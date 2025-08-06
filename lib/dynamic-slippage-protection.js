/**
 * @title Dynamic Slippage Protection Service
 * @author DEX Security Team
 * @notice Advanced slippage protection with real-time price analysis and dynamic limits
 * @dev Provides intelligent slippage calculation based on market conditions and volatility
 */

const { ethers } = require('ethers');

class DynamicSlippageProtection {
    constructor(config) {
        this.config = {
            provider: new ethers.providers.JsonRpcProvider(config.rpcUrl),
            priceOracles: config.priceOracles || [],
            chainlinkFeeds: config.chainlinkFeeds || {},
            uniswapV3Factory: config.uniswapV3Factory,
            defaultSlippageBps: config.defaultSlippageBps || 50, // 0.5%
            maxSlippageBps: config.maxSlippageBps || 1000, // 10%
            volatilityWindow: config.volatilityWindow || 300, // 5 minutes
            priceUpdateInterval: config.priceUpdateInterval || 10000, // 10 seconds
            emergencySlippageBps: config.emergencySlippageBps || 2000, // 20%
            ...config
        };

        this.priceCache = new Map();
        this.volatilityCache = new Map();
        this.liquidityCache = new Map();
        this.priceHistory = new Map();
        this.marketConditions = {
            volatility: 'normal',
            liquidity: 'normal',
            congestion: 'normal',
            trend: 'stable'
        };

        this.slippageStats = {
            ordersAnalyzed: 0,
            slippageViolations: 0,
            dynamicAdjustments: 0,
            emergencyTriggers: 0,
            averageSlippageUsed: 0
        };

        this._startPriceMonitoring();
        this._startMarketAnalysis();
    }

    /**
     * Calculate optimal slippage protection for an order
     * @param {Object} orderParams Order parameters
     * @returns {Promise<Object>} Slippage protection configuration
     */
    async calculateOptimalSlippage(orderParams) {
        try {
            const {
                tokenIn,
                tokenOut,
                amountIn,
                userSlippageBps,
                urgency = 'normal', // low, normal, high, emergency
                executionStrategy = 'standard' // standard, mev_protected, flashbot
            } = orderParams;

            // Validate inputs
            this._validateOrderParams(orderParams);

            // Get current price data
            const priceData = await this._getCurrentPriceData(tokenIn, tokenOut);
            
            // Calculate base slippage
            const baseSlippage = await this._calculateBaseSlippage(tokenIn, tokenOut, amountIn);
            
            // Apply volatility adjustment
            const volatilityAdjustment = await this._calculateVolatilityAdjustment(tokenIn, tokenOut);
            
            // Apply liquidity adjustment
            const liquidityAdjustment = await this._calculateLiquidityAdjustment(tokenIn, tokenOut, amountIn);
            
            // Apply market condition adjustments
            const marketAdjustment = await this._calculateMarketConditionAdjustment();
            
            // Apply urgency adjustment
            const urgencyAdjustment = this._calculateUrgencyAdjustment(urgency);
            
            // Apply execution strategy adjustment
            const strategyAdjustment = this._calculateStrategyAdjustment(executionStrategy);

            // Combine all adjustments
            const calculatedSlippageBps = Math.max(
                this.config.defaultSlippageBps,
                Math.min(
                    this.config.maxSlippageBps,
                    baseSlippage + volatilityAdjustment + liquidityAdjustment + 
                    marketAdjustment + urgencyAdjustment + strategyAdjustment
                )
            );

            // Use user preference if it's reasonable
            const recommendedSlippageBps = userSlippageBps && userSlippageBps >= calculatedSlippageBps
                ? userSlippageBps
                : calculatedSlippageBps;

            // Check for emergency conditions
            const emergencyConditions = await this._checkEmergencyConditions(tokenIn, tokenOut);
            
            const finalSlippageBps = emergencyConditions.isEmergency
                ? Math.max(recommendedSlippageBps, this.config.emergencySlippageBps)
                : recommendedSlippageBps;

            // Calculate price boundaries
            const priceBoundaries = this._calculatePriceBoundaries(
                priceData.currentPrice,
                finalSlippageBps,
                amountIn
            );

            // Generate protection strategy
            const protectionStrategy = this._generateProtectionStrategy(
                finalSlippageBps,
                emergencyConditions,
                orderParams
            );

            this.slippageStats.ordersAnalyzed++;
            if (finalSlippageBps > this.config.defaultSlippageBps) {
                this.slippageStats.dynamicAdjustments++;
            }
            if (emergencyConditions.isEmergency) {
                this.slippageStats.emergencyTriggers++;
            }

            return {
                recommendedSlippageBps: finalSlippageBps,
                minAmountOut: priceBoundaries.minAmountOut,
                maxAmountIn: priceBoundaries.maxAmountIn,
                priceImpactEstimate: baseSlippage,
                volatilityFactor: volatilityAdjustment,
                liquidityFactor: liquidityAdjustment,
                marketConditions: this.marketConditions,
                emergencyConditions,
                protectionStrategy,
                confidence: this._calculateConfidence(priceData),
                expirationTime: Date.now() + (5 * 60 * 1000), // 5 minutes
                monitoring: {
                    shouldMonitor: finalSlippageBps > 100, // Monitor if >1%
                    alertThreshold: finalSlippageBps * 1.5,
                    stopLossThreshold: finalSlippageBps * 2
                }
            };

        } catch (error) {
            console.error('Slippage calculation failed:', error);
            return this._getEmergencySlippageConfig(orderParams);
        }
    }

