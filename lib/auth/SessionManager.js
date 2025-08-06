/**
 * @title Session Management System with Redis
 * @author DEX Security Team
 * @notice Enterprise-grade session management with Redis persistence and security features
 * @dev Implements secure session handling with multi-device support, concurrent session limits, and security monitoring
 */

const crypto = require('crypto');
const Redis = require('redis');

class SessionManager {
    constructor(redisClient, config) {
        this.redisClient = redisClient;
        this.config = {
            sessionTTL: config.sessionTTL || 3600000, // 1 hour default
            maxSessionsPerUser: config.maxSessionsPerUser || 5,
            maxConcurrentSessions: config.maxConcurrentSessions || 3,
            sessionSecretLength: config.sessionSecretLength || 32,
            enableDeviceTracking: config.enableDeviceTracking !== false,
            enableSecurityMonitoring: config.enableSecurityMonitoring !== false,
            sessionCookieName: config.sessionCookieName || 'dex_session',
            secureOnly: config.secureOnly !== false,
            httpOnly: config.httpOnly !== false,
            sameSite: config.sameSite || 'strict',
            ...config
        };

        // Session storage keys
        this.SESSION_PREFIX = 'session:';
        this.USER_SESSIONS_PREFIX = 'user_sessions:';
        this.DEVICE_SESSIONS_PREFIX = 'device_sessions:';
        this.CONCURRENT_SESSIONS_PREFIX = 'concurrent:';

        // Security and monitoring
        this.securityMonitor = new SessionSecurityMonitor(config);
        this.deviceTracker = new DeviceTracker(config);
        this.sessionAnalytics = new SessionAnalytics(redisClient, config);

        this._startBackgroundTasks();
    }

