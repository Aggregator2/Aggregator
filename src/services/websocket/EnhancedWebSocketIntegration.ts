import { EventEmitter } from 'events';
import { WebSocketService, ChannelType } from './WebSocketService';
import { EnhancedMatchingEngine } from '../matchingEngine/EnhancedMatchingEngine';
import { SettlementOrchestrator } from '../settlement/SettlementOrchestrator';
import {
  Order,
  Trade,
  ExecutionReport,
  OrderBookUpdate,
  OrderBookSnapshot,
  MarketData
} from '../matchingEngine/types';

export interface EnhancedWebSocketConfig {
  port: number;
  corsOrigin?: string | string[];
  authSecret: string;
  authRequired?: boolean;
  rateLimits?: {
    connectionsPerIp?: number;
    messagesPerMinute?: number;
    subscriptionsPerConnection?: number;
  };
  updateBatchInterval?: number;
  snapshotInterval?: number;
}

interface BatchedUpdates {
  orderbook: Map<string, OrderBookUpdate[]>;
  trades: Map<string, Trade[]>;
  tickers: Map<string, any>;
  userOrders: Map<string, Order[]>;
  userTrades: Map<string, Trade[]>;
}

export class EnhancedWebSocketIntegration extends EventEmitter {
  private wsService: WebSocketService;
  private matchingEngine: EnhancedMatchingEngine;
  private settlementOrchestrator?: SettlementOrchestrator;
  private batchedUpdates: BatchedUpdates;
  private batchTimer?: NodeJS.Timeout;
  private snapshotTimers: Map<string, NodeJS.Timeout> = new Map();
  private config: EnhancedWebSocketConfig;

  constructor(
    config: EnhancedWebSocketConfig,
    matchingEngine: EnhancedMatchingEngine,
    settlementOrchestrator?: SettlementOrchestrator
  ) {
    super();
    this.config = config;
    this.matchingEngine = matchingEngine;
    this.settlementOrchestrator = settlementOrchestrator;

    // Initialize WebSocket service
    this.wsService = new WebSocketService({
      port: config.port,
      path: '/ws',
      cors: {
        origin: config.corsOrigin || '*',
        credentials: true
      },
      auth: {
        secret: config.authSecret,
        required: config.authRequired !== false
      },
      rateLimits: {
        connectionsPerIp: config.rateLimits?.connectionsPerIp || 10,
        messagesPerMinute: config.rateLimits?.messagesPerMinute || 100,
        subscriptionsPerConnection: config.rateLimits?.subscriptionsPerConnection || 20
      },
      heartbeatInterval: 30000
    });

    // Initialize batched updates
    this.batchedUpdates = {
      orderbook: new Map(),
      trades: new Map(),
      tickers: new Map(),
      userOrders: new Map(),
      userTrades: new Map()
    };

    this.setupEventHandlers();
    this.startBatchTimer();
  }

