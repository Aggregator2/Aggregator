/**
 * @fileoverview User Session Management for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Advanced session management with sliding expiration, concurrent session control, and security features
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * Session Manager
 * Handles user sessions with sliding expiration, security features, and concurrent session management
 */
class SessionManager {
    constructor(redis, config) {
        this.redis = redis;
        this.config = {
            ttl: config.ttl || 3600, // 1 hour default
            slidingExpiration: config.slidingExpiration !== false,
            maxConcurrentSessions: config.maxConcurrentSessions || 5,
            sessionSecretKey: config.sessionSecretKey || crypto.randomBytes(32).toString('hex'),
            refreshThreshold: config.refreshThreshold || 0.5, // Refresh when 50% of TTL is consumed
            securityMode: config.securityMode || 'standard', // 'standard', 'strict', 'paranoid'
            ipBinding: config.ipBinding || false,
            deviceFingerprinting: config.deviceFingerprinting !== false,
            sessionRotation: config.sessionRotation || false,
            inactivityTimeout: config.inactivityTimeout || 1800, // 30 minutes
            ...config
        };

        this.state = {
            stats: {
                activeSessions: 0,
                totalSessions: 0,
                expiredSessions: 0,
                refreshedSessions: 0,
                securityViolations: 0,
                avgSessionDuration: 0
            },
            securityEvents: new Map(),
            deviceCache: new Map()
        };

        // Security levels configuration
        this.securityLevels = {
            standard: {
                requireIpBinding: false,
                requireDeviceFingerprint: false,
                maxLocationChanges: 10,
                maxFailedAttempts: 5
            },
            strict: {
                requireIpBinding: true,
                requireDeviceFingerprint: true,
                maxLocationChanges: 3,
                maxFailedAttempts: 3
            },
            paranoid: {
                requireIpBinding: true,
                requireDeviceFingerprint: true,
                maxLocationChanges: 1,
                maxFailedAttempts: 1,
                forceRotation: true
            }
        };

        // Lua scripts for atomic operations
        this.luaScripts = {};
    }

    /**
     * Initialize session manager
     */
    async initialize() {
        try {
            await this._loadLuaScripts();
            await this._startCleanupScheduler();
            console.log('Session Manager initialized');
        } catch (error) {
            console.error('Failed to initialize Session Manager:', error);
            throw error;
        }
    }

    /**
     * Load Lua scripts for atomic session operations
     */
    async _loadLuaScripts() {
        // Create session with concurrent limit check
        this.luaScripts.createSession = await this.redis.defineCommand('createSession', {
            numberOfKeys: 3,
            lua: `
                local userSessionsKey = KEYS[1]  -- user:sessions:userId
                local sessionKey = KEYS[2]       -- session:sessionId
                local statsKey = KEYS[3]         -- session:stats
                
                local sessionData = ARGV[1]
                local sessionId = ARGV[2]
                local userId = ARGV[3]
                local ttl = tonumber(ARGV[4])
                local maxConcurrent = tonumber(ARGV[5])
                local timestamp = ARGV[6]
                
                -- Check concurrent session limit
                local currentSessions = redis.call('ZCARD', userSessionsKey)
                
                if currentSessions >= maxConcurrent then
                    -- Remove oldest session
                    local oldest = redis.call('ZRANGE', userSessionsKey, 0, 0, 'WITHSCORES')
                    if #oldest > 0 then
                        local oldSessionId = oldest[1]
                        redis.call('ZREM', userSessionsKey, oldSessionId)
                        redis.call('DEL', 'session:' .. oldSessionId)
                    end
                end
                
                -- Create new session
                redis.call('SET', sessionKey, sessionData)
                redis.call('EXPIRE', sessionKey, ttl)
                redis.call('ZADD', userSessionsKey, timestamp, sessionId)
                redis.call('EXPIRE', userSessionsKey, ttl)
                
                -- Update stats
                redis.call('HINCRBY', statsKey, 'totalSessions', 1)
                redis.call('HINCRBY', statsKey, 'activeSessions', 1)
                
                return {true, currentSessions + 1}
            `
        });

        // Update session with sliding expiration
        this.luaScripts.updateSession = await this.redis.defineCommand('updateSession', {
            numberOfKeys: 2,
            lua: `
                local sessionKey = KEYS[1]
                local userSessionsKey = KEYS[2]
                
                local sessionData = ARGV[1]
                local sessionId = ARGV[2]
                local ttl = tonumber(ARGV[3])
                local timestamp = ARGV[4]
                local slidingExpiration = ARGV[5] == 'true'
                
                -- Check if session exists
                local exists = redis.call('EXISTS', sessionKey)
                if exists == 0 then
                    return {false, 'session_not_found'}
                end
                
                -- Update session data
                redis.call('SET', sessionKey, sessionData)
                
                -- Apply sliding expiration if enabled
                if slidingExpiration then
                    redis.call('EXPIRE', sessionKey, ttl)
                    redis.call('ZADD', userSessionsKey, timestamp, sessionId)
                    redis.call('EXPIRE', userSessionsKey, ttl)
                end
                
                return {true, 'updated'}
            `
        });

        // Destroy session and cleanup
        this.luaScripts.destroySession = await this.redis.defineCommand('destroySession', {
            numberOfKeys: 3,
            lua: `
                local sessionKey = KEYS[1]
                local userSessionsKey = KEYS[2]
                local statsKey = KEYS[3]
                
                local sessionId = ARGV[1]
                
                -- Check if session exists
                local exists = redis.call('EXISTS', sessionKey)
                if exists == 0 then
                    return {false, 'session_not_found'}
                end
                
                -- Remove session
                redis.call('DEL', sessionKey)
                redis.call('ZREM', userSessionsKey, sessionId)
                
                -- Update stats
                redis.call('HINCRBY', statsKey, 'activeSessions', -1)
                
                return {true, 'destroyed'}
            `
        });
    }

