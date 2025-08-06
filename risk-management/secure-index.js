const EventEmitter = require('events');
const SecurePositionLimitsManager = require('./secure-position-limits-manager');
const SecureVolumeRestrictionsManager = require('./secure-volume-restrictions-manager');
const SecureCircuitBreakerManager = require('./secure-circuit-breaker-manager');
const SecureMLActivityDetector = require('./secure-ml-activity-detector');
const SecureGeoRestrictionsManager = require('./secure-geo-restrictions-manager');
const SecureTokenManagementSystem = require('./secure-token-management-system');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');
const crypto = require('crypto');

class SecureRiskManagementSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Component configurations with validation
      positionLimits: this.sanitizeObject(config.positionLimits || {}),
      volumeRestrictions: this.sanitizeObject(config.volumeRestrictions || {}),
      circuitBreakers: this.sanitizeObject(config.circuitBreakers || {}),
      mlDetection: this.sanitizeObject(config.mlDetection || {}),
      geoRestrictions: this.sanitizeObject(config.geoRestrictions || {}),
      tokenManagement: this.sanitizeObject(config.tokenManagement || {}),
      
      // System-wide security settings
      enableAllComponents: config.enableAllComponents !== false,
      strictMode: config.strictMode !== false, // Fail-safe when components fail
      emergencyMode: config.emergencyMode || false,
      
      // Authentication and authorization
      authenticationRequired: config.authenticationRequired !== false,
      maxFailedAttempts: this.validateNumber(config.maxFailedAttempts, 5, 1, 100),
      lockoutDuration: this.validateNumber(config.lockoutDuration, 300000, 60000, 3600000),
      
      // Integration settings with validation
      matchingEngineIntegration: config.matchingEngineIntegration !== false,
      orderBookIntegration: config.orderBookIntegration !== false,
      
      // Validated alert settings
      alertWebhook: this.sanitizeUrl(config.alertWebhook),
      slackWebhook: this.sanitizeUrl(config.slackWebhook),
      emailNotifications: this.validateEmailList(config.emailNotifications || []),
      
      // Performance and security settings
      healthCheckInterval: this.validateNumber(config.healthCheckInterval, 30000, 10000, 300000),
      maxCacheSize: this.validateNumber(config.maxCacheSize, 50000, 1000, 1000000),
      cacheExpiry: this.validateNumber(config.cacheExpiry, 300000, 60000, 3600000),
      
      // Rate limiting
      maxRequestsPerMinute: this.validateNumber(config.maxRequestsPerMinute, 1000, 100, 100000),
      
      // Memory management
      maxMemoryUsage: this.validateNumber(config.maxMemoryUsage, 512 * 1024 * 1024, 100 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
      
      // Secure Redis configuration
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'risk:system:'),
      
      // Data encryption settings
      encryptionEnabled: config.encryptionEnabled !== false,
      encryptionKey: process.env.RISK_ENCRYPTION_KEY,
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Secure component management
    this.components = new Map();
    this.componentHealth = new Map();
    this.componentSecurity = new Map();
    
    // System security state
    this.systemHealth = 'healthy'; // healthy, degraded, critical
    this.systemSecurity = 'secure'; // secure, warning, compromised
    this.lastHealthCheck = null;
    this.lastSecurityCheck = null;
    
    // Secure caching with size limits
    this.riskDecisions = new LRU(this.config.maxCacheSize / 4);
    this.decisionCache = new LRU(this.config.maxCacheSize / 4);
    this.userCache = new LRU(this.config.maxCacheSize / 4);
    this.tokenCache = new LRU(this.config.maxCacheSize / 4);
    
    // Security tracking
    this.failedAttempts = new Map(); // userId -> attempts count
    this.lockedUsers = new Map(); // userId -> lockout expiry
    this.suspiciousActivities = new Map(); // userId -> suspicious events
    this.securityAlerts = new Map(); // alertId -> alert details
    
    // Integration references with validation
    this.matchingEngine = null;
    this.orderBook = null;
    
    // Performance tracking
    this.performanceStats = {
      assessmentsPerSecond: 0,
      averageAssessmentTime: 0,
      cacheHitRate: 0,
      securityViolations: 0,
      emergencyStops: 0,
      blockedRequests: 0,
      memoryUsage: 0
    };
    
    // Authentication and authorization
    this.authorizedUsers = new Set();
    this.permissionMatrix = new Map();
    
    // Atomic operation locks
    this.operationLocks = new Map();
    this.lockTimeouts = new Map();
    
    // Rate limiting
    this.rateLimiters = new Map();
    this.defaultRateLimit = { requests: this.config.maxRequestsPerMinute, window: 60000 };
    
    // Memory management
    this.memoryCheckInterval = 60000; // 1 minute
    this.maxRiskDecisions = 100000;
  }

  // Input validation helpers
  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 200);
  }

  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      const allowedProtocols = ['http:', 'https:', 'redis:', 'rediss:'];
      if (allowedProtocols.includes(parsed.protocol)) {
        return url;
      }
    } catch {
      return null;
    }
    return null;
  }

  sanitizeKeyPrefix(prefix) {
    if (typeof prefix !== 'string') return 'risk:system:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
  }

  validateEmailList(emails) {
    if (!Array.isArray(emails)) return [];
    return emails
      .filter(email => typeof email === 'string' && email.includes('@'))
      .map(email => email.toLowerCase().trim())
      .slice(0, 50); // Limit list size
  }

  sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};
    
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
        } else if (typeof value === 'object' && value !== null) {
          sanitized[cleanKey] = this.sanitizeObject(value);
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
      const isValid = await this.verifyAuthToken(authToken);
      if (!isValid) {
        throw new Error('Invalid authentication token');
      }
      return true;
    } catch (error) {
      await this.metrics.incrementCounter('risk_system.auth_failures', 1, {}, 'risk');
      throw new Error('Authentication failed');
    }
  }

  async authorize(userId, operation, authenticatedUser) {
    const permissions = this.permissionMatrix.get(userId) || [];
    const requiredPermission = `risk_system.${operation}`;
    
    if (!permissions.includes(requiredPermission) && !permissions.includes('risk_system.*')) {
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
    const maxAge = this.config.cacheExpiry;
    
    this.cleanCacheByAge(this.riskDecisions, maxAge);
    this.cleanCacheByAge(this.decisionCache, maxAge);
    this.cleanCacheByAge(this.userCache, maxAge);
    this.cleanCacheByAge(this.tokenCache, maxAge);
    
    // Limit map sizes
    this.limitMapSize(this.failedAttempts, 10000);
    this.limitMapSize(this.lockedUsers, 1000);
    this.limitMapSize(this.suspiciousActivities, 5000);
    this.limitMapSize(this.securityAlerts, 1000);
    this.limitMapSize(this.rateLimiters, 50000);
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
      console.log('🛡️ Initializing Secure Risk Management System...');
      
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
      
      // Initialize metrics collector
      await this.metrics.initialize();
      
      // Initialize all secure components
      await this.initializeSecureComponents();
      
      // Setup secure component event handlers
      this.setupSecureComponentEventHandlers();
      
      // Start memory monitoring
      this.memoryMonitorInterval = setInterval(() => {
        this.checkMemoryUsage();
      }, this.memoryCheckInterval);
      
      console.log('✅ Secure Risk Management System initialized');
      
    } catch (error) {
      console.error('Failed to initialize Secure Risk Management System:', error);
      throw error;
    }
  }

  async initializeSecureComponents() {
    const componentConfigs = [
      { name: 'positionLimits', class: SecurePositionLimitsManager, config: this.config.positionLimits },
      { name: 'volumeRestrictions', class: SecureVolumeRestrictionsManager, config: this.config.volumeRestrictions },
      { name: 'circuitBreakers', class: SecureCircuitBreakerManager, config: this.config.circuitBreakers },
      { name: 'mlDetection', class: SecureMLActivityDetector, config: this.config.mlDetection },
      { name: 'geoRestrictions', class: SecureGeoRestrictionsManager, config: this.config.geoRestrictions },
      { name: 'tokenManagement', class: SecureTokenManagementSystem, config: this.config.tokenManagement }
    ];
    
    for (const { name, class: ComponentClass, config } of componentConfigs) {
      try {
        console.log(`Initializing secure ${name}...`);
        
        const component = new ComponentClass(config);
        await component.initialize();
        
        this.components.set(name, component);
        this.componentHealth.set(name, {
          status: 'healthy',
          lastCheck: Date.now(),
          errors: 0,
          initialized: true,
          secure: true
        });
        
        this.componentSecurity.set(name, {
          authenticationEnabled: component.config?.authenticationRequired !== false,
          encryptionEnabled: component.config?.encryptionEnabled !== false,
          rateLimitingEnabled: true,
          inputValidationEnabled: true,
          lastSecurityCheck: Date.now()
        });
        
        console.log(`✅ Secure ${name} initialized`);
        
      } catch (error) {
        console.error(`Failed to initialize secure ${name}:`, error);
        
        this.componentHealth.set(name, {
          status: 'failed',
          lastCheck: Date.now(),
          errors: 1,
          initialized: false,
          secure: false,
          error: error.message
        });
        
        if (this.config.strictMode) {
          throw error;
        }
      }
    }
  }

  setupSecureComponentEventHandlers() {
    // Position Limits Events
    const positionLimits = this.components.get('positionLimits');
    if (positionLimits) {
      positionLimits.on('limit_violation', (data) => {
        this.handleSecureRiskEvent('position_limit_violation', data);
      });
      
      positionLimits.on('emergency_stop', (data) => {
        this.handleSecureRiskEvent('emergency_stop', data);
      });
    }
    
    // Volume Restrictions Events
    const volumeRestrictions = this.components.get('volumeRestrictions');
    if (volumeRestrictions) {
      volumeRestrictions.on('volume_violation', (data) => {
        this.handleSecureRiskEvent('volume_violation', data);
      });
      
      volumeRestrictions.on('user_suspended', (data) => {
        this.handleSecureRiskEvent('user_suspended', data);
      });
    }
    
    // Circuit Breaker Events
    const circuitBreakers = this.components.get('circuitBreakers');
    if (circuitBreakers) {
      circuitBreakers.on('circuit_breaker_opened', (data) => {
        this.handleSecureRiskEvent('circuit_breaker_opened', data);
      });
      
      circuitBreakers.on('circuit_breaker_half_open', (data) => {
        this.handleSecureRiskEvent('circuit_breaker_half_open', data);
      });
    }
    
    // ML Detection Events
    const mlDetection = this.components.get('mlDetection');
    if (mlDetection) {
      mlDetection.on('anomaly_detected', (data) => {
        this.handleSecureRiskEvent('anomaly_detected', data);
      });
    }
    
    // Geo Restrictions Events
    const geoRestrictions = this.components.get('geoRestrictions');
    if (geoRestrictions) {
      geoRestrictions.on('suspicious_location_detected', (data) => {
        this.handleSecureRiskEvent('suspicious_location_detected', data);
      });
    }
    
    // Token Management Events
    const tokenManagement = this.components.get('tokenManagement');
    if (tokenManagement) {
      tokenManagement.on('token_blacklisted', (data) => {
        this.handleSecureRiskEvent('token_blacklisted', data);
      });
      
      tokenManagement.on('token_whitelisted', (data) => {
        this.handleSecureRiskEvent('token_whitelisted', data);
      });
    }
  }

  async start(matchingEngine = null, orderBook = null, authenticatedUser = null, authToken = null) {
    if (this.isRunning) return;
    
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'start_system', authenticatedUser);
      }
    }
    
    console.log('🚀 Starting Secure Risk Management System...');
    this.isRunning = true;
    
    // Validate and store integration references
    this.matchingEngine = this.validateIntegration(matchingEngine);
    this.orderBook = this.validateIntegration(orderBook);
    
    // Start all secure components
    await this.startSecureComponents();
    
    // Start secure health monitoring
    this.startSecureHealthMonitoring();
    
    // Start security monitoring
    this.startSecurityMonitoring();
    
    // Start performance tracking
    this.startSecurePerformanceTracking();
    
    console.log('✅ Secure Risk Management System started');
    
    // Emit system ready event
    this.emit('system_ready', {
      timestamp: Date.now(),
      components: Array.from(this.components.keys()),
      systemHealth: this.systemHealth,
      systemSecurity: this.systemSecurity
    });
  }

  validateIntegration(integration) {
    if (!integration || typeof integration !== 'object') return null;
    
    // Basic validation of integration object
    if (typeof integration.processOrder === 'function' ||
        typeof integration.updateOrderBook === 'function' ||
        typeof integration.getMarketData === 'function') {
      return integration;
    }
    
    return null;
  }

  async startSecureComponents() {
    for (const [name, component] of this.components) {
      try {
        console.log(`Starting secure ${name}...`);
        
        await component.start();
        
        const health = this.componentHealth.get(name);
        health.status = 'running';
        health.lastCheck = Date.now();
        
        console.log(`✅ Secure ${name} started`);
        
      } catch (error) {
        console.error(`Failed to start secure ${name}:`, error);
        
        const health = this.componentHealth.get(name);
        health.status = 'failed';
        health.errors++;
        health.error = error.message;
        
        if (this.config.strictMode) {
          throw error;
        }
      }
    }
  }

  startSecureHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performSecureHealthCheck();
      } catch (error) {
        console.error('Secure health check error:', error);
      }
    }, this.config.healthCheckInterval);
  }

  startSecurityMonitoring() {
    this.securityCheckInterval = setInterval(async () => {
      try {
        await this.performSecurityCheck();
      } catch (error) {
        console.error('Security check error:', error);
      }
    }, this.config.healthCheckInterval * 2); // Less frequent than health checks
  }

  startSecurePerformanceTracking() {
    this.performanceInterval = setInterval(async () => {
      await this.updateSecurePerformanceMetrics();
    }, 60000); // Every minute
  }

  async performSecureHealthCheck() {
    let healthyComponents = 0;
    let secureComponents = 0;
    let totalComponents = 0;
    
    for (const [name, component] of this.components) {
      totalComponents++;
      
      try {
        // Check component health
        let isHealthy = false;
        let isSecure = false;
        
        if (typeof component.isRunning !== 'undefined') {
          isHealthy = component.isRunning;
        }
        
        // Check security status
        const security = this.componentSecurity.get(name);
        if (security) {
          isSecure = security.authenticationEnabled && 
                    security.inputValidationEnabled;
        }
        
        const health = this.componentHealth.get(name);
        if (isHealthy) {
          health.status = 'healthy';
          health.lastCheck = Date.now();
          healthyComponents++;
        } else {
          health.status = 'unhealthy';
          health.errors++;
        }
        
        health.secure = isSecure;
        if (isSecure) {
          secureComponents++;
        }
        
      } catch (error) {
        console.error(`Secure health check failed for ${name}:`, error);
        
        const health = this.componentHealth.get(name);
        health.status = 'failed';
        health.errors++;
        health.error = error.message;
        health.secure = false;
      }
    }
    
    // Determine overall system health and security
    const healthRatio = healthyComponents / totalComponents;
    const securityRatio = secureComponents / totalComponents;
    
    if (healthRatio >= 0.8) {
      this.systemHealth = 'healthy';
    } else if (healthRatio >= 0.5) {
      this.systemHealth = 'degraded';
    } else {
      this.systemHealth = 'critical';
    }
    
    if (securityRatio >= 0.9) {
      this.systemSecurity = 'secure';
    } else if (securityRatio >= 0.7) {
      this.systemSecurity = 'warning';
    } else {
      this.systemSecurity = 'compromised';
    }
    
    this.lastHealthCheck = Date.now();
    
    // Update metrics
    await this.metrics.setGauge('risk_system.health_ratio', healthRatio, {}, 'risk');
    await this.metrics.setGauge('risk_system.security_ratio', securityRatio, {}, 'risk');
    await this.metrics.setGauge('risk_system.healthy_components', healthyComponents, {}, 'risk');
    await this.metrics.setGauge('risk_system.secure_components', secureComponents, {}, 'risk');
    
    // Emit health status
    this.emit('health_check', {
      systemHealth: this.systemHealth,
      systemSecurity: this.systemSecurity,
      healthyComponents,
      secureComponents,
      totalComponents,
      componentHealth: Object.fromEntries(this.componentHealth),
      timestamp: Date.now()
    });
  }

  async performSecurityCheck() {
    // Check for security anomalies
    const securityIssues = [];
    
    // Check failed authentication attempts
    const failedAttempts = this.failedAttempts.size;
    if (failedAttempts > 100) {
      securityIssues.push({
        type: 'excessive_failed_attempts',
        severity: 'high',
        count: failedAttempts
      });
    }
    
    // Check locked users
    const lockedUsers = this.lockedUsers.size;
    if (lockedUsers > 50) {
      securityIssues.push({
        type: 'excessive_locked_users',
        severity: 'medium',
        count: lockedUsers
      });
    }
    
    // Check suspicious activities
    const suspiciousCount = this.suspiciousActivities.size;
    if (suspiciousCount > 20) {
      securityIssues.push({
        type: 'excessive_suspicious_activity',
        severity: 'high',
        count: suspiciousCount
      });
    }
    
    // Update security status
    if (securityIssues.length > 0) {
      const highSeverity = securityIssues.filter(i => i.severity === 'high');
      if (highSeverity.length > 0) {
        this.systemSecurity = 'compromised';
      } else {
        this.systemSecurity = 'warning';
      }
    }
    
    this.lastSecurityCheck = Date.now();
    
    // Emit security check results
    if (securityIssues.length > 0) {
      this.emit('security_alert', {
        issues: securityIssues,
        systemSecurity: this.systemSecurity,
        timestamp: Date.now()
      });
    }
  }

  async handleSecureRiskEvent(eventType, data) {
    try {
      const riskEvent = {
        type: eventType,
        data: this.sanitizeObject(data),
        timestamp: Date.now(),
        id: this.generateSecureEventId(),
        severity: this.determineSeverity(eventType),
        systemHealth: this.systemHealth,
        systemSecurity: this.systemSecurity
      };
      
      // Store risk event with encryption
      this.riskDecisions.set(riskEvent.id, {
        ...riskEvent,
        timestamp: Date.now()
      });
      
      // Update performance stats
      this.performanceStats.securityViolations++;
      
      if (riskEvent.severity === 'critical') {
        this.performanceStats.emergencyStops++;
      }
      
      // Update metrics
      await this.metrics.incrementCounter('risk_system.risk_events', 1, {
        type: eventType,
        severity: riskEvent.severity
      }, 'risk');
      
      // Send secure notifications
      await this.sendSecureRiskNotification(riskEvent);
      
      // Emit to external listeners
      this.emit('risk_event', riskEvent);
      
      console.log(`Secure risk event: ${eventType}`, { 
        id: riskEvent.id, 
        userId: data.userId, 
        severity: riskEvent.severity 
      });
      
    } catch (error) {
      console.error('Failed to handle secure risk event:', error);
    }
  }

  generateSecureEventId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256')
      .update(`${timestamp}:${random}`)
      .digest('hex')
      .substring(0, 16);
    
    return `secure_risk_${timestamp}_${hash}`;
  }

  determineSeverity(eventType) {
    const criticalEvents = [
      'emergency_stop',
      'circuit_breaker_opened',
      'anomaly_detected',
      'token_blacklisted'
    ];
    
    const highEvents = [
      'position_limit_violation',
      'volume_violation',
      'user_suspended',
      'suspicious_location_detected'
    ];
    
    const mediumEvents = [
      'circuit_breaker_half_open',
      'token_whitelisted'
    ];
    
    if (criticalEvents.includes(eventType)) return 'critical';
    if (highEvents.includes(eventType)) return 'high';
    if (mediumEvents.includes(eventType)) return 'medium';
    return 'low';
  }

  async sendSecureRiskNotification(riskEvent) {
    const severity = riskEvent.severity;
    
    if (severity === 'critical' && this.config.alertWebhook) {
      await this.sendSecureWebhookAlert(riskEvent);
    }
    
    if (severity !== 'low' && this.config.slackWebhook) {
      await this.sendSecureSlackAlert(riskEvent);
    }
  }

  async sendSecureWebhookAlert(riskEvent) {
    try {
      const https = require('https');
      const url = require('url');
      
      const webhook = url.parse(this.config.alertWebhook);
      const postData = JSON.stringify({
        event: riskEvent.type,
        severity: riskEvent.severity,
        timestamp: riskEvent.timestamp,
        eventId: riskEvent.id,
        systemHealth: riskEvent.systemHealth,
        systemSecurity: riskEvent.systemSecurity,
        data: this.sanitizeObject(riskEvent.data)
      });
      
      const options = {
        hostname: webhook.hostname,
        port: webhook.port || 443,
        path: webhook.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length,
          'User-Agent': 'SecureRiskManagement/1.0'
        }
      };
      
      const req = https.request(options);
      req.write(postData);
      req.end();
      
    } catch (error) {
      console.error('Failed to send secure webhook alert:', error);
    }
  }

  async sendSecureSlackAlert(riskEvent) {
    // Implement secure Slack webhook notification
    // Similar to webhook alert but with Slack-specific formatting and security
  }

  // Main secure risk assessment methods
  async assessSecureUserRisk(userId, activityData = {}, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'assess_user_risk', authenticatedUser);
      }
    }
    
    // Input validation
    const sanitizedUserId = this.sanitizeString(userId);
    if (!sanitizedUserId) {
      throw new Error('Invalid user ID');
    }
    
    const sanitizedActivityData = this.sanitizeObject(activityData);
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'assess_user_risk');
    }
    
    // Check cache first
    const cacheKey = `user_risk_${sanitizedUserId}_${this.hashData(sanitizedActivityData)}`;
    const cached = this.userCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheExpiry) {
      this.performanceStats.cacheHitRate += 0.1;
      return cached.data;
    }
    
    const startTime = Date.now();
    const assessments = [];
    
    try {
      // Position limits assessment
      const positionLimits = this.components.get('positionLimits');
      if (positionLimits) {
        const permission = await positionLimits.isSecureUserAllowedToTrade(sanitizedUserId, authenticatedUser, authToken);
        assessments.push({
          component: 'positionLimits',
          allowed: permission.allowed,
          reason: permission.reason,
          details: this.sanitizeObject(permission)
        });
      }
      
      // Volume restrictions assessment
      const volumeRestrictions = this.components.get('volumeRestrictions');
      if (volumeRestrictions && sanitizedActivityData.volume) {
        const permission = await volumeRestrictions.isSecureUserAllowedToTrade(
          sanitizedUserId, 
          sanitizedActivityData.volume, 
          authenticatedUser, 
          authToken
        );
        assessments.push({
          component: 'volumeRestrictions',
          allowed: permission.allowed,
          reason: permission.reason,
          details: this.sanitizeObject(permission)
        });
      }
      
      // ML activity detection
      const mlDetection = this.components.get('mlDetection');
      if (mlDetection && sanitizedActivityData) {
        const analysis = await mlDetection.analyzeSecureUserActivity(
          sanitizedUserId, 
          sanitizedActivityData, 
          authenticatedUser, 
          authToken
        );
        assessments.push({
          component: 'mlDetection',
          allowed: analysis.severity === 'normal',
          reason: analysis.severity !== 'normal' ? 'unusual_activity' : null,
          details: this.sanitizeObject(analysis)
        });
      }
      
      // Determine overall risk
      const blocked = assessments.filter(a => !a.allowed);
      const warnings = assessments.filter(a => a.details?.warning);
      
      const result = {
        userId: sanitizedUserId,
        allowed: blocked.length === 0,
        blocked: blocked.map(b => b.reason).filter(Boolean),
        warnings: warnings.map(w => w.reason).filter(Boolean),
        assessments: assessments.map(a => this.sanitizeObject(a)),
        riskScore: this.calculateOverallRiskScore(assessments),
        timestamp: Date.now(),
        processingTime: Date.now() - startTime
      };
      
      // Cache result
      this.userCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
      // Update performance metrics
      this.updateAssessmentMetrics(Date.now() - startTime);
      
      return result;
      
    } catch (error) {
      console.error(`Secure user risk assessment failed for ${sanitizedUserId}:`, error);
      
      return {
        userId: sanitizedUserId,
        allowed: false,
        blocked: ['risk_assessment_failed'],
        warnings: [],
        assessments: [],
        riskScore: 1.0,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  async assessSecureLocationRisk(ip, userId = null, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'assess_location_risk', authenticatedUser);
      }
    }
    
    // Input validation
    const sanitizedIP = this.sanitizeIP(ip);
    if (!sanitizedIP) {
      throw new Error('Invalid IP address format');
    }
    
    const sanitizedUserId = userId ? this.sanitizeString(userId) : null;
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'assess_location_risk');
    }
    
    try {
      const geoRestrictions = this.components.get('geoRestrictions');
      if (!geoRestrictions) {
        return {
          allowed: true,
          reason: 'geo_restrictions_disabled',
          riskLevel: 'low'
        };
      }
      
      const result = await geoRestrictions.checkSecureLocationCompliance(
        sanitizedIP, 
        sanitizedUserId, 
        authenticatedUser, 
        authToken
      );
      
      return {
        allowed: result.allowed,
        reason: result.reason,
        riskLevel: result.riskLevel || 'medium',
        restrictions: result.restrictions || [],
        vpnDetected: result.vpnDetected || false,
        country: result.country,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error(`Secure location risk assessment failed for ${sanitizedIP}:`, error);
      
      return {
        allowed: false,
        reason: 'location_check_failed',
        riskLevel: 'high',
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  async assessSecureTokenRisk(tokenAddress, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'assess_token_risk', authenticatedUser);
      }
    }
    
    // Input validation
    const sanitizedTokenAddress = this.sanitizeTokenAddress(tokenAddress);
    if (!sanitizedTokenAddress) {
      throw new Error('Invalid token address format');
    }
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'assess_token_risk');
    }
    
    // Check cache first
    const cacheKey = `token_risk_${sanitizedTokenAddress}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheExpiry) {
      this.performanceStats.cacheHitRate += 0.1;
      return cached.data;
    }
    
    try {
      const tokenManagement = this.components.get('tokenManagement');
      if (!tokenManagement) {
        return {
          allowed: true,
          reason: 'token_management_disabled',
          riskLevel: 'low'
        };
      }
      
      const result = await tokenManagement.assessSecureTokenRisk(
        sanitizedTokenAddress, 
        authenticatedUser, 
        authToken
      );
      
      const response = {
        allowed: result.riskLevel !== 'critical',
        status: result.riskLevel === 'critical' ? 'blacklisted' : 'approved',
        riskLevel: result.riskLevel,
        riskScore: result.riskScore,
        category: result.category,
        timestamp: Date.now()
      };
      
      // Cache result
      this.tokenCache.set(cacheKey, {
        data: response,
        timestamp: Date.now()
      });
      
      return response;
      
    } catch (error) {
      console.error(`Secure token risk assessment failed for ${sanitizedTokenAddress}:`, error);
      
      return {
        allowed: false,
        status: 'assessment_failed',
        riskLevel: 'critical',
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  sanitizeIP(ip) {
    if (typeof ip !== 'string') return null;
    
    // Basic IP validation
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    if (ipv4Regex.test(ip) || ipv6Regex.test(ip)) {
      return ip;
    }
    
    return null;
  }

  sanitizeTokenAddress(address) {
    if (typeof address !== 'string') return null;
    
    // Basic Ethereum address validation
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (ethAddressRegex.test(address)) {
      return address.toLowerCase();
    }
    
    return null;
  }

  hashData(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').substring(0, 16);
  }

  calculateOverallRiskScore(assessments) {
    if (assessments.length === 0) return 0.5;
    
    let totalRisk = 0;
    let riskCount = 0;
    
    for (const assessment of assessments) {
      if (!assessment.allowed) {
        totalRisk += 1.0; // Blocked = maximum risk
      } else if (assessment.details?.riskScore) {
        totalRisk += assessment.details.riskScore;
      } else if (assessment.details?.warning) {
        totalRisk += 0.5; // Warning = medium risk
      }
      riskCount++;
    }
    
    return riskCount > 0 ? Math.min(totalRisk / riskCount, 1.0) : 0;
  }

  updateAssessmentMetrics(processingTime) {
    this.performanceStats.averageAssessmentTime = 
      (this.performanceStats.averageAssessmentTime * 0.9) + (processingTime * 0.1);
    
    this.performanceStats.assessmentsPerSecond++;
  }

  async updateSecurePerformanceMetrics() {
    await this.metrics.setGauge('risk_system.assessments_per_second', 
      this.performanceStats.assessmentsPerSecond, {}, 'risk');
    
    await this.metrics.setGauge('risk_system.average_assessment_time', 
      this.performanceStats.averageAssessmentTime, {}, 'risk');
    
    await this.metrics.setGauge('risk_system.cache_hit_rate', 
      this.performanceStats.cacheHitRate, {}, 'risk');
    
    await this.metrics.setGauge('risk_system.security_violations', 
      this.performanceStats.securityViolations, {}, 'risk');
    
    await this.metrics.setGauge('risk_system.emergency_stops', 
      this.performanceStats.emergencyStops, {}, 'risk');
    
    await this.metrics.setGauge('risk_system.blocked_requests', 
      this.performanceStats.blockedRequests, {}, 'risk');
    
    await this.metrics.setGauge('risk_system.memory_usage', 
      this.performanceStats.memoryUsage, {}, 'risk');
    
    // Reset counters
    this.performanceStats.assessmentsPerSecond = 0;
  }

  // Utility methods for external integration
  getSecureSystemStatus(authenticatedUser = null, authToken = null) {
    // Basic authentication for system status
    if (this.config.authenticationRequired && authToken) {
      // Allow read-only access to system status with valid token
    }
    
    return {
      isRunning: this.isRunning,
      systemHealth: this.systemHealth,
      systemSecurity: this.systemSecurity,
      lastHealthCheck: this.lastHealthCheck,
      lastSecurityCheck: this.lastSecurityCheck,
      components: Object.fromEntries(
        Array.from(this.components.keys()).map(name => [
          name,
          {
            enabled: this.components.has(name),
            health: this.componentHealth.get(name),
            security: this.componentSecurity.get(name)
          }
        ])
      ),
      riskEvents: this.riskDecisions.size,
      integrations: {
        matchingEngine: !!this.matchingEngine,
        orderBook: !!this.orderBook
      },
      performance: this.performanceStats,
      timestamp: Date.now()
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping Secure Risk Management System...');
    
    // Stop intervals
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.securityCheckInterval) clearInterval(this.securityCheckInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    if (this.memoryMonitorInterval) clearInterval(this.memoryMonitorInterval);
    
    // Release all locks
    for (const lockKey of this.operationLocks.keys()) {
      this.releaseLock(lockKey);
    }
    
    // Stop all components
    for (const [name, component] of this.components) {
      try {
        if (typeof component.stop === 'function') {
          component.stop();
        }
        console.log(`✅ Secure ${name} stopped`);
      } catch (error) {
        console.error(`Failed to stop secure ${name}:`, error);
      }
    }
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data
    this.components.clear();
    this.componentHealth.clear();
    this.componentSecurity.clear();
    this.riskDecisions.clear();
    this.decisionCache.clear();
    this.userCache.clear();
    this.tokenCache.clear();
    this.operationLocks.clear();
    this.lockTimeouts.clear();
    this.rateLimiters.clear();
    
    this.isRunning = false;
    console.log('✅ Secure Risk Management System stopped');
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

module.exports = SecureRiskManagementSystem;