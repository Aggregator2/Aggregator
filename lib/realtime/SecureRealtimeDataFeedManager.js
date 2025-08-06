const EventEmitter = require('events');
const crypto = require('crypto');
const SecureWebSocketManager = require('./SecureWebSocketManager');
const SecureBandwidthOptimizer = require('./SecureBandwidthOptimizer');
const SecureOrderBookFeed = require('./SecureOrderBookFeed');
const SecureTradeNotificationFeed = require('./SecureTradeNotificationFeed');
const SecurePriceTickerFeed = require('./SecurePriceTickerFeed');
const SecureUserOrderStatusFeed = require('./SecureUserOrderStatusFeed');
const SecureSystemStatusFeed = require('./SecureSystemStatusFeed');

/**
 * Secure Real-time Data Feed Manager
 * Central orchestrator for all real-time data feeds with comprehensive security
 */
class SecureRealtimeDataFeedManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate configuration for security
    this.validateConfig(config);
    
    this.config = {
      port: config.port || 8080,
      enableOrderBook: config.enableOrderBook !== false,
      enableTrades: config.enableTrades !== false,
      enableTickers: config.enableTickers !== false,
      enableUserOrders: config.enableUserOrders !== false,
      enableSystemStatus: config.enableSystemStatus !== false,
      enableBandwidthOptimization: config.enableBandwidthOptimization !== false,
      maxSubscriptionsPerConnection: Math.min(config.maxSubscriptionsPerConnection || 50, 200),
      subscriptionRateLimit: {
        requests: Math.min(config.subscriptionRateLimit?.requests || 50, 1000),
        window: Math.max(config.subscriptionRateLimit?.window || 60000, 10000)
      },
      enableAuthentication: config.enableAuthentication !== false,
      enableAuthorization: config.enableAuthorization !== false,
      enableEncryption: config.enableEncryption !== false,
      encryptionKey: config.encryptionKey, // Required for secure operations
      jwtSecret: config.jwtSecret, // Required for authentication
      enableAuditLogging: config.enableAuditLogging !== false,
      enableSecurityMonitoring: config.enableSecurityMonitoring !== false,
      ...config
    };
    
    // Security configuration
    this.securityConfig = {
      maxConcurrentOperations: 200,
      enableCircuitBreaker: true,
      circuitBreakerThreshold: 0.1,
      enableDDoSProtection: true,
      maxConnectionsPerIP: 100,
      enableRateLimiting: true,
      suspiciousActivityThreshold: 1000,
      enableIntrusionDetection: true,
      securityEventRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
      enableThreatMitigation: true
    };
    
    // Component managers
    this.webSocketManager = null;
    this.bandwidthOptimizer = null;
    this.orderBookFeed = null;
    this.tradeNotificationFeed = null;
    this.priceTickerFeed = null;
    this.userOrderStatusFeed = null;
    this.systemStatusFeed = null;
    
    // Security and monitoring
    this.securityEvents = new LRUCache(10000);
    this.threatDetection = new Map();
    this.connectionMetrics = new Map();
    this.performanceMetrics = new Map();
    
    // Circuit breaker state
    this.circuitBreaker = {
      state: 'closed', // closed, open, half-open
      failures: 0,
      lastFailureTime: 0,
      resetTimeout: 30000
    };
    
    // Performance and security tracking
    this.stats = {
      connectionsTotal: 0,
      connectionsActive: 0,
      subscriptionsTotal: 0,
      subscriptionsActive: 0,
      messagesProcessed: 0,
      messagesSent: 0,
      bytesTransferred: 0,
      securityViolations: 0,
      threatsDetected: 0,
      circuitBreakerTrips: 0,
      avgResponseTime: 0,
      uptime: Date.now()
    };
    
    // Active operations tracking
    this.activeOperations = new Set();
    
    // Subscription management with security
    this.subscriptionManager = {
      subscriptions: new Map(), // connectionId -> subscription data
      channelSubscribers: new Map(), // channel -> Set of connectionIds
      userSubscriptions: new Map(), // userId -> Set of subscriptions
      rateLimiters: new Map(), // connectionId -> rate limiter data
      subscriptionCounts: new Map() // userId -> subscription count
    };
  }
  
  /**
   * Validate configuration for security
   */
  validateConfig(config) {
    const requiredFields = ['encryptionKey', 'jwtSecret'];
    const missingFields = requiredFields.filter(field => !config[field]);
    
    if (missingFields.length > 0) {
      throw new SecurityError(`Missing required configuration: ${missingFields.join(', ')}`);
    }
    
    // Validate encryption key strength
    if (config.encryptionKey.length < 32) {
      throw new SecurityError('Encryption key must be at least 32 characters');
    }
    
    // Validate JWT secret strength
    if (config.jwtSecret.length < 32) {
      throw new SecurityError('JWT secret must be at least 32 characters');
    }
  }
  
  /**
   * Start the secure data feed manager
   */
  async start() {
    try {
      this.emit('starting', { timestamp: Date.now() });
      
      // Initialize security monitoring first
      if (this.config.enableSecurityMonitoring) {
        this.initializeSecurityMonitoring();
      }
      
      // Initialize bandwidth optimizer
      if (this.config.enableBandwidthOptimization) {
        await this.initializeBandwidthOptimizer();
      }
      
      // Initialize WebSocket manager with security
      await this.initializeWebSocketManager();
      
      // Initialize feed components
      await this.initializeFeeds();
      
      // Set up subscription management
      this.setupSecureSubscriptionManagement();
      
      // Start monitoring and health checks
      this.startSystemMonitoring();
      
      this.emit('started', { 
        port: this.config.port,
        timestamp: Date.now(),
        components: this.getActiveComponents()
      });
      
    } catch (error) {
      this.handleStartupError(error);
      throw error;
    }
  }
  
  /**
   * Initialize security monitoring
   */
  initializeSecurityMonitoring() {
    // Set up security event handlers
    this.on('security_violation', (event) => {
      this.handleSecurityEvent(event);
    });
    
    this.on('threat_detected', (event) => {
      this.handleThreatEvent(event);
    });
    
    // Start security monitoring tasks
    setInterval(() => {
      this.performSecurityChecks();
    }, 30000); // Every 30 seconds
    
    setInterval(() => {
      this.analyzeSecurityPatterns();
    }, 300000); // Every 5 minutes
  }
  
  /**
   * Initialize bandwidth optimizer
   */
  async initializeBandwidthOptimizer() {
    this.bandwidthOptimizer = new SecureBandwidthOptimizer({
      ...this.config.bandwidthOptimizer,
      encryptionKey: this.config.encryptionKey,
      enableSecurityFeatures: true
    });
    
    // Set up security event forwarding
    this.bandwidthOptimizer.on('security_violation', (event) => {
      this.emit('security_violation', { 
        source: 'bandwidth_optimizer', 
        ...event 
      });
    });
  }
  
  /**
   * Initialize WebSocket manager with security
   */
  async initializeWebSocketManager() {
    this.webSocketManager = new SecureWebSocketManager({
      port: this.config.port,
      maxConnections: this.config.maxConnections,
      authRequired: this.config.enableAuthentication,
      jwtSecret: this.config.jwtSecret,
      encryptionKey: this.config.encryptionKey,
      enableOriginValidation: true,
      enableRateLimiting: true,
      enableSecurityHeaders: true,
      maxConnectionsPerIP: this.securityConfig.maxConnectionsPerIP,
      enableCircuitBreaker: this.securityConfig.enableCircuitBreaker
    });
    
    // Set up event forwarding and monitoring
    this.setupWebSocketEventHandlers();
    
    await this.webSocketManager.initialize();
  }
  
  /**
   * Set up WebSocket event handlers
   */
  setupWebSocketEventHandlers() {
    // Connection events
    this.webSocketManager.on('connection', (event) => {
      this.handleConnection(event);
    });
    
    this.webSocketManager.on('disconnection', (event) => {
      this.handleDisconnection(event);
    });
    
    // Authentication events
    this.webSocketManager.on('authenticated', (event) => {
      this.handleAuthentication(event);
    });
    
    // Security events
    this.webSocketManager.on('security_violation', (event) => {
      this.emit('security_violation', { 
        source: 'websocket_manager', 
        ...event 
      });
    });
    
    // Subscription events
    this.webSocketManager.on('subscribed', (event) => {
      this.handleSecureSubscription(event);
    });
    
    this.webSocketManager.on('unsubscribed', (event) => {
      this.handleSecureUnsubscription(event);
    });
  }
  
  /**
   * Initialize all feed components
   */
  async initializeFeeds() {
    const feedConfigs = {
      encryptionKey: this.config.encryptionKey,
      enableAuditLogging: this.config.enableAuditLogging,
      enableSecurityFeatures: true
    };
    
    // Initialize order book feed
    if (this.config.enableOrderBook) {
      this.orderBookFeed = new SecureOrderBookFeed({
        ...this.config.orderBookFeed,
        ...feedConfigs
      });
      this.orderBookFeed.initialize(this.webSocketManager);
      this.setupFeedSecurityHandlers('order_book', this.orderBookFeed);
    }
    
    // Initialize trade notification feed
    if (this.config.enableTrades) {
      this.tradeNotificationFeed = new SecureTradeNotificationFeed({
        ...this.config.tradeNotificationFeed,
        ...feedConfigs
      });
      this.tradeNotificationFeed.initialize(this.webSocketManager);
      this.setupFeedSecurityHandlers('trade_notification', this.tradeNotificationFeed);
    }
    
    // Initialize price ticker feed
    if (this.config.enableTickers) {
      this.priceTickerFeed = new SecurePriceTickerFeed({
        ...this.config.priceTickerFeed,
        ...feedConfigs
      });
      this.priceTickerFeed.initialize(this.webSocketManager);
      this.setupFeedSecurityHandlers('price_ticker', this.priceTickerFeed);
    }
    
    // Initialize user order status feed
    if (this.config.enableUserOrders) {
      this.userOrderStatusFeed = new SecureUserOrderStatusFeed({
        ...this.config.userOrderStatusFeed,
        ...feedConfigs
      });
      this.userOrderStatusFeed.initialize(this.webSocketManager);
      this.setupFeedSecurityHandlers('user_order_status', this.userOrderStatusFeed);
    }
    
    // Initialize system status feed
    if (this.config.enableSystemStatus) {
      this.systemStatusFeed = new SecureSystemStatusFeed({
        ...this.config.systemStatusFeed,
        ...feedConfigs
      });
      this.systemStatusFeed.initialize(this.webSocketManager);
      this.setupFeedSecurityHandlers('system_status', this.systemStatusFeed);
    }
  }
  
  /**
   * Set up security handlers for feed components
   */
  setupFeedSecurityHandlers(feedName, feedComponent) {
    feedComponent.on('security_violation', (event) => {
      this.emit('security_violation', { 
        source: feedName, 
        ...event 
      });
    });
    
    feedComponent.on('suspicious_activity', (event) => {
      this.emit('threat_detected', { 
        source: feedName, 
        type: 'suspicious_activity',
        ...event 
      });
    });
  }
  
  /**
   * Set up secure subscription management
   */
  setupSecureSubscriptionManagement() {
    // Override subscription validation
    this.webSocketManager.validateSubscriptionPermissions = (connection, channel, params) => {
      return this.validateSecureSubscriptionPermissions(connection, channel, params);
    };
    
    // Set up subscription rate limiting
    setInterval(() => {
      this.resetSubscriptionRateLimits();
    }, this.config.subscriptionRateLimit.window);
  }
  
  /**
   * Validate secure subscription permissions
   */
  validateSecureSubscriptionPermissions(connection, channel, params) {
    try {
      // Check authentication
      if (this.config.enableAuthentication && !connection.authenticated) {
        this.logSecurityEvent('unauthorized_subscription_attempt', {
          connectionId: connection.id,
          channel: channel,
          ip: connection.ip
        });
        return false;
      }
      
      // Check subscription rate limits
      if (!this.checkSubscriptionRateLimit(connection.id)) {
        this.logSecurityEvent('subscription_rate_limit_exceeded', {
          connectionId: connection.id,
          channel: channel
        });
        return false;
      }
      
      // Check subscription count limits
      if (!this.checkSubscriptionCountLimits(connection.userId)) {
        this.logSecurityEvent('subscription_count_limit_exceeded', {
          connectionId: connection.id,
          userId: connection.userId,
          channel: channel
        });
        return false;
      }
      
      // Check channel-specific permissions
      return this.validateChannelPermissions(connection, channel, params);
      
    } catch (error) {
      this.logSecurityEvent('subscription_validation_error', {
        connectionId: connection.id,
        channel: channel,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * Check subscription rate limits
   */
  checkSubscriptionRateLimit(connectionId) {
    const now = Date.now();
    let rateLimiter = this.subscriptionManager.rateLimiters.get(connectionId);
    
    if (!rateLimiter) {
      rateLimiter = {
        requests: 0,
        windowStart: now
      };
      this.subscriptionManager.rateLimiters.set(connectionId, rateLimiter);
    }
    
    // Reset window if expired
    if (now - rateLimiter.windowStart > this.config.subscriptionRateLimit.window) {
      rateLimiter.requests = 0;
      rateLimiter.windowStart = now;
    }
    
    rateLimiter.requests++;
    return rateLimiter.requests <= this.config.subscriptionRateLimit.requests;
  }
  
  /**
   * Check subscription count limits
   */
  checkSubscriptionCountLimits(userId) {
    if (!userId) return true; // Allow for non-authenticated public subscriptions
    
    const currentCount = this.subscriptionManager.subscriptionCounts.get(userId) || 0;
    return currentCount < this.config.maxSubscriptionsPerConnection;
  }
  
  /**
   * Validate channel-specific permissions
   */
  validateChannelPermissions(connection, channel, params) {
    const channelPermissions = {
      'orderbook': [], // Public
      'ticker': [], // Public
      'all_tickers': [], // Public
      'trades': ['read_market_data'], // Requires permission
      'user_trades': ['read_own_trades'], // User-specific
      'user_orders': ['read_own_orders'], // User-specific
      'system_status': [], // Public (with level restrictions)
      'admin_notifications': ['admin'] // Admin only
    };
    
    const requiredPermissions = channelPermissions[channel] || [];
    
    // Check if permissions are required
    if (requiredPermissions.length === 0) {
      return true; // Public channel
    }
    
    // Check if user has required permissions
    const userPermissions = connection.metadata?.permissions || [];
    const userRoles = connection.metadata?.roles || [];
    
    const hasPermission = requiredPermissions.some(permission => 
      userPermissions.includes(permission) || userRoles.includes(permission)
    );
    
    if (!hasPermission) {
      this.logSecurityEvent('insufficient_channel_permissions', {
        connectionId: connection.id,
        userId: connection.userId,
        channel: channel,
        requiredPermissions: requiredPermissions,
        userPermissions: userPermissions
      });
      return false;
    }
    
    // Additional validation for user-specific channels
    if (channel === 'user_trades' || channel === 'user_orders') {
      return this.validateUserSpecificChannelAccess(connection, params);
    }
    
    return true;
  }
  
  /**
   * Validate user-specific channel access
   */
  validateUserSpecificChannelAccess(connection, params) {
    const requestedUserId = params.userId;
    
    // Users can only access their own data
    if (connection.userId !== requestedUserId) {
      // Check for admin override
      const isAdmin = connection.metadata?.roles?.includes('admin') ||
                     connection.metadata?.permissions?.includes('read_all_data');
      
      if (!isAdmin) {
        this.logSecurityEvent('unauthorized_user_data_access', {
          connectionId: connection.id,
          userId: connection.userId,
          requestedUserId: requestedUserId
        });
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Handle secure subscription
   */
  handleSecureSubscription(event) {
    const { connectionId, channel, params } = event;
    
    try {
      const connection = this.webSocketManager.connections.get(connectionId);
      if (!connection) return;
      
      // Create subscription record
      const subscriptionKey = this.generateSubscriptionKey(connectionId, channel, params);
      const subscription = {
        subscriptionKey: subscriptionKey,
        connectionId: connectionId,
        userId: connection.userId,
        channel: channel,
        params: params,
        subscribedAt: Date.now(),
        accessCount: 0
      };
      
      // Store subscription
      this.subscriptionManager.subscriptions.set(subscriptionKey, subscription);
      
      // Track channel subscribers
      if (!this.subscriptionManager.channelSubscribers.has(channel)) {
        this.subscriptionManager.channelSubscribers.set(channel, new Set());
      }
      this.subscriptionManager.channelSubscribers.get(channel).add(connectionId);
      
      // Track user subscriptions
      if (connection.userId) {
        if (!this.subscriptionManager.userSubscriptions.has(connection.userId)) {
          this.subscriptionManager.userSubscriptions.set(connection.userId, new Set());
        }
        this.subscriptionManager.userSubscriptions.get(connection.userId).add(subscriptionKey);
        
        // Update subscription count
        const currentCount = this.subscriptionManager.subscriptionCounts.get(connection.userId) || 0;
        this.subscriptionManager.subscriptionCounts.set(connection.userId, currentCount + 1);
      }
      
      this.stats.subscriptionsTotal++;
      this.stats.subscriptionsActive++;
      
      // Log successful subscription
      this.logSecurityEvent('subscription_success', {
        connectionId: connectionId,
        userId: connection.userId,
        channel: channel,
        subscriptionKey: subscriptionKey
      });
      
    } catch (error) {
      this.handleSubscriptionError(error, event);
    }
  }
  
  /**
   * Handle secure unsubscription
   */
  handleSecureUnsubscription(event) {
    const { connectionId, channel, params } = event;
    
    try {
      // Find and remove matching subscriptions
      const subscriptionsToRemove = [];
      
      for (const [subscriptionKey, subscription] of this.subscriptionManager.subscriptions) {
        if (subscription.connectionId === connectionId && 
            subscription.channel === channel &&
            this.paramsMatch(subscription.params, params)) {
          subscriptionsToRemove.push(subscriptionKey);
        }
      }
      
      // Remove subscriptions
      subscriptionsToRemove.forEach(subscriptionKey => {
        this.removeSubscription(subscriptionKey);
      });
      
    } catch (error) {
      this.handleUnsubscriptionError(error, event);
    }
  }
  
  /**
   * Remove subscription
   */
  removeSubscription(subscriptionKey) {
    const subscription = this.subscriptionManager.subscriptions.get(subscriptionKey);
    if (!subscription) return;
    
    // Remove from subscriptions
    this.subscriptionManager.subscriptions.delete(subscriptionKey);
    
    // Remove from channel subscribers
    const channelSubscribers = this.subscriptionManager.channelSubscribers.get(subscription.channel);
    if (channelSubscribers) {
      channelSubscribers.delete(subscription.connectionId);
      if (channelSubscribers.size === 0) {
        this.subscriptionManager.channelSubscribers.delete(subscription.channel);
      }
    }
    
    // Remove from user subscriptions
    if (subscription.userId) {
      const userSubs = this.subscriptionManager.userSubscriptions.get(subscription.userId);
      if (userSubs) {
        userSubs.delete(subscriptionKey);
        if (userSubs.size === 0) {
          this.subscriptionManager.userSubscriptions.delete(subscription.userId);
        }
      }
      
      // Update subscription count
      const currentCount = this.subscriptionManager.subscriptionCounts.get(subscription.userId) || 0;
      this.subscriptionManager.subscriptionCounts.set(subscription.userId, Math.max(0, currentCount - 1));
    }
    
    this.stats.subscriptionsActive--;
  }
  
  /**
   * Generate subscription key
   */
  generateSubscriptionKey(connectionId, channel, params) {
    const data = JSON.stringify({ connectionId, channel, params, timestamp: Date.now() });
    return crypto.createHmac('sha256', this.config.encryptionKey)
      .update(data)
      .digest('hex')
      .substring(0, 32);
  }
  
  /**
   * Check if parameters match
   */
  paramsMatch(params1, params2) {
    return JSON.stringify(params1) === JSON.stringify(params2);
  }
  
  /**
   * Handle connection
   */
  handleConnection(event) {
    const { connectionId, clientIP } = event;
    
    this.stats.connectionsTotal++;
    this.stats.connectionsActive++;
    
    // Track connection metrics
    this.connectionMetrics.set(connectionId, {
      connectedAt: Date.now(),
      ip: clientIP,
      messagesReceived: 0,
      messagesSent: 0,
      bytesTransferred: 0,
      subscriptions: 0,
      lastActivity: Date.now()
    });
    
    // Check for suspicious connection patterns
    this.detectSuspiciousConnectionPatterns(clientIP);
  }
  
  /**
   * Handle disconnection
   */
  handleDisconnection(event) {
    const { connectionId, userId } = event;
    
    this.stats.connectionsActive--;
    
    // Remove all subscriptions for this connection
    const subscriptionsToRemove = [];
    for (const [subscriptionKey, subscription] of this.subscriptionManager.subscriptions) {
      if (subscription.connectionId === connectionId) {
        subscriptionsToRemove.push(subscriptionKey);
      }
    }
    
    subscriptionsToRemove.forEach(subscriptionKey => {
      this.removeSubscription(subscriptionKey);
    });
    
    // Clean up connection data
    this.connectionMetrics.delete(connectionId);
    this.subscriptionManager.rateLimiters.delete(connectionId);
  }
  
  /**
   * Handle authentication
   */
  handleAuthentication(event) {
    const { connectionId, userId } = event;
    
    this.logSecurityEvent('authentication_success', {
      connectionId: connectionId,
      userId: userId,
      timestamp: Date.now()
    });
  }
  
  /**
   * Detect suspicious connection patterns
   */
  detectSuspiciousConnectionPatterns(clientIP) {
    // Track connections per IP
    let ipConnections = this.threatDetection.get(clientIP);
    if (!ipConnections) {
      ipConnections = {
        count: 0,
        firstConnection: Date.now(),
        lastConnection: Date.now()
      };
      this.threatDetection.set(clientIP, ipConnections);
    }
    
    ipConnections.count++;
    ipConnections.lastConnection = Date.now();
    
    // Check for rapid connection attempts
    const timeWindow = 60000; // 1 minute
    const maxConnectionsPerWindow = this.securityConfig.maxConnectionsPerIP;
    
    if (ipConnections.count > maxConnectionsPerWindow && 
        (ipConnections.lastConnection - ipConnections.firstConnection) < timeWindow) {
      
      this.emit('threat_detected', {
        type: 'rapid_connection_attempts',
        ip: clientIP,
        connectionCount: ipConnections.count,
        timeWindow: timeWindow,
        severity: 'high'
      });
    }
  }
  
  /**
   * Log security event
   */
  logSecurityEvent(type, data) {
    if (!this.config.enableAuditLogging) return;
    
    const eventId = crypto.randomBytes(16).toString('hex');
    const securityEvent = {
      id: eventId,
      type: type,
      timestamp: Date.now(),
      data: data
    };
    
    this.securityEvents.set(eventId, securityEvent);
    this.stats.securityViolations++;
    
    this.emit('security_event', securityEvent);
  }
  
  /**
   * Handle security event
   */
  handleSecurityEvent(event) {
    this.stats.securityViolations++;
    
    // Check circuit breaker
    if (this.securityConfig.enableCircuitBreaker) {
      this.updateCircuitBreaker(false);
    }
    
    // Log for audit
    this.logSecurityEvent('security_violation', event);
    
    // Take immediate action for critical events
    if (event.severity === 'critical') {
      this.handleCriticalSecurityEvent(event);
    }
  }
  
  /**
   * Handle threat event
   */
  handleThreatEvent(event) {
    this.stats.threatsDetected++;
    
    // Log threat
    this.logSecurityEvent('threat_detected', event);
    
    // Implement threat mitigation if enabled
    if (this.securityConfig.enableThreatMitigation) {
      this.mitigateThreat(event);
    }
  }
  
  /**
   * Handle critical security event
   */
  handleCriticalSecurityEvent(event) {
    // Immediate actions for critical security events
    if (event.connectionId) {
      const connection = this.webSocketManager.connections.get(event.connectionId);
      if (connection) {
        connection.ws.close(1008, 'Security violation');
      }
    }
    
    if (event.ip) {
      // Add IP to blacklist (would need to implement IP blacklisting)
      this.emit('ip_blacklist_request', { ip: event.ip, reason: event.type });
    }
  }
  
  /**
   * Mitigate threat
   */
  mitigateThreat(threat) {
    switch (threat.type) {
      case 'rapid_connection_attempts':
        // Temporarily block IP
        this.emit('ip_rate_limit', { 
          ip: threat.ip, 
          duration: 300000 // 5 minutes
        });
        break;
        
      case 'suspicious_activity':
        // Increase monitoring for connection
        if (threat.connectionId) {
          this.enhanceConnectionMonitoring(threat.connectionId);
        }
        break;
        
      case 'anomalous_behavior':
        // Log and monitor
        this.logSecurityEvent('anomalous_behavior_detected', threat);
        break;
    }
  }
  
  /**
   * Enhance connection monitoring
   */
  enhanceConnectionMonitoring(connectionId) {
    const metrics = this.connectionMetrics.get(connectionId);
    if (metrics) {
      metrics.enhancedMonitoring = true;
      metrics.monitoringStarted = Date.now();
    }
  }
  
  /**
   * Update circuit breaker
   */
  updateCircuitBreaker(success) {
    if (success) {
      if (this.circuitBreaker.state === 'half-open') {
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failures = 0;
      }
    } else {
      this.circuitBreaker.failures++;
      this.circuitBreaker.lastFailureTime = Date.now();
      
      if (this.circuitBreaker.failures >= this.securityConfig.circuitBreakerThreshold * 100) {
        this.circuitBreaker.state = 'open';
        this.stats.circuitBreakerTrips++;
        
        // Auto-reset after timeout
        setTimeout(() => {
          this.circuitBreaker.state = 'half-open';
        }, this.circuitBreaker.resetTimeout);
      }
    }
  }
  
  /**
   * Perform security checks
   */
  performSecurityChecks() {
    // Check circuit breaker state
    this.checkCircuitBreakerReset();
    
    // Monitor connection metrics
    this.monitorConnectionMetrics();
    
    // Clean up old security events
    this.cleanupSecurityEvents();
    
    // Check for anomalies
    this.detectAnomalies();
  }
  
  /**
   * Check circuit breaker reset
   */
  checkCircuitBreakerReset() {
    if (this.circuitBreaker.state === 'open') {
      const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
      if (timeSinceFailure > this.circuitBreaker.resetTimeout) {
        this.circuitBreaker.state = 'half-open';
      }
    }
  }
  
  /**
   * Monitor connection metrics
   */
  monitorConnectionMetrics() {
    const now = Date.now();
    
    for (const [connectionId, metrics] of this.connectionMetrics) {
      // Check for inactive connections
      if (now - metrics.lastActivity > 300000) { // 5 minutes
        this.emit('inactive_connection', { connectionId, lastActivity: metrics.lastActivity });
      }
      
      // Check for enhanced monitoring expiry
      if (metrics.enhancedMonitoring && now - metrics.monitoringStarted > 600000) { // 10 minutes
        metrics.enhancedMonitoring = false;
      }
    }
  }
  
  /**
   * Clean up security events
   */
  cleanupSecurityEvents() {
    const cutoff = Date.now() - this.securityConfig.securityEventRetention;
    
    for (const [eventId, event] of this.securityEvents.cache) {
      if (event.timestamp < cutoff) {
        this.securityEvents.delete(eventId);
      }
    }
  }
  
  /**
   * Detect anomalies
   */
  detectAnomalies() {
    // Check for unusual patterns in metrics
    const currentMetrics = this.getPerformanceMetrics();
    
    // Compare with historical averages
    for (const [metric, value] of Object.entries(currentMetrics)) {
      const historical = this.performanceMetrics.get(metric);
      if (historical && this.isAnomalousValue(value, historical)) {
        this.emit('anomaly_detected', {
          metric: metric,
          currentValue: value,
          historicalAverage: historical.average,
          deviation: Math.abs(value - historical.average) / historical.average
        });
      }
    }
  }
  
  /**
   * Check if value is anomalous
   */
  isAnomalousValue(current, historical) {
    const threshold = 2.0; // 2x deviation threshold
    return Math.abs(current - historical.average) > threshold * historical.standardDeviation;
  }
  
  /**
   * Analyze security patterns
   */
  analyzeSecurityPatterns() {
    // Analyze recent security events for patterns
    const recentEvents = Array.from(this.securityEvents.cache.values())
      .filter(event => Date.now() - event.timestamp < 3600000) // Last hour
      .sort((a, b) => b.timestamp - a.timestamp);
    
    // Group by type
    const eventsByType = {};
    recentEvents.forEach(event => {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    });
    
    // Check for concerning patterns
    for (const [type, count] of Object.entries(eventsByType)) {
      if (count > this.securityConfig.suspiciousActivityThreshold) {
        this.emit('security_pattern_detected', {
          type: type,
          count: count,
          timeWindow: '1 hour',
          severity: 'high'
        });
      }
    }
  }
  
  /**
   * Start system monitoring
   */
  startSystemMonitoring() {
    setInterval(() => {
      this.updatePerformanceMetrics();
    }, 10000); // Every 10 seconds
    
    setInterval(() => {
      this.performHealthChecks();
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Update performance metrics
   */
  updatePerformanceMetrics() {
    const metrics = this.getPerformanceMetrics();
    
    for (const [metric, value] of Object.entries(metrics)) {
      let historical = this.performanceMetrics.get(metric);
      if (!historical) {
        historical = {
          values: [],
          average: value,
          standardDeviation: 0
        };
      }
      
      historical.values.push(value);
      if (historical.values.length > 100) {
        historical.values.shift(); // Keep last 100 values
      }
      
      // Calculate running statistics
      historical.average = historical.values.reduce((a, b) => a + b, 0) / historical.values.length;
      
      const variance = historical.values.reduce((sum, val) => {
        return sum + Math.pow(val - historical.average, 2);
      }, 0) / historical.values.length;
      historical.standardDeviation = Math.sqrt(variance);
      
      this.performanceMetrics.set(metric, historical);
    }
  }
  
  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return {
      connectionsActive: this.stats.connectionsActive,
      subscriptionsActive: this.stats.subscriptionsActive,
      messagesPerSecond: this.calculateMessagesPerSecond(),
      avgResponseTime: this.stats.avgResponseTime,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // MB
      cpuUsage: process.cpuUsage().user / 1000000 // Convert to seconds
    };
  }
  
  /**
   * Calculate messages per second
   */
  calculateMessagesPerSecond() {
    const now = Date.now();
    const timeWindow = 10000; // 10 seconds
    
    if (!this.lastMetricsTime) {
      this.lastMetricsTime = now;
      this.lastMessageCount = this.stats.messagesProcessed;
      return 0;
    }
    
    const timeDiff = now - this.lastMetricsTime;
    const messageDiff = this.stats.messagesProcessed - this.lastMessageCount;
    
    this.lastMetricsTime = now;
    this.lastMessageCount = this.stats.messagesProcessed;
    
    return timeDiff > 0 ? (messageDiff / timeDiff) * 1000 : 0;
  }
  
  /**
   * Perform health checks
   */
  performHealthChecks() {
    // Check component health
    const componentHealth = {
      webSocketManager: this.webSocketManager ? 'healthy' : 'unhealthy',
      orderBookFeed: this.orderBookFeed ? 'healthy' : 'unhealthy',
      tradeNotificationFeed: this.tradeNotificationFeed ? 'healthy' : 'unhealthy',
      priceTickerFeed: this.priceTickerFeed ? 'healthy' : 'unhealthy',
      userOrderStatusFeed: this.userOrderStatusFeed ? 'healthy' : 'unhealthy',
      systemStatusFeed: this.systemStatusFeed ? 'healthy' : 'unhealthy',
      bandwidthOptimizer: this.bandwidthOptimizer ? 'healthy' : 'unhealthy'
    };
    
    // Update system status if system status feed is available
    if (this.systemStatusFeed) {
      for (const [component, status] of Object.entries(componentHealth)) {
        this.systemStatusFeed.updateSystemStatus({
          component: component,
          status: status === 'healthy' ? 'operational' : 'down',
          message: status === 'healthy' ? 'Component operating normally' : 'Component unavailable',
          severity: status === 'healthy' ? 'info' : 'error',
          timestamp: Date.now()
        });
      }
    }
  }
  
  /**
   * Reset subscription rate limits
   */
  resetSubscriptionRateLimits() {
    const now = Date.now();
    
    for (const [connectionId, rateLimiter] of this.subscriptionManager.rateLimiters) {
      if (now - rateLimiter.windowStart > this.config.subscriptionRateLimit.window) {
        rateLimiter.requests = 0;
        rateLimiter.windowStart = now;
      }
    }
  }
  
  /**
   * Handle startup error
   */
  handleStartupError(error) {
    this.emit('startup_error', {
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle subscription error
   */
  handleSubscriptionError(error, event) {
    this.logSecurityEvent('subscription_error', {
      error: error.message,
      event: event,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle unsubscription error
   */
  handleUnsubscriptionError(error, event) {
    this.logSecurityEvent('unsubscription_error', {
      error: error.message,
      event: event,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get active components
   */
  getActiveComponents() {
    const components = [];
    
    if (this.webSocketManager) components.push('websocket_manager');
    if (this.bandwidthOptimizer) components.push('bandwidth_optimizer');
    if (this.orderBookFeed) components.push('order_book_feed');
    if (this.tradeNotificationFeed) components.push('trade_notification_feed');
    if (this.priceTickerFeed) components.push('price_ticker_feed');
    if (this.userOrderStatusFeed) components.push('user_order_status_feed');
    if (this.systemStatusFeed) components.push('system_status_feed');
    
    return components;
  }
  
  /**
   * Get comprehensive statistics
   */
  getStats() {
    const baseStats = { ...this.stats };
    
    // Add component stats
    if (this.webSocketManager) {
      baseStats.webSocket = this.webSocketManager.getStats();
    }
    
    if (this.bandwidthOptimizer) {
      baseStats.bandwidthOptimizer = this.bandwidthOptimizer.getStats();
    }
    
    if (this.orderBookFeed) {
      baseStats.orderBook = this.orderBookFeed.getStats();
    }
    
    if (this.tradeNotificationFeed) {
      baseStats.tradeNotification = this.tradeNotificationFeed.getStats();
    }
    
    if (this.priceTickerFeed) {
      baseStats.priceTicker = this.priceTickerFeed.getStats();
    }
    
    if (this.userOrderStatusFeed) {
      baseStats.userOrderStatus = this.userOrderStatusFeed.getStats();
    }
    
    if (this.systemStatusFeed) {
      baseStats.systemStatus = this.systemStatusFeed.getStats();
    }
    
    // Add security stats
    baseStats.security = {
      securityEvents: this.securityEvents.size,
      threatsDetected: this.stats.threatsDetected,
      circuitBreakerState: this.circuitBreaker.state,
      activeConnections: this.connectionMetrics.size
    };
    
    return baseStats;
  }
  
  /**
   * Shutdown with secure cleanup
   */
  async shutdown() {
    try {
      this.emit('shutting_down', { timestamp: Date.now() });
      
      // Shutdown all components
      if (this.systemStatusFeed) {
        await this.systemStatusFeed.shutdown();
      }
      
      if (this.userOrderStatusFeed) {
        await this.userOrderStatusFeed.shutdown();
      }
      
      if (this.priceTickerFeed) {
        await this.priceTickerFeed.shutdown();
      }
      
      if (this.tradeNotificationFeed) {
        await this.tradeNotificationFeed.shutdown();
      }
      
      if (this.orderBookFeed) {
        await this.orderBookFeed.shutdown();
      }
      
      if (this.webSocketManager) {
        await this.webSocketManager.shutdown();
      }
      
      // Clear all sensitive data
      this.securityEvents.clear();
      this.threatDetection.clear();
      this.connectionMetrics.clear();
      this.performanceMetrics.clear();
      this.subscriptionManager.subscriptions.clear();
      this.subscriptionManager.channelSubscribers.clear();
      this.subscriptionManager.userSubscriptions.clear();
      this.subscriptionManager.rateLimiters.clear();
      this.subscriptionManager.subscriptionCounts.clear();
      this.activeOperations.clear();
      
      this.emit('shutdown', { timestamp: Date.now() });
      
    } catch (error) {
      this.emit('shutdown_error', {
        error: error.message,
        timestamp: Date.now()
      });
      throw error;
    }
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

module.exports = SecureRealtimeDataFeedManager;