    /**
     * Create a new user session
     */
    async createSession(userId, userAgent, ipAddress, additionalData = {}) {
        try {
            // Generate session ID
            const sessionId = this._generateSessionId();
            
            // Create device fingerprint
            const deviceFingerprint = this._createDeviceFingerprint(userAgent, additionalData);
            
            // Validate security requirements
            await this._validateSecurityRequirements(userId, ipAddress, deviceFingerprint);
            
            // Create session data
            const sessionData = {
                sessionId,
                userId,
                userAgent,
                ipAddress,
                deviceFingerprint,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                refreshCount: 0,
                securityLevel: this.config.securityMode,
                ...additionalData
            };
            
            // Store session atomically
            const userSessionsKey = this._getUserSessionsKey(userId);
            const sessionKey = this._getSessionKey(sessionId);
            const statsKey = this._getStatsKey();
            
            const result = await this.redis.createSession(
                userSessionsKey,
                sessionKey,
                statsKey,
                JSON.stringify(sessionData),
                sessionId,
                userId,
                this.config.ttl,
                this.config.maxConcurrentSessions,
                Date.now().toString()
            );
            
            if (result[0]) {
                // Generate JWT token
                const token = this._generateJWT(sessionData);
                
                // Update stats
                this.state.stats.totalSessions++;
                this.state.stats.activeSessions = result[1];
                
                // Store device information
                if (this.config.deviceFingerprinting) {
                    await this._storeDeviceInfo(userId, deviceFingerprint, additionalData);
                }
                
                return {
                    sessionId,
                    token,
                    expiresAt: Date.now() + (this.config.ttl * 1000),
                    sessionCount: result[1]
                };
            }
            
            throw new Error('Failed to create session');
            
        } catch (error) {
            console.error('Create session error:', error);
            throw error;
        }
    }

    /**
     * Validate and refresh an existing session
     */
    async validateSession(sessionId, ipAddress = null, userAgent = null) {
        try {
            const sessionKey = this._getSessionKey(sessionId);
            const sessionData = await this.redis.get(sessionKey);
            
            if (!sessionData) {
                return { valid: false, reason: 'session_not_found' };
            }
            
            const session = JSON.parse(sessionData);
            
            // Security validations
            const securityCheck = await this._performSecurityChecks(session, ipAddress, userAgent);
            if (!securityCheck.valid) {
                await this._logSecurityViolation(session.userId, securityCheck.reason, {
                    sessionId,
                    ipAddress,
                    userAgent
                });
                return securityCheck;
            }
            
            // Check if session needs refresh
            const shouldRefresh = this._shouldRefreshSession(session);
            
            if (shouldRefresh) {
                await this._refreshSession(sessionId, session);
            }
            
            return {
                valid: true,
                session: {
                    sessionId: session.sessionId,
                    userId: session.userId,
                    createdAt: session.createdAt,
                    lastActivity: session.lastActivity,
                    securityLevel: session.securityLevel
                },
                refreshed: shouldRefresh
            };
            
        } catch (error) {
            console.error('Validate session error:', error);
            return { valid: false, reason: 'validation_error' };
        }
    }

