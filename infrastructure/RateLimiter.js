/**
 * @fileoverview Advanced Rate Limiting System for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Multi-tier rate limiting with IP, wallet, and API-based controls
 */

const Redis = require('redis');
const crypto = require('crypto');

/**
 * Advanced Rate Limiter with multiple strategies and backends
 */
class RateLimiter {
    constructor(config) {
        this.config = {
            redis: {
                host: config.redis?.host || 'localhost',
                port: config.redis?.port || 6379,
                password: config.redis?.password,
                db: config.redis?.db || 0,
                keyPrefix: config.redis?.keyPrefix || 'rl:',
                ...config.redis
            },
            strategies: {
                ip: {
                    enabled: true,
                    windowMs: 60000, // 1 minute
                    maxRequests: 100,
                    skipSuccessfulRequests: false,
                    skipFailedRequests: false,
                    ...config.strategies?.ip
                },
                wallet: {
                    enabled: true,
                    windowMs: 60000, // 1 minute
                    maxRequests: 50,
                    skipSuccessfulRequests: false,
                    skipFailedRequests: false,
                    ...config.strategies?.wallet
                },
                api: {
                    enabled: true,
                    windowMs: 60000, // 1 minute
                    maxRequests: 1000,
                    skipSuccessfulRequests: false,
                    skipFailedRequests: false,
                    ...config.strategies?.api
                },
                global: {
                    enabled: true,
                    windowMs: 60000, // 1 minute
                    maxRequests: 10000,
                    ...config.strategies?.global
                }
            },
            whitelist: {
                ips: config.whitelist?.ips || [],
                wallets: config.whitelist?.wallets || [],
                apiKeys: config.whitelist?.apiKeys || []
            },
            blacklist: {
                ips: config.whitelist?.ips || [],
                wallets: config.whitelist?.wallets || [],
                enabled: config.blacklist?.enabled || true,
                autoBlacklist: config.blacklist?.autoBlacklist || true,
                blacklistThreshold: config.blacklist?.blacklistThreshold || 1000,
                blacklistDuration: config.blacklist?.blacklistDuration || 24 * 60 * 60 * 1000 // 24 hours
            },
            adaptiveLimit: {
                enabled: config.adaptiveLimit?.enabled || true,
                factor: config.adaptiveLimit?.factor || 0.8,
                highLoadThreshold: config.adaptiveLimit?.highLoadThreshold || 0.8,
                recoveryFactor: config.adaptiveLimit?.recoveryFactor || 1.2
            },
            auditLogging: config.auditLogging !== false,
            clustering: config.clustering || false,
            ...config
        };

        this.redis = null;
        this.auditLogger = null;
        this.metrics = {
            totalRequests: 0,
            blockedRequests: 0,
            rateLimitHits: new Map(),
            adaptiveAdjustments: 0
        };

        this.initialize();
    }

    /**
     * Initialize rate limiter
     */
    async initialize() {
        try {
            await this._initializeRedis();
            await this._initializeAuditLogging();
            await this._loadBlacklists();
            await this._startMetricsCollection();
            
            console.log('Rate Limiter initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Rate Limiter:', error);
            throw error;
        }
    }

    /**
     * Initialize Redis connection
     */
    async _initializeRedis() {
        this.redis = Redis.createClient(this.config.redis);
        
        this.redis.on('error', (error) => {
            console.error('Redis connection error:', error);
        });

        this.redis.on('connect', () => {
            console.log('Connected to Redis for rate limiting');
        });

        await this.redis.connect();
    }

