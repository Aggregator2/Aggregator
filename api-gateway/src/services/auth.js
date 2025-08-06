/**
 * Authentication and Authorization Service
 * Comprehensive auth system with JWT, API keys, and multi-factor authentication
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { ethers } from 'ethers';

/**
 * Authentication Service
 */
export class AuthService {
    constructor(config, databaseService) {
        this.config = config;
        this.db = databaseService;
        
        // JWT configuration
        this.jwtSecret = config.jwt.secret;
        this.jwtExpiresIn = config.jwt.expiresIn;
        this.jwtRefreshExpiresIn = config.jwt.refreshExpiresIn;
        
        // API key configuration
        this.apiKeyPrefix = 'sq_';
        this.apiKeyLength = 32;
        this.saltRounds = 12;
        
        // Session management
        this.activeSessions = new Map();
        this.refreshTokens = new Map();
        
        // Security tracking
        this.failedAttempts = new Map();
        this.blockedIPs = new Set();
        
        this.setupCleanupIntervals();
    }

    /**
     * Setup periodic cleanup of expired data
     */
    setupCleanupIntervals() {
        // Clean up failed attempts every 15 minutes
        setInterval(() => {
            const cutoff = Date.now() - 900000; // 15 minutes ago
            for (const [key, data] of this.failedAttempts) {
                if (data.lastAttempt < cutoff) {
                    this.failedAttempts.delete(key);
                }
            }
        }, 900000);

        // Clean up expired sessions every hour
        setInterval(() => {
            const now = Date.now();
            for (const [token, session] of this.activeSessions) {
                if (session.expiresAt < now) {
                    this.activeSessions.delete(token);
                }
            }
        }, 3600000);
    }

    /**
     * Web3 signature-based authentication
     */
    async authenticateWithSignature(address, signature, message, nonce) {
        try {
            // Validate inputs
            if (!this.isValidAddress(address)) {
                throw new Error('Invalid Ethereum address');
            }

            // Check nonce to prevent replay attacks
            const isValidNonce = await this.validateNonce(address, nonce);
            if (!isValidNonce) {
                throw new Error('Invalid or expired nonce');
            }

            // Verify signature
            const recoveredAddress = ethers.verifyMessage(message, signature);
            if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
                await this.recordFailedAttempt(address, 'invalid_signature');
                throw new Error('Signature verification failed');
            }

            // Invalidate nonce to prevent reuse
            await this.invalidateNonce(address, nonce);

            // Get or create user
            let user = await this.db.getUserByAddress(address);
            if (!user) {
                user = await this.createUser(address);
            }

            // Update last login
            await this.db.updateUser(user.address, {
                lastLoginAt: new Date(),
                lastLoginIP: this.getClientIP()
            });

            // Generate tokens
            const tokens = await this.generateTokens(user);
            
            // Create session
            await this.createSession(user, tokens.token);

            return {
                success: true,
                user,
                tokens
            };

        } catch (error) {
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }

    /**
     * JWT token authentication
     */
    async authenticateWithToken(token) {
        try {
            // Verify JWT token
            const decoded = jwt.verify(token, this.jwtSecret, {
                issuer: this.config.jwt.issuer,
                audience: this.config.jwt.audience
            });

            // Check if session is active
            const session = this.activeSessions.get(token);
            if (!session) {
                throw new Error('Session not found');
            }

            if (session.expiresAt < Date.now()) {
                this.activeSessions.delete(token);
                throw new Error('Session expired');
            }

            // Get user data
            const user = await this.db.getUserByAddress(decoded.address);
            if (!user) {
                throw new Error('User not found');
            }

            if (!user.isActive) {
                throw new Error('User account is deactivated');
            }

            // Update session activity
            session.lastActivity = Date.now();

            return {
                success: true,
                user,
                token
            };

        } catch (error) {
            throw new Error(`Token authentication failed: ${error.message}`);
        }
    }