    /**
     * Update session activity and data
     */
    async updateSessionActivity(sessionId, activityData = {}) {
        try {
            const sessionKey = this._getSessionKey(sessionId);
            const sessionData = await this.redis.get(sessionKey);
            
            if (!sessionData) {
                return { success: false, reason: 'session_not_found' };
            }
            
            const session = JSON.parse(sessionData);
            
            // Update activity data
            session.lastActivity = Date.now();
            session.activityCount = (session.activityCount || 0) + 1;
            
            // Merge additional activity data
            if (activityData.page) session.lastPage = activityData.page;
            if (activityData.action) session.lastAction = activityData.action;
            if (activityData.ipAddress) session.lastIpAddress = activityData.ipAddress;
            
            // Store updated session
            const userSessionsKey = this._getUserSessionsKey(session.userId);
            
            const result = await this.redis.updateSession(
                sessionKey,
                userSessionsKey,
                JSON.stringify(session),
                sessionId,
                this.config.ttl,
                Date.now().toString(),
                this.config.slidingExpiration.toString()
            );
            
            if (result[0]) {
                this.state.stats.refreshedSessions++;
                return { success: true, lastActivity: session.lastActivity };
            }
            
            return { success: false, reason: result[1] };
            
        } catch (error) {
            console.error('Update session activity error:', error);
            return { success: false, reason: 'update_error' };
        }
    }

    /**
     * Destroy a specific session
     */
    async destroySession(sessionId) {
        try {
            // Get session data first for cleanup
            const sessionKey = this._getSessionKey(sessionId);
            const sessionData = await this.redis.get(sessionKey);
            
            if (!sessionData) {
                return { success: false, reason: 'session_not_found' };
            }
            
            const session = JSON.parse(sessionData);
            const userSessionsKey = this._getUserSessionsKey(session.userId);
            const statsKey = this._getStatsKey();
            
            // Destroy session atomically
            const result = await this.redis.destroySession(
                sessionKey,
                userSessionsKey,
                statsKey,
                sessionId
            );
            
            if (result[0]) {
                this.state.stats.activeSessions--;
                
                // Calculate session duration for stats
                const duration = Date.now() - session.createdAt;
                this._updateAverageSessionDuration(duration);
                
                return { success: true, duration };
            }
            
            return { success: false, reason: result[1] };
            
        } catch (error) {
            console.error('Destroy session error:', error);
            return { success: false, reason: 'destroy_error' };
        }
    }

    /**
     * Destroy all sessions for a user
     */
    async destroyAllUserSessions(userId, excludeSessionId = null) {
        try {
            const userSessionsKey = this._getUserSessionsKey(userId);
            const sessionIds = await this.redis.zrange(userSessionsKey, 0, -1);
            
            let destroyedCount = 0;
            
            for (const sessionId of sessionIds) {
                if (sessionId !== excludeSessionId) {
                    const result = await this.destroySession(sessionId);
                    if (result.success) {
                        destroyedCount++;
                    }
                }
            }
            
            return { success: true, destroyedCount };
            
        } catch (error) {
            console.error('Destroy all user sessions error:', error);
            return { success: false, reason: 'destroy_all_error' };
        }
    }

    /**
     * Get user's active sessions
     */
    async getUserSessions(userId) {
        try {
            const userSessionsKey = this._getUserSessionsKey(userId);
            const sessionIds = await this.redis.zrange(userSessionsKey, 0, -1, 'WITHSCORES');
            
            const sessions = [];
            
            for (let i = 0; i < sessionIds.length; i += 2) {
                const sessionId = sessionIds[i];
                const createdAt = parseInt(sessionIds[i + 1]);
                
                const sessionKey = this._getSessionKey(sessionId);
                const sessionData = await this.redis.get(sessionKey);
                
                if (sessionData) {
                    const session = JSON.parse(sessionData);
                    sessions.push({
                        sessionId,
                        createdAt,
                        lastActivity: session.lastActivity,
                        ipAddress: session.ipAddress,
                        userAgent: session.userAgent,
                        deviceFingerprint: session.deviceFingerprint,
                        isActive: Date.now() - session.lastActivity < this.config.inactivityTimeout * 1000
                    });
                }
            }
            
            return sessions;
            
        } catch (error) {
            console.error('Get user sessions error:', error);
            throw error;
        }
    }

