const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Trade Execution Notification Feed
 * Handles real-time trade notifications with privacy controls and filtering
 */
class TradeNotificationFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      batchInterval: config.batchInterval || 100,     // Batch trades every 100ms
      maxBatchSize: config.maxBatchSize || 50,        // Max trades per batch
      enableFiltering: config.enableFiltering !== false,
      enableAggregation: config.enableAggregation !== false,
      retentionPeriod: config.retentionPeriod || 3600000, // 1 hour
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // Trade data management
    this.recentTrades = new Map(); // symbol -> array of recent trades
    this.tradeBuffer = new Map();  // symbol -> pending trades to broadcast
    this.aggregatedTrades = new Map(); // symbol -> aggregated trade data
    
    // Subscription management
    this.subscriptions = new Map(); // subscriptionKey -> subscription details
    this.symbolSubscribers = new Map(); // symbol -> Set of subscription keys
    this.userTradeSubscribers = new Map(); // userId -> Set of subscription keys
    
    // Privacy and filtering
    this.privacyLevels = {
      PUBLIC: 'public',       // All trades visible
      AGGREGATED: 'aggregated', // Only aggregated data
      PRIVATE: 'private'      // User's own trades only
    };
    
    // Performance tracking
    this.performanceStats = {
      tradesProcessed: 0,
      tradesSent: 0,
      batchesSent: 0,
      aggregationsCreated: 0,
      subscriptionsActive: 0,
      avgProcessingTime: 0,
      bytesTransferred: 0
    };
    
    // Trade filtering and aggregation
    this.filterCriteria = new Map(); // subscriptionKey -> filter criteria
    this.aggregationIntervals = new Map(); // symbol -> aggregation timer
    
    this.startTradeProcessor();
    this.startCleanupTask();
  }
  
  /**
   * Initialize with WebSocket manager
   */
  initialize(webSocketManager) {
    this.webSocketManager = webSocketManager;
    
    // Listen for subscription events
    this.webSocketManager.on('subscribed', (event) => {
      if (event.channel === 'trades') {
        this.handleTradeSubscription(event);
      } else if (event.channel === 'user_trades') {
        this.handleUserTradeSubscription(event);
      }
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      if (event.channel === 'trades' || event.channel === 'user_trades') {
        this.handleUnsubscription(event);
      }
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
  }
  
  /**
   * Process new trade execution
   */
  processTrade(tradeData) {
    const startTime = Date.now();
    
    const trade = this.normalizeTrade(tradeData);
    
    // Store in recent trades
    this.storeRecentTrade(trade);
    
    // Add to broadcast buffer
    this.bufferTradeForBroadcast(trade);
    
    // Update aggregations
    if (this.config.enableAggregation) {
      this.updateAggregations(trade);
    }
    
    // Process user-specific notifications
    this.processUserTradeNotifications(trade);
    
    this.performanceStats.tradesProcessed++;
    this.performanceStats.avgProcessingTime = this.updateAverage(
      this.performanceStats.avgProcessingTime,
      Date.now() - startTime,
      this.performanceStats.tradesProcessed
    );
    
    this.emit('trade_processed', trade);
  }
  
  /**
   * Normalize trade data
   */
  normalizeTrade(tradeData) {
    return {
      id: tradeData.id || this.generateTradeId(),
      symbol: tradeData.symbol,
      price: tradeData.price.toString(),
      size: tradeData.size.toString(),
      side: tradeData.side, // 'buy' or 'sell'
      timestamp: tradeData.timestamp || Date.now(),
      maker: tradeData.maker,
      taker: tradeData.taker,
      makerUserId: tradeData.makerUserId,
      takerUserId: tradeData.takerUserId,
      value: (parseFloat(tradeData.price) * parseFloat(tradeData.size)).toString(),
      fees: tradeData.fees || {},
      metadata: tradeData.metadata || {}
    };
  }
  
  /**
   * Store recent trade
   */
  storeRecentTrade(trade) {
    if (!this.recentTrades.has(trade.symbol)) {
      this.recentTrades.set(trade.symbol, []);
    }
    
    const trades = this.recentTrades.get(trade.symbol);
    trades.push(trade);
    
    // Maintain size limit (keep last 1000 trades)
    if (trades.length > 1000) {
      trades.splice(0, trades.length - 1000);
    }
  }
  
  /**
   * Buffer trade for broadcast
   */
  bufferTradeForBroadcast(trade) {
    if (!this.tradeBuffer.has(trade.symbol)) {
      this.tradeBuffer.set(trade.symbol, []);
    }
    
    this.tradeBuffer.get(trade.symbol).push(trade);
  }
  
  /**
   * Update trade aggregations
   */
  updateAggregations(trade) {
    const symbol = trade.symbol;
    
    if (!this.aggregatedTrades.has(symbol)) {
      this.aggregatedTrades.set(symbol, this.createEmptyAggregation(symbol));
    }
    
    const aggregation = this.aggregatedTrades.get(symbol);
    
    // Update aggregation data
    aggregation.count++;
    aggregation.volume += parseFloat(trade.size);
    aggregation.value += parseFloat(trade.value);
    aggregation.lastPrice = trade.price;
    aggregation.lastTimestamp = trade.timestamp;
    
    // Update price statistics
    const price = parseFloat(trade.price);
    if (!aggregation.high || price > parseFloat(aggregation.high)) {
      aggregation.high = trade.price;
    }
    if (!aggregation.low || price < parseFloat(aggregation.low)) {
      aggregation.low = trade.price;
    }
    
    // Calculate VWAP
    aggregation.vwap = (aggregation.value / aggregation.volume).toString();
    
    this.performanceStats.aggregationsCreated++;
  }
  
  /**
   * Process user-specific trade notifications
   */
  processUserTradeNotifications(trade) {
    // Notify maker
    if (trade.makerUserId) {
      this.sendUserTradeNotification(trade.makerUserId, trade, 'maker');
    }
    
    // Notify taker
    if (trade.takerUserId) {
      this.sendUserTradeNotification(trade.takerUserId, trade, 'taker');
    }
  }
  
  /**
   * Send user trade notification
   */
  sendUserTradeNotification(userId, trade, role) {
    const userSubscribers = this.userTradeSubscribers.get(userId);
    if (!userSubscribers || userSubscribers.size === 0) {
      return;
    }
    
    for (const subscriptionKey of userSubscribers) {
      const subscription = this.subscriptions.get(subscriptionKey);
      if (!subscription) continue;
      
      // Create user-specific trade data
      const userTrade = this.createUserTradeData(trade, role, subscription);
      
      const message = {
        type: 'user_trade',
        data: userTrade,
        timestamp: Date.now()
      };
      
      this.webSocketManager.sendToConnection(subscription.connectionId, message);
    }
  }
  
  /**
   * Create user-specific trade data
   */
  createUserTradeData(trade, role, subscription) {
    const baseData = {
      id: trade.id,
      symbol: trade.symbol,
      price: trade.price,
      size: trade.size,
      side: role === 'maker' ? 
        (trade.side === 'buy' ? 'sell' : 'buy') : // Opposite for maker
        trade.side,
      timestamp: trade.timestamp,
      role: role,
      value: trade.value,
      fees: trade.fees
    };
    
    // Add additional data based on subscription settings
    if (subscription.includeCounterparty) {
      baseData.counterparty = role === 'maker' ? 
        trade.takerUserId : trade.makerUserId;
    }
    
    if (subscription.includeMetadata) {
      baseData.metadata = trade.metadata;
    }
    
    return baseData;
  }
  
  /**
   * Handle trade subscription
   */
  handleTradeSubscription(event) {
    const { connectionId, params } = event;
    const { 
      symbol, 
      privacyLevel = this.privacyLevels.PUBLIC,
      filter = {},
      aggregated = false 
    } = params;
    
    const subscriptionKey = `trades:${connectionId}:${symbol}:${privacyLevel}:${aggregated}`;
    
    // Validate privacy level
    if (!Object.values(this.privacyLevels).includes(privacyLevel)) {
      this.webSocketManager.sendToConnection(connectionId, {
        type: 'subscription_error',
        code: 'INVALID_PRIVACY_LEVEL',
        message: 'Invalid privacy level specified'
      });
      return;
    }
    
    // Store subscription
    this.subscriptions.set(subscriptionKey, {
      connectionId: connectionId,
      channel: 'trades',
      symbol: symbol,
      privacyLevel: privacyLevel,
      filter: filter,
      aggregated: aggregated,
      subscribedAt: Date.now(),
      lastUpdate: null
    });
    
    // Track symbol subscribers
    if (!this.symbolSubscribers.has(symbol)) {
      this.symbolSubscribers.set(symbol, new Set());
    }
    this.symbolSubscribers.get(symbol).add(subscriptionKey);
    
    // Store filter criteria
    if (Object.keys(filter).length > 0) {
      this.filterCriteria.set(subscriptionKey, filter);
    }
    
    this.performanceStats.subscriptionsActive++;
    
    // Send recent trades or aggregated data
    if (aggregated) {
      this.sendAggregatedData(subscriptionKey);
    } else {
      this.sendRecentTrades(subscriptionKey);
    }
    
    this.emit('trade_subscription_added', { subscriptionKey, symbol, connectionId });
  }
  
  /**
   * Handle user trade subscription
   */
  handleUserTradeSubscription(event) {
    const { connectionId, params } = event;
    const { userId, includeCounterparty = false, includeMetadata = false } = params;
    
    // Verify user can subscribe to their own trades
    const connection = this.webSocketManager.connections?.get(connectionId);
    if (!connection || connection.userId !== userId) {
      this.webSocketManager.sendToConnection(connectionId, {
        type: 'subscription_error',
        code: 'UNAUTHORIZED_USER_TRADES',
        message: 'Can only subscribe to your own trades'
      });
      return;
    }
    
    const subscriptionKey = `user_trades:${connectionId}:${userId}`;
    
    // Store subscription
    this.subscriptions.set(subscriptionKey, {
      connectionId: connectionId,
      channel: 'user_trades',
      userId: userId,
      includeCounterparty: includeCounterparty,
      includeMetadata: includeMetadata,
      subscribedAt: Date.now()
    });
    
    // Track user subscribers
    if (!this.userTradeSubscribers.has(userId)) {
      this.userTradeSubscribers.set(userId, new Set());
    }
    this.userTradeSubscribers.get(userId).add(subscriptionKey);
    
    this.performanceStats.subscriptionsActive++;
    
    this.emit('user_trade_subscription_added', { subscriptionKey, userId, connectionId });
  }
  
  /**
   * Send recent trades
   */
  sendRecentTrades(subscriptionKey) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    const recentTrades = this.recentTrades.get(subscription.symbol) || [];
    const filteredTrades = this.applyTradeFilters(recentTrades, subscription);
    
    // Limit to last 50 trades
    const tradesToSend = filteredTrades.slice(-50);
    
    const message = {
      type: 'trades_snapshot',
      symbol: subscription.symbol,
      data: tradesToSend.map(trade => this.formatTradeForPrivacy(trade, subscription.privacyLevel)),
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(subscription.connectionId, message);
  }
  
  /**
   * Send aggregated data
   */
  sendAggregatedData(subscriptionKey) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    const aggregation = this.aggregatedTrades.get(subscription.symbol);
    if (!aggregation) {
      return;
    }
    
    const message = {
      type: 'trades_aggregated',
      symbol: subscription.symbol,
      data: {
        count: aggregation.count,
        volume: aggregation.volume.toString(),
        value: aggregation.value.toString(),
        vwap: aggregation.vwap,
        high: aggregation.high,
        low: aggregation.low,
        lastPrice: aggregation.lastPrice,
        period: aggregation.period
      },
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(subscription.connectionId, message);
  }
  
  /**
   * Apply trade filters
   */
  applyTradeFilters(trades, subscription) {
    if (!this.config.enableFiltering) {
      return trades;
    }
    
    const filter = this.filterCriteria.get(subscription.subscriptionKey) || {};
    
    return trades.filter(trade => {
      // Price filter
      if (filter.minPrice && parseFloat(trade.price) < parseFloat(filter.minPrice)) {
        return false;
      }
      if (filter.maxPrice && parseFloat(trade.price) > parseFloat(filter.maxPrice)) {
        return false;
      }
      
      // Size filter
      if (filter.minSize && parseFloat(trade.size) < parseFloat(filter.minSize)) {
        return false;
      }
      if (filter.maxSize && parseFloat(trade.size) > parseFloat(filter.maxSize)) {
        return false;
      }
      
      // Side filter
      if (filter.side && trade.side !== filter.side) {
        return false;
      }
      
      // Time filter
      if (filter.since && trade.timestamp < filter.since) {
        return false;
      }
      
      return true;
    });
  }
  
  /**
   * Format trade for privacy level
   */
  formatTradeForPrivacy(trade, privacyLevel) {
    const baseTrade = {
      id: trade.id,
      symbol: trade.symbol,
      price: trade.price,
      size: trade.size,
      side: trade.side,
      timestamp: trade.timestamp,
      value: trade.value
    };
    
    switch (privacyLevel) {
      case this.privacyLevels.PUBLIC:
        // Include all public information
        return {
          ...baseTrade,
          maker: trade.maker,
          taker: trade.taker
        };
        
      case this.privacyLevels.AGGREGATED:
        // Only basic trade info
        return baseTrade;
        
      case this.privacyLevels.PRIVATE:
        // Minimal information
        return {
          id: trade.id,
          symbol: trade.symbol,
          price: trade.price,
          size: trade.size,
          timestamp: trade.timestamp
        };
        
      default:
        return baseTrade;
    }
  }
  
  /**
   * Handle unsubscription
   */
  handleUnsubscription(event) {
    const { connectionId, params } = event;
    
    // Find and remove subscriptions
    const subscriptionsToRemove = [];
    for (const [subscriptionKey, subscription] of this.subscriptions) {
      if (subscription.connectionId === connectionId) {
        // Check if it matches the unsubscription criteria
        if (this.matchesUnsubscription(subscription, params)) {
          subscriptionsToRemove.push(subscriptionKey);
        }
      }
    }
    
    subscriptionsToRemove.forEach(subscriptionKey => {
      this.removeSubscription(subscriptionKey);
    });
  }
  
  /**
   * Check if subscription matches unsubscription criteria
   */
  matchesUnsubscription(subscription, params) {
    if (subscription.channel === 'trades' && params.symbol) {
      return subscription.symbol === params.symbol;
    }
    
    if (subscription.channel === 'user_trades' && params.userId) {
      return subscription.userId === params.userId;
    }
    
    return true; // Remove all if no specific criteria
  }
  
  /**
   * Remove subscription
   */
  removeSubscription(subscriptionKey) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    this.subscriptions.delete(subscriptionKey);
    
    // Remove from symbol subscribers
    if (subscription.channel === 'trades') {
      const symbolSubs = this.symbolSubscribers.get(subscription.symbol);
      if (symbolSubs) {
        symbolSubs.delete(subscriptionKey);
        if (symbolSubs.size === 0) {
          this.symbolSubscribers.delete(subscription.symbol);
        }
      }
    }
    
    // Remove from user subscribers
    if (subscription.channel === 'user_trades') {
      const userSubs = this.userTradeSubscribers.get(subscription.userId);
      if (userSubs) {
        userSubs.delete(subscriptionKey);
        if (userSubs.size === 0) {
          this.userTradeSubscribers.delete(subscription.userId);
        }
      }
    }
    
    // Clean up filter criteria
    this.filterCriteria.delete(subscriptionKey);
    
    this.performanceStats.subscriptionsActive--;
    
    this.emit('subscription_removed', { subscriptionKey, subscription });
  }
  
  /**
   * Handle connection disconnection
   */
  handleDisconnection(event) {
    const { connectionId } = event;
    
    // Remove all subscriptions for this connection
    const subscriptionsToRemove = [];
    for (const [subscriptionKey, subscription] of this.subscriptions) {
      if (subscription.connectionId === connectionId) {
        subscriptionsToRemove.push(subscriptionKey);
      }
    }
    
    subscriptionsToRemove.forEach(subscriptionKey => {
      this.removeSubscription(subscriptionKey);
    });
  }
  
  /**
   * Start trade processor
   */
  startTradeProcessor() {
    setInterval(() => {
      this.processPendingTrades();
    }, this.config.batchInterval);
  }
  
  /**
   * Process pending trades
   */
  processPendingTrades() {
    for (const [symbol, trades] of this.tradeBuffer) {
      if (trades.length === 0) continue;
      
      const subscribers = this.symbolSubscribers.get(symbol);
      if (!subscribers || subscribers.size === 0) {
        // Clear buffer if no subscribers
        this.tradeBuffer.set(symbol, []);
        continue;
      }
      
      // Create batches
      const batches = this.createTradeBatches(trades);
      
      for (const subscriptionKey of subscribers) {
        const subscription = this.subscriptions.get(subscriptionKey);
        if (!subscription || subscription.aggregated) continue;
        
        for (const batch of batches) {
          this.sendTradeBatch(subscription, batch);
        }
      }
      
      // Clear processed trades
      this.tradeBuffer.set(symbol, []);
    }
  }
  
  /**
   * Create trade batches
   */
  createTradeBatches(trades) {
    const batches = [];
    
    for (let i = 0; i < trades.length; i += this.config.maxBatchSize) {
      batches.push(trades.slice(i, i + this.config.maxBatchSize));
    }
    
    return batches;
  }
  
  /**
   * Send trade batch
   */
  sendTradeBatch(subscription, batch) {
    const filteredTrades = this.applyTradeFilters(batch, subscription);
    if (filteredTrades.length === 0) return;
    
    const formattedTrades = filteredTrades.map(trade => 
      this.formatTradeForPrivacy(trade, subscription.privacyLevel)
    );
    
    const message = {
      type: 'trades_update',
      symbol: subscription.symbol,
      data: formattedTrades,
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(subscription.connectionId, message);
    
    this.performanceStats.tradesSent += formattedTrades.length;
    this.performanceStats.batchesSent++;
  }
  
  /**
   * Start cleanup task
   */
  startCleanupTask() {
    setInterval(() => {
      this.cleanupOldTrades();
    }, 300000); // Every 5 minutes
  }
  
  /**
   * Clean up old trades
   */
  cleanupOldTrades() {
    const cutoff = Date.now() - this.config.retentionPeriod;
    
    for (const [symbol, trades] of this.recentTrades) {
      const filteredTrades = trades.filter(trade => trade.timestamp > cutoff);
      this.recentTrades.set(symbol, filteredTrades);
    }
  }
  
  /**
   * Create empty aggregation
   */
  createEmptyAggregation(symbol) {
    return {
      symbol: symbol,
      count: 0,
      volume: 0,
      value: 0,
      vwap: '0',
      high: null,
      low: null,
      lastPrice: null,
      lastTimestamp: null,
      period: '1h'
    };
  }
  
  /**
   * Generate trade ID
   */
  generateTradeId() {
    return `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.performanceStats,
      subscriptionsActive: this.subscriptions.size,
      symbolsTracked: this.symbolSubscribers.size,
      usersTracked: this.userTradeSubscribers.size,
      tradesBuffered: Array.from(this.tradeBuffer.values()).reduce((total, trades) => total + trades.length, 0)
    };
  }
  
  /**
   * Shutdown trade feed
   */
  shutdown() {
    this.recentTrades.clear();
    this.tradeBuffer.clear();
    this.aggregatedTrades.clear();
    this.subscriptions.clear();
    this.symbolSubscribers.clear();
    this.userTradeSubscribers.clear();
    this.filterCriteria.clear();
    
    // Clear aggregation intervals
    for (const timer of this.aggregationIntervals.values()) {
      clearInterval(timer);
    }
    this.aggregationIntervals.clear();
    
    this.emit('shutdown');
  }
}

module.exports = TradeNotificationFeed;