    /**
     * Create a new session for user
     * @param {Object} sessionData Session data
     * @returns {Promise<Object>} Created session
     */
    async createSession(sessionData) {
        try {
            const {
                userId,
                clientIp,
                userAgent,
                deviceFingerprint = null,
                metadata = {},
                expiresAt = null
            } = sessionData;

            // Check concurrent session limits
            await this._checkConcurrentSessionLimits(userId, clientIp);

            // Generate session ID and secret
            const sessionId = crypto.randomUUID();
            const sessionSecret = crypto.randomBytes(this.config.sessionSecretLength).toString('hex');
            const sessionToken = `${sessionId}.${sessionSecret}`;

            // Calculate expiration
            const expirationTime = expiresAt || (Date.now() + this.config.sessionTTL);

            // Device information
            const deviceInfo = this.config.enableDeviceTracking ? 
                await this.deviceTracker.extractDeviceInfo(userAgent, deviceFingerprint) : null;

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
                metadata,
                isActive: true,
                securityFlags: {
                    suspiciousActivity: false,
                    locationChanges: 0,
                    deviceChanges: 0,
                    lastSecurityCheck: Date.now()
                },
                accessHistory: []
            };

            // Store session in Redis
            const sessionKey = this.SESSION_PREFIX + sessionId;
            const ttlSeconds = Math.ceil((expirationTime - Date.now()) / 1000);
            
            await this.redisClient.setEx(
                sessionKey,
                ttlSeconds,
                JSON.stringify(session)
            );

            // Track user sessions
            await this._addToUserSessions(userId, sessionId, expirationTime);

            // Track device sessions
            if (deviceInfo) {
                await this._addToDeviceSessions(deviceInfo.fingerprint, sessionId);
            }

            // Update concurrent session count
            await this._updateConcurrentSessions(userId, clientIp, 'add');

            // Log session creation
            await this.securityMonitor.logSessionCreated({
                sessionId,
                userId,
                clientIp,
                userAgent,
                deviceInfo,
                createdAt: session.createdAt
            });

            // Record analytics
            if (this.config.enableSessionAnalytics) {
                await this.sessionAnalytics.recordSessionCreation(session);
            }

            return {
                sessionId,
                sessionToken,
                expiresAt: expirationTime,
                deviceInfo: deviceInfo ? {
                    type: deviceInfo.type,
                    os: deviceInfo.os,
                    browser: deviceInfo.browser
                } : null
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
     * Get session by ID
     * @param {string} sessionId Session ID
     * @returns {Promise<Object|null>} Session data or null
     */
    async getSession(sessionId) {
        try {
            const sessionKey = this.SESSION_PREFIX + sessionId;
            const sessionData = await this.redisClient.get(sessionKey);
            
            if (!sessionData) {
                return null;
            }

            const session = JSON.parse(sessionData);
            
            // Check if session is expired
            if (Date.now() > session.expiresAt) {
                await this.invalidateSession(sessionId);
                return null;
            }

            // Check if session is active
            if (!session.isActive) {
                return null;
            }

            return session;

        } catch (error) {
            console.error('Error getting session:', error);
            return null;
        }
    }

    /**
     * Validate session token
     * @param {string} sessionToken Full session token
     * @param {string} clientIp Client IP address
     * @param {string} userAgent User agent
     * @returns {Promise<Object|null>} Validation result
     */
    async validateSession(sessionToken, clientIp, userAgent) {
        try {
            // Parse session token
            const [sessionId, sessionSecret] = sessionToken.split('.');
            if (!sessionId || !sessionSecret) {
                throw new SessionError('Invalid session token format');
            }

            // Get session
            const session = await this.getSession(sessionId);
            if (!session) {
                throw new SessionError('Session not found or expired');
            }

            // Verify session secret
            if (session.sessionSecret !== sessionSecret) {
                await this.securityMonitor.logSessionSecurityViolation({
                    sessionId,
                    userId: session.userId,
                    violation: 'invalid_secret',
                    clientIp,
                    userAgent
                });
                throw new SessionError('Invalid session credentials');
            }

            // Security checks
            await this._performSecurityChecks(session, clientIp, userAgent);

            // Update last activity
            await this._updateSessionActivity(session, clientIp, userAgent);

            return {
                valid: true,
                session: {
                    id: session.id,
                    userId: session.userId,
                    createdAt: session.createdAt,
                    lastActivity: session.lastActivity,
                    expiresAt: session.expiresAt,
                    deviceInfo: session.deviceInfo
                }
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
     * Refresh session (extend expiration)
     * @param {string} sessionId Session ID
     * @param {number} extendBy Extension time in milliseconds
     * @returns {Promise<Object>} Updated session info
     */
    async refreshSession(sessionId, extendBy = null) {
        try {
            const session = await this.getSession(sessionId);
            if (!session) {
                throw new SessionError('Session not found');
            }

            // Calculate new expiration
            const extension = extendBy || this.config.sessionTTL;
            const newExpiresAt = Date.now() + extension;
            
            session.expiresAt = newExpiresAt;
            session.lastRefresh = Date.now();

            // Update in Redis
            const sessionKey = this.SESSION_PREFIX + sessionId;
            const ttlSeconds = Math.ceil(extension / 1000);
            
            await this.redisClient.setEx(
                sessionKey,
                ttlSeconds,
                JSON.stringify(session)
            );

            // Update user sessions mapping
            await this._updateUserSessionExpiry(session.userId, sessionId, newExpiresAt);

            await this.securityMonitor.logSessionRefreshed({
                sessionId,
                userId: session.userId,
                newExpiresAt,
                extensionTime: extension
            });

            return {
                sessionId,
                expiresAt: newExpiresAt,
                refreshedAt: session.lastRefresh
            };

        } catch (error) {
            await this.securityMonitor.logSessionError({
                action: 'refresh_session',
                sessionId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Invalidate session
     * @param {string} sessionId Session ID
     * @param {Object} options Invalidation options
     * @returns {Promise<void>}
     */
    async invalidateSession(sessionId, options = {}) {
        try {
            const session = await this.getSession(sessionId);
            if (!session) {
                return; // Already invalidated
            }

            // Remove from Redis
            const sessionKey = this.SESSION_PREFIX + sessionId;
            await this.redisClient.del(sessionKey);

            // Remove from user sessions
            await this._removeFromUserSessions(session.userId, sessionId);

            // Remove from device sessions
            if (session.deviceInfo?.fingerprint) {
                await this._removeFromDeviceSessions(session.deviceInfo.fingerprint, sessionId);
            }

            // Update concurrent session count
            await this._updateConcurrentSessions(session.userId, session.clientIp, 'remove');

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

        } catch (error) {
            console.error('Error invalidating session:', error);
            // Don't throw on invalidation errors
        }
    }

    /**
     * Invalidate all sessions for user
     * @param {string} userId User ID
     * @param {Object} options Invalidation options
     * @returns {Promise<number>} Number of sessions invalidated
     */
    async invalidateAllUserSessions(userId, options = {}) {
        try {
            const userSessionsKey = this.USER_SESSIONS_PREFIX + userId;
            const sessionIds = await this.redisClient.sMembers(userSessionsKey);

            let invalidatedCount = 0;
            for (const sessionId of sessionIds) {
                try {
                    await this.invalidateSession(sessionId, {
                        ...options,
                        reason: options.reason || 'user_logout_all'
                    });
                    invalidatedCount++;
                } catch (error) {
                    console.error(`Error invalidating session ${sessionId}:`, error);
                }
            }

            await this.securityMonitor.logAllSessionsInvalidated({
                userId,
                count: invalidatedCount,
                reason: options.reason
            });

            return invalidatedCount;

        } catch (error) {
            console.error('Error invalidating all user sessions:', error);
            return 0;
        }
    }

    /**
     * Get active sessions for user
     * @param {string} userId User ID
     * @returns {Promise<Array>} Active sessions
     */
    async getUserSessions(userId) {
        try {
            const userSessionsKey = this.USER_SESSIONS_PREFIX + userId;
            const sessionIds = await this.redisClient.sMembers(userSessionsKey);

            const sessions = [];
            for (const sessionId of sessionIds) {
                const session = await this.getSession(sessionId);
                if (session) {
                    sessions.push({
                        id: session.id,
                        createdAt: session.createdAt,
                        lastActivity: session.lastActivity,
                        expiresAt: session.expiresAt,
                        clientIp: session.clientIp,
                        deviceInfo: session.deviceInfo,
                        current: false // Will be set by caller if needed
                    });
                }
            }

            return sessions.sort((a, b) => b.lastActivity - a.lastActivity);

        } catch (error) {
            console.error('Error getting user sessions:', error);
            return [];
        }
    }

    // =============================================================================
    // PRIVATE HELPER METHODS
    // =============================================================================

    /**
     * Check concurrent session limits
     * @param {string} userId User ID
     * @param {string} clientIp Client IP
     * @private
     */
    async _checkConcurrentSessionLimits(userId, clientIp) {
        const userSessionsKey = this.USER_SESSIONS_PREFIX + userId;
        const sessionCount = await this.redisClient.sCard(userSessionsKey);

        if (sessionCount >= this.config.maxSessionsPerUser) {
            // Remove oldest session
            await this._removeOldestSession(userId);
        }

        // Check concurrent sessions from same IP
        const concurrentKey = this.CONCURRENT_SESSIONS_PREFIX + clientIp;
        const concurrentCount = await this.redisClient.get(concurrentKey) || 0;

        if (parseInt(concurrentCount) >= this.config.maxConcurrentSessions) {
            throw new SessionError('Maximum concurrent sessions exceeded');
        }
    }

    /**
     * Perform security checks on session
     * @param {Object} session Session data
     * @param {string} clientIp Current client IP
     * @param {string} userAgent Current user agent
     * @private
     */
    async _performSecurityChecks(session, clientIp, userAgent) {
        let securityViolations = [];

        // Check IP changes
        if (session.clientIp !== clientIp) {
            session.securityFlags.locationChanges++;
            securityViolations.push('ip_change');
            
            // Allow IP changes but log them
            session.clientIp = clientIp;
        }

        // Check user agent changes
        if (session.userAgent !== userAgent) {
            session.securityFlags.deviceChanges++;
            securityViolations.push('user_agent_change');
            
            // Update user agent
            session.userAgent = userAgent;
        }

        // Check for suspicious activity patterns
        if (session.securityFlags.locationChanges > 3 || session.securityFlags.deviceChanges > 2) {
            session.securityFlags.suspiciousActivity = true;
            securityViolations.push('suspicious_pattern');
        }

        // Log security events
        if (securityViolations.length > 0) {
            await this.securityMonitor.logSessionSecurityEvent({
                sessionId: session.id,
                userId: session.userId,
                violations: securityViolations,
                clientIp,
                userAgent,
                timestamp: Date.now()
            });
        }

        session.securityFlags.lastSecurityCheck = Date.now();
    }

    /**
     * Update session activity
     * @param {Object} session Session data
     * @param {string} clientIp Client IP
     * @param {string} userAgent User agent
     * @private
     */
    async _updateSessionActivity(session, clientIp, userAgent) {
        const now = Date.now();
        
        // Update activity timestamp
        session.lastActivity = now;
        
        // Add to access history (keep last 10 accesses)
        session.accessHistory.push({
            timestamp: now,
            clientIp,
            userAgent: userAgent.substring(0, 100) // Truncate to save space
        });

        if (session.accessHistory.length > 10) {
            session.accessHistory = session.accessHistory.slice(-10);
        }

        // Update in Redis
        const sessionKey = this.SESSION_PREFIX + session.id;
        const ttl = await this.redisClient.ttl(sessionKey);
        
        if (ttl > 0) {
            await this.redisClient.setEx(
                sessionKey,
                ttl,
                JSON.stringify(session)
            );
        }
    }

    /**
     * Add session to user sessions set
     * @param {string} userId User ID
     * @param {string} sessionId Session ID
     * @param {number} expiresAt Expiration timestamp
     * @private
     */
    async _addToUserSessions(userId, sessionId, expiresAt) {
        const userSessionsKey = this.USER_SESSIONS_PREFIX + userId;
        await this.redisClient.sAdd(userSessionsKey, sessionId);
        
        // Set expiration for the set (slightly longer than session)
        const ttlSeconds = Math.ceil((expiresAt - Date.now()) / 1000) + 3600;
        await this.redisClient.expire(userSessionsKey, ttlSeconds);
    }

    /**
     * Remove session from user sessions set
     * @param {string} userId User ID
     * @param {string} sessionId Session ID
     * @private
     */
    async _removeFromUserSessions(userId, sessionId) {
        const userSessionsKey = this.USER_SESSIONS_PREFIX + userId;
        await this.redisClient.sRem(userSessionsKey, sessionId);
    }

    /**
     * Update user session expiry
     * @param {string} userId User ID
     * @param {string} sessionId Session ID
     * @param {number} newExpiresAt New expiration timestamp
     * @private
     */
    async _updateUserSessionExpiry(userId, sessionId, newExpiresAt) {
        const userSessionsKey = this.USER_SESSIONS_PREFIX + userId;
        const ttlSeconds = Math.ceil((newExpiresAt - Date.now()) / 1000) + 3600;
        await this.redisClient.expire(userSessionsKey, ttlSeconds);
    }

    /**
     * Remove oldest session for user
     * @param {string} userId User ID
     * @private
     */
    async _removeOldestSession(userId) {
        const sessions = await this.getUserSessions(userId);
        if (sessions.length > 0) {
            const oldestSession = sessions[sessions.length - 1];
            await this.invalidateSession(oldestSession.id, {
                reason: 'session_limit_exceeded'
            });
        }
    }

    /**
     * Add session to device sessions
     * @param {string} deviceFingerprint Device fingerprint
     * @param {string} sessionId Session ID
     * @private
     */
    async _addToDeviceSessions(deviceFingerprint, sessionId) {
        const deviceSessionsKey = this.DEVICE_SESSIONS_PREFIX + deviceFingerprint;
        await this.redisClient.sAdd(deviceSessionsKey, sessionId);
        await this.redisClient.expire(deviceSessionsKey, 86400); // 24 hours
    }

    /**
     * Remove session from device sessions
     * @param {string} deviceFingerprint Device fingerprint
     * @param {string} sessionId Session ID
     * @private
     */
    async _removeFromDeviceSessions(deviceFingerprint, sessionId) {
        const deviceSessionsKey = this.DEVICE_SESSIONS_PREFIX + deviceFingerprint;
        await this.redisClient.sRem(deviceSessionsKey, sessionId);
    }

    /**
     * Update concurrent sessions count
     * @param {string} userId User ID
     * @param {string} clientIp Client IP
     * @param {string} operation 'add' or 'remove'
     * @private
     */
    async _updateConcurrentSessions(userId, clientIp, operation) {
        const concurrentKey = this.CONCURRENT_SESSIONS_PREFIX + clientIp;
        
        if (operation === 'add') {
            await this.redisClient.incr(concurrentKey);
            await this.redisClient.expire(concurrentKey, 3600); // 1 hour
        } else if (operation === 'remove') {
            const current = await this.redisClient.get(concurrentKey) || 0;
            if (parseInt(current) > 0) {
                await this.redisClient.decr(concurrentKey);
            }
        }
    }

    /**
     * Start background tasks
     * @private
     */
    _startBackgroundTasks() {
        // Clean up expired session mappings every 10 minutes
        setInterval(async () => {
            await this._cleanupExpiredMappings();
        }, 600000);

        // Run security analysis every 5 minutes
        setInterval(async () => {
            await this.securityMonitor.runSecurityAnalysis();
        }, 300000);
    }

    /**
     * Clean up expired session mappings
     * @private
     */
    async _cleanupExpiredMappings() {
        try {
            // This would clean up orphaned session mappings
            console.log('Cleaning up expired session mappings');
        } catch (error) {
            console.error('Error cleaning up session mappings:', error);
        }
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get session statistics
     * @returns {Promise<Object>} Session statistics
     */
    async getSessionStatistics() {
        try {
            // Get approximate counts (would need more sophisticated implementation in production)
            const stats = {
                totalActiveSessions: 0,
                sessionsPerUser: {},
                averageSessionDuration: 0,
                securityEvents: 0,
                timestamp: Date.now()
            };

            return stats;
        } catch (error) {
            console.error('Error getting session statistics:', error);
            return { error: error.message };
        }
    }

    /**
     * Get active session count
     * @returns {Promise<number>} Active session count
     */
    async getActiveSessionCount() {
        try {
            // Implementation would count active sessions
            return 0;
        } catch (error) {
            console.error('Error getting active session count:', error);
            return 0;
        }
    }

    /**
     * Get health status
     * @returns {Promise<Object>} Health status
     */
    async getHealthStatus() {
        try {
            const redisHealth = this.redisClient.isReady ? 'healthy' : 'unhealthy';
            const activeSessionCount = await this.getActiveSessionCount();
            
            return {
                status: redisHealth === 'healthy' ? 'healthy' : 'degraded',
                components: {
                    redis: redisHealth,
                    deviceTracking: this.config.enableDeviceTracking ? 'enabled' : 'disabled',
                    securityMonitoring: this.config.enableSecurityMonitoring ? 'enabled' : 'disabled'
                },
                metrics: {
                    activeSessions: activeSessionCount,
                    maxSessionsPerUser: this.config.maxSessionsPerUser,
                    sessionTTL: this.config.sessionTTL
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
// SUPPORTING CLASSES
// =============================================================================

class SessionSecurityMonitor {
    constructor(config) {
        this.config = config;
        this.securityEvents = [];
    }

    async logSessionCreated(data) {
        console.log('Session created:', data.sessionId);
    }

    async logSessionInvalidated(data) {
        console.log('Session invalidated:', data.sessionId);
    }

    async logSessionRefreshed(data) {
        console.log('Session refreshed:', data.sessionId);
    }

    async logAllSessionsInvalidated(data) {
        console.log('All sessions invalidated for user:', data.userId);
    }

    async logSessionError(data) {
        console.error('Session error:', data);
    }

    async logSessionValidationError(data) {
        console.error('Session validation error:', data);
    }

    async logSessionSecurityViolation(data) {
        console.warn('Session security violation:', data);
    }

    async logSessionSecurityEvent(data) {
        console.warn('Session security event:', data);
    }

    async runSecurityAnalysis() {
        console.log('Running session security analysis');
    }
}

class DeviceTracker {
    constructor(config) {
        this.config = config;
    }

    async extractDeviceInfo(userAgent, deviceFingerprint) {
        // Simple device info extraction (would be more sophisticated in production)
        return {
            fingerprint: deviceFingerprint || crypto.createHash('md5').update(userAgent).digest('hex'),
            userAgent,
            type: this._detectDeviceType(userAgent),
            os: this._detectOS(userAgent),
            browser: this._detectBrowser(userAgent),
            timestamp: Date.now()
        };
    }

    _detectDeviceType(userAgent) {
        if (/Mobile|Android|iPhone|iPad/.test(userAgent)) return 'mobile';
        if (/Tablet|iPad/.test(userAgent)) return 'tablet';
        return 'desktop';
    }

    _detectOS(userAgent) {
        if (/Windows/.test(userAgent)) return 'Windows';
        if (/Mac OS X/.test(userAgent)) return 'macOS';
        if (/Linux/.test(userAgent)) return 'Linux';
        if (/Android/.test(userAgent)) return 'Android';
        if (/iOS/.test(userAgent)) return 'iOS';
        return 'Unknown';
    }

    _detectBrowser(userAgent) {
        if (/Chrome/.test(userAgent)) return 'Chrome';
        if (/Firefox/.test(userAgent)) return 'Firefox';
        if (/Safari/.test(userAgent)) return 'Safari';
        if (/Edge/.test(userAgent)) return 'Edge';
        return 'Unknown';
    }
}

class SessionAnalytics {
    constructor(redisClient, config) {
        this.redisClient = redisClient;
        this.config = config;
    }

    async recordSessionCreation(session) {
        // Record session creation for analytics
    }

    async recordSessionEnd(session, reason) {
        // Record session end for analytics
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
    SessionManager,
    SessionSecurityMonitor,
    DeviceTracker,
    SessionAnalytics,
    SessionError
};