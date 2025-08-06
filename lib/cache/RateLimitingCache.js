/**
 * @fileoverview Advanced Rate Limiting Cache for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description High-performance rate limiting with multiple algorithms, distributed counters, and adaptive thresholds
 */

const crypto = require('crypto');

/**
 * Rate Limiting Cache Manager
 * Supports multiple rate limiting algorithms, distributed counters, and adaptive rate limiting
 */
class RateLimitingCache {
    constructor(redis, config) {
        this.redis = redis;
        this.config = {
            windowSize: config.windowSize || 60, // 1 minute default
            maxRequests: config.maxRequests || 100,
            slidingWindow: config.slidingWindow !== false,
            algorithm: config.algorithm || 'sliding_window_log', // 'fixed_window', 'sliding_window_log', 'sliding_window_counter', 'token_bucket', 'leaky_bucket'
            burstAllowance: config.burstAllowance || 1.5, // 150% of normal rate for bursts
            adaptiveRateLimit: config.adaptiveRateLimit || false,
            distributedMode: config.distributedMode !== false,
            blacklistEnabled: config.blacklistEnabled !== false,
            whitelistEnabled: config.whitelistEnabled || false,
            geoBasedLimits: config.geoBasedLimits || false,
            userTierLimits: config.userTierLimits || {},
            ipBasedLimits: config.ipBasedLimits || {},
            ...config
        };

        this.state = {
            stats: {
                totalRequests: 0,
                allowedRequests: 0,
                deniedRequests: 0,
                blacklistedRequests: 0,
                adaptiveAdjustments: 0,
                avgResponseTime: 0
            },
            adaptiveThresholds: new Map(),
            blacklistedIPs: new Set(),
            whitelistedIPs: new Set(),
            userTiers: new Map()
        };

        // Rate limiting algorithms
        this.algorithms = {
            fixed_window: this._fixedWindowRateLimit.bind(this),
            sliding_window_log: this._slidingWindowLogRateLimit.bind(this),
            sliding_window_counter: this._slidingWindowCounterRateLimit.bind(this),
            token_bucket: this._tokenBucketRateLimit.bind(this),
            leaky_bucket: this._leakyBucketRateLimit.bind(this)
        };

        // Lua scripts for atomic operations
        this.luaScripts = {};
    }

    /**
     * Initialize rate limiting cache
     */
    async initialize() {
        try {
            await this._loadLuaScripts();
            await this._loadBlackWhiteLists();
            await this._startAdaptiveMonitoring();
            console.log('Rate Limiting Cache initialized');
        } catch (error) {
            console.error('Failed to initialize Rate Limiting Cache:', error);
            throw error;
        }
    }