    /**
     * Monitor order execution for slippage violations
     * @param {Object} order Order being executed
     * @param {Object} executionResult Execution result
     * @returns {Promise<Object>} Monitoring result
     */
    async monitorOrderExecution(order, executionResult) {
        try {
            const {
                tokenIn,
                tokenOut,
                amountIn,
                expectedAmountOut,
                actualAmountOut,
                slippageLimit
            } = executionResult;

            // Calculate actual slippage
            const actualSlippageBps = this._calculateActualSlippage(
                expectedAmountOut,
                actualAmountOut
            );

            // Check if slippage exceeded limits
            const slippageViolation = actualSlippageBps > slippageLimit;
            
            if (slippageViolation) {
                this.slippageStats.slippageViolations++;
                await this._handleSlippageViolation(order, actualSlippageBps, slippageLimit);
            }

            // Update price history with execution data
            await this._updatePriceHistory(tokenIn, tokenOut, {
                price: actualAmountOut / amountIn,
                slippage: actualSlippageBps,
                timestamp: Date.now(),
                volume: amountIn
            });

            // Analyze for market manipulation
            const manipulationAnalysis = await this._analyzeForManipulation(
                order,
                actualSlippageBps
            );

            return {
                actualSlippageBps,
                slippageViolation,
                slippageLimit,
                exceedBy: Math.max(0, actualSlippageBps - slippageLimit),
                manipulationRisk: manipulationAnalysis.riskLevel,
                recommendations: this._generateExecutionRecommendations(
                    actualSlippageBps,
                    slippageLimit,
                    manipulationAnalysis
                )
            };

        } catch (error) {
            console.error('Order execution monitoring failed:', error);
            return {
                actualSlippageBps: 0,
                slippageViolation: false,
                error: error.message
            };
        }
    }

    /**
     * Get real-time slippage adjustment for changing market conditions
     * @param {string} tokenIn Input token address
     * @param {string} tokenOut Output token address
     * @param {Object} currentOrder Current order parameters
     * @returns {Promise<Object>} Real-time adjustment
     */
    async getRealTimeSlippageAdjustment(tokenIn, tokenOut, currentOrder) {
        const currentConditions = await this._getCurrentMarketConditions(tokenIn, tokenOut);
        const originalSlippage = currentOrder.slippageBps;
        
        // Calculate adjustment based on changing conditions
        let adjustment = 0;
        const reasons = [];

        // Volatility spike adjustment
        if (currentConditions.volatility > this.marketConditions.volatility * 1.5) {
            adjustment += 50; // Additional 0.5%
            reasons.push('Volatility spike detected');
        }

        // Liquidity crisis adjustment
        if (currentConditions.liquidity < this.marketConditions.liquidity * 0.5) {
            adjustment += 100; // Additional 1%
            reasons.push('Liquidity crisis detected');
        }

        // Network congestion adjustment
        if (currentConditions.gasPrice > 100) { // >100 gwei
            adjustment += 25; // Additional 0.25%
            reasons.push('High network congestion');
        }

        // MEV activity adjustment
        if (currentConditions.mevActivity > 0.3) {
            adjustment += 75; // Additional 0.75%
            reasons.push('High MEV activity');
        }

        const newSlippageBps = Math.min(
            this.config.maxSlippageBps,
            originalSlippage + adjustment
        );

        return {
            originalSlippageBps: originalSlippage,
            adjustedSlippageBps: newSlippageBps,
            adjustment,
            reasons,
            shouldUpdate: adjustment > 10, // Update if >0.1% adjustment
            urgency: adjustment > 50 ? 'high' : adjustment > 20 ? 'medium' : 'low'
        };
    }

