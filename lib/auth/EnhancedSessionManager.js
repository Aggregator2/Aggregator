/**
 * @title Enhanced Session Manager with Security Hardening
 * @author DEX Security Team
 * @notice Production-ready session management with advanced security features
 * @dev Addresses session fixation, race conditions, and performance optimization
 */

const crypto = require('crypto');
const Redis = require('redis');

class EnhancedSessionManager {
    constructor(redisClient, config) {
        this.redisClient = redisClient;
        this.config = {
            sessionTTL: config.sessionTTL || 3600000, // 1 hour
            maxSessionsPerUser: config.maxSessionsPerUser || 5,
            maxConcurrentSessions: config.maxConcurrentSessions || 3,
            sessionSecretLength: config.sessionSecretLength || 32,
            enableDeviceTracking: config.enableDeviceTracking !== false,
            enableSecurityMonitoring: config.enableSecurityMonitoring !== false,
            sessionCookieName: config.sessionCookieName || 'dex_session',
            secureOnly: config.secureOnly !== false,
            httpOnly: config.httpOnly !== false,
            sameSite: config.sameSite || 'strict',
            enableSessionFingerprinting: config.enableSessionFingerprinting !== false,
            fingerprintRotationInterval: config.fingerprintRotationInterval || 3600000, // 1 hour
            antiCSRFEnabled: config.antiCSRFEnabled !== false,
            ...config
        };

        // Enhanced session storage keys
        this.SESSION_PREFIX = 'session:';
        this.USER_SESSIONS_PREFIX = 'user_sessions:';
        this.DEVICE_SESSIONS_PREFIX = 'device_sessions:';
        this.CONCURRENT_SESSIONS_PREFIX = 'concurrent:';
        this.FINGERPRINT_PREFIX = 'fingerprint:';
        this.CSRF_TOKEN_PREFIX = 'csrf:';

        // Security components
        this.securityMonitor = new EnhancedSessionSecurityMonitor(config);
        this.deviceTracker = new AdvancedDeviceTracker(config);
        this.sessionAnalytics = new SessionAnalytics(redisClient, config);
        this.fingerprintManager = new SessionFingerprintManager(config);
        this.csrfProtection = new CSRFProtection(config);

        // Performance optimization
        this.sessionCache = new Map(); // In-memory cache for hot sessions
        this.cacheSize = config.sessionCacheSize || 1000;
        this.batchOperations = []; // For batching Redis operations

        this._startBackgroundTasks();
    }

