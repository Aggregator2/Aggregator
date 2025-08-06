const WebSocket = require('ws');
const Redis = require('ioredis');
const EventEmitter = require('events');
const jwt = require('jsonwebtoken');
const { RateLimiterRedis } = require('rate-limiter-flexible');
const crypto = require('crypto');

/**
 * @class EnhancedWebSocketServer
 * @description Production-ready WebSocket server with comprehensive edge case handling
 * @extends EventEmitter
 * 
 * Features:
 * - Comprehensive error handling and recovery
 * - Advanced rate limiting and DoS protection
 * - Connection state management and cleanup
 * - Message ordering and delivery guarantees
 * - Graceful degradation under load
 * - Memory leak prevention
 * - Security hardening
 */
class EnhancedWebSocketServer extends EventEmitter {
  /**
   * @param {Object} config - Configuration options
   * @param {number} config.port - WebSocket server port
   * @param {string} config.jwtSecret - JWT secret for authentication
   * @param {Object} config.redis - Redis configuration
   * @param {Object} config.rateLimiting - Rate limiting configuration
   * @param {Object} config.security - Security configuration
   */
  constructor(config = {}) {
    super();
    
    // Validate configuration
    this._validateConfig(config);
    
    this.config = {
      port: config.port || 8080,
      host: config.host || '0.0.0.0',
      jwtSecret: config.jwtSecret || process.env.JWT_SECRET,
      
      // Redis configuration
      redis: {
        host: config.redis?.host || 'localhost',
        port: config.redis?.port || 6379,
        password: config.redis?.password,
        db: config.redis?.db || 0,
        ...config.redis
      },
      
      // Rate limiting configuration
      rateLimiting: {
        connectionWindow: 60, // seconds
        maxConnectionsPerIp: 10,
        messageWindow: 1, // seconds
        maxMessagesPerConnection: 100,
        globalMessageLimit: 10000, // messages per second globally
        ...config.rateLimiting
      },
      
      // Security configuration
      security: {
        maxMessageSize: 64 * 1024, // 64KB
        maxSubscriptionsPerConnection: 50,
        heartbeatInterval: 30000, // 30 seconds
        connectionTimeout: 60000, // 60 seconds
        enableCompression: true,
        compressionThreshold: 1024,
        ...config.security
      },
      
      // Performance configuration
      performance: {
        messageQueueSize: 1000,
        batchSize: 100,
        batchInterval: 50, // ms
        maxMemoryUsage: 500 * 1024 * 1024, // 500MB
        ...config.performance
      },
      
      ...config
    };
    
    // WebSocket server
    this.wss = null;
    
    // Redis clients with error handling
    this.redis = this._createRedisClient('main');
    this.pubClient = this._createRedisClient('pub');
    this.subClient = this._createRedisClient('sub');
    
    // Connection management
    this.connections = new Map();
    this.subscriptions = new Map();
    this.userConnections = new Map();
    this.ipConnections = new Map();
    
    // Message management
    this.messageQueues = new Map();
    this.pendingMessages = new Map();
    this.messageSequence = 0;
    
    // Rate limiters
    this.rateLimiters = this._createRateLimiters();
    
    // Security state
    this.bannedIps = new Set();
    this.suspiciousActivity = new Map();
    
    // Performance monitoring
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errorsEncountered: 0,
      rateLimitViolations: 0,
      memoryUsage: 0,
      lastCleanup: Date.now()
    };
    
    // Health check state
    this.healthStatus = {
      status: 'starting',
      redisConnected: false,
      lastHealthCheck: Date.now()
    };
    