    /**
     * API key authentication
     */
    async authenticateWithApiKey(apiKey) {
        try {
            // Validate API key format
            if (!this.isValidApiKeyFormat(apiKey)) {
                throw new Error('Invalid API key format');
            }

            // Extract key ID and secret
            const keyHash = this.hashApiKey(apiKey);
            
            // Get API key from database
            const apiKeyRecord = await this.db.getApiKeyByHash(keyHash);
            if (!apiKeyRecord) {
                throw new Error('API key not found');
            }

            // Check if API key is active
            if (!apiKeyRecord.isActive) {
                throw new Error('API key is deactivated');
            }

            // Check expiration
            if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
                throw new Error('API key has expired');
            }

            // Update last used timestamp
            await this.db.updateApiKey(apiKeyRecord.id, {
                lastUsedAt: new Date(),
                usageCount: apiKeyRecord.usageCount + 1
            });

            // Get associated user
            const user = await this.db.getUserByAddress(apiKeyRecord.userAddress);
            if (!user || !user.isActive) {
                throw new Error('Associated user not found or inactive');
            }

            // Check rate limits for API key
            await this.checkApiKeyRateLimit(apiKeyRecord);

            return {
                success: true,
                user: {
                    ...user,
                    apiKeyId: apiKeyRecord.id,
                    permissions: apiKeyRecord.permissions,
                    tier: apiKeyRecord.tier || user.tier
                },
                apiKey: apiKeyRecord
            };

        } catch (error) {
            throw new Error(`API key authentication failed: ${error.message}`);
        }
    }

    /**
     * Generate authentication tokens
     */
    async generateTokens(user) {
        const payload = {
            address: user.address,
            permissions: user.permissions || [],
            tier: user.tier || 'free',
            isAdmin: user.isAdmin || false
        };

        // Generate access token
        const token = jwt.sign(payload, this.jwtSecret, {
            expiresIn: this.jwtExpiresIn,
            issuer: this.config.jwt.issuer,
            audience: this.config.jwt.audience,
            subject: user.address
        });

        // Generate refresh token
        const refreshToken = this.generateSecureToken(64);
        const refreshExpiresAt = new Date(Date.now() + this.parseTimeToMs(this.jwtRefreshExpiresIn));

        // Store refresh token
        this.refreshTokens.set(refreshToken, {
            userAddress: user.address,
            expiresAt: refreshExpiresAt.getTime(),
            createdAt: Date.now()
        });

        // Store in database
        await this.db.createRefreshToken({
            token: refreshToken,
            userAddress: user.address,
            expiresAt: refreshExpiresAt
        });

        return {
            token,
            refreshToken,
            expiresAt: new Date(Date.now() + this.parseTimeToMs(this.jwtExpiresIn)),
            tokenType: 'Bearer'
        };
    }

    /**
     * Refresh access token
     */
    async refreshAccessToken(refreshToken) {
        try {
            // Validate refresh token
            const tokenData = this.refreshTokens.get(refreshToken);
            if (!tokenData) {
                const dbToken = await this.db.getRefreshToken(refreshToken);
                if (!dbToken || dbToken.expiresAt < new Date()) {
                    throw new Error('Invalid or expired refresh token');
                }
                tokenData = {
                    userAddress: dbToken.userAddress,
                    expiresAt: dbToken.expiresAt.getTime()
                };
            }

            if (tokenData.expiresAt < Date.now()) {
                this.refreshTokens.delete(refreshToken);
                await this.db.deleteRefreshToken(refreshToken);
                throw new Error('Refresh token expired');
            }

            // Get user
            const user = await this.db.getUserByAddress(tokenData.userAddress);
            if (!user || !user.isActive) {
                throw new Error('User not found or inactive');
            }

            // Generate new tokens
            const tokens = await this.generateTokens(user);

            // Invalidate old refresh token
            this.refreshTokens.delete(refreshToken);
            await this.db.deleteRefreshToken(refreshToken);

            return {
                success: true,
                user,
                tokens
            };

        } catch (error) {
            throw new Error(`Token refresh failed: ${error.message}`);
        }
    }

    /**
     * Create new API key
     */
    async createApiKey(userAddress, options = {}) {
        try {
            const {
                name,
                permissions = ['read'],
                expiresIn = '1y',
                tier = null
            } = options;

            // Validate user
            const user = await this.db.getUserByAddress(userAddress);
            if (!user) {
                throw new Error('User not found');
            }

            // Check API key limits
            const existingKeys = await this.db.getApiKeysByUser(userAddress);
            const maxKeys = this.getMaxApiKeysForTier(user.tier);
            
            if (existingKeys.length >= maxKeys) {
                throw new Error(`Maximum ${maxKeys} API keys allowed for ${user.tier} tier`);
            }

            // Generate API key
            const apiKey = this.generateApiKey();
            const keyHash = this.hashApiKey(apiKey);

            // Calculate expiration
            const expiresAt = expiresIn ? 
                             new Date(Date.now() + this.parseTimeToMs(expiresIn)) : 
                             null;

            // Create API key record
            const apiKeyRecord = await this.db.createApiKey({
                id: this.generateSecureToken(16),
                userAddress,
                name: name || `API Key ${existingKeys.length + 1}`,
                keyHash,
                permissions,
                tier: tier || user.tier,
                expiresAt,
                createdAt: new Date(),
                isActive: true,
                usageCount: 0
            });

            return {
                success: true,
                apiKey: {
                    ...apiKeyRecord,
                    key: apiKey // Only returned once during creation
                }
            };

        } catch (error) {
            throw new Error(`API key creation failed: ${error.message}`);
        }
    }

    /**
     * Revoke API key
     */
    async revokeApiKey(apiKeyId, userAddress) {
        try {
            const apiKey = await this.db.getApiKey(apiKeyId);
            
            if (!apiKey) {
                throw new Error('API key not found');
            }

            if (apiKey.userAddress !== userAddress) {
                throw new Error('Unauthorized to revoke this API key');
            }

            await this.db.updateApiKey(apiKeyId, {
                isActive: false,
                revokedAt: new Date()
            });

            return { success: true };

        } catch (error) {
            throw new Error(`API key revocation failed: ${error.message}`);
        }
    }

    /**
     * Logout user
     */
    async logout(token) {
        try {
            // Remove session
            this.activeSessions.delete(token);
            
            // Get token data to find refresh tokens
            const decoded = jwt.decode(token);
            if (decoded?.address) {
                // Remove all refresh tokens for user
                const userRefreshTokens = [];
                for (const [refreshToken, data] of this.refreshTokens) {
                    if (data.userAddress === decoded.address) {
                        userRefreshTokens.push(refreshToken);
                    }
                }
                
                // Clean up refresh tokens
                userRefreshTokens.forEach(refreshToken => {
                    this.refreshTokens.delete(refreshToken);
                });
                
                // Clean up from database
                await this.db.deleteRefreshTokensByUser(decoded.address);
            }

            return { success: true };

        } catch (error) {
            throw new Error(`Logout failed: ${error.message}`);
        }
    }

    /**
     * Validate order signature
     */
    async validateOrderSignature(orderData, userAddress) {
        try {
            const { signature, nonce, deadline, ...order } = orderData;

            // Create order hash according to EIP-712
            const domain = {
                name: 'SettlementQueue',
                version: '5',
                chainId: order.chainId || 1,
                verifyingContract: this.config.contractAddress
            };

            const types = {
                Order: [
                    { name: 'id', type: 'uint128' },
                    { name: 'trader', type: 'address' },
                    { name: 'tokenIn', type: 'address' },
                    { name: 'tokenOut', type: 'address' },
                    { name: 'amountIn', type: 'uint128' },
                    { name: 'minAmountOut', type: 'uint96' },
                    { name: 'deadline', type: 'uint32' },
                    { name: 'nonce', type: 'uint64' }
                ]
            };

            const orderStruct = {
                id: 0, // Will be set by contract
                trader: userAddress,
                tokenIn: order.tokenIn,
                tokenOut: order.tokenOut,
                amountIn: order.amountIn,
                minAmountOut: order.minAmountOut,
                deadline: Math.floor(new Date(deadline).getTime() / 1000),
                nonce: nonce
            };

            // Verify signature
            const recoveredAddress = ethers.verifyTypedData(domain, types, orderStruct, signature);
            
            if (recoveredAddress.toLowerCase() !== userAddress.toLowerCase()) {
                throw new Error('Invalid order signature');
            }

            // Check nonce uniqueness
            const nonceUsed = await this.db.isNonceUsed(userAddress, nonce);
            if (nonceUsed) {
                throw new Error('Nonce already used');
            }

            return true;

        } catch (error) {
            throw new Error(`Order signature validation failed: ${error.message}`);
        }
    }

    /**
     * Generate and validate nonces for replay protection
     */
    async generateNonce(address) {
        const nonce = crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + 300000); // 5 minutes

        await this.db.createNonce({
            address,
            nonce,
            expiresAt,
            used: false
        });

        return nonce;
    }

    async validateNonce(address, nonce) {
        const nonceRecord = await this.db.getNonce(address, nonce);
        return nonceRecord && 
               !nonceRecord.used && 
               nonceRecord.expiresAt > new Date();
    }

    async invalidateNonce(address, nonce) {
        await this.db.markNonceAsUsed(address, nonce);
    }

    /**
     * Create session
     */
    async createSession(user, token) {
        const session = {
            userAddress: user.address,
            token,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            expiresAt: Date.now() + this.parseTimeToMs(this.jwtExpiresIn),
            clientIP: this.getClientIP(),
            userAgent: this.getUserAgent()
        };

        this.activeSessions.set(token, session);
        
        // Store in database for persistence
        await this.db.createSession(session);
        
        return session;
    }

    /**
     * Security helpers
     */
    async recordFailedAttempt(identifier, reason) {
        const key = identifier;
        const attempts = this.failedAttempts.get(key) || { count: 0, lastAttempt: 0 };
        
        attempts.count++;
        attempts.lastAttempt = Date.now();
        attempts.reason = reason;
        
        this.failedAttempts.set(key, attempts);

        // Block IP after 5 failed attempts
        if (attempts.count >= 5) {
            this.blockedIPs.add(this.getClientIP());
            setTimeout(() => {
                this.blockedIPs.delete(this.getClientIP());
            }, 900000); // 15 minutes
        }

        // Log security event
        await this.db.logSecurityEvent({
            type: 'failed_authentication',
            identifier,
            reason,
            clientIP: this.getClientIP(),
            userAgent: this.getUserAgent(),
            timestamp: new Date()
        });
    }

    async checkApiKeyRateLimit(apiKey) {
        const limits = this.getRateLimitsForTier(apiKey.tier || 'free');
        const windowStart = Date.now() - 60000; // 1 minute window
        
        const usage = await this.db.getApiKeyUsage(apiKey.id, windowStart);
        
        if (usage.requestCount >= limits.perMinute) {
            throw new Error('API key rate limit exceeded');
        }
    }

    /**
     * Utility methods
     */
    generateApiKey() {
        const randomBytes = crypto.randomBytes(this.apiKeyLength);
        return this.apiKeyPrefix + randomBytes.toString('hex');
    }

    hashApiKey(apiKey) {
        return crypto.createHash('sha256').update(apiKey).digest('hex');
    }

    generateSecureToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    isValidAddress(address) {
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    }

    isValidApiKeyFormat(apiKey) {
        return apiKey.startsWith(this.apiKeyPrefix) && 
               apiKey.length === this.apiKeyPrefix.length + (this.apiKeyLength * 2);
    }

    parseTimeToMs(timeString) {
        const units = {
            's': 1000,
            'm': 60 * 1000,
            'h': 60 * 60 * 1000,
            'd': 24 * 60 * 60 * 1000,
            'w': 7 * 24 * 60 * 60 * 1000,
            'y': 365 * 24 * 60 * 60 * 1000
        };

        const match = timeString.match(/^(\d+)([smhdwy])$/);
        if (!match) {
            throw new Error('Invalid time format');
        }

        return parseInt(match[1]) * units[match[2]];
    }

    getMaxApiKeysForTier(tier) {
        const limits = {
            free: 2,
            pro: 10,
            enterprise: 50
        };
        return limits[tier] || limits.free;
    }

    getRateLimitsForTier(tier) {
        const limits = {
            free: { perMinute: 100, perHour: 1000, perDay: 10000 },
            pro: { perMinute: 1000, perHour: 50000, perDay: 1000000 },
            enterprise: { perMinute: 10000, perHour: 500000, perDay: -1 }
        };
        return limits[tier] || limits.free;
    }

    getClientIP() {
        // This would be set by middleware in real implementation
        return '127.0.0.1';
    }

    getUserAgent() {
        // This would be set by middleware in real implementation
        return 'unknown';
    }

    async createUser(address) {
        return await this.db.createUser({
            address: address.toLowerCase(),
            createdAt: new Date(),
            isActive: true,
            tier: 'free',
            permissions: ['read'],
            profile: {}
        });
    }

    /**
     * Initialize service
     */
    async initialize() {
        // Load active sessions from database on startup
        const sessions = await this.db.getActiveSessions();
        sessions.forEach(session => {
            if (session.expiresAt > Date.now()) {
                this.activeSessions.set(session.token, session);
            }
        });

        // Load active refresh tokens
        const refreshTokens = await this.db.getActiveRefreshTokens();
        refreshTokens.forEach(token => {
            if (token.expiresAt > Date.now()) {
                this.refreshTokens.set(token.token, {
                    userAddress: token.userAddress,
                    expiresAt: token.expiresAt.getTime()
                });
            }
        });

        console.log('✅ AuthService initialized successfully');
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            // Check if we can generate a token
            const testPayload = { test: true };
            const token = jwt.sign(testPayload, this.jwtSecret, { expiresIn: '1s' });
            jwt.verify(token, this.jwtSecret);
            
            return {
                status: 'healthy',
                activeSessions: this.activeSessions.size,
                refreshTokens: this.refreshTokens.size,
                failedAttempts: this.failedAttempts.size,
                blockedIPs: this.blockedIPs.size
            };
        } catch (error) {
            throw new Error(`AuthService health check failed: ${error.message}`);
        }
    }
}

export default AuthService;