import { EventEmitter } from 'events';
import { WebSocketService, WebSocketServiceConfig } from './WebSocketService';
import { MatchingEngine } from '../matchingEngine/MatchingEngine';
import { OrderBookDatabase } from '../orderBookDatabase/OrderBookDatabase';
import {
  Order,
  Trade,
  ExecutionReport,
  OrderBookUpdate,
  OrderBookSnapshot,
  MarketData,
  OrderStatus
} from '../matchingEngine/types';

export interface WebSocketIntegrationConfig {
  websocket: WebSocketServiceConfig;
  updateBatchInterval: number;
  snapshotInterval: number;
  marketDataInterval: number;
}

interface UpdateBatch {
  orderBookUpdates: Map<string, OrderBookUpdate[]>;
  trades: Map<string, Trade[]>;
  marketData: Map<string, MarketData>;
}

export class WebSocketIntegration extends EventEmitter {
  private wsService: WebSocketService;
  private matchingEngine: MatchingEngine;
  private orderBookDatabase?: OrderBookDatabase;
  private config: WebSocketIntegrationConfig;
  private updateBatch: UpdateBatch;
  private batchTimer?: NodeJS.Timeout;
  private snapshotTimers: Map<string, NodeJS.Timeout> = new Map();
  private marketDataTimer?: NodeJS.Timeout;

  constructor(
    config: WebSocketIntegrationConfig,
    matchingEngine: MatchingEngine,
    orderBookDatabase?: OrderBookDatabase
  ) {
    super();
    this.config = config;
    this.matchingEngine = matchingEngine;
    this.orderBookDatabase = orderBookDatabase;
    this.wsService = new WebSocketService(config.websocket);
    
    this.updateBatch = {
      orderBookUpdates: new Map(),
      trades: new Map(),
      marketData: new Map()
    };

    this.setupEventHandlers();
    this.startBatchTimer();
    this.startMarketDataTimer();
  }

  private setupEventHandlers(): void {
    // MatchingEngine events
    this.matchingEngine.on('orderAccepted', this.handleOrderAccepted.bind(this));
    this.matchingEngine.on('orderRejected', this.handleOrderRejected.bind(this));
    this.matchingEngine.on('orderCancelled', this.handleOrderCancelled.bind(this));
    this.matchingEngine.on('orderExpired', this.handleOrderExpired.bind(this));
    this.matchingEngine.on('trade', this.handleTrade.bind(this));
    this.matchingEngine.on('orderBookUpdate', this.handleOrderBookUpdate.bind(this));
    this.matchingEngine.on('executionReport', this.handleExecutionReport.bind(this));

    // WebSocket service events
    this.wsService.on('request:orderbook:snapshot', this.handleOrderBookSnapshotRequest.bind(this));
    this.wsService.on('request:trades:recent', this.handleRecentTradesRequest.bind(this));
    this.wsService.on('request:user:orders', this.handleUserOrdersRequest.bind(this));
    this.wsService.on('request:user:trades', this.handleUserTradesRequest.bind(this));
    this.wsService.on('client:subscribed', this.handleClientSubscribed.bind(this));
    this.wsService.on('client:unsubscribed', this.handleClientUnsubscribed.bind(this));
  }

  // Order lifecycle handlers
  private handleOrderAccepted(data: { order: Order; executionReport: ExecutionReport }): void {
    const { order, executionReport } = data;
    
    // Send immediate update to order owner
    this.wsService.sendOrderUpdate(order.userId, order);
    this.wsService.sendExecutionReport(order.userId, executionReport);
  }

  private handleOrderRejected(data: { order: Order; reason: string }): void {
    const { order } = data;
    
    // Send immediate rejection to order owner
    this.wsService.sendOrderUpdate(order.userId, order);
  }

  private handleOrderCancelled(data: { order: Order; executionReport: ExecutionReport }): void {
    const { order, executionReport } = data;
    
    // Send immediate cancellation to order owner
    this.wsService.sendOrderUpdate(order.userId, order);
    this.wsService.sendExecutionReport(order.userId, executionReport);
  }

  private handleOrderExpired(data: { order: Order }): void {
    const { order } = data;
    
    // Send immediate expiration to order owner
    this.wsService.sendOrderUpdate(order.userId, order);
  }

