/**
 * @title Anti-Sandwich Protection Service
 * @author DEX Security Team
 * @notice Advanced sandwich attack detection and prevention system
 * @dev Provides real-time monitoring and protection against MEV attacks
 */

const { ethers } = require('ethers');

class AntiSandwichProtection {
    constructor(config) {
        this.config = {
            provider: new ethers.providers.JsonRpcProvider(config.rpcUrl),
            settlementContract: config.settlementContract,
            protectionLevel: config.protectionLevel || 'high', // low, medium, high, maximum
            mempoolMonitoring: config.mempoolMonitoring || true,
            realTimeAnalysis: config.realTimeAnalysis || true,
            autoBundle: config.autoBundle || true,
            ...config
        };

        this.pendingOrders = new Map();
        this.suspiciousTransactions = new Set();
        this.mempoolCache = new Map();
        this.priceImpactTracker = new Map();
        this.sandwichDetectionRules = this._initializeDetectionRules();
        
        // Protection statistics
        this.stats = {
            ordersProtected: 0,
            sandwichesDetected: 0,
            sandwichesPrevented: 0,
            bundlesCreated: 0,
            mevSaved: 0
        };

        if (this.config.mempoolMonitoring) {
            this._startMempoolMonitoring();
        }
    }

    /**
     * Analyze order for sandwich attack risk
     * @param {Object} order Order to analyze
     * @returns {Promise<Object>} Risk analysis result
     */
    async analyzeOrderRisk(order) {
        try {
            const riskAnalysis = {
                riskLevel: 'low',
                threats: [],
                recommendations: [],
                protectionStrategy: null,
                confidence: 0
            };

            // Check order characteristics
            const sizeRisk = this._analyzeSizeRisk(order);
            const pairRisk = this._analyzePairRisk(order);
            const timingRisk = await this._analyzeTimingRisk(order);
            const mempoolRisk = await this._analyzeMempoolRisk(order);
            const priceImpactRisk = await this._analyzePriceImpactRisk(order);

            // Aggregate risk scores
            const totalRisk = (sizeRisk.score + pairRisk.score + timingRisk.score + 
                             mempoolRisk.score + priceImpactRisk.score) / 5;

            riskAnalysis.confidence = Math.min(100, totalRisk * 20); // Scale to 0-100
            
            if (totalRisk > 0.8) {
                riskAnalysis.riskLevel = 'critical';
                riskAnalysis.protectionStrategy = 'force_bundle_execution';
            } else if (totalRisk > 0.6) {
                riskAnalysis.riskLevel = 'high';
                riskAnalysis.protectionStrategy = 'delayed_execution_with_bundle';
            } else if (totalRisk > 0.4) {
                riskAnalysis.riskLevel = 'medium';
                riskAnalysis.protectionStrategy = 'commit_reveal_protection';
            } else if (totalRisk > 0.2) {
                riskAnalysis.riskLevel = 'low';
                riskAnalysis.protectionStrategy = 'basic_monitoring';
            }

            // Collect threats and recommendations
            [sizeRisk, pairRisk, timingRisk, mempoolRisk, priceImpactRisk].forEach(risk => {
                if (risk.threats) riskAnalysis.threats.push(...risk.threats);
                if (risk.recommendations) riskAnalysis.recommendations.push(...risk.recommendations);
            });

            return riskAnalysis;

        } catch (error) {
            console.error('Order risk analysis failed:', error);
            return {
                riskLevel: 'unknown',
                threats: ['Analysis failed'],
                recommendations: ['Manual review required'],
                protectionStrategy: 'manual_review',
                confidence: 0
            };
        }
    }

    /**
     * Create protective bundle for high-risk orders
     * @param {Object[]} orders Orders to protect
     * @returns {Promise<Object>} Bundle creation result
     */
    async createProtectiveBundle(orders) {
        try {
            if (!Array.isArray(orders) || orders.length === 0) {
                throw new Error('Invalid orders array');
            }

            // Sort orders by risk level (highest risk first)
            const sortedOrders = orders.sort((a, b) => {
                const riskA = this._getOrderRiskScore(a);
                const riskB = this._getOrderRiskScore(b);
                return riskB - riskA;
            });

            // Group compatible orders
            const orderGroups = this._groupCompatibleOrders(sortedOrders);
            const bundles = [];

            for (const group of orderGroups) {
                const bundle = await this._createAtomicBundle(group);
                if (bundle) {
                    bundles.push(bundle);
                    this.stats.bundlesCreated++;
                }
            }

            return {
                success: true,
                bundlesCreated: bundles.length,
                bundles,
                ordersProtected: orders.length,
                estimatedMevSaved: this._estimateMevSaved(orders)
            };

        } catch (error) {
            console.error('Protective bundle creation failed:', error);
            return {
                success: false,
                error: error.message,
                bundlesCreated: 0
            };
        }
    }

