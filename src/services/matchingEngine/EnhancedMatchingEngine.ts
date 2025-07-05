import { MatchingEngine } from './MatchingEngine';
import {
  Order,
  Trade,
  ExecutionReport,
  OrderBookUpdate,
  OrderBookSnapshot,
  MarketData,
  OrderSide,
  OrderStatus,
  OrderType,
  TimeInForce,
  MatchingEngineConfig
} from './types';

export interface OrderBookChange {
  pair: string;
  side: OrderSide;
  price: number;
  oldQuantity: number;
  newQuantity: number;
  timestamp: number;
}

export class EnhancedMatchingEngine extends MatchingEngine {
  private lastOrderBookSnapshots: Map<string, OrderBookSnapshot> = new Map();
  private orderBookSequence: Map<string, number> = new Map();

  constructor(config: MatchingEngineConfig) {
    super(config);
  }

  // Override submitOrder to emit proper events
  async submitOrder(orderRequest: Partial<Order>): Promise<ExecutionReport> {
    const executionReport = await super.submitOrder(orderRequest);
    const order = this.getOrder(executionReport.orderId);

    if (order) {
      // Emit order status update
      this.emit('orderUpdate', {
        order,
        executionReport,
        timestamp: Date.now()
      });

      // Emit trades if any
      if (executionReport.trades.length > 0) {
        for (const trade of executionReport.trades) {
          this.emitTradeEvent(trade);
        }
      }

      // Emit order book updates
      if (order.status === OrderStatus.OPEN || order.status === OrderStatus.PARTIALLY_FILLED) {
        this.emitOrderBookUpdate(order.pair, 'ADD', order);
      }
    }

    return executionReport;
  }

  // Override cancelOrder to emit proper events
  async cancelOrder(orderId: string, userId?: string): Promise<ExecutionReport> {
    const order = this.getOrder(orderId);
    const executionReport = await super.cancelOrder(orderId, userId);

    if (order) {
      // Emit order status update
      this.emit('orderUpdate', {
        order: this.getOrder(orderId),
        executionReport,
        timestamp: Date.now()
      });

      // Emit order book update for removal
      this.emitOrderBookUpdate(order.pair, 'REMOVE', order);
    }

    return executionReport;
  }

  // Emit enhanced trade event
  private emitTradeEvent(trade: Trade): void {
    // Get the orders involved
    const takerOrder = this.getOrder(trade.takerOrderId);
    const makerOrder = this.getOrder(trade.makerOrderId);

    this.emit('trade', {
      trade,
      takerOrder,
      makerOrder,
      timestamp: Date.now()
    });

    // Emit user-specific trade events
    if (takerOrder) {
      this.emit('userTrade', {
        userId: takerOrder.userId,
        trade,
        side: trade.takerSide,
        role: 'TAKER'
      });
    }

    if (makerOrder) {
      this.emit('userTrade', {
        userId: makerOrder.userId,
        trade,
        side: trade.takerSide === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY,
        role: 'MAKER'
      });
    }

    // Update market data
    this.updateAndEmitMarketData(trade.pair, trade);
  }

  // Emit order book update
  private emitOrderBookUpdate(pair: string, action: 'ADD' | 'UPDATE' | 'REMOVE', order: Order): void {
    const sequence = this.getNextSequence(pair);
    
    const update: OrderBookUpdate = {
      type: action,
      side: order.side,
      price: order.price,
      quantity: action === 'REMOVE' ? 0 : order.quantity - order.filledQuantity,
      orderId: order.id,
      timestamp: Date.now(),
      sequenceNumber: sequence
    };

    this.emit('orderBookUpdate', {
      pair,
      update,
      timestamp: Date.now()
    });

    // Also emit depth change for specific price level
    this.emitOrderBookDepthChange(pair, order.side, order.price);
  }

  // Emit order book depth change
  private emitOrderBookDepthChange(pair: string, side: OrderSide, price: number): void {
    const orderBook = this.getOrderBook(pair);
    if (!orderBook) return;

    const snapshot = orderBook.getSnapshot();
    const level = side === OrderSide.BUY 
      ? snapshot.bids.find(l => l.price === price)
      : snapshot.asks.find(l => l.price === price);

    const change: OrderBookChange = {
      pair,
      side,
      price,
      oldQuantity: 0, // Would need to track this
      newQuantity: level?.quantity || 0,
      timestamp: Date.now()
    };

    this.emit('orderBookDepthChange', change);
  }

