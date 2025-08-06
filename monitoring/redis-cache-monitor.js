/**
 * Redis Cache Performance Monitor
 * Tracks cache hit rates, memory usage, evictions, and performance metrics
 */

const { getMetricsCollector } = require('./metrics-collector');
const EventEmitter = require('events');
const Redis = require('ioredis');

class RedisCacheMonitor extends EventEmitter {
  constructor(redisConfig, config = {}) {
    super();
    this.redis = new Redis(redisConfig);
    this.metrics = getMetricsCollector();
    
    this.config = {
      // Performance thresholds
      thresholds: {
        hitRate: 0.85,              // 85% cache hit rate target
        evictionRate: 0.05,         // 5% eviction rate warning
        memoryUsage: 0.80,          // 80% memory usage warning
        responseTime: 5,            // 5ms response time target
        connectionErrors: 10,       // Connection errors per minute
        keyspaceSize: 10000000      // 10M keys warning threshold
      },
      // Monitoring intervals
      intervals: {
        hitRate: 10000,             // 10 seconds
        memory: 30000,              // 30 seconds
        slowlog: 60000,             // 1 minute
        keyspace: 300000            // 5 minutes
      },
      // Cache analysis
      analysis: {
        trackPatterns: true,        // Track key access patterns
        sampleRate: 0.01,           // Sample 1% of operations
        ttlAnalysis: true,          // Analyze TTL effectiveness
        hotKeyDetection: true       // Detect hot keys
      },
      ...config
    };

    // Cache statistics
    this.cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      expires: 0,
      evictions: 0,
      errors: 0
    };

    // Performance metrics
    this.performance = {
      hitRate: 0,
      missRate: 0,
      avgResponseTime: 0,
      memoryUsage: 0,
      evictionRate: 0,
      keyspaceHits: new Map(),
      hotKeys: new Set(),
      keyPatterns: new Map()
    };

    // Memory analysis
    this.memoryStats = {
      used: 0,
      peak: 0,
      fragmentation: 0,
      evictedKeys: 0,
      dataset: 0,
      overhead: 0
    };