    /**
     * Rotate session ID for security
     */
    async rotateSession(oldSessionId) {
        try {
            // Get existing session data
            const oldSessionKey = this._getSessionKey(oldSessionId);
            const sessionData = await this.redis.get(oldSessionKey);
            
            if (!sessionData) {
                return { success: false, reason: 'session_not_found' };
            }
            
            const session = JSON.parse(sessionData);
            
            // Generate new session ID
            const newSessionId = this._generateSessionId();
            session.sessionId = newSessionId;
            session.rotatedAt = Date.now();
            session.rotationCount = (session.rotationCount || 0) + 1;
            
            // Create new session
            const newSessionKey = this._getSessionKey(newSessionId);
            const userSessionsKey = this._getUserSessionsKey(session.userId);
            
            // Atomic rotation
            const pipeline = this.redis.pipeline();
            pipeline.set(newSessionKey, JSON.stringify(session));
            pipeline.expire(newSessionKey, this.config.ttl);
            pipeline.zadd(userSessionsKey, Date.now(), newSessionId);
            pipeline.zrem(userSessionsKey, oldSessionId);
            pipeline.del(oldSessionKey);
            
            await pipeline.exec();
            
            // Generate new JWT
            const token = this._generateJWT(session);
            
            return {
                success: true,
                newSessionId,
                token,
                expiresAt: Date.now() + (this.config.ttl * 1000)
            };
            
        } catch (error) {
            console.error('Rotate session error:', error);
            return { success: false, reason: 'rotation_error' };
        }
    }

