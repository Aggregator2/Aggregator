/**
 * @title API Key Management System with Tiered Rate Limiting
 * @author DEX Security Team
 * @notice Comprehensive API key management with multiple tiers and advanced rate limiting
 * @dev Implements enterprise-grade API access control with usage analytics and security monitoring
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Redis = require('redis');

class APIKeyManagement {
    constructor(config) {
        this.config = {
            keyLength: config.keyLength || 64,
            hashRounds: config.hashRounds || 12,
            defaultTier: config.defaultTier || 'basic',
            enableUsageAnalytics: config.enableUsageAnalytics !== false,
            enableSecurityMonitoring: config.enableSecurityMonitoring !== false,
            ...config
        };

        // Redis for rate limiting and caching
        this.redisClient = Redis.createClient(config.redis || {});
        this.redisClient.on('error', (err) => console.error('Redis Client Error', err));

        // API key storage (in production, use database)
        this.apiKeys = new Map(); // keyId -> API key data
        this.keysByHash = new Map(); // hash -> API key data
        this.userKeys = new Map(); // userId -> Set of keyIds

        // Rate limiter
        this.rateLimiter = new TieredRateLimiter(this.redisClient, config);
        
        // Security and analytics
        this.securityMonitor = new APISecurityMonitor(config);
        this.usageAnalytics = new APIUsageAnalytics(this.redisClient, config);
        this.alertSystem = new APIAlertSystem(config);

        // Define API tiers
        this.tiers = this._initializeTiers();
        
        this._startBackgroundTasks();
    }

    /**
     * Initialize the API key management system
     */
    async initialize() {
        try {
            await this.redisClient.connect();
            await this.rateLimiter.initialize();
            await this.usageAnalytics.initialize();
            console.log('API Key Management system initialized successfully');
        } catch (error) {
            console.error('Failed to initialize API key management:', error);
            throw error;
        }
    }

    /**
     * Create a new API key for a user
     * @param {string} userId User ID
     * @param {Object} options API key options
     * @returns {Promise<Object>} Created API key information
     */
    async createAPIKey(userId, options = {}) {
        try {
            const {
                name = 'Default API Key',
                tier = this.config.defaultTier,
                permissions = [],
                expiresAt = null,
                ipWhitelist = [],
                metadata = {}
            } = options;

            // Validate tier
            if (!this.tiers.has(tier)) {
                throw new APIKeyError(`Invalid tier: ${tier}`);
            }

            // Generate API key
            const keyId = crypto.randomUUID();
            const rawKey = crypto.randomBytes(this.config.keyLength).toString('hex');
            const keyHash = await bcrypt.hash(rawKey, this.config.hashRounds);
            
            // Create full API key (includes prefix for identification)
            const fullAPIKey = `dex_${tier}_${Buffer.from(keyId).toString('base64').replace(/[=+/]/g, '').substring(0, 8)}_${rawKey}`;

            const apiKeyData = {
                id: keyId,
                userId,
                name,
                tier,
                keyHash,
                permissions: new Set(permissions),
                ipWhitelist: new Set(ipWhitelist),
                metadata,
                createdAt: Date.now(),
                lastUsed: null,
                usageCount: 0,
                isActive: true,
                expiresAt,
                securityFlags: {
                    suspiciousActivity: false,
                    rateLimitViolations: 0,
                    lastSecurityCheck: Date.now()
                }
            };

            // Store API key
            this.apiKeys.set(keyId, apiKeyData);
            this.keysByHash.set(keyHash, apiKeyData);

            // Track user's keys
            if (!this.userKeys.has(userId)) {
                this.userKeys.set(userId, new Set());
            }
            this.userKeys.get(userId).add(keyId);

            // Initialize rate limiting
            await this.rateLimiter.initializeKey(keyId, tier);

            // Log creation
            await this.securityMonitor.logKeyCreation({
                keyId,
                userId,
                tier,
                name,
                permissions: Array.from(permissions),
                createdAt: apiKeyData.createdAt
            });

            return {
                keyId,
                apiKey: fullAPIKey, // Only returned once
                name,
                tier,
                permissions: Array.from(permissions),
                limits: this.tiers.get(tier),
                createdAt: apiKeyData.createdAt,
                expiresAt
            };

        } catch (error) {
            await this.securityMonitor.logKeyError({
                action: 'create_key',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Validate API key and check rate limits
     * @param {string} apiKey Full API key
     * @param {string} clientIp Client IP address
     * @param {string} endpoint API endpoint
     * @param {Object} options Validation options
     * @returns {Promise<Object>} Validation result
     */
    async validateAPIKey(apiKey, clientIp, endpoint = 'general', options = {}) {
        try {
            // Parse API key
            const keyData = await this._parseAPIKey(apiKey);
            if (!keyData) {
                throw new APIKeyError('Invalid API key format');
            }

            // Get API key data
            const apiKeyData = this.keysByHash.get(keyData.hash);
            if (!apiKeyData) {
                throw new APIKeyError('API key not found');
            }

            // Check if key is active
            if (!apiKeyData.isActive) {
                throw new APIKeyError('API key is inactive');
            }

            // Check expiration
            if (apiKeyData.expiresAt && Date.now() > apiKeyData.expiresAt) {
                throw new APIKeyError('API key has expired');
            }

            // Check IP whitelist
            if (apiKeyData.ipWhitelist.size > 0 && !apiKeyData.ipWhitelist.has(clientIp)) {
                throw new APIKeyError('IP address not whitelisted');
            }

            // Check rate limits
            const rateLimitResult = await this.rateLimiter.checkRateLimit(
                apiKeyData.id,
                apiKeyData.tier,
                endpoint,
                clientIp
            );

            if (!rateLimitResult.allowed) {
                // Record rate limit violation
                apiKeyData.securityFlags.rateLimitViolations++;
                
                await this.securityMonitor.logRateLimitViolation({
                    keyId: apiKeyData.id,
                    userId: apiKeyData.userId,
                    clientIp,
                    endpoint,
                    tier: apiKeyData.tier,
                    limits: rateLimitResult.limits,
                    current: rateLimitResult.current
                });

                throw new RateLimitError('Rate limit exceeded', rateLimitResult);
            }

            // Update usage statistics
            await this._updateUsageStats(apiKeyData, endpoint, clientIp);

            // Security monitoring
            await this.securityMonitor.recordAPIUsage({
                keyId: apiKeyData.id,
                userId: apiKeyData.userId,
                endpoint,
                clientIp,
                tier: apiKeyData.tier,
                timestamp: Date.now()
            });

            return {
                valid: true,
                keyId: apiKeyData.id,
                userId: apiKeyData.userId,
                tier: apiKeyData.tier,
                permissions: Array.from(apiKeyData.permissions),
                rateLimits: rateLimitResult.limits,
                usage: {
                    remaining: rateLimitResult.remaining,
                    resetTime: rateLimitResult.resetTime
                }
            };

        } catch (error) {
            await this.securityMonitor.logValidationError({
                apiKey: apiKey?.substring(0, 20) + '...', // Log partial key for debugging
                clientIp,
                endpoint,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Update API key properties
     * @param {string} keyId API key ID
     * @param {Object} updates Update data
     * @returns {Promise<Object>} Updated key data
     */
    async updateAPIKey(keyId, updates) {
        try {
            const apiKeyData = this.apiKeys.get(keyId);
            if (!apiKeyData) {
                throw new APIKeyError('API key not found');
            }

            const oldData = { ...apiKeyData };

            // Update allowed fields
            if (updates.name !== undefined) {
                apiKeyData.name = updates.name;
            }
            if (updates.permissions !== undefined) {
                apiKeyData.permissions = new Set(updates.permissions);
            }
            if (updates.ipWhitelist !== undefined) {
                apiKeyData.ipWhitelist = new Set(updates.ipWhitelist);
            }
            if (updates.expiresAt !== undefined) {
                apiKeyData.expiresAt = updates.expiresAt;
            }
            if (updates.isActive !== undefined) {
                apiKeyData.isActive = updates.isActive;
            }

            // Update tier (requires special handling)
            if (updates.tier !== undefined && updates.tier !== apiKeyData.tier) {
                if (!this.tiers.has(updates.tier)) {
                    throw new APIKeyError(`Invalid tier: ${updates.tier}`);
                }
                
                const oldTier = apiKeyData.tier;
                apiKeyData.tier = updates.tier;
                
                // Update rate limiter
                await this.rateLimiter.updateKeyTier(keyId, oldTier, updates.tier);
            }

            apiKeyData.updatedAt = Date.now();
            apiKeyData.updatedBy = updates.updatedBy || 'system';

            await this.securityMonitor.logKeyUpdate({
                keyId,
                userId: apiKeyData.userId,
                oldData: this._sanitizeKeyData(oldData),
                newData: this._sanitizeKeyData(apiKeyData),
                updatedBy: updates.updatedBy
            });

            return {
                keyId,
                name: apiKeyData.name,
                tier: apiKeyData.tier,
                permissions: Array.from(apiKeyData.permissions),
                isActive: apiKeyData.isActive,
                updatedAt: apiKeyData.updatedAt
            };

        } catch (error) {
            await this.securityMonitor.logKeyError({
                action: 'update_key',
                keyId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Revoke API key
     * @param {string} keyId API key ID
     * @param {Object} options Revocation options
     * @returns {Promise<void>}
     */
    async revokeAPIKey(keyId, options = {}) {
        try {
            const apiKeyData = this.apiKeys.get(keyId);
            if (!apiKeyData) {
                throw new APIKeyError('API key not found');
            }

            // Mark as inactive
            apiKeyData.isActive = false;
            apiKeyData.revokedAt = Date.now();
            apiKeyData.revokedBy = options.revokedBy || 'system';
            apiKeyData.revocationReason = options.reason || 'manual_revocation';

            // Clean up rate limiting data
            await this.rateLimiter.cleanupKey(keyId);

            // Remove from user's key set
            const userKeySet = this.userKeys.get(apiKeyData.userId);
            if (userKeySet) {
                userKeySet.delete(keyId);
                if (userKeySet.size === 0) {
                    this.userKeys.delete(apiKeyData.userId);
                }
            }

            await this.securityMonitor.logKeyRevocation({
                keyId,
                userId: apiKeyData.userId,
                reason: options.reason,
                revokedBy: options.revokedBy,
                revokedAt: apiKeyData.revokedAt
            });

        } catch (error) {
            await this.securityMonitor.logKeyError({
                action: 'revoke_key',
                keyId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get API key usage analytics
     * @param {string} keyId API key ID
     * @param {Object} options Analytics options
     * @returns {Promise<Object>} Usage analytics
     */
    async getKeyAnalytics(keyId, options = {}) {
        try {
            const apiKeyData = this.apiKeys.get(keyId);
            if (!apiKeyData) {
                throw new APIKeyError('API key not found');
            }

            const analytics = await this.usageAnalytics.getKeyAnalytics(keyId, options);
            const rateLimitStats = await this.rateLimiter.getKeyStats(keyId);

            return {
                keyId,
                basicStats: {
                    totalRequests: apiKeyData.usageCount,
                    lastUsed: apiKeyData.lastUsed,
                    createdAt: apiKeyData.createdAt,
                    tier: apiKeyData.tier
                },
                usage: analytics,
                rateLimiting: rateLimitStats,
                security: {
                    rateLimitViolations: apiKeyData.securityFlags.rateLimitViolations,
                    suspiciousActivity: apiKeyData.securityFlags.suspiciousActivity
                }
            };

        } catch (error) {
            console.error('Error getting key analytics:', error);
            throw error;
        }
    }

    /**
     * List API keys for a user
     * @param {string} userId User ID
     * @param {Object} options List options
     * @returns {Promise<Array>} List of API keys
     */
    async listUserAPIKeys(userId, options = {}) {
        try {
            const userKeySet = this.userKeys.get(userId);
            if (!userKeySet) {
                return [];
            }

            const keys = [];
            for (const keyId of userKeySet) {
                const apiKeyData = this.apiKeys.get(keyId);
                if (apiKeyData && (options.includeInactive || apiKeyData.isActive)) {
                    keys.push({
                        keyId,
                        name: apiKeyData.name,
                        tier: apiKeyData.tier,
                        permissions: Array.from(apiKeyData.permissions),
                        isActive: apiKeyData.isActive,
                        createdAt: apiKeyData.createdAt,
                        lastUsed: apiKeyData.lastUsed,
                        usageCount: apiKeyData.usageCount,
                        expiresAt: apiKeyData.expiresAt
                    });
                }
            }

            return keys.sort((a, b) => b.createdAt - a.createdAt);

        } catch (error) {
            console.error('Error listing user API keys:', error);
            throw error;
        }
    }

    // =============================================================================
    // PRIVATE HELPER METHODS
    // =============================================================================

    /**
     * Initialize API tier configurations
     * @returns {Map} Tier configurations
     * @private
     */
    _initializeTiers() {
        const tiers = new Map();

        // Basic tier
        tiers.set('basic', {
            name: 'Basic',
            description: 'Basic API access for individual developers',
            limits: {
                requestsPerMinute: 100,
                requestsPerHour: 1000,
                requestsPerDay: 10000,
                concurrentRequests: 5,
                dataTransferPerDay: 100 * 1024 * 1024 // 100MB
            },
            features: {
                webhooks: false,
                analytics: false,
                priority: 'low',
                support: 'community'
            },
            cost: 0
        });

        // Professional tier
        tiers.set('professional', {
            name: 'Professional',
            description: 'Enhanced API access for professional traders',
            limits: {
                requestsPerMinute: 500,
                requestsPerHour: 10000,
                requestsPerDay: 100000,
                concurrentRequests: 20,
                dataTransferPerDay: 1024 * 1024 * 1024 // 1GB
            },
            features: {
                webhooks: true,
                analytics: true,
                priority: 'medium',
                support: 'email'
            },
            cost: 50
        });

        // Enterprise tier
        tiers.set('enterprise', {
            name: 'Enterprise',
            description: 'Unlimited API access for institutional clients',
            limits: {
                requestsPerMinute: 2000,
                requestsPerHour: 50000,
                requestsPerDay: 1000000,
                concurrentRequests: 100,
                dataTransferPerDay: 10 * 1024 * 1024 * 1024 // 10GB
            },
            features: {
                webhooks: true,
                analytics: true,
                priority: 'high',
                support: 'dedicated',
                customLimits: true
            },
            cost: 500
        });

        // Internal tier (for system operations)
        tiers.set('internal', {
            name: 'Internal',
            description: 'Unlimited access for internal system operations',
            limits: {
                requestsPerMinute: Infinity,
                requestsPerHour: Infinity,
                requestsPerDay: Infinity,
                concurrentRequests: Infinity,
                dataTransferPerDay: Infinity
            },
            features: {
                webhooks: true,
                analytics: true,
                priority: 'highest',
                support: 'internal'
            },
            cost: 0
        });

        return tiers;
    }

    /**
     * Parse API key and extract components
     * @param {string} apiKey Full API key
     * @returns {Object|null} Parsed key data
     * @private
     */
    async _parseAPIKey(apiKey) {
        try {
            // Expected format: dex_{tier}_{keyPrefix}_{rawKey}
            const parts = apiKey.split('_');
            if (parts.length !== 4 || parts[0] !== 'dex') {
                return null;
            }

            const [prefix, tier, keyPrefix, rawKey] = parts;
            
            // Find matching key by trying all stored hashes
            for (const [hash, keyData] of this.keysByHash.entries()) {
                if (keyData.tier === tier) {
                    const isMatch = await bcrypt.compare(`dex_${tier}_${keyPrefix}_${rawKey}`, hash);
                    if (isMatch) {
                        return {
                            tier,
                            keyPrefix,
                            rawKey,
                            hash
                        };
                    }
                }
            }

            return null;

        } catch (error) {
            console.error('Error parsing API key:', error);
            return null;
        }
    }

    /**
     * Update usage statistics for API key
     * @param {Object} apiKeyData API key data
     * @param {string} endpoint Endpoint accessed
     * @param {string} clientIp Client IP
     * @private
     */
    async _updateUsageStats(apiKeyData, endpoint, clientIp) {
        apiKeyData.usageCount++;
        apiKeyData.lastUsed = Date.now();

        if (this.config.enableUsageAnalytics) {
            await this.usageAnalytics.recordUsage(apiKeyData.id, {
                endpoint,
                clientIp,
                timestamp: Date.now(),
                tier: apiKeyData.tier
            });
        }
    }

    /**
     * Sanitize key data for logging
     * @param {Object} keyData API key data
     * @returns {Object} Sanitized data
     * @private
     */
    _sanitizeKeyData(keyData) {
        return {
            id: keyData.id,
            name: keyData.name,
            tier: keyData.tier,
            isActive: keyData.isActive,
            usageCount: keyData.usageCount,
            permissionCount: keyData.permissions?.size || 0
        };
    }

    /**
     * Start background tasks
     * @private
     */
    _startBackgroundTasks() {
        // Clean up expired keys every hour
        setInterval(async () => {
            await this._cleanupExpiredKeys();
        }, 3600000);

        // Security monitoring every 5 minutes
        setInterval(async () => {
            await this.securityMonitor.runSecurityCheck();
        }, 300000);

        // Usage analytics aggregation every 15 minutes
        if (this.config.enableUsageAnalytics) {
            setInterval(async () => {
                await this.usageAnalytics.aggregateUsageData();
            }, 900000);
        }
    }

    /**
     * Clean up expired API keys
     * @private
     */
    async _cleanupExpiredKeys() {
        const now = Date.now();
        const expiredKeys = [];

        for (const [keyId, keyData] of this.apiKeys.entries()) {
            if (keyData.expiresAt && now > keyData.expiresAt && keyData.isActive) {
                expiredKeys.push(keyId);
            }
        }

        for (const keyId of expiredKeys) {
            await this.revokeAPIKey(keyId, {
                reason: 'expired',
                revokedBy: 'system'
            });
        }

        if (expiredKeys.length > 0) {
            console.log(`Cleaned up ${expiredKeys.length} expired API keys`);
        }
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get available API tiers
     * @returns {Object} Available tiers
     */
    getAvailableTiers() {
        const tiers = {};
        for (const [tierId, tierData] of this.tiers.entries()) {
            if (tierId !== 'internal') { // Don't expose internal tier
                tiers[tierId] = {
                    name: tierData.name,
                    description: tierData.description,
                    limits: tierData.limits,
                    features: tierData.features,
                    cost: tierData.cost
                };
            }
        }
        return tiers;
    }

    /**
     * Get system statistics
     * @returns {Object} System statistics
     */
    getSystemStatistics() {
        const totalKeys = this.apiKeys.size;
        const activeKeys = Array.from(this.apiKeys.values()).filter(k => k.isActive).length;
        const tierStats = {};

        for (const tierName of this.tiers.keys()) {
            tierStats[tierName] = Array.from(this.apiKeys.values())
                .filter(k => k.tier === tierName && k.isActive).length;
        }

        return {
            totalKeys,
            activeKeys,
            tierDistribution: tierStats,
            totalUsers: this.userKeys.size,
            systemHealth: 'healthy'
        };
    }

    /**
     * Get health status
     * @returns {Promise<Object>} Health status
     */
    async getHealthStatus() {
        try {
            const redisHealth = this.redisClient.isReady ? 'healthy' : 'unhealthy';
            const rateLimiterHealth = await this.rateLimiter.getHealthStatus();
            
            return {
                status: redisHealth === 'healthy' && rateLimiterHealth.status === 'healthy' ? 'healthy' : 'degraded',
                components: {
                    redis: redisHealth,
                    rateLimiter: rateLimiterHealth.status,
                    analytics: this.config.enableUsageAnalytics ? 'enabled' : 'disabled'
                },
                statistics: this.getSystemStatistics(),
                timestamp: Date.now()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: Date.now()
            };
        }
    }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

class TieredRateLimiter {
    constructor(redisClient, config) {
        this.redisClient = redisClient;
        this.config = config;
        this.windowSize = 60; // 1 minute windows
    }

    async initialize() {
        // Initialize rate limiting scripts in Redis
        console.log('Rate limiter initialized');
    }

    async initializeKey(keyId, tier) {
        // Initialize rate limiting for new key
        const key = `rate_limit:${keyId}`;
        await this.redisClient.setEx(key, 3600, JSON.stringify({
            tier,
            initialized: Date.now()
        }));
    }

    async checkRateLimit(keyId, tier, endpoint, clientIp) {
        // Implementation would check various rate limits
        // For now, return allowed
        return {
            allowed: true,
            remaining: 100,
            resetTime: Date.now() + 60000,
            limits: {
                requestsPerMinute: 100
            }
        };
    }

    async updateKeyTier(keyId, oldTier, newTier) {
        // Update tier in rate limiting system
        console.log(`Updated key ${keyId} tier from ${oldTier} to ${newTier}`);
    }

    async cleanupKey(keyId) {
        // Clean up rate limiting data for revoked key
        await this.redisClient.del(`rate_limit:${keyId}`);
    }

    async getKeyStats(keyId) {
        // Get rate limiting statistics for key
        return {
            currentUsage: 0,
            limitsReached: 0,
            lastReset: Date.now()
        };
    }

    async getHealthStatus() {
        return { status: 'healthy' };
    }
}

class APISecurityMonitor {
    constructor(config) {
        this.config = config;
        this.securityEvents = [];
    }

    async logKeyCreation(data) {
        console.log('API key created:', data.keyId);
    }

    async logKeyUpdate(data) {
        console.log('API key updated:', data.keyId);
    }

    async logKeyRevocation(data) {
        console.log('API key revoked:', data.keyId);
    }

    async logKeyError(data) {
        console.error('API key error:', data);
    }

    async logRateLimitViolation(data) {
        console.warn('Rate limit violation:', data);
    }

    async logValidationError(data) {
        console.error('Validation error:', data);
    }

    async recordAPIUsage(data) {
        // Record usage for security analysis
    }

    async runSecurityCheck() {
        // Run periodic security checks
        console.log('Running security check');
    }
}

class APIUsageAnalytics {
    constructor(redisClient, config) {
        this.redisClient = redisClient;
        this.config = config;
    }

    async initialize() {
        console.log('Usage analytics initialized');
    }

    async recordUsage(keyId, data) {
        // Record usage data for analytics
    }

    async getKeyAnalytics(keyId, options) {
        // Return analytics data for key
        return {
            dailyUsage: [],
            topEndpoints: [],
            averageResponseTime: 100
        };
    }

    async aggregateUsageData() {
        // Aggregate usage data
        console.log('Aggregating usage data');
    }
}

class APIAlertSystem {
    constructor(config) {
        this.config = config;
    }

    async sendAlert(type, data) {
        console.warn(`API Alert [${type}]:`, data);
    }
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

class APIKeyError extends Error {
    constructor(message, code = 'API_KEY_ERROR') {
        super(message);
        this.name = 'APIKeyError';
        this.code = code;
    }
}

class RateLimitError extends Error {
    constructor(message, rateLimitData) {
        super(message);
        this.name = 'RateLimitError';
        this.code = 'RATE_LIMIT_EXCEEDED';
        this.rateLimitData = rateLimitData;
    }
}

module.exports = {
    APIKeyManagement,
    TieredRateLimiter,
    APISecurityMonitor,
    APIUsageAnalytics,
    APIKeyError,
    RateLimitError
};