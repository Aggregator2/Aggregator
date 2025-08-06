const EventEmitter = require('events');
const Redis = require('ioredis');
const { StatsD } = require('node-statsd');

/**
 * Real-time Transaction Monitoring System with AML Rule Engine
 */
class TransactionMonitor extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            redis: config.redis || { host: 'localhost', port: 6379 },
            thresholds: {
                largeTransaction: config.largeTransactionThreshold || 10000, // $10k USD
                dailyLimit: config.dailyLimit || 50000,
                monthlyLimit: config.monthlyLimit || 200000,
                velocityCheckWindow: config.velocityCheckWindow || 3600000 // 1 hour
            },
            chainalysis: {
                apiKey: config.chainalysis?.apiKey,
                baseUrl: config.chainalysis?.baseUrl || 'https://api.chainalysis.com'
            },
            elliptic: {
                apiKey: config.elliptic?.apiKey,
                baseUrl: config.elliptic?.baseUrl || 'https://api.elliptic.co'
            },
            ...config
        };
        
        this.redis = new Redis(this.config.redis);
        this.statsd = new StatsD({
            host: config.statsdHost || 'localhost',
            port: config.statsdPort || 8125,
            prefix: 'compliance.transaction.'
        });
        
        // AML Rules
        this.rules = new Map();
        this.initializeDefaultRules();
        
        // Pattern detectors
        this.patternDetectors = {
            washTrading: new WashTradingDetector(),
            layering: new LayeringDetector(),
            structuring: new StructuringDetector(),
            rapidMovement: new RapidMovementDetector()
        };
        
        // Risk scores cache
        this.riskScores = new Map();
        
        // Suspicious activity tracking
        this.suspiciousActivities = new Map();
    }
    
    /**
     * Initialize default AML rules
     */
    initializeDefaultRules() {
        // Large transaction rule
        this.addRule({
            id: 'large_transaction',
            name: 'Large Transaction Detection',
            condition: (tx) => tx.amountUSD >= this.config.thresholds.largeTransaction,
            action: 'flag_and_report',
            severity: 'high'
        });
        
        // High frequency trading rule
        this.addRule({
            id: 'high_frequency',
            name: 'High Frequency Trading',
            condition: async (tx, context) => {
                const count = await this.getTransactionCount(tx.userId, 3600000); // 1 hour
                return count > 50;
            },
            action: 'monitor',
            severity: 'medium'
        });
        
        // Cross-border transaction rule
        this.addRule({
            id: 'cross_border',
            name: 'Cross-Border Transaction',
            condition: (tx) => tx.originCountry !== tx.destinationCountry,
            action: 'enhanced_monitoring',
            severity: 'medium'
        });
        
        // Sanctioned entity rule
        this.addRule({
            id: 'sanctioned_entity',
            name: 'Sanctioned Entity Detection',
            condition: async (tx) => {
                return await this.checkSanctionedAddress(tx.toAddress) ||
                       await this.checkSanctionedAddress(tx.fromAddress);
            },
            action: 'block_and_report',
            severity: 'critical'
        });
        
        // Unusual pattern rule
        this.addRule({
            id: 'unusual_pattern',
            name: 'Unusual Transaction Pattern',
            condition: async (tx, context) => {
                const pattern = await this.detectUnusualPattern(tx, context);
                return pattern.suspicious;
            },
            action: 'flag_for_review',
            severity: 'high'
        });
    }
    
    /**
     * Monitor transaction in real-time
     */
    async monitorTransaction(transaction) {
        try {
            // Enrich transaction data
            const enrichedTx = await this.enrichTransaction(transaction);
            
            // Check blockchain analytics
            const riskScore = await this.assessBlockchainRisk(enrichedTx);
            enrichedTx.riskScore = riskScore;
            
            // Run AML rules
            const violations = await this.runAMLRules(enrichedTx);
            
            // Detect patterns
            const patterns = await this.detectPatterns(enrichedTx);
            
            // Calculate overall risk
            const overallRisk = this.calculateOverallRisk(enrichedTx, violations, patterns);
            
            // Store transaction data
            await this.storeTransactionData(enrichedTx, overallRisk);
            
            // Take actions based on risk
            await this.handleRiskActions(enrichedTx, overallRisk, violations);
            
            // Update metrics
            this.updateMetrics(enrichedTx, overallRisk);
            
            return {
                transactionId: enrichedTx.id,
                status: overallRisk.action,
                riskLevel: overallRisk.level,
                violations: violations.map(v => ({
                    rule: v.rule.name,
                    severity: v.rule.severity
                })),
                patterns: patterns.map(p => ({
                    type: p.type,
                    confidence: p.confidence
                }))
            };
            
        } catch (error) {
            console.error('Transaction monitoring error:', error);
            this.emit('error', { transaction, error });
            throw error;
        }
    }
    
    /**
     * Enrich transaction with additional data
     */
    async enrichTransaction(transaction) {
        const enriched = { ...transaction };
        
        // Add USD equivalent
        if (!enriched.amountUSD) {
            enriched.amountUSD = await this.convertToUSD(
                enriched.amount,
                enriched.currency
            );
        }
        
        // Add user context
        enriched.userContext = await this.getUserContext(enriched.userId);
        
        // Add address labels
        enriched.fromAddressInfo = await this.getAddressInfo(enriched.fromAddress);
        enriched.toAddressInfo = await this.getAddressInfo(enriched.toAddress);
        
        // Add timestamp
        enriched.timestamp = enriched.timestamp || Date.now();
        
        return enriched;
    }
    
    /**
     * Assess blockchain risk using Chainalysis/Elliptic
     */
    async assessBlockchainRisk(transaction) {
        const scores = {};
        
        // Chainalysis risk assessment
        if (this.config.chainalysis.apiKey) {
            try {
                const chainalysisScore = await this.getChainanalysisScore(transaction);
                scores.chainalysis = chainalysisScore;
            } catch (error) {
                console.error('Chainalysis error:', error);
            }
        }
        
        // Elliptic risk assessment
        if (this.config.elliptic.apiKey) {
            try {
                const ellipticScore = await this.getEllipticScore(transaction);
                scores.elliptic = ellipticScore;
            } catch (error) {
                console.error('Elliptic error:', error);
            }
        }
        
        // Internal risk assessment
        scores.internal = await this.calculateInternalRiskScore(transaction);
        
        // Combine scores
        const combinedScore = this.combineRiskScores(scores);
        
        return {
            score: combinedScore,
            sources: scores,
            level: this.getRiskLevel(combinedScore)
        };
    }
    
    /**
     * Run AML rules against transaction
     */
    async runAMLRules(transaction) {
        const violations = [];
        
        for (const [ruleId, rule] of this.rules) {
            try {
                const context = await this.buildRuleContext(transaction);
                const violated = await rule.condition(transaction, context);
                
                if (violated) {
                    violations.push({
                        rule,
                        transaction,
                        timestamp: Date.now(),
                        context
                    });
                }
            } catch (error) {
                console.error(`Rule ${ruleId} error:`, error);
            }
        }
        
        return violations;
    }
    
    /**
     * Detect suspicious patterns
     */
    async detectPatterns(transaction) {
        const detectedPatterns = [];
        
        for (const [name, detector] of Object.entries(this.patternDetectors)) {
            try {
                const result = await detector.detect(transaction, this);
                if (result.detected) {
                    detectedPatterns.push({
                        type: name,
                        confidence: result.confidence,
                        details: result.details,
                        transactions: result.relatedTransactions
                    });
                }
            } catch (error) {
                console.error(`Pattern detector ${name} error:`, error);
            }
        }
        
        return detectedPatterns;
    }
    
    /**
     * Calculate overall risk
     */
    calculateOverallRisk(transaction, violations, patterns) {
        let riskScore = transaction.riskScore.score;
        let factors = [];
        
        // Add violation scores
        for (const violation of violations) {
            switch (violation.rule.severity) {
                case 'critical':
                    riskScore += 100;
                    break;
                case 'high':
                    riskScore += 50;
                    break;
                case 'medium':
                    riskScore += 25;
                    break;
                case 'low':
                    riskScore += 10;
                    break;
            }
            factors.push({
                type: 'rule_violation',
                rule: violation.rule.id,
                severity: violation.rule.severity
            });
        }
        
        // Add pattern scores
        for (const pattern of patterns) {
            riskScore += pattern.confidence * 30;
            factors.push({
                type: 'pattern_detected',
                pattern: pattern.type,
                confidence: pattern.confidence
            });
        }
        
        // Determine action
        let action = 'approve';
        let requiresReporting = false;
        
        if (riskScore >= 200) {
            action = 'block';
            requiresReporting = true;
        } else if (riskScore >= 100) {
            action = 'manual_review';
            requiresReporting = riskScore >= 150;
        } else if (riskScore >= 50) {
            action = 'enhanced_monitoring';
        }
        
        return {
            score: riskScore,
            level: this.getRiskLevel(riskScore),
            action,
            requiresReporting,
            factors
        };
    }
    
    /**
     * Handle risk-based actions
     */
    async handleRiskActions(transaction, risk, violations) {
        switch (risk.action) {
            case 'block':
                await this.blockTransaction(transaction);
                this.emit('transactionBlocked', { transaction, risk });
                break;
                
            case 'manual_review':
                await this.flagForReview(transaction, risk);
                this.emit('transactionFlagged', { transaction, risk });
                break;
                
            case 'enhanced_monitoring':
                await this.addToEnhancedMonitoring(transaction.userId);
                break;
        }
        
        // Generate reports if needed
        if (risk.requiresReporting) {
            if (transaction.amountUSD >= this.config.thresholds.largeTransaction) {
                await this.generateCTR(transaction); // Currency Transaction Report
            }
            
            if (risk.level === 'critical' || violations.some(v => v.rule.severity === 'critical')) {
                await this.generateSAR(transaction, risk, violations); // Suspicious Activity Report
            }
        }
    }
    
    /**
     * Add rule to AML engine
     */
    addRule(rule) {
        this.rules.set(rule.id, rule);
    }
    
    /**
     * Get transaction count for user
     */
    async getTransactionCount(userId, window) {
        const key = `tx_count:${userId}`;
        const cutoff = Date.now() - window;
        
        const count = await this.redis.zcount(key, cutoff, '+inf');
        return count;
    }
    
    /**
     * Check if address is sanctioned
     */
    async checkSanctionedAddress(address) {
        // Check local cache first
        const cached = await this.redis.get(`sanctioned:${address}`);
        if (cached !== null) {
            return cached === 'true';
        }
        
        // Check with external services
        // This would integrate with OFAC, EU sanctions lists, etc.
        const sanctioned = false; // Mock implementation
        
        // Cache result
        await this.redis.setex(`sanctioned:${address}`, 86400, sanctioned ? 'true' : 'false');
        
        return sanctioned;
    }
    
    /**
     * Detect unusual pattern
     */
    async detectUnusualPattern(transaction, context) {
        const userHistory = await this.getUserTransactionHistory(transaction.userId, 30);
        
        // Check for sudden changes in behavior
        const avgAmount = userHistory.reduce((sum, tx) => sum + tx.amountUSD, 0) / userHistory.length;
        const isUnusualAmount = transaction.amountUSD > avgAmount * 10;
        
        // Check for unusual destinations
        const destinations = new Set(userHistory.map(tx => tx.toAddress));
        const isNewDestination = !destinations.has(transaction.toAddress);
        
        // Check for time patterns
        const hour = new Date(transaction.timestamp).getHours();
        const unusualTime = hour >= 2 && hour <= 5; // 2 AM - 5 AM
        
        return {
            suspicious: isUnusualAmount || (isNewDestination && unusualTime),
            factors: {
                unusualAmount: isUnusualAmount,
                newDestination: isNewDestination,
                unusualTime: unusualTime
            }
        };
    }
    
    /**
     * Build rule context
     */
    async buildRuleContext(transaction) {
        return {
            userHistory: await this.getUserTransactionHistory(transaction.userId, 30),
            dailyVolume: await this.getUserDailyVolume(transaction.userId),
            monthlyVolume: await this.getUserMonthlyVolume(transaction.userId),
            relatedTransactions: await this.getRelatedTransactions(transaction)
        };
    }
    
    /**
     * Store transaction data
     */
    async storeTransactionData(transaction, risk) {
        const key = `tx:${transaction.id}`;
        const data = {
            ...transaction,
            risk,
            monitoredAt: Date.now()
        };
        
        await this.redis.setex(key, 2592000, JSON.stringify(data)); // 30 days
        
        // Add to user history
        await this.redis.zadd(
            `tx_history:${transaction.userId}`,
            transaction.timestamp,
            transaction.id
        );
        
        // Add to daily volume
        await this.redis.hincrby(
            `daily_volume:${transaction.userId}:${this.getDateKey()}`,
            'total',
            Math.floor(transaction.amountUSD)
        );
    }
    
    /**
     * Generate Currency Transaction Report (CTR)
     */
    async generateCTR(transaction) {
        const report = {
            type: 'CTR',
            transactionId: transaction.id,
            amount: transaction.amountUSD,
            currency: transaction.currency,
            date: new Date(transaction.timestamp),
            userId: transaction.userId,
            userInfo: transaction.userContext,
            generatedAt: Date.now()
        };
        
        await this.redis.lpush('reports:ctr', JSON.stringify(report));
        this.emit('ctrGenerated', report);
        
        return report;
    }
    
    /**
     * Generate Suspicious Activity Report (SAR)
     */
    async generateSAR(transaction, risk, violations) {
        const report = {
            type: 'SAR',
            transactionId: transaction.id,
            suspiciousActivity: {
                description: this.describeSuspiciousActivity(violations, risk),
                violations: violations.map(v => ({
                    rule: v.rule.name,
                    severity: v.rule.severity
                })),
                riskScore: risk.score,
                riskFactors: risk.factors
            },
            transaction: {
                amount: transaction.amountUSD,
                currency: transaction.currency,
                from: transaction.fromAddress,
                to: transaction.toAddress,
                timestamp: transaction.timestamp
            },
            userInfo: transaction.userContext,
            generatedAt: Date.now(),
            status: 'pending_review'
        };
        
        await this.redis.lpush('reports:sar', JSON.stringify(report));
        this.emit('sarGenerated', report);
        
        return report;
    }
    
    /**
     * Get risk level from score
     */
    getRiskLevel(score) {
        if (score >= 200) return 'critical';
        if (score >= 100) return 'high';
        if (score >= 50) return 'medium';
        if (score >= 25) return 'low';
        return 'minimal';
    }
    
    /**
     * Update metrics
     */
    updateMetrics(transaction, risk) {
        this.statsd.increment('transactions.monitored');
        this.statsd.increment(`transactions.risk.${risk.level}`);
        this.statsd.gauge('transactions.risk_score', risk.score);
        
        if (risk.action !== 'approve') {
            this.statsd.increment(`transactions.action.${risk.action}`);
        }
    }
    
    // Mock implementations for external services
    async getChainanalysisScore(transaction) {
        // In production, call Chainalysis API
        return {
            score: Math.random() * 100,
            categories: ['exchange', 'mixing'],
            cluster: 'binance'
        };
    }
    
    async getEllipticScore(transaction) {
        // In production, call Elliptic API
        return {
            risk: Math.random() * 100,
            type: 'exchange',
            flags: []
        };
    }
    
    async calculateInternalRiskScore(transaction) {
        let score = 0;
        
        // Amount-based scoring
        if (transaction.amountUSD > 50000) score += 30;
        else if (transaction.amountUSD > 10000) score += 20;
        else if (transaction.amountUSD > 5000) score += 10;
        
        // New user penalty
        if (transaction.userContext.accountAge < 30) score += 20;
        
        // High-risk country
        if (this.isHighRiskCountry(transaction.userContext.country)) score += 30;
        
        return score;
    }
    
    combineRiskScores(scores) {
        const weights = {
            chainalysis: 0.4,
            elliptic: 0.3,
            internal: 0.3
        };
        
        let combinedScore = 0;
        let totalWeight = 0;
        
        for (const [source, data] of Object.entries(scores)) {
            if (data && weights[source]) {
                const score = data.score || data.risk || data;
                combinedScore += score * weights[source];
                totalWeight += weights[source];
            }
        }
        
        return totalWeight > 0 ? combinedScore / totalWeight : 0;
    }
    
    async convertToUSD(amount, currency) {
        // In production, use real exchange rates
        const rates = {
            'ETH': 2000,
            'BTC': 40000,
            'USDT': 1,
            'USDC': 1
        };
        
        return amount * (rates[currency] || 1);
    }
    
    async getUserContext(userId) {
        // Fetch user context from database
        return {
            userId,
            accountAge: 90, // days
            kycStatus: 'verified',
            country: 'US',
            riskProfile: 'low'
        };
    }
    
    async getAddressInfo(address) {
        // Fetch address information
        return {
            address,
            label: 'unknown',
            type: 'wallet',
            risk: 'low'
        };
    }
    
    isHighRiskCountry(country) {
        const highRiskCountries = ['IR', 'KP', 'SY', 'CU', 'VE'];
        return highRiskCountries.includes(country);
    }
    
    async getUserTransactionHistory(userId, days) {
        // Fetch user transaction history
        return [];
    }
    
    async getUserDailyVolume(userId) {
        const key = `daily_volume:${userId}:${this.getDateKey()}`;
        const volume = await this.redis.hget(key, 'total');
        return parseInt(volume) || 0;
    }
    
    async getUserMonthlyVolume(userId) {
        // Calculate monthly volume
        return 0;
    }
    
    async getRelatedTransactions(transaction) {
        // Find related transactions
        return [];
    }
    
    getDateKey() {
        const date = new Date();
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }
    
    async blockTransaction(transaction) {
        // Block transaction implementation
        await this.redis.sadd('blocked_transactions', transaction.id);
    }
    
    async flagForReview(transaction, risk) {
        // Flag for manual review
        await this.redis.lpush('review_queue', JSON.stringify({
            transaction,
            risk,
            flaggedAt: Date.now()
        }));
    }
    
    async addToEnhancedMonitoring(userId) {
        // Add user to enhanced monitoring list
        await this.redis.sadd('enhanced_monitoring', userId);
    }
    
    describeSuspiciousActivity(violations, risk) {
        const descriptions = violations.map(v => v.rule.name).join(', ');
        return `Suspicious activity detected: ${descriptions}. Risk score: ${risk.score}`;
    }
}

