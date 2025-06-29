import { EventEmitter } from 'events';
import { OrderBook } from './OrderBook';
import {
  Order,
  OrderType,
  OrderStatus,
  OrderSide,
  TimeInForce,
  Trade,
  ExecutionReport,
  MatchingEngineConfig,
  MarketData,
  OrderBookSnapshot,
} from './types';

export class MatchingEngine extends EventEmitter {
  private orderBooks: Map<string, OrderBook>;
  private orders: Map<string, Order>;
  private trades: Trade[];
  private config: MatchingEngineConfig;
  private marketData: Map<string, MarketData>;
  private orderSequence: number;

  constructor(config: MatchingEngineConfig) {
    super();
    this.orderBooks = new Map();
    this.orders = new Map();
    this.trades = [];
    this.config = config;
    this.marketData = new Map();
    this.orderSequence = 0;
  }

  // Initialize order book for a trading pair
  initializePair(pair: string, tickSize?: number): void {
    if (!this.orderBooks.has(pair)) {
      const pairTickSize = tickSize || this.config.tickSize[pair] || 0.01;
      this.orderBooks.set(pair, new OrderBook(pair, pairTickSize));
      
      // Initialize market data
      this.marketData.set(pair, {
        pair,
        lastPrice: 0,
        bidPrice: 0,
        askPrice: 0,
        bidQuantity: 0,
        askQuantity: 0,
        volume24h: 0,
        high24h: 0,
        low24h: Infinity,
        openPrice24h: 0,
        lastUpdateTime: Date.now(),
      });

      this.emit('pairInitialized', { pair, tickSize: pairTickSize });
    }
  }

  // Submit a new order
  async submitOrder(orderRequest: Partial<Order>): Promise<ExecutionReport> {
    // Validate order
    this.validateOrder(orderRequest);

    // Create order object
    const order: Order = {
      id: this.generateOrderId(),
      userId: orderRequest.userId!,
      pair: orderRequest.pair!,
      side: orderRequest.side!,
      type: orderRequest.type!,
      price: orderRequest.price || 0,
      quantity: orderRequest.quantity!,
      filledQuantity: 0,
      status: OrderStatus.PENDING,
      timeInForce: orderRequest.timeInForce || TimeInForce.GTC,
      timestamp: Date.now(),
      lastUpdateTime: Date.now(),
      clientOrderId: orderRequest.clientOrderId,
      metadata: orderRequest.metadata,
    };

    // Store order
    this.orders.set(order.id, order);

    // Get order book
    const orderBook = this.orderBooks.get(order.pair);
    if (!orderBook) {
      throw new Error(`Order book not found for pair ${order.pair}`);
    }

    let executionReport: ExecutionReport;

    try {
      // Process based on order type
      if (order.type === OrderType.MARKET) {
        executionReport = await this.processMarketOrder(order, orderBook);
      } else {
        executionReport = await this.processLimitOrder(order, orderBook);
      }

      // Emit events
      this.emit('orderSubmitted', order);
      this.emit('executionReport', executionReport);

      // Update market data
      this.updateMarketData(order.pair, executionReport.trades);

      return executionReport;
    } catch (error) {
      order.status = OrderStatus.CANCELLED;
      order.lastUpdateTime = Date.now();
      
      const errorReport: ExecutionReport = {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        executionId: this.generateExecutionId(),
        status: OrderStatus.CANCELLED,
        side: order.side,
        pair: order.pair,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: 0,
        remainingQuantity: order.quantity,
        averagePrice: 0,
        trades: [],
        timestamp: Date.now(),
        message: error instanceof Error ? error.message : 'Order processing failed',
      };

      this.emit('orderCancelled', order);
      this.emit('executionReport', errorReport);
      
      throw error;
    }
  }