    /**
     * Load Lua scripts for atomic rate limiting operations
     */
    async _loadLuaScripts() {
        // Sliding window log rate limiting
        this.luaScripts.slidingWindowLog = await this.redis.defineCommand('slidingWindowLog', {
            numberOfKeys: 1,
            lua: `
                local key = KEYS[1]
                local window = tonumber(ARGV[1])
                local limit = tonumber(ARGV[2])
                local now = tonumber(ARGV[3])
                local ttl = tonumber(ARGV[4])
                local identifier = ARGV[5]
                
                -- Remove expired entries
                redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window * 1000)
                
                -- Count current requests
                local current = redis.call('ZCARD', key)
                
                if current < limit then
                    -- Add current request
                    redis.call('ZADD', key, now, identifier)
                    redis.call('EXPIRE', key, ttl)
                    return {true, limit - current - 1, limit}
                else
                    -- Rate limit exceeded
                    return {false, 0, limit}
                end
            `
        });

        // Sliding window counter rate limiting
        this.luaScripts.slidingWindowCounter = await this.redis.defineCommand('slidingWindowCounter', {
            numberOfKeys: 2,
            lua: `
                local currentKey = KEYS[1]
                local previousKey = KEYS[2]
                local window = tonumber(ARGV[1])
                local limit = tonumber(ARGV[2])
                local now = tonumber(ARGV[3])
                local ttl = tonumber(ARGV[4])
                
                -- Get current and previous window counts
                local current = tonumber(redis.call('GET', currentKey) or '0')
                local previous = tonumber(redis.call('GET', previousKey) or '0')
                
                -- Calculate sliding window count
                local currentWindowStart = math.floor(now / (window * 1000)) * (window * 1000)
                local timeIntoWindow = now - currentWindowStart
                local weightedPrevious = previous * (1 - timeIntoWindow / (window * 1000))
                local slidingCount = current + weightedPrevious
                
                if slidingCount < limit then
                    -- Increment current window counter
                    redis.call('INCR', currentKey)
                    redis.call('EXPIRE', currentKey, ttl)
                    return {true, math.floor(limit - slidingCount - 1), limit}
                else
                    return {false, 0, limit}
                end
            `
        });

        // Token bucket rate limiting
        this.luaScripts.tokenBucket = await this.redis.defineCommand('tokenBucket', {
            numberOfKeys: 1,
            lua: `
                local key = KEYS[1]
                local capacity = tonumber(ARGV[1])
                local refillRate = tonumber(ARGV[2])
                local requested = tonumber(ARGV[3])
                local now = tonumber(ARGV[4])
                local ttl = tonumber(ARGV[5])
                
                -- Get current bucket state
                local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
                local tokens = tonumber(bucket[1]) or capacity
                local lastRefill = tonumber(bucket[2]) or now
                
                -- Calculate tokens to add based on time elapsed
                local timeDiff = math.max(0, now - lastRefill)
                local tokensToAdd = math.floor(timeDiff * refillRate / 1000)
                tokens = math.min(capacity, tokens + tokensToAdd)
                
                if tokens >= requested then
                    -- Consume tokens
                    tokens = tokens - requested
                    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
                    redis.call('EXPIRE', key, ttl)
                    return {true, tokens, capacity}
                else
                    -- Update bucket state without consuming tokens
                    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
                    redis.call('EXPIRE', key, ttl)
                    return {false, tokens, capacity}
                end
            `
        });

        // Leaky bucket rate limiting
        this.luaScripts.leakyBucket = await this.redis.defineCommand('leakyBucket', {
            numberOfKeys: 1,
            lua: `
                local key = KEYS[1]
                local capacity = tonumber(ARGV[1])
                local leakRate = tonumber(ARGV[2])
                local requested = tonumber(ARGV[3])
                local now = tonumber(ARGV[4])
                local ttl = tonumber(ARGV[5])
                
                -- Get current bucket state
                local bucket = redis.call('HMGET', key, 'volume', 'lastLeak')
                local volume = tonumber(bucket[1]) or 0
                local lastLeak = tonumber(bucket[2]) or now
                
                -- Calculate leaked volume
                local timeDiff = math.max(0, now - lastLeak)
                local leaked = math.floor(timeDiff * leakRate / 1000)
                volume = math.max(0, volume - leaked)
                
                if volume + requested <= capacity then
                    -- Add to bucket
                    volume = volume + requested
                    redis.call('HMSET', key, 'volume', volume, 'lastLeak', now)
                    redis.call('EXPIRE', key, ttl)
                    return {true, capacity - volume, capacity}
                else
                    -- Update bucket state
                    redis.call('HMSET', key, 'volume', volume, 'lastLeak', now)
                    redis.call('EXPIRE', key, ttl)
                    return {false, capacity - volume, capacity}
                end
            `
        });
    }

    /**
     * Check rate limit for a request
     */
    async checkRateLimit(identifier, options = {}) {
        const startTime = Date.now();
        
        try {
            // Extract options
            const {
                algorithm = this.config.algorithm,
                windowSize = this.config.windowSize,
                maxRequests = this.config.maxRequests,
                userTier = 'default',
                ipAddress = null,
                userAgent = null,
                endpoint = null
            } = options;

            // Pre-checks
            const preCheck = await this._performPreChecks(identifier, ipAddress, userAgent);
            if (!preCheck.allowed) {
                this.state.stats.deniedRequests++;
                if (preCheck.reason === 'blacklisted') {
                    this.state.stats.blacklistedRequests++;
                }
                return preCheck;
            }

            // Get effective limits based on user tier and IP
            const effectiveLimits = this._getEffectiveLimits(userTier, ipAddress, endpoint);
            const finalMaxRequests = effectiveLimits.maxRequests || maxRequests;
            const finalWindowSize = effectiveLimits.windowSize || windowSize;

            // Apply rate limiting algorithm
            const algorithmFunc = this.algorithms[algorithm];
            if (!algorithmFunc) {
                throw new Error(`Unknown rate limiting algorithm: ${algorithm}`);
            }

            const result = await algorithmFunc(
                identifier,
                finalWindowSize,
                finalMaxRequests,
                options
            );

            // Update statistics
            this.state.stats.totalRequests++;
            if (result.allowed) {
                this.state.stats.allowedRequests++;
            } else {
                this.state.stats.deniedRequests++;
            }

            // Adaptive rate limiting adjustment
            if (this.config.adaptiveRateLimit) {
                await this._adjustAdaptiveThresholds(identifier, result.allowed, options);
            }

            // Log rate limiting events
            await this._logRateLimitEvent(identifier, result, options);

            this._updateStats('check', Date.now() - startTime);
            return result;

        } catch (error) {
            console.error('Rate limit check error:', error);
            // Fail open - allow request if rate limiting fails
            return {
                allowed: true,
                reason: 'rate_limit_error',
                remaining: 0,
                resetTime: Date.now() + (this.config.windowSize * 1000)
            };
        }
    }

