const axios = require('axios');
const EventEmitter = require('events');

/**
 * Opsgenie Integration for SwappiQ Alerting System
 */
class OpsgenieIntegration extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            apiKey: config.apiKey,
            baseUrl: config.baseUrl || 'https://api.opsgenie.com/v2',
            region: config.region || 'us', // 'us' or 'eu'
            ...config
        };
        
        if (!this.config.apiKey) {
            throw new Error('Opsgenie API key is required');
        }
        
        // Set base URL based on region
        if (this.config.region === 'eu') {
            this.config.baseUrl = 'https://api.eu.opsgenie.com/v2';
        }
        
        this.client = axios.create({
            baseURL: this.config.baseUrl,
            headers: {
                'Authorization': `GenieKey ${this.config.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        this.alerts = new Map();
    }
    
    /**
     * Send notification to Opsgenie
     */
    async send(userId, notification) {
        try {
            const alert = await this.createAlert(notification);
            
            this.alerts.set(notification.alertId, alert);
            
            this.emit('notificationSent', {
                channel: 'opsgenie',
                userId,
                alertId: notification.alertId,
                opsgenieAlertId: alert.id,
                timestamp: Date.now()
            });
            
            return alert;
            
        } catch (error) {
            console.error('Opsgenie notification error:', error);
            this.emit('error', { userId, notification, error });
            throw error;
        }
    }
    
    /**
     * Create Opsgenie alert
     */
    async createAlert(notification) {
        const alert = notification.alert;
        const priority = this.mapPriority(alert.severity);
        
        const payload = {
            message: this.formatMessage(alert),
            alias: notification.alertId,
            description: this.formatDescription(alert),
            responders: await this.getResponders(notification),
            tags: this.getTags(alert),
            details: {
                metric: alert.metric,
                value: String(alert.value),
                threshold: String(alert.threshold || ''),
                timestamp: new Date(alert.timestamp).toISOString(),
                source: alert.source || 'swappiq-monitoring',
                component: alert.component || alert.metric,
                ...alert.metadata
            },
            entity: alert.entity || alert.metric,
            source: 'SwappiQ Monitoring',
            priority: priority,
            user: notification.target.id || 'system',
            note: alert.note || ''
        };
        
        // Add actions if available
        if (alert.actions) {
            payload.actions = alert.actions;
        }
        
        // Add visual elements
        if (alert.visuals) {
            payload.visuals = alert.visuals;
        }
        
        const response = await this.client.post('/alerts', payload);
        
        return {
            id: response.data.data.id,
            alias: notification.alertId,
            status: 'open',
            createdAt: Date.now()
        };
    }
    
    /**
     * Acknowledge alert in Opsgenie
     */
    async acknowledgeAlert(alertId, userId, note = '') {
        try {
            const alert = this.alerts.get(alertId);
            if (!alert) {
                throw new Error('Alert not found');
            }
            
            const payload = {
                user: userId,
                source: 'SwappiQ Monitoring',
                note: note || 'Alert acknowledged'
            };
            
            await this.client.post(
                `/alerts/${alertId}/acknowledge`,
                payload,
                {
                    params: { identifierType: 'alias' }
                }
            );
            
            this.emit('alertAcknowledged', {
                alertId,
                userId,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('Opsgenie acknowledge error:', error);
            throw error;
        }
    }
    
    /**
     * Close alert in Opsgenie
     */
    async closeAlert(alertId, userId, note = '') {
        try {
            const alert = this.alerts.get(alertId);
            if (!alert) {
                throw new Error('Alert not found');
            }
            
            const payload = {
                user: userId,
                source: 'SwappiQ Monitoring',
                note: note || 'Alert resolved'
            };
            
            await this.client.post(
                `/alerts/${alertId}/close`,
                payload,
                {
                    params: { identifierType: 'alias' }
                }
            );
            
            this.alerts.delete(alertId);
            
            this.emit('alertClosed', {
                alertId,
                userId,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('Opsgenie close error:', error);
            throw error;
        }
    }
    
    /**
     * Add note to alert
     */
    async addNote(alertId, userId, note) {
        try {
            const payload = {
                user: userId,
                source: 'SwappiQ Monitoring',
                note: note
            };
            
            await this.client.post(
                `/alerts/${alertId}/notes`,
                payload,
                {
                    params: { identifierType: 'alias' }
                }
            );
            
            return { success: true };
            
        } catch (error) {
            console.error('Failed to add note:', error);
            throw error;
        }
    }
    
    /**
     * Escalate alert to next level
     */
    async escalateAlert(alertId, escalationId, note = '') {
        try {
            const payload = {
                user: 'system',
                source: 'SwappiQ Monitoring',
                note: note || 'Alert escalated',
                escalation: {
                    id: escalationId,
                    type: 'escalation'
                }
            };
            
            await this.client.post(
                `/alerts/${alertId}/escalate`,
                payload,
                {
                    params: { identifierType: 'alias' }
                }
            );
            
            this.emit('alertEscalated', {
                alertId,
                escalationId,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('Opsgenie escalate error:', error);
            throw error;
        }
    }
    
    /**
     * Get responders based on notification target
     */
    async getResponders(notification) {
        const responders = [];
        const target = notification.target;
        
        if (target.type === 'user') {
            responders.push({
                type: 'user',
                id: target.id
            });
        } else if (target.type === 'team') {
            responders.push({
                type: 'team',
                id: target.teamId
            });
        } else if (target.rotation) {
            responders.push({
                type: 'schedule',
                id: target.rotation
            });
        }
        
        // Add escalation if specified
        if (notification.escalation) {
            responders.push({
                type: 'escalation',
                id: notification.escalation
            });
        }
        
        return responders;
    }
    
    /**
     * Map severity to Opsgenie priority
     */
    mapPriority(severity) {
        const mapping = {
            'critical': 'P1',
            'high': 'P2',
            'medium': 'P3',
            'low': 'P4',
            'info': 'P5'
        };
        
        return mapping[severity] || 'P3';
    }
    
    /**
     * Format alert message
     */
    formatMessage(alert) {
        if (alert.message) return alert.message;
        
        let message = `[${alert.severity.toUpperCase()}] `;
        
        if (alert.type === 'anomaly') {
            message += `Anomaly: ${alert.metric}`;
        } else if (alert.type === 'threshold') {
            message += `Threshold Breach: ${alert.metric}`;
        } else if (alert.type === 'prediction') {
            message += `Predicted Issue: ${alert.metric}`;
        } else if (alert.type === 'sla_violation') {
            message += `SLA Violation: ${alert.metric}`;
        } else {
            message += `Alert: ${alert.metric}`;
        }
        
        return message;
    }
    
    /**
     * Format alert description
     */
    formatDescription(alert) {
        let description = '';
        
        if (alert.description) {
            description = alert.description + '\n\n';
        }
        
        description += `Metric: ${alert.metric}\n`;
        
        if (alert.value !== undefined) {
            description += `Current Value: ${alert.value}\n`;
        }
        
        if (alert.threshold !== undefined) {
            description += `Threshold: ${alert.threshold}\n`;
        }
        
        if (alert.detection) {
            description += `\nDetection Details:\n`;
            description += `Algorithm: ${alert.detection.algorithm}\n`;
            description += `Score: ${alert.detection.score}\n`;
            description += `Confidence: ${(alert.detection.confidence * 100).toFixed(1)}%\n`;
        }
        
        if (alert.prediction) {
            description += `\nPrediction:\n`;
            description += `Time to Issue: ${alert.prediction.timeToIssue.human}\n`;
            description += `Predicted Value: ${alert.prediction.value}\n`;
        }
        
        return description;
    }
    
    /**
     * Get tags for alert
     */
    getTags(alert) {
        const tags = [];
        
        // Add severity
        tags.push(`severity:${alert.severity}`);
        
        // Add type
        tags.push(`type:${alert.type}`);
        
        // Add component
        if (alert.component) {
            tags.push(`component:${alert.component}`);
        }
        
        // Add environment
        if (alert.environment) {
            tags.push(`env:${alert.environment}`);
        }
        
        // Add custom tags
        if (alert.tags) {
            tags.push(...alert.tags);
        }
        
        return tags;
    }
    
    /**
     * Create schedule in Opsgenie
     */
    async createSchedule(name, rotations) {
        try {
            const payload = {
                name: name,
                description: `SwappiQ on-call schedule: ${name}`,
                enabled: true,
                timezone: rotations[0].timezone || 'UTC',
                rotations: rotations.map(rotation => ({
                    name: rotation.name,
                    startDate: new Date(rotation.startDate).toISOString(),
                    type: rotation.type || 'weekly',
                    length: rotation.length || 1,
                    participants: rotation.participants.map(p => ({
                        type: 'user',
                        id: p.id
                    })),
                    timeRestriction: rotation.timeRestriction
                }))
            };
            
            const response = await this.client.post('/schedules', payload);
            return response.data.data;
            
        } catch (error) {
            console.error('Failed to create schedule:', error);
            throw error;
        }
    }
    
    /**
     * Get who is on-call
     */
    async getOnCall(scheduleId) {
        try {
            const response = await this.client.get(`/schedules/${scheduleId}/on-calls`);
            return response.data.data;
            
        } catch (error) {
            console.error('Failed to get on-call:', error);
            return null;
        }
    }
    
    /**
     * Create escalation in Opsgenie
     */
    async createEscalation(name, rules) {
        try {
            const payload = {
                name: name,
                description: `SwappiQ escalation: ${name}`,
                rules: rules.map(rule => ({
                    condition: rule.condition || 'if-not-acked',
                    notifyType: rule.notifyType || 'all',
                    delay: {
                        timeAmount: rule.delayMinutes || 5,
                        timeUnit: 'minutes'
                    },
                    recipient: rule.recipient
                }))
            };
            
            const response = await this.client.post('/escalations', payload);
            return response.data.data;
            
        } catch (error) {
            console.error('Failed to create escalation:', error);
            throw error;
        }
    }
    
    /**
     * Create heartbeat monitor
     */
    async createHeartbeat(name, interval) {
        try {
            const payload = {
                name: name,
                description: `SwappiQ service heartbeat: ${name}`,
                interval: interval,
                intervalUnit: 'minutes',
                enabled: true
            };
            
            const response = await this.client.post('/heartbeats', payload);
            return response.data.data;
            
        } catch (error) {
            console.error('Failed to create heartbeat:', error);
            throw error;
        }
    }
    
    /**
     * Send heartbeat ping
     */
    async pingHeartbeat(name) {
        try {
            await this.client.get(`/heartbeats/${name}/ping`);
            return { success: true };
            
        } catch (error) {
            console.error('Failed to ping heartbeat:', error);
            throw error;
        }
    }
    
    /**
     * Get alert logs
     */
    async getAlertLogs(alertId) {
        try {
            const response = await this.client.get(
                `/alerts/${alertId}/logs`,
                {
                    params: { identifierType: 'alias' }
                }
            );
            
            return response.data.data;
            
        } catch (error) {
            console.error('Failed to get alert logs:', error);
            return [];
        }
    }
    
    /**
     * Get incident details
     */
    async getIncident(incidentId) {
        try {
            const response = await this.client.get(`/incidents/${incidentId}`);
            return response.data.data;
            
        } catch (error) {
            console.error('Failed to get incident:', error);
            return null;
        }
    }
    
    /**
     * Create maintenance window
     */
    async createMaintenance(description, startTime, endTime) {
        try {
            const payload = {
                description: description,
                time: {
                    type: 'schedule',
                    startDate: startTime.toISOString(),
                    endDate: endTime.toISOString()
                }
            };
            
            const response = await this.client.post('/maintenance', payload);
            return response.data.data;
            
        } catch (error) {
            console.error('Failed to create maintenance:', error);
            throw error;
        }
    }
    
    /**
     * Get alert statistics
     */
    async getAlertStats(startDate, endDate) {
        try {
            const response = await this.client.get('/reports/alerts-count', {
                params: {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                    groupBy: 'priority'
                }
            });
            
            return response.data.data;
            
        } catch (error) {
            console.error('Failed to get alert stats:', error);
            return null;
        }
    }
}

module.exports = OpsgenieIntegration;