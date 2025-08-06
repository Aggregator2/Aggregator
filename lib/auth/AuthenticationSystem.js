/**
 * @title Comprehensive Authentication System
 * @author DEX Security Team
 * @notice Complete authentication system with OAuth2, JWT, and wallet support
 * @dev Implements multiple authentication methods with security best practices
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { ethers } = require('ethers');
const Redis = require('redis');

class AuthenticationSystem {
    constructor(config) {
        this.config = {
            jwtSecret: config.jwtSecret || process.env.JWT_SECRET,
            jwtRefreshSecret: config.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET,
            jwtExpiresIn: config.jwtExpiresIn || '15m',
            refreshTokenExpiresIn: config.refreshTokenExpiresIn || '7d',
            bcryptRounds: config.bcryptRounds || 12,
            maxLoginAttempts: config.maxLoginAttempts || 5,
            lockoutDuration: config.lockoutDuration || 900000, // 15 minutes
            sessionDuration: config.sessionDuration || 3600000, // 1 hour
            requireEmailVerification: config.requireEmailVerification || true,
            require2FA: config.require2FA || false,
            ...config
        };

        // Initialize Redis for session management
        this.redisClient = Redis.createClient(config.redis || {});
        this.redisClient.on('error', (err) => console.error('Redis Client Error', err));
        
        // Authentication providers
        this.providers = new Map();
        this.walletAuth = new WalletAuthentication(config);
        this.oauth2Provider = new OAuth2Provider(config);
        this.jwtManager = new JWTManager(this.config);
        this.sessionManager = new SessionManager(this.redisClient, config);
        this.twoFactorAuth = new TwoFactorAuthentication(config);
        
        // Security tracking
        this.securityLogger = new SecurityLogger(config);
        this.rateLimiter = new AuthRateLimiter(this.redisClient, config);
        this.loginAttempts = new Map(); // Track failed login attempts
        
        this._initializeProviders();
        this._startSecurityMonitoring();
    }

    /**
     * Initialize the authentication system
     */
    async initialize() {
        try {
            await this.redisClient.connect();
            await this._loadSecurityConfig();
            console.log('Authentication system initialized successfully');
        } catch (error) {
            console.error('Failed to initialize authentication system:', error);
            throw error;
        }
    }

    /**
     * Authenticate user with email/password
     * @param {string} email User email
     * @param {string} password User password
     * @param {string} clientIp Client IP address
     * @param {string} userAgent User agent string
     * @returns {Promise<Object>} Authentication result
     */
    async authenticateWithPassword(email, password, clientIp, userAgent) {
        try {
            // Rate limiting
            await this.rateLimiter.checkAuthLimit(clientIp);
            
            // Check if account is locked
            const lockStatus = await this._checkAccountLock(email);
            if (lockStatus.isLocked) {
                throw new AuthenticationError('Account temporarily locked due to failed login attempts');
            }

            // Find user
            const user = await this._findUserByEmail(email);
            if (!user) {
                await this._recordFailedAttempt(email, clientIp);
                throw new AuthenticationError('Invalid credentials');
            }

            // Verify password
            const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
            if (!isPasswordValid) {
                await this._recordFailedAttempt(email, clientIp);
                throw new AuthenticationError('Invalid credentials');
            }

            // Check if email is verified
            if (this.config.requireEmailVerification && !user.emailVerified) {
                throw new AuthenticationError('Email verification required');
            }

            // Check if 2FA is required
            if (user.twoFactorEnabled || this.config.require2FA) {
                return {
                    requiresTwoFactor: true,
                    userId: user.id,
                    tempToken: await this._generateTempToken(user.id)
                };
            }

            // Generate tokens and session
            const authResult = await this._generateAuthTokens(user, clientIp, userAgent);
            
            // Clear failed attempts
            await this._clearFailedAttempts(email);
            
            // Log successful authentication
            await this.securityLogger.logAuthentication({
                userId: user.id,
                method: 'password',
                success: true,
                clientIp,
                userAgent
            });

            return authResult;

        } catch (error) {
            await this.securityLogger.logAuthentication({
                email,
                method: 'password',
                success: false,
                error: error.message,
                clientIp,
                userAgent
            });
            throw error;
        }
    }

    /**
     * Authenticate with wallet signature (EIP-4361)
     * @param {string} address Ethereum address
     * @param {string} signature Signed message
     * @param {string} message Original message
     * @param {string} clientIp Client IP address
     * @param {string} userAgent User agent string
     * @returns {Promise<Object>} Authentication result
     */
    async authenticateWithWallet(address, signature, message, clientIp, userAgent) {
        try {
            await this.rateLimiter.checkAuthLimit(clientIp);

            // Verify EIP-4361 signature
            const isValidSignature = await this.walletAuth.verifySignature(
                address, 
                signature, 
                message
            );

            if (!isValidSignature) {
                throw new AuthenticationError('Invalid wallet signature');
            }

            // Find or create user
            let user = await this._findUserByWallet(address);
            if (!user) {
                user = await this._createWalletUser(address);
            }

            // Generate tokens and session
            const authResult = await this._generateAuthTokens(user, clientIp, userAgent);

            await this.securityLogger.logAuthentication({
                userId: user.id,
                walletAddress: address,
                method: 'wallet',
                success: true,
                clientIp,
                userAgent
            });

            return authResult;

        } catch (error) {
            await this.securityLogger.logAuthentication({
                walletAddress: address,
                method: 'wallet',
                success: false,
                error: error.message,
                clientIp,
                userAgent
            });
            throw error;
        }
    }

    /**
     * Complete 2FA authentication
     * @param {string} tempToken Temporary token from initial auth
     * @param {string} totpCode TOTP code from authenticator
     * @param {string} clientIp Client IP address
     * @param {string} userAgent User agent string
     * @returns {Promise<Object>} Authentication result
     */
    async completeTwoFactorAuth(tempToken, totpCode, clientIp, userAgent) {
        try {
            // Verify temp token
            const tempPayload = await this.jwtManager.verifyTempToken(tempToken);
            const user = await this._findUserById(tempPayload.userId);

            if (!user) {
                throw new AuthenticationError('Invalid authentication state');
            }

            // Verify TOTP code
            const isValidCode = await this.twoFactorAuth.verifyTOTP(
                user.twoFactorSecret, 
                totpCode
            );

            if (!isValidCode) {
                throw new AuthenticationError('Invalid 2FA code');
            }

            // Generate full auth tokens
            const authResult = await this._generateAuthTokens(user, clientIp, userAgent);

            await this.securityLogger.logAuthentication({
                userId: user.id,
                method: '2fa_completion',
                success: true,
                clientIp,
                userAgent
            });

            return authResult;

        } catch (error) {
            await this.securityLogger.logAuthentication({
                method: '2fa_completion',
                success: false,
                error: error.message,
                clientIp,
                userAgent
            });
            throw error;
        }
    }

    /**
     * Refresh access token using refresh token
     * @param {string} refreshToken Refresh token
     * @param {string} clientIp Client IP address
     * @returns {Promise<Object>} New tokens
     */
    async refreshAccessToken(refreshToken, clientIp) {
        try {
            // Verify refresh token
            const payload = await this.jwtManager.verifyRefreshToken(refreshToken);
            
            // Check if session is still valid
            const session = await this.sessionManager.getSession(payload.sessionId);
            if (!session || session.userId !== payload.userId) {
                throw new AuthenticationError('Invalid session');
            }

            // Get user details
            const user = await this._findUserById(payload.userId);
            if (!user) {
                throw new AuthenticationError('User not found');
            }

            // Generate new access token
            const newAccessToken = await this.jwtManager.generateAccessToken(user, payload.sessionId);

            await this.securityLogger.logTokenRefresh({
                userId: user.id,
                sessionId: payload.sessionId,
                clientIp
            });

            return {
                accessToken: newAccessToken,
                expiresIn: this.config.jwtExpiresIn
            };

        } catch (error) {
            await this.securityLogger.logTokenRefresh({
                success: false,
                error: error.message,
                clientIp
            });
            throw error;
        }
    }

    /**
     * Logout user and invalidate session
     * @param {string} accessToken Access token
     * @param {string} refreshToken Refresh token (optional)
     * @returns {Promise<void>}
     */
    async logout(accessToken, refreshToken = null) {
        try {
            const payload = await this.jwtManager.verifyAccessToken(accessToken);
            
            // Invalidate session
            await this.sessionManager.invalidateSession(payload.sessionId);
            
            // Add tokens to blacklist
            await this.jwtManager.blacklistToken(accessToken);
            if (refreshToken) {
                await this.jwtManager.blacklistToken(refreshToken);
            }

            await this.securityLogger.logLogout({
                userId: payload.userId,
                sessionId: payload.sessionId
            });

        } catch (error) {
            console.error('Logout error:', error);
            // Don't throw error for logout failures
        }
    }

    /**
     * Setup 2FA for user
     * @param {string} userId User ID
     * @returns {Promise<Object>} 2FA setup details
     */
    async setup2FA(userId) {
        try {
            const user = await this._findUserById(userId);
            if (!user) {
                throw new AuthenticationError('User not found');
            }

            const secret = speakeasy.generateSecret({
                name: `DEX (${user.email || user.walletAddress})`,
                issuer: 'DEX Platform'
            });

            // Store temporary secret (not enabled until verified)
            await this._storeTempTwoFactorSecret(userId, secret.base32);

            const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

            return {
                secret: secret.base32,
                qrCode: qrCodeUrl,
                manualEntryKey: secret.base32
            };

        } catch (error) {
            console.error('2FA setup error:', error);
            throw error;
        }
    }

    /**
     * Verify and enable 2FA
     * @param {string} userId User ID
     * @param {string} totpCode TOTP code
     * @returns {Promise<Array>} Backup codes
     */
    async enable2FA(userId, totpCode) {
        try {
            const tempSecret = await this._getTempTwoFactorSecret(userId);
            if (!tempSecret) {
                throw new AuthenticationError('2FA setup not initiated');
            }

            const isValidCode = await this.twoFactorAuth.verifyTOTP(tempSecret, totpCode);
            if (!isValidCode) {
                throw new AuthenticationError('Invalid 2FA code');
            }

            // Generate backup codes
            const backupCodes = this._generateBackupCodes();
            const hashedBackupCodes = await Promise.all(
                backupCodes.map(code => bcrypt.hash(code, 10))
            );

            // Enable 2FA for user
            await this._enable2FAForUser(userId, tempSecret, hashedBackupCodes);
            
            // Clean up temporary secret
            await this._clearTempTwoFactorSecret(userId);

            await this.securityLogger.log2FAEnabled({ userId });

            return backupCodes;

        } catch (error) {
            console.error('2FA enable error:', error);
            throw error;
        }
    }

    /**
     * Disable 2FA for user
     * @param {string} userId User ID
     * @param {string} totpCode Current TOTP code for verification
     * @returns {Promise<void>}
     */
    async disable2FA(userId, totpCode) {
        try {
            const user = await this._findUserById(userId);
            if (!user || !user.twoFactorSecret) {
                throw new AuthenticationError('2FA not enabled');
            }

            const isValidCode = await this.twoFactorAuth.verifyTOTP(
                user.twoFactorSecret, 
                totpCode
            );

            if (!isValidCode) {
                throw new AuthenticationError('Invalid 2FA code');
            }

            await this._disable2FAForUser(userId);
            
            await this.securityLogger.log2FADisabled({ userId });

        } catch (error) {
            console.error('2FA disable error:', error);
            throw error;
        }
    }

    // =============================================================================
    // PRIVATE HELPER METHODS
    // =============================================================================

    /**
     * Generate authentication tokens and create session
     * @param {Object} user User object
     * @param {string} clientIp Client IP
     * @param {string} userAgent User agent
     * @returns {Promise<Object>} Auth tokens and user info
     * @private
     */
    async _generateAuthTokens(user, clientIp, userAgent) {
        // Create session
        const session = await this.sessionManager.createSession({
            userId: user.id,
            clientIp,
            userAgent,
            createdAt: Date.now()
        });

        // Generate tokens
        const accessToken = await this.jwtManager.generateAccessToken(user, session.id);
        const refreshToken = await this.jwtManager.generateRefreshToken(user, session.id);

        return {
            accessToken,
            refreshToken,
            expiresIn: this.config.jwtExpiresIn,
            user: {
                id: user.id,
                email: user.email,
                walletAddress: user.walletAddress,
                roles: user.roles || [],
                twoFactorEnabled: user.twoFactorEnabled || false,
                emailVerified: user.emailVerified || false
            },
            sessionId: session.id
        };
    }

    /**
     * Check if account is locked due to failed attempts
     * @param {string} email User email
     * @returns {Promise<Object>} Lock status
     * @private
     */
    async _checkAccountLock(email) {
        const attempts = this.loginAttempts.get(email);
        if (!attempts) {
            return { isLocked: false };
        }

        if (attempts.count >= this.config.maxLoginAttempts) {
            const timeLeft = attempts.lockUntil - Date.now();
            if (timeLeft > 0) {
                return { 
                    isLocked: true, 
                    timeLeft: Math.ceil(timeLeft / 1000) 
                };
            } else {
                // Lock expired, clear attempts
                this.loginAttempts.delete(email);
                return { isLocked: false };
            }
        }

        return { isLocked: false };
    }

    /**
     * Record failed login attempt
     * @param {string} email User email
     * @param {string} clientIp Client IP
     * @private
     */
    async _recordFailedAttempt(email, clientIp) {
        const attempts = this.loginAttempts.get(email) || { count: 0, ips: new Set() };
        attempts.count++;
        attempts.ips.add(clientIp);
        attempts.lastAttempt = Date.now();

        if (attempts.count >= this.config.maxLoginAttempts) {
            attempts.lockUntil = Date.now() + this.config.lockoutDuration;
        }

        this.loginAttempts.set(email, attempts);

        await this.securityLogger.logFailedAttempt({
            email,
            clientIp,
            attemptCount: attempts.count
        });
    }

    /**
     * Clear failed login attempts
     * @param {string} email User email
     * @private
     */
    async _clearFailedAttempts(email) {
        this.loginAttempts.delete(email);
    }

    /**
     * Generate temporary token for 2FA flow
     * @param {string} userId User ID
     * @returns {Promise<string>} Temporary token
     * @private
     */
    async _generateTempToken(userId) {
        return jwt.sign(
            { userId, type: 'temp' },
            this.config.jwtSecret,
            { expiresIn: '5m' } // 5 minute expiry
        );
    }

    /**
     * Generate backup codes for 2FA
     * @returns {Array} Backup codes
     * @private
     */
    _generateBackupCodes() {
        const codes = [];
        for (let i = 0; i < 10; i++) {
            codes.push(crypto.randomBytes(4).toString('hex'));
        }
        return codes;
    }

    /**
     * Initialize authentication providers
     * @private
     */
    _initializeProviders() {
        // Register OAuth2 providers
        this.providers.set('google', new GoogleOAuthProvider(this.config.oauth.google));
        this.providers.set('github', new GitHubOAuthProvider(this.config.oauth.github));
        this.providers.set('discord', new DiscordOAuthProvider(this.config.oauth.discord));
    }

    /**
     * Start security monitoring
     * @private
     */
    _startSecurityMonitoring() {
        // Clean up expired login attempts
        setInterval(() => {
            const now = Date.now();
            for (const [email, attempts] of this.loginAttempts.entries()) {
                if (attempts.lockUntil && attempts.lockUntil < now) {
                    this.loginAttempts.delete(email);
                }
            }
        }, 60000); // Every minute

        // Monitor suspicious activity
        setInterval(async () => {
            await this._detectSuspiciousActivity();
        }, 300000); // Every 5 minutes
    }

    /**
     * Detect suspicious authentication activity
     * @private
     */
    async _detectSuspiciousActivity() {
        // Check for unusual login patterns
        // Implementation would analyze login attempts, IPs, etc.
        const suspiciousPatterns = await this.securityLogger.detectSuspiciousPatterns();
        
        if (suspiciousPatterns.length > 0) {
            await this.securityLogger.logSuspiciousActivity(suspiciousPatterns);
        }
    }

    // Database operation placeholders (implement with your database)
    async _findUserByEmail(email) {
        // Implementation depends on your database
        return null;
    }

    async _findUserById(userId) {
        // Implementation depends on your database
        return null;
    }

    async _findUserByWallet(address) {
        // Implementation depends on your database
        return null;
    }

    async _createWalletUser(address) {
        // Implementation depends on your database
        return { id: crypto.randomUUID(), walletAddress: address };
    }

    async _storeTempTwoFactorSecret(userId, secret) {
        await this.redisClient.setEx(`temp_2fa:${userId}`, 600, secret); // 10 minutes
    }

    async _getTempTwoFactorSecret(userId) {
        return await this.redisClient.get(`temp_2fa:${userId}`);
    }

    async _clearTempTwoFactorSecret(userId) {
        await this.redisClient.del(`temp_2fa:${userId}`);
    }

    async _enable2FAForUser(userId, secret, backupCodes) {
        // Implementation depends on your database
        console.log(`Enabling 2FA for user ${userId}`);
    }

    async _disable2FAForUser(userId) {
        // Implementation depends on your database
        console.log(`Disabling 2FA for user ${userId}`);
    }

    async _loadSecurityConfig() {
        // Load security configuration from database
        console.log('Loading security configuration');
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Validate access token and return user context
     * @param {string} token Access token
     * @returns {Promise<Object>} User context
     */
    async validateToken(token) {
        try {
            const payload = await this.jwtManager.verifyAccessToken(token);
            
            // Check if session is still valid
            const session = await this.sessionManager.getSession(payload.sessionId);
            if (!session) {
                throw new AuthenticationError('Session expired');
            }

            return {
                userId: payload.userId,
                sessionId: payload.sessionId,
                roles: payload.roles || [],
                permissions: payload.permissions || []
            };

        } catch (error) {
            throw new AuthenticationError('Invalid token');
        }
    }

    /**
     * Get authentication statistics
     * @returns {Object} Authentication statistics
     */
    getAuthStatistics() {
        return {
            activeSessions: this.sessionManager.getActiveSessionCount(),
            failedAttempts: this.loginAttempts.size,
            providersRegistered: this.providers.size,
            securityEvents: this.securityLogger.getEventCount()
        };
    }

    /**
     * Get health status
     * @returns {Promise<Object>} Health status
     */
    async getHealthStatus() {
        try {
            const redisStatus = this.redisClient.isReady ? 'healthy' : 'unhealthy';
            const sessionCount = await this.sessionManager.getActiveSessionCount();
            
            return {
                status: redisStatus === 'healthy' ? 'healthy' : 'degraded',
                redis: redisStatus,
                activeSessions: sessionCount,
                failedAttempts: this.loginAttempts.size,
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
// AUTHENTICATION ERROR CLASS
// =============================================================================

class AuthenticationError extends Error {
    constructor(message, code = 'AUTH_ERROR') {
        super(message);
        this.name = 'AuthenticationError';
        this.code = code;
    }
}

module.exports = { 
    AuthenticationSystem, 
    AuthenticationError 
};