    /**
     * Sliding window log rate limiting
     */
    async _slidingWindowLogRateLimit(identifier, windowSize, maxRequests, options) {
        const key = this._getRateLimitKey(identifier, 'swl');
        const now = Date.now();
        const requestId = `${now}_${crypto.randomBytes(4).toString('hex')}`;

        const result = await this.redis.slidingWindowLog(
            key,
            windowSize,
            maxRequests,
            now,
            windowSize * 2, // TTL
            requestId
        );

        return {
            allowed: result[0],
            remaining: result[1],
            resetTime: now + (windowSize * 1000),
            algorithm: 'sliding_window_log',
            identifier,
            limit: result[2]
        };
    }

    /**
     * Sliding window counter rate limiting
     */
    async _slidingWindowCounterRateLimit(identifier, windowSize, maxRequests, options) {
        const now = Date.now();
        const currentWindow = Math.floor(now / (windowSize * 1000));
        const previousWindow = currentWindow - 1;

        const currentKey = this._getRateLimitKey(identifier, `swc_${currentWindow}`);
        const previousKey = this._getRateLimitKey(identifier, `swc_${previousWindow}`);

        const result = await this.redis.slidingWindowCounter(
            currentKey,
            previousKey,
            windowSize,
            maxRequests,
            now,
            windowSize * 2 // TTL
        );

        return {
            allowed: result[0],
            remaining: result[1],
            resetTime: (currentWindow + 1) * windowSize * 1000,
            algorithm: 'sliding_window_counter',
            identifier,
            limit: result[2]
        };
    }

    /**
     * Token bucket rate limiting
     */
    async _tokenBucketRateLimit(identifier, windowSize, maxRequests, options) {
        const key = this._getRateLimitKey(identifier, 'tb');
        const capacity = maxRequests;
        const refillRate = maxRequests / windowSize; // tokens per second
        const requested = options.tokens || 1;
        const now = Date.now();

        const result = await this.redis.tokenBucket(
            key,
            capacity,
            refillRate,
            requested,
            now,
            windowSize * 2 // TTL
        );

        return {
            allowed: result[0],
            remaining: result[1],
            resetTime: now + Math.ceil((requested - result[1]) / refillRate * 1000),
            algorithm: 'token_bucket',
            identifier,
            limit: result[2],
            tokensConsumed: requested
        };
    }

    /**
     * Leaky bucket rate limiting
     */
    async _leakyBucketRateLimit(identifier, windowSize, maxRequests, options) {
        const key = this._getRateLimitKey(identifier, 'lb');
        const capacity = maxRequests;
        const leakRate = maxRequests / windowSize; // items per second
        const requested = options.items || 1;
        const now = Date.now();

        const result = await this.redis.leakyBucket(
            key,
            capacity,
            leakRate,
            requested,
            now,
            windowSize * 2 // TTL
        );

        return {
            allowed: result[0],
            remaining: result[1],
            resetTime: now + Math.ceil((capacity - result[1]) / leakRate * 1000),
            algorithm: 'leaky_bucket',
            identifier,
            limit: result[2]
        };
    }

    /**
     * Fixed window rate limiting
     */
    async _fixedWindowRateLimit(identifier, windowSize, maxRequests, options) {
        const now = Date.now();
        const window = Math.floor(now / (windowSize * 1000));
        const key = this._getRateLimitKey(identifier, `fw_${window}`);

        const current = await this.redis.incr(key);
        if (current === 1) {
            await this.redis.expire(key, windowSize);
        }

        return {
            allowed: current <= maxRequests,
            remaining: Math.max(0, maxRequests - current),
            resetTime: (window + 1) * windowSize * 1000,
            algorithm: 'fixed_window',
            identifier,
            limit: maxRequests,
            current
        };
    }