    this.initialize();
  }

  async initialize() {
    try {
      // Configure Redis for monitoring
      await this.configureRedisMonitoring();
      
      // Start monitoring loops
      this.startMonitoring();
      
      // Subscribe to Redis events
      this.subscribeToRedisEvents();
      
      console.log('📊 Redis Cache Monitor initialized');
    } catch (error) {
      console.error('Failed to initialize Redis Cache Monitor:', error);
      throw error;
    }
  }

  /**
   * Configure Redis for enhanced monitoring
   */
  async configureRedisMonitoring() {
    try {
      // Enable keyspace notifications for expired keys
      await this.redis.config('SET', 'notify-keyspace-events', 'Ex');
      
      // Configure slowlog
      await this.redis.config('SET', 'slowlog-log-slower-than', '5000'); // 5ms
      await this.redis.config('SET', 'slowlog-max-len', '128');
      
      console.log('✅ Redis monitoring configured');
    } catch (error) {
      console.error('Failed to configure Redis monitoring:', error);
    }
  }

  /**
   * Subscribe to Redis keyspace events
   */
  subscribeToRedisEvents() {
    const subscriber = new Redis(this.redis.options);
    
    // Subscribe to expired keys
    subscriber.subscribe('__keyevent@0__:expired', (err) => {
      if (err) {
        console.error('Failed to subscribe to Redis events:', err);
      }
    });
    
    subscriber.on('message', (channel, key) => {
      if (channel.includes('expired')) {
        this.cacheStats.expires++;
        this.trackKeyPattern(key);
      }
    });
  }

  /**
   * Start monitoring loops
   */
  startMonitoring() {
    // Monitor hit rate
    this.hitRateInterval = setInterval(() => {
      this.calculateHitRate();
    }, this.config.intervals.hitRate);

    // Monitor memory usage
    this.memoryInterval = setInterval(() => {
      this.analyzeMemoryUsage();
    }, this.config.intervals.memory);

    // Monitor slow operations
    this.slowlogInterval = setInterval(() => {
      this.analyzeSlowLog();
    }, this.config.intervals.slowlog);

    // Monitor keyspace
    this.keyspaceInterval = setInterval(() => {
      this.analyzeKeyspace();
    }, this.config.intervals.keyspace);
  }

  /**
   * Track cache operation
   */
  trackOperation(operation, key, responseTime, hit = null) {
    const now = Date.now();
    
    // Update operation counts
    switch (operation) {
      case 'get':
        if (hit) {
          this.cacheStats.hits++;
        } else {
          this.cacheStats.misses++;
        }
        break;
      case 'set':
      case 'setex':
        this.cacheStats.sets++;
        break;
      case 'del':
        this.cacheStats.deletes++;
        break;
      case 'error':
        this.cacheStats.errors++;
        break;
    }

    // Track response time
    if (responseTime) {
      this.recordResponseTime(operation, responseTime);
    }

    // Track key patterns if enabled
    if (this.config.analysis.trackPatterns && Math.random() < this.config.analysis.sampleRate) {
      this.trackKeyPattern(key);
    }

    // Track hot keys
    if (this.config.analysis.hotKeyDetection && operation === 'get') {
      this.trackHotKey(key);
    }

    // Record metrics
    this.recordOperationMetrics(operation, responseTime, hit);
  }

  /**
   * Calculate cache hit rate
   */
  async calculateHitRate() {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    
    if (total > 0) {
      this.performance.hitRate = this.cacheStats.hits / total;
      this.performance.missRate = this.cacheStats.misses / total;
      
      // Check hit rate threshold
      if (this.performance.hitRate < this.config.thresholds.hitRate) {
        this.emit('alert', {
          type: 'low_cache_hit_rate',
          severity: 'medium',
          hitRate: this.performance.hitRate * 100,
          threshold: this.config.thresholds.hitRate * 100,
          message: `Low Redis cache hit rate: ${(this.performance.hitRate * 100).toFixed(2)}%`
        });
      }
      
      // Get Redis INFO stats
      const info = await this.redis.info('stats');
      const stats = this.parseRedisInfo(info);
      
      // Update metrics from Redis INFO
      if (stats.keyspace_hits && stats.keyspace_misses) {
        const redisTotal = parseInt(stats.keyspace_hits) + parseInt(stats.keyspace_misses);
        const redisHitRate = redisTotal > 0 ? parseInt(stats.keyspace_hits) / redisTotal : 0;
        
        // Record both application and Redis hit rates
        await this.metrics.setGauge('redis.hit_rate.application', this.performance.hitRate * 100);
        await this.metrics.setGauge('redis.hit_rate.server', redisHitRate * 100);
      }
    }
  }

  /**
   * Analyze memory usage
   */
  async analyzeMemoryUsage() {
    try {
      const info = await this.redis.info('memory');
      const stats = this.parseRedisInfo(info);
      
      // Update memory statistics
      this.memoryStats.used = parseInt(stats.used_memory || 0);
      this.memoryStats.peak = parseInt(stats.used_memory_peak || 0);
      this.memoryStats.fragmentation = parseFloat(stats.mem_fragmentation_ratio || 1);
      this.memoryStats.dataset = parseInt(stats.used_memory_dataset || 0);
      this.memoryStats.overhead = parseInt(stats.used_memory_overhead || 0);
      
      // Calculate memory usage percentage
      const maxMemory = parseInt(stats.maxmemory || 0);
      if (maxMemory > 0) {
        this.performance.memoryUsage = this.memoryStats.used / maxMemory;
        
        // Check memory threshold
        if (this.performance.memoryUsage > this.config.thresholds.memoryUsage) {
          this.emit('alert', {
            type: 'high_memory_usage',
            severity: 'high',
            usage: this.performance.memoryUsage * 100,
            threshold: this.config.thresholds.memoryUsage * 100,
            usedMemory: this.formatBytes(this.memoryStats.used),
            maxMemory: this.formatBytes(maxMemory),
            message: `High Redis memory usage: ${(this.performance.memoryUsage * 100).toFixed(2)}%`
          });
        }
      }
      
      // Check fragmentation
      if (this.memoryStats.fragmentation > 1.5) {
        this.emit('alert', {
          type: 'memory_fragmentation',
          severity: 'medium',
          fragmentation: this.memoryStats.fragmentation,
          message: `High Redis memory fragmentation: ${this.memoryStats.fragmentation.toFixed(2)}`
        });
      }
      
      // Get eviction statistics
      const evictedKeys = parseInt(stats.evicted_keys || 0);
      if (evictedKeys > this.memoryStats.evictedKeys) {
        const evictions = evictedKeys - this.memoryStats.evictedKeys;
        this.cacheStats.evictions += evictions;
        
        // Calculate eviction rate
        const totalOps = this.cacheStats.sets;
        if (totalOps > 0) {
          this.performance.evictionRate = this.cacheStats.evictions / totalOps;
          
          if (this.performance.evictionRate > this.config.thresholds.evictionRate) {
            this.emit('alert', {
              type: 'high_eviction_rate',
              severity: 'high',
              evictionRate: this.performance.evictionRate * 100,
              threshold: this.config.thresholds.evictionRate * 100,
              evictions: this.cacheStats.evictions,
              message: `High Redis eviction rate: ${(this.performance.evictionRate * 100).toFixed(2)}%`
            });
          }
        }
      }
      this.memoryStats.evictedKeys = evictedKeys;
      
      // Record memory metrics
      await this.recordMemoryMetrics();
      
    } catch (error) {
      console.error('Failed to analyze memory usage:', error);
    }
  }

  /**
   * Analyze slow log
   */
  async analyzeSlowLog() {
    try {
      const slowlog = await this.redis.slowlog('get', 100);
      
      if (slowlog.length > 0) {
        // Process slow operations
        const slowOps = slowlog.map(entry => ({
          id: entry[0],
          timestamp: new Date(entry[1] * 1000),
          duration: entry[2], // microseconds
          command: entry[3].join(' '),
          client: entry[4],
          clientName: entry[5]
        }));
        
        // Find extremely slow operations
        const criticalOps = slowOps.filter(op => op.duration > this.config.thresholds.responseTime * 1000);
        
        if (criticalOps.length > 0) {
          this.emit('alert', {
            type: 'slow_redis_operations',
            severity: 'high',
            count: criticalOps.length,
            operations: criticalOps.slice(0, 5).map(op => ({
              command: op.command.substring(0, 50),
              duration: op.duration / 1000 // Convert to ms
            })),
            message: `${criticalOps.length} slow Redis operations detected`
          });
        }
        
        // Analyze command patterns
        const commandStats = {};
        slowOps.forEach(op => {
          const cmd = op.command.split(' ')[0];
          if (!commandStats[cmd]) {
            commandStats[cmd] = { count: 0, totalTime: 0 };
          }
          commandStats[cmd].count++;
          commandStats[cmd].totalTime += op.duration;
        });
        
        // Record slow operation metrics
        for (const [cmd, stats] of Object.entries(commandStats)) {
          await this.metrics.recordHistogram('redis.slowlog.duration', stats.totalTime / stats.count / 1000, {
            command: cmd
          });
        }
        
        // Clear slowlog after processing
        await this.redis.slowlog('reset');
      }
    } catch (error) {
      console.error('Failed to analyze slow log:', error);
    }
  }

  /**
   * Analyze keyspace
   */
  async analyzeKeyspace() {
    try {
      const info = await this.redis.info('keyspace');
      const stats = this.parseRedisInfo(info);
      
      let totalKeys = 0;
      let totalExpires = 0;
      
      // Process each database
      for (const [key, value] of Object.entries(stats)) {
        if (key.startsWith('db')) {
          const dbStats = this.parseKeyspaceDb(value);
          totalKeys += dbStats.keys;
          totalExpires += dbStats.expires;
          
          // Record per-database metrics
          await this.metrics.setGauge('redis.keyspace.keys', dbStats.keys, {
            db: key
          });
          
          await this.metrics.setGauge('redis.keyspace.expires', dbStats.expires, {
            db: key
          });
        }
      }
      
      // Check keyspace size
      if (totalKeys > this.config.thresholds.keyspaceSize) {
        this.emit('alert', {
          type: 'large_keyspace',
          severity: 'medium',
          totalKeys,
          threshold: this.config.thresholds.keyspaceSize,
          message: `Large Redis keyspace: ${totalKeys.toLocaleString()} keys`
        });
      }
      
      // Analyze TTL usage
      if (this.config.analysis.ttlAnalysis && totalKeys > 0) {
        const ttlRatio = totalExpires / totalKeys;
        
        if (ttlRatio < 0.5) {
          this.emit('optimization_suggestion', {
            type: 'ttl_usage',
            ttlRatio: ttlRatio * 100,
            recommendation: 'Consider setting TTL on more keys to prevent unbounded memory growth'
          });
        }
      }
      
      // Analyze key patterns
      if (this.config.analysis.trackPatterns) {
        await this.analyzeKeyPatterns();
      }
      
    } catch (error) {
      console.error('Failed to analyze keyspace:', error);
    }
  }

  /**
   * Track key access patterns
   */
  trackKeyPattern(key) {
    if (!key) return;
    
    // Extract pattern (e.g., "user:123:profile" -> "user:*:profile")
    const pattern = key.replace(/:\d+:/g, ':*:').replace(/:\d+$/, ':*');
    
    if (!this.performance.keyPatterns.has(pattern)) {
      this.performance.keyPatterns.set(pattern, {
        count: 0,
        lastAccess: Date.now()
      });
    }
    
    const patternStats = this.performance.keyPatterns.get(pattern);
    patternStats.count++;
    patternStats.lastAccess = Date.now();
    
    // Keep only top 100 patterns
    if (this.performance.keyPatterns.size > 100) {
      const sorted = Array.from(this.performance.keyPatterns.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 100);
      
      this.performance.keyPatterns = new Map(sorted);
    }
  }

  /**
   * Track hot keys
   */
  trackHotKey(key) {
    if (!this.performance.keyspaceHits.has(key)) {
      this.performance.keyspaceHits.set(key, 0);
    }
    
    this.performance.keyspaceHits.set(key, this.performance.keyspaceHits.get(key) + 1);
    
    // Identify hot keys (top 1% of access frequency)
    if (this.performance.keyspaceHits.size > 100) {
      const sorted = Array.from(this.performance.keyspaceHits.entries())
        .sort((a, b) => b[1] - a[1]);
      
      const threshold = sorted[Math.floor(sorted.length * 0.01)][1];
      
      this.performance.hotKeys.clear();
      sorted.forEach(([k, count]) => {
        if (count >= threshold) {
          this.performance.hotKeys.add(k);
        }
      });
      
      // Keep only recent keys
      this.performance.keyspaceHits = new Map(sorted.slice(0, 1000));
    }
  }

  /**
   * Analyze key patterns for optimization
   */
  async analyzeKeyPatterns() {
    const patterns = Array.from(this.performance.keyPatterns.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);
    
    // Check for inefficient patterns
    for (const [pattern, stats] of patterns) {
      // Check for missing prefixes (potential performance issue)
      if (!pattern.includes(':') && stats.count > 1000) {
        this.emit('optimization_suggestion', {
          type: 'key_pattern',
          pattern,
          accessCount: stats.count,
          recommendation: 'Consider using key prefixes for better organization and scanning'
        });
      }
      
      // Check for overly complex patterns
      const colonCount = (pattern.match(/:/g) || []).length;
      if (colonCount > 5) {
        this.emit('optimization_suggestion', {
          type: 'complex_key_pattern',
          pattern,
          complexity: colonCount,
          recommendation: 'Consider simplifying key structure to reduce parsing overhead'
        });
      }
    }
  }

  /**
   * Record response time
   */
  recordResponseTime(operation, responseTime) {
    // Update average response time (exponential moving average)
    const alpha = 0.1; // Smoothing factor
    this.performance.avgResponseTime = 
      alpha * responseTime + (1 - alpha) * this.performance.avgResponseTime;
    
    // Check response time threshold
    if (responseTime > this.config.thresholds.responseTime) {
      this.emit('slow_operation', {
        operation,
        responseTime,
        threshold: this.config.thresholds.responseTime
      });
    }
  }

  /**
   * Record operation metrics
   */
  async recordOperationMetrics(operation, responseTime, hit) {
    // Record operation counter
    await this.metrics.incrementCounter(`redis.operations.${operation}`, 1);
    
    // Record response time
    if (responseTime) {
      await this.metrics.recordHistogram('redis.response_time', responseTime, {
        operation
      });
    }
    
    // Record hit/miss for get operations
    if (operation === 'get') {
      await this.metrics.incrementCounter(`redis.cache.${hit ? 'hits' : 'misses'}`, 1);
    }
  }

  /**
   * Record memory metrics
   */
  async recordMemoryMetrics() {
    await this.metrics.setGauge('redis.memory.used', this.memoryStats.used);
    await this.metrics.setGauge('redis.memory.peak', this.memoryStats.peak);
    await this.metrics.setGauge('redis.memory.fragmentation', this.memoryStats.fragmentation);
    await this.metrics.setGauge('redis.memory.dataset', this.memoryStats.dataset);
    await this.metrics.setGauge('redis.memory.overhead', this.memoryStats.overhead);
    await this.metrics.setGauge('redis.memory.usage_percent', this.performance.memoryUsage * 100);
    await this.metrics.incrementCounter('redis.evictions', this.cacheStats.evictions);
  }

  /**
   * Get cache performance report
   */
  getCacheReport() {
    const totalOps = this.cacheStats.hits + this.cacheStats.misses;
    
    return {
      summary: {
        hitRate: this.performance.hitRate * 100,
        missRate: this.performance.missRate * 100,
        totalOperations: totalOps,
        avgResponseTime: this.performance.avgResponseTime,
        errorRate: totalOps > 0 ? (this.cacheStats.errors / totalOps) * 100 : 0
      },
      operations: {
        hits: this.cacheStats.hits,
        misses: this.cacheStats.misses,
        sets: this.cacheStats.sets,
        deletes: this.cacheStats.deletes,
        expires: this.cacheStats.expires,
        evictions: this.cacheStats.evictions,
        errors: this.cacheStats.errors
      },
      memory: {
        used: this.formatBytes(this.memoryStats.used),
        peak: this.formatBytes(this.memoryStats.peak),
        dataset: this.formatBytes(this.memoryStats.dataset),
        overhead: this.formatBytes(this.memoryStats.overhead),
        fragmentation: this.memoryStats.fragmentation,
        usagePercent: this.performance.memoryUsage * 100
      },
      patterns: {
        topPatterns: Array.from(this.performance.keyPatterns.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 10)
          .map(([pattern, stats]) => ({
            pattern,
            accessCount: stats.count
          })),
        hotKeys: Array.from(this.performance.hotKeys).slice(0, 10)
      },
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Generate optimization recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    
    // Hit rate recommendations
    if (this.performance.hitRate < this.config.thresholds.hitRate) {
      recommendations.push({
        type: 'improve_hit_rate',
        priority: 'high',
        current: this.performance.hitRate * 100,
        target: this.config.thresholds.hitRate * 100,
        suggestions: [
          'Increase cache TTL for frequently accessed data',
          'Implement cache warming for predictable access patterns',
          'Review cache key design for better coverage'
        ]
      });
    }
    
    // Memory recommendations
    if (this.performance.memoryUsage > this.config.thresholds.memoryUsage) {
      recommendations.push({
        type: 'reduce_memory_usage',
        priority: 'high',
        current: this.performance.memoryUsage * 100,
        suggestions: [
          'Implement more aggressive TTL policies',
          'Consider using Redis memory optimization features (compression)',
          'Review and remove unused cache entries'
        ]
      });
    }
    
    // Eviction recommendations
    if (this.performance.evictionRate > this.config.thresholds.evictionRate) {
      recommendations.push({
        type: 'reduce_evictions',
        priority: 'medium',
        current: this.performance.evictionRate * 100,
        suggestions: [
          'Increase Redis maxmemory setting',
          'Optimize cache entry sizes',
          'Implement cache tiering strategy'
        ]
      });
    }
    
    return recommendations;
  }

  /**
   * Utility functions
   */
  parseRedisInfo(info) {
    const stats = {};
    info.split('\r\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          stats[key] = value;
        }
      }
    });
    return stats;
  }

  parseKeyspaceDb(dbInfo) {
    const match = dbInfo.match(/keys=(\d+),expires=(\d+)/);
    return {
      keys: parseInt(match[1] || 0),
      expires: parseInt(match[2] || 0)
    };
  }

  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Cleanup
   */
  async stop() {
    clearInterval(this.hitRateInterval);
    clearInterval(this.memoryInterval);
    clearInterval(this.slowlogInterval);
    clearInterval(this.keyspaceInterval);
    
    await this.redis.quit();
    
    console.log('🛑 Redis Cache Monitor stopped');
  }
}

module.exports = RedisCacheMonitor;