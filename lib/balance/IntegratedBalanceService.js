const BalanceValidationService = require('./BalanceValidationService');
const HistoricalProofEngine = require('./HistoricalProofEngine');
const MultiChainBalanceAggregator = require('./MultiChainBalanceAggregator');
const EventEmitter = require('events');

/**
 * @class IntegratedBalanceService
 * @description Comprehensive balance service integrating all balance-related functionality
 * @extends EventEmitter
 * 
 * Features:
 * - Unified API for all balance operations
 * - Intelligent caching and cache invalidation
 * - Real-time order validation with multi-chain support
 * - Historical proof generation and verification
 * - Portfolio management and risk assessment
 * - Automated monitoring and alerting
 */
class IntegratedBalanceService extends EventEmitter {
  /**
   * @param {Object} config - Configuration for all services
   */
  constructor(config = {}) {
    super();
    
    this.config = {
      // Service-specific configurations
      validation: config.validation || {},
      historical: config.historical || {},
      multichain: config.multichain || {},
      
      // Integration settings
      integration: {
        enableRealTimeValidation: config.integration?.enableRealTimeValidation !== false,
        enableHistoricalProofs: config.integration?.enableHistoricalProofs !== false,
        enableMultiChain: config.integration?.enableMultiChain !== false,
        enablePortfolioTracking: config.integration?.enablePortfolioTracking !== false,
        cacheInvalidationDelay: config.integration?.cacheInvalidationDelay || 5000,
        ...config.integration
      },
      
      // Performance settings
      performance: {
        batchSize: config.performance?.batchSize || 50,
        concurrentRequests: config.performance?.concurrentRequests || 10,
        timeout: config.performance?.timeout || 30000,
        retryAttempts: config.performance?.retryAttempts || 3,
        ...config.performance
      },
      
      ...config
    };
    
    // Initialize individual services
    this.validationService = new BalanceValidationService(this.config.validation);
    this.historicalEngine = new HistoricalProofEngine(this.config.historical);
    this.multiChainAggregator = new MultiChainBalanceAggregator(this.config.multichain);
    
    // Service state
    this.isInitialized = false;
    this.pendingValidations = new Map();
    this.proofRequests = new Map();
    
    // Metrics and monitoring
    this.metrics = {
      validationsPerformed: 0,
      proofsGenerated: 0,
      aggregationsCompleted: 0,
      errorsEncountered: 0,
      averageResponseTime: 0,
      cacheEfficiency: 0
    };
    
    // Setup event handlers
    this._setupEventHandlers();
  }

