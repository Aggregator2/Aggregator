const EventEmitter = require('events');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');

// Promisify compression functions for better error handling
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);
const deflateAsync = promisify(zlib.deflate);
const inflateAsync = promisify(zlib.inflate);
const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);

/**
 * Secure Bandwidth Optimizer with Enhanced Security and Performance
 * Addresses vulnerabilities and implements advanced optimization techniques
 */
class SecureBandwidthOptimizer extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate configuration
    this.validateConfig(config);
    
    this.config = {
      compressionEnabled: config.compressionEnabled !== false,
      compressionThreshold: Math.max(config.compressionThreshold || 1024, 512), // Min 512 bytes
      compressionLevel: Math.min(Math.max(config.compressionLevel || 6, 1), 9), // 1-9 range
      enableDeduplication: config.enableDeduplication !== false,
      deduplicationWindow: Math.min(config.deduplicationWindow || 60000, 300000), // Max 5 minutes
      enableBatching: config.enableBatching !== false,
      batchInterval: Math.max(config.batchInterval || 50, 10), // Min 10ms
      maxBatchSize: Math.min(config.maxBatchSize || 100, 1000), // Max 1000 messages
      enableDeltaCompression: config.enableDeltaCompression !== false,
      adaptiveStreaming: config.adaptiveStreaming !== false,
      maxCacheSize: config.maxCacheSize || 10000, // Limit cache size
      maxMessageSize: config.maxMessageSize || 1024 * 1024, // 1MB max
      encryptionKey: config.encryptionKey, // For secure hashing
      bandwidthThresholds: {
        low: Math.max(config.bandwidthThresholds?.low || 100 * 1024, 50 * 1024),
        medium: Math.max(config.bandwidthThresholds?.medium || 500 * 1024, 200 * 1024),
        high: Math.max(config.bandwidthThresholds?.high || 1024 * 1024, 500 * 1024)
      },
      ...config
    };
    
    // Secure message processing with bounded collections
    this.messageQueue = new Map(); // connectionId -> bounded message queue
    this.batchTimers = new Map();  // connectionId -> batch timer
    this.compressionCache = new LRUCache(this.config.maxCacheSize);
    this.deduplicationCache = new LRUCache(this.config.maxCacheSize);
    
    // Delta compression state with security
    this.deltaStates = new Map(); // connectionId -> secure delta state
    this.deltaPatches = new Map(); // connectionId -> bounded patch history
    
    // Enhanced connection tracking with limits
    this.connectionTracking = new Map(); // connectionId -> secure tracking data
    this.adaptiveSettings = new Map(); // connectionId -> adaptive settings
    
    // Security controls
    this.securityConfig = {
      maxConnectionsTracked: 50000,
      maxQueueSize: 1000,
      maxDeltaHistory: 100,
      compressionTimeoutMs: 5000,
      maxCompressionConcurrency: 10,
      enableIntegrityChecks: true,
      hashAlgorithm: 'sha256',
      maxHashSize: 32 // bytes
    };
    
    // Performance tracking with security metrics
    this.performanceStats = {
      messagesProcessed: 0,
      bytesOriginal: 0,
      bytesCompressed: 0,
      compressionRatio: 0,
      duplicatesFiltered: 0,
      batchesSent: 0,
      deltasPatchesGenerated: 0,
      bandwidthSaved: 0,
      avgCompressionTime: 0,
      securityViolations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      compressionErrors: 0,
      memoryUsage: 0
    };
    
    // Secure compression algorithms with validation
    this.compressionAlgorithms = {
      gzip: {
        compress: this.secureGzipCompress.bind(this),
        decompress: this.secureGzipDecompress.bind(this),
        level: this.config.compressionLevel,
        maxRatio: 0.01 // Minimum compression ratio to prevent bombs
      },
      deflate: {
        compress: this.secureDeflateCompress.bind(this),
        decompress: this.secureDeflateDecompress.bind(this),
        level: this.config.compressionLevel,
        maxRatio: 0.01
      },
      brotli: {
        compress: this.secureBrotliCompress.bind(this),
        decompress: this.secureBrotliDecompress.bind(this),
        level: this.config.compressionLevel,
        maxRatio: 0.01
      }
    };
    
    // Message patterns with security validation
    this.messagePatterns = Object.freeze({
      orderbook: {
        compressionAlgorithm: 'gzip',
        enableDelta: true,
        batchable: true,
        maxSize: 512 * 1024, // 512KB
        deduplicationKey: this.secureOrderbookKey.bind(this),
        validator: this.validateOrderbookMessage.bind(this)
      },
      ticker: {
        compressionAlgorithm: 'deflate',
        enableDelta: false,
        batchable: true,
        maxSize: 64 * 1024, // 64KB
        deduplicationKey: this.secureTickerKey.bind(this),
        validator: this.validateTickerMessage.bind(this)
      },
      trades: {
        compressionAlgorithm: 'gzip',
        enableDelta: false,
        batchable: true,
        maxSize: 128 * 1024, // 128KB
        deduplicationKey: this.secureTradeKey.bind(this),
        validator: this.validateTradeMessage.bind(this)
      },
      user_orders: {
        compressionAlgorithm: 'gzip',
        enableDelta: true,
        batchable: false,
        maxSize: 256 * 1024, // 256KB
        deduplicationKey: this.secureUserOrderKey.bind(this),
        validator: this.validateUserOrderMessage.bind(this)
      }
    });
    
    // Compression semaphore for concurrency control
    this.compressionSemaphore = new Semaphore(this.securityConfig.maxCompressionConcurrency);
    
    // Initialize secure components
    this.initializeSecureComponents();
    this.startCleanupTasks();
  }
  
  /**
   * Validate configuration for security
   */
  validateConfig(config) {
    // Validate required security parameters
    if (config.encryptionKey && typeof config.encryptionKey !== 'string') {
      throw new Error('Encryption key must be a string');
    }
    
    // Validate numeric limits
    const numericConfigs = [
      'compressionThreshold', 'compressionLevel', 'deduplicationWindow',
      'batchInterval', 'maxBatchSize', 'maxCacheSize', 'maxMessageSize'
    ];
    
    numericConfigs.forEach(key => {
      if (config[key] !== undefined && (!Number.isInteger(config[key]) || config[key] < 0)) {
        throw new Error(`${key} must be a positive integer`);
      }
    });
  }
  
  /**
   * Initialize secure components
   */
  initializeSecureComponents() {
    // Initialize secure hash function
    this.secureHash = this.config.encryptionKey 
      ? this.createHMACHash.bind(this)
      : this.createSecureHash.bind(this);
    
    // Set up memory monitoring
    this.startMemoryMonitoring();
  }
  
  /**
   * Process message with comprehensive security validation
   */
  async processMessage(connectionId, message, options = {}) {
    const startTime = Date.now();
    
    try {
      // Validate inputs
      this.validateProcessingInputs(connectionId, message, options);
      
      // Parse message safely
      const messageObj = this.parseMessageSecurely(message);
      const messageType = messageObj.type;
      const pattern = this.messagePatterns[messageType];
      
      if (!pattern) {
        throw new SecurityError(`Unknown message type: ${messageType}`);
      }
      
      // Validate message against pattern
      if (pattern.validator && !pattern.validator(messageObj)) {
        throw new SecurityError(`Message validation failed for type: ${messageType}`);
      }
      
      // Check message size limits
      const messageSize = this.calculateMessageSize(messageObj);
      if (messageSize > pattern.maxSize) {
        throw new SecurityError(`Message too large: ${messageSize} > ${pattern.maxSize}`);
      }
      
      // Update connection tracking securely
      this.updateSecureConnectionTracking(connectionId, messageSize);
      
      // Get adaptive settings with security bounds
      const adaptiveSettings = this.getSecureAdaptiveSettings(connectionId);
      const finalOptions = { ...options, ...adaptiveSettings };
      
      // Process with security checks
      let optimizedMessage = messageObj;
      
      // 1. Secure deduplication
      if (this.config.enableDeduplication && pattern.deduplicationKey) {
        const isDuplicate = await this.checkSecureDeduplication(messageObj, pattern);
        if (isDuplicate) {
          this.performanceStats.duplicatesFiltered++;
          return { skipped: true, reason: 'duplicate' };
        }
      }
      
      // 2. Secure delta compression
      if (this.config.enableDeltaCompression && pattern.enableDelta && finalOptions.enableDelta !== false) {
        const deltaResult = await this.generateSecureDelta(connectionId, messageObj, messageType);
        if (deltaResult && deltaResult.savesBandwidth) {
          optimizedMessage = deltaResult.delta;
          this.performanceStats.deltasPatchesGenerated++;
        }
      }
      
      // 3. Secure batching
      if (this.config.enableBatching && pattern.batchable && finalOptions.enableBatching !== false) {
        await this.addToSecureBatch(connectionId, optimizedMessage, finalOptions);
        return { batched: true };
      }
      
      // 4. Secure compression
      const result = await this.compressMessageSecurely(optimizedMessage, pattern, finalOptions);
      
      // Update performance stats
      this.updatePerformanceStats(startTime);
      
      return result;
      
    } catch (error) {
      this.handleProcessingError(connectionId, error);
      return { error: error.message };
    }
  }
  
  /**
   * Validate processing inputs
   */
  validateProcessingInputs(connectionId, message, options) {
    if (!connectionId || typeof connectionId !== 'string') {
      throw new SecurityError('Invalid connection ID');
    }
    
    if (!message) {
      throw new SecurityError('Message is required');
    }
    
    if (typeof options !== 'object') {
      throw new SecurityError('Options must be an object');
    }
    
    // Check connection limits
    if (this.connectionTracking.size > this.securityConfig.maxConnectionsTracked) {
      throw new SecurityError('Maximum connections tracked exceeded');
    }
  }
  
  /**
   * Parse message with security validation
   */
  parseMessageSecurely(message) {
    let messageStr;
    
    if (typeof message === 'string') {
      messageStr = message;
    } else if (typeof message === 'object') {
      try {
        messageStr = JSON.stringify(message);
      } catch (error) {
        throw new SecurityError('Failed to serialize message object');
      }
    } else {
      throw new SecurityError('Invalid message type');
    }
    
    // Check message size before parsing
    if (messageStr.length > this.config.maxMessageSize) {
      throw new SecurityError('Message exceeds maximum size');
    }
    
    let parsed;
    try {
      parsed = JSON.parse(messageStr);
    } catch (error) {
      throw new SecurityError('Invalid JSON format');
    }
    
    // Security validation
    if (!parsed || typeof parsed !== 'object') {
      throw new SecurityError('Message must be an object');
    }
    
    // Check for prototype pollution
    if (this.hasPrototypePollution(parsed)) {
      throw new SecurityError('Prototype pollution detected');
    }
    
    return parsed;
  }
  
  /**
   * Check for prototype pollution attempts
   */
  hasPrototypePollution(obj) {
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    
    const checkObject = (o) => {
      if (!o || typeof o !== 'object') return false;
      
      for (const key of Object.keys(o)) {
        if (dangerousKeys.includes(key)) return true;
        if (typeof o[key] === 'object' && checkObject(o[key])) return true;
      }
      
      return false;
    };
    
    return checkObject(obj);
  }
  
  /**
   * Calculate message size securely
   */
  calculateMessageSize(message) {
    try {
      return Buffer.byteLength(JSON.stringify(message), 'utf8');
    } catch (error) {
      throw new SecurityError('Failed to calculate message size');
    }
  }
  
  /**
   * Update connection tracking with security bounds
   */
  updateSecureConnectionTracking(connectionId, messageSize) {
    if (!this.connectionTracking.has(connectionId)) {
      this.connectionTracking.set(connectionId, {
        bytesProcessed: 0,
        messagesProcessed: 0,
        startTime: Date.now(),
        recentSamples: [],
        currentBandwidth: 0,
        lastUpdate: Date.now()
      });
    }
    
    const tracking = this.connectionTracking.get(connectionId);
    tracking.bytesProcessed += messageSize;
    tracking.messagesProcessed++;
    tracking.lastUpdate = Date.now();
    
    // Maintain bounded sample history
    tracking.recentSamples.push({ bytes: messageSize, timestamp: Date.now() });
    if (tracking.recentSamples.length > 100) {
      tracking.recentSamples = tracking.recentSamples.slice(-50);
    }
    
    // Calculate bandwidth with security bounds
    this.calculateSecureBandwidth(tracking);
  }
  
  /**
   * Calculate bandwidth with security validation
   */
  calculateSecureBandwidth(tracking) {
    const now = Date.now();
    const window = 10000; // 10 seconds
    
    // Filter recent samples
    const recentSamples = tracking.recentSamples.filter(
      sample => now - sample.timestamp < window
    );
    
    if (recentSamples.length > 1) {
      const totalBytes = recentSamples.reduce((sum, sample) => sum + sample.bytes, 0);
      const timespan = now - recentSamples[0].timestamp;
      
      if (timespan > 0) {
        tracking.currentBandwidth = Math.min(
          (totalBytes / timespan) * 1000, // bytes per second
          100 * 1024 * 1024 // Cap at 100MB/s for security
        );
      }
    }
  }
  
  /**
   * Get secure adaptive settings
   */
  getSecureAdaptiveSettings(connectionId) {
    if (!this.config.adaptiveStreaming) {
      return {};
    }
    
    const tracking = this.connectionTracking.get(connectionId);
    if (!tracking) {
      return {};
    }
    
    const bandwidth = tracking.currentBandwidth;
    const thresholds = this.config.bandwidthThresholds;
    
    let settings = {};
    
    if (bandwidth < thresholds.low) {
      settings = {
        compressionLevel: 9,
        enableBatching: true,
        batchInterval: Math.min(this.config.batchInterval * 4, 1000),
        maxBatchSize: Math.max(this.config.maxBatchSize / 2, 10),
        enableDelta: true,
        compressionAlgorithm: 'gzip'
      };
    } else if (bandwidth < thresholds.medium) {
      settings = {
        compressionLevel: 6,
        enableBatching: true,
        batchInterval: this.config.batchInterval * 2,
        maxBatchSize: Math.floor(this.config.maxBatchSize * 0.75),
        enableDelta: true,
        compressionAlgorithm: 'deflate'
      };
    } else if (bandwidth >= thresholds.high) {
      settings = {
        compressionLevel: 3,
        enableBatching: false,
        enableDelta: false,
        compressionAlgorithm: 'deflate'
      };
    }
    
    // Cache settings with expiration
    this.adaptiveSettings.set(connectionId, {
      ...settings,
      timestamp: Date.now(),
      bandwidth: bandwidth
    });
    
    return settings;
  }
  
  /**
   * Check secure deduplication
   */
  async checkSecureDeduplication(message, pattern) {
    try {
      const key = await pattern.deduplicationKey(message);
      if (!key || typeof key !== 'string') {
        return false; // Invalid key, don't deduplicate
      }
      
      const secureKey = this.secureHash(key);
      const now = Date.now();
      
      const existing = this.deduplicationCache.get(secureKey);
      if (existing && now - existing.timestamp < this.config.deduplicationWindow) {
        return true; // Duplicate found
      }
      
      // Store with bounded data
      this.deduplicationCache.set(secureKey, {
        timestamp: now,
        hash: secureKey
      });
      
      return false;
    } catch (error) {
      // Log error but don't fail deduplication
      this.emit('deduplication_error', { error: error.message });
      return false;
    }
  }
  
  /**
   * Generate secure delta compression
   */
  async generateSecureDelta(connectionId, newMessage, messageType) {
    try {
      const stateKey = `${connectionId}:${messageType}`;
      const lastState = this.deltaStates.get(stateKey);
      
      if (!lastState) {
        this.storeDeltaState(stateKey, newMessage);
        return null;
      }
      
      const delta = await this.createSecureDelta(lastState, newMessage, messageType);
      this.storeDeltaState(stateKey, newMessage);
      
      // Validate compression benefit
      const originalSize = this.calculateMessageSize(newMessage);
      const deltaSize = this.calculateMessageSize(delta);
      
      if (deltaSize < originalSize * 0.8) { // At least 20% savings
        return {
          delta: {
            type: `${messageType}_delta`,
            patch: delta,
            timestamp: Date.now(),
            checksum: this.secureHash(JSON.stringify(delta))
          },
          savesBandwidth: true,
          originalSize: originalSize,
          deltaSize: deltaSize
        };
      }
      
      return null;
    } catch (error) {
      this.emit('delta_error', { connectionId, error: error.message });
      return null;
    }
  }
  
  /**
   * Store delta state with bounds
   */
  storeDeltaState(stateKey, message) {
    // Limit delta states per connection
    const maxStates = 10;
    const connectionId = stateKey.split(':')[0];
    const connectionStates = Array.from(this.deltaStates.keys())
      .filter(key => key.startsWith(`${connectionId}:`));
    
    if (connectionStates.length >= maxStates) {
      // Remove oldest state
      const oldest = connectionStates[0];
      this.deltaStates.delete(oldest);
    }
    
    this.deltaStates.set(stateKey, {
      message: message,
      timestamp: Date.now()
    });
  }
  
  /**
   * Create secure delta between messages
   */
  async createSecureDelta(oldState, newMessage, messageType) {
    const oldMessage = oldState.message;
    
    switch (messageType) {
      case 'orderbook':
      case 'orderbook_update':
        return this.createSecureOrderBookDelta(oldMessage, newMessage);
      case 'user_orders_update':
        return this.createSecureOrdersDelta(oldMessage, newMessage);
      default:
        return this.createSecureObjectDelta(oldMessage, newMessage);
    }
  }
  
  /**
   * Create secure order book delta
   */
  createSecureOrderBookDelta(oldMessage, newMessage) {
    const changes = [];
    const maxChanges = 1000; // Prevent excessive delta size
    
    try {
      // Safely compare bids
      const oldBids = this.extractOrderBookSide(oldMessage, 'bids');
      const newBids = this.extractOrderBookSide(newMessage, 'bids');
      
      this.compareOrderBookSide(oldBids, newBids, 'b', changes, maxChanges);
      
      // Safely compare asks
      const oldAsks = this.extractOrderBookSide(oldMessage, 'asks');
      const newAsks = this.extractOrderBookSide(newMessage, 'asks');
      
      this.compareOrderBookSide(oldAsks, newAsks, 'a', changes, maxChanges);
      
      return {
        symbol: this.sanitizeString(newMessage.symbol),
        changes: changes.slice(0, maxChanges), // Ensure bounds
        timestamp: newMessage.timestamp,
        checksum: this.secureHash(JSON.stringify(changes))
      };
    } catch (error) {
      throw new SecurityError('Failed to create order book delta');
    }
  }
  
  /**
   * Extract order book side safely
   */
  extractOrderBookSide(message, side) {
    const data = message.data || {};
    const sideData = data[side] || [];
    
    if (!Array.isArray(sideData)) {
      return new Map();
    }
    
    const result = new Map();
    for (const item of sideData.slice(0, 1000)) { // Limit to 1000 levels
      if (Array.isArray(item) && item.length >= 2) {
        const price = this.sanitizePrice(item[0]);
        const size = this.sanitizeSize(item[1]);
        if (price && size !== null) {
          result.set(price, size);
        }
      }
    }
    
    return result;
  }
  
  /**
   * Compare order book sides securely
   */
  compareOrderBookSide(oldSide, newSide, prefix, changes, maxChanges) {
    if (changes.length >= maxChanges) return;
    
    // Check new/updated levels
    for (const [price, size] of newSide) {
      if (changes.length >= maxChanges) break;
      
      if (!oldSide.has(price) || oldSide.get(price) !== size) {
        changes.push([prefix, price, size.toString()]);
      }
    }
    
    // Check removed levels
    for (const price of oldSide.keys()) {
      if (changes.length >= maxChanges) break;
      
      if (!newSide.has(price)) {
        changes.push([prefix, price, '0']);
      }
    }
  }
  
  /**
   * Add to secure batch
   */
  async addToSecureBatch(connectionId, message, options = {}) {
    if (!this.messageQueue.has(connectionId)) {
      this.messageQueue.set(connectionId, []);
    }
    
    const queue = this.messageQueue.get(connectionId);
    
    // Check queue size limits
    if (queue.length >= this.securityConfig.maxQueueSize) {
      throw new SecurityError('Message queue full');
    }
    
    queue.push({
      message: message,
      timestamp: Date.now(),
      size: this.calculateMessageSize(message)
    });
    
    // Check batch size
    const maxBatchSize = Math.min(
      options.maxBatchSize || this.config.maxBatchSize,
      this.securityConfig.maxQueueSize
    );
    
    if (queue.length >= maxBatchSize) {
      await this.flushSecureBatch(connectionId);
      return;
    }
    
    // Set secure timer
    if (!this.batchTimers.has(connectionId)) {
      const interval = Math.max(
        options.batchInterval || this.config.batchInterval,
        10 // Minimum 10ms
      );
      
      const timer = setTimeout(() => {
        this.flushSecureBatch(connectionId);
      }, interval);
      
      this.batchTimers.set(connectionId, timer);
    }
  }
  
  /**
   * Flush secure batch
   */
  async flushSecureBatch(connectionId) {
    const queue = this.messageQueue.get(connectionId);
    if (!queue || queue.length === 0) return;
    
    // Clear timer
    const timer = this.batchTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(connectionId);
    }
    
    try {
      // Extract messages with size limit
      const batchItems = queue.splice(0, this.config.maxBatchSize);
      const messages = batchItems.map(item => item.message);
      
      // Create secure batch
      const batchMessage = {
        type: 'batch',
        messages: messages,
        count: messages.length,
        timestamp: Date.now(),
        checksum: this.secureHash(JSON.stringify(messages))
      };
      
      // Validate batch size
      const batchSize = this.calculateMessageSize(batchMessage);
      if (batchSize > this.config.maxMessageSize) {
        throw new SecurityError('Batch too large');
      }
      
      // Compress batch
      const result = await this.compressMessageSecurely(batchMessage, {
        compressionAlgorithm: 'gzip'
      });
      
      this.performanceStats.batchesSent++;
      
      this.emit('secure_batch_ready', {
        connectionId: connectionId,
        batch: result,
        messageCount: messages.length
      });
      
      return result;
    } catch (error) {
      this.emit('batch_error', { connectionId, error: error.message });
      throw error;
    }
  }
  
  /**
   * Compress message securely with timeout and validation
   */
  async compressMessageSecurely(message, pattern = {}, options = {}) {
    // Acquire semaphore for concurrency control
    await this.compressionSemaphore.acquire();
    
    try {
      return await this.performSecureCompression(message, pattern, options);
    } finally {
      this.compressionSemaphore.release();
    }
  }
  
  /**
   * Perform secure compression with validation
   */
  async performSecureCompression(message, pattern, options) {
    const messageStr = JSON.stringify(message);
    const originalSize = Buffer.byteLength(messageStr, 'utf8');
    
    // Validate message size
    if (originalSize > this.config.maxMessageSize) {
      throw new SecurityError('Message exceeds maximum size for compression');
    }
    
    // Check compression threshold
    if (!this.config.compressionEnabled || 
        originalSize < this.config.compressionThreshold ||
        options.enableCompression === false) {
      
      this.updateCompressionStats(originalSize, originalSize);
      return this.createCompressionResult(messageStr, false, originalSize, originalSize, 'none');
    }
    
    // Check compression cache
    const messageHash = this.secureHash(messageStr);
    const cached = this.compressionCache.get(messageHash);
    if (cached && this.validateCachedResult(cached)) {
      this.performanceStats.cacheHits++;
      return { ...cached, fromCache: true };
    }
    
    this.performanceStats.cacheMisses++;
    
    // Determine compression algorithm
    const algorithm = this.selectSecureCompressionAlgorithm(pattern, options);
    const compressor = this.compressionAlgorithms[algorithm];
    
    if (!compressor) {
      throw new SecurityError(`Unknown compression algorithm: ${algorithm}`);
    }
    
    try {
      // Compress with timeout
      const compressedData = await this.timeoutPromise(
        compressor.compress(messageStr, options),
        this.securityConfig.compressionTimeoutMs
      );
      
      const compressedSize = Buffer.byteLength(compressedData);
      
      // Validate compression ratio for security
      const compressionRatio = compressedSize / originalSize;
      if (compressionRatio < compressor.maxRatio) {
        throw new SecurityError('Compression ratio too high, possible compression bomb');
      }
      
      // Only use compression if beneficial
      if (compressedSize < originalSize) {
        const result = this.createCompressionResult(
          compressedData, true, originalSize, compressedSize, algorithm
        );
        
        // Cache with size limit
        if (this.compressionCache.size < this.config.maxCacheSize) {
          this.compressionCache.set(messageHash, result);
        }
        
        this.updateCompressionStats(originalSize, compressedSize);
        return result;
      } else {
        // Compression not beneficial
        this.updateCompressionStats(originalSize, originalSize);
        return this.createCompressionResult(
          messageStr, false, originalSize, originalSize, 'none'
        );
      }
      
    } catch (error) {
      this.performanceStats.compressionErrors++;
      
      if (error.name === 'TimeoutError') {
        throw new SecurityError('Compression timeout');
      } else if (error.name === 'SecurityError') {
        throw error;
      } else {
        // Fallback to uncompressed for other errors
        this.updateCompressionStats(originalSize, originalSize);
        return this.createCompressionResult(
          messageStr, false, originalSize, originalSize, 'none', error.message
        );
      }
    }
  }
  
  /**
   * Select secure compression algorithm
   */
  selectSecureCompressionAlgorithm(pattern, options) {
    const algorithm = options.compressionAlgorithm || 
                     pattern.compressionAlgorithm || 
                     'gzip';
    
    // Validate algorithm
    if (!this.compressionAlgorithms[algorithm]) {
      return 'gzip'; // Safe fallback
    }
    
    return algorithm;
  }
  
  /**
   * Create compression result object
   */
  createCompressionResult(data, compressed, originalSize, compressedSize, algorithm, error = null) {
    return {
      data: data,
      compressed: compressed,
      originalSize: originalSize,
      compressedSize: compressedSize,
      algorithm: algorithm,
      compressionRatio: originalSize / compressedSize,
      timestamp: Date.now(),
      error: error
    };
  }
  
  /**
   * Validate cached compression result
   */
  validateCachedResult(cached) {
    // Check age
    const maxAge = 300000; // 5 minutes
    if (Date.now() - cached.timestamp > maxAge) {
      return false;
    }
    
    // Validate structure
    return cached.data && 
           typeof cached.compressed === 'boolean' &&
           typeof cached.originalSize === 'number' &&
           typeof cached.compressedSize === 'number';
  }
  
  /**
   * Update compression statistics
   */
  updateCompressionStats(originalSize, compressedSize) {
    this.performanceStats.bytesOriginal += originalSize;
    this.performanceStats.bytesCompressed += compressedSize;
    this.performanceStats.bandwidthSaved += Math.max(0, originalSize - compressedSize);
    
    if (this.performanceStats.bytesOriginal > 0) {
      this.performanceStats.compressionRatio = 
        this.performanceStats.bytesOriginal / this.performanceStats.bytesCompressed;
    }
  }
  
  /**
   * Secure GZIP compression
   */
  async secureGzipCompress(data, options = {}) {
    const level = Math.min(Math.max(options.compressionLevel || this.config.compressionLevel, 1), 9);
    
    return await gzipAsync(data, {
      level: level,
      memLevel: 8, // Memory vs speed tradeoff
      strategy: zlib.constants.Z_DEFAULT_STRATEGY
    });
  }
  
  /**
   * Secure GZIP decompression
   */
  async secureGzipDecompress(data) {
    // Add size limits for security
    const options = {
      chunkSize: 64 * 1024, // 64KB chunks
      maxOutputLength: this.config.maxMessageSize * 10 // Limit expansion
    };
    
    return await gunzipAsync(data, options);
  }
  
  /**
   * Secure Deflate compression
   */
  async secureDeflateCompress(data, options = {}) {
    const level = Math.min(Math.max(options.compressionLevel || this.config.compressionLevel, 1), 9);
    
    return await deflateAsync(data, {
      level: level,
      memLevel: 8,
      strategy: zlib.constants.Z_DEFAULT_STRATEGY
    });
  }
  
  /**
   * Secure Deflate decompression
   */
  async secureDeflateDecompress(data) {
    const options = {
      chunkSize: 64 * 1024,
      maxOutputLength: this.config.maxMessageSize * 10
    };
    
    return await inflateAsync(data, options);
  }
  
  /**
   * Secure Brotli compression
   */
  async secureBrotliCompress(data, options = {}) {
    if (!zlib.brotliCompress) {
      throw new Error('Brotli compression not available');
    }
    
    const quality = Math.min(Math.max(options.compressionLevel || this.config.compressionLevel, 1), 11);
    
    return await brotliCompressAsync(data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(data)
      }
    });
  }
  
  /**
   * Secure Brotli decompression
   */
  async secureBrotliDecompress(data) {
    if (!zlib.brotliDecompress) {
      throw new Error('Brotli decompression not available');
    }
    
    return await brotliDecompressAsync(data);
  }
  
  /**
   * Create secure hash
   */
  createSecureHash(data) {
    return crypto.createHash(this.securityConfig.hashAlgorithm)
      .update(data)
      .digest('hex')
      .substring(0, this.securityConfig.maxHashSize);
  }
  
  /**
   * Create HMAC hash for enhanced security
   */
  createHMACHash(data) {
    return crypto.createHmac(this.securityConfig.hashAlgorithm, this.config.encryptionKey)
      .update(data)
      .digest('hex')
      .substring(0, this.securityConfig.maxHashSize);
  }
  
  /**
   * Promise with timeout for security
   */
  timeoutPromise(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('Operation timeout');
          error.name = 'TimeoutError';
          reject(error);
        }, timeoutMs);
      })
    ]);
  }
  
  /**
   * Message validation functions
   */
  validateOrderbookMessage(message) {
    return message.symbol && typeof message.symbol === 'string' &&
           message.data && typeof message.data === 'object';
  }
  
  validateTickerMessage(message) {
    return message.symbol && typeof message.symbol === 'string' &&
           message.data && typeof message.data === 'object';
  }
  
  validateTradeMessage(message) {
    return message.data && (Array.isArray(message.data) || typeof message.data === 'object');
  }
  
  validateUserOrderMessage(message) {
    return message.data && Array.isArray(message.data);
  }
  
  /**
   * Secure key generation functions
   */
  secureOrderbookKey(message) {
    const symbol = this.sanitizeString(message.symbol);
    const bidsSample = this.extractOrderBookSample(message, 'bids');
    return `${symbol}_${bidsSample}`;
  }
  
  secureTickerKey(message) {
    const symbol = this.sanitizeString(message.symbol);
    const price = this.sanitizePrice(message.data?.price);
    return `${symbol}_${price}`;
  }
  
  secureTradeKey(message) {
    const id = this.sanitizeString(message.data?.id);
    return id || this.secureHash(JSON.stringify(message.data));
  }
  
  secureUserOrderKey(message) {
    return message.data?.map(order => 
      `${this.sanitizeString(order.orderId)}_${this.sanitizeString(order.status)}`
    ).join('|');
  }
  
  /**
   * Extract order book sample for deduplication
   */
  extractOrderBookSample(message, side) {
    const data = message.data || {};
    const sideData = data[side] || [];
    
    if (!Array.isArray(sideData)) return '';
    
    return sideData.slice(0, 5) // Top 5 levels
      .map(level => Array.isArray(level) ? `${level[0]}_${level[1]}` : '')
      .join('|');
  }
  
  /**
   * Sanitization functions
   */
  sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^\w\-\.\/]/g, '').substring(0, 100);
  }
  
  sanitizePrice(price) {
    const num = parseFloat(price);
    return isNaN(num) ? null : Math.max(0, Math.min(num, 1e12)).toString();
  }
  
  sanitizeSize(size) {
    const num = parseFloat(size);
    return isNaN(num) ? null : Math.max(0, Math.min(num, 1e12));
  }
  
  /**
   * Handle processing errors
   */
  handleProcessingError(connectionId, error) {
    this.performanceStats.securityViolations++;
    
    this.emit('processing_error', {
      connectionId: connectionId,
      error: error.message,
      type: error.name,
      timestamp: Date.now()
    });
    
    // Clean up connection data if security error
    if (error.name === 'SecurityError') {
      this.cleanupConnectionData(connectionId);
    }
  }
  
  /**
   * Update performance statistics
   */
  updatePerformanceStats(startTime) {
    this.performanceStats.messagesProcessed++;
    this.performanceStats.avgCompressionTime = this.updateRunningAverage(
      this.performanceStats.avgCompressionTime,
      Date.now() - startTime,
      this.performanceStats.messagesProcessed
    );
  }
  
  /**
   * Update running average
   */
  updateRunningAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Start memory monitoring
   */
  startMemoryMonitoring() {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.performanceStats.memoryUsage = memUsage.heapUsed;
      
      // Emit memory warning if high
      if (memUsage.heapUsed / memUsage.heapTotal > 0.9) {
        this.emit('memory_warning', { usage: memUsage });
      }
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Start cleanup tasks
   */
  startCleanupTasks() {
    // Regular cleanup
    setInterval(() => {
      this.performCleanup();
    }, 300000); // Every 5 minutes
    
    // Aggressive cleanup when memory is high
    setInterval(() => {
      const memUsage = process.memoryUsage();
      if (memUsage.heapUsed / memUsage.heapTotal > 0.8) {
        this.performAggressiveCleanup();
      }
    }, 60000); // Every minute
  }
  
  /**
   * Perform regular cleanup
   */
  performCleanup() {
    const now = Date.now();
    
    // Clean up old connection tracking
    for (const [connectionId, tracking] of this.connectionTracking) {
      if (now - tracking.lastUpdate > 3600000) { // 1 hour
        this.cleanupConnectionData(connectionId);
      }
    }
    
    // Clean up old delta states
    for (const [stateKey, state] of this.deltaStates) {
      if (now - state.timestamp > 1800000) { // 30 minutes
        this.deltaStates.delete(stateKey);
      }
    }
    
    // Clean up old adaptive settings
    for (const [connectionId, settings] of this.adaptiveSettings) {
      if (now - settings.timestamp > 300000) { // 5 minutes
        this.adaptiveSettings.delete(connectionId);
      }
    }
  }
  
  /**
   * Perform aggressive cleanup when memory is high
   */
  performAggressiveCleanup() {
    // Clear half the caches
    this.compressionCache.clear(this.compressionCache.size / 2);
    this.deduplicationCache.clear(this.deduplicationCache.size / 2);
    
    // Limit tracking data
    if (this.connectionTracking.size > 1000) {
      const entries = Array.from(this.connectionTracking.entries());
      entries.sort((a, b) => a[1].lastUpdate - b[1].lastUpdate);
      
      const toRemove = entries.slice(0, entries.length - 1000);
      toRemove.forEach(([connectionId]) => {
        this.cleanupConnectionData(connectionId);
      });
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
  
  /**
   * Clean up connection-specific data
   */
  cleanupConnectionData(connectionId) {
    // Remove connection tracking
    this.connectionTracking.delete(connectionId);
    this.adaptiveSettings.delete(connectionId);
    
    // Flush any pending batch
    this.flushSecureBatch(connectionId);
    
    // Clear message queue
    this.messageQueue.delete(connectionId);
    
    // Clear batch timer
    const timer = this.batchTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(connectionId);
    }
    
    // Remove delta states
    const statesToRemove = Array.from(this.deltaStates.keys())
      .filter(key => key.startsWith(`${connectionId}:`));
    statesToRemove.forEach(key => this.deltaStates.delete(key));
  }
  
  /**
   * Get connection statistics
   */
  getConnectionStats(connectionId) {
    const tracking = this.connectionTracking.get(connectionId);
    const adaptive = this.adaptiveSettings.get(connectionId);
    const queueSize = this.messageQueue.get(connectionId)?.length || 0;
    
    return {
      tracking: tracking || null,
      adaptiveSettings: adaptive || null,
      queuedMessages: queueSize,
      deltaStates: Array.from(this.deltaStates.keys())
        .filter(key => key.startsWith(`${connectionId}:`)).length
    };
  }
  
  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      performance: this.performanceStats,
      cacheStats: {
        compressionCacheSize: this.compressionCache.size,
        deduplicationCacheSize: this.deduplicationCache.size,
        cacheHitRate: this.performanceStats.cacheHits / 
                     (this.performanceStats.cacheHits + this.performanceStats.cacheMisses)
      },
      connectionStats: {
        tracked: this.connectionTracking.size,
        withAdaptiveSettings: this.adaptiveSettings.size,
        withDeltaStates: Array.from(this.deltaStates.keys())
          .reduce((acc, key) => {
            const connectionId = key.split(':')[0];
            acc.add(connectionId);
            return acc;
          }, new Set()).size,
        withQueuedMessages: this.messageQueue.size
      },
      memoryStats: {
        heapUsed: this.performanceStats.memoryUsage,
        cacheMemoryEstimate: this.estimateCacheMemory()
      }
    };
  }
  
  /**
   * Estimate cache memory usage
   */
  estimateCacheMemory() {
    // Rough estimate based on cache sizes
    const avgEntrySize = 1024; // 1KB average
    return (this.compressionCache.size + this.deduplicationCache.size) * avgEntrySize;
  }
  
  /**
   * Shutdown with cleanup
   */
  shutdown() {
    // Clear all timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    
    // Clear all data structures
    this.messageQueue.clear();
    this.batchTimers.clear();
    this.compressionCache.clear();
    this.deduplicationCache.clear();
    this.deltaStates.clear();
    this.connectionTracking.clear();
    this.adaptiveSettings.clear();
    
    this.emit('shutdown');
  }
}

/**
 * LRU Cache implementation with size limits
 */
class LRUCache {
  constructor(maxSize) {
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
  
  has(key) {
    return this.cache.has(key);
  }
  
  get size() {
    return this.cache.size;
  }
  
  clear(count = this.cache.size) {
    const keys = Array.from(this.cache.keys()).slice(0, count);
    keys.forEach(key => this.cache.delete(key));
  }
}

/**
 * Semaphore for concurrency control
 */
class Semaphore {
  constructor(permits) {
    this.permits = permits;
    this.queue = [];
  }
  
  async acquire() {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }
  
  release() {
    this.permits++;
    if (this.queue.length > 0) {
      this.permits--;
      const resolve = this.queue.shift();
      resolve();
    }
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

module.exports = SecureBandwidthOptimizer;