  private setupEventHandlers(): void {
    // MatchingEngine events
    this.matchingEngine.on('orderUpdate', this.handleOrderUpdate.bind(this));
    this.matchingEngine.on('trade', this.handleTrade.bind(this));
    this.matchingEngine.on('userTrade', this.handleUserTrade.bind(this));
    this.matchingEngine.on('orderBookUpdate', this.handleOrderBookUpdate.bind(this));
    this.matchingEngine.on('orderBookDepthChange', this.handleOrderBookDepthChange.bind(this));
    this.matchingEngine.on('marketData', this.handleMarketData.bind(this));
    this.matchingEngine.on('ticker', this.handleTicker.bind(this));
    this.matchingEngine.on('orderBookSnapshot', this.handleOrderBookSnapshot.bind(this));

    // Settlement events (if available)
    if (this.settlementOrchestrator) {
      this.settlementOrchestrator.on('epochStarted', this.handleEpochStarted.bind(this));
      this.settlementOrchestrator.on('epochFinalized', this.handleEpochFinalized.bind(this));
      this.settlementOrchestrator.on('settlementConfirmed', this.handleSettlementConfirmed.bind(this));
    }

    // WebSocket client events
    this.wsService.on('client:connected', this.handleClientConnected.bind(this));
    this.wsService.on('client:authenticated', this.handleClientAuthenticated.bind(this));
    this.wsService.on('subscription:added', this.handleSubscriptionAdded.bind(this));
    this.wsService.on('subscription:removed', this.handleSubscriptionRemoved.bind(this));
    
    // Client requests
    this.wsService.on('request:orderbook:snapshot', this.handleOrderBookSnapshotRequest.bind(this));
    this.wsService.on('request:trades:recent', this.handleRecentTradesRequest.bind(this));
    this.wsService.on('request:user:orders', this.handleUserOrdersRequest.bind(this));
    this.wsService.on('request:user:trades', this.handleUserTradesRequest.bind(this));
    this.wsService.on('request:market:data', this.handleMarketDataRequest.bind(this));
  }

  // Start batch timer for efficient updates
  private startBatchTimer(): void {
    const interval = this.config.updateBatchInterval || 100; // 100ms default
    
    this.batchTimer = setInterval(() => {
      this.flushBatchedUpdates();
    }, interval);
  }

  // Flush batched updates
  private flushBatchedUpdates(): void {
    // Flush order book updates
    for (const [pair, updates] of this.batchedUpdates.orderbook) {
      if (updates.length > 0) {
        this.wsService.broadcastToChannel(
          `${ChannelType.ORDER_BOOK}:${pair}`,
          'orderbook:update',
          { pair, updates }
        );
      }
    }

    // Flush trades
    for (const [pair, trades] of this.batchedUpdates.trades) {
      if (trades.length > 0) {
        this.wsService.broadcastToChannel(
          `${ChannelType.TRADES}:${pair}`,
          'trades:new',
          { pair, trades }
        );
      }
    }

    // Flush tickers
    for (const [pair, ticker] of this.batchedUpdates.tickers) {
      this.wsService.broadcastToChannel(
        `${ChannelType.TICKER}:${pair}`,
        'ticker:update',
        ticker
      );
    }

    // Flush user updates
    for (const [userId, orders] of this.batchedUpdates.userOrders) {
      if (orders.length > 0) {
        this.wsService.sendToUser(userId, 'orders:update', { orders });
      }
    }

    for (const [userId, trades] of this.batchedUpdates.userTrades) {
      if (trades.length > 0) {
        this.wsService.sendToUser(userId, 'trades:new', { trades });
      }
    }

    // Clear batched updates
    this.batchedUpdates = {
      orderbook: new Map(),
      trades: new Map(),
      tickers: new Map(),
      userOrders: new Map(),
      userTrades: new Map()
    };
  }

  // Handle order update
  private handleOrderUpdate(data: { order: Order; executionReport: ExecutionReport }): void {
    const { order, executionReport } = data;
    
    // Send immediate update to order owner
    this.wsService.sendToUser(order.userId, 'order:update', {
      order,
      executionReport,
      timestamp: Date.now()
    });

    // Batch for user orders channel
    const userOrders = this.batchedUpdates.userOrders.get(order.userId) || [];
    userOrders.push(order);
    this.batchedUpdates.userOrders.set(order.userId, userOrders);
  }

  // Handle trade
  private handleTrade(data: { trade: Trade; takerOrder?: Order; makerOrder?: Order }): void {
    const { trade } = data;
    
    // Batch trade for broadcast
    const pairTrades = this.batchedUpdates.trades.get(trade.pair) || [];
    pairTrades.push(trade);
    this.batchedUpdates.trades.set(trade.pair, pairTrades);
  }

