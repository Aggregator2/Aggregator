const EventEmitter = require('events');
const geoip = require('geoip-lite');
const axios = require('axios');
const Redis = require('ioredis');

/**
 * Smart Compliance Engine
 * Handles geo-blocking, VPN detection, token restrictions, and dynamic rules
 */
class SmartCompliance extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            redis: config.redis || { host: 'localhost', port: 6379 },
            vpnDetection: {
                provider: config.vpnDetection?.provider || 'ipqualityscore',
                apiKey: config.vpnDetection?.apiKey,
                threshold: config.vpnDetection?.threshold || 0.85
            },
            geoBlocking: {
                enabled: config.geoBlocking?.enabled !== false,
                blockedCountries: config.geoBlocking?.blockedCountries || ['KP', 'IR', 'CU', 'SY'],
                blockedRegions: config.geoBlocking?.blockedRegions || ['crimea']
            },
            tokenRestrictions: config.tokenRestrictions || {},
            regulatoryApi: {
                endpoint: config.regulatoryApi?.endpoint || 'https://api.regulatory-updates.com',
                apiKey: config.regulatoryApi?.apiKey
            },
            ...config
        };
        
        this.redis = new Redis(this.config.redis);
        
        // Rules engine
        this.rulesEngine = new ComplianceRulesEngine();
        
        // Token compliance manager
        this.tokenCompliance = new TokenComplianceManager(this.config);
        
        // Geo compliance manager
        this.geoCompliance = new GeoComplianceManager(this.config);
        
        // VPN detector
        this.vpnDetector = new VPNDetector(this.config.vpnDetection);
        
        // Regulatory updates monitor
        this.regulatoryMonitor = new RegulatoryMonitor(this.config.regulatoryApi);
        
        // Initialize default rules
        this.initializeDefaultRules();
        
        // Start regulatory monitoring
        this.startRegulatoryMonitoring();
    }
    
    /**
     * Initialize default compliance rules
     */
    initializeDefaultRules() {
        // Geographic restrictions
        this.rulesEngine.addRule({
            id: 'geo_restriction',
            name: 'Geographic Restrictions',
            type: 'pre_transaction',
            condition: async (context) => {
                const geoCheck = await this.geoCompliance.checkCompliance(context.ip, context.country);
                return !geoCheck.allowed;
            },
            action: 'block',
            message: 'Service not available in your region'
        });
        
        // VPN/Proxy detection
        this.rulesEngine.addRule({
            id: 'vpn_detection',
            name: 'VPN/Proxy Detection',
            type: 'pre_transaction',
            condition: async (context) => {
                const vpnCheck = await this.vpnDetector.detect(context.ip);
                return vpnCheck.isVPN && vpnCheck.confidence > this.config.vpnDetection.threshold;
            },
            action: 'block',
            message: 'VPN/Proxy connections are not allowed'
        });
        
        // Token restrictions
        this.rulesEngine.addRule({
            id: 'token_restriction',
            name: 'Token Trading Restrictions',
            type: 'pre_transaction',
            condition: async (context) => {
                const tokenCheck = await this.tokenCompliance.checkToken(
                    context.token,
                    context.country,
                    context.userType
                );
                return !tokenCheck.allowed;
            },
            action: 'block',
            message: 'This token is not available for trading in your jurisdiction'
        });
        
        // Securities compliance
        this.rulesEngine.addRule({
            id: 'securities_compliance',
            name: 'Securities Law Compliance',
            type: 'pre_transaction',
            condition: async (context) => {
                if (context.tokenType === 'security') {
                    return !context.user.accreditedInvestor && context.country === 'US';
                }
                return false;
            },
            action: 'block',
            message: 'This security token requires accredited investor status'
        });
        
        // Daily limit compliance
        this.rulesEngine.addRule({
            id: 'daily_limit',
            name: 'Daily Trading Limit',
            type: 'pre_transaction',
            condition: async (context) => {
                const limit = await this.getJurisdictionLimit(context.country, context.userType);
                const dailyVolume = await this.getUserDailyVolume(context.userId);
                return dailyVolume + context.amount > limit;
            },
            action: 'block',
            message: 'Daily trading limit exceeded for your jurisdiction'
        });
    }
    
    /**
     * Check compliance for transaction
     */
    async checkCompliance(transactionContext) {
        try {
            // Enrich context with compliance data
            const enrichedContext = await this.enrichContext(transactionContext);
            
            // Run pre-transaction rules
            const preChecks = await this.rulesEngine.evaluate(enrichedContext, 'pre_transaction');
            
            if (!preChecks.passed) {
                return {
                    allowed: false,
                    reason: preChecks.failedRule.message,
                    ruleId: preChecks.failedRule.id,
                    details: preChecks.details
                };
            }
            
            // Check specific compliance requirements
            const complianceChecks = await Promise.all([
                this.checkGeoCompliance(enrichedContext),
                this.checkTokenCompliance(enrichedContext),
                this.checkUserCompliance(enrichedContext),
                this.checkTransactionLimits(enrichedContext)
            ]);
            
            const failed = complianceChecks.find(check => !check.passed);
            if (failed) {
                return {
                    allowed: false,
                    reason: failed.reason,
                    checkType: failed.type,
                    details: failed.details
                };
            }
            
            // Log compliance check
            await this.logComplianceCheck(enrichedContext, true);
            
            return {
                allowed: true,
                context: enrichedContext,
                checks: complianceChecks
            };
            
        } catch (error) {
            console.error('Compliance check error:', error);
            this.emit('error', { type: 'compliance_check', error });
            
            // Fail closed - deny if error
            return {
                allowed: false,
                reason: 'Compliance check failed',
                error: error.message
            };
        }
    }
    
    /**
     * Enrich transaction context
     */
    async enrichContext(context) {
        const enriched = { ...context };
        
        // Get geo data
        if (context.ip) {
            const geo = geoip.lookup(context.ip);
            enriched.country = enriched.country || geo?.country;
            enriched.region = geo?.region;
            enriched.city = geo?.city;
            enriched.timezone = geo?.timezone;
        }
        
        // Get user compliance profile
        if (context.userId) {
            enriched.userProfile = await this.getUserComplianceProfile(context.userId);
        }
        
        // Get token classification
        if (context.token) {
            enriched.tokenInfo = await this.tokenCompliance.getTokenInfo(context.token);
        }
        
        // Add timestamp
        enriched.timestamp = Date.now();
        
        return enriched;
    }
    
    /**
     * Check geographic compliance
     */
    async checkGeoCompliance(context) {
        try {
            // Check country restrictions
            const countryCheck = await this.geoCompliance.checkCountry(context.country);
            if (!countryCheck.allowed) {
                return {
                    passed: false,
                    type: 'geo',
                    reason: 'Country restricted',
                    details: countryCheck
                };
            }
            
            // Check region restrictions
            if (context.region) {
                const regionCheck = await this.geoCompliance.checkRegion(context.region);
                if (!regionCheck.allowed) {
                    return {
                        passed: false,
                        type: 'geo',
                        reason: 'Region restricted',
                        details: regionCheck
                    };
                }
            }
            
            // Check VPN/Proxy
            if (context.ip) {
                const vpnCheck = await this.vpnDetector.detect(context.ip);
                if (vpnCheck.isVPN && vpnCheck.confidence > this.config.vpnDetection.threshold) {
                    return {
                        passed: false,
                        type: 'geo',
                        reason: 'VPN/Proxy detected',
                        details: vpnCheck
                    };
                }
            }
            
            return { passed: true, type: 'geo' };
            
        } catch (error) {
            console.error('Geo compliance check error:', error);
            return {
                passed: false,
                type: 'geo',
                reason: 'Geo compliance check failed',
                error: error.message
            };
        }
    }
    
    /**
     * Check token compliance
     */
    async checkTokenCompliance(context) {
        if (!context.token) {
            return { passed: true, type: 'token' };
        }
        
        try {
            const tokenCheck = await this.tokenCompliance.checkToken(
                context.token,
                context.country,
                context.userProfile?.type
            );
            
            if (!tokenCheck.allowed) {
                return {
                    passed: false,
                    type: 'token',
                    reason: tokenCheck.reason,
                    details: tokenCheck
                };
            }
            
            // Check token-specific rules
            if (tokenCheck.restrictions) {
                for (const restriction of tokenCheck.restrictions) {
                    const restrictionCheck = await this.evaluateRestriction(restriction, context);
                    if (!restrictionCheck.passed) {
                        return {
                            passed: false,
                            type: 'token',
                            reason: restrictionCheck.reason,
                            details: restrictionCheck
                        };
                    }
                }
            }
            
            return { passed: true, type: 'token' };
            
        } catch (error) {
            console.error('Token compliance check error:', error);
            return {
                passed: false,
                type: 'token',
                reason: 'Token compliance check failed',
                error: error.message
            };
        }
    }
    
    /**
     * Check user compliance
     */
    async checkUserCompliance(context) {
        if (!context.userId) {
            return { passed: true, type: 'user' };
        }
        
        try {
            const profile = context.userProfile;
            
            // Check KYC status
            if (!profile.kycVerified && context.amount > 1000) {
                return {
                    passed: false,
                    type: 'user',
                    reason: 'KYC verification required for this transaction',
                    details: { requiredFor: 'amount_exceeds_limit' }
                };
            }
            
            // Check user restrictions
            if (profile.restricted) {
                return {
                    passed: false,
                    type: 'user',
                    reason: 'User account restricted',
                    details: { restriction: profile.restrictionReason }
                };
            }
            
            // Check accredited investor status for securities
            if (context.tokenInfo?.type === 'security' && !profile.accreditedInvestor) {
                return {
                    passed: false,
                    type: 'user',
                    reason: 'Accredited investor status required',
                    details: { tokenType: 'security' }
                };
            }
            
            return { passed: true, type: 'user' };
            
        } catch (error) {
            console.error('User compliance check error:', error);
            return {
                passed: false,
                type: 'user',
                reason: 'User compliance check failed',
                error: error.message
            };
        }
    }
    
    /**
     * Check transaction limits
     */
    async checkTransactionLimits(context) {
        try {
            // Get jurisdiction limits
            const limits = await this.getJurisdictionLimits(
                context.country,
                context.userProfile?.type
            );
            
            // Check single transaction limit
            if (context.amount > limits.singleTransaction) {
                return {
                    passed: false,
                    type: 'limit',
                    reason: 'Transaction exceeds single transaction limit',
                    details: {
                        limit: limits.singleTransaction,
                        amount: context.amount
                    }
                };
            }
            
            // Check daily limit
            const dailyVolume = await this.getUserDailyVolume(context.userId);
            if (dailyVolume + context.amount > limits.daily) {
                return {
                    passed: false,
                    type: 'limit',
                    reason: 'Transaction exceeds daily limit',
                    details: {
                        limit: limits.daily,
                        current: dailyVolume,
                        attempted: context.amount
                    }
                };
            }
            
            // Check monthly limit
            const monthlyVolume = await this.getUserMonthlyVolume(context.userId);
            if (monthlyVolume + context.amount > limits.monthly) {
                return {
                    passed: false,
                    type: 'limit',
                    reason: 'Transaction exceeds monthly limit',
                    details: {
                        limit: limits.monthly,
                        current: monthlyVolume,
                        attempted: context.amount
                    }
                };
            }
            
            return { passed: true, type: 'limit' };
            
        } catch (error) {
            console.error('Transaction limit check error:', error);
            return {
                passed: false,
                type: 'limit',
                reason: 'Transaction limit check failed',
                error: error.message
            };
        }
    }
    
    /**
     * Get user compliance profile
     */
    async getUserComplianceProfile(userId) {
        const cached = await this.redis.get(`compliance:profile:${userId}`);
        if (cached) {
            return JSON.parse(cached);
        }
        
        // Fetch from database
        const profile = {
            userId,
            kycVerified: true,
            kycLevel: 2,
            accreditedInvestor: false,
            type: 'retail',
            country: 'US',
            restricted: false,
            createdAt: Date.now()
        };
        
        // Cache for 1 hour
        await this.redis.setex(
            `compliance:profile:${userId}`,
            3600,
            JSON.stringify(profile)
        );
        
        return profile;
    }
    
    /**
     * Get jurisdiction limits
     */
    async getJurisdictionLimits(country, userType) {
        const key = `limits:${country}:${userType}`;
        const cached = await this.redis.get(key);
        if (cached) {
            return JSON.parse(cached);
        }
        
        // Default limits by jurisdiction
        const limits = {
            US: {
                retail: {
                    singleTransaction: 10000,
                    daily: 50000,
                    monthly: 200000
                },
                accredited: {
                    singleTransaction: 100000,
                    daily: 500000,
                    monthly: 2000000
                }
            },
            EU: {
                retail: {
                    singleTransaction: 15000,
                    daily: 75000,
                    monthly: 300000
                }
            },
            DEFAULT: {
                retail: {
                    singleTransaction: 5000,
                    daily: 25000,
                    monthly: 100000
                }
            }
        };
        
        const countryLimits = limits[country] || limits.DEFAULT;
        const userLimits = countryLimits[userType] || countryLimits.retail;
        
        // Cache for 24 hours
        await this.redis.setex(key, 86400, JSON.stringify(userLimits));
        
        return userLimits;
    }
    
    /**
     * Get user daily volume
     */
    async getUserDailyVolume(userId) {
        const key = `volume:daily:${userId}:${this.getDateKey()}`;
        const volume = await this.redis.get(key);
        return parseFloat(volume) || 0;
    }
    
    /**
     * Get user monthly volume
     */
    async getUserMonthlyVolume(userId) {
        const key = `volume:monthly:${userId}:${this.getMonthKey()}`;
        const volume = await this.redis.get(key);
        return parseFloat(volume) || 0;
    }
    
    /**
     * Start regulatory monitoring
     */
    startRegulatoryMonitoring() {
        // Check for regulatory updates every hour
        setInterval(async () => {
            try {
                const updates = await this.regulatoryMonitor.checkUpdates();
                if (updates.length > 0) {
                    await this.processRegulatoryUpdates(updates);
                }
            } catch (error) {
                console.error('Regulatory monitoring error:', error);
            }
        }, 3600000); // 1 hour
    }
    
    /**
     * Process regulatory updates
     */
    async processRegulatoryUpdates(updates) {
        for (const update of updates) {
            this.emit('regulatoryUpdate', update);
            
            // Update rules based on regulatory changes
            if (update.type === 'restriction') {
                await this.updateRestrictions(update);
            } else if (update.type === 'limit_change') {
                await this.updateLimits(update);
            } else if (update.type === 'token_classification') {
                await this.updateTokenClassification(update);
            }
        }
    }
    
    /**
     * Update restrictions based on regulatory changes
     */
    async updateRestrictions(update) {
        if (update.scope === 'country') {
            this.config.geoBlocking.blockedCountries.push(...update.countries);
        } else if (update.scope === 'token') {
            await this.tokenCompliance.addRestriction(update.token, update.restriction);
        }
    }
    
    /**
     * Log compliance check
     */
    async logComplianceCheck(context, result) {
        const log = {
            timestamp: Date.now(),
            userId: context.userId,
            country: context.country,
            token: context.token,
            amount: context.amount,
            result,
            ip: context.ip
        };
        
        await this.redis.lpush('compliance:logs', JSON.stringify(log));
        
        // Keep only last 30 days
        await this.redis.ltrim('compliance:logs', 0, 1000000);
    }
    
    /**
     * Get date key for daily tracking
     */
    getDateKey() {
        const date = new Date();
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }
    
    /**
     * Get month key for monthly tracking
     */
    getMonthKey() {
        const date = new Date();
        return `${date.getFullYear()}-${date.getMonth() + 1}`;
    }
    
    /**
     * Evaluate restriction
     */
    async evaluateRestriction(restriction, context) {
        // Implement restriction evaluation logic
        return { passed: true };
    }
    
    /**
     * Get jurisdiction limit (simplified)
     */
    async getJurisdictionLimit(country, userType) {
        const limits = await this.getJurisdictionLimits(country, userType);
        return limits.daily;
    }
}

