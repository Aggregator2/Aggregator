const { ethers } = require('ethers');
const EventEmitter = require('events');

/**
 * @class MultiChainBalanceAggregator
 * @description Advanced multi-chain balance aggregation with cross-chain liquidity tracking
 * 
 * Features:
 * - Real-time balance aggregation across multiple networks
 * - Cross-chain token mapping and standardization
 * - Liquidity pool balance tracking (Uniswap, Sushiswap, etc.)
 * - Bridge balance monitoring for locked tokens
 * - Portfolio-level balance analytics
 * - Risk assessment based on chain distribution
 */
class MultiChainBalanceAggregator extends EventEmitter {
  /**
   * @param {Object} config - Configuration options
   * @param {Object} config.networks - Network configurations
   * @param {Object} config.tokenMappings - Cross-chain token mappings
   * @param {Object} config.bridgeContracts - Bridge contract addresses
   * @param {Object} config.liquidityPools - DEX pool configurations
   */
  constructor(config = {}) {
    super();
    
    this.config = {
      networks: config.networks || {},
      
      // Cross-chain token mappings
      tokenMappings: {
        'USDC': {
          ethereum: '0xA0b86a33E6417c5E74A0D11ba67af3d6b07f01AE',
          polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
          arbitrum: '0xFC3fAC73a06FDE5f3de0C5B1B4F34B4DC3C7a91C',
          optimism: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607'
        },
        'USDT': {
          ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
          arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'
        },
        'WETH': {
          ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          polygon: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
          arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          optimism: '0x4200000000000000000000000000000000000006'
        },
        ...config.tokenMappings
      },
      
      // Bridge contract addresses for locked token tracking
      bridgeContracts: {
        ethereum: {
          polygonBridge: '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf',
          arbitrumBridge: '0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a',
          optimismBridge: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1'
        },
        polygon: {
          ethereumBridge: '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77'
        },
        ...config.bridgeContracts
      },
      
      // DEX pool configurations
      liquidityPools: {
        uniswapV3: {
          ethereum: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
          polygon: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
          arbitrum: '0x1F98431c8aD98523631AE4a59f267346ea31F984'
        },
        sushiswap: {
          ethereum: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
          polygon: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
          arbitrum: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'
        },
        ...config.liquidityPools
      },
      
      // Aggregation settings
      aggregation: {
        enableLiquidityPools: config.aggregation?.enableLiquidityPools || true,
        enableBridgeBalances: config.aggregation?.enableBridgeBalances || true,
        enableStakedBalances: config.aggregation?.enableStakedBalances || true,
        priceOracle: config.aggregation?.priceOracle || 'chainlink',
        baseCurrency: config.aggregation?.baseCurrency || 'USD',
        ...config.aggregation
      },
      
      ...config
    };
    
    this.providers = new Map();
    this.balanceValidators = new Map();
    this.priceFeeds = new Map();
    
    // Cache for cross-chain data
    this.balanceCache = new Map();
    this.poolCache = new Map();
    this.bridgeCache = new Map();
    
    // Risk assessment data
    this.riskProfiles = new Map();
    this.chainHealthScores = new Map();
    
    this._initializeProviders();
    this._startMonitoring();
  }