  // Handle user trade
  private handleUserTrade(data: { userId: string; trade: Trade; side: string; role: string }): void {
    const { userId, trade } = data;
    
    // Send immediate notification
    this.wsService.sendToUser(userId, 'trade:executed', data);
    
    // Batch for user trades channel
    const userTrades = this.batchedUpdates.userTrades.get(userId) || [];
    userTrades.push(trade);
    this.batchedUpdates.userTrades.set(userId, userTrades);
  }

  // Handle order book update
  private handleOrderBookUpdate(data: { pair: string; update: OrderBookUpdate }): void {
    const { pair, update } = data;
    
    // Batch update
    const pairUpdates = this.batchedUpdates.orderbook.get(pair) || [];
    pairUpdates.push(update);
    this.batchedUpdates.orderbook.set(pair, pairUpdates);
  }

  // Handle order book depth change
  private handleOrderBookDepthChange(change: any): void {
    // Send immediate update for depth changes
    this.wsService.broadcastToChannel(
      `${ChannelType.ORDER_BOOK}:${change.pair}`,
      'orderbook:depth',
      change
    );
  }

  // Handle market data
  private handleMarketData(data: { pair: string; data: MarketData }): void {
    this.wsService.broadcastToChannel(
      `${ChannelType.MARKET_DATA}:${data.pair}`,
      'market:data',
      data.data
    );
  }

  // Handle ticker
  private handleTicker(ticker: any): void {
    // Batch ticker update
    this.batchedUpdates.tickers.set(ticker.pair, ticker);
  }

  // Handle order book snapshot
  private handleOrderBookSnapshot(data: { pair: string; snapshot: OrderBookSnapshot }): void {
    this.wsService.broadcastToChannel(
      `${ChannelType.ORDER_BOOK}:${data.pair}`,
      'orderbook:snapshot',
      data.snapshot
    );
  }

  // Handle client connected
  private handleClientConnected(clientId: string): void {
    console.log(`Client connected: ${clientId}`);
    
    // Send initial handshake
    this.wsService.sendToClient(clientId, 'connected', {
      serverTime: Date.now(),
      version: '1.0.0'
    });
  }

  // Handle client authenticated
  private handleClientAuthenticated(data: { clientId: string; userId: string }): void {
    console.log(`Client authenticated: ${data.clientId} as user ${data.userId}`);
    
    // Send user's initial state
    this.matchingEngine.emitInitialState(data.userId);
  }

  // Handle subscription added
  private handleSubscriptionAdded(data: { clientId: string; channel: string; params?: any }): void {
    console.log(`Client ${data.clientId} subscribed to ${data.channel}`);
    
    // Send initial data based on channel type
    if (data.channel.startsWith(ChannelType.ORDER_BOOK)) {
      const pair = data.params?.pair || data.channel.split(':')[1];
      if (pair) {
        this.matchingEngine.emitOrderBookSnapshot(pair);
        this.startSnapshotTimer(pair);
      }
    } else if (data.channel.startsWith(ChannelType.TRADES)) {
      const pair = data.params?.pair || data.channel.split(':')[1];
      if (pair) {
        this.handleRecentTradesRequest({
          clientId: data.clientId,
          pair,
          limit: 50
        });
      }
    } else if (data.channel.startsWith(ChannelType.MARKET_DATA)) {
      const pair = data.params?.pair || data.channel.split(':')[1];
      if (pair) {
        const marketData = this.matchingEngine.getMarketData(pair);
        if (marketData) {
          this.wsService.sendToClient(data.clientId, 'market:data', marketData);
        }
      }
    }
  }

  // Handle subscription removed
  private handleSubscriptionRemoved(data: { clientId: string; channel: string }): void {
    console.log(`Client ${data.clientId} unsubscribed from ${data.channel}`);
    
    // Check if we need to stop snapshot timer
    if (data.channel.startsWith(ChannelType.ORDER_BOOK)) {
      const pair = data.channel.split(':')[1];
      if (pair) {
        this.checkAndStopSnapshotTimer(pair);
      }
    }
  }