/**
 * Wash Trading Detector
 */
class WashTradingDetector {
    async detect(transaction, monitor) {
        // Look for circular trades
        const recentTrades = await monitor.getUserTransactionHistory(transaction.userId, 1);
        
        // Check for A->B->A pattern
        const circular = recentTrades.filter(tx => 
            tx.toAddress === transaction.fromAddress &&
            tx.fromAddress === transaction.toAddress
        );
        
        if (circular.length > 0) {
            return {
                detected: true,
                confidence: 0.9,
                details: 'Circular trading pattern detected',
                relatedTransactions: circular.map(tx => tx.id)
            };
        }
        
        // Check for self-trading through intermediate addresses
        const connectedAddresses = await this.findConnectedAddresses(
            transaction.fromAddress,
            transaction.toAddress,
            recentTrades
        );
        
        if (connectedAddresses.length > 0) {
            return {
                detected: true,
                confidence: 0.7,
                details: 'Possible wash trading through connected addresses',
                relatedTransactions: connectedAddresses
            };
        }
        
        return { detected: false };
    }
    
    async findConnectedAddresses(from, to, trades) {
        // Simplified connection detection
        const connections = [];
        
        for (const trade of trades) {
            if (trade.fromAddress === from && trades.some(t => 
                t.fromAddress === trade.toAddress && t.toAddress === to
            )) {
                connections.push(trade.id);
            }
        }
        
        return connections;
    }
}

