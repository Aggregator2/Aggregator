const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');
const crypto = require('crypto');

class SecureGeoRestrictionsManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Validated geographic restrictions
      blockedCountries: this.validateCountryList(config.blockedCountries || [
        'US', 'CU', 'IR', 'KP', 'SY', 'MM' // OFAC sanctioned countries
      ]),
      
      // Validated restricted countries (limited access)
      restrictedCountries: this.validateCountryList(config.restrictedCountries || [
        'CN', 'RU', 'BY' // Countries with trading restrictions
      ]),
      
      // Sanitized compliance frameworks
      complianceFrameworks: this.validateComplianceFrameworks(config.complianceFrameworks || {
        OFAC: { enabled: true, priority: 'critical' },
        EU_SANCTIONS: { enabled: true, priority: 'high' },
        UN_SANCTIONS: { enabled: true, priority: 'high' },
        FATF_GRAYLIST: { enabled: true, priority: 'medium' }
      }),
      
      // Validated IP geolocation settings
      geoProviders: this.validateGeoProviders(config.geoProviders || []),
      
      // VPN/Proxy detection with validation
      vpnDetection: config.vpnDetection !== false,
      vpnProviders: this.validateVpnProviders(config.vpnProviders || []),
      
      // Performance and caching settings
      ipCacheExpiry: this.validateNumber(config.ipCacheExpiry, 3600000, 300000, 86400000),
      countryCacheExpiry: this.validateNumber(config.countryCacheExpiry, 86400000, 3600000, 86400000 * 7),
      maxCacheSize: this.validateNumber(config.maxCacheSize, 100000, 1000, 1000000),
      
      // Validated KYC requirements
      kycRequiredCountries: this.validateCountryList(config.kycRequiredCountries || [
        'DE', 'FR', 'UK', 'JP', 'AU', 'CA' // Countries requiring KYC
      ]),
      
      // Trading restrictions by country with validation
      tradingLimits: this.validateTradingLimits(config.tradingLimits || {
        'CN': { dailyLimit: 10000, verificationRequired: true },
        'RU': { dailyLimit: 5000, verificationRequired: true },
        'TR': { dailyLimit: 20000, verificationRequired: false }
      }),
      
      // Secure Redis configuration
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'risk:geo:'),
      
      // Performance settings with validation
      timeoutMs: this.validateNumber(config.timeoutMs, 5000, 1000, 30000),
      retryAttempts: this.validateNumber(config.retryAttempts, 3, 1, 10),
      batchSize: this.validateNumber(config.batchSize, 50, 10, 1000),
      
      // Security settings
      authenticationRequired: config.authenticationRequired !== false,
      maxFailedAttempts: this.validateNumber(config.maxFailedAttempts, 5, 1, 100),
      lockoutDuration: this.validateNumber(config.lockoutDuration, 300000, 60000, 3600000),
      
      // Performance optimizations
      enableCompression: config.enableCompression !== false,
      useBatching: config.useBatching !== false,
      maxMemoryUsage: this.validateNumber(config.maxMemoryUsage, 256 * 1024 * 1024, 50 * 1024 * 1024, 1024 * 1024 * 1024),
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Secure caching with size limits
    this.ipLocationCache = new LRU(this.config.maxCacheSize / 4); // IP -> location data
    this.countryDataCache = new LRU(this.config.maxCacheSize / 4); // country -> compliance data
    this.vpnCache = new LRU(this.config.maxCacheSize / 4); // IP -> VPN detection result
    this.lookupCache = new LRU(this.config.maxCacheSize / 4); // General lookup cache
    
    // User location tracking with validation
    this.userLocations = new Map(); // userId -> location history (limited size)
    this.suspiciousLocations = new Map(); // userId -> suspicious location events
    this.locationExpiry = new Map(); // userId -> expiry timestamp
    
    // Compliance data with validation
    this.sanctionLists = new Map(); // country -> sanction details
    this.complianceUpdates = new Map(); // framework -> last update time
    
    // Performance tracking
    this.performanceStats = {
      lookupsPerSecond: 0,
      averageLookupTime: 0,
      cacheHitRate: 0,
      vpnDetectionRate: 0,
      blockedRequests: 0,
      complianceChecks: 0,
      memoryUsage: 0,
      errorRate: 0
    };
    
    // Secure provider management
    this.geoProviders = new Map();
    this.vpnProviders = new Map();
    this.providerHealthStatus = new Map();
    
    // Rate limiting for external APIs and users
    this.apiRateLimiters = new Map();
    this.userRateLimiters = new Map();
    this.defaultUserRateLimit = { requests: 100, window: 60000 }; // 100 requests per minute
    
    // Security tracking
    this.failedAttempts = new Map(); // userId -> attempts count
    this.lockedUsers = new Map(); // userId -> lockout expiry
    this.suspiciousIPs = new Set(); // IPs with suspicious activity
    
    // Authentication and authorization
    this.authorizedUsers = new Set();
    this.permissionMatrix = new Map();
    
    // Atomic operation locks
    this.operationLocks = new Map();
    this.lockTimeouts = new Map();
    
    // Memory management
    this.memoryCheckInterval = 60000; // 1 minute
    this.maxUserLocations = 10000;
    this.maxSuspiciousLocations = 5000;
  }

  // Input validation helpers
  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateCountryList(countries) {
    if (!Array.isArray(countries)) return [];
    
    return countries
      .filter(country => typeof country === 'string')
      .map(country => country.toUpperCase().trim())
      .filter(country => /^[A-Z]{2,3}$/.test(country)) // ISO country codes
      .slice(0, 300); // Limit list size
  }

  validateComplianceFrameworks(frameworks) {
    const validated = {};
    const allowedFrameworks = ['OFAC', 'EU_SANCTIONS', 'UN_SANCTIONS', 'FATF_GRAYLIST', 'UK_SANCTIONS'];
    const allowedPriorities = ['low', 'medium', 'high', 'critical'];
    
    for (const [framework, config] of Object.entries(frameworks)) {
      if (allowedFrameworks.includes(framework) && 
          typeof config === 'object' && config !== null) {
        validated[framework] = {
          enabled: config.enabled === true,
          priority: allowedPriorities.includes(config.priority) ? config.priority : 'medium'
        };
      }
    }
    
    return validated;
  }

  validateGeoProviders(providers) {
    if (!Array.isArray(providers)) return [];
    
    const allowedProviders = ['maxmind', 'ipapi', 'ipgeolocation', 'ipinfo', 'geojs'];
    
    return providers
      .filter(provider => typeof provider === 'object' && provider !== null)
      .filter(provider => allowedProviders.includes(provider.name))
      .map(provider => ({
        name: this.sanitizeString(provider.name),
        priority: this.validateNumber(provider.priority, 1, 1, 10),
        apiKey: this.sanitizeApiKey(provider.apiKey),
        enabled: provider.enabled !== false
      }))
      .slice(0, 5); // Limit to 5 providers
  }

  validateVpnProviders(providers) {
    if (!Array.isArray(providers)) return [];
    
    const allowedProviders = ['iphub', 'vpnapi', 'proxycheck', 'getipintel'];
    
    return providers
      .filter(provider => typeof provider === 'object' && provider !== null)
      .filter(provider => allowedProviders.includes(provider.name))
      .map(provider => ({
        name: this.sanitizeString(provider.name),
        apiKey: this.sanitizeApiKey(provider.apiKey),
        enabled: provider.enabled !== false
      }))
      .slice(0, 3); // Limit to 3 providers
  }

  validateTradingLimits(limits) {
    const validated = {};
    
    for (const [country, config] of Object.entries(limits)) {
      const countryCode = country.toUpperCase().trim();
      if (/^[A-Z]{2,3}$/.test(countryCode) && typeof config === 'object' && config !== null) {
        validated[countryCode] = {
          dailyLimit: this.validateNumber(config.dailyLimit, 10000, 0, 1e12),
          verificationRequired: config.verificationRequired === true
        };
      }
    }
    
    return validated;
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100);
  }

  sanitizeApiKey(key) {
    if (typeof key !== 'string') return '';
    return key.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 200);
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
    if (typeof prefix !== 'string') return 'risk:geo:';
    return prefix.replace(/[^a-zA-Z0-9:_-]/g, '').substring(0, 50) + ':';
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
      await this.metrics.incrementCounter('geo_restrictions.auth_failures', 1, {}, 'risk');
      throw new Error('Authentication failed');
    }
  }

  async authorize(userId, operation, authenticatedUser) {
    const permissions = this.permissionMatrix.get(userId) || [];
    const requiredPermission = `geo_restrictions.${operation}`;
    
    if (!permissions.includes(requiredPermission) && !permissions.includes('geo_restrictions.*')) {
      throw new Error(`Insufficient permissions for operation: ${operation}`);
    }
    
    return true;
  }

  async verifyAuthToken(token) {
    // Implement JWT verification or API key validation
    return token.length > 10; // Simplified for example
  }

  // Rate limiting
  async checkUserRateLimit(userId, operation = 'default') {
    const key = `${userId}:${operation}`;
    const limiter = this.userRateLimiters.get(key) || { ...this.defaultUserRateLimit, count: 0, window: Date.now() };
    
    const now = Date.now();
    if (now - limiter.window >= limiter.window) {
      limiter.count = 0;
      limiter.window = now;
    }
    
    if (limiter.count >= limiter.requests) {
      throw new Error('Rate limit exceeded');
    }
    
    limiter.count++;
    this.userRateLimiters.set(key, limiter);
    return true;
  }

  async checkApiRateLimit(provider, endpoint = 'default') {
    const key = `${provider}:${endpoint}`;
    const limiter = this.apiRateLimiters.get(key) || { requests: 1000, window: 3600000, count: 0, windowStart: Date.now() };
    
    const now = Date.now();
    if (now - limiter.windowStart >= limiter.window) {
      limiter.count = 0;
      limiter.windowStart = now;
    }
    
    if (limiter.count >= limiter.requests) {
      throw new Error(`API rate limit exceeded for provider: ${provider}`);
    }
    
    limiter.count++;
    this.apiRateLimiters.set(key, limiter);
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
    
    // Clean location cache
    this.cleanCacheByAge(this.ipLocationCache, this.config.ipCacheExpiry);
    this.cleanCacheByAge(this.countryDataCache, this.config.countryCacheExpiry);
    this.cleanCacheByAge(this.vpnCache, this.config.ipCacheExpiry);
    
    // Limit map sizes
    this.limitMapSize(this.userLocations, this.maxUserLocations);
    this.limitMapSize(this.suspiciousLocations, this.maxSuspiciousLocations);
    this.limitMapSize(this.userRateLimiters, 10000);
    this.limitMapSize(this.failedAttempts, 1000);
    
    // Clean expired location data
    this.cleanExpiredLocations();
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

  cleanExpiredLocations() {
    const now = Date.now();
    for (const [userId, expiry] of this.locationExpiry.entries()) {
      if (now > expiry) {
        this.userLocations.delete(userId);
        this.locationExpiry.delete(userId);
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
      
      // Initialize providers securely
      await this.initializeSecureProviders();
      
      // Load compliance data
      await this.loadComplianceData();
      
      // Start memory monitoring
      this.memoryMonitorInterval = setInterval(() => {
        this.checkMemoryUsage();
      }, this.memoryCheckInterval);
      
      console.log('✅ Secure geo restrictions manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize secure geo restrictions manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('⚡ Starting secure geo restrictions manager...');
    this.isRunning = true;
    
    // Start secure monitoring
    this.startSecureMonitoring();
    
    // Start compliance updates
    this.startComplianceUpdates();
    
    // Start performance tracking
    this.startSecurePerformanceTracking();
    
    console.log('✅ Secure geo restrictions manager started');
  }

  startSecureMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.updateProviderHealth();
        await this.cleanupExpiredData();
        await this.updateSecurityMetrics();
      } catch (error) {
        console.error('Secure geo monitoring error:', error);
        await this.metrics.incrementCounter('geo_restrictions.monitoring_errors', 1, {}, 'risk');
      }
    }, 30000); // Every 30 seconds
  }

  startComplianceUpdates() {
    this.complianceInterval = setInterval(async () => {
      try {
        await this.updateComplianceData();
      } catch (error) {
        console.error('Compliance update error:', error);
      }
    }, 3600000); // Every hour
  }

  startSecurePerformanceTracking() {
    this.performanceInterval = setInterval(async () => {
      await this.updateSecurePerformanceMetrics();
    }, 60000); // Every minute
  }

  async checkSecureLocationCompliance(ip, userId = null, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (userId && authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'check_location', authenticatedUser);
      }
    }
    
    // Input validation
    const sanitizedIP = this.sanitizeIP(ip);
    if (!sanitizedIP) {
      throw new Error('Invalid IP address format');
    }
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkUserRateLimit(authenticatedUser.id, 'location_check');
    }
    
    // Check for suspicious IP
    if (this.suspiciousIPs.has(sanitizedIP)) {
      await this.metrics.incrementCounter('geo_restrictions.suspicious_ip_blocked', 1, {}, 'risk');
      return {
        allowed: false,
        reason: 'suspicious_ip',
        riskLevel: 'high',
        timestamp: Date.now()
      };
    }
    
    const startTime = Date.now();
    
    try {
      // Acquire lock for atomic operation
      const lockId = await this.acquireLock(`location_check_${sanitizedIP}`);
      
      try {
        // Get location data with caching
        const locationData = await this.getSecureLocationData(sanitizedIP);
        
        // Perform compliance checks
        const complianceResult = await this.performComplianceChecks(locationData, sanitizedIP);
        
        // Check VPN/Proxy if enabled
        if (this.config.vpnDetection) {
          const vpnResult = await this.checkVPNStatus(sanitizedIP);
          complianceResult.vpnDetected = vpnResult.isVPN;
          complianceResult.vpnRisk = vpnResult.riskLevel;
        }
        
        // Store user location if provided
        if (userId) {
          await this.storeSecureUserLocation(userId, locationData, complianceResult);
        }
        
        // Update performance metrics
        const processingTime = Date.now() - startTime;
        this.updateLocationCheckMetrics(processingTime, complianceResult.allowed);
        
        return {
          ...complianceResult,
          ip: sanitizedIP,
          timestamp: Date.now(),
          processingTime
        };
        
      } finally {
        await this.releaseLock(`location_check_${sanitizedIP}`);
      }
      
    } catch (error) {
      console.error('Location compliance check error:', error);
      await this.metrics.incrementCounter('geo_restrictions.check_errors', 1, {}, 'risk');
      
      // Return conservative result on error
      return {
        allowed: false,
        reason: 'system_error',
        riskLevel: 'high',
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  async getSecureLocationData(ip) {
    // Check cache first
    const cached = this.ipLocationCache.get(ip);
    if (cached && Date.now() - cached.timestamp < this.config.ipCacheExpiry) {
      this.performanceStats.cacheHitRate += 0.1;
      return cached.data;
    }
    
    // Try providers in priority order
    const providers = this.config.geoProviders
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    for (const provider of providers) {
      try {
        // Check provider health
        if (!this.isProviderHealthy(provider.name)) {
          continue;
        }
        
        // Check API rate limit
        await this.checkApiRateLimit(provider.name, 'location');
        
        // Get location data from provider
        const locationData = await this.queryLocationProvider(provider, ip);
        
        if (locationData && locationData.country) {
          // Validate and sanitize location data
          const validatedData = this.validateLocationData(locationData);
          
          // Cache result
          this.ipLocationCache.set(ip, {
            data: validatedData,
            timestamp: Date.now(),
            provider: provider.name
          });
          
          return validatedData;
        }
        
      } catch (error) {
        console.error(`Location provider ${provider.name} error:`, error);
        this.markProviderUnhealthy(provider.name);
        continue;
      }
    }
    
    // Fallback to default if all providers fail
    return {
      country: 'UNKNOWN',
      region: 'UNKNOWN',
      city: 'UNKNOWN',
      confidence: 0,
      provider: 'fallback'
    };
  }

  async queryLocationProvider(provider, ip) {
    // Simplified provider implementation
    // In real implementation, this would make actual API calls to geo providers
    
    switch (provider.name) {
      case 'maxmind':
        return await this.queryMaxMind(provider.apiKey, ip);
      case 'ipapi':
        return await this.queryIPAPI(provider.apiKey, ip);
      case 'ipgeolocation':
        return await this.queryIPGeolocation(provider.apiKey, ip);
      default:
        throw new Error(`Unknown provider: ${provider.name}`);
    }
  }

  async queryMaxMind(apiKey, ip) {
    // Simplified MaxMind implementation
    return {
      country: 'US',
      region: 'CA',
      city: 'San Francisco',
      confidence: 0.95,
      provider: 'maxmind'
    };
  }

  async queryIPAPI(apiKey, ip) {
    // Simplified IP-API implementation
    return {
      country: 'US',
      region: 'CA',
      city: 'San Francisco',
      confidence: 0.90,
      provider: 'ipapi'
    };
  }

  async queryIPGeolocation(apiKey, ip) {
    // Simplified IPGeolocation implementation
    return {
      country: 'US',
      region: 'CA',
      city: 'San Francisco',
      confidence: 0.85,
      provider: 'ipgeolocation'
    };
  }

  validateLocationData(data) {
    return {
      country: this.sanitizeString(data.country || 'UNKNOWN').toUpperCase(),
      region: this.sanitizeString(data.region || 'UNKNOWN'),
      city: this.sanitizeString(data.city || 'UNKNOWN'),
      confidence: this.validateNumber(data.confidence, 0.5, 0, 1),
      provider: this.sanitizeString(data.provider || 'unknown')
    };
  }

  async performComplianceChecks(locationData, ip) {
    const country = locationData.country;
    const result = {
      allowed: true,
      reason: null,
      riskLevel: 'low',
      country,
      restrictions: [],
      sanctions: []
    };
    
    // Check blocked countries
    if (this.config.blockedCountries.includes(country)) {
      result.allowed = false;
      result.reason = 'blocked_country';
      result.riskLevel = 'critical';
      result.restrictions.push(`Country ${country} is blocked`);
    }
    
    // Check restricted countries
    if (this.config.restrictedCountries.includes(country)) {
      result.restrictions.push(`Country ${country} has trading restrictions`);
      result.riskLevel = 'medium';
      
      // Apply trading limits
      const limits = this.config.tradingLimits[country];
      if (limits) {
        result.tradingLimits = limits;
        if (limits.verificationRequired) {
          result.verificationRequired = true;
        }
      }
    }
    
    // Check compliance frameworks
    const sanctions = await this.checkSanctions(country);
    if (sanctions.length > 0) {
      result.sanctions = sanctions;
      result.riskLevel = 'high';
      
      // Check if any critical sanctions apply
      const criticalSanctions = sanctions.filter(s => s.priority === 'critical');
      if (criticalSanctions.length > 0) {
        result.allowed = false;
        result.reason = 'sanctions_violation';
        result.riskLevel = 'critical';
      }
    }
    
    // Check KYC requirements
    if (this.config.kycRequiredCountries.includes(country)) {
      result.kycRequired = true;
    }
    
    await this.metrics.incrementCounter('geo_restrictions.compliance_checks', 1, {
      country,
      allowed: result.allowed,
      riskLevel: result.riskLevel
    }, 'risk');
    
    return result;
  }

  async checkSanctions(country) {
    const sanctions = [];
    
    for (const [framework, config] of Object.entries(this.config.complianceFrameworks)) {
      if (!config.enabled) continue;
      
      const sanctionData = this.sanctionLists.get(`${framework}:${country}`);
      if (sanctionData) {
        sanctions.push({
          framework,
          priority: config.priority,
          details: sanctionData,
          timestamp: Date.now()
        });
      }
    }
    
    return sanctions;
  }

  async checkVPNStatus(ip) {
    // Check cache first
    const cached = this.vpnCache.get(ip);
    if (cached && Date.now() - cached.timestamp < this.config.ipCacheExpiry) {
      return cached.data;
    }
    
    // Try VPN providers
    const providers = this.config.vpnProviders.filter(p => p.enabled);
    
    for (const provider of providers) {
      try {
        // Check provider health
        if (!this.isProviderHealthy(provider.name)) {
          continue;
        }
        
        // Check API rate limit
        await this.checkApiRateLimit(provider.name, 'vpn');
        
        // Query VPN provider
        const vpnResult = await this.queryVPNProvider(provider, ip);
        
        if (vpnResult) {
          // Cache result
          this.vpnCache.set(ip, {
            data: vpnResult,
            timestamp: Date.now(),
            provider: provider.name
          });
          
          this.performanceStats.vpnDetectionRate += vpnResult.isVPN ? 1 : 0;
          
          return vpnResult;
        }
        
      } catch (error) {
        console.error(`VPN provider ${provider.name} error:`, error);
        this.markProviderUnhealthy(provider.name);
        continue;
      }
    }
    
    // Default result if all providers fail
    return {
      isVPN: false,
      riskLevel: 'unknown',
      confidence: 0,
      provider: 'fallback'
    };
  }

  async queryVPNProvider(provider, ip) {
    // Simplified VPN provider implementation
    switch (provider.name) {
      case 'iphub':
        return { isVPN: false, riskLevel: 'low', confidence: 0.9, provider: 'iphub' };
      case 'vpnapi':
        return { isVPN: false, riskLevel: 'low', confidence: 0.85, provider: 'vpnapi' };
      default:
        throw new Error(`Unknown VPN provider: ${provider.name}`);
    }
  }

  async storeSecureUserLocation(userId, locationData, complianceResult) {
    const sanitizedUserId = this.sanitizeString(userId);
    if (!sanitizedUserId) return;
    
    const locationRecord = {
      ...locationData,
      compliance: complianceResult,
      timestamp: Date.now()
    };
    
    // Get or create user location history
    const userHistory = this.userLocations.get(sanitizedUserId) || [];
    userHistory.push(locationRecord);
    
    // Limit history size
    if (userHistory.length > 100) {
      userHistory.shift(); // Remove oldest
    }
    
    this.userLocations.set(sanitizedUserId, userHistory);
    
    // Set expiry
    this.locationExpiry.set(sanitizedUserId, Date.now() + this.config.countryCacheExpiry);
    
    // Check for suspicious location changes
    await this.checkSuspiciousLocationChange(sanitizedUserId, locationRecord, userHistory);
    
    // Save to Redis with encryption
    await this.saveEncryptedUserLocation(sanitizedUserId, locationRecord);
  }

  async checkSuspiciousLocationChange(userId, newLocation, history) {
    if (history.length < 2) return;
    
    const previousLocation = history[history.length - 2];
    const timeDiff = newLocation.timestamp - previousLocation.timestamp;
    
    // Check for rapid location changes (less than 1 hour between different countries)
    if (timeDiff < 3600000 && // Less than 1 hour
        newLocation.country !== previousLocation.country &&
        newLocation.country !== 'UNKNOWN' && 
        previousLocation.country !== 'UNKNOWN') {
      
      const suspiciousEvent = {
        userId,
        type: 'rapid_location_change',
        previousLocation: previousLocation.country,
        newLocation: newLocation.country,
        timeDiff,
        timestamp: Date.now(),
        riskLevel: 'high'
      };
      
      this.suspiciousLocations.set(userId, suspiciousEvent);
      
      this.emit('suspicious_location_detected', suspiciousEvent);
      
      await this.metrics.incrementCounter('geo_restrictions.suspicious_locations', 1, {
        type: 'rapid_change'
      }, 'risk');
      
      console.warn(`Suspicious location change detected for user ${userId}: ${previousLocation.country} -> ${newLocation.country} in ${timeDiff}ms`);
    }
  }

  isProviderHealthy(providerName) {
    const status = this.providerHealthStatus.get(providerName);
    if (!status) return true; // Assume healthy if no status
    
    const now = Date.now();
    return status.healthy && (now - status.lastCheck < 300000); // 5 minute health window
  }

  markProviderUnhealthy(providerName) {
    this.providerHealthStatus.set(providerName, {
      healthy: false,
      lastCheck: Date.now(),
      errorCount: (this.providerHealthStatus.get(providerName)?.errorCount || 0) + 1
    });
  }

  updateLocationCheckMetrics(processingTime, allowed) {
    this.performanceStats.averageLookupTime = 
      (this.performanceStats.averageLookupTime * 0.9) + (processingTime * 0.1);
    
    if (!allowed) {
      this.performanceStats.blockedRequests++;
    }
    
    this.performanceStats.complianceChecks++;
  }

  async updateSecurityMetrics() {
    await this.metrics.setGauge('geo_restrictions.security.failed_attempts', 
      this.failedAttempts.size, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.security.locked_users', 
      this.lockedUsers.size, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.security.suspicious_ips', 
      this.suspiciousIPs.size, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.performance.memory_usage', 
      this.performanceStats.memoryUsage, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.performance.cache_hit_rate', 
      this.performanceStats.cacheHitRate, {}, 'risk');
  }

  async updateSecurePerformanceMetrics() {
    await this.updateSecurityMetrics();
    
    await this.metrics.setGauge('geo_restrictions.lookups_per_second', 
      this.performanceStats.lookupsPerSecond, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.average_lookup_time', 
      this.performanceStats.averageLookupTime, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.blocked_requests', 
      this.performanceStats.blockedRequests, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.vpn_detection_rate', 
      this.performanceStats.vpnDetectionRate, {}, 'risk');
  }

  // Continue with remaining methods following the same patterns...
  // [Additional methods would follow the same security, validation, and performance patterns]

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping secure geo restrictions manager...');
    
    // Stop intervals
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.complianceInterval) clearInterval(this.complianceInterval);
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
    this.ipLocationCache.clear();
    this.countryDataCache.clear();
    this.vpnCache.clear();
    this.userLocations.clear();
    this.suspiciousLocations.clear();
    this.operationLocks.clear();
    this.lockTimeouts.clear();
    this.userRateLimiters.clear();
    this.apiRateLimiters.clear();
    
    this.isRunning = false;
    console.log('✅ Secure geo restrictions manager stopped');
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

module.exports = SecureGeoRestrictionsManager;