/**
 * Compliance Rules Engine
 */
class ComplianceRulesEngine {
    constructor() {
        this.rules = new Map();
    }
    
    addRule(rule) {
        this.rules.set(rule.id, rule);
    }
    
    async evaluate(context, type) {
        const applicableRules = Array.from(this.rules.values())
            .filter(rule => rule.type === type);
        
        for (const rule of applicableRules) {
            try {
                const violated = await rule.condition(context);
                if (violated) {
                    return {
                        passed: false,
                        failedRule: rule,
                        details: { context, ruleId: rule.id }
                    };
                }
            } catch (error) {
                console.error(`Rule ${rule.id} evaluation error:`, error);
            }
        }
        
        return { passed: true };
    }
}

/**
 * Token Compliance Manager
 */
class TokenComplianceManager {
    constructor(config) {
        this.config = config;
        this.tokenRegistry = new Map();
        this.restrictions = new Map();
        
        // Initialize token classifications
        this.initializeTokens();
    }
    
    initializeTokens() {
        // Example token classifications
        this.tokenRegistry.set('USDC', {
            type: 'stablecoin',
            regulated: true,
            restrictions: []
        });
        
        this.tokenRegistry.set('WBTC', {
            type: 'wrapped',
            regulated: false,
            restrictions: []
        });
    }
    
