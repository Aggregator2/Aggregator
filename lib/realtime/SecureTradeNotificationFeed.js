const EventEmitter = require('events');
const crypto = require('crypto');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Secure Trade Execution Notification Feed
 * Addresses critical authorization vulnerabilities with enhanced permission checks
 */
class SecureTradeNotificationFeed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate configuration
    this.validateConfig(config);
    
    this.config = {
      batchInterval: Math.max(config.batchInterval || 100, 10), // Min 10ms
      maxBatchSize: Math.min(config.maxBatchSize || 50, 1000), // Max 1000 trades
      enableFiltering: config.enableFiltering !== false,
      enableAggregation: config.enableAggregation !== false,
      retentionPeriod: Math.min(config.retentionPeriod || 3600000, 86400000), // Max 24 hours
      maxTradesPerSymbol: Math.min(config.maxTradesPerSymbol || 10000, 100000),
      maxSubscriptionsPerUser: Math.min(config.maxSubscriptionsPerUser || 100, 1000),
      maxSymbolsTracked: Math.min(config.maxSymbolsTracked || 1000, 10000),
      enablePIIProtection: config.enablePIIProtection !== false,
      encryptionKey: config.encryptionKey, // Required for secure operations
      auditLogging: config.auditLogging !== false,
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.webSocketManager = null;
    
    // Secure data management with bounded collections
    this.recentTrades = new LRUCache(this.config.maxSymbolsTracked);
    this.tradeBuffer = new LRUCache(this.config.maxSymbolsTracked);
    this.aggregatedTrades = new LRUCache(this.config.maxSymbolsTracked);
    
    // Subscription management with security controls
    this.subscriptions = new Map();
    this.symbolSubscribers = new LRUCache(this.config.maxSymbolsTracked);
    this.userTradeSubscribers = new LRUCache(10000); // Max users
    
    // Enhanced security controls
    this.securityConfig = {
      maxProcessingTimeMs: 1000,
      maxConcurrentOperations: 100,
      enableRateLimiting: true,
      maxTradesPerSecond: 10000,
      suspiciousActivityThreshold: 1000,
      enableAccessLogging: true,
      maxFilterCriteria: 20,
      maxUserDataRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
      enableIntegrityChecks: true,
      hashAlgorithm: 'sha256'
    };
    
    // Privacy and authorization levels
    this.privacyLevels = {
      PUBLIC: 'public',       // All trades visible (anonymized)
      AGGREGATED: 'aggregated', // Only aggregated data
      PRIVATE: 'private',     // User's own trades only
      ADMIN: 'admin'          // Full data (admin only)
    };
    
    // Permission matrix for authorization
    this.permissionMatrix = {
      [this.privacyLevels.PUBLIC]: ['read_market_data'],
      [this.privacyLevels.AGGREGATED]: ['read_market_data'],
      [this.privacyLevels.PRIVATE]: ['read_own_trades'],
      [this.privacyLevels.ADMIN]: ['admin', 'read_all_trades']
    };
    
    // Performance and security tracking
    this.performanceStats = {
      tradesProcessed: 0,
      tradesSent: 0,
      batchesSent: 0,
      aggregationsCreated: 0,
      subscriptionsActive: 0,
      avgProcessingTime: 0,
      bytesTransferred: 0,
      securityViolations: 0,
      authorizationFailures: 0,
      dataLeakagePrevented: 0,
      auditEventsLogged: 0,
      suspiciousActivities: 0
    };
    
    // Access control and audit logging
    this.accessLog = new LRUCache(100000); // Recent access logs
    this.suspiciousActivities = new Map();
    this.userActivityTracking = new Map(); // userId -> activity stats
    
    // Trade filtering and aggregation with security
    this.secureFilterCriteria = new Map();
    this.aggregationIntervals = new Map();
    this.activeOperations = new Set(); // Track concurrent operations
    
    // Input validation schemas
    this.validationSchemas = {
      tradeData: {
        id: { type: 'string', maxLength: 100, required: true },
        symbol: { type: 'string', pattern: /^[A-Z]{2,10}\/[A-Z]{2,10}$/, required: true },
        price: { type: 'string', pattern: /^\d+\.?\d*$/, maxLength: 20, required: true },
        size: { type: 'string', pattern: /^\d+\.?\d*$/, maxLength: 20, required: true },
        side: { type: 'string', enum: ['buy', 'sell'], required: true },
        timestamp: { type: 'number', min: 0, required: true },
        makerUserId: { type: 'string', maxLength: 100 },
        takerUserId: { type: 'string', maxLength: 100 }
      },
      subscriptionParams: {
        symbol: { type: 'string', pattern: /^[A-Z]{2,10}\/[A-Z]{2,10}$/, maxLength: 20 },
        privacyLevel: { type: 'string', enum: Object.values(this.privacyLevels) },
        userId: { type: 'string', maxLength: 100 }
      }
    };
    
    this.startSecureTradeProcessor();
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
    
    // Listen for subscription events with security validation
    this.webSocketManager.on('subscribed', (event) => {
      try {
        if (event.channel === 'trades') {
          this.handleSecureTradeSubscription(event);
        } else if (event.channel === 'user_trades') {
          this.handleSecureUserTradeSubscription(event);
        }
      } catch (error) {
        this.handleSecurityViolation('subscription_error', error, event);
      }
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      this.handleUnsubscription(event);
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
  }
  
  /**
   * Process new trade execution with security validation
   */
  processTrade(tradeData) {
    const operationId = crypto.randomBytes(8).toString('hex');
    
    try {
      // Check concurrent operation limits
      if (this.activeOperations.size >= this.securityConfig.maxConcurrentOperations) {
        throw new SecurityError('Maximum concurrent operations exceeded');
      }
      
      this.activeOperations.add(operationId);
      const startTime = Date.now();
      
      // Validate and sanitize trade data
      const sanitizedTrade = this.validateAndSanitizeTrade(tradeData);
      
      // Store in recent trades with bounds checking
      this.storeRecentTradeSecurely(sanitizedTrade);
      
      // Buffer for broadcast with security checks
      this.bufferTradeForSecureBroadcast(sanitizedTrade);
      
      // Update aggregations safely
      if (this.config.enableAggregation) {
        this.updateAggregationsSecurely(sanitizedTrade);
      }
      
      // Process user notifications with authorization
      this.processSecureUserTradeNotifications(sanitizedTrade);
      
      // Log trade processing for audit
      this.logTradeProcessing(sanitizedTrade, operationId);
      
      this.performanceStats.tradesProcessed++;
      this.performanceStats.avgProcessingTime = this.updateAverage(
        this.performanceStats.avgProcessingTime,
        Date.now() - startTime,
        this.performanceStats.tradesProcessed
      );
      
      this.emit('trade_processed', { id: sanitizedTrade.id, timestamp: Date.now() });
      
    } catch (error) {
      this.handleTradeProcessingError(error, tradeData, operationId);
      throw error;
    } finally {
      this.activeOperations.delete(operationId);
    }
  }
  
  /**
   * Validate and sanitize trade data
   */
  validateAndSanitizeTrade(tradeData) {
    // Validate against schema
    for (const [field, schema] of Object.entries(this.validationSchemas.tradeData)) {
      if (!this.validateField(tradeData[field], schema)) {
        throw new SecurityError(`Invalid ${field} in trade data`);
      }
    }
    
    // Sanitize and normalize
    const sanitized = {
      id: this.sanitizeString(tradeData.id),
      symbol: this.sanitizeString(tradeData.symbol).toUpperCase(),
      price: this.sanitizeNumericString(tradeData.price),
      size: this.sanitizeNumericString(tradeData.size),
      side: this.sanitizeString(tradeData.side).toLowerCase(),
      timestamp: this.validateTimestamp(tradeData.timestamp),
      makerUserId: tradeData.makerUserId ? this.sanitizeUserId(tradeData.makerUserId) : null,
      takerUserId: tradeData.takerUserId ? this.sanitizeUserId(tradeData.takerUserId) : null,
      value: this.calculateSecureValue(tradeData.price, tradeData.size),
      fees: this.sanitizeFees(tradeData.fees || {}),
      metadata: this.sanitizeMetadata(tradeData.metadata || {})
    };
    
    // Additional security validations
    this.validateTradeBusinessRules(sanitized);
    
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
    
    return true;
  }
  
  /**
   * Sanitize string input
   */
  sanitizeString(str) {
    if (typeof str !== 'string') return '';
    
    // Remove dangerous characters and patterns
    return str
      .replace(/[<>\"'&]/g, '') // Remove HTML/script chars
      .replace(/\${.*?}/g, '') // Remove template literals
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .trim();
  }
  
  /**
   * Sanitize numeric string
   */
  sanitizeNumericString(str) {
    if (typeof str !== 'string') return '0';
    
    const cleaned = str.replace(/[^\d.]/g, '');
    const number = parseFloat(cleaned);
    
    if (isNaN(number) || number < 0 || number > 1e12) {
      throw new SecurityError('Invalid numeric value');
    }
    
    return number.toString();
  }
  
  /**
   * Sanitize user ID
   */
  sanitizeUserId(userId) {
    const sanitized = this.sanitizeString(userId);
    
    if (sanitized.length === 0 || sanitized.length > 100) {
      throw new SecurityError('Invalid user ID format');
    }
    
    // Check for dangerous patterns
    if (/(__proto__|constructor|prototype)/i.test(sanitized)) {
      throw new SecurityError('User ID contains dangerous patterns');
    }
    
    return sanitized;
  }
  
  /**
   * Validate timestamp
   */
  validateTimestamp(timestamp) {
    const ts = parseInt(timestamp);
    const now = Date.now();
    
    // Allow timestamps within reasonable range
    if (isNaN(ts) || ts < now - 86400000 || ts > now + 3600000) {
      return now; // Use current time for invalid timestamps
    }
    
    return ts;
  }
  
  /**
   * Calculate secure value
   */
  calculateSecureValue(price, size) {
    const priceNum = parseFloat(price);
    const sizeNum = parseFloat(size);
    
    if (isNaN(priceNum) || isNaN(sizeNum)) {
      return '0';
    }
    
    const value = priceNum * sizeNum;
    return Math.round(value * 1e8) / 1e8; // Round to 8 decimal places
  }
  
  /**
   * Sanitize fees object
   */
  sanitizeFees(fees) {
    const sanitized = {};
    const allowedFields = ['maker', 'taker', 'currency'];
    
    for (const field of allowedFields) {
      if (fees[field]) {
        sanitized[field] = this.sanitizeNumericString(fees[field].toString());
      }
    }
    
    return sanitized;
  }
  
  /**
   * Sanitize metadata object
   */
  sanitizeMetadata(metadata) {
    const sanitized = {};
    const maxFields = 10;
    let fieldCount = 0;
    
    for (const [key, value] of Object.entries(metadata)) {
      if (fieldCount >= maxFields) break;
      
      const cleanKey = this.sanitizeString(key);
      if (cleanKey.length > 0 && cleanKey.length <= 50) {
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
   * Validate trade business rules
   */
  validateTradeBusinessRules(trade) {
    const price = parseFloat(trade.price);
    const size = parseFloat(trade.size);
    
    // Price bounds check
    if (price <= 0 || price > 1e9) {
      throw new SecurityError('Price outside acceptable bounds');
    }
    
    // Size bounds check
    if (size <= 0 || size > 1e9) {
      throw new SecurityError('Size outside acceptable bounds');
    }
    
    // Value bounds check
    if (price * size > 1e12) {
      throw new SecurityError('Trade value exceeds maximum limit');
    }
  }
  
  /**
   * Store recent trade securely
   */
  storeRecentTradeSecurely(trade) {
    const symbol = trade.symbol;
    
    let trades = this.recentTrades.get(symbol);
    if (!trades) {
      trades = [];
      this.recentTrades.set(symbol, trades);
    }
    
    // Check size limits to prevent memory exhaustion
    if (trades.length >= this.config.maxTradesPerSymbol) {
      // Remove oldest trades (FIFO)
      const removeCount = Math.floor(this.config.maxTradesPerSymbol * 0.1);
      trades.splice(0, removeCount);
    }
    
    trades.push(trade);
  }
  
  /**
   * Handle secure trade subscription with enhanced authorization
   */
  handleSecureTradeSubscription(event) {
    const { connectionId, params } = event;
    
    // Get connection details for authorization
    const connection = this.webSocketManager.connections?.get(connectionId);
    if (!connection || !connection.authenticated) {
      throw new SecurityError('Unauthenticated connection');
    }
    
    // Validate subscription parameters
    this.validateSubscriptionParams(params);
    
    const { 
      symbol, 
      privacyLevel = this.privacyLevels.PUBLIC,
      filter = {},
      aggregated = false 
    } = params;
    
    // Validate privacy level and authorization
    this.validatePrivacyLevelAuthorization(connection, privacyLevel);
    
    // Check subscription limits
    this.checkSubscriptionLimits(connection.userId);
    
    // Generate secure subscription key
    const subscriptionKey = this.generateSecureSubscriptionKey(
      connectionId, symbol, privacyLevel, aggregated
    );
    
    // Validate and sanitize filter criteria
    const sanitizedFilter = this.validateAndSanitizeFilter(filter);
    
    // Store subscription with security metadata
    this.subscriptions.set(subscriptionKey, {
      connectionId: connectionId,
      userId: connection.userId,
      channel: 'trades',
      symbol: symbol,
      privacyLevel: privacyLevel,
      filter: sanitizedFilter,
      aggregated: aggregated,
      subscribedAt: Date.now(),
      permissions: connection.metadata?.permissions || [],
      roles: connection.metadata?.roles || [],
      lastUpdate: null,
      accessCount: 0
    });
    
    // Track symbol subscribers with bounds
    this.addSymbolSubscriber(symbol, subscriptionKey);
    
    // Store secure filter criteria
    if (Object.keys(sanitizedFilter).length > 0) {
      this.secureFilterCriteria.set(subscriptionKey, sanitizedFilter);
    }
    
    this.performanceStats.subscriptionsActive++;
    
    // Log subscription for audit
    this.logSubscriptionEvent('trades', connection.userId, symbol, privacyLevel);
    
    // Send initial data based on privacy level
    if (aggregated) {
      this.sendSecureAggregatedData(subscriptionKey);
    } else {
      this.sendSecureRecentTrades(subscriptionKey);
    }
    
    this.emit('trade_subscription_added', { 
      subscriptionKey, 
      symbol, 
      connectionId,
      userId: connection.userId 
    });
  }
  
  /**
   * Validate privacy level authorization
   */
  validatePrivacyLevelAuthorization(connection, privacyLevel) {
    const requiredPermissions = this.permissionMatrix[privacyLevel];
    if (!requiredPermissions) {
      throw new SecurityError('Invalid privacy level');
    }
    
    const userPermissions = connection.metadata?.permissions || [];
    const userRoles = connection.metadata?.roles || [];
    
    // Check if user has required permissions
    const hasPermission = requiredPermissions.some(permission => 
      userPermissions.includes(permission) || userRoles.includes(permission)
    );
    
    if (!hasPermission) {
      this.performanceStats.authorizationFailures++;
      throw new SecurityError('Insufficient permissions for privacy level');
    }
  }
  
  /**
   * Check subscription limits per user
   */
  checkSubscriptionLimits(userId) {
    let userSubscriptionCount = 0;
    
    for (const subscription of this.subscriptions.values()) {
      if (subscription.userId === userId) {
        userSubscriptionCount++;
      }
    }
    
    if (userSubscriptionCount >= this.config.maxSubscriptionsPerUser) {
      throw new SecurityError('Maximum subscriptions per user exceeded');
    }
  }
  
  /**
   * Validate and sanitize filter criteria
   */
  validateAndSanitizeFilter(filter) {
    const sanitized = {};
    const allowedFields = ['minPrice', 'maxPrice', 'minSize', 'maxSize', 'side', 'since'];
    let fieldCount = 0;
    
    for (const [key, value] of Object.entries(filter)) {
      if (fieldCount >= this.securityConfig.maxFilterCriteria) {
        break;
      }
      
      if (allowedFields.includes(key)) {
        switch (key) {
          case 'minPrice':
          case 'maxPrice':
          case 'minSize':
          case 'maxSize':
            sanitized[key] = this.sanitizeNumericString(value.toString());
            break;
          case 'side':
            if (['buy', 'sell'].includes(value)) {
              sanitized[key] = value;
            }
            break;
          case 'since':
            sanitized[key] = this.validateTimestamp(value);
            break;
        }
        fieldCount++;
      }
    }
    
    return sanitized;
  }
  
  /**
   * Handle secure user trade subscription with strict authorization
   */
  handleSecureUserTradeSubscription(event) {
    const { connectionId, params } = event;
    
    // Get connection for authorization
    const connection = this.webSocketManager.connections?.get(connectionId);
    if (!connection || !connection.authenticated) {
      throw new SecurityError('Unauthenticated connection');
    }
    
    const { userId, includeCounterparty = false, includeMetadata = false } = params;
    
    // Strict authorization: users can only subscribe to their own trades
    if (connection.userId !== userId) {
      // Admin override check
      const isAdmin = connection.metadata?.roles?.includes('admin') || 
                     connection.metadata?.permissions?.includes('read_all_trades');
      
      if (!isAdmin) {
        this.performanceStats.authorizationFailures++;
        this.logSecurityViolation('unauthorized_user_trade_access', connection.userId, { 
          requestedUserId: userId 
        });
        throw new SecurityError('Can only subscribe to your own trades');
      }
    }
    
    // Validate user ID
    const sanitizedUserId = this.sanitizeUserId(userId);
    
    // Check subscription limits
    this.checkSubscriptionLimits(connection.userId);
    
    const subscriptionKey = this.generateSecureSubscriptionKey(
      connectionId, sanitizedUserId, 'user_trades'
    );
    
    // Store subscription with security context
    this.subscriptions.set(subscriptionKey, {
      connectionId: connectionId,
      userId: connection.userId,
      channel: 'user_trades',
      targetUserId: sanitizedUserId,
      includeCounterparty: Boolean(includeCounterparty),
      includeMetadata: Boolean(includeMetadata),
      subscribedAt: Date.now(),
      permissions: connection.metadata?.permissions || [],
      roles: connection.metadata?.roles || [],
      accessCount: 0
    });
    
    // Track user subscribers with bounds
    this.addUserTradeSubscriber(sanitizedUserId, subscriptionKey);
    
    this.performanceStats.subscriptionsActive++;
    
    // Log subscription for audit
    this.logSubscriptionEvent('user_trades', connection.userId, sanitizedUserId);
    
    this.emit('user_trade_subscription_added', { 
      subscriptionKey, 
      userId: sanitizedUserId, 
      connectionId,
      subscriberId: connection.userId
    });
  }
  
  /**
   * Add symbol subscriber with bounds checking
   */
  addSymbolSubscriber(symbol, subscriptionKey) {
    let subscribers = this.symbolSubscribers.get(symbol);
    if (!subscribers) {
      subscribers = new Set();
      this.symbolSubscribers.set(symbol, subscribers);
    }
    
    subscribers.add(subscriptionKey);
  }
  
  /**
   * Add user trade subscriber with bounds checking
   */
  addUserTradeSubscriber(userId, subscriptionKey) {
    let subscribers = this.userTradeSubscribers.get(userId);
    if (!subscribers) {
      subscribers = new Set();
      this.userTradeSubscribers.set(userId, subscribers);
    }
    
    subscribers.add(subscriptionKey);
  }
  
  /**
   * Process secure user trade notifications with authorization
   */
  processSecureUserTradeNotifications(trade) {
    // Notify maker with authorization check
    if (trade.makerUserId) {
      this.sendSecureUserTradeNotification(trade.makerUserId, trade, 'maker');
    }
    
    // Notify taker with authorization check
    if (trade.takerUserId) {
      this.sendSecureUserTradeNotification(trade.takerUserId, trade, 'taker');
    }
  }
  
  /**
   * Send secure user trade notification with data protection
   */
  sendSecureUserTradeNotification(userId, trade, role) {
    const userSubscribers = this.userTradeSubscribers.get(userId);
    if (!userSubscribers || userSubscribers.size === 0) {
      return;
    }
    
    for (const subscriptionKey of userSubscribers) {
      const subscription = this.subscriptions.get(subscriptionKey);
      if (!subscription) continue;
      
      // Double-check authorization
      if (subscription.targetUserId !== userId && !this.isAdminSubscription(subscription)) {
        this.performanceStats.dataLeakagePrevented++;
        continue;
      }
      
      // Create user-specific trade data with PII protection
      const userTrade = this.createSecureUserTradeData(trade, role, subscription);
      
      const message = {
        type: 'user_trade',
        data: userTrade,
        timestamp: Date.now()
      };
      
      this.webSocketManager.sendToConnection(subscription.connectionId, message);
      
      // Update access tracking
      subscription.accessCount++;
      this.logUserDataAccess(subscription.userId, subscription.targetUserId, 'trade_notification');
    }
  }
  
  /**
   * Create secure user trade data with PII protection
   */
  createSecureUserTradeData(trade, role, subscription) {
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
    
    // Conditionally include sensitive data based on permissions
    if (subscription.includeCounterparty && this.hasCounterpartyPermission(subscription)) {
      const counterpartyId = role === 'maker' ? trade.takerUserId : trade.makerUserId;
      // Hash counterparty ID for privacy
      baseData.counterpartyHash = this.hashUserId(counterpartyId);
    }
    
    if (subscription.includeMetadata && this.hasMetadataPermission(subscription)) {
      baseData.metadata = this.filterSensitiveMetadata(trade.metadata);
    }
    
    return baseData;
  }
  
  /**
   * Check if subscription is from admin
   */
  isAdminSubscription(subscription) {
    return subscription.roles?.includes('admin') || 
           subscription.permissions?.includes('read_all_trades');
  }
  
  /**
   * Check counterparty permission
   */
  hasCounterpartyPermission(subscription) {
    return subscription.permissions?.includes('read_counterparty_data') ||
           subscription.roles?.includes('admin');
  }
  
  /**
   * Check metadata permission
   */
  hasMetadataPermission(subscription) {
    return subscription.permissions?.includes('read_trade_metadata') ||
           subscription.roles?.includes('admin');
  }
  
  /**
   * Hash user ID for privacy
   */
  hashUserId(userId) {
    if (!userId) return null;
    
    return crypto.createHmac('sha256', this.config.encryptionKey)
      .update(userId)
      .digest('hex')
      .substring(0, 16);
  }
  
  /**
   * Filter sensitive metadata
   */
  filterSensitiveMetadata(metadata) {
    const filtered = {};
    const allowedFields = ['orderType', 'timeInForce', 'source'];
    
    for (const field of allowedFields) {
      if (metadata[field]) {
        filtered[field] = metadata[field];
      }
    }
    
    return filtered;
  }
  
  /**
   * Send secure recent trades with privacy controls
   */
  sendSecureRecentTrades(subscriptionKey) {
    const subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    const recentTrades = this.recentTrades.get(subscription.symbol) || [];
    const filteredTrades = this.applySecureTradeFilters(recentTrades, subscription);
    
    // Limit based on privacy level
    const maxTrades = this.getMaxTradesForPrivacyLevel(subscription.privacyLevel);
    const tradesToSend = filteredTrades.slice(-maxTrades);
    
    const formattedTrades = tradesToSend.map(trade => 
      this.formatTradeForSecurePrivacy(trade, subscription)
    );
    
    const message = {
      type: 'trades_snapshot',
      symbol: subscription.symbol,
      data: formattedTrades,
      timestamp: Date.now()
    };
    
    this.webSocketManager.sendToConnection(subscription.connectionId, message);
    
    // Update access tracking
    subscription.accessCount++;
    this.logDataAccess(subscription.userId, 'trades_snapshot', subscription.symbol);
  }
  
  /**
   * Get max trades based on privacy level
   */
  getMaxTradesForPrivacyLevel(privacyLevel) {
    switch (privacyLevel) {
      case this.privacyLevels.PRIVATE: return 10;
      case this.privacyLevels.AGGREGATED: return 5;
      case this.privacyLevels.PUBLIC: return 50;
      case this.privacyLevels.ADMIN: return 100;
      default: return 20;
    }
  }
  
  /**
   * Format trade for secure privacy controls
   */
  formatTradeForSecurePrivacy(trade, subscription) {
    const baseTrade = {
      id: trade.id,
      symbol: trade.symbol,
      price: trade.price,
      size: trade.size,
      side: trade.side,
      timestamp: trade.timestamp,
      value: trade.value
    };
    
    switch (subscription.privacyLevel) {
      case this.privacyLevels.PUBLIC:
        // Public data only, no user identification
        return baseTrade;
        
      case this.privacyLevels.AGGREGATED:
        // Minimal information
        return {
          price: trade.price,
          size: trade.size,
          timestamp: trade.timestamp
        };
        
      case this.privacyLevels.PRIVATE:
        // Very limited data
        return {
          price: trade.price,
          side: trade.side,
          timestamp: trade.timestamp
        };
        
      case this.privacyLevels.ADMIN:
        // Full data for admin users
        return {
          ...baseTrade,
          makerHash: this.hashUserId(trade.makerUserId),
          takerHash: this.hashUserId(trade.takerUserId),
          fees: trade.fees
        };
        
      default:
        return baseTrade;
    }
  }
  
  /**
   * Log subscription events for audit
   */
  logSubscriptionEvent(channel, userId, target, privacyLevel = null) {
    if (!this.config.auditLogging) return;
    
    const logEntry = {
      timestamp: Date.now(),
      event: 'subscription',
      channel: channel,
      userId: userId,
      target: target,
      privacyLevel: privacyLevel,
      sessionId: this.hashUserId(userId + Date.now())
    };
    
    this.accessLog.set(crypto.randomBytes(8).toString('hex'), logEntry);
    this.performanceStats.auditEventsLogged++;
  }
  
  /**
   * Log data access for compliance
   */
  logDataAccess(userId, dataType, target) {
    if (!this.config.auditLogging) return;
    
    const logEntry = {
      timestamp: Date.now(),
      event: 'data_access',
      userId: userId,
      dataType: dataType,
      target: target
    };
    
    this.accessLog.set(crypto.randomBytes(8).toString('hex'), logEntry);
  }
  
  /**
   * Log user data access specifically
   */
  logUserDataAccess(accessorUserId, targetUserId, operation) {
    if (!this.config.auditLogging) return;
    
    const logEntry = {
      timestamp: Date.now(),
      event: 'user_data_access',
      accessorUserId: accessorUserId,
      targetUserId: targetUserId,
      operation: operation,
      authorized: accessorUserId === targetUserId
    };
    
    this.accessLog.set(crypto.randomBytes(8).toString('hex'), logEntry);
  }
  
  /**
   * Log security violations
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
   * Start security monitoring
   */
  startSecurityMonitoring() {
    setInterval(() => {
      this.performSecurityChecks();
    }, 60000); // Every minute
  }
  
  /**
   * Perform periodic security checks
   */
  performSecurityChecks() {
    // Check for suspicious activity patterns
    this.detectSuspiciousActivity();
    
    // Clean up old logs and data
    this.cleanupSecurityData();
    
    // Monitor resource usage
    this.monitorResourceUsage();
  }
  
  /**
   * Detect suspicious activity patterns
   */
  detectSuspiciousActivity() {
    for (const [userId, activity] of this.userActivityTracking) {
      if (activity.accessCount > this.securityConfig.suspiciousActivityThreshold) {
        this.performanceStats.suspiciousActivities++;
        this.logSecurityViolation('high_activity_pattern', userId, {
          accessCount: activity.accessCount
        });
      }
    }
  }
  
  /**
   * Clean up security data
   */
  cleanupSecurityData() {
    const now = Date.now();
    const retentionPeriod = this.securityConfig.maxUserDataRetention;
    
    // Clean up old access logs
    for (const [key, logEntry] of this.accessLog.cache) {
      if ((now - logEntry.timestamp) > retentionPeriod) {
        this.accessLog.delete(key);
      }
    }
  }
  
  /**
   * Monitor resource usage
   */
  monitorResourceUsage() {
    const used = process.memoryUsage();
    const usedMB = used.heapUsed / 1024 / 1024;
    
    if (usedMB > 500) { // 500MB threshold
      this.emit('high_memory_usage', { usedMB });
    }
  }
  
  /**
   * Generate secure subscription key
   */
  generateSecureSubscriptionKey(...parts) {
    const data = parts.join(':') + ':' + Date.now() + ':' + crypto.randomBytes(8).toString('hex');
    return crypto.createHmac('sha256', this.config.encryptionKey)
      .update(data)
      .digest('hex')
      .substring(0, 32);
  }
  
  /**
   * Validate subscription parameters
   */
  validateSubscriptionParams(params) {
    for (const [field, schema] of Object.entries(this.validationSchemas.subscriptionParams)) {
      if (params[field] && !this.validateField(params[field], schema)) {
        throw new SecurityError(`Invalid ${field} in subscription parameters`);
      }
    }
  }
  
  /**
   * Start secure trade processor
   */
  startSecureTradeProcessor() {
    setInterval(() => {
      try {
        this.processSecurePendingTrades();
      } catch (error) {
        this.handleSecurityViolation('trade_processor_error', error);
      }
    }, this.config.batchInterval);
  }
  
  /**
   * Process pending trades securely
   */
  processSecurePendingTrades() {
    for (const [symbol, trades] of this.tradeBuffer.cache) {
      if (!trades || trades.length === 0) continue;
      
      const subscribers = this.symbolSubscribers.get(symbol);
      if (!subscribers || subscribers.size === 0) {
        this.tradeBuffer.delete(symbol);
        continue;
      }
      
      const batches = this.createSecureTradeBatches(trades);
      
      for (const subscriptionKey of subscribers) {
        const subscription = this.subscriptions.get(subscriptionKey);
        if (!subscription || subscription.aggregated) continue;
        
        for (const batch of batches) {
          this.sendSecureTradeBatch(subscription, batch);
        }
      }
      
      this.tradeBuffer.delete(symbol);
    }
  }
  
  /**
   * Create secure trade batches
   */
  createSecureTradeBatches(trades) {
    const maxSize = Math.min(this.config.maxBatchSize, 100);
    const batches = [];
    
    for (let i = 0; i < trades.length; i += maxSize) {
      batches.push(trades.slice(i, i + maxSize));
    }
    
    return batches;
  }
  
  /**
   * Send secure trade batch
   */
  sendSecureTradeBatch(subscription, batch) {
    const filteredTrades = this.applySecureTradeFilters(batch, subscription);
    if (filteredTrades.length === 0) return;
    
    const formattedTrades = filteredTrades.map(trade => 
      this.formatTradeForSecurePrivacy(trade, subscription)
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
    
    // Update access tracking
    subscription.accessCount++;
  }
  
  /**
   * Apply secure trade filters
   */
  applySecureTradeFilters(trades, subscription) {
    if (!this.config.enableFiltering) {
      return trades;
    }
    
    const filter = this.secureFilterCriteria.get(subscription.subscriptionKey) || {};
    
    return trades.filter(trade => {
      // Apply all filter criteria securely
      if (filter.minPrice && parseFloat(trade.price) < parseFloat(filter.minPrice)) return false;
      if (filter.maxPrice && parseFloat(trade.price) > parseFloat(filter.maxPrice)) return false;
      if (filter.minSize && parseFloat(trade.size) < parseFloat(filter.minSize)) return false;
      if (filter.maxSize && parseFloat(trade.size) > parseFloat(filter.maxSize)) return false;
      if (filter.side && trade.side !== filter.side) return false;
      if (filter.since && trade.timestamp < filter.since) return false;
      
      return true;
    });
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
      subscriptionsActive: this.subscriptions.size,
      symbolsTracked: this.symbolSubscribers.size,
      usersTracked: this.userTradeSubscribers.size,
      tradesBuffered: Array.from(this.tradeBuffer.cache.values()).reduce((total, trades) => 
        total + (trades ? trades.length : 0), 0
      ),
      activeOperations: this.activeOperations.size,
      accessLogEntries: this.accessLog.size
    };
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
    
    for (const [symbol, trades] of this.recentTrades.cache) {
      if (trades) {
        const filteredTrades = trades.filter(trade => trade.timestamp > cutoff);
        this.recentTrades.set(symbol, filteredTrades);
      }
    }
  }
  
  /**
   * Shutdown with secure cleanup
   */
  shutdown() {
    // Clear all sensitive data
    this.recentTrades.clear();
    this.tradeBuffer.clear();
    this.aggregatedTrades.clear();
    this.subscriptions.clear();
    this.symbolSubscribers.clear();
    this.userTradeSubscribers.clear();
    this.secureFilterCriteria.clear();
    this.accessLog.clear();
    this.activeOperations.clear();
    
    // Clear aggregation intervals
    for (const timer of this.aggregationIntervals.values()) {
      clearInterval(timer);
    }
    this.aggregationIntervals.clear();
    
    this.emit('shutdown');
  }
}

/**
 * LRU Cache implementation for bounded collections
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

module.exports = SecureTradeNotificationFeed;