/**
 * @fileoverview Redis-based Session Management for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Distributed session management with Redis for scalability
 */

const EventEmitter = require('events');
const Redis = require('ioredis');
const crypto = require('crypto');

/**
 * Redis Session Manager
 * Manages distributed sessions with Redis backend
 */
class RedisSessionManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Redis configuration
            redis: {
                host: config.redis?.host || 'localhost',
                port: config.redis?.port || 6379,
                password: config.redis?.password,
                db: config.redis?.db || 0,
                keyPrefix: config.redis?.keyPrefix || 'swappiq:session:',
                enableOfflineQueue: config.redis?.enableOfflineQueue !== false,
                maxRetriesPerRequest: config.redis?.maxRetriesPerRequest || 3,
                retryStrategy: config.redis?.retryStrategy || ((times) => Math.min(times * 50, 2000)),
                
                // Cluster configuration
                cluster: config.redis?.cluster || null,
                sentinels: config.redis?.sentinels || null,
                
                // Connection pool
                connectionPool: {
                    min: config.redis?.connectionPool?.min || 2,
                    max: config.redis?.connectionPool?.max || 10
                }
            },
            
            // Session configuration
            session: {
                ttl: config.session?.ttl || 86400, // 24 hours in seconds
                maxSessions: config.session?.maxSessions || 5,
                sliding: config.session?.sliding !== false, // Sliding expiration
                secure: config.session?.secure !== false,
                sameSite: config.session?.sameSite || 'strict',
                httpOnly: config.session?.httpOnly !== false,
                cookieName: config.session?.cookieName || 'swappiq_session',
                
                // Session data limits
                maxDataSize: config.session?.maxDataSize || 65536, // 64KB
                compressData: config.session?.compressData || false
            },
            
            // Security configuration
            security: {
                encryption: {
                    enabled: config.security?.encryption?.enabled !== false,
                    algorithm: config.security?.encryption?.algorithm || 'aes-256-gcm',
                    keyRotation: config.security?.encryption?.keyRotation !== false,
                    keyRotationInterval: config.security?.encryption?.keyRotationInterval || 86400000 // 24 hours
                },
                
                sessionFixation: {
                    preventFixation: config.security?.sessionFixation?.preventFixation !== false,
                    regenerateOnLogin: config.security?.sessionFixation?.regenerateOnLogin !== false
                },
                
                rateLimiting: {
                    enabled: config.security?.rateLimiting?.enabled !== false,
                    maxRequests: config.security?.rateLimiting?.maxRequests || 100,
                    windowMs: config.security?.rateLimiting?.windowMs || 60000 // 1 minute
                },
                
                ipValidation: config.security?.ipValidation !== false,
                userAgentValidation: config.security?.userAgentValidation !== false
            },
            
            // Performance configuration
            performance: {
                caching: {
                    enabled: config.performance?.caching?.enabled !== false,
                    localCacheTTL: config.performance?.caching?.localCacheTTL || 300, // 5 minutes
                    maxCacheSize: config.performance?.caching?.maxCacheSize || 1000
                },
                
                batching: {
                    enabled: config.performance?.batching?.enabled || false,
                    batchSize: config.performance?.batching?.batchSize || 100,
                    batchInterval: config.performance?.batching?.batchInterval || 100 // ms
                },
                
                pipelining: config.performance?.pipelining !== false
            },
            
            // Monitoring configuration
            monitoring: {
                enabled: config.monitoring?.enabled !== false,
                metricsInterval: config.monitoring?.metricsInterval || 60000, // 1 minute
                healthCheckInterval: config.monitoring?.healthCheckInterval || 30000 // 30 seconds
            },
            
            auditLogging: config.auditLogging !== false,
            ...config
        };

        this.state = {
            connected: false,
            redis: null,
            redisSub: null,
            localCache: new Map(),
            encryptionKeys: new Map(),
            currentEncryptionKey: null,
            
            metrics: {
                sessionsCreated: 0,
                sessionsDestroyed: 0,
                sessionHits: 0,
                sessionMisses: 0,
                cacheHits: 0,
                cacheMisses: 0,
                averageLatency: 0,
                errors: 0
            },
            
            rateLimitMap: new Map()
        };

        this.healthCheckTimer = null;
        this.metricsTimer = null;
        this.keyRotationTimer = null;
        this.cacheCleanupTimer = null;
        
        this.initialize();
    }

    /**
     * Initialize Redis session manager
     */
    async initialize() {
        try {
            await this._initializeRedis();
            await this._initializeEncryption();
            await this._startMonitoring();
            await this._loadExistingSessions();
            
            console.log('Redis Session Manager initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Redis Session Manager:', error);
            throw error;
        }
    }

    /**
     * Create a new session
     */
    async createSession(userId, data = {}, options = {}) {
        try {
            const startTime = Date.now();
            
            // Check rate limiting
            if (this.config.security.rateLimiting.enabled) {
                this._checkRateLimit(userId);
            }

            // Generate session ID
            const sessionId = this._generateSessionId();
            
            // Prepare session data
            const sessionData = {
                id: sessionId,
                userId,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                expiresAt: Date.now() + (this.config.session.ttl * 1000),
                data: this._validateSessionData(data),
                metadata: {
                    ip: options.ip,
                    userAgent: options.userAgent,
                    ...options.metadata
                }
            };

            // Check session limits
            await this._checkSessionLimits(userId);

            // Encrypt session data if enabled
            const storedData = this.config.security.encryption.enabled
                ? await this._encryptSessionData(sessionData)
                : JSON.stringify(sessionData);

            // Store in Redis
            const key = this._getSessionKey(sessionId);
            const pipeline = this.state.redis.pipeline();
            
            pipeline.set(key, storedData);
            pipeline.expire(key, this.config.session.ttl);
            
            // Add to user's session index
            const userKey = this._getUserSessionsKey(userId);
            pipeline.sadd(userKey, sessionId);
            pipeline.expire(userKey, this.config.session.ttl);
            
            await pipeline.exec();

            // Update local cache
            if (this.config.performance.caching.enabled) {
                this._updateLocalCache(sessionId, sessionData);
            }

            // Update metrics
            this.state.metrics.sessionsCreated++;
            const latency = Date.now() - startTime;
            this._updateLatencyMetric(latency);

            await this._auditLog('SESSION_CREATED', {
                sessionId,
                userId,
                latency
            });

            this.emit('sessionCreated', {
                sessionId,
                userId
            });

            return {
                sessionId,
                expiresAt: sessionData.expiresAt,
                cookie: this._generateCookie(sessionId)
            };

        } catch (error) {
            this.state.metrics.errors++;
            console.error('Failed to create session:', error);
            throw error;
        }
    }

    /**
     * Get session data
     */
    async getSession(sessionId) {
        try {
            const startTime = Date.now();
            
            // Check local cache first
            if (this.config.performance.caching.enabled) {
                const cached = this._getFromLocalCache(sessionId);
                if (cached) {
                    this.state.metrics.cacheHits++;
                    return cached;
                }
                this.state.metrics.cacheMisses++;
            }

            // Get from Redis
            const key = this._getSessionKey(sessionId);
            const storedData = await this.state.redis.get(key);
            
            if (!storedData) {
                this.state.metrics.sessionMisses++;
                return null;
            }

            // Decrypt if needed
            const sessionData = this.config.security.encryption.enabled
                ? await this._decryptSessionData(storedData)
                : JSON.parse(storedData);

            // Validate session
            if (!this._validateSession(sessionData)) {
                await this.destroySession(sessionId);
                return null;
            }

            // Update activity and extend TTL if sliding expiration
            if (this.config.session.sliding) {
                await this._updateSessionActivity(sessionId, sessionData);
            }

            // Update cache
            if (this.config.performance.caching.enabled) {
                this._updateLocalCache(sessionId, sessionData);
            }

            // Update metrics
            this.state.metrics.sessionHits++;
            const latency = Date.now() - startTime;
            this._updateLatencyMetric(latency);

            return sessionData;

        } catch (error) {
            this.state.metrics.errors++;
            console.error('Failed to get session:', error);
            throw error;
        }
    }

    /**
     * Update session data
     */
    async updateSession(sessionId, updates) {
        try {
            const session = await this.getSession(sessionId);
            
            if (!session) {
                throw new Error('Session not found');
            }

            // Merge updates
            const updatedData = {
                ...session.data,
                ...updates
            };

            // Validate data size
            this._validateSessionData(updatedData);

            // Update session
            session.data = updatedData;
            session.lastActivity = Date.now();

            // Encrypt and store
            const storedData = this.config.security.encryption.enabled
                ? await this._encryptSessionData(session)
                : JSON.stringify(session);

            const key = this._getSessionKey(sessionId);
            await this.state.redis.set(key, storedData);

            // Extend TTL if sliding
            if (this.config.session.sliding) {
                await this.state.redis.expire(key, this.config.session.ttl);
            }

            // Update cache
            if (this.config.performance.caching.enabled) {
                this._updateLocalCache(sessionId, session);
            }

            await this._auditLog('SESSION_UPDATED', {
                sessionId,
                userId: session.userId
            });

            return session;

        } catch (error) {
            this.state.metrics.errors++;
            console.error('Failed to update session:', error);
            throw error;
        }
    }

    /**
     * Destroy a session
     */
    async destroySession(sessionId) {
        try {
            // Get session for user ID
            const session = await this.getSession(sessionId);
            
            if (!session) {
                return false;
            }

            const pipeline = this.state.redis.pipeline();
            
            // Delete session
            const key = this._getSessionKey(sessionId);
            pipeline.del(key);
            
            // Remove from user's session index
            const userKey = this._getUserSessionsKey(session.userId);
            pipeline.srem(userKey, sessionId);
            
            await pipeline.exec();

            // Remove from cache
            if (this.config.performance.caching.enabled) {
                this.state.localCache.delete(sessionId);
            }

            // Update metrics
            this.state.metrics.sessionsDestroyed++;

            await this._auditLog('SESSION_DESTROYED', {
                sessionId,
                userId: session.userId
            });

            this.emit('sessionDestroyed', {
                sessionId,
                userId: session.userId
            });

            return true;

        } catch (error) {
            this.state.metrics.errors++;
            console.error('Failed to destroy session:', error);
            throw error;
        }
    }

    /**
     * Destroy all sessions for a user
     */
    async destroyUserSessions(userId) {
        try {
            const userKey = this._getUserSessionsKey(userId);
            const sessionIds = await this.state.redis.smembers(userKey);
            
            if (sessionIds.length === 0) {
                return 0;
            }

            const pipeline = this.state.redis.pipeline();
            
            // Delete all sessions
            for (const sessionId of sessionIds) {
                const key = this._getSessionKey(sessionId);
                pipeline.del(key);
                
                // Remove from cache
                if (this.config.performance.caching.enabled) {
                    this.state.localCache.delete(sessionId);
                }
            }
            
            // Delete user's session index
            pipeline.del(userKey);
            
            await pipeline.exec();

            await this._auditLog('USER_SESSIONS_DESTROYED', {
                userId,
                count: sessionIds.length
            });

            return sessionIds.length;

        } catch (error) {
            this.state.metrics.errors++;
            console.error('Failed to destroy user sessions:', error);
            throw error;
        }
    }

    /**
     * Get all sessions for a user
     */
    async getUserSessions(userId) {
        try {
            const userKey = this._getUserSessionsKey(userId);
            const sessionIds = await this.state.redis.smembers(userKey);
            
            const sessions = [];
            
            for (const sessionId of sessionIds) {
                const session = await this.getSession(sessionId);
                if (session) {
                    sessions.push({
                        id: sessionId,
                        createdAt: session.createdAt,
                        lastActivity: session.lastActivity,
                        expiresAt: session.expiresAt,
                        metadata: session.metadata
                    });
                }
            }

            return sessions;

        } catch (error) {
            console.error('Failed to get user sessions:', error);
            throw error;
        }
    }

    /**
     * Regenerate session ID (for security)
     */
    async regenerateSessionId(oldSessionId) {
        try {
            const session = await this.getSession(oldSessionId);
            
            if (!session) {
                throw new Error('Session not found');
            }

            // Create new session with same data
            const newSession = await this.createSession(session.userId, session.data, {
                metadata: session.metadata
            });

            // Destroy old session
            await this.destroySession(oldSessionId);

            await this._auditLog('SESSION_REGENERATED', {
                oldSessionId,
                newSessionId: newSession.sessionId,
                userId: session.userId
            });

            return newSession;

        } catch (error) {
            console.error('Failed to regenerate session:', error);
            throw error;
        }
    }

    // ========== PRIVATE METHODS ==========

    async _initializeRedis() {
        // Initialize Redis client
        if (this.config.redis.cluster) {
            this.state.redis = new Redis.Cluster(this.config.redis.cluster, {
                redisOptions: {
                    password: this.config.redis.password
                }
            });
        } else if (this.config.redis.sentinels) {
            this.state.redis = new Redis({
                sentinels: this.config.redis.sentinels,
                name: 'mymaster',
                password: this.config.redis.password
            });
        } else {
            this.state.redis = new Redis({
                host: this.config.redis.host,
                port: this.config.redis.port,
                password: this.config.redis.password,
                db: this.config.redis.db,
                keyPrefix: this.config.redis.keyPrefix,
                enableOfflineQueue: this.config.redis.enableOfflineQueue,
                maxRetriesPerRequest: this.config.redis.maxRetriesPerRequest,
                retryStrategy: this.config.redis.retryStrategy
            });
        }

        // Set up event handlers
        this.state.redis.on('connect', () => {
            this.state.connected = true;
            console.log('Redis connected');
            this.emit('connected');
        });

        this.state.redis.on('error', (error) => {
            console.error('Redis error:', error);
            this.emit('error', error);
        });

        this.state.redis.on('close', () => {
            this.state.connected = false;
            console.log('Redis connection closed');
            this.emit('disconnected');
        });

        // Wait for connection
        await this.state.redis.ping();

        // Initialize subscriber for pub/sub if needed
        this.state.redisSub = this.state.redis.duplicate();
    }

    async _initializeEncryption() {
        if (!this.config.security.encryption.enabled) return;

        // Generate initial encryption key
        this.state.currentEncryptionKey = await this._generateEncryptionKey();
        this.state.encryptionKeys.set('current', this.state.currentEncryptionKey);

        // Start key rotation if enabled
        if (this.config.security.encryption.keyRotation) {
            this.keyRotationTimer = setInterval(async () => {
                await this._rotateEncryptionKey();
            }, this.config.security.encryption.keyRotationInterval);
        }
    }

    async _startMonitoring() {
        // Health check timer
        if (this.config.monitoring.enabled) {
            this.healthCheckTimer = setInterval(async () => {
                await this._performHealthCheck();
            }, this.config.monitoring.healthCheckInterval);

            // Metrics collection timer
            this.metricsTimer = setInterval(() => {
                this.emit('metrics', this.getMetrics());
            }, this.config.monitoring.metricsInterval);
        }

        // Cache cleanup timer
        if (this.config.performance.caching.enabled) {
            this.cacheCleanupTimer = setInterval(() => {
                this._cleanupLocalCache();
            }, 60000); // Every minute
        }
    }

    async _loadExistingSessions() {
        // Optional: Load session count or perform initialization tasks
        try {
            const pattern = `${this.config.redis.keyPrefix}*`;
            const keys = await this.state.redis.keys(pattern);
            console.log(`Found ${keys.length} existing sessions`);
        } catch (error) {
            console.warn('Failed to load existing sessions:', error);
        }
    }

    _generateSessionId() {
        return crypto.randomBytes(32).toString('hex');
    }

    _getSessionKey(sessionId) {
        return `session:${sessionId}`;
    }

    _getUserSessionsKey(userId) {
        return `user:${userId}:sessions`;
    }

    _validateSessionData(data) {
        const dataStr = JSON.stringify(data);
        if (dataStr.length > this.config.session.maxDataSize) {
            throw new Error(`Session data exceeds maximum size of ${this.config.session.maxDataSize} bytes`);
        }
        return data;
    }

    _validateSession(session) {
        // Check expiration
        if (Date.now() > session.expiresAt) {
            return false;
        }

        // Additional validation can be added here
        return true;
    }

    async _checkSessionLimits(userId) {
        const userKey = this._getUserSessionsKey(userId);
        const count = await this.state.redis.scard(userKey);
        
        if (count >= this.config.session.maxSessions) {
            // Remove oldest session
            const sessions = await this.getUserSessions(userId);
            if (sessions.length > 0) {
                const oldest = sessions.sort((a, b) => a.createdAt - b.createdAt)[0];
                await this.destroySession(oldest.id);
            }
        }
    }

    async _updateSessionActivity(sessionId, session) {
        session.lastActivity = Date.now();
        session.expiresAt = Date.now() + (this.config.session.ttl * 1000);

        const storedData = this.config.security.encryption.enabled
            ? await this._encryptSessionData(session)
            : JSON.stringify(session);

        const key = this._getSessionKey(sessionId);
        const pipeline = this.state.redis.pipeline();
        
        pipeline.set(key, storedData);
        pipeline.expire(key, this.config.session.ttl);
        
        await pipeline.exec();
    }

    async _generateEncryptionKey() {
        return {
            id: crypto.randomBytes(16).toString('hex'),
            key: crypto.randomBytes(32),
            createdAt: Date.now()
        };
    }

    async _encryptSessionData(data) {
        const key = this.state.currentEncryptionKey.key;
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.config.security.encryption.algorithm, key, iv);
        
        const dataStr = JSON.stringify(data);
        let encrypted = cipher.update(dataStr, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const authTag = cipher.getAuthTag();
        
        return JSON.stringify({
            keyId: this.state.currentEncryptionKey.id,
            iv: iv.toString('base64'),
            authTag: authTag.toString('base64'),
            data: encrypted.toString('base64')
        });
    }

    async _decryptSessionData(encryptedData) {
        const encrypted = JSON.parse(encryptedData);
        
        // Get appropriate key
        const keyData = this.state.encryptionKeys.get(encrypted.keyId) || 
                       this.state.currentEncryptionKey;
        
        if (!keyData) {
            throw new Error('Encryption key not found');
        }

        const decipher = crypto.createDecipheriv(
            this.config.security.encryption.algorithm,
            keyData.key,
            Buffer.from(encrypted.iv, 'base64')
        );
        
        decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
        
        let decrypted = decipher.update(Buffer.from(encrypted.data, 'base64'));
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        return JSON.parse(decrypted.toString('utf8'));
    }

    async _rotateEncryptionKey() {
        const newKey = await this._generateEncryptionKey();
        
        // Keep old key for decryption
        this.state.encryptionKeys.set(
            this.state.currentEncryptionKey.id,
            this.state.currentEncryptionKey
        );
        
        // Set new current key
        this.state.currentEncryptionKey = newKey;
        this.state.encryptionKeys.set('current', newKey);
        
        // Clean up old keys (keep last 2)
        if (this.state.encryptionKeys.size > 3) {
            const oldestKey = Array.from(this.state.encryptionKeys.entries())
                .filter(([id]) => id !== 'current')
                .sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
            
            if (oldestKey) {
                this.state.encryptionKeys.delete(oldestKey[0]);
            }
        }

        await this._auditLog('ENCRYPTION_KEY_ROTATED', {
            newKeyId: newKey.id
        });
    }

    _checkRateLimit(userId) {
        const now = Date.now();
        const windowStart = now - this.config.security.rateLimiting.windowMs;
        
        let userLimits = this.state.rateLimitMap.get(userId);
        
        if (!userLimits) {
            userLimits = { requests: [], blockedUntil: 0 };
            this.state.rateLimitMap.set(userId, userLimits);
        }

        // Check if blocked
        if (now < userLimits.blockedUntil) {
            throw new Error('Rate limit exceeded');
        }

        // Clean old requests
        userLimits.requests = userLimits.requests.filter(time => time > windowStart);

        // Check limit
        if (userLimits.requests.length >= this.config.security.rateLimiting.maxRequests) {
            userLimits.blockedUntil = now + this.config.security.rateLimiting.windowMs;
            throw new Error('Rate limit exceeded');
        }

        // Add current request
        userLimits.requests.push(now);
    }

    _updateLocalCache(sessionId, sessionData) {
        this.state.localCache.set(sessionId, {
            data: sessionData,
            cachedAt: Date.now()
        });

        // Limit cache size
        if (this.state.localCache.size > this.config.performance.caching.maxCacheSize) {
            const oldestKey = this.state.localCache.keys().next().value;
            this.state.localCache.delete(oldestKey);
        }
    }

    _getFromLocalCache(sessionId) {
        const cached = this.state.localCache.get(sessionId);
        
        if (!cached) return null;

        const age = Date.now() - cached.cachedAt;
        if (age > this.config.performance.caching.localCacheTTL * 1000) {
            this.state.localCache.delete(sessionId);
            return null;
        }

        return cached.data;
    }

    _cleanupLocalCache() {
        const now = Date.now();
        const maxAge = this.config.performance.caching.localCacheTTL * 1000;
        
        for (const [sessionId, cached] of this.state.localCache.entries()) {
            if (now - cached.cachedAt > maxAge) {
                this.state.localCache.delete(sessionId);
            }
        }
    }

    _generateCookie(sessionId) {
        const cookieOptions = [
            `${this.config.session.cookieName}=${sessionId}`,
            `Max-Age=${this.config.session.ttl}`,
            'Path=/'
        ];

        if (this.config.session.secure) {
            cookieOptions.push('Secure');
        }

        if (this.config.session.httpOnly) {
            cookieOptions.push('HttpOnly');
        }

        if (this.config.session.sameSite) {
            cookieOptions.push(`SameSite=${this.config.session.sameSite}`);
        }

        return cookieOptions.join('; ');
    }

    _updateLatencyMetric(latency) {
        this.state.metrics.averageLatency = 
            (this.state.metrics.averageLatency + latency) / 2;
    }

    async _performHealthCheck() {
        try {
            await this.state.redis.ping();
            this.emit('healthCheck', { status: 'healthy' });
        } catch (error) {
            this.emit('healthCheck', { status: 'unhealthy', error: error.message });
        }
    }

    async _auditLog(action, details) {
        if (!this.config.auditLogging) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'RedisSessionManager'
        };

        this.emit('auditLog', logEntry);
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            redis: {
                connected: this.state.connected,
                keyPrefix: this.config.redis.keyPrefix
            },
            cache: {
                size: this.state.localCache.size,
                maxSize: this.config.performance.caching.maxCacheSize
            },
            security: {
                encryptionEnabled: this.config.security.encryption.enabled,
                activeKeys: this.state.encryptionKeys.size
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Clear timers
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
        if (this.metricsTimer) clearInterval(this.metricsTimer);
        if (this.keyRotationTimer) clearInterval(this.keyRotationTimer);
        if (this.cacheCleanupTimer) clearInterval(this.cacheCleanupTimer);

        // Clear cache
        this.state.localCache.clear();
        this.state.rateLimitMap.clear();

        // Close Redis connections
        if (this.state.redis) {
            await this.state.redis.quit();
        }
        if (this.state.redisSub) {
            await this.state.redisSub.quit();
        }

        console.log('Redis Session Manager cleaned up');
    }
}

module.exports = { RedisSessionManager };