    /**
     * Monitor mempool for sandwich attack patterns
     * @returns {Promise<void>}
     */
    async _startMempoolMonitoring() {
        console.log('Starting mempool monitoring for sandwich detection...');

        // Subscribe to pending transactions
        this.config.provider.on('pending', async (txHash) => {
            try {
                const tx = await this.config.provider.getTransaction(txHash);
                if (tx && this._isRelevantTransaction(tx)) {
                    await this._analyzePendingTransaction(tx);
                }
            } catch (error) {
                // Transaction might have been mined already, ignore
            }
        });

        // Periodic mempool analysis
        setInterval(async () => {
            await this._performMempoolAnalysis();
        }, 5000); // Every 5 seconds

        // Clean up old mempool data
        setInterval(() => {
            this._cleanupMempoolCache();
        }, 30000); // Every 30 seconds
    }

    /**
     * Analyze pending transaction for sandwich patterns
     * @param {Object} tx Transaction to analyze
     * @returns {Promise<void>}
     */
    async _analyzePendingTransaction(tx) {
        const analysis = {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: tx.value,
            gasPrice: tx.gasPrice,
            data: tx.data,
            timestamp: Date.now()
        };

        // Parse transaction data if it's a DEX interaction
        const parsedTx = this._parseTransaction(tx);
        if (parsedTx) {
            analysis.dexInteraction = parsedTx;
            
            // Check for sandwich attack patterns
            const sandwichRisk = await this._detectSandwichPattern(analysis);
            if (sandwichRisk.isSuspicious) {
                this.suspiciousTransactions.add(tx.hash);
                this._notifySandwichThreat(sandwichRisk);
            }
        }

        // Cache for analysis
        this.mempoolCache.set(tx.hash, analysis);
    }

    /**
     * Detect sandwich attack patterns
     * @param {Object} txAnalysis Transaction analysis
     * @returns {Promise<Object>} Sandwich detection result
     */
    async _detectSandwichPattern(txAnalysis) {
        const result = {
            isSuspicious: false,
            suspicionScore: 0,
            patterns: [],
            evidence: []
        };

        if (!txAnalysis.dexInteraction) {
            return result;
        }

        const { tokenIn, tokenOut, amountIn } = txAnalysis.dexInteraction;
        
        // Look for front-running transactions
        const frontRunningTxs = Array.from(this.mempoolCache.values())
            .filter(tx => {
                if (!tx.dexInteraction) return false;
                const interaction = tx.dexInteraction;
                
                // Same token pair but reverse direction
                return (
                    interaction.tokenIn === tokenOut &&
                    interaction.tokenOut === tokenIn &&
                    tx.timestamp < txAnalysis.timestamp &&
                    Math.abs(tx.timestamp - txAnalysis.timestamp) < 12000 // 12 seconds
                );
            });

        if (frontRunningTxs.length > 0) {
            result.patterns.push('front_running_detected');
            result.suspicionScore += 0.4;
            result.evidence.push(`${frontRunningTxs.length} potential front-running transactions detected`);
        }

        // Check for high gas price (common in MEV attacks)
        const averageGasPrice = await this._getAverageGasPrice();
        const gasPriceMultiplier = txAnalysis.gasPrice.div(averageGasPrice);
        
        if (gasPriceMultiplier.gt(ethers.BigNumber.from(2))) { // 2x average
            result.patterns.push('high_gas_price');
            result.suspicionScore += 0.3;
            result.evidence.push(`Gas price ${gasPriceMultiplier.toString()}x above average`);
        }

        // Check for large trade size relative to liquidity
        const liquidityData = await this._getTokenPairLiquidity(tokenIn, tokenOut);
        if (liquidityData) {
            const tradeImpact = amountIn.mul(10000).div(liquidityData.liquidity);
            if (tradeImpact.gt(ethers.BigNumber.from(200))) { // >2% impact
                result.patterns.push('high_price_impact');
                result.suspicionScore += 0.4;
                result.evidence.push(`High price impact: ${tradeImpact.div(100).toString()}%`);
            }
        }

        // Check sender history for MEV activity
        const senderHistory = await this._analyzeSenderHistory(txAnalysis.from);
        if (senderHistory.isMevBot) {
            result.patterns.push('known_mev_bot');
            result.suspicionScore += 0.5;
            result.evidence.push('Transaction from known MEV bot');
        }

        result.isSuspicious = result.suspicionScore > 0.6;
        
        return result;
    }

