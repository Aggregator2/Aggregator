const EventEmitter = require('events');
const zlib = require('zlib');
const crypto = require('crypto');

/**
 * Bandwidth Optimization Techniques
 * Implements compression, deduplication, batching, and adaptive streaming
 */
class BandwidthOptimizer extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      compressionEnabled: config.compressionEnabled !== false,
      compressionThreshold: config.compressionThreshold || 1024, // 1KB
      compressionLevel: config.compressionLevel || 6,
      enableDeduplication: config.enableDeduplication !== false,
      deduplicationWindow: config.deduplicationWindow || 60000, // 1 minute
      enableBatching: config.enableBatching !== false,
      batchInterval: config.batchInterval || 50, // 50ms
      maxBatchSize: config.maxBatchSize || 100,
      enableDeltaCompression: config.enableDeltaCompression !== false,
      adaptiveStreaming: config.adaptiveStreaming !== false,
      bandwidthThresholds: config.bandwidthThresholds || {
        low: 100 * 1024,      // 100KB/s
        medium: 500 * 1024,   // 500KB/s
        high: 1024 * 1024     // 1MB/s
      },
      ...config
    };
    
    // Message processing
    this.messageQueue = new Map(); // connectionId -> message queue
    this.batchTimers = new Map();  // connectionId -> batch timer
    this.compressionCache = new Map(); // hash -> compressed data
    this.deduplicationCache = new Map(); // hash -> {data, timestamp}
    
    // Delta compression state
    this.deltaStates = new Map(); // connectionId -> last state for delta
    this.deltaPatches = new Map(); // connectionId -> patch history
    
    // Connection bandwidth tracking
    this.connectionBandwidth = new Map(); // connectionId -> bandwidth stats
    this.adaptiveSettings = new Map(); // connectionId -> adaptive settings
    
    // Performance tracking
    this.performanceStats = {
      messagesProcessed: 0,
      bytesOriginal: 0,
      bytesCompressed: 0,
      compressionRatio: 0,
      duplicatesFiltered: 0,
      batchesSent: 0,
      deltasPatchesGenerated: 0,
      bandwidthSaved: 0,
      avgCompressionTime: 0
    };
    
    // Compression algorithms
    this.compressionAlgorithms = {
      gzip: {
        compress: this.gzipCompress.bind(this),
        decompress: this.gzipDecompress.bind(this),
        level: this.config.compressionLevel
      },
      deflate: {
        compress: this.deflateCompress.bind(this),
        decompress: this.deflateDecompress.bind(this),
        level: this.config.compressionLevel
      },
      brotli: {
        compress: this.brotliCompress.bind(this),
        decompress: this.brotliDecompress.bind(this),
        level: this.config.compressionLevel
      }
    };
    
    // Message patterns for optimization
    this.messagePatterns = {
      orderbook: {
        compressionAlgorithm: 'gzip',
        enableDelta: true,
        batchable: true,
        deduplicationKey: (msg) => `${msg.symbol}_${JSON.stringify(msg.data?.bids?.slice(0, 5))}`
      },
      ticker: {
        compressionAlgorithm: 'deflate',
        enableDelta: false,
        batchable: true,
        deduplicationKey: (msg) => `${msg.symbol}_${msg.data?.price}`
      },
      trades: {
        compressionAlgorithm: 'gzip',
        enableDelta: false,
        batchable: true,
        deduplicationKey: (msg) => `${msg.data?.id}`
      },
      user_orders: {
        compressionAlgorithm: 'gzip',
        enableDelta: true,
        batchable: false,
        deduplicationKey: (msg) => `${msg.data?.orderId}_${msg.data?.status}`
      }
    };
    
    this.startBatchProcessor();
    this.startCleanupTasks();
  }
  
  /**
   * Process message for optimization
   */
  async processMessage(connectionId, message, options = {}) {
    const startTime = Date.now();
    
    try {
      // Parse message if it's a string
      const messageObj = typeof message === 'string' ? JSON.parse(message) : message;
      const messageType = messageObj.type;
      const pattern = this.messagePatterns[messageType] || {};
      
      // Update connection bandwidth tracking
      this.updateBandwidthTracking(connectionId, JSON.stringify(messageObj).length);
      
      // Apply adaptive settings based on connection bandwidth
      const adaptiveSettings = this.getAdaptiveSettings(connectionId);
      const finalOptions = { ...options, ...adaptiveSettings };
      
      // Process based on optimization strategy
      let optimizedMessage = messageObj;
      
      // 1. Deduplication
      if (this.config.enableDeduplication && pattern.deduplicationKey) {
        const isDuplicate = this.checkDuplication(messageObj, pattern.deduplicationKey);
        if (isDuplicate) {
          this.performanceStats.duplicatesFiltered++;
          return { skipped: true, reason: 'duplicate' };
        }
      }
      
      // 2. Delta compression
      if (this.config.enableDeltaCompression && pattern.enableDelta && finalOptions.enableDelta !== false) {
        const deltaResult = this.generateDelta(connectionId, messageObj, messageType);
        if (deltaResult && deltaResult.savesBandwidth) {
          optimizedMessage = deltaResult.delta;
          this.performanceStats.deltasPatchesGenerated++;
        }
      }
      
      // 3. Batching
      if (this.config.enableBatching && pattern.batchable && finalOptions.enableBatching !== false) {
        this.addToBatch(connectionId, optimizedMessage, finalOptions);
        return { batched: true };
      }
      
      // 4. Compression
      const result = await this.compressMessage(optimizedMessage, pattern, finalOptions);
      
      this.performanceStats.messagesProcessed++;
      this.performanceStats.avgCompressionTime = this.updateAverage(
        this.performanceStats.avgCompressionTime,
        Date.now() - startTime,
        this.performanceStats.messagesProcessed
      );
      
      return result;
      
    } catch (error) {
      this.emit('optimization_error', { connectionId, error: error.message });
      return { error: error.message };
    }
  }
  
  /**
   * Update bandwidth tracking
   */
  updateBandwidthTracking(connectionId, messageSize) {
    if (!this.connectionBandwidth.has(connectionId)) {
      this.connectionBandwidth.set(connectionId, {
        bytesTransferred: 0,
        messageCount: 0,
        startTime: Date.now(),
        recentSamples: [],
        currentBandwidth: 0
      });
    }
    
    const stats = this.connectionBandwidth.get(connectionId);
    stats.bytesTransferred += messageSize;
    stats.messageCount++;
    
    // Add sample for bandwidth calculation
    const now = Date.now();
    stats.recentSamples.push({ bytes: messageSize, timestamp: now });
    
    // Keep only last 10 seconds of samples
    const cutoff = now - 10000;
    stats.recentSamples = stats.recentSamples.filter(sample => sample.timestamp > cutoff);
    
    // Calculate current bandwidth
    if (stats.recentSamples.length > 1) {
      const totalBytes = stats.recentSamples.reduce((sum, sample) => sum + sample.bytes, 0);
      const timespan = now - stats.recentSamples[0].timestamp;
      stats.currentBandwidth = (totalBytes / timespan) * 1000; // bytes per second
    }
  }
  
  /**
   * Get adaptive settings based on connection bandwidth
   */
  getAdaptiveSettings(connectionId) {
    if (!this.config.adaptiveStreaming) {
      return {};
    }
    
    const bandwidthStats = this.connectionBandwidth.get(connectionId);
    if (!bandwidthStats) {
      return {};
    }
    
    const bandwidth = bandwidthStats.currentBandwidth;
    const thresholds = this.config.bandwidthThresholds;
    
    let settings = this.adaptiveSettings.get(connectionId) || {};
    
    if (bandwidth < thresholds.low) {
      // Low bandwidth - aggressive optimization
      settings = {
        compressionLevel: 9,
        enableBatching: true,
        batchInterval: 200,
        maxBatchSize: 50,
        enableDelta: true,
        compressionAlgorithm: 'gzip'
      };
    } else if (bandwidth < thresholds.medium) {
      // Medium bandwidth - balanced optimization
      settings = {
        compressionLevel: 6,
        enableBatching: true,
        batchInterval: 100,
        maxBatchSize: 75,
        enableDelta: true,
        compressionAlgorithm: 'deflate'
      };
    } else if (bandwidth >= thresholds.high) {
      // High bandwidth - minimal optimization
      settings = {
        compressionLevel: 3,
        enableBatching: false,
        enableDelta: false,
        compressionAlgorithm: 'deflate'
      };
    }
    
    this.adaptiveSettings.set(connectionId, settings);
    return settings;
  }
  
  /**
   * Check for message duplication
   */
  checkDuplication(message, deduplicationKeyFn) {
    const key = typeof deduplicationKeyFn === 'function' ? 
      deduplicationKeyFn(message) : 
      this.generateHash(JSON.stringify(message));
    
    const now = Date.now();
    const existing = this.deduplicationCache.get(key);
    
    if (existing && now - existing.timestamp < this.config.deduplicationWindow) {
      return true; // Duplicate found
    }
    
    // Store for future deduplication
    this.deduplicationCache.set(key, {
      data: message,
      timestamp: now
    });
    
    return false;
  }
  
  /**
   * Generate delta compression
   */
  generateDelta(connectionId, newMessage, messageType) {
    const lastState = this.deltaStates.get(connectionId);
    if (!lastState || !lastState[messageType]) {
      // No previous state, store current and return original
      this.storeDeltaState(connectionId, messageType, newMessage);
      return null;
    }
    
    const previousMessage = lastState[messageType];
    const delta = this.createDelta(previousMessage, newMessage, messageType);
    
    // Store new state
    this.storeDeltaState(connectionId, messageType, newMessage);
    
    // Check if delta saves bandwidth
    const originalSize = JSON.stringify(newMessage).length;
    const deltaSize = JSON.stringify(delta).length;
    
    if (deltaSize < originalSize * 0.8) { // Save at least 20%
      return {
        delta: {
          type: `${messageType}_delta`,
          patch: delta,
          timestamp: Date.now()
        },
        savesBandwidth: true,
        originalSize: originalSize,
        deltaSize: deltaSize
      };
    }
    
    return null;
  }
  
  /**
   * Store delta state
   */
  storeDeltaState(connectionId, messageType, message) {
    if (!this.deltaStates.has(connectionId)) {
      this.deltaStates.set(connectionId, {});
    }
    
    this.deltaStates.get(connectionId)[messageType] = message;
  }
  
  /**
   * Create delta between two messages
   */
  createDelta(oldMessage, newMessage, messageType) {
    if (messageType === 'orderbook' || messageType === 'orderbook_update') {
      return this.createOrderBookDelta(oldMessage, newMessage);
    } else if (messageType === 'user_orders_update') {
      return this.createOrdersDelta(oldMessage, newMessage);
    } else {
      // Generic object diff
      return this.createObjectDelta(oldMessage, newMessage);
    }
  }
  
  /**
   * Create order book delta
   */
  createOrderBookDelta(oldMessage, newMessage) {
    const changes = [];
    
    // Compare bids
    const oldBids = new Map((oldMessage.data?.bids || []).map(([price, size]) => [price, size]));
    const newBids = newMessage.data?.bids || [];
    
    newBids.forEach(([price, size]) => {
      if (!oldBids.has(price) || oldBids.get(price) !== size) {
        changes.push(['b', price, size]); // bid change
      }
    });
    
    // Check for removed bids
    oldBids.forEach((size, price) => {
      if (!newBids.some(([p]) => p === price)) {
        changes.push(['b', price, '0']); // bid removal
      }
    });
    
    // Compare asks
    const oldAsks = new Map((oldMessage.data?.asks || []).map(([price, size]) => [price, size]));
    const newAsks = newMessage.data?.asks || [];
    
    newAsks.forEach(([price, size]) => {
      if (!oldAsks.has(price) || oldAsks.get(price) !== size) {
        changes.push(['a', price, size]); // ask change
      }
    });
    
    // Check for removed asks
    oldAsks.forEach((size, price) => {
      if (!newAsks.some(([p]) => p === price)) {
        changes.push(['a', price, '0']); // ask removal
      }
    });
    
    return {
      symbol: newMessage.symbol,
      changes: changes,
      timestamp: newMessage.timestamp
    };
  }
  
  /**
   * Create orders delta
   */
  createOrdersDelta(oldMessage, newMessage) {
    // Compare order arrays and return only changes
    const oldOrders = new Map((oldMessage.data || []).map(order => [order.orderId, order]));
    const newOrders = newMessage.data || [];
    
    const changes = [];
    
    newOrders.forEach(order => {
      const oldOrder = oldOrders.get(order.orderId);
      if (!oldOrder || JSON.stringify(oldOrder) !== JSON.stringify(order)) {
        changes.push(order);
      }
    });
    
    return {
      orderChanges: changes,
      timestamp: newMessage.timestamp
    };
  }
  
  /**
   * Create generic object delta
   */
  createObjectDelta(oldObj, newObj) {
    const changes = {};
    
    // Simple property comparison
    Object.keys(newObj).forEach(key => {
      if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
        changes[key] = newObj[key];
      }
    });
    
    return changes;
  }
  
  /**
   * Add message to batch
   */
  addToBatch(connectionId, message, options = {}) {
    if (!this.messageQueue.has(connectionId)) {
      this.messageQueue.set(connectionId, []);
    }
    
    const queue = this.messageQueue.get(connectionId);
    queue.push(message);
    
    // Check if batch is full
    const maxBatchSize = options.maxBatchSize || this.config.maxBatchSize;
    if (queue.length >= maxBatchSize) {
      this.flushBatch(connectionId);
      return;
    }
    
    // Set timer for batch flush
    if (!this.batchTimers.has(connectionId)) {
      const interval = options.batchInterval || this.config.batchInterval;
      const timer = setTimeout(() => {
        this.flushBatch(connectionId);
      }, interval);
      
      this.batchTimers.set(connectionId, timer);
    }
  }
  
  /**
   * Flush batch for connection
   */
  async flushBatch(connectionId) {
    const queue = this.messageQueue.get(connectionId);
    if (!queue || queue.length === 0) return;
    
    // Clear timer
    const timer = this.batchTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(connectionId);
    }
    
    // Create batch message
    const batchMessage = {
      type: 'batch',
      messages: queue.splice(0), // Remove all messages
      count: queue.length,
      timestamp: Date.now()
    };
    
    // Compress batch
    const result = await this.compressMessage(batchMessage, {
      compressionAlgorithm: 'gzip'
    });
    
    this.performanceStats.batchesSent++;
    
    this.emit('batch_ready', {
      connectionId: connectionId,
      batch: result,
      messageCount: batchMessage.count
    });
    
    return result;
  }
  
  /**
   * Compress message
   */
  async compressMessage(message, pattern = {}, options = {}) {
    const messageStr = JSON.stringify(message);
    const originalSize = Buffer.byteLength(messageStr, 'utf8');
    
    // Check if compression is enabled and beneficial
    if (!this.config.compressionEnabled || 
        originalSize < this.config.compressionThreshold ||
        options.enableCompression === false) {
      
      this.performanceStats.bytesOriginal += originalSize;
      this.performanceStats.bytesCompressed += originalSize;
      
      return {
        data: messageStr,
        compressed: false,
        originalSize: originalSize,
        compressedSize: originalSize,
        algorithm: 'none'
      };
    }
    
    // Check compression cache
    const messageHash = this.generateHash(messageStr);
    const cached = this.compressionCache.get(messageHash);
    if (cached) {
      return {
        ...cached,
        fromCache: true
      };
    }
    
    // Determine compression algorithm
    const algorithm = options.compressionAlgorithm || 
                     pattern.compressionAlgorithm || 
                     'gzip';
    
    const compressor = this.compressionAlgorithms[algorithm];
    if (!compressor) {
      throw new Error(`Unknown compression algorithm: ${algorithm}`);
    }
    
    try {
      const compressedData = await compressor.compress(messageStr, options);
      const compressedSize = Buffer.byteLength(compressedData);
      
      // Only use compression if it saves space
      if (compressedSize < originalSize) {
        const result = {
          data: compressedData,
          compressed: true,
          originalSize: originalSize,
          compressedSize: compressedSize,
          algorithm: algorithm,
          compressionRatio: originalSize / compressedSize
        };
        
        // Cache result
        this.compressionCache.set(messageHash, result);
        
        // Update stats
        this.performanceStats.bytesOriginal += originalSize;
        this.performanceStats.bytesCompressed += compressedSize;
        this.performanceStats.bandwidthSaved += (originalSize - compressedSize);
        this.performanceStats.compressionRatio = 
          this.performanceStats.bytesOriginal / this.performanceStats.bytesCompressed;
        
        return result;
      } else {
        // Compression didn't help
        this.performanceStats.bytesOriginal += originalSize;
        this.performanceStats.bytesCompressed += originalSize;
        
        return {
          data: messageStr,
          compressed: false,
          originalSize: originalSize,
          compressedSize: originalSize,
          algorithm: 'none'
        };
      }
    } catch (error) {
      // Fallback to uncompressed
      this.performanceStats.bytesOriginal += originalSize;
      this.performanceStats.bytesCompressed += originalSize;
      
      return {
        data: messageStr,
        compressed: false,
        originalSize: originalSize,
        compressedSize: originalSize,
        algorithm: 'none',
        error: error.message
      };
    }
  }
  
  /**
   * GZIP compression
   */
  async gzipCompress(data, options = {}) {
    return new Promise((resolve, reject) => {
      const level = options.compressionLevel || this.config.compressionLevel;
      zlib.gzip(data, { level }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }
  
  /**
   * GZIP decompression
   */
  async gzipDecompress(data) {
    return new Promise((resolve, reject) => {
      zlib.gunzip(data, (err, result) => {
        if (err) reject(err);
        else resolve(result.toString());
      });
    });
  }
  
  /**
   * Deflate compression
   */
  async deflateCompress(data, options = {}) {
    return new Promise((resolve, reject) => {
      const level = options.compressionLevel || this.config.compressionLevel;
      zlib.deflate(data, { level }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }
  
  /**
   * Deflate decompression
   */
  async deflateDecompress(data) {
    return new Promise((resolve, reject) => {
      zlib.inflate(data, (err, result) => {
        if (err) reject(err);
        else resolve(result.toString());
      });
    });
  }
  
  /**
   * Brotli compression (Node.js 11.7.0+)
   */
  async brotliCompress(data, options = {}) {
    if (!zlib.brotliCompress) {
      throw new Error('Brotli compression not available');
    }
    
    return new Promise((resolve, reject) => {
      const quality = options.compressionLevel || this.config.compressionLevel;
      zlib.brotliCompress(data, { 
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality }
      }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }
  
  /**
   * Brotli decompression
   */
  async brotliDecompress(data) {
    if (!zlib.brotliDecompress) {
      throw new Error('Brotli decompression not available');
    }
    
    return new Promise((resolve, reject) => {
      zlib.brotliDecompress(data, (err, result) => {
        if (err) reject(err);
        else resolve(result.toString());
      });
    });
  }
  
  /**
   * Generate hash for deduplication/caching
   */
  generateHash(data) {
    return crypto.createHash('sha256').update(data).digest('hex').substr(0, 16);
  }
  
  /**
   * Start batch processor
   */
  startBatchProcessor() {
    // Periodic batch flushing for connections with pending messages
    setInterval(() => {
      for (const connectionId of this.messageQueue.keys()) {
        const queue = this.messageQueue.get(connectionId);
        if (queue && queue.length > 0) {
          // Flush if batch has been waiting too long
          this.flushBatch(connectionId);
        }
      }
    }, this.config.batchInterval * 2);
  }
  
  /**
   * Start cleanup tasks
   */
  startCleanupTasks() {
    // Clean caches periodically
    setInterval(() => {
      this.cleanupCaches();
    }, 300000); // Every 5 minutes
  }
  
  /**
   * Clean up caches
   */
  cleanupCaches() {
    const now = Date.now();
    
    // Clean deduplication cache
    for (const [key, entry] of this.deduplicationCache) {
      if (now - entry.timestamp > this.config.deduplicationWindow) {
        this.deduplicationCache.delete(key);
      }
    }
    
    // Clean compression cache (keep most recent 1000 entries)
    if (this.compressionCache.size > 1000) {
      const entries = Array.from(this.compressionCache.entries());
      const toKeep = entries.slice(-1000);
      this.compressionCache.clear();
      toKeep.forEach(([key, value]) => {
        this.compressionCache.set(key, value);
      });
    }
    
    // Clean inactive connection data
    for (const connectionId of this.connectionBandwidth.keys()) {
      const stats = this.connectionBandwidth.get(connectionId);
      if (now - stats.startTime > 3600000) { // 1 hour inactive
        this.connectionBandwidth.delete(connectionId);
        this.adaptiveSettings.delete(connectionId);
        this.deltaStates.delete(connectionId);
        this.messageQueue.delete(connectionId);
        
        const timer = this.batchTimers.get(connectionId);
        if (timer) {
          clearTimeout(timer);
          this.batchTimers.delete(connectionId);
        }
      }
    }
  }
  
  /**
   * Clean up connection data
   */
  cleanupConnection(connectionId) {
    // Flush any pending batch
    this.flushBatch(connectionId);
    
    // Clean up all connection-specific data
    this.connectionBandwidth.delete(connectionId);
    this.adaptiveSettings.delete(connectionId);
    this.deltaStates.delete(connectionId);
    this.messageQueue.delete(connectionId);
    
    const timer = this.batchTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(connectionId);
    }
  }
  
  /**
   * Get bandwidth statistics for connection
   */
  getConnectionStats(connectionId) {
    const bandwidth = this.connectionBandwidth.get(connectionId);
    const adaptive = this.adaptiveSettings.get(connectionId);
    const deltaState = this.deltaStates.get(connectionId);
    const queueSize = this.messageQueue.get(connectionId)?.length || 0;
    
    return {
      bandwidth: bandwidth || null,
      adaptiveSettings: adaptive || null,
      deltaStatesCount: deltaState ? Object.keys(deltaState).length : 0,
      queuedMessages: queueSize
    };
  }
  
  /**
   * Update running average
   */
  updateAverage(currentAvg, newValue, count) {
    return currentAvg + (newValue - currentAvg) / count;
  }
  
  /**
   * Get optimization statistics
   */
  getStats() {
    return {
      ...this.performanceStats,
      cacheStats: {
        compressionCacheSize: this.compressionCache.size,
        deduplicationCacheSize: this.deduplicationCache.size
      },
      connectionStats: {
        tracked: this.connectionBandwidth.size,
        withAdaptiveSettings: this.adaptiveSettings.size,
        withDeltaStates: this.deltaStates.size,
        withQueuedMessages: this.messageQueue.size
      }
    };
  }
  
  /**
   * Shutdown bandwidth optimizer
   */
  shutdown() {
    // Clear all timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    
    // Clear all caches and data
    this.messageQueue.clear();
    this.batchTimers.clear();
    this.compressionCache.clear();
    this.deduplicationCache.clear();
    this.deltaStates.clear();
    this.connectionBandwidth.clear();
    this.adaptiveSettings.clear();
    
    this.emit('shutdown');
  }
}

module.exports = BandwidthOptimizer;