    async checkToken(token, country, userType) {
        const tokenInfo = this.tokenRegistry.get(token);
        if (!tokenInfo) {
            return { allowed: true }; // Unknown tokens allowed by default
        }
        
        // Check country-specific restrictions
        const restrictions = this.getTokenRestrictions(token, country);
        for (const restriction of restrictions) {
            if (!this.evaluateTokenRestriction(restriction, userType)) {
                return {
                    allowed: false,
                    reason: restriction.reason,
                    restriction
                };
            }
        }
        
        return { allowed: true, tokenInfo };
    }
    
    async getTokenInfo(token) {
        return this.tokenRegistry.get(token) || { type: 'unknown' };
    }
    
    getTokenRestrictions(token, country) {
        const key = `${token}:${country}`;
        return this.restrictions.get(key) || [];
    }
    
    evaluateTokenRestriction(restriction, userType) {
        // Implement restriction evaluation
        return true;
    }
    
    async addRestriction(token, restriction) {
        const key = `${token}:${restriction.country}`;
        const existing = this.restrictions.get(key) || [];
        existing.push(restriction);
        this.restrictions.set(key, existing);
    }
}

/**
 * Geo Compliance Manager
 */
class GeoComplianceManager {
    constructor(config) {
        this.config = config;
    }
    