    /**
     * Analyze token pair for slippage characteristics
     * @param {string} tokenIn Input token address
     * @param {string} tokenOut Output token address
     * @returns {Promise<Object>} Pair analysis
     */
    async analyzePairSlippageCharacteristics(tokenIn, tokenOut) {
        try {
            // Get historical data
            const historicalData = await this._getHistoricalPriceData(tokenIn, tokenOut);
            
            // Calculate volatility metrics
            const volatilityMetrics = this._calculateVolatilityMetrics(historicalData);
            
            // Analyze liquidity patterns
            const liquidityAnalysis = await this._analyzeLiquidityPatterns(tokenIn, tokenOut);
            
            // Check for manipulation history
            const manipulationHistory = await this._checkManipulationHistory(tokenIn, tokenOut);
            
            // Calculate slippage profile
            const slippageProfile = this._calculateSlippageProfile(
                volatilityMetrics,
                liquidityAnalysis,
                manipulationHistory
            );

            return {
                volatility: {
                    daily: volatilityMetrics.daily,
                    weekly: volatilityMetrics.weekly,
                    trend: volatilityMetrics.trend,
                    classification: this._classifyVolatility(volatilityMetrics.daily)
                },
                liquidity: {
                    depth: liquidityAnalysis.depth,
                    stability: liquidityAnalysis.stability,
                    concentration: liquidityAnalysis.concentration,
                    classification: this._classifyLiquidity(liquidityAnalysis.depth)
                },
                riskFactors: {
                    manipulation: manipulationHistory.riskLevel,
                    flashLoanVulnerability: liquidityAnalysis.flashLoanRisk,
                    volatilityRisk: volatilityMetrics.riskLevel
                },
                slippageProfile: {
                    recommended: {
                        conservative: slippageProfile.conservative,
                        moderate: slippageProfile.moderate,
                        aggressive: slippageProfile.aggressive
                    },
                    emergency: slippageProfile.emergency,
                    factors: slippageProfile.factors
                },
                confidence: this._calculateAnalysisConfidence(historicalData.length)
            };

        } catch (error) {
            console.error('Pair analysis failed:', error);
            return this._getDefaultPairAnalysis();
        }
    }

    // =============================================================================
    // PRICE MONITORING AND ANALYSIS
    // =============================================================================

    /**
     * Start real-time price monitoring
     */
    _startPriceMonitoring() {
        console.log('Starting price monitoring for slippage protection...');

        // Subscribe to price feeds
        this._subscribeToPriceFeeds();

        // Periodic price updates
        setInterval(async () => {
            await this._updateAllPrices();
        }, this.config.priceUpdateInterval);

        // Clean up old data
        setInterval(() => {
            this._cleanupOldData();
        }, 60000); // Every minute
    }

    /**
     * Start market condition analysis
     */
    _startMarketAnalysis() {
        // Update market conditions every 30 seconds
        setInterval(async () => {
            await this._updateMarketConditions();
        }, 30000);
    }

    /**
     * Subscribe to price feeds from multiple sources
     */
    async _subscribeToPriceFeeds() {
        // Chainlink price feeds
        for (const [pair, feedAddress] of Object.entries(this.config.chainlinkFeeds)) {
            try {
                const feed = new ethers.Contract(
                    feedAddress,
                    ['function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'],
                    this.config.provider
                );

                // Subscribe to updates
                feed.on('AnswerUpdated', async (current, roundId, updatedAt) => {
                    await this._handlePriceFeedUpdate(pair, current, updatedAt);
                });
            } catch (error) {
                console.error(`Failed to subscribe to price feed for ${pair}:`, error);
            }
        }
    }

