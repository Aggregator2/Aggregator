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
import { db, TransactionClient } from '../../database/config';
import { OrderRepository } from '../../database/repositories/OrderRepository';
import { TradeRepository } from '../../database/repositories/TradeRepository';
import { UserBalanceRepository } from '../../database/repositories/UserBalanceRepository';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class DatabaseMatchingEngine extends EventEmitter {
  private orderBooks: Map<string, OrderBook>;
  private config: MatchingEngineConfig;
  private orderRepo: OrderRepository;
  private tradeRepo: TradeRepository;
  private balanceRepo: UserBalanceRepository;
  private marketData: Map<string, MarketData>;

  constructor(config: MatchingEngineConfig) {
    super();
    this.orderBooks = new Map();
    this.config = config;
    this.orderRepo = new OrderRepository();
    this.tradeRepo = new TradeRepository();
    this.balanceRepo = new UserBalanceRepository();
    this.marketData = new Map();
  }

  async initialize(): Promise<void> {
    try {
      // Initialize database connection
      await db.connect();
      
      // Load active orders from database
      await this.loadActiveOrders();
      
      // Start periodic tasks
      this.startPeriodicTasks();
      
      logger.info('DatabaseMatchingEngine initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize DatabaseMatchingEngine', error);
      throw error;
    }
  }

  private async loadActiveOrders(): Promise<void> {
    // Load all trading pairs
    const pairs = Object.keys(this.config.tickSize);
    
    for (const pair of pairs) {
      this.initializePair(pair);
      
      // Load active orders for this pair
      const activeOrders = await this.orderRepo.getActiveOrdersByPair(pair);
      const orderBook = this.orderBooks.get(pair)!;
      
      for (const order of activeOrders) {
        orderBook.addOrder(order);
      }
      
      logger.info(`Loaded ${activeOrders.length} active orders for ${pair}`);
    }
  }

  private startPeriodicTasks(): void {
    // Cancel expired orders every minute
    setInterval(async () => {
      try {
        const cancelledCount = await this.orderRepo.cancelExpiredOrders();
        if (cancelledCount > 0) {
          logger.info(`Cancelled ${cancelledCount} expired orders`);
        }
      } catch (error) {
        logger.error('Error cancelling expired orders', error);
      }
    }, 60000);

    // Update market data every 5 seconds
    setInterval(async () => {
      await this.updateAllMarketData();
    }, 5000);
  }

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

  async submitOrder(orderRequest: Partial<Order>): Promise<ExecutionReport> {
    // Validate order
    this.validateOrder(orderRequest);

    // Create order object with UUID
    const order: Order = {
      id: uuidv4(),
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

    // Get order book
    const orderBook = this.orderBooks.get(order.pair);
    if (!orderBook) {
      throw new Error(`Order book not found for pair ${order.pair}`);
    }

    // Execute in transaction
    return await db.transaction(async (client: TransactionClient) => {
      try {
        // Lock user balance
        const [baseCurrency, quoteCurrency] = order.pair.split('/');
        const lockCurrency = order.side === OrderSide.BUY ? quoteCurrency : baseCurrency;
        const lockAmount = order.side === OrderSide.BUY 
          ? order.quantity * (order.price || Number.MAX_SAFE_INTEGER)
          : order.quantity;

        await this.balanceRepo.lockBalance(
          order.userId,
          lockCurrency,
          lockAmount,
          client
        );

        // Save order to database
        await this.orderRepo.createOrder(order, client);

        // Process order
        let executionReport: ExecutionReport;
        const trades: Trade[] = [];

        if (order.type === OrderType.MARKET) {
          executionReport = await this.processMarketOrder(order, orderBook, trades, client);
        } else {
          executionReport = await this.processLimitOrder(order, orderBook, trades, client);
        }

        // Save trades to database
        if (trades.length > 0) {
          await this.tradeRepo.createBulkTrades(trades, client);
        }

        // Update order in database
        await this.orderRepo.updateOrder(
          order.id,
          {
            filledQuantity: order.filledQuantity,
            status: order.status,
            lastUpdateTime: order.lastUpdateTime,
          },
          client
        );

        // Process balance updates for executed trades
        await this.processTradeBalances(trades, client);

        // Emit events
        this.emit('orderSubmitted', order);
        this.emit('executionReport', executionReport);

        // Update market data
        await this.updateMarketData(order.pair, trades);

        return executionReport;
      } catch (error) {
        logger.error('Error processing order', { order, error });
        throw error;
      }
    });
  }

  private async processMarketOrder(
    order: Order,
    orderBook: OrderBook,
    tradesOut: Trade[],
    client: TransactionClient
  ): Promise<ExecutionReport> {
    // Set market order price to ensure matching
    if (order.side === OrderSide.BUY) {
      order.price = Number.MAX_SAFE_INTEGER;
    } else {
      order.price = 0.000001;
    }
    
    // Lock maker orders before matching
    const potentialMatches = orderBook.getPotentialMatches(order);
    const makerOrderIds = potentialMatches.map(o => o.id);
    const lockedMakerOrders = await this.orderRepo.lockOrdersForMatching(makerOrderIds, client);
    
    // Match orders
    const trades = orderBook.matchOrders(order);
    tradesOut.push(...trades);

    // Check Time in Force constraints
    if (order.timeInForce === TimeInForce.FOK && order.filledQuantity < order.quantity) {
      // Fill or Kill - cancel if not fully filled
      order.status = OrderStatus.CANCELLED;
      order.lastUpdateTime = Date.now();
      
      // Revert trades
      tradesOut.length = 0;
      return this.generateExecutionReport(order, []);
    }

    // Calculate fees
    for (const trade of trades) {
      trade.takerFee = trade.quantity * trade.price * this.config.takerFeeRate;
      trade.makerFee = trade.quantity * trade.price * this.config.makerFeeRate;
    }

    // Update maker orders in database
    for (const trade of trades) {
      const makerOrder = lockedMakerOrders.find(o => o.id === trade.makerOrderId);
      if (makerOrder) {
        makerOrder.filledQuantity += trade.quantity;
        const newStatus = makerOrder.filledQuantity >= makerOrder.quantity 
          ? OrderStatus.FILLED 
          : OrderStatus.PARTIALLY_FILLED;
        
        await this.orderRepo.updateOrder(
          makerOrder.id,
          {
            filledQuantity: makerOrder.filledQuantity,
            status: newStatus,
            lastUpdateTime: Date.now(),
          },
          client
        );

        orderBook.updateOrderFill(trade.makerOrderId, makerOrder.filledQuantity);
        
        if (newStatus === OrderStatus.FILLED) {
          this.emit('orderFilled', makerOrder);
        }
      }
    }

    // Update order status
    if (order.filledQuantity === 0) {
      order.status = OrderStatus.CANCELLED;
    } else if (order.filledQuantity < order.quantity) {
      order.status = OrderStatus.PARTIALLY_FILLED;
      if (order.timeInForce === TimeInForce.IOC) {
        order.status = OrderStatus.CANCELLED;
      }
    } else {
      order.status = OrderStatus.FILLED;
    }

    order.lastUpdateTime = Date.now();

    return this.generateExecutionReport(order, trades);
  }

  private async processLimitOrder(
    order: Order,
    orderBook: OrderBook,
    tradesOut: Trade[],
    client: TransactionClient
  ): Promise<ExecutionReport> {
    // Lock potential maker orders
    const potentialMatches = orderBook.getPotentialMatches(order);
    const makerOrderIds = potentialMatches.map(o => o.id);
    const lockedMakerOrders = await this.orderRepo.lockOrdersForMatching(makerOrderIds, client);
    
    // Try to match immediately
    const trades = orderBook.matchOrders(order);
    tradesOut.push(...trades);

    // Calculate fees
    for (const trade of trades) {
      trade.takerFee = trade.quantity * trade.price * this.config.takerFeeRate;
      trade.makerFee = trade.quantity * trade.price * this.config.makerFeeRate;
    }

    // Update maker orders
    for (const trade of trades) {
      const makerOrder = lockedMakerOrders.find(o => o.id === trade.makerOrderId);
      if (makerOrder) {
        makerOrder.filledQuantity += trade.quantity;
        const newStatus = makerOrder.filledQuantity >= makerOrder.quantity 
          ? OrderStatus.FILLED 
          : OrderStatus.PARTIALLY_FILLED;
        
        await this.orderRepo.updateOrder(
          makerOrder.id,
          {
            filledQuantity: makerOrder.filledQuantity,
            status: newStatus,
            lastUpdateTime: Date.now(),
          },
          client
        );

        orderBook.updateOrderFill(trade.makerOrderId, makerOrder.filledQuantity);
        
        if (newStatus === OrderStatus.FILLED) {
          this.emit('orderFilled', makerOrder);
        }
      }
    }

    // Check if order should be added to book
    if (order.filledQuantity < order.quantity) {
      // Check Time in Force
      if (order.timeInForce === TimeInForce.IOC || order.timeInForce === TimeInForce.FOK) {
        order.status = OrderStatus.CANCELLED;
        
        if (order.timeInForce === TimeInForce.FOK && order.filledQuantity > 0) {
          // Revert trades for FOK
          tradesOut.length = 0;
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

  private async processTradeBalances(trades: Trade[], client: TransactionClient): Promise<void> {
    for (const trade of trades) {
      const [baseCurrency, quoteCurrency] = trade.pair.split('/');
      
      // Get user IDs from orders
      const takerOrder = await this.orderRepo.getOrderById(trade.takerOrderId);
      const makerOrder = await this.orderRepo.getOrderById(trade.makerOrderId);
      
      if (!takerOrder || !makerOrder) {
        throw new Error('Order not found for trade balance processing');
      }

      const quoteAmount = trade.price * trade.quantity;

      // Process taker balances
      if (trade.takerSide === OrderSide.BUY) {
        // Taker buys base, sells quote
        await this.balanceRepo.updateBalance(
          takerOrder.userId,
          baseCurrency,
          trade.quantity - trade.takerFee, // Receive base minus fee
          0,
          `Trade ${trade.id}`,
          client
        );
        await this.balanceRepo.updateBalance(
          takerOrder.userId,
          quoteCurrency,
          -quoteAmount,
          -quoteAmount, // Unlock the locked amount
          `Trade ${trade.id}`,
          client
        );
      } else {
        // Taker sells base, buys quote
        await this.balanceRepo.updateBalance(
          takerOrder.userId,
          baseCurrency,
          -trade.quantity,
          -trade.quantity, // Unlock the locked amount
          `Trade ${trade.id}`,
          client
        );
        await this.balanceRepo.updateBalance(
          takerOrder.userId,
          quoteCurrency,
          quoteAmount - trade.takerFee, // Receive quote minus fee
          0,
          `Trade ${trade.id}`,
          client
        );
      }

      // Process maker balances
      if (trade.takerSide === OrderSide.BUY) {
        // Maker sells base, buys quote
        await this.balanceRepo.updateBalance(
          makerOrder.userId,
          baseCurrency,
          -trade.quantity,
          -trade.quantity, // Unlock the locked amount
          `Trade ${trade.id}`,
          client
        );
        await this.balanceRepo.updateBalance(
          makerOrder.userId,
          quoteCurrency,
          quoteAmount - trade.makerFee, // Receive quote minus fee
          0,
          `Trade ${trade.id}`,
          client
        );
      } else {
        // Maker buys base, sells quote
        await this.balanceRepo.updateBalance(
          makerOrder.userId,
          baseCurrency,
          trade.quantity - trade.makerFee, // Receive base minus fee
          0,
          `Trade ${trade.id}`,
          client
        );
        await this.balanceRepo.updateBalance(
          makerOrder.userId,
          quoteCurrency,
          -quoteAmount,
          -quoteAmount, // Unlock the locked amount
          `Trade ${trade.id}`,
          client
        );
      }
    }
  }

  async cancelOrder(orderId: string, userId?: string): Promise<ExecutionReport> {
    return await db.transaction(async (client: TransactionClient) => {
      // Lock and fetch order
      const orders = await this.orderRepo.lockOrdersForMatching([orderId], client);
      const order = orders[0];
      
      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }

      if (userId && order.userId !== userId) {
        throw new Error('Unauthorized to cancel this order');
      }

      if (order.status === OrderStatus.FILLED || order.status === OrderStatus.CANCELLED) {
        throw new Error(`Order ${orderId} is already ${order.status}`);
      }

      // Remove from order book
      const orderBook = this.orderBooks.get(order.pair);
      if (orderBook) {
        orderBook.removeOrder(orderId);
      }

      // Update order status
      order.status = OrderStatus.CANCELLED;
      order.lastUpdateTime = Date.now();

      await this.orderRepo.updateOrder(
        order.id,
        {
          status: order.status,
          lastUpdateTime: order.lastUpdateTime,
        },
        client
      );

      // Unlock remaining balance
      const [baseCurrency, quoteCurrency] = order.pair.split('/');
      const remainingQuantity = order.quantity - order.filledQuantity;
      
      if (remainingQuantity > 0) {
        const unlockCurrency = order.side === OrderSide.BUY ? quoteCurrency : baseCurrency;
        const unlockAmount = order.side === OrderSide.BUY 
          ? remainingQuantity * order.price
          : remainingQuantity;

        await this.balanceRepo.unlockBalance(
          order.userId,
          unlockCurrency,
          unlockAmount,
          client
        );
      }

      const report = this.generateExecutionReport(order, []);
      
      this.emit('orderCancelled', order);
      this.emit('executionReport', report);

      return report;
    });
  }

  private generateExecutionReport(order: Order, trades: Trade[]): ExecutionReport {
    const totalValue = trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
    const averagePrice = trades.length > 0 && order.filledQuantity > 0 
      ? totalValue / order.filledQuantity 
      : 0;

    return {
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      executionId: `EXEC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

  private validateOrder(order: Partial<Order>): void {
    if (!order.userId) throw new Error('User ID is required');
    if (!order.pair) throw new Error('Trading pair is required');
    if (!order.side) throw new Error('Order side is required');
    if (!order.type) throw new Error('Order type is required');
    if (!order.quantity || order.quantity <= 0) throw new Error('Invalid quantity');

    // Check min/max order size
    const minSize = this.config.minOrderSize[order.pair!] || 0;
    const maxSize = this.config.maxOrderSize[order.pair!] || Infinity;
    
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
      
      // Check tick size
      const tickSize = this.config.tickSize[order.pair!] || 0.01;
      if (order.price % tickSize !== 0) {
        throw new Error(`Price must be a multiple of tick size ${tickSize}`);
      }
    }
  }

  private async updateMarketData(pair: string, trades: Trade[]): Promise<void> {
    const marketData = this.marketData.get(pair);
    if (!marketData) return;

    // Fetch latest stats from database
    const stats = await this.tradeRepo.getMarketStats(pair);
    
    // Update market data
    marketData.lastPrice = stats.lastPrice;
    marketData.volume24h = stats.volume24h;
    marketData.high24h = stats.high24h;
    marketData.low24h = stats.low24h;
    
    // Get order book top
    const orderBook = this.orderBooks.get(pair);
    if (orderBook) {
      const bestBid = orderBook.getBestBid();
      const bestAsk = orderBook.getBestAsk();
      
      marketData.bidPrice = bestBid ? bestBid.price : 0;
      marketData.bidQuantity = bestBid ? bestBid.quantity : 0;
      marketData.askPrice = bestAsk ? bestAsk.price : 0;
      marketData.askQuantity = bestAsk ? bestAsk.quantity : 0;
    }

    marketData.lastUpdateTime = Date.now();

    this.emit('marketDataUpdate', marketData);
  }

  private async updateAllMarketData(): Promise<void> {
    for (const pair of this.orderBooks.keys()) {
      await this.updateMarketData(pair, []);
    }
  }

  async getOrderBook(pair: string, depth: number = 50): Promise<OrderBookSnapshot | null> {
    const snapshot = await this.orderRepo.getOrderBookSnapshot(pair, depth);
    
    return {
      pair,
      bids: snapshot.bids.map(level => ({
        price: level.price,
        quantity: level.quantity,
        orders: [], // Not loading individual orders for performance
      })),
      asks: snapshot.asks.map(level => ({
        price: level.price,
        quantity: level.quantity,
        orders: [], // Not loading individual orders for performance
      })),
      lastUpdateTime: Date.now(),
      sequenceNumber: 0, // Would need to implement proper sequencing
    };
  }

  async getMarketData(pair: string): Promise<MarketData | null> {
    return this.marketData.get(pair) || null;
  }

  async getOrder(orderId: string): Promise<Order | null> {
    return await this.orderRepo.getOrderById(orderId);
  }

  async getUserOrders(
    userId: string,
    filters?: {
      pair?: string;
      status?: OrderStatus[];
      startTime?: number;
      endTime?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<Order[]> {
    return await this.orderRepo.getOrdersByUser(userId, filters);
  }

  async getRecentTrades(pair: string, limit: number = 100): Promise<Trade[]> {
    return await this.tradeRepo.getRecentTrades(pair, limit);
  }

  async shutdown(): Promise<void> {
    await db.disconnect();
    this.removeAllListeners();
    logger.info('DatabaseMatchingEngine shut down');
  }
}