    /**
     * Get session statistics
     */
    getStats() {
        return {
            ...this.state.stats,
            config: {
                ttl: this.config.ttl,
                maxConcurrentSessions: this.config.maxConcurrentSessions,
                slidingExpiration: this.config.slidingExpiration,
                securityMode: this.config.securityMode
            }
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const testSessionId = 'health_check_session';
            const testKey = this._getSessionKey(testSessionId);
            
            await this.redis.setex(testKey, 10, JSON.stringify({ test: true }));
            const retrieved = await this.redis.get(testKey);
            await this.redis.del(testKey);
            
            return {
                status: 'healthy',
                canWrite: !!retrieved,
                activeSessions: this.state.stats.activeSessions
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
     * Generate secure session ID
     */
    _generateSessionId() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Create device fingerprint
     */
    _createDeviceFingerprint(userAgent, additionalData = {}) {
        const fingerprint = {
            userAgent,
            platform: additionalData.platform,
            language: additionalData.language,
            timezone: additionalData.timezone,
            screen: additionalData.screen,
            plugins: additionalData.plugins
        };
        
        return crypto.createHash('sha256')
            .update(JSON.stringify(fingerprint))
            .digest('hex');
    }

    /**
     * Generate JWT token
     */
    _generateJWT(sessionData) {
        const payload = {
            sessionId: sessionData.sessionId,
            userId: sessionData.userId,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + this.config.ttl
        };
        
        return jwt.sign(payload, this.config.sessionSecretKey);
    }

    /**
     * Validate security requirements
     */
    async _validateSecurityRequirements(userId, ipAddress, deviceFingerprint) {
        const securityLevel = this.securityLevels[this.config.securityMode];
        
        if (securityLevel.requireIpBinding) {
            // Check if IP is on whitelist or flagged
            const ipCheck = await this._validateIpAddress(userId, ipAddress);
            if (!ipCheck.valid) {
                throw new Error(`IP validation failed: ${ipCheck.reason}`);
            }
        }
        
        if (securityLevel.requireDeviceFingerprint) {
            // Check device fingerprint against known devices
            const deviceCheck = await this._validateDeviceFingerprint(userId, deviceFingerprint);
            if (!deviceCheck.valid) {
                throw new Error(`Device validation failed: ${deviceCheck.reason}`);
            }
        }
    }

    /**
     * Perform security checks on session validation
     */
    async _performSecurityChecks(session, ipAddress, userAgent) {
        const securityLevel = this.securityLevels[session.securityLevel];
        
        // Check inactivity timeout
        if (Date.now() - session.lastActivity > this.config.inactivityTimeout * 1000) {
            return { valid: false, reason: 'session_inactive' };
        }
        
        // IP binding check
        if (this.config.ipBinding && ipAddress && session.ipAddress !== ipAddress) {
            const ipChangeAllowed = await this._isIpChangeAllowed(session.userId, ipAddress);
            if (!ipChangeAllowed) {
                return { valid: false, reason: 'ip_mismatch' };
            }
        }
        
        // Device fingerprint check
        if (userAgent && this.config.deviceFingerprinting) {
            const currentFingerprint = this._createDeviceFingerprint(userAgent);
            if (session.deviceFingerprint !== currentFingerprint) {
                return { valid: false, reason: 'device_mismatch' };
            }
        }
        
        return { valid: true };
    }

    /**
     * Check if session should be refreshed
     */
    _shouldRefreshSession(session) {
        if (!this.config.slidingExpiration) return false;
        
        const now = Date.now();
        const timeSinceCreation = now - session.createdAt;
        const ttlMs = this.config.ttl * 1000;
        
        return timeSinceCreation > (ttlMs * this.config.refreshThreshold);
    }

    /**
     * Refresh session with sliding expiration
     */
    async _refreshSession(sessionId, session) {
        session.lastActivity = Date.now();
        session.refreshCount = (session.refreshCount || 0) + 1;
        
        const sessionKey = this._getSessionKey(sessionId);
        const userSessionsKey = this._getUserSessionsKey(session.userId);
        
        await this.redis.updateSession(
            sessionKey,
            userSessionsKey,
            JSON.stringify(session),
            sessionId,
            this.config.ttl,
            Date.now().toString(),
            'true'
        );
    }

    /**
     * Store device information
     */
    async _storeDeviceInfo(userId, deviceFingerprint, deviceData) {
        const deviceKey = `user:devices:${userId}`;
        const deviceInfo = {
            fingerprint: deviceFingerprint,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            trusted: false,
            ...deviceData
        };
        
        await this.redis.hset(deviceKey, deviceFingerprint, JSON.stringify(deviceInfo));
        await this.redis.expire(deviceKey, this.config.ttl * 24); // 24x session TTL
    }

    /**
     * Log security violation
     */
    async _logSecurityViolation(userId, reason, details) {
        this.state.stats.securityViolations++;
        
        const violation = {
            userId,
            reason,
            details,
            timestamp: Date.now()
        };
        
        const violationKey = `security:violations:${userId}`;
        await this.redis.lpush(violationKey, JSON.stringify(violation));
        await this.redis.ltrim(violationKey, 0, 99); // Keep last 100 violations
        await this.redis.expire(violationKey, 86400 * 7); // 7 days
        
        console.warn('Security violation logged:', violation);
    }

    /**
     * Validate IP address
     */
    async _validateIpAddress(userId, ipAddress) {
        // Implement IP validation logic
        return { valid: true };
    }

    /**
     * Validate device fingerprint
     */
    async _validateDeviceFingerprint(userId, fingerprint) {
        // Implement device validation logic
        return { valid: true };
    }

    /**
     * Check if IP change is allowed
     */
    async _isIpChangeAllowed(userId, newIpAddress) {
        // Implement IP change validation logic
        return true;
    }

    /**
     * Update average session duration statistics
     */
    _updateAverageSessionDuration(duration) {
        const total = this.state.stats.avgSessionDuration * this.state.stats.totalSessions;
        this.state.stats.avgSessionDuration = (total + duration) / (this.state.stats.totalSessions + 1);
    }

    /**
     * Start cleanup scheduler for expired sessions
     */
    async _startCleanupScheduler() {
        setInterval(async () => {
            try {
                await this._cleanupExpiredSessions();
            } catch (error) {
                console.error('Session cleanup error:', error);
            }
        }, 300000); // Every 5 minutes
    }

    /**
     * Clean up expired sessions
     */
    async _cleanupExpiredSessions() {
        // Implementation for cleaning up expired sessions
        // This would scan for expired sessions and remove them
    }

    /**
     * Generate cache keys
     */
    _getSessionKey(sessionId) {
        return `session:${sessionId}`;
    }

    _getUserSessionsKey(userId) {
        return `user:sessions:${userId}`;
    }

    _getStatsKey() {
        return 'session:stats';
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        console.log('Session Manager cleanup completed');
    }
}

module.exports = { SessionManager };