/**
 * @title Cross-Asset Matching Engine
 * @author DEX Trading Team
 * @notice Advanced cross-asset pair matching with path finding and arbitrage detection
 * @dev Supports multi-hop trading, liquidity aggregation, and optimal price discovery
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

class CrossAssetMatcher extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Cross-asset configuration
            crossAssetEnabled: config.crossAssetEnabled || true,
            maxHops: config.maxHops || 3,
            maxPathsPerQuery: config.maxPathsPerQuery || 10,
            minLiquidityThreshold: config.minLiquidityThreshold || '1000000000000000000', // 1 token
            
            // Path finding configuration
            pathFindingAlgorithm: config.pathFindingAlgorithm || 'dijkstra',
            maxComputationTime: config.maxComputationTime || 1000, // 1 second
            enableCaching: config.enableCaching || true,
            cacheExpiryTime: config.cacheExpiryTime || 30000, // 30 seconds
            
            // Arbitrage detection
            arbitrageDetectionEnabled: config.arbitrageDetectionEnabled || true,
            minArbitrageProfit: config.minArbitrageProfit || '10000000000000000', // 0.01 tokens
            maxArbitrageSlippage: config.maxArbitrageSlippage || 0.05, // 5%
            
            // Liquidity aggregation
            liquidityAggregationEnabled: config.liquidityAggregationEnabled || true,
            maxLiquiditySources: config.maxLiquiditySources || 5,
            rebalancingEnabled: config.rebalancingEnabled || true,
            
            // Price optimization
            priceOptimizationEnabled: config.priceOptimizationEnabled || true,
            dynamicPricingEnabled: config.dynamicPricingEnabled || true,
            impactCalculationEnabled: config.impactCalculationEnabled || true,
            
            // Risk management
            maxPositionSize: config.maxPositionSize || '100000000000000000000000', // 100k tokens
            concentrationLimit: config.concentrationLimit || 0.1, // 10% of total liquidity
            
            ...config
        };

        // Core components
        this.pathFinder = new PathFinder(this.config);
        this.liquidityAggregator = new LiquidityAggregator(this.config);
        this.arbitrageDetector = new ArbitrageDetector(this.config);
        this.priceOptimizer = new PriceOptimizer(this.config);
        this.riskManager = new CrossAssetRiskManager(this.config);
        
        // Data structures
        this.assetGraph = new AssetGraph();
        this.liquidityPools = new Map(); // Pool ID -> Pool data
        this.tradingPairs = new Map(); // Pair -> Pool mappings
        this.pathCache = new Map(); // Cache for computed paths
        this.arbitrageOpportunities = new Map();
        
        // Market data
        this.priceFeeds = new Map();
        this.liquidityProviders = new Map();
        this.orderBooks = new Map();
        
        // Metrics and monitoring
        this.metrics = new CrossAssetMetrics();
        this.performanceMonitor = new PerformanceMonitor();
        
        this._initializeMatcher();
    }

    /**
     * Initialize cross-asset matcher
     * @private
     */
    async _initializeMatcher() {
        // Initialize components
        await this.pathFinder.initialize();
        await this.liquidityAggregator.initialize();
        await this.arbitrageDetector.initialize();
        await this.priceOptimizer.initialize();
        await this.riskManager.initialize();
        
        // Start periodic tasks
        this.cacheCleanupInterval = setInterval(() => {
            this._cleanupCache();
        }, 60000); // Every minute
        
        if (this.config.arbitrageDetectionEnabled) {
            this.arbitrageInterval = setInterval(() => {
                this._scanForArbitrage();
            }, 5000); // Every 5 seconds
        }
        
        console.log('Cross-Asset Matcher initialized');
    }

    /**
     * Register a new liquidity pool
     * @param {Object} pool Pool configuration
     * @returns {Promise<Object>} Registration result
     */
    async registerPool(pool) {
        try {
            await this._validatePool(pool);
            
            const poolId = crypto.randomUUID();
            const poolData = {
                id: poolId,
                ...pool,
                registeredAt: Date.now(),
                lastUpdated: Date.now(),
                status: 'active'
            };
            
            this.liquidityPools.set(poolId, poolData);
            
            // Update asset graph
            await this._updateAssetGraph(poolData);
            
            // Update trading pairs mappings
            await this._updateTradingPairs(poolData);
            
            // Clear relevant caches
            this._invalidatePathCache(pool.tokenA, pool.tokenB);
            
            this.emit('poolRegistered', {
                poolId,
                tokenA: pool.tokenA,
                tokenB: pool.tokenB,
                timestamp: Date.now()
            });
            
            this.metrics.recordPoolRegistration(poolId, pool);
            
            return {
                success: true,
                poolId,
                status: 'registered'
            };
            
        } catch (error) {
            this.metrics.recordError('pool_registration', error);
            throw error;
        }
    }

    /**
     * Find optimal path for cross-asset trade
     * @param {Object} tradeRequest Trade request
     * @returns {Promise<Object>} Optimal path and pricing
     */
    async findOptimalPath(tradeRequest) {
        const startTime = performance.now();
        
        try {
            await this._validateTradeRequest(tradeRequest);
            
            const { fromToken, toToken, amount, maxHops } = tradeRequest;
            
            // Check cache first
            const cacheKey = this._generateCacheKey(fromToken, toToken, amount);
            if (this.config.enableCaching && this.pathCache.has(cacheKey)) {
                const cachedResult = this.pathCache.get(cacheKey);
                if (Date.now() - cachedResult.timestamp < this.config.cacheExpiryTime) {
                    this.metrics.recordCacheHit('path_finding');
                    return cachedResult.data;
                }
            }
            
            // Find all possible paths
            const paths = await this.pathFinder.findPaths({
                fromToken,
                toToken,
                maxHops: Math.min(maxHops || this.config.maxHops, this.config.maxHops),
                maxPaths: this.config.maxPathsPerQuery
            });
            
            if (paths.length === 0) {
                throw new Error(`No trading path found from ${fromToken} to ${toToken}`);
            }
            
            // Calculate pricing for each path
            const pricedPaths = await Promise.all(
                paths.map(path => this._calculatePathPricing(path, amount, tradeRequest))
            );
            
            // Filter paths by liquidity and constraints
            const viablePaths = pricedPaths.filter(path => 
                this._isPathViable(path, tradeRequest)
            );
            
            if (viablePaths.length === 0) {
                throw new Error('No viable trading paths with sufficient liquidity');
            }
            
            // Select optimal path
            const optimalPath = this._selectOptimalPath(viablePaths, tradeRequest);
            
            // Apply price optimization
            if (this.config.priceOptimizationEnabled) {
                await this.priceOptimizer.optimizePath(optimalPath, tradeRequest);
            }
            
            // Validate risk constraints
            await this.riskManager.validatePath(optimalPath, tradeRequest);
            
            const result = {
                path: optimalPath,
                alternativePaths: viablePaths.slice(0, 3), // Top 3 alternatives
                executionPlan: await this._createExecutionPlan(optimalPath),
                priceImpact: optimalPath.totalPriceImpact,
                estimatedOutput: optimalPath.estimatedOutput,
                estimatedGas: optimalPath.estimatedGas,
                confidence: optimalPath.confidence,
                timestamp: Date.now()
            };
            
            // Cache result
            if (this.config.enableCaching) {
                this.pathCache.set(cacheKey, {
                    data: result,
                    timestamp: Date.now()
                });
            }
            
            const processingTime = performance.now() - startTime;
            this.metrics.recordPathFinding(processingTime, paths.length, viablePaths.length);
            
            return result;
            
        } catch (error) {
            this.metrics.recordError('path_finding', error);
            throw error;
        }
    }

    /**
     * Execute cross-asset trade
     * @param {Object} executionPlan Execution plan from findOptimalPath
     * @returns {Promise<Object>} Execution result
     */
    async executeCrossAssetTrade(executionPlan) {
        const startTime = performance.now();
        
        try {
            await this._validateExecutionPlan(executionPlan);
            
            // Check if plan is still valid
            const planValidation = await this._validatePlanCurrency(executionPlan);
            if (!planValidation.valid) {
                throw new Error(`Execution plan outdated: ${planValidation.reason}`);
            }
            
            // Execute trades in sequence
            const executionResults = [];
            let currentAmount = BigInt(executionPlan.inputAmount);
            
            for (let i = 0; i < executionPlan.steps.length; i++) {
                const step = executionPlan.steps[i];
                
                // Execute individual trade step
                const stepResult = await this._executeTradeStep(step, currentAmount);
                executionResults.push(stepResult);
                
                // Update amount for next step
                currentAmount = BigInt(stepResult.outputAmount);
                
                // Apply slippage protection
                if (stepResult.slippage > step.maxSlippage) {
                    throw new Error(`Slippage exceeded limit at step ${i + 1}: ${stepResult.slippage}`);
                }
            }
            
            // Calculate final results
            const finalOutput = executionResults[executionResults.length - 1].outputAmount;
            const totalGasUsed = executionResults.reduce(
                (sum, result) => sum + BigInt(result.gasUsed), 0n
            );
            
            const result = {
                success: true,
                inputAmount: executionPlan.inputAmount,
                outputAmount: finalOutput.toString(),
                expectedOutput: executionPlan.expectedOutput,
                actualSlippage: this._calculateTotalSlippage(executionResults),
                gasUsed: totalGasUsed.toString(),
                executionSteps: executionResults,
                executionTime: performance.now() - startTime,
                timestamp: Date.now()
            };
            
            // Update metrics
            this.metrics.recordTradeExecution(result);
            
            // Emit trade event
            this.emit('crossAssetTradeExecuted', result);
            
            return result;
            
        } catch (error) {
            this.metrics.recordError('trade_execution', error);
            
            // Emit failure event
            this.emit('crossAssetTradeFailed', {
                executionPlan,
                error: error.message,
                timestamp: Date.now()
            });
            
            throw error;
        }
    }

    /**
     * Get cross-asset market data
     * @param {Object} query Market data query
     * @returns {Promise<Object>} Market data
     */
    async getMarketData(query) {
        try {
            const { tokens, includeArbitrage, includeLiquidity } = query;
            
            const marketData = {
                tokens: tokens || Array.from(this.assetGraph.getTokens()),
                pairs: [],
                liquidity: {},
                arbitrageOpportunities: [],
                timestamp: Date.now()
            };
            
            // Get all trading pairs
            for (const [pairKey, poolIds] of this.tradingPairs) {
                const [tokenA, tokenB] = pairKey.split('-');
                
                const pairData = {
                    tokenA,
                    tokenB,
                    pools: [],
                    bestBid: null,
                    bestAsk: null,
                    totalLiquidity: 0
                };
                
                // Aggregate data from all pools for this pair
                for (const poolId of poolIds) {
                    const pool = this.liquidityPools.get(poolId);
                    if (pool && pool.status === 'active') {
                        const poolData = await this._getPoolMarketData(pool);
                        pairData.pools.push(poolData);
                        pairData.totalLiquidity += poolData.totalLiquidity;
                        
                        // Update best prices
                        if (!pairData.bestBid || poolData.bidPrice > pairData.bestBid) {
                            pairData.bestBid = poolData.bidPrice;
                        }
                        if (!pairData.bestAsk || poolData.askPrice < pairData.bestAsk) {
                            pairData.bestAsk = poolData.askPrice;
                        }
                    }
                }
                
                marketData.pairs.push(pairData);
            }
            
            // Include liquidity data if requested
            if (includeLiquidity) {
                marketData.liquidity = await this._aggregateLiquidityData();
            }
            
            // Include arbitrage opportunities if requested
            if (includeArbitrage) {
                marketData.arbitrageOpportunities = Array.from(
                    this.arbitrageOpportunities.values()
                ).slice(0, 10); // Top 10 opportunities
            }
            
            return marketData;
            
        } catch (error) {
            this.metrics.recordError('market_data', error);
            throw error;
        }
    }

    /**
     * Update pool liquidity
     * @param {string} poolId Pool ID
     * @param {Object} liquidityUpdate Liquidity update
     * @returns {Promise<Object>} Update result
     */
    async updatePoolLiquidity(poolId, liquidityUpdate) {
        try {
            const pool = this.liquidityPools.get(poolId);
            if (!pool) {
                throw new Error('Pool not found');
            }
            
            // Validate liquidity update
            await this._validateLiquidityUpdate(liquidityUpdate);
            
            // Update pool data
            pool.reserveA = liquidityUpdate.reserveA;
            pool.reserveB = liquidityUpdate.reserveB;
            pool.lastUpdated = Date.now();
            
            // Update price feeds
            const price = this._calculatePoolPrice(pool);
            this.priceFeeds.set(`${pool.tokenA}-${pool.tokenB}`, {
                price,
                timestamp: Date.now(),
                source: 'pool_update'
            });
            
            // Invalidate related caches
            this._invalidatePathCache(pool.tokenA, pool.tokenB);
            
            // Check for new arbitrage opportunities
            if (this.config.arbitrageDetectionEnabled) {
                await this._checkArbitrageForPool(pool);
            }
            
            this.emit('poolLiquidityUpdated', {
                poolId,
                tokenA: pool.tokenA,
                tokenB: pool.tokenB,
                newPrice: price,
                timestamp: Date.now()
            });
            
            return {
                success: true,
                poolId,
                newPrice: price,
                timestamp: Date.now()
            };
            
        } catch (error) {
            this.metrics.recordError('liquidity_update', error);
            throw error;
        }
    }

    /**
     * Calculate path pricing
     * @param {Object} path Trading path
     * @param {string} amount Input amount
     * @param {Object} tradeRequest Original trade request
     * @returns {Promise<Object>} Priced path
     * @private
     */
    async _calculatePathPricing(path, amount, tradeRequest) {
        let currentAmount = BigInt(amount);
        let totalPriceImpact = 0;
        let totalGasCost = 0n;
        const stepPricing = [];
        
        for (let i = 0; i < path.steps.length; i++) {
            const step = path.steps[i];
            const pool = this.liquidityPools.get(step.poolId);
            
            if (!pool) {
                throw new Error(`Pool not found: ${step.poolId}`);
            }
            
            // Calculate step pricing
            const stepPriceData = await this._calculateStepPricing(
                pool, 
                step.fromToken, 
                step.toToken, 
                currentAmount
            );
            
            stepPricing.push(stepPriceData);
            
            // Update for next step
            currentAmount = BigInt(stepPriceData.outputAmount);
            totalPriceImpact += stepPriceData.priceImpact;
            totalGasCost += BigInt(stepPriceData.gasCost);
        }
        
        // Calculate confidence score
        const confidence = this._calculatePathConfidence(path, stepPricing);
        
        return {
            ...path,
            inputAmount: amount,
            estimatedOutput: currentAmount.toString(),
            stepPricing,
            totalPriceImpact,
            estimatedGas: totalGasCost.toString(),
            confidence,
            calculatedAt: Date.now()
        };
    }

    /**
     * Calculate step pricing for a single hop
     * @param {Object} pool Liquidity pool
     * @param {string} fromToken From token
     * @param {string} toToken To token
     * @param {BigInt} inputAmount Input amount
     * @returns {Promise<Object>} Step pricing
     * @private
     */
    async _calculateStepPricing(pool, fromToken, toToken, inputAmount) {
        const reserveFrom = BigInt(
            pool.tokenA === fromToken ? pool.reserveA : pool.reserveB
        );
        const reserveTo = BigInt(
            pool.tokenA === fromToken ? pool.reserveB : pool.reserveA
        );
        
        // Apply AMM formula (constant product)
        const feeRate = BigInt(pool.fee || 3000); // 0.3% default
        const feeDenominator = 1000000n;
        
        const amountInWithFee = inputAmount * (feeDenominator - feeRate);
        const numerator = amountInWithFee * reserveTo;
        const denominator = (reserveFrom * feeDenominator) + amountInWithFee;
        const outputAmount = numerator / denominator;
        
        // Calculate price impact
        const spotPrice = Number(reserveTo) / Number(reserveFrom);
        const executionPrice = Number(outputAmount) / Number(inputAmount);
        const priceImpact = Math.abs(1 - executionPrice / spotPrice);
        
        // Estimate gas cost
        const gasCost = this._estimateSwapGas(pool);
        
        return {
            poolId: pool.id,
            fromToken,
            toToken,
            inputAmount: inputAmount.toString(),
            outputAmount: outputAmount.toString(),
            spotPrice,
            executionPrice,
            priceImpact,
            gasCost: gasCost.toString(),
            timestamp: Date.now()
        };
    }

    /**
     * Select optimal path from viable options
     * @param {Array} paths Viable paths
     * @param {Object} tradeRequest Trade request
     * @returns {Object} Optimal path
     * @private
     */
    _selectOptimalPath(paths, tradeRequest) {
        const { optimizationStrategy = 'best_output' } = tradeRequest;
        
        switch (optimizationStrategy) {
            case 'best_output':
                return paths.reduce((best, current) => 
                    BigInt(current.estimatedOutput) > BigInt(best.estimatedOutput) ? current : best
                );
                
            case 'lowest_impact':
                return paths.reduce((best, current) => 
                    current.totalPriceImpact < best.totalPriceImpact ? current : best
                );
                
            case 'lowest_gas':
                return paths.reduce((best, current) => 
                    BigInt(current.estimatedGas) < BigInt(best.estimatedGas) ? current : best
                );
                
            case 'highest_confidence':
                return paths.reduce((best, current) => 
                    current.confidence > best.confidence ? current : best
                );
                
            case 'balanced':
            default:
                // Balanced approach considering output, impact, and confidence
                return paths.reduce((best, current) => {
                    const bestScore = this._calculateBalancedScore(best);
                    const currentScore = this._calculateBalancedScore(current);
                    return currentScore > bestScore ? current : best;
                });
        }
    }

    /**
     * Calculate balanced score for path selection
     * @param {Object} path Path to score
     * @returns {number} Balanced score
     * @private
     */
    _calculateBalancedScore(path) {
        const outputWeight = 0.4;
        const impactWeight = 0.3;
        const confidenceWeight = 0.2;
        const gasWeight = 0.1;
        
        // Normalize metrics (simplified)
        const outputScore = Math.log(Number(path.estimatedOutput)) / 50; // Normalize output
        const impactScore = 1 - Math.min(path.totalPriceImpact, 1); // Lower impact is better
        const confidenceScore = path.confidence;
        const gasScore = 1 - Math.min(Number(path.estimatedGas) / 1000000, 1); // Lower gas is better
        
        return (
            outputScore * outputWeight +
            impactScore * impactWeight +
            confidenceScore * confidenceWeight +
            gasScore * gasWeight
        );
    }

    /**
     * Check if path is viable
     * @param {Object} path Path to check
     * @param {Object} tradeRequest Trade request
     * @returns {boolean} True if viable
     * @private
     */
    _isPathViable(path, tradeRequest) {
        // Check minimum output
        if (tradeRequest.minOutput && 
            BigInt(path.estimatedOutput) < BigInt(tradeRequest.minOutput)) {
            return false;
        }
        
        // Check maximum price impact
        if (tradeRequest.maxPriceImpact && 
            path.totalPriceImpact > tradeRequest.maxPriceImpact) {
            return false;
        }
        
        // Check maximum gas cost
        if (tradeRequest.maxGas && 
            BigInt(path.estimatedGas) > BigInt(tradeRequest.maxGas)) {
            return false;
        }
        
        // Check confidence threshold
        if (tradeRequest.minConfidence && 
            path.confidence < tradeRequest.minConfidence) {
            return false;
        }
        
        // Check liquidity threshold
        const hasInsufficientLiquidity = path.stepPricing.some(step => {
            const pool = this.liquidityPools.get(step.poolId);
            const minReserve = BigInt(this.config.minLiquidityThreshold);
            return BigInt(pool.reserveA) < minReserve || BigInt(pool.reserveB) < minReserve;
        });
        
        if (hasInsufficientLiquidity) {
            return false;
        }
        
        return true;
    }

    /**
     * Create execution plan from optimal path
     * @param {Object} path Optimal path
     * @returns {Promise<Object>} Execution plan
     * @private
     */
    async _createExecutionPlan(path) {
        const executionSteps = [];
        
        for (let i = 0; i < path.stepPricing.length; i++) {
            const stepPricing = path.stepPricing[i];
            const pool = this.liquidityPools.get(stepPricing.poolId);
            
            executionSteps.push({
                stepNumber: i + 1,
                poolId: stepPricing.poolId,
                poolAddress: pool.address,
                fromToken: stepPricing.fromToken,
                toToken: stepPricing.toToken,
                inputAmount: stepPricing.inputAmount,
                expectedOutput: stepPricing.outputAmount,
                maxSlippage: 0.01, // 1% default slippage tolerance
                deadline: Date.now() + 300000, // 5 minutes
                gasLimit: Math.ceil(Number(stepPricing.gasCost) * 1.2) // 20% buffer
            });
        }
        
        return {
            inputToken: path.fromToken,
            outputToken: path.toToken,
            inputAmount: path.inputAmount,
            expectedOutput: path.estimatedOutput,
            totalSteps: executionSteps.length,
            steps: executionSteps,
            maxTotalSlippage: 0.05, // 5% total slippage tolerance
            deadline: Date.now() + 300000, // 5 minutes
            createdAt: Date.now()
        };
    }

    /**
     * Execute individual trade step
     * @param {Object} step Execution step
     * @param {BigInt} actualInputAmount Actual input amount
     * @returns {Promise<Object>} Step execution result
     * @private
     */
    async _executeTradeStep(step, actualInputAmount) {
        // Mock implementation - would integrate with actual DEX contracts
        const pool = this.liquidityPools.get(step.poolId);
        
        // Recalculate with actual input amount
        const actualPricing = await this._calculateStepPricing(
            pool,
            step.fromToken,
            step.toToken,
            actualInputAmount
        );
        
        // Calculate slippage
        const expectedOutput = BigInt(step.expectedOutput);
        const actualOutput = BigInt(actualPricing.outputAmount);
        const slippage = Number(expectedOutput - actualOutput) / Number(expectedOutput);
        
        // Mock execution result
        return {
            stepNumber: step.stepNumber,
            poolId: step.poolId,
            inputAmount: actualInputAmount.toString(),
            outputAmount: actualPricing.outputAmount,
            executedPrice: actualPricing.executionPrice,
            slippage: Math.abs(slippage),
            gasUsed: actualPricing.gasCost,
            txHash: crypto.randomBytes(32).toString('hex'),
            timestamp: Date.now()
        };
    }

    /**
     * Update asset graph with new pool
     * @param {Object} pool Pool data
     * @private
     */
    async _updateAssetGraph(pool) {
        this.assetGraph.addEdge(pool.tokenA, pool.tokenB, {
            poolId: pool.id,
            fee: pool.fee || 3000,
            weight: this._calculateEdgeWeight(pool)
        });
    }

    /**
     * Update trading pairs mappings
     * @param {Object} pool Pool data
     * @private
     */
    async _updateTradingPairs(pool) {
        const pairKey = `${pool.tokenA}-${pool.tokenB}`;
        const reversePairKey = `${pool.tokenB}-${pool.tokenA}`;
        
        // Add to both directions
        [pairKey, reversePairKey].forEach(key => {
            if (!this.tradingPairs.has(key)) {
                this.tradingPairs.set(key, new Set());
            }
            this.tradingPairs.get(key).add(pool.id);
        });
    }

    /**
     * Calculate edge weight for graph algorithms
     * @param {Object} pool Pool data
     * @returns {number} Edge weight
     * @private
     */
    _calculateEdgeWeight(pool) {
        // Lower weight = better path (higher liquidity, lower fees)
        const liquidityScore = Math.log(Number(pool.reserveA) + Number(pool.reserveB));
        const feeScore = (pool.fee || 3000) / 1000000; // Normalize fee
        
        return feeScore / liquidityScore;
    }

    /**
     * Generate cache key for path finding
     * @param {string} fromToken From token
     * @param {string} toToken To token
     * @param {string} amount Amount
     * @returns {string} Cache key
     * @private
     */
    _generateCacheKey(fromToken, toToken, amount) {
        return `${fromToken}-${toToken}-${amount}`;
    }

    /**
     * Invalidate path cache for token pair
     * @param {string} tokenA Token A
     * @param {string} tokenB Token B
     * @private
     */
    _invalidatePathCache(tokenA, tokenB) {
        // Remove all cache entries involving these tokens
        for (const [key, value] of this.pathCache) {
            if (key.includes(tokenA) || key.includes(tokenB)) {
                this.pathCache.delete(key);
            }
        }
    }

    /**
     * Clean up expired cache entries
     * @private
     */
    _cleanupCache() {
        const now = Date.now();
        const expiryTime = this.config.cacheExpiryTime;
        
        for (const [key, value] of this.pathCache) {
            if (now - value.timestamp > expiryTime) {
                this.pathCache.delete(key);
            }
        }
    }

    /**
     * Scan for arbitrage opportunities
     * @private
     */
    async _scanForArbitrage() {
        try {
            const opportunities = await this.arbitrageDetector.scanOpportunities(
                this.liquidityPools,
                this.assetGraph
            );
            
            // Update arbitrage opportunities
            this.arbitrageOpportunities.clear();
            opportunities.forEach(opp => {
                this.arbitrageOpportunities.set(opp.id, opp);
            });
            
            // Emit significant opportunities
            const significantOpportunities = opportunities.filter(
                opp => BigInt(opp.profit) > BigInt(this.config.minArbitrageProfit)
            );
            
            if (significantOpportunities.length > 0) {
                this.emit('arbitrageOpportunitiesDetected', {
                    opportunities: significantOpportunities,
                    timestamp: Date.now()
                });
            }
            
        } catch (error) {
            console.error('Arbitrage scanning error:', error);
        }
    }

    /**
     * Validate pool configuration
     * @param {Object} pool Pool to validate
     * @private
     */
    async _validatePool(pool) {
        if (!pool.tokenA || !pool.tokenB) {
            throw new Error('Pool must specify both tokenA and tokenB');
        }
        
        if (pool.tokenA === pool.tokenB) {
            throw new Error('Pool tokens must be different');
        }
        
        if (!pool.reserveA || !pool.reserveB) {
            throw new Error('Pool must specify both reserves');
        }
        
        if (!pool.address) {
            throw new Error('Pool must specify contract address');
        }
    }

    /**
     * Validate trade request
     * @param {Object} tradeRequest Trade request to validate
     * @private
     */
    async _validateTradeRequest(tradeRequest) {
        if (!tradeRequest.fromToken || !tradeRequest.toToken) {
            throw new Error('Trade request must specify both from and to tokens');
        }
        
        if (tradeRequest.fromToken === tradeRequest.toToken) {
            throw new Error('From and to tokens must be different');
        }
        
        if (!tradeRequest.amount || BigInt(tradeRequest.amount) <= 0n) {
            throw new Error('Trade amount must be positive');
        }
    }

    /**
     * Get cross-asset matcher statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            activePools: this.liquidityPools.size,
            tradingPairs: this.tradingPairs.size,
            arbitrageOpportunities: this.arbitrageOpportunities.size,
            cachedPaths: this.pathCache.size,
            supportedTokens: this.assetGraph.getTokens().length,
            metrics: this.metrics.getMetrics(),
            pathFinder: this.pathFinder.getStatistics(),
            arbitrageDetector: this.arbitrageDetector.getStatistics()
        };
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.cacheCleanupInterval) {
            clearInterval(this.cacheCleanupInterval);
        }
        
        if (this.arbitrageInterval) {
            clearInterval(this.arbitrageInterval);
        }
        
        this.liquidityPools.clear();
        this.tradingPairs.clear();
        this.pathCache.clear();
        this.arbitrageOpportunities.clear();
        
        this.emit('matcherDestroyed');
    }
}

// =============================================================================
// SUPPORTING CLASSES (SIMPLIFIED IMPLEMENTATIONS)
// =============================================================================

class AssetGraph {
    constructor() {
        this.graph = new Map();
    }

    addEdge(tokenA, tokenB, edgeData) {
        if (!this.graph.has(tokenA)) {
            this.graph.set(tokenA, new Map());
        }
        if (!this.graph.has(tokenB)) {
            this.graph.set(tokenB, new Map());
        }
        
        this.graph.get(tokenA).set(tokenB, edgeData);
        this.graph.get(tokenB).set(tokenA, edgeData);
    }

    getTokens() {
        return Array.from(this.graph.keys());
    }

    getNeighbors(token) {
        return this.graph.get(token) || new Map();
    }
}

class PathFinder {
    constructor(config) {
        this.config = config;
    }

    async initialize() {
        console.log('Path Finder initialized');
    }

    async findPaths({ fromToken, toToken, maxHops, maxPaths }) {
        // Simplified path finding - would implement Dijkstra's or similar
        const paths = [];
        
        // Direct path
        paths.push({
            fromToken,
            toToken,
            steps: [{
                fromToken,
                toToken,
                poolId: 'mock-pool-1'
            }],
            hopCount: 1
        });
        
        return paths;
    }

    getStatistics() {
        return {
            pathsFound: 0,
            averageHops: 1.5
        };
    }
}

class LiquidityAggregator {
    constructor(config) {
        this.config = config;
    }

    async initialize() {
        console.log('Liquidity Aggregator initialized');
    }
}

class ArbitrageDetector {
    constructor(config) {
        this.config = config;
    }

    async initialize() {
        console.log('Arbitrage Detector initialized');
    }

    async scanOpportunities(pools, assetGraph) {
        // Mock implementation
        return [];
    }

    getStatistics() {
        return {
            opportunitiesDetected: 0,
            totalProfit: '0'
        };
    }
}

class PriceOptimizer {
    constructor(config) {
        this.config = config;
    }

    async initialize() {
        console.log('Price Optimizer initialized');
    }

    async optimizePath(path, tradeRequest) {
        // Mock optimization
        return path;
    }
}

class CrossAssetRiskManager {
    constructor(config) {
        this.config = config;
    }

    async initialize() {
        console.log('Cross-Asset Risk Manager initialized');
    }

    async validatePath(path, tradeRequest) {
        // Mock risk validation
        return true;
    }
}

class CrossAssetMetrics {
    constructor() {
        this.metrics = {
            pathsFound: 0,
            tradesExecuted: 0,
            totalVolume: '0',
            averagePathLength: 0,
            cacheHitRate: 0
        };
    }

    recordPathFinding(processingTime, totalPaths, viablePaths) {
        this.metrics.pathsFound++;
    }

    recordTradeExecution(result) {
        this.metrics.tradesExecuted++;
        const currentVolume = BigInt(this.metrics.totalVolume);
        this.metrics.totalVolume = (currentVolume + BigInt(result.inputAmount)).toString();
    }

    recordPoolRegistration(poolId, pool) {
        // Track pool registration
    }

    recordCacheHit(operation) {
        // Track cache performance
    }

    recordError(operation, error) {
        console.error(`Cross-asset error in ${operation}:`, error.message);
    }

    getMetrics() {
        return { ...this.metrics };
    }
}

class PerformanceMonitor {
    constructor() {
        this.measurements = new Map();
    }

    startMeasurement(id) {
        this.measurements.set(id, performance.now());
    }

    endMeasurement(id) {
        const start = this.measurements.get(id);
        if (start) {
            this.measurements.delete(id);
            return performance.now() - start;
        }
        return 0;
    }
}

module.exports = {
    CrossAssetMatcher,
    AssetGraph,
    PathFinder,
    LiquidityAggregator,
    ArbitrageDetector,
    PriceOptimizer,
    CrossAssetRiskManager,
    CrossAssetMetrics,
    PerformanceMonitor
};