    /**
     * Add IP to blacklist
     */
    async addToBlacklist(ipAddress, reason = 'manual', ttl = 3600) {
        try {
            const blacklistKey = this._getBlacklistKey();
            const entry = {
                ipAddress,
                reason,
                addedAt: Date.now(),
                ttl
            };

            await this.redis.hset(blacklistKey, ipAddress, JSON.stringify(entry));
            await this.redis.expire(blacklistKey, ttl);
            
            this.state.blacklistedIPs.add(ipAddress);
            
            return { success: true, entry };
        } catch (error) {
            console.error('Add to blacklist error:', error);
            throw error;
        }
    }

    /**
     * Remove IP from blacklist
     */
    async removeFromBlacklist(ipAddress) {
        try {
            const blacklistKey = this._getBlacklistKey();
            await this.redis.hdel(blacklistKey, ipAddress);
            
            this.state.blacklistedIPs.delete(ipAddress);
            
            return { success: true };
        } catch (error) {
            console.error('Remove from blacklist error:', error);
            throw error;
        }
    }

    /**
     * Add IP to whitelist
     */
    async addToWhitelist(ipAddress, reason = 'manual') {
        try {
            const whitelistKey = this._getWhitelistKey();
            const entry = {
                ipAddress,
                reason,
                addedAt: Date.now()
            };

            await this.redis.hset(whitelistKey, ipAddress, JSON.stringify(entry));
            this.state.whitelistedIPs.add(ipAddress);
            
            return { success: true, entry };
        } catch (error) {
            console.error('Add to whitelist error:', error);
            throw error;
        }
    }

    /**
     * Set user tier limits
     */
    async setUserTier(userId, tier, limits) {
        try {
            const tierKey = this._getUserTierKey(userId);
            const tierData = {
                tier,
                limits,
                setAt: Date.now()
            };

            await this.redis.setex(tierKey, 86400, JSON.stringify(tierData)); // 24 hours TTL
            this.state.userTiers.set(userId, tierData);
            
            return { success: true, tierData };
        } catch (error) {
            console.error('Set user tier error:', error);
            throw error;
        }
    }

    /**
     * Get rate limiting statistics for identifier
     */
    async getRateLimitInfo(identifier, algorithm = this.config.algorithm) {
        try {
            const info = {
                identifier,
                algorithm,
                timestamp: Date.now()
            };

            switch (algorithm) {
                case 'sliding_window_log':
                    const swlKey = this._getRateLimitKey(identifier, 'swl');
                    const entries = await this.redis.zcard(swlKey);
                    info.currentRequests = entries;
                    break;

                case 'token_bucket':
                    const tbKey = this._getRateLimitKey(identifier, 'tb');
                    const bucket = await this.redis.hmget(tbKey, 'tokens', 'lastRefill');
                    info.availableTokens = parseInt(bucket[0]) || 0;
                    info.lastRefill = parseInt(bucket[1]) || 0;
                    break;

                case 'leaky_bucket':
                    const lbKey = this._getRateLimitKey(identifier, 'lb');
                    const leakyBucket = await this.redis.hmget(lbKey, 'volume', 'lastLeak');
                    info.currentVolume = parseInt(leakyBucket[0]) || 0;
                    info.lastLeak = parseInt(leakyBucket[1]) || 0;
                    break;

                default:
                    info.message = 'Rate limit info not available for this algorithm';
            }

            return info;
        } catch (error) {
            console.error('Get rate limit info error:', error);
            throw error;
        }
    }