  // Process market order
  private async processMarketOrder(order: Order, orderBook: OrderBook): Promise<ExecutionReport> {
    // Set market order price to ensure matching
    if (order.side === OrderSide.BUY) {
      order.price = Number.MAX_SAFE_INTEGER; // Buy at any price
    } else {
      order.price = 0.000001; // Sell at any price (but not 0)
    }
    
    // Market orders match immediately against available liquidity
    const trades = orderBook.matchOrders(order);

    // Check Time in Force constraints
    if (order.timeInForce === TimeInForce.FOK && order.filledQuantity < order.quantity) {
      // Fill or Kill - cancel if not fully filled
      order.status = OrderStatus.CANCELLED;
      order.lastUpdateTime = Date.now();
      
      // Revert trades
      for (const trade of trades) {
        const makerOrder = this.orders.get(trade.makerOrderId);
        if (makerOrder) {
          makerOrder.filledQuantity -= trade.quantity;
          orderBook.updateOrderFill(trade.makerOrderId, makerOrder.filledQuantity);
        }
      }
      
      return this.generateExecutionReport(order, []);
    }

    // Store trades
    this.trades.push(...trades);

    // Update order status
    if (order.filledQuantity === 0) {
      order.status = OrderStatus.CANCELLED;
    } else if (order.filledQuantity < order.quantity) {
      order.status = OrderStatus.PARTIALLY_FILLED;
      if (order.timeInForce === TimeInForce.IOC) {
        // Immediate or Cancel - cancel remaining
        order.status = OrderStatus.CANCELLED;
      }
    } else {
      order.status = OrderStatus.FILLED;
    }

    order.lastUpdateTime = Date.now();

    // Calculate fees
    for (const trade of trades) {
      trade.takerFee = trade.quantity * trade.price * this.config.takerFeeRate;
      trade.makerFee = trade.quantity * trade.price * this.config.makerFeeRate;
    }

    // Update maker orders
    for (const trade of trades) {
      const makerOrder = this.orders.get(trade.makerOrderId);
      if (makerOrder) {
        orderBook.updateOrderFill(trade.makerOrderId, makerOrder.filledQuantity);
        if (makerOrder.status === OrderStatus.FILLED) {
          this.emit('orderFilled', makerOrder);
        }
      }
    }

    return this.generateExecutionReport(order, trades);
  }

  // Process limit order
  private async processLimitOrder(order: Order, orderBook: OrderBook): Promise<ExecutionReport> {
    // Try to match immediately
    const trades = orderBook.matchOrders(order);

    // Store trades
    this.trades.push(...trades);

    // Calculate fees
    for (const trade of trades) {
      trade.takerFee = trade.quantity * trade.price * this.config.takerFeeRate;
      trade.makerFee = trade.quantity * trade.price * this.config.makerFeeRate;
    }

    // Update maker orders
    for (const trade of trades) {
      const makerOrder = this.orders.get(trade.makerOrderId);
      if (makerOrder) {
        orderBook.updateOrderFill(trade.makerOrderId, makerOrder.filledQuantity);
        if (makerOrder.status === OrderStatus.FILLED) {
          this.emit('orderFilled', makerOrder);
        }
      }
    }

    // Check if order should be added to book
    if (order.filledQuantity < order.quantity) {
      // Check Time in Force
      if (order.timeInForce === TimeInForce.IOC || order.timeInForce === TimeInForce.FOK) {
        // Cancel remaining
        order.status = OrderStatus.CANCELLED;
        
        if (order.timeInForce === TimeInForce.FOK && order.filledQuantity > 0) {
          // Revert trades for FOK
          for (const trade of trades) {
            const makerOrder = this.orders.get(trade.makerOrderId);
            if (makerOrder) {
              makerOrder.filledQuantity -= trade.quantity;
              orderBook.updateOrderFill(trade.makerOrderId, makerOrder.filledQuantity);
            }
          }
          order.filledQuantity = 0;
          return this.generateExecutionReport(order, []);
        }
      } else {
        // Add to order book
        order.status = order.filledQuantity > 0 ? OrderStatus.PARTIALLY_FILLED : OrderStatus.OPEN;
        orderBook.addOrder(order);
        this.emit('orderAdded', order);
      }
    } else {
      order.status = OrderStatus.FILLED;
      this.emit('orderFilled', order);
    }

    order.lastUpdateTime = Date.now();

    return this.generateExecutionReport(order, trades);
  }

  // Cancel an order
  async cancelOrder(orderId: string, userId?: string): Promise<ExecutionReport> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (userId && order.userId !== userId) {
      throw new Error('Unauthorized to cancel this order');
    }

    if (order.status === OrderStatus.FILLED || order.status === OrderStatus.CANCELLED) {
      throw new Error(`Order ${orderId} is already ${order.status}`);
    }

    const orderBook = this.orderBooks.get(order.pair);
    if (orderBook) {
      orderBook.removeOrder(orderId);
    }

    order.status = OrderStatus.CANCELLED;
    order.lastUpdateTime = Date.now();

    const report = this.generateExecutionReport(order, []);
    
    this.emit('orderCancelled', order);
    this.emit('executionReport', report);