    /**
     * Handle price feed update
     * @param {string} pair Token pair identifier
     * @param {BigNumber} price New price
     * @param {BigNumber} timestamp Update timestamp
     */
    async _handlePriceFeedUpdate(pair, price, timestamp) {
        const priceData = {
            price: parseFloat(ethers.utils.formatUnits(price, 8)),
            timestamp: timestamp.toNumber() * 1000,
            source: 'chainlink'
        };

        // Update cache
        this.priceCache.set(pair, priceData);

        // Update price history
        if (!this.priceHistory.has(pair)) {
            this.priceHistory.set(pair, []);
        }
        
        const history = this.priceHistory.get(pair);
        history.push(priceData);

        // Keep only recent history
        const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
        this.priceHistory.set(
            pair,
            history.filter(entry => entry.timestamp > cutoff)
        );

        // Update volatility
        await this._updateVolatility(pair);
    }

    /**
     * Get current price data for token pair
     * @param {string} tokenIn Input token
     * @param {string} tokenOut Output token
     * @returns {Promise<Object>} Price data
     */
    async _getCurrentPriceData(tokenIn, tokenOut) {
        const pairKey = `${tokenIn}-${tokenOut}`;
        
        // Check cache first
        const cached = this.priceCache.get(pairKey);
        if (cached && Date.now() - cached.timestamp < 30000) { // 30 seconds
            return cached;
        }

        // Fetch from multiple sources
        const prices = await Promise.allSettled([
            this._getChainlinkPrice(tokenIn, tokenOut),
            this._getUniswapV3Price(tokenIn, tokenOut),
            this._getDEXAggregatorPrice(tokenIn, tokenOut)
        ]);

        // Calculate weighted average
        const validPrices = prices
            .filter(result => result.status === 'fulfilled' && result.value)
            .map(result => result.value);

        if (validPrices.length === 0) {
            throw new Error('Unable to fetch price data from any source');
        }

        const averagePrice = validPrices.reduce((sum, price) => sum + price.price, 0) / validPrices.length;
        const confidence = Math.min(100, validPrices.length * 30); // Max confidence with 3+ sources

        const priceData = {
            currentPrice: averagePrice,
            sources: validPrices.length,
            confidence,
            timestamp: Date.now(),
            spread: this._calculatePriceSpread(validPrices)
        };

        this.priceCache.set(pairKey, priceData);
        return priceData;
    }

    /**
     * Calculate base slippage for token pair and amount
     * @param {string} tokenIn Input token
     * @param {string} tokenOut Output token
     * @param {BigNumber} amountIn Input amount
     * @returns {Promise<number>} Base slippage in basis points
     */
    async _calculateBaseSlippage(tokenIn, tokenOut, amountIn) {
        try {
            // Get liquidity data
            const liquidityData = await this._getLiquidityData(tokenIn, tokenOut);
            
            if (!liquidityData || liquidityData.totalLiquidity.eq(0)) {
                return this.config.defaultSlippageBps * 2; // Double default for unknown liquidity
            }

            // Calculate price impact based on amount vs liquidity
            const impactRatio = amountIn.mul(10000).div(liquidityData.totalLiquidity);
            
            // Base formula: impact = sqrt(amount / liquidity) * constant
            const sqrtImpact = Math.sqrt(parseFloat(ethers.utils.formatEther(impactRatio)));
            const baseSlippageBps = Math.max(
                this.config.defaultSlippageBps,
                Math.min(500, sqrtImpact * 100) // Cap at 5%
            );

            return baseSlippageBps;

        } catch (error) {
            console.error('Base slippage calculation failed:', error);
            return this.config.defaultSlippageBps;
        }
    }

    /**
     * Calculate volatility adjustment
     * @param {string} tokenIn Input token
     * @param {string} tokenOut Output token
     * @returns {Promise<number>} Volatility adjustment in basis points
     */
    async _calculateVolatilityAdjustment(tokenIn, tokenOut) {
        const pairKey = `${tokenIn}-${tokenOut}`;
        const volatility = this.volatilityCache.get(pairKey);
        
        if (!volatility) {
            return 25; // Default 0.25% adjustment
        }

        // Convert volatility to slippage adjustment
        // High volatility = higher slippage protection needed
        if (volatility > 0.1) return 200; // 2% for very high volatility
        if (volatility > 0.05) return 100; // 1% for high volatility
        if (volatility > 0.02) return 50;  // 0.5% for medium volatility
        if (volatility > 0.01) return 25;  // 0.25% for low volatility
        return 0; // No adjustment for very low volatility
    }

