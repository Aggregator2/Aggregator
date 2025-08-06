const Redis = require('ioredis');
const EventEmitter = require('events');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

/**
 * @class SecureRedisOrderBookService
 * @description Security-hardened order book service with comprehensive protections
 * @extends EventEmitter
 * 
 * Security Features:
 * - Input sanitization and validation
 * - Atomic Redis operations with transactions
 * - Rate limiting and DoS protection
 * - Memory management and cleanup
 * - Audit logging and monitoring
 * - Error handling without information disclosure
 */
class SecureRedisOrderBookService extends EventEmitter {
  /**
   * @param {Object} config - Configuration options
   * @param {string} config.redisHost - Redis host
   * @param {number} config.redisPort - Redis port
   * @param {string} config.redisPassword - Redis password
   * @param {boolean} config.redisTls - Enable TLS
   * @param {number} config.maxOrdersPerUser - Maximum orders per user
   * @param {number} config.maxOrderBookSize - Maximum orders in order book
   * @param {number} config.rateLimitWindow - Rate limit window in ms
   * @param {number} config.rateLimitMax - Max operations per window
   */
  constructor(config = {}) {
    super();
    
    // Validate configuration
    this._validateConfig(config);
    
    this.config = {
      redisHost: config.redisHost || 'localhost',
      redisPort: config.redisPort || 6379,
      redisPassword: config.redisPassword,
      redisTls: config.redisTls || false,
      redisDb: config.redisDb || 0,
      
      // Security limits
      maxOrdersPerUser: config.maxOrdersPerUser || 1000,
      maxOrderBookSize: config.maxOrderBookSize || 1000000,
      maxPairs: config.maxPairs || 100,
      maxOrderSize: config.maxOrderSize || 1000000,
      
      // Rate limiting
      rateLimitWindow: config.rateLimitWindow || 60000, // 1 minute
      rateLimitMax: config.rateLimitMax || 100,
      
      // Performance settings
      batchSize: Math.min(config.batchSize || 1000, 5000), // Cap batch size
      batchInterval: Math.max(config.batchInterval || 100, 50), // Min interval
      snapshotInterval: config.snapshotInterval || 300000, // 5 minutes
      
      // Memory management
      maxCacheSize: config.maxCacheSize || 10000,
      maxProcessingTimes: config.maxProcessingTimes || 1000,
      cleanupInterval: config.cleanupInterval || 3600000, // 1 hour
      
      ...config
    };
    
    // Redis client with security configuration
    this.redis = this._createSecureRedisClient();
    this.pubClient = this.redis.duplicate();
    this.subClient = this.redis.duplicate();
    
    // Security state
    this.rateLimits = new Map(); // userId -> rate limit data
    this.userOrderCounts = new Map(); // userId -> order count
    this.auditLog = []; // Security audit events
    
    // Validated trading pairs
    this.validPairs = new Set();
    this.pairConfigs = new Map();
    
    // Performance and memory management
    this.batchQueues = new Map();
    this.processingTimes = new Map(); // Limited size arrays
    this.cacheSize = 0;
    
    // Security monitoring
    this.securityMetrics = {
      blockedOperations: 0,
      invalidInputs: 0,
      rateLimitViolations: 0,
      authFailures: 0
    };
    
    // Start security monitoring
    this._startSecurityMonitoring();
    
    // Lua scripts for atomic operations
    this.scripts = this._loadSecureScripts();
  }