  // Update and emit market data
  private updateAndEmitMarketData(pair: string, trade: Trade): void {
    const marketData = this.getMarketData(pair);
    if (!marketData) return;

    // Update 24h volume
    marketData.volume24h += trade.quantity * trade.price;

    // Update last price
    marketData.lastPrice = trade.price;

    // Update 24h high/low
    if (trade.price > marketData.high24h) {
      marketData.high24h = trade.price;
    }
    if (trade.price < marketData.low24h) {
      marketData.low24h = trade.price;
    }

    // Update best bid/ask from order book
    const orderBook = this.getOrderBook(pair);
    if (orderBook) {
      const snapshot = orderBook.getSnapshot();
      marketData.bidPrice = snapshot.bids[0]?.price || 0;
      marketData.bidQuantity = snapshot.bids[0]?.quantity || 0;
      marketData.askPrice = snapshot.asks[0]?.price || 0;
      marketData.askQuantity = snapshot.asks[0]?.quantity || 0;
    }

    marketData.lastUpdateTime = Date.now();

    this.emit('marketData', {
      pair,
      data: marketData,
      timestamp: Date.now()
    });

    // Emit ticker update
    this.emit('ticker', {
      pair,
      lastPrice: marketData.lastPrice,
      bidPrice: marketData.bidPrice,
      askPrice: marketData.askPrice,
      volume24h: marketData.volume24h,
      high24h: marketData.high24h,
      low24h: marketData.low24h,
      change24h: marketData.openPrice24h > 0 
        ? ((marketData.lastPrice - marketData.openPrice24h) / marketData.openPrice24h) * 100 
        : 0,
      timestamp: Date.now()
    });
  }

  // Get order book snapshot with sequence number
  getOrderBookSnapshotWithSequence(pair: string): OrderBookSnapshot & { sequenceNumber: number } {
    const snapshot = this.getOrderBookSnapshot(pair);
    const sequence = this.orderBookSequence.get(pair) || 0;
    
    return {
      ...snapshot,
      sequenceNumber: sequence
    };
  }

  // Get recent trades with enhanced info
  getRecentTradesEnhanced(pair: string, limit: number = 100): Array<Trade & { timestamp: number }> {
    return this.getRecentTrades(pair, limit).map(trade => ({
      ...trade,
      timestamp: trade.timestamp || Date.now()
    }));
  }

  // Get user's open orders
  getUserOpenOrders(userId: string, pair?: string): Order[] {
    return this.getOrders(userId, pair).filter(
      order => order.status === OrderStatus.OPEN || order.status === OrderStatus.PARTIALLY_FILLED
    );
  }

  // Get user's order history
  getUserOrderHistory(userId: string, pair?: string, limit: number = 100): Order[] {
    return this.getOrders(userId, pair)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Get user's trade history
  getUserTradeHistory(userId: string, pair?: string, limit: number = 100): Trade[] {
    const userTrades: Trade[] = [];
    const trades = pair ? this.getRecentTrades(pair, 1000) : this.getAllTrades();

    for (const trade of trades) {
      const takerOrder = this.getOrder(trade.takerOrderId);
      const makerOrder = this.getOrder(trade.makerOrderId);

      if (takerOrder?.userId === userId || makerOrder?.userId === userId) {
        userTrades.push(trade);
      }

      if (userTrades.length >= limit) break;
    }

    return userTrades;
  }

  // Get all trades (for user history across all pairs)
  private getAllTrades(): Trade[] {
    // This would need to be implemented in the base class
    // For now, aggregate from all pairs
    const allTrades: Trade[] = [];
    for (const pair of this.getTradingPairs()) {
      allTrades.push(...this.getRecentTrades(pair, 1000));
    }
    return allTrades.sort((a, b) => b.timestamp - a.timestamp);
  }

  // Get next sequence number for a pair
  private getNextSequence(pair: string): number {
    const current = this.orderBookSequence.get(pair) || 0;
    const next = current + 1;
    this.orderBookSequence.set(pair, next);
    return next;
  }

  // Emit periodic snapshots
  emitOrderBookSnapshot(pair: string): void {
    const snapshot = this.getOrderBookSnapshotWithSequence(pair);
    
    this.emit('orderBookSnapshot', {
      pair,
      snapshot,
      timestamp: Date.now()
    });

    // Store last snapshot
    this.lastOrderBookSnapshots.set(pair, snapshot);
  }

  // Get order book (expose protected method)
  getOrderBook(pair: string): any {
    return this['orderBooks'].get(pair);
  }

  // Emit initial state for new connections
  emitInitialState(userId?: string): void {
    // Emit snapshots for all pairs
    for (const pair of this.getTradingPairs()) {
      this.emitOrderBookSnapshot(pair);
      
      // Emit market data
      const marketData = this.getMarketData(pair);
      if (marketData) {
        this.emit('marketData', {
          pair,
          data: marketData,
          timestamp: Date.now()
        });
      }
    }

    // Emit user-specific data if userId provided
    if (userId) {
      // Emit user's open orders
      const openOrders = this.getUserOpenOrders(userId);
      this.emit('userOrders', {
        userId,
        orders: openOrders,
        timestamp: Date.now()
      });

      // Emit user's recent trades
      const recentTrades = this.getUserTradeHistory(userId, undefined, 50);
      this.emit('userTrades', {
        userId,
        trades: recentTrades,
        timestamp: Date.now()
      });
    }
  }
}