const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Order Book Depth Feed System
 * Handles real-time order book updates with depth tracking and optimization
 */
class OrderBookFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxDepth: config.maxDepth || 50,           // Max levels per side
      updateInterval: config.updateInterval || 100, // Batch updates every 100ms
      priceGrouping: config.priceGrouping || 8,   // Price precision grouping
      enableCompression: config.enableCompression !== false,
      enableDelta: config.enableDelta !== false,  // Send only changes
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // Order book state management
    this.orderBooks = new Map(); // symbol -> order book data
    this.lastSnapshots = new Map(); // symbol -> last full snapshot
    this.pendingUpdates = new Map(); // symbol -> pending updates array
    this.updateBuffer = new Map(); // symbol -> buffered updates
    
    // Subscription management
    this.subscriptions = new Map(); // subscriptionKey -> subscription details
    this.symbolSubscribers = new Map(); // symbol -> Set of subscription keys
    
    // Performance tracking
    this.performanceStats = {
      updatesProcessed: 0,
      snapshotsSent: 0,
      deltasSent: 0,
      compressionRatio: 0,
      avgUpdateLatency: 0,
      subscriptionsActive: 0,
      booksTracked: 0
    };
    
    // Buffering and batching
    this.updateTimer = null;
    this.lastUpdateTime = new Map(); // symbol -> last update timestamp
    
    this.startUpdateProcessor();
  }
  
  /**
   * Initialize with WebSocket manager
   */
  initialize(webSocketManager) {
    this.webSocketManager = webSocketManager;
    
    // Listen for subscription events
    this.webSocketManager.on('subscribed', (event) => {
      if (event.channel === 'orderbook') {
        this.handleSubscription(event);
      }
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      if (event.channel === 'orderbook') {
        this.handleUnsubscription(event);
      }
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
  }
  
  /**
   * Update order book with new order data
   */
  updateOrderBook(symbol, orderData) {
    const startTime = Date.now();
    
    // Get or create order book
    let orderBook = this.orderBooks.get(symbol);
    if (!orderBook) {
      orderBook = this.createEmptyOrderBook(symbol);
      this.orderBooks.set(symbol, orderBook);
      this.performanceStats.booksTracked++;
    }
    
    // Process the order update
    const changes = this.processOrderUpdate(orderBook, orderData);
    
    if (changes.length > 0) {
      // Add to pending updates
      if (!this.pendingUpdates.has(symbol)) {
        this.pendingUpdates.set(symbol, []);
      }
      
      this.pendingUpdates.get(symbol).push({
        changes: changes,
        timestamp: Date.now(),
        sequenceId: orderBook.sequenceId++
      });
      
      this.lastUpdateTime.set(symbol, Date.now());
    }
    
    this.performanceStats.updatesProcessed++;
    this.performanceStats.avgUpdateLatency = this.updateAverage(
      this.performanceStats.avgUpdateLatency,
      Date.now() - startTime,
      this.performanceStats.updatesProcessed
    );
  }
  
  /**
   * Process individual order update
   */
  processOrderUpdate(orderBook, orderData) {
    const { side, price, size, orderId, type } = orderData;
    const changes = [];
    
    if (type === 'add' || type === 'update') {
      const targetSide = side === 'buy' ? orderBook.bids : orderBook.asks;
      
      // Update order in the book
      if (size > 0) {
        const existingLevel = targetSide.get(price);
        if (existingLevel) {
          existingLevel.size = size;
          existingLevel.orders.set(orderId, { size, timestamp: Date.now() });
        } else {
          targetSide.set(price, {
            price: price,
            size: size,
            orders: new Map([[orderId, { size, timestamp: Date.now() }]])
          });
        }
        
        changes.push({
          type: 'level_update',
          side: side,
          price: price,
          size: size
        });
      } else {
        // Remove order/level
        this.removeFromOrderBook(orderBook, side, price, orderId, changes);
      }
    } else if (type === 'remove') {
      this.removeFromOrderBook(orderBook, side, price, orderId, changes);
    }
    
    // Maintain sorted order and depth limits
    this.maintainOrderBookIntegrity(orderBook, side);
    
    return changes;
  }
  
  /**
   * Remove order from order book
   */
  removeFromOrderBook(orderBook, side, price, orderId, changes) {
    const targetSide = side === 'buy' ? orderBook.bids : orderBook.asks;
    const level = targetSide.get(price);
    
    if (level) {
      level.orders.delete(orderId);
      
      if (level.orders.size === 0) {
        targetSide.delete(price);
        changes.push({
          type: 'level_remove',
          side: side,
          price: price,
          size: 0
        });
      } else {
        // Recalculate level size
        level.size = Array.from(level.orders.values())
          .reduce((total, order) => total + order.size, 0);
        
        changes.push({
          type: 'level_update',
          side: side,
          price: price,
          size: level.size
        });
      }
    }
  }
  
  /**
   * Maintain order book integrity
   */
  maintainOrderBookIntegrity(orderBook, side) {
    const targetSide = side === 'buy' ? orderBook.bids : orderBook.asks;
    
    // Convert to sorted array
    const sortedLevels = Array.from(targetSide.entries()).sort((a, b) => {
      return side === 'buy' ? 
        parseFloat(b[0]) - parseFloat(a[0]) : // Bids: highest first
        parseFloat(a[0]) - parseFloat(b[0]);  // Asks: lowest first
    });
    
    // Trim to max depth
    if (sortedLevels.length > this.config.maxDepth) {
      const levelsToRemove = sortedLevels.slice(this.config.maxDepth);
      levelsToRemove.forEach(([price]) => targetSide.delete(price));
    }
    
    // Update best bid/ask
    if (side === 'buy' && sortedLevels.length > 0) {
      orderBook.bestBid = sortedLevels[0][0];
    } else if (side === 'sell' && sortedLevels.length > 0) {
      orderBook.bestAsk = sortedLevels[0][0];
    }
    
    // Update spread
    if (orderBook.bestBid && orderBook.bestAsk) {
      orderBook.spread = parseFloat(orderBook.bestAsk) - parseFloat(orderBook.bestBid);
      orderBook.spreadPercent = (orderBook.spread / parseFloat(orderBook.bestAsk)) * 100;
    }
  }
  
  /**
   * Handle new subscription
   */
  handleSubscription(event) {
    const { connectionId, params } = event;
    const { symbol, depth = this.config.maxDepth, grouped = false } = params;
    
    if (!symbol) {
      return;
    }
    
    const subscriptionKey = `${connectionId}:${symbol}:${depth}:${grouped}`;
    
    // Store subscription details
    this.subscriptions.set(subscriptionKey, {
      connectionId: connectionId,
      symbol: symbol,
      depth: Math.min(depth, this.config.maxDepth),
      grouped: grouped,
      subscribedAt: Date.now(),
      lastSnapshot: null,
      deltaMode: this.config.enableDelta
    });
    
    // Track symbol subscribers
    if (!this.symbolSubscribers.has(symbol)) {
      this.symbolSubscribers.set(symbol, new Set());
    }
    this.symbolSubscribers.get(symbol).add(subscriptionKey);
    
    this.performanceStats.subscriptionsActive++;
    
    // Send initial snapshot
    this.sendOrderBookSnapshot(subscriptionKey);
    
    this.emit('subscription_added', { subscriptionKey, symbol, connectionId });
  }
  
  /**
   * Handle unsubscription
   */
  handleUnsubscription(event) {
    const { connectionId, params } = event;
    const { symbol } = params;
    
    // Find and remove subscription
    for (const [subscriptionKey, subscription] of this.subscriptions) {
      if (subscription.connectionId === connectionId && subscription.symbol === symbol) {
        this.subscriptions.delete(subscriptionKey);
        
        // Remove from symbol subscribers
        const symbolSubs = this.symbolSubscribers.get(symbol);
        if (symbolSubs) {
          symbolSubs.delete(subscriptionKey);
          if (symbolSubs.size === 0) {
            this.symbolSubscribers.delete(symbol);
          }
        }
        
        this.performanceStats.subscriptionsActive--;
        this.emit('subscription_removed', { subscriptionKey, symbol, connectionId });
        break;
      }
    }
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
      const subscription = this.subscriptions.get(subscriptionKey);
      this.subscriptions.delete(subscriptionKey);
      
      // Remove from symbol subscribers
      const symbolSubs = this.symbolSubscribers.get(subscription.symbol);
      if (symbolSubs) {
        symbolSubs.delete(subscriptionKey);
        if (symbolSubs.size === 0) {
          this.symbolSubscribers.delete(subscription.symbol);
        }
      }
      
      this.performanceStats.subscriptionsActive--;
    });
  }
  
  /**
   * Send order book snapshot
   */
  sendOrderBookSnapshot(subscriptionKey) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    const orderBook = this.orderBooks.get(subscription.symbol);
    if (!orderBook) {
      // Send empty order book
      this.webSocketManager.sendToConnection(subscription.connectionId, {
        type: 'orderbook_snapshot',
        symbol: subscription.symbol,
        data: {
          bids: [],
          asks: [],
          timestamp: Date.now(),
          sequence: 0
        }
      });
      return;
    }
    
    // Generate snapshot data
    const snapshotData = this.generateSnapshot(orderBook, subscription);
    
    // Apply grouping if requested
    if (subscription.grouped) {
      snapshotData.bids = this.groupPriceLevels(snapshotData.bids, 'buy');
      snapshotData.asks = this.groupPriceLevels(snapshotData.asks, 'sell');
    }
    
    const message = {
      type: 'orderbook_snapshot',
      symbol: subscription.symbol,
      data: snapshotData,
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(subscription.connectionId, message, {
      enableDiff: false // Full snapshot, no diff
    });
    
    // Store last snapshot for delta calculation
    subscription.lastSnapshot = snapshotData;
    this.performanceStats.snapshotsSent++;
  }
  
  /**
   * Generate order book snapshot
   */
  generateSnapshot(orderBook, subscription) {
    const bids = Array.from(orderBook.bids.entries())
      .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])) // Highest first
      .slice(0, subscription.depth)
      .map(([price, level]) => [price, level.size.toString()]);
    
    const asks = Array.from(orderBook.asks.entries())
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])) // Lowest first
      .slice(0, subscription.depth)
      .map(([price, level]) => [price, level.size.toString()]);
    
    return {
      bids: bids,
      asks: asks,
      timestamp: Date.now(),
      sequence: orderBook.sequenceId,
      bestBid: orderBook.bestBid,
      bestAsk: orderBook.bestAsk,
      spread: orderBook.spread
    };
  }
  
  /**
   * Group price levels for reduced precision
   */
  groupPriceLevels(levels, side) {
    const grouping = this.config.priceGrouping;
    const grouped = new Map();
    
    levels.forEach(([price, size]) => {
      const numPrice = parseFloat(price);
      const groupedPrice = this.roundToGrouping(numPrice, grouping);
      const groupKey = groupedPrice.toString();
      
      const existing = grouped.get(groupKey);
      if (existing) {
        existing[1] = (parseFloat(existing[1]) + parseFloat(size)).toString();
      } else {
        grouped.set(groupKey, [groupKey, size]);
      }
    });
    
    // Return sorted grouped levels
    return Array.from(grouped.values()).sort((a, b) => {
      return side === 'buy' ? 
        parseFloat(b[0]) - parseFloat(a[0]) : // Bids: highest first
        parseFloat(a[0]) - parseFloat(b[0]);  // Asks: lowest first
    });
  }
  
  /**
   * Round price to grouping precision
   */
  roundToGrouping(price, grouping) {
    const factor = Math.pow(10, grouping);
    return Math.round(price * factor) / factor;
  }
  
  /**
   * Start update processor
   */
  startUpdateProcessor() {
    this.updateTimer = setInterval(() => {
      this.processBufferedUpdates();
    }, this.config.updateInterval);
  }
  
  /**
   * Process buffered updates
   */
  processBufferedUpdates() {
    for (const [symbol, updates] of this.pendingUpdates) {
      if (updates.length === 0) continue;
      
      // Get subscribers for this symbol
      const subscribers = this.symbolSubscribers.get(symbol);
      if (!subscribers || subscribers.size === 0) {
        // Clear updates if no subscribers
        this.pendingUpdates.set(symbol, []);
        continue;
      }
      
      // Process updates for each subscriber
      for (const subscriptionKey of subscribers) {
        this.sendOrderBookUpdate(subscriptionKey, updates);
      }
      
      // Clear processed updates
      this.pendingUpdates.set(symbol, []);
    }
  }
  
  /**
   * Send order book update
   */
  sendOrderBookUpdate(subscriptionKey, updates) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    const orderBook = this.orderBooks.get(subscription.symbol);
    if (!orderBook) return;
    
    if (subscription.deltaMode && subscription.lastSnapshot) {
      // Send delta update
      this.sendDeltaUpdate(subscription, updates);
    } else {
      // Send full snapshot
      this.sendOrderBookSnapshot(subscriptionKey);
    }
  }
  
  /**
   * Send delta update
   */
  sendDeltaUpdate(subscription, updates) {
    const changes = [];
    
    // Consolidate changes
    const changeMap = new Map(); // price:side -> latest change
    
    updates.forEach(update => {
      update.changes.forEach(change => {
        const key = `${change.price}:${change.side}`;
        changeMap.set(key, change);
      });
    });
    
    // Convert to array and apply grouping if needed
    let deltaChanges = Array.from(changeMap.values());
    
    if (subscription.grouped) {
      deltaChanges = this.applyGroupingToChanges(deltaChanges);
    }
    
    const message = {
      type: 'orderbook_delta',
      symbol: subscription.symbol,
      data: {
        changes: deltaChanges,
        timestamp: Date.now(),
        sequence: updates[updates.length - 1].sequenceId
      }
    };
    
    this.webSocketManager.sendToConnection(subscription.connectionId, message, {
      enableDiff: true
    });
    
    this.performanceStats.deltasSent++;
  }
  
  /**
   * Apply grouping to delta changes
   */
  applyGroupingToChanges(changes) {
    const grouped = new Map();
    
    changes.forEach(change => {
      const groupedPrice = this.roundToGrouping(parseFloat(change.price), this.config.priceGrouping);
      const key = `${groupedPrice}:${change.side}`;
      
      const existing = grouped.get(key);
      if (existing) {
        // Consolidate sizes
        if (change.type === 'level_remove') {
          existing.size = 0;
        } else {
          existing.size += change.size;
        }
      } else {
        grouped.set(key, {
          ...change,
          price: groupedPrice.toString(),
          size: change.type === 'level_remove' ? 0 : change.size
        });
      }
    });
    
    return Array.from(grouped.values());
  }
  
  /**
   * Create empty order book
   */
  createEmptyOrderBook(symbol) {
    return {
      symbol: symbol,
      bids: new Map(), // price -> { price, size, orders: Map }
      asks: new Map(), // price -> { price, size, orders: Map }
      bestBid: null,
      bestAsk: null,
      spread: null,
      spreadPercent: null,
      sequenceId: 1,
      lastUpdated: Date.now()
    };
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Get order book statistics
   */
  getStats() {
    return {
      ...this.performanceStats,
      booksTracked: this.orderBooks.size,
      subscriptionsActive: this.subscriptions.size,
      symbolsTracked: this.symbolSubscribers.size
    };
  }
  
  /**
   * Get order book for symbol
   */
  getOrderBook(symbol) {
    return this.orderBooks.get(symbol);
  }
  
  /**
   * Clear order book
   */
  clearOrderBook(symbol) {
    this.orderBooks.delete(symbol);
    this.pendingUpdates.delete(symbol);
    this.lastUpdateTime.delete(symbol);
    this.lastSnapshots.delete(symbol);
  }
  
  /**
   * Shutdown order book feed
   */
  shutdown() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    
    this.orderBooks.clear();
    this.subscriptions.clear();
    this.symbolSubscribers.clear();
    this.pendingUpdates.clear();
    
    this.emit('shutdown');
  }
}

module.exports = OrderBookFeed;