const WebSocket = require('ws');
const EventEmitter = require('events');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { RateLimiter } = require('limiter');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

/**
 * Secure WebSocket Manager with Enhanced Security Controls
 * Addresses critical vulnerabilities and implements defense-in-depth
 */
class SecureWebSocketManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate required configuration
    this.validateConfig(config);
    
    this.config = {
      port: config.port || 8080,
      maxConnections: config.maxConnections || 10000,
      heartbeatInterval: config.heartbeatInterval || 30000,
      compressionEnabled: config.compressionEnabled !== false,
      authRequired: config.authRequired !== false,
      rateLimitEnabled: config.rateLimitEnabled !== false,
      maxMessageSize: config.maxMessageSize || 64 * 1024, // 64KB
      connectionTimeout: config.connectionTimeout || 60000,
      enableOriginValidation: config.enableOriginValidation !== false,
      allowedOrigins: config.allowedOrigins || [],
      maxSubscriptionsPerConnection: config.maxSubscriptionsPerConnection || 50,
      jwtSecret: config.jwtSecret, // Required, no fallback
      encryptionKey: config.encryptionKey, // Required for data encryption
      ...config
    };
    
    this.server = null;
    this.connections = new Map(); // connectionId -> connection metadata
    this.userConnections = new Map(); // userId -> Set of connectionIds
    this.metrics = getSecureMetricsCollector();
    
    // Enhanced security controls
    this.securityConfig = {
      maxConnectionsPerIP: 100,
      connectionRateWindow: 60000, // 1 minute
      maxFailedAuthAttempts: 5,
      authFailureWindow: 300000, // 5 minutes
      blacklistDuration: 3600000, // 1 hour
      sessionTimeout: 1800000, // 30 minutes
      tokenRotationInterval: 900000, // 15 minutes
      maxMessageRate: 100, // per minute
      maxBandwidthPerConnection: 10 * 1024 * 1024, // 10MB per minute
      suspiciousActivityThreshold: 100,
      enableCSRFProtection: true,
      enableXSSProtection: true,
      requireSecureTransport: process.env.NODE_ENV === 'production'
    };
    
    // Rate limiting with multiple tiers
    this.rateLimiters = {
      connection: new Map(), // IP -> connection rate limiter
      message: new Map(),    // connectionId -> message rate limiter
      subscription: new Map(), // connectionId -> subscription rate limiter
      authentication: new Map() // IP -> auth rate limiter
    };
    
    // Security tracking
    this.securityTracking = {
      blacklistedIPs: new Set(),
      suspiciousIPs: new Map(), // IP -> suspicion score
      failedAuthAttempts: new Map(), // IP -> { count, resetTime }
      activeSessions: new Map(), // sessionId -> session data
      revokedTokens: new Set(), // Blacklisted JWTs
      connectionAttempts: new Map(), // IP -> { count, resetTime }
      suspiciousActivity: new Map() // connectionId -> activity log
    };
    
    // Input validation schemas
    this.validationSchemas = {
      message: {
        type: { type: 'string', maxLength: 50, required: true },
        data: { type: 'object', maxSize: 32 * 1024 }, // 32KB max
        timestamp: { type: 'number', min: 0 }
      },
      subscription: {
        channel: { type: 'string', maxLength: 100, required: true },
        params: { type: 'object', maxProperties: 20, maxSize: 4 * 1024 }
      },
      authentication: {
        token: { type: 'string', maxLength: 2048, required: true }
      }
    };
    
    // Secure connection metadata structure
    this.connectionDefaults = Object.freeze({
      id: null,
      ws: null,
      ip: null,
      userAgent: null,
      origin: null,
      authenticated: false,
      userId: null,
      sessionId: null,
      roles: [],
      permissions: [],
      subscriptions: null, // Will be Set
      rateLimiter: null,
      bandwidthStats: null,
      securityContext: null,
      lastActivity: 0,
      connectedAt: 0,
      authAttempts: 0,
      suspicionScore: 0,
      metadata: null // Will be Object.create(null)
    });
    
    // Performance and security stats
    this.performanceStats = {
      connectionsTotal: 0,
      connectionsActive: 0,
      connectionsRejected: 0,
      messagesProcessed: 0,
      messagesSent: 0,
      bytesTransferred: 0,
      compressionRatio: 0,
      avgLatency: 0,
      rateLimitViolations: 0,
      authenticationFailures: 0,
      authenticationSuccesses: 0,
      securityViolations: 0,
      suspiciousActivities: 0,
      blockedIPs: 0
    };
    
    // Cleanup intervals
    this.intervals = {
      heartbeat: null,
      security: null,
      metrics: null,
      session: null
    };
    
    this.initializeSecurityModules();
  }
  
  /**
   * Validate required configuration
   */
  validateConfig(config) {
    const requiredFields = ['jwtSecret', 'encryptionKey'];
    const missingFields = requiredFields.filter(field => !config[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required configuration: ${missingFields.join(', ')}`);
    }
    
    // Validate JWT secret strength
    if (config.jwtSecret && config.jwtSecret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters long');
    }
    
    // Validate encryption key
    if (config.encryptionKey && config.encryptionKey.length !== 64) {
      throw new Error('Encryption key must be exactly 64 characters (32 bytes hex)');
    }
  }
  
  /**
   * Initialize security modules
   */
  initializeSecurityModules() {
    // Set up security monitoring
    this.startSecurityMonitoring();
    
    // Initialize encryption
    this.cipher = {
      algorithm: 'aes-256-gcm',
      key: Buffer.from(this.config.encryptionKey, 'hex')
    };
    
    // Set up session management
    this.startSessionManagement();
  }
  
  /**
   * Initialize secure WebSocket server
   */
  async initialize() {
    // Validate TLS configuration for production
    if (this.securityConfig.requireSecureTransport && !this.config.server) {
      throw new Error('HTTPS server required for production deployment');
    }
    
    this.server = new WebSocket.Server({
      port: this.config.port,
      server: this.config.server,
      perMessageDeflate: this.config.compressionEnabled,
      maxPayload: this.config.maxMessageSize,
      clientTracking: false,
      verifyClient: (info) => this.verifyClient(info)
    });
    
    this.server.on('connection', (ws, request) => {
      this.handleConnection(ws, request);
    });
    
    this.server.on('error', (error) => {
      this.emit('security_error', { type: 'server_error', error: error.message });
    });
    
    // Start monitoring and cleanup tasks
    this.startMonitoringTasks();
    
    this.emit('initialized', { 
      port: this.config.port,
      securityEnabled: true,
      timestamp: Date.now()
    });
  }
  
  /**
   * Verify client connection (origin, rate limiting, etc.)
   */
  verifyClient(info) {
    const req = info.req;
    const clientIP = this.getSecureClientIP(req);
    const origin = req.headers.origin;
    const userAgent = req.headers['user-agent'];
    
    // Check if IP is blacklisted
    if (this.securityTracking.blacklistedIPs.has(clientIP)) {
      this.performanceStats.connectionsRejected++;
      return false;
    }
    
    // Validate origin if enabled
    if (this.config.enableOriginValidation && this.config.allowedOrigins.length > 0) {
      if (!origin || !this.config.allowedOrigins.includes(origin)) {
        this.logSecurityEvent('invalid_origin', { clientIP, origin });
        return false;
      }
    }
    
    // Check connection rate limiting per IP
    if (!this.checkConnectionRateLimit(clientIP)) {
      this.performanceStats.connectionsRejected++;
      return false;
    }
    
    // Check user agent (basic bot detection)
    if (!userAgent || userAgent.length > 500) {
      this.logSecurityEvent('suspicious_user_agent', { clientIP, userAgent });
      return false;
    }
    
    return true;
  }
  
  /**
   * Get secure client IP with validation
   */
  getSecureClientIP(request) {
    // Only trust proxy headers if explicitly configured
    if (this.config.trustProxy) {
      const forwardedFor = request.headers['x-forwarded-for'];
      const realIP = request.headers['x-real-ip'];
      
      if (forwardedFor) {
        // Take the first IP in chain (original client)
        const ips = forwardedFor.split(',').map(ip => ip.trim());
        return this.validateIPAddress(ips[0]);
      }
      
      if (realIP) {
        return this.validateIPAddress(realIP);
      }
    }
    
    // Fall back to direct connection IP
    const directIP = request.connection?.remoteAddress || 
                    request.socket?.remoteAddress ||
                    '127.0.0.1';
    
    return this.validateIPAddress(directIP);
  }
  
  /**
   * Validate IP address format
   */
  validateIPAddress(ip) {
    // IPv4 regex
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    // IPv6 regex (simplified)
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    if (ipv4Regex.test(ip) || ipv6Regex.test(ip)) {
      return ip;
    }
    
    this.logSecurityEvent('invalid_ip_format', { ip });
    return '0.0.0.0'; // Safe fallback
  }
  
  /**
   * Handle new WebSocket connection with security checks
   */
  async handleConnection(ws, request) {
    const clientIP = this.getSecureClientIP(request);
    const connectionId = this.generateSecureConnectionId();
    const userAgent = request.headers['user-agent'];
    const origin = request.headers.origin;
    
    // Check max connections limit
    if (this.connections.size >= this.config.maxConnections) {
      ws.close(1013, 'Server at capacity');
      this.performanceStats.connectionsRejected++;
      return;
    }
    
    // Create secure connection object
    const connection = this.createSecureConnection({
      id: connectionId,
      ws: ws,
      ip: clientIP,
      userAgent: userAgent,
      origin: origin,
      connectedAt: Date.now(),
      lastActivity: Date.now()
    });
    
    // Store connection
    this.connections.set(connectionId, connection);
    this.performanceStats.connectionsTotal++;
    this.performanceStats.connectionsActive++;
    
    // Set up connection handlers
    this.setupSecureConnectionHandlers(ws, connection);
    
    // Send secure welcome message
    this.sendSecureWelcomeMessage(connection);
    
    // Start connection security monitoring
    this.monitorConnection(connection);
    
    this.emit('secure_connection', { 
      connectionId, 
      clientIP, 
      userAgent: userAgent?.substring(0, 100), // Truncate for logging
      timestamp: Date.now()
    });
  }
  
  /**
   * Create secure connection object
   */
  createSecureConnection(data) {
    const connection = Object.create(null);
    
    // Copy default structure
    Object.keys(this.connectionDefaults).forEach(key => {
      if (key === 'subscriptions') {
        connection[key] = new Set();
      } else if (key === 'metadata') {
        connection[key] = Object.create(null);
      } else if (key === 'securityContext') {
        connection[key] = {
          authAttempts: 0,
          suspicionScore: 0,
          lastSecurityEvent: null,
          securityFlags: new Set()
        };
      } else if (key === 'bandwidthStats') {
        connection[key] = {
          bytesSent: 0,
          bytesReceived: 0,
          messagesSent: 0,
          messagesReceived: 0,
          compressionSavings: 0,
          lastReset: Date.now()
        };
      } else {
        connection[key] = this.connectionDefaults[key];
      }
    });
    
    // Set provided data
    Object.keys(data).forEach(key => {
      if (key in this.connectionDefaults) {
        connection[key] = data[key];
      }
    });
    
    // Create secure rate limiter
    connection.rateLimiter = new RateLimiter({
      tokensPerInterval: this.securityConfig.maxMessageRate,
      interval: 'minute'
    });
    
    return connection;
  }
  
  /**
   * Generate cryptographically secure connection ID
   */
  generateSecureConnectionId() {
    const timestamp = Date.now().toString(36);
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256')
      .update(timestamp + randomBytes + process.hrtime.bigint().toString())
      .digest('hex');
    
    return `conn_${timestamp}_${hash.substring(0, 32)}`;
  }
  
  /**
   * Set up secure connection event handlers
   */
  setupSecureConnectionHandlers(ws, connection) {
    // Message handler with security validation
    ws.on('message', async (data) => {
      try {
        await this.handleSecureMessage(connection, data);
      } catch (error) {
        this.handleConnectionSecurityError(connection, error, 'message_error');
      }
    });
    
    // Close handler with cleanup
    ws.on('close', (code, reason) => {
      this.handleSecureDisconnection(connection, code, reason);
    });
    
    // Error handler
    ws.on('error', (error) => {
      this.handleConnectionSecurityError(connection, error, 'websocket_error');
    });
    
    // Pong handler for heartbeat
    ws.on('pong', () => {
      connection.lastActivity = Date.now();
    });
    
    // Set connection timeout
    setTimeout(() => {
      if (!connection.authenticated && ws.readyState === WebSocket.OPEN) {
        ws.close(1008, 'Authentication timeout');
        this.logSecurityEvent('auth_timeout', { connectionId: connection.id });
      }
    }, this.config.connectionTimeout);
  }
  
  /**
   * Handle incoming message with comprehensive security validation
   */
  async handleSecureMessage(connection, data) {
    const startTime = Date.now();
    
    // Update activity tracking
    connection.lastActivity = Date.now();
    
    // Check message size
    if (data.length > this.config.maxMessageSize) {
      throw new Error('Message too large');
    }
    
    // Rate limiting check
    if (!connection.rateLimiter.tryRemoveTokens(1)) {
      this.performanceStats.rateLimitViolations++;
      throw new Error('Rate limit exceeded');
    }
    
    // Parse and validate message
    let message;
    try {
      message = this.parseSecureMessage(data);
    } catch (error) {
      throw new Error(`Invalid message format: ${error.message}`);
    }
    
    // Validate message structure
    this.validateMessageStructure(message, this.validationSchemas.message);
    
    // Update bandwidth tracking
    this.updateSecureBandwidthTracking(connection, data.length);
    
    // Check bandwidth limits
    if (this.checkBandwidthExceeded(connection)) {
      throw new Error('Bandwidth limit exceeded');
    }
    
    // Process message based on type
    await this.processSecureMessage(connection, message);
    
    // Update performance stats
    this.performanceStats.messagesProcessed++;
    this.performanceStats.avgLatency = this.updateRunningAverage(
      this.performanceStats.avgLatency,
      Date.now() - startTime,
      this.performanceStats.messagesProcessed
    );
  }
  
  /**
   * Parse message with security validation
   */
  parseSecureMessage(data) {
    // Prevent JSON bombs
    if (data.length > this.config.maxMessageSize) {
      throw new Error('Message too large');
    }
    
    // Parse with error handling
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      throw new Error('Invalid JSON');
    }
    
    // Basic structure validation
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Message must be object');
    }
    
    // Prevent prototype pollution
    if ('__proto__' in parsed || 'constructor' in parsed || 'prototype' in parsed) {
      throw new Error('Malicious object structure detected');
    }
    
    return parsed;
  }
  
  /**
   * Validate message structure against schema
   */
  validateMessageStructure(message, schema) {
    Object.keys(schema).forEach(field => {
      const rules = schema[field];
      const value = message[field];
      
      // Check required fields
      if (rules.required && (value === undefined || value === null)) {
        throw new Error(`Missing required field: ${field}`);
      }
      
      if (value !== undefined) {
        // Type validation
        if (rules.type && typeof value !== rules.type) {
          throw new Error(`Invalid type for ${field}: expected ${rules.type}`);
        }
        
        // String validations
        if (rules.type === 'string') {
          if (rules.maxLength && value.length > rules.maxLength) {
            throw new Error(`String too long for ${field}: max ${rules.maxLength}`);
          }
          
          // XSS prevention
          if (this.containsSuspiciousContent(value)) {
            throw new Error(`Suspicious content detected in ${field}`);
          }
        }
        
        // Number validations
        if (rules.type === 'number') {
          if (rules.min !== undefined && value < rules.min) {
            throw new Error(`Number too small for ${field}: min ${rules.min}`);
          }
          if (rules.max !== undefined && value > rules.max) {
            throw new Error(`Number too large for ${field}: max ${rules.max}`);
          }
        }
        
        // Object validations
        if (rules.type === 'object') {
          if (rules.maxProperties && Object.keys(value).length > rules.maxProperties) {
            throw new Error(`Too many properties in ${field}: max ${rules.maxProperties}`);
          }
          
          if (rules.maxSize) {
            const serialized = JSON.stringify(value);
            if (serialized.length > rules.maxSize) {
              throw new Error(`Object too large for ${field}: max ${rules.maxSize} bytes`);
            }
          }
        }
      }
    });
  }
  
  /**
   * Check for suspicious content (XSS, injection attempts)
   */
  containsSuspiciousContent(content) {
    const suspiciousPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /vbscript:/gi,
      /onload\s*=/gi,
      /onerror\s*=/gi,
      /onclick\s*=/gi,
      /eval\s*\(/gi,
      /expression\s*\(/gi,
      /url\s*\(/gi,
      /import\s*\(/gi
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(content));
  }
  
  /**
   * Process secure message based on type
   */
  async processSecureMessage(connection, message) {
    switch (message.type) {
      case 'authenticate':
        await this.handleSecureAuthentication(connection, message);
        break;
        
      case 'subscribe':
        await this.handleSecureSubscription(connection, message);
        break;
        
      case 'unsubscribe':
        await this.handleSecureUnsubscription(connection, message);
        break;
        
      case 'ping':
        this.sendSecureMessage(connection, {
          type: 'pong',
          timestamp: Date.now()
        });
        break;
        
      case 'heartbeat':
        connection.lastActivity = Date.now();
        break;
        
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }
  
  /**
   * Handle secure authentication with enhanced validation
   */
  async handleSecureAuthentication(connection, message) {
    // Validate authentication message
    this.validateMessageStructure(message, this.validationSchemas.authentication);
    
    // Check authentication rate limiting
    if (!this.checkAuthenticationRateLimit(connection.ip)) {
      connection.securityContext.authAttempts++;
      throw new Error('Authentication rate limit exceeded');
    }
    
    const { token } = message;
    
    // Check if token is blacklisted
    if (this.securityTracking.revokedTokens.has(token)) {
      this.logSecurityEvent('revoked_token_used', { 
        connectionId: connection.id,
        ip: connection.ip 
      });
      throw new Error('Token has been revoked');
    }
    
    try {
      // Verify JWT with proper secret
      const decoded = jwt.verify(token, this.config.jwtSecret, {
        algorithms: ['HS256', 'HS384', 'HS512'], // Explicit algorithm whitelist
        maxAge: '24h', // Maximum token age
        clockTolerance: 30 // 30 second clock skew tolerance
      });
      
      // Validate token structure
      this.validateTokenClaims(decoded);
      
      // Check token freshness
      if (this.isTokenStale(decoded)) {
        throw new Error('Token is stale, please refresh');
      }
      
      // Update connection with authentication
      connection.authenticated = true;
      connection.userId = decoded.userId;
      connection.roles = decoded.roles || [];
      connection.permissions = decoded.permissions || [];
      connection.sessionId = this.generateSecureSessionId();
      
      // Store session
      this.securityTracking.activeSessions.set(connection.sessionId, {
        connectionId: connection.id,
        userId: connection.userId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        roles: connection.roles,
        permissions: connection.permissions
      });
      
      // Track user connections
      if (!this.userConnections.has(connection.userId)) {
        this.userConnections.set(connection.userId, new Set());
      }
      this.userConnections.get(connection.userId).add(connection.id);
      
      // Send success response
      this.sendSecureMessage(connection, {
        type: 'auth_success',
        userId: connection.userId,
        sessionId: connection.sessionId,
        permissions: connection.permissions,
        expiresAt: Date.now() + this.securityConfig.sessionTimeout
      });
      
      this.performanceStats.authenticationSuccesses++;
      
      this.emit('secure_authentication', {
        connectionId: connection.id,
        userId: connection.userId,
        ip: connection.ip
      });
      
    } catch (error) {
      // Track failed authentication
      connection.securityContext.authAttempts++;
      this.trackFailedAuthentication(connection.ip);
      this.performanceStats.authenticationFailures++;
      
      this.logSecurityEvent('auth_failure', {
        connectionId: connection.id,
        ip: connection.ip,
        error: error.message,
        attempts: connection.securityContext.authAttempts
      });
      
      throw new Error('Authentication failed');
    }
  }
  
  /**
   * Validate JWT token claims
   */
  validateTokenClaims(decoded) {
    const requiredClaims = ['userId', 'iat', 'exp'];
    
    requiredClaims.forEach(claim => {
      if (!(claim in decoded)) {
        throw new Error(`Missing required claim: ${claim}`);
      }
    });
    
    // Validate user ID format
    if (typeof decoded.userId !== 'string' || decoded.userId.length === 0) {
      throw new Error('Invalid userId format');
    }
    
    // Validate timestamps
    if (typeof decoded.iat !== 'number' || typeof decoded.exp !== 'number') {
      throw new Error('Invalid timestamp claims');
    }
    
    if (decoded.exp <= decoded.iat) {
      throw new Error('Invalid token expiration');
    }
  }
  
  /**
   * Check if token is stale (approaching expiration)
   */
  isTokenStale(decoded) {
    const now = Math.floor(Date.now() / 1000);
    const timeToExpiry = decoded.exp - now;
    
    // Token is stale if it expires within 5 minutes
    return timeToExpiry < 300;
  }
  
  /**
   * Generate secure session ID
   */
  generateSecureSessionId() {
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(32);
    const sessionData = Buffer.concat([
      Buffer.from(timestamp.toString()),
      randomBytes
    ]);
    
    return crypto.createHash('sha256').update(sessionData).digest('hex');
  }
  
  /**
   * Track failed authentication attempts
   */
  trackFailedAuthentication(ip) {
    const now = Date.now();
    const attempts = this.securityTracking.failedAuthAttempts.get(ip) || {
      count: 0,
      resetTime: now + this.securityConfig.authFailureWindow
    };
    
    if (now > attempts.resetTime) {
      attempts.count = 0;
      attempts.resetTime = now + this.securityConfig.authFailureWindow;
    }
    
    attempts.count++;
    this.securityTracking.failedAuthAttempts.set(ip, attempts);
    
    // Blacklist IP if too many failures
    if (attempts.count >= this.securityConfig.maxFailedAuthAttempts) {
      this.blacklistIP(ip, 'excessive_auth_failures');
    }
  }
  
  /**
   * Check authentication rate limiting
   */
  checkAuthenticationRateLimit(ip) {
    if (!this.rateLimiters.authentication.has(ip)) {
      this.rateLimiters.authentication.set(ip, new RateLimiter({
        tokensPerInterval: 10, // 10 auth attempts per minute
        interval: 'minute'
      }));
    }
    
    return this.rateLimiters.authentication.get(ip).tryRemoveTokens(1);
  }
  
  /**
   * Check connection rate limiting
   */
  checkConnectionRateLimit(ip) {
    const now = Date.now();
    const attempts = this.securityTracking.connectionAttempts.get(ip) || {
      count: 0,
      resetTime: now + this.securityConfig.connectionRateWindow
    };
    
    if (now > attempts.resetTime) {
      attempts.count = 0;
      attempts.resetTime = now + this.securityConfig.connectionRateWindow;
    }
    
    attempts.count++;
    this.securityTracking.connectionAttempts.set(ip, attempts);
    
    if (attempts.count > this.securityConfig.maxConnectionsPerIP) {
      this.blacklistIP(ip, 'excessive_connections');
      return false;
    }
    
    return true;
  }
  
  /**
   * Blacklist IP address
   */
  blacklistIP(ip, reason) {
    this.securityTracking.blacklistedIPs.add(ip);
    this.performanceStats.blockedIPs++;
    
    this.logSecurityEvent('ip_blacklisted', { ip, reason });
    
    // Auto-remove after blacklist duration
    setTimeout(() => {
      this.securityTracking.blacklistedIPs.delete(ip);
      this.logSecurityEvent('ip_unblacklisted', { ip });
    }, this.securityConfig.blacklistDuration);
  }
  
  /**
   * Send secure message with encryption option
   */
  sendSecureMessage(connection, message, options = {}) {
    if (!connection.ws || connection.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    
    try {
      let messageData = JSON.stringify(message);
      
      // Encrypt sensitive data if requested
      if (options.encrypt && this.cipher) {
        messageData = this.encryptMessage(messageData);
      }
      
      connection.ws.send(messageData);
      
      // Update bandwidth tracking
      connection.bandwidthStats.bytesSent += Buffer.byteLength(messageData);
      connection.bandwidthStats.messagesSent++;
      this.performanceStats.messagesSent++;
      
      return true;
    } catch (error) {
      this.handleConnectionSecurityError(connection, error, 'send_error');
      return false;
    }
  }
  
  /**
   * Encrypt message data
   */
  encryptMessage(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.cipher.algorithm, this.cipher.key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
      encrypted: true,
      data: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    });
  }
  
  /**
   * Handle connection security errors
   */
  handleConnectionSecurityError(connection, error, type) {
    // Increase suspicion score
    connection.securityContext.suspicionScore += 10;
    connection.securityContext.lastSecurityEvent = { type, error: error.message, timestamp: Date.now() };
    
    this.performanceStats.securityViolations++;
    
    this.logSecurityEvent('connection_security_error', {
      connectionId: connection.id,
      ip: connection.ip,
      type: type,
      error: error.message,
      suspicionScore: connection.securityContext.suspicionScore
    });
    
    // Take action based on suspicion score
    if (connection.securityContext.suspicionScore >= this.securityConfig.suspiciousActivityThreshold) {
      this.handleSuspiciousConnection(connection);
    }
    
    this.emit('security_violation', {
      connectionId: connection.id,
      type: type,
      error: error.message
    });
  }
  
  /**
   * Handle suspicious connection
   */
  handleSuspiciousConnection(connection) {
    // Close connection
    if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.close(1008, 'Suspicious activity detected');
    }
    
    // Blacklist IP
    this.blacklistIP(connection.ip, 'suspicious_activity');
    
    // Log security incident
    this.logSecurityEvent('suspicious_connection_terminated', {
      connectionId: connection.id,
      ip: connection.ip,
      userId: connection.userId,
      suspicionScore: connection.securityContext.suspicionScore,
      securityEvents: connection.securityContext.lastSecurityEvent
    });
    
    this.performanceStats.suspiciousActivities++;
  }
  
  /**
   * Update secure bandwidth tracking
   */
  updateSecureBandwidthTracking(connection, bytes) {
    const now = Date.now();
    const stats = connection.bandwidthStats;
    
    // Reset counter every minute
    if (now - stats.lastReset > 60000) {
      stats.bytesReceived = 0;
      stats.messagesReceived = 0;
      stats.lastReset = now;
    }
    
    stats.bytesReceived += bytes;
    stats.messagesReceived++;
  }
  
  /**
   * Check if bandwidth limit exceeded
   */
  checkBandwidthExceeded(connection) {
    const stats = connection.bandwidthStats;
    return stats.bytesReceived > this.securityConfig.maxBandwidthPerConnection;
  }
  
  /**
   * Log security events
   */
  logSecurityEvent(eventType, data) {
    const securityEvent = {
      type: eventType,
      timestamp: Date.now(),
      severity: this.getEventSeverity(eventType),
      ...data
    };
    
    // Emit for external logging systems
    this.emit('security_event', securityEvent);
    
    // Store in metrics
    this.metrics?.recordSecurityEvent?.(securityEvent);
  }
  
  /**
   * Get event severity level
   */
  getEventSeverity(eventType) {
    const severityMap = {
      'auth_failure': 'medium',
      'auth_timeout': 'medium',
      'invalid_origin': 'high',
      'suspicious_user_agent': 'medium',
      'rate_limit_exceeded': 'medium',
      'ip_blacklisted': 'high',
      'suspicious_connection_terminated': 'critical',
      'revoked_token_used': 'critical',
      'malicious_content_detected': 'high'
    };
    
    return severityMap[eventType] || 'low';
  }
  
  /**
   * Start security monitoring tasks
   */
  startSecurityMonitoring() {
    this.intervals.security = setInterval(() => {
      this.performSecurityChecks();
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Start session management
   */
  startSessionManagement() {
    this.intervals.session = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Every minute
  }
  
  /**
   * Start monitoring tasks
   */
  startMonitoringTasks() {
    // Heartbeat for connection health
    this.intervals.heartbeat = setInterval(() => {
      this.performHeartbeat();
    }, this.config.heartbeatInterval);
    
    // Metrics collection
    this.intervals.metrics = setInterval(() => {
      this.collectMetrics();
    }, 60000); // Every minute
  }
  
  /**
   * Perform security checks
   */
  performSecurityChecks() {
    const now = Date.now();
    
    // Check for stale connections
    for (const [connectionId, connection] of this.connections) {
      if (now - connection.lastActivity > this.securityConfig.sessionTimeout) {
        this.terminateStaleConnection(connection);
      }
    }
    
    // Clean up old tracking data
    this.cleanupSecurityTracking();
  }
  
  /**
   * Terminate stale connection
   */
  terminateStaleConnection(connection) {
    if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.close(1001, 'Session timeout');
    }
    
    this.logSecurityEvent('session_timeout', {
      connectionId: connection.id,
      userId: connection.userId,
      lastActivity: connection.lastActivity
    });
  }
  
  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    
    for (const [sessionId, session] of this.securityTracking.activeSessions) {
      if (now - session.lastActivity > this.securityConfig.sessionTimeout) {
        this.securityTracking.activeSessions.delete(sessionId);
        
        this.logSecurityEvent('session_expired', {
          sessionId: sessionId,
          userId: session.userId
        });
      }
    }
  }
  
  /**
   * Clean up security tracking data
   */
  cleanupSecurityTracking() {
    const now = Date.now();
    
    // Clean up failed auth attempts
    for (const [ip, attempts] of this.securityTracking.failedAuthAttempts) {
      if (now > attempts.resetTime) {
        this.securityTracking.failedAuthAttempts.delete(ip);
      }
    }
    
    // Clean up connection attempts
    for (const [ip, attempts] of this.securityTracking.connectionAttempts) {
      if (now > attempts.resetTime) {
        this.securityTracking.connectionAttempts.delete(ip);
      }
    }
  }
  
  /**
   * Perform heartbeat check
   */
  performHeartbeat() {
    const now = Date.now();
    
    for (const [connectionId, connection] of this.connections) {
      if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
        // Check if connection is stale
        if (now - connection.lastActivity > this.config.heartbeatInterval * 2) {
          connection.ws.close(1001, 'Connection timeout');
          continue;
        }
        
        // Send ping
        connection.ws.ping();
      }
    }
  }
  
  /**
   * Collect performance metrics
   */
  collectMetrics() {
    const stats = {
      ...this.performanceStats,
      memoryUsage: process.memoryUsage(),
      connectionsActive: this.connections.size,
      activeSessions: this.securityTracking.activeSessions.size,
      blacklistedIPs: this.securityTracking.blacklistedIPs.size,
      timestamp: Date.now()
    };
    
    this.emit('metrics_collected', stats);
  }
  
  /**
   * Handle secure disconnection
   */
  handleSecureDisconnection(connection, code, reason) {
    // Clean up connection data
    this.connections.delete(connection.id);
    
    // Clean up user connections
    if (connection.userId) {
      const userConnections = this.userConnections.get(connection.userId);
      if (userConnections) {
        userConnections.delete(connection.id);
        if (userConnections.size === 0) {
          this.userConnections.delete(connection.userId);
        }
      }
    }
    
    // Clean up session
    if (connection.sessionId) {
      this.securityTracking.activeSessions.delete(connection.sessionId);
    }
    
    // Update stats
    this.performanceStats.connectionsActive--;
    
    this.emit('secure_disconnection', {
      connectionId: connection.id,
      userId: connection.userId,
      code: code,
      reason: reason,
      duration: Date.now() - connection.connectedAt
    });
  }
  
  /**
   * Send secure welcome message
   */
  sendSecureWelcomeMessage(connection) {
    this.sendSecureMessage(connection, {
      type: 'welcome',
      connectionId: connection.id,
      timestamp: Date.now(),
      serverTime: new Date().toISOString(),
      requiresAuth: this.config.authRequired,
      securityEnabled: true,
      sessionTimeout: this.securityConfig.sessionTimeout,
      rateLimits: {
        messages: this.securityConfig.maxMessageRate,
        bandwidth: this.securityConfig.maxBandwidthPerConnection
      }
    });
  }
  
  /**
   * Update running average
   */
  updateRunningAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Get comprehensive statistics
   */
  getSecureStats() {
    return {
      performance: this.performanceStats,
      security: {
        blacklistedIPs: this.securityTracking.blacklistedIPs.size,
        activeSessions: this.securityTracking.activeSessions.size,
        revokedTokens: this.securityTracking.revokedTokens.size,
        suspiciousIPs: this.securityTracking.suspiciousIPs.size
      },
      connections: {
        active: this.connections.size,
        userConnections: this.userConnections.size
      },
      system: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
  }
  
  /**
   * Shutdown with cleanup
   */
  async shutdown() {
    // Clear all intervals
    Object.values(this.intervals).forEach(interval => {
      if (interval) clearInterval(interval);
    });
    
    // Close all connections
    for (const connection of this.connections.values()) {
      if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close(1001, 'Server shutting down');
      }
    }
    
    // Close server
    if (this.server) {
      this.server.close();
    }
    
    // Clear tracking data
    this.connections.clear();
    this.userConnections.clear();
    this.securityTracking.activeSessions.clear();
    this.securityTracking.blacklistedIPs.clear();
    
    this.emit('secure_shutdown');
  }
}

module.exports = SecureWebSocketManager;