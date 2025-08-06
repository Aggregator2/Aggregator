/**
 * @fileoverview DDoS Protection System for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Multi-layer DDoS protection with traffic analysis, pattern detection, and mitigation
 */

const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * Comprehensive DDoS Protection System
 */
class DDoSProtection extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Detection thresholds
            thresholds: {
                requestsPerSecond: config.thresholds?.requestsPerSecond || 1000,
                requestsPerMinute: config.thresholds?.requestsPerMinute || 10000,
                uniqueIpsPerMinute: config.thresholds?.uniqueIpsPerMinute || 5000,
                bandwidthMbps: config.thresholds?.bandwidthMbps || 100,
                connectionCount: config.thresholds?.connectionCount || 10000,
                errorRate: config.thresholds?.errorRate || 0.5, // 50%
                ...config.thresholds
            },
            
            // Detection windows
            windows: {
                shortTerm: config.windows?.shortTerm || 60000, // 1 minute
                mediumTerm: config.windows?.mediumTerm || 300000, // 5 minutes
                longTerm: config.windows?.longTerm || 900000, // 15 minutes
                ...config.windows
            },
            
            // Mitigation strategies
            mitigation: {
                challengeThreshold: config.mitigation?.challengeThreshold || 0.3,
                blockThreshold: config.mitigation?.blockThreshold || 0.7,
                tempBlockDuration: config.mitigation?.tempBlockDuration || 300000, // 5 minutes
                permBlockDuration: config.mitigation?.permBlockDuration || 86400000, // 24 hours
                escalationFactor: config.mitigation?.escalationFactor || 1.5,
                ...config.mitigation
            },
            
            // Traffic shaping
            trafficShaping: {
                enabled: config.trafficShaping?.enabled !== false,
                queueSize: config.trafficShaping?.queueSize || 1000,
                processingRate: config.trafficShaping?.processingRate || 100, // requests per second
                priorityLevels: config.trafficShaping?.priorityLevels || 3,
                ...config.trafficShaping
            },
            
            // Pattern analysis
            patternAnalysis: {
                enabled: config.patternAnalysis?.enabled !== false,
                minSampleSize: config.patternAnalysis?.minSampleSize || 100,
                anomalyThreshold: config.patternAnalysis?.anomalyThreshold || 2.5, // standard deviations
                learningPeriod: config.patternAnalysis?.learningPeriod || 3600000, // 1 hour
                ...config.patternAnalysis
            },
            
            // Geofencing
            geofencing: {
                enabled: config.geofencing?.enabled || false,
                allowedCountries: config.geofencing?.allowedCountries || [],
                blockedCountries: config.geofencing?.blockedCountries || [],
                maxCountriesPerMinute: config.geofencing?.maxCountriesPerMinute || 50,
                ...config.geofencing
            },
            
            auditLogging: config.auditLogging !== false,
            alerting: config.alerting !== false,
            ...config
        };

        this.state = {
            protection: {
                level: 'normal', // normal, elevated, high, critical
                activeMitigations: new Set(),
                lastEscalation: null,
                attacksBlocked: 0
            },
            traffic: {
                currentRps: 0,
                currentConnections: 0,
                uniqueIps: new Set(),
                countries: new Set(),
                bandwidth: 0
            },
            patterns: {
                baseline: null,
                anomalies: [],
                learningMode: true,
                samples: []
            },
            mitigations: {
                blockedIps: new Map(),
                challengedIps: new Map(),
                rateLimited: new Map(),
                trafficQueue: []
            }
        };

        this.metrics = {
            totalRequests: 0,
            blockedRequests: 0,
            challengedRequests: 0,
            falsePositives: 0,
            attacksDetected: 0,
            bytesTransferred: 0
        };

        this.detectors = new Map();
        this.mitigators = new Map();
        this.auditLogger = null;

        this.initialize();
    }

    /**
     * Initialize DDoS protection system
     */
    async initialize() {
        try {
            await this._initializeDetectors();
            await this._initializeMitigators();
            await this._initializeAuditLogging();
            await this._startMonitoring();
            
            console.log('DDoS Protection System initialized');
        } catch (error) {
            console.error('Failed to initialize DDoS Protection:', error);
            throw error;
        }
    }

    /**
     * Analyze incoming request for DDoS indicators
     * @param {Object} request Request object
     * @returns {Object} Analysis result with mitigation actions
     */
    async analyzeRequest(request) {
        try {
            const {
                ip,
                userAgent,
                method,
                path,
                headers,
                timestamp = Date.now(),
                size = 0,
                country,
                asn
            } = request;

            // Update traffic metrics
            this._updateTrafficMetrics(request);

            // Run all detectors
            const detectionResults = await this._runDetectors(request);
            
            // Calculate threat score
            const threatScore = this._calculateThreatScore(detectionResults);
            
            // Determine mitigation actions
            const mitigations = await this._determineMitigations(ip, threatScore, detectionResults);
            
            // Update protection level
            this._updateProtectionLevel(threatScore);
            
            // Log analysis
            await this._auditLog('DDOS_ANALYSIS', {
                ip,
                threatScore,
                protectionLevel: this.state.protection.level,
                detections: detectionResults.filter(r => r.triggered),
                mitigations: mitigations,
                userAgent: userAgent?.substring(0, 100) // Truncate for logging
            });

            return {
                allowed: mitigations.action !== 'block',
                action: mitigations.action,
                threatScore,
                protectionLevel: this.state.protection.level,
                mitigations,
                challenge: mitigations.challenge,
                retryAfter: mitigations.retryAfter,
                details: detectionResults
            };

        } catch (error) {
            console.error('DDoS analysis failed:', error);
            return {
                allowed: true, // Fail open for availability
                action: 'allow',
                threatScore: 0,
                error: error.message
            };
        }
    }

    /**
     * Initialize detection systems
     */
    async _initializeDetectors() {
        // Volume-based detectors
        this.detectors.set('volume_rps', new VolumeDetector({
            type: 'requests_per_second',
            threshold: this.config.thresholds.requestsPerSecond,
            window: 1000
        }));

        this.detectors.set('volume_rpm', new VolumeDetector({
            type: 'requests_per_minute',
            threshold: this.config.thresholds.requestsPerMinute,
            window: 60000
        }));

        this.detectors.set('bandwidth', new BandwidthDetector({
            threshold: this.config.thresholds.bandwidthMbps,
            window: this.config.windows.shortTerm
        }));

        // Pattern-based detectors
        this.detectors.set('user_agent', new UserAgentDetector({
            suspiciousPatterns: [
                /bot/i, /crawler/i, /spider/i, /scanner/i,
                /wget/i, /curl/i, /python/i, /go-http/i
            ],
            threshold: 0.7
        }));

        this.detectors.set('request_pattern', new RequestPatternDetector({
            rapidFireThreshold: 10, // requests per second from single IP
            burstThreshold: 100, // requests in 10 seconds
            sequentialThreshold: 0.9 // 90% sequential patterns
        }));

        this.detectors.set('geographic', new GeographicDetector({
            enabled: this.config.geofencing.enabled,
            allowedCountries: this.config.geofencing.allowedCountries,
            blockedCountries: this.config.geofencing.blockedCountries,
            maxCountriesPerMinute: this.config.geofencing.maxCountriesPerMinute
        }));
    }

    /**
     * Initialize mitigation systems
     */
    async _initializeMitigators() {
        this.mitigators.set('rate_limiter', new AdaptiveRateLimiter({
            baseLimit: 100,
            burstLimit: 200,
            adaptiveEnabled: true
        }));

        this.mitigators.set('traffic_shaper', new TrafficShaper({
            enabled: this.config.trafficShaping.enabled,
            queueSize: this.config.trafficShaping.queueSize,
            processingRate: this.config.trafficShaping.processingRate
        }));

        this.mitigators.set('challenge_system', new ChallengeSystem({
            types: ['captcha', 'proof_of_work', 'javascript'],
            difficulty: 'adaptive'
        }));
    }

    /**
     * Run all detection systems
     */
    async _runDetectors(request) {
        const results = [];
        
        for (const [name, detector] of this.detectors.entries()) {
            try {
                const result = await detector.analyze(request, this.state);
                results.push({
                    detector: name,
                    triggered: result.triggered,
                    score: result.score,
                    confidence: result.confidence,
                    details: result.details
                });
            } catch (error) {
                console.error(`Detector ${name} failed:`, error);
                results.push({
                    detector: name,
                    triggered: false,
                    score: 0,
                    confidence: 0,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Calculate overall threat score from detection results
     */
    _calculateThreatScore(detectionResults) {
        let totalScore = 0;
        let totalWeight = 0;

        const weights = {
            volume_rps: 0.3,
            volume_rpm: 0.2,
            bandwidth: 0.2,
            user_agent: 0.1,
            request_pattern: 0.25,
            geographic: 0.15
        };

        for (const result of detectionResults) {
            const weight = weights[result.detector] || 0.1;
            totalScore += result.score * weight * result.confidence;
            totalWeight += weight;
        }

        return totalWeight > 0 ? Math.min(totalScore / totalWeight, 1.0) : 0;
    }

    /**
     * Determine mitigation actions based on threat score
     */
    async _determineMitigations(ip, threatScore, detectionResults) {
        const mitigations = {
            action: 'allow',
            challenge: null,
            retryAfter: null,
            applied: []
        };

        // Check if IP is already blocked
        if (this.state.mitigations.blockedIps.has(ip)) {
            const blockInfo = this.state.mitigations.blockedIps.get(ip);
            if (blockInfo.expires > Date.now()) {
                mitigations.action = 'block';
                mitigations.retryAfter = Math.ceil((blockInfo.expires - Date.now()) / 1000);
                mitigations.applied.push('ip_block');
                return mitigations;
            } else {
                this.state.mitigations.blockedIps.delete(ip);
            }
        }

        // Apply mitigations based on threat score
        if (threatScore >= this.config.mitigation.blockThreshold) {
            mitigations.action = 'block';
            mitigations.applied.push('ip_block');
            
            // Add to blocked IPs
            this.state.mitigations.blockedIps.set(ip, {
                expires: Date.now() + this.config.mitigation.tempBlockDuration,
                reason: 'high_threat_score',
                score: threatScore
            });

            this.state.protection.attacksBlocked++;
            this.metrics.blockedRequests++;

        } else if (threatScore >= this.config.mitigation.challengeThreshold) {
            mitigations.action = 'challenge';
            mitigations.challenge = await this._generateChallenge(ip, threatScore);
            mitigations.applied.push('challenge');
            
            this.metrics.challengedRequests++;
        }

        return mitigations;
    }

    /**
     * Update protection level based on current threat landscape
     */
    _updateProtectionLevel(currentThreatScore) {
        const now = Date.now();
        const recentThreats = this._getRecentThreatLevel();
        const systemLoad = this._getSystemLoad();

        let newLevel = 'normal';

        if (recentThreats > 0.7 || systemLoad > 0.8) {
            newLevel = 'critical';
        } else if (recentThreats > 0.5 || systemLoad > 0.6) {
            newLevel = 'high';
        } else if (recentThreats > 0.3 || systemLoad > 0.4) {
            newLevel = 'elevated';
        }

        if (newLevel !== this.state.protection.level) {
            const oldLevel = this.state.protection.level;
            this.state.protection.level = newLevel;
            this.state.protection.lastEscalation = now;

            this._auditLog('PROTECTION_LEVEL_CHANGED', {
                oldLevel,
                newLevel,
                recentThreats,
                systemLoad,
                timestamp: now
            });

            this.emit('protectionLevelChanged', {
                oldLevel,
                newLevel,
                reason: 'threat_assessment'
            });
        }
    }

    /**
     * Generate challenge for suspicious requests
     */
    async _generateChallenge(ip, threatScore) {
        const challengeType = this._selectChallengeType(threatScore);
        
        const challenge = {
            type: challengeType,
            id: crypto.randomBytes(16).toString('hex'),
            expires: Date.now() + 300000, // 5 minutes
            attempts: 0,
            maxAttempts: 3
        };

        switch (challengeType) {
            case 'proof_of_work':
                challenge.difficulty = Math.floor(threatScore * 20) + 5; // 5-25 difficulty
                challenge.target = crypto.randomBytes(32).toString('hex');
                break;
                
            case 'javascript':
                challenge.script = this._generateJavaScriptChallenge();
                break;
                
            case 'captcha':
                challenge.captchaId = await this._generateCaptcha();
                break;
        }

        // Store challenge
        this.state.mitigations.challengedIps.set(ip, challenge);

        return challenge;
    }

    // ========== UTILITY METHODS ==========

    _updateTrafficMetrics(request) {
        const now = Date.now();
        
        this.metrics.totalRequests++;
        this.metrics.bytesTransferred += request.size || 0;
        
        this.state.traffic.uniqueIps.add(request.ip);
        
        if (request.country) {
            this.state.traffic.countries.add(request.country);
        }
    }

    _getRecentThreatLevel() {
        const recentBlocks = this.state.protection.attacksBlocked;
        const recentRequests = this.metrics.totalRequests;
        
        if (recentRequests === 0) return 0;
        return Math.min(recentBlocks / (recentRequests * 0.1), 1.0);
    }

    _getSystemLoad() {
        return Math.min(this.state.traffic.currentRps / this.config.thresholds.requestsPerSecond, 1.0);
    }

    _selectChallengeType(threatScore) {
        if (threatScore > 0.6) return 'proof_of_work';
        if (threatScore > 0.4) return 'javascript';
        return 'captcha';
    }

    _generateJavaScriptChallenge() {
        const operations = ['+', '-', '*', '%'];
        const op = operations[Math.floor(Math.random() * operations.length)];
        const a = Math.floor(Math.random() * 100);
        const b = Math.floor(Math.random() * 100) + 1;
        
        return {
            expression: `${a} ${op} ${b}`,
            answer: eval(`${a} ${op} ${b}`)
        };
    }

    async _startMonitoring() {
        // Cleanup expired entries
        setInterval(() => {
            this._cleanupExpiredEntries();
        }, 60000);

        // Update traffic statistics
        setInterval(() => {
            this._updateTrafficStats();
        }, 10000);

        // Emit metrics
        setInterval(() => {
            this.emit('metrics', this.getMetrics());
        }, 30000);
    }

    _cleanupExpiredEntries() {
        const now = Date.now();
        
        for (const [ip, blockInfo] of this.state.mitigations.blockedIps.entries()) {
            if (blockInfo.expires <= now) {
                this.state.mitigations.blockedIps.delete(ip);
            }
        }
        
        for (const [ip, challenge] of this.state.mitigations.challengedIps.entries()) {
            if (challenge.expires <= now) {
                this.state.mitigations.challengedIps.delete(ip);
            }
        }
    }

    _updateTrafficStats() {
        this.state.traffic.currentRps = 0;
        this.state.traffic.uniqueIps.clear();
        this.state.traffic.countries.clear();
    }

    getMetrics() {
        return {
            protection: {
                level: this.state.protection.level,
                activeMitigations: Array.from(this.state.protection.activeMitigations),
                attacksBlocked: this.state.protection.attacksBlocked
            },
            traffic: {
                totalRequests: this.metrics.totalRequests,
                blockedRequests: this.metrics.blockedRequests,
                challengedRequests: this.metrics.challengedRequests,
                currentRps: this.state.traffic.currentRps,
                uniqueIps: this.state.traffic.uniqueIps.size,
                countries: this.state.traffic.countries.size,
                bytesTransferred: this.metrics.bytesTransferred
            },
            mitigations: {
                blockedIps: this.state.mitigations.blockedIps.size,
                challengedIps: this.state.mitigations.challengedIps.size,
                queuedRequests: this.state.mitigations.trafficQueue.length
            },
            timestamp: new Date().toISOString()
        };
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
                    filename: '/var/log/swappiq/ddos-protection.log',
                    maxsize: 100 * 1024 * 1024,
                    maxFiles: 10
                })
            ]
        });
    }

    async _auditLog(action, details) {
        if (!this.auditLogger) return;

        this.auditLogger.info('DDOS_AUDIT', {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'DDoSProtection'
        });
    }

    async cleanup() {
        console.log('DDoS Protection System cleaned up');
    }
}