  /**
   * Initialize the integrated service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      console.log('Initializing Integrated Balance Service...');
      
      // Initialize monitoring for all supported tokens
      if (this.config.integration.enableRealTimeValidation) {
        await this._initializeTokenMonitoring();
      }
      
      this.isInitialized = true;
      
      this.emit('service_initialized', {
        timestamp: Date.now(),
        services: {
          validation: true,
          historical: true,
          multichain: true
        }
      });
      
      console.log('Integrated Balance Service initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize Integrated Balance Service:', error);
      throw error;
    }
  }

  /**
   * Comprehensive order validation with multi-chain support
   * @param {Object} order - Order to validate
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Complete validation result
   */
  async validateOrderBalances(order, options = {}) {
    const startTime = Date.now();
    
    try {
      if (!this.isInitialized) {
        throw new Error('Service not initialized');
      }

      const validationResult = {
        orderId: order.id,
        userAddress: order.userId,
        valid: false,
        validations: {},
        multiChainData: {},
        recommendations: [],
        timestamp: Date.now()
      };

      // Primary balance validation
      const primaryValidation = await this.validationService.validateBalance(
        order.userId,
        order.makerToken,
        order.makerAmount,
        order.chainId || '1',
        options
      );
      
      validationResult.validations.primary = primaryValidation;
      validationResult.valid = primaryValidation.valid;

      // Allowance validation if required
      if (order.spenderAddress && primaryValidation.valid) {
        const allowanceValidation = await this.validationService.validateAllowance(
          order.userId,
          order.makerToken,
          order.spenderAddress,
          order.makerAmount,
          order.chainId || '1'
        );
        
        validationResult.validations.allowance = allowanceValidation;
        validationResult.valid = validationResult.valid && allowanceValidation.valid;
      }

      // Multi-chain aggregation if enabled and requested
      if (this.config.integration.enableMultiChain && options.includeMultiChain) {
        try {
          const tokenSymbol = await this._getTokenSymbol(order.makerToken, order.chainId);
          const supportedChains = this._getSupportedChains(tokenSymbol);
          
          if (supportedChains.length > 1) {
            const multiChainBalance = await this.multiChainAggregator.aggregateBalances(
              order.userId,
              [tokenSymbol],
              { includePrices: true }
            );
            
            validationResult.multiChainData = multiChainBalance;
            
            // Check if user has sufficient balance across chains
            const totalBalance = multiChainBalance.tokens[tokenSymbol]?.totalBalance || '0';
            const requiredAmount = ethers.BigNumber.from(order.makerAmount);
            
            if (ethers.BigNumber.from(totalBalance).gte(requiredAmount)) {
              validationResult.recommendations.push({
                type: 'multi_chain_sufficient',
                message: 'Sufficient balance available across multiple chains',
                suggestedChains: this._suggestOptimalChains(multiChainBalance, requiredAmount)
              });
            }
          }
        } catch (multiChainError) {
          console.warn('Multi-chain validation failed:', multiChainError.message);
          validationResult.multiChainData = { error: multiChainError.message };
        }
      }

      // Generate validation recommendations
      if (!validationResult.valid) {
        validationResult.recommendations.push(
          ...this._generateValidationRecommendations(validationResult, order)
        );
      }

      // Update metrics
      this.metrics.validationsPerformed++;
      this.metrics.averageResponseTime = this._updateAverageResponseTime(
        Date.now() - startTime
      );

      this.emit('order_validated', {
        orderId: order.id,
        valid: validationResult.valid,
        responseTime: Date.now() - startTime
      });

      return validationResult;

    } catch (error) {
      this.metrics.errorsEncountered++;
      
      this.emit('validation_error', {
        orderId: order.id,
        error: error.message,
        responseTime: Date.now() - startTime
      });
      
      throw new Error(`Order validation failed: ${error.message}`);
    }
  }

  /**
   * Generate historical proof for balance disputes
   * @param {Object} disputeRequest - Dispute request details
   * @returns {Promise<Object>} Historical proof package
   */
  async generateDisputeProof(disputeRequest) {
    try {
      if (!this.config.integration.enableHistoricalProofs) {
        throw new Error('Historical proofs not enabled');
      }

      const proofResult = {
        disputeId: disputeRequest.disputeId,
        userAddress: disputeRequest.userAddress,
        tokenAddress: disputeRequest.tokenAddress,
        blockNumber: disputeRequest.blockNumber,
        chainId: disputeRequest.chainId,
        proofGenerated: Date.now()
      };

      // Generate comprehensive historical proof
      const historicalProof = await this.historicalEngine.generateHistoricalProof(
        disputeRequest.userAddress,
        disputeRequest.tokenAddress,
        disputeRequest.blockNumber,
        disputeRequest.chainId
      );

      proofResult.proof = historicalProof;

      // Cross-validate with current balance if recent
      const blockAge = Date.now() - (historicalProof.timestamp * 1000);
      if (blockAge < 3600000) { // Less than 1 hour old
        try {
          const currentValidation = await this.validationService.validateBalance(
            disputeRequest.userAddress,
            disputeRequest.tokenAddress,
            '0',
            disputeRequest.chainId
          );
          
          proofResult.crossValidation = {
            currentBalance: currentValidation.actualBalance,
            historicalBalance: historicalProof.balance,
            consistent: currentValidation.actualBalance === historicalProof.balance
          };
        } catch (crossValidationError) {
          proofResult.crossValidation = {
            error: crossValidationError.message
          };
        }
      }

      // Generate fraud proof if inconsistency detected
      if (disputeRequest.suspectedFraud && disputeRequest.correctBalance) {
        try {
          const fraudProof = await this.historicalEngine.generateFraudProof(
            historicalProof,
            { balance: disputeRequest.correctBalance }
          );
          
          proofResult.fraudProof = fraudProof;
        } catch (fraudError) {
          console.warn('Fraud proof generation failed:', fraudError.message);
        }
      }

      this.metrics.proofsGenerated++;

      this.emit('proof_generated', {
        disputeId: disputeRequest.disputeId,
        proofType: 'historical',
        blockNumber: disputeRequest.blockNumber
      });

      return proofResult;

    } catch (error) {
      this.emit('proof_generation_error', {
        disputeId: disputeRequest.disputeId,
        error: error.message
      });
      
      throw new Error(`Dispute proof generation failed: ${error.message}`);
    }
  }

