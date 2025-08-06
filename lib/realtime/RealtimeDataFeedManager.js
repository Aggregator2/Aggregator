const EventEmitter = require('events');
const WebSocketManager = require('./WebSocketManager');
const OrderBookFeed = require('./OrderBookFeed');
const TradeNotificationFeed = require('./TradeNotificationFeed');
const PriceTickerFeed = require('./PriceTickerFeed');
const UserOrderStatusFeed = require('./UserOrderStatusFeed');
const SystemStatusFeed = require('./SystemStatusFeed');
const BandwidthOptimizer = require('./BandwidthOptimizer');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Real-time Data Feed Manager
 * Central orchestrator for all real-time data feeds with subscription management
 */
class RealtimeDataFeedManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      port: config.port || 8080,
      enableOrderBook: config.enableOrderBook !== false,
      enableTrades: config.enableTrades !== false,
      enableTickers: config.enableTickers !== false,
      enableUserOrders: config.enableUserOrders !== false,
      enableSystemStatus: config.enableSystemStatus !== false,
      enableBandwidthOptimization: config.enableBandwidthOptimization !== false,
      maxSubscriptionsPerConnection: config.maxSubscriptionsPerConnection || 50,
      subscriptionRateLimit: config.subscriptionRateLimit || { requests: 10, window: 60000 },
      enableMetrics: config.enableMetrics !== false,
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.isRunning = false;
    
    // Core components
    this.webSocketManager = null;
    this.bandwidthOptimizer = null;
    
    // Feed components
    this.feeds = {
      orderBook: null,
      trades: null,
      ticker: null,
      userOrders: null,
      systemStatus: null
    };
    
    // Subscription management
    this.subscriptionRegistry = new Map(); // subscriptionId -> subscription details
    this.connectionSubscriptions = new Map(); // connectionId -> Set of subscriptionIds
    this.channelSubscribers = new Map(); // channel -> Set of subscriptionIds
    this.rateLimiters = new Map(); // connectionId -> rate limiter
    
    // Supported channels and their configurations
    this.supportedChannels = {
      orderbook: {
        feedName: 'orderBook',
        requiresAuth: false,
        maxParams: 10,
        validParams: ['symbol', 'depth', 'grouped'],
        rateLimitWeight: 1
      },
      trades: {
        feedName: 'trades',
        requiresAuth: false,
        maxParams: 10,
        validParams: ['symbol', 'privacyLevel', 'filter', 'aggregated'],
        rateLimitWeight: 1
      },
      user_trades: {
        feedName: 'trades',
        requiresAuth: true,
        maxParams: 5,
        validParams: ['userId', 'includeCounterparty', 'includeMetadata'],
        rateLimitWeight: 2
      },
      ticker: {
        feedName: 'ticker',
        requiresAuth: false,
        maxParams: 5,
        validParams: ['symbol', 'includeIndicators', 'includeVolume', 'includeMarketStats'],
        rateLimitWeight: 1
      },
      all_tickers: {
        feedName: 'ticker',
        requiresAuth: false,
        maxParams: 2,
        validParams: ['includeIndicators', 'includeVolume'],
        rateLimitWeight: 3
      },
      user_orders: {
        feedName: 'userOrders',
        requiresAuth: true,
        maxParams: 5,
        validParams: ['userId', 'detailLevel', 'includeHistory'],
        rateLimitWeight: 2
      },
      system_status: {
        feedName: 'systemStatus',
        requiresAuth: false,
        maxParams: 3,
        validParams: ['components', 'includeMetrics'],
        rateLimitWeight: 1
      },
      system_alerts: {
        feedName: 'systemStatus',
        requiresAuth: false,
        maxParams: 3,
        validParams: ['severity', 'includeHistory'],
        rateLimitWeight: 1
      },
      maintenance: {
        feedName: 'systemStatus',
        requiresAuth: false,
        maxParams: 2,
        validParams: ['notifications'],
        rateLimitWeight: 1
      }
    };
    
    // Performance tracking
    this.performanceStats = {
      totalSubscriptions: 0,
      activeSubscriptions: 0,
      subscriptionRequestsProcessed: 0,
      subscriptionErrors: 0,
      messagesRouted: 0,
      totalDataTransferred: 0,
      avgResponseTime: 0
    };
    
    // Rate limiting for subscriptions
    this.subscriptionRateLimiter = {
      requests: this.config.subscriptionRateLimit.requests,
      window: this.config.subscriptionRateLimit.window,
      connections: new Map() // connectionId -> { count, resetTime }
    };
  }
  
  /**
   * Initialize all components
   */
  async initialize() {
    try {
      // Initialize WebSocket manager
      this.webSocketManager = new WebSocketManager(this.config);
      await this.webSocketManager.initialize();
      
      // Initialize bandwidth optimizer if enabled
      if (this.config.enableBandwidthOptimization) {
        this.bandwidthOptimizer = new BandwidthOptimizer(this.config.bandwidthOptimization);
      }
      
      // Initialize feeds
      await this.initializeFeeds();
      
      // Set up event handlers
      this.setupEventHandlers();
      
      this.emit('initialized');
      
    } catch (error) {
      this.emit('error', { phase: 'initialization', error: error.message });
      throw error;
    }
  }
  
  /**
   * Initialize feed components
   */
  async initializeFeeds() {
    // Initialize Order Book Feed
    if (this.config.enableOrderBook) {
      this.feeds.orderBook = new OrderBookFeed(this.config.orderBook);
      this.feeds.orderBook.initialize(this.webSocketManager);
    }
    
    // Initialize Trade Notification Feed
    if (this.config.enableTrades) {
      this.feeds.trades = new TradeNotificationFeed(this.config.trades);
      this.feeds.trades.initialize(this.webSocketManager);
    }
    
    // Initialize Price Ticker Feed
    if (this.config.enableTickers) {
      this.feeds.ticker = new PriceTickerFeed(this.config.ticker);
      this.feeds.ticker.initialize(this.webSocketManager);
    }
    
    // Initialize User Order Status Feed
    if (this.config.enableUserOrders) {
      this.feeds.userOrders = new UserOrderStatusFeed(this.config.userOrders);
      this.feeds.userOrders.initialize(this.webSocketManager);
    }
    
    // Initialize System Status Feed
    if (this.config.enableSystemStatus) {
      this.feeds.systemStatus = new SystemStatusFeed(this.config.systemStatus);
      this.feeds.systemStatus.initialize(this.webSocketManager);
    }
  }
  
  /**
   * Set up event handlers
   */
  setupEventHandlers() {
    // WebSocket manager events
    this.webSocketManager.on('subscribed', (event) => {
      this.handleSubscriptionRequest(event);
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      this.handleUnsubscriptionRequest(event);
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
    
    this.webSocketManager.on('error', (error) => {
      this.emit('error', { component: 'websocket', ...error });
    });
    
    // Feed events
    Object.entries(this.feeds).forEach(([feedName, feed]) => {
      if (feed) {
        feed.on('error', (error) => {
          this.emit('error', { component: feedName, ...error });
        });
      }
    });
    
    // Bandwidth optimizer events
    if (this.bandwidthOptimizer) {
      this.bandwidthOptimizer.on('batch_ready', (event) => {
        this.handleOptimizedMessage(event);
      });
      
      this.bandwidthOptimizer.on('optimization_error', (error) => {
        this.emit('error', { component: 'bandwidth_optimizer', ...error });
      });
    }
  }
  
  /**
   * Handle subscription request
   */
  async handleSubscriptionRequest(event) {
    const startTime = Date.now();
    const { connectionId, channel, params = {} } = event;
    
    try {
      // Check rate limiting
      if (!this.checkSubscriptionRateLimit(connectionId)) {
        this.sendSubscriptionError(connectionId, 'RATE_LIMIT_EXCEEDED', 
          'Too many subscription requests, please slow down');
        return;
      }
      
      // Validate channel
      const channelConfig = this.supportedChannels[channel];
      if (!channelConfig) {
        this.sendSubscriptionError(connectionId, 'UNSUPPORTED_CHANNEL', 
          `Channel '${channel}' is not supported`);
        return;
      }
      
      // Check if feed is enabled
      const feed = this.feeds[channelConfig.feedName];
      if (!feed) {
        this.sendSubscriptionError(connectionId, 'FEED_DISABLED', 
          `Feed for channel '${channel}' is disabled`);
        return;
      }
      
      // Validate parameters
      const validationResult = this.validateSubscriptionParams(channel, params);
      if (!validationResult.valid) {
        this.sendSubscriptionError(connectionId, 'INVALID_PARAMETERS', 
          validationResult.error);
        return;
      }
      
      // Check authentication if required
      if (channelConfig.requiresAuth) {
        const connection = this.webSocketManager.connections?.get(connectionId);
        if (!connection || !connection.authenticated) {
          this.sendSubscriptionError(connectionId, 'AUTHENTICATION_REQUIRED', 
            'Authentication required for this channel');
          return;
        }
      }
      
      // Check subscription limits
      if (!this.checkSubscriptionLimits(connectionId)) {
        this.sendSubscriptionError(connectionId, 'SUBSCRIPTION_LIMIT_EXCEEDED', 
          'Maximum subscriptions per connection exceeded');
        return;
      }
      
      // Create subscription
      const subscription = this.createSubscription(connectionId, channel, params, channelConfig);
      
      // Register subscription
      this.registerSubscription(subscription);
      
      // Send success response
      this.webSocketManager.sendToConnection(connectionId, {
        type: 'subscription_success',
        subscriptionId: subscription.id,
        channel: channel,
        params: params,
        timestamp: Date.now()
      });
      
      this.performanceStats.subscriptionRequestsProcessed++;
      this.performanceStats.totalSubscriptions++;
      this.performanceStats.activeSubscriptions++;
      this.performanceStats.avgResponseTime = this.updateAverage(
        this.performanceStats.avgResponseTime,
        Date.now() - startTime,
        this.performanceStats.subscriptionRequestsProcessed
      );
      
      this.emit('subscription_created', subscription);
      
    } catch (error) {
      this.performanceStats.subscriptionErrors++;
      this.sendSubscriptionError(connectionId, 'INTERNAL_ERROR', 
        'Internal server error while processing subscription');
      this.emit('error', { 
        phase: 'subscription', 
        connectionId, 
        channel, 
        error: error.message 
      });
    }
  }
  
  /**
   * Handle unsubscription request
   */
  handleUnsubscriptionRequest(event) {
    const { connectionId, channel, params = {} } = event;
    
    // Find matching subscriptions
    const connectionSubs = this.connectionSubscriptions.get(connectionId) || new Set();
    const subscriptionsToRemove = [];
    
    for (const subscriptionId of connectionSubs) {
      const subscription = this.subscriptionRegistry.get(subscriptionId);
      if (subscription && subscription.channel === channel) {
        // Check if params match (if specified)
        if (Object.keys(params).length === 0 || this.paramsMatch(subscription.params, params)) {
          subscriptionsToRemove.push(subscriptionId);
        }
      }
    }
    
    // Remove subscriptions
    subscriptionsToRemove.forEach(subscriptionId => {
      this.removeSubscription(subscriptionId);
    });
    
    // Send success response
    this.webSocketManager.sendToConnection(connectionId, {
      type: 'unsubscription_success',
      channel: channel,
      removedSubscriptions: subscriptionsToRemove.length,
      timestamp: Date.now()
    });
    
    this.emit('subscriptions_removed', { 
      connectionId, 
      channel, 
      count: subscriptionsToRemove.length 
    });
  }
  
  /**
   * Handle connection disconnection
   */
  handleDisconnection(event) {
    const { connectionId } = event;
    
    // Remove all subscriptions for this connection
    const connectionSubs = this.connectionSubscriptions.get(connectionId) || new Set();
    const subscriptionsRemoved = connectionSubs.size;
    
    connectionSubs.forEach(subscriptionId => {
      this.removeSubscription(subscriptionId);
    });
    
    // Clean up connection data
    this.connectionSubscriptions.delete(connectionId);
    this.rateLimiters.delete(connectionId);
    this.subscriptionRateLimiter.connections.delete(connectionId);
    
    // Clean up bandwidth optimizer data
    if (this.bandwidthOptimizer) {
      this.bandwidthOptimizer.cleanupConnection(connectionId);
    }
    
    this.performanceStats.activeSubscriptions -= subscriptionsRemoved;
    
    this.emit('connection_cleanup', { 
      connectionId, 
      subscriptionsRemoved 
    });
  }
  
  /**
   * Create subscription object
   */
  createSubscription(connectionId, channel, params, channelConfig) {
    const subscriptionId = this.generateSubscriptionId();
    
    return {
      id: subscriptionId,
      connectionId: connectionId,
      channel: channel,
      params: params,
      feedName: channelConfig.feedName,
      requiresAuth: channelConfig.requiresAuth,
      rateLimitWeight: channelConfig.rateLimitWeight,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      bytesTransferred: 0
    };
  }
  
  /**
   * Register subscription
   */
  registerSubscription(subscription) {
    // Add to subscription registry
    this.subscriptionRegistry.set(subscription.id, subscription);
    
    // Add to connection subscriptions
    if (!this.connectionSubscriptions.has(subscription.connectionId)) {
      this.connectionSubscriptions.set(subscription.connectionId, new Set());
    }
    this.connectionSubscriptions.get(subscription.connectionId).add(subscription.id);
    
    // Add to channel subscribers
    if (!this.channelSubscribers.has(subscription.channel)) {
      this.channelSubscribers.set(subscription.channel, new Set());
    }
    this.channelSubscribers.get(subscription.channel).add(subscription.id);
  }
  
  /**
   * Remove subscription
   */
  removeSubscription(subscriptionId) {
    const subscription = this.subscriptionRegistry.get(subscriptionId);
    if (!subscription) return;
    
    // Remove from registry
    this.subscriptionRegistry.delete(subscriptionId);
    
    // Remove from connection subscriptions
    const connectionSubs = this.connectionSubscriptions.get(subscription.connectionId);
    if (connectionSubs) {
      connectionSubs.delete(subscriptionId);
      if (connectionSubs.size === 0) {
        this.connectionSubscriptions.delete(subscription.connectionId);
      }
    }
    
    // Remove from channel subscribers
    const channelSubs = this.channelSubscribers.get(subscription.channel);
    if (channelSubs) {
      channelSubs.delete(subscriptionId);
      if (channelSubs.size === 0) {
        this.channelSubscribers.delete(subscription.channel);
      }
    }
    
    this.performanceStats.activeSubscriptions--;
    
    this.emit('subscription_removed', subscription);
  }
  
  /**
   * Check subscription rate limit
   */
  checkSubscriptionRateLimit(connectionId) {
    const now = Date.now();
    const rateLimitData = this.subscriptionRateLimiter.connections.get(connectionId) || {
      count: 0,
      resetTime: now + this.subscriptionRateLimiter.window
    };
    
    if (now > rateLimitData.resetTime) {
      rateLimitData.count = 0;
      rateLimitData.resetTime = now + this.subscriptionRateLimiter.window;
    }
    
    rateLimitData.count++;
    this.subscriptionRateLimiter.connections.set(connectionId, rateLimitData);
    
    return rateLimitData.count <= this.subscriptionRateLimiter.requests;
  }
  
  /**
   * Check subscription limits per connection
   */
  checkSubscriptionLimits(connectionId) {
    const connectionSubs = this.connectionSubscriptions.get(connectionId);
    const currentCount = connectionSubs ? connectionSubs.size : 0;
    
    return currentCount < this.config.maxSubscriptionsPerConnection;
  }
  
  /**
   * Validate subscription parameters
   */
  validateSubscriptionParams(channel, params) {
    const channelConfig = this.supportedChannels[channel];
    if (!channelConfig) {
      return { valid: false, error: 'Unknown channel' };
    }
    
    // Check parameter count
    if (Object.keys(params).length > channelConfig.maxParams) {
      return { 
        valid: false, 
        error: `Too many parameters (max: ${channelConfig.maxParams})` 
      };
    }
    
    // Check parameter names
    for (const paramName of Object.keys(params)) {
      if (!channelConfig.validParams.includes(paramName)) {
        return { 
          valid: false, 
          error: `Invalid parameter: ${paramName}` 
        };
      }
    }
    
    // Channel-specific validation
    if (channel === 'orderbook') {
      if (params.depth && (params.depth < 1 || params.depth > 100)) {
        return { valid: false, error: 'Depth must be between 1 and 100' };
      }
    }
    
    if (channel === 'user_orders' || channel === 'user_trades') {
      if (!params.userId) {
        return { valid: false, error: 'userId parameter required' };
      }
    }
    
    return { valid: true };
  }
  
  /**
   * Check if params match
   */
  paramsMatch(subscriptionParams, requestParams) {
    for (const [key, value] of Object.entries(requestParams)) {
      if (subscriptionParams[key] !== value) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * Send subscription error
   */
  sendSubscriptionError(connectionId, code, message) {
    this.webSocketManager.sendToConnection(connectionId, {
      type: 'subscription_error',
      code: code,
      message: message,
      timestamp: Date.now()
    });
  }
  
  /**
   * Route message through bandwidth optimizer
   */
  async routeMessage(connectionId, message, options = {}) {
    if (!this.bandwidthOptimizer) {
      // Send directly
      this.webSocketManager.sendToConnection(connectionId, message, options);
      return;
    }
    
    try {
      const result = await this.bandwidthOptimizer.processMessage(connectionId, message, options);
      
      if (result.skipped) {
        // Message was skipped (duplicate, etc.)
        return;
      }
      
      if (result.batched) {
        // Message was added to batch, will be sent later
        return;
      }
      
      if (result.error) {
        // Optimization failed, send original
        this.webSocketManager.sendToConnection(connectionId, message, options);
        return;
      }
      
      // Send optimized message
      const optimizedMessage = result.compressed ? 
        Buffer.from(result.data) : 
        (typeof result.data === 'string' ? result.data : JSON.stringify(result.data));
      
      this.webSocketManager.sendToConnection(connectionId, optimizedMessage, {
        ...options,
        compressed: result.compressed,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize
      });
      
      // Update stats
      this.updateMessageStats(result);
      
    } catch (error) {
      // Fallback to direct send
      this.webSocketManager.sendToConnection(connectionId, message, options);
      this.emit('error', { 
        component: 'message_routing', 
        connectionId, 
        error: error.message 
      });
    }
  }
  
  /**
   * Handle optimized message from bandwidth optimizer
   */
  handleOptimizedMessage(event) {
    const { connectionId, batch } = event;
    
    this.webSocketManager.sendToConnection(connectionId, batch.data, {
      compressed: batch.compressed,
      originalSize: batch.originalSize,
      compressedSize: batch.compressedSize
    });
    
    this.updateMessageStats(batch);
  }
  
  /**
   * Update message statistics
   */
  updateMessageStats(result) {
    this.performanceStats.messagesRouted++;
    this.performanceStats.totalDataTransferred += result.compressedSize || result.originalSize;
  }
  
  /**
   * Public API methods for feeds to send data
   */
  
  /**
   * Broadcast order book update
   */
  broadcastOrderBookUpdate(symbol, data, options = {}) {
    if (!this.feeds.orderBook) return;
    
    const channelSubs = this.channelSubscribers.get('orderbook') || new Set();
    
    for (const subscriptionId of channelSubs) {
      const subscription = this.subscriptionRegistry.get(subscriptionId);
      if (subscription && subscription.params.symbol === symbol) {
        const message = {
          type: 'orderbook_update',
          symbol: symbol,
          data: data,
          timestamp: Date.now()
        };
        
        this.routeMessage(subscription.connectionId, message, {
          ...options,
          enableDiff: true
        });
      }
    }
  }
  
  /**
   * Broadcast trade notification
   */
  broadcastTradeNotification(tradeData, options = {}) {
    if (!this.feeds.trades) return;
    
    const channelSubs = this.channelSubscribers.get('trades') || new Set();
    
    for (const subscriptionId of channelSubs) {
      const subscription = this.subscriptionRegistry.get(subscriptionId);
      if (subscription && subscription.params.symbol === tradeData.symbol) {
        const message = {
          type: 'trade_update',
          data: tradeData,
          timestamp: Date.now()
        };
        
        this.routeMessage(subscription.connectionId, message, options);
      }
    }
  }
  
  /**
   * Broadcast ticker update
   */
  broadcastTickerUpdate(symbol, tickerData, options = {}) {
    if (!this.feeds.ticker) return;
    
    // Single ticker subscribers
    const tickerSubs = this.channelSubscribers.get('ticker') || new Set();
    for (const subscriptionId of tickerSubs) {
      const subscription = this.subscriptionRegistry.get(subscriptionId);
      if (subscription && subscription.params.symbol === symbol) {
        const message = {
          type: 'ticker_update',
          data: tickerData,
          timestamp: Date.now()
        };
        
        this.routeMessage(subscription.connectionId, message, options);
      }
    }
    
    // All tickers subscribers
    const allTickerSubs = this.channelSubscribers.get('all_tickers') || new Set();
    for (const subscriptionId of allTickerSubs) {
      const subscription = this.subscriptionRegistry.get(subscriptionId);
      const message = {
        type: 'all_tickers_update',
        data: [tickerData],
        timestamp: Date.now()
      };
      
      this.routeMessage(subscription.connectionId, message, options);
    }
  }
  
  /**
   * Generate subscription ID
   */
  generateSubscriptionId() {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Start the data feed manager
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Data feed manager is already running');
    }
    
    await this.initialize();
    this.isRunning = true;
    
    this.emit('started');
  }
  
  /**
   * Stop the data feed manager
   */
  async shutdown() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    // Shutdown all feeds
    for (const feed of Object.values(this.feeds)) {
      if (feed && typeof feed.shutdown === 'function') {
        await feed.shutdown();
      }
    }
    
    // Shutdown bandwidth optimizer
    if (this.bandwidthOptimizer) {
      this.bandwidthOptimizer.shutdown();
    }
    
    // Shutdown WebSocket manager
    if (this.webSocketManager) {
      await this.webSocketManager.shutdown();
    }
    
    // Clear all subscriptions
    this.subscriptionRegistry.clear();
    this.connectionSubscriptions.clear();
    this.channelSubscribers.clear();
    this.rateLimiters.clear();
    
    this.emit('shutdown');
  }
  
  /**
   * Get comprehensive statistics
   */
  getStats() {
    const stats = {
      manager: this.performanceStats,
      webSocket: this.webSocketManager?.getStats() || {},
      feeds: {}
    };
    
    // Get feed stats
    Object.entries(this.feeds).forEach(([name, feed]) => {
      if (feed && typeof feed.getStats === 'function') {
        stats.feeds[name] = feed.getStats();
      }
    });
    
    // Get bandwidth optimizer stats
    if (this.bandwidthOptimizer) {
      stats.bandwidthOptimizer = this.bandwidthOptimizer.getStats();
    }
    
    // Add subscription stats
    stats.subscriptions = {
      total: this.subscriptionRegistry.size,
      byChannel: Object.fromEntries(
        Array.from(this.channelSubscribers.entries()).map(([channel, subs]) => [
          channel, subs.size
        ])
      ),
      byConnection: this.connectionSubscriptions.size
    };
    
    return stats;
  }
  
  /**
   * Get subscription details
   */
  getSubscriptions(connectionId) {
    if (connectionId) {
      const connectionSubs = this.connectionSubscriptions.get(connectionId) || new Set();
      return Array.from(connectionSubs).map(id => this.subscriptionRegistry.get(id));
    }
    
    return Array.from(this.subscriptionRegistry.values());
  }
  
  /**
   * Health check
   */
  getHealthStatus() {
    const status = {
      status: this.isRunning ? 'healthy' : 'stopped',
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      components: {
        webSocket: this.webSocketManager ? 'healthy' : 'disabled',
        bandwidthOptimizer: this.bandwidthOptimizer ? 'healthy' : 'disabled'
      },
      feeds: {},
      subscriptions: {
        active: this.subscriptionRegistry.size,
        connections: this.connectionSubscriptions.size
      }
    };
    
    // Check feed health
    Object.entries(this.feeds).forEach(([name, feed]) => {
      status.components[name] = feed ? 'healthy' : 'disabled';
    });
    
    return status;
  }
}

module.exports = RealtimeDataFeedManager;