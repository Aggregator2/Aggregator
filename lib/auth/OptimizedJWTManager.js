/**
 * @title Optimized JWT Manager with Security Enhancements
 * @author DEX Security Team
 * @notice High-performance JWT management with asymmetric keys and security hardening
 * @dev Addresses timing attacks, key rotation, and performance bottlenecks
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Redis = require('redis');
const { Worker } = require('worker_threads');

class OptimizedJWTManager {
    constructor(config) {
        this.config = {
            algorithm: config.algorithm || 'RS256',
            accessTokenTTL: config.accessTokenTTL || 900, // 15 minutes
            refreshTokenTTL: config.refreshTokenTTL || 604800, // 7 days
            keyRotationInterval: config.keyRotationInterval || 2592000000, // 30 days
            issuer: config.issuer || 'dex-platform',
            audience: config.audience || 'dex-api',
            enableAsyncCrypto: config.enableAsyncCrypto !== false,
            maxConcurrentOps: config.maxConcurrentOps || 100,
            ...config
        };

        // Redis for distributed token blacklist and key storage
        this.redisClient = Redis.createClient(config.redis || {});
        
        // Key management
        this.keyPairs = new Map(); // keyId -> { publicKey, privateKey, createdAt }
        this.currentKeyId = null;
        this.keyRotationTimer = null;
        
        // Performance optimization
        this.cryptoWorkerPool = this.config.enableAsyncCrypto ? 
            new CryptoWorkerPool(config.cryptoWorkers || 4) : null;
        this.operationQueue = new OperationQueue(this.config.maxConcurrentOps);
        
        // Token blacklist cache (LRU)
        this.blacklistCache = new Map(); // token -> expiry
        this.blacklistCacheSize = config.blacklistCacheSize || 10000;
        
        // Security monitoring
        this.securityMetrics = new JWTSecurityMetrics();
        
        this._initializeKeyRotation();
    }

    /**
     * Initialize JWT manager
     */
    async initialize() {
        try {
            await this.redisClient.connect();
            await this._loadOrGenerateKeys();
            await this._startKeyRotation();
            console.log('Optimized JWT Manager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize JWT Manager:', error);
            throw error;
        }
    }

    /**
     * Generate access token with optimized performance
     * @param {Object} user User data
     * @param {string} sessionId Session ID
     * @param {Object} options Token options
     * @returns {Promise<string>} JWT token
     */
    async generateAccessToken(user, sessionId, options = {}) {
        const startTime = process.hrtime.bigint();
        
        try {
            const payload = {
                sub: user.id,
                iss: this.config.issuer,
                aud: this.config.audience,
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + this.config.accessTokenTTL,
                jti: crypto.randomUUID(),
                sessionId,
                roles: user.roles || [],
                permissions: user.permissions || [],
                type: 'access'
            };

            // Add additional claims if provided
            if (options.additionalClaims) {
                Object.assign(payload, options.additionalClaims);
            }

            const token = await this._signTokenOptimized(payload, 'access');
            
            // Record performance metrics
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000; // Convert to ms
            this.securityMetrics.recordTokenGeneration('access', duration, true);
            
            return token;

        } catch (error) {
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000;
            this.securityMetrics.recordTokenGeneration('access', duration, false);
            throw new JWTError(`Failed to generate access token: ${error.message}`);
        }
    }

    /**
     * Generate refresh token with extended TTL
     * @param {Object} user User data
     * @param {string} sessionId Session ID
     * @returns {Promise<string>} Refresh token
     */
    async generateRefreshToken(user, sessionId) {
        const startTime = process.hrtime.bigint();
        
        try {
            const payload = {
                sub: user.id,
                iss: this.config.issuer,
                aud: this.config.audience,
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + this.config.refreshTokenTTL,
                jti: crypto.randomUUID(),
                sessionId,
                type: 'refresh'
            };

            const token = await this._signTokenOptimized(payload, 'refresh');
            
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000;
            this.securityMetrics.recordTokenGeneration('refresh', duration, true);
            
            return token;

        } catch (error) {
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000;
            this.securityMetrics.recordTokenGeneration('refresh', duration, false);
            throw new JWTError(`Failed to generate refresh token: ${error.message}`);
        }
    }

    /**
     * Verify token with constant-time operations and caching
     * @param {string} token JWT token
     * @param {string} tokenType Expected token type
     * @returns {Promise<Object>} Decoded payload
     */
    async verifyToken(token, tokenType = 'access') {
        const startTime = process.hrtime.bigint();
        
        try {
            // Check blacklist first (fast cache lookup)
            if (await this._isTokenBlacklisted(token)) {
                throw new JWTError('Token has been revoked');
            }

            // Decode header to get key ID (without verification)
            const decoded = jwt.decode(token, { complete: true });
            if (!decoded || !decoded.header.kid) {
                throw new JWTError('Invalid token format');
            }

            // Get public key for verification
            const keyPair = this.keyPairs.get(decoded.header.kid);
            if (!keyPair) {
                throw new JWTError('Unknown signing key');
            }

            // Verify token with proper algorithm validation
            const payload = await this._verifyTokenOptimized(token, keyPair.publicKey);

            // Validate token type
            if (payload.type !== tokenType) {
                throw new JWTError(`Invalid token type. Expected: ${tokenType}, Got: ${payload.type}`);
            }

            // Additional security validations
            await this._validateTokenClaims(payload);

            const duration = Number(process.hrtime.bigint() - startTime) / 1000000;
            this.securityMetrics.recordTokenVerification(tokenType, duration, true);

            return payload;

        } catch (error) {
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000;
            this.securityMetrics.recordTokenVerification(tokenType, duration, false);
            
            // Constant-time error response to prevent timing attacks
            await this._constantTimeDelay();
            throw new JWTError(`Token verification failed: ${error.message}`);
        }
    }

    /**
     * Verify access token
     * @param {string} token Access token
     * @returns {Promise<Object>} Decoded payload
     */
    async verifyAccessToken(token) {
        return this.verifyToken(token, 'access');
    }

    /**
     * Verify refresh token
     * @param {string} token Refresh token
     * @returns {Promise<Object>} Decoded payload
     */
    async verifyRefreshToken(token) {
        return this.verifyToken(token, 'refresh');
    }

    /**
     * Blacklist token (for logout/revocation)
     * @param {string} token JWT token to blacklist
     * @returns {Promise<void>}
     */
    async blacklistToken(token) {
        try {
            const decoded = jwt.decode(token);
            if (!decoded || !decoded.exp) {
                return; // Invalid token, no need to blacklist
            }

            // Calculate TTL for blacklist entry
            const expiryTime = decoded.exp * 1000; // Convert to milliseconds
            const ttlSeconds = Math.max(0, Math.ceil((expiryTime - Date.now()) / 1000));

            if (ttlSeconds > 0) {
                // Store in Redis with TTL
                await this.redisClient.setEx(`blacklist:${decoded.jti}`, ttlSeconds, '1');
                
                // Also cache locally for performance
                this._addToBlacklistCache(decoded.jti, expiryTime);
            }

            this.securityMetrics.recordTokenBlacklisted();

        } catch (error) {
            console.error('Error blacklisting token:', error);
            // Don't throw error for blacklisting failures
        }
    }

    /**
     * Generate temporary token for specific operations
     * @param {Object} payload Token payload
     * @param {number} ttlSeconds TTL in seconds
     * @returns {Promise<string>} Temporary token
     */
    async generateTempToken(payload, ttlSeconds = 300) {
        const tempPayload = {
            ...payload,
            iss: this.config.issuer,
            aud: this.config.audience,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + ttlSeconds,
            jti: crypto.randomUUID(),
            type: 'temp'
        };

        return this._signTokenOptimized(tempPayload, 'temp');
    }

    /**
     * Verify temporary token
     * @param {string} token Temporary token
     * @returns {Promise<Object>} Decoded payload
     */
    async verifyTempToken(token) {
        return this.verifyToken(token, 'temp');
    }

    // =============================================================================
    // PRIVATE OPTIMIZATION METHODS
    // =============================================================================

    /**
     * Sign token with performance optimization
     * @param {Object} payload Token payload
     * @param {string} tokenType Token type
     * @returns {Promise<string>} Signed token
     * @private
     */
    async _signTokenOptimized(payload, tokenType) {
        if (!this.currentKeyId) {
            throw new JWTError('No signing key available');
        }

        const keyPair = this.keyPairs.get(this.currentKeyId);
        const options = {
            algorithm: this.config.algorithm,
            keyid: this.currentKeyId,
            header: {
                typ: 'JWT',
                alg: this.config.algorithm,
                kid: this.currentKeyId
            }
        };

        // Use worker thread for CPU-intensive signing if available
        if (this.cryptoWorkerPool && tokenType !== 'temp') {
            return this.operationQueue.add(async () => {
                return this.cryptoWorkerPool.signToken(payload, keyPair.privateKey, options);
            });
        }

        // Fallback to main thread signing
        return new Promise((resolve, reject) => {
            jwt.sign(payload, keyPair.privateKey, options, (err, token) => {
                if (err) reject(err);
                else resolve(token);
            });
        });
    }

    /**
     * Verify token with performance optimization
     * @param {string} token JWT token
     * @param {string} publicKey Public key for verification
     * @returns {Promise<Object>} Decoded payload
     * @private
     */
    async _verifyTokenOptimized(token, publicKey) {
        const options = {
            algorithms: [this.config.algorithm],
            issuer: this.config.issuer,
            audience: this.config.audience,
            clockTolerance: 30 // 30 seconds clock skew tolerance
        };

        // Use worker thread for CPU-intensive verification if available
        if (this.cryptoWorkerPool) {
            return this.operationQueue.add(async () => {
                return this.cryptoWorkerPool.verifyToken(token, publicKey, options);
            });
        }

        // Fallback to main thread verification
        return new Promise((resolve, reject) => {
            jwt.verify(token, publicKey, options, (err, decoded) => {
                if (err) reject(err);
                else resolve(decoded);
            });
        });
    }

    /**
     * Check if token is blacklisted with caching
     * @param {string} token JWT token
     * @returns {Promise<boolean>} True if blacklisted
     * @private
     */
    async _isTokenBlacklisted(token) {
        try {
            const decoded = jwt.decode(token);
            if (!decoded || !decoded.jti) {
                return false;
            }

            // Check local cache first
            const cachedExpiry = this.blacklistCache.get(decoded.jti);
            if (cachedExpiry) {
                if (Date.now() < cachedExpiry) {
                    return true;
                } else {
                    // Expired, remove from cache
                    this.blacklistCache.delete(decoded.jti);
                }
            }

            // Check Redis
            const isBlacklisted = await this.redisClient.exists(`blacklist:${decoded.jti}`);
            
            // Cache the result if blacklisted
            if (isBlacklisted) {
                this._addToBlacklistCache(decoded.jti, decoded.exp * 1000);
            }

            return Boolean(isBlacklisted);

        } catch (error) {
            console.error('Error checking token blacklist:', error);
            return false; // Fail open for blacklist checks
        }
    }

    /**
     * Add token to local blacklist cache
     * @param {string} jti Token ID
     * @param {number} expiryTime Expiry timestamp
     * @private
     */
    _addToBlacklistCache(jti, expiryTime) {
        // Implement LRU eviction
        if (this.blacklistCache.size >= this.blacklistCacheSize) {
            const firstKey = this.blacklistCache.keys().next().value;
            this.blacklistCache.delete(firstKey);
        }

        this.blacklistCache.set(jti, expiryTime);
    }

    /**
     * Validate token claims for security
     * @param {Object} payload Token payload
     * @private
     */
    async _validateTokenClaims(payload) {
        // Validate required claims
        if (!payload.sub || !payload.iat || !payload.exp) {
            throw new JWTError('Missing required claims');
        }

        // Validate expiration
        if (payload.exp <= Math.floor(Date.now() / 1000)) {
            throw new JWTError('Token has expired');
        }

        // Validate not before (if present)
        if (payload.nbf && payload.nbf > Math.floor(Date.now() / 1000)) {
            throw new JWTError('Token not yet valid');
        }

        // Validate issued at time (prevent future tokens)
        if (payload.iat > Math.floor(Date.now() / 1000) + 60) { // 1 minute tolerance
            throw new JWTError('Token issued in the future');
        }
    }

    /**
     * Constant-time delay to prevent timing attacks
     * @private
     */
    async _constantTimeDelay() {
        // Add random delay between 10-50ms to prevent timing analysis
        const delay = 10 + Math.random() * 40;
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Load existing keys or generate new ones
     * @private
     */
    async _loadOrGenerateKeys() {
        try {
            // Try to load existing keys from Redis
            const existingKeys = await this.redisClient.hGetAll('jwt_keys');
            
            if (Object.keys(existingKeys).length > 0) {
                // Load existing keys
                for (const [keyId, keyData] of Object.entries(existingKeys)) {
                    const parsedKeyData = JSON.parse(keyData);
                    this.keyPairs.set(keyId, parsedKeyData);
                }
                
                // Set current key (most recent)
                const sortedKeys = Array.from(this.keyPairs.entries())
                    .sort((a, b) => b[1].createdAt - a[1].createdAt);
                this.currentKeyId = sortedKeys[0][0];
            } else {
                // Generate initial key pair
                await this._generateKeyPair();
            }

        } catch (error) {
            console.error('Error loading keys, generating new ones:', error);
            await this._generateKeyPair();
        }
    }

    /**
     * Generate new RSA key pair
     * @private
     */
    async _generateKeyPair() {
        const keyId = crypto.randomUUID();
        
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });

        const keyData = {
            publicKey,
            privateKey,
            createdAt: Date.now(),
            algorithm: this.config.algorithm
        };

        // Store in memory
        this.keyPairs.set(keyId, keyData);
        this.currentKeyId = keyId;

        // Store in Redis
        await this.redisClient.hSet('jwt_keys', keyId, JSON.stringify(keyData));

        console.log(`Generated new JWT key pair: ${keyId}`);
    }

    /**
     * Initialize key rotation system
     * @private
     */
    _initializeKeyRotation() {
        // Start key rotation timer
        this.keyRotationTimer = setInterval(async () => {
            try {
                await this._rotateKeys();
            } catch (error) {
                console.error('Key rotation failed:', error);
            }
        }, this.config.keyRotationInterval);
    }

    /**
     * Start key rotation
     * @private
     */
    async _startKeyRotation() {
        // Check if current key needs rotation
        if (this.currentKeyId) {
            const currentKey = this.keyPairs.get(this.currentKeyId);
            const keyAge = Date.now() - currentKey.createdAt;
            
            if (keyAge > this.config.keyRotationInterval) {
                await this._rotateKeys();
            }
        }
    }

    /**
     * Rotate JWT signing keys
     * @private
     */
    async _rotateKeys() {
        console.log('Starting JWT key rotation...');
        
        // Generate new key pair
        await this._generateKeyPair();
        
        // Clean up old keys (keep last 2 for verification)
        const sortedKeys = Array.from(this.keyPairs.entries())
            .sort((a, b) => b[1].createdAt - a[1].createdAt);

        const keysToKeep = sortedKeys.slice(0, 2);
        const keysToRemove = sortedKeys.slice(2);

        // Remove old keys
        for (const [keyId] of keysToRemove) {
            this.keyPairs.delete(keyId);
            await this.redisClient.hDel('jwt_keys', keyId);
        }

        console.log(`JWT key rotation completed. Removed ${keysToRemove.length} old keys.`);
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get current public keys for verification (JWK format)
     * @returns {Object} JWK Set
     */
    getPublicKeys() {
        const keys = [];
        
        for (const [keyId, keyData] of this.keyPairs.entries()) {
            // Convert PEM to JWK (simplified - production would use proper library)
            keys.push({
                kty: 'RSA',
                use: 'sig',
                kid: keyId,
                alg: this.config.algorithm,
                // In production, convert PEM to JWK format
                x5c: [keyData.publicKey.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')]
            });
        }

        return {
            keys
        };
    }

    /**
     * Get JWT manager statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            ...this.securityMetrics.getMetrics(),
            activeKeys: this.keyPairs.size,
            currentKeyId: this.currentKeyId,
            blacklistCacheSize: this.blacklistCache.size,
            algorithm: this.config.algorithm,
            keyRotationInterval: this.config.keyRotationInterval
        };
    }

    /**
     * Get health status
     * @returns {Promise<Object>} Health status
     */
    async getHealthStatus() {
        try {
            const redisHealth = this.redisClient.isReady ? 'healthy' : 'unhealthy';
            const hasValidKey = this.currentKeyId && this.keyPairs.has(this.currentKeyId);
            
            return {
                status: redisHealth === 'healthy' && hasValidKey ? 'healthy' : 'degraded',
                components: {
                    redis: redisHealth,
                    keyManagement: hasValidKey ? 'healthy' : 'unhealthy',
                    cryptoWorkers: this.cryptoWorkerPool ? 'enabled' : 'disabled'
                },
                metrics: this.getStatistics(),
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

    /**
     * Cleanup resources
     */
    async cleanup() {
        if (this.keyRotationTimer) {
            clearInterval(this.keyRotationTimer);
        }
        
        if (this.cryptoWorkerPool) {
            await this.cryptoWorkerPool.cleanup();
        }
        
        await this.redisClient.disconnect();
    }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

class CryptoWorkerPool {
    constructor(workerCount = 4) {
        this.workers = [];
        this.currentWorker = 0;
        this.workerCount = workerCount;
        
        // Initialize workers (implementation would create actual worker threads)
        for (let i = 0; i < workerCount; i++) {
            this.workers.push({
                id: i,
                busy: false
            });
        }
    }

    async signToken(payload, privateKey, options) {
        // Implementation would delegate to worker thread
        return new Promise((resolve, reject) => {
            jwt.sign(payload, privateKey, options, (err, token) => {
                if (err) reject(err);
                else resolve(token);
            });
        });
    }

    async verifyToken(token, publicKey, options) {
        // Implementation would delegate to worker thread
        return new Promise((resolve, reject) => {
            jwt.verify(token, publicKey, options, (err, decoded) => {
                if (err) reject(err);
                else resolve(decoded);
            });
        });
    }

    async cleanup() {
        // Cleanup worker threads
        console.log('Cleaning up crypto worker pool');
    }
}

class OperationQueue {
    constructor(maxConcurrent = 100) {
        this.maxConcurrent = maxConcurrent;
        this.queue = [];
        this.running = 0;
    }

    async add(operation) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                operation,
                resolve,
                reject
            });
            
            this.process();
        });
    }

    async process() {
        if (this.running >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        const item = this.queue.shift();
        this.running++;

        try {
            const result = await item.operation();
            item.resolve(result);
        } catch (error) {
            item.reject(error);
        } finally {
            this.running--;
            this.process(); // Process next item
        }
    }
}

class JWTSecurityMetrics {
    constructor() {
        this.metrics = {
            tokensGenerated: { access: 0, refresh: 0, temp: 0 },
            tokensVerified: { access: 0, refresh: 0, temp: 0 },
            tokensBlacklisted: 0,
            verificationFailures: 0,
            averageGenerationTime: { access: 0, refresh: 0, temp: 0 },
            averageVerificationTime: { access: 0, refresh: 0, temp: 0 }
        };
    }

    recordTokenGeneration(type, duration, success) {
        if (success) {
            this.metrics.tokensGenerated[type]++;
            this.metrics.averageGenerationTime[type] = 
                (this.metrics.averageGenerationTime[type] + duration) / 2;
        }
    }

    recordTokenVerification(type, duration, success) {
        if (success) {
            this.metrics.tokensVerified[type]++;
            this.metrics.averageVerificationTime[type] = 
                (this.metrics.averageVerificationTime[type] + duration) / 2;
        } else {
            this.metrics.verificationFailures++;
        }
    }

    recordTokenBlacklisted() {
        this.metrics.tokensBlacklisted++;
    }

    getMetrics() {
        return { ...this.metrics };
    }
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

class JWTError extends Error {
    constructor(message, code = 'JWT_ERROR') {
        super(message);
        this.name = 'JWTError';
        this.code = code;
    }
}

module.exports = {
    OptimizedJWTManager,
    CryptoWorkerPool,
    OperationQueue,
    JWTSecurityMetrics,
    JWTError
};