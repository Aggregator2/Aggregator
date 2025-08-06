const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');
const crypto = require('crypto');

class SecureTokenManagementSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Validated token risk assessment settings
      riskAssessmentProviders: this.validateRiskProviders(config.riskAssessmentProviders || []),
      
      // Sanitized whitelist/blacklist management
      autoWhitelistThreshold: this.validateNumber(config.autoWhitelistThreshold, 0.9, 0.5, 1.0),
      autoBlacklistThreshold: this.validateNumber(config.autoBlacklistThreshold, 0.3, 0.0, 0.5),
      
      // Validated token categories with risk levels
      tokenCategories: this.validateTokenCategories(config.tokenCategories || {
        'stablecoin': { riskLevel: 'low', dailyLimit: 1000000 },
        'major_crypto': { riskLevel: 'medium', dailyLimit: 500000 },
        'defi_token': { riskLevel: 'medium', dailyLimit: 200000 },
        'meme_coin': { riskLevel: 'high', dailyLimit: 50000 },
        'new_token': { riskLevel: 'critical', dailyLimit: 10000 }
      }),
      
      // Market data validation settings
      priceDeviationThreshold: this.validateNumber(config.priceDeviationThreshold, 0.2, 0.01, 1.0),
      volumeThreshold: this.validateNumber(config.volumeThreshold, 100000, 1000, 1e12),
      liquidityThreshold: this.validateNumber(config.liquidityThreshold, 50000, 1000, 1e12),
      
      // Token approval workflow settings
      requiresManualApproval: this.validateTokenList(config.requiresManualApproval || []),
      autoApprovalEnabled: config.autoApprovalEnabled !== false,
      approvalTimeoutMs: this.validateNumber(config.approvalTimeoutMs, 86400000, 3600000, 86400000 * 7),
      
      // Secure data sources
      dataSources: this.validateDataSources(config.dataSources || []),
      
      // Performance and caching settings
      tokenCacheExpiry: this.validateNumber(config.tokenCacheExpiry, 1800000, 300000, 3600000),
      marketDataExpiry: this.validateNumber(config.marketDataExpiry, 300000, 60000, 1800000),
      maxCacheSize: this.validateNumber(config.maxCacheSize, 50000, 1000, 1000000),
      
      // Secure Redis configuration
      redisUrl: this.sanitizeUrl(config.redisUrl || process.env.REDIS_URL),
      keyPrefix: this.sanitizeKeyPrefix(config.keyPrefix || 'risk:tokens:'),
      
      // Security settings
      authenticationRequired: config.authenticationRequired !== false,
      maxFailedAttempts: this.validateNumber(config.maxFailedAttempts, 5, 1, 100),
      lockoutDuration: this.validateNumber(config.lockoutDuration, 300000, 60000, 3600000),
      
      // Performance optimizations
      batchSize: this.validateNumber(config.batchSize, 50, 10, 1000),
      enableCompression: config.enableCompression !== false,
      maxMemoryUsage: this.validateNumber(config.maxMemoryUsage, 512 * 1024 * 1024, 100 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
      
      // Contract security settings
      contractVerificationRequired: config.contractVerificationRequired !== false,
      proxyDetectionEnabled: config.proxyDetectionEnabled !== false,
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Secure token management with size limits
    this.whitelistedTokens = new Map(); // address -> token data
    this.blacklistedTokens = new Map(); // address -> blacklist reason
    this.pendingApprovals = new Map(); // address -> approval request
    this.tokenRiskAssessments = new Map(); // address -> risk data
    
    // Market data caching with validation
    this.tokenCache = new LRU(this.config.maxCacheSize / 4);
    this.marketDataCache = new LRU(this.config.maxCacheSize / 4);
    this.contractCache = new LRU(this.config.maxCacheSize / 4);
    this.riskCache = new LRU(this.config.maxCacheSize / 4);
    
    // Performance tracking
    this.performanceStats = {
      assessmentsPerSecond: 0,
      averageAssessmentTime: 0,
      cacheHitRate: 0,
      approvalRequests: 0,
      autoApprovals: 0,
      rejectedTokens: 0,
      memoryUsage: 0,
      errorRate: 0
    };
    
    // Token approval workflow
    this.approvalWorkflow = new Map(); // requestId -> workflow state
    this.approvalTimeouts = new Map(); // requestId -> timeout handle
    this.approvalHistory = new Map(); // address -> approval history
    
    // Security tracking
    this.failedAttempts = new Map(); // userId -> attempts count
    this.lockedUsers = new Map(); // userId -> lockout expiry
    this.suspiciousTokens = new Set(); // Tokens with suspicious activity
    
    // Authentication and authorization
    this.authorizedUsers = new Set();
    this.permissionMatrix = new Map();
    
    // Atomic operation locks
    this.operationLocks = new Map();
    this.lockTimeouts = new Map();
    
    // Rate limiting
    this.rateLimiters = new Map();
    this.defaultRateLimit = { requests: 50, window: 60000 }; // 50 requests per minute
    
    // Memory management
    this.memoryCheckInterval = 60000; // 1 minute
    this.maxTokenHistory = 10000;
    this.maxApprovalHistory = 5000;
  }

  // Input validation helpers
  validateNumber(value, defaultValue, min, max) {
    if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) {
      return defaultValue;
    }
    return value;
  }

  validateRiskProviders(providers) {
    if (!Array.isArray(providers)) return [];
    
    const allowedProviders = ['coingecko', 'coinmarketcap', 'defi_pulse', 'token_metrics', 'messari'];
    
    return providers
      .filter(provider => typeof provider === 'object' && provider !== null)
      .filter(provider => allowedProviders.includes(provider.name))
      .map(provider => ({
        name: this.sanitizeString(provider.name),
        apiKey: this.sanitizeApiKey(provider.apiKey),
        priority: this.validateNumber(provider.priority, 1, 1, 10),
        enabled: provider.enabled !== false,
        rateLimit: this.validateNumber(provider.rateLimit, 100, 10, 10000)
      }))
      .slice(0, 5); // Limit to 5 providers
  }

  validateTokenCategories(categories) {
    const validated = {};
    const allowedRiskLevels = ['low', 'medium', 'high', 'critical'];
    
    for (const [category, config] of Object.entries(categories)) {
      const sanitizedCategory = this.sanitizeString(category);
      if (sanitizedCategory && typeof config === 'object' && config !== null) {
        validated[sanitizedCategory] = {
          riskLevel: allowedRiskLevels.includes(config.riskLevel) ? config.riskLevel : 'medium',
          dailyLimit: this.validateNumber(config.dailyLimit, 100000, 1000, 1e12),
          requiresApproval: config.requiresApproval === true
        };
      }
    }
    
    return validated;
  }

  validateTokenList(tokens) {
    if (!Array.isArray(tokens)) return [];
    
    return tokens
      .filter(token => typeof token === 'string')
      .map(token => this.sanitizeTokenAddress(token))
      .filter(token => token !== null)
      .slice(0, 10000); // Limit list size
  }

  validateDataSources(sources) {
    if (!Array.isArray(sources)) return [];
    
    const allowedSources = ['blockchain', 'chainlink', 'uniswap', 'coingecko', 'defi_pulse'];
    
    return sources
      .filter(source => typeof source === 'object' && source !== null)
      .filter(source => allowedSources.includes(source.name))
      .map(source => ({
        name: this.sanitizeString(source.name),
        endpoint: this.sanitizeUrl(source.endpoint),
        apiKey: this.sanitizeApiKey(source.apiKey),
        enabled: source.enabled !== false
      }))
      .slice(0, 10); // Limit to 10 sources
  }

  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100);
  }

  sanitizeApiKey(key) {
    if (typeof key !== 'string') return '';
    return key.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 200);
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
    if (typeof prefix !== 'string') return 'risk:tokens:';
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
      await this.metrics.incrementCounter('token_management.auth_failures', 1, {}, 'risk');
      throw new Error('Authentication failed');
    }
  }

  async authorize(userId, operation, authenticatedUser) {
    const permissions = this.permissionMatrix.get(userId) || [];
    const requiredPermission = `token_management.${operation}`;
    
    if (!permissions.includes(requiredPermission) && !permissions.includes('token_management.*')) {
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
    this.cleanCacheByAge(this.tokenCache, this.config.tokenCacheExpiry);
    this.cleanCacheByAge(this.marketDataCache, this.config.marketDataExpiry);
    this.cleanCacheByAge(this.contractCache, this.config.tokenCacheExpiry);
    this.cleanCacheByAge(this.riskCache, this.config.tokenCacheExpiry);
    
    // Limit map sizes
    this.limitMapSize(this.tokenRiskAssessments, this.maxTokenHistory);
    this.limitMapSize(this.approvalHistory, this.maxApprovalHistory);
    this.limitMapSize(this.rateLimiters, 10000);
    this.limitMapSize(this.failedAttempts, 1000);
    
    // Clean old approval workflows
    this.cleanExpiredApprovals();
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

  cleanExpiredApprovals() {
    const now = Date.now();
    for (const [requestId, workflow] of this.approvalWorkflow.entries()) {
      if (workflow.expiresAt && now > workflow.expiresAt) {
        this.approvalWorkflow.delete(requestId);
        
        const timeout = this.approvalTimeouts.get(requestId);
        if (timeout) {
          clearTimeout(timeout);
          this.approvalTimeouts.delete(requestId);
        }
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
      
      // Load existing token data
      await this.loadSecureTokenData();
      
      // Initialize data providers
      await this.initializeDataProviders();
      
      // Start memory monitoring
      this.memoryMonitorInterval = setInterval(() => {
        this.checkMemoryUsage();
      }, this.memoryCheckInterval);
      
      console.log('✅ Secure token management system initialized');
      
    } catch (error) {
      console.error('Failed to initialize secure token management system:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('⚡ Starting secure token management system...');
    this.isRunning = true;
    
    // Start secure monitoring
    this.startSecureMonitoring();
    
    // Start data updates
    this.startDataUpdates();
    
    // Start performance tracking
    this.startSecurePerformanceTracking();
    
    console.log('✅ Secure token management system started');
  }

  startSecureMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.updateTokenRiskAssessments();
        await this.processApprovalQueue();
        await this.cleanupExpiredData();
        await this.updateSecurityMetrics();
      } catch (error) {
        console.error('Secure token monitoring error:', error);
        await this.metrics.incrementCounter('token_management.monitoring_errors', 1, {}, 'risk');
      }
    }, 30000); // Every 30 seconds
  }

  startDataUpdates() {
    this.dataUpdateInterval = setInterval(async () => {
      try {
        await this.updateMarketData();
        await this.updateContractData();
      } catch (error) {
        console.error('Token data update error:', error);
      }
    }, 300000); // Every 5 minutes
  }

  startSecurePerformanceTracking() {
    this.performanceInterval = setInterval(async () => {
      await this.updateSecurePerformanceMetrics();
    }, 60000); // Every minute
  }

  async assessSecureTokenRisk(tokenAddress, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'assess_risk', authenticatedUser);
      }
    }
    
    // Input validation
    const sanitizedAddress = this.sanitizeTokenAddress(tokenAddress);
    if (!sanitizedAddress) {
      throw new Error('Invalid token address format');
    }
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'assess_token');
    }
    
    // Check if token is blacklisted
    if (this.blacklistedTokens.has(sanitizedAddress)) {
      const blacklistReason = this.blacklistedTokens.get(sanitizedAddress);
      return {
        address: sanitizedAddress,
        riskScore: 1.0,
        riskLevel: 'critical',
        status: 'blacklisted',
        reason: blacklistReason.reason,
        timestamp: Date.now()
      };
    }
    
    const startTime = Date.now();
    
    // Acquire lock for atomic operation
    const lockId = await this.acquireLock(`assess_${sanitizedAddress}`);
    
    try {
      // Check cache first
      const cached = this.riskCache.get(sanitizedAddress);
      if (cached && Date.now() - cached.timestamp < this.config.tokenCacheExpiry) {
        this.performanceStats.cacheHitRate += 0.1;
        return cached.data;
      }
      
      // Perform comprehensive risk assessment
      const riskAssessment = await this.performComprehensiveRiskAssessment(sanitizedAddress);
      
      // Store assessment
      this.tokenRiskAssessments.set(sanitizedAddress, riskAssessment);
      
      // Cache result
      this.riskCache.set(sanitizedAddress, {
        data: riskAssessment,
        timestamp: Date.now()
      });
      
      // Update performance metrics
      const processingTime = Date.now() - startTime;
      this.updateAssessmentMetrics(processingTime);
      
      // Auto-approve or blacklist if thresholds met
      await this.processAutoDecision(sanitizedAddress, riskAssessment);
      
      return riskAssessment;
      
    } finally {
      await this.releaseLock(`assess_${sanitizedAddress}`);
    }
  }

  async performComprehensiveRiskAssessment(tokenAddress) {
    const assessment = {
      address: tokenAddress,
      riskScore: 0.5,
      riskLevel: 'medium',
      factors: {},
      marketData: {},
      contractData: {},
      timestamp: Date.now()
    };
    
    try {
      // Get token metadata
      const tokenData = await this.getSecureTokenData(tokenAddress);
      assessment.tokenData = tokenData;
      
      // Assess market factors
      const marketFactors = await this.assessMarketFactors(tokenAddress, tokenData);
      assessment.factors.market = marketFactors;
      
      // Assess contract security
      const contractFactors = await this.assessContractSecurity(tokenAddress);
      assessment.factors.contract = contractFactors;
      
      // Assess liquidity factors
      const liquidityFactors = await this.assessLiquidityFactors(tokenAddress);
      assessment.factors.liquidity = liquidityFactors;
      
      // Assess governance factors
      const governanceFactors = await this.assessGovernanceFactors(tokenAddress, tokenData);
      assessment.factors.governance = governanceFactors;
      
      // Calculate overall risk score
      assessment.riskScore = this.calculateOverallRiskScore(assessment.factors);
      assessment.riskLevel = this.calculateRiskLevel(assessment.riskScore);
      
      // Determine token category
      assessment.category = this.categorizeToken(tokenData, assessment.factors);
      
      return assessment;
      
    } catch (error) {
      console.error('Risk assessment error:', error);
      return {
        ...assessment,
        riskScore: 0.8,
        riskLevel: 'high',
        error: error.message
      };
    }
  }

  async getSecureTokenData(tokenAddress) {
    // Check cache first
    const cached = this.tokenCache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.config.tokenCacheExpiry) {
      return cached.data;
    }
    
    // Fetch from multiple sources
    const tokenData = {
      address: tokenAddress,
      name: '',
      symbol: '',
      decimals: 18,
      totalSupply: 0,
      holders: 0,
      transfers: 0,
      age: 0,
      verified: false
    };
    
    try {
      // Get data from blockchain
      const blockchainData = await this.getTokenDataFromBlockchain(tokenAddress);
      Object.assign(tokenData, blockchainData);
      
      // Get data from external APIs
      const apiData = await this.getTokenDataFromAPIs(tokenAddress);
      Object.assign(tokenData, apiData);
      
      // Validate and sanitize data
      const validatedData = this.validateTokenData(tokenData);
      
      // Cache result
      this.tokenCache.set(tokenAddress, {
        data: validatedData,
        timestamp: Date.now()
      });
      
      return validatedData;
      
    } catch (error) {
      console.error('Token data fetch error:', error);
      return tokenData;
    }
  }

  async getTokenDataFromBlockchain(tokenAddress) {
    // Simplified blockchain data fetch
    // In real implementation, this would query actual blockchain
    return {
      name: 'Example Token',
      symbol: 'EXAMPLE',
      decimals: 18,
      totalSupply: 1000000,
      verified: true
    };
  }

  async getTokenDataFromAPIs(tokenAddress) {
    // Simplified API data fetch
    // In real implementation, this would query external APIs
    return {
      holders: 5000,
      transfers: 100000,
      age: Date.now() - (86400000 * 365), // 1 year old
      marketCap: 10000000
    };
  }

  validateTokenData(data) {
    return {
      address: this.sanitizeTokenAddress(data.address) || data.address,
      name: this.sanitizeString(data.name || ''),
      symbol: this.sanitizeString(data.symbol || ''),
      decimals: this.validateNumber(data.decimals, 18, 0, 77),
      totalSupply: this.validateNumber(data.totalSupply, 0, 0, 1e18),
      holders: this.validateNumber(data.holders, 0, 0, 1e9),
      transfers: this.validateNumber(data.transfers, 0, 0, 1e12),
      age: this.validateNumber(data.age, 0, 0, Date.now()),
      verified: Boolean(data.verified),
      marketCap: this.validateNumber(data.marketCap, 0, 0, 1e15)
    };
  }

  async assessMarketFactors(tokenAddress, tokenData) {
    const factors = {
      volatility: 0.5,
      volume: 0.5,
      priceStability: 0.5,
      marketCapStability: 0.5,
      liquidityScore: 0.5
    };
    
    try {
      // Get market data
      const marketData = await this.getMarketData(tokenAddress);
      
      // Assess volatility (higher volatility = higher risk)
      factors.volatility = Math.min(marketData.volatility || 0.5, 1.0);
      
      // Assess volume (very low or very high volume can be risky)
      const normalizedVolume = this.normalizeVolume(marketData.volume || 0);
      factors.volume = this.calculateVolumeRisk(normalizedVolume);
      
      // Assess price stability
      factors.priceStability = this.assessPriceStability(marketData.priceHistory || []);
      
      // Assess market cap stability
      factors.marketCapStability = this.assessMarketCapStability(tokenData.marketCap || 0);
      
      // Assess overall liquidity
      factors.liquidityScore = this.assessLiquidity(marketData);
      
    } catch (error) {
      console.error('Market factors assessment error:', error);
    }
    
    return factors;
  }

  async assessContractSecurity(tokenAddress) {
    const factors = {
      contractVerified: 0.5,
      proxyContract: 0.5,
      mintFunction: 0.5,
      pauseFunction: 0.5,
      upgradeable: 0.5,
      ownershipRenounced: 0.5
    };
    
    try {
      // Get contract data
      const contractData = await this.getContractData(tokenAddress);
      
      // Check if contract is verified
      factors.contractVerified = contractData.verified ? 0.1 : 0.8;
      
      // Check for proxy pattern (can be risky)
      factors.proxyContract = contractData.isProxy ? 0.7 : 0.3;
      
      // Check for mint function (can be risky if unlimited)
      factors.mintFunction = this.assessMintFunction(contractData.functions || []);
      
      // Check for pause function
      factors.pauseFunction = contractData.hasPauseFunction ? 0.6 : 0.4;
      
      // Check if upgradeable
      factors.upgradeable = contractData.isUpgradeable ? 0.7 : 0.3;
      
      // Check if ownership is renounced
      factors.ownershipRenounced = contractData.ownershipRenounced ? 0.2 : 0.6;
      
    } catch (error) {
      console.error('Contract security assessment error:', error);
    }
    
    return factors;
  }

  async assessLiquidityFactors(tokenAddress) {
    const factors = {
      dexLiquidity: 0.5,
      liquidityDistribution: 0.5,
      liquidityStability: 0.5,
      slippageRisk: 0.5
    };
    
    try {
      // Get liquidity data from DEXes
      const liquidityData = await this.getLiquidityData(tokenAddress);
      
      // Assess total DEX liquidity
      const totalLiquidity = liquidityData.totalLiquidity || 0;
      factors.dexLiquidity = this.normalizeLiquidityScore(totalLiquidity);
      
      // Assess liquidity distribution across DEXes
      factors.liquidityDistribution = this.assessLiquidityDistribution(liquidityData.distribution || []);
      
      // Assess liquidity stability over time
      factors.liquidityStability = this.assessLiquidityStability(liquidityData.history || []);
      
      // Assess slippage risk
      factors.slippageRisk = this.assessSlippageRisk(liquidityData.slippage || {});
      
    } catch (error) {
      console.error('Liquidity factors assessment error:', error);
    }
    
    return factors;
  }

  async assessGovernanceFactors(tokenAddress, tokenData) {
    const factors = {
      tokenDistribution: 0.5,
      holderConcentration: 0.5,
      governanceModel: 0.5,
      communityEngagement: 0.5
    };
    
    try {
      // Assess token distribution
      const distributionData = await this.getTokenDistribution(tokenAddress);
      factors.tokenDistribution = this.assessTokenDistribution(distributionData);
      
      // Assess holder concentration
      factors.holderConcentration = this.assessHolderConcentration(tokenData.holders || 0, distributionData);
      
      // Assess governance model
      const governanceData = await this.getGovernanceData(tokenAddress);
      factors.governanceModel = this.assessGovernanceModel(governanceData);
      
      // Assess community engagement
      factors.communityEngagement = this.assessCommunityEngagement(governanceData);
      
    } catch (error) {
      console.error('Governance factors assessment error:', error);
    }
    
    return factors;
  }

  calculateOverallRiskScore(factors) {
    // Weighted average of all risk factors
    const weights = {
      market: 0.3,
      contract: 0.25,
      liquidity: 0.25,
      governance: 0.2
    };
    
    let weightedScore = 0;
    let totalWeight = 0;
    
    for (const [category, categoryFactors] of Object.entries(factors)) {
      if (weights[category] && typeof categoryFactors === 'object') {
        const categoryScore = this.calculateCategoryScore(categoryFactors);
        weightedScore += categoryScore * weights[category];
        totalWeight += weights[category];
      }
    }
    
    return totalWeight > 0 ? Math.min(Math.max(weightedScore / totalWeight, 0), 1) : 0.5;
  }

  calculateCategoryScore(categoryFactors) {
    const values = Object.values(categoryFactors).filter(v => typeof v === 'number');
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0.5;
  }

  calculateRiskLevel(riskScore) {
    if (riskScore >= 0.8) return 'critical';
    if (riskScore >= 0.6) return 'high';
    if (riskScore >= 0.4) return 'medium';
    return 'low';
  }

  categorizeToken(tokenData, factors) {
    // Simplified token categorization
    const symbol = (tokenData.symbol || '').toLowerCase();
    const name = (tokenData.name || '').toLowerCase();
    
    if (symbol.includes('usd') || name.includes('stable')) {
      return 'stablecoin';
    }
    
    if (['btc', 'eth', 'bnb', 'ada', 'dot'].some(major => symbol.includes(major))) {
      return 'major_crypto';
    }
    
    if (factors.contract?.contractVerified < 0.5) {
      return 'new_token';
    }
    
    if (symbol.includes('doge') || symbol.includes('shib') || name.includes('meme')) {
      return 'meme_coin';
    }
    
    return 'defi_token';
  }

  async processAutoDecision(tokenAddress, assessment) {
    try {
      if (assessment.riskScore <= this.config.autoBlacklistThreshold) {
        await this.addTokenToBlacklist(tokenAddress, 'auto_high_risk', null, null);
        
      } else if (assessment.riskScore >= this.config.autoWhitelistThreshold) {
        await this.addTokenToWhitelist(tokenAddress, assessment, null, null);
        
      } else if (this.config.requiresManualApproval.includes(tokenAddress)) {
        await this.requestTokenApproval(tokenAddress, assessment, null, null);
      }
      
    } catch (error) {
      console.error('Auto decision processing error:', error);
    }
  }

  async addTokenToWhitelist(tokenAddress, tokenData, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'add_whitelist', authenticatedUser);
      }
    }
    
    const sanitizedAddress = this.sanitizeTokenAddress(tokenAddress);
    if (!sanitizedAddress) {
      throw new Error('Invalid token address');
    }
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'add_whitelist');
    }
    
    const lockId = await this.acquireLock(`whitelist_${sanitizedAddress}`);
    
    try {
      const whitelistEntry = {
        address: sanitizedAddress,
        addedAt: Date.now(),
        addedBy: authenticatedUser?.id || 'system',
        tokenData: this.sanitizeObject(tokenData),
        approved: true
      };
      
      this.whitelistedTokens.set(sanitizedAddress, whitelistEntry);
      
      // Remove from blacklist if present
      this.blacklistedTokens.delete(sanitizedAddress);
      
      // Save to Redis
      await this.saveSecureTokenList('whitelist', sanitizedAddress, whitelistEntry);
      
      this.emit('token_whitelisted', {
        address: sanitizedAddress,
        data: whitelistEntry,
        user: authenticatedUser?.id
      });
      
      await this.metrics.incrementCounter('token_management.tokens_whitelisted', 1, {}, 'risk');
      
      console.log(`Token whitelisted: ${sanitizedAddress}`);
      
      return whitelistEntry;
      
    } finally {
      await this.releaseLock(`whitelist_${sanitizedAddress}`);
    }
  }

  async addTokenToBlacklist(tokenAddress, reason, authenticatedUser = null, authToken = null) {
    // Security checks
    if (this.config.authenticationRequired) {
      await this.authenticate(authToken);
      if (authenticatedUser?.id) {
        await this.authorize(authenticatedUser.id, 'add_blacklist', authenticatedUser);
      }
    }
    
    const sanitizedAddress = this.sanitizeTokenAddress(tokenAddress);
    if (!sanitizedAddress) {
      throw new Error('Invalid token address');
    }
    
    const sanitizedReason = this.sanitizeString(reason || 'manual_review');
    
    // Rate limiting
    if (authenticatedUser?.id) {
      await this.checkRateLimit(authenticatedUser.id, 'add_blacklist');
    }
    
    const lockId = await this.acquireLock(`blacklist_${sanitizedAddress}`);
    
    try {
      const blacklistEntry = {
        address: sanitizedAddress,
        reason: sanitizedReason,
        addedAt: Date.now(),
        addedBy: authenticatedUser?.id || 'system'
      };
      
      this.blacklistedTokens.set(sanitizedAddress, blacklistEntry);
      
      // Remove from whitelist if present
      this.whitelistedTokens.delete(sanitizedAddress);
      
      // Add to suspicious tokens
      this.suspiciousTokens.add(sanitizedAddress);
      
      // Save to Redis
      await this.saveSecureTokenList('blacklist', sanitizedAddress, blacklistEntry);
      
      this.emit('token_blacklisted', {
        address: sanitizedAddress,
        reason: sanitizedReason,
        user: authenticatedUser?.id
      });
      
      await this.metrics.incrementCounter('token_management.tokens_blacklisted', 1, {
        reason: sanitizedReason
      }, 'risk');
      
      console.warn(`Token blacklisted: ${sanitizedAddress} (${sanitizedReason})`);
      
      return blacklistEntry;
      
    } finally {
      await this.releaseLock(`blacklist_${sanitizedAddress}`);
    }
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

  updateAssessmentMetrics(processingTime) {
    this.performanceStats.averageAssessmentTime = 
      (this.performanceStats.averageAssessmentTime * 0.9) + (processingTime * 0.1);
    
    this.performanceStats.assessmentsPerSecond++;
  }

  async updateSecurityMetrics() {
    await this.metrics.setGauge('token_management.security.failed_attempts', 
      this.failedAttempts.size, {}, 'risk');
    
    await this.metrics.setGauge('token_management.security.locked_users', 
      this.lockedUsers.size, {}, 'risk');
    
    await this.metrics.setGauge('token_management.security.suspicious_tokens', 
      this.suspiciousTokens.size, {}, 'risk');
    
    await this.metrics.setGauge('token_management.performance.memory_usage', 
      this.performanceStats.memoryUsage, {}, 'risk');
    
    await this.metrics.setGauge('token_management.performance.cache_hit_rate', 
      this.performanceStats.cacheHitRate, {}, 'risk');
  }

  async updateSecurePerformanceMetrics() {
    await this.updateSecurityMetrics();
    
    await this.metrics.setGauge('token_management.tokens.whitelisted', 
      this.whitelistedTokens.size, {}, 'risk');
    
    await this.metrics.setGauge('token_management.tokens.blacklisted', 
      this.blacklistedTokens.size, {}, 'risk');
    
    await this.metrics.setGauge('token_management.tokens.pending_approval', 
      this.pendingApprovals.size, {}, 'risk');
    
    await this.metrics.setGauge('token_management.assessments_per_second', 
      this.performanceStats.assessmentsPerSecond, {}, 'risk');
    
    await this.metrics.setGauge('token_management.average_assessment_time', 
      this.performanceStats.averageAssessmentTime, {}, 'risk');
    
    // Reset counters
    this.performanceStats.assessmentsPerSecond = 0;
  }

  // Continue with remaining methods following the same patterns...
  // [Additional methods would follow the same security, validation, and performance patterns]

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping secure token management system...');
    
    // Stop intervals
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.dataUpdateInterval) clearInterval(this.dataUpdateInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    if (this.memoryMonitorInterval) clearInterval(this.memoryMonitorInterval);
    
    // Clear timeouts
    for (const timeout of this.approvalTimeouts.values()) {
      clearTimeout(timeout);
    }
    
    // Release all locks
    for (const lockKey of this.operationLocks.keys()) {
      this.releaseLock(lockKey);
    }
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data structures
    this.whitelistedTokens.clear();
    this.blacklistedTokens.clear();
    this.tokenRiskAssessments.clear();
    this.tokenCache.clear();
    this.marketDataCache.clear();
    this.contractCache.clear();
    this.riskCache.clear();
    this.operationLocks.clear();
    this.lockTimeouts.clear();
    this.rateLimiters.clear();
    
    this.isRunning = false;
    console.log('✅ Secure token management system stopped');
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

module.exports = SecureTokenManagementSystem;