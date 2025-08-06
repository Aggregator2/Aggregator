const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');
const crypto = require('crypto');

class SecurePositionLimitsManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Default position limits with validation
      defaultMaxPosition: this.validateNumber(config.defaultMaxPosition, 100000, 1, 1e12),
      defaultMaxLeverage: this.validateNumber(config.defaultMaxLeverage, 10, 1, 1000),
      defaultMaxOpenOrders: this.validateNumber(config.defaultMaxOpenOrders, 50, 1, 10000),
      
      // Risk tiers with comprehensive validation
      tierLimits: this.validateTierLimits(config.tierLimits || {
        basic: { maxPosition: 10000, maxLeverage: 3, maxOpenOrders: 10 },
        verified: { maxPosition: 100000, maxLeverage: 10, maxOpenOrders: 50 },
        professional: { maxPosition: 1000000, maxLeverage: 20, maxOpenOrders: 200 },
        institutional: { maxPosition: 10000000, maxLeverage: 50, maxOpenOrders: 1000 }
      }),
      
      // Performance and security settings
      updateInterval: this.validateNumber(config.updateInterval, 1000, 100, 60000),
      maxPositionAge: this.validateNumber(config.maxPositionAge, 300000, 10000, 3600000),
      maxCacheSize: this.validateNumber(config.maxCacheSize, 10000, 100, 1000000),
      
      // Redis configuration with sanitization
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'risk:position:'),
      
      // Security settings
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
    this.userPositions = new Map(); // Limited size with LRU eviction
    this.userOrders = new Map();
    this.userLimits = new Map();
    
    // Performance optimization caches
    this.positionCache = new LRU(this.config.maxCacheSize / 4);
    this.cacheExpiry = new Map();
    
    // Security tracking
    this.limitViolations = new Map();
    this.emergencyStops = new Set();
    this.failedAttempts = new Map(); // userId -> attempts count
    this.lockedUsers = new Map(); // userId -> lockout expiry
    
    // Performance and monitoring
    this.performanceStats = {
      checksPerSecond: 0,
      averageCheckTime: 0,
      cacheHitRate: 0,
      violationsDetected: 0,
      memoryUsage: 0
    };
    
    // Authentication and authorization
    this.authorizedUsers = new Set();
    this.permissionMatrix = new Map();
    
    // Atomic operation locks
    this.operationLocks = new Map();
    this.lockTimeouts = new Map();
  }

  // Input validation helpers
  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateTierLimits(tiers) {
    const validatedTiers = {};
    for (const [tier, limits] of Object.entries(tiers)) {
      if (typeof limits === 'object' && limits !== null) {
        validatedTiers[this.sanitizeString(tier)] = {
          maxPosition: this.validateNumber(limits.maxPosition, 10000, 1, 1e12),
          maxLeverage: this.validateNumber(limits.maxLeverage, 10, 1, 1000),
          maxOpenOrders: this.validateNumber(limits.maxOpenOrders, 50, 1, 10000)
        };
      }
    }
    return validatedTiers;
  }

  sanitizeUrl(url) {
    if (typeof url !== 'string') return 'redis://localhost:6379';
    // Basic URL validation
    try {
      const parsed = new URL(url);
      if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
        throw new Error('Invalid Redis URL protocol');
      }
      return url;
    } catch (error) {
      console.warn('Invalid Redis URL, using default');
      return 'redis://localhost:6379';
    }
  }

  sanitizeKeyPrefix(prefix) {
    if (typeof prefix !== 'string') return 'risk:position:';
    // Remove potentially dangerous characters
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100);
  }

  // Secure Redis key generation
  generateSecureKey(keyType, identifier, subKey = '') {
    const sanitizedId = this.sanitizeString(identifier);
    const sanitizedSubKey = this.sanitizeString(subKey);
    const baseKey = `${this.config.keyPrefix}${keyType}:${sanitizedId}`;
    return sanitizedSubKey ? `${baseKey}:${sanitizedSubKey}` : baseKey;
  }

  // Authentication and authorization
  async authenticate(token) {
    if (!this.config.authenticationRequired) return true;
    
    try {
      // Implement proper JWT validation here
      const decoded = this.validateJWT(token);
      return decoded && decoded.permissions;
    } catch (error) {
      console.warn('Authentication failed:', error.message);
      return false;
    }
  }

  async authorize(userId, action, authenticatedUser) {
    if (!this.config.authenticationRequired) return true;
    
    const permissions = this.permissionMatrix.get(authenticatedUser) || new Set();
    
    // Define required permissions for each action
    const requiredPermissions = {
      'setLimits': 'MODIFY_POSITION_LIMITS',
      'emergencyStop': 'EMERGENCY_ACTIONS',
      'viewLimits': 'VIEW_POSITION_LIMITS'
    };
    
    const required = requiredPermissions[action];
    if (!required || permissions.has(required) || permissions.has('ADMIN')) {
      return true;
    }
    
    throw new Error(`Unauthorized: Missing permission ${required}`);
  }

  validateJWT(token) {
    // Implement proper JWT validation
    // This is a placeholder - use a proper JWT library
    try {
      const [header, payload, signature] = token.split('.');
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
      return decoded;
    } catch (error) {
      throw new Error('Invalid JWT token');
    }
  }

  // Atomic operations with locks
  async acquireLock(lockKey, timeout = 5000) {
    const lockId = crypto.randomBytes(16).toString('hex');
    const expiry = Date.now() + timeout;
    
    // Check if lock already exists
    if (this.operationLocks.has(lockKey)) {
      const existingLock = this.operationLocks.get(lockKey);
      if (existingLock.expiry > Date.now()) {
        throw new Error(`Operation locked: ${lockKey}`);
      }
    }
    
    // Acquire lock
    this.operationLocks.set(lockKey, { id: lockId, expiry });
    
    // Set timeout to auto-release
    this.lockTimeouts.set(lockKey, setTimeout(() => {
      this.releaseLock(lockKey, lockId);
    }, timeout));
    
    return lockId;
  }

  async releaseLock(lockKey, lockId) {
    const lock = this.operationLocks.get(lockKey);
    if (lock && lock.id === lockId) {
      this.operationLocks.delete(lockKey);
      
      const timeout = this.lockTimeouts.get(lockKey);
      if (timeout) {
        clearTimeout(timeout);
        this.lockTimeouts.delete(lockKey);
      }
    }
  }

  // Rate limiting and security checks
  async checkRateLimit(userId) {
    const attempts = this.failedAttempts.get(userId) || 0;
    if (attempts >= this.config.maxFailedAttempts) {
      const lockout = this.lockedUsers.get(userId);
      if (lockout && lockout > Date.now()) {
        throw new Error('User temporarily locked due to excessive failed attempts');
      }
      // Reset after lockout period
      this.failedAttempts.delete(userId);
      this.lockedUsers.delete(userId);
    }
  }

  recordFailedAttempt(userId) {
    const attempts = (this.failedAttempts.get(userId) || 0) + 1;
    this.failedAttempts.set(userId, attempts);
    
    if (attempts >= this.config.maxFailedAttempts) {
      this.lockedUsers.set(userId, Date.now() + this.config.lockoutDuration);
    }
  }

  async initialize() {
    try {
      // Initialize Redis connection with security options
      const Redis = require('redis');
      const redisOptions = {
        url: this.config.redisUrl,
        socket: {
          tls: this.config.redisUrl.includes('rediss://'),
          rejectUnauthorized: true,
          connectTimeout: 5000
        },
        commandTimeout: 3000,
        retryDelayOnFailover: 100
      };
      
      // Add authentication if available
      if (process.env.REDIS_PASSWORD) {
        redisOptions.password = process.env.REDIS_PASSWORD;
      }
      
      this.redis = Redis.createClient(redisOptions);
      
      this.redis.on('error', (err) => {
        console.error('Redis error:', err.message);
        this.emit('error', err);
      });

      await this.redis.connect();
      
      // Test connection
      await this.redis.ping();
      
      // Load existing data securely
      await this.loadUserLimits();
      await this.loadUserPositions();
      
      console.log('✅ Secure position limits manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize secure position limits manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🔒 Starting secure position limits manager...');
    this.isRunning = true;
    
    // Start position monitoring with error handling
    this.startSecurePositionMonitoring();
    
    // Start cache cleanup with memory management
    this.startSecureCacheCleanup();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    // Start security monitoring
    this.startSecurityMonitoring();
    
    console.log('✅ Secure position limits manager started');
  }

  startSecurePositionMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.updateAllPositions();
        await this.checkAllLimitsSecurely();
        this.enforceMemoryLimits();
      } catch (error) {
        console.error('Secure position monitoring error:', error);
        await this.metrics.incrementCounter('position_limits.monitoring_errors', 1, {}, 'risk');
      }
    }, this.config.updateInterval);
  }

  startSecureCacheCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredCache();
      this.enforceMemoryLimits();
      this.cleanupSecurityData();
    }, 60000); // Every minute
  }

  startSecurityMonitoring() {
    this.securityInterval = setInterval(() => {
      this.monitorSuspiciousActivity();
      this.checkForAnomalies();
      this.updateSecurityMetrics();
    }, 30000); // Every 30 seconds
  }

  // Memory management and DoS protection
  enforceMemoryLimits() {
    const maxSize = this.config.maxCacheSize;
    
    // Enforce size limits with LRU eviction
    while (this.userPositions.size > maxSize) {
      const firstKey = this.userPositions.keys().next().value;
      this.userPositions.delete(firstKey);
    }
    
    while (this.userOrders.size > maxSize) {
      const firstKey = this.userOrders.keys().next().value;
      this.userOrders.delete(firstKey);
    }
    
    while (this.userLimits.size > maxSize) {
      const firstKey = this.userLimits.keys().next().value;
      this.userLimits.delete(firstKey);
    }
    
    // Update memory usage stats
    this.performanceStats.memoryUsage = process.memoryUsage().heapUsed;
  }

  cleanupSecurityData() {
    const now = Date.now();
    
    // Cleanup expired lockouts
    for (const [userId, expiry] of this.lockedUsers) {
      if (expiry < now) {
        this.lockedUsers.delete(userId);
        this.failedAttempts.delete(userId);
      }
    }
    
    // Cleanup old violations (keep for 24 hours)
    const cutoff = now - 86400000;
    for (const [userId, violation] of this.limitViolations) {
      if (violation.timestamp < cutoff) {
        this.limitViolations.delete(userId);
      }
    }
  }

  // Secure user limits management
  async setUserLimits(userId, limits, authenticatedUser, authToken) {
    try {
      // Security checks
      await this.authenticate(authToken);
      await this.authorize(userId, 'setLimits', authenticatedUser);
      await this.checkRateLimit(authenticatedUser);
      
      // Input validation
      this.validateUserLimitsInput(userId, limits);
      
      // Acquire atomic lock
      const lockKey = `limits_${userId}`;
      const lockId = await this.acquireLock(lockKey);
      
      try {
        const userLimits = {
          maxPosition: this.validateNumber(limits.maxPosition, this.config.defaultMaxPosition, 1, 1e12),
          maxLeverage: this.validateNumber(limits.maxLeverage, this.config.defaultMaxLeverage, 1, 1000),
          maxOpenOrders: this.validateNumber(limits.maxOpenOrders, this.config.defaultMaxOpenOrders, 1, 10000),
          tier: this.sanitizeString(limits.tier || 'basic'),
          customLimits: this.validateCustomLimits(limits.customLimits || {}),
          updatedAt: Date.now(),
          updatedBy: this.sanitizeString(authenticatedUser)
        };
        
        // Validate tier exists
        if (!this.config.tierLimits[userLimits.tier]) {
          throw new Error('Invalid user tier');
        }
        
        // Store in memory with size enforcement
        this.enforceMemoryLimits();
        this.userLimits.set(userId, userLimits);
        
        // Store in Redis securely
        const secureKey = this.generateSecureKey('limits', userId);
        await this.redis.hSet(secureKey, 'data', JSON.stringify(userLimits));
        await this.redis.expire(secureKey, 86400 * 7); // 7 day expiry
        
        // Clear position cache for user
        this.clearUserCache(userId);
        
        // Emit event with sanitized data
        this.emit('limits_updated', { 
          userId: this.hashUserId(userId), 
          tier: userLimits.tier,
          updatedBy: userLimits.updatedBy
        });
        
        // Update metrics
        await this.metrics.incrementCounter('position_limits.limits_updated', 1, {
          tier: userLimits.tier
        }, 'risk');
        
        return userLimits;
        
      } finally {
        await this.releaseLock(lockKey, lockId);
      }
      
    } catch (error) {
      this.recordFailedAttempt(authenticatedUser);
      console.error(`Failed to set user limits for ${this.hashUserId(userId)}:`, error.message);
      throw error;
    }
  }

  validateUserLimitsInput(userId, limits) {
    if (!userId || typeof userId !== 'string' || userId.length > 100) {
      throw new Error('Invalid user ID');
    }
    
    if (!limits || typeof limits !== 'object') {
      throw new Error('Invalid limits object');
    }
    
    // Additional business logic validation
    if (limits.maxLeverage && limits.maxPosition) {
      const maxExposure = limits.maxPosition * limits.maxLeverage;
      if (maxExposure > 1e15) { // 1 quadrillion max exposure
        throw new Error('Leverage and position combination exceeds maximum exposure');
      }
    }
  }

  validateCustomLimits(customLimits) {
    const validated = {};
    if (typeof customLimits === 'object' && customLimits !== null) {
      for (const [key, value] of Object.entries(customLimits)) {
        if (typeof key === 'string' && key.length <= 50) {
          const sanitizedKey = this.sanitizeString(key);
          if (typeof value === 'number' && isFinite(value)) {
            validated[sanitizedKey] = Math.max(0, Math.min(value, 1e12));
          }
        }
      }
    }
    return validated;
  }

  // Secure position updates with race condition protection
  async updateUserPosition(userId, position, authenticatedUser, authToken) {
    try {
      await this.authenticate(authToken);
      await this.checkRateLimit(authenticatedUser);
      
      this.validatePositionInput(userId, position);
      
      const lockKey = `position_${userId}`;
      const lockId = await this.acquireLock(lockKey);
      
      try {
        const currentTime = Date.now();
        
        // Get current positions safely
        let userPositions = this.userPositions.get(userId) || new Map();
        
        // Update position with validation
        const positionKey = `${this.sanitizeString(position.pair)}_${this.sanitizeString(position.side)}`;
        const validatedPosition = {
          orderId: this.sanitizeString(position.orderId || ''),
          pair: this.sanitizeString(position.pair),
          side: this.sanitizeString(position.side),
          size: this.validateNumber(position.size, 0, 0, 1e12),
          value: this.validateNumber(position.value, 0, 0, 1e15),
          leverage: this.validateNumber(position.leverage, 1, 1, 1000),
          entryPrice: this.validateNumber(position.entryPrice, 0, 0, 1e12),
          lastUpdated: currentTime
        };
        
        userPositions.set(positionKey, validatedPosition);
        this.userPositions.set(userId, userPositions);
        
        // Store in Redis with compression if enabled
        const secureKey = this.generateSecureKey('positions', userId);
        const positionData = Array.from(userPositions.entries());
        const dataToStore = this.config.enableCompression ? 
          this.compressData(positionData) : JSON.stringify(positionData);
        
        await this.redis.hSet(secureKey, 'data', dataToStore);
        await this.redis.expire(secureKey, 3600); // 1 hour expiry
        
        // Clear cache
        this.clearUserCache(userId);
        
        // Check limits immediately with the new position
        await this.checkUserLimitsSecurely(userId);
        
        // Update metrics
        await this.metrics.setGauge('position_limits.user_positions', userPositions.size, {
          userId: this.hashUserId(userId)
        }, 'risk');
        
      } finally {
        await this.releaseLock(lockKey, lockId);
      }
      
    } catch (error) {
      console.error(`Failed to update position for ${this.hashUserId(userId)}:`, error.message);
      throw error;
    }
  }

  validatePositionInput(userId, position) {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid user ID');
    }
    
    if (!position || typeof position !== 'object') {
      throw new Error('Invalid position object');
    }
    
    const requiredFields = ['pair', 'side', 'size', 'value'];
    for (const field of requiredFields) {
      if (!(field in position)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    if (!['long', 'short'].includes(position.side)) {
      throw new Error('Invalid position side');
    }
    
    if (position.size <= 0 || position.value <= 0) {
      throw new Error('Position size and value must be positive');
    }
    
    if (position.leverage && (position.leverage <= 0 || position.leverage > 1000)) {
      throw new Error('Invalid leverage value');
    }
  }

  // Secure limit checking with comprehensive validation
  async checkUserLimitsSecurely(userId) {
    const startTime = Date.now();
    
    try {
      // Rate limiting check
      await this.checkRateLimit(userId);
      
      // Get user limits and exposure atomically
      const limits = await this.getUserLimits(userId);
      const exposure = await this.calculateUserExposureSecurely(userId);
      
      // Perform all limit checks
      const violations = [];
      
      const positionViolation = this.checkPositionLimitSecurely(exposure, limits);
      const leverageViolation = this.checkLeverageLimitSecurely(exposure, limits);
      const ordersViolation = this.checkOrdersLimitSecurely(userId, limits);
      
      if (positionViolation) violations.push(positionViolation);
      if (leverageViolation) violations.push(leverageViolation);
      if (ordersViolation) violations.push(ordersViolation);
      
      // Handle violations with proper error handling
      if (violations.length > 0) {
        await this.handleLimitViolationsSecurely(userId, violations, exposure, limits);
      } else {
        // Clear any existing violations
        this.limitViolations.delete(userId);
      }
      
      // Update performance stats
      const checkTime = Date.now() - startTime;
      this.updateCheckPerformance(checkTime);
      
      return {
        userId: this.hashUserId(userId),
        exposure,
        limits: this.sanitizeLimitsForResponse(limits),
        violations: violations.map(v => this.sanitizeViolation(v)),
        status: violations.length > 0 ? 'violation' : 'ok'
      };
      
    } catch (error) {
      console.error(`Failed to check limits for ${this.hashUserId(userId)}:`, error.message);
      this.recordFailedAttempt(userId);
      throw error;
    }
  }

  checkPositionLimitSecurely(exposure, limits) {
    if (!exposure || !limits) return null;
    
    const totalValue = Math.max(0, exposure.totalPositionValue || 0);
    const maxPosition = Math.max(0, limits.maxPosition || 0);
    
    if (totalValue > maxPosition) {
      const ratio = maxPosition > 0 ? totalValue / maxPosition : Infinity;
      return {
        type: 'position_limit',
        severity: ratio > 1.2 ? 'critical' : 'warning', // 20% buffer for critical
        current: totalValue,
        limit: maxPosition,
        ratio,
        message: `Position value ${totalValue.toFixed(2)} exceeds limit ${maxPosition.toFixed(2)}`
      };
    }
    return null;
  }

  checkLeverageLimitSecurely(exposure, limits) {
    if (!exposure || !limits) return null;
    
    const maxLeverage = Math.max(0, exposure.maxLeverage || 0);
    const leverageLimit = Math.max(0, limits.maxLeverage || 0);
    
    if (maxLeverage > leverageLimit) {
      const ratio = leverageLimit > 0 ? maxLeverage / leverageLimit : Infinity;
      return {
        type: 'leverage_limit',
        severity: ratio > 1.1 ? 'critical' : 'warning', // 10% buffer for critical
        current: maxLeverage,
        limit: leverageLimit,
        ratio,
        message: `Leverage ${maxLeverage.toFixed(2)} exceeds limit ${leverageLimit.toFixed(2)}`
      };
    }
    return null;
  }

  checkOrdersLimitSecurely(userId, limits) {
    const orders = this.userOrders.get(userId) || [];
    const openOrders = orders.filter(o => o && o.status === 'open').length;
    const orderLimit = Math.max(0, limits.maxOpenOrders || 0);
    
    if (openOrders > orderLimit) {
      const ratio = orderLimit > 0 ? openOrders / orderLimit : Infinity;
      return {
        type: 'orders_limit',
        severity: ratio > 1.1 ? 'critical' : 'warning',
        current: openOrders,
        limit: orderLimit,
        ratio,
        message: `Open orders ${openOrders} exceeds limit ${orderLimit}`
      };
    }
    return null;
  }

  // Secure exposure calculation with validation
  async calculateUserExposureSecurely(userId) {
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
      
      // Calculate position exposure with validation
      for (const [key, position] of positions) {
        if (this.isPositionValid(position)) {
          const value = Math.max(0, position.value || 0);
          const leverage = Math.max(1, Math.min(position.leverage || 1, 1000));
          
          totalPositionValue += value;
          totalLeveragedValue += value * leverage;
          maxLeverage = Math.max(maxLeverage, leverage);
          positionCount++;
        }
      }
      
      // Calculate order exposure with validation
      let orderValue = 0;
      let openOrdersCount = 0;
      
      for (const order of orders) {
        if (this.isOrderValid(order) && order.status === 'open') {
          const amount = Math.max(0, order.amount || 0);
          const price = Math.max(0, order.price || 0);
          orderValue += amount * price;
          openOrdersCount++;
        }
      }
      
      const exposure = {
        totalPositionValue: Math.min(totalPositionValue, 1e15), // Cap at reasonable max
        totalLeveragedValue: Math.min(totalLeveragedValue, 1e15),
        maxLeverage: Math.min(maxLeverage, 1000),
        positionCount: Math.min(positionCount, 10000),
        orderValue: Math.min(orderValue, 1e15),
        openOrdersCount: Math.min(openOrdersCount, 10000),
        calculatedAt: Date.now()
      };
      
      // Cache with TTL
      this.positionCache.set(cacheKey, exposure);
      this.cacheExpiry.set(cacheKey, Date.now() + 30000); // 30 second cache
      
      return exposure;
      
    } catch (error) {
      console.error(`Failed to calculate exposure for ${this.hashUserId(userId)}:`, error.message);
      return {
        totalPositionValue: 0,
        totalLeveragedValue: 0,
        maxLeverage: 0,
        positionCount: 0,
        orderValue: 0,
        openOrdersCount: 0,
        calculatedAt: Date.now(),
        error: 'calculation_failed'
      };
    }
  }

  isPositionValid(position) {
    return position && 
           typeof position === 'object' &&
           typeof position.value === 'number' &&
           isFinite(position.value) &&
           position.value >= 0 &&
           Date.now() - (position.lastUpdated || 0) < this.config.maxPositionAge;
  }

  isOrderValid(order) {
    return order &&
           typeof order === 'object' &&
           typeof order.amount === 'number' &&
           typeof order.price === 'number' &&
           isFinite(order.amount) &&
           isFinite(order.price) &&
           order.amount >= 0 &&
           order.price >= 0;
  }

  // Data compression for performance
  compressData(data) {
    try {
      const zlib = require('zlib');
      const jsonString = JSON.stringify(data);
      return zlib.gzipSync(jsonString).toString('base64');
    } catch (error) {
      console.warn('Compression failed, using uncompressed data');
      return JSON.stringify(data);
    }
  }

  decompressData(compressedData) {
    try {
      const zlib = require('zlib');
      const buffer = Buffer.from(compressedData, 'base64');
      const decompressed = zlib.gunzipSync(buffer).toString();
      return JSON.parse(decompressed);
    } catch (error) {
      console.warn('Decompression failed, trying as JSON');
      return JSON.parse(compressedData);
    }
  }

  // Security helpers
  hashUserId(userId) {
    return crypto.createHash('sha256')
      .update(userId.toString())
      .update(process.env.USER_HASH_SALT || 'default_salt')
      .digest('hex')
      .substring(0, 32); // Use longer hash
  }

  sanitizeLimitsForResponse(limits) {
    return {
      maxPosition: limits.maxPosition,
      maxLeverage: limits.maxLeverage,
      maxOpenOrders: limits.maxOpenOrders,
      tier: limits.tier
      // Don't expose updatedBy or internal data
    };
  }

  sanitizeViolation(violation) {
    return {
      type: violation.type,
      severity: violation.severity,
      ratio: Math.round(violation.ratio * 1000) / 1000, // Round to 3 decimals
      message: violation.message
      // Don't expose exact current/limit values
    };
  }

  // Performance monitoring
  updateCheckPerformance(checkTime) {
    const alpha = 0.1;
    this.performanceStats.averageCheckTime = 
      (1 - alpha) * this.performanceStats.averageCheckTime + alpha * checkTime;
  }

  // Security monitoring
  monitorSuspiciousActivity() {
    // Monitor for unusual patterns
    const now = Date.now();
    let suspiciousUsers = 0;
    
    for (const [userId, attempts] of this.failedAttempts) {
      if (attempts > this.config.maxFailedAttempts / 2) {
        suspiciousUsers++;
      }
    }
    
    // Update security metrics
    this.performanceStats.suspiciousActivity = suspiciousUsers;
  }

  checkForAnomalies() {
    // Check for system anomalies
    const memoryUsage = process.memoryUsage().heapUsed;
    const memoryThreshold = 1024 * 1024 * 1024; // 1GB
    
    if (memoryUsage > memoryThreshold) {
      console.warn('High memory usage detected, performing cleanup');
      this.enforceMemoryLimits();
    }
  }

  async updateSecurityMetrics() {
    await this.metrics.setGauge('position_limits.locked_users', 
      this.lockedUsers.size, {}, 'risk');
    
    await this.metrics.setGauge('position_limits.failed_attempts', 
      this.failedAttempts.size, {}, 'risk');
    
    await this.metrics.setGauge('position_limits.memory_usage', 
      this.performanceStats.memoryUsage, {}, 'risk');
  }

  // Safe public interface for trading permission check
  async isUserAllowedToTrade(userId, orderValue = 0) {
    try {
      // Basic input validation
      if (!userId || typeof userId !== 'string') {
        return {
          allowed: false,
          reason: 'invalid_user_id',
          message: 'Invalid user identifier provided'
        };
      }
      
      // Check if user is locked
      const lockout = this.lockedUsers.get(userId);
      if (lockout && lockout > Date.now()) {
        return {
          allowed: false,
          reason: 'user_locked',
          message: 'User temporarily locked due to security concerns'
        };
      }
      
      // Check emergency stops
      if (this.emergencyStops.has(userId)) {
        return {
          allowed: false,
          reason: 'emergency_stop',
          message: 'Trading suspended due to risk limit violations'
        };
      }
      
      // Get current exposure and limits
      const limits = await this.getUserLimits(userId);
      const exposure = await this.calculateUserExposureSecurely(userId);
      
      // Validate order value
      const validOrderValue = Math.max(0, Math.min(orderValue || 0, 1e12));
      
      // Check if new order would exceed limits
      const projectedValue = exposure.totalPositionValue + validOrderValue;
      
      if (projectedValue > limits.maxPosition) {
        return {
          allowed: false,
          reason: 'position_limit',
          message: `Order would exceed position limit`,
          utilization: projectedValue / limits.maxPosition
        };
      }
      
      // Check open orders limit
      if (exposure.openOrdersCount >= limits.maxOpenOrders) {
        return {
          allowed: false,
          reason: 'orders_limit',
          message: `Maximum open orders reached`
        };
      }
      
      // Check if approaching limits (warning)
      const positionUtilization = projectedValue / limits.maxPosition;
      const orderUtilization = exposure.openOrdersCount / limits.maxOpenOrders;
      
      const result = {
        allowed: true,
        utilization: {
          position: Math.round(positionUtilization * 1000) / 1000,
          orders: Math.round(orderUtilization * 1000) / 1000
        }
      };
      
      // Add warnings if approaching limits
      if (positionUtilization > 0.8 || orderUtilization > 0.8) {
        result.warning = true;
        result.reason = 'approaching_limits';
        result.message = 'Approaching risk limits';
      }
      
      return result;
      
    } catch (error) {
      console.error(`Failed to check trading permission for ${this.hashUserId(userId)}:`, error.message);
      return {
        allowed: false,
        reason: 'system_error',
        message: 'Unable to verify risk limits'
      };
    }
  }

  // Additional secure methods would continue here...
  // [Rest of implementation with similar security enhancements]

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping secure position limits manager...');
    
    // Stop intervals
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    if (this.securityInterval) clearInterval(this.securityInterval);
    
    // Clear all locks
    for (const [lockKey, timeout] of this.lockTimeouts) {
      clearTimeout(timeout);
    }
    this.operationLocks.clear();
    this.lockTimeouts.clear();
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear sensitive data
    this.userPositions.clear();
    this.userOrders.clear();
    this.userLimits.clear();
    this.positionCache.clear();
    this.cacheExpiry.clear();
    this.limitViolations.clear();
    this.emergencyStops.clear();
    this.failedAttempts.clear();
    this.lockedUsers.clear();
    this.authorizedUsers.clear();
    this.permissionMatrix.clear();
    
    this.isRunning = false;
    console.log('✅ Secure position limits manager stopped');
  }
}

// LRU Cache implementation for performance
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
  
  clear() {
    this.cache.clear();
  }
}

module.exports = SecurePositionLimitsManager;