const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Secure User Order Status Updates Feed
 * Provides real-time order status updates with enhanced security and authorization
 */
class SecureUserOrderStatusFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate configuration
    this.validateConfig(config);
    
    this.config = {
      batchInterval: Math.max(config.batchInterval || 50, 10), // Min 10ms
      maxBatchSize: Math.min(config.maxBatchSize || 25, 100), // Max 100 updates
      enableHistory: config.enableHistory !== false,
      historyRetention: Math.min(config.historyRetention || 86400000, 7 * 86400000), // Max 7 days
      enableNotifications: config.enableNotifications !== false,
      maxOrdersPerUser: Math.min(config.maxOrdersPerUser || 10000, 100000),
      maxHistoryPerUser: Math.min(config.maxHistoryPerUser || 1000, 10000),
      maxUsersTracked: Math.min(config.maxUsersTracked || 10000, 100000),
      enableDataEncryption: config.enableDataEncryption !== false,
      encryptionKey: config.encryptionKey, // Required for secure operations
      enableAuditLogging: config.enableAuditLogging !== false,
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // Secure order tracking with bounded collections
    this.userOrders = new LRUCache(this.config.maxUsersTracked);
    this.orderHistory = new LRUCache(this.config.maxUsersTracked);
    this.orderStatusQueue = new LRUCache(this.config.maxUsersTracked);
    this.orderNotifications = new LRUCache(this.config.maxUsersTracked);
    
    // Subscription management with security controls
    this.userSubscriptions = new LRUCache(this.config.maxUsersTracked);
    this.connectionSubscriptions = new Map();
    this.userConnectionCounts = new Map(); // userId -> connection count
    
    // Security controls
    this.securityConfig = {
      maxProcessingTimeMs: 1000,
      maxConcurrentOperations: 50,
      enableStrictAuthorization: true,
      enableInputValidation: true,
      enableOutputSanitization: true,
      maxSubscriptionsPerUser: 10,
      maxConnectionsPerUser: 5,
      auditDataAccess: true,
      enableRateLimiting: true,
      maxUpdatesPerSecond: 1000,
      hashAlgorithm: 'sha256'
    };
    
    // Order state definitions
    this.orderStates = {
      PENDING: 'pending',
      OPEN: 'open',
      PARTIAL: 'partial',
      FILLED: 'filled',
      CANCELLED: 'cancelled',
      REJECTED: 'rejected',
      EXPIRED: 'expired'
    };
    
    // Notification types
    this.notificationTypes = {
      ORDER_PLACED: 'order_placed',
      ORDER_FILLED: 'order_filled',
      ORDER_PARTIAL: 'order_partial',
      ORDER_CANCELLED: 'order_cancelled',
      ORDER_REJECTED: 'order_rejected',
      ORDER_EXPIRED: 'order_expired',
      BALANCE_CHANGE: 'balance_change',
      RISK_ALERT: 'risk_alert'
    };
    
    // Performance and security tracking
    this.performanceStats = {
      ordersProcessed: 0,
      updatesProcessed: 0,
      updatesSent: 0,
      batchesSent: 0,
      subscriptionsActive: 0,
      avgProcessingTime: 0,
      securityViolations: 0,
      authorizationFailures: 0,
      dataAccessLogged: 0,
      encryptedDataProcessed: 0,
      suspiciousActivities: 0
    };
    
    // Input validation schemas
    this.validationSchemas = {
      orderUpdate: {
        orderId: { type: 'string', maxLength: 100, required: true },
        userId: { type: 'string', maxLength: 100, required: true },
        status: { type: 'string', enum: Object.values(this.orderStates), required: true },
        symbol: { type: 'string', pattern: /^[A-Z]{2,10}\/[A-Z]{2,10}$/, required: true },
        side: { type: 'string', enum: ['buy', 'sell'], required: true },
        type: { type: 'string', enum: ['market', 'limit', 'stop', 'stop_limit'], required: true },
        quantity: { type: 'number', min: 0, max: 1e12, required: true },
        price: { type: 'number', min: 0, max: 1e12 },
        filled: { type: 'number', min: 0, max: 1e12 },
        remaining: { type: 'number', min: 0, max: 1e12 },
        timestamp: { type: 'number', min: 0, required: true }
      },
      subscriptionParams: {
        userId: { type: 'string', maxLength: 100, required: true },
        includeHistory: { type: 'boolean' },
        notificationLevel: { type: 'string', enum: ['minimal', 'standard', 'detailed'] }
      }
    };
    
    // Active operations tracking
    this.activeOperations = new Set();
    this.accessLog = new LRUCache(10000); // Recent access logs
    
    // Rate limiting
    this.updateRateLimiter = {
      windowMs: 1000,
      maxUpdates: this.securityConfig.maxUpdatesPerSecond,
      currentWindow: Math.floor(Date.now() / 1000),
      currentCount: 0
    };
    
    this.startSecureOrderProcessor();
    this.startSecurityMonitoring();
    this.startCleanupTask();
  }
  
  /**
   * Validate configuration for security
   */
  validateConfig(config) {
    const requiredFields = ['encryptionKey'];
    const missingFields = requiredFields.filter(field => !config[field]);
    if (missingFields.length > 0) {
      throw new SecurityError(`Missing required configuration: ${missingFields.join(', ')}`);
    }
  }
  
  /**
   * Initialize with WebSocket manager
   */
  initialize(webSocketManager) {
    this.webSocketManager = webSocketManager;
    
    this.webSocketManager.on('subscribed', (event) => {
      try {
        if (event.channel === 'user_orders') {
          this.handleSecureUserOrderSubscription(event);
        }
      } catch (error) {
        this.handleSecurityViolation('subscription_error', error, event);
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
   * Secure order status update with comprehensive validation
   */
  updateOrderStatus(orderUpdate) {
    const operationId = crypto.randomBytes(8).toString('hex');
    
    try {
      // Rate limiting check
      if (!this.checkUpdateRateLimit()) {
        throw new SecurityError('Update rate limit exceeded');
      }
      
      // Check concurrent operations
      if (this.activeOperations.size >= this.securityConfig.maxConcurrentOperations) {
        throw new SecurityError('Maximum concurrent operations exceeded');
      }
      
      this.activeOperations.add(operationId);
      const startTime = Date.now();
      
      // Validate and sanitize order update
      const sanitizedUpdate = this.validateAndSanitizeOrderUpdate(orderUpdate);
      
      // Update order data securely
      this.secureUpdateOrder(sanitizedUpdate);
      
      // Add to history if enabled
      if (this.config.enableHistory) {
        this.secureAddToHistory(sanitizedUpdate);
      }
      
      // Queue for notification
      this.queueSecureOrderNotification(sanitizedUpdate);
      
      // Log data access for audit
      this.logOrderDataAccess(sanitizedUpdate.userId, 'order_update', sanitizedUpdate.orderId);
      
      this.performanceStats.ordersProcessed++;
      this.performanceStats.avgProcessingTime = this.updateAverage(
        this.performanceStats.avgProcessingTime,
        Date.now() - startTime,
        this.performanceStats.ordersProcessed
      );
      
      this.emit('order_status_updated', {
        orderId: sanitizedUpdate.orderId,
        userId: sanitizedUpdate.userId,
        status: sanitizedUpdate.status,
        timestamp: sanitizedUpdate.timestamp,
        operationId: operationId
      });
      
    } catch (error) {
      this.handleOrderUpdateError(error, orderUpdate, operationId);
      throw error;
    } finally {
      this.activeOperations.delete(operationId);
    }
  }
  
  /**
   * Validate and sanitize order update
   */
  validateAndSanitizeOrderUpdate(orderUpdate) {
    // Validate against schema
    for (const [field, schema] of Object.entries(this.validationSchemas.orderUpdate)) {
      if (!this.validateField(orderUpdate[field], schema)) {
        throw new SecurityError(`Invalid ${field} in order update`);
      }
    }
    
    // Sanitize and normalize
    const sanitized = {
      orderId: this.sanitizeString(orderUpdate.orderId),
      userId: this.sanitizeString(orderUpdate.userId),
      status: this.sanitizeString(orderUpdate.status).toLowerCase(),
      symbol: this.sanitizeString(orderUpdate.symbol).toUpperCase(),
      side: this.sanitizeString(orderUpdate.side).toLowerCase(),
      type: this.sanitizeString(orderUpdate.type).toLowerCase(),
      quantity: this.sanitizeNumber(orderUpdate.quantity),
      price: this.sanitizeNumber(orderUpdate.price || 0),
      filled: this.sanitizeNumber(orderUpdate.filled || 0),
      remaining: this.sanitizeNumber(orderUpdate.remaining || orderUpdate.quantity),
      timestamp: this.validateTimestamp(orderUpdate.timestamp),
      fees: this.sanitizeFees(orderUpdate.fees || {}),
      metadata: this.sanitizeMetadata(orderUpdate.metadata || {})
    };
    
    // Business rule validation
    this.validateOrderBusinessRules(sanitized);
    
    return sanitized;
  }
  
  /**
   * Validate field against schema
   */
  validateField(value, schema) {
    if (schema.required && (value === undefined || value === null)) {
      return false;
    }
    
    if (value === undefined || value === null) {
      return !schema.required;
    }
    
    if (schema.type && typeof value !== schema.type) {
      return false;
    }
    
    if (schema.maxLength && value.length > schema.maxLength) {
      return false;
    }
    
    if (schema.pattern && !schema.pattern.test(value)) {
      return false;
    }
    
    if (schema.enum && !schema.enum.includes(value)) {
      return false;
    }
    
    if (schema.min !== undefined && value < schema.min) {
      return false;
    }
    
    if (schema.max !== undefined && value > schema.max) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Sanitize string input
   */
  sanitizeString(str) {
    if (typeof str !== 'string') return '';
    
    return str
      .replace(/[<>\"'&]/g, '')
      .replace(/\${.*?}/g, '')
      .replace(/javascript:/gi, '')
      .replace(/(__proto__|constructor|prototype)/gi, '')
      .trim();
  }
  
  /**
   * Sanitize numeric input
   */
  sanitizeNumber(num) {
    if (typeof num === 'string') {
      num = parseFloat(num);
    }
    
    if (isNaN(num) || !isFinite(num) || num < 0) {
      return 0;
    }
    
    return Math.round(num * 1e8) / 1e8; // 8 decimal precision
  }
  
  /**
   * Validate timestamp
   */
  validateTimestamp(timestamp) {
    const ts = parseInt(timestamp);
    const now = Date.now();
    
    if (isNaN(ts) || ts < now - 86400000 || ts > now + 3600000) {
      return now;
    }
    
    return ts;
  }
  
  /**
   * Sanitize fees object
   */
  sanitizeFees(fees) {
    const sanitized = {};
    const allowedFields = ['commission', 'currency', 'type'];
    
    for (const field of allowedFields) {
      if (fees[field]) {
        if (field === 'commission') {
          sanitized[field] = this.sanitizeNumber(fees[field]);
        } else {
          sanitized[field] = this.sanitizeString(fees[field].toString());
        }
      }
    }
    
    return sanitized;
  }
  
  /**
   * Sanitize metadata object
   */
  sanitizeMetadata(metadata) {
    const sanitized = {};
    const maxFields = 5;
    let fieldCount = 0;
    
    for (const [key, value] of Object.entries(metadata)) {
      if (fieldCount >= maxFields) break;
      
      const cleanKey = this.sanitizeString(key);
      if (cleanKey.length > 0 && cleanKey.length <= 20) {
        if (typeof value === 'string') {
          sanitized[cleanKey] = this.sanitizeString(value);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[cleanKey] = value;
        }
        fieldCount++;
      }
    }
    
    return sanitized;
  }
  
  /**
   * Validate order business rules
   */
  validateOrderBusinessRules(orderUpdate) {
    // Validate quantities
    if (orderUpdate.filled > orderUpdate.quantity) {
      throw new SecurityError('Filled quantity cannot exceed total quantity');
    }
    
    if (orderUpdate.remaining > orderUpdate.quantity) {
      throw new SecurityError('Remaining quantity cannot exceed total quantity');
    }
    
    // Validate price bounds
    if (orderUpdate.price > 0 && (orderUpdate.price < 0.00000001 || orderUpdate.price > 1e9)) {
      throw new SecurityError('Price outside acceptable bounds');
    }
    
    // Validate status transitions
    this.validateStatusTransition(orderUpdate.orderId, orderUpdate.status);
  }
  
  /**
   * Validate status transition
   */
  validateStatusTransition(orderId, newStatus) {
    // This could include complex business logic for valid state transitions
    const validTransitions = {
      [this.orderStates.PENDING]: [this.orderStates.OPEN, this.orderStates.REJECTED],
      [this.orderStates.OPEN]: [this.orderStates.PARTIAL, this.orderStates.FILLED, this.orderStates.CANCELLED, this.orderStates.EXPIRED],
      [this.orderStates.PARTIAL]: [this.orderStates.FILLED, this.orderStates.CANCELLED],
      [this.orderStates.FILLED]: [], // Final state
      [this.orderStates.CANCELLED]: [], // Final state
      [this.orderStates.REJECTED]: [], // Final state
      [this.orderStates.EXPIRED]: [] // Final state
    };
    
    // For simplicity, we'll allow all transitions for now
    // In production, implement proper state machine validation
  }
  
  /**
   * Secure update order
   */
  secureUpdateOrder(orderUpdate) {
    const userId = orderUpdate.userId;
    const orderId = orderUpdate.orderId;
    
    // Get or create user orders map
    let userOrdersMap = this.userOrders.get(userId);
    if (!userOrdersMap) {
      userOrdersMap = new Map();
      this.userOrders.set(userId, userOrdersMap);
    }
    
    // Check order limits per user
    if (!userOrdersMap.has(orderId) && userOrdersMap.size >= this.config.maxOrdersPerUser) {
      throw new SecurityError('Maximum orders per user exceeded');
    }
    
    // Encrypt sensitive data if enabled
    const orderData = this.config.enableDataEncryption ? 
      this.encryptOrderData(orderUpdate) : orderUpdate;
    
    // Store order data
    userOrdersMap.set(orderId, {
      ...orderData,
      lastUpdated: Date.now(),
      updateCount: (userOrdersMap.get(orderId)?.updateCount || 0) + 1
    });
    
    this.performanceStats.encryptedDataProcessed++;
  }
  
  /**
   * Encrypt order data
   */
  encryptOrderData(orderData) {
    const sensitiveFields = ['quantity', 'price', 'filled'];
    const encrypted = { ...orderData };
    
    for (const field of sensitiveFields) {
      if (orderData[field] !== undefined) {
        encrypted[field] = this.encryptValue(orderData[field].toString());
      }
    }
    
    return encrypted;
  }
  
  /**
   * Encrypt value using HMAC
   */
  encryptValue(value) {
    return crypto.createHmac('sha256', this.config.encryptionKey)
      .update(value)
      .digest('hex');
  }
  
  /**
   * Secure add to history
   */
  secureAddToHistory(orderUpdate) {
    const userId = orderUpdate.userId;
    
    let userHistory = this.orderHistory.get(userId);
    if (!userHistory) {
      userHistory = [];
      this.orderHistory.set(userId, userHistory);
    }
    
    // Add to history with timestamp
    userHistory.push({
      ...orderUpdate,
      historyTimestamp: Date.now()
    });
    
    // Maintain bounded size
    if (userHistory.length > this.config.maxHistoryPerUser) {
      const removeCount = Math.floor(this.config.maxHistoryPerUser * 0.1);
      userHistory.splice(0, removeCount);
    }
  }
  
  /**
   * Handle secure user order subscription
   */
  handleSecureUserOrderSubscription(event) {
    const { connectionId, params } = event;
    
    // Get connection for authorization
    const connection = this.webSocketManager.connections?.get(connectionId);
    if (!connection || !connection.authenticated) {
      throw new SecurityError('Unauthenticated connection');
    }
    
    // Validate subscription parameters
    this.validateSubscriptionParams(params);
    
    const { userId, includeHistory = false, notificationLevel = 'standard' } = params;
    
    // Strict authorization: users can only subscribe to their own orders
    if (connection.userId !== userId) {
      // Admin override check
      const isAdmin = connection.metadata?.roles?.includes('admin') || 
                     connection.metadata?.permissions?.includes('read_all_orders');
      
      if (!isAdmin) {
        this.performanceStats.authorizationFailures++;
        this.logSecurityViolation('unauthorized_order_access', connection.userId, {
          requestedUserId: userId
        });
        throw new SecurityError('Can only subscribe to your own orders');
      }
    }
    
    // Check subscription limits
    this.checkUserSubscriptionLimits(connection.userId);
    
    // Validate user ID
    const sanitizedUserId = this.sanitizeString(userId);
    
    // Store subscription with security metadata
    this.connectionSubscriptions.set(connectionId, {
      userId: connection.userId,
      targetUserId: sanitizedUserId,
      includeHistory: Boolean(includeHistory),
      notificationLevel: notificationLevel,
      subscribedAt: Date.now(),
      accessCount: 0,
      permissions: connection.metadata?.permissions || [],
      roles: connection.metadata?.roles || []
    });
    
    // Track user subscriptions
    this.addUserSubscription(sanitizedUserId, connectionId);
    
    // Update connection count
    const currentCount = this.userConnectionCounts.get(connection.userId) || 0;
    this.userConnectionCounts.set(connection.userId, currentCount + 1);
    
    this.performanceStats.subscriptionsActive++;
    
    // Log subscription for audit
    this.logSubscriptionEvent(connection.userId, sanitizedUserId, notificationLevel);
    
    // Send current orders
    this.sendSecureCurrentOrders(connectionId, sanitizedUserId, includeHistory);
    
    this.emit('user_order_subscription_added', {
      connectionId,
      userId: sanitizedUserId,
      subscriberId: connection.userId
    });
  }
  
  /**
   * Check user subscription limits
   */
  checkUserSubscriptionLimits(userId) {
    const currentCount = this.userConnectionCounts.get(userId) || 0;
    if (currentCount >= this.securityConfig.maxConnectionsPerUser) {
      throw new SecurityError('Maximum connections per user exceeded');
    }
  }
  
  /**
   * Validate subscription parameters
   */
  validateSubscriptionParams(params) {
    for (const [field, schema] of Object.entries(this.validationSchemas.subscriptionParams)) {
      if (!this.validateField(params[field], schema)) {
        throw new SecurityError(`Invalid ${field} in subscription parameters`);
      }
    }
  }
  
  /**
   * Add user subscription
   */
  addUserSubscription(userId, connectionId) {
    let userSubs = this.userSubscriptions.get(userId);
    if (!userSubs) {
      userSubs = new Set();
      this.userSubscriptions.set(userId, userSubs);
    }
    
    userSubs.add(connectionId);
  }
  
  /**
   * Send secure current orders
   */
  sendSecureCurrentOrders(connectionId, userId, includeHistory) {
    try {
      const subscription = this.connectionSubscriptions.get(connectionId);
      if (!subscription) return;
      
      // Get current orders
      const userOrders = this.userOrders.get(userId);
      const currentOrders = userOrders ? Array.from(userOrders.values()) : [];
      
      // Decrypt and sanitize orders for transmission
      const sanitizedOrders = currentOrders.map(order => 
        this.sanitizeOrderForTransmission(order, subscription)
      );
      
      const message = {
        type: 'user_orders_snapshot',
        data: {
          orders: sanitizedOrders,
          count: sanitizedOrders.length
        },
        timestamp: Date.now()
      };
      
      // Add history if requested and authorized
      if (includeHistory && this.hasHistoryPermission(subscription)) {
        const userHistory = this.orderHistory.get(userId) || [];
        const sanitizedHistory = userHistory.slice(-100).map(order => 
          this.sanitizeOrderForTransmission(order, subscription)
        );
        message.data.history = sanitizedHistory;
      }
      
      this.webSocketManager.sendToConnection(connectionId, message);
      
      subscription.accessCount++;
      this.logOrderDataAccess(subscription.userId, 'orders_snapshot', userId);
      
    } catch (error) {
      this.handleSecurityViolation('send_orders_error', error, { connectionId, userId });
    }
  }
  
  /**
   * Check history permission
   */
  hasHistoryPermission(subscription) {
    return subscription.permissions?.includes('read_order_history') ||
           subscription.roles?.includes('admin') ||
           subscription.userId === subscription.targetUserId;
  }
  
  /**
   * Sanitize order for transmission
   */
  sanitizeOrderForTransmission(order, subscription) {
    const sanitized = {
      orderId: order.orderId,
      status: order.status,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      timestamp: order.timestamp,
      lastUpdated: order.lastUpdated
    };
    
    // Include detailed data based on authorization level
    if (this.hasDetailedDataPermission(subscription)) {
      // Decrypt if necessary
      sanitized.quantity = this.config.enableDataEncryption ? 
        this.decryptValue(order.quantity) : order.quantity;
      sanitized.price = this.config.enableDataEncryption ? 
        this.decryptValue(order.price) : order.price;
      sanitized.filled = this.config.enableDataEncryption ? 
        this.decryptValue(order.filled) : order.filled;
      sanitized.remaining = order.remaining;
      sanitized.fees = order.fees;
    }
    
    // Include metadata based on permission level
    if (this.hasMetadataPermission(subscription)) {
      sanitized.metadata = this.filterSensitiveMetadata(order.metadata || {});
    }
    
    return sanitized;
  }
  
  /**
   * Check detailed data permission
   */
  hasDetailedDataPermission(subscription) {
    return subscription.userId === subscription.targetUserId ||
           subscription.roles?.includes('admin') ||
           subscription.permissions?.includes('read_detailed_orders');
  }
  
  /**
   * Check metadata permission
   */
  hasMetadataPermission(subscription) {
    return subscription.permissions?.includes('read_order_metadata') ||
           subscription.roles?.includes('admin');
  }
  
  /**
   * Decrypt value
   */
  decryptValue(encryptedValue) {
    // For HMAC, we can't actually decrypt, so this would need proper encryption
    // For now, return the encrypted value as-is
    return encryptedValue;
  }
  
  /**
   * Filter sensitive metadata
   */
  filterSensitiveMetadata(metadata) {
    const filtered = {};
    const allowedFields = ['source', 'timeInForce', 'orderType'];
    
    for (const field of allowedFields) {
      if (metadata[field]) {
        filtered[field] = metadata[field];
      }
    }
    
    return filtered;
  }
  
  /**
   * Queue secure order notification
   */
  queueSecureOrderNotification(orderUpdate) {
    const userId = orderUpdate.userId;
    
    let statusQueue = this.orderStatusQueue.get(userId);
    if (!statusQueue) {
      statusQueue = [];
      this.orderStatusQueue.set(userId, statusQueue);
    }
    
    // Add to queue with bounds checking
    statusQueue.push({
      ...orderUpdate,
      queuedAt: Date.now()
    });
    
    // Maintain bounded size
    if (statusQueue.length > this.config.maxBatchSize * 10) {
      statusQueue.shift(); // Remove oldest
    }
  }
  
  /**
   * Check update rate limit
   */
  checkUpdateRateLimit() {
    const now = Math.floor(Date.now() / 1000);
    
    if (now > this.updateRateLimiter.currentWindow) {
      this.updateRateLimiter.currentWindow = now;
      this.updateRateLimiter.currentCount = 0;
    }
    
    this.updateRateLimiter.currentCount++;
    return this.updateRateLimiter.currentCount <= this.updateRateLimiter.maxUpdates;
  }
  
  /**
   * Log subscription event
   */
  logSubscriptionEvent(subscriberId, targetUserId, notificationLevel) {
    if (!this.config.enableAuditLogging) return;
    
    const logEntry = {
      timestamp: Date.now(),
      event: 'user_order_subscription',
      subscriberId: subscriberId,
      targetUserId: targetUserId,
      notificationLevel: notificationLevel,
      authorized: subscriberId === targetUserId
    };
    
    this.accessLog.set(crypto.randomBytes(8).toString('hex'), logEntry);
    this.performanceStats.dataAccessLogged++;
  }
  
  /**
   * Log order data access
   */
  logOrderDataAccess(accessorUserId, operation, targetUserId) {
    if (!this.config.enableAuditLogging) return;
    
    const logEntry = {
      timestamp: Date.now(),
      event: 'order_data_access',
      accessorUserId: accessorUserId,
      operation: operation,
      targetUserId: targetUserId
    };
    
    this.accessLog.set(crypto.randomBytes(8).toString('hex'), logEntry);
    this.performanceStats.dataAccessLogged++;
  }
  
  /**
   * Log security violation
   */
  logSecurityViolation(type, userId, details) {
    this.performanceStats.securityViolations++;
    
    const violation = {
      timestamp: Date.now(),
      type: type,
      userId: userId,
      details: details
    };
    
    this.accessLog.set(crypto.randomBytes(8).toString('hex'), violation);
    this.emit('security_violation', violation);
  }
  
  /**
   * Handle security violations
   */
  handleSecurityViolation(type, error, context) {
    this.performanceStats.securityViolations++;
    
    this.emit('security_violation', {
      type: type,
      error: error.message,
      context: context,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle order update errors
   */
  handleOrderUpdateError(error, orderUpdate, operationId) {
    this.performanceStats.securityViolations++;
    
    this.emit('order_update_error', {
      error: error.message,
      orderUpdate: this.sanitizeErrorContext(orderUpdate),
      operationId: operationId,
      timestamp: Date.now()
    });
  }
  
  /**
   * Sanitize error context
   */
  sanitizeErrorContext(context) {
    if (!context) return {};
    
    return {
      orderId: context.orderId || 'unknown',
      userId: context.userId || 'unknown',
      status: context.status || 'unknown',
      timestamp: context.timestamp || Date.now()
    };
  }
  
  /**
   * Start secure order processor
   */
  startSecureOrderProcessor() {
    setInterval(() => {
      try {
        this.processSecureOrderUpdates();
      } catch (error) {
        this.handleSecurityViolation('order_processor_error', error);
      }
    }, this.config.batchInterval);
  }
  
  /**
   * Process secure order updates
   */
  processSecureOrderUpdates() {
    for (const [userId, statusQueue] of this.orderStatusQueue.cache) {
      if (!statusQueue || statusQueue.length === 0) continue;
      
      const userSubscribers = this.userSubscriptions.get(userId);
      if (!userSubscribers || userSubscribers.size === 0) {
        // Clear queue if no subscribers
        this.orderStatusQueue.set(userId, []);
        continue;
      }
      
      // Create batches
      const batchSize = Math.min(statusQueue.length, this.config.maxBatchSize);
      const batch = statusQueue.splice(0, batchSize);
      
      // Send to each subscriber
      for (const connectionId of userSubscribers) {
        this.sendSecureOrderUpdateBatch(connectionId, batch);
      }
      
      this.performanceStats.batchesSent++;
    }
  }
  
  /**
   * Send secure order update batch
   */
  sendSecureOrderUpdateBatch(connectionId, batch) {
    try {
      const subscription = this.connectionSubscriptions.get(connectionId);
      if (!subscription) return;
      
      const sanitizedUpdates = batch.map(update => 
        this.sanitizeOrderForTransmission(update, subscription)
      );
      
      const message = {
        type: 'user_orders_update',
        data: {
          updates: sanitizedUpdates,
          count: sanitizedUpdates.length
        },
        timestamp: Date.now()
      };
      
      this.webSocketManager.sendToConnection(connectionId, message);
      
      subscription.accessCount++;
      this.performanceStats.updatesSent += sanitizedUpdates.length;
      
    } catch (error) {
      this.handleSecurityViolation('batch_send_error', error, { connectionId });
    }
  }
  
  /**
   * Start security monitoring
   */
  startSecurityMonitoring() {
    setInterval(() => {
      this.performSecurityChecks();
    }, 60000); // Every minute
  }
  
  /**
   * Perform security checks
   */
  performSecurityChecks() {
    // Clean up stale subscriptions
    this.cleanupStaleSubscriptions();
    
    // Monitor resource usage
    this.monitorResourceUsage();
    
    // Clean up old logs
    this.cleanupSecurityLogs();
  }
  
  /**
   * Clean up stale subscriptions
   */
  cleanupStaleSubscriptions() {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [connectionId, subscription] of this.connectionSubscriptions) {
      if ((now - subscription.subscribedAt) > staleThreshold && subscription.accessCount === 0) {
        this.removeSubscription(connectionId);
      }
    }
  }
  
  /**
   * Monitor resource usage
   */
  monitorResourceUsage() {
    const used = process.memoryUsage();
    const usedMB = used.heapUsed / 1024 / 1024;
    
    if (usedMB > 500) {
      this.emit('high_memory_usage', { usedMB });
    }
  }
  
  /**
   * Clean up security logs
   */
  cleanupSecurityLogs() {
    const now = Date.now();
    const retentionPeriod = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    for (const [key, logEntry] of this.accessLog.cache) {
      if ((now - logEntry.timestamp) > retentionPeriod) {
        this.accessLog.delete(key);
      }
    }
  }
  
  /**
   * Remove subscription
   */
  removeSubscription(connectionId) {
    const subscription = this.connectionSubscriptions.get(connectionId);
    if (!subscription) return;
    
    this.connectionSubscriptions.delete(connectionId);
    
    // Remove from user subscriptions
    const userSubs = this.userSubscriptions.get(subscription.targetUserId);
    if (userSubs) {
      userSubs.delete(connectionId);
      if (userSubs.size === 0) {
        this.userSubscriptions.delete(subscription.targetUserId);
      }
    }
    
    // Update connection count
    const currentCount = this.userConnectionCounts.get(subscription.userId) || 0;
    this.userConnectionCounts.set(subscription.userId, Math.max(0, currentCount - 1));
    
    this.performanceStats.subscriptionsActive--;
  }
  
  /**
   * Handle unsubscription
   */
  handleUnsubscription(event) {
    const { connectionId } = event;
    this.removeSubscription(connectionId);
  }
  
  /**
   * Handle disconnection
   */
  handleDisconnection(event) {
    const { connectionId } = event;
    this.removeSubscription(connectionId);
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
    for (const [userId, history] of this.orderHistory.cache) {
      if (history) {
        const filteredHistory = history.filter(order => order.timestamp > cutoff);
        this.orderHistory.set(userId, filteredHistory);
      }
    }
    
    // Clean completed orders older than retention period
    for (const [userId, ordersMap] of this.userOrders.cache) {
      if (ordersMap) {
        const finalStates = [this.orderStates.FILLED, this.orderStates.CANCELLED, this.orderStates.REJECTED, this.orderStates.EXPIRED];
        
        for (const [orderId, order] of ordersMap) {
          if (finalStates.includes(order.status) && order.lastUpdated < cutoff) {
            ordersMap.delete(orderId);
          }
        }
      }
    }
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Get comprehensive stats
   */
  getStats() {
    return {
      ...this.performanceStats,
      subscriptionsActive: this.connectionSubscriptions.size,
      usersTracked: this.userOrders.size,
      activeOperations: this.activeOperations.size,
      accessLogEntries: this.accessLog.size
    };
  }
  
  /**
   * Shutdown with secure cleanup
   */
  shutdown() {
    // Clear all sensitive data
    this.userOrders.clear();
    this.orderHistory.clear();
    this.orderStatusQueue.clear();
    this.orderNotifications.clear();
    this.userSubscriptions.clear();
    this.connectionSubscriptions.clear();
    this.userConnectionCounts.clear();
    this.accessLog.clear();
    this.activeOperations.clear();
    
    this.emit('shutdown');
  }
}

/**
 * LRU Cache implementation
 */
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  
  get(key) {
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return undefined;
  }
  
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  delete(key) {
    return this.cache.delete(key);
  }
  
  has(key) {
    return this.cache.has(key);
  }
  
  get size() {
    return this.cache.size;
  }
  
  clear() {
    this.cache.clear();
  }
}

/**
 * Security Error class
 */
class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecurityError';
  }
}

module.exports = SecureUserOrderStatusFeed;