const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

class PositionLimitsManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Default position limits
      defaultMaxPosition: config.defaultMaxPosition || 100000, // USD value
      defaultMaxLeverage: config.defaultMaxLeverage || 10,
      defaultMaxOpenOrders: config.defaultMaxOpenOrders || 50,
      
      // Risk tiers
      tierLimits: config.tierLimits || {
        basic: { maxPosition: 10000, maxLeverage: 3, maxOpenOrders: 10 },
        verified: { maxPosition: 100000, maxLeverage: 10, maxOpenOrders: 50 },
        professional: { maxPosition: 1000000, maxLeverage: 20, maxOpenOrders: 200 },
        institutional: { maxPosition: 10000000, maxLeverage: 50, maxOpenOrders: 1000 }
      },
      
      // Position tracking
      updateInterval: config.updateInterval || 1000, // 1 second
      maxPositionAge: config.maxPositionAge || 300000, // 5 minutes
      
      // Redis configuration
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      keyPrefix: config.keyPrefix || 'risk:position:',
      
      // Safety settings
      emergencyStopThreshold: config.emergencyStopThreshold || 0.95, // 95% of limit
      warningThreshold: config.warningThreshold || 0.8, // 80% of limit
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // In-memory position tracking for performance
    this.userPositions = new Map(); // userId -> positions
    this.userOrders = new Map(); // userId -> open orders
    this.userLimits = new Map(); // userId -> custom limits
    
    // Position calculation cache
    this.positionCache = new Map();
    this.cacheExpiry = new Map();
    
    // Risk events
    this.limitViolations = new Map(); // userId -> violations
    this.emergencyStops = new Set(); // userIds with emergency stops
    
    // Performance tracking
    this.performanceStats = {
      checksPerSecond: 0,
      averageCheckTime: 0,
      cacheHitRate: 0,
      violationsDetected: 0
    };
  }

  async initialize() {
    try {
      // Initialize Redis connection
      const Redis = require('redis');
      this.redis = Redis.createClient({ url: this.config.redisUrl });
      await this.redis.connect();
      
      // Load existing user limits and positions
      await this.loadUserLimits();
      await this.loadUserPositions();
      
      console.log('✅ Position limits manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize position limits manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🔒 Starting position limits manager...');
    this.isRunning = true;
    
    // Start position monitoring
    this.startPositionMonitoring();
    
    // Start cache cleanup
    this.startCacheCleanup();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Position limits manager started');
  }

  startPositionMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.updateAllPositions();
        await this.checkAllLimits();
      } catch (error) {
        console.error('Position monitoring error:', error);
        await this.metrics.incrementCounter('position_limits.monitoring_errors', 1, {}, 'risk');
      }
    }, this.config.updateInterval);
  }

  startCacheCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredCache();
    }, 60000); // Every minute
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 30000); // Every 30 seconds
  }

  async setUserLimits(userId, limits) {
    try {
      this.validateLimits(limits);
      
      const userLimits = {
        maxPosition: limits.maxPosition || this.config.defaultMaxPosition,
        maxLeverage: limits.maxLeverage || this.config.defaultMaxLeverage,
        maxOpenOrders: limits.maxOpenOrders || this.config.defaultMaxOpenOrders,
        tier: limits.tier || 'basic',
        customLimits: limits.customLimits || {},
        updatedAt: Date.now(),
        updatedBy: limits.updatedBy || 'system'
      };
      
      // Store in memory
      this.userLimits.set(userId, userLimits);
      
      // Store in Redis
      await this.redis.hSet(
        `${this.config.keyPrefix}limits`,
        userId,
        JSON.stringify(userLimits)
      );
      
      // Clear position cache for user
      this.clearUserCache(userId);
      
      // Emit event
      this.emit('limits_updated', { userId, limits: userLimits });
      
      // Update metrics
      await this.metrics.incrementCounter('position_limits.limits_updated', 1, {
        tier: userLimits.tier
      }, 'risk');
      
      return userLimits;
      
    } catch (error) {
      console.error(`Failed to set user limits for ${userId}:`, error);
      throw error;
    }
  }

  validateLimits(limits) {
    if (limits.maxPosition && (limits.maxPosition <= 0 || limits.maxPosition > 100000000)) {
      throw new Error('Invalid maxPosition: must be between 0 and 100M');
    }
    if (limits.maxLeverage && (limits.maxLeverage <= 0 || limits.maxLeverage > 100)) {
      throw new Error('Invalid maxLeverage: must be between 0 and 100');
    }
    if (limits.maxOpenOrders && (limits.maxOpenOrders <= 0 || limits.maxOpenOrders > 10000)) {
      throw new Error('Invalid maxOpenOrders: must be between 0 and 10000');
    }
  }

  async getUserLimits(userId) {
    // Check memory cache first
    let limits = this.userLimits.get(userId);
    
    if (!limits) {
      // Load from Redis
      const limitsData = await this.redis.hGet(`${this.config.keyPrefix}limits`, userId);
      if (limitsData) {
        limits = JSON.parse(limitsData);
        this.userLimits.set(userId, limits);
      } else {
        // Use default limits based on tier
        limits = this.getDefaultLimitsForUser(userId);
      }
    }
    
    return limits;
  }

  getDefaultLimitsForUser(userId) {
    // This would typically look up user tier from database
    // For now, using basic tier as default
    const tierLimits = this.config.tierLimits.basic;
    
    return {
      maxPosition: tierLimits.maxPosition,
      maxLeverage: tierLimits.maxLeverage,
      maxOpenOrders: tierLimits.maxOpenOrders,
      tier: 'basic',
      customLimits: {},
      updatedAt: Date.now(),
      updatedBy: 'system'
    };
  }

  async updateUserPosition(userId, position) {
    try {
      const currentTime = Date.now();
      
      // Validate position data
      this.validatePosition(position);
      
      // Get current positions
      let userPositions = this.userPositions.get(userId) || new Map();
      
      // Update position
      const positionKey = `${position.pair}_${position.side}`;
      userPositions.set(positionKey, {
        ...position,
        lastUpdated: currentTime
      });
      
      this.userPositions.set(userId, userPositions);
      
      // Store in Redis for persistence
      await this.redis.hSet(
        `${this.config.keyPrefix}positions`,
        userId,
        JSON.stringify(Array.from(userPositions.entries()))
      );
      
      // Clear cache
      this.clearUserCache(userId);
      
      // Check limits immediately
      await this.checkUserLimits(userId);
      
      // Update metrics
      await this.metrics.setGauge('position_limits.user_positions', userPositions.size, {
        userId: this.hashUserId(userId)
      }, 'risk');
      
    } catch (error) {
      console.error(`Failed to update position for ${userId}:`, error);
      throw error;
    }
  }

  validatePosition(position) {
    if (!position.pair || !position.side || !position.size || !position.value) {
      throw new Error('Invalid position: missing required fields');
    }
    if (!['long', 'short'].includes(position.side)) {
      throw new Error('Invalid position side: must be long or short');
    }
    if (position.size <= 0 || position.value <= 0) {
      throw new Error('Invalid position: size and value must be positive');
    }
    if (position.leverage && position.leverage <= 0) {
      throw new Error('Invalid leverage: must be positive');
    }
  }

  async updateUserOrders(userId, orders) {
    try {
      // Validate orders
      orders.forEach(order => this.validateOrder(order));
      
      // Store orders
      this.userOrders.set(userId, orders);
      
      // Store in Redis
      await this.redis.hSet(
        `${this.config.keyPrefix}orders`,
        userId,
        JSON.stringify(orders)
      );
      
      // Clear cache
      this.clearUserCache(userId);
      
      // Check limits
      await this.checkUserLimits(userId);
      
      // Update metrics
      await this.metrics.setGauge('position_limits.user_orders', orders.length, {
        userId: this.hashUserId(userId)
      }, 'risk');
      
    } catch (error) {
      console.error(`Failed to update orders for ${userId}:`, error);
      throw error;
    }
  }

  validateOrder(order) {
    if (!order.id || !order.pair || !order.side || !order.type || !order.amount) {
      throw new Error('Invalid order: missing required fields');
    }
    if (!['buy', 'sell'].includes(order.side)) {
      throw new Error('Invalid order side: must be buy or sell');
    }
    if (order.amount <= 0) {
      throw new Error('Invalid order amount: must be positive');
    }
  }

  async checkUserLimits(userId) {
    const startTime = Date.now();
    
    try {
      // Get user limits
      const limits = await this.getUserLimits(userId);
      
      // Calculate current exposure
      const exposure = await this.calculateUserExposure(userId);
      
      // Check position limit
      const positionViolation = this.checkPositionLimit(exposure, limits);
      
      // Check leverage limit
      const leverageViolation = this.checkLeverageLimit(exposure, limits);
      
      // Check open orders limit
      const ordersViolation = this.checkOrdersLimit(userId, limits);
      
      // Handle violations
      const violations = [positionViolation, leverageViolation, ordersViolation]
        .filter(v => v !== null);
      
      if (violations.length > 0) {
        await this.handleLimitViolations(userId, violations, exposure, limits);
      } else {
        // Clear any existing violations
        this.limitViolations.delete(userId);
      }
      
      // Update performance stats
      const checkTime = Date.now() - startTime;
      this.updateCheckPerformance(checkTime);
      
      return {
        userId,
        exposure,
        limits,
        violations,
        status: violations.length > 0 ? 'violation' : 'ok'
      };
      
    } catch (error) {
      console.error(`Failed to check limits for ${userId}:`, error);
      throw error;
    }
  }

  async calculateUserExposure(userId) {
    // Check cache first
    const cacheKey = `exposure_${userId}`;
    const cached = this.positionCache.get(cacheKey);
    const expiry = this.cacheExpiry.get(cacheKey);
    
    if (cached && expiry && Date.now() < expiry) {
      this.performanceStats.cacheHitRate++;
      return cached;
    }
    
    try {
      const positions = this.userPositions.get(userId) || new Map();
      const orders = this.userOrders.get(userId) || [];
      
      let totalPositionValue = 0;
      let totalLeveragedValue = 0;
      let maxLeverage = 0;
      let positionCount = 0;
      
      // Calculate position exposure
      for (const [key, position] of positions) {
        if (this.isPositionCurrent(position)) {
          totalPositionValue += position.value;
          
          const leveragedValue = position.value * (position.leverage || 1);
          totalLeveragedValue += leveragedValue;
          
          maxLeverage = Math.max(maxLeverage, position.leverage || 1);
          positionCount++;
        }
      }
      
      // Calculate order exposure
      let orderValue = 0;
      for (const order of orders) {
        if (order.status === 'open') {
          orderValue += order.amount * (order.price || 0);
        }
      }
      
      const exposure = {
        totalPositionValue,
        totalLeveragedValue,
        maxLeverage,
        positionCount,
        orderValue,
        openOrdersCount: orders.filter(o => o.status === 'open').length,
        calculatedAt: Date.now()
      };
      
      // Cache the result
      this.positionCache.set(cacheKey, exposure);
      this.cacheExpiry.set(cacheKey, Date.now() + 30000); // 30 second cache
      
      return exposure;
      
    } catch (error) {
      console.error(`Failed to calculate exposure for ${userId}:`, error);
      throw error;
    }
  }

  isPositionCurrent(position) {
    return Date.now() - position.lastUpdated < this.config.maxPositionAge;
  }

  checkPositionLimit(exposure, limits) {
    if (exposure.totalPositionValue > limits.maxPosition) {
      const ratio = exposure.totalPositionValue / limits.maxPosition;
      return {
        type: 'position_limit',
        severity: ratio > this.config.emergencyStopThreshold ? 'critical' : 'warning',
        current: exposure.totalPositionValue,
        limit: limits.maxPosition,
        ratio,
        message: `Position value ${exposure.totalPositionValue} exceeds limit ${limits.maxPosition}`
      };
    }
    return null;
  }

  checkLeverageLimit(exposure, limits) {
    if (exposure.maxLeverage > limits.maxLeverage) {
      const ratio = exposure.maxLeverage / limits.maxLeverage;
      return {
        type: 'leverage_limit',
        severity: ratio > this.config.emergencyStopThreshold ? 'critical' : 'warning',
        current: exposure.maxLeverage,
        limit: limits.maxLeverage,
        ratio,
        message: `Leverage ${exposure.maxLeverage} exceeds limit ${limits.maxLeverage}`
      };
    }
    return null;
  }

  checkOrdersLimit(userId, limits) {
    const orders = this.userOrders.get(userId) || [];
    const openOrders = orders.filter(o => o.status === 'open').length;
    
    if (openOrders > limits.maxOpenOrders) {
      const ratio = openOrders / limits.maxOpenOrders;
      return {
        type: 'orders_limit',
        severity: ratio > this.config.emergencyStopThreshold ? 'critical' : 'warning',
        current: openOrders,
        limit: limits.maxOpenOrders,
        ratio,
        message: `Open orders ${openOrders} exceeds limit ${limits.maxOpenOrders}`
      };
    }
    return null;
  }

  async handleLimitViolations(userId, violations, exposure, limits) {
    const criticalViolations = violations.filter(v => v.severity === 'critical');
    
    // Store violations
    this.limitViolations.set(userId, {
      violations,
      exposure,
      limits,
      timestamp: Date.now()
    });
    
    // Handle critical violations
    if (criticalViolations.length > 0) {
      await this.handleCriticalViolations(userId, criticalViolations);
    }
    
    // Emit violation events
    for (const violation of violations) {
      this.emit('limit_violation', {
        userId,
        violation,
        exposure,
        limits
      });
      
      // Update metrics
      await this.metrics.incrementCounter('position_limits.violations', 1, {
        type: violation.type,
        severity: violation.severity
      }, 'risk');
    }
    
    this.performanceStats.violationsDetected++;
  }

  async handleCriticalViolations(userId, violations) {
    // Emergency stop for critical violations
    this.emergencyStops.add(userId);
    
    // Emit emergency stop event
    this.emit('emergency_stop', {
      userId,
      violations,
      timestamp: Date.now(),
      action: 'positions_frozen'
    });
    
    // Update metrics
    await this.metrics.incrementCounter('position_limits.emergency_stops', 1, {
      userId: this.hashUserId(userId)
    }, 'risk');
    
    console.warn(`Emergency stop activated for user ${this.hashUserId(userId)}`);
  }

  async isUserAllowedToTrade(userId, orderValue = 0, orderType = 'market') {
    try {
      // Check if user has emergency stop
      if (this.emergencyStops.has(userId)) {
        return {
          allowed: false,
          reason: 'emergency_stop',
          message: 'Trading suspended due to risk limit violations'
        };
      }
      
      // Get current exposure and limits
      const limits = await this.getUserLimits(userId);
      const exposure = await this.calculateUserExposure(userId);
      
      // Check if new order would exceed limits
      const projectedValue = exposure.totalPositionValue + orderValue;
      
      if (projectedValue > limits.maxPosition * this.config.warningThreshold) {
        if (projectedValue > limits.maxPosition) {
          return {
            allowed: false,
            reason: 'position_limit',
            message: `Order would exceed position limit: ${projectedValue} > ${limits.maxPosition}`
          };
        } else {
          return {
            allowed: true,
            warning: true,
            reason: 'position_warning',
            message: `Order approaches position limit: ${projectedValue} / ${limits.maxPosition}`
          };
        }
      }
      
      // Check open orders limit
      const orders = this.userOrders.get(userId) || [];
      const openOrders = orders.filter(o => o.status === 'open').length;
      
      if (openOrders >= limits.maxOpenOrders) {
        return {
          allowed: false,
          reason: 'orders_limit',
          message: `Maximum open orders reached: ${openOrders} / ${limits.maxOpenOrders}`
        };
      }
      
      return {
        allowed: true,
        exposure,
        limits,
        utilization: {
          position: projectedValue / limits.maxPosition,
          orders: openOrders / limits.maxOpenOrders
        }
      };
      
    } catch (error) {
      console.error(`Failed to check trading permission for ${userId}:`, error);
      return {
        allowed: false,
        reason: 'system_error',
        message: 'Unable to verify risk limits'
      };
    }
  }

  async removeEmergencyStop(userId, reason = 'manual') {
    if (this.emergencyStops.has(userId)) {
      this.emergencyStops.delete(userId);
      
      this.emit('emergency_stop_removed', {
        userId,
        reason,
        timestamp: Date.now()
      });
      
      await this.metrics.incrementCounter('position_limits.emergency_stops_removed', 1, {
        reason
      }, 'risk');
      
      console.log(`Emergency stop removed for user ${this.hashUserId(userId)}, reason: ${reason}`);
    }
  }

  async updateAllPositions() {
    // This would typically fetch from the matching engine or database
    // For now, we'll just clean up old positions
    for (const [userId, positions] of this.userPositions) {
      let hasChanges = false;
      
      for (const [key, position] of positions) {
        if (!this.isPositionCurrent(position)) {
          positions.delete(key);
          hasChanges = true;
        }
      }
      
      if (hasChanges) {
        if (positions.size === 0) {
          this.userPositions.delete(userId);
        }
        this.clearUserCache(userId);
      }
    }
  }

  async checkAllLimits() {
    const startTime = Date.now();
    let checksPerformed = 0;
    
    try {
      const userIds = new Set([
        ...this.userPositions.keys(),
        ...this.userOrders.keys()
      ]);
      
      for (const userId of userIds) {
        await this.checkUserLimits(userId);
        checksPerformed++;
      }
      
      // Update performance stats
      const totalTime = Date.now() - startTime;
      this.performanceStats.checksPerSecond = checksPerformed / (totalTime / 1000);
      
    } catch (error) {
      console.error('Error checking all limits:', error);
    }
  }

  clearUserCache(userId) {
    const cacheKey = `exposure_${userId}`;
    this.positionCache.delete(cacheKey);
    this.cacheExpiry.delete(cacheKey);
  }

  cleanupExpiredCache() {
    const now = Date.now();
    for (const [key, expiry] of this.cacheExpiry) {
      if (now >= expiry) {
        this.positionCache.delete(key);
        this.cacheExpiry.delete(key);
      }
    }
  }

  updateCheckPerformance(checkTime) {
    const alpha = 0.1; // Exponential moving average factor
    this.performanceStats.averageCheckTime = 
      (1 - alpha) * this.performanceStats.averageCheckTime + alpha * checkTime;
  }

  async updatePerformanceMetrics() {
    await this.metrics.setGauge('position_limits.checks_per_second', 
      this.performanceStats.checksPerSecond, {}, 'risk');
    
    await this.metrics.setGauge('position_limits.average_check_time', 
      this.performanceStats.averageCheckTime, {}, 'risk');
    
    await this.metrics.setGauge('position_limits.cache_hit_rate', 
      this.performanceStats.cacheHitRate, {}, 'risk');
    
    await this.metrics.setGauge('position_limits.violations_detected', 
      this.performanceStats.violationsDetected, {}, 'risk');
    
    await this.metrics.setGauge('position_limits.emergency_stops_active', 
      this.emergencyStops.size, {}, 'risk');
  }

  async loadUserLimits() {
    try {
      const limitsData = await this.redis.hGetAll(`${this.config.keyPrefix}limits`);
      for (const [userId, data] of Object.entries(limitsData)) {
        this.userLimits.set(userId, JSON.parse(data));
      }
      console.log(`Loaded limits for ${this.userLimits.size} users`);
    } catch (error) {
      console.error('Failed to load user limits:', error);
    }
  }

  async loadUserPositions() {
    try {
      const positionsData = await this.redis.hGetAll(`${this.config.keyPrefix}positions`);
      for (const [userId, data] of Object.entries(positionsData)) {
        const positions = new Map(JSON.parse(data));
        this.userPositions.set(userId, positions);
      }
      console.log(`Loaded positions for ${this.userPositions.size} users`);
    } catch (error) {
      console.error('Failed to load user positions:', error);
    }
  }

  hashUserId(userId) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(userId.toString()).digest('hex').substring(0, 16);
  }

  getPositionLimitsStatus() {
    return {
      isRunning: this.isRunning,
      usersTracked: this.userPositions.size,
      emergencyStops: this.emergencyStops.size,
      violations: this.limitViolations.size,
      cacheSize: this.positionCache.size,
      performance: this.performanceStats
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping position limits manager...');
    
    // Stop intervals
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear caches
    this.userPositions.clear();
    this.userOrders.clear();
    this.userLimits.clear();
    this.positionCache.clear();
    this.cacheExpiry.clear();
    this.limitViolations.clear();
    this.emergencyStops.clear();
    
    this.isRunning = false;
    console.log('✅ Position limits manager stopped');
  }
}

module.exports = PositionLimitsManager;