  /**
   * Get comprehensive portfolio analysis
   * @param {string} userAddress - User wallet address
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Complete portfolio analysis
   */
  async getPortfolioAnalysis(userAddress, options = {}) {
    try {
      if (!this.config.integration.enablePortfolioTracking) {
        throw new Error('Portfolio tracking not enabled');
      }

      const analysis = {
        userAddress,
        timestamp: Date.now(),
        portfolio: {},
        riskAssessment: {},
        historicalPerformance: {},
        recommendations: [],
        options
      };

      // Get current portfolio value
      analysis.portfolio = await this.multiChainAggregator.getPortfolioValue(
        userAddress,
        options.baseCurrency || 'USD'
      );

      // Historical performance analysis if requested
      if (options.includeHistorical && options.timeRange) {
        try {
          analysis.historicalPerformance = await this._getHistoricalPerformance(
            userAddress,
            options.timeRange
          );
        } catch (historicalError) {
          analysis.historicalPerformance = { error: historicalError.message };
        }
      }

      // Cross-chain movement analysis
      if (options.includeMo vements) {
        try {
          const knownTokens = Object.keys(analysis.portfolio.assetAllocation || {});
          const movementPromises = knownTokens.map(token =>
            this.multiChainAggregator.trackCrossChainMovements(
              userAddress,
              token,
              options.movementTimeRange || 86400000
            )
          );
          
          const movements = await Promise.all(movementPromises);
          analysis.crossChainMovements = movements;
        } catch (movementError) {
          analysis.crossChainMovements = { error: movementError.message };
        }
      }

      // Generate portfolio recommendations
      analysis.recommendations = this._generatePortfolioRecommendations(analysis);

      this.metrics.aggregationsCompleted++;

      this.emit('portfolio_analyzed', {
        userAddress,
        totalValue: analysis.portfolio.totalValue,
        riskScore: analysis.portfolio.riskMetrics?.chainRiskScore || 0
      });

      return analysis;

    } catch (error) {
      this.emit('portfolio_analysis_error', {
        userAddress,
        error: error.message
      });
      
      throw new Error(`Portfolio analysis failed: ${error.message}`);
    }
  }

