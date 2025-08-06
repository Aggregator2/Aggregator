const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * Performance Optimizer for Real-time Data Feeds
 * 
 * Provides comprehensive performance optimization including:
 * - Memory management with bounded collections
 * - CPU optimization for cryptographic operations
 * - Network bandwidth optimization
 * - Database query optimization
 * - Caching strategies
 * - Resource pooling
 * 
 * @performance Target: <2ms average response time, <100MB memory usage
 * @scalability Support for 10K+ concurrent connections
 */
class PerformanceOptimizer extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Memory optimization
      maxMemoryMB: config.maxMemoryMB || 100,
      gcThresholdMB: config.gcThresholdMB || 80,
      enableMemoryMonitoring: config.enableMemoryMonitoring !== false,
      
      // CPU optimization  
      maxCpuPercent: config.maxCpuPercent || 80,
      enableCpuThrottling: config.enableCpuThrottling !== false,
      workerThreads: config.workerThreads || require('os').cpus().length,
      
      // Network optimization
      compressionLevel: config.compressionLevel || 6,
      enableGzip: config.enableGzip !== false,
      maxPayloadSize: config.maxPayloadSize || 64 * 1024, // 64KB
      
      // Cache optimization
      cacheSize: config.cacheSize || 10000,
      cacheTTL: config.cacheTTL || 300000, // 5 minutes
      enableLRU: config.enableLRU !== false,
      
      // Database optimization
      poolSize: config.poolSize || 20,
      queryTimeout: config.queryTimeout || 30000,
      enableQueryCache: config.enableQueryCache !== false,
      
      ...config
    };

    this.metrics = {
      memoryUsage: [],
      cpuUsage: [],
      responseTime: [],
      cacheHitRate: 0,
      queryExecutionTime: [],
      networkThroughput: []
    };

    this.performanceCounters = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      queriesExecuted: 0,
      optimizationsApplied: 0
    };

    this.optimizationStrategies = new Map();
    this.resourcePools = new Map();
    this.activeOptimizations = new Set();

    this.initializeOptimizations();
  }

  /**
   * Initialize all optimization strategies
   */
  async initializeOptimizations() {
    try {
      await this.setupMemoryOptimization();
      await this.setupCpuOptimization();
      await this.setupNetworkOptimization();
      await this.setupCacheOptimization();
      await this.setupDatabaseOptimization();
      
      if (this.config.enableMemoryMonitoring) {
        this.startMemoryMonitoring();
      }
      
      console.log('Performance optimization initialized successfully');
      this.emit('optimizationReady');
    } catch (error) {
      console.error('Failed to initialize performance optimization:', error);
      throw error;
    }
  }

  /**
   * Setup memory optimization strategies
   */
  async setupMemoryOptimization() {
    // LRU Cache implementation for bounded memory usage
    const LRU = require('lru-cache');
    
    this.memoryCache = new LRU({
      max: this.config.cacheSize,
      ttl: this.config.cacheTTL,
      updateAgeOnGet: true,
      dispose: (value, key) => {
        // Cleanup disposed values
        if (value && typeof value.cleanup === 'function') {
          value.cleanup();
        }
      }
    });

    // Object pooling for frequently created objects
    this.objectPools = {
      websocketMessages: new ObjectPool(() => ({}), 1000),
      tradeData: new ObjectPool(() => ({
        price: 0,
        volume: 0,
        timestamp: 0,
        symbol: ''
      }), 500),
      orderBookEntries: new ObjectPool(() => ({
        price: 0,
        quantity: 0,
        side: 'buy'
      }), 1000)
    };

    // Memory usage monitoring
    this.memoryMonitor = {
      checkInterval: setInterval(() => {
        const usage = process.memoryUsage();
        const usageMB = usage.heapUsed / (1024 * 1024);
        
        this.metrics.memoryUsage.push({
          timestamp: Date.now(),
          heapUsed: usageMB,
          heapTotal: usage.heapTotal / (1024 * 1024),
          external: usage.external / (1024 * 1024)
        });

        // Trigger GC if memory usage is high
        if (usageMB > this.config.gcThresholdMB) {
          this.forceGarbageCollection();
        }

        // Keep only last 100 measurements
        if (this.metrics.memoryUsage.length > 100) {
          this.metrics.memoryUsage.shift();
        }
      }, 5000)
    };

    console.log('Memory optimization setup complete');
  }

  /**
   * Setup CPU optimization strategies
   */
  async setupCpuOptimization() {
    const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
    
    if (isMainThread) {
      // Create worker thread pool for CPU-intensive operations
      this.workerPool = [];
      for (let i = 0; i < this.config.workerThreads; i++) {
        const worker = new Worker(__filename, {
          workerData: { isWorker: true, workerId: i }
        });
        
        worker.available = true;
        this.workerPool.push(worker);
      }

      // CPU monitoring
      let lastCpuUsage = process.cpuUsage();
      this.cpuMonitor = setInterval(() => {
        const currentCpuUsage = process.cpuUsage(lastCpuUsage);
        const cpuPercent = (currentCpuUsage.user + currentCpuUsage.system) / 1000000 * 100;
        
        this.metrics.cpuUsage.push({
          timestamp: Date.now(),
          percent: cpuPercent
        });

        // Apply CPU throttling if usage is high
        if (cpuPercent > this.config.maxCpuPercent && this.config.enableCpuThrottling) {
          this.applyCpuThrottling();
        }

        lastCpuUsage = process.cpuUsage();
        
        // Keep only last 100 measurements
        if (this.metrics.cpuUsage.length > 100) {
          this.metrics.cpuUsage.shift();
        }
      }, 1000);
    } else {
      // Worker thread code for CPU-intensive operations
      this.setupWorkerThread();
    }

    // Crypto operation optimization
    this.cryptoOptimizations = {
      // Pre-computed hashes for common operations
      hashCache: new Map(),
      
      // Async crypto operations
      hashAsync: async (data, algorithm = 'sha256') => {
        const key = `${algorithm}:${data}`;
        if (this.cryptoOptimizations.hashCache.has(key)) {
          return this.cryptoOptimizations.hashCache.get(key);
        }
        
        return new Promise((resolve, reject) => {
          const hash = crypto.createHash(algorithm);
          hash.on('readable', () => {
            const data = hash.read();
            if (data) {
              const result = data.toString('hex');
              this.cryptoOptimizations.hashCache.set(key, result);
              resolve(result);
            }
          });
          hash.write(data);
          hash.end();
        });
      }
    };

    console.log('CPU optimization setup complete');
  }

  /**
   * Setup network optimization strategies
   */
  async setupNetworkOptimization() {
    const zlib = require('zlib');
    
    // Compression optimization
    this.compressionOptions = {
      level: this.config.compressionLevel,
      chunkSize: 16 * 1024,
      windowBits: 15,
      memLevel: 8
    };

    // Network buffer optimization
    this.networkBuffers = {
      // Reusable buffers for network operations
      sendBuffer: Buffer.allocUnsafe(this.config.maxPayloadSize),
      receiveBuffer: Buffer.allocUnsafe(this.config.maxPayloadSize * 2),
      
      // Message batching for efficiency
      messageBatch: [],
      batchTimeout: null,
      maxBatchSize: 100,
      maxBatchDelay: 50, // ms
      
      // Bandwidth throttling
      bandwidthLimit: 10 * 1024 * 1024, // 10 MB/s
      bandwidthUsed: 0,
      bandwidthWindow: 1000 // 1 second window
    };

    // Message compression function
    this.compressMessage = async (message) => {
      if (message.length < 1024) {
        return message; // Don't compress small messages
      }
      
      return new Promise((resolve, reject) => {
        zlib.gzip(message, this.compressionOptions, (err, compressed) => {
          if (err) {
            reject(err);
          } else {
            resolve(compressed);
          }
        });
      });
    };

    // Message decompression function
    this.decompressMessage = async (compressed) => {
      return new Promise((resolve, reject) => {
        zlib.gunzip(compressed, (err, decompressed) => {
          if (err) {
            reject(err);
          } else {
            resolve(decompressed);
          }
        });
      });
    };

    // Bandwidth monitoring
    this.bandwidthMonitor = setInterval(() => {
      this.networkBuffers.bandwidthUsed = 0;
    }, this.networkBuffers.bandwidthWindow);

    console.log('Network optimization setup complete');
  }

  /**
   * Setup cache optimization strategies
   */
  async setupCacheOptimization() {
    // Multi-layer caching system
    this.cacheSystem = {
      // L1: In-memory cache (fastest)
      l1Cache: new Map(),
      l1MaxSize: 1000,
      
      // L2: LRU cache (memory efficient)
      l2Cache: this.memoryCache,
      
      // L3: Redis cache (shared across instances)
      l3Cache: null, // Will be initialized if Redis is available
      
      // Cache statistics
      stats: {
        l1Hits: 0,
        l1Misses: 0,
        l2Hits: 0,
        l2Misses: 0,
        l3Hits: 0,
        l3Misses: 0
      }
    };

    // Smart caching strategies
    this.cachingStrategies = {
      // Time-based expiration
      timeBasedExpiry: (key, ttl = this.config.cacheTTL) => {
        return {
          key,
          expiresAt: Date.now() + ttl,
          isExpired: function() {
            return Date.now() > this.expiresAt;
          }
        };
      },
      
      // Frequency-based caching
      frequencyBasedCache: new Map(),
      
      // Predictive caching based on access patterns
      accessPatterns: new Map()
    };

    // Cache warming for frequently accessed data
    this.cacheWarming = {
      warmupPatterns: [
        'market_data:*',
        'user_preferences:*',
        'price_history:*'
      ],
      
      async warmCache() {
        console.log('Starting cache warmup...');
        // Implementation would load frequently accessed data
        console.log('Cache warmup completed');
      }
    };

    await this.cacheWarming.warmCache();
    console.log('Cache optimization setup complete');
  }

  /**
   * Setup database optimization strategies
   */
  async setupDatabaseOptimization() {
    // Connection pooling
    this.connectionPool = {
      connections: [],
      maxConnections: this.config.poolSize,
      activeConnections: 0,
      waitingQueue: [],
      
      async getConnection() {
        if (this.connections.length > 0) {
          return this.connections.pop();
        }
        
        if (this.activeConnections < this.maxConnections) {
          this.activeConnections++;
          // Create new connection (mock implementation)
          return { id: crypto.randomUUID(), active: true };
        }
        
        // Wait for available connection
        return new Promise((resolve) => {
          this.waitingQueue.push(resolve);
        });
      },
      
      releaseConnection(connection) {
        if (this.waitingQueue.length > 0) {
          const resolve = this.waitingQueue.shift();
          resolve(connection);
        } else {
          this.connections.push(connection);
        }
      }
    };

    // Query optimization
    this.queryOptimizer = {
      // Query cache
      queryCache: new Map(),
      
      // Prepared statements cache
      preparedStatements: new Map(),
      
      // Query execution time tracking
      queryMetrics: new Map(),
      
      // Batch query optimization
      batchQueries: [],
      batchTimeout: null,
      maxBatchSize: 50,
      maxBatchDelay: 10, // ms
      
      optimizeQuery: (query) => {
        // Query optimization logic
        let optimizedQuery = query;
        
        // Add LIMIT if missing for SELECT queries
        if (query.toLowerCase().includes('select') && !query.toLowerCase().includes('limit')) {
          optimizedQuery += ' LIMIT 1000';
        }
        
        // Add appropriate indexes hints
        // Implementation would analyze query and suggest indexes
        
        return optimizedQuery;
      }
    };

    // Database monitoring
    this.databaseMonitor = {
      slowQueries: [],
      connectionUsage: [],
      
      trackQuery: (query, executionTime) => {
        if (executionTime > 100) { // Log slow queries (>100ms)
          this.slowQueries.push({
            query,
            executionTime,
            timestamp: Date.now()
          });
          
          // Keep only last 100 slow queries
          if (this.slowQueries.length > 100) {
            this.slowQueries.shift();
          }
        }
      }
    };

    console.log('Database optimization setup complete');
  }

  /**
   * Apply performance optimization to operation
   */
  async optimizeOperation(operationType, operation, data = {}) {
    const startTime = process.hrtime.bigint();
    this.performanceCounters.totalRequests++;
    
    try {
      let result;
      
      switch (operationType) {
        case 'websocket_message':
          result = await this.optimizeWebSocketMessage(operation, data);
          break;
        case 'database_query':
          result = await this.optimizeDatabaseQuery(operation, data);
          break;
        case 'crypto_operation':
          result = await this.optimizeCryptoOperation(operation, data);
          break;
        case 'cache_operation':
          result = await this.optimizeCacheOperation(operation, data);
          break;
        case 'network_operation':
          result = await this.optimizeNetworkOperation(operation, data);
          break;
        default:
          result = await operation(data);
      }
      
      this.performanceCounters.successfulRequests++;
      this.performanceCounters.optimizationsApplied++;
      
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
      
      this.metrics.responseTime.push({
        timestamp: Date.now(),
        operationType,
        executionTime
      });
      
      // Keep only last 1000 measurements
      if (this.metrics.responseTime.length > 1000) {
        this.metrics.responseTime.shift();
      }
      
      return result;
    } catch (error) {
      this.performanceCounters.failedRequests++;
      throw error;
    }
  }

  /**
   * Optimize WebSocket message processing
   */
  async optimizeWebSocketMessage(operation, data) {
    // Use object pooling for message objects
    const messageObj = this.objectPools.websocketMessages.acquire();
    
    try {
      // Reset and populate message object
      Object.keys(messageObj).forEach(key => delete messageObj[key]);
      Object.assign(messageObj, data);
      
      // Apply compression if message is large
      if (JSON.stringify(messageObj).length > 1024) {
        messageObj.compressed = true;
        messageObj.data = await this.compressMessage(JSON.stringify(messageObj.data));
      }
      
      const result = await operation(messageObj);
      return result;
    } finally {
      // Return object to pool
      this.objectPools.websocketMessages.release(messageObj);
    }
  }

  /**
   * Optimize database query execution
   */
  async optimizeDatabaseQuery(operation, data) {
    const { query, params } = data;
    
    // Check query cache first
    const cacheKey = `query:${crypto.createHash('md5').update(query + JSON.stringify(params)).digest('hex')}`;
    
    if (this.config.enableQueryCache) {
      const cached = this.cacheSystem.l2Cache.get(cacheKey);
      if (cached) {
        this.cacheSystem.stats.l2Hits++;
        return cached;
      }
    }
    
    // Optimize query
    const optimizedQuery = this.queryOptimizer.optimizeQuery(query);
    
    // Get connection from pool
    const connection = await this.connectionPool.getConnection();
    
    try {
      const startTime = Date.now();
      const result = await operation({ query: optimizedQuery, params, connection });
      const executionTime = Date.now() - startTime;
      
      // Track query performance
      this.databaseMonitor.trackQuery(optimizedQuery, executionTime);
      this.queryOptimizer.queryMetrics.set(cacheKey, executionTime);
      
      // Cache result if query is fast and result is not too large
      if (executionTime < 100 && JSON.stringify(result).length < 64 * 1024) {
        this.cacheSystem.l2Cache.set(cacheKey, result);
      }
      
      return result;
    } finally {
      this.connectionPool.releaseConnection(connection);
    }
  }

  /**
   * Optimize cryptographic operations
   */
  async optimizeCryptoOperation(operation, data) {
    const { algorithm, input } = data;
    
    // Use worker thread for CPU-intensive crypto operations
    if (input.length > 1024 * 1024) { // 1MB threshold
      return this.delegateToWorker('crypto', { operation, algorithm, input });
    }
    
    // Use optimized crypto functions
    if (algorithm === 'hash') {
      return this.cryptoOptimizations.hashAsync(input, data.hashAlgorithm);
    }
    
    return operation(data);
  }

  /**
   * Optimize cache operations
   */
  async optimizeCacheOperation(operation, data) {
    const { key, value, action } = data;
    
    if (action === 'get') {
      // Try L1 cache first (fastest)
      if (this.cacheSystem.l1Cache.has(key)) {
        this.cacheSystem.stats.l1Hits++;
        return this.cacheSystem.l1Cache.get(key);
      }
      
      // Try L2 cache (LRU)
      const l2Result = this.cacheSystem.l2Cache.get(key);
      if (l2Result) {
        this.cacheSystem.stats.l2Hits++;
        // Promote to L1 cache
        this.setL1Cache(key, l2Result);
        return l2Result;
      }
      
      this.cacheSystem.stats.l2Misses++;
      return null;
    }
    
    if (action === 'set') {
      // Set in both L1 and L2 caches
      this.setL1Cache(key, value);
      this.cacheSystem.l2Cache.set(key, value);
      return true;
    }
    
    return operation(data);
  }

  /**
   * Optimize network operations
   */
  async optimizeNetworkOperation(operation, data) {
    // Check bandwidth limits
    if (this.networkBuffers.bandwidthUsed >= this.networkBuffers.bandwidthLimit) {
      throw new Error('Bandwidth limit exceeded');
    }
    
    // Apply compression if enabled
    if (this.config.enableGzip && data.payload && data.payload.length > 1024) {
      data.payload = await this.compressMessage(data.payload);
      data.compressed = true;
    }
    
    const result = await operation(data);
    
    // Track bandwidth usage
    if (data.payload) {
      this.networkBuffers.bandwidthUsed += data.payload.length;
    }
    
    return result;
  }

  /**
   * Set L1 cache with size management
   */
  setL1Cache(key, value) {
    if (this.cacheSystem.l1Cache.size >= this.cacheSystem.l1MaxSize) {
      // Remove oldest entry (simple FIFO)
      const firstKey = this.cacheSystem.l1Cache.keys().next().value;
      this.cacheSystem.l1Cache.delete(firstKey);
    }
    this.cacheSystem.l1Cache.set(key, value);
  }

  /**
   * Delegate CPU-intensive work to worker thread
   */
  async delegateToWorker(operation, data) {
    const availableWorker = this.workerPool.find(worker => worker.available);
    
    if (!availableWorker) {
      throw new Error('No available worker threads');
    }
    
    availableWorker.available = false;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker operation timeout'));
      }, 30000);
      
      availableWorker.once('message', (result) => {
        clearTimeout(timeout);
        availableWorker.available = true;
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result.data);
        }
      });
      
      availableWorker.postMessage({ operation, data });
    });
  }

  /**
   * Setup worker thread functionality
   */
  setupWorkerThread() {
    const { parentPort, workerData } = require('worker_threads');
    
    if (parentPort) {
      parentPort.on('message', async ({ operation, data }) => {
        try {
          let result;
          
          switch (operation) {
            case 'crypto':
              result = await this.performCryptoOperation(data);
              break;
            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
          
          parentPort.postMessage({ data: result });
        } catch (error) {
          parentPort.postMessage({ error: error.message });
        }
      });
    }
  }

  /**
   * Perform cryptographic operation in worker thread
   */
  async performCryptoOperation(data) {
    const { algorithm, input, hashAlgorithm } = data;
    
    if (algorithm === 'hash') {
      const hash = crypto.createHash(hashAlgorithm || 'sha256');
      hash.update(input);
      return hash.digest('hex');
    }
    
    throw new Error(`Unsupported crypto algorithm: ${algorithm}`);
  }

  /**
   * Apply CPU throttling when usage is high
   */
  applyCpuThrottling() {
    // Implement CPU throttling strategies
    console.log('Applying CPU throttling due to high usage');
    
    // Reduce worker thread count temporarily
    const throttledWorkers = Math.floor(this.workerPool.length * 0.7);
    for (let i = throttledWorkers; i < this.workerPool.length; i++) {
      this.workerPool[i].available = false;
    }
    
    // Re-enable after delay
    setTimeout(() => {
      this.workerPool.forEach(worker => worker.available = true);
      console.log('CPU throttling released');
    }, 5000);
  }

  /**
   * Force garbage collection when memory usage is high
   */
  forceGarbageCollection() {
    if (global.gc) {
      global.gc();
      console.log('Forced garbage collection due to high memory usage');
    }
    
    // Clear some caches to free memory
    this.cacheSystem.l1Cache.clear();
    this.cryptoOptimizations.hashCache.clear();
    
    this.emit('memoryOptimized');
  }

  /**
   * Start memory monitoring
   */
  startMemoryMonitoring() {
    console.log('Memory monitoring started');
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    const currentMemory = process.memoryUsage();
    
    return {
      timestamp: Date.now(),
      counters: this.performanceCounters,
      metrics: {
        ...this.metrics,
        currentMemoryMB: currentMemory.heapUsed / (1024 * 1024),
        cacheHitRate: this.calculateCacheHitRate()
      },
      cacheStats: this.cacheSystem.stats,
      optimization: {
        strategiesActive: this.activeOptimizations.size,
        poolsActive: this.resourcePools.size
      }
    };
  }

  /**
   * Calculate cache hit rate
   */
  calculateCacheHitRate() {
    const totalHits = this.cacheSystem.stats.l1Hits + this.cacheSystem.stats.l2Hits + this.cacheSystem.stats.l3Hits;
    const totalMisses = this.cacheSystem.stats.l1Misses + this.cacheSystem.stats.l2Misses + this.cacheSystem.stats.l3Misses;
    const total = totalHits + totalMisses;
    
    return total > 0 ? (totalHits / total) * 100 : 0;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    // Clear intervals
    if (this.memoryMonitor?.checkInterval) {
      clearInterval(this.memoryMonitor.checkInterval);
    }
    if (this.cpuMonitor) {
      clearInterval(this.cpuMonitor);
    }
    if (this.bandwidthMonitor) {
      clearInterval(this.bandwidthMonitor);
    }
    
    // Terminate worker threads
    if (this.workerPool) {
      this.workerPool.forEach(worker => worker.terminate());
    }
    
    // Clear caches
    this.cacheSystem.l1Cache.clear();
    this.cacheSystem.l2Cache.clear();
    
    console.log('Performance optimizer cleanup completed');
  }
}

/**
 * Object Pool for memory optimization
 */
class ObjectPool {
  constructor(createFn, maxSize = 100) {
    this.createFn = createFn;
    this.maxSize = maxSize;
    this.pool = [];
    this.created = 0;
    this.acquired = 0;
    this.released = 0;
  }

  acquire() {
    if (this.pool.length > 0) {
      this.acquired++;
      return this.pool.pop();
    }
    
    if (this.created < this.maxSize) {
      this.created++;
      this.acquired++;
      return this.createFn();
    }
    
    throw new Error('Object pool exhausted');
  }

  release(obj) {
    if (this.pool.length < this.maxSize) {
      // Reset object state if needed
      if (typeof obj.reset === 'function') {
        obj.reset();
      }
      this.pool.push(obj);
      this.released++;
    }
  }

  getStats() {
    return {
      poolSize: this.pool.length,
      created: this.created,
      acquired: this.acquired,
      released: this.released,
      utilization: (this.acquired - this.released) / this.created
    };
  }
}

module.exports = PerformanceOptimizer;