  // Start snapshot timer for a pair
  private startSnapshotTimer(pair: string): void {
    if (this.snapshotTimers.has(pair)) return;
    
    const interval = this.config.snapshotInterval || 5000; // 5 seconds default
    
    const timer = setInterval(() => {
      this.matchingEngine.emitOrderBookSnapshot(pair);
    }, interval);
    
    this.snapshotTimers.set(pair, timer);
  }

  // Check and stop snapshot timer if no subscribers
  private checkAndStopSnapshotTimer(pair: string): void {
    const channel = `${ChannelType.ORDER_BOOK}:${pair}`;
    const hasSubscribers = this.wsService.getChannelSubscriberCount(channel) > 0;
    
    if (!hasSubscribers) {
      const timer = this.snapshotTimers.get(pair);
      if (timer) {
        clearInterval(timer);
        this.snapshotTimers.delete(pair);
      }
    }
  }

  // Handle order book snapshot request
  private handleOrderBookSnapshotRequest(data: { clientId: string; pair: string }): void {
    const snapshot = this.matchingEngine.getOrderBookSnapshotWithSequence(data.pair);
    this.wsService.sendToClient(data.clientId, 'orderbook:snapshot', {
      pair: data.pair,
      snapshot
    });
  }

  // Handle recent trades request
  private handleRecentTradesRequest(data: { clientId: string; pair: string; limit?: number }): void {
    const trades = this.matchingEngine.getRecentTradesEnhanced(data.pair, data.limit || 100);
    this.wsService.sendToClient(data.clientId, 'trades:recent', {
      pair: data.pair,
      trades
    });
  }

  // Handle user orders request
  private handleUserOrdersRequest(data: { clientId: string; userId: string; pair?: string }): void {
    const openOrders = this.matchingEngine.getUserOpenOrders(data.userId, data.pair);
    const orderHistory = this.matchingEngine.getUserOrderHistory(data.userId, data.pair, 50);
    
    this.wsService.sendToClient(data.clientId, 'user:orders', {
      openOrders,
      orderHistory
    });
  }

  // Handle user trades request
  private handleUserTradesRequest(data: { clientId: string; userId: string; pair?: string; limit?: number }): void {
    const trades = this.matchingEngine.getUserTradeHistory(data.userId, data.pair, data.limit || 100);
    this.wsService.sendToClient(data.clientId, 'user:trades', {
      trades
    });
  }

  // Handle market data request
  private handleMarketDataRequest(data: { clientId: string; pair: string }): void {
    const marketData = this.matchingEngine.getMarketData(data.pair);
    if (marketData) {
      this.wsService.sendToClient(data.clientId, 'market:data', {
        pair: data.pair,
        data: marketData
      });
    }
  }

  // Settlement event handlers
  private handleEpochStarted(data: any): void {
    this.wsService.broadcast('settlement:epoch:started', data);
  }

  private handleEpochFinalized(data: any): void {
    this.wsService.broadcast('settlement:epoch:finalized', data);
  }

  private handleSettlementConfirmed(data: any): void {
    // Send to specific user if userId is available
    if (data.userId) {
      this.wsService.sendToUser(data.userId, 'settlement:confirmed', data);
    }
    // Also broadcast to settlement channel
    this.wsService.broadcastToChannel('settlement:updates', 'settlement:confirmed', data);
  }

  // Start the WebSocket server
  async start(): Promise<void> {
    await this.wsService.start();
    console.log(`WebSocket server started on port ${this.config.port}`);
  }

  // Stop the WebSocket server
  async stop(): Promise<void> {
    // Clear timers
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    
    for (const timer of this.snapshotTimers.values()) {
      clearInterval(timer);
    }
    
    await this.wsService.stop();
    console.log('WebSocket server stopped');
  }

  // Get WebSocket service instance (for external access)
  getWebSocketService(): WebSocketService {
    return this.wsService;
  }
}