  /**
   * Aggregate balances across all supported chains
   * @param {string} userAddress - User wallet address
   * @param {Array<string>} tokens - Array of token symbols to aggregate
   * @param {Object} options - Aggregation options
   * @returns {Promise<Object>} Comprehensive balance aggregation
   */
  async aggregateBalances(userAddress, tokens, options = {}) {
    try {
      const aggregationResult = {
        userAddress,
        tokens: {},
        totalValueUSD: 0,
        chains: {},
        liquidityPositions: {},
        bridgeBalances: {},
        riskAssessment: {},
        timestamp: Date.now(),
        options
      };

      // Process each token across all chains
      for (const tokenSymbol of tokens) {
        const tokenData = await this._aggregateTokenAcrossChains(
          userAddress,
          tokenSymbol,
          options
        );
        
        aggregationResult.tokens[tokenSymbol] = tokenData;
        aggregationResult.totalValueUSD += tokenData.totalValueUSD;
      }

      // Aggregate chain-level data
      for (const [chainId, networkConfig] of Object.entries(this.config.networks)) {
        const chainData = await this._getChainSummary(userAddress, chainId, tokens);
        aggregationResult.chains[chainId] = chainData;
      }

      // Include liquidity pool positions if enabled
      if (this.config.aggregation.enableLiquidityPools) {
        aggregationResult.liquidityPositions = await this._aggregateLiquidityPositions(
          userAddress,
          tokens
        );
      }

      // Include bridge balances if enabled
      if (this.config.aggregation.enableBridgeBalances) {
        aggregationResult.bridgeBalances = await this._aggregateBridgeBalances(
          userAddress,
          tokens
        );
      }

      // Perform risk assessment
      aggregationResult.riskAssessment = await this._assessPortfolioRisk(
        userAddress,
        aggregationResult
      );

      this.emit('aggregation_completed', {
        userAddress,
        tokenCount: tokens.length,
        totalValue: aggregationResult.totalValueUSD,
        chainCount: Object.keys(aggregationResult.chains).length
      });

      return aggregationResult;

    } catch (error) {
      this.emit('aggregation_error', {
        userAddress,
        tokens,
        error: error.message
      });
      
      throw new Error(`Balance aggregation failed: ${error.message}`);
    }
  }

  /**
   * Get real-time portfolio value across all chains
   * @param {string} userAddress - User wallet address
   * @param {string} baseCurrency - Base currency for valuation (USD, ETH, etc.)
   * @returns {Promise<Object>} Portfolio valuation with breakdown
   */
  async getPortfolioValue(userAddress, baseCurrency = 'USD') {
    try {
      // Get all known tokens for user
      const knownTokens = await this._discoverUserTokens(userAddress);
      
      // Aggregate balances
      const aggregation = await this.aggregateBalances(userAddress, knownTokens, {
        includePrices: true,
        baseCurrency
      });

      // Calculate portfolio metrics
      const portfolio = {
        totalValue: aggregation.totalValueUSD,
        baseCurrency,
        
        // Chain distribution
        chainDistribution: this._calculateChainDistribution(aggregation),
        
        // Asset allocation
        assetAllocation: this._calculateAssetAllocation(aggregation),
        
        // Risk metrics
        riskMetrics: {
          diversificationScore: this._calculateDiversificationScore(aggregation),
          chainRiskScore: this._calculateChainRiskScore(aggregation),
          liquidityScore: this._calculateLiquidityScore(aggregation)
        },
        
        // Performance tracking
        performance: await this._calculatePerformanceMetrics(userAddress, aggregation),
        
        timestamp: Date.now()
      };

      return portfolio;

    } catch (error) {
      throw new Error(`Portfolio valuation failed: ${error.message}`);
    }
  }

  /**
   * Track cross-chain token movements and migrations
   * @param {string} userAddress - User wallet address
   * @param {string} tokenSymbol - Token symbol to track
   * @param {number} timeRange - Time range in milliseconds
   * @returns {Promise<Object>} Token movement analysis
   */
  async trackCrossChainMovements(userAddress, tokenSymbol, timeRange = 86400000) {
    try {
      const movements = {
        userAddress,
        tokenSymbol,
        timeRange,
        movements: [],
        summary: {
          totalTransferred: 0,
          bridgeOperations: 0,
          chains: new Set(),
          totalFees: 0
        },
        timestamp: Date.now()
      };

      const tokenMapping = this.config.tokenMappings[tokenSymbol];
      if (!tokenMapping) {
        throw new Error(`Token mapping not found for ${tokenSymbol}`);
      }

      // Check each chain for movements
      for (const [chainName, tokenAddress] of Object.entries(tokenMapping)) {
        const chainId = this._getChainId(chainName);
        const provider = this.providers.get(chainId);
        
        if (!provider) continue;

        try {
          // Get transfer events for the time range
          const transfers = await this._getTransferEvents(
            userAddress,
            tokenAddress,
            chainId,
            timeRange
          );

          // Get bridge events
          const bridgeEvents = await this._getBridgeEvents(
            userAddress,
            tokenAddress,
            chainId,
            timeRange
          );

          // Process and categorize movements
          const chainMovements = this._processChainMovements(
            transfers,
            bridgeEvents,
            chainName,
            chainId
          );

          movements.movements.push(...chainMovements);
          
          // Update summary
          chainMovements.forEach(movement => {
            movements.summary.totalTransferred += parseFloat(movement.amount);
            movements.summary.chains.add(movement.sourceChain);
            movements.summary.chains.add(movement.destinationChain);
            movements.summary.totalFees += parseFloat(movement.fee || 0);
            
            if (movement.type === 'bridge') {
              movements.summary.bridgeOperations++;
            }
          });

        } catch (error) {
          console.error(`Error tracking movements on ${chainName}:`, error);
        }
      }

      // Convert Set to Array for serialization
      movements.summary.chains = Array.from(movements.summary.chains);

      return movements;

    } catch (error) {
      throw new Error(`Cross-chain movement tracking failed: ${error.message}`);
    }
  }

