const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');
const crypto = require('crypto');

class SecureVolumeRestrictionsManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Validated volume limits by tier
      volumeLimits: this.validateVolumeLimits(config.volumeLimits || {
        tier1: { daily: 10000, weekly: 50000, monthly: 200000 },
        tier2: { daily: 50000, weekly: 250000, monthly: 1000000 },
        tier3: { daily: 200000, weekly: 1000000, monthly: 5000000 },
        tier4: { daily: 1000000, weekly: 5000000, monthly: 20000000 }
      }),
      
      // Default tier for new users with validation
      defaultTier: this.validateTier(config.defaultTier || 'tier1'),
      
      // Volume tracking windows with validation
      trackingWindows: this.validateTrackingWindows(config.trackingWindows || {
        hourly: 3600000,
        daily: 86400000,
        weekly: 86400000 * 7,
        monthly: 86400000 * 30
      }),
      
      // Rolling window configuration
      windowSlices: this.validateNumber(config.windowSlices, 24, 4, 168), // 24 hour slices
      retentionPeriod: this.validateNumber(config.retentionPeriod, 86400000 * 90, 86400000 * 7, 86400000 * 365),
      
      // Violation handling settings
      violationSuspensionDuration: this.validateNumber(config.violationSuspensionDuration, 3600000, 300000, 86400000),
      maxViolationsPerDay: this.validateNumber(config.maxViolationsPerDay, 3, 1, 100),
      escalationThreshold: this.validateNumber(config.escalationThreshold, 1.2, 1.0, 5.0),
      
      // Performance settings with validation
      batchSize: this.validateNumber(config.batchSize, 100, 10, 1000),
      flushInterval: this.validateNumber(config.flushInterval, 60000, 10000, 300000),
      maxCacheSize: this.validateNumber(config.maxCacheSize, 100000, 1000, 1000000),
      
      // Secure Redis configuration
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'risk:volume:'),
      
      // Security settings
      authenticationRequired: config.authenticationRequired !== false,
      maxFailedAttempts: this.validateNumber(config.maxFailedAttempts, 5, 1, 100),
      lockoutDuration: this.validateNumber(config.lockoutDuration, 300000, 60000, 3600000),
      
      // Performance optimizations
      enableCompression: config.enableCompression !== false,
      useBatching: config.useBatching !== false,
      useAggregation: config.useAggregation !== false,
      maxMemoryUsage: this.validateNumber(config.maxMemoryUsage, 256 * 1024 * 1024, 50 * 1024 * 1024, 1024 * 1024 * 1024),
      
      // Alert thresholds with validation
      alertThresholds: this.validateAlertThresholds(config.alertThresholds || {
        warning: 0.8,
        critical: 0.95
      }),
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Secure volume tracking with size limits
    this.userVolumes = new Map(); // userId -> volume data by window
    this.userTiers = new Map(); // userId -> tier assignment
    this.userViolations = new Map(); // userId -> violation history
    this.suspendedUsers = new Map(); // userId -> suspension details
    
    // Rolling window data structures with bounds
    this.volumeBuckets = new Map(); // userId:window:bucket -> volume amount
    this.bucketTimestamps = new Map(); // bucket -> timestamp
    this.aggregatedVolumes = new Map(); // userId:window -> total volume
    
    // Performance optimization caches
    this.volumeCache = new LRU(this.config.maxCacheSize / 4);
    this.tierCache = new LRU(this.config.maxCacheSize / 4);
    this.violationCache = new LRU(this.config.maxCacheSize / 4);
    this.aggregationCache = new LRU(this.config.maxCacheSize / 4);
    
    // Batch processing queues with size limits
    this.volumeUpdateQueue = [];
    this.aggregationQueue = [];
    this.persistenceQueue = [];
    this.maxQueueSize = 10000;
    
    // Performance tracking
    this.performanceStats = {
      volumeChecksPerSecond: 0,
      averageCheckTime: 0,
      cacheHitRate: 0,
      violationsDetected: 0,
      suspensionsIssued: 0,
      aggregationsPerformed: 0,
      memoryUsage: 0,
      errorRate: 0
    };
    
    // Security tracking
    this.failedAttempts = new Map(); // userId -> attempts count
    this.lockedUsers = new Map(); // userId -> lockout expiry
    this.suspiciousActivity = new Map(); // userId -> suspicious events
    
    // Authentication and authorization
    this.authorizedUsers = new Set();
    this.permissionMatrix = new Map();
    
    // Atomic operation locks
    this.operationLocks = new Map();
    this.lockTimeouts = new Map();
    
    // Rate limiting
    this.rateLimiters = new Map();
    this.defaultRateLimit = { requests: 1000, window: 60000 }; // 1000 requests per minute
    
    // Memory management
    this.memoryCheckInterval = 60000; // 1 minute
    this.maxUserVolumes = 100000;
    this.maxVolumeBuckets = 1000000;
  }

  // Input validation helpers
  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateVolumeLimits(limits) {
    const validated = {};
    const allowedTiers = ['tier1', 'tier2', 'tier3', 'tier4', 'tier5'];
    
    for (const tier of allowedTiers) {
      const tierLimits = limits[tier];
      if (tierLimits && typeof tierLimits === 'object') {
        validated[tier] = {
          hourly: this.validateNumber(tierLimits.hourly, 1000, 100, 1e12),
          daily: this.validateNumber(tierLimits.daily, 10000, 1000, 1e12),
          weekly: this.validateNumber(tierLimits.weekly, 50000, 5000, 1e12),
          monthly: this.validateNumber(tierLimits.monthly, 200000, 20000, 1e12)
        };
      }
    }
    
    return validated;
  }

  validateTier(tier) {
    const allowedTiers = ['tier1', 'tier2', 'tier3', 'tier4', 'tier5'];
    return allowedTiers.includes(tier) ? tier : 'tier1';
  }

  validateTrackingWindows(windows) {
    const validated = {};
    const allowedWindows = ['hourly', 'daily', 'weekly', 'monthly'];
    
    for (const window of allowedWindows) {
      const duration = windows[window];
      if (typeof duration === 'number' && duration > 0) {
        validated[window] = Math.min(duration, 86400000 * 365); // Max 1 year
      }
    }
    
    return validated;
  }

  validateAlertThresholds(thresholds) {
    return {
      warning: this.validateNumber(thresholds.warning, 0.8, 0.1, 1.0),
      critical: this.validateNumber(thresholds.critical, 0.95, 0.1, 1.0)
    };
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
    if (typeof prefix !== 'string') return 'risk:volume:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  // Authentication and authorization
  async authenticate(authToken) {
    if (!this.config.authenticationRequired) return true;
    
    if (!authToken || typeof authToken !== 'string') {
      throw new Error('Authentication token required');
    }
    
    try {
      const isValid = await this.verifyAuthToken(authToken);
      if (!isValid) {
        throw new Error('Invalid authentication token');
      }
      return true;
    } catch (error) {
      await this.metrics.incrementCounter('volume_restrictions.auth_failures', 1, {}, 'risk');
      throw new Error('Authentication failed');
    }
  }

  async authorize(userId, operation, authenticatedUser) {
    const permissions = this.permissionMatrix.get(userId) || [];
    const requiredPermission = `volume_restrictions.${operation}`;
    
    if (!permissions.includes(requiredPermission) && !permissions.includes('volume_restrictions.*')) {
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
    
    if (usage.heapUsed > this.config.maxMemoryUsage) {
      this.performanceCleanup();
    }
  }

  performanceCleanup() {
    // Clean expired cache entries
    const now = Date.now();
    const maxAge = 300000; // 5 minutes
    
    this.cleanCacheByAge(this.volumeCache, maxAge);
    this.cleanCacheByAge(this.tierCache, maxAge);
    this.cleanCacheByAge(this.violationCache, maxAge);
    this.cleanCacheByAge(this.aggregationCache, maxAge);
    
    // Limit data structure sizes
    this.limitMapSize(this.userVolumes, this.maxUserVolumes);
    this.limitMapSize(this.volumeBuckets, this.maxVolumeBuckets);
    this.limitMapSize(this.rateLimiters, 10000);
    this.limitMapSize(this.failedAttempts, 1000);
    
    // Clean expired buckets
    this.cleanExpiredBuckets();
    
    // Limit queue sizes
    this.limitQueueSize(this.volumeUpdateQueue);
    this.limitQueueSize(this.aggregationQueue);
    this.limitQueueSize(this.persistenceQueue);
  }

  cleanCacheByAge(cache, maxAge) {
    const now = Date.now();
    const entries = Array.from(cache.entries());
    
    for (const [key, value] of entries) {
      if (value.timestamp && now - value.timestamp > maxAge) {
        cache.delete(key);
      }
    }
  }

  limitMapSize(map, maxSize) {
    if (map.size > maxSize) {
      const entries = Array.from(map.entries());
      entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
      
      const toDelete = entries.slice(0, entries.length - maxSize);
      for (const [key] of toDelete) {
        map.delete(key);
      }
    }
  }

  limitQueueSize(queue) {
    if (queue.length > this.maxQueueSize) {
      queue.splice(0, queue.length - this.maxQueueSize);
    }
  }

  cleanExpiredBuckets() {
    const now = Date.now();
    const cutoff = now - this.config.retentionPeriod;
    
    for (const [bucketKey, timestamp] of this.bucketTimestamps.entries()) {
      if (timestamp < cutoff) {
        this.volumeBuckets.delete(bucketKey);
        this.bucketTimestamps.delete(bucketKey);
      }
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
      
      // Load existing volume data
      await this.loadSecureVolumeData();
      
      // Start memory monitoring
      this.memoryMonitorInterval = setInterval(() => {
        this.checkMemoryUsage();
      }, this.memoryCheckInterval);
      
      console.log('✅ Secure volume restrictions manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize secure volume restrictions manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('⚡ Starting secure volume restrictions manager...');
    this.isRunning = true;
    
    // Start secure monitoring
    this.startSecureMonitoring();
    
    // Start batch processing
    this.startBatchProcessing();
    
    // Start performance tracking
    this.startSecurePerformanceTracking();
    
    console.log('✅ Secure volume restrictions manager started');
  }

  startSecureMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.processViolationChecks();
        await this.cleanupExpiredData();
        await this.updateSecurityMetrics();
      } catch (error) {
        console.error('Secure volume monitoring error:', error);
        await this.metrics.incrementCounter('volume_restrictions.monitoring_errors', 1, {}, 'risk');
      }
    }, 30000); // Every 30 seconds
  }

  startBatchProcessing() {
    this.batchInterval = setInterval(async () => {
      try {
        await this.processBatchUpdates();
        await this.processAggregations();
        await this.persistBatchData();
      } catch (error) {
        console.error('Batch processing error:', error);
      }
    }, this.config.flushInterval);
  }

  startSecurePerformanceTracking() {
    this.performanceInterval = setInterval(async () => {
      await this.updateSecurePerformanceMetrics();
    }, 60000); // Every minute
  }

  async recordSecureVolume(userId, volume, timestamp = null, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'record_volume', authenticatedUser);
      }
    }
    
    // Input validation
    const sanitizedUserId = this.sanitizeString(userId);
    if (!sanitizedUserId) {
      throw new Error('Invalid user ID');
    }
    
    const validatedVolume = this.validateNumber(volume, 0, 0, 1e12);
    if (validatedVolume <= 0) {
      throw new Error('Invalid volume amount');
    }
    
    const validatedTimestamp = timestamp && typeof timestamp === 'number' && timestamp > 0 ? 
      timestamp : Date.now();
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'record_volume');
    }
    
    // Check if user is suspended
    if (this.isUserSuspended(sanitizedUserId)) {
      const suspension = this.suspendedUsers.get(sanitizedUserId);
      throw new Error(`User suspended until ${new Date(suspension.expiresAt).toISOString()}: ${suspension.reason}`);
    }
    
    const startTime = Date.now();
    
    // Acquire lock for atomic operation
    const lockId = await this.acquireLock(`volume_${sanitizedUserId}`);
    
    try {
      // Record volume in rolling windows
      await this.recordVolumeInWindows(sanitizedUserId, validatedVolume, validatedTimestamp);
      
      // Check for violations
      const violationResult = await this.checkVolumeViolations(sanitizedUserId, validatedVolume, validatedTimestamp);
      
      // Update performance metrics
      const processingTime = Date.now() - startTime;
      this.updateVolumeCheckMetrics(processingTime);
      
      // Handle violations if detected
      if (violationResult.hasViolation) {
        await this.handleVolumeViolation(sanitizedUserId, violationResult, authenticatedUser);
      }
      
      return {
        userId: sanitizedUserId,
        volume: validatedVolume,
        timestamp: validatedTimestamp,
        allowed: !violationResult.hasViolation,
        currentUsage: violationResult.currentUsage,
        limits: violationResult.limits,
        processingTime
      };
      
    } finally {
      await this.releaseLock(`volume_${sanitizedUserId}`);
    }
  }

  async recordVolumeInWindows(userId, volume, timestamp) {
    const windows = Object.keys(this.config.trackingWindows);
    
    for (const window of windows) {
      const windowDuration = this.config.trackingWindows[window];
      const bucketSize = windowDuration / this.config.windowSlices;
      const bucketIndex = Math.floor(timestamp / bucketSize);
      const bucketKey = `${userId}:${window}:${bucketIndex}`;
      
      // Add to bucket
      const currentBucketVolume = this.volumeBuckets.get(bucketKey) || 0;
      this.volumeBuckets.set(bucketKey, currentBucketVolume + volume);
      this.bucketTimestamps.set(bucketKey, timestamp);
      
      // Add to batch queue if using batching
      if (this.config.useBatching) {
        this.volumeUpdateQueue.push({
          userId,
          window,
          bucketIndex,
          volume,
          timestamp
        });
      }
    }
    
    // Invalidate cache for this user
    this.invalidateUserCache(userId);
  }

  async checkVolumeViolations(userId, currentVolume, timestamp) {
    const userTier = this.getUserTier(userId);
    const tierLimits = this.config.volumeLimits[userTier];
    
    if (!tierLimits) {
      return {
        hasViolation: false,
        currentUsage: {},
        limits: {},
        violations: []
      };
    }
    
    const currentUsage = await this.calculateSecureUserVolume(userId, timestamp);
    const violations = [];
    
    // Check each window for violations
    for (const [window, limit] of Object.entries(tierLimits)) {
      const usage = currentUsage[window] || 0;
      const usageWithCurrent = usage + currentVolume;
      
      if (usageWithCurrent > limit) {
        violations.push({
          window,
          limit,
          currentUsage: usage,
          projectedUsage: usageWithCurrent,
          excess: usageWithCurrent - limit,
          severity: this.calculateViolationSeverity(usageWithCurrent, limit)
        });
      }
    }
    
    return {
      hasViolation: violations.length > 0,
      currentUsage,
      limits: tierLimits,
      violations,
      tier: userTier
    };
  }

  async calculateSecureUserVolume(userId, timestamp = null) {
    const now = timestamp || Date.now();
    
    // Check cache first
    const cacheKey = `volume_${userId}_${Math.floor(now / 60000)}`; // 1 minute cache
    const cached = this.volumeCache.get(cacheKey);
    if (cached) {
      this.performanceStats.cacheHitRate += 0.1;
      return cached.data;
    }
    
    const usage = {};
    
    for (const [window, windowDuration] of Object.entries(this.config.trackingWindows)) {
      const windowStart = now - windowDuration;
      const bucketSize = windowDuration / this.config.windowSlices;
      let totalVolume = 0;
      
      // Sum all buckets in the window
      for (let i = 0; i < this.config.windowSlices; i++) {
        const bucketTimestamp = windowStart + (i * bucketSize);
        const bucketIndex = Math.floor(bucketTimestamp / bucketSize);
        const bucketKey = `${userId}:${window}:${bucketIndex}`;
        
        const bucketVolume = this.volumeBuckets.get(bucketKey) || 0;
        totalVolume += bucketVolume;
      }
      
      usage[window] = Math.max(0, totalVolume);
    }
    
    // Cache result
    this.volumeCache.set(cacheKey, {
      data: usage,
      timestamp: now
    });
    
    return usage;
  }

  getUserTier(userId) {
    // Check cache first
    const cached = this.tierCache.get(userId);
    if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
      return cached.data;
    }
    
    const tier = this.userTiers.get(userId) || this.config.defaultTier;
    
    // Cache result
    this.tierCache.set(userId, {
      data: tier,
      timestamp: Date.now()
    });
    
    return tier;
  }

  isUserSuspended(userId) {
    const suspension = this.suspendedUsers.get(userId);
    if (!suspension) return false;
    
    const now = Date.now();
    if (now > suspension.expiresAt) {
      this.suspendedUsers.delete(userId);
      return false;
    }
    
    return true;
  }

  calculateViolationSeverity(usage, limit) {
    const ratio = usage / limit;
    
    if (ratio >= 2.0) return 'critical';
    if (ratio >= 1.5) return 'high';
    if (ratio >= 1.2) return 'medium';
    return 'low';
  }

  async handleVolumeViolation(userId, violationResult, authenticatedUser) {
    // Record violation
    const violation = {
      userId,
      timestamp: Date.now(),
      violations: violationResult.violations,
      tier: violationResult.tier,
      reportedBy: authenticatedUser?.id || 'system'
    };
    
    // Get user violation history
    const userViolations = this.userViolations.get(userId) || [];
    userViolations.push(violation);
    
    // Limit violation history
    if (userViolations.length > 100) {
      userViolations.shift();
    }
    
    this.userViolations.set(userId, userViolations);
    
    // Check for repeated violations
    const recentViolations = this.getRecentViolations(userId, 86400000); // Last 24 hours
    
    if (recentViolations.length >= this.config.maxViolationsPerDay) {
      await this.suspendUser(userId, 'repeated_violations', authenticatedUser);
    }
    
    // Emit violation event
    this.emit('volume_violation', violation);
    
    // Update metrics
    await this.metrics.incrementCounter('volume_restrictions.violations', 1, {
      tier: violationResult.tier,
      severity: violation.violations[0]?.severity || 'unknown'
    }, 'risk');
    
    this.performanceStats.violationsDetected++;
    
    console.warn(`Volume violation detected for user ${userId}: ${JSON.stringify(violationResult.violations)}`);
    
    // Save violation to Redis
    await this.saveSecureViolation(userId, violation);
  }

  getRecentViolations(userId, timeWindow) {
    const userViolations = this.userViolations.get(userId) || [];
    const cutoff = Date.now() - timeWindow;
    
    return userViolations.filter(v => v.timestamp > cutoff);
  }

  async suspendUser(userId, reason, authenticatedUser) {
    const suspension = {
      userId,
      reason: this.sanitizeString(reason),
      startTime: Date.now(),
      expiresAt: Date.now() + this.config.violationSuspensionDuration,
      suspendedBy: authenticatedUser?.id || 'system'
    };
    
    this.suspendedUsers.set(userId, suspension);
    
    // Emit suspension event
    this.emit('user_suspended', suspension);
    
    // Update metrics
    await this.metrics.incrementCounter('volume_restrictions.suspensions', 1, {
      reason
    }, 'risk');
    
    this.performanceStats.suspensionsIssued++;
    
    console.warn(`User suspended: ${userId} (${reason}) until ${new Date(suspension.expiresAt).toISOString()}`);
    
    // Save suspension to Redis
    await this.saveSecureSuspension(userId, suspension);
  }

  async setSecureUserTier(userId, tier, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'set_tier', authenticatedUser);
      }
    }
    
    // Input validation
    const sanitizedUserId = this.sanitizeString(userId);
    if (!sanitizedUserId) {
      throw new Error('Invalid user ID');
    }
    
    const validatedTier = this.validateTier(tier);
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'set_tier');
    }
    
    const lockId = await this.acquireLock(`tier_${sanitizedUserId}`);
    
    try {
      const previousTier = this.userTiers.get(sanitizedUserId) || this.config.defaultTier;
      this.userTiers.set(sanitizedUserId, validatedTier);
      
      // Invalidate cache
      this.tierCache.delete(sanitizedUserId);
      this.invalidateUserCache(sanitizedUserId);
      
      // Emit tier change event
      this.emit('user_tier_changed', {
        userId: sanitizedUserId,
        previousTier,
        newTier: validatedTier,
        changedBy: authenticatedUser?.id || 'system',
        timestamp: Date.now()
      });
      
      // Save to Redis
      await this.saveSecureUserTier(sanitizedUserId, validatedTier);
      
      console.log(`User tier updated: ${sanitizedUserId} (${previousTier} -> ${validatedTier})`);
      
      return {
        userId: sanitizedUserId,
        tier: validatedTier,
        previousTier,
        limits: this.config.volumeLimits[validatedTier]
      };
      
    } finally {
      await this.releaseLock(`tier_${sanitizedUserId}`);
    }
  }

  invalidateUserCache(userId) {
    const patterns = [`volume_${userId}_`, `tier_${userId}`, `violation_${userId}_`];
    
    for (const pattern of patterns) {
      for (const [key] of this.volumeCache.entries()) {
        if (key.startsWith(pattern)) {
          this.volumeCache.delete(key);
        }
      }
      
      for (const [key] of this.tierCache.entries()) {
        if (key.startsWith(pattern)) {
          this.tierCache.delete(key);
        }
      }
      
      for (const [key] of this.violationCache.entries()) {
        if (key.startsWith(pattern)) {
          this.violationCache.delete(key);
        }
      }
    }
  }

  async isSecureUserAllowedToTrade(userId, volume, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'check_allowed', authenticatedUser);
      }
    }
    
    // Input validation
    const sanitizedUserId = this.sanitizeString(userId);
    if (!sanitizedUserId) {
      return { allowed: false, reason: 'invalid_user_id' };
    }
    
    const validatedVolume = this.validateNumber(volume, 0, 0, 1e12);
    if (validatedVolume <= 0) {
      return { allowed: false, reason: 'invalid_volume' };
    }
    
    // Rate limiting
    if (authenticatedUser?.id) {
      try {
        await this.checkRateLimit(authenticatedUser.id, 'check_trade');
      } catch (error) {
        return { allowed: false, reason: 'rate_limit_exceeded' };
      }
    }
    
    // Check if user is suspended
    if (this.isUserSuspended(sanitizedUserId)) {
      const suspension = this.suspendedUsers.get(sanitizedUserId);
      return {
        allowed: false,
        reason: 'user_suspended',
        suspensionDetails: {
          reason: suspension.reason,
          expiresAt: suspension.expiresAt
        }
      };
    }
    
    try {
      // Check volume violations
      const violationResult = await this.checkVolumeViolations(sanitizedUserId, validatedVolume, Date.now());
      
      if (violationResult.hasViolation) {
        return {
          allowed: false,
          reason: 'volume_limit_exceeded',
          violations: violationResult.violations,
          currentUsage: violationResult.currentUsage,
          limits: violationResult.limits,
          tier: violationResult.tier
        };
      }
      
      return {
        allowed: true,
        currentUsage: violationResult.currentUsage,
        limits: violationResult.limits,
        tier: violationResult.tier,
        remainingCapacity: this.calculateRemainingCapacity(violationResult.currentUsage, violationResult.limits)
      };
      
    } catch (error) {
      console.error('Trade allowance check error:', error);
      return {
        allowed: false,
        reason: 'system_error',
        error: error.message
      };
    }
  }

  calculateRemainingCapacity(currentUsage, limits) {
    const remaining = {};
    
    for (const [window, limit] of Object.entries(limits)) {
      const usage = currentUsage[window] || 0;
      remaining[window] = Math.max(0, limit - usage);
    }
    
    return remaining;
  }

  updateVolumeCheckMetrics(processingTime) {
    this.performanceStats.averageCheckTime = 
      (this.performanceStats.averageCheckTime * 0.9) + (processingTime * 0.1);
    
    this.performanceStats.volumeChecksPerSecond++;
  }

  async updateSecurityMetrics() {
    await this.metrics.setGauge('volume_restrictions.security.failed_attempts', 
      this.failedAttempts.size, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.security.locked_users', 
      this.lockedUsers.size, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.security.suspended_users', 
      this.suspendedUsers.size, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.performance.memory_usage', 
      this.performanceStats.memoryUsage, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.performance.cache_hit_rate', 
      this.performanceStats.cacheHitRate, {}, 'risk');
  }

  async updateSecurePerformanceMetrics() {
    await this.updateSecurityMetrics();
    
    await this.metrics.setGauge('volume_restrictions.volume_checks_per_second', 
      this.performanceStats.volumeChecksPerSecond, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.average_check_time', 
      this.performanceStats.averageCheckTime, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.violations_detected', 
      this.performanceStats.violationsDetected, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.suspensions_issued', 
      this.performanceStats.suspensionsIssued, {}, 'risk');
    
    // Reset counters
    this.performanceStats.volumeChecksPerSecond = 0;
  }

  // Continue with remaining methods following the same patterns...
  // [Additional methods would follow the same security, validation, and performance patterns]

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping secure volume restrictions manager...');
    
    // Stop intervals
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.batchInterval) clearInterval(this.batchInterval);
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
    this.userVolumes.clear();
    this.userTiers.clear();
    this.userViolations.clear();
    this.suspendedUsers.clear();
    this.volumeBuckets.clear();
    this.bucketTimestamps.clear();
    this.volumeCache.clear();
    this.tierCache.clear();
    this.violationCache.clear();
    this.operationLocks.clear();
    this.lockTimeouts.clear();
    this.rateLimiters.clear();
    
    this.isRunning = false;
    console.log('✅ Secure volume restrictions manager stopped');
  }
}

// Simple LRU cache implementation
class LRU {
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
  
  delete(key) {
    return this.cache.delete(key);
  }
  
  clear() {
    this.cache.clear();
  }
  
  entries() {
    return this.cache.entries();
  }
}

module.exports = SecureVolumeRestrictionsManager;