    async checkCompliance(ip, country) {
        const countryCheck = await this.checkCountry(country);
        if (!countryCheck.allowed) {
            return countryCheck;
        }
        
        // Additional IP-based checks
        if (ip) {
            const ipCheck = await this.checkIPReputation(ip);
            if (!ipCheck.allowed) {
                return ipCheck;
            }
        }
        
        return { allowed: true };
    }
    
    async checkCountry(country) {
        if (this.config.geoBlocking.blockedCountries.includes(country)) {
            return {
                allowed: false,
                reason: 'country_blocked',
                country
            };
        }
        
        return { allowed: true };
    }
    
    async checkRegion(region) {
        const blockedRegions = this.config.geoBlocking.blockedRegions;
        const regionLower = region.toLowerCase();
        
        if (blockedRegions.some(r => regionLower.includes(r))) {
            return {
                allowed: false,
                reason: 'region_blocked',
                region
            };
        }
        
        return { allowed: true };
    }
    
    async checkIPReputation(ip) {
        // Check IP reputation services
        return { allowed: true };
    }
}

/**
 * VPN Detector
 */
class VPNDetector {
    constructor(config) {
        this.config = config;
        this.cache = new Map();
    }
    
    async detect(ip) {
        // Check cache
        const cached = this.cache.get(ip);
        if (cached && Date.now() - cached.timestamp < 3600000) {
            return cached.result;
        }
        
        try {
            const result = await this.checkWithProvider(ip);
            
            // Cache result
            this.cache.set(ip, {
                result,
                timestamp: Date.now()
            });
            
            return result;
            
        } catch (error) {
            console.error('VPN detection error:', error);
            return { isVPN: false, confidence: 0 };
        }
    }
    