    return report;
  }

  // Generate execution report
  private generateExecutionReport(order: Order, trades: Trade[]): ExecutionReport {
    const totalValue = trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
    const averagePrice = trades.length > 0 ? totalValue / order.filledQuantity : 0;

    return {
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      executionId: this.generateExecutionId(),
      status: order.status,
      side: order.side,
      pair: order.pair,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      remainingQuantity: order.quantity - order.filledQuantity,
      averagePrice,
      trades,
      timestamp: Date.now(),
    };
  }

  // Validate order
  private validateOrder(order: Partial<Order>): void {
    if (!order.userId) throw new Error('User ID is required');
    if (!order.pair) throw new Error('Trading pair is required');
    if (!order.side) throw new Error('Order side is required');
    if (!order.type) throw new Error('Order type is required');
    if (!order.quantity || order.quantity <= 0) throw new Error('Invalid quantity');

    // Check min/max order size
    const minSize = this.config.minOrderSize[order.pair] || 0;
    const maxSize = this.config.maxOrderSize[order.pair] || Infinity;
    
    if (order.quantity < minSize) {
      throw new Error(`Order size below minimum ${minSize}`);
    }
    if (order.quantity > maxSize) {
      throw new Error(`Order size above maximum ${maxSize}`);
    }

    // Validate limit order price
    if (order.type === OrderType.LIMIT) {
      if (!order.price || order.price <= 0) {
        throw new Error('Price is required for limit orders');
      }
    }
  }

  // Update market data
  private updateMarketData(pair: string, trades: Trade[]): void {
    if (trades.length === 0) return;

    const marketData = this.marketData.get(pair);
    if (!marketData) return;

    const orderBook = this.orderBooks.get(pair);
    if (!orderBook) return;

    // Update last price
    marketData.lastPrice = trades[trades.length - 1].price;

    // Update bid/ask
    const bestBid = orderBook.getBestBid();
    const bestAsk = orderBook.getBestAsk();
    
    marketData.bidPrice = bestBid ? bestBid.price : 0;
    marketData.bidQuantity = bestBid ? bestBid.quantity : 0;
    marketData.askPrice = bestAsk ? bestAsk.price : 0;
    marketData.askQuantity = bestAsk ? bestAsk.quantity : 0;

    // Update 24h stats (simplified - in production, this would track actual 24h window)
    const tradeVolume = trades.reduce((sum, trade) => sum + trade.quantity * trade.price, 0);
    marketData.volume24h += tradeVolume;

    for (const trade of trades) {
      if (trade.price > marketData.high24h) marketData.high24h = trade.price;
      if (trade.price < marketData.low24h) marketData.low24h = trade.price;
    }

    marketData.lastUpdateTime = Date.now();

    this.emit('marketDataUpdate', marketData);
  }

  // Get order book snapshot
  getOrderBook(pair: string, depth: number = 50): OrderBookSnapshot | null {
    const orderBook = this.orderBooks.get(pair);
    return orderBook ? orderBook.getSnapshot(depth) : null;
  }

  // Get market data
  getMarketData(pair: string): MarketData | null {
    return this.marketData.get(pair) || null;
  }

  // Get order
  getOrder(orderId: string): Order | null {
    return this.orders.get(orderId) || null;
  }

  // Get user orders
  getUserOrders(userId: string, pair?: string, status?: OrderStatus): Order[] {
    const orders = Array.from(this.orders.values()).filter(order => {
      if (order.userId !== userId) return false;
      if (pair && order.pair !== pair) return false;
      if (status && order.status !== status) return false;
      return true;
    });

    return orders.sort((a, b) => b.timestamp - a.timestamp);
  }

  // Get recent trades
  getRecentTrades(pair: string, limit: number = 100): Trade[] {
    return this.trades
      .filter(trade => trade.pair === pair)
      .slice(-limit)
      .reverse();
  }

  // Generate unique order ID
  private generateOrderId(): string {
    return `ORD-${Date.now()}-${(++this.orderSequence).toString().padStart(6, '0')}`;
  }

  // Generate unique execution ID
  private generateExecutionId(): string {
    return `EXEC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get all trading pairs
  getTradingPairs(): string[] {
    return Array.from(this.orderBooks.keys());
  }

  // Clear all data (for testing)
  clear(): void {
    this.orderBooks.clear();
    this.orders.clear();
    this.trades = [];
    this.marketData.clear();
    this.orderSequence = 0;
  }
}