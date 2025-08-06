const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

class TokenManagementSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Default token lists
      defaultWhitelist: config.defaultWhitelist || [
        'ETH', 'BTC', 'USDC', 'USDT', 'DAI', 'WETH', 'WBTC'
      ],
      
      // Automatic blacklist criteria
      autoBlacklistCriteria: config.autoBlacklistCriteria || {
        volatilityThreshold: 0.5, // 50% price change in 1 hour
        liquidityThreshold: 10000, // Minimum $10k liquidity
        volumeThreshold: 1000, // Minimum $1k 24h volume
        marketCapThreshold: 100000, // Minimum $100k market cap
        ageThreshold: 86400000 * 7, // 7 days since creation
      },
      
      // Risk categories
      riskCategories: config.riskCategories || {
        stable: { maxVolatility: 0.05, minLiquidity: 1000000 },
        low: { maxVolatility: 0.15, minLiquidity: 500000 },
        medium: { maxVolatility: 0.3, minLiquidity: 100000 },
        high: { maxVolatility: 0.5, minLiquidity: 50000 },
        extreme: { maxVolatility: 1.0, minLiquidity: 10000 }
      },
      
      // Compliance frameworks
      complianceFrameworks: config.complianceFrameworks || {
        OFAC: { enabled: true, priority: 'critical' },
        EU_SANCTIONS: { enabled: true, priority: 'high' },
        FATF_TRAVEL_RULE: { enabled: true, priority: 'medium' }
      },
      
      // Token data sources
      dataSources: config.dataSources || [
        { name: 'coingecko', priority: 1, apiKey: process.env.COINGECKO_API_KEY },
        { name: 'coinmarketcap', priority: 2, apiKey: process.env.CMC_API_KEY },
        { name: 'defipulse', priority: 3, apiKey: process.env.DEFIPULSE_API_KEY }
      ],
      
      // Update intervals
      priceUpdateInterval: config.priceUpdateInterval || 60000, // 1 minute
      metadataUpdateInterval: config.metadataUpdateInterval || 3600000, // 1 hour
      complianceUpdateInterval: config.complianceUpdateInterval || 86400000, // 24 hours
      
      // Cache settings
      tokenCacheExpiry: config.tokenCacheExpiry || 300000, // 5 minutes
      priceCacheExpiry: config.priceCacheExpiry || 60000, // 1 minute
      maxCacheSize: config.maxCacheSize || 10000,
      
      // Security settings
      requireManualApproval: config.requireManualApproval !== false,
      autoApprovalThreshold: config.autoApprovalThreshold || 0.9, // 90% confidence
      maxTokensPerUser: config.maxTokensPerUser || 50,
      
      // Redis configuration
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      keyPrefix: config.keyPrefix || 'risk:tokens:',
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Token management data
    this.whitelist = new Set(this.config.defaultWhitelist); // Approved tokens
    this.blacklist = new Set(); // Banned tokens
    this.graylist = new Set(); // Under review tokens
    this.pendingApproval = new Map(); // tokenId -> approval request
    
    // Token metadata and pricing
    this.tokenMetadata = new Map(); // tokenId -> metadata
    this.tokenPrices = new Map(); // tokenId -> price data
    this.tokenRiskScores = new Map(); // tokenId -> risk assessment
    
    // Market data cache
    this.marketDataCache = new Map(); // tokenId -> market data
    this.liquidityData = new Map(); // tokenId -> liquidity info
    this.volumeData = new Map(); // tokenId -> volume info
    
    // Compliance tracking
    this.complianceStatus = new Map(); // tokenId -> compliance checks
    this.sanctionedTokens = new Set(); // Tokens on sanction lists
    
    // User preferences and overrides
    this.userTokenLists = new Map(); // userId -> custom token list
    this.userRestrictions = new Map(); // userId -> restrictions
    
    // Data providers
    this.dataProviders = new Map();
    this.rateLimiters = new Map();
    
    // Performance tracking
    this.performanceStats = {
      tokensTracked: 0,
      whitelistSize: 0,
      blacklistSize: 0,
      priceUpdatesPerSecond: 0,
      complianceChecks: 0,
      riskAssessments: 0
    };
  }

  async initialize() {
    try {
      // Initialize Redis connection
      const Redis = require('redis');
      this.redis = Redis.createClient({ url: this.config.redisUrl });
      await this.redis.connect();
      
      // Initialize data providers
      await this.initializeDataProviders();
      
      // Load existing token lists
      await this.loadTokenLists();
      
      // Load token metadata and prices
      await this.loadTokenData();
      
      // Load compliance data
      await this.loadComplianceData();
      
      // Initialize rate limiters
      this.initializeRateLimiters();
      
      console.log('✅ Token management system initialized');
      
    } catch (error) {
      console.error('Failed to initialize token management system:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🪙 Starting token management system...');
    this.isRunning = true;
    
    // Start price updates
    this.startPriceUpdates();
    
    // Start metadata updates
    this.startMetadataUpdates();
    
    // Start compliance monitoring
    this.startComplianceMonitoring();
    
    // Start risk assessment
    this.startRiskAssessment();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Token management system started');
  }

  startPriceUpdates() {
    this.priceUpdateInterval = setInterval(async () => {
      try {
        await this.updateTokenPrices();
      } catch (error) {
        console.error('Price update error:', error);
        await this.metrics.incrementCounter('token_management.price_update_errors', 1, {}, 'risk');
      }
    }, this.config.priceUpdateInterval);
  }

  startMetadataUpdates() {
    this.metadataUpdateInterval = setInterval(async () => {
      try {
        await this.updateTokenMetadata();
      } catch (error) {
        console.error('Metadata update error:', error);
      }
    }, this.config.metadataUpdateInterval);
  }

  startComplianceMonitoring() {
    this.complianceInterval = setInterval(async () => {
      try {
        await this.updateComplianceData();
        await this.performComplianceChecks();
      } catch (error) {
        console.error('Compliance monitoring error:', error);
      }
    }, this.config.complianceUpdateInterval);
  }

  startRiskAssessment() {
    this.riskAssessmentInterval = setInterval(async () => {
      try {
        await this.performRiskAssessments();
      } catch (error) {
        console.error('Risk assessment error:', error);
      }
    }, 1800000); // Every 30 minutes
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 30000); // Every 30 seconds
  }

  async initializeDataProviders() {
    for (const source of this.config.dataSources) {
      if (source.apiKey) {
        this.dataProviders.set(source.name, {
          ...source,
          client: this.createDataClient(source)
        });
      }
    }
  }

  createDataClient(source) {
    const https = require('https');
    
    return {
      fetchTokenData: async (tokenId) => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Token data fetch timeout'));
          }, 10000);
          
          try {
            const url = this.buildTokenDataUrl(source, tokenId);
            const headers = this.getDataHeaders(source);
            
            const req = https.get(url, { headers }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                clearTimeout(timeout);
                try {
                  const result = JSON.parse(data);
                  resolve(this.parseTokenDataResponse(source, result));
                } catch (error) {
                  reject(error);
                }
              });
            });
            
            req.on('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
            
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      },
      
      fetchMarketData: async (tokenId) => {
        // Similar implementation for market data
        return this.fetchMarketDataFromProvider(source, tokenId);
      }
    };
  }

  buildTokenDataUrl(source, tokenId) {
    const urls = {
      coingecko: `https://api.coingecko.com/api/v3/coins/${tokenId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
      coinmarketcap: `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${tokenId}`,
      defipulse: `https://data-api.defipulse.com/api/v1/egs/api/ethgasAPI.json?api-key=${source.apiKey}`
    };
    
    return urls[source.name] || '';
  }

  getDataHeaders(source) {
    const headers = { 'User-Agent': 'DEX-Token-Manager/1.0' };
    
    if (source.name === 'coinmarketcap') {
      headers['X-CMC_PRO_API_KEY'] = source.apiKey;
    }
    
    return headers;
  }

  parseTokenDataResponse(source, response) {
    const parsers = {
      coingecko: (data) => ({
        id: data.id,
        symbol: data.symbol?.toUpperCase(),
        name: data.name,
        description: data.description?.en,
        homepage: data.links?.homepage?.[0],
        blockchain: data.asset_platform_id,
        contractAddress: data.contract_address,
        marketCap: data.market_data?.market_cap?.usd,
        volume24h: data.market_data?.total_volume?.usd,
        price: data.market_data?.current_price?.usd,
        priceChange24h: data.market_data?.price_change_percentage_24h,
        circulatingSupply: data.market_data?.circulating_supply,
        totalSupply: data.market_data?.total_supply,
        maxSupply: data.market_data?.max_supply,
        ath: data.market_data?.ath?.usd,
        atl: data.market_data?.atl?.usd,
        lastUpdated: data.last_updated,
        provider: 'coingecko'
      }),
      
      coinmarketcap: (data) => {
        const tokenData = Object.values(data.data)[0];
        return {
          id: tokenData.id,
          symbol: tokenData.symbol,
          name: tokenData.name,
          marketCap: tokenData.quote?.USD?.market_cap,
          volume24h: tokenData.quote?.USD?.volume_24h,
          price: tokenData.quote?.USD?.price,
          priceChange24h: tokenData.quote?.USD?.percent_change_24h,
          circulatingSupply: tokenData.circulating_supply,
          totalSupply: tokenData.total_supply,
          maxSupply: tokenData.max_supply,
          lastUpdated: tokenData.last_updated,
          provider: 'coinmarketcap'
        };
      }
    };
    
    const parser = parsers[source.name];
    return parser ? parser(response) : {};
  }

  async fetchMarketDataFromProvider(source, tokenId) {
    // Simplified market data fetching
    // In production, this would fetch detailed market data
    return {
      liquidity: Math.random() * 1000000,
      volume24h: Math.random() * 500000,
      volatility: Math.random() * 0.5,
      lastUpdated: Date.now()
    };
  }

  async addTokenToWhitelist(tokenId, approver = 'system', metadata = {}) {
    try {
      // Validate token
      await this.validateToken(tokenId);
      
      // Perform compliance check
      const complianceResult = await this.checkTokenCompliance(tokenId);
      if (!complianceResult.compliant) {
        throw new Error(`Token failed compliance check: ${complianceResult.reason}`);
      }
      
      // Perform risk assessment
      const riskAssessment = await this.assessTokenRisk(tokenId);
      
      // Add to whitelist
      this.whitelist.add(tokenId);
      this.blacklist.delete(tokenId);
      this.graylist.delete(tokenId);
      
      // Store metadata
      const tokenData = {
        id: tokenId,
        status: 'whitelisted',
        approvedBy: approver,
        approvedAt: Date.now(),
        complianceResult,
        riskAssessment,
        metadata,
        ...metadata
      };
      
      this.tokenMetadata.set(tokenId, tokenData);
      
      // Store in Redis
      await this.saveTokenLists();
      await this.redis.hSet(
        `${this.config.keyPrefix}metadata`,
        tokenId,
        JSON.stringify(tokenData)
      );
      
      // Emit event
      this.emit('token_whitelisted', {
        tokenId,
        approver,
        timestamp: Date.now(),
        riskScore: riskAssessment.riskScore
      });
      
      // Update metrics
      await this.metrics.incrementCounter('token_management.tokens_whitelisted', 1, {
        approver: approver === 'system' ? 'automatic' : 'manual'
      }, 'risk');
      
      console.log(`Token whitelisted: ${tokenId} by ${approver}`);
      
      return tokenData;
      
    } catch (error) {
      console.error(`Failed to whitelist token ${tokenId}:`, error);
      throw error;
    }
  }

  async addTokenToBlacklist(tokenId, reason, approver = 'system') {
    try {
      // Add to blacklist
      this.blacklist.add(tokenId);
      this.whitelist.delete(tokenId);
      this.graylist.delete(tokenId);
      
      // Store blacklist metadata
      const blacklistData = {
        id: tokenId,
        status: 'blacklisted',
        reason,
        blacklistedBy: approver,
        blacklistedAt: Date.now()
      };
      
      this.tokenMetadata.set(tokenId, blacklistData);
      
      // Store in Redis
      await this.saveTokenLists();
      await this.redis.hSet(
        `${this.config.keyPrefix}metadata`,
        tokenId,
        JSON.stringify(blacklistData)
      );
      
      // Emit event
      this.emit('token_blacklisted', {
        tokenId,
        reason,
        approver,
        timestamp: Date.now()
      });
      
      // Update metrics
      await this.metrics.incrementCounter('token_management.tokens_blacklisted', 1, {
        reason: reason.replace(/\s+/g, '_').toLowerCase()
      }, 'risk');
      
      console.log(`Token blacklisted: ${tokenId} - ${reason}`);
      
      return blacklistData;
      
    } catch (error) {
      console.error(`Failed to blacklist token ${tokenId}:`, error);
      throw error;
    }
  }

  async requestTokenApproval(tokenId, requestedBy, justification = '') {
    try {
      // Check if already in a list
      if (this.whitelist.has(tokenId)) {
        throw new Error('Token is already whitelisted');
      }
      
      if (this.blacklist.has(tokenId)) {
        throw new Error('Token is blacklisted and cannot be approved');
      }
      
      // Fetch token data
      const tokenData = await this.fetchTokenData(tokenId);
      
      // Perform initial risk assessment
      const riskAssessment = await this.assessTokenRisk(tokenId);
      
      // Perform compliance check
      const complianceResult = await this.checkTokenCompliance(tokenId);
      
      // Create approval request
      const approvalRequest = {
        tokenId,
        requestedBy,
        justification,
        tokenData,
        riskAssessment,
        complianceResult,
        status: 'pending',
        requestedAt: Date.now(),
        id: this.generateRequestId()
      };
      
      // Add to graylist and pending approval
      this.graylist.add(tokenId);
      this.pendingApproval.set(tokenId, approvalRequest);
      
      // Check if meets auto-approval criteria
      if (this.shouldAutoApprove(riskAssessment, complianceResult)) {
        await this.processAutoApproval(approvalRequest);
      } else {
        // Require manual approval
        this.emit('approval_required', approvalRequest);
      }
      
      // Store in Redis
      await this.redis.hSet(
        `${this.config.keyPrefix}pending`,
        tokenId,
        JSON.stringify(approvalRequest)
      );
      
      // Update metrics
      await this.metrics.incrementCounter('token_management.approval_requests', 1, {
        riskLevel: riskAssessment.riskLevel
      }, 'risk');
      
      return approvalRequest;
      
    } catch (error) {
      console.error(`Failed to request token approval for ${tokenId}:`, error);
      throw error;
    }
  }

  shouldAutoApprove(riskAssessment, complianceResult) {
    return complianceResult.compliant &&
           riskAssessment.confidence >= this.config.autoApprovalThreshold &&
           riskAssessment.riskLevel !== 'extreme' &&
           riskAssessment.riskScore < 0.7;
  }

  async processAutoApproval(approvalRequest) {
    try {
      await this.addTokenToWhitelist(
        approvalRequest.tokenId,
        'auto_approval',
        approvalRequest.tokenData
      );
      
      approvalRequest.status = 'auto_approved';
      approvalRequest.approvedAt = Date.now();
      
      this.pendingApproval.delete(approvalRequest.tokenId);
      
      this.emit('token_auto_approved', approvalRequest);
      
      console.log(`Token auto-approved: ${approvalRequest.tokenId}`);
      
    } catch (error) {
      console.error(`Auto-approval failed for ${approvalRequest.tokenId}:`, error);
      approvalRequest.status = 'auto_approval_failed';
      approvalRequest.error = error.message;
    }
  }

  async approveTokenRequest(tokenId, approver, notes = '') {
    const request = this.pendingApproval.get(tokenId);
    if (!request) {
      throw new Error(`No pending approval request found for token ${tokenId}`);
    }
    
    try {
      await this.addTokenToWhitelist(tokenId, approver, request.tokenData);
      
      request.status = 'approved';
      request.approvedBy = approver;
      request.approvedAt = Date.now();
      request.notes = notes;
      
      this.pendingApproval.delete(tokenId);
      
      // Remove from Redis pending
      await this.redis.hDel(`${this.config.keyPrefix}pending`, tokenId);
      
      this.emit('token_request_approved', request);
      
      return request;
      
    } catch (error) {
      console.error(`Failed to approve token request for ${tokenId}:`, error);
      throw error;
    }
  }

  async rejectTokenRequest(tokenId, approver, reason) {
    const request = this.pendingApproval.get(tokenId);
    if (!request) {
      throw new Error(`No pending approval request found for token ${tokenId}`);
    }
    
    request.status = 'rejected';
    request.rejectedBy = approver;
    request.rejectedAt = Date.now();
    request.rejectionReason = reason;
    
    this.graylist.delete(tokenId);
    this.pendingApproval.delete(tokenId);
    
    // Remove from Redis pending
    await this.redis.hDel(`${this.config.keyPrefix}pending`, tokenId);
    
    this.emit('token_request_rejected', request);
    
    return request;
  }

  async validateToken(tokenId) {
    // Basic token validation
    if (!tokenId || typeof tokenId !== 'string') {
      throw new Error('Invalid token ID');
    }
    
    if (tokenId.length < 2 || tokenId.length > 20) {
      throw new Error('Token ID must be between 2 and 20 characters');
    }
    
    // Check if token exists and has valid data
    const tokenData = await this.fetchTokenData(tokenId);
    if (!tokenData || !tokenData.price) {
      throw new Error('Token data not available or invalid');
    }
    
    return true;
  }

  async fetchTokenData(tokenId) {
    // Try data providers in priority order
    const providers = Array.from(this.dataProviders.values())
      .sort((a, b) => a.priority - b.priority);
    
    for (const provider of providers) {
      try {
        if (!this.canMakeRequest(provider.name)) {
          continue;
        }
        
        const data = await provider.client.fetchTokenData(tokenId);
        if (data && data.price) {
          this.recordRequest(provider.name, true);
          return data;
        }
        
      } catch (error) {
        console.warn(`Token data fetch failed for provider ${provider.name}:`, error);
        this.recordRequest(provider.name, false);
      }
    }
    
    // Return cached data if available
    const cached = this.tokenMetadata.get(tokenId);
    if (cached) {
      return cached;
    }
    
    throw new Error(`Failed to fetch token data for ${tokenId}`);
  }

  async assessTokenRisk(tokenId) {
    try {
      // Fetch token data and market data
      const tokenData = await this.fetchTokenData(tokenId);
      const marketData = await this.fetchMarketData(tokenId);
      
      // Calculate risk factors
      const riskFactors = {
        volatility: this.calculateVolatilityRisk(tokenData, marketData),
        liquidity: this.calculateLiquidityRisk(marketData),
        volume: this.calculateVolumeRisk(marketData),
        marketCap: this.calculateMarketCapRisk(tokenData),
        age: this.calculateAgeRisk(tokenData),
        compliance: await this.calculateComplianceRisk(tokenId)
      };
      
      // Calculate overall risk score
      const riskScore = this.calculateOverallRiskScore(riskFactors);
      const riskLevel = this.determineRiskLevel(riskScore);
      const confidence = this.calculateConfidence(tokenData, marketData);
      
      const assessment = {
        tokenId,
        riskScore,
        riskLevel,
        confidence,
        riskFactors,
        assessedAt: Date.now(),
        assessedBy: 'risk_engine'
      };
      
      // Store assessment
      this.tokenRiskScores.set(tokenId, assessment);
      
      // Update metrics
      await this.metrics.incrementCounter('token_management.risk_assessments', 1, {
        riskLevel
      }, 'risk');
      
      this.performanceStats.riskAssessments++;
      
      return assessment;
      
    } catch (error) {
      console.error(`Risk assessment failed for token ${tokenId}:`, error);
      
      return {
        tokenId,
        riskScore: 1.0, // Maximum risk for failed assessment
        riskLevel: 'extreme',
        confidence: 0,
        error: error.message,
        assessedAt: Date.now()
      };
    }
  }

  calculateVolatilityRisk(tokenData, marketData) {
    const priceChange24h = Math.abs(tokenData.priceChange24h || 0) / 100;
    const volatility = marketData.volatility || priceChange24h;
    
    // Normalize volatility to risk score [0, 1]
    return Math.min(1, volatility / 0.5); // 50% volatility = max risk
  }

  calculateLiquidityRisk(marketData) {
    const liquidity = marketData.liquidity || 0;
    const threshold = this.config.autoBlacklistCriteria.liquidityThreshold;
    
    if (liquidity >= threshold * 10) return 0; // Very liquid
    if (liquidity >= threshold) return 0.3; // Adequate liquidity
    if (liquidity >= threshold / 2) return 0.6; // Low liquidity
    return 1; // Very low liquidity
  }

  calculateVolumeRisk(marketData) {
    const volume = marketData.volume24h || 0;
    const threshold = this.config.autoBlacklistCriteria.volumeThreshold;
    
    if (volume >= threshold * 100) return 0; // High volume
    if (volume >= threshold * 10) return 0.2; // Good volume
    if (volume >= threshold) return 0.5; // Adequate volume
    return 1; // Low volume
  }

  calculateMarketCapRisk(tokenData) {
    const marketCap = tokenData.marketCap || 0;
    const threshold = this.config.autoBlacklistCriteria.marketCapThreshold;
    
    if (marketCap >= threshold * 1000) return 0; // Large cap
    if (marketCap >= threshold * 100) return 0.2; // Mid cap
    if (marketCap >= threshold * 10) return 0.4; // Small cap
    if (marketCap >= threshold) return 0.7; // Micro cap
    return 1; // Nano cap
  }

  calculateAgeRisk(tokenData) {
    const age = Date.now() - new Date(tokenData.lastUpdated || Date.now()).getTime();
    const threshold = this.config.autoBlacklistCriteria.ageThreshold;
    
    if (age >= threshold * 52) return 0; // > 1 year
    if (age >= threshold * 4) return 0.2; // > 1 month
    if (age >= threshold) return 0.5; // > 1 week
    return 1; // Very new
  }

  async calculateComplianceRisk(tokenId) {
    const complianceResult = await this.checkTokenCompliance(tokenId);
    
    if (!complianceResult.compliant) return 1;
    if (complianceResult.warnings.length > 0) return 0.5;
    return 0;
  }

  calculateOverallRiskScore(riskFactors) {
    const weights = {
      volatility: 0.2,
      liquidity: 0.25,
      volume: 0.15,
      marketCap: 0.15,
      age: 0.1,
      compliance: 0.15
    };
    
    let totalScore = 0;
    for (const [factor, score] of Object.entries(riskFactors)) {
      totalScore += (score || 0) * (weights[factor] || 0);
    }
    
    return Math.min(1, Math.max(0, totalScore));
  }

  determineRiskLevel(riskScore) {
    if (riskScore <= 0.2) return 'stable';
    if (riskScore <= 0.4) return 'low';
    if (riskScore <= 0.6) return 'medium';
    if (riskScore <= 0.8) return 'high';
    return 'extreme';
  }

  calculateConfidence(tokenData, marketData) {
    let confidence = 0.5; // Base confidence
    
    // Increase confidence based on data availability
    if (tokenData.marketCap) confidence += 0.1;
    if (tokenData.volume24h) confidence += 0.1;
    if (marketData.liquidity) confidence += 0.1;
    if (tokenData.contractAddress) confidence += 0.1;
    if (tokenData.description) confidence += 0.1;
    
    return Math.min(1, confidence);
  }

  async checkTokenCompliance(tokenId) {
    const compliance = {
      compliant: true,
      frameworks: {},
      warnings: [],
      violations: []
    };
    
    try {
      // Check each enabled compliance framework
      for (const [framework, config] of Object.entries(this.config.complianceFrameworks)) {
        if (config.enabled) {
          const result = await this.checkFrameworkCompliance(framework, tokenId);
          compliance.frameworks[framework] = result;
          
          if (!result.compliant) {
            compliance.compliant = false;
            compliance.violations.push({
              framework,
              reason: result.reason,
              severity: config.priority
            });
          }
          
          if (result.warnings.length > 0) {
            compliance.warnings.push(...result.warnings);
          }
        }
      }
      
      this.performanceStats.complianceChecks++;
      
      return compliance;
      
    } catch (error) {
      console.error(`Compliance check failed for token ${tokenId}:`, error);
      
      return {
        compliant: false,
        error: error.message,
        frameworks: {},
        warnings: [],
        violations: [{ framework: 'system', reason: 'compliance_check_failed', severity: 'critical' }]
      };
    }
  }

  async checkFrameworkCompliance(framework, tokenId) {
    // Check if token is on sanction lists
    const sanctionKey = `${framework}_${tokenId}`;
    const isSanctioned = this.sanctionedTokens.has(sanctionKey);
    
    if (isSanctioned) {
      return {
        compliant: false,
        reason: `Token appears on ${framework} sanction list`,
        warnings: [],
        lastChecked: Date.now()
      };
    }
    
    // Additional framework-specific checks would go here
    return {
      compliant: true,
      reason: null,
      warnings: [],
      lastChecked: Date.now()
    };
  }

  async fetchMarketData(tokenId) {
    // Check cache first
    const cached = this.marketDataCache.get(tokenId);
    if (cached && Date.now() - cached.timestamp < this.config.priceCacheExpiry) {
      return cached;
    }
    
    // Fetch from providers
    const providers = Array.from(this.dataProviders.values());
    
    for (const provider of providers) {
      try {
        const data = await provider.client.fetchMarketData(tokenId);
        if (data) {
          data.timestamp = Date.now();
          this.marketDataCache.set(tokenId, data);
          return data;
        }
      } catch (error) {
        console.warn(`Market data fetch failed for ${provider.name}:`, error);
      }
    }
    
    // Return default data if all providers fail
    return {
      liquidity: 0,
      volume24h: 0,
      volatility: 1,
      timestamp: Date.now()
    };
  }

  async updateTokenPrices() {
    const tokens = Array.from(this.whitelist);
    const batchSize = 20; // Process in batches
    
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (tokenId) => {
        try {
          const priceData = await this.fetchTokenPrice(tokenId);
          this.tokenPrices.set(tokenId, priceData);
          this.performanceStats.priceUpdatesPerSecond++;
        } catch (error) {
          console.warn(`Price update failed for ${tokenId}:`, error);
        }
      }));
    }
  }

  async fetchTokenPrice(tokenId) {
    // Simplified price fetching
    const tokenData = await this.fetchTokenData(tokenId);
    
    return {
      price: tokenData.price,
      priceChange24h: tokenData.priceChange24h,
      volume24h: tokenData.volume24h,
      lastUpdated: Date.now()
    };
  }

  async updateTokenMetadata() {
    // Update metadata for all tracked tokens
    const allTokens = new Set([
      ...this.whitelist,
      ...this.graylist,
      ...Array.from(this.pendingApproval.keys())
    ]);
    
    for (const tokenId of allTokens) {
      try {
        const metadata = await this.fetchTokenData(tokenId);
        this.tokenMetadata.set(tokenId, {
          ...this.tokenMetadata.get(tokenId),
          ...metadata,
          lastUpdated: Date.now()
        });
      } catch (error) {
        console.warn(`Metadata update failed for ${tokenId}:`, error);
      }
    }
  }

  async updateComplianceData() {
    // Update sanction lists from official sources
    console.log('Updating token compliance data...');
    
    try {
      // This would fetch from real sanction list APIs
      // For demo, using static data
      const ofacTokens = ['SOME_SANCTIONED_TOKEN'];
      const euTokens = ['ANOTHER_SANCTIONED_TOKEN'];
      
      this.sanctionedTokens.clear();
      ofacTokens.forEach(token => this.sanctionedTokens.add(`OFAC_${token}`));
      euTokens.forEach(token => this.sanctionedTokens.add(`EU_SANCTIONS_${token}`));
      
      // Store in Redis
      await this.redis.set(
        `${this.config.keyPrefix}sanctions`,
        JSON.stringify(Array.from(this.sanctionedTokens))
      );
      
    } catch (error) {
      console.error('Failed to update compliance data:', error);
    }
  }

  async performComplianceChecks() {
    // Re-check compliance for all whitelisted tokens
    for (const tokenId of this.whitelist) {
      try {
        const compliance = await this.checkTokenCompliance(tokenId);
        this.complianceStatus.set(tokenId, compliance);
        
        // Auto-blacklist if compliance fails
        if (!compliance.compliant) {
          const criticalViolations = compliance.violations.filter(v => v.severity === 'critical');
          if (criticalViolations.length > 0) {
            await this.addTokenToBlacklist(
              tokenId,
              `Compliance violation: ${criticalViolations[0].reason}`,
              'auto_compliance'
            );
          }
        }
      } catch (error) {
        console.warn(`Compliance check failed for ${tokenId}:`, error);
      }
    }
  }

  async performRiskAssessments() {
    // Re-assess risk for all whitelisted tokens
    for (const tokenId of this.whitelist) {
      try {
        const assessment = await this.assessTokenRisk(tokenId);
        
        // Auto-blacklist extremely risky tokens
        if (assessment.riskLevel === 'extreme' && assessment.confidence > 0.8) {
          await this.addTokenToBlacklist(
            tokenId,
            `Extreme risk detected: score ${assessment.riskScore.toFixed(3)}`,
            'auto_risk'
          );
        }
      } catch (error) {
        console.warn(`Risk assessment failed for ${tokenId}:`, error);
      }
    }
  }

  isTokenAllowed(tokenId) {
    return {
      allowed: this.whitelist.has(tokenId),
      status: this.getTokenStatus(tokenId),
      riskLevel: this.tokenRiskScores.get(tokenId)?.riskLevel || 'unknown',
      compliance: this.complianceStatus.get(tokenId) || { compliant: false }
    };
  }

  getTokenStatus(tokenId) {
    if (this.whitelist.has(tokenId)) return 'whitelisted';
    if (this.blacklist.has(tokenId)) return 'blacklisted';
    if (this.graylist.has(tokenId)) return 'pending_review';
    if (this.pendingApproval.has(tokenId)) return 'pending_approval';
    return 'unknown';
  }

  canMakeRequest(providerName) {
    const limiter = this.rateLimiters.get(providerName);
    if (!limiter) return true;
    
    const now = Date.now();
    const windowStart = Math.floor(now / 60000) * 60000;
    
    if (limiter.window !== windowStart) {
      limiter.window = windowStart;
      limiter.count = 0;
    }
    
    return limiter.count < limiter.limit;
  }

  recordRequest(providerName, success) {
    const limiter = this.rateLimiters.get(providerName);
    if (limiter) {
      limiter.count++;
    }
  }

  initializeRateLimiters() {
    const limits = {
      coingecko: { limit: 50, window: 0, count: 0 }, // 50/minute
      coinmarketcap: { limit: 333, window: 0, count: 0 }, // 333/minute
      defipulse: { limit: 300, window: 0, count: 0 } // 300/minute
    };
    
    for (const [name, config] of Object.entries(limits)) {
      this.rateLimiters.set(name, config);
    }
  }

  async saveTokenLists() {
    await this.redis.set(`${this.config.keyPrefix}whitelist`, 
      JSON.stringify(Array.from(this.whitelist)));
    
    await this.redis.set(`${this.config.keyPrefix}blacklist`, 
      JSON.stringify(Array.from(this.blacklist)));
    
    await this.redis.set(`${this.config.keyPrefix}graylist`, 
      JSON.stringify(Array.from(this.graylist)));
  }

  async loadTokenLists() {
    try {
      const whitelist = await this.redis.get(`${this.config.keyPrefix}whitelist`);
      if (whitelist) {
        this.whitelist = new Set(JSON.parse(whitelist));
      }
      
      const blacklist = await this.redis.get(`${this.config.keyPrefix}blacklist`);
      if (blacklist) {
        this.blacklist = new Set(JSON.parse(blacklist));
      }
      
      const graylist = await this.redis.get(`${this.config.keyPrefix}graylist`);
      if (graylist) {
        this.graylist = new Set(JSON.parse(graylist));
      }
      
      console.log(`Loaded token lists: ${this.whitelist.size} whitelisted, ${this.blacklist.size} blacklisted`);
      
    } catch (error) {
      console.error('Failed to load token lists:', error);
    }
  }

  async loadTokenData() {
    try {
      const metadata = await this.redis.hGetAll(`${this.config.keyPrefix}metadata`);
      for (const [tokenId, data] of Object.entries(metadata)) {
        this.tokenMetadata.set(tokenId, JSON.parse(data));
      }
      
      const pending = await this.redis.hGetAll(`${this.config.keyPrefix}pending`);
      for (const [tokenId, data] of Object.entries(pending)) {
        this.pendingApproval.set(tokenId, JSON.parse(data));
      }
      
      console.log(`Loaded data for ${this.tokenMetadata.size} tokens, ${this.pendingApproval.size} pending approval`);
      
    } catch (error) {
      console.error('Failed to load token data:', error);
    }
  }

  async loadComplianceData() {
    try {
      const sanctions = await this.redis.get(`${this.config.keyPrefix}sanctions`);
      if (sanctions) {
        this.sanctionedTokens = new Set(JSON.parse(sanctions));
      }
      
    } catch (error) {
      console.error('Failed to load compliance data:', error);
    }
  }

  async updatePerformanceMetrics() {
    this.performanceStats.tokensTracked = this.tokenMetadata.size;
    this.performanceStats.whitelistSize = this.whitelist.size;
    this.performanceStats.blacklistSize = this.blacklist.size;
    
    await this.metrics.setGauge('token_management.tokens_tracked', 
      this.performanceStats.tokensTracked, {}, 'risk');
    
    await this.metrics.setGauge('token_management.whitelist_size', 
      this.performanceStats.whitelistSize, {}, 'risk');
    
    await this.metrics.setGauge('token_management.blacklist_size', 
      this.performanceStats.blacklistSize, {}, 'risk');
    
    await this.metrics.setGauge('token_management.pending_approval', 
      this.pendingApproval.size, {}, 'risk');
    
    await this.metrics.setGauge('token_management.price_updates_per_second', 
      this.performanceStats.priceUpdatesPerSecond, {}, 'risk');
    
    // Reset counters
    this.performanceStats.priceUpdatesPerSecond = 0;
  }

  generateRequestId() {
    const crypto = require('crypto');
    return `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  getTokenManagementStatus() {
    return {
      isRunning: this.isRunning,
      tokenLists: {
        whitelist: this.whitelist.size,
        blacklist: this.blacklist.size,
        graylist: this.graylist.size,
        pendingApproval: this.pendingApproval.size
      },
      dataProviders: {
        active: this.dataProviders.size,
        rateLimiters: this.rateLimiters.size
      },
      compliance: {
        sanctionedTokens: this.sanctionedTokens.size,
        complianceChecks: this.performanceStats.complianceChecks
      },
      performance: this.performanceStats
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping token management system...');
    
    // Stop intervals
    if (this.priceUpdateInterval) clearInterval(this.priceUpdateInterval);
    if (this.metadataUpdateInterval) clearInterval(this.metadataUpdateInterval);
    if (this.complianceInterval) clearInterval(this.complianceInterval);
    if (this.riskAssessmentInterval) clearInterval(this.riskAssessmentInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear data
    this.whitelist.clear();
    this.blacklist.clear();
    this.graylist.clear();
    this.pendingApproval.clear();
    this.tokenMetadata.clear();
    this.tokenPrices.clear();
    this.tokenRiskScores.clear();
    this.marketDataCache.clear();
    this.liquidityData.clear();
    this.volumeData.clear();
    this.complianceStatus.clear();
    this.sanctionedTokens.clear();
    this.userTokenLists.clear();
    this.userRestrictions.clear();
    this.dataProviders.clear();
    this.rateLimiters.clear();
    
    this.isRunning = false;
    console.log('✅ Token management system stopped');
  }
}

module.exports = TokenManagementSystem;