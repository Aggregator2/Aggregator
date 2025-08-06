const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * User Order Status Updates Feed
 * Provides real-time order status updates with privacy controls and detailed tracking
 */
class UserOrderStatusFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      batchInterval: config.batchInterval || 50,          // Batch updates every 50ms
      maxBatchSize: config.maxBatchSize || 25,            // Max updates per batch
      enableHistory: config.enableHistory !== false,     // Track order history
      historyRetention: config.historyRetention || 86400000, // 24 hours
      enableNotifications: config.enableNotifications !== false,
      notificationThresholds: config.notificationThresholds || {},
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // Order tracking
    this.userOrders = new Map();        // userId -> Map(orderId -> order data)
    this.orderHistory = new Map();      // userId -> array of historical orders
    this.orderStatusQueue = new Map();  // userId -> array of pending status updates
    this.orderNotifications = new Map(); // userId -> notification preferences
    
    // Subscription management
    this.userSubscriptions = new Map(); // userId -> Set of connectionIds
    this.connectionSubscriptions = new Map(); // connectionId -> subscription details
    
    // Order state tracking
    this.orderStates = {
      PENDING: 'pending',           // Order submitted but not yet processed
      OPEN: 'open',                // Order active in the order book
      PARTIAL: 'partial',          // Order partially filled
      FILLED: 'filled',            // Order completely filled
      CANCELLED: 'cancelled',      // Order cancelled by user
      REJECTED: 'rejected',        // Order rejected by system
      EXPIRED: 'expired'           // Order expired due to time constraints
    };
    
    // Notification types
    this.notificationTypes = {
      ORDER_PLACED: 'order_placed',
      ORDER_FILLED: 'order_filled',
      ORDER_PARTIAL: 'order_partial',
      ORDER_CANCELLED: 'order_cancelled',
      ORDER_REJECTED: 'order_rejected',
      ORDER_EXPIRED: 'order_expired',
      BALANCE_INSUFFICIENT: 'balance_insufficient',
      PRICE_ALERT: 'price_alert'
    };
    
    // Performance tracking
    this.performanceStats = {
      ordersTracked: 0,
      statusUpdatesProcessed: 0,
      statusUpdatesSent: 0,
      notificationsSent: 0,
      batchesProcessed: 0,
      subscriptionsActive: 0,
      avgUpdateLatency: 0
    };
    
    // Privacy and security
    this.orderDataFields = {
      public: ['orderId', 'symbol', 'side', 'type', 'status', 'timestamp'],
      private: ['orderId', 'symbol', 'side', 'type', 'status', 'quantity', 'price', 'filled', 'remaining', 'timestamp', 'fees'],
      detailed: ['orderId', 'symbol', 'side', 'type', 'status', 'quantity', 'price', 'filled', 'remaining', 'timestamp', 'fees', 'fills', 'metadata']
    };
    
    this.startStatusProcessor();
    this.startCleanupTask();
  }
  
  /**
   * Initialize with WebSocket manager
   */
  initialize(webSocketManager) {
    this.webSocketManager = webSocketManager;
    
    // Listen for subscription events
    this.webSocketManager.on('subscribed', (event) => {
      if (event.channel === 'user_orders') {
        this.handleOrderSubscription(event);
      }
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      if (event.channel === 'user_orders') {
        this.handleUnsubscription(event);
      }
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
  }
  
  /**
   * Update order status
   */
  updateOrderStatus(userId, orderUpdate) {
    const startTime = Date.now();
    
    const normalizedUpdate = this.normalizeOrderUpdate(orderUpdate);
    
    // Update order in user's order map
    this.updateUserOrder(userId, normalizedUpdate);
    
    // Add to order history if status changed significantly
    this.addToOrderHistory(userId, normalizedUpdate);
    
    // Queue status update for broadcast
    this.queueStatusUpdate(userId, normalizedUpdate);
    
    // Process notifications
    if (this.config.enableNotifications) {
      this.processOrderNotifications(userId, normalizedUpdate);
    }
    
    this.performanceStats.statusUpdatesProcessed++;
    this.performanceStats.avgUpdateLatency = this.updateAverage(
      this.performanceStats.avgUpdateLatency,
      Date.now() - startTime,
      this.performanceStats.statusUpdatesProcessed
    );
    
    this.emit('order_status_updated', { userId, order: normalizedUpdate });
  }
  
  /**
   * Normalize order update data
   */
  normalizeOrderUpdate(orderUpdate) {
    return {
      orderId: orderUpdate.orderId,
      symbol: orderUpdate.symbol,
      side: orderUpdate.side, // 'buy' or 'sell'
      type: orderUpdate.type, // 'market', 'limit', 'stop', etc.
      status: orderUpdate.status,
      quantity: orderUpdate.quantity?.toString() || '0',
      price: orderUpdate.price?.toString() || '0',
      filled: orderUpdate.filled?.toString() || '0',
      remaining: orderUpdate.remaining?.toString() || '0',
      averagePrice: orderUpdate.averagePrice?.toString() || '0',
      timestamp: orderUpdate.timestamp || Date.now(),
      lastUpdate: Date.now(),
      fees: orderUpdate.fees || {},
      fills: orderUpdate.fills || [],
      metadata: orderUpdate.metadata || {},
      previousStatus: orderUpdate.previousStatus || null
    };
  }
  
  /**
   * Update user order
   */
  updateUserOrder(userId, orderUpdate) {
    if (!this.userOrders.has(userId)) {
      this.userOrders.set(userId, new Map());
    }
    
    const userOrderMap = this.userOrders.get(userId);
    const existingOrder = userOrderMap.get(orderUpdate.orderId);
    
    if (existingOrder) {
      // Merge updates
      const updatedOrder = {
        ...existingOrder,
        ...orderUpdate,
        previousStatus: existingOrder.status
      };
      userOrderMap.set(orderUpdate.orderId, updatedOrder);
    } else {
      // New order
      userOrderMap.set(orderUpdate.orderId, orderUpdate);
      this.performanceStats.ordersTracked++;
    }
    
    // Remove completed orders after some time (keep for history)
    if (this.isTerminalStatus(orderUpdate.status)) {
      setTimeout(() => {
        if (userOrderMap.has(orderUpdate.orderId)) {
          userOrderMap.delete(orderUpdate.orderId);
        }
      }, 300000); // Remove after 5 minutes
    }
  }
  
  /**
   * Add to order history
   */
  addToOrderHistory(userId, orderUpdate) {
    if (!this.config.enableHistory) return;
    
    // Only add to history for significant status changes
    const significantStatuses = [
      this.orderStates.FILLED,
      this.orderStates.CANCELLED,
      this.orderStates.REJECTED,
      this.orderStates.EXPIRED
    ];
    
    if (!significantStatuses.includes(orderUpdate.status)) return;
    
    if (!this.orderHistory.has(userId)) {
      this.orderHistory.set(userId, []);
    }
    
    const history = this.orderHistory.get(userId);
    history.push({
      ...orderUpdate,
      historyTimestamp: Date.now()
    });
    
    // Maintain history size (keep last 1000 orders)
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }
  }
  
  /**
   * Queue status update for broadcast
   */
  queueStatusUpdate(userId, orderUpdate) {
    if (!this.orderStatusQueue.has(userId)) {
      this.orderStatusQueue.set(userId, []);
    }
    
    this.orderStatusQueue.get(userId).push(orderUpdate);
  }
  
  /**
   * Process order notifications
   */
  processOrderNotifications(userId, orderUpdate) {
    const notificationPrefs = this.orderNotifications.get(userId) || {};
    const notifications = [];
    
    // Determine notification type based on status change
    const notificationType = this.getNotificationTypeFromStatus(orderUpdate.status, orderUpdate.previousStatus);
    
    if (notificationType && this.shouldSendNotification(notificationType, notificationPrefs)) {
      notifications.push({
        type: notificationType,
        orderId: orderUpdate.orderId,
        symbol: orderUpdate.symbol,
        message: this.generateNotificationMessage(notificationType, orderUpdate),
        timestamp: Date.now(),
        priority: this.getNotificationPriority(notificationType),
        data: this.getNotificationData(orderUpdate, notificationPrefs.detailLevel || 'basic')
      });
    }
    
    // Check for price alerts
    if (orderUpdate.type === 'limit' && orderUpdate.status === this.orderStates.OPEN) {
      const priceAlert = this.checkPriceAlerts(userId, orderUpdate);
      if (priceAlert) {
        notifications.push(priceAlert);
      }
    }
    
    // Send notifications
    notifications.forEach(notification => {
      this.sendNotification(userId, notification);
    });
  }
  
  /**
   * Get notification type from status change
   */
  getNotificationTypeFromStatus(newStatus, previousStatus) {
    switch (newStatus) {
      case this.orderStates.OPEN:
        return previousStatus === this.orderStates.PENDING ? this.notificationTypes.ORDER_PLACED : null;
      case this.orderStates.PARTIAL:
        return this.notificationTypes.ORDER_PARTIAL;
      case this.orderStates.FILLED:
        return this.notificationTypes.ORDER_FILLED;
      case this.orderStates.CANCELLED:
        return this.notificationTypes.ORDER_CANCELLED;
      case this.orderStates.REJECTED:
        return this.notificationTypes.ORDER_REJECTED;
      case this.orderStates.EXPIRED:
        return this.notificationTypes.ORDER_EXPIRED;
      default:
        return null;
    }
  }
  
  /**
   * Check if notification should be sent
   */
  shouldSendNotification(notificationType, preferences) {
    const defaultSettings = {
      [this.notificationTypes.ORDER_PLACED]: true,
      [this.notificationTypes.ORDER_FILLED]: true,
      [this.notificationTypes.ORDER_PARTIAL]: true,
      [this.notificationTypes.ORDER_CANCELLED]: true,
      [this.notificationTypes.ORDER_REJECTED]: true,
      [this.notificationTypes.ORDER_EXPIRED]: true,
      [this.notificationTypes.BALANCE_INSUFFICIENT]: true,
      [this.notificationTypes.PRICE_ALERT]: true
    };
    
    return preferences[notificationType] !== false && defaultSettings[notificationType];
  }
  
  /**
   * Generate notification message
   */
  generateNotificationMessage(notificationType, orderUpdate) {
    const { symbol, side, quantity, price, filled } = orderUpdate;
    
    switch (notificationType) {
      case this.notificationTypes.ORDER_PLACED:
        return `${side.toUpperCase()} order for ${quantity} ${symbol} placed at ${price}`;
      case this.notificationTypes.ORDER_FILLED:
        return `${side.toUpperCase()} order for ${quantity} ${symbol} completely filled`;
      case this.notificationTypes.ORDER_PARTIAL:
        return `${side.toUpperCase()} order for ${symbol} partially filled (${filled}/${quantity})`;
      case this.notificationTypes.ORDER_CANCELLED:
        return `${side.toUpperCase()} order for ${quantity} ${symbol} cancelled`;
      case this.notificationTypes.ORDER_REJECTED:
        return `${side.toUpperCase()} order for ${quantity} ${symbol} rejected`;
      case this.notificationTypes.ORDER_EXPIRED:
        return `${side.toUpperCase()} order for ${quantity} ${symbol} expired`;
      default:
        return `Order status updated for ${symbol}`;
    }
  }
  
  /**
   * Get notification priority
   */
  getNotificationPriority(notificationType) {
    const priorities = {
      [this.notificationTypes.ORDER_FILLED]: 'high',
      [this.notificationTypes.ORDER_REJECTED]: 'high',
      [this.notificationTypes.BALANCE_INSUFFICIENT]: 'high',
      [this.notificationTypes.ORDER_PARTIAL]: 'medium',
      [this.notificationTypes.PRICE_ALERT]: 'medium',
      [this.notificationTypes.ORDER_PLACED]: 'low',
      [this.notificationTypes.ORDER_CANCELLED]: 'low',
      [this.notificationTypes.ORDER_EXPIRED]: 'low'
    };
    
    return priorities[notificationType] || 'low';
  }
  
  /**
   * Get notification data based on detail level
   */
  getNotificationData(orderUpdate, detailLevel) {
    const fields = this.orderDataFields[detailLevel] || this.orderDataFields.basic;
    const data = {};
    
    fields.forEach(field => {
      if (orderUpdate[field] !== undefined) {
        data[field] = orderUpdate[field];
      }
    });
    
    return data;
  }
  
  /**
   * Check price alerts
   */
  checkPriceAlerts(userId, orderUpdate) {
    // This would integrate with a price alert system
    // For now, return null as price alerts would be handled separately
    return null;
  }
  
  /**
   * Send notification
   */
  sendNotification(userId, notification) {
    const userConnections = this.userSubscriptions.get(userId);
    if (!userConnections || userConnections.size === 0) return;
    
    const message = {
      type: 'order_notification',
      data: notification
    };
    
    userConnections.forEach(connectionId => {
      this.webSocketManager.sendToConnection(connectionId, message);
    });
    
    this.performanceStats.notificationsSent++;
  }
  
  /**
   * Handle order subscription
   */
  handleOrderSubscription(event) {
    const { connectionId, params } = event;
    const { userId, detailLevel = 'private', includeHistory = false } = params;
    
    // Verify user can subscribe to their own orders
    const connection = this.webSocketManager.connections?.get(connectionId);
    if (!connection || connection.userId !== userId) {
      this.webSocketManager.sendToConnection(connectionId, {
        type: 'subscription_error',
        code: 'UNAUTHORIZED_USER_ORDERS',
        message: 'Can only subscribe to your own order updates'
      });
      return;
    }
    
    // Validate detail level
    if (!this.orderDataFields[detailLevel]) {
      this.webSocketManager.sendToConnection(connectionId, {
        type: 'subscription_error',
        code: 'INVALID_DETAIL_LEVEL',
        message: 'Invalid detail level specified'
      });
      return;
    }
    
    // Store subscription
    this.connectionSubscriptions.set(connectionId, {
      userId: userId,
      detailLevel: detailLevel,
      includeHistory: includeHistory,
      subscribedAt: Date.now(),
      lastUpdate: null
    });
    
    // Track user subscriptions
    if (!this.userSubscriptions.has(userId)) {
      this.userSubscriptions.set(userId, new Set());
    }
    this.userSubscriptions.get(userId).add(connectionId);
    
    this.performanceStats.subscriptionsActive++;
    
    // Send current orders
    this.sendCurrentOrders(connectionId, userId, detailLevel);
    
    // Send order history if requested
    if (includeHistory) {
      this.sendOrderHistory(connectionId, userId, detailLevel);
    }
    
    this.emit('order_subscription_added', { connectionId, userId });
  }
  
  /**
   * Send current orders
   */
  sendCurrentOrders(connectionId, userId, detailLevel) {
    const userOrderMap = this.userOrders.get(userId);
    if (!userOrderMap || userOrderMap.size === 0) {
      this.webSocketManager.sendToConnection(connectionId, {
        type: 'user_orders_snapshot',
        data: [],
        timestamp: Date.now()
      });
      return;
    }
    
    const orders = Array.from(userOrderMap.values()).map(order => 
      this.filterOrderData(order, detailLevel)
    );
    
    this.webSocketManager.sendToConnection(connectionId, {
      type: 'user_orders_snapshot',
      data: orders,
      timestamp: Date.now()
    });
  }
  
  /**
   * Send order history
   */
  sendOrderHistory(connectionId, userId, detailLevel) {
    if (!this.config.enableHistory) return;
    
    const history = this.orderHistory.get(userId) || [];
    const filteredHistory = history.map(order => 
      this.filterOrderData(order, detailLevel)
    );
    
    this.webSocketManager.sendToConnection(connectionId, {
      type: 'user_orders_history',
      data: filteredHistory,
      timestamp: Date.now()
    });
  }
  
  /**
   * Filter order data based on detail level
   */
  filterOrderData(order, detailLevel) {
    const allowedFields = this.orderDataFields[detailLevel] || this.orderDataFields.public;
    const filtered = {};
    
    allowedFields.forEach(field => {
      if (order[field] !== undefined) {
        filtered[field] = order[field];
      }
    });
    
    return filtered;
  }
  
  /**
   * Handle unsubscription
   */
  handleUnsubscription(event) {
    const { connectionId } = event;
    this.removeSubscription(connectionId);
  }
  
  /**
   * Remove subscription
   */
  removeSubscription(connectionId) {
    const subscription = this.connectionSubscriptions.get(connectionId);
    if (!subscription) return;
    
    this.connectionSubscriptions.delete(connectionId);
    
    // Remove from user subscriptions
    const userConnections = this.userSubscriptions.get(subscription.userId);
    if (userConnections) {
      userConnections.delete(connectionId);
      if (userConnections.size === 0) {
        this.userSubscriptions.delete(subscription.userId);
      }
    }
    
    this.performanceStats.subscriptionsActive--;
    
    this.emit('order_subscription_removed', { connectionId, userId: subscription.userId });
  }
  
  /**
   * Handle connection disconnection
   */
  handleDisconnection(event) {
    const { connectionId } = event;
    this.removeSubscription(connectionId);
  }
  
  /**
   * Start status processor
   */
  startStatusProcessor() {
    setInterval(() => {
      this.processPendingStatusUpdates();
    }, this.config.batchInterval);
  }
  
  /**
   * Process pending status updates
   */
  processPendingStatusUpdates() {
    for (const [userId, updates] of this.orderStatusQueue) {
      if (updates.length === 0) continue;
      
      const userConnections = this.userSubscriptions.get(userId);
      if (!userConnections || userConnections.size === 0) {
        // Clear updates if no subscribers
        this.orderStatusQueue.set(userId, []);
        continue;
      }
      
      // Create batches
      const batches = this.createUpdateBatches(updates);
      
      userConnections.forEach(connectionId => {
        const subscription = this.connectionSubscriptions.get(connectionId);
        if (!subscription) return;
        
        batches.forEach(batch => {
          this.sendOrderStatusBatch(connectionId, batch, subscription.detailLevel);
        });
      });
      
      // Clear processed updates
      this.orderStatusQueue.set(userId, []);
    }
  }
  
  /**
   * Create update batches
   */
  createUpdateBatches(updates) {
    const batches = [];
    
    for (let i = 0; i < updates.length; i += this.config.maxBatchSize) {
      batches.push(updates.slice(i, i + this.config.maxBatchSize));
    }
    
    return batches;
  }
  
  /**
   * Send order status batch
   */
  sendOrderStatusBatch(connectionId, batch, detailLevel) {
    const filteredUpdates = batch.map(update => 
      this.filterOrderData(update, detailLevel)
    );
    
    const message = {
      type: 'user_orders_update',
      data: filteredUpdates,
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(connectionId, message);
    
    this.performanceStats.statusUpdatesSent += filteredUpdates.length;
    this.performanceStats.batchesProcessed++;
  }
  
  /**
   * Set notification preferences
   */
  setNotificationPreferences(userId, preferences) {
    this.orderNotifications.set(userId, {
      ...this.orderNotifications.get(userId),
      ...preferences
    });
  }
  
  /**
   * Get user orders
   */
  getUserOrders(userId, detailLevel = 'private') {
    const userOrderMap = this.userOrders.get(userId);
    if (!userOrderMap) return [];
    
    return Array.from(userOrderMap.values()).map(order => 
      this.filterOrderData(order, detailLevel)
    );
  }
  
  /**
   * Get order by ID
   */
  getOrderById(userId, orderId, detailLevel = 'private') {
    const userOrderMap = this.userOrders.get(userId);
    if (!userOrderMap) return null;
    
    const order = userOrderMap.get(orderId);
    if (!order) return null;
    
    return this.filterOrderData(order, detailLevel);
  }
  
  /**
   * Check if status is terminal
   */
  isTerminalStatus(status) {
    return [
      this.orderStates.FILLED,
      this.orderStates.CANCELLED,
      this.orderStates.REJECTED,
      this.orderStates.EXPIRED
    ].includes(status);
  }
  
  /**
   * Start cleanup task
   */
  startCleanupTask() {
    setInterval(() => {
      this.cleanupOldData();
    }, 3600000); // Every hour
  }
  
  /**
   * Clean up old data
   */
  cleanupOldData() {
    const cutoff = Date.now() - this.config.historyRetention;
    
    // Clean order history
    for (const [userId, history] of this.orderHistory) {
      const filteredHistory = history.filter(order => 
        order.historyTimestamp > cutoff
      );
      this.orderHistory.set(userId, filteredHistory);
    }
    
    // Clean inactive user orders
    for (const [userId, userOrderMap] of this.userOrders) {
      const activeOrders = new Map();
      for (const [orderId, order] of userOrderMap) {
        if (!this.isTerminalStatus(order.status) || order.lastUpdate > cutoff) {
          activeOrders.set(orderId, order);
        }
      }
      this.userOrders.set(userId, activeOrders);
    }
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
    const totalOrders = Array.from(this.userOrders.values())
      .reduce((total, userOrderMap) => total + userOrderMap.size, 0);
    
    return {
      ...this.performanceStats,
      totalActiveOrders: totalOrders,
      usersWithOrders: this.userOrders.size,
      usersSubscribed: this.userSubscriptions.size,
      subscriptionsActive: this.connectionSubscriptions.size
    };
  }
  
  /**
   * Shutdown order status feed
   */
  shutdown() {
    this.userOrders.clear();
    this.orderHistory.clear();
    this.orderStatusQueue.clear();
    this.orderNotifications.clear();
    this.userSubscriptions.clear();
    this.connectionSubscriptions.clear();
    
    this.emit('shutdown');
  }
}

module.exports = UserOrderStatusFeed;