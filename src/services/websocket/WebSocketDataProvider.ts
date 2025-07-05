import { WebSocketServer } from './WebSocketServer';
import { EnhancedMatchingEngine } from '../matchingEngine/EnhancedMatchingEngine';
import { ProofGeneratingSettlementEngine } from '../settlement/ProofGeneratingSettlementEngine';
import { EventEmitter } from 'events';
import { Order, Trade, OrderBook } from '../matchingEngine/types';
import { RateLimiter } from './RateLimiter';

export interface WebSocketDataProviderConfig {
  orderbookSnapshotInterval?: number;
  orderbookUpdateBatchSize?: number;
  tradeFeedLimit?: number;
  tickerUpdateInterval?: number;
  positionUpdateInterval?: number;
}

export class WebSocketDataProvider extends EventEmitter {
  private wsServer: WebSocketServer;
  private matchingEngine: EnhancedMatchingEngine;
  private settlementEngine: ProofGeneratingSettlementEngine;
  private config: WebSocketDataProviderConfig;
  private orderbookSnapshots: Map<string, any> = new Map();
  private tickerIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pendingBroadcasts: Map<string, any[]> = new Map();
  private broadcastTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    wsServer: WebSocketServer,
    matchingEngine: EnhancedMatchingEngine,
    settlementEngine: ProofGeneratingSettlementEngine,
    config: WebSocketDataProviderConfig = {}
  ) {
    super();
    
    this.wsServer = wsServer;
    this.matchingEngine = matchingEngine;
    this.settlementEngine = settlementEngine;
    this.config = {
      orderbookSnapshotInterval: 1000,
      orderbookUpdateBatchSize: 50,
      tradeFeedLimit: 100,
      tickerUpdateInterval: 5000,
      positionUpdateInterval: 10000,
      ...config
    };

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // WebSocket server events
    this.wsServer.on('snapshotRequested', this.handleSnapshotRequest.bind(this));
    
    // Matching engine events
    this.matchingEngine.on('orderBookUpdate', this.handleOrderBookUpdate.bind(this));
    this.matchingEngine.on('trade', this.handleTrade.bind(this));
    this.matchingEngine.on('orderUpdate', this.handleOrderUpdate.bind(this));
    
    // Settlement engine events
    this.settlementEngine.on('settlementQueued', this.handleSettlementUpdate.bind(this));
    this.settlementEngine.on('bundleExecuted', this.handleSettlementExecuted.bind(this));
  }

  // Handle snapshot requests
  private async handleSnapshotRequest(data: {
    socketId: string;
    channel: string;
    pair?: string;
    userId?: string;
    callback: (data: any) => void;
  }): Promise<void> {
    const { channel, pair, userId, callback } = data;

    try {
      switch (channel) {
        case 'orderbook':
          if (pair) {
            const snapshot = await this.getOrderBookSnapshot(pair);
            callback(snapshot);
          }
          break;

        case 'trades':
          if (pair) {
            const trades = await this.getRecentTrades(pair);
            callback(trades);
          }
          break;

        case 'orders':
          if (userId) {
            const orders = await this.getUserOrders(userId);
            callback(orders);
          }
          break;

        case 'settlements':
          const settlements = await this.getPendingSettlements(userId);
          callback(settlements);
          break;

        case 'tickers':
          const tickers = await this.getAllTickers();
          callback(tickers);
          break;

        case 'positions':
          if (userId) {
            const positions = await this.getUserPositions(userId);
            callback(positions);
          }
          break;

        default:
          callback({ error: 'Unknown channel' });
      }
    } catch (error) {
      console.error(`Error generating snapshot for ${channel}:`, error);
      callback({ error: 'Failed to generate snapshot' });
    }
  }

  // Order book updates with throttling
  private handleOrderBookUpdate(data: {
    pair: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    action: 'ADD' | 'UPDATE' | 'REMOVE';
  }): void {
    const { pair } = data;
    
    // Get current order book state
    const orderBook = this.matchingEngine.getOrderBook(pair);
    if (!orderBook) return;

    // Create update message
    const update = {
      bids: this.formatOrderBookSide(orderBook.bids, this.config.orderbookUpdateBatchSize!),
      asks: this.formatOrderBookSide(orderBook.asks, this.config.orderbookUpdateBatchSize!),
      lastUpdateId: Date.now()
    };

    // Throttle high-frequency orderbook updates
    this.throttledBroadcast('orderbook', pair, 'update', update);
  }

  // Trade updates with throttling
  private handleTrade(data: { trade: Trade }): void {
    const { trade } = data;
    
    // Format trade for broadcast
    const formattedTrade = {
      id: trade.id,
      pair: trade.pair,
      price: trade.price,
      quantity: trade.quantity,
      buyerId: trade.buyerId,
      sellerId: trade.sellerId,
      buyOrderId: trade.buyOrderId,
      sellOrderId: trade.sellOrderId,
      timestamp: trade.timestamp,
      isBuyerMaker: trade.buyOrderId < trade.sellOrderId
    };

    // Throttle high-frequency trade updates
    this.throttledBroadcast('trades', trade.pair, 'trade', formattedTrade);

    // Update ticker
    this.updateTicker(trade.pair);
  }

  // Order updates for users
  private handleOrderUpdate(data: {
    order: Order;
    event: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'EXPIRED';
  }): void {
    const { order, event } = data;
    
    // Format order update
    const update = {
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      pair: order.pair,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      remainingQuantity: order.quantity - order.filledQuantity,
      status: order.status,
      event,
      timestamp: Date.now()
    };

    // Broadcast to user
    this.wsServer.broadcastToUser(order.userId, 'orders', 'update', update);
  }

  // Settlement updates
  private handleSettlementUpdate(data: any): void {
    const update = {
      settlementId: data.settlementId,
      status: 'QUEUED',
      tradeId: data.tradeId,
      expectedTime: data.expectedTime,
      timestamp: Date.now()
    };

    this.wsServer.broadcast('settlements', undefined, 'update', update);
  }

  private handleSettlementExecuted(data: any): void {
    const update = {
      batchId: data.bundleId,
      status: 'EXECUTED',
      transactionHash: data.transactionHash,
      merkleRoot: data.merkleRoot,
      leafCount: data.leafCount,
      timestamp: Date.now()
    };

    this.wsServer.broadcast('settlements', undefined, 'executed', update);
  }

  // Get order book snapshot
  private async getOrderBookSnapshot(pair: string): Promise<any> {
    const orderBook = this.matchingEngine.getOrderBook(pair);
    if (!orderBook) {
      throw new Error(`Order book not found for ${pair}`);
    }

    return {
      pair,
      bids: this.formatOrderBookSide(orderBook.bids),
      asks: this.formatOrderBookSide(orderBook.asks),
      lastUpdateId: Date.now()
    };
  }

  // Get recent trades
  private async getRecentTrades(pair: string): Promise<any> {
    const trades = this.matchingEngine.getRecentTrades(pair, this.config.tradeFeedLimit!);
    
    return trades.map(trade => ({
      id: trade.id,
      price: trade.price,
      quantity: trade.quantity,
      timestamp: trade.timestamp,
      isBuyerMaker: trade.buyOrderId < trade.sellOrderId
    }));
  }

  // Get user orders
  private async getUserOrders(userId: string): Promise<any> {
    const orders = this.matchingEngine.getOrders(userId);
    
    return orders.map(order => ({
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      pair: order.pair,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      remainingQuantity: order.quantity - order.filledQuantity,
      status: order.status,
      createdAt: order.timestamp,
      updatedAt: order.lastUpdateTime
    }));
  }

  // Get pending settlements
  private async getPendingSettlements(userId?: string): Promise<any> {
    const settlements = this.settlementEngine.getPendingSettlements();
    
    const filtered = userId 
      ? settlements.filter(s => s.buyer === userId || s.seller === userId)
      : settlements;

    return filtered.map(settlement => ({
      settlementId: settlement.settlementId,
      tradeId: settlement.tradeId,
      status: 'PENDING',
      expectedTime: settlement.expectedTime,
      amount: settlement.amount.toString()
    }));
  }

  // Get all tickers
  private async getAllTickers(): Promise<any> {
    const pairs = this.matchingEngine.getActivePairs();
    const tickers: any[] = [];

    for (const pair of pairs) {
      const ticker = await this.getTicker(pair);
      if (ticker) {
        tickers.push(ticker);
      }
    }

    return tickers;
  }

  // Get single ticker
  private async getTicker(pair: string): Promise<any> {
    const stats = this.matchingEngine.get24HourStats(pair);
    const orderBook = this.matchingEngine.getOrderBook(pair);
    
    if (!stats || !orderBook) return null;

    const bestBid = orderBook.bids.length > 0 ? orderBook.bids[0].price : 0;
    const bestAsk = orderBook.asks.length > 0 ? orderBook.asks[0].price : 0;

    return {
      pair,
      lastPrice: stats.lastPrice,
      bidPrice: bestBid,
      askPrice: bestAsk,
      volume24h: stats.volume,
      high24h: stats.high,
      low24h: stats.low,
      change24h: stats.changePercent,
      timestamp: Date.now()
    };
  }

  // Get user positions
  private async getUserPositions(userId: string): Promise<any> {
    // This would integrate with a position tracking service
    // For now, return mock data
    return [
      {
        symbol: 'ETH',
        quantity: '10.5',
        averagePrice: '2450.00',
        currentPrice: '2500.00',
        pnl: '525.00',
        pnlPercent: '2.14'
      }
    ];
  }

  // Update ticker
  private updateTicker(pair: string): void {
    // Throttle ticker updates
    if (!this.tickerIntervals.has(pair)) {
      this.sendTickerUpdate(pair);
      
      this.tickerIntervals.set(pair, setTimeout(() => {
        this.tickerIntervals.delete(pair);
      }, 1000)); // Minimum 1 second between updates
    }
  }

  private async sendTickerUpdate(pair: string): Promise<void> {
    const ticker = await this.getTicker(pair);
    if (ticker) {
      this.wsServer.broadcast('tickers', pair, 'update', ticker);
    }
  }

  // Throttled broadcast for high-frequency channels
  private throttledBroadcast(channel: string, pair: string | undefined, type: string, data: any): void {
    const key = `${channel}:${pair || 'global'}`;
    
    // Get rate limiter from WebSocket server
    const rateLimiter = (this.wsServer as any).rateLimiter;
    const highFrequencyChannels = rateLimiter?.config?.messageThrottling?.highFrequencyChannels || ['orderbook', 'trades', 'tickers'];
    const throttleDelay = rateLimiter?.config?.messageThrottling?.throttleDelay || 100;

    // Check if this channel needs throttling
    if (!highFrequencyChannels.includes(channel)) {
      // Direct broadcast for non-throttled channels
      this.wsServer.broadcast(channel, pair, type, data);
      return;
    }

    // Add to pending broadcasts
    if (!this.pendingBroadcasts.has(key)) {
      this.pendingBroadcasts.set(key, []);
    }
    
    // Replace existing pending update with latest
    this.pendingBroadcasts.set(key, [{ channel, pair, type, data }]);

    // If no timer exists, set one
    if (!this.broadcastTimers.has(key)) {
      this.broadcastTimers.set(key, setTimeout(() => {
        const pending = this.pendingBroadcasts.get(key);
        if (pending && pending.length > 0) {
          const latest = pending[pending.length - 1];
          this.wsServer.broadcast(latest.channel, latest.pair, latest.type, latest.data);
        }
        
        this.pendingBroadcasts.delete(key);
        this.broadcastTimers.delete(key);
      }, throttleDelay));
    }
  }

  // Format order book side
  private formatOrderBookSide(
    orders: any[],
    limit?: number
  ): Array<[number, number]> {
    const formatted = orders
      .slice(0, limit || orders.length)
      .map(order => [order.price, order.quantity]);
    
    return formatted;
  }

  // Start periodic updates
  public startPeriodicUpdates(): void {
    // Start ticker updates
    setInterval(() => {
      const pairs = this.matchingEngine.getActivePairs();
      pairs.forEach(pair => this.sendTickerUpdate(pair));
    }, this.config.tickerUpdateInterval!);

    // Start position updates
    setInterval(() => {
      // This would update user positions
      // Implementation depends on position tracking service
    }, this.config.positionUpdateInterval!);
  }

  // Stop periodic updates
  public stopPeriodicUpdates(): void {
    // Clear all intervals
    for (const interval of this.tickerIntervals.values()) {
      clearTimeout(interval);
    }
    this.tickerIntervals.clear();

    // Clear all pending broadcasts
    for (const timer of this.broadcastTimers.values()) {
      clearTimeout(timer);
    }
    this.broadcastTimers.clear();
    this.pendingBroadcasts.clear();
  }
}