// ========== DETECTOR IMPLEMENTATIONS ==========

class VolumeDetector {
    constructor(config) {
        this.config = config;
        this.requests = [];
    }

    async analyze(request, state) {
        const now = Date.now();
        const windowStart = now - this.config.window;
        
        this.requests = this.requests.filter(r => r.timestamp > windowStart);
        this.requests.push({ timestamp: now, ip: request.ip });
        
        const currentRate = this.requests.length;
        const triggered = currentRate > this.config.threshold;
        
        return {
            triggered,
            score: Math.min(currentRate / this.config.threshold, 1.0),
            confidence: triggered ? 0.9 : 0.1,
            details: { currentRate, threshold: this.config.threshold }
        };
    }
}

class BandwidthDetector {
    constructor(config) {
        this.config = config;
        this.bandwidth = [];
    }

    async analyze(request, state) {
        const now = Date.now();
        const windowStart = now - this.config.window;
        
        this.bandwidth = this.bandwidth.filter(b => b.timestamp > windowStart);
        this.bandwidth.push({ timestamp: now, bytes: request.size || 0 });
        
        const totalBytes = this.bandwidth.reduce((sum, b) => sum + b.bytes, 0);
        const mbps = (totalBytes * 8) / (this.config.window / 1000) / 1000000;
        const triggered = mbps > this.config.threshold;
        
        return {
            triggered,
            score: Math.min(mbps / this.config.threshold, 1.0),
            confidence: 0.8,
            details: { currentMbps: mbps, threshold: this.config.threshold }
        };
    }
}