    async checkWithProvider(ip) {
        if (this.config.provider === 'ipqualityscore') {
            return await this.checkIPQualityScore(ip);
        }
        
        // Default detection logic
        return { isVPN: false, confidence: 0 };
    }
    
    async checkIPQualityScore(ip) {
        if (!this.config.apiKey) {
            return { isVPN: false, confidence: 0 };
        }
        
        try {
            const response = await axios.get(
                `https://ipqualityscore.com/api/json/ip/${this.config.apiKey}/${ip}`
            );
            
            const data = response.data;
            
            return {
                isVPN: data.vpn || data.proxy,
                confidence: data.fraud_score / 100,
                details: {
                    vpn: data.vpn,
                    proxy: data.proxy,
                    tor: data.tor,
                    fraudScore: data.fraud_score
                }
            };
            
        } catch (error) {
            console.error('IPQualityScore API error:', error);
            return { isVPN: false, confidence: 0 };
        }
    }
}

/**
 * Regulatory Monitor
 */
class RegulatoryMonitor {
    constructor(config) {
        this.config = config;
        this.lastCheck = null;
    }
    
    async checkUpdates() {
        if (!this.config.apiKey) {
            return [];
        }
        
        try {
            const response = await axios.get(this.config.endpoint, {
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                params: {
                    since: this.lastCheck || Date.now() - 86400000 // 24 hours
                }
            });
            
            this.lastCheck = Date.now();
            
            return response.data.updates || [];
            
        } catch (error) {
            console.error('Regulatory API error:', error);
            return [];
        }
    }
}

module.exports = SmartCompliance;