  /**
   * Optimize portfolio distribution across chains
   * @param {string} userAddress - User wallet address
   * @param {Object} currentPortfolio - Current portfolio state
   * @param {Object} targetAllocation - Desired allocation strategy
   * @returns {Promise<Object>} Optimization recommendations
   */
  async optimizePortfolioDistribution(userAddress, currentPortfolio, targetAllocation) {
    try {
      const optimization = {
        userAddress,
        currentState: currentPortfolio,
        targetAllocation,
        recommendations: [],
        estimatedCosts: {},
        riskImpact: {},
        timestamp: Date.now()
      };

      // Analyze current vs target allocation
      const allocationGaps = this._calculateAllocationGaps(
        currentPortfolio,
        targetAllocation
      );

      // Generate rebalancing recommendations
      for (const [tokenSymbol, gap] of Object.entries(allocationGaps)) {
        if (Math.abs(gap.percentageDiff) > 5) { // 5% threshold
          const recommendation = await this._generateRebalanceRecommendation(
            userAddress,
            tokenSymbol,
            gap,
            currentPortfolio
          );
          
          optimization.recommendations.push(recommendation);
        }
      }

      // Calculate estimated costs for all recommendations
      optimization.estimatedCosts = await this._calculateRebalancingCosts(
        optimization.recommendations
      );

      // Assess risk impact
      optimization.riskImpact = await this._assessRebalancingRisk(
        currentPortfolio,
        optimization.recommendations
      );

      return optimization;

    } catch (error) {
      throw new Error(`Portfolio optimization failed: ${error.message}`);
    }
  }

  // Private methods

  /**
   * Initialize providers for all configured networks
   * @private
   */
  _initializeProviders() {
    for (const [networkName, config] of Object.entries(this.config.networks)) {
      try {
        if (config.rpcUrl) {
          const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
          this.providers.set(config.chainId.toString(), provider);
        }
      } catch (error) {
        console.error(`Failed to initialize provider for ${networkName}:`, error);
      }
    }
  }