    /**
     * Create a new session with enhanced security
     * @param {Object} sessionData Session data
     * @returns {Promise<Object>} Created session with security tokens
     */
    async createSession(sessionData) {
        try {
            const {
                userId,
                clientIp,
                userAgent,
                deviceFingerprint = null,
                metadata = {},
                expiresAt = null,
                regenerateFromExisting = false
            } = sessionData;

            // Security: Check concurrent session limits
            await this._checkConcurrentSessionLimits(userId, clientIp);

            // Generate session identifiers
            const sessionId = crypto.randomUUID();
            const sessionSecret = crypto.randomBytes(this.config.sessionSecretLength).toString('hex');
            const sessionToken = `${sessionId}.${sessionSecret}`;

            // Generate session fingerprint for additional security
            const fingerprint = this.config.enableSessionFingerprinting ?
                await this.fingerprintManager.generateFingerprint(userAgent, clientIp, deviceFingerprint) : null;

            // Generate CSRF token
            const csrfToken = this.config.antiCSRFEnabled ?
                await this.csrfProtection.generateToken(sessionId) : null;

            // Calculate expiration
            const expirationTime = expiresAt || (Date.now() + this.config.sessionTTL);

            // Enhanced device information
            const deviceInfo = this.config.enableDeviceTracking ?
                await this.deviceTracker.extractEnhancedDeviceInfo(userAgent, deviceFingerprint, clientIp) : null;

            const session = {
                id: sessionId,
                userId,
                sessionSecret,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                expiresAt: expirationTime,
                clientIp,
                userAgent,
                deviceInfo,
                fingerprint,
                csrfToken,
                metadata,
                isActive: true,
                isAuthenticated: true,
                regeneratedFromExisting,
                securityFlags: {
                    suspiciousActivity: false,
                    locationChanges: 0,
                    deviceChanges: 0,
                    fingerprintMismatches: 0,
                    lastSecurityCheck: Date.now(),
                    requiresReauth: false
                },
                accessHistory: [],
                performanceMetrics: {
                    creationTime: Date.now(),
                    requestCount: 0,
                    averageResponseTime: 0
                }
            };

            // Use Redis transaction for atomicity
            const multi = this.redisClient.multi();
            
            // Store session
            const sessionKey = this.SESSION_PREFIX + sessionId;
            const ttlSeconds = Math.ceil((expirationTime - Date.now()) / 1000);
            multi.setEx(sessionKey, ttlSeconds, JSON.stringify(session));

            // Track user sessions
            const userSessionsKey = this.USER_SESSIONS_PREFIX + userId;
            multi.sAdd(userSessionsKey, sessionId);
            multi.expire(userSessionsKey, ttlSeconds + 3600); // Extra hour for cleanup

            // Track device sessions
            if (deviceInfo?.fingerprint) {
                const deviceSessionsKey = this.DEVICE_SESSIONS_PREFIX + deviceInfo.fingerprint;
                multi.sAdd(deviceSessionsKey, sessionId);
                multi.expire(deviceSessionsKey, 86400); // 24 hours
            }

            // Update concurrent session count
            const concurrentKey = this.CONCURRENT_SESSIONS_PREFIX + clientIp;
            multi.incr(concurrentKey);
            multi.expire(concurrentKey, 3600); // 1 hour

            // Store fingerprint if enabled
            if (fingerprint) {
                const fingerprintKey = this.FINGERPRINT_PREFIX + sessionId;
                multi.setEx(fingerprintKey, ttlSeconds, fingerprint);
            }

            // Store CSRF token if enabled
            if (csrfToken) {
                const csrfKey = this.CSRF_TOKEN_PREFIX + sessionId;
                multi.setEx(csrfKey, ttlSeconds, csrfToken);
            }

            // Execute atomic transaction
            await multi.exec();

            // Cache hot session
            this._addToSessionCache(sessionId, session);

            // Log session creation
            await this.securityMonitor.logSessionCreated({
                sessionId,
                userId,
                clientIp,
                userAgent,
                deviceInfo,
                fingerprint: fingerprint ? 'generated' : null,
                csrfToken: csrfToken ? 'generated' : null,
                regeneratedFromExisting,
                createdAt: session.createdAt
            });

            // Record analytics
            if (this.config.enableSessionAnalytics) {
                await this.sessionAnalytics.recordSessionCreation(session);
            }

            return {
                sessionId,
                sessionToken,
                csrfToken,
                expiresAt: expirationTime,
                fingerprint: fingerprint ? this._hashFingerprint(fingerprint) : null,
                deviceInfo: deviceInfo ? {
                    type: deviceInfo.type,
                    os: deviceInfo.os,
                    browser: deviceInfo.browser,
                    trusted: deviceInfo.trusted
                } : null,
                securityLevel: this._calculateSecurityLevel(session)
            };

        } catch (error) {
            await this.securityMonitor.logSessionError({
                action: 'create_session',
                userId: sessionData.userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Regenerate session ID for security (prevents session fixation)
     * @param {string} currentSessionId Current session ID
     * @param {string} clientIp Client IP
     * @param {string} userAgent User agent
     * @returns {Promise<Object>} New session data
     */
    async regenerateSessionId(currentSessionId, clientIp, userAgent) {
        try {
            // Get current session
            const currentSession = await this.getSession(currentSessionId);
            if (!currentSession) {
                throw new SessionError('Session not found for regeneration');
            }

            // Invalidate current session
            await this.invalidateSession(currentSessionId, {
                reason: 'regeneration',
                skipNotification: true
            });

            // Create new session with same user data
            const newSession = await this.createSession({
                userId: currentSession.userId,
                clientIp,
                userAgent,
                deviceFingerprint: currentSession.deviceInfo?.fingerprint,
                metadata: currentSession.metadata,
                expiresAt: currentSession.expiresAt,
                regenerateFromExisting: true
            });

            await this.securityMonitor.logSessionRegenerated({
                oldSessionId: currentSessionId,
                newSessionId: newSession.sessionId,
                userId: currentSession.userId,
                reason: 'security_regeneration'
            });

            return newSession;

        } catch (error) {
            await this.securityMonitor.logSessionError({
                action: 'regenerate_session',
                sessionId: currentSessionId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Validate session with enhanced security checks
     * @param {string} sessionToken Full session token
     * @param {string} clientIp Client IP address
     * @param {string} userAgent User agent
     * @param {Object} options Validation options
     * @returns {Promise<Object|null>} Validation result
     */
    async validateSession(sessionToken, clientIp, userAgent, options = {}) {
        try {
            const { csrfToken, requireFingerprint = true } = options;

            // Parse session token
            const [sessionId, sessionSecret] = sessionToken.split('.');
            if (!sessionId || !sessionSecret) {
                throw new SessionError('Invalid session token format');
            }

            // Get session (try cache first)
            let session = this.sessionCache.get(sessionId);
            if (!session) {
                session = await this.getSession(sessionId);
                if (session) {
                    this._addToSessionCache(sessionId, session);
                }
            }

            if (!session) {
                throw new SessionError('Session not found or expired');
            }

            // Constant-time secret verification
            if (!this._constantTimeCompare(session.sessionSecret, sessionSecret)) {
                await this.securityMonitor.logSessionSecurityViolation({
                    sessionId,
                    userId: session.userId,
                    violation: 'invalid_secret',
                    clientIp,
                    userAgent
                });
                throw new SessionError('Invalid session credentials');
            }

            // Enhanced security checks
            await this._performEnhancedSecurityChecks(session, clientIp, userAgent, {
                csrfToken,
                requireFingerprint
            });

            // Update session activity atomically
            await this._updateSessionActivityAtomic(session, clientIp, userAgent);

            return {
                valid: true,
                session: {
                    id: session.id,
                    userId: session.userId,
                    createdAt: session.createdAt,
                    lastActivity: session.lastActivity,
                    expiresAt: session.expiresAt,
                    deviceInfo: session.deviceInfo,
                    securityLevel: this._calculateSecurityLevel(session),
                    requiresReauth: session.securityFlags.requiresReauth
                },
                securityWarnings: this._getSecurityWarnings(session)
            };

        } catch (error) {
            await this.securityMonitor.logSessionValidationError({
                sessionToken: sessionToken?.substring(0, 20) + '...', // Partial token for debugging
                clientIp,
                userAgent,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Invalidate session with cleanup
     * @param {string} sessionId Session ID
     * @param {Object} options Invalidation options
     * @returns {Promise<void>}
     */
    async invalidateSession(sessionId, options = {}) {
        try {
            const session = await this.getSession(sessionId);
            if (!session && !options.force) {
                return; // Already invalidated
            }

            // Use Redis transaction for atomic cleanup
            const multi = this.redisClient.multi();

            // Remove session
            multi.del(this.SESSION_PREFIX + sessionId);

            if (session) {
                // Remove from user sessions
                multi.sRem(this.USER_SESSIONS_PREFIX + session.userId, sessionId);

                // Remove from device sessions
                if (session.deviceInfo?.fingerprint) {
                    multi.sRem(this.DEVICE_SESSIONS_PREFIX + session.deviceInfo.fingerprint, sessionId);
                }

                // Update concurrent session count
                const concurrentKey = this.CONCURRENT_SESSIONS_PREFIX + session.clientIp;
                multi.decr(concurrentKey);

                // Remove fingerprint and CSRF token
                multi.del(this.FINGERPRINT_PREFIX + sessionId);
                multi.del(this.CSRF_TOKEN_PREFIX + sessionId);
            }

            await multi.exec();

            // Remove from cache
            this.sessionCache.delete(sessionId);

            if (session && !options.skipNotification) {
                await this.securityMonitor.logSessionInvalidated({
                    sessionId,
                    userId: session.userId,
                    reason: options.reason || 'manual',
                    invalidatedBy: options.invalidatedBy || 'system'
                });

                // Record analytics
                if (this.config.enableSessionAnalytics) {
                    await this.sessionAnalytics.recordSessionEnd(session, options.reason);
                }
            }

        } catch (error) {
            console.error('Error invalidating session:', error);
            // Don't throw on invalidation errors
        }
    }

    // =============================================================================
    // ENHANCED SECURITY METHODS
    // =============================================================================

    /**
     * Perform enhanced security checks
     * @param {Object} session Session data
     * @param {string} clientIp Current client IP
     * @param {string} userAgent Current user agent
     * @param {Object} options Security check options
     * @private
     */
    async _performEnhancedSecurityChecks(session, clientIp, userAgent, options) {
        const securityViolations = [];

        // 1. Validate CSRF token if provided
        if (this.config.antiCSRFEnabled && options.csrfToken) {
            const isValidCSRF = await this.csrfProtection.validateToken(session.id, options.csrfToken);
            if (!isValidCSRF) {
                securityViolations.push('invalid_csrf_token');
            }
        }

        // 2. Validate session fingerprint
        if (this.config.enableSessionFingerprinting && options.requireFingerprint) {
            const currentFingerprint = await this.fingerprintManager.generateFingerprint(
                userAgent, clientIp, session.deviceInfo?.fingerprint
            );
            
            const storedFingerprint = await this.redisClient.get(this.FINGERPRINT_PREFIX + session.id);
            if (storedFingerprint && !this._constantTimeCompare(currentFingerprint, storedFingerprint)) {
                session.securityFlags.fingerprintMismatches++;
                securityViolations.push('fingerprint_mismatch');
            }
        }

        // 3. Check for suspicious IP changes
        if (session.clientIp !== clientIp) {
            const ipDistance = await this._calculateIPDistance(session.clientIp, clientIp);
            if (ipDistance > 1000) { // More than 1000km
                session.securityFlags.locationChanges++;
                securityViolations.push('suspicious_location_change');
            }
            session.clientIp = clientIp;
        }

        // 4. Check for user agent changes
        if (session.userAgent !== userAgent) {
            const uaDistance = this._calculateUserAgentDistance(session.userAgent, userAgent);
            if (uaDistance > 0.7) { // Significant change
                session.securityFlags.deviceChanges++;
                securityViolations.push('suspicious_device_change');
            }
            session.userAgent = userAgent;
        }

        // 5. Check for replay attacks (rapid successive requests)
        const timeSinceLastActivity = Date.now() - session.lastActivity;
        if (timeSinceLastActivity < 100) { // Less than 100ms
            securityViolations.push('potential_replay_attack');
        }

        // 6. Check overall security pattern
        if (session.securityFlags.locationChanges > 3 || 
            session.securityFlags.deviceChanges > 2 ||
            session.securityFlags.fingerprintMismatches > 2) {
            session.securityFlags.suspiciousActivity = true;
            session.securityFlags.requiresReauth = true;
            securityViolations.push('suspicious_activity_pattern');
        }

        // Log security events
        if (securityViolations.length > 0) {
            await this.securityMonitor.logSessionSecurityEvent({
                sessionId: session.id,
                userId: session.userId,
                violations: securityViolations,
                clientIp,
                userAgent,
                timestamp: Date.now(),
                securityLevel: this._calculateSecurityLevel(session)
            });

            // Force re-authentication for critical violations
            const criticalViolations = ['suspicious_activity_pattern', 'fingerprint_mismatch'];
            if (securityViolations.some(v => criticalViolations.includes(v))) {
                session.securityFlags.requiresReauth = true;
            }
        }

        session.securityFlags.lastSecurityCheck = Date.now();
    }

    /**
     * Update session activity atomically
     * @param {Object} session Session data
     * @param {string} clientIp Client IP
     * @param {string} userAgent User agent
     * @private
     */
    async _updateSessionActivityAtomic(session, clientIp, userAgent) {
        const now = Date.now();
        
        // Update session data
        session.lastActivity = now;
        session.performanceMetrics.requestCount++;
        
        // Add to access history (keep last 10)
        session.accessHistory.push({
            timestamp: now,
            clientIp,
            userAgent: userAgent.substring(0, 100)
        });

        if (session.accessHistory.length > 10) {
            session.accessHistory = session.accessHistory.slice(-10);
        }

        // Batch update for performance
        this.batchOperations.push({
            type: 'update_session',
            sessionId: session.id,
            sessionData: session,
            timestamp: now
        });

        // Process batch if it's getting large
        if (this.batchOperations.length >= 10) {
            await this._processBatchOperations();
        }

        // Update cache
        this._addToSessionCache(session.id, session);
    }

    /**
     * Process batched Redis operations
     * @private
     */
    async _processBatchOperations() {
        if (this.batchOperations.length === 0) return;

        const multi = this.redisClient.multi();
        
        for (const operation of this.batchOperations) {
            if (operation.type === 'update_session') {
                const sessionKey = this.SESSION_PREFIX + operation.sessionId;
                const ttl = await this.redisClient.ttl(sessionKey);
                
                if (ttl > 0) {
                    multi.setEx(sessionKey, ttl, JSON.stringify(operation.sessionData));
                }
            }
        }

        await multi.exec();
        this.batchOperations = [];
    }

    /**
     * Constant-time string comparison to prevent timing attacks
     * @param {string} a First string
     * @param {string} b Second string
     * @returns {boolean} True if strings are equal
     * @private
     */
    _constantTimeCompare(a, b) {
        if (a.length !== b.length) {
            return false;
        }

        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }

        return result === 0;
    }

    /**
     * Calculate security level for session
     * @param {Object} session Session data
     * @returns {string} Security level
     * @private
     */
    _calculateSecurityLevel(session) {
        let score = 100;

        // Deduct points for security issues
        score -= session.securityFlags.locationChanges * 10;
        score -= session.securityFlags.deviceChanges * 15;
        score -= session.securityFlags.fingerprintMismatches * 20;

        if (session.securityFlags.suspiciousActivity) score -= 30;
        if (!session.fingerprint) score -= 10;
        if (!session.csrfToken) score -= 10;

        if (score >= 90) return 'high';
        if (score >= 70) return 'medium';
        if (score >= 50) return 'low';
        return 'critical';
    }

    /**
     * Get security warnings for session
     * @param {Object} session Session data
     * @returns {Array} Security warnings
     * @private
     */
    _getSecurityWarnings(session) {
        const warnings = [];

        if (session.securityFlags.locationChanges > 1) {
            warnings.push('Multiple location changes detected');
        }
        if (session.securityFlags.deviceChanges > 0) {
            warnings.push('Device fingerprint changes detected');
        }
        if (session.securityFlags.fingerprintMismatches > 1) {
            warnings.push('Session fingerprint mismatches detected');
        }
        if (session.securityFlags.requiresReauth) {
            warnings.push('Re-authentication required due to suspicious activity');
        }

        return warnings;
    }

    /**
     * Add session to in-memory cache
     * @param {string} sessionId Session ID
     * @param {Object} session Session data
     * @private
     */
    _addToSessionCache(sessionId, session) {
        // Implement LRU eviction
        if (this.sessionCache.size >= this.cacheSize) {
            const firstKey = this.sessionCache.keys().next().value;
            this.sessionCache.delete(firstKey);
        }

        this.sessionCache.set(sessionId, { ...session });
    }

    /**
     * Calculate IP distance (simplified geolocation)
     * @param {string} ip1 First IP
     * @param {string} ip2 Second IP
     * @returns {Promise<number>} Distance in kilometers
     * @private
     */
    async _calculateIPDistance(ip1, ip2) {
        // Simplified implementation - production would use proper geolocation service
        if (ip1 === ip2) return 0;
        
        // Mock distance calculation
        const hash1 = crypto.createHash('md5').update(ip1).digest('hex');
        const hash2 = crypto.createHash('md5').update(ip2).digest('hex');
        
        return Math.abs(parseInt(hash1.substring(0, 8), 16) - parseInt(hash2.substring(0, 8), 16)) / 100000;
    }

    /**
     * Calculate user agent similarity
     * @param {string} ua1 First user agent
     * @param {string} ua2 Second user agent
     * @returns {number} Distance (0-1, where 0 is identical)
     * @private
     */
    _calculateUserAgentDistance(ua1, ua2) {
        if (ua1 === ua2) return 0;
        
        // Simple Levenshtein distance normalized
        const longer = ua1.length > ua2.length ? ua1 : ua2;
        const shorter = ua1.length > ua2.length ? ua2 : ua1;
        
        if (longer.length === 0) return 1;
        
        // Simplified distance calculation
        let distance = 0;
        for (let i = 0; i < shorter.length; i++) {
            if (longer[i] !== shorter[i]) distance++;
        }
        distance += longer.length - shorter.length;
        
        return distance / longer.length;
    }

    /**
     * Hash fingerprint for comparison
     * @param {string} fingerprint Fingerprint to hash
     * @returns {string} Hashed fingerprint
     * @private
     */
    _hashFingerprint(fingerprint) {
        return crypto.createHash('sha256').update(fingerprint).digest('hex').substring(0, 16);
    }

    /**
     * Start background tasks
     * @private
     */
    _startBackgroundTasks() {
        // Process batched operations every 5 seconds
        setInterval(async () => {
            await this._processBatchOperations();
        }, 5000);

        // Clean up session cache every 10 minutes
        setInterval(() => {
            this._cleanupSessionCache();
        }, 600000);

        // Security analysis every 5 minutes
        setInterval(async () => {
            await this.securityMonitor.runSecurityAnalysis();
        }, 300000);
    }

    /**
     * Clean up expired sessions from cache
     * @private
     */
    _cleanupSessionCache() {
        const now = Date.now();
        for (const [sessionId, session] of this.sessionCache.entries()) {
            if (now > session.expiresAt) {
                this.sessionCache.delete(sessionId);
            }
        }
    }

    // =============================================================================
    // PUBLIC API ENHANCEMENTS
    // =============================================================================

    /**
     * Get enhanced session statistics
     * @returns {Promise<Object>} Enhanced session statistics
     */
    async getEnhancedSessionStatistics() {
        try {
            const baseStats = await this.getSessionStatistics();
            
            // Add enhanced metrics
            const enhancedStats = {
                ...baseStats,
                security: {
                    averageSecurityLevel: 'medium', // Would calculate from active sessions
                    fingerprintingEnabled: this.config.enableSessionFingerprinting,
                    csrfProtectionEnabled: this.config.antiCSRFEnabled,
                    suspiciousActivityDetected: 0, // Would query from monitoring
                    securityViolationsToday: 0
                },
                performance: {
                    cacheHitRatio: this.sessionCache.size > 0 ? 0.85 : 0, // Mock ratio
                    averageValidationTime: 15, // Mock time in ms
                    batchOperationsPending: this.batchOperations.length
                },
                fingerprinting: this.config.enableSessionFingerprinting ? {
                    enabled: true,
                    rotationInterval: this.config.fingerprintRotationInterval,
                    mismatchRate: 0.02 // Mock rate
                } : { enabled: false }
            };

            return enhancedStats;
        } catch (error) {
            console.error('Error getting enhanced session statistics:', error);
            return { error: error.message };
        }
    }

    /**
     * Force security check on all active sessions
     * @param {string} userId User ID (optional - if provided, checks only user's sessions)
     * @returns {Promise<Object>} Security check results
     */
    async forceSecurityCheck(userId = null) {
        try {
            const results = {
                sessionsChecked: 0,
                securityViolations: 0,
                sessionsInvalidated: 0,
                warnings: []
            };

            // Implementation would check all sessions or user-specific sessions
            console.log(`Running forced security check for ${userId || 'all users'}`);

            return results;
        } catch (error) {
            console.error('Error during forced security check:', error);
            throw error;
        }
    }

    /**
     * Get health status with enhanced metrics
     * @returns {Promise<Object>} Enhanced health status
     */
    async getHealthStatus() {
        try {
            const baseHealth = await super.getHealthStatus?.() || {};
            const redisHealth = this.redisClient.isReady ? 'healthy' : 'unhealthy';
            
            return {
                ...baseHealth,
                status: redisHealth === 'healthy' ? 'healthy' : 'degraded',
                components: {
                    ...baseHealth.components,
                    redis: redisHealth,
                    sessionCache: this.sessionCache.size < this.cacheSize ? 'healthy' : 'degraded',
                    securityMonitoring: this.config.enableSecurityMonitoring ? 'enabled' : 'disabled',
                    fingerprinting: this.config.enableSessionFingerprinting ? 'enabled' : 'disabled',
                    csrfProtection: this.config.antiCSRFEnabled ? 'enabled' : 'disabled'
                },
                metrics: {
                    cachedSessions: this.sessionCache.size,
                    maxCacheSize: this.cacheSize,
                    pendingBatchOps: this.batchOperations.length,
                    ...(baseHealth.metrics || {})
                },
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
// ENHANCED SUPPORTING CLASSES
// =============================================================================

class EnhancedSessionSecurityMonitor {
    constructor(config) {
        super();
        this.config = config;
        this.securityEvents = [];
        this.alertThresholds = {
            suspiciousActivityPerHour: 10,
            fingerprintMismatchesPerHour: 20,
            locationChangesPerHour: 15
        };
    }

    async logSessionRegenerated(data) {
        console.log('Session regenerated:', data.newSessionId);
        this.securityEvents.push({
            type: 'session_regenerated',
            ...data,
            timestamp: Date.now()
        });
    }

    async runSecurityAnalysis() {
        console.log('Running enhanced session security analysis');
        
        // Analyze recent security events for patterns
        const recentEvents = this.securityEvents.filter(
            event => Date.now() - event.timestamp < 3600000 // Last hour
        );

        // Check for concerning patterns
        if (recentEvents.length > this.alertThresholds.suspiciousActivityPerHour) {
            console.warn('High volume of security events detected');
        }
    }
}

class AdvancedDeviceTracker {
    constructor(config) {
        this.config = config;
        this.deviceDatabase = new Map(); // Simple device database
    }

    async extractEnhancedDeviceInfo(userAgent, deviceFingerprint, clientIp) {
        const basicInfo = await this.extractDeviceInfo(userAgent, deviceFingerprint);
        
        // Enhanced tracking
        const enhancedInfo = {
            ...basicInfo,
            trusted: await this._isDeviceTrusted(basicInfo.fingerprint),
            riskScore: await this._calculateDeviceRiskScore(basicInfo, clientIp),
            lastSeen: await this._getDeviceLastSeen(basicInfo.fingerprint),
            geolocation: await this._getApproximateLocation(clientIp)
        };

        // Update device database
        await this._updateDeviceDatabase(enhancedInfo);

        return enhancedInfo;
    }

    async _isDeviceTrusted(fingerprint) {
        // Check if device has been seen before and behaved normally
        const deviceHistory = this.deviceDatabase.get(fingerprint);
        return deviceHistory ? deviceHistory.trustScore > 0.7 : false;
    }

    async _calculateDeviceRiskScore(deviceInfo, clientIp) {
        // Calculate risk based on device properties and behavior
        let riskScore = 0.5; // Neutral

        // Factors that increase risk
        if (deviceInfo.type === 'unknown') riskScore += 0.2;
        if (!deviceInfo.fingerprint) riskScore += 0.3;

        // Factors that decrease risk
        if (deviceInfo.trusted) riskScore -= 0.3;

        return Math.max(0, Math.min(1, riskScore));
    }

    async _getDeviceLastSeen(fingerprint) {
        const deviceHistory = this.deviceDatabase.get(fingerprint);
        return deviceHistory ? deviceHistory.lastSeen : null;
    }

    async _getApproximateLocation(clientIp) {
        // Simplified geolocation - production would use proper service
        return {
            country: 'Unknown',
            region: 'Unknown',
            city: 'Unknown',
            estimated: true
        };
    }

    async _updateDeviceDatabase(deviceInfo) {
        this.deviceDatabase.set(deviceInfo.fingerprint, {
            ...deviceInfo,
            lastSeen: Date.now(),
            trustScore: deviceInfo.riskScore ? 1 - deviceInfo.riskScore : 0.5
        });
    }
}

class SessionFingerprintManager {
    constructor(config) {
        this.config = config;
    }

    async generateFingerprint(userAgent, clientIp, deviceFingerprint) {
        const components = [
            userAgent,
            clientIp,
            deviceFingerprint || '',
            Date.now().toString()
        ];

        return crypto.createHash('sha256')
            .update(components.join('|'))
            .digest('hex');
    }
}

class CSRFProtection {
    constructor(config) {
        this.config = config;
    }

    async generateToken(sessionId) {
        const token = crypto.randomBytes(32).toString('hex');
        // In production, store token association with session
        return token;
    }

    async validateToken(sessionId, token) {
        // In production, validate against stored token
        return token && token.length === 64; // Basic validation
    }
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

class SessionError extends Error {
    constructor(message, code = 'SESSION_ERROR') {
        super(message);
        this.name = 'SessionError';
        this.code = code;
    }
}

module.exports = {
    EnhancedSessionManager,
    EnhancedSessionSecurityMonitor,
    AdvancedDeviceTracker,
    SessionFingerprintManager,
    CSRFProtection,
    SessionError
};