/**
 * Layering Detector
 */
class LayeringDetector {
    async detect(transaction, monitor) {
        const recentTrades = await monitor.getUserTransactionHistory(transaction.userId, 0.5); // 12 hours
        
        // Look for multiple small transactions
        const smallTrades = recentTrades.filter(tx => 
            tx.amountUSD < 1000 && tx.amountUSD > 100
        );
        
        if (smallTrades.length > 10) {
            // Check if they're going to different addresses
            const uniqueAddresses = new Set(smallTrades.map(tx => tx.toAddress));
            
            if (uniqueAddresses.size > 5) {
                return {
                    detected: true,
                    confidence: 0.8,
                    details: 'Multiple small transactions to various addresses',
                    relatedTransactions: smallTrades.map(tx => tx.id)
                };
            }
        }
        
        return { detected: false };
    }
}

/**
 * Structuring Detector (Smurfing)
 */
class StructuringDetector {
    async detect(transaction, monitor) {
        const dailyVolume = await monitor.getUserDailyVolume(transaction.userId);
        
        // Check if just under reporting threshold
        const threshold = monitor.config.thresholds.largeTransaction;
        const buffer = threshold * 0.1; // 10% buffer
        
        if (transaction.amountUSD > threshold - buffer && 
            transaction.amountUSD < threshold) {
            
            // Check for similar amounts
            const recentTrades = await monitor.getUserTransactionHistory(transaction.userId, 7);
            const similarAmounts = recentTrades.filter(tx => 
                Math.abs(tx.amountUSD - transaction.amountUSD) < 100
            );
            
            if (similarAmounts.length > 2) {
                return {
                    detected: true,
                    confidence: 0.85,
                    details: 'Structured transactions to avoid reporting threshold',
                    relatedTransactions: similarAmounts.map(tx => tx.id)
                };
            }
        }
        
        return { detected: false };
    }
}

/**
 * Rapid Movement Detector
 */
class RapidMovementDetector {
    async detect(transaction, monitor) {
        // Check for rapid fund movement
        const recentDeposits = await monitor.redis.zrevrangebyscore(
            `deposits:${transaction.userId}`,
            Date.now(),
            Date.now() - 3600000, // 1 hour
            'WITHSCORES'
        );
        
        if (recentDeposits.length > 0) {
            const depositTime = parseInt(recentDeposits[1]);
            const timeDiff = transaction.timestamp - depositTime;
            
            if (timeDiff < 600000) { // Less than 10 minutes
                return {
                    detected: true,
                    confidence: 0.75,
                    details: 'Rapid movement of funds after deposit',
                    relatedTransactions: [recentDeposits[0]]
                };
            }
        }
        
        return { detected: false };
    }
}

module.exports = TransactionMonitor;