    /**
     * Calculate liquidity adjustment
     * @param {string} tokenIn Input token
     * @param {string} tokenOut Output token
     * @param {BigNumber} amountIn Input amount
     * @returns {Promise<number>} Liquidity adjustment in basis points
     */
    async _calculateLiquidityAdjustment(tokenIn, tokenOut, amountIn) {
        try {
            const liquidityData = await this._getLiquidityData(tokenIn, tokenOut);
            
            if (!liquidityData) {
                return 100; // 1% adjustment for unknown liquidity
            }

            // Calculate depth ratio
            const depthRatio = amountIn.mul(100).div(liquidityData.totalLiquidity);
            
            if (depthRatio.gt(20)) return 300; // 3% for >20% of liquidity
            if (depthRatio.gt(10)) return 200; // 2% for >10% of liquidity
            if (depthRatio.gt(5)) return 100;  // 1% for >5% of liquidity
            if (depthRatio.gt(1)) return 50;   // 0.5% for >1% of liquidity
            return 0; // No adjustment for small trades

        } catch (error) {
            console.error('Liquidity adjustment calculation failed:', error);
            return 50; // Default 0.5% adjustment
        }
    }

    /**
     * Calculate market condition adjustment
     * @returns {Promise<number>} Market adjustment in basis points
     */
    async _calculateMarketConditionAdjustment() {
        let adjustment = 0;

        // Network congestion adjustment
        const gasPrice = await this.config.provider.getGasPrice();
        const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
        
        if (gasPriceGwei > 100) adjustment += 100; // 1% for very high gas
        else if (gasPriceGwei > 50) adjustment += 50; // 0.5% for high gas
        else if (gasPriceGwei > 20) adjustment += 25; // 0.25% for elevated gas

        // Market trend adjustment
        if (this.marketConditions.trend === 'volatile') adjustment += 75;
        else if (this.marketConditions.trend === 'bearish') adjustment += 50;
        else if (this.marketConditions.trend === 'bullish') adjustment += 25;

        return adjustment;
    }

    /**
     * Calculate urgency adjustment
     * @param {string} urgency Urgency level
     * @returns {number} Urgency adjustment in basis points
     */
    _calculateUrgencyAdjustment(urgency) {
        switch (urgency) {
            case 'emergency': return 200; // 2%
            case 'high': return 100; // 1%
            case 'normal': return 0;
            case 'low': return -25; // Can use tighter slippage
            default: return 0;
        }
    }

    /**
     * Calculate execution strategy adjustment
     * @param {string} strategy Execution strategy
     * @returns {number} Strategy adjustment in basis points
     */
    _calculateStrategyAdjustment(strategy) {
        switch (strategy) {
            case 'flashbot': return -50; // MEV protection allows tighter slippage
            case 'mev_protected': return -25; // Some MEV protection
            case 'standard': return 0;
            case 'aggressive': return 50; // Higher slippage for speed
            default: return 0;
        }
    }

    // =============================================================================
    // EMERGENCY AND VIOLATION HANDLING
    // =============================================================================

    /**
     * Check for emergency market conditions
     * @param {string} tokenIn Input token
     * @param {string} tokenOut Output token
     * @returns {Promise<Object>} Emergency conditions
     */
    async _checkEmergencyConditions(tokenIn, tokenOut) {
        const conditions = {
            isEmergency: false,
            triggers: [],
            severity: 'normal'
        };

        try {
            // Check volatility spike
            const pairKey = `${tokenIn}-${tokenOut}`;
            const volatility = this.volatilityCache.get(pairKey) || 0;
            
            if (volatility > 0.2) { // 20% volatility
                conditions.isEmergency = true;
                conditions.triggers.push('extreme_volatility');
                conditions.severity = 'critical';
            } else if (volatility > 0.1) { // 10% volatility
                conditions.isEmergency = true;
                conditions.triggers.push('high_volatility');
                conditions.severity = 'high';
            }

            // Check liquidity crisis
            const liquidityData = await this._getLiquidityData(tokenIn, tokenOut);
            if (liquidityData && liquidityData.totalLiquidity.lt(ethers.utils.parseEther('1000'))) {
                conditions.isEmergency = true;
                conditions.triggers.push('liquidity_crisis');
                conditions.severity = 'high';
            }

            // Check network congestion
            const gasPrice = await this.config.provider.getGasPrice();
            const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
            
            if (gasPriceGwei > 200) { // >200 gwei
                conditions.isEmergency = true;
                conditions.triggers.push('extreme_congestion');
                conditions.severity = conditions.severity === 'critical' ? 'critical' : 'high';
            }

            // Check for flash crash
            const priceData = await this._getCurrentPriceData(tokenIn, tokenOut);
            const recentHistory = this.priceHistory.get(`${tokenIn}-${tokenOut}`) || [];
            
            if (recentHistory.length > 0) {
                const recentPrice = recentHistory[recentHistory.length - 1].price;
                const priceChange = Math.abs(priceData.currentPrice - recentPrice) / recentPrice;
                
                if (priceChange > 0.1) { // 10% price change
                    conditions.isEmergency = true;
                    conditions.triggers.push('flash_crash');
                    conditions.severity = 'critical';
                }
            }

        } catch (error) {
            console.error('Emergency condition check failed:', error);
            // Err on the side of caution
            conditions.isEmergency = true;
            conditions.triggers.push('system_error');
            conditions.severity = 'high';
        }

        return conditions;
    }

