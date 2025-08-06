const axios = require('axios');
const EventEmitter = require('events');

/**
 * PagerDuty Integration for SwappiQ Alerting System
 */
class PagerDutyIntegration extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            apiKey: config.apiKey,
            integrationKey: config.integrationKey,
            baseUrl: config.baseUrl || 'https://api.pagerduty.com',
            from: config.from || 'swappiq-alerts@swappiq.com',
            ...config
        };
        
        if (!this.config.apiKey || !this.config.integrationKey) {
            throw new Error('PagerDuty API key and integration key are required');
        }
        
        this.client = axios.create({
            baseURL: this.config.baseUrl,
            headers: {
                'Authorization': `Token token=${this.config.apiKey}`,
                'Accept': 'application/vnd.pagerduty+json;version=2',
                'Content-Type': 'application/json'
            }
        });
        
        this.incidents = new Map();
    }
    
    /**
     * Send notification to PagerDuty user
     */
    async send(userId, notification) {
        try {
            const incident = await this.createIncident(notification);
            
            this.incidents.set(notification.alertId, incident);
            
            this.emit('notificationSent', {
                channel: 'pagerduty',
                userId,
                alertId: notification.alertId,
                incidentId: incident.id,
                timestamp: Date.now()
            });
            
            return incident;
            
        } catch (error) {
            console.error('PagerDuty notification error:', error);
            this.emit('error', { userId, notification, error });
            throw error;
        }
    }
    
    /**
     * Create PagerDuty incident
     */
    async createIncident(notification) {
        const alert = notification.alert;
        const severity = this.mapSeverity(alert.severity);
        
        const payload = {
            routing_key: this.config.integrationKey,
            event_action: 'trigger',
            dedup_key: notification.alertId,
            payload: {
                summary: this.formatSummary(alert),
                severity: severity,
                source: alert.source || 'swappiq-monitoring',
                component: alert.component || alert.metric,
                group: alert.group || 'swappiq',
                class: alert.class || this.getAlertClass(alert),
                custom_details: {
                    metric: alert.metric,
                    value: alert.value,
                    threshold: alert.threshold,
                    detection: alert.detection,
                    timestamp: alert.timestamp,
                    ...alert.metadata
                }
            },
            images: this.createImages(alert),
            links: this.createLinks(alert),
            client: 'SwappiQ Monitoring',
            client_url: `${this.config.dashboardUrl}/alerts/${notification.alertId}`
        };
        
        const response = await axios.post(
            'https://events.pagerduty.com/v2/enqueue',
            payload
        );
        
        return {
            id: response.data.dedup_key,
            status: response.data.status,
            message: response.data.message
        };
    }
    
    /**
     * Acknowledge incident in PagerDuty
     */
    async acknowledgeIncident(alertId, userId) {
        try {
            const incident = this.incidents.get(alertId);
            if (!incident) {
                throw new Error('Incident not found');
            }
            
            const payload = {
                routing_key: this.config.integrationKey,
                event_action: 'acknowledge',
                dedup_key: alertId
            };
            
            await axios.post(
                'https://events.pagerduty.com/v2/enqueue',
                payload
            );
            
            this.emit('incidentAcknowledged', {
                alertId,
                userId,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('PagerDuty acknowledge error:', error);
            throw error;
        }
    }
    
    /**
     * Resolve incident in PagerDuty
     */
    async resolveIncident(alertId, resolution) {
        try {
            const incident = this.incidents.get(alertId);
            if (!incident) {
                throw new Error('Incident not found');
            }
            
            const payload = {
                routing_key: this.config.integrationKey,
                event_action: 'resolve',
                dedup_key: alertId
            };
            
            await axios.post(
                'https://events.pagerduty.com/v2/enqueue',
                payload
            );
            
            this.incidents.delete(alertId);
            
            this.emit('incidentResolved', {
                alertId,
                resolution,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('PagerDuty resolve error:', error);
            throw error;
        }
    }
    
    /**
     * Get user details from PagerDuty
     */
    async getUser(userId) {
        try {
            const response = await this.client.get(`/users/${userId}`);
            return response.data.user;
        } catch (error) {
            console.error('Failed to get PagerDuty user:', error);
            return null;
        }
    }
    
    /**
     * Get escalation policy
     */
    async getEscalationPolicy(policyId) {
        try {
            const response = await this.client.get(`/escalation_policies/${policyId}`);
            return response.data.escalation_policy;
        } catch (error) {
            console.error('Failed to get escalation policy:', error);
            return null;
        }
    }
    
    /**
     * Get on-call users for a schedule
     */
    async getOnCallUsers(scheduleId) {
        try {
            const now = new Date().toISOString();
            const response = await this.client.get(`/schedules/${scheduleId}/users`, {
                params: {
                    since: now,
                    until: now
                }
            });
            
            return response.data.users;
        } catch (error) {
            console.error('Failed to get on-call users:', error);
            return [];
        }
    }
    
    /**
     * Create escalation policy in PagerDuty
     */
    async createEscalationPolicy(name, rules) {
        try {
            const escalationRules = rules.map((rule, index) => ({
                escalation_delay_in_minutes: rule.delayMinutes || 30,
                targets: rule.targets.map(target => {
                    if (target.type === 'user') {
                        return {
                            id: target.id,
                            type: 'user_reference'
                        };
                    } else if (target.type === 'schedule') {
                        return {
                            id: target.id,
                            type: 'schedule_reference'
                        };
                    }
                })
            }));
            
            const payload = {
                escalation_policy: {
                    type: 'escalation_policy',
                    name: name,
                    escalation_rules: escalationRules,
                    num_loops: 0,
                    services: []
                }
            };
            
            const response = await this.client.post('/escalation_policies', payload);
            return response.data.escalation_policy;
            
        } catch (error) {
            console.error('Failed to create escalation policy:', error);
            throw error;
        }
    }
    
    /**
     * Update incident urgency
     */
    async updateIncidentUrgency(incidentId, urgency) {
        try {
            const payload = {
                incident: {
                    type: 'incident',
                    urgency: urgency // 'low' or 'high'
                }
            };
            
            const response = await this.client.put(
                `/incidents/${incidentId}`,
                payload,
                {
                    headers: {
                        'From': this.config.from
                    }
                }
            );
            
            return response.data.incident;
            
        } catch (error) {
            console.error('Failed to update incident urgency:', error);
            throw error;
        }
    }
    
    /**
     * Add note to incident
     */
    async addIncidentNote(incidentId, note) {
        try {
            const payload = {
                note: {
                    content: note
                }
            };
            
            const response = await this.client.post(
                `/incidents/${incidentId}/notes`,
                payload,
                {
                    headers: {
                        'From': this.config.from
                    }
                }
            );
            
            return response.data.note;
            
        } catch (error) {
            console.error('Failed to add incident note:', error);
            throw error;
        }
    }
    
    /**
     * Map severity to PagerDuty severity
     */
    mapSeverity(severity) {
        const mapping = {
            'critical': 'critical',
            'high': 'error',
            'medium': 'warning',
            'low': 'info',
            'info': 'info'
        };
        
        return mapping[severity] || 'warning';
    }
    
    /**
     * Format alert summary
     */
    formatSummary(alert) {
        if (alert.summary) return alert.summary;
        
        let summary = `[${alert.severity.toUpperCase()}] `;
        
        if (alert.type === 'anomaly') {
            summary += `Anomaly detected in ${alert.metric}`;
        } else if (alert.type === 'threshold') {
            summary += `${alert.metric} exceeded threshold`;
        } else if (alert.type === 'prediction') {
            summary += `Predicted issue with ${alert.metric}`;
        } else if (alert.type === 'sla_violation') {
            summary += `SLA violation for ${alert.metric}`;
        } else {
            summary += `Alert for ${alert.metric}`;
        }
        
        if (alert.value !== undefined) {
            summary += ` (${alert.value})`;
        }
        
        return summary;
    }
    
    /**
     * Get alert class
     */
    getAlertClass(alert) {
        if (alert.class) return alert.class;
        
        const typeMapping = {
            'anomaly': 'anomaly_detection',
            'threshold': 'threshold_breach',
            'prediction': 'predictive_alert',
            'sla_violation': 'sla_violation',
            'resource_exhaustion': 'resource_alert'
        };
        
        return typeMapping[alert.type] || 'alert';
    }
    
    /**
     * Create images for incident
     */
    createImages(alert) {
        const images = [];
        
        if (alert.chartUrl) {
            images.push({
                src: alert.chartUrl,
                alt: `Chart for ${alert.metric}`,
                type: 'chart'
            });
        }
        
        if (alert.dashboardUrl) {
            images.push({
                src: alert.dashboardUrl,
                alt: 'Dashboard screenshot',
                type: 'dashboard'
            });
        }
        
        return images;
    }
    
    /**
     * Create links for incident
     */
    createLinks(alert) {
        const links = [];
        
        if (this.config.dashboardUrl) {
            links.push({
                href: `${this.config.dashboardUrl}/metrics/${alert.metric}`,
                text: 'View Metric Dashboard'
            });
        }
        
        if (alert.runbookUrl) {
            links.push({
                href: alert.runbookUrl,
                text: 'Runbook'
            });
        }
        
        if (alert.logsUrl) {
            links.push({
                href: alert.logsUrl,
                text: 'View Logs'
            });
        }
        
        return links;
    }
    
    /**
     * Sync on-call schedule with internal rotation
     */
    async syncOnCallSchedule(scheduleId, rotation) {
        try {
            const pagerDutySchedule = await this.client.get(`/schedules/${scheduleId}`);
            const schedule = pagerDutySchedule.data.schedule;
            
            // Get current on-call
            const onCallUsers = await this.getOnCallUsers(scheduleId);
            
            return {
                schedule: schedule.name,
                currentOnCall: onCallUsers,
                nextHandoff: schedule.next_handoff,
                finalHandoff: schedule.final_handoff
            };
            
        } catch (error) {
            console.error('Failed to sync schedule:', error);
            throw error;
        }
    }
    
    /**
     * Create maintenance window
     */
    async createMaintenanceWindow(start, end, description) {
        try {
            const payload = {
                maintenance_window: {
                    type: 'maintenance_window',
                    start_time: start.toISOString(),
                    end_time: end.toISOString(),
                    description: description,
                    services: this.config.services || []
                }
            };
            
            const response = await this.client.post('/maintenance_windows', payload);
            return response.data.maintenance_window;
            
        } catch (error) {
            console.error('Failed to create maintenance window:', error);
            throw error;
        }
    }
    
    /**
     * Get incident analytics
     */
    async getIncidentAnalytics(startDate, endDate) {
        try {
            const response = await this.client.get('/analytics/incidents', {
                params: {
                    since: startDate.toISOString(),
                    until: endDate.toISOString(),
                    time_zone: 'UTC'
                }
            });
            
            return response.data;
            
        } catch (error) {
            console.error('Failed to get incident analytics:', error);
            return null;
        }
    }
}

module.exports = PagerDutyIntegration;