    /**
     * Main rate limiting function
     * @param {Object} request Request object with IP, wallet, API key, etc.
     * @returns {Object} Rate limit result
     */
    async checkRateLimit(request) {
        try {
            this.metrics.totalRequests++;

            const {
                ip,
                walletAddress,
                apiKey,
                endpoint,
                method,
                userAgent,
                timestamp = Date.now()
            } = request;

            // Check blacklists first
            const blacklistCheck = await this._checkBlacklists(ip, walletAddress, apiKey);
            if (blacklistCheck.blocked) {
                this.metrics.blockedRequests++;
                await this._auditLog('BLACKLIST_BLOCK', blacklistCheck);
                return {
                    allowed: false,
                    reason: 'blacklisted',
                    details: blacklistCheck,
                    retryAfter: null
                };
            }

            // Check whitelists
            const whitelistCheck = this._checkWhitelists(ip, walletAddress, apiKey);
            if (whitelistCheck.whitelisted) {
                await this._auditLog('WHITELIST_ALLOW', whitelistCheck);
                return {
                    allowed: true,
                    reason: 'whitelisted',
                    details: whitelistCheck
                };
            }

            // Perform rate limit checks
            const rateLimitResults = await Promise.all([
                this._checkIPRateLimit(ip, timestamp),
                this._checkWalletRateLimit(walletAddress, timestamp),
                this._checkAPIRateLimit(apiKey, timestamp),
                this._checkGlobalRateLimit(timestamp),
                this._checkEndpointRateLimit(endpoint, method, timestamp)
            ]);

            // Find the most restrictive limit
            const blocked = rateLimitResults.find(result => !result.allowed);
            
            if (blocked) {
                this.metrics.blockedRequests++;
                this.metrics.rateLimitHits.set(blocked.strategy, 
                    (this.metrics.rateLimitHits.get(blocked.strategy) || 0) + 1);

                // Check for auto-blacklisting
                if (this.config.blacklist.autoBlacklist) {
                    await this._checkAutoBlacklist(ip, walletAddress, blocked);
                }

                await this._auditLog('RATE_LIMIT_EXCEEDED', {
                    ...blocked,
                    ip,
                    walletAddress,
                    apiKey: apiKey ? this._hashApiKey(apiKey) : null,
                    endpoint,
                    method
                });

                return {
                    allowed: false,
                    reason: 'rate_limited',
                    strategy: blocked.strategy,
                    details: blocked,
                    retryAfter: blocked.retryAfter
                };
            }

            // All checks passed
            await this._auditLog('REQUEST_ALLOWED', {
                ip,
                walletAddress,
                endpoint,
                method,
                strategies: rateLimitResults.map(r => ({
                    strategy: r.strategy,
                    remaining: r.remaining
                }))
            });

            return {
                allowed: true,
                details: rateLimitResults,
                adaptive: await this._getAdaptiveStatus()
            };

        } catch (error) {
            console.error('Rate limiting check failed:', error);
            await this._auditLog('RATE_LIMIT_ERROR', { error: error.message });
            
            // Fail open for availability
            return {
                allowed: true,
                reason: 'error_fail_open',
                error: error.message
            };
        }
    }

    /**
     * Check IP-based rate limiting
     */
    async _checkIPRateLimit(ip, timestamp) {
        if (!this.config.strategies.ip.enabled || !ip) {
            return { allowed: true, strategy: 'ip', remaining: null };
        }

        const key = `${this.config.redis.keyPrefix}ip:${ip}`;
        const window = this.config.strategies.ip.windowMs;
        const maxRequests = await this._getAdaptiveLimit('ip');

        return await this._performRateLimit(key, window, maxRequests, 'ip', timestamp);
    }

    /**
     * Check wallet-based rate limiting
     */
    async _checkWalletRateLimit(walletAddress, timestamp) {
        if (!this.config.strategies.wallet.enabled || !walletAddress) {
            return { allowed: true, strategy: 'wallet', remaining: null };
        }

        const key = `${this.config.redis.keyPrefix}wallet:${walletAddress.toLowerCase()}`;
        const window = this.config.strategies.wallet.windowMs;
        const maxRequests = await this._getAdaptiveLimit('wallet');

        return await this._performRateLimit(key, window, maxRequests, 'wallet', timestamp);
    }

    /**
     * Check API key-based rate limiting
     */
    async _checkAPIRateLimit(apiKey, timestamp) {
        if (!this.config.strategies.api.enabled || !apiKey) {
            return { allowed: true, strategy: 'api', remaining: null };
        }

        const hashedKey = this._hashApiKey(apiKey);
        const key = `${this.config.redis.keyPrefix}api:${hashedKey}`;
        const window = this.config.strategies.api.windowMs;
        const maxRequests = await this._getAdaptiveLimit('api');

        return await this._performRateLimit(key, window, maxRequests, 'api', timestamp);
    }

    /**
     * Check global rate limiting
     */
    async _checkGlobalRateLimit(timestamp) {
        if (!this.config.strategies.global.enabled) {
            return { allowed: true, strategy: 'global', remaining: null };
        }

        const key = `${this.config.redis.keyPrefix}global`;
        const window = this.config.strategies.global.windowMs;
        const maxRequests = await this._getAdaptiveLimit('global');

        return await this._performRateLimit(key, window, maxRequests, 'global', timestamp);
    }