    /**
     * Handle slippage violation
     * @param {Object} order Order that violated slippage
     * @param {number} actualSlippage Actual slippage experienced
     * @param {number} slippageLimit Slippage limit that was set
     */
    async _handleSlippageViolation(order, actualSlippage, slippageLimit) {
        console.warn(`Slippage violation detected:`, {
            orderId: order.id,
            actualSlippage: `${(actualSlippage / 100).toFixed(2)}%`,
            limit: `${(slippageLimit / 100).toFixed(2)}%`,
            excess: `${((actualSlippage - slippageLimit) / 100).toFixed(2)}%`
        });

        // Update violation statistics
        this.slippageStats.slippageViolations++;

        // Analyze for potential manipulation
        const manipulation = await this._analyzeForManipulation(order, actualSlippage);
        
        if (manipulation.riskLevel === 'high') {
            console.error('Potential price manipulation detected:', manipulation);
        }

        // Update protection parameters for future orders
        await this._updateProtectionParameters(order.tokenIn, order.tokenOut, actualSlippage);
    }

    /**
     * Analyze execution for potential manipulation
     * @param {Object} order Order to analyze
     * @param {number} actualSlippage Actual slippage experienced
     * @returns {Promise<Object>} Manipulation analysis
     */
    async _analyzeForManipulation(order, actualSlippage) {
        const analysis = {
            riskLevel: 'low',
            indicators: [],
            confidence: 0
        };

        try {
            // Check if slippage is extremely high
            if (actualSlippage > 1000) { // >10%
                analysis.indicators.push('extreme_slippage');
                analysis.riskLevel = 'high';
                analysis.confidence += 40;
            }

            // Check for unusual price movements around execution
            const priceHistory = this.priceHistory.get(`${order.tokenIn}-${order.tokenOut}`) || [];
            const executionTime = Date.now();
            
            const recentPrices = priceHistory.filter(
                entry => Math.abs(entry.timestamp - executionTime) < 60000 // 1 minute window
            );

            if (recentPrices.length > 2) {
                const priceVariation = this._calculatePriceVariation(recentPrices);
                if (priceVariation > 0.05) { // 5% variation
                    analysis.indicators.push('price_manipulation');
                    analysis.riskLevel = analysis.riskLevel === 'high' ? 'high' : 'medium';
                    analysis.confidence += 30;
                }
            }

            // Check for suspicious timing patterns
            const timingAnalysis = await this._analyzeExecutionTiming(order);
            if (timingAnalysis.suspicious) {
                analysis.indicators.push('suspicious_timing');
                analysis.riskLevel = analysis.riskLevel === 'high' ? 'high' : 'medium';
                analysis.confidence += 20;
            }

        } catch (error) {
            console.error('Manipulation analysis failed:', error);
        }

        return analysis;
    }

    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================

    _validateOrderParams(params) {
        const required = ['tokenIn', 'tokenOut', 'amountIn'];
        for (const field of required) {
            if (!params[field]) {
                throw new Error(`Missing required parameter: ${field}`);
            }
        }

        if (!ethers.utils.isAddress(params.tokenIn)) {
            throw new Error('Invalid tokenIn address');
        }

        if (!ethers.utils.isAddress(params.tokenOut)) {
            throw new Error('Invalid tokenOut address');
        }

        if (ethers.BigNumber.from(params.amountIn).lte(0)) {
            throw new Error('Invalid amountIn');
        }
    }

