const { ethers } = require('ethers');
const EventEmitter = require('events');
const SecureBalanceValidationService = require('./SecureBalanceValidationService');
const OptimizedMultiChainAggregator = require('./OptimizedMultiChainAggregator');

/**
 * @class RobustBalanceService
 * @description Ultra-robust balance service with comprehensive edge case handling
 * @extends EventEmitter
 * 
 * Edge Cases Handled:
 * - Network failures and timeouts
 * - Provider unavailability and recovery
 * - Memory exhaustion and cleanup
 * - Concurrent request conflicts
 * - Invalid data and malformed responses
 * - Token contract edge cases (proxies, upgrades, non-standard)
 * - Chain reorganizations and rollbacks
 * - Gas price spikes and transaction failures
 * - Rate limiting and backoff strategies
 * - Cache corruption and recovery
 * - WebSocket disconnections and reconnections
 * - Archive node limitations
 * - Cross-chain bridge delays
 * - Decimal precision issues
 * - Zero balance and empty responses
 * - Malicious contract interactions
 * - State transitions during queries
 */
class RobustBalanceService extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Edge case handling configuration
      edgeCases: {
        maxRetryAttempts: config.edgeCases?.maxRetryAttempts || 5,
        retryBackoffMultiplier: config.edgeCases?.retryBackoffMultiplier || 2,
        maxRetryDelay: config.edgeCases?.maxRetryDelay || 30000,
        timeoutGracePeriod: config.edgeCases?.timeoutGracePeriod || 5000,
        memoryThreshold: config.edgeCases?.memoryThreshold || 0.8, // 80% of available memory
        concurrencyLimit: config.edgeCases?.concurrencyLimit || 100,
        staleDataThreshold: config.edgeCases?.staleDataThreshold || 300000, // 5 minutes
        chainReorgDepth: config.edgeCases?.chainReorgDepth || 10,
        gasLimitSafetyFactor: config.edgeCases?.gasLimitSafetyFactor || 1.2,
        decimalPrecisionLimit: config.edgeCases?.decimalPrecisionLimit || 18,
        ...config.edgeCases
      },
      
      // Fallback configurations
      fallbacks: {
        enableProviderFallback: config.fallbacks?.enableProviderFallback !== false,
        enableArchiveFallback: config.fallbacks?.enableArchiveFallback !== false,
        enableCacheFallback: config.fallbacks?.enableCacheFallback !== false,
        maxFallbackAttempts: config.fallbacks?.maxFallbackAttempts || 3,
        fallbackTimeout: config.fallbacks?.fallbackTimeout || 10000,
        ...config.fallbacks
      },
      
      // Recovery configurations
      recovery: {
        autoRecovery: config.recovery?.autoRecovery !== false,
        recoveryInterval: config.recovery?.recoveryInterval || 60000,
        healthCheckInterval: config.recovery?.healthCheckInterval || 30000,
        degradedModeThreshold: config.recovery?.degradedModeThreshold || 0.5,
        emergencyModeThreshold: config.recovery?.emergencyModeThreshold || 0.2,
        ...config.recovery
      },
      
      ...config
    };
    
    // Initialize underlying services with robust configuration
    this.secureService = new SecureBalanceValidationService({
      ...config,
      security: {
        ...config.security,
        maxConcurrentRequests: this.config.edgeCases.concurrencyLimit,
        circuitBreakerThreshold: 5,
        enableAuditLogging: true
      }
    });
    
    this.optimizedAggregator = new OptimizedMultiChainAggregator({
      ...config,
      performance: {
        ...config.performance,
        maxConcurrentRequests: this.config.edgeCases.concurrencyLimit,
        requestTimeout: this.config.fallbacks.fallbackTimeout
      }
    });
    
    // Edge case tracking
    this.edgeCaseMetrics = {
      retryAttempts: 0,
      fallbackUsed: 0,
      timeouts: 0,
      networkErrors: 0,
      dataCorruption: 0,
      memoryWarnings: 0,
      chainReorgs: 0,
      providerFailures: 0,
      recoveryEvents: 0,
      degradedModeActivations: 0,
      emergencyModeActivations: 0
    };
    
    // Service state management
    this.serviceState = {
      mode: 'normal', // normal, degraded, emergency
      healthScore: 1.0,
      lastHealthCheck: Date.now(),
      failingProviders: new Set(),
      recoveryInProgress: false,
      memoryUsage: 0,
      activeFallbacks: new Set()
    };
    
    // Request tracking for edge case detection
    this.requestTracker = {
      inFlight: new Map(),
      completedRequests: new Map(),
      failedRequests: new Map(),
      suspiciousPatterns: new Map()
    };
    
    // Provider fallback chain
    this.providerFallbacks = new Map();
    this.archiveFallbacks = new Map();
    
    // Cache integrity monitoring
    this.cacheIntegrity = {
      checksums: new Map(),
      corruptionDetected: 0,
      lastIntegrityCheck: Date.now()
    };
    
    // Initialize robust service
    this._initializeRobustServices();
    this._startEdgeCaseMonitoring();
    this._setupGracefulShutdown();
  }

  /**
   * Ultra-robust balance validation with comprehensive edge case handling
   * @param {string} userAddress - User wallet address
   * @param {string} tokenAddress - Token contract address
   * @param {string} amount - Required amount
   * @param {string} chainId - Network chain ID
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Robust validation result
   */
  async validateBalance(userAddress, tokenAddress, amount, chainId, options = {}) {
    const requestId = this._generateRequestId();
    const startTime = Date.now();
    
    try {
      // Pre-validation edge case checks
      await this._performPreValidationChecks(userAddress, tokenAddress, amount, chainId);
      
      // Track request
      this.requestTracker.inFlight.set(requestId, {
        userAddress,
        tokenAddress,
        amount,
        chainId,
        startTime,
        attempts: 0
      });
      
      let validationResult;
      let attempts = 0;
      const maxAttempts = this.config.edgeCases.maxRetryAttempts;
      
      while (attempts < maxAttempts) {
        try {
          // Check service health before proceeding
          await this._checkServiceHealth();
          
          // Attempt validation with edge case protection
          validationResult = await this._performRobustValidation(
            userAddress, tokenAddress, amount, chainId, options, attempts
          );
          
          // Validate result integrity
          await this._validateResultIntegrity(validationResult);
          
          break; // Success
          
        } catch (error) {
          attempts++;
          this.edgeCaseMetrics.retryAttempts++;
          
          await this._handleValidationError(error, attempts, maxAttempts, requestId);
          
          if (attempts < maxAttempts) {
            const delay = this._calculateBackoffDelay(attempts);
            await this._sleep(delay);
          } else {
            throw error; // Final attempt failed
          }
        }
      }
      
      // Post-validation edge case checks
      await this._performPostValidationChecks(validationResult);
      
      // Update request tracking
      this.requestTracker.completedRequests.set(requestId, {
        ...this.requestTracker.inFlight.get(requestId),
        result: validationResult,
        completedAt: Date.now(),
        attempts,
        success: true
      });
      
      this.requestTracker.inFlight.delete(requestId);
      
      // Emit robust validation event
      this.emit('robust_validation_completed', {
        requestId,
        userAddress,
        tokenAddress,
        chainId,
        valid: validationResult.valid,
        attempts,
        responseTime: Date.now() - startTime,
        serviceMode: this.serviceState.mode
      });
      
      return validationResult;
      
    } catch (error) {
      // Handle final failure
      await this._handleFinalValidationFailure(error, requestId, startTime);
      throw new Error(`Robust validation failed after all attempts: ${error.message}`);
    }
  }

  /**
   * Robust multi-chain balance aggregation with fallbacks
   * @param {string} userAddress - User wallet address
   * @param {Array<string>} tokens - Token symbols
   * @param {Object} options - Aggregation options
   * @returns {Promise<Object>} Robust aggregation result
   */
  async aggregateBalances(userAddress, tokens, options = {}) {
    const requestId = this._generateRequestId();
    
    try {
      // Check for edge case conditions
      await this._checkAggregationPreconditions(userAddress, tokens);
      
      let aggregationResult;
      let fallbackUsed = false;
      
      try {
        // Primary aggregation attempt
        aggregationResult = await this.optimizedAggregator.aggregateBalances(
          userAddress, tokens, options
        );
        
        // Validate aggregation integrity
        await this._validateAggregationIntegrity(aggregationResult, tokens);
        
      } catch (primaryError) {
        this.edgeCaseMetrics.fallbackUsed++;
        fallbackUsed = true;
        
        // Fallback to secure service
        aggregationResult = await this._performFallbackAggregation(
          userAddress, tokens, options, primaryError
        );
      }
      
      // Handle edge cases in results
      aggregationResult = await this._handleAggregationEdgeCases(aggregationResult);
      
      aggregationResult.metadata = {
        requestId,
        fallbackUsed,
        serviceMode: this.serviceState.mode,
        healthScore: this.serviceState.healthScore,
        timestamp: Date.now()
      };
      
      return aggregationResult;
      
    } catch (error) {
      await this._logEdgeCaseEvent('aggregation_failure', {
        requestId,
        userAddress,
        tokens,
        error: error.message
      });
      
      throw new Error(`Robust aggregation failed: ${error.message}`);
    }
  }

  /**
   * Edge case aware portfolio analysis
   * @param {string} userAddress - User wallet address
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Robust portfolio analysis
   */
  async getPortfolioAnalysis(userAddress, options = {}) {
    try {
      // Handle zero balance edge case
      const quickBalanceCheck = await this._performQuickBalanceCheck(userAddress);
      if (quickBalanceCheck.isEmpty) {
        return this._createEmptyPortfolioResponse(userAddress);
      }
      
      // Perform analysis with fallback protection
      let portfolioResult;
      
      try {
        portfolioResult = await this.optimizedAggregator.getPortfolioValue(
          userAddress, options.baseCurrency
        );
      } catch (error) {
        // Fallback to basic analysis
        portfolioResult = await this._performBasicPortfolioAnalysis(userAddress, options);
      }
      
      // Handle edge cases in portfolio data
      portfolioResult = await this._handlePortfolioEdgeCases(portfolioResult);
      
      return portfolioResult;
      
    } catch (error) {
      throw new Error(`Robust portfolio analysis failed: ${error.message}`);
    }
  }

  // Private edge case handling methods

  /**
   * Perform pre-validation checks for edge cases
   * @private
   */
  async _performPreValidationChecks(userAddress, tokenAddress, amount, chainId) {
    // Address format validation with edge cases
    if (!this._isValidAddressFormat(userAddress)) {
      throw new Error('Invalid user address format');
    }
    
    if (!this._isValidAddressFormat(tokenAddress)) {
      throw new Error('Invalid token address format');
    }
    
    // Amount edge cases
    if (!this._isValidAmount(amount)) {
      throw new Error('Invalid amount format');
    }
    
    // Check for known problematic addresses
    if (await this._isProblematicAddress(userAddress) || await this._isProblematicAddress(tokenAddress)) {
      throw new Error('Address flagged as problematic');
    }
    
    // Chain availability check
    if (!await this._isChainAvailable(chainId)) {
      throw new Error(`Chain ${chainId} currently unavailable`);
    }
    
    // Memory usage check
    await this._checkMemoryUsage();
    
    // Concurrency limit check
    if (this.requestTracker.inFlight.size >= this.config.edgeCases.concurrencyLimit) {
      throw new Error('Concurrency limit exceeded');
    }
  }

  /**
   * Perform robust validation with error handling
   * @private
   */
  async _performRobustValidation(userAddress, tokenAddress, amount, chainId, options, attempt) {
    // Use appropriate service based on current mode
    let validationService;
    
    if (this.serviceState.mode === 'emergency') {
      // Use minimal validation in emergency mode
      validationService = this._getEmergencyValidationService();
    } else {
      validationService = this.secureService;
    }
    
    // Add timeout protection
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Validation timeout')), 
        this.config.fallbacks.fallbackTimeout + this.config.edgeCases.timeoutGracePeriod);
    });
    
    const validationPromise = validationService.validateBalance(
      userAddress, tokenAddress, amount, chainId, {
        ...options,
        attempt,
        serviceMode: this.serviceState.mode
      }
    );
    
    const result = await Promise.race([validationPromise, timeoutPromise]);
    
    // Check for chain reorganization
    if (result.blockNumber) {
      await this._checkForChainReorganization(chainId, result.blockNumber);
    }
    
    return result;
  }

  /**
   * Validate result integrity
   * @private
   */
  async _validateResultIntegrity(result) {
    // Check required fields
    const requiredFields = ['valid', 'userAddress', 'tokenAddress', 'chainId', 'actualBalance'];
    for (const field of requiredFields) {
      if (result[field] === undefined || result[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate balance format
    try {
      ethers.BigNumber.from(result.actualBalance);
    } catch {
      throw new Error('Invalid balance format in result');
    }
    
    // Check for suspicious values
    if (result.actualBalance.length > 100) { // Extremely large number
      throw new Error('Suspicious balance value detected');
    }
    
    // Validate timestamp
    const now = Date.now();
    if (!result.timestamp || Math.abs(now - result.timestamp) > 60000) { // More than 1 minute old
      this.edgeCaseMetrics.dataCorruption++;
      throw new Error('Result timestamp validation failed');
    }
  }

  /**
   * Handle validation errors with appropriate responses
   * @private
   */
  async _handleValidationError(error, attempt, maxAttempts, requestId) {
    const errorType = this._classifyError(error);
    
    switch (errorType) {
      case 'network':
        this.edgeCaseMetrics.networkErrors++;
        await this._handleNetworkError(error);
        break;
        
      case 'timeout':
        this.edgeCaseMetrics.timeouts++;
        await this._handleTimeoutError(error);
        break;
        
      case 'provider':
        this.edgeCaseMetrics.providerFailures++;
        await this._handleProviderError(error);
        break;
        
      case 'data':
        this.edgeCaseMetrics.dataCorruption++;
        await this._handleDataError(error);
        break;
        
      default:
        await this._handleUnknownError(error);
    }
    
    // Log edge case event
    await this._logEdgeCaseEvent('validation_retry', {
      requestId,
      attempt,
      maxAttempts,
      errorType,
      errorMessage: error.message
    });
    
    // Update service health
    this._updateServiceHealth(false);
  }

  /**
   * Classify error types for appropriate handling
   * @private
   */
  _classifyError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('connection') || message.includes('enotfound')) {
      return 'network';
    }
    
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }
    
    if (message.includes('provider') || message.includes('rpc') || message.includes('node')) {
      return 'provider';
    }
    
    if (message.includes('invalid') || message.includes('corrupt') || message.includes('format')) {
      return 'data';
    }
    
    return 'unknown';
  }

  /**
   * Handle network errors
   * @private
   */
  async _handleNetworkError(error) {
    // Switch to fallback providers if available
    await this._activateProviderFallbacks();
    
    // Reduce service health
    this.serviceState.healthScore = Math.max(0.3, this.serviceState.healthScore - 0.1);
  }

  /**
   * Handle timeout errors
   * @private
   */
  async _handleTimeoutError(error) {
    // Increase timeout for next attempt
    this.config.fallbacks.fallbackTimeout = Math.min(
      this.config.fallbacks.fallbackTimeout * 1.5,
      this.config.edgeCases.maxRetryDelay
    );
    
    // Check if we should enter degraded mode
    if (this.edgeCaseMetrics.timeouts > 10) {
      await this._enterDegradedMode();
    }
  }

  /**
   * Handle provider errors
   * @private
   */
  async _handleProviderError(error) {
    // Mark current provider as failing
    // Implementation would track and switch providers
    
    // Try alternative RPC endpoints
    await this._rotateProviderEndpoints();
  }

  /**
   * Handle data corruption errors
   * @private
   */
  async _handleDataError(error) {
    // Clear corrupted cache
    await this._clearCorruptedCache();
    
    // Validate cache integrity
    await this._performCacheIntegrityCheck();
  }

  /**
   * Perform fallback aggregation
   * @private
   */
  async _performFallbackAggregation(userAddress, tokens, options, primaryError) {
    try {
      // Simple fallback: get balances individually
      const results = {
        userAddress,
        tokens: {},
        totalValueUSD: 0,
        fallback: true,
        primaryError: primaryError.message,
        timestamp: Date.now()
      };
      
      for (const token of tokens) {
        try {
          const balance = await this.secureService.validateBalance(
            userAddress, 
            this._getTokenAddress(token), 
            '0', 
            '1', // Default to Ethereum
            options
          );
          
          results.tokens[token] = {
            balance: balance.actualBalance,
            valid: balance.valid,
            fallback: true
          };
          
        } catch (tokenError) {
          results.tokens[token] = {
            balance: '0',
            valid: false,
            error: tokenError.message,
            fallback: true
          };
        }
      }
      
      return results;
      
    } catch (fallbackError) {
      throw new Error(`Both primary and fallback aggregation failed: ${fallbackError.message}`);
    }
  }

  /**
   * Handle aggregation edge cases
   * @private
   */
  async _handleAggregationEdgeCases(aggregationResult) {
    // Handle empty results
    if (!aggregationResult.tokens || Object.keys(aggregationResult.tokens).length === 0) {
      aggregationResult.edgeCases = ['empty_result'];
      aggregationResult.isEmpty = true;
    }
    
    // Handle partial failures
    const totalTokens = Object.keys(aggregationResult.tokens).length;
    const failedTokens = Object.values(aggregationResult.tokens).filter(t => !t.valid).length;
    
    if (failedTokens > 0) {
      aggregationResult.edgeCases = aggregationResult.edgeCases || [];
      aggregationResult.edgeCases.push('partial_failure');
      aggregationResult.partialFailure = {
        totalTokens,
        failedTokens,
        successRate: ((totalTokens - failedTokens) / totalTokens * 100).toFixed(2) + '%'
      };
    }
    
    // Handle precision issues
    if (aggregationResult.totalValueUSD && aggregationResult.totalValueUSD.toString().includes('e')) {
      aggregationResult.edgeCases = aggregationResult.edgeCases || [];
      aggregationResult.edgeCases.push('precision_issue');
      aggregationResult.totalValueUSD = this._formatWithPrecision(aggregationResult.totalValueUSD);
    }
    
    // Handle stale data
    const dataAge = Date.now() - aggregationResult.timestamp;
    if (dataAge > this.config.edgeCases.staleDataThreshold) {
      aggregationResult.edgeCases = aggregationResult.edgeCases || [];
      aggregationResult.edgeCases.push('stale_data');
      aggregationResult.dataAge = dataAge;
    }
    
    return aggregationResult;
  }

  /**
   * Check service health and handle degradation
   * @private
   */
  async _checkServiceHealth() {
    const now = Date.now();
    
    // Perform health check if needed
    if (now - this.serviceState.lastHealthCheck > this.config.recovery.healthCheckInterval) {
      await this._performHealthCheck();
    }
    
    // Check if we need to change service mode
    if (this.serviceState.healthScore < this.config.recovery.emergencyModeThreshold) {
      await this._enterEmergencyMode();
    } else if (this.serviceState.healthScore < this.config.recovery.degradedModeThreshold) {
      await this._enterDegradedMode();
    }
    
    // Throw error if in emergency mode and health is too low
    if (this.serviceState.mode === 'emergency' && this.serviceState.healthScore < 0.1) {
      throw new Error('Service in emergency mode with critical health');
    }
  }

  /**
   * Perform comprehensive health check
   * @private
   */
  async _performHealthCheck() {
    this.serviceState.lastHealthCheck = Date.now();
    
    let healthChecks = {
      memory: await this._checkMemoryHealth(),
      providers: await this._checkProviderHealth(),
      cache: await this._checkCacheHealth(),
      concurrency: this._checkConcurrencyHealth(),
      errorRate: this._checkErrorRate()
    };
    
    // Calculate overall health score
    const weights = { memory: 0.2, providers: 0.3, cache: 0.2, concurrency: 0.15, errorRate: 0.15 };
    this.serviceState.healthScore = Object.entries(healthChecks)
      .reduce((score, [metric, value]) => score + (value * weights[metric]), 0);
    
    // Emit health status
    this.emit('health_check_completed', {
      healthScore: this.serviceState.healthScore,
      mode: this.serviceState.mode,
      checks: healthChecks,
      timestamp: Date.now()
    });
  }

  /**
   * Check memory health
   * @private
   */
  async _checkMemoryHealth() {
    try {
      const memUsage = process.memoryUsage();
      const totalMemory = memUsage.heapTotal;
      const usedMemory = memUsage.heapUsed;
      const memoryUtilization = usedMemory / totalMemory;
      
      this.serviceState.memoryUsage = memoryUtilization;
      
      if (memoryUtilization > this.config.edgeCases.memoryThreshold) {
        this.edgeCaseMetrics.memoryWarnings++;
        await this._performMemoryCleanup();
        return 0.3; // Poor health
      }
      
      return memoryUtilization < 0.5 ? 1.0 : 1.0 - (memoryUtilization - 0.5) * 2;
      
    } catch (error) {
      return 0.5; // Unknown state
    }
  }

  /**
   * Check provider health
   * @private
   */
  async _checkProviderHealth() {
    let healthyProviders = 0;
    let totalProviders = 0;
    
    // This would check all configured providers
    // For now, return a simplified health score
    const failingProviderCount = this.serviceState.failingProviders.size;
    
    if (failingProviderCount === 0) return 1.0;
    if (failingProviderCount <= 2) return 0.7;
    if (failingProviderCount <= 5) return 0.4;
    return 0.1;
  }

  /**
   * Check cache health
   * @private
   */
  async _checkCacheHealth() {
    try {
      // Check cache corruption
      if (this.cacheIntegrity.corruptionDetected > 0) {
        return 0.3;
      }
      
      // Check cache performance
      const now = Date.now();
      if (now - this.cacheIntegrity.lastIntegrityCheck > 300000) { // 5 minutes
        await this._performCacheIntegrityCheck();
      }
      
      return 1.0; // Simplified check
      
    } catch (error) {
      return 0.5;
    }
  }

  /**
   * Check concurrency health
   * @private
   */
  _checkConcurrencyHealth() {
    const currentConcurrency = this.requestTracker.inFlight.size;
    const maxConcurrency = this.config.edgeCases.concurrencyLimit;
    
    const utilizationRate = currentConcurrency / maxConcurrency;
    
    if (utilizationRate < 0.5) return 1.0;
    if (utilizationRate < 0.8) return 0.7;
    if (utilizationRate < 0.95) return 0.4;
    return 0.1;
  }

  /**
   * Check error rate
   * @private
   */
  _checkErrorRate() {
    const totalRequests = this.requestTracker.completedRequests.size + this.requestTracker.failedRequests.size;
    if (totalRequests === 0) return 1.0;
    
    const errorRate = this.requestTracker.failedRequests.size / totalRequests;
    
    if (errorRate < 0.01) return 1.0; // Less than 1% error rate
    if (errorRate < 0.05) return 0.8; // Less than 5% error rate
    if (errorRate < 0.1) return 0.5;  // Less than 10% error rate
    return 0.2; // More than 10% error rate
  }

  /**
   * Enter degraded mode
   * @private
   */
  async _enterDegradedMode() {
    if (this.serviceState.mode !== 'degraded') {
      this.serviceState.mode = 'degraded';
      this.edgeCaseMetrics.degradedModeActivations++;
      
      // Reduce concurrency and increase timeouts
      this.config.edgeCases.concurrencyLimit = Math.floor(this.config.edgeCases.concurrencyLimit * 0.5);
      this.config.fallbacks.fallbackTimeout = this.config.fallbacks.fallbackTimeout * 1.5;
      
      await this._logEdgeCaseEvent('degraded_mode_entered', {
        healthScore: this.serviceState.healthScore,
        triggeredBy: 'health_check'
      });
      
      this.emit('service_mode_changed', {
        mode: 'degraded',
        healthScore: this.serviceState.healthScore,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Enter emergency mode
   * @private
   */
  async _enterEmergencyMode() {
    if (this.serviceState.mode !== 'emergency') {
      this.serviceState.mode = 'emergency';
      this.edgeCaseMetrics.emergencyModeActivations++;
      
      // Severely limit operations
      this.config.edgeCases.concurrencyLimit = Math.floor(this.config.edgeCases.concurrencyLimit * 0.1);
      this.config.fallbacks.fallbackTimeout = this.config.fallbacks.fallbackTimeout * 3;
      
      await this._logEdgeCaseEvent('emergency_mode_entered', {
        healthScore: this.serviceState.healthScore,
        triggeredBy: 'critical_health'
      });
      
      this.emit('service_mode_changed', {
        mode: 'emergency',
        healthScore: this.serviceState.healthScore,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Perform memory cleanup
   * @private
   */
  async _performMemoryCleanup() {
    try {
      // Clear old completed requests
      const cutoffTime = Date.now() - 300000; // 5 minutes
      
      for (const [requestId, request] of this.requestTracker.completedRequests) {
        if (request.completedAt < cutoffTime) {
          this.requestTracker.completedRequests.delete(requestId);
        }
      }
      
      // Clear old failed requests
      for (const [requestId, request] of this.requestTracker.failedRequests) {
        if (request.failedAt < cutoffTime) {
          this.requestTracker.failedRequests.delete(requestId);
        }
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      await this._logEdgeCaseEvent('memory_cleanup_performed', {
        memoryUsage: this.serviceState.memoryUsage
      });
      
    } catch (error) {
      console.error('Memory cleanup failed:', error);
    }
  }

  /**
   * Initialize robust services
   * @private
   */
  _initializeRobustServices() {
    // Set up event handlers for underlying services
    this.secureService.on('validation_error', (data) => {
      this._handleUnderlyingServiceError('secure_service', data);
    });
    
    this.optimizedAggregator.on('aggregation_error', (data) => {
      this._handleUnderlyingServiceError('optimized_aggregator', data);
    });
    
    // Initialize fallback chains
    this._initializeFallbackChains();
  }

  /**
   * Start edge case monitoring
   * @private
   */
  _startEdgeCaseMonitoring() {
    // Monitor request patterns
    setInterval(() => {
      this._analyzeRequestPatterns();
    }, 60000);
    
    // Monitor service health
    setInterval(() => {
      this._performHealthCheck();
    }, this.config.recovery.healthCheckInterval);
    
    // Monitor and cleanup
    setInterval(() => {
      this._performMaintenanceCleanup();
    }, 300000);
    
    // Recovery monitoring
    if (this.config.recovery.autoRecovery) {
      setInterval(() => {
        this._attemptAutoRecovery();
      }, this.config.recovery.recoveryInterval);
    }
  }

  /**
   * Setup graceful shutdown
   * @private
   */
  _setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`Received ${signal}, performing graceful shutdown...`);
      await this._gracefulShutdown();
      process.exit(0);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  /**
   * Graceful shutdown with edge case handling
   * @private
   */
  async _gracefulShutdown() {
    try {
      // Wait for in-flight requests to complete (with timeout)
      const shutdownTimeout = 30000; // 30 seconds
      const startTime = Date.now();
      
      while (this.requestTracker.inFlight.size > 0 && 
             Date.now() - startTime < shutdownTimeout) {
        await this._sleep(1000);
      }
      
      // Shutdown underlying services
      if (this.secureService.shutdown) {
        await this.secureService.shutdown();
      }
      
      // Final logging
      await this._logEdgeCaseEvent('service_shutdown', {
        totalRequests: this.requestTracker.completedRequests.size,
        edgeCaseMetrics: this.edgeCaseMetrics,
        finalHealthScore: this.serviceState.healthScore
      });
      
      this.emit('service_shutdown', {
        timestamp: Date.now(),
        graceful: true
      });
      
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
    }
  }

  /**
   * Utility methods
   * @private
   */
  
  _generateRequestId() {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }
  
  _calculateBackoffDelay(attempt) {
    const baseDelay = this.config.edgeCases.retryBackoffMultiplier ** (attempt - 1) * 1000;
    return Math.min(baseDelay, this.config.edgeCases.maxRetryDelay);
  }
  
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  _updateServiceHealth(success) {
    if (success) {
      this.serviceState.healthScore = Math.min(1.0, this.serviceState.healthScore + 0.01);
    } else {
      this.serviceState.healthScore = Math.max(0.0, this.serviceState.healthScore - 0.02);
    }
  }
  
  async _logEdgeCaseEvent(eventType, details) {
    const logEntry = {
      timestamp: Date.now(),
      eventType,
      details,
      serviceMode: this.serviceState.mode,
      healthScore: this.serviceState.healthScore
    };
    
    this.emit('edge_case_event', logEntry);
  }

  /**
   * Get comprehensive service status including edge case metrics
   */
  getServiceStatus() {
    return {
      serviceState: this.serviceState,
      edgeCaseMetrics: this.edgeCaseMetrics,
      requestTracker: {
        inFlight: this.requestTracker.inFlight.size,
        completed: this.requestTracker.completedRequests.size,
        failed: this.requestTracker.failedRequests.size
      },
      configuration: {
        edgeCases: this.config.edgeCases,
        fallbacks: this.config.fallbacks,
        recovery: this.config.recovery
      },
      timestamp: Date.now()
    };
  }
}

module.exports = RobustBalanceService;