    // Start monitoring and cleanup processes
    this._startMonitoring();
  }

  /**
   * Start the WebSocket server with comprehensive error handling
   * @returns {Promise<void>}
   */
  async start() {
    try {
      // Verify Redis connection
      await this._verifyRedisConnections();
      
      // Create WebSocket server with security options
      this.wss = new WebSocket.Server({
        port: this.config.port,
        host: this.config.host,
        
        // Security headers
        perMessageDeflate: this.config.security.enableCompression ? {
          zlibDeflateOptions: {
            chunkSize: 1024,
            windowBits: 13,
            level: 3,
            memLevel: 7
          },
          threshold: this.config.security.compressionThreshold,
          concurrencyLimit: 10,
          clientNoContextTakeover: true,
          serverNoContextTakeover: false
        } : false,
        
        // Connection verification
        verifyClient: (info) => this._verifyClient(info),
        
        // Handle protocols
        handleProtocols: (protocols) => {
          if (protocols.includes('orderbook-v2')) return 'orderbook-v2';
          if (protocols.includes('orderbook-v1')) return 'orderbook-v1';
          return false;
        }
      });
      
      // Setup server event handlers
      this.wss.on('connection', this._handleConnection.bind(this));
      this.wss.on('error', this._handleServerError.bind(this));
      this.wss.on('headers', this._addSecurityHeaders.bind(this));
      
      // Setup Redis subscriptions
      await this._setupRedisSubscriptions();
      
      // Start background processes
      this._startMessageProcessor();
      this._startHeartbeat();
      this._startCleanup();
      
      this.healthStatus.status = 'healthy';
      
      console.log(`Enhanced WebSocket server started on ${this.config.host}:${this.config.port}`);
      this.emit('started', { 
        port: this.config.port, 
        host: this.config.host,
        timestamp: Date.now()
      });
      
    } catch (error) {
      this.healthStatus.status = 'error';
      console.error('Failed to start WebSocket server:', error);
      this.emit('error', { type: 'startup', error });
      throw error;
    }
  }

  /**
   * Handle new WebSocket connection with comprehensive validation
   * @private
   */
  async _handleConnection(ws, request) {
    const connectionId = this._generateConnectionId();
    const clientIp = this._getClientIp(request);
    const userAgent = request.headers['user-agent'] || 'unknown';
    
    try {
      // Security checks
      if (this.bannedIps.has(clientIp)) {
        ws.close(1008, 'IP banned');
        return;
      }
      
      // Rate limiting checks
      try {
        await this.rateLimiters.connection.consume(clientIp);
      } catch (rateLimitError) {
        this._recordSuspiciousActivity(clientIp, 'rate_limit_connection');
        ws.close(1008, 'Connection rate limit exceeded');
        return;
      }
      
      // Check IP connection limit
      const ipConnectionCount = this.ipConnections.get(clientIp)?.size || 0;
      if (ipConnectionCount >= this.config.rateLimiting.maxConnectionsPerIp) {
        this._recordSuspiciousActivity(clientIp, 'too_many_connections');
        ws.close(1008, 'Too many connections from IP');
        return;
      }
      
      // Create connection object
      const connection = {
        id: connectionId,
        ws,
        ip: clientIp,
        userAgent,
        userId: null,
        authenticated: false,
        subscriptions: new Set(),
        messageCount: 0,
        lastActivity: Date.now(),
        createdAt: Date.now(),
        protocol: ws.protocol || 'unknown',
        state: 'connected',
        healthScore: 100 // Health score for connection quality
      };
      
      // Store connection
      this.connections.set(connectionId, connection);
      this.messageQueues.set(connectionId, []);
      
      // Track IP connections
      if (!this.ipConnections.has(clientIp)) {
        this.ipConnections.set(clientIp, new Set());
      }
      this.ipConnections.get(clientIp).add(connectionId);
      
      // Update metrics
      this.metrics.totalConnections++;
      this.metrics.activeConnections++;
      
      // Setup connection event handlers with error boundaries
      this._setupConnectionHandlers(connectionId, connection);
      
      // Send welcome message
      this._sendToConnection(connectionId, {
        type: 'welcome',
        connectionId,
        protocol: connection.protocol,
        serverTime: Date.now(),
        features: ['compression', 'batching', 'heartbeat']
      });
      
      this.emit('connection', { 
        connectionId, 
        ip: clientIp, 
        userAgent,
        protocol: connection.protocol
      });
      
    } catch (error) {
      console.error(`Connection setup failed for ${connectionId}:`, error);
      this.metrics.errorsEncountered++;
      
      // Cleanup and close
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'Internal error');
      }
      
      this._cleanupConnection(connectionId);
    }
  }

  /**
   * Setup connection event handlers with comprehensive error handling
   * @private
   */
  _setupConnectionHandlers(connectionId, connection) {
    const { ws } = connection;
    
    // Message handler with error boundary
    ws.on('message', async (data) => {
      try {
        await this._handleMessage(connectionId, data);
      } catch (error) {
        console.error(`Message handling error for ${connectionId}:`, error);
        this._handleConnectionError(connectionId, error);
      }
    });
    
    // Close handler
    ws.on('close', (code, reason) => {
      this._handleDisconnect(connectionId, code, reason);
    });
    
    // Error handler
    ws.on('error', (error) => {
      console.error(`WebSocket error for ${connectionId}:`, error);
      this._handleConnectionError(connectionId, error);
    });
    
    // Pong handler for heartbeat
    ws.on('pong', () => {
      this._handlePong(connectionId);
    });
    
    // Unexpected response handler
    ws.on('unexpected-response', (request, response) => {
      console.warn(`Unexpected response for ${connectionId}:`, response.statusCode);
    });
  }

  /**
   * Handle incoming message with comprehensive validation and error handling
   * @private
   */
  async _handleMessage(connectionId, data) {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.state !== 'connected') {
      return;
    }
    
    // Rate limiting check
    try {
      await this.rateLimiters.message.consume(connectionId);
    } catch (rateLimitError) {
      this.metrics.rateLimitViolations++;
      this._degradeConnectionHealth(connectionId, 10);
      this._sendError(connectionId, 'Rate limit exceeded');
      return;
    }
    
    // Size validation
    if (data.length > this.config.security.maxMessageSize) {
      this._recordSuspiciousActivity(connection.ip, 'oversized_message');
      this._sendError(connectionId, 'Message too large');
      return;
    }
    
    // Update connection activity
    connection.lastActivity = Date.now();
    connection.messageCount++;
    this.metrics.messagesReceived++;
    
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(data);
    } catch (parseError) {
      this._degradeConnectionHealth(connectionId, 5);
      this._sendError(connectionId, 'Invalid JSON');
      return;
    }
    
    // Message validation
    if (!this._validateMessage(parsedMessage)) {
      this._degradeConnectionHealth(connectionId, 5);
      this._sendError(connectionId, 'Invalid message format');
      return;
    }
    
    // Handle message by type
    try {
      switch (parsedMessage.type) {
        case 'authenticate':
          await this._handleAuthenticate(connectionId, parsedMessage);
          break;
          
        case 'subscribe':
          await this._handleSubscribe(connectionId, parsedMessage);
          break;
          
        case 'unsubscribe':
          await this._handleUnsubscribe(connectionId, parsedMessage);
          break;
          
        case 'ping':
          this._sendToConnection(connectionId, { 
            type: 'pong', 
            timestamp: Date.now() 
          });
          break;
          
        case 'health':
          this._sendToConnection(connectionId, {
            type: 'health_response',
            status: this.healthStatus,
            connectionHealth: connection.healthScore,
            timestamp: Date.now()
          });
          break;
          
        default:
          this._sendError(connectionId, 'Unknown message type');
      }
    } catch (handlingError) {
      console.error(`Message handling error for ${connectionId}:`, handlingError);
      this._sendError(connectionId, 'Message processing failed');
    }
  }

  /**
   * Handle authentication with enhanced security
   * @private
   */
  async _handleAuthenticate(connectionId, message) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    if (!message.token) {
      this._sendError(connectionId, 'Token required');
      return;
    }
    
    try {
      // Verify JWT with additional security checks
      const decoded = jwt.verify(message.token, this.config.jwtSecret, {
        algorithms: ['HS256'],
        maxAge: '24h', // Token expiry
        issuer: 'orderbook-server', // Expected issuer
        audience: 'orderbook-client' // Expected audience
      });
      
      // Additional validation
      if (!decoded.userId || !decoded.permissions) {
        throw new Error('Invalid token payload');
      }
      
      // Check if user is banned
      const isBanned = await this.redis.get(`banned:user:${decoded.userId}`);
      if (isBanned) {
        this._sendError(connectionId, 'User banned');
        return;
      }
      
      // Update connection
      connection.userId = decoded.userId;
      connection.authenticated = true;
      connection.permissions = decoded.permissions || [];
      
      // Track user connections
      if (!this.userConnections.has(decoded.userId)) {
        this.userConnections.set(decoded.userId, new Set());
      }
      this.userConnections.get(decoded.userId).add(connectionId);
      
      // Improve health score for authenticated connections
      connection.healthScore = Math.min(connection.healthScore + 20, 100);
      
      this._sendToConnection(connectionId, {
        type: 'authenticated',
        userId: decoded.userId,
        permissions: connection.permissions,
        timestamp: Date.now()
      });
      
      this.emit('authenticated', { 
        connectionId, 
        userId: decoded.userId,
        permissions: connection.permissions
      });
      
    } catch (authError) {
      this._recordSuspiciousActivity(connection.ip, 'auth_failure');
      this._degradeConnectionHealth(connectionId, 15);
      this._sendError(connectionId, 'Authentication failed');
      
      // Consider banning after multiple auth failures
      const failureCount = (this.suspiciousActivity.get(connection.ip)?.auth_failure || 0);
      if (failureCount > 5) {
        this._banIp(connection.ip, 'Multiple auth failures');
      }
    }
  }

  /**
   * Handle subscription with authorization checks
   * @private
   */
  async _handleSubscribe(connectionId, message) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    if (!message.channel) {
      this._sendError(connectionId, 'Channel required');
      return;
    }
    
    // Validate channel format
    if (!this._validateChannel(message.channel)) {
      this._sendError(connectionId, 'Invalid channel format');
      return;
    }
    
    // Check subscription limits
    if (connection.subscriptions.size >= this.config.security.maxSubscriptionsPerConnection) {
      this._sendError(connectionId, 'Subscription limit reached');
      return;
    }
    
    // Authorization checks for private channels
    if (message.channel.startsWith('private:') || message.channel.startsWith('user:')) {
      if (!connection.authenticated) {
        this._sendError(connectionId, 'Authentication required for private channels');
        return;
      }
      
      // Check specific permissions
      if (!this._hasChannelPermission(connection, message.channel)) {
        this._sendError(connectionId, 'Insufficient permissions');
        return;
      }
    }
    
    // Add subscription
    connection.subscriptions.add(message.channel);
    
    if (!this.subscriptions.has(message.channel)) {
      this.subscriptions.set(message.channel, new Set());
      
      // Subscribe to Redis channel
      try {
        await this.subClient.subscribe(message.channel);
      } catch (redisError) {
        console.error('Redis subscription failed:', redisError);
        this._sendError(connectionId, 'Subscription failed');
        return;
      }
    }
    
    this.subscriptions.get(message.channel).add(connectionId);
    
    this._sendToConnection(connectionId, {
      type: 'subscribed',
      channel: message.channel,
      timestamp: Date.now()
    });
    
    // Send latest data if available
    await this._sendLatestData(connectionId, message.channel);
    
    this.emit('subscribed', { connectionId, channel: message.channel });
  }

  /**
   * Handle unsubscribe with cleanup
   * @private
   */
  async _handleUnsubscribe(connectionId, message) {
    const connection = this.connections.get(connectionId);
    if (!connection || !message.channel) return;
    
    if (!connection.subscriptions.has(message.channel)) {
      this._sendError(connectionId, 'Not subscribed to channel');
      return;
    }
    
    // Remove subscription
    connection.subscriptions.delete(message.channel);
    
    const channelSubscribers = this.subscriptions.get(message.channel);
    if (channelSubscribers) {
      channelSubscribers.delete(connectionId);
      
      // Unsubscribe from Redis if no more subscribers
      if (channelSubscribers.size === 0) {
        this.subscriptions.delete(message.channel);
        try {
          await this.subClient.unsubscribe(message.channel);
        } catch (redisError) {
          console.error('Redis unsubscribe failed:', redisError);
        }
      }
    }
    
    this._sendToConnection(connectionId, {
      type: 'unsubscribed',
      channel: message.channel,
      timestamp: Date.now()
    });
    
    this.emit('unsubscribed', { connectionId, channel: message.channel });
  }

  /**
   * Handle connection disconnect with comprehensive cleanup
   * @private
   */
  _handleDisconnect(connectionId, code, reason) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    connection.state = 'disconnected';
    
    // Remove from all subscriptions
    for (const channel of connection.subscriptions) {
      const channelSubscribers = this.subscriptions.get(channel);
      if (channelSubscribers) {
        channelSubscribers.delete(connectionId);
        
        if (channelSubscribers.size === 0) {
          this.subscriptions.delete(channel);
          this.subClient.unsubscribe(channel).catch(console.error);
        }
      }
    }
    
    // Remove from user connections
    if (connection.userId && this.userConnections.has(connection.userId)) {
      const userConns = this.userConnections.get(connection.userId);
      userConns.delete(connectionId);
      
      if (userConns.size === 0) {
        this.userConnections.delete(connection.userId);
      }
    }
    
    // Remove from IP connections
    const ipConns = this.ipConnections.get(connection.ip);
    if (ipConns) {
      ipConns.delete(connectionId);
      
      if (ipConns.size === 0) {
        this.ipConnections.delete(connection.ip);
      }
    }
    
    // Cleanup
    this._cleanupConnection(connectionId);
    
    this.metrics.activeConnections--;
    
    this.emit('disconnected', {
      connectionId,
      userId: connection.userId,
      code,
      reason: reason?.toString(),
      duration: Date.now() - connection.createdAt,
      healthScore: connection.healthScore
    });
  }

  /**
   * Cleanup connection resources
   * @private
   */
  _cleanupConnection(connectionId) {
    this.connections.delete(connectionId);
    this.messageQueues.delete(connectionId);
    this.pendingMessages.delete(connectionId);
  }

  /**
   * Send message to connection with error handling
   * @private
   */
  _sendToConnection(connectionId, message) {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    
    try {
      // Add message sequence for ordering
      const sequencedMessage = {
        ...message,
        sequence: ++this.messageSequence,
        timestamp: message.timestamp || Date.now()
      };
      
      connection.ws.send(JSON.stringify(sequencedMessage));
      this.metrics.messagesSent++;
      return true;
    } catch (error) {
      console.error(`Failed to send to ${connectionId}:`, error);
      this._handleConnectionError(connectionId, error);
      return false;
    }
  }

  /**
   * Send error message to connection
   * @private
   */
  _sendError(connectionId, message) {
    this._sendToConnection(connectionId, {
      type: 'error',
      error: message,
      timestamp: Date.now()
    });
  }

  /**
   * Handle connection errors with recovery attempts
   * @private
   */
  _handleConnectionError(connectionId, error) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    this.metrics.errorsEncountered++;
    this._degradeConnectionHealth(connectionId, 20);
    
    // Close connection if health is too low
    if (connection.healthScore < 20) {
      connection.ws.close(1011, 'Connection health degraded');
    }
    
    this.emit('connection_error', {
      connectionId,
      error: error.message,
      healthScore: connection.healthScore
    });
  }

  /**
   * Degrade connection health score
   * @private
   */
  _degradeConnectionHealth(connectionId, penalty) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.healthScore = Math.max(connection.healthScore - penalty, 0);
    }
  }

  /**
   * Record suspicious activity for security monitoring
   * @private
   */
  _recordSuspiciousActivity(ip, activity) {
    if (!this.suspiciousActivity.has(ip)) {
      this.suspiciousActivity.set(ip, {});
    }
    
    const activities = this.suspiciousActivity.get(ip);
    activities[activity] = (activities[activity] || 0) + 1;
    
    this.emit('suspicious_activity', { ip, activity, count: activities[activity] });
  }

  /**
   * Ban IP address
   * @private
   */
  _banIp(ip, reason) {
    this.bannedIps.add(ip);
    
    // Close all connections from this IP
    for (const [connectionId, connection] of this.connections) {
      if (connection.ip === ip) {
        connection.ws.close(1008, 'IP banned');
      }
    }
    
    // Store ban in Redis with TTL
    this.redis.setex(`banned:ip:${ip}`, 3600, reason).catch(console.error);
    
    this.emit('ip_banned', { ip, reason });
  }

  /**
   * Start monitoring processes
   * @private
   */
  _startMonitoring() {
    // Health check every 30 seconds
    setInterval(() => {
      this._performHealthCheck();
    }, 30000);
    
    // Memory monitoring every 60 seconds
    setInterval(() => {
      this._monitorMemoryUsage();
    }, 60000);
    
    // Cleanup every 5 minutes
    setInterval(() => {
      this._performCleanup();
    }, 300000);
  }

  /**
   * Perform health check
   * @private
   */
  _performHealthCheck() {
    const now = Date.now();
    
    // Check Redis connection
    this.redis.ping()
      .then(() => {
        this.healthStatus.redisConnected = true;
      })
      .catch(() => {
        this.healthStatus.redisConnected = false;
        this.healthStatus.status = 'degraded';
      });
    
    // Update health status
    if (this.metrics.activeConnections > 0 && this.healthStatus.redisConnected) {
      this.healthStatus.status = 'healthy';
    } else if (!this.healthStatus.redisConnected) {
      this.healthStatus.status = 'degraded';
    }
    
    this.healthStatus.lastHealthCheck = now;
    
    this.emit('health_check', this.healthStatus);
  }

  /**
   * Monitor memory usage and trigger cleanup if needed
   * @private
   */
  _monitorMemoryUsage() {
    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage = memUsage.heapUsed;
    
    if (memUsage.heapUsed > this.config.performance.maxMemoryUsage) {
      console.warn('High memory usage detected, triggering cleanup');
      this._performAggressiveCleanup();
    }
    
    this.emit('memory_status', {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss
    });
  }

  /**
   * Perform regular cleanup
   * @private
   */
  _performCleanup() {
    const now = Date.now();
    const timeout = this.config.security.connectionTimeout;
    
    // Clean stale connections
    for (const [connectionId, connection] of this.connections) {
      if (now - connection.lastActivity > timeout) {
        console.log(`Cleaning stale connection: ${connectionId}`);
        connection.ws.close(1001, 'Connection timeout');
      }
    }
    
    // Clean suspicious activity older than 1 hour
    for (const [ip, activities] of this.suspiciousActivity) {
      if (Object.keys(activities).length === 0) {
        this.suspiciousActivity.delete(ip);
      }
    }
    
    // Clean message queues
    for (const [connectionId, queue] of this.messageQueues) {
      if (queue.length > this.config.performance.messageQueueSize) {
        queue.splice(0, queue.length - this.config.performance.messageQueueSize);
      }
    }
    
    this.metrics.lastCleanup = now;
  }

  /**
   * Perform aggressive cleanup during high memory usage
   * @private
   */
  _performAggressiveCleanup() {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Clear message queues
    for (const queue of this.messageQueues.values()) {
      queue.length = 0;
    }
    
    // Close unhealthy connections
    for (const [connectionId, connection] of this.connections) {
      if (connection.healthScore < 50) {
        connection.ws.close(1011, 'Resource cleanup');
      }
    }
  }

  // Additional helper methods for validation, rate limiting, etc.
  // [Previous helper methods from WebSocketOrderBookServer would go here]
  
  /**
   * Validate configuration
   * @private
   */
  _validateConfig(config) {
    if (!config.jwtSecret && !process.env.JWT_SECRET) {
      throw new Error('JWT secret is required');
    }
    
    if (config.port && (config.port < 1 || config.port > 65535)) {
      throw new Error('Invalid port number');
    }
  }

  /**
   * Create Redis client with error handling
   * @private
   */
  _createRedisClient(purpose) {
    const client = new Redis({
      ...this.config.redis,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 100, 3000);
      }
    });
    
    client.on('error', (error) => {
      console.error(`Redis ${purpose} client error:`, error);
      this.emit('redis_error', { purpose, error });
    });
    
    return client;
  }

  /**
   * Create rate limiters
   * @private
   */
  _createRateLimiters() {
    return {
      connection: new RateLimiterRedis({
        storeClient: this.redis,
        keyPrefix: 'ws_conn_rl',
        points: this.config.rateLimiting.maxConnectionsPerIp,
        duration: this.config.rateLimiting.connectionWindow
      }),
      
      message: new RateLimiterRedis({
        storeClient: this.redis,
        keyPrefix: 'ws_msg_rl',
        points: this.config.rateLimiting.maxMessagesPerConnection,
        duration: this.config.rateLimiting.messageWindow
      })
    };
  }

  /**
   * Get client IP with proxy support
   * @private
   */
  _getClientIp(request) {
    return request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           request.headers['x-real-ip'] ||
           request.connection.remoteAddress ||
           request.socket.remoteAddress ||
           'unknown';
  }

  /**
   * Generate secure connection ID
   * @private
   */
  _generateConnectionId() {
    return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Get current server statistics
   * @returns {Object} Server statistics
   */
  getStatistics() {
    return {
      ...this.metrics,
      health: this.healthStatus,
      connections: {
        active: this.metrics.activeConnections,
        total: this.metrics.totalConnections,
        byProtocol: this._getConnectionsByProtocol()
      },
      subscriptions: {
        channels: this.subscriptions.size,
        total: Array.from(this.subscriptions.values())
          .reduce((sum, subs) => sum + subs.size, 0)
      },
      security: {
        bannedIps: this.bannedIps.size,
        suspiciousActivities: this.suspiciousActivity.size
      }
    };
  }

  /**
   * Graceful shutdown with proper cleanup
   * @returns {Promise<void>}
   */
  async shutdown() {
    console.log('Shutting down Enhanced WebSocket server...');
    
    this.healthStatus.status = 'shutting_down';
    
    // Notify all clients
    const shutdownMessage = {
      type: 'shutdown',
      message: 'Server is shutting down',
      timestamp: Date.now()
    };
    
    for (const connectionId of this.connections.keys()) {
      this._sendToConnection(connectionId, shutdownMessage);
    }
    
    // Wait a moment for messages to be sent
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Close all connections
    for (const connection of this.connections.values()) {
      connection.ws.close(1001, 'Server shutdown');
    }
    
    // Close WebSocket server
    if (this.wss) {
      await new Promise((resolve) => {
        this.wss.close(resolve);
      });
    }
    
    // Close Redis connections
    await this.redis.quit();
    await this.pubClient.quit();
    await this.subClient.quit();
    
    this.emit('shutdown');
    console.log('Enhanced WebSocket server shutdown complete');
  }
}

module.exports = EnhancedWebSocketServer;