class UserAgentDetector {
    constructor(config) {
        this.config = config;
    }

    async analyze(request) {
        const userAgent = request.userAgent || '';
        let suspiciousScore = 0;
        
        for (const pattern of this.config.suspiciousPatterns) {
            if (pattern.test(userAgent)) {
                suspiciousScore += 0.3;
            }
        }
        
        if (!userAgent || userAgent.length < 10) {
            suspiciousScore += 0.5;
        }
        
        const triggered = suspiciousScore >= this.config.threshold;
        
        return {
            triggered,
            score: Math.min(suspiciousScore, 1.0),
            confidence: 0.7,
            details: { userAgent: userAgent.substring(0, 100), suspiciousScore }
        };
    }
}

class RequestPatternDetector {
    constructor(config) {
        this.config = config;
        this.ipRequests = new Map();
    }

    async analyze(request) {
        const now = Date.now();
        const ip = request.ip;
        
        if (!this.ipRequests.has(ip)) {
            this.ipRequests.set(ip, []);
        }
        
        const requests = this.ipRequests.get(ip);
        const recentRequests = requests.filter(r => now - r.timestamp < 60000);
        recentRequests.push({ timestamp: now, path: request.path });
        
        this.ipRequests.set(ip, recentRequests);
        
        const rapidFire = recentRequests.filter(r => now - r.timestamp < 1000).length;
        const burst = recentRequests.filter(r => now - r.timestamp < 10000).length;
        
        let score = 0;
        if (rapidFire > this.config.rapidFireThreshold) score += 0.7;
        if (burst > this.config.burstThreshold) score += 0.5;
        
        return {
            triggered: score > 0.5,
            score: Math.min(score, 1.0),
            confidence: 0.8,
            details: { rapidFire, burst }
        };
    }
}