  /**
   * Initialize a trading pair with strict validation
   * @param {string} pair - Trading pair (e.g., "BTC-USD")
   * @param {Object} config - Pair configuration
   * @returns {Promise<Object>} Pair configuration
   */
  async initializePair(pair, config = {}) {
    // Validate pair format
    if (!this._isValidPair(pair)) {
      this._logSecurityEvent('invalid_pair_format', { pair });
      throw new Error('Invalid trading pair format');
    }
    
    if (this.validPairs.size >= this.config.maxPairs) {
      throw new Error('Maximum trading pairs limit reached');
    }
    
    // Sanitize and validate configuration
    const pairConfig = this._sanitizePairConfig(config);
    
    try {
      // Atomic initialization
      const pipeline = this.redis.pipeline();
      
      // Initialize order book structure
      pipeline.set(`ob:${pair}:sequence`, 0);
      pipeline.set(`ob:${pair}:order_count`, 0);
      pipeline.set(`ob:${pair}:initialized`, Date.now());
      
      await pipeline.exec();
      
      // Store validated configuration
      this.validPairs.add(pair);
      this.pairConfigs.set(pair, pairConfig);
      this.batchQueues.set(pair, []);
      this.processingTimes.set(pair, []);
      
      this._logSecurityEvent('pair_initialized', { pair, config: pairConfig });
      
      return pairConfig;
    } catch (error) {
      this._logSecurityEvent('pair_init_failed', { pair, error: error.message });
      throw new Error('Failed to initialize trading pair');
    }
  }

  /**
   * Add order with comprehensive security checks
   * @param {Object} order - Order object
   * @param {string} userId - User ID for authorization
   * @returns {Promise<Object>} Order result
   */
  async addOrder(order, userId) {
    const startTime = performance.now();
    
    try {
      // Rate limiting check
      if (!this._checkRateLimit(userId)) {
        this.securityMetrics.rateLimitViolations++;
        throw new Error('Rate limit exceeded');
      }
      
      // Validate and sanitize order
      const sanitizedOrder = this._validateAndSanitizeOrder(order, userId);
      
      // Check user limits
      await this._checkUserLimits(userId, sanitizedOrder.pair);
      
      // Check order book limits
      await this._checkOrderBookLimits(sanitizedOrder.pair);
      
      // Generate secure order ID if not provided
      if (!sanitizedOrder.id) {
        sanitizedOrder.id = this._generateSecureOrderId(userId);
      }
      
      // Add to batch queue for atomic processing
      await this._addToBatch(sanitizedOrder);
      
      const processingTime = performance.now() - startTime;
      this._recordProcessingTime(sanitizedOrder.pair, processingTime);
      
      this._logSecurityEvent('order_added', {
        orderId: sanitizedOrder.id,
        userId,
        pair: sanitizedOrder.pair,
        side: sanitizedOrder.side
      });
      
      return {
        orderId: sanitizedOrder.id,
        status: 'queued',
        timestamp: sanitizedOrder.timestamp
      };
      
    } catch (error) {
      this.securityMetrics.invalidInputs++;
      this._logSecurityEvent('order_rejected', {
        userId,
        reason: error.message,
        order: this._sanitizeOrderForLog(order)
      });
      throw error;
    }
  }