    /**
     * Group compatible orders for bundling
     * @param {Object[]} orders Orders to group
     * @returns {Object[][]} Groups of compatible orders
     */
    _groupCompatibleOrders(orders) {
        const groups = [];
        const used = new Set();

        for (let i = 0; i < orders.length; i++) {
            if (used.has(i)) continue;

            const group = [orders[i]];
            used.add(i);

            // Find compatible orders
            for (let j = i + 1; j < orders.length; j++) {
                if (used.has(j)) continue;

                if (this._areOrdersCompatible(orders[i], orders[j])) {
                    group.push(orders[j]);
                    used.add(j);

                    // Limit bundle size
                    if (group.length >= 10) break;
                }
            }

            groups.push(group);
        }

        return groups;
    }

    /**
     * Check if two orders are compatible for bundling
     * @param {Object} order1 First order
     * @param {Object} order2 Second order
     * @returns {boolean} True if compatible
     */
    _areOrdersCompatible(order1, order2) {
        // Check if orders can be executed together without conflicts
        
        // Same token pair but different directions are compatible
        if ((order1.tokenIn === order2.tokenOut && order1.tokenOut === order2.tokenIn) ||
            (order1.tokenIn === order2.tokenIn && order1.tokenOut === order2.tokenOut)) {
            
            // Check timing compatibility
            const timeDiff = Math.abs(order1.deadline - order2.deadline);
            if (timeDiff > 300) return false; // 5 minutes max difference
            
            // Check size compatibility (avoid massive price impact)
            const totalImpact = this._estimateCombinedPriceImpact(order1, order2);
            if (totalImpact > 0.05) return false; // 5% max combined impact
            
            return true;
        }

        // Different token pairs can be bundled if they don't interfere
        if (order1.tokenIn !== order2.tokenIn && order1.tokenOut !== order2.tokenOut &&
            order1.tokenIn !== order2.tokenOut && order1.tokenOut !== order2.tokenIn) {
            return true;
        }

        return false;
    }

    /**
     * Create atomic bundle from order group
     * @param {Object[]} orderGroup Group of orders
     * @returns {Promise<Object>} Bundle object
     */
    async _createAtomicBundle(orderGroup) {
        try {
            // Calculate optimal execution order
            const executionOrder = this._optimizeExecutionOrder(orderGroup);
            
            // Estimate gas requirements
            const gasEstimate = this._estimateBundleGas(executionOrder);
            
            // Set appropriate gas price for protection
            const gasPrice = await this._calculateProtectiveGasPrice();

            const bundle = {
                id: this._generateBundleId(),
                orders: executionOrder,
                gasEstimate,
                gasPrice,
                maxSlippage: this._calculateBundleMaxSlippage(orderGroup),
                protectionLevel: this._calculateBundleProtectionLevel(orderGroup),
                estimatedMevSaved: this._estimateBundleMevSaved(orderGroup),
                createdAt: Date.now()
            };

            return bundle;

        } catch (error) {
            console.error('Bundle creation failed:', error);
            return null;
        }
    }

    /**
     * Optimize execution order within bundle
     * @param {Object[]} orders Orders to optimize
     * @returns {Object[]} Optimized order sequence
     */
    _optimizeExecutionOrder(orders) {
        // Sort by dependency and price impact
        return orders.sort((a, b) => {
            // Orders that provide liquidity first
            const aProvides = this._providesLiquidity(a);
            const bProvides = this._providesLiquidity(b);
            
            if (aProvides && !bProvides) return -1;
            if (!aProvides && bProvides) return 1;
            
            // Then by price impact (lower impact first)
            const aImpact = this._estimateOrderPriceImpact(a);
            const bImpact = this._estimateOrderPriceImpact(b);
            
            return aImpact - bImpact;
        });
    }

