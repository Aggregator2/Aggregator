const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const Redis = require('redis');
const crypto = require('crypto');
const { promisify } = require('util');

class SecureMetricsCollector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      redisUrl: config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379',
      retentionPeriod: config.retentionPeriod || 86400 * 7, // 7 days
      aggregationIntervals: config.aggregationIntervals || [60, 300, 900, 3600],
      maxMemoryMB: config.maxMemoryMB || 512, // Memory limit
      maxMetricsPerKey: config.maxMetricsPerKey || 10000, // Per-key limit
      encryptionKey: config.encryptionKey || process.env.METRICS_ENCRYPTION_KEY,
      rateLimitPerSecond: config.rateLimitPerSecond || 1000,
      enableSanitization: config.enableSanitization !== false,
      ...config
    };

    this.redis = null;
    this.metrics = new Map();
    this.timers = new Map();
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    
    // Security and performance features
    this.rateLimiter = new Map(); // IP-based rate limiting
    this.memoryUsage = 0;
    this.lastCleanup = Date.now();
    this.encryptionCipher = null;
    
    // Validation patterns
    this.validMetricName = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    this.validLabelKey = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    this.maxKeyLength = 256;
    this.maxValueLength = 1024;
    
    if (this.config.encryptionKey) {
      this.initializeEncryption();
    }
  }

  initializeEncryption() {
    try {
      // Validate encryption key
      if (this.config.encryptionKey.length < 32) {
        throw new Error('Encryption key must be at least 32 characters');
      }
      
      this.encryptionCipher = {
        algorithm: 'aes-256-gcm',
        key: crypto.scryptSync(this.config.encryptionKey, 'metrics-salt', 32)
      };
    } catch (error) {
      console.error('Failed to initialize encryption:', error);
      throw error;
    }
  }

  encrypt(data) {
    if (!this.encryptionCipher) return data;
    
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(this.encryptionCipher.algorithm, this.encryptionCipher.key);
      cipher.setAAD(iv);
      
      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted: true,
        data: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      return data; // Fallback to unencrypted
    }
  }

  decrypt(encryptedData) {
    if (!encryptedData.encrypted || !this.encryptionCipher) {
      return encryptedData;
    }
    
    try {
      const decipher = crypto.createDecipher(this.encryptionCipher.algorithm, this.encryptionCipher.key);
      decipher.setAAD(Buffer.from(encryptedData.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      return encryptedData; // Return as-is if decryption fails
    }
  }

  validateInput(name, labels = {}, value = null) {
    // Validate metric name
    if (!name || typeof name !== 'string') {
      throw new Error('Metric name must be a non-empty string');
    }
    
    if (name.length > this.maxKeyLength) {
      throw new Error(`Metric name too long: ${name.length} > ${this.maxKeyLength}`);
    }
    
    if (!this.validMetricName.test(name)) {
      throw new Error(`Invalid metric name format: ${name}`);
    }
    
    // Validate labels
    if (labels && typeof labels === 'object') {
      for (const [key, val] of Object.entries(labels)) {
        if (!this.validLabelKey.test(key)) {
          throw new Error(`Invalid label key format: ${key}`);
        }
        
        if (key.length > this.maxKeyLength) {
          throw new Error(`Label key too long: ${key}`);
        }
        
        if (typeof val === 'string' && val.length > this.maxValueLength) {
          throw new Error(`Label value too long: ${val}`);
        }
      }
    }
    
    // Validate numeric values
    if (value !== null && typeof value !== 'number') {
      throw new Error('Metric value must be a number');
    }
    
    if (value !== null && !isFinite(value)) {
      throw new Error('Metric value must be finite');
    }
  }

  sanitizeInput(input) {
    if (!this.config.enableSanitization) return input;
    
    if (typeof input === 'string') {
      // Remove potential injection patterns
      return input
        .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Control characters
        .replace(/['"\\]/g, '') // Quotes and backslashes
        .substring(0, this.maxValueLength);
    }
    
    if (typeof input === 'object' && input !== null) {
      const sanitized = {};
      for (const [key, value] of Object.entries(input)) {
        const cleanKey = this.sanitizeInput(key);
        const cleanValue = this.sanitizeInput(value);
        if (cleanKey && cleanValue !== undefined) {
          sanitized[cleanKey] = cleanValue;
        }
      }
      return sanitized;
    }
    
    return input;
  }

  checkRateLimit(identifier = 'default') {
    const now = Date.now();
    const windowStart = Math.floor(now / 1000) * 1000; // 1-second window
    
    if (!this.rateLimiter.has(identifier)) {
      this.rateLimiter.set(identifier, { window: windowStart, count: 0 });
    }
    
    const limiter = this.rateLimiter.get(identifier);
    
    // Reset window if needed
    if (limiter.window < windowStart) {
      limiter.window = windowStart;
      limiter.count = 0;
    }
    
    limiter.count++;
    
    if (limiter.count > this.config.rateLimitPerSecond) {
      throw new Error(`Rate limit exceeded for ${identifier}`);
    }
    
    return true;
  }

  checkMemoryUsage() {
    const usage = process.memoryUsage();
    this.memoryUsage = usage.heapUsed;
    
    if (this.memoryUsage > this.config.maxMemoryMB * 1024 * 1024) {
      console.warn(`Memory usage high: ${Math.round(this.memoryUsage / 1024 / 1024)}MB`);
      this.performEmergencyCleanup();
    }
  }

  performEmergencyCleanup() {
    console.log('Performing emergency memory cleanup...');
    
    // Clear old rate limiters
    const cutoff = Date.now() - 10000; // 10 seconds
    for (const [key, limiter] of this.rateLimiter) {
      if (limiter.window < cutoff) {
        this.rateLimiter.delete(key);
      }
    }
    
    // Limit in-memory collections
    this.limitCollectionSize(this.timers, 1000);
    this.limitCollectionSize(this.counters, 10000);
    this.limitCollectionSize(this.gauges, 10000);
    this.limitCollectionSize(this.histograms, 1000);
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  limitCollectionSize(collection, maxSize) {
    if (collection.size > maxSize) {
      const keysToDelete = Array.from(collection.keys()).slice(0, collection.size - maxSize);
      for (const key of keysToDelete) {
        collection.delete(key);
      }
    }
  }

  async initialize() {
    try {
      // Create Redis connection with security options
      const redisOptions = {
        url: this.config.redisUrl,
        socket: {
          tls: this.config.redisUrl.includes('rediss://'),
          rejectUnauthorized: true
        }
      };
      
      // Add authentication if available
      if (process.env.REDIS_PASSWORD) {
        redisOptions.password = process.env.REDIS_PASSWORD;
      }
      
      this.redis = Redis.createClient(redisOptions);
      
      this.redis.on('error', (err) => {
        console.error('Redis error:', err);
        this.emit('error', err);
      });

      await this.redis.connect();
      
      // Test Redis connection with auth
      await this.redis.ping();
      
      console.log('✅ Secure metrics collector initialized');
      
      // Start background tasks
      this.startMaintenanceTasks();
      
    } catch (error) {
      console.error('Failed to initialize metrics collector:', error);
      throw error;
    }
  }

  startMaintenanceTasks() {
    // Memory monitoring
    setInterval(() => {
      this.checkMemoryUsage();
    }, 30000); // Every 30 seconds
    
    // Cleanup old data
    setInterval(async () => {
      await this.performScheduledCleanup();
    }, 300000); // Every 5 minutes
    
    // Rate limiter cleanup
    setInterval(() => {
      this.cleanupRateLimiters();
    }, 60000); // Every minute
  }

  async performScheduledCleanup() {
    const now = Date.now();
    const cutoff = now - (this.config.retentionPeriod * 1000);
    
    try {
      // Clean expired metrics from Redis
      const keys = await this.redis.keys('*');
      const pipeline = this.redis.pipeline();
      
      for (const key of keys) {
        if (key.includes('gauge:') || key.includes('histogram:')) {
          pipeline.zRemRangeByScore(key, 0, cutoff);
        }
      }
      
      await pipeline.exec();
      
      this.lastCleanup = now;
      console.log('✅ Scheduled cleanup completed');
      
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }

  cleanupRateLimiters() {
    const cutoff = Date.now() - 60000; // 1 minute
    for (const [key, limiter] of this.rateLimiter) {
      if (limiter.window < cutoff) {
        this.rateLimiter.delete(key);
      }
    }
  }

  // Secure timer implementation
  startTimer(name, labels = {}, identifier = 'default') {
    this.checkRateLimit(identifier);
    this.validateInput(name, labels);
    
    const sanitizedLabels = this.sanitizeInput(labels);
    const key = this.getMetricKey(name, sanitizedLabels);
    
    // Limit concurrent timers
    if (this.timers.size > this.config.maxMetricsPerKey) {
      throw new Error('Maximum concurrent timers exceeded');
    }
    
    this.timers.set(key, {
      startTime: performance.now(),
      labels: sanitizedLabels,
      name: name
    });
    
    return key;
  }

  endTimer(timerKey) {
    const timer = this.timers.get(timerKey);
    if (!timer) {
      console.warn(`Timer ${timerKey} not found`);
      return null;
    }

    const duration = performance.now() - timer.startTime;
    this.timers.delete(timerKey);
    
    // Record in histogram with validation
    if (duration >= 0 && duration < 3600000) { // Max 1 hour
      this.recordHistogram(timer.name, duration, timer.labels);
    }
    
    return duration;
  }

  // Secure counter implementation with atomic operations
  async incrementCounter(name, value = 1, labels = {}, identifier = 'default') {
    this.checkRateLimit(identifier);
    this.validateInput(name, labels, value);
    
    const sanitizedLabels = this.sanitizeInput(labels);
    const key = this.getMetricKey(name, sanitizedLabels);
    
    // Validate increment value
    if (Math.abs(value) > 1e10) {
      throw new Error('Counter increment too large');
    }
    
    // Atomic increment in Redis using pipeline
    const pipeline = this.redis.pipeline();
    pipeline.incrByFloat(`counter:${key}`, value);
    pipeline.expire(`counter:${key}`, this.config.retentionPeriod);
    
    const results = await pipeline.exec();
    const newValue = results[0][1];
    
    // Update in-memory counter with bounds checking
    const current = this.counters.get(key) || 0;
    const updated = Math.max(0, Math.min(current + value, 1e15)); // Prevent overflow
    this.counters.set(key, updated);
    
    // Emit event for real-time updates
    this.emit('counter', { 
      name: this.sanitizeInput(name), 
      value: updated, 
      labels: sanitizedLabels 
    });
    
    return updated;
  }

  // Secure gauge implementation
  async setGauge(name, value, labels = {}, identifier = 'default') {
    this.checkRateLimit(identifier);
    this.validateInput(name, labels, value);
    
    const sanitizedLabels = this.sanitizeInput(labels);
    const key = this.getMetricKey(name, sanitizedLabels);
    
    // Update in-memory gauge
    this.gauges.set(key, value);
    
    // Store in Redis with encryption
    const timestamp = Date.now();
    const dataToStore = this.encrypt({ value, timestamp });
    
    const pipeline = this.redis.pipeline();
    pipeline.zAdd(`gauge:${key}`, {
      score: timestamp,
      value: JSON.stringify(dataToStore)
    });
    
    // Cleanup old data and limit entries
    const maxEntries = Math.min(this.config.maxMetricsPerKey, 10000);
    pipeline.zRemRangeByRank(`gauge:${key}`, 0, -(maxEntries + 1));
    
    await pipeline.exec();
    
    // Emit event for real-time updates
    this.emit('gauge', { 
      name: this.sanitizeInput(name), 
      value, 
      labels: sanitizedLabels 
    });
    
    return value;
  }

  // Secure histogram implementation
  async recordHistogram(name, value, labels = {}, identifier = 'default') {
    this.checkRateLimit(identifier);
    this.validateInput(name, labels, value);
    
    const sanitizedLabels = this.sanitizeInput(labels);
    const key = this.getMetricKey(name, sanitizedLabels);
    
    // Validate histogram value
    if (value < 0 || value > 1e10) {
      throw new Error('Histogram value out of valid range');
    }
    
    // Update in-memory histogram with size limit
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    
    const histogram = this.histograms.get(key);
    histogram.push(value);
    
    // Keep only recent values with size limit
    const maxSize = Math.min(1000, this.config.maxMetricsPerKey / 10);
    if (histogram.length > maxSize) {
      histogram.splice(0, histogram.length - maxSize);
    }
    
    // Store in Redis with encryption
    const timestamp = Date.now();
    const dataToStore = this.encrypt({ value, timestamp });
    
    await this.redis.zAdd(`histogram:${key}`, {
      score: timestamp,
      value: JSON.stringify(dataToStore)
    });
    
    // Update statistics
    await this.updateHistogramStats(key);
    
    // Emit event for real-time updates
    this.emit('histogram', { 
      name: this.sanitizeInput(name), 
      value, 
      labels: sanitizedLabels 
    });
  }

  // Secure metric key generation
  getMetricKey(name, labels = {}) {
    // Validate and sanitize inputs
    const sanitizedName = this.sanitizeInput(name);
    const sanitizedLabels = this.sanitizeInput(labels);
    
    const labelStr = Object.entries(sanitizedLabels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`) // Use = instead of : to prevent confusion
      .join(',');
    
    const key = labelStr ? `${sanitizedName}{${labelStr}}` : sanitizedName;
    
    // Additional length validation
    if (key.length > this.maxKeyLength) {
      // Create a hash for very long keys
      const hash = crypto.createHash('sha256').update(key).digest('hex').substring(0, 32);
      return `${sanitizedName.substring(0, 100)}_${hash}`;
    }
    
    return key;
  }

  // Enhanced histogram statistics with bounds checking
  async updateHistogramStats(key) {
    const values = this.histograms.get(key) || [];
    if (values.length === 0) return;
    
    const sorted = [...values].sort((a, b) => a - b);
    const stats = {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: this.percentile(sorted, 0.5),
      p75: this.percentile(sorted, 0.75),
      p90: this.percentile(sorted, 0.9),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99),
      timestamp: Date.now()
    };
    
    const encryptedStats = this.encrypt(stats);
    
    await this.redis.set(`histogram:${key}:stats`, JSON.stringify(encryptedStats), {
      EX: this.config.retentionPeriod
    });
    
    return stats;
  }

  percentile(sortedArray, p) {
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  // Secure snapshot with data sanitization
  async getSnapshot() {
    const snapshot = {
      timestamp: Date.now(),
      counters: {},
      gauges: {},
      histograms: {},
      memoryUsage: this.memoryUsage,
      rateLimitStatus: this.rateLimiter.size
    };
    
    // Sanitize counter data
    for (const [key, value] of this.counters) {
      const sanitizedKey = this.sanitizeInput(key);
      snapshot.counters[sanitizedKey] = typeof value === 'number' ? value : 0;
    }
    
    // Sanitize gauge data
    for (const [key, value] of this.gauges) {
      const sanitizedKey = this.sanitizeInput(key);
      snapshot.gauges[sanitizedKey] = typeof value === 'number' ? value : 0;
    }
    
    // Sanitize histogram stats
    for (const [key, values] of this.histograms) {
      if (values.length > 0) {
        const sanitizedKey = this.sanitizeInput(key);
        const stats = await this.updateHistogramStats(key);
        snapshot.histograms[sanitizedKey] = stats;
      }
    }
    
    return snapshot;
  }

  // Secure time series retrieval with decryption
  async getTimeSeries(metricType, metricName, startTime, endTime, labels = {}) {
    this.validateInput(metricName, labels);
    
    const sanitizedLabels = this.sanitizeInput(labels);
    const key = this.getMetricKey(metricName, sanitizedLabels);
    const redisKey = `${metricType}:${key}`;
    
    try {
      const data = await this.redis.zRangeByScore(
        redisKey,
        startTime,
        endTime,
        { WITHSCORES: true }
      );
      
      // Parse and decrypt data
      const series = [];
      for (let i = 0; i < data.length; i += 2) {
        try {
          const encryptedData = JSON.parse(data[i]);
          const decryptedData = this.decrypt(encryptedData);
          
          // Validate decrypted data
          if (decryptedData && typeof decryptedData.value === 'number') {
            series.push({
              timestamp: parseInt(data[i + 1]),
              value: decryptedData.value
            });
          }
        } catch (e) {
          console.warn('Failed to parse metric data point:', e.message);
          // Skip corrupted data points
        }
      }
      
      return series;
      
    } catch (error) {
      console.error('Failed to retrieve time series:', error);
      return [];
    }
  }

  // Secure cleanup method
  async cleanup() {
    try {
      await this.performScheduledCleanup();
      console.log('✅ Secure metrics cleanup completed');
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }

  // Secure connection closure
  async close() {
    if (this.redis) {
      await this.redis.quit();
    }
    
    // Clear sensitive data from memory
    this.metrics.clear();
    this.timers.clear();
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.rateLimiter.clear();
    
    if (this.encryptionCipher) {
      this.encryptionCipher.key.fill(0); // Clear encryption key from memory
    }
  }
}

// Singleton instance with additional security
let secureMetricsCollector = null;

function getSecureMetricsCollector(config) {
  if (!secureMetricsCollector) {
    secureMetricsCollector = new SecureMetricsCollector(config);
  }
  return secureMetricsCollector;
}

module.exports = {
  SecureMetricsCollector,
  getSecureMetricsCollector
};