  private handleTrade(trade: Trade): void {
    // Buffer trade for batch update
    const pair = trade.pair;
    if (!this.updateBatch.trades.has(pair)) {
      this.updateBatch.trades.set(pair, []);
    }
    this.updateBatch.trades.get(pair)!.push(trade);

    // Send immediate update to trade participants
    if (trade.buyOrderId) {
      const buyOrder = this.matchingEngine.getOrder(trade.buyOrderId);
      if (buyOrder) {
        this.wsService.sendUserTrade(buyOrder.userId, trade);
      }
    }

    if (trade.sellOrderId) {
      const sellOrder = this.matchingEngine.getOrder(trade.sellOrderId);
      if (sellOrder) {
        this.wsService.sendUserTrade(sellOrder.userId, trade);
      }
    }
  }

  private handleOrderBookUpdate(data: { pair: string; update: OrderBookUpdate }): void {
    const { pair, update } = data;
    
    // Buffer order book update
    if (!this.updateBatch.orderBookUpdates.has(pair)) {
      this.updateBatch.orderBookUpdates.set(pair, []);
    }
    this.updateBatch.orderBookUpdates.get(pair)!.push(update);
  }

  private handleExecutionReport(report: ExecutionReport): void {
    // Send immediate execution report to order owner
    const order = this.matchingEngine.getOrder(report.orderId);
    if (order) {
      this.wsService.sendExecutionReport(order.userId, report);
      this.wsService.sendOrderUpdate(order.userId, order);
    }
  }

  // WebSocket request handlers
  private async handleOrderBookSnapshotRequest(data: {
    pair: string;
    depth: number;
    clientId: string;
  }): Promise<void> {
    const { pair, depth, clientId } = data;
    
    try {
      const snapshot = this.matchingEngine.getOrderBookSnapshot(pair, depth);
      this.wsService.sendToClient(clientId, 'orderbook:snapshot', {
        channel: `orderbook:${pair}`,
        data: snapshot,
        timestamp: Date.now()
      });
    } catch (error) {
      this.wsService.sendToClient(clientId, 'error', {
        message: `Failed to get order book snapshot: ${error.message}`
      });
    }
  }

  private async handleRecentTradesRequest(data: {
    pair: string;
    limit: number;
    clientId: string;
  }): Promise<void> {
    const { pair, limit, clientId } = data;
    
    try {
      const trades = await this.getRecentTrades(pair, limit);
      this.wsService.sendToClient(clientId, 'trades:recent', {
        channel: `trades:${pair}`,
        data: trades,
        timestamp: Date.now()
      });
    } catch (error) {
      this.wsService.sendToClient(clientId, 'error', {
        message: `Failed to get recent trades: ${error.message}`
      });
    }
  }

  private async handleUserOrdersRequest(data: {
    userId: string;
    status?: OrderStatus;
    clientId: string;
  }): Promise<void> {
    const { userId, status, clientId } = data;
    
    try {
      const orders = this.matchingEngine.getUserOrders(userId, status);
      this.wsService.sendToClient(clientId, 'user:orders', {
        channel: 'orders',
        data: orders,
        timestamp: Date.now()
      });
    } catch (error) {
      this.wsService.sendToClient(clientId, 'error', {
        message: `Failed to get user orders: ${error.message}`
      });
    }
  }

  private async handleUserTradesRequest(data: {
    userId: string;
    limit: number;
    clientId: string;
  }): Promise<void> {
    const { userId, limit, clientId } = data;
    
    try {
      const trades = await this.getUserTrades(userId, limit);
      this.wsService.sendToClient(clientId, 'user:trades', {
        channel: 'user_trades',
        data: trades,
        timestamp: Date.now()
      });
    } catch (error) {
      this.wsService.sendToClient(clientId, 'error', {
        message: `Failed to get user trades: ${error.message}`
      });
    }
  }

  private handleClientSubscribed(data: { clientId: string; userId?: string; channel: string }): void {
    const { channel } = data;
    const [channelType, pair] = channel.split(':');
    
    // Start snapshot timer for new order book subscriptions
    if (channelType === 'orderbook' && pair && !this.snapshotTimers.has(pair)) {
      const timer = setInterval(() => {
        this.sendOrderBookSnapshot(pair);
      }, this.config.snapshotInterval);
      this.snapshotTimers.set(pair, timer);
    }
  }

  private handleClientUnsubscribed(data: { clientId: string; userId?: string; channel: string }): void {
    const { channel } = data;
    const [channelType, pair] = channel.split(':');
    
    // Stop snapshot timer if no more subscribers
    if (channelType === 'orderbook' && pair) {
      const subscribers = this.wsService['channelSubscribers'].get(channel);
      if (!subscribers || subscribers.size === 0) {
        const timer = this.snapshotTimers.get(pair);
        if (timer) {
          clearInterval(timer);
          this.snapshotTimers.delete(pair);
        }
      }
    }
  }

