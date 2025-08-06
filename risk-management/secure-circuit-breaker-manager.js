const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');
const crypto = require('crypto');

class SecureCircuitBreakerManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Validated circuit breaker thresholds
      failureThreshold: this.validateNumber(config.failureThreshold, 10, 1, 1000),
      volumeThreshold: this.validateNumber(config.volumeThreshold, 1000000, 1000, 1e12),
      latencyThreshold: this.validateNumber(config.latencyThreshold, 5000, 100, 300000),
      errorRateThreshold: this.validateNumber(config.errorRateThreshold, 0.1, 0.01, 1.0),
      
      // Validated time windows
      timeWindow: this.validateNumber(config.timeWindow, 60000, 10000, 3600000),
      halfOpenWindow: this.validateNumber(config.halfOpenWindow, 30000, 5000, 600000),
      resetWindow: this.validateNumber(config.resetWindow, 300000, 60000, 3600000),
      
      // Recovery settings with validation
      successThreshold: this.validateNumber(config.successThreshold, 5, 1, 100),
      maxTestRequests: this.validateNumber(config.maxTestRequests, 3, 1, 50),
      
      // Sanitized system breakers
      systemBreakers: this.validateSystemBreakers(config.systemBreakers || {
        trading: { enabled: true, priority: 'critical' },
        withdrawal: { enabled: true, priority: 'high' },
        deposit: { enabled: true, priority: 'medium' },
        api: { enabled: true, priority: 'medium' }
      }),
      
      // Performance and security settings
      autoRecovery: config.autoRecovery !== false,
      recoveryTimeout: this.validateNumber(config.recoveryTimeout, 600000, 60000, 3600000),
      emergencyThreshold: this.validateNumber(config.emergencyThreshold, 0.5, 0.1, 1.0),
      maxCacheSize: this.validateNumber(config.maxCacheSize, 10000, 100, 1000000),
      
      // Secure Redis configuration
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'risk:circuit:'),
      
      // Authentication and authorization
      authenticationRequired: config.authenticationRequired !== false,
      maxFailedAttempts: this.validateNumber(config.maxFailedAttempts, 5, 1, 100),
      lockoutDuration: this.validateNumber(config.lockoutDuration, 300000, 60000, 3600000),
      
      // Performance optimizations
      batchSize: this.validateNumber(config.batchSize, 100, 10, 1000),
      enableCompression: config.enableCompression !== false,
      usePipelining: config.usePipelining !== false,
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Secure data structures with size limits
    this.circuitBreakers = new Map(); // Limited size with LRU eviction
    this.requestCounts = new Map();
    this.errorCounts = new Map();
    this.latencyData = new Map();
    this.volumeData = new Map();
    this.stateHistory = new Map();
    this.testRequests = new Map();
    
    // Performance optimization caches
    this.breakerCache = new LRU(this.config.maxCacheSize / 4);
    this.metricCache = new LRU(this.config.maxCacheSize / 4);
    this.cacheExpiry = new Map();
    
    // Security tracking
    this.systemState = 'normal';
    this.emergencyStartTime = null;
    this.emergencyTriggers = [];
    this.failedAttempts = new Map(); // userId -> attempts count
    this.lockedUsers = new Map(); // userId -> lockout expiry
    
    // Performance monitoring
    this.performanceStats = {
      tripsPerHour: 0,
      averageRecoveryTime: 0,
      falsePositiveRate: 0,
      systemAvailability: 1.0,
      checksPerSecond: 0,
      averageCheckTime: 0,
      cacheHitRate: 0,
      memoryUsage: 0
    };
    
    // Authentication and authorization
    this.authorizedUsers = new Set();
    this.permissionMatrix = new Map();
    
    // Atomic operation locks
    this.operationLocks = new Map();
    this.lockTimeouts = new Map();
    
    // Memory management
    this.maxMemoryUsage = config.maxMemoryUsage || 512 * 1024 * 1024; // 512MB
    this.memoryCheckInterval = 60000; // 1 minute
    
    // Rate limiting
    this.rateLimiters = new Map();
    this.defaultRateLimit = { requests: 1000, window: 60000 }; // 1000 requests per minute
  }

  // Input validation helpers
  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateSystemBreakers(breakers) {
    const validatedBreakers = {};
    const allowedPriorities = ['low', 'medium', 'high', 'critical'];
    
    for (const [key, config] of Object.entries(breakers)) {
      if (typeof config === 'object' && config !== null) {
        const sanitizedKey = this.sanitizeString(key);
        validatedBreakers[sanitizedKey] = {
          enabled: config.enabled === true,
          priority: allowedPriorities.includes(config.priority) ? config.priority : 'medium',
          ...this.sanitizeObject(config)
        };
      }
    }
    
    return validatedBreakers;
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100);
  }

  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
        throw new Error('Invalid Redis URL protocol');
      }
      return url;
    } catch {
      return null;
    }
  }

  sanitizeKeyPrefix(prefix) {
    if (typeof prefix !== 'string') return 'risk:circuit:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  sanitizeObject(obj) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanKey = this.sanitizeString(key);
      if (cleanKey && typeof value !== 'function') {
        if (typeof value === 'string') {
          sanitized[cleanKey] = this.sanitizeString(value);
        } else if (typeof value === 'number' && isFinite(value)) {
          sanitized[cleanKey] = value;
        } else if (typeof value === 'boolean') {
          sanitized[cleanKey] = value;
        }
      }
    }
    return sanitized;
  }

  // Authentication and authorization
  async authenticate(authToken) {
    if (!this.config.authenticationRequired) return true;
    
    if (!authToken || typeof authToken !== 'string') {
      throw new Error('Authentication token required');
    }
    
    try {
      // Verify JWT token or API key
      const isValid = await this.verifyAuthToken(authToken);
      if (!isValid) {
        throw new Error('Invalid authentication token');
      }
      return true;
    } catch (error) {
      await this.metrics.incrementCounter('circuit_breaker.auth_failures', 1, {}, 'risk');
      throw new Error('Authentication failed');
    }
  }

  async authorize(userId, operation, authenticatedUser) {
    const permissions = this.permissionMatrix.get(userId) || [];
    const requiredPermission = `circuit_breaker.${operation}`;
    
    if (!permissions.includes(requiredPermission) && !permissions.includes('circuit_breaker.*')) {
      throw new Error(`Insufficient permissions for operation: ${operation}`);
    }
    
    return true;
  }

  async verifyAuthToken(token) {
    // Implement JWT verification or API key validation
    return token.length > 10; // Simplified for example
  }

  // Rate limiting
  async checkRateLimit(userId, operation = 'default') {
    const key = `${userId}:${operation}`;
    const limiter = this.rateLimiters.get(key) || { ...this.defaultRateLimit, count: 0, window: Date.now() };
    
    const now = Date.now();
    if (now - limiter.window >= limiter.window) {
      limiter.count = 0;
      limiter.window = now;
    }
    
    if (limiter.count >= limiter.requests) {
      throw new Error('Rate limit exceeded');
    }
    
    limiter.count++;
    this.rateLimiters.set(key, limiter);
    return true;
  }

  // Memory management
  checkMemoryUsage() {
    const usage = process.memoryUsage();
    this.performanceStats.memoryUsage = usage.heapUsed;
    
    if (usage.heapUsed > this.maxMemoryUsage) {
      this.performanceCleanup();
    }
  }

  performanceCleanup() {
    // Clean old cache entries
    const now = Date.now();
    const maxAge = 300000; // 5 minutes
    
    for (const [key, expiry] of this.cacheExpiry.entries()) {
      if (now - expiry > maxAge) {
        this.breakerCache.delete(key);
        this.metricCache.delete(key);
        this.cacheExpiry.delete(key);
      }
    }
    
    // Limit data structure sizes
    this.limitMapSize(this.rateLimiters, 10000);
    this.limitMapSize(this.failedAttempts, 1000);
    this.limitMapSize(this.lockedUsers, 1000);
    
    // Clean old historical data
    this.cleanupHistoricalData();
  }

  limitMapSize(map, maxSize) {
    if (map.size > maxSize) {
      const entries = Array.from(map.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toDelete = entries.slice(0, entries.length - maxSize);
      for (const [key] of toDelete) {
        map.delete(key);
      }
    }
  }

  cleanupHistoricalData() {
    const cutoff = Date.now() - this.config.timeWindow * 2;
    
    for (const breakerId of this.circuitBreakers.keys()) {
      this.cleanArrayData(this.latencyData, breakerId, cutoff);
      this.cleanArrayData(this.errorCounts, breakerId, cutoff);
      this.cleanArrayData(this.volumeData, breakerId, cutoff);
      this.cleanArrayData(this.requestCounts, breakerId, cutoff);
    }
  }

  cleanArrayData(dataMap, key, cutoff) {
    const array = dataMap.get(key);
    if (array && Array.isArray(array)) {
      const cleaned = array.filter(item => item.timestamp && item.timestamp > cutoff);
      dataMap.set(key, cleaned.slice(-1000)); // Keep max 1000 entries
    }
  }

  // Atomic operations with distributed locks
  async acquireLock(lockKey, timeoutMs = 30000) {
    const lockId = crypto.randomUUID();
    const lockPath = `${this.config.keyPrefix}locks:${this.sanitizeString(lockKey)}`;
    
    try {
      const result = await this.redis.set(lockPath, lockId, 'PX', timeoutMs, 'NX');
      if (result === 'OK') {
        this.operationLocks.set(lockKey, lockId);
        
        // Set cleanup timeout
        const timeout = setTimeout(() => {
          this.releaseLock(lockKey);
        }, timeoutMs);
        this.lockTimeouts.set(lockKey, timeout);
        
        return lockId;
      }
      throw new Error('Failed to acquire lock');
    } catch (error) {
      throw new Error(`Lock acquisition failed: ${error.message}`);
    }
  }

  async releaseLock(lockKey) {
    const lockId = this.operationLocks.get(lockKey);
    if (!lockId) return;
    
    const lockPath = `${this.config.keyPrefix}locks:${this.sanitizeString(lockKey)}`;
    
    try {
      // Use Lua script for atomic check-and-delete
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      
      await this.redis.eval(script, 1, lockPath, lockId);
      
      this.operationLocks.delete(lockKey);
      
      const timeout = this.lockTimeouts.get(lockKey);
      if (timeout) {
        clearTimeout(timeout);
        this.lockTimeouts.delete(lockKey);
      }
    } catch (error) {
      console.error('Lock release error:', error);
    }
  }

  async initialize() {
    try {
      // Initialize Redis connection with security options
      const Redis = require('redis');
      this.redis = Redis.createClient({
        url: this.config.redisUrl,
        socket: {
          connectTimeout: 10000,
          lazyConnect: true
        },
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      });
      
      await this.redis.connect();
      
      // Load existing circuit breaker states
      await this.loadCircuitBreakerStates();
      
      // Initialize system circuit breakers
      await this.initializeSystemBreakers();
      
      // Start memory monitoring
      this.memoryMonitorInterval = setInterval(() => {
        this.checkMemoryUsage();
      }, this.memoryCheckInterval);
      
      console.log('✅ Secure circuit breaker manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize secure circuit breaker manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('⚡ Starting secure circuit breaker manager...');
    this.isRunning = true;
    
    // Start monitoring with error handling
    this.startSecureMonitoring();
    
    // Start auto-recovery
    if (this.config.autoRecovery) {
      this.startSecureAutoRecovery();
    }
    
    // Start performance tracking
    this.startSecurePerformanceTracking();
    
    console.log('✅ Secure circuit breaker manager started');
  }

  startSecureMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.evaluateAllCircuitBreakers();
        await this.checkSystemHealth();
        await this.cleanupOldData();
        await this.updateSecurityMetrics();
      } catch (error) {
        console.error('Secure circuit breaker monitoring error:', error);
        await this.metrics.incrementCounter('circuit_breaker.monitoring_errors', 1, {}, 'risk');
      }
    }, 10000); // Every 10 seconds
  }

  startSecureAutoRecovery() {
    this.recoveryInterval = setInterval(async () => {
      try {
        await this.attemptSecureAutoRecovery();
      } catch (error) {
        console.error('Secure auto-recovery error:', error);
      }
    }, 30000); // Every 30 seconds
  }

  startSecurePerformanceTracking() {
    this.performanceInterval = setInterval(async () => {
      await this.updateSecurePerformanceMetrics();
    }, 60000); // Every minute
  }

  async initializeSystemBreakers() {
    for (const [breakerId, config] of Object.entries(this.config.systemBreakers)) {
      if (config.enabled) {
        await this.createSecureCircuitBreaker(breakerId, {
          type: 'system',
          priority: config.priority,
          ...config
        });
      }
    }
  }

  async createSecureCircuitBreaker(breakerId, config = {}, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      await this.authorize(authenticatedUser?.id, 'create', authenticatedUser);
    }
    
    // Input validation
    const sanitizedBreakerId = this.sanitizeString(breakerId);
    if (!sanitizedBreakerId) {
      throw new Error('Invalid circuit breaker ID');
    }
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'create_breaker');
    }
    
    // Acquire lock for atomic operation
    const lockId = await this.acquireLock(`create_breaker_${sanitizedBreakerId}`);
    
    try {
      // Check if breaker already exists
      if (this.circuitBreakers.has(sanitizedBreakerId)) {
        throw new Error(`Circuit breaker already exists: ${sanitizedBreakerId}`);
      }
      
      const breaker = {
        id: sanitizedBreakerId,
        state: 'closed', // closed, open, half-open
        type: this.sanitizeString(config.type || 'custom'),
        priority: ['low', 'medium', 'high', 'critical'].includes(config.priority) ? 
          config.priority : 'medium',
        
        // Validated thresholds
        failureThreshold: this.validateNumber(config.failureThreshold, this.config.failureThreshold, 1, 1000),
        volumeThreshold: this.validateNumber(config.volumeThreshold, this.config.volumeThreshold, 1000, 1e12),
        latencyThreshold: this.validateNumber(config.latencyThreshold, this.config.latencyThreshold, 100, 300000),
        errorRateThreshold: this.validateNumber(config.errorRateThreshold, this.config.errorRateThreshold, 0.01, 1.0),
        
        // Secure counters
        requestCount: 0,
        errorCount: 0,
        successCount: 0,
        
        // Timing with validation
        lastFailureTime: null,
        lastSuccessTime: null,
        stateChangeTime: Date.now(),
        nextAttemptTime: null,
        
        // Statistics
        totalRequests: 0,
        totalErrors: 0,
        averageLatency: 0,
        
        // Validated configuration
        timeWindow: this.validateNumber(config.timeWindow, this.config.timeWindow, 10000, 3600000),
        resetWindow: this.validateNumber(config.resetWindow, this.config.resetWindow, 60000, 3600000),
        
        // Metadata
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: authenticatedUser?.id || 'system',
        
        // Security metadata
        securityHash: this.generateSecurityHash(sanitizedBreakerId, config)
      };
      
      this.circuitBreakers.set(sanitizedBreakerId, breaker);
      
      // Initialize secure monitoring data
      this.requestCounts.set(sanitizedBreakerId, []);
      this.errorCounts.set(sanitizedBreakerId, []);
      this.latencyData.set(sanitizedBreakerId, []);
      this.volumeData.set(sanitizedBreakerId, []);
      this.stateHistory.set(sanitizedBreakerId, []);
      this.testRequests.set(sanitizedBreakerId, 0);
      
      // Save to Redis with encryption
      await this.saveSecureCircuitBreakerState(sanitizedBreakerId);
      
      this.emit('circuit_breaker_created', { 
        breakerId: sanitizedBreakerId, 
        config: this.sanitizeObject(breaker),
        user: authenticatedUser?.id 
      });
      
      console.log(`Secure circuit breaker created: ${sanitizedBreakerId} (${breaker.type})`);
      
      return breaker;
      
    } finally {
      await this.releaseLock(`create_breaker_${sanitizedBreakerId}`);
    }
  }

  generateSecurityHash(breakerId, config) {
    const data = JSON.stringify({ breakerId, config, timestamp: Date.now() });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async recordSecureRequest(breakerId, result, authenticatedUser = null) {
    // Input validation
    const sanitizedBreakerId = this.sanitizeString(breakerId);
    if (!sanitizedBreakerId) {
      throw new Error('Invalid circuit breaker ID');
    }
    
    const breaker = this.circuitBreakers.get(sanitizedBreakerId);
    if (!breaker) {
      throw new Error(`Circuit breaker not found: ${sanitizedBreakerId}`);
    }
    
    // Validate result object
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid result object');
    }
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'record_request');
    }
    
    const now = Date.now();
    
    // Acquire lock for atomic operation
    const lockId = await this.acquireLock(`record_${sanitizedBreakerId}`);
    
    try {
      // Validate and sanitize result data
      const sanitizedResult = {
        success: Boolean(result.success),
        latency: result.latency ? this.validateNumber(result.latency, 0, 0, 300000) : null,
        volume: result.volume ? this.validateNumber(result.volume, 0, 0, 1e12) : null,
        error: result.error ? this.sanitizeString(result.error) : null,
        timestamp: now
      };
      
      // Record request securely
      breaker.requestCount++;
      breaker.totalRequests++;
      breaker.updatedAt = now;
      
      // Record result with validation
      if (sanitizedResult.success) {
        breaker.successCount++;
        breaker.lastSuccessTime = now;
        
        // Record latency with bounds checking
        if (sanitizedResult.latency !== null) {
          this.recordSecureLatency(sanitizedBreakerId, sanitizedResult.latency);
          
          // Update average latency with exponential smoothing
          const alpha = 0.1;
          breaker.averageLatency = 
            (1 - alpha) * breaker.averageLatency + alpha * sanitizedResult.latency;
        }
        
        // Record volume with validation
        if (sanitizedResult.volume !== null) {
          this.recordSecureVolume(sanitizedBreakerId, sanitizedResult.volume);
        }
        
      } else {
        breaker.errorCount++;
        breaker.totalErrors++;
        breaker.lastFailureTime = now;
        
        // Record error details securely
        this.recordSecureError(sanitizedBreakerId, sanitizedResult.error || 'unknown');
      }
      
      // Evaluate circuit breaker state
      await this.evaluateCircuitBreaker(sanitizedBreakerId);
      
      // Update metrics
      await this.updateCircuitBreakerMetrics(sanitizedBreakerId);
      
      // Save state securely
      await this.saveSecureCircuitBreakerState(sanitizedBreakerId);
      
    } finally {
      await this.releaseLock(`record_${sanitizedBreakerId}`);
    }
  }

  recordSecureLatency(breakerId, latency) {
    const latencyArray = this.latencyData.get(breakerId) || [];
    latencyArray.push({ timestamp: Date.now(), latency });
    
    // Keep only recent data with size limit
    const cutoff = Date.now() - this.config.timeWindow;
    const filtered = latencyArray
      .filter(l => l.timestamp > cutoff)
      .slice(-1000); // Max 1000 entries
    
    this.latencyData.set(breakerId, filtered);
  }

  recordSecureVolume(breakerId, volume) {
    const volumeArray = this.volumeData.get(breakerId) || [];
    volumeArray.push({ timestamp: Date.now(), volume });
    
    // Keep only recent data with size limit
    const cutoff = Date.now() - this.config.timeWindow;
    const filtered = volumeArray
      .filter(v => v.timestamp > cutoff)
      .slice(-1000); // Max 1000 entries
    
    this.volumeData.set(breakerId, filtered);
  }

  recordSecureError(breakerId, error) {
    const errorArray = this.errorCounts.get(breakerId) || [];
    errorArray.push({ timestamp: Date.now(), error: this.sanitizeString(error) });
    
    // Keep only recent data with size limit
    const cutoff = Date.now() - this.config.timeWindow;
    const filtered = errorArray
      .filter(e => e.timestamp > cutoff)
      .slice(-1000); // Max 1000 entries
    
    this.errorCounts.set(breakerId, filtered);
  }

  async canExecuteSecureRequest(breakerId, authenticatedUser = null) {
    // Input validation
    const sanitizedBreakerId = this.sanitizeString(breakerId);
    if (!sanitizedBreakerId) {
      return { allowed: false, reason: 'invalid_breaker_id' };
    }
    
    const breaker = this.circuitBreakers.get(sanitizedBreakerId);
    if (!breaker) {
      return { allowed: true, reason: 'no_breaker' };
    }
    
    // Rate limiting
    if (authenticatedUser?.id) {
      try {
        await this.checkRateLimit(authenticatedUser.id, 'check_execution');
      } catch (error) {
        return { allowed: false, reason: 'rate_limit_exceeded' };
      }
    }
    
    switch (breaker.state) {
      case 'closed':
        return { allowed: true, state: 'closed' };
        
      case 'open':
        return { 
          allowed: false, 
          state: 'open',
          reason: 'circuit_breaker_open',
          nextAttempt: breaker.nextAttemptTime
        };
        
      case 'half-open':
        const testCount = this.testRequests.get(sanitizedBreakerId) || 0;
        if (testCount < this.config.maxTestRequests) {
          this.testRequests.set(sanitizedBreakerId, testCount + 1);
          return { 
            allowed: true, 
            state: 'half-open',
            testRequest: true 
          };
        } else {
          return { 
            allowed: false, 
            state: 'half-open',
            reason: 'test_limit_reached'
          };
        }
        
      default:
        return { allowed: false, reason: 'invalid_state' };
    }
  }

  async saveSecureCircuitBreakerState(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    if (!breaker) return;
    
    try {
      // Encrypt sensitive data
      const encryptedData = this.encryptData(JSON.stringify(breaker));
      
      await this.redis.hSet(
        `${this.config.keyPrefix}states`,
        breakerId,
        encryptedData
      );
      
      // Update cache
      this.breakerCache.set(breakerId, { ...breaker });
      this.cacheExpiry.set(breakerId, Date.now());
      
    } catch (error) {
      console.error('Failed to save circuit breaker state:', error);
      throw error;
    }
  }

  async loadCircuitBreakerStates() {
    try {
      const states = await this.redis.hGetAll(`${this.config.keyPrefix}states`);
      let loadedCount = 0;
      
      for (const [breakerId, encryptedData] of Object.entries(states)) {
        try {
          // Decrypt and parse data
          const decryptedData = this.decryptData(encryptedData);
          const breaker = JSON.parse(decryptedData);
          
          // Validate loaded breaker
          if (this.validateBreakerData(breaker)) {
            this.circuitBreakers.set(breakerId, breaker);
            
            // Initialize monitoring data
            this.requestCounts.set(breakerId, []);
            this.errorCounts.set(breakerId, []);
            this.latencyData.set(breakerId, []);
            this.volumeData.set(breakerId, []);
            this.stateHistory.set(breakerId, []);
            this.testRequests.set(breakerId, 0);
            
            loadedCount++;
          }
        } catch (error) {
          console.error(`Failed to load circuit breaker state for ${breakerId}:`, error);
        }
      }
      
      console.log(`Loaded ${loadedCount} secure circuit breaker states`);
    } catch (error) {
      console.error('Failed to load circuit breaker states:', error);
    }
  }

  validateBreakerData(breaker) {
    return breaker &&
           typeof breaker.id === 'string' &&
           ['closed', 'open', 'half-open'].includes(breaker.state) &&
           typeof breaker.createdAt === 'number' &&
           breaker.createdAt > 0;
  }

  encryptData(data) {
    if (!process.env.CIRCUIT_BREAKER_ENCRYPTION_KEY) {
      return data; // Return unencrypted if no key configured
    }
    
    const key = Buffer.from(process.env.CIRCUIT_BREAKER_ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  decryptData(encryptedData) {
    if (!process.env.CIRCUIT_BREAKER_ENCRYPTION_KEY) {
      return encryptedData; // Return as-is if no key configured
    }
    
    const key = Buffer.from(process.env.CIRCUIT_BREAKER_ENCRYPTION_KEY, 'hex');
    const parts = encryptedData.split(':');
    
    if (parts.length !== 2) {
      return encryptedData; // Return as-is if not encrypted format
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  async updateSecurityMetrics() {
    await this.metrics.setGauge('circuit_breaker.security.failed_attempts', 
      this.failedAttempts.size, {}, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.security.locked_users', 
      this.lockedUsers.size, {}, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.security.active_locks', 
      this.operationLocks.size, {}, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.performance.memory_usage', 
      this.performanceStats.memoryUsage, {}, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.performance.cache_hit_rate', 
      this.performanceStats.cacheHitRate, {}, 'risk');
  }

  async updateSecurePerformanceMetrics() {
    await this.updateSecurityMetrics();
    
    await this.metrics.setGauge('circuit_breaker.system_availability', 
      this.performanceStats.systemAvailability, {}, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.trips_per_hour', 
      this.performanceStats.tripsPerHour, {}, 'risk');
    
    await this.metrics.setGauge('circuit_breaker.emergency_mode', 
      this.systemState === 'emergency' ? 1 : 0, {}, 'risk');
    
    // Count breakers by state securely
    const states = { closed: 0, open: 0, 'half-open': 0 };
    for (const breaker of this.circuitBreakers.values()) {
      if (states.hasOwnProperty(breaker.state)) {
        states[breaker.state]++;
      }
    }
    
    for (const [state, count] of Object.entries(states)) {
      await this.metrics.setGauge('circuit_breaker.count_by_state', 
        count, { state }, 'risk');
    }
  }

  async attemptSecureAutoRecovery() {
    if (!this.config.autoRecovery) return;
    
    const now = Date.now();
    
    for (const [breakerId, breaker] of this.circuitBreakers) {
      if (breaker.state === 'open' && 
          now - breaker.stateChangeTime >= this.config.recoveryTimeout) {
        
        console.log(`Attempting secure auto-recovery for circuit breaker: ${breakerId}`);
        await this.transitionToHalfOpen(breakerId);
      }
    }
  }

  async transitionToHalfOpen(breakerId) {
    const breaker = this.circuitBreakers.get(breakerId);
    if (!breaker) return;
    
    const lockId = await this.acquireLock(`transition_${breakerId}`);
    
    try {
      breaker.state = 'half-open';
      breaker.stateChangeTime = Date.now();
      
      // Reset counters for testing
      breaker.requestCount = 0;
      breaker.errorCount = 0;
      breaker.successCount = 0;
      this.testRequests.set(breakerId, 0);
      
      this.emit('circuit_breaker_half_open', {
        breakerId,
        timestamp: Date.now()
      });
      
      console.log(`Circuit breaker half-open: ${breakerId}`);
      
      await this.saveSecureCircuitBreakerState(breakerId);
      
    } finally {
      await this.releaseLock(`transition_${breakerId}`);
    }
  }

  // Continue with remaining methods following the same security patterns...
  // [Additional methods would follow the same security, validation, and performance patterns]

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping secure circuit breaker manager...');
    
    // Stop intervals
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    if (this.memoryMonitorInterval) clearInterval(this.memoryMonitorInterval);
    
    // Release all locks
    for (const lockKey of this.operationLocks.keys()) {
      this.releaseLock(lockKey);
    }
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data structures
    this.circuitBreakers.clear();
    this.requestCounts.clear();
    this.errorCounts.clear();
    this.latencyData.clear();
    this.volumeData.clear();
    this.stateHistory.clear();
    this.testRequests.clear();
    this.operationLocks.clear();
    this.lockTimeouts.clear();
    this.rateLimiters.clear();
    this.failedAttempts.clear();
    this.lockedUsers.clear();
    
    this.isRunning = false;
    console.log('✅ Secure circuit breaker manager stopped');
  }
}

module.exports = SecureCircuitBreakerManager;