    /**
     * Check endpoint-specific rate limiting
     */
    async _checkEndpointRateLimit(endpoint, method, timestamp) {
        if (!endpoint) {
            return { allowed: true, strategy: 'endpoint', remaining: null };
        }

        // Define endpoint-specific limits
        const endpointLimits = {
            '/api/orders': { windowMs: 60000, maxRequests: 20 },
            '/api/signatures/verify': { windowMs: 60000, maxRequests: 100 },
            '/api/auth/login': { windowMs: 900000, maxRequests: 5 }, // 15 minutes, 5 attempts
            '/api/admin': { windowMs: 60000, maxRequests: 10 }
        };

        const endpointConfig = endpointLimits[endpoint];
        if (!endpointConfig) {
            return { allowed: true, strategy: 'endpoint', remaining: null };
        }

        const key = `${this.config.redis.keyPrefix}endpoint:${endpoint}:${method}`;
        
        return await this._performRateLimit(
            key, 
            endpointConfig.windowMs, 
            endpointConfig.maxRequests, 
            'endpoint', 
            timestamp
        );
    }

    /**
     * Perform sliding window rate limiting using Redis
     */
    async _performRateLimit(key, windowMs, maxRequests, strategy, timestamp) {
        const now = timestamp || Date.now();
        const windowStart = now - windowMs;

        // Use Redis transaction for atomic operations
        const multi = this.redis.multi();
        
        // Remove old entries
        multi.zremrangebyscore(key, '-inf', windowStart);
        
        // Count current requests in window
        multi.zcard(key);
        
        // Add current request
        multi.zadd(key, now, `${now}-${Math.random()}`);
        
        // Set expiration
        multi.expire(key, Math.ceil(windowMs / 1000));
        
        const results = await multi.exec();
        const currentCount = results[1][1]; // Get count result

        const allowed = currentCount < maxRequests;
        const remaining = Math.max(0, maxRequests - currentCount - 1);
        const retryAfter = allowed ? null : Math.ceil(windowMs / 1000);

        return {
            allowed,
            strategy,
            currentCount: currentCount + 1,
            maxRequests,
            remaining,
            retryAfter,
            windowMs,
            resetTime: now + windowMs
        };
    }

    /**
     * Check blacklists
     */
    async _checkBlacklists(ip, walletAddress, apiKey) {
        if (!this.config.blacklist.enabled) {
            return { blocked: false };
        }

        const checks = [];

        // Check IP blacklist
        if (ip) {
            const ipBlacklisted = await this.redis.sismember(
                `${this.config.redis.keyPrefix}blacklist:ips`, 
                ip
            );
            if (ipBlacklisted) {
                checks.push({ type: 'ip', value: ip, reason: 'blacklisted_ip' });
            }
        }

        // Check wallet blacklist
        if (walletAddress) {
            const walletBlacklisted = await this.redis.sismember(
                `${this.config.redis.keyPrefix}blacklist:wallets`, 
                walletAddress.toLowerCase()
            );
            if (walletBlacklisted) {
                checks.push({ type: 'wallet', value: walletAddress, reason: 'blacklisted_wallet' });
            }
        }

        // Check API key blacklist
        if (apiKey) {
            const hashedKey = this._hashApiKey(apiKey);
            const apiBlacklisted = await this.redis.sismember(
                `${this.config.redis.keyPrefix}blacklist:apis`, 
                hashedKey
            );
            if (apiBlacklisted) {
                checks.push({ type: 'api', value: hashedKey, reason: 'blacklisted_api' });
            }
        }

        return {
            blocked: checks.length > 0,
            reasons: checks
        };
    }

    /**
     * Check whitelists
     */
    _checkWhitelists(ip, walletAddress, apiKey) {
        const whitelisted = [];

        if (ip && this.config.whitelist.ips.includes(ip)) {
            whitelisted.push({ type: 'ip', value: ip });
        }

        if (walletAddress && this.config.whitelist.wallets.includes(walletAddress.toLowerCase())) {
            whitelisted.push({ type: 'wallet', value: walletAddress });
        }

        if (apiKey && this.config.whitelist.apiKeys.includes(apiKey)) {
            whitelisted.push({ type: 'api', value: this._hashApiKey(apiKey) });
        }

        return {
            whitelisted: whitelisted.length > 0,
            reasons: whitelisted
        };
    }