    _calculatePriceBoundaries(currentPrice, slippageBps, amountIn) {
        const slippageMultiplier = (10000 - slippageBps) / 10000;
        const minAmountOut = ethers.BigNumber.from(Math.floor(
            parseFloat(ethers.utils.formatEther(amountIn)) * currentPrice * slippageMultiplier
        ));

        const maxAmountIn = amountIn.mul(10000 + slippageBps).div(10000);

        return {
            minAmountOut,
            maxAmountIn,
            effectivePrice: currentPrice * slippageMultiplier
        };
    }

    _generateProtectionStrategy(slippageBps, emergencyConditions, orderParams) {
        const strategy = {
            type: 'standard',
            recommendations: [],
            alternatives: []
        };

        if (emergencyConditions.isEmergency) {
            strategy.type = 'emergency';
            strategy.recommendations.push('Consider delaying execution until market stabilizes');
            strategy.alternatives.push('Use flashbot execution for MEV protection');
        } else if (slippageBps > 500) { // >5%
            strategy.type = 'high_protection';
            strategy.recommendations.push('Use commit-reveal scheme');
            strategy.recommendations.push('Consider order splitting');
            strategy.alternatives.push('Wait for better market conditions');
        } else if (slippageBps > 200) { // >2%
            strategy.type = 'enhanced';
            strategy.recommendations.push('Monitor execution closely');
            strategy.alternatives.push('Use MEV-protected execution');
        }

        return strategy;
    }

    _calculateConfidence(priceData) {
        let confidence = priceData.confidence || 50;
        
        // Adjust based on data freshness
        const age = Date.now() - priceData.timestamp;
        if (age < 10000) confidence += 20; // <10 seconds
        else if (age < 30000) confidence += 10; // <30 seconds
        else if (age > 60000) confidence -= 20; // >1 minute

        // Adjust based on price spread
        if (priceData.spread < 0.001) confidence += 15; // <0.1% spread
        else if (priceData.spread > 0.01) confidence -= 15; // >1% spread

        return Math.max(0, Math.min(100, confidence));
    }

    _getEmergencySlippageConfig(orderParams) {
        return {
            recommendedSlippageBps: this.config.emergencySlippageBps,
            minAmountOut: ethers.BigNumber.from(0),
            maxAmountIn: ethers.BigNumber.from(orderParams.amountIn).mul(2),
            priceImpactEstimate: this.config.emergencySlippageBps,
            volatilityFactor: this.config.emergencySlippageBps / 2,
            liquidityFactor: this.config.emergencySlippageBps / 2,
            marketConditions: { emergency: true },
            emergencyConditions: { isEmergency: true, triggers: ['system_error'], severity: 'critical' },
            protectionStrategy: { type: 'emergency', recommendations: ['Use maximum slippage protection'] },
            confidence: 0,
            expirationTime: Date.now() + (60 * 1000), // 1 minute
            monitoring: { shouldMonitor: true, alertThreshold: this.config.emergencySlippageBps * 1.5 }
        };
    }

    _calculateActualSlippage(expectedAmount, actualAmount) {
        if (expectedAmount.eq(0)) return 0;
        
        const difference = expectedAmount.sub(actualAmount);
        return difference.mul(10000).div(expectedAmount).toNumber();
    }

    async _getChainlinkPrice(tokenIn, tokenOut) {
        const pairKey = `${tokenIn}-${tokenOut}`;
        const feedAddress = this.config.chainlinkFeeds[pairKey];
        
        if (!feedAddress) return null;

        try {
            const feed = new ethers.Contract(
                feedAddress,
                ['function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'],
                this.config.provider
            );

            const [, price, , updatedAt] = await feed.latestRoundData();
            
            return {
                price: parseFloat(ethers.utils.formatUnits(price, 8)),
                timestamp: updatedAt.toNumber() * 1000,
                source: 'chainlink'
            };
        } catch (error) {
            return null;
        }
    }

    async _getUniswapV3Price(tokenIn, tokenOut) {
        // Mock implementation - would use actual Uniswap V3 quoter
        return {
            price: 0.0004,
            timestamp: Date.now(),
            source: 'uniswap_v3'
        };
    }

    async _getDEXAggregatorPrice(tokenIn, tokenOut) {
        // Mock implementation - would use 1inch or similar
        return {
            price: 0.00041,
            timestamp: Date.now(),
            source: 'dex_aggregator'
        };
    }