    /**
     * Initialize sandwich detection rules
     * @returns {Object} Detection rules configuration
     */
    _initializeDetectionRules() {
        return {
            gasPrice: {
                suspiciousMultiplier: 2.0,
                highRiskMultiplier: 5.0
            },
            priceImpact: {
                lowRisk: 0.005,    // 0.5%
                mediumRisk: 0.02,  // 2%
                highRisk: 0.05     // 5%
            },
            timing: {
                frontRunWindow: 12000,  // 12 seconds
                backRunWindow: 30000,   // 30 seconds
                blockWindow: 3          // 3 blocks
            },
            size: {
                smallOrder: ethers.utils.parseEther('1'),
                mediumOrder: ethers.utils.parseEther('10'),
                largeOrder: ethers.utils.parseEther('100')
            }
        };
    }

    /**
     * Analyze order size risk
     * @param {Object} order Order to analyze
     * @returns {Object} Size risk analysis
     */
    _analyzeSizeRisk(order) {
        const rules = this.sandwichDetectionRules.size;
        const amount = ethers.BigNumber.from(order.amountIn);
        
        let score = 0;
        const threats = [];
        const recommendations = [];

        if (amount.gte(rules.largeOrder)) {
            score = 0.8;
            threats.push('Large order size increases sandwich attack risk');
            recommendations.push('Consider splitting into smaller orders or using commit-reveal');
        } else if (amount.gte(rules.mediumOrder)) {
            score = 0.5;
            threats.push('Medium order size may attract MEV attention');
            recommendations.push('Monitor for front-running activity');
        } else if (amount.gte(rules.smallOrder)) {
            score = 0.2;
        }

        return { score, threats, recommendations };
    }

    /**
     * Analyze token pair risk
     * @param {Object} order Order to analyze
     * @returns {Object} Pair risk analysis
     */
    _analyzePairRisk(order) {
        const { tokenIn, tokenOut } = order;
        let score = 0;
        const threats = [];
        const recommendations = [];

        // High-volume pairs are more attractive to MEV bots
        const pairVolume = this._getTokenPairVolume(tokenIn, tokenOut);
        if (pairVolume > 1000000) { // $1M+ daily volume
            score += 0.3;
            threats.push('High-volume trading pair attracts MEV attention');
        }

        // Volatile pairs have higher sandwich potential
        const volatility = this._getTokenPairVolatility(tokenIn, tokenOut);
        if (volatility > 0.05) { // 5% volatility
            score += 0.4;
            threats.push('High volatility increases sandwich profitability');
            recommendations.push('Use tighter slippage limits');
        }

        return { score, threats, recommendations };
    }

    /**
     * Analyze timing risk
     * @param {Object} order Order to analyze
     * @returns {Promise<Object>} Timing risk analysis
     */
    async _analyzeTimingRisk(order) {
        let score = 0;
        const threats = [];
        const recommendations = [];

        // Check current network congestion
        const pendingTxCount = await this._getPendingTransactionCount();
        if (pendingTxCount > 1000) {
            score += 0.3;
            threats.push('High network congestion increases MEV risk');
            recommendations.push('Use higher gas price or wait for lower congestion');
        }

        // Check recent MEV activity
        const recentMevActivity = await this._getRecentMevActivity();
        if (recentMevActivity > 0.1) { // 10% of recent blocks had MEV
            score += 0.4;
            threats.push('High recent MEV activity detected');
            recommendations.push('Consider using flashbot protection');
        }

        return { score, threats, recommendations };
    }

    /**
     * Analyze mempool risk
     * @param {Object} order Order to analyze
     * @returns {Promise<Object>} Mempool risk analysis
     */
    async _analyzeMempoolRisk(order) {
        let score = 0;
        const threats = [];
        const recommendations = [];

        const { tokenIn, tokenOut } = order;

        // Check for pending transactions on same pair
        const similarTxs = Array.from(this.mempoolCache.values())
            .filter(tx => {
                if (!tx.dexInteraction) return false;
                const interaction = tx.dexInteraction;
                return (interaction.tokenIn === tokenIn && interaction.tokenOut === tokenOut) ||
                       (interaction.tokenIn === tokenOut && interaction.tokenOut === tokenIn);
            });

        if (similarTxs.length > 5) {
            score += 0.5;
            threats.push(`${similarTxs.length} similar transactions in mempool`);
            recommendations.push('Wait for mempool to clear or use private execution');
        }

        // Check for suspicious high-gas transactions
        const highGasTxs = similarTxs.filter(tx => {
            const avgGasPrice = ethers.utils.parseUnits('20', 'gwei');
            return tx.gasPrice.gt(avgGasPrice.mul(3));
        });

        if (highGasTxs.length > 0) {
            score += 0.6;
            threats.push('High-gas transactions detected in mempool (potential MEV bots)');
            recommendations.push('Use protective bundling or private mempool');
        }

        return { score, threats, recommendations };
    }