    /**
     * Check for auto-blacklisting based on repeated violations
     */
    async _checkAutoBlacklist(ip, walletAddress, rateLimitResult) {
        const violationKey = `${this.config.redis.keyPrefix}violations:${ip || walletAddress}`;
        const violations = await this.redis.incr(violationKey);
        await this.redis.expire(violationKey, 3600); // 1 hour window

        if (violations >= this.config.blacklist.blacklistThreshold) {
            if (ip) {
                await this.addToBlacklist('ip', ip, 'auto_blacklist', this.config.blacklist.blacklistDuration);
            }
            if (walletAddress) {
                await this.addToBlacklist('wallet', walletAddress, 'auto_blacklist', this.config.blacklist.blacklistDuration);
            }

            await this._auditLog('AUTO_BLACKLIST_TRIGGERED', {
                ip,
                walletAddress,
                violations,
                threshold: this.config.blacklist.blacklistThreshold
            });
        }
    }

    /**
     * Get adaptive rate limit based on system load
     */
    async _getAdaptiveLimit(strategy) {
        if (!this.config.adaptiveLimit.enabled) {
            return this.config.strategies[strategy].maxRequests;
        }

        const baseLimit = this.config.strategies[strategy].maxRequests;
        const loadFactor = await this._getSystemLoadFactor();

        if (loadFactor > this.config.adaptiveLimit.highLoadThreshold) {
            // Reduce limits during high load
            const adjustedLimit = Math.floor(baseLimit * this.config.adaptiveLimit.factor);
            this.metrics.adaptiveAdjustments++;
            return adjustedLimit;
        } else if (loadFactor < this.config.adaptiveLimit.highLoadThreshold * 0.5) {
            // Increase limits during low load
            const adjustedLimit = Math.floor(baseLimit * this.config.adaptiveLimit.recoveryFactor);
            return adjustedLimit;
        }

        return baseLimit;
    }

    /**
     * Get system load factor (simplified implementation)
     */
    async _getSystemLoadFactor() {
        try {
            // Get current request rate
            const currentLoad = this.metrics.totalRequests / (Date.now() / 1000 / 60); // requests per minute
            const maxCapacity = 10000; // configurable max capacity
            
            return Math.min(currentLoad / maxCapacity, 1.0);
        } catch (error) {
            return 0.5; // Default to medium load on error
        }
    }

    /**
     * Add to blacklist
     */
    async addToBlacklist(type, value, reason, duration = null) {
        const blacklistKey = `${this.config.redis.keyPrefix}blacklist:${type}s`;
        
        if (type === 'wallet') {
            value = value.toLowerCase();
        } else if (type === 'api') {
            value = this._hashApiKey(value);
        }

        await this.redis.sadd(blacklistKey, value);

        if (duration) {
            // Set automatic removal
            const removalKey = `${this.config.redis.keyPrefix}blacklist_removal:${type}:${value}`;
            await this.redis.setex(removalKey, Math.ceil(duration / 1000), '1');
            
            // Schedule removal (in production, use a proper job queue)
            setTimeout(async () => {
                await this.removeFromBlacklist(type, value);
            }, duration);
        }

        await this._auditLog('BLACKLIST_ADDED', { type, value, reason, duration });
    }

    /**
     * Remove from blacklist
     */
    async removeFromBlacklist(type, value) {
        const blacklistKey = `${this.config.redis.keyPrefix}blacklist:${type}s`;
        
        if (type === 'wallet') {
            value = value.toLowerCase();
        } else if (type === 'api') {
            value = this._hashApiKey(value);
        }

        await this.redis.srem(blacklistKey, value);
        await this._auditLog('BLACKLIST_REMOVED', { type, value });
    }

