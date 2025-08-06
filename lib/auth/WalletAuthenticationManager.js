/**
 * @fileoverview EIP-4361 Wallet-Based Authentication Manager
 * @author SwappiQ Protocol
 * @description Sign-In with Ethereum (SIWE) implementation with enhanced security
 */

const { SiweMessage } = require('siwe');
const { ethers } = require('ethers');
const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * Wallet Authentication Manager
 * Implements EIP-4361 Sign-In with Ethereum
 */
class WalletAuthenticationManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Domain configuration
            domain: config.domain || 'swappiq.protocol',
            uri: config.uri || 'https://swappiq.protocol',
            chainId: config.chainId || 1, // Ethereum mainnet
            
            // Session configuration
            sessionDuration: config.sessionDuration || 86400000, // 24 hours
            nonceExpiry: config.nonceExpiry || 300000, // 5 minutes
            maxSessions: config.maxSessions || 5, // Max sessions per wallet
            
            // Security settings
            security: {
                requireENS: config.security?.requireENS || false,
                allowedDomains: config.security?.allowedDomains || [],
                blacklistedAddresses: config.security?.blacklistedAddresses || new Set(),
                rateLimiting: {
                    enabled: config.security?.rateLimiting?.enabled !== false,
                    maxAttempts: config.security?.rateLimiting?.maxAttempts || 5,
                    windowMs: config.security?.rateLimiting?.windowMs || 900000 // 15 minutes
                },
                csrfProtection: config.security?.csrfProtection !== false
            },
            
            // Message customization
            messageTemplate: config.messageTemplate || {
                statement: 'Sign this message to authenticate with SwappiQ Protocol',
                notBefore: true,
                requestId: true,
                resources: ['https://swappiq.protocol/api']
            },
            
            // Provider settings
            providers: {
                infura: config.providers?.infura,
                alchemy: config.providers?.alchemy,
                custom: config.providers?.custom
            },
            
            // Audit settings
            auditLogging: config.auditLogging !== false,
            metrics: config.metrics !== false,
            
            ...config
        };

        this.state = {
            nonces: new Map(), // nonce -> { address, createdAt, used }
            sessions: new Map(), // sessionId -> session data
            addressSessions: new Map(), // address -> Set<sessionId>
            rateLimitMap: new Map(), // address -> { attempts, resetTime }
            
            metrics: {
                totalAuthentications: 0,
                failedAuthentications: 0,
                activesSessions: 0,
                revokedSessions: 0,
                averageSessionDuration: 0
            }
        };

        this.provider = null;
        this.ensResolver = null;
        this.sessionStore = null;
        this.csrfTokens = new Map();
        
        this.initialize();
    }

    /**
     * Initialize the authentication manager
     */
    async initialize() {
        try {
            await this._initializeProvider();
            await this._initializeENSResolver();
            await this._startCleanupTasks();
            
            console.log('Wallet Authentication Manager initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Wallet Authentication Manager:', error);
            throw error;
        }
    }

    /**
     * Generate authentication request
     */
    async generateAuthRequest(address, options = {}) {
        try {
            // Validate address
            if (!ethers.utils.isAddress(address)) {
                throw new Error('Invalid Ethereum address');
            }

            // Check blacklist
            if (this.config.security.blacklistedAddresses.has(address.toLowerCase())) {
                throw new Error('Address is blacklisted');
            }

            // Check rate limiting
            if (this.config.security.rateLimiting.enabled) {
                this._checkRateLimit(address);
            }

            // Generate nonce
            const nonce = this._generateNonce();
            
            // Store nonce
            this.state.nonces.set(nonce, {
                address: address.toLowerCase(),
                createdAt: Date.now(),
                used: false,
                ip: options.ip,
                userAgent: options.userAgent
            });

            // Generate CSRF token if enabled
            let csrfToken = null;
            if (this.config.security.csrfProtection) {
                csrfToken = this._generateCSRFToken();
                this.csrfTokens.set(address.toLowerCase(), {
                    token: csrfToken,
                    createdAt: Date.now()
                });
            }

            // Create SIWE message
            const siweMessage = new SiweMessage({
                domain: this.config.domain,
                address,
                statement: options.statement || this.config.messageTemplate.statement,
                uri: options.uri || this.config.uri,
                version: '1',
                chainId: options.chainId || this.config.chainId,
                nonce,
                notBefore: this.config.messageTemplate.notBefore ? new Date().toISOString() : undefined,
                expirationTime: new Date(Date.now() + this.config.nonceExpiry).toISOString(),
                requestId: this.config.messageTemplate.requestId ? crypto.randomBytes(16).toString('hex') : undefined,
                resources: options.resources || this.config.messageTemplate.resources
            });

            const message = siweMessage.prepareMessage();

            await this._auditLog('AUTH_REQUEST_GENERATED', {
                address,
                nonce,
                chainId: siweMessage.chainId,
                domain: siweMessage.domain
            });

            return {
                message,
                nonce,
                csrfToken,
                expiresAt: Date.now() + this.config.nonceExpiry
            };

        } catch (error) {
            console.error('Failed to generate auth request:', error);
            throw error;
        }
    }

    /**
     * Verify and authenticate signed message
     */
    async authenticate(message, signature, options = {}) {
        try {
            const startTime = Date.now();
            
            // Parse SIWE message
            const siweMessage = new SiweMessage(message);
            
            // Verify CSRF token if enabled
            if (this.config.security.csrfProtection && options.csrfToken) {
                this._verifyCSRFToken(siweMessage.address, options.csrfToken);
            }

            // Check nonce
            const nonceData = this.state.nonces.get(siweMessage.nonce);
            if (!nonceData) {
                throw new Error('Invalid or expired nonce');
            }

            if (nonceData.used) {
                throw new Error('Nonce already used');
            }

            if (Date.now() - nonceData.createdAt > this.config.nonceExpiry) {
                throw new Error('Nonce expired');
            }

            // Verify address matches
            if (nonceData.address !== siweMessage.address.toLowerCase()) {
                throw new Error('Address mismatch');
            }

            // Verify signature
            const fields = await siweMessage.verify({ signature });
            
            if (!fields.success) {
                throw new Error('Invalid signature');
            }

            // Mark nonce as used
            nonceData.used = true;

            // Check ENS if required
            if (this.config.security.requireENS) {
                const ensName = await this._resolveENS(siweMessage.address);
                if (!ensName) {
                    throw new Error('ENS name required');
                }
                fields.data.ensName = ensName;
            }

            // Check existing sessions
            await this._checkExistingSessions(siweMessage.address);

            // Create session
            const session = await this._createSession(siweMessage.address, fields.data, options);

            // Update metrics
            this.state.metrics.totalAuthentications++;
            this.state.metrics.activesSessions = this.state.sessions.size;

            const authTime = Date.now() - startTime;
            
            await this._auditLog('AUTHENTICATION_SUCCESS', {
                address: siweMessage.address,
                sessionId: session.id,
                authTime,
                ensName: fields.data.ensName
            });

            this.emit('authenticated', {
                address: siweMessage.address,
                sessionId: session.id,
                ensName: fields.data.ensName
            });

            return session;

        } catch (error) {
            this.state.metrics.failedAuthentications++;
            
            await this._auditLog('AUTHENTICATION_FAILED', {
                error: error.message,
                message: message?.substring(0, 100)
            });

            console.error('Authentication failed:', error);
            throw error;
        }
    }

    /**
     * Validate existing session
     */
    async validateSession(sessionId) {
        try {
            const session = this.state.sessions.get(sessionId);
            
            if (!session) {
                return { valid: false, reason: 'Session not found' };
            }

            // Check expiry
            if (Date.now() > session.expiresAt) {
                await this.revokeSession(sessionId);
                return { valid: false, reason: 'Session expired' };
            }

            // Check if address is still valid
            if (this.config.security.blacklistedAddresses.has(session.address)) {
                await this.revokeSession(sessionId);
                return { valid: false, reason: 'Address blacklisted' };
            }

            // Update last activity
            session.lastActivity = Date.now();

            return {
                valid: true,
                session: {
                    id: session.id,
                    address: session.address,
                    ensName: session.ensName,
                    chainId: session.chainId,
                    expiresAt: session.expiresAt,
                    metadata: session.metadata
                }
            };

        } catch (error) {
            console.error('Session validation failed:', error);
            return { valid: false, reason: 'Validation error' };
        }
    }

    /**
     * Refresh session
     */
    async refreshSession(sessionId) {
        try {
            const session = this.state.sessions.get(sessionId);
            
            if (!session) {
                throw new Error('Session not found');
            }

            // Check if session can be refreshed
            const timeLeft = session.expiresAt - Date.now();
            if (timeLeft <= 0) {
                throw new Error('Session already expired');
            }

            // Extend session
            session.expiresAt = Date.now() + this.config.sessionDuration;
            session.refreshedAt = Date.now();
            session.refreshCount = (session.refreshCount || 0) + 1;

            await this._auditLog('SESSION_REFRESHED', {
                sessionId,
                address: session.address,
                newExpiry: session.expiresAt
            });

            return {
                sessionId,
                expiresAt: session.expiresAt,
                refreshCount: session.refreshCount
            };

        } catch (error) {
            console.error('Session refresh failed:', error);
            throw error;
        }
    }

    /**
     * Revoke session
     */
    async revokeSession(sessionId) {
        try {
            const session = this.state.sessions.get(sessionId);
            
            if (!session) {
                return false;
            }

            // Remove from maps
            this.state.sessions.delete(sessionId);
            
            const addressSessions = this.state.addressSessions.get(session.address);
            if (addressSessions) {
                addressSessions.delete(sessionId);
                if (addressSessions.size === 0) {
                    this.state.addressSessions.delete(session.address);
                }
            }

            // Update metrics
            this.state.metrics.revokedSessions++;
            this.state.metrics.activesSessions = this.state.sessions.size;

            // Calculate session duration
            const duration = Date.now() - session.createdAt;
            this.state.metrics.averageSessionDuration = 
                (this.state.metrics.averageSessionDuration + duration) / 2;

            await this._auditLog('SESSION_REVOKED', {
                sessionId,
                address: session.address,
                duration,
                reason: 'Manual revocation'
            });

            this.emit('sessionRevoked', {
                sessionId,
                address: session.address
            });

            return true;

        } catch (error) {
            console.error('Session revocation failed:', error);
            throw error;
        }
    }

    /**
     * Revoke all sessions for an address
     */
    async revokeAddressSessions(address) {
        try {
            const normalizedAddress = address.toLowerCase();
            const sessions = this.state.addressSessions.get(normalizedAddress);
            
            if (!sessions || sessions.size === 0) {
                return 0;
            }

            let revokedCount = 0;
            for (const sessionId of sessions) {
                if (await this.revokeSession(sessionId)) {
                    revokedCount++;
                }
            }

            await this._auditLog('ADDRESS_SESSIONS_REVOKED', {
                address: normalizedAddress,
                revokedCount
            });

            return revokedCount;

        } catch (error) {
            console.error('Failed to revoke address sessions:', error);
            throw error;
        }
    }

    /**
     * Get active sessions for address
     */
    getAddressSessions(address) {
        const normalizedAddress = address.toLowerCase();
        const sessionIds = this.state.addressSessions.get(normalizedAddress);
        
        if (!sessionIds || sessionIds.size === 0) {
            return [];
        }

        const sessions = [];
        for (const sessionId of sessionIds) {
            const session = this.state.sessions.get(sessionId);
            if (session && Date.now() < session.expiresAt) {
                sessions.push({
                    id: session.id,
                    createdAt: session.createdAt,
                    expiresAt: session.expiresAt,
                    lastActivity: session.lastActivity,
                    metadata: session.metadata
                });
            }
        }

        return sessions;
    }

    /**
     * Update session metadata
     */
    async updateSessionMetadata(sessionId, metadata) {
        try {
            const session = this.state.sessions.get(sessionId);
            
            if (!session) {
                throw new Error('Session not found');
            }

            session.metadata = {
                ...session.metadata,
                ...metadata,
                updatedAt: Date.now()
            };

            await this._auditLog('SESSION_METADATA_UPDATED', {
                sessionId,
                address: session.address
            });

            return true;

        } catch (error) {
            console.error('Failed to update session metadata:', error);
            throw error;
        }
    }

    // ========== PRIVATE METHODS ==========

    async _initializeProvider() {
        if (this.config.providers.custom) {
            this.provider = new ethers.providers.JsonRpcProvider(this.config.providers.custom);
        } else if (this.config.providers.infura) {
            this.provider = new ethers.providers.InfuraProvider(
                this.config.chainId,
                this.config.providers.infura
            );
        } else if (this.config.providers.alchemy) {
            this.provider = new ethers.providers.AlchemyProvider(
                this.config.chainId,
                this.config.providers.alchemy
            );
        } else {
            this.provider = ethers.getDefaultProvider(this.config.chainId);
        }
    }

    async _initializeENSResolver() {
        if (this.provider && this.config.chainId === 1) { // ENS only on mainnet
            this.ensResolver = new ethers.providers.EnsResolver(this.provider);
        }
    }

    async _startCleanupTasks() {
        // Clean up expired nonces
        setInterval(() => {
            const now = Date.now();
            for (const [nonce, data] of this.state.nonces.entries()) {
                if (now - data.createdAt > this.config.nonceExpiry) {
                    this.state.nonces.delete(nonce);
                }
            }
        }, 60000); // Every minute

        // Clean up expired sessions
        setInterval(() => {
            const now = Date.now();
            for (const [sessionId, session] of this.state.sessions.entries()) {
                if (now > session.expiresAt) {
                    this.revokeSession(sessionId);
                }
            }
        }, 300000); // Every 5 minutes

        // Clean up rate limit data
        setInterval(() => {
            const now = Date.now();
            for (const [address, data] of this.state.rateLimitMap.entries()) {
                if (now > data.resetTime) {
                    this.state.rateLimitMap.delete(address);
                }
            }
        }, 900000); // Every 15 minutes
    }

    _generateNonce() {
        return crypto.randomBytes(16).toString('hex');
    }

    _generateCSRFToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    _verifyCSRFToken(address, token) {
        const storedData = this.csrfTokens.get(address.toLowerCase());
        
        if (!storedData || storedData.token !== token) {
            throw new Error('Invalid CSRF token');
        }

        if (Date.now() - storedData.createdAt > this.config.nonceExpiry) {
            throw new Error('CSRF token expired');
        }

        // Remove used token
        this.csrfTokens.delete(address.toLowerCase());
    }

    _checkRateLimit(address) {
        const now = Date.now();
        const normalizedAddress = address.toLowerCase();
        
        let limitData = this.state.rateLimitMap.get(normalizedAddress);
        
        if (!limitData || now > limitData.resetTime) {
            limitData = {
                attempts: 0,
                resetTime: now + this.config.security.rateLimiting.windowMs
            };
            this.state.rateLimitMap.set(normalizedAddress, limitData);
        }

        limitData.attempts++;

        if (limitData.attempts > this.config.security.rateLimiting.maxAttempts) {
            throw new Error('Rate limit exceeded');
        }
    }

    async _resolveENS(address) {
        if (!this.provider || this.config.chainId !== 1) {
            return null;
        }

        try {
            return await this.provider.lookupAddress(address);
        } catch (error) {
            console.warn('ENS resolution failed:', error);
            return null;
        }
    }

    async _checkExistingSessions(address) {
        const normalizedAddress = address.toLowerCase();
        const existingSessions = this.state.addressSessions.get(normalizedAddress);
        
        if (existingSessions && existingSessions.size >= this.config.maxSessions) {
            // Remove oldest session
            let oldestSession = null;
            let oldestTime = Infinity;
            
            for (const sessionId of existingSessions) {
                const session = this.state.sessions.get(sessionId);
                if (session && session.createdAt < oldestTime) {
                    oldestTime = session.createdAt;
                    oldestSession = sessionId;
                }
            }
            
            if (oldestSession) {
                await this.revokeSession(oldestSession);
            }
        }
    }

    async _createSession(address, siweData, options) {
        const sessionId = crypto.randomBytes(32).toString('hex');
        const normalizedAddress = address.toLowerCase();
        
        const session = {
            id: sessionId,
            address: normalizedAddress,
            chainId: siweData.chainId,
            domain: siweData.domain,
            ensName: siweData.ensName,
            createdAt: Date.now(),
            expiresAt: Date.now() + this.config.sessionDuration,
            lastActivity: Date.now(),
            refreshCount: 0,
            metadata: {
                ip: options.ip,
                userAgent: options.userAgent,
                ...options.metadata
            }
        };

        // Store session
        this.state.sessions.set(sessionId, session);
        
        // Update address sessions
        if (!this.state.addressSessions.has(normalizedAddress)) {
            this.state.addressSessions.set(normalizedAddress, new Set());
        }
        this.state.addressSessions.get(normalizedAddress).add(sessionId);

        return session;
    }

    async _auditLog(action, details) {
        if (!this.config.auditLogging) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'WalletAuthenticationManager'
        };

        this.emit('auditLog', logEntry);
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            nonces: {
                active: this.state.nonces.size,
                expired: 0 // Would need tracking
            },
            rateLimiting: {
                tracked: this.state.rateLimitMap.size
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.state.nonces.clear();
        this.state.sessions.clear();
        this.state.addressSessions.clear();
        this.state.rateLimitMap.clear();
        this.csrfTokens.clear();
        
        console.log('Wallet Authentication Manager cleaned up');
    }
}

module.exports = { WalletAuthenticationManager };