  /**
   * Batch validate multiple orders efficiently
   * @param {Array} orders - Array of orders to validate
   * @param {Object} options - Validation options
   * @returns {Promise<Array>} Array of validation results
   */
  async batchValidateOrders(orders, options = {}) {
    try {
      if (orders.length === 0) {
        return [];
      }

      if (orders.length > this.config.performance.batchSize) {
        throw new Error(`Batch size exceeds limit of ${this.config.performance.batchSize}`);
      }

      // Group orders by chain for efficiency
      const ordersByChain = this._groupOrdersByChain(orders);
      const results = [];

      // Process each chain's orders
      for (const [chainId, chainOrders] of ordersByChain) {
        try {
          // Process orders in parallel but limit concurrency
          const batchPromises = this._createBatches(
            chainOrders,
            this.config.performance.concurrentRequests
          ).map(batch =>
            Promise.all(
              batch.map(order => this.validateOrderBalances(order, options))
            )
          );

          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults.flat());

        } catch (chainError) {
          // Mark all orders in this chain as failed
          chainOrders.forEach(order => {
            results.push({
              orderId: order.id,
              valid: false,
              error: `Chain validation failed: ${chainError.message}`,
              timestamp: Date.now()
            });
          });
        }
      }

      return results;

    } catch (error) {
      throw new Error(`Batch validation failed: ${error.message}`);
    }
  }

  /**
   * Handle balance transfer events for cache invalidation
   * @param {Object} transferEvent - Transfer event data
   */
  async handleTransferEvent(transferEvent) {
    try {
      const { tokenAddress, fromAddress, toAddress, chainId } = transferEvent;

      // Invalidate balance caches
      await this.validationService.invalidateBalanceCache(
        tokenAddress,
        fromAddress,
        toAddress,
        chainId
      );

      // Update portfolio tracking if enabled
      if (this.config.integration.enablePortfolioTracking) {
        // Trigger portfolio recalculation for affected users
        setTimeout(async () => {
          try {
            await this._updatePortfolioCache([fromAddress, toAddress]);
          } catch (error) {
            console.error('Portfolio cache update failed:', error);
          }
        }, this.config.integration.cacheInvalidationDelay);
      }

      this.emit('transfer_processed', {
        tokenAddress,
        fromAddress,
        toAddress,
        chainId,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Transfer event handling failed:', error);
    }
  }

  /**
   * Get service health and performance metrics
   * @returns {Object} Service health status
   */
  getHealthStatus() {
    return {
      status: this.isInitialized ? 'healthy' : 'initializing',
      services: {
        validation: this.validationService.getStatistics(),
        multichain: this.multiChainAggregator.getHealthStatus()
      },
      metrics: this.metrics,
      configuration: {
        realTimeValidation: this.config.integration.enableRealTimeValidation,
        historicalProofs: this.config.integration.enableHistoricalProofs,
        multiChain: this.config.integration.enableMultiChain,
        portfolioTracking: this.config.integration.enablePortfolioTracking
      },
      timestamp: Date.now()
    };
  }

  // Private methods

  /**
   * Setup event handlers between services
   * @private
   */
  _setupEventHandlers() {
    // Forward important events from child services
    this.validationService.on('balance_validated', (data) => {
      this.emit('balance_validated', data);
    });

    this.validationService.on('suspicious_activity', (data) => {
      this.emit('suspicious_activity', data);
    });

    this.multiChainAggregator.on('aggregation_completed', (data) => {
      this.emit('aggregation_completed', data);
    });

    this.historicalEngine.on('proof_generated', (data) => {
      this.emit('proof_generated', data);
    });
  }

  /**
   * Initialize transfer monitoring for all supported tokens
   * @private
   */
  async _initializeTokenMonitoring() {
    // Get all token mappings from multi-chain aggregator
    const tokenMappings = this.multiChainAggregator.config.tokenMappings;
    
    for (const [tokenSymbol, chains] of Object.entries(tokenMappings)) {
      for (const [chainName, tokenAddress] of Object.entries(chains)) {
        try {
          const chainId = this._getChainId(chainName);
          if (chainId) {
            await this.validationService.startTransferMonitoring(tokenAddress, chainId);
          }
        } catch (error) {
          console.warn(`Failed to start monitoring for ${tokenSymbol} on ${chainName}:`, error.message);
        }
      }
    }
  }

  /**
   * Generate validation recommendations
   * @private
   */
  _generateValidationRecommendations(validationResult, order) {
    const recommendations = [];

    if (!validationResult.validations.primary?.valid) {
      recommendations.push({
        type: 'insufficient_balance',
        message: 'Insufficient balance for order',
        required: order.makerAmount,
        available: validationResult.validations.primary?.actualBalance || '0'
      });
    }

    if (validationResult.validations.allowance && !validationResult.validations.allowance.valid) {
      recommendations.push({
        type: 'insufficient_allowance',
        message: 'Insufficient token allowance',
        required: order.makerAmount,
        current: validationResult.validations.allowance.actualAllowance
      });
    }

    if (validationResult.multiChainData?.totalValueUSD > 0) {
      recommendations.push({
        type: 'multi_chain_available',
        message: 'Consider using cross-chain bridges to consolidate funds',
        totalAvailable: validationResult.multiChainData.totalValueUSD
      });
    }

    return recommendations;
  }

  /**
   * Group orders by chain for efficient processing
   * @private
   */
  _groupOrdersByChain(orders) {
    const grouped = new Map();

    for (const order of orders) {
      const chainId = order.chainId || '1';
      if (!grouped.has(chainId)) {
        grouped.set(chainId, []);
      }
      grouped.get(chainId).push(order);
    }

    return grouped;
  }

  /**
   * Create processing batches
   * @private
   */
  _createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Update average response time metric
   * @private
   */
  _updateAverageResponseTime(newTime) {
    const count = this.metrics.validationsPerformed;
    const currentAvg = this.metrics.averageResponseTime;
    
    return ((currentAvg * (count - 1)) + newTime) / count;
  }

  /**
   * Get chain ID from network name
   * @private
   */
  _getChainId(chainName) {
    return this.multiChainAggregator._getChainId(chainName);
  }

  /**
   * Shutdown the integrated service
   */
  async shutdown() {
    console.log('Shutting down Integrated Balance Service...');
    
    try {
      // Shutdown individual services
      await this.validationService.shutdown();
      // Note: Other services don't have shutdown methods in this implementation
      
      this.emit('service_shutdown', { timestamp: Date.now() });
      
      console.log('Integrated Balance Service shutdown complete');
      
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }
}

module.exports = IntegratedBalanceService;