    /**
     * Analyze price impact risk
     * @param {Object} order Order to analyze
     * @returns {Promise<Object>} Price impact risk analysis
     */
    async _analyzePriceImpactRisk(order) {
        const rules = this.sandwichDetectionRules.priceImpact;
        let score = 0;
        const threats = [];
        const recommendations = [];

        const estimatedImpact = await this._estimateOrderPriceImpact(order);

        if (estimatedImpact > rules.highRisk) {
            score = 0.9;
            threats.push(`Very high price impact (${(estimatedImpact * 100).toFixed(2)}%)`);
            recommendations.push('Split order or use alternative execution strategy');
        } else if (estimatedImpact > rules.mediumRisk) {
            score = 0.6;
            threats.push(`High price impact (${(estimatedImpact * 100).toFixed(2)}%)`);
            recommendations.push('Consider protective bundling');
        } else if (estimatedImpact > rules.lowRisk) {
            score = 0.3;
            threats.push(`Moderate price impact (${(estimatedImpact * 100).toFixed(2)}%)`);
            recommendations.push('Monitor execution carefully');
        }

        return { score, threats, recommendations };
    }

    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================

    _isRelevantTransaction(tx) {
        // Check if transaction is relevant for sandwich detection
        if (!tx.to) return false;
        
        // Common DEX router addresses
        const dexRouters = [
            '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2
            '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3
            '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', // Sushiswap
            '0xba12222222228d8ba445958a75a0704d566bf2c8'  // Balancer
        ];

        return dexRouters.includes(tx.to.toLowerCase());
    }