    /**
     * Reset rate limit for identifier
     */
    async resetRateLimit(identifier, algorithm = null) {
        try {
            const algorithms = algorithm ? [algorithm] : Object.keys(this.algorithms);
            let deletedKeys = 0;

            for (const algo of algorithms) {
                const pattern = this._getRateLimitKey(identifier, `${algo}*`);
                const keys = await this.redis.keys(pattern);
                
                if (keys.length > 0) {
                    await this.redis.del(...keys);
                    deletedKeys += keys.length;
                }
            }

            return { success: true, deletedKeys };
        } catch (error) {
            console.error('Reset rate limit error:', error);
            throw error;
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            ...this.state.stats,
            blacklistedIPs: this.state.blacklistedIPs.size,
            whitelistedIPs: this.state.whitelistedIPs.size,
            userTiers: this.state.userTiers.size,
            config: {
                algorithm: this.config.algorithm,
                windowSize: this.config.windowSize,
                maxRequests: this.config.maxRequests,
                adaptiveRateLimit: this.config.adaptiveRateLimit
            }
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const testKey = this._getRateLimitKey('health_check', 'test');
            await this.redis.setex(testKey, 10, '1');
            const retrieved = await this.redis.get(testKey);
            await this.redis.del(testKey);

            return {
                status: 'healthy',
                canWrite: !!retrieved,
                scriptsLoaded: Object.keys(this.luaScripts).length
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    // ========== PRIVATE METHODS ==========

    /**
     * Perform pre-checks (blacklist, whitelist)
     */
    async _performPreChecks(identifier, ipAddress, userAgent) {
        // Whitelist check (if enabled)
        if (this.config.whitelistEnabled && ipAddress) {
            if (this.state.whitelistedIPs.has(ipAddress)) {
                return { allowed: true, reason: 'whitelisted' };
            }
        }

        // Blacklist check (if enabled)
        if (this.config.blacklistEnabled && ipAddress) {
            if (this.state.blacklistedIPs.has(ipAddress)) {
                return { allowed: false, reason: 'blacklisted' };
            }
        }

        return { allowed: true };
    }

    /**
     * Get effective rate limits based on user tier and IP
     */
    _getEffectiveLimits(userTier, ipAddress, endpoint) {
        let limits = {};

        // User tier limits
        if (this.config.userTierLimits[userTier]) {
            limits = { ...this.config.userTierLimits[userTier] };
        }

        // IP-based limits
        if (ipAddress && this.config.ipBasedLimits[ipAddress]) {
            limits = { ...limits, ...this.config.ipBasedLimits[ipAddress] };
        }

        // Endpoint-specific limits
        if (endpoint && this.config.endpointLimits && this.config.endpointLimits[endpoint]) {
            limits = { ...limits, ...this.config.endpointLimits[endpoint] };
        }

        return limits;
    }

    /**
     * Adjust adaptive thresholds based on system load
     */
    async _adjustAdaptiveThresholds(identifier, allowed, options) {
        // Implementation for adaptive rate limiting
        // This would monitor system performance and adjust thresholds dynamically
        this.state.stats.adaptiveAdjustments++;
    }

    /**
     * Log rate limiting events
     */
    async _logRateLimitEvent(identifier, result, options) {
        if (!result.allowed) {
            const logKey = this._getRateLimitLogKey();
            const logEntry = {
                identifier,
                result,
                options,
                timestamp: Date.now()
            };

            await this.redis.lpush(logKey, JSON.stringify(logEntry));
            await this.redis.ltrim(logKey, 0, 999); // Keep last 1000 entries
            await this.redis.expire(logKey, 3600); // 1 hour TTL
        }
    }

    /**
     * Load blacklist and whitelist from Redis
     */
    async _loadBlackWhiteLists() {
        try {
            // Load blacklist
            if (this.config.blacklistEnabled) {
                const blacklistKey = this._getBlacklistKey();
                const blacklist = await this.redis.hgetall(blacklistKey);
                
                for (const ip of Object.keys(blacklist)) {
                    this.state.blacklistedIPs.add(ip);
                }
            }

            // Load whitelist
            if (this.config.whitelistEnabled) {
                const whitelistKey = this._getWhitelistKey();
                const whitelist = await this.redis.hgetall(whitelistKey);
                
                for (const ip of Object.keys(whitelist)) {
                    this.state.whitelistedIPs.add(ip);
                }
            }
        } catch (error) {
            console.error('Load black/white lists error:', error);
        }
    }

    /**
     * Start adaptive monitoring
     */
    async _startAdaptiveMonitoring() {
        if (this.config.adaptiveRateLimit) {
            setInterval(async () => {
                try {
                    await this._performAdaptiveAdjustments();
                } catch (error) {
                    console.error('Adaptive monitoring error:', error);
                }
            }, 60000); // Every minute
        }
    }

    /**
     * Perform adaptive adjustments
     */
    async _performAdaptiveAdjustments() {
        // Implementation for adaptive rate limiting adjustments
        // This would analyze system metrics and adjust rate limits accordingly
    }

    /**
     * Update performance statistics
     */
    _updateStats(operation, responseTime) {
        this.state.stats.avgResponseTime = 
            (this.state.stats.avgResponseTime * this.state.stats.totalRequests + responseTime) / 
            (this.state.stats.totalRequests + 1);
    }

    /**
     * Generate cache keys
     */
    _getRateLimitKey(identifier, algorithm) {
        return `ratelimit:${algorithm}:${identifier}`;
    }

    _getBlacklistKey() {
        return 'ratelimit:blacklist';
    }

    _getWhitelistKey() {
        return 'ratelimit:whitelist';
    }

    _getUserTierKey(userId) {
        return `ratelimit:tier:${userId}`;
    }

    _getRateLimitLogKey() {
        return 'ratelimit:log';
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        console.log('Rate Limiting Cache cleanup completed');
    }
}

module.exports = { RateLimitingCache };