    _calculatePriceSpread(prices) {
        if (prices.length < 2) return 0;
        
        const priceValues = prices.map(p => p.price);
        const min = Math.min(...priceValues);
        const max = Math.max(...priceValues);
        
        return (max - min) / min;
    }

    async _getLiquidityData(tokenIn, tokenOut) {
        // Mock implementation - would fetch from actual DEX contracts
        return {
            totalLiquidity: ethers.utils.parseEther('1000000'), // $1M
            depth: ethers.utils.parseEther('100000'), // $100k depth
            concentration: 0.7 // 70% concentrated
        };
    }

    async _updateVolatility(pairKey) {
        const history = this.priceHistory.get(pairKey) || [];
        if (history.length < 10) return;

        const recentPrices = history.slice(-20); // Last 20 data points
        const returns = [];

        for (let i = 1; i < recentPrices.length; i++) {
            const returnPct = (recentPrices[i].price - recentPrices[i-1].price) / recentPrices[i-1].price;
            returns.push(returnPct);
        }

        // Calculate standard deviation
        const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
        const volatility = Math.sqrt(variance);

        this.volatilityCache.set(pairKey, volatility);
    }

    async _updateAllPrices() {
        // Update prices for monitored pairs
        for (const pair of this.priceCache.keys()) {
            try {
                const [tokenIn, tokenOut] = pair.split('-');
                await this._getCurrentPriceData(tokenIn, tokenOut);
            } catch (error) {
                console.error(`Failed to update price for ${pair}:`, error);
            }
        }
    }

    async _updateMarketConditions() {
        try {
            // Update volatility condition
            const avgVolatility = Array.from(this.volatilityCache.values())
                .reduce((sum, vol) => sum + vol, 0) / Math.max(this.volatilityCache.size, 1);

            if (avgVolatility > 0.1) this.marketConditions.volatility = 'high';
            else if (avgVolatility > 0.05) this.marketConditions.volatility = 'elevated';
            else this.marketConditions.volatility = 'normal';

            // Update other conditions...
            this.marketConditions.trend = 'stable'; // Simplified
            this.marketConditions.liquidity = 'normal'; // Simplified
            this.marketConditions.congestion = 'normal'; // Simplified

        } catch (error) {
            console.error('Market condition update failed:', error);
        }
    }

    _cleanupOldData() {
        const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours

        // Clean price cache
        for (const [key, data] of this.priceCache.entries()) {
            if (data.timestamp < cutoff) {
                this.priceCache.delete(key);
            }
        }

        // Clean price history
        for (const [key, history] of this.priceHistory.entries()) {
            const filtered = history.filter(entry => entry.timestamp > cutoff);
            if (filtered.length === 0) {
                this.priceHistory.delete(key);
            } else {
                this.priceHistory.set(key, filtered);
            }
        }
    }

    _generateExecutionRecommendations(actualSlippage, limit, manipulationAnalysis) {
        const recommendations = [];

        if (actualSlippage > limit) {
            recommendations.push('Increase slippage tolerance for similar orders');
            recommendations.push('Consider using MEV protection');
        }

        if (manipulationAnalysis.riskLevel === 'high') {
            recommendations.push('Report potential manipulation to security team');
            recommendations.push('Use private mempool for future similar orders');
        }

        return recommendations;
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get slippage protection statistics
     * @returns {Object} Statistics
     */
    getSlippageStats() {
        const avgSlippage = this.slippageStats.ordersAnalyzed > 0
            ? this.slippageStats.averageSlippageUsed / this.slippageStats.ordersAnalyzed
            : 0;

        return {
            ...this.slippageStats,
            violationRate: this.slippageStats.ordersAnalyzed > 0
                ? (this.slippageStats.slippageViolations / this.slippageStats.ordersAnalyzed * 100).toFixed(2) + '%'
                : '0%',
            adjustmentRate: this.slippageStats.ordersAnalyzed > 0
                ? (this.slippageStats.dynamicAdjustments / this.slippageStats.ordersAnalyzed * 100).toFixed(2) + '%'
                : '0%',
            averageSlippageUsed: (avgSlippage / 100).toFixed(3) + '%'
        };
    }

    /**
     * Update configuration
     * @param {Object} newConfig New configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current market conditions
     * @returns {Object} Market conditions
     */
    getMarketConditions() {
        return { ...this.marketConditions };
    }
}

module.exports = { DynamicSlippageProtection };