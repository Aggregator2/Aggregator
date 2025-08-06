const EventEmitter = require('events');
const Redis = require('ioredis');
const cron = require('node-cron');

/**
 * Escalation Policy Manager
 * Manages alert escalation policies and on-call rotations
 */
class EscalationManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            redisUrl: config.redisUrl || 'redis://localhost:6379',
            maxRetries: config.maxRetries || 3,
            retryDelay: config.retryDelay || 300000, // 5 minutes
            ...config
        };
        
        this.redis = new Redis(this.config.redisUrl);
        this.policies = new Map();
        this.rotations = new Map();
        this.activeAlerts = new Map();
        this.acknowledgedAlerts = new Map();
        
        // Notification channels
        this.channels = new Map();
        
        // Initialize scheduled jobs
        this.scheduledJobs = new Map();
    }
    
    /**
     * Define an escalation policy
     */
    definePolicy(policyConfig) {
        const policy = {
            id: policyConfig.id,
            name: policyConfig.name,
            description: policyConfig.description,
            rules: policyConfig.rules || [],
            defaultRule: policyConfig.defaultRule,
            active: true,
            createdAt: Date.now(),
            metadata: policyConfig.metadata || {}
        };
        
        // Validate rules
        for (const rule of policy.rules) {
            this.validateRule(rule);
        }
        
        this.policies.set(policy.id, policy);
        this.emit('policyCreated', policy);
        
        return policy;
    }
    
    /**
     * Define an on-call rotation
     */
    defineRotation(rotationConfig) {
        const rotation = {
            id: rotationConfig.id,
            name: rotationConfig.name,
            members: rotationConfig.members || [],
            schedule: rotationConfig.schedule,
            timezone: rotationConfig.timezone || 'UTC',
            handoffTime: rotationConfig.handoffTime || '09:00',
            overrides: rotationConfig.overrides || [],
            active: true,
            createdAt: Date.now()
        };
        
        this.rotations.set(rotation.id, rotation);
        
        // Schedule rotation changes
        if (rotation.schedule.type === 'weekly') {
            this.scheduleWeeklyRotation(rotation);
        } else if (rotation.schedule.type === 'daily') {
            this.scheduleDailyRotation(rotation);
        }
        
        this.emit('rotationCreated', rotation);
        
        return rotation;
    }
    
    /**
     * Process an alert through escalation policies
     */
    async processAlert(alert) {
        try {
            // Find matching policy
            const policy = this.findMatchingPolicy(alert);
            if (!policy) {
                console.error('No matching escalation policy for alert:', alert);
                return;
            }
            
            // Find matching rule
            const rule = this.findMatchingRule(policy, alert) || policy.defaultRule;
            if (!rule) {
                console.error('No matching rule in policy:', policy.id);
                return;
            }
            
            // Create alert record
            const alertRecord = {
                id: `${alert.metric}-${Date.now()}`,
                alert,
                policy: policy.id,
                rule: rule.name,
                level: 0,
                attempts: 0,
                status: 'active',
                createdAt: Date.now(),
                notifications: []
            };
            
            this.activeAlerts.set(alertRecord.id, alertRecord);
            
            // Start escalation
            await this.escalate(alertRecord, rule);
            
        } catch (error) {
            console.error('Alert processing error:', error);
            this.emit('error', { alert, error });
        }
    }
    
    /**
     * Escalate an alert
     */
    async escalate(alertRecord, rule) {
        const levels = rule.escalationLevels || [];
        const currentLevel = levels[alertRecord.level];
        
        if (!currentLevel) {
            console.log('No more escalation levels for alert:', alertRecord.id);
            return;
        }
        
        // Get targets for this level
        const targets = await this.resolveTargets(currentLevel.targets);
        
        // Send notifications
        for (const target of targets) {
            try {
                await this.notify(alertRecord, target, currentLevel);
                
                alertRecord.notifications.push({
                    level: alertRecord.level,
                    target,
                    timestamp: Date.now(),
                    status: 'sent'
                });
                
            } catch (error) {
                console.error(`Notification failed for ${target.id}:`, error);
                
                alertRecord.notifications.push({
                    level: alertRecord.level,
                    target,
                    timestamp: Date.now(),
                    status: 'failed',
                    error: error.message
                });
            }
        }
        
        // Update alert record
        alertRecord.attempts++;
        alertRecord.lastNotification = Date.now();
        
        // Store in Redis
        await this.redis.set(
            `alert:${alertRecord.id}`,
            JSON.stringify(alertRecord),
            'EX',
            86400 // 24 hours
        );
        
        // Schedule next escalation if not acknowledged
        if (currentLevel.escalateAfter && alertRecord.level < levels.length - 1) {
            setTimeout(async () => {
                const current = this.activeAlerts.get(alertRecord.id);
                if (current && current.status === 'active' && !this.acknowledgedAlerts.has(alertRecord.id)) {
                    current.level++;
                    await this.escalate(current, rule);
                }
            }, currentLevel.escalateAfter);
        }
        
        // Schedule repeat notifications
        if (currentLevel.repeatInterval && currentLevel.repeatCount) {
            this.scheduleRepeatNotifications(alertRecord, rule, currentLevel);
        }
    }
    
    /**
     * Resolve notification targets
     */
    async resolveTargets(targetConfigs) {
        const targets = [];
        
        for (const config of targetConfigs) {
            switch (config.type) {
                case 'user':
                    targets.push({
                        type: 'user',
                        id: config.id,
                        channels: config.channels || ['email', 'sms']
                    });
                    break;
                    
                case 'rotation':
                    const onCall = await this.getOnCallUser(config.rotationId);
                    if (onCall) {
                        targets.push({
                            type: 'user',
                            id: onCall.id,
                            channels: onCall.channels || ['email', 'sms'],
                            rotation: config.rotationId
                        });
                    }
                    break;
                    
                case 'team':
                    const teamMembers = await this.getTeamMembers(config.teamId);
                    for (const member of teamMembers) {
                        targets.push({
                            type: 'user',
                            id: member.id,
                            channels: member.channels || ['email'],
                            team: config.teamId
                        });
                    }
                    break;
                    
                case 'webhook':
                    targets.push({
                        type: 'webhook',
                        id: config.id,
                        url: config.url,
                        headers: config.headers || {}
                    });
                    break;
            }
        }
        
        return targets;
    }
    
    /**
     * Send notification to target
     */
    async notify(alertRecord, target, level) {
        const notification = {
            alertId: alertRecord.id,
            alert: alertRecord.alert,
            policy: alertRecord.policy,
            level: alertRecord.level,
            target,
            timestamp: Date.now()
        };
        
        switch (target.type) {
            case 'user':
                for (const channel of target.channels) {
                    const channelHandler = this.channels.get(channel);
                    if (channelHandler) {
                        await channelHandler.send(target.id, notification);
                    }
                }
                break;
                
            case 'webhook':
                await this.sendWebhook(target.url, notification, target.headers);
                break;
        }
        
        this.emit('notificationSent', notification);
    }
    
    /**
     * Acknowledge an alert
     */
    async acknowledgeAlert(alertId, userId, message = '') {
        const alertRecord = this.activeAlerts.get(alertId);
        if (!alertRecord) {
            throw new Error('Alert not found');
        }
        
        alertRecord.status = 'acknowledged';
        alertRecord.acknowledgedBy = userId;
        alertRecord.acknowledgedAt = Date.now();
        alertRecord.acknowledgementMessage = message;
        
        this.acknowledgedAlerts.set(alertId, alertRecord);
        
        // Update Redis
        await this.redis.set(
            `alert:${alertId}`,
            JSON.stringify(alertRecord),
            'EX',
            86400
        );
        
        this.emit('alertAcknowledged', {
            alertId,
            userId,
            timestamp: Date.now()
        });
        
        return alertRecord;
    }
    
    /**
     * Resolve an alert
     */
    async resolveAlert(alertId, userId, resolution = '') {
        const alertRecord = this.activeAlerts.get(alertId) || 
                          this.acknowledgedAlerts.get(alertId);
                          
        if (!alertRecord) {
            throw new Error('Alert not found');
        }
        
        alertRecord.status = 'resolved';
        alertRecord.resolvedBy = userId;
        alertRecord.resolvedAt = Date.now();
        alertRecord.resolution = resolution;
        
        // Remove from active/acknowledged
        this.activeAlerts.delete(alertId);
        this.acknowledgedAlerts.delete(alertId);
        
        // Update Redis
        await this.redis.set(
            `alert:resolved:${alertId}`,
            JSON.stringify(alertRecord),
            'EX',
            604800 // 7 days
        );
        
        this.emit('alertResolved', {
            alertId,
            userId,
            timestamp: Date.now()
        });
        
        return alertRecord;
    }
    
    /**
     * Find matching escalation policy
     */
    findMatchingPolicy(alert) {
        for (const [id, policy] of this.policies) {
            if (!policy.active) continue;
            
            // Check policy conditions
            if (policy.conditions) {
                if (this.matchesConditions(alert, policy.conditions)) {
                    return policy;
                }
            }
        }
        
        // Return default policy if exists
        return Array.from(this.policies.values()).find(p => p.isDefault);
    }
    
    /**
     * Find matching rule in policy
     */
    findMatchingRule(policy, alert) {
        for (const rule of policy.rules) {
            if (this.matchesConditions(alert, rule.conditions)) {
                return rule;
            }
        }
        return null;
    }
    
    /**
     * Check if alert matches conditions
     */
    matchesConditions(alert, conditions) {
        for (const condition of conditions) {
            let matches = false;
            
            switch (condition.type) {
                case 'severity':
                    matches = alert.severity === condition.value ||
                             (condition.operator === 'gte' && 
                              this.compareSeverity(alert.severity, condition.value) >= 0);
                    break;
                    
                case 'metric':
                    matches = condition.pattern ? 
                             new RegExp(condition.pattern).test(alert.metric) :
                             alert.metric === condition.value;
                    break;
                    
                case 'tag':
                    matches = alert.tags && alert.tags.includes(condition.value);
                    break;
                    
                case 'time':
                    matches = this.matchesTimeCondition(condition);
                    break;
                    
                case 'value':
                    matches = this.compareValue(alert.value, condition.operator, condition.value);
                    break;
            }
            
            if (!matches) return false;
        }
        
        return true;
    }
    
    /**
     * Compare severity levels
     */
    compareSeverity(sev1, sev2) {
        const levels = { 'info': 0, 'low': 1, 'medium': 2, 'high': 3, 'critical': 4 };
        return levels[sev1] - levels[sev2];
    }
    
    /**
     * Check time condition
     */
    matchesTimeCondition(condition) {
        const now = new Date();
        const hour = now.getHours();
        const dayOfWeek = now.getDay();
        
        if (condition.businessHours) {
            return hour >= 9 && hour < 17 && dayOfWeek >= 1 && dayOfWeek <= 5;
        }
        
        if (condition.hours) {
            return hour >= condition.hours.start && hour < condition.hours.end;
        }
        
        if (condition.days) {
            return condition.days.includes(dayOfWeek);
        }
        
        return true;
    }
    
    /**
     * Compare values
     */
    compareValue(value, operator, threshold) {
        switch (operator) {
            case 'gt': return value > threshold;
            case 'gte': return value >= threshold;
            case 'lt': return value < threshold;
            case 'lte': return value <= threshold;
            case 'eq': return value === threshold;
            case 'neq': return value !== threshold;
            default: return false;
        }
    }
    
    /**
     * Get current on-call user
     */
    async getOnCallUser(rotationId) {
        const rotation = this.rotations.get(rotationId);
        if (!rotation || !rotation.active) return null;
        
        // Check overrides first
        const now = Date.now();
        for (const override of rotation.overrides) {
            if (override.startTime <= now && override.endTime > now) {
                return { id: override.userId, channels: override.channels };
            }
        }
        
        // Calculate current on-call based on schedule
        const currentIndex = this.calculateRotationIndex(rotation);
        const userId = rotation.members[currentIndex];
        
        // Get user details from Redis
        const userKey = `user:${userId}`;
        const userData = await this.redis.get(userKey);
        
        return userData ? JSON.parse(userData) : { id: userId };
    }
    
    /**
     * Calculate rotation index
     */
    calculateRotationIndex(rotation) {
        const now = new Date();
        const startDate = new Date(rotation.createdAt);
        
        switch (rotation.schedule.type) {
            case 'daily':
                const daysSinceStart = Math.floor((now - startDate) / (24 * 60 * 60 * 1000));
                return daysSinceStart % rotation.members.length;
                
            case 'weekly':
                const weeksSinceStart = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));
                return weeksSinceStart % rotation.members.length;
                
            case 'custom':
                // Custom rotation logic
                return 0;
                
            default:
                return 0;
        }
    }
    
    /**
     * Get team members
     */
    async getTeamMembers(teamId) {
        const teamKey = `team:${teamId}:members`;
        const members = await this.redis.smembers(teamKey);
        
        const memberDetails = [];
        for (const memberId of members) {
            const userKey = `user:${memberId}`;
            const userData = await this.redis.get(userKey);
            if (userData) {
                memberDetails.push(JSON.parse(userData));
            }
        }
        
        return memberDetails;
    }
    
    /**
     * Send webhook notification
     */
    async sendWebhook(url, data, headers = {}) {
        const axios = require('axios');
        
        try {
            const response = await axios.post(url, data, {
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                timeout: 10000
            });
            
            return response.data;
            
        } catch (error) {
            console.error('Webhook error:', error.message);
            throw error;
        }
    }
    
    /**
     * Schedule repeat notifications
     */
    scheduleRepeatNotifications(alertRecord, rule, level) {
        let repeatCount = 0;
        const maxRepeats = level.repeatCount || 3;
        
        const repeatInterval = setInterval(async () => {
            const current = this.activeAlerts.get(alertRecord.id);
            
            if (!current || current.status !== 'active' || 
                this.acknowledgedAlerts.has(alertRecord.id) ||
                repeatCount >= maxRepeats) {
                clearInterval(repeatInterval);
                return;
            }
            
            // Resend notification
            const targets = await this.resolveTargets(level.targets);
            for (const target of targets) {
                await this.notify(current, target, level);
            }
            
            repeatCount++;
            
        }, level.repeatInterval);
    }
    
    /**
     * Schedule weekly rotation
     */
    scheduleWeeklyRotation(rotation) {
        const [hour, minute] = rotation.handoffTime.split(':');
        const cronExpression = `${minute} ${hour} * * ${rotation.schedule.dayOfWeek || '1'}`;
        
        const job = cron.schedule(cronExpression, async () => {
            this.emit('rotationChange', {
                rotation: rotation.id,
                timestamp: Date.now()
            });
        }, {
            timezone: rotation.timezone
        });
        
        this.scheduledJobs.set(`rotation:${rotation.id}`, job);
    }
    
    /**
     * Schedule daily rotation
     */
    scheduleDailyRotation(rotation) {
        const [hour, minute] = rotation.handoffTime.split(':');
        const cronExpression = `${minute} ${hour} * * *`;
        
        const job = cron.schedule(cronExpression, async () => {
            this.emit('rotationChange', {
                rotation: rotation.id,
                timestamp: Date.now()
            });
        }, {
            timezone: rotation.timezone
        });
        
        this.scheduledJobs.set(`rotation:${rotation.id}`, job);
    }
    
    /**
     * Validate escalation rule
     */
    validateRule(rule) {
        if (!rule.name) {
            throw new Error('Rule must have a name');
        }
        
        if (!rule.escalationLevels || rule.escalationLevels.length === 0) {
            throw new Error('Rule must have at least one escalation level');
        }
        
        for (const level of rule.escalationLevels) {
            if (!level.targets || level.targets.length === 0) {
                throw new Error('Escalation level must have at least one target');
            }
        }
    }
    
    /**
     * Register notification channel
     */
    registerChannel(name, handler) {
        this.channels.set(name, handler);
    }
    
    /**
     * Get escalation statistics
     */
    async getEscalationStats(timeRange = 86400000) { // 24 hours
        const endTime = Date.now();
        const startTime = endTime - timeRange;
        
        const alerts = await this.redis.zrangebyscore(
            'alerts:timeline',
            startTime,
            endTime
        );
        
        const stats = {
            totalAlerts: alerts.length,
            byStatus: { active: 0, acknowledged: 0, resolved: 0 },
            bySeverity: {},
            byPolicy: {},
            averageTimeToAcknowledge: 0,
            averageTimeToResolve: 0,
            escalationRate: 0
        };
        
        // Calculate statistics
        let totalAckTime = 0;
        let totalResolveTime = 0;
        let acknowledgedCount = 0;
        let resolvedCount = 0;
        let escalatedCount = 0;
        
        for (const alertData of alerts) {
            const alert = JSON.parse(alertData);
            
            // Status counts
            stats.byStatus[alert.status]++;
            
            // Severity counts
            stats.bySeverity[alert.alert.severity] = 
                (stats.bySeverity[alert.alert.severity] || 0) + 1;
            
            // Policy counts
            stats.byPolicy[alert.policy] = 
                (stats.byPolicy[alert.policy] || 0) + 1;
            
            // Time calculations
            if (alert.acknowledgedAt) {
                totalAckTime += alert.acknowledgedAt - alert.createdAt;
                acknowledgedCount++;
            }
            
            if (alert.resolvedAt) {
                totalResolveTime += alert.resolvedAt - alert.createdAt;
                resolvedCount++;
            }
            
            if (alert.level > 0) {
                escalatedCount++;
            }
        }
        
        // Calculate averages
        if (acknowledgedCount > 0) {
            stats.averageTimeToAcknowledge = totalAckTime / acknowledgedCount;
        }
        
        if (resolvedCount > 0) {
            stats.averageTimeToResolve = totalResolveTime / resolvedCount;
        }
        
        if (alerts.length > 0) {
            stats.escalationRate = (escalatedCount / alerts.length) * 100;
        }
        
        return stats;
    }
}

module.exports = EscalationManager;