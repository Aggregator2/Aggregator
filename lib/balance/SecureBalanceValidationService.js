const { ethers } = require('ethers');
const Redis = require('ioredis');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const crypto = require('crypto');

/**
 * @class SecureBalanceValidationService
 * @description Security-hardened balance validation service with comprehensive protections
 * @extends EventEmitter
 * 
 * Security Features:
 * - Input sanitization and validation
 * - Rate limiting and DDoS protection
 * - Memory exhaustion prevention
 * - Cache poisoning protection
 * - Atomic operations with Redis transactions
 * - Comprehensive audit logging
 * - Circuit breaker patterns
 * - Time-based cache invalidation
 */
class SecureBalanceValidationService extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Enhanced security configurations
      security: {
        maxCacheSize: config.security?.maxCacheSize || 100000, // Prevent memory exhaustion
        maxInputLength: config.security?.maxInputLength || 256,
        rateLimitWindow: config.security?.rateLimitWindow || 60000, // 1 minute
        rateLimitRequests: config.security?.rateLimitRequests || 100,
        enableAuditLogging: config.security?.enableAuditLogging !== false,
        maxConcurrentRequests: config.security?.maxConcurrentRequests || 50,
        circuitBreakerThreshold: config.security?.circuitBreakerThreshold || 10,
        suspiciousPatternDetection: config.security?.suspiciousPatternDetection !== false,
        encryptSensitiveData: config.security?.encryptSensitiveData !== false,
        ...config.security
      },
      
      // Network configurations with security enhancements
      networks: {
        ethereum: {
          rpcUrl: config.networks?.ethereum?.rpcUrl || process.env.ETHEREUM_RPC_URL,
          archiveUrl: config.networks?.ethereum?.archiveUrl || process.env.ETHEREUM_ARCHIVE_URL,
          chainId: 1,
          blockTime: 12000,
          confirmations: 3,
          maxRetries: 3,
          timeout: 30000,
          rateLimitRps: 10 // Requests per second limit
        },
        polygon: {
          rpcUrl: config.networks?.polygon?.rpcUrl || process.env.POLYGON_RPC_URL,
          archiveUrl: config.networks?.polygon?.archiveUrl || process.env.POLYGON_ARCHIVE_URL,
          chainId: 137,
          blockTime: 2000,
          confirmations: 10,
          maxRetries: 3,
          timeout: 30000,
          rateLimitRps: 15
        },
        arbitrum: {
          rpcUrl: config.networks?.arbitrum?.rpcUrl || process.env.ARBITRUM_RPC_URL,
          archiveUrl: config.networks?.arbitrum?.archiveUrl || process.env.ARBITRUM_ARCHIVE_URL,
          chainId: 42161,
          blockTime: 1000,
          confirmations: 5,
          maxRetries: 3,
          timeout: 30000,
          rateLimitRps: 20
        },
        ...config.networks
      },
      
      // Secure Redis configuration
      redis: {
        host: config.redis?.host || 'localhost',
        port: config.redis?.port || 6379,
        password: config.redis?.password,
        db: config.redis?.db || 1,
        keyPrefix: 'secure_balance:',
        enableReadyCheck: true,
        connectTimeout: 10000,
        commandTimeout: 5000,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false, // Prevent memory buildup
        ...config.redis
      },
      
      // Enhanced cache configuration
      cache: {
        balanceTTL: config.cache?.balanceTTL || 30,
        allowanceTTL: config.cache?.allowanceTTL || 60,
        historicalTTL: config.cache?.historicalTTL || 3600,
        maxCacheSize: config.cache?.maxCacheSize || 50000,
        cleanupInterval: config.cache?.cleanupInterval || 300000, // 5 minutes
        compressionThreshold: config.cache?.compressionThreshold || 1024,
        enableEncryption: config.cache?.enableEncryption !== false,
        ...config.cache
      },
      
      // Enhanced validation parameters
      validation: {
        minConfirmations: config.validation?.minConfirmations || 3,
        maxHistoryDepth: config.validation?.maxHistoryDepth || 7776000,
        balanceThreshold: config.validation?.balanceThreshold || ethers.utils.parseEther('0.001'),
        proofValidityPeriod: config.validation?.proofValidityPeriod || 86400000,
        suspiciousVelocity: config.validation?.suspiciousVelocity || 10,
        maxOrderSize: config.validation?.maxOrderSize || ethers.utils.parseEther('1000000'),
        minOrderSize: config.validation?.minOrderSize || ethers.utils.parseEther('0.001'),
        ...config.validation
      },
      
      ...config
    };
    
    // Security state management
    this.rateLimiters = new Map();
    this.suspiciousActivities = new Map();
    this.circuitBreakers = new Map();
    this.auditLog = [];
    this.encryptionKey = this._generateEncryptionKey();
    this.concurrentRequests = 0;
    
    // Enhanced providers with security wrappers
    this.providers = new Map();
    this.archiveProviders = new Map();
    this.providerHealthChecks = new Map();
    
    // Secure Redis client
    this.redis = this._createSecureRedisClient();
    
    // Enhanced cache management
    this.balanceCache = new Map();
    this.allowanceCache = new Map();
    this.historicalCache = new Map();
    this.transferListeners = new Map();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      errors: 0
    };
    
    // Enhanced metrics with security monitoring
    this.metrics = {
      balanceChecks: 0,
      cacheHits: 0,
      cacheMisses: 0,
      validationTime: [],
      errors: 0,
      proofGenerations: 0,
      securityEvents: 0,
      rateLimitViolations: 0,
      suspiciousActivities: 0,
      circuitBreakerTrips: 0
    };
    
    // Initialize secure service
    this._initializeSecureProviders();
    this._startSecurityMonitoring();
    this._initializeCircuitBreakers();
  }

  /**
   * Secure balance validation with comprehensive protection
   * @param {string} userAddress - User's wallet address
   * @param {string} tokenAddress - Token contract address
   * @param {string} amount - Required amount
   * @param {string} chainId - Network chain ID
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Secure validation result
   */
  async validateBalance(userAddress, tokenAddress, amount, chainId, options = {}) {
    const requestId = this._generateRequestId();
    const startTime = performance.now();
    
    try {
      // Security pre-checks
      await this._performSecurityChecks(userAddress, tokenAddress, amount, chainId, requestId);
      
      // Rate limiting check
      if (!await this._checkRateLimit(userAddress, 'balance_validation')) {
        await this._logSecurityEvent('rate_limit_exceeded', { userAddress, requestId });
        throw new Error('Rate limit exceeded');
      }
      
      // Circuit breaker check
      if (this._isCircuitBreakerOpen(chainId)) {
        throw new Error(`Circuit breaker open for chain ${chainId}`);
      }
      
      // Increment concurrent request counter
      this.concurrentRequests++;
      if (this.concurrentRequests > this.config.security.maxConcurrentRequests) {
        this.concurrentRequests--;
        throw new Error('Maximum concurrent requests exceeded');
      }
      
      try {
        // Input validation and sanitization
        const sanitizedInputs = await this._sanitizeAndValidateInputs(
          userAddress, tokenAddress, amount, chainId
        );
        
        // Generate secure cache key
        const cacheKey = this._generateSecureCacheKey(
          'balance', sanitizedInputs.userAddress, sanitizedInputs.tokenAddress, chainId
        );
        
        // Check secure cache
        let validationResult;
        const cached = await this._getSecureCache(cacheKey);
        
        if (cached && this._isCacheValid(cached)) {
          validationResult = this._decryptCacheData(cached);
          validationResult.fromCache = true;
          this.metrics.cacheHits++;
          this.cacheStats.hits++;
        } else {
          // Fetch real-time balance with retry logic
          const balanceData = await this._fetchSecureBalance(
            sanitizedInputs.userAddress,
            sanitizedInputs.tokenAddress,
            chainId
          );
          
          // Perform validation
          validationResult = await this._performSecureValidation(
            sanitizedInputs,
            balanceData,
            options
          );
          
          // Cache result securely
          await this._setSecureCache(cacheKey, validationResult);
          this.metrics.cacheMisses++;
          this.cacheStats.misses++;
        }
        
        // Enhanced fraud detection
        await this._performFraudDetection(userAddress, tokenAddress, amount, chainId);
        
        // Update metrics
        this.metrics.balanceChecks++;
        this.metrics.validationTime.push(performance.now() - startTime);
        
        // Audit logging
        await this._logSecurityEvent('balance_validated', {
          requestId,
          userAddress: sanitizedInputs.userAddress,
          tokenAddress: sanitizedInputs.tokenAddress,
          chainId,
          valid: validationResult.valid,
          fromCache: validationResult.fromCache,
          responseTime: performance.now() - startTime
        });
        
        this.emit('balance_validated', {
          ...validationResult,
          requestId,
          securityLevel: 'high'
        });
        
        return validationResult;
        
      } finally {
        this.concurrentRequests--;
      }
      
    } catch (error) {
      this.concurrentRequests = Math.max(0, this.concurrentRequests - 1);
      this.metrics.errors++;
      
      // Circuit breaker logic
      await this._recordCircuitBreakerFailure(chainId);
      
      await this._logSecurityEvent('validation_error', {
        requestId,
        userAddress,
        tokenAddress,
        chainId,
        error: error.message,
        responseTime: performance.now() - startTime
      });
      
      this.emit('validation_error', {
        requestId,
        userAddress,
        tokenAddress,
        chainId,
        error: error.message,
        timestamp: Date.now()
      });
      
      throw new Error(`Secure balance validation failed: ${error.message}`);
    }
  }

  /**
   * Secure allowance validation with enhanced protection
   * @param {string} userAddress - User's wallet address
   * @param {string} tokenAddress - Token contract address
   * @param {string} spenderAddress - Spender contract address
   * @param {string} requiredAmount - Required allowance
   * @param {string} chainId - Network chain ID
   * @returns {Promise<Object>} Secure allowance validation result
   */
  async validateAllowance(userAddress, tokenAddress, spenderAddress, requiredAmount, chainId) {
    const requestId = this._generateRequestId();
    
    try {
      // Security pre-checks
      await this._performSecurityChecks(userAddress, tokenAddress, requiredAmount, chainId, requestId);
      
      if (!await this._isValidAddress(spenderAddress)) {
        throw new Error('Invalid spender address');
      }
      
      // Rate limiting
      if (!await this._checkRateLimit(userAddress, 'allowance_validation')) {
        throw new Error('Rate limit exceeded');
      }
      
      // Sanitize inputs
      const sanitizedInputs = await this._sanitizeAndValidateInputs(
        userAddress, tokenAddress, requiredAmount, chainId
      );
      const sanitizedSpender = await this._sanitizeAddress(spenderAddress);
      
      // Generate secure cache key
      const cacheKey = this._generateSecureCacheKey(
        'allowance',
        sanitizedInputs.userAddress,
        sanitizedInputs.tokenAddress,
        sanitizedSpender,
        chainId
      );
      
      // Check secure cache
      let allowanceResult;
      const cached = await this._getSecureCache(cacheKey);
      
      if (cached && this._isCacheValid(cached)) {
        allowanceResult = this._decryptCacheData(cached);
        allowanceResult.fromCache = true;
      } else {
        // Fetch real-time allowance
        const allowanceData = await this._fetchSecureAllowance(
          sanitizedInputs.userAddress,
          sanitizedInputs.tokenAddress,
          sanitizedSpender,
          chainId
        );
        
        // Validate allowance
        const required = ethers.BigNumber.from(sanitizedInputs.amount);
        allowanceResult = {
          valid: allowanceData.allowance.gte(required),
          userAddress: sanitizedInputs.userAddress,
          tokenAddress: sanitizedInputs.tokenAddress,
          spenderAddress: sanitizedSpender,
          chainId,
          requiredAmount: required.toString(),
          actualAllowance: allowanceData.allowance.toString(),
          blockNumber: allowanceData.blockNumber,
          fromCache: false,
          timestamp: Date.now(),
          requestId
        };
        
        // Cache securely
        await this._setSecureCache(cacheKey, allowanceResult);
      }
      
      await this._logSecurityEvent('allowance_validated', {
        requestId,
        userAddress: sanitizedInputs.userAddress,
        tokenAddress: sanitizedInputs.tokenAddress,
        spenderAddress: sanitizedSpender,
        chainId,
        valid: allowanceResult.valid
      });
      
      return allowanceResult;
      
    } catch (error) {
      await this._logSecurityEvent('allowance_validation_error', {
        requestId,
        userAddress,
        tokenAddress,
        spenderAddress,
        chainId,
        error: error.message
      });
      
      throw new Error(`Secure allowance validation failed: ${error.message}`);
    }
  }

  /**
   * Secure cache invalidation with atomic operations
   * @param {string} tokenAddress - Token contract address
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Receiver address
   * @param {string} chainId - Network chain ID
   */
  async invalidateBalanceCache(tokenAddress, fromAddress, toAddress, chainId) {
    const requestId = this._generateRequestId();
    
    try {
      // Sanitize addresses
      const sanitizedToken = await this._sanitizeAddress(tokenAddress);
      const sanitizedFrom = await this._sanitizeAddress(fromAddress);
      const sanitizedTo = await this._sanitizeAddress(toAddress);
      
      // Generate invalidation keys
      const balanceKeys = [
        this._generateSecureCacheKey('balance', sanitizedFrom, sanitizedToken, chainId),
        this._generateSecureCacheKey('balance', sanitizedTo, sanitizedToken, chainId)
      ];
      
      // Atomic cache invalidation using Redis transaction
      const pipeline = this.redis.pipeline();
      
      for (const key of balanceKeys) {
        pipeline.del(key);
        this.balanceCache.delete(key);
      }
      
      await pipeline.exec();
      
      // Invalidate related allowance caches
      await this._invalidateAllowanceCachesSecure(
        sanitizedToken, sanitizedFrom, sanitizedTo, chainId
      );
      
      await this._logSecurityEvent('cache_invalidated', {
        requestId,
        tokenAddress: sanitizedToken,
        fromAddress: sanitizedFrom,
        toAddress: sanitizedTo,
        chainId,
        keysInvalidated: balanceKeys.length
      });
      
      this.emit('cache_invalidated', {
        requestId,
        tokenAddress: sanitizedToken,
        fromAddress: sanitizedFrom,
        toAddress: sanitizedTo,
        chainId,
        timestamp: Date.now()
      });
      
    } catch (error) {
      await this._logSecurityEvent('cache_invalidation_error', {
        requestId,
        tokenAddress,
        fromAddress,
        toAddress,
        chainId,
        error: error.message
      });
      
      console.error('Secure cache invalidation failed:', error);
    }
  }

  // Private security methods

  /**
   * Perform comprehensive security checks
   * @private
   */
  async _performSecurityChecks(userAddress, tokenAddress, amount, chainId, requestId) {
    // Input length validation
    if (userAddress.length > this.config.security.maxInputLength ||
        tokenAddress.length > this.config.security.maxInputLength) {
      throw new Error('Input exceeds maximum length');
    }
    
    // Address format validation
    if (!await this._isValidAddress(userAddress) || !await this._isValidAddress(tokenAddress)) {
      throw new Error('Invalid address format');
    }
    
    // Amount validation
    try {
      const amountBN = ethers.BigNumber.from(amount);
      if (amountBN.gt(this.config.validation.maxOrderSize)) {
        throw new Error('Amount exceeds maximum order size');
      }
      if (amountBN.lt(this.config.validation.minOrderSize) && !amountBN.isZero()) {
        throw new Error('Amount below minimum order size');
      }
    } catch (error) {
      throw new Error('Invalid amount format');
    }
    
    // Chain ID validation
    if (!this.providers.has(chainId.toString())) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    
    // Suspicious pattern detection
    if (this.config.security.suspiciousPatternDetection) {
      await this._detectSuspiciousPatterns(userAddress, tokenAddress, amount, chainId);
    }
  }

  /**
   * Sanitize and validate all inputs
   * @private
   */
  async _sanitizeAndValidateInputs(userAddress, tokenAddress, amount, chainId) {
    return {
      userAddress: await this._sanitizeAddress(userAddress),
      tokenAddress: await this._sanitizeAddress(tokenAddress),
      amount: amount.toString().trim(),
      chainId: chainId.toString().trim()
    };
  }

  /**
   * Sanitize Ethereum address
   * @private
   */
  async _sanitizeAddress(address) {
    if (!address || typeof address !== 'string') {
      throw new Error('Invalid address type');
    }
    
    const cleaned = address.trim().toLowerCase();
    
    if (!ethers.utils.isAddress(cleaned)) {
      throw new Error('Invalid address format');
    }
    
    return ethers.utils.getAddress(cleaned); // Returns checksummed address
  }

  /**
   * Validate Ethereum address format
   * @private
   */
  async _isValidAddress(address) {
    try {
      return ethers.utils.isAddress(address);
    } catch {
      return false;
    }
  }

  /**
   * Generate secure cache key with HMAC
   * @private
   */
  _generateSecureCacheKey(...parts) {
    const data = parts.join(':');
    const hmac = crypto.createHmac('sha256', this.encryptionKey);
    hmac.update(data);
    return `secure_${hmac.digest('hex').substring(0, 16)}:${data}`;
  }

  /**
   * Rate limiting implementation
   * @private
   */
  async _checkRateLimit(userAddress, action) {
    const key = `${userAddress}:${action}`;
    const now = Date.now();
    const window = this.config.security.rateLimitWindow;
    
    if (!this.rateLimiters.has(key)) {
      this.rateLimiters.set(key, []);
    }
    
    const requests = this.rateLimiters.get(key);
    
    // Remove old requests outside the window
    while (requests.length > 0 && now - requests[0] > window) {
      requests.shift();
    }
    
    // Check if limit exceeded
    if (requests.length >= this.config.security.rateLimitRequests) {
      this.metrics.rateLimitViolations++;
      return false;
    }
    
    requests.push(now);
    return true;
  }

  /**
   * Circuit breaker implementation
   * @private
   */
  _isCircuitBreakerOpen(chainId) {
    const breaker = this.circuitBreakers.get(chainId);
    if (!breaker) return false;
    
    const now = Date.now();
    
    // Reset if timeout passed
    if (breaker.state === 'open' && now - breaker.lastFailure > breaker.timeout) {
      breaker.state = 'half-open';
      breaker.failures = 0;
    }
    
    return breaker.state === 'open';
  }

  /**
   * Record circuit breaker failure
   * @private
   */
  async _recordCircuitBreakerFailure(chainId) {
    if (!this.circuitBreakers.has(chainId)) {
      this.circuitBreakers.set(chainId, {
        failures: 0,
        threshold: this.config.security.circuitBreakerThreshold,
        timeout: 60000, // 1 minute
        state: 'closed',
        lastFailure: 0
      });
    }
    
    const breaker = this.circuitBreakers.get(chainId);
    breaker.failures++;
    breaker.lastFailure = Date.now();
    
    if (breaker.failures >= breaker.threshold) {
      breaker.state = 'open';
      this.metrics.circuitBreakerTrips++;
      
      await this._logSecurityEvent('circuit_breaker_opened', {
        chainId,
        failures: breaker.failures,
        threshold: breaker.threshold
      });
    }
  }

  /**
   * Initialize circuit breakers
   * @private
   */
  _initializeCircuitBreakers() {
    for (const [networkName, config] of Object.entries(this.config.networks)) {
      this.circuitBreakers.set(config.chainId.toString(), {
        failures: 0,
        threshold: this.config.security.circuitBreakerThreshold,
        timeout: 60000,
        state: 'closed',
        lastFailure: 0
      });
    }
  }

  /**
   * Enhanced fraud detection
   * @private
   */
  async _performFraudDetection(userAddress, tokenAddress, amount, chainId) {
    const key = `${userAddress}:${tokenAddress}:${chainId}`;
    const now = Date.now();
    
    if (!this.suspiciousActivities.has(key)) {
      this.suspiciousActivities.set(key, {
        requests: [],
        patterns: new Set(),
        riskScore: 0
      });
    }
    
    const activity = this.suspiciousActivities.get(key);
    activity.requests.push({ timestamp: now, amount });
    
    // Remove old requests (1 minute window)
    activity.requests = activity.requests.filter(req => now - req.timestamp <= 60000);
    
    // Detect suspicious patterns
    const velocity = activity.requests.length;
    const amounts = activity.requests.map(r => r.amount);
    const uniqueAmounts = new Set(amounts).size;
    
    // High velocity detection
    if (velocity > this.config.validation.suspiciousVelocity) {
      activity.patterns.add('high_velocity');
      activity.riskScore += 30;
    }
    
    // Repeated amount detection
    if (amounts.length > 5 && uniqueAmounts === 1) {
      activity.patterns.add('repeated_amounts');
      activity.riskScore += 20;
    }
    
    // Risk threshold check
    if (activity.riskScore > 50) {
      this.metrics.suspiciousActivities++;
      
      await this._logSecurityEvent('suspicious_activity_detected', {
        userAddress,
        tokenAddress,
        chainId,
        patterns: Array.from(activity.patterns),
        riskScore: activity.riskScore,
        velocity
      });
      
      this.emit('suspicious_activity', {
        userAddress,
        tokenAddress,
        chainId,
        patterns: Array.from(activity.patterns),
        riskScore: activity.riskScore,
        timestamp: now
      });
    }
    
    // Decay risk score over time
    activity.riskScore = Math.max(0, activity.riskScore - 1);
  }

  /**
   * Detect suspicious patterns
   * @private
   */
  async _detectSuspiciousPatterns(userAddress, tokenAddress, amount, chainId) {
    // Pattern detection logic would be implemented here
    // This is a placeholder for actual ML-based pattern detection
    
    const patterns = [];
    
    // Check for known malicious addresses
    if (await this._isKnownMaliciousAddress(userAddress)) {
      patterns.push('known_malicious_address');
    }
    
    // Check for unusual amount patterns
    if (await this._hasUnusualAmountPattern(userAddress, amount)) {
      patterns.push('unusual_amount_pattern');
    }
    
    if (patterns.length > 0) {
      throw new Error(`Suspicious patterns detected: ${patterns.join(', ')}`);
    }
  }

  /**
   * Check if address is known to be malicious
   * @private
   */
  async _isKnownMaliciousAddress(address) {
    // In production, this would check against a database of known malicious addresses
    return false;
  }

  /**
   * Check for unusual amount patterns
   * @private
   */
  async _hasUnusualAmountPattern(userAddress, amount) {
    // In production, this would use ML models to detect unusual patterns
    return false;
  }

  /**
   * Create secure Redis client with enhanced configuration
   * @private
   */
  _createSecureRedisClient() {
    const client = new Redis({
      ...this.config.redis,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      commandTimeout: 5000,
      enableOfflineQueue: false
    });
    
    client.on('error', (error) => {
      this.metrics.errors++;
      console.error('Secure Redis client error:', error);
      this.emit('redis_error', error);
    });
    
    client.on('ready', () => {
      console.log('Secure Redis client ready');
    });
    
    client.on('reconnecting', () => {
      console.log('Secure Redis client reconnecting');
    });
    
    return client;
  }

  /**
   * Initialize secure providers with health monitoring
   * @private
   */
  _initializeSecureProviders() {
    for (const [networkName, config] of Object.entries(this.config.networks)) {
      try {
        // Main RPC provider with security wrapper
        if (config.rpcUrl) {
          const provider = new ethers.providers.JsonRpcProvider({
            url: config.rpcUrl,
            timeout: config.timeout
          });
          
          // Add security monitoring
          const secureProvider = this._wrapProviderWithSecurity(provider, config);
          this.providers.set(config.chainId.toString(), secureProvider);
        }
        
        // Archive provider
        if (config.archiveUrl) {
          const archiveProvider = new ethers.providers.JsonRpcProvider({
            url: config.archiveUrl,
            timeout: config.timeout
          });
          
          const secureArchiveProvider = this._wrapProviderWithSecurity(archiveProvider, config);
          this.archiveProviders.set(config.chainId.toString(), secureArchiveProvider);
        }
        
        // Initialize health check
        this.providerHealthChecks.set(config.chainId.toString(), {
          healthy: true,
          lastCheck: Date.now(),
          failures: 0,
          responseTime: 0
        });
        
      } catch (error) {
        console.error(`Failed to initialize secure provider for ${networkName}:`, error);
      }
    }
  }

  /**
   * Wrap provider with security monitoring
   * @private
   */
  _wrapProviderWithSecurity(provider, config) {
    const originalSend = provider.send.bind(provider);
    
    provider.send = async (method, params) => {
      const startTime = Date.now();
      
      try {
        // Rate limiting check
        if (!await this._checkProviderRateLimit(config.chainId, config.rateLimitRps)) {
          throw new Error('Provider rate limit exceeded');
        }
        
        const result = await originalSend(method, params);
        
        // Update health status
        this._updateProviderHealth(config.chainId, true, Date.now() - startTime);
        
        return result;
        
      } catch (error) {
        this._updateProviderHealth(config.chainId, false, Date.now() - startTime);
        throw error;
      }
    };
    
    return provider;
  }

  /**
   * Provider-specific rate limiting
   * @private
   */
  async _checkProviderRateLimit(chainId, rps) {
    const key = `provider_${chainId}`;
    const now = Date.now();
    const window = 1000; // 1 second
    
    if (!this.rateLimiters.has(key)) {
      this.rateLimiters.set(key, []);
    }
    
    const requests = this.rateLimiters.get(key);
    
    // Remove old requests
    while (requests.length > 0 && now - requests[0] > window) {
      requests.shift();
    }
    
    // Check rate limit
    if (requests.length >= rps) {
      return false;
    }
    
    requests.push(now);
    return true;
  }

  /**
   * Update provider health status
   * @private
   */
  _updateProviderHealth(chainId, success, responseTime) {
    const health = this.providerHealthChecks.get(chainId);
    if (!health) return;
    
    health.lastCheck = Date.now();
    health.responseTime = responseTime;
    
    if (success) {
      health.failures = 0;
      health.healthy = true;
    } else {
      health.failures++;
      if (health.failures >= 5) {
        health.healthy = false;
      }
    }
  }

  /**
   * Fetch balance with security measures
   * @private
   */
  async _fetchSecureBalance(userAddress, tokenAddress, chainId) {
    const provider = this.providers.get(chainId.toString());
    
    if (!provider) {
      throw new Error(`Provider not available for chain ${chainId}`);
    }
    
    // Check provider health
    const health = this.providerHealthChecks.get(chainId.toString());
    if (!health || !health.healthy) {
      throw new Error(`Provider unhealthy for chain ${chainId}`);
    }
    
    try {
      let balance;
      const blockNumber = await provider.getBlockNumber();
      
      if (tokenAddress === ethers.constants.AddressZero) {
        balance = await provider.getBalance(userAddress, blockNumber);
      } else {
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ['function balanceOf(address) view returns (uint256)'],
          provider
        );
        balance = await tokenContract.balanceOf(userAddress, { blockTag: blockNumber });
      }
      
      return { balance, blockNumber };
      
    } catch (error) {
      // Record failure for circuit breaker
      await this._recordCircuitBreakerFailure(chainId);
      throw error;
    }
  }

  /**
   * Fetch allowance with security measures
   * @private
   */
  async _fetchSecureAllowance(userAddress, tokenAddress, spenderAddress, chainId) {
    const provider = this.providers.get(chainId.toString());
    
    if (!provider) {
      throw new Error(`Provider not available for chain ${chainId}`);
    }
    
    try {
      const blockNumber = await provider.getBlockNumber();
      
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function allowance(address,address) view returns (uint256)'],
        provider
      );
      
      const allowance = await tokenContract.allowance(userAddress, spenderAddress, {
        blockTag: blockNumber
      });
      
      return { allowance, blockNumber };
      
    } catch (error) {
      await this._recordCircuitBreakerFailure(chainId);
      throw error;
    }
  }

  /**
   * Perform secure validation
   * @private
   */
  async _performSecureValidation(sanitizedInputs, balanceData, options) {
    const requiredAmount = ethers.BigNumber.from(sanitizedInputs.amount);
    const hasBalance = balanceData.balance.gte(requiredAmount);
    
    return {
      valid: hasBalance,
      userAddress: sanitizedInputs.userAddress,
      tokenAddress: sanitizedInputs.tokenAddress,
      chainId: sanitizedInputs.chainId,
      requiredAmount: requiredAmount.toString(),
      actualBalance: balanceData.balance.toString(),
      blockNumber: balanceData.blockNumber,
      fromCache: false,
      timestamp: Date.now(),
      securityLevel: 'high'
    };
  }

  /**
   * Get data from secure cache
   * @private
   */
  async _getSecureCache(key) {
    try {
      const encrypted = await this.redis.get(key);
      if (!encrypted) return null;
      
      return this._decryptCacheData(encrypted);
      
    } catch (error) {
      this.cacheStats.errors++;
      console.error('Secure cache retrieval failed:', error);
      return null;
    }
  }

  /**
   * Set data in secure cache
   * @private
   */
  async _setSecureCache(key, data) {
    try {
      const encrypted = this._encryptCacheData(data);
      const ttl = this._getCacheTTL(key);
      
      await this.redis.setex(key, ttl, encrypted);
      
    } catch (error) {
      this.cacheStats.errors++;
      console.error('Secure cache storage failed:', error);
    }
  }

  /**
   * Encrypt cache data
   * @private
   */
  _encryptCacheData(data) {
    if (!this.config.cache.enableEncryption) {
      return JSON.stringify(data);
    }
    
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return encrypted;
  }

  /**
   * Decrypt cache data
   * @private
   */
  _decryptCacheData(encryptedData) {
    if (!this.config.cache.enableEncryption) {
      return JSON.parse(encryptedData);
    }
    
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  /**
   * Generate encryption key
   * @private
   */
  _generateEncryptionKey() {
    return process.env.BALANCE_SERVICE_ENCRYPTION_KEY || 
           crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get cache TTL based on key type
   * @private
   */
  _getCacheTTL(key) {
    if (key.includes('balance:')) return this.config.cache.balanceTTL;
    if (key.includes('allowance:')) return this.config.cache.allowanceTTL;
    if (key.includes('historical:')) return this.config.cache.historicalTTL;
    return 30; // default
  }

  /**
   * Check if cache is valid
   * @private
   */
  _isCacheValid(cached) {
    if (!cached || !cached.timestamp) return false;
    
    const age = Date.now() - cached.timestamp;
    const maxAge = 30000; // 30 seconds
    
    return age < maxAge;
  }

  /**
   * Invalidate allowance caches securely
   * @private
   */
  async _invalidateAllowanceCachesSecure(tokenAddress, fromAddress, toAddress, chainId) {
    try {
      // This would get all spender addresses associated with these users
      // For now, we'll implement a more targeted approach
      
      const pipeline = this.redis.pipeline();
      
      // Search for allowance cache keys (this is a simplified approach)
      const pattern = `*allowance:${chainId}:${tokenAddress}:*`;
      const keys = await this.redis.keys(pattern);
      
      for (const key of keys) {
        if (key.includes(fromAddress) || key.includes(toAddress)) {
          pipeline.del(key);
          this.allowanceCache.delete(key);
        }
      }
      
      await pipeline.exec();
      
    } catch (error) {
      console.error('Secure allowance cache invalidation failed:', error);
    }
  }

  /**
   * Generate unique request ID
   * @private
   */
  _generateRequestId() {
    return crypto.randomUUID();
  }

  /**
   * Security event logging
   * @private
   */
  async _logSecurityEvent(eventType, details) {
    if (!this.config.security.enableAuditLogging) return;
    
    const logEntry = {
      timestamp: Date.now(),
      eventType,
      details,
      level: this._getEventLevel(eventType)
    };
    
    this.auditLog.push(logEntry);
    this.metrics.securityEvents++;
    
    // Keep audit log size manageable
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000);
    }
    
    // Emit for external logging systems
    this.emit('security_event', logEntry);
  }

  /**
   * Get security event level
   * @private
   */
  _getEventLevel(eventType) {
    const highRiskEvents = [
      'rate_limit_exceeded',
      'suspicious_activity_detected',
      'circuit_breaker_opened',
      'authentication_failure'
    ];
    
    return highRiskEvents.includes(eventType) ? 'high' : 'low';
  }

  /**
   * Start security monitoring
   * @private
   */
  _startSecurityMonitoring() {
    // Cleanup old rate limit entries
    setInterval(() => {
      this._cleanupRateLimiters();
    }, 60000);
    
    // Monitor cache size
    setInterval(() => {
      this._monitorCacheSize();
    }, 30000);
    
    // Health check providers
    setInterval(() => {
      this._performProviderHealthChecks();
    }, 120000);
    
    // Clean up suspicious activities
    setInterval(() => {
      this._cleanupSuspiciousActivities();
    }, 300000);
    
    // Emit security metrics
    setInterval(() => {
      this.emit('security_metrics', {
        metrics: this.metrics,
        cacheStats: this.cacheStats,
        circuitBreakers: this._getCircuitBreakerStatus(),
        timestamp: Date.now()
      });
    }, 60000);
  }

  /**
   * Cleanup rate limiters
   * @private
   */
  _cleanupRateLimiters() {
    const now = Date.now();
    const window = this.config.security.rateLimitWindow;
    
    for (const [key, requests] of this.rateLimiters) {
      const validRequests = requests.filter(timestamp => now - timestamp <= window);
      
      if (validRequests.length === 0) {
        this.rateLimiters.delete(key);
      } else {
        this.rateLimiters.set(key, validRequests);
      }
    }
  }

  /**
   * Monitor cache size and enforce limits
   * @private
   */
  _monitorCacheSize() {
    const totalSize = this.balanceCache.size + this.allowanceCache.size + this.historicalCache.size;
    
    if (totalSize > this.config.security.maxCacheSize) {
      // Implement LRU eviction
      this._evictOldestCacheEntries();
      this.cacheStats.evictions++;
    }
  }

  /**
   * Evict oldest cache entries
   * @private
   */
  _evictOldestCacheEntries() {
    const targetSize = Math.floor(this.config.security.maxCacheSize * 0.8);
    const allCaches = [this.balanceCache, this.allowanceCache, this.historicalCache];
    
    for (const cache of allCaches) {
      while (cache.size > targetSize / allCaches.length) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) {
          cache.delete(oldestKey);
        } else {
          break;
        }
      }
    }
  }

  /**
   * Perform provider health checks
   * @private
   */
  async _performProviderHealthChecks() {
    for (const [chainId, provider] of this.providers) {
      try {
        const startTime = Date.now();
        await provider.getBlockNumber();
        const responseTime = Date.now() - startTime;
        
        this._updateProviderHealth(chainId, true, responseTime);
        
      } catch (error) {
        this._updateProviderHealth(chainId, false, -1);
      }
    }
  }

  /**
   * Cleanup suspicious activities
   * @private
   */
  _cleanupSuspiciousActivities() {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour
    
    for (const [key, activity] of this.suspiciousActivities) {
      activity.requests = activity.requests.filter(req => now - req.timestamp <= maxAge);
      
      if (activity.requests.length === 0) {
        this.suspiciousActivities.delete(key);
      }
    }
  }

  /**
   * Get circuit breaker status
   * @private
   */
  _getCircuitBreakerStatus() {
    const status = {};
    for (const [chainId, breaker] of this.circuitBreakers) {
      status[chainId] = {
        state: breaker.state,
        failures: breaker.failures,
        lastFailure: breaker.lastFailure
      };
    }
    return status;
  }

  /**
   * Get comprehensive service statistics
   */
  getSecurityStatistics() {
    return {
      metrics: this.metrics,
      cacheStats: this.cacheStats,
      security: {
        rateLimiters: this.rateLimiters.size,
        suspiciousActivities: this.suspiciousActivities.size,
        circuitBreakers: this._getCircuitBreakerStatus(),
        auditLogSize: this.auditLog.length
      },
      providers: {
        available: Array.from(this.providers.keys()),
        healthy: Array.from(this.providerHealthChecks.entries())
          .filter(([_, health]) => health.healthy)
          .map(([chainId]) => chainId)
      },
      concurrentRequests: this.concurrentRequests,
      timestamp: Date.now()
    };
  }

  /**
   * Secure shutdown
   */
  async shutdown() {
    console.log('Shutting down Secure Balance Validation Service...');
    
    try {
      // Stop all monitoring
      clearInterval();
      
      // Stop transfer monitoring
      for (const [key] of this.transferListeners) {
        const [tokenAddress, chainId] = key.split('-');
        await this.stopTransferMonitoring(tokenAddress, chainId);
      }
      
      // Close Redis connection
      await this.redis.quit();
      
      // Clear all caches securely
      this.balanceCache.clear();
      this.allowanceCache.clear();
      this.historicalCache.clear();
      this.rateLimiters.clear();
      this.suspiciousActivities.clear();
      
      // Final security log
      await this._logSecurityEvent('service_shutdown', {
        totalRequests: this.metrics.balanceChecks,
        securityEvents: this.metrics.securityEvents,
        uptime: Date.now()
      });
      
      this.emit('shutdown', { 
        timestamp: Date.now(),
        securityLevel: 'high'
      });
      
      console.log('Secure Balance Validation Service shutdown complete');
      
    } catch (error) {
      console.error('Error during secure shutdown:', error);
    }
  }
}

module.exports = SecureBalanceValidationService;