  // Batch processing
  private startBatchTimer(): void {
    this.batchTimer = setInterval(() => {
      this.flushBatch();
    }, this.config.updateBatchInterval);
  }

  private flushBatch(): void {
    // Flush order book updates
    for (const [pair, updates] of this.updateBatch.orderBookUpdates) {
      if (updates.length > 0) {
        // Aggregate updates
        const aggregatedUpdate = this.aggregateOrderBookUpdates(updates);
        this.wsService.broadcastOrderBookUpdate(pair, aggregatedUpdate);
      }
    }

    // Flush trades
    for (const [pair, trades] of this.updateBatch.trades) {
      if (trades.length > 0) {
        for (const trade of trades) {
          this.wsService.broadcastTrade(trade);
        }
      }
    }

    // Flush market data
    for (const [pair, data] of this.updateBatch.marketData) {
      this.wsService.broadcastMarketData(pair, data);
    }

    // Clear batch
    this.updateBatch = {
      orderBookUpdates: new Map(),
      trades: new Map(),
      marketData: new Map()
    };
  }

  private aggregateOrderBookUpdates(updates: OrderBookUpdate[]): OrderBookUpdate {
    // Aggregate multiple updates into one
    const aggregated: OrderBookUpdate = {
      bids: [],
      asks: [],
      sequence: updates[updates.length - 1].sequence,
      timestamp: updates[updates.length - 1].timestamp
    };

    // Merge updates (simplified - in production, track price levels properly)
    for (const update of updates) {
      aggregated.bids.push(...update.bids);
      aggregated.asks.push(...update.asks);
    }

    return aggregated;
  }

  // Market data updates
  private startMarketDataTimer(): void {
    this.marketDataTimer = setInterval(() => {
      this.updateMarketData();
    }, this.config.marketDataInterval);
  }

  private updateMarketData(): void {
    const pairs = this.matchingEngine.getActivePairs();
    
    for (const pair of pairs) {
      const marketData = this.matchingEngine.getMarketData(pair);
      if (marketData) {
        this.updateBatch.marketData.set(pair, marketData);
        
        // Also broadcast ticker update
        const ticker = {
          pair,
          lastPrice: marketData.lastPrice,
          bidPrice: marketData.bidPrice,
          askPrice: marketData.askPrice,
          volume24h: marketData.volume24h,
          high24h: marketData.high24h,
          low24h: marketData.low24h,
          priceChange24h: marketData.lastPrice - marketData.openPrice24h,
          priceChangePercent24h: ((marketData.lastPrice - marketData.openPrice24h) / marketData.openPrice24h) * 100
        };
        
        this.wsService.broadcastTicker(pair, ticker);
      }
    }
  }

  // Helper methods
  private sendOrderBookSnapshot(pair: string): void {
    try {
      const snapshot = this.matchingEngine.getOrderBookSnapshot(pair);
      this.wsService.broadcastOrderBookSnapshot(pair, snapshot);
    } catch (error) {
      console.error(`Failed to send order book snapshot for ${pair}:`, error);
    }
  }

  private async getRecentTrades(pair: string, limit: number): Promise<Trade[]> {
    if (this.orderBookDatabase) {
      return await this.orderBookDatabase.getRecentTrades(pair, limit);
    }
    return this.matchingEngine.getRecentTrades(pair, limit);
  }

  private async getUserTrades(userId: string, limit: number): Promise<Trade[]> {
    if (this.orderBookDatabase) {
      return await this.orderBookDatabase.getUserTrades(userId, limit);
    }
    return this.matchingEngine.getUserTrades(userId, limit);
  }

  // Lifecycle methods
  public async start(): Promise<void> {
    await this.wsService.start();
    console.log('WebSocket integration started');
  }

  public async stop(): Promise<void> {
    // Clear timers
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    if (this.marketDataTimer) {
      clearInterval(this.marketDataTimer);
    }
    for (const timer of this.snapshotTimers.values()) {
      clearInterval(timer);
    }

    await this.wsService.stop();
    console.log('WebSocket integration stopped');
  }

  public getStats(): any {
    return {
      websocket: this.wsService.getStats(),
      snapshotTimers: this.snapshotTimers.size,
      batchSize: {
        orderBookUpdates: this.updateBatch.orderBookUpdates.size,
        trades: this.updateBatch.trades.size,
        marketData: this.updateBatch.marketData.size
      }
    };
  }
}