    /**
     * Get rate limit status for debugging
     */
    async getRateLimitStatus(ip, walletAddress, apiKey) {
        const statuses = {};

        if (ip) {
            const key = `${this.config.redis.keyPrefix}ip:${ip}`;
            const count = await this.redis.zcard(key);
            statuses.ip = {
                current: count,
                max: this.config.strategies.ip.maxRequests,
                remaining: Math.max(0, this.config.strategies.ip.maxRequests - count)
            };
        }

        if (walletAddress) {
            const key = `${this.config.redis.keyPrefix}wallet:${walletAddress.toLowerCase()}`;
            const count = await this.redis.zcard(key);
            statuses.wallet = {
                current: count,
                max: this.config.strategies.wallet.maxRequests,
                remaining: Math.max(0, this.config.strategies.wallet.maxRequests - count)
            };
        }

        if (apiKey) {
            const hashedKey = this._hashApiKey(apiKey);
            const key = `${this.config.redis.keyPrefix}api:${hashedKey}`;
            const count = await this.redis.zcard(key);
            statuses.api = {
                current: count,
                max: this.config.strategies.api.maxRequests,
                remaining: Math.max(0, this.config.strategies.api.maxRequests - count)
            };
        }

        return statuses;
    }

    /**
     * Get metrics and statistics
     */
    getMetrics() {
        const successRate = this.metrics.totalRequests > 0 
            ? (this.metrics.totalRequests - this.metrics.blockedRequests) / this.metrics.totalRequests 
            : 1;

        return {
            totalRequests: this.metrics.totalRequests,
            blockedRequests: this.metrics.blockedRequests,
            successRate,
            rateLimitHits: Object.fromEntries(this.metrics.rateLimitHits),
            adaptiveAdjustments: this.metrics.adaptiveAdjustments,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            totalRequests: 0,
            blockedRequests: 0,
            rateLimitHits: new Map(),
            adaptiveAdjustments: 0
        };
    }

    // ========== UTILITY FUNCTIONS ==========

    _hashApiKey(apiKey) {
        return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
    }

    async _getAdaptiveStatus() {
        if (!this.config.adaptiveLimit.enabled) return null;

        return {
            enabled: true,
            loadFactor: await this._getSystemLoadFactor(),
            adjustments: this.metrics.adaptiveAdjustments
        };
    }

    async _loadBlacklists() {
        // Load static blacklists from configuration
        for (const ip of this.config.blacklist.ips || []) {
            await this.addToBlacklist('ip', ip, 'static_config');
        }
        
        for (const wallet of this.config.blacklist.wallets || []) {
            await this.addToBlacklist('wallet', wallet, 'static_config');
        }
    }

    async _startMetricsCollection() {
        // Start periodic metrics collection
        setInterval(() => {
            // This could send metrics to monitoring systems
            const metrics = this.getMetrics();
            console.log('Rate Limiter Metrics:', metrics);
        }, 60000); // Every minute
    }

    async _initializeAuditLogging() {
        if (!this.config.auditLogging) return;

        const winston = require('winston');
        
        this.auditLogger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({
                    filename: '/var/log/swappiq/rate-limit-audit.log',
                    maxsize: 100 * 1024 * 1024,
                    maxFiles: 10
                })
            ]
        });
    }

    async _auditLog(action, details) {
        if (!this.auditLogger) return;

        this.auditLogger.info('RATE_LIMIT_AUDIT', {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'RateLimiter'
        });
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            if (this.redis) {
                await this.redis.quit();
            }
            console.log('Rate Limiter cleaned up successfully');
        } catch (error) {
            console.error('Error during Rate Limiter cleanup:', error);
        }
    }
}

module.exports = { RateLimiter };

/**
 * Usage Example:
 * 
 * const rateLimiter = new RateLimiter({
 *     redis: {
 *         host: 'localhost',
 *         port: 6379,
 *         password: 'redis-password'
 *     },
 *     strategies: {
 *         ip: { windowMs: 60000, maxRequests: 100 },
 *         wallet: { windowMs: 60000, maxRequests: 50 },
 *         api: { windowMs: 60000, maxRequests: 1000 }
 *     },
 *     whitelist: {
 *         ips: ['127.0.0.1', '::1'],
 *         wallets: ['0x742d35Cc6642C4532a6c70E42c0a6a1b23B35a52']
 *     },
 *     blacklist: {
 *         autoBlacklist: true,
 *         blacklistThreshold: 100
 *     }
 * });
 * 
 * // Check rate limit
 * const result = await rateLimiter.checkRateLimit({
 *     ip: req.ip,
 *     walletAddress: req.body.walletAddress,
 *     apiKey: req.headers['x-api-key'],
 *     endpoint: req.path,
 *     method: req.method
 * });
 * 
 * if (!result.allowed) {
 *     return res.status(429).json({
 *         error: 'Rate limit exceeded',
 *         retryAfter: result.retryAfter
 *     });
 * }
 */