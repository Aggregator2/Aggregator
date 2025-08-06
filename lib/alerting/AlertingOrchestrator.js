const EventEmitter = require('events');
const AnomalyDetector = require('./AnomalyDetector');
const PredictiveAlerting = require('./PredictiveAlerting');
const SLAMonitor = require('./SLAMonitor');
const EscalationManager = require('./EscalationManager');
const PagerDutyIntegration = require('./PagerDutyIntegration');
const OpsgenieIntegration = require('./OpsgenieIntegration');

/**
 * Alerting Orchestrator - Coordinates all alerting components
 */
class AlertingOrchestrator extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = config;
        
        // Initialize components
        this.anomalyDetector = new AnomalyDetector(config.anomaly);
        this.predictiveAlerting = new PredictiveAlerting(config.predictive);
        this.slaMonitor = new SLAMonitor(config.sla);
        this.escalationManager = new EscalationManager(config.escalation);
        
        // Initialize integrations
        this.integrations = new Map();
        
        if (config.pagerduty) {
            this.integrations.set('pagerduty', new PagerDutyIntegration(config.pagerduty));
        }
        
        if (config.opsgenie) {
            this.integrations.set('opsgenie', new OpsgenieIntegration(config.opsgenie));
        }
        
        // Register channels with escalation manager
        this.registerChannels();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Alert deduplication
        this.recentAlerts = new Map();
        this.deduplicationWindow = config.deduplicationWindow || 300000; // 5 minutes
    }
    
    /**
     * Register notification channels
     */
    registerChannels() {
        // PagerDuty channel
        if (this.integrations.has('pagerduty')) {
            this.escalationManager.registerChannel('pagerduty', this.integrations.get('pagerduty'));
        }
        
        // Opsgenie channel
        if (this.integrations.has('opsgenie')) {
            this.escalationManager.registerChannel('opsgenie', this.integrations.get('opsgenie'));
        }
        
        // Email channel (example)
        this.escalationManager.registerChannel('email', {
            send: async (userId, notification) => {
                // Email implementation
                console.log(`Email to ${userId}:`, notification);
            }
        });
        
        // SMS channel (example)
        this.escalationManager.registerChannel('sms', {
            send: async (userId, notification) => {
                // SMS implementation
                console.log(`SMS to ${userId}:`, notification);
            }
        });
    }
    
    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Anomaly detection events
        this.anomalyDetector.on('anomalyDetected', async (anomaly) => {
            const alert = this.createAlert('anomaly', anomaly);
            await this.processAlert(alert);
        });
        
        // Predictive alerting events
        this.predictiveAlerting.on('predictiveAlert', async (prediction) => {
            const alert = this.createAlert('prediction', prediction);
            await this.processAlert(alert);
        });
        
        this.predictiveAlerting.on('resourceExhaustionPredicted', async (prediction) => {
            const alert = this.createAlert('resource_exhaustion', prediction);
            await this.processAlert(alert);
        });
        
        // SLA monitoring events
        this.slaMonitor.on('slaViolation', async (violation) => {
            const alert = this.createAlert('sla_violation', violation);
            await this.processAlert(alert);
        });
        
        this.slaMonitor.on('slaWarning', async (warning) => {
            const alert = this.createAlert('sla_warning', warning);
            await this.processAlert(alert);
        });
        
        // Escalation events
        this.escalationManager.on('alertAcknowledged', async (ack) => {
            await this.handleAcknowledgement(ack);
        });
        
        this.escalationManager.on('alertResolved', async (resolution) => {
            await this.handleResolution(resolution);
        });
    }
    
    /**
     * Create standardized alert object
     */
    createAlert(type, data) {
        const alert = {
            id: `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type,
            timestamp: Date.now(),
            source: 'swappiq-monitoring'
        };
        
        switch (type) {
            case 'anomaly':
                alert.metric = data.metric;
                alert.value = data.value;
                alert.detection = data.detection;
                alert.severity = data.severity;
                alert.summary = `Anomaly detected in ${data.metric}`;
                break;
                
            case 'prediction':
                alert.metric = data.metric;
                alert.prediction = data.prediction;
                alert.issues = data.issues;
                alert.severity = data.issues[0]?.level || 'medium';
                alert.summary = `Predicted issue with ${data.metric}`;
                alert.timeToIssue = data.timeToIssue;
                break;
                
            case 'resource_exhaustion':
                alert.metric = `resource.${data.type}`;
                alert.resourceType = data.type;
                alert.timeToExhaustion = data.timeToExhaustion;
                alert.severity = data.severity;
                alert.summary = data.recommendation;
                alert.currentUsage = data.currentUsage;
                alert.prediction = data;
                break;
                
            case 'sla_violation':
                alert.metric = `sla.${data.sla.id}`;
                alert.sla = data.sla;
                alert.result = data.result;
                alert.severity = 'high';
                alert.summary = `SLA violation: ${data.sla.name}`;
                alert.value = data.result.value;
                alert.threshold = data.sla.target;
                break;
                
            case 'sla_warning':
                alert.metric = `sla.${data.sla.id}`;
                alert.sla = data.sla;
                alert.result = data.result;
                alert.severity = 'medium';
                alert.summary = `SLA warning: ${data.sla.name}`;
                alert.value = data.result.value;
                alert.threshold = data.sla.warningThreshold;
                break;
        }
        
        return alert;
    }
    
    /**
     * Process alert through deduplication and escalation
     */
    async processAlert(alert) {
        try {
            // Check for deduplication
            if (this.isDuplicateAlert(alert)) {
                console.log('Duplicate alert suppressed:', alert.id);
                return;
            }
            
            // Record alert for deduplication
            this.recordAlert(alert);
            
            // Enrich alert with context
            await this.enrichAlert(alert);
            
            // Process through escalation manager
            await this.escalationManager.processAlert(alert);
            
            // Emit for external handlers
            this.emit('alertProcessed', alert);
            
            // Update metrics
            this.updateAlertMetrics(alert);
            
        } catch (error) {
            console.error('Alert processing error:', error);
            this.emit('error', { alert, error });
        }
    }
    
    /**
     * Check if alert is duplicate
     */
    isDuplicateAlert(alert) {
        const key = `${alert.type}-${alert.metric}`;
        const recent = this.recentAlerts.get(key);
        
        if (!recent) return false;
        
        const timeDiff = alert.timestamp - recent.timestamp;
        return timeDiff < this.deduplicationWindow;
    }
    
    /**
     * Record alert for deduplication
     */
    recordAlert(alert) {
        const key = `${alert.type}-${alert.metric}`;
        this.recentAlerts.set(key, {
            timestamp: alert.timestamp,
            id: alert.id
        });
        
        // Clean old entries
        setTimeout(() => {
            const current = this.recentAlerts.get(key);
            if (current && current.id === alert.id) {
                this.recentAlerts.delete(key);
            }
        }, this.deduplicationWindow);
    }
    
    /**
     * Enrich alert with additional context
     */
    async enrichAlert(alert) {
        // Add dashboard links
        alert.dashboardUrl = `${this.config.dashboardUrl}/alerts/${alert.id}`;
        alert.metricUrl = `${this.config.dashboardUrl}/metrics/${alert.metric}`;
        
        // Add runbook if available
        const runbook = this.getRunbook(alert.type, alert.metric);
        if (runbook) {
            alert.runbookUrl = runbook;
        }
        
        // Add historical context
        if (alert.metric) {
            const history = await this.anomalyDetector.getHistoricalData(alert.metric, 1);
            if (history.length > 0) {
                alert.context = {
                    recentValues: history.slice(-10),
                    trend: this.calculateTrend(history)
                };
            }
        }
        
        // Add environment info
        alert.environment = this.config.environment || 'production';
        alert.region = this.config.region || 'us-east-1';
        
        // Add tags
        alert.tags = this.generateTags(alert);
    }
    
    /**
     * Handle alert acknowledgement
     */
    async handleAcknowledgement(ack) {
        // Update integrations
        for (const [name, integration] of this.integrations) {
            try {
                if (integration.acknowledgeIncident) {
                    await integration.acknowledgeIncident(ack.alertId, ack.userId);
                } else if (integration.acknowledgeAlert) {
                    await integration.acknowledgeAlert(ack.alertId, ack.userId);
                }
            } catch (error) {
                console.error(`Failed to acknowledge in ${name}:`, error);
            }
        }
        
        this.emit('alertAcknowledged', ack);
    }
    
    /**
     * Handle alert resolution
     */
    async handleResolution(resolution) {
        // Update integrations
        for (const [name, integration] of this.integrations) {
            try {
                if (integration.resolveIncident) {
                    await integration.resolveIncident(resolution.alertId, resolution.resolution);
                } else if (integration.closeAlert) {
                    await integration.closeAlert(resolution.alertId, resolution.userId, resolution.resolution);
                }
            } catch (error) {
                console.error(`Failed to resolve in ${name}:`, error);
            }
        }
        
        this.emit('alertResolved', resolution);
    }
    
    /**
     * Get runbook URL for alert
     */
    getRunbook(type, metric) {
        const runbooks = this.config.runbooks || {};
        
        // Check specific metric runbook
        if (runbooks[metric]) {
            return runbooks[metric];
        }
        
        // Check type runbook
        if (runbooks[type]) {
            return runbooks[type];
        }
        
        // Check pattern matching
        for (const [pattern, url] of Object.entries(runbooks)) {
            if (metric && new RegExp(pattern).test(metric)) {
                return url;
            }
        }
        
        return null;
    }
    
    /**
     * Generate tags for alert
     */
    generateTags(alert) {
        const tags = [];
        
        tags.push(`type:${alert.type}`);
        tags.push(`severity:${alert.severity}`);
        tags.push(`env:${alert.environment}`);
        
        if (alert.metric) {
            const parts = alert.metric.split('.');
            if (parts.length > 1) {
                tags.push(`component:${parts[0]}`);
                tags.push(`measure:${parts[parts.length - 1]}`);
            }
        }
        
        if (alert.sla) {
            tags.push(`sla:${alert.sla.id}`);
        }
        
        return tags;
    }
    
    /**
     * Calculate trend from historical data
     */
    calculateTrend(history) {
        if (history.length < 2) return 'stable';
        
        const recent = history.slice(-10);
        const values = recent.map(h => h.value);
        
        // Simple linear regression
        const n = values.length;
        const sumX = values.reduce((_, __, i) => _ + i, 0);
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = values.reduce((acc, y, i) => acc + i * y, 0);
        const sumX2 = values.reduce((acc, _, i) => acc + i * i, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        
        if (Math.abs(slope) < 0.01) return 'stable';
        return slope > 0 ? 'increasing' : 'decreasing';
    }
    
    /**
     * Update alert metrics
     */
    updateAlertMetrics(alert) {
        // This would integrate with your metrics system
        console.log('Alert metrics:', {
            type: alert.type,
            severity: alert.severity,
            metric: alert.metric
        });
    }
    
    /**
     * Define monitoring configuration
     */
    async defineMonitoring(config) {
        // Define anomaly detection models
        if (config.anomalyDetection) {
            for (const metric of config.anomalyDetection.metrics) {
                await this.anomalyDetector.trainModel(
                    metric.name,
                    metric.historicalData,
                    metric.algorithm || 'zscore'
                );
            }
        }
        
        // Define predictive thresholds
        if (config.predictiveThresholds) {
            for (const threshold of config.predictiveThresholds) {
                this.predictiveAlerting.setPredictionThreshold(
                    threshold.metric,
                    threshold
                );
            }
        }
        
        // Define SLAs
        if (config.slas) {
            for (const sla of config.slas) {
                this.slaMonitor.defineSLA(sla);
            }
        }
        
        // Define escalation policies
        if (config.escalationPolicies) {
            for (const policy of config.escalationPolicies) {
                this.escalationManager.definePolicy(policy);
            }
        }
        
        // Define rotations
        if (config.rotations) {
            for (const rotation of config.rotations) {
                this.escalationManager.defineRotation(rotation);
            }
        }
    }
    
    /**
     * Get alerting statistics
     */
    async getStatistics(timeRange = 86400000) {
        const stats = {
            alerts: await this.escalationManager.getEscalationStats(timeRange),
            slas: {},
            predictions: {
                prevented: 0,
                accuracy: 0
            }
        };
        
        // Get SLA compliance stats
        for (const [slaId, sla] of this.slaMonitor.slas) {
            const report = await this.slaMonitor.getSLAReport(
                slaId,
                Date.now() - timeRange,
                Date.now()
            );
            stats.slas[slaId] = report?.summary;
        }
        
        return stats;
    }
}

module.exports = AlertingOrchestrator;