class GeographicDetector {
    constructor(config) {
        this.config = config;
    }

    async analyze(request) {
        if (!this.config.enabled || !request.country) {
            return { triggered: false, score: 0, confidence: 0, details: {} };
        }

        const country = request.country;
        
        // Check blocked countries
        if (this.config.blockedCountries.includes(country)) {
            return {
                triggered: true,
                score: 1.0,
                confidence: 0.95,
                details: { country, reason: 'blocked_country' }
            };
        }

        // Check allowed countries
        if (this.config.allowedCountries.length > 0 && 
            !this.config.allowedCountries.includes(country)) {
            return {
                triggered: true,
                score: 0.8,
                confidence: 0.9,
                details: { country, reason: 'not_in_allowed_list' }
            };
        }

        return { triggered: false, score: 0, confidence: 0.5, details: { country } };
    }
}

class AdaptiveRateLimiter {
    constructor(config) {
        this.config = config;
        this.limits = new Map();
    }

    async apply(ip) {
        return { allowed: true, retryAfter: null };
    }
}

class TrafficShaper {
    constructor(config) {
        this.config = config;
        this.queue = [];
    }

    async apply(ip, threatScore) {
        if (!this.config.enabled) {
            return { queued: false };
        }
        return { queued: false, position: 0 };
    }
}

class ChallengeSystem {
    constructor(config) {
        this.config = config;
    }

    async generate(type, difficulty) {
        return { type, id: crypto.randomBytes(8).toString('hex') };
    }
}

module.exports = { DDoSProtection };