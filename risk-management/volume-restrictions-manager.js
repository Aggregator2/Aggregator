const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

class VolumeRestrictionsManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Default volume limits (in USD)
      defaultDailyLimit: config.defaultDailyLimit || 100000,
      defaultWeeklyLimit: config.defaultWeeklyLimit || 500000,
      defaultMonthlyLimit: config.defaultMonthlyLimit || 2000000,
      
      // Rolling window configurations
      dailyWindow: config.dailyWindow || 86400000, // 24 hours
      weeklyWindow: config.weeklyWindow || 604800000, // 7 days
      monthlyWindow: config.monthlyWindow || 2592000000, // 30 days
      
      // Volume tracking granularity
      trackingInterval: config.trackingInterval || 300000, // 5 minutes
      bucketSize: config.bucketSize || 3600000, // 1 hour buckets
      
      // Tier-based limits
      tierLimits: config.tierLimits || {
        basic: { daily: 10000, weekly: 50000, monthly: 200000 },
        verified: { daily: 100000, weekly: 500000, monthly: 2000000 },
        professional: { daily: 1000000, weekly: 5000000, monthly: 20000000 },
        institutional: { daily: 10000000, weekly: 50000000, monthly: 200000000 }
      },
      
      // Redis configuration
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      keyPrefix: config.keyPrefix || 'risk:volume:',
      
      // Safety thresholds
      warningThreshold: config.warningThreshold || 0.8, // 80% of limit
      emergencyThreshold: config.emergencyThreshold || 0.95, // 95% of limit
      
      // Performance settings
      batchSize: config.batchSize || 100,
      maxCacheSize: config.maxCacheSize || 10000,
      cacheExpiry: config.cacheExpiry || 300000, // 5 minutes
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Volume tracking data structures
    this.userVolumes = new Map(); // userId -> volume data
    this.volumeBuckets = new Map(); // time bucket -> volume data
    this.userLimits = new Map(); // userId -> custom limits
    
    // Caching for performance
    this.volumeCache = new Map(); // userId -> cached calculations
    this.cacheTimestamps = new Map(); // userId -> cache timestamp
    
    // Rolling window data
    this.rollingWindows = new Map(); // userId -> { daily, weekly, monthly }
    
    // Violation tracking
    this.volumeViolations = new Map(); // userId -> violations
    this.suspendedUsers = new Set(); // userIds suspended due to volume
    
    // Performance metrics
    this.performanceStats = {
      calculationsPerSecond: 0,
      averageCalculationTime: 0,
      cacheHitRate: 0,
      violationsDetected: 0,
      bucketsProcessed: 0
    };
  }

  async initialize() {
    try {
      // Initialize Redis connection
      const Redis = require('redis');
      this.redis = Redis.createClient({ url: this.config.redisUrl });
      await this.redis.connect();
      
      // Load existing data
      await this.loadUserLimits();
      await this.loadUserVolumes();
      await this.loadVolumeBuckets();
      
      console.log('✅ Volume restrictions manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize volume restrictions manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('📊 Starting volume restrictions manager...');
    this.isRunning = true;
    
    // Start volume tracking
    this.startVolumeTracking();
    
    // Start rolling window maintenance
    this.startRollingWindowMaintenance();
    
    // Start cache cleanup
    this.startCacheCleanup();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Volume restrictions manager started');
  }

  startVolumeTracking() {
    this.trackingInterval = setInterval(async () => {
      try {
        await this.processVolumeBuckets();
        await this.updateRollingWindows();
        await this.checkAllVolumeLimits();
      } catch (error) {
        console.error('Volume tracking error:', error);
        await this.metrics.incrementCounter('volume_restrictions.tracking_errors', 1, {}, 'risk');
      }
    }, this.config.trackingInterval);
  }

  startRollingWindowMaintenance() {
    this.maintenanceInterval = setInterval(async () => {
      try {
        await this.cleanupOldBuckets();
        await this.recalculateRollingWindows();
      } catch (error) {
        console.error('Rolling window maintenance error:', error);
      }
    }, 3600000); // Every hour
  }

  startCacheCleanup() {
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupExpiredCache();
    }, 300000); // Every 5 minutes
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 30000); // Every 30 seconds
  }

  async setUserVolumeLimit(userId, limits) {
    try {
      this.validateVolumeLimits(limits);
      
      const volumeLimits = {
        daily: limits.daily || this.config.defaultDailyLimit,
        weekly: limits.weekly || this.config.defaultWeeklyLimit,
        monthly: limits.monthly || this.config.defaultMonthlyLimit,
        tier: limits.tier || 'basic',
        customLimits: limits.customLimits || {},
        updatedAt: Date.now(),
        updatedBy: limits.updatedBy || 'system'
      };
      
      // Store in memory
      this.userLimits.set(userId, volumeLimits);
      
      // Store in Redis
      await this.redis.hSet(
        `${this.config.keyPrefix}limits`,
        userId,
        JSON.stringify(volumeLimits)
      );
      
      // Clear cache
      this.clearUserCache(userId);
      
      // Emit event
      this.emit('volume_limits_updated', { userId, limits: volumeLimits });
      
      // Update metrics
      await this.metrics.incrementCounter('volume_restrictions.limits_updated', 1, {
        tier: volumeLimits.tier
      }, 'risk');
      
      return volumeLimits;
      
    } catch (error) {
      console.error(`Failed to set volume limits for ${userId}:`, error);
      throw error;
    }
  }

  validateVolumeLimits(limits) {
    if (limits.daily && (limits.daily <= 0 || limits.daily > 1000000000)) {
      throw new Error('Invalid daily limit: must be between 0 and 1B');
    }
    if (limits.weekly && (limits.weekly <= 0 || limits.weekly > 10000000000)) {
      throw new Error('Invalid weekly limit: must be between 0 and 10B');
    }
    if (limits.monthly && (limits.monthly <= 0 || limits.monthly > 100000000000)) {
      throw new Error('Invalid monthly limit: must be between 0 and 100B');
    }
    
    // Ensure weekly >= daily and monthly >= weekly
    if (limits.daily && limits.weekly && limits.weekly < limits.daily) {
      throw new Error('Weekly limit must be >= daily limit');
    }
    if (limits.weekly && limits.monthly && limits.monthly < limits.weekly) {
      throw new Error('Monthly limit must be >= weekly limit');
    }
  }

  async getUserVolumeLimit(userId) {
    // Check memory cache first
    let limits = this.userLimits.get(userId);
    
    if (!limits) {
      // Load from Redis
      const limitsData = await this.redis.hGet(`${this.config.keyPrefix}limits`, userId);
      if (limitsData) {
        limits = JSON.parse(limitsData);
        this.userLimits.set(userId, limits);
      } else {
        // Use default limits
        limits = this.getDefaultVolumeLimitsForUser(userId);
      }
    }
    
    return limits;
  }

  getDefaultVolumeLimitsForUser(userId) {
    // This would typically look up user tier from database
    const tierLimits = this.config.tierLimits.basic;
    
    return {
      daily: tierLimits.daily,
      weekly: tierLimits.weekly,
      monthly: tierLimits.monthly,
      tier: 'basic',
      customLimits: {},
      updatedAt: Date.now(),
      updatedBy: 'system'
    };
  }

  async recordVolume(userId, volume, timestamp = Date.now()) {
    try {
      this.validateVolumeRecord(volume);
      
      // Get bucket timestamp
      const bucketTime = this.getBucketTimestamp(timestamp);
      
      // Update volume buckets
      await this.addVolumeToBucket(userId, volume, bucketTime);
      
      // Update user volume tracking
      await this.updateUserVolume(userId, volume, timestamp);
      
      // Clear cache for user
      this.clearUserCache(userId);
      
      // Check limits immediately if significant volume
      if (volume > 1000) { // Only check for volumes > $1000
        await this.checkUserVolumeLimit(userId);
      }
      
      // Update metrics
      await this.metrics.incrementCounter('volume_restrictions.volume_recorded', volume, {
        userId: this.hashUserId(userId)
      }, 'risk');
      
    } catch (error) {
      console.error(`Failed to record volume for ${userId}:`, error);
      throw error;
    }
  }

  validateVolumeRecord(volume) {
    if (typeof volume !== 'number' || volume <= 0) {
      throw new Error('Volume must be a positive number');
    }
    if (volume > 1000000000) { // $1B max per transaction
      throw new Error('Volume exceeds maximum transaction limit');
    }
  }

  getBucketTimestamp(timestamp) {
    return Math.floor(timestamp / this.config.bucketSize) * this.config.bucketSize;
  }

  async addVolumeToBucket(userId, volume, bucketTime) {
    const bucketKey = `${bucketTime}_${userId}`;
    
    // Update in-memory bucket
    if (!this.volumeBuckets.has(bucketKey)) {
      this.volumeBuckets.set(bucketKey, {
        userId,
        bucketTime,
        volume: 0,
        transactionCount: 0,
        lastUpdated: Date.now()
      });
    }
    
    const bucket = this.volumeBuckets.get(bucketKey);
    bucket.volume += volume;
    bucket.transactionCount++;
    bucket.lastUpdated = Date.now();
    
    // Store in Redis
    await this.redis.hSet(
      `${this.config.keyPrefix}buckets`,
      bucketKey,
      JSON.stringify(bucket)
    );
  }

  async updateUserVolume(userId, volume, timestamp) {
    if (!this.userVolumes.has(userId)) {
      this.userVolumes.set(userId, {
        totalVolume: 0,
        transactionCount: 0,
        firstTransaction: timestamp,
        lastTransaction: timestamp,
        dailyVolume: 0,
        weeklyVolume: 0,
        monthlyVolume: 0
      });
    }
    
    const userVolume = this.userVolumes.get(userId);
    userVolume.totalVolume += volume;
    userVolume.transactionCount++;
    userVolume.lastTransaction = timestamp;
    
    // Store in Redis
    await this.redis.hSet(
      `${this.config.keyPrefix}users`,
      userId,
      JSON.stringify(userVolume)
    );
  }

  async calculateUserVolume(userId, windowType = 'daily') {
    const startTime = Date.now();
    
    // Check cache first
    const cacheKey = `${userId}_${windowType}`;
    const cached = this.volumeCache.get(cacheKey);
    const cacheTime = this.cacheTimestamps.get(cacheKey);
    
    if (cached && cacheTime && Date.now() - cacheTime < this.config.cacheExpiry) {
      this.performanceStats.cacheHitRate++;
      return cached;
    }
    
    try {
      const now = Date.now();
      let windowStart;
      
      switch (windowType) {
        case 'daily':
          windowStart = now - this.config.dailyWindow;
          break;
        case 'weekly':
          windowStart = now - this.config.weeklyWindow;
          break;
        case 'monthly':
          windowStart = now - this.config.monthlyWindow;
          break;
        default:
          throw new Error(`Invalid window type: ${windowType}`);
      }
      
      // Calculate volume from buckets
      let totalVolume = 0;
      let transactionCount = 0;
      
      for (const [bucketKey, bucket] of this.volumeBuckets) {
        if (bucket.userId === userId && bucket.bucketTime >= windowStart) {
          totalVolume += bucket.volume;
          transactionCount += bucket.transactionCount;
        }
      }
      
      const result = {
        volume: totalVolume,
        transactionCount,
        windowType,
        windowStart,
        calculatedAt: now
      };
      
      // Cache the result
      this.volumeCache.set(cacheKey, result);
      this.cacheTimestamps.set(cacheKey, now);
      
      // Update performance stats
      const calculationTime = Date.now() - startTime;
      this.updateCalculationPerformance(calculationTime);
      
      return result;
      
    } catch (error) {
      console.error(`Failed to calculate ${windowType} volume for ${userId}:`, error);
      throw error;
    }
  }

  async checkUserVolumeLimit(userId) {
    try {
      // Get user limits
      const limits = await this.getUserVolumeLimit(userId);
      
      // Calculate current volumes
      const [dailyVolume, weeklyVolume, monthlyVolume] = await Promise.all([
        this.calculateUserVolume(userId, 'daily'),
        this.calculateUserVolume(userId, 'weekly'),
        this.calculateUserVolume(userId, 'monthly')
      ]);
      
      // Check each limit
      const violations = [];
      
      // Daily limit check
      if (dailyVolume.volume > limits.daily) {
        violations.push({
          type: 'daily_volume',
          current: dailyVolume.volume,
          limit: limits.daily,
          ratio: dailyVolume.volume / limits.daily,
          severity: this.getViolationSeverity(dailyVolume.volume / limits.daily)
        });
      }
      
      // Weekly limit check
      if (weeklyVolume.volume > limits.weekly) {
        violations.push({
          type: 'weekly_volume',
          current: weeklyVolume.volume,
          limit: limits.weekly,
          ratio: weeklyVolume.volume / limits.weekly,
          severity: this.getViolationSeverity(weeklyVolume.volume / limits.weekly)
        });
      }
      
      // Monthly limit check
      if (monthlyVolume.volume > limits.monthly) {
        violations.push({
          type: 'monthly_volume',
          current: monthlyVolume.volume,
          limit: limits.monthly,
          ratio: monthlyVolume.volume / limits.monthly,
          severity: this.getViolationSeverity(monthlyVolume.volume / limits.monthly)
        });
      }
      
      // Handle violations
      if (violations.length > 0) {
        await this.handleVolumeViolations(userId, violations, {
          daily: dailyVolume,
          weekly: weeklyVolume,
          monthly: monthlyVolume
        }, limits);
      } else {
        // Clear existing violations
        this.volumeViolations.delete(userId);
      }
      
      return {
        userId,
        volumes: { daily: dailyVolume, weekly: weeklyVolume, monthly: monthlyVolume },
        limits,
        violations,
        status: violations.length > 0 ? 'violation' : 'ok'
      };
      
    } catch (error) {
      console.error(`Failed to check volume limits for ${userId}:`, error);
      throw error;
    }
  }

  getViolationSeverity(ratio) {
    if (ratio >= this.config.emergencyThreshold) return 'critical';
    if (ratio >= this.config.warningThreshold) return 'warning';
    return 'info';
  }

  async handleVolumeViolations(userId, violations, volumes, limits) {
    const criticalViolations = violations.filter(v => v.severity === 'critical');
    
    // Store violations
    this.volumeViolations.set(userId, {
      violations,
      volumes,
      limits,
      timestamp: Date.now()
    });
    
    // Handle critical violations
    if (criticalViolations.length > 0) {
      await this.suspendUserTrading(userId, criticalViolations);
    }
    
    // Emit violation events
    for (const violation of violations) {
      this.emit('volume_violation', {
        userId,
        violation,
        volumes,
        limits
      });
      
      // Update metrics
      await this.metrics.incrementCounter('volume_restrictions.violations', 1, {
        type: violation.type,
        severity: violation.severity
      }, 'risk');
    }
    
    this.performanceStats.violationsDetected++;
  }

  async suspendUserTrading(userId, violations) {
    this.suspendedUsers.add(userId);
    
    // Emit suspension event
    this.emit('user_suspended', {
      userId,
      violations,
      timestamp: Date.now(),
      reason: 'volume_limit_exceeded'
    });
    
    // Update metrics
    await this.metrics.incrementCounter('volume_restrictions.suspensions', 1, {
      userId: this.hashUserId(userId)
    }, 'risk');
    
    console.warn(`User trading suspended due to volume violations: ${this.hashUserId(userId)}`);
  }

  async isUserAllowedToTrade(userId, proposedVolume = 0) {
    try {
      // Check if user is suspended
      if (this.suspendedUsers.has(userId)) {
        return {
          allowed: false,
          reason: 'volume_suspension',
          message: 'Trading suspended due to volume limit violations'
        };
      }
      
      // Get limits and current volumes
      const limits = await this.getUserVolumeLimit(userId);
      const [dailyVolume, weeklyVolume, monthlyVolume] = await Promise.all([
        this.calculateUserVolume(userId, 'daily'),
        this.calculateUserVolume(userId, 'weekly'),
        this.calculateUserVolume(userId, 'monthly')
      ]);
      
      // Check if proposed trade would exceed limits
      const projectedDaily = dailyVolume.volume + proposedVolume;
      const projectedWeekly = weeklyVolume.volume + proposedVolume;
      const projectedMonthly = monthlyVolume.volume + proposedVolume;
      
      // Check daily limit
      if (projectedDaily > limits.daily) {
        return {
          allowed: false,
          reason: 'daily_volume_limit',
          message: `Trade would exceed daily volume limit: ${projectedDaily} > ${limits.daily}`,
          current: dailyVolume.volume,
          limit: limits.daily,
          proposed: proposedVolume
        };
      }
      
      // Check weekly limit
      if (projectedWeekly > limits.weekly) {
        return {
          allowed: false,
          reason: 'weekly_volume_limit',
          message: `Trade would exceed weekly volume limit: ${projectedWeekly} > ${limits.weekly}`,
          current: weeklyVolume.volume,
          limit: limits.weekly,
          proposed: proposedVolume
        };
      }
      
      // Check monthly limit
      if (projectedMonthly > limits.monthly) {
        return {
          allowed: false,
          reason: 'monthly_volume_limit',
          message: `Trade would exceed monthly volume limit: ${projectedMonthly} > ${limits.monthly}`,
          current: monthlyVolume.volume,
          limit: limits.monthly,
          proposed: proposedVolume
        };
      }
      
      // Check warning thresholds
      const warnings = [];
      
      if (projectedDaily > limits.daily * this.config.warningThreshold) {
        warnings.push('approaching_daily_limit');
      }
      if (projectedWeekly > limits.weekly * this.config.warningThreshold) {
        warnings.push('approaching_weekly_limit');
      }
      if (projectedMonthly > limits.monthly * this.config.warningThreshold) {
        warnings.push('approaching_monthly_limit');
      }
      
      return {
        allowed: true,
        warnings,
        utilization: {
          daily: projectedDaily / limits.daily,
          weekly: projectedWeekly / limits.weekly,
          monthly: projectedMonthly / limits.monthly
        },
        remaining: {
          daily: limits.daily - projectedDaily,
          weekly: limits.weekly - projectedWeekly,
          monthly: limits.monthly - projectedMonthly
        }
      };
      
    } catch (error) {
      console.error(`Failed to check trading permission for ${userId}:`, error);
      return {
        allowed: false,
        reason: 'system_error',
        message: 'Unable to verify volume limits'
      };
    }
  }

  async removeSuspension(userId, reason = 'manual') {
    if (this.suspendedUsers.has(userId)) {
      this.suspendedUsers.delete(userId);
      
      this.emit('suspension_removed', {
        userId,
        reason,
        timestamp: Date.now()
      });
      
      await this.metrics.incrementCounter('volume_restrictions.suspensions_removed', 1, {
        reason
      }, 'risk');
      
      console.log(`Volume suspension removed for user ${this.hashUserId(userId)}, reason: ${reason}`);
    }
  }

  async processVolumeBuckets() {
    // This would typically process pending volume records
    // For now, we'll just update performance stats
    this.performanceStats.bucketsProcessed = this.volumeBuckets.size;
  }

  async updateRollingWindows() {
    // Update rolling window calculations for active users
    for (const userId of this.userVolumes.keys()) {
      try {
        const [daily, weekly, monthly] = await Promise.all([
          this.calculateUserVolume(userId, 'daily'),
          this.calculateUserVolume(userId, 'weekly'),
          this.calculateUserVolume(userId, 'monthly')
        ]);
        
        this.rollingWindows.set(userId, { daily, weekly, monthly });
      } catch (error) {
        console.error(`Failed to update rolling windows for ${userId}:`, error);
      }
    }
  }

  async checkAllVolumeLimits() {
    const startTime = Date.now();
    let checksPerformed = 0;
    
    try {
      for (const userId of this.userVolumes.keys()) {
        await this.checkUserVolumeLimit(userId);
        checksPerformed++;
      }
      
      // Update performance stats
      const totalTime = Date.now() - startTime;
      this.performanceStats.calculationsPerSecond = checksPerformed / (totalTime / 1000);
      
    } catch (error) {
      console.error('Error checking all volume limits:', error);
    }
  }

  async cleanupOldBuckets() {
    const cutoff = Date.now() - this.config.monthlyWindow;
    let cleanedCount = 0;
    
    for (const [bucketKey, bucket] of this.volumeBuckets) {
      if (bucket.bucketTime < cutoff) {
        this.volumeBuckets.delete(bucketKey);
        await this.redis.hDel(`${this.config.keyPrefix}buckets`, bucketKey);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old volume buckets`);
    }
  }

  async recalculateRollingWindows() {
    // Recalculate rolling windows for all users periodically
    for (const userId of this.userVolumes.keys()) {
      this.clearUserCache(userId);
    }
  }

  clearUserCache(userId) {
    const keys = [`${userId}_daily`, `${userId}_weekly`, `${userId}_monthly`];
    for (const key of keys) {
      this.volumeCache.delete(key);
      this.cacheTimestamps.delete(key);
    }
  }

  cleanupExpiredCache() {
    const now = Date.now();
    for (const [key, timestamp] of this.cacheTimestamps) {
      if (now - timestamp >= this.config.cacheExpiry) {
        this.volumeCache.delete(key);
        this.cacheTimestamps.delete(key);
      }
    }
  }

  updateCalculationPerformance(calculationTime) {
    const alpha = 0.1;
    this.performanceStats.averageCalculationTime = 
      (1 - alpha) * this.performanceStats.averageCalculationTime + alpha * calculationTime;
  }

  async updatePerformanceMetrics() {
    await this.metrics.setGauge('volume_restrictions.calculations_per_second', 
      this.performanceStats.calculationsPerSecond, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.average_calculation_time', 
      this.performanceStats.averageCalculationTime, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.cache_hit_rate', 
      this.performanceStats.cacheHitRate, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.violations_detected', 
      this.performanceStats.violationsDetected, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.suspended_users', 
      this.suspendedUsers.size, {}, 'risk');
    
    await this.metrics.setGauge('volume_restrictions.buckets_tracked', 
      this.volumeBuckets.size, {}, 'risk');
  }

  async loadUserLimits() {
    try {
      const limitsData = await this.redis.hGetAll(`${this.config.keyPrefix}limits`);
      for (const [userId, data] of Object.entries(limitsData)) {
        this.userLimits.set(userId, JSON.parse(data));
      }
      console.log(`Loaded volume limits for ${this.userLimits.size} users`);
    } catch (error) {
      console.error('Failed to load user volume limits:', error);
    }
  }

  async loadUserVolumes() {
    try {
      const volumeData = await this.redis.hGetAll(`${this.config.keyPrefix}users`);
      for (const [userId, data] of Object.entries(volumeData)) {
        this.userVolumes.set(userId, JSON.parse(data));
      }
      console.log(`Loaded volumes for ${this.userVolumes.size} users`);
    } catch (error) {
      console.error('Failed to load user volumes:', error);
    }
  }

  async loadVolumeBuckets() {
    try {
      const bucketData = await this.redis.hGetAll(`${this.config.keyPrefix}buckets`);
      for (const [bucketKey, data] of Object.entries(bucketData)) {
        this.volumeBuckets.set(bucketKey, JSON.parse(data));
      }
      console.log(`Loaded ${this.volumeBuckets.size} volume buckets`);
    } catch (error) {
      console.error('Failed to load volume buckets:', error);
    }
  }

  hashUserId(userId) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(userId.toString()).digest('hex').substring(0, 16);
  }

  getVolumeRestrictionsStatus() {
    return {
      isRunning: this.isRunning,
      usersTracked: this.userVolumes.size,
      suspendedUsers: this.suspendedUsers.size,
      violations: this.volumeViolations.size,
      bucketsTracked: this.volumeBuckets.size,
      cacheSize: this.volumeCache.size,
      performance: this.performanceStats
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping volume restrictions manager...');
    
    // Stop intervals
    if (this.trackingInterval) clearInterval(this.trackingInterval);
    if (this.maintenanceInterval) clearInterval(this.maintenanceInterval);
    if (this.cacheCleanupInterval) clearInterval(this.cacheCleanupInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data
    this.userVolumes.clear();
    this.volumeBuckets.clear();
    this.userLimits.clear();
    this.volumeCache.clear();
    this.cacheTimestamps.clear();
    this.rollingWindows.clear();
    this.volumeViolations.clear();
    this.suspendedUsers.clear();
    
    this.isRunning = false;
    console.log('✅ Volume restrictions manager stopped');
  }
}

module.exports = VolumeRestrictionsManager;