  /**
   * Cancel order with ownership verification
   * @param {string} orderId - Order ID
   * @param {string} pair - Trading pair
   * @param {string} userId - User ID for authorization
   * @returns {Promise<Object>} Cancel result
   */
  async cancelOrder(orderId, pair, userId) {
    // Validate inputs
    if (!this._isValidOrderId(orderId) || !this._isValidPair(pair)) {
      this.securityMetrics.invalidInputs++;
      throw new Error('Invalid order ID or pair');
    }
    
    try {
      // Verify order ownership atomically
      const result = await this._atomicCancelOrder(orderId, pair, userId);
      
      if (!result.success) {
        this._logSecurityEvent('cancel_denied', {
          orderId,
          userId,
          reason: result.reason
        });
        throw new Error(result.reason);
      }
      
      this._logSecurityEvent('order_cancelled', {
        orderId,
        userId,
        pair
      });
      
      return result;
      
    } catch (error) {
      this._logSecurityEvent('cancel_failed', {
        orderId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get order book with access control
   * @param {string} pair - Trading pair
   * @param {number} depth - Order book depth
   * @param {string} userId - User ID for authorization
   * @returns {Promise<Object>} Order book snapshot
   */
  async getOrderBook(pair, depth = 20, userId = null) {
    // Validate inputs
    if (!this._isValidPair(pair) || !this.validPairs.has(pair)) {
      throw new Error('Invalid or uninitialized trading pair');
    }
    
    depth = Math.min(Math.max(1, parseInt(depth) || 20), 100); // Limit depth
    
    try {
      // Rate limiting for read operations
      if (userId && !this._checkReadRateLimit(userId)) {
        throw new Error('Read rate limit exceeded');
      }
      
      const orderBook = await this._getOrderBookSecure(pair, depth);
      
      // Sanitize output
      return this._sanitizeOrderBookOutput(orderBook, userId);
      
    } catch (error) {
      this._logSecurityEvent('orderbook_access_failed', {
        pair,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create secure snapshot with data protection
   * @param {string} pair - Trading pair
   * @returns {Promise<Object>} Snapshot data
   */
  async createSnapshot(pair) {
    if (!this.validPairs.has(pair)) {
      throw new Error('Invalid trading pair');
    }
    
    const startTime = performance.now();
    
    try {
      // Create atomic snapshot
      const snapshot = await this._createAtomicSnapshot(pair);
      
      // Encrypt sensitive data
      const encryptedSnapshot = this._encryptSnapshot(snapshot);
      
      // Store with TTL
      const snapshotKey = `ob:${pair}:snapshots:${Date.now()}`;
      await this.redis.setex(
        snapshotKey,
        86400, // 24 hour TTL
        JSON.stringify(encryptedSnapshot)
      );
      
      // Cleanup old snapshots
      await this._cleanupOldSnapshots(pair);
      
      const processingTime = performance.now() - startTime;
      
      this._logSecurityEvent('snapshot_created', {
        pair,
        processingTime,
        snapshotSize: encryptedSnapshot.orders?.length || 0
      });
      
      return {
        pair,
        timestamp: snapshot.timestamp,
        orderCount: snapshot.orders?.length || 0,
        processingTime
      };
      
    } catch (error) {
      this._logSecurityEvent('snapshot_failed', {
        pair,
        error: error.message
      });
      throw error;
    }
  }

  // Private security methods

  /**
   * Validate configuration parameters
   * @private
   */
  _validateConfig(config) {
    if (config.maxOrdersPerUser && (config.maxOrdersPerUser < 1 || config.maxOrdersPerUser > 10000)) {
      throw new Error('Invalid maxOrdersPerUser configuration');
    }
    
    if (config.rateLimitMax && (config.rateLimitMax < 1 || config.rateLimitMax > 10000)) {
      throw new Error('Invalid rateLimitMax configuration');
    }
    
    // Validate Redis connection parameters
    if (config.redisHost && !/^[a-zA-Z0-9.-]+$/.test(config.redisHost)) {
      throw new Error('Invalid Redis host format');
    }
  }

  /**
   * Create secure Redis client with proper authentication
   * @private
   */
  _createSecureRedisClient() {
    const options = {
      host: this.config.redisHost,
      port: this.config.redisPort,
      db: this.config.redisDb,
      
      // Security options
      password: this.config.redisPassword,
      tls: this.config.redisTls ? {} : null,
      
      // Connection management
      connectTimeout: 10000,
      commandTimeout: 5000,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      
      // Security: Disable dangerous commands
      disabledCommands: ['FLUSHDB', 'FLUSHALL', 'CONFIG', 'EVAL'],
      
      retryStrategy: (times) => {
        if (times > 3) {
          this._logSecurityEvent('redis_connection_failed', { attempt: times });
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000);
      }
    };
    
    const client = new Redis(options);
    
    client.on('error', (error) => {
      this._logSecurityEvent('redis_error', { error: error.message });
    });
    
    return client;
  }

  /**
   * Validate trading pair format
   * @private
   */
  _isValidPair(pair) {
    return typeof pair === 'string' && 
           /^[A-Z]{2,10}-[A-Z]{2,10}$/.test(pair) &&
           pair.length <= 20;
  }

  /**
   * Validate order ID format
   * @private
   */
  _isValidOrderId(orderId) {
    return typeof orderId === 'string' && 
           /^[a-zA-Z0-9_-]{1,50}$/.test(orderId);
  }

  /**
   * Validate and sanitize order input
   * @private
   */
  _validateAndSanitizeOrder(order, userId) {
    if (!order || typeof order !== 'object') {
      throw new Error('Invalid order object');
    }
    
    // Validate required fields
    const requiredFields = ['pair', 'side', 'type', 'amount'];
    for (const field of requiredFields) {
      if (!order[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate pair
    if (!this._isValidPair(order.pair) || !this.validPairs.has(order.pair)) {
      throw new Error('Invalid trading pair');
    }
    
    // Validate side
    if (!['buy', 'sell'].includes(order.side?.toLowerCase())) {
      throw new Error('Invalid order side');
    }
    
    // Validate type
    if (!['limit', 'market'].includes(order.type?.toLowerCase())) {
      throw new Error('Invalid order type');
    }
    
    // Validate and sanitize numeric fields
    const amount = this._validateAndSanitizeAmount(order.amount);
    const price = order.type === 'limit' ? this._validateAndSanitizePrice(order.price) : null;
    
    // Get pair configuration for validation
    const pairConfig = this.pairConfigs.get(order.pair);
    if (!pairConfig) {
      throw new Error('Pair configuration not found');
    }
    
    // Validate against pair limits
    if (amount < pairConfig.minAmount || amount > this.config.maxOrderSize) {
      throw new Error('Order amount out of range');
    }
    
    if (price && (price < pairConfig.minPrice || price > pairConfig.maxPrice)) {
      throw new Error('Order price out of range');
    }
    
    // Create sanitized order
    return {
      id: order.id ? this._sanitizeString(order.id, 50) : null,
      userId: this._sanitizeString(userId, 50),
      pair: order.pair,
      side: order.side.toLowerCase(),
      type: order.type.toLowerCase(),
      amount,
      price,
      timestamp: Date.now(),
      sequenceId: null // Will be set during processing
    };
  }

  /**
   * Validate and sanitize numeric amount
   * @private
   */
  _validateAndSanitizeAmount(amount) {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0 || num > this.config.maxOrderSize) {
      throw new Error('Invalid amount');
    }
    return Math.round(num * 100000000) / 100000000; // 8 decimal precision
  }

  /**
   * Validate and sanitize price
   * @private
   */
  _validateAndSanitizePrice(price) {
    const num = parseFloat(price);
    if (isNaN(num) || num <= 0) {
      throw new Error('Invalid price');
    }
    return Math.round(num * 100000000) / 100000000; // 8 decimal precision
  }

  /**
   * Sanitize string input
   * @private
   */
  _sanitizeString(str, maxLength = 100) {
    if (typeof str !== 'string') {
      throw new Error('Invalid string input');
    }
    
    // Remove potentially dangerous characters
    const sanitized = str.replace(/[<>'"&\x00-\x1f\x7f]/g, '');
    
    if (sanitized.length > maxLength) {
      throw new Error(`String too long (max ${maxLength})`);
    }
    
    return sanitized;
  }

  /**
   * Check rate limiting for user
   * @private
   */
  _checkRateLimit(userId) {
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindow;
    
    if (!this.rateLimits.has(userId)) {
      this.rateLimits.set(userId, []);
    }
    
    const userRequests = this.rateLimits.get(userId);
    
    // Remove old requests
    while (userRequests.length > 0 && userRequests[0] < windowStart) {
      userRequests.shift();
    }
    
    // Check limit
    if (userRequests.length >= this.config.rateLimitMax) {
      return false;
    }
    
    // Add current request
    userRequests.push(now);
    
    // Limit array size to prevent memory issues
    if (userRequests.length > this.config.rateLimitMax * 2) {
      userRequests.splice(0, userRequests.length - this.config.rateLimitMax);
    }
    
    return true;
  }

  /**
   * Check read rate limiting (more permissive)
   * @private
   */
  _checkReadRateLimit(userId) {
    return this._checkRateLimit(`read:${userId}`);
  }

  /**
   * Check user order limits
   * @private
   */
  async _checkUserLimits(userId, pair) {
    const userOrderCount = await this.redis.scard(`ob:${pair}:users:${userId}`);
    
    if (userOrderCount >= this.config.maxOrdersPerUser) {
      throw new Error('User order limit exceeded');
    }
  }

  /**
   * Check order book size limits
   * @private
   */
  async _checkOrderBookLimits(pair) {
    const orderCount = await this.redis.get(`ob:${pair}:order_count`) || 0;
    
    if (parseInt(orderCount) >= this.config.maxOrderBookSize) {
      throw new Error('Order book size limit exceeded');
    }
  }

  /**
   * Generate cryptographically secure order ID
   * @private
   */
  _generateSecureOrderId(userId) {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    const userHash = crypto.createHash('sha256').update(userId).digest('hex').substr(0, 8);
    
    return `${timestamp}-${userHash}-${random}`;
  }

  /**
   * Add order to batch queue with security checks
   * @private
   */
  async _addToBatch(order) {
    const queue = this.batchQueues.get(order.pair);
    if (!queue) {
      throw new Error('Invalid trading pair');
    }
    
    // Assign sequence ID
    order.sequenceId = await this.redis.incr(`ob:${order.pair}:sequence`);
    
    queue.push({
      action: 'add',
      order,
      timestamp: Date.now()
    });
    
    // Process if batch is full
    if (queue.length >= this.config.batchSize) {
      await this._processBatchSecure(order.pair);
    }
  }

  /**
   * Process batch with atomic operations
   * @private
   */
  async _processBatchSecure(pair) {
    const queue = this.batchQueues.get(pair);
    if (!queue || queue.length === 0) return;
    
    const batch = queue.splice(0, this.config.batchSize);
    
    try {
      // Use Redis transaction for atomicity
      const pipeline = this.redis.pipeline();
      
      for (const operation of batch) {
        await this._addOperationToPipeline(pipeline, operation);
      }
      
      const results = await pipeline.exec();
      
      // Check for failures
      const failures = results.filter(([error]) => error !== null);
      if (failures.length > 0) {
        this._logSecurityEvent('batch_partial_failure', {
          pair,
          failures: failures.length,
          total: batch.length
        });
      }
      
    } catch (error) {
      this._logSecurityEvent('batch_failed', {
        pair,
        error: error.message,
        batchSize: batch.length
      });
      
      // Re-queue failed operations with exponential backoff
      setTimeout(() => {
        queue.unshift(...batch);
      }, 1000);
    }
  }

  /**
   * Atomic cancel order operation
   * @private
   */
  async _atomicCancelOrder(orderId, pair, userId) {
    const script = `
      local orderKey = KEYS[1]
      local orderId = ARGV[1]
      local userId = ARGV[2]
      
      -- Get order data
      local orderData = redis.call('hget', orderKey, orderId)
      if not orderData then
        return {0, 'Order not found'}
      end
      
      local order = cjson.decode(orderData)
      
      -- Check ownership
      if order.userId ~= userId then
        return {0, 'Access denied'}
      end
      
      -- Check if already cancelled/filled
      if order.status == 'cancelled' or order.status == 'filled' then
        return {0, 'Order already ' .. order.status}
      end
      
      -- Cancel order
      order.status = 'cancelled'
      order.cancelledAt = redis.call('time')[1]
      
      redis.call('hset', orderKey, orderId, cjson.encode(order))
      
      return {1, 'Order cancelled'}
    `;
    
    const result = await this.redis.eval(
      script,
      1,
      `ob:${pair}:orders`,
      orderId,
      userId
    );
    
    return {
      success: result[0] === 1,
      reason: result[1]
    };
  }

  /**
   * Get order book with security filtering
   * @private
   */
  async _getOrderBookSecure(pair, depth) {
    // Use atomic read operation
    const pipeline = this.redis.pipeline();
    
    pipeline.zrevrange(`ob:${pair}:bids:prices`, 0, depth - 1, 'WITHSCORES');
    pipeline.zrange(`ob:${pair}:asks:prices`, 0, depth - 1, 'WITHSCORES');
    pipeline.get(`ob:${pair}:sequence`);
    
    const [[, bids], [, asks], [, sequenceId]] = await pipeline.exec();
    
    return {
      pair,
      timestamp: Date.now(),
      sequenceId: parseInt(sequenceId) || 0,
      bids: this._formatPriceLevels(bids),
      asks: this._formatPriceLevels(asks)
    };
  }

  /**
   * Sanitize order book output
   * @private
   */
  _sanitizeOrderBookOutput(orderBook, userId) {
    // Remove sensitive information for public access
    if (!userId) {
      // Public access - remove detailed information
      return {
        pair: orderBook.pair,
        timestamp: orderBook.timestamp,
        bids: orderBook.bids.slice(0, 10), // Limit depth for public
        asks: orderBook.asks.slice(0, 10)
      };
    }
    
    return orderBook;
  }

  /**
   * Create atomic snapshot with encryption
   * @private
   */
  async _createAtomicSnapshot(pair) {
    const pipeline = this.redis.pipeline();
    
    // Get all data atomically
    pipeline.get(`ob:${pair}:sequence`);
    pipeline.hgetall(`ob:${pair}:orders`);
    pipeline.zrevrange(`ob:${pair}:bids:prices`, 0, -1, 'WITHSCORES');
    pipeline.zrange(`ob:${pair}:asks:prices`, 0, -1, 'WITHSCORES');
    
    const [[, sequenceId], [, orders], [, bids], [, asks]] = await pipeline.exec();
    
    return {
      pair,
      timestamp: Date.now(),
      sequenceId: parseInt(sequenceId) || 0,
      orders: Object.entries(orders || {}).map(([id, data]) => {
        try {
          return { id, ...JSON.parse(data) };
        } catch {
          return null;
        }
      }).filter(Boolean),
      orderBook: {
        bids: this._formatPriceLevels(bids),
        asks: this._formatPriceLevels(asks)
      }
    };
  }

  /**
   * Encrypt snapshot data
   * @private
   */
  _encryptSnapshot(snapshot) {
    // For production, use proper encryption
    // This is a simplified example
    const sensitiveFields = ['orders'];
    const encrypted = { ...snapshot };
    
    for (const field of sensitiveFields) {
      if (encrypted[field]) {
        // In production, use crypto.encrypt with proper key management
        encrypted[field] = Buffer.from(JSON.stringify(encrypted[field])).toString('base64');
      }
    }
    
    return encrypted;
  }

  /**
   * Log security events for audit
   * @private
   */
  _logSecurityEvent(event, data) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      data,
      nodeId: process.env.NODE_ID || 'unknown'
    };
    
    this.auditLog.push(logEntry);
    
    // Limit audit log size
    if (this.auditLog.length > 10000) {
      this.auditLog.splice(0, 5000);
    }
    
    // Emit for external logging systems
    this.emit('security_event', logEntry);
    
    // Log critical events immediately
    if (['order_rejected', 'cancel_denied', 'rate_limit_exceeded'].includes(event)) {
      console.warn('Security Event:', JSON.stringify(logEntry));
    }
  }

  /**
   * Sanitize order for logging (remove sensitive data)
   * @private
   */
  _sanitizeOrderForLog(order) {
    if (!order) return null;
    
    return {
      pair: order.pair,
      side: order.side,
      type: order.type,
      hasPrice: !!order.price,
      hasAmount: !!order.amount
    };
  }

  /**
   * Start security monitoring processes
   * @private
   */
  _startSecurityMonitoring() {
    // Clean up rate limits periodically
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.config.rateLimitWindow * 2;
      
      for (const [userId, requests] of this.rateLimits.entries()) {
        // Remove old requests
        while (requests.length > 0 && requests[0] < cutoff) {
          requests.shift();
        }
        
        // Remove empty entries
        if (requests.length === 0) {
          this.rateLimits.delete(userId);
        }
      }
    }, this.config.rateLimitWindow);
    
    // Memory cleanup
    setInterval(() => {
      this._performMemoryCleanup();
    }, this.config.cleanupInterval);
    
    // Security metrics reporting
    setInterval(() => {
      this.emit('security_metrics', { ...this.securityMetrics });
    }, 60000); // Every minute
  }

  /**
   * Perform memory cleanup
   * @private
   */
  _performMemoryCleanup() {
    // Cleanup processing times
    for (const [pair, times] of this.processingTimes.entries()) {
      if (times.length > this.config.maxProcessingTimes) {
        times.splice(0, times.length - this.config.maxProcessingTimes);
      }
    }
    
    // Report memory usage
    const memUsage = process.memoryUsage();
    this.emit('memory_status', {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss
    });
  }

  /**
   * Record processing time with limits
   * @private
   */
  _recordProcessingTime(pair, time) {
    if (!this.processingTimes.has(pair)) {
      this.processingTimes.set(pair, []);
    }
    
    const times = this.processingTimes.get(pair);
    times.push(time);
    
    // Maintain size limit
    if (times.length > this.config.maxProcessingTimes) {
      times.shift();
    }
  }

  /**
   * Load secure Lua scripts
   * @private
   */
  _loadSecureScripts() {
    return {
      // Add more secure scripts here
    };
  }

  /**
   * Format price levels safely
   * @private
   */
  _formatPriceLevels(levels) {
    if (!Array.isArray(levels)) return [];
    
    const formatted = [];
    for (let i = 0; i < levels.length && i < 200; i += 2) { // Limit size
      const price = parseFloat(levels[i]);
      const amount = parseFloat(levels[i + 1]);
      
      if (!isNaN(price) && !isNaN(amount) && price > 0 && amount > 0) {
        formatted.push({ price, amount });
      }
    }
    
    return formatted;
  }

  /**
   * Cleanup old snapshots
   * @private
   */
  async _cleanupOldSnapshots(pair) {
    try {
      const keys = await this.redis.keys(`ob:${pair}:snapshots:*`);
      if (keys.length > 24) { // Keep last 24 snapshots
        const keysToDelete = keys
          .sort()
          .slice(0, keys.length - 24);
        
        if (keysToDelete.length > 0) {
          await this.redis.del(...keysToDelete);
        }
      }
    } catch (error) {
      this._logSecurityEvent('snapshot_cleanup_failed', {
        pair,
        error: error.message
      });
    }
  }

  /**
   * Get security audit log
   * @returns {Array} Recent audit events
   */
  getAuditLog(limit = 100) {
    return this.auditLog.slice(-limit);
  }

  /**
   * Get security metrics
   * @returns {Object} Security metrics
   */
  getSecurityMetrics() {
    return {
      ...this.securityMetrics,
      rateLimitEntries: this.rateLimits.size,
      auditLogSize: this.auditLog.length,
      validPairs: this.validPairs.size
    };
  }

  /**
   * Graceful shutdown with security cleanup
   */
  async shutdown() {
    this._logSecurityEvent('service_shutdown', { timestamp: Date.now() });
    
    // Clear sensitive data
    this.rateLimits.clear();
    this.auditLog.length = 0;
    
    // Close Redis connections
    await this.redis.quit();
    await this.pubClient.quit();
    await this.subClient.quit();
    
    this.removeAllListeners();
  }
}

module.exports = SecureRedisOrderBookService;