  /**
   * Aggregate a single token across all chains
   * @private
   */
  async _aggregateTokenAcrossChains(userAddress, tokenSymbol, options) {
    const tokenMapping = this.config.tokenMappings[tokenSymbol];
    if (!tokenMapping) {
      throw new Error(`Token mapping not found for ${tokenSymbol}`);
    }

    const tokenData = {
      symbol: tokenSymbol,
      totalBalance: ethers.BigNumber.from(0),
      totalValueUSD: 0,
      chains: {},
      averagePrice: 0,
      priceVariance: 0
    };

    const balancePromises = Object.entries(tokenMapping).map(async ([chainName, tokenAddress]) => {
      try {
        const chainId = this._getChainId(chainName);
        const balance = await this._getTokenBalance(userAddress, tokenAddress, chainId);
        const price = options.includePrices ? await this._getTokenPrice(tokenSymbol, chainName) : 0;
        const valueUSD = parseFloat(ethers.utils.formatEther(balance)) * price;

        return {
          chainName,
          chainId,
          tokenAddress,
          balance: balance.toString(),
          balanceFormatted: ethers.utils.formatEther(balance),
          price,
          valueUSD,
          valid: true
        };
      } catch (error) {
        return {
          chainName,
          chainId: this._getChainId(chainName),
          tokenAddress,
          balance: '0',
          balanceFormatted: '0',
          price: 0,
          valueUSD: 0,
          valid: false,
          error: error.message
        };
      }
    });

    const results = await Promise.all(balancePromises);
    
    // Aggregate results
    results.forEach(result => {
      if (result.valid) {
        tokenData.totalBalance = tokenData.totalBalance.add(result.balance);
        tokenData.totalValueUSD += result.valueUSD;
      }
      tokenData.chains[result.chainName] = result;
    });

    // Calculate average price and variance
    const validPrices = results.filter(r => r.valid && r.price > 0).map(r => r.price);
    if (validPrices.length > 0) {
      tokenData.averagePrice = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
      tokenData.priceVariance = this._calculateVariance(validPrices);
    }

    return tokenData;
  }