    _parseTransaction(tx) {
        // Parse DEX transaction data
        try {
            // This is a simplified parser - production would need full ABI parsing
            const data = tx.data;
            
            if (data.startsWith('0x38ed1739')) { // swapExactTokensForTokens
                return {
                    type: 'swap',
                    tokenIn: '0x' + data.slice(34, 74),
                    tokenOut: '0x' + data.slice(98, 138),
                    amountIn: ethers.BigNumber.from('0x' + data.slice(10, 74))
                };
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    async _getAverageGasPrice() {
        try {
            const gasPrice = await this.config.provider.getGasPrice();
            return gasPrice;
        } catch (error) {
            return ethers.utils.parseUnits('20', 'gwei');
        }
    }

    async _getTokenPairLiquidity(tokenIn, tokenOut) {
        // Mock implementation - would query actual DEX contracts
        return {
            liquidity: ethers.utils.parseEther('1000000') // $1M liquidity
        };
    }

    async _analyzeSenderHistory(address) {
        // Mock implementation - would analyze on-chain history
        const knownMevBots = [
            '0x0000000000000000000000000000000000000000' // placeholder
        ];
        
        return {
            isMevBot: knownMevBots.includes(address.toLowerCase()),
            mevScore: 0.5
        };
    }

    _performMempoolAnalysis() {
        // Periodic analysis of mempool state
        const now = Date.now();
        const recentTxs = Array.from(this.mempoolCache.values())
            .filter(tx => now - tx.timestamp < 60000); // Last minute

        console.log(`Mempool analysis: ${recentTxs.length} recent transactions`);
    }

    _cleanupMempoolCache() {
        const now = Date.now();
        const cutoff = now - 300000; // 5 minutes

        for (const [hash, tx] of this.mempoolCache.entries()) {
            if (tx.timestamp < cutoff) {
                this.mempoolCache.delete(hash);
            }
        }
    }

    _notifySandwichThreat(threat) {
        console.warn('Sandwich attack threat detected:', threat);
        this.stats.sandwichesDetected++;
        // In production, would send alerts to monitoring system
    }

    _getOrderRiskScore(order) {
        // Calculate overall risk score for order
        const sizeRisk = this._analyzeSizeRisk(order).score;
        const pairRisk = this._analyzePairRisk(order).score;
        return (sizeRisk + pairRisk) / 2;
    }

    _estimateMevSaved(orders) {
        // Estimate MEV that would be saved by protection
        let totalSaved = 0;
        for (const order of orders) {
            const orderValue = order.amountIn * 0.4; // Assume 0.4 ETH per token
            totalSaved += orderValue * 0.001; // 0.1% MEV extraction rate
        }
        return totalSaved;
    }

    _estimateCombinedPriceImpact(order1, order2) {
        // Simplified combined price impact calculation
        const impact1 = this._estimateOrderPriceImpact(order1);
        const impact2 = this._estimateOrderPriceImpact(order2);
        
        // Non-linear combination (impacts amplify each other)
        return impact1 + impact2 + (impact1 * impact2);
    }

    _estimateOrderPriceImpact(order) {
        // Simplified price impact estimation
        const orderSize = parseFloat(ethers.utils.formatEther(order.amountIn));
        return Math.min(0.1, orderSize / 10000); // Max 10% impact
    }

    _providesLiquidity(order) {
        // Check if order provides liquidity (e.g., limit order)
        return order.type === 'limit' || order.type === 'add_liquidity';
    }

    _estimateBundleGas(orders) {
        // Estimate total gas for bundle execution
        return orders.length * 150000 + 50000; // 150k per order + 50k overhead
    }

    async _calculateProtectiveGasPrice() {
        const baseGasPrice = await this.config.provider.getGasPrice();
        return baseGasPrice.mul(110).div(100); // 10% above current
    }

    _calculateBundleMaxSlippage(orders) {
        // Calculate appropriate max slippage for bundle
        const maxSlippages = orders.map(order => order.maxSlippageBps || 500);
        return Math.max(...maxSlippages);
    }

    _calculateBundleProtectionLevel(orders) {
        const avgRisk = orders.reduce((sum, order) => sum + this._getOrderRiskScore(order), 0) / orders.length;
        
        if (avgRisk > 0.8) return 'maximum';
        if (avgRisk > 0.6) return 'high';
        if (avgRisk > 0.4) return 'medium';
        return 'low';
    }

    _estimateBundleMevSaved(orders) {
        return this._estimateMevSaved(orders);
    }

    _generateBundleId() {
        return `bundle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    _getTokenPairVolume(tokenIn, tokenOut) {
        // Mock implementation
        return 500000; // $500k daily volume
    }

    _getTokenPairVolatility(tokenIn, tokenOut) {
        // Mock implementation
        return 0.03; // 3% volatility
    }

    async _getPendingTransactionCount() {
        try {
            const blockWithTxs = await this.config.provider.getBlockWithTransactions('pending');
            return blockWithTxs ? blockWithTxs.transactions.length : 0;
        } catch (error) {
            return 500; // Fallback estimate
        }
    }

    async _getRecentMevActivity() {
        // Mock implementation - would analyze recent blocks for MEV activity
        return 0.05; // 5% of blocks had MEV
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get protection statistics
     * @returns {Object} Protection statistics
     */
    getProtectionStats() {
        return {
            ...this.stats,
            protectionRate: this.stats.ordersProtected > 0 
                ? (this.stats.sandwichesPrevented / this.stats.ordersProtected * 100).toFixed(2) + '%'
                : '0%',
            detectionAccuracy: this.stats.sandwichesDetected > 0
                ? (this.stats.sandwichesPrevented / this.stats.sandwichesDetected * 100).toFixed(2) + '%'
                : '0%',
            averageMevSaved: this.stats.ordersProtected > 0
                ? (this.stats.mevSaved / this.stats.ordersProtected).toFixed(6) + ' ETH'
                : '0 ETH'
        };
    }

    /**
     * Update protection configuration
     * @param {Object} newConfig New configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        if (newConfig.protectionLevel) {
            this.sandwichDetectionRules = this._initializeDetectionRules();
        }
    }

    /**
     * Get current mempool threat level
     * @returns {string} Threat level: low, medium, high, critical
     */
    getCurrentThreatLevel() {
        const suspiciousCount = this.suspiciousTransactions.size;
        const mempoolSize = this.mempoolCache.size;
        
        if (mempoolSize === 0) return 'low';
        
        const suspiciousRatio = suspiciousCount / mempoolSize;
        
        if (suspiciousRatio > 0.3) return 'critical';
        if (suspiciousRatio > 0.2) return 'high';
        if (suspiciousRatio > 0.1) return 'medium';
        return 'low';
    }
}

module.exports = { AntiSandwichProtection };