  /**
   * Get chain summary for a user
   * @private
   */
  async _getChainSummary(userAddress, chainId, tokens) {
    try {
      const provider = this.providers.get(chainId);
      if (!provider) {
        return { available: false, error: 'Provider not available' };
      }

      const nativeBalance = await provider.getBalance(userAddress);
      const blockNumber = await provider.getBlockNumber();
      
      return {
        chainId,
        networkName: this._getNetworkName(chainId),
        available: true,
        nativeBalance: nativeBalance.toString(),
        nativeBalanceFormatted: ethers.utils.formatEther(nativeBalance),
        blockNumber,
        tokenCount: tokens.length,
        lastUpdated: Date.now()
      };

    } catch (error) {
      return {
        chainId,
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Aggregate liquidity pool positions
   * @private
   */
  async _aggregateLiquidityPositions(userAddress, tokens) {
    const positions = {};

    for (const [dexName, dexConfig] of Object.entries(this.config.liquidityPools)) {
      try {
        const dexPositions = await this._getDexPositions(userAddress, dexConfig, tokens);
        if (dexPositions.length > 0) {
          positions[dexName] = dexPositions;
        }
      } catch (error) {
        console.error(`Error fetching ${dexName} positions:`, error);
      }
    }

    return positions;
  }

  /**
   * Aggregate bridge balances
   * @private
   */
  async _aggregateBridgeBalances(userAddress, tokens) {
    const bridgeBalances = {};

    for (const [chainName, bridges] of Object.entries(this.config.bridgeContracts)) {
      const chainId = this._getChainId(chainName);
      const provider = this.providers.get(chainId);
      
      if (!provider) continue;

      try {
        for (const [bridgeName, bridgeAddress] of Object.entries(bridges)) {
          const balance = await this._getBridgeBalance(
            userAddress,
            bridgeAddress,
            chainId,
            tokens
          );
          
          if (balance.totalValue > 0) {
            bridgeBalances[`${chainName}-${bridgeName}`] = balance;
          }
        }
      } catch (error) {
        console.error(`Error fetching bridge balances for ${chainName}:`, error);
      }
    }

    return bridgeBalances;
  }

  /**
   * Assess portfolio risk
   * @private
   */
  async _assessPortfolioRisk(userAddress, aggregationResult) {
    const riskAssessment = {
      overallRisk: 'low',
      riskFactors: [],
      recommendations: [],
      scores: {
        diversification: 0,
        chainRisk: 0,
        liquidityRisk: 0,
        concentrationRisk: 0
      }
    };

    // Chain concentration risk
    const chainValues = Object.values(aggregationResult.chains)
      .filter(chain => chain.available)
      .map(chain => parseFloat(chain.nativeBalanceFormatted) || 0);
    
    const totalValue = chainValues.reduce((a, b) => a + b, 0);
    const maxChainPercentage = totalValue > 0 ? Math.max(...chainValues) / totalValue : 0;

    if (maxChainPercentage > 0.7) {
      riskAssessment.riskFactors.push('High chain concentration risk');
      riskAssessment.scores.concentrationRisk = 80;
    }

    // Token diversification
    const tokenCount = Object.keys(aggregationResult.tokens).length;
    if (tokenCount < 3) {
      riskAssessment.riskFactors.push('Low token diversification');
      riskAssessment.scores.diversification = 30;
    }

    // Calculate overall risk
    const avgScore = Object.values(riskAssessment.scores).reduce((a, b) => a + b, 0) / 
                    Object.keys(riskAssessment.scores).length;
    
    if (avgScore > 60) {
      riskAssessment.overallRisk = 'high';
    } else if (avgScore > 30) {
      riskAssessment.overallRisk = 'medium';
    }

    return riskAssessment;
  }

  /**
   * Get token balance on specific chain
   * @private
   */
  async _getTokenBalance(userAddress, tokenAddress, chainId) {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Provider not available for chain ${chainId}`);
    }

    if (tokenAddress === ethers.constants.AddressZero) {
      return await provider.getBalance(userAddress);
    } else {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );
      return await tokenContract.balanceOf(userAddress);
    }
  }

  /**
   * Get token price from oracle
   * @private
   */
  async _getTokenPrice(tokenSymbol, chainName) {
    // Simplified price fetching - in production, use Chainlink or other oracles
    try {
      // Mock price data - replace with actual oracle integration
      const mockPrices = {
        'USDC': 1.00,
        'USDT': 1.00,
        'WETH': 2000.00,
        'WBTC': 30000.00
      };
      
      return mockPrices[tokenSymbol] || 0;
    } catch (error) {
      console.error(`Price fetch failed for ${tokenSymbol}:`, error);
      return 0;
    }
  }

  /**
   * Helper methods
   * @private
   */
  _getChainId(chainName) {
    const network = this.config.networks[chainName];
    return network ? network.chainId.toString() : null;
  }

  _getNetworkName(chainId) {
    for (const [name, config] of Object.entries(this.config.networks)) {
      if (config.chainId.toString() === chainId) {
        return name;
      }
    }
    return `chain-${chainId}`;
  }

  _calculateVariance(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Start monitoring processes
   * @private
   */
  _startMonitoring() {
    // Monitor chain health
    setInterval(() => {
      this._updateChainHealthScores();
    }, 60000);

    // Clear old cache entries
    setInterval(() => {
      this._cleanupCache();
    }, 300000);
  }

  /**
   * Update chain health scores
   * @private
   */
  async _updateChainHealthScores() {
    for (const [chainId, provider] of this.providers) {
      try {
        const startTime = Date.now();
        await provider.getBlockNumber();
        const responseTime = Date.now() - startTime;
        
        // Score based on response time
        let score = 100;
        if (responseTime > 5000) score = 20;
        else if (responseTime > 2000) score = 60;
        else if (responseTime > 1000) score = 80;
        
        this.chainHealthScores.set(chainId, {
          score,
          responseTime,
          lastChecked: Date.now()
        });
        
      } catch (error) {
        this.chainHealthScores.set(chainId, {
          score: 0,
          responseTime: -1,
          lastChecked: Date.now(),
          error: error.message
        });
      }
    }
  }

  /**
   * Cleanup cache entries
   * @private
   */
  _cleanupCache() {
    const now = Date.now();
    const maxAge = 300000; // 5 minutes

    [this.balanceCache, this.poolCache, this.bridgeCache].forEach(cache => {
      for (const [key, entry] of cache) {
        if (now - entry.timestamp > maxAge) {
          cache.delete(key);
        }
      }
    });
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    return {
      providers: {
        total: this.providers.size,
        healthy: Array.from(this.chainHealthScores.values())
          .filter(score => score.score > 50).length
      },
      cache: {
        balanceEntries: this.balanceCache.size,
        poolEntries: this.poolCache.size,
        bridgeEntries: this.bridgeCache.size
      },
      chainHealthScores: Object.fromEntries(this.chainHealthScores),
      lastUpdated: Date.now()
    };
  }
}

module.exports = MultiChainBalanceAggregator;