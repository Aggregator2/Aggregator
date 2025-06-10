#!/usr/bin/env node

const KeyRotationManager = require('./KeyRotationManager');
const ScheduledRotationService = require('./scheduled-rotation');
const EventBasedRotationService = require('./event-rotation');
const fs = require('fs').promises;
const path = require('path');

/**
 * Key Rotation Monitoring and Alerting System
 * Monitors key rotation health, sends alerts, and provides dashboard data
 */
class RotationMonitoringService {
    constructor(config = {}) {
        this.config = {
            checkInterval: config.checkInterval || 60 * 60 * 1000, // 1 hour
            alertThresholds: {
                daysUntilExpiry: 7,
                failedRotationCount: 3,
                staleRotationDays: 35
            },
            alertChannels: {
                email: config.email || process.env.ALERT_EMAIL,
                webhook: config.webhook || process.env.ALERT_WEBHOOK,
                slack: config.slack || process.env.SLACK_WEBHOOK
            },
            ...config
        };
        
        this.rotationManager = new KeyRotationManager();
        this.monitoringData = {
            lastCheck: null,
            alerts: [],
            healthStatus: 'unknown',
            keyStatuses: new Map()
        };
        
        this.isRunning = false;
        this.checkInterval = null;
    }

    /**
     * Start monitoring service
     */
    start() {
        if (this.isRunning) {
            console.log('⚠️  Monitoring service is already running');
            return;
        }

        console.log('🔍 Starting key rotation monitoring service...');
        console.log(`⏰ Check interval: ${this.config.checkInterval / 1000 / 60} minutes`);
        
        this.isRunning = true;
        
        // Perform initial check
        this.performHealthCheck();
        
        // Schedule regular checks
        this.checkInterval = setInterval(() => {
            this.performHealthCheck();
        }, this.config.checkInterval);
        
        console.log('✅ Monitoring service started');
    }

    /**
     * Stop monitoring service
     */
    stop() {
        if (!this.isRunning) {
            console.log('⚠️  Monitoring service is not running');
            return;
        }

        console.log('🛑 Stopping monitoring service...');
        
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        
        this.isRunning = false;
        console.log('✅ Monitoring service stopped');
    }

    /**
     * Perform comprehensive health check
     */
    async performHealthCheck() {
        console.log(`🔍 Performing health check at ${new Date().toISOString()}`);
        
        try {
            this.monitoringData.lastCheck = new Date().toISOString();
            
            // Check rotation status for all keys
            const rotationStatus = await this.rotationManager.getRotationStatus();
            
            let overallHealth = 'healthy';
            const alerts = [];
            
            for (const [keyType, status] of Object.entries(rotationStatus)) {
                const keyHealth = await this.checkKeyHealth(keyType, status);
                
                this.monitoringData.keyStatuses.set(keyType, keyHealth);
                
                // Collect alerts
                if (keyHealth.alerts.length > 0) {
                    alerts.push(...keyHealth.alerts);
                }
                
                // Update overall health
                if (keyHealth.status === 'critical') {
                    overallHealth = 'critical';
                } else if (keyHealth.status === 'warning' && overallHealth === 'healthy') {
                    overallHealth = 'warning';
                }
            }
            
            this.monitoringData.healthStatus = overallHealth;
            this.monitoringData.alerts = alerts;
            
            // Send alerts if necessary
            if (alerts.length > 0) {
                await this.sendAlerts(alerts);
            }
            
            // Log health status
            this.logHealthStatus(overallHealth, alerts);
            
        } catch (error) {
            console.error('❌ Health check failed:', error.message);
            this.monitoringData.healthStatus = 'error';
            this.monitoringData.alerts.push({
                type: 'system_error',
                severity: 'critical',
                message: `Health check failed: ${error.message}`,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Check health of individual key
     * @param {string} keyType 
     * @param {Object} status 
     * @returns {Object}
     */
    async checkKeyHealth(keyType, status) {
        const alerts = [];
        let keyStatus = 'healthy';
        
        try {
            // Check if key file exists
            const keyPath = path.join(
                this.rotationManager.config.keyStorePath,
                `${status.keyId}.json`
            );
            
            let keyData;
            try {
                keyData = JSON.parse(await fs.readFile(keyPath, 'utf8'));
            } catch (error) {
                alerts.push({
                    type: 'missing_key_file',
                    severity: 'critical',
                    message: `Key file not found for ${keyType}`,
                    keyType,
                    timestamp: new Date().toISOString()
                });
                keyStatus = 'critical';
                
                return { status: keyStatus, alerts, lastUpdate: null };
            }
            
            const keyAge = Date.now() - new Date(keyData.timestamp).getTime();
            const keyAgeDays = Math.floor(keyAge / (24 * 60 * 60 * 1000));
            
            // Check if rotation is overdue
            if (status.isDue) {
                const severity = keyAgeDays > this.config.alertThresholds.staleRotationDays ? 'critical' : 'warning';
                alerts.push({
                    type: 'rotation_overdue',
                    severity,
                    message: `Key rotation overdue for ${keyType} (${keyAgeDays} days old)`,
                    keyType,
                    ageDays: keyAgeDays,
                    timestamp: new Date().toISOString()
                });
                
                if (severity === 'critical') {
                    keyStatus = 'critical';
                } else if (keyStatus === 'healthy') {
                    keyStatus = 'warning';
                }
            }
            
            // Check if rotation is due soon
            const daysUntilRotation = this.config.alertThresholds.daysUntilExpiry;
            if (keyAgeDays >= (30 - daysUntilRotation)) {
                alerts.push({
                    type: 'rotation_due_soon',
                    severity: 'info',
                    message: `Key rotation due soon for ${keyType} (${30 - keyAgeDays} days remaining)`,
                    keyType,
                    daysRemaining: 30 - keyAgeDays,
                    timestamp: new Date().toISOString()
                });
            }
            
            return {
                status: keyStatus,
                alerts,
                lastUpdate: keyData.timestamp,
                ageDays: keyAgeDays,
                version: status.currentVersion
            };
            
        } catch (error) {
            alerts.push({
                type: 'health_check_error',
                severity: 'warning',
                message: `Health check failed for ${keyType}: ${error.message}`,
                keyType,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            return {
                status: 'warning',
                alerts,
                lastUpdate: null,
                error: error.message
            };
        }
    }

    /**
     * Send alerts through configured channels
     * @param {Array} alerts 
     */
    async sendAlerts(alerts) {
        const criticalAlerts = alerts.filter(a => a.severity === 'critical');
        const warningAlerts = alerts.filter(a => a.severity === 'warning');
        
        if (criticalAlerts.length > 0) {
            console.log(`🚨 CRITICAL ALERTS: ${criticalAlerts.length}`);
            await this.sendCriticalAlerts(criticalAlerts);
        }
        
        if (warningAlerts.length > 0) {
            console.log(`⚠️  WARNING ALERTS: ${warningAlerts.length}`);
            await this.sendWarningAlerts(warningAlerts);
        }
    }

    /**
     * Send critical alerts (immediate notification)
     * @param {Array} alerts 
     */
    async sendCriticalAlerts(alerts) {
        const message = this.formatAlertMessage('CRITICAL', alerts);
        
        // Console notification
        console.log('🚨 CRITICAL ALERT:', message);
        
        // Email notification (if configured)
        if (this.config.alertChannels.email) {
            await this.sendEmailAlert('CRITICAL', message, alerts);
        }
        
        // Webhook notification (if configured)
        if (this.config.alertChannels.webhook) {
            await this.sendWebhookAlert('CRITICAL', message, alerts);
        }
        
        // Slack notification (if configured)
        if (this.config.alertChannels.slack) {
            await this.sendSlackAlert('CRITICAL', message, alerts);
        }
    }

    /**
     * Send warning alerts (regular notification)
     * @param {Array} alerts 
     */
    async sendWarningAlerts(alerts) {
        const message = this.formatAlertMessage('WARNING', alerts);
        
        // Console notification
        console.log('⚠️  WARNING ALERT:', message);
        
        // Only send to webhook/slack for warnings (less noisy)
        if (this.config.alertChannels.webhook) {
            await this.sendWebhookAlert('WARNING', message, alerts);
        }
    }

    /**
     * Format alert message
     * @param {string} level 
     * @param {Array} alerts 
     * @returns {string}
     */
    formatAlertMessage(level, alerts) {
        const summary = `${level}: ${alerts.length} key rotation alert(s)`;
        const details = alerts.map(alert => 
            `- ${alert.type}: ${alert.message}`
        ).join('\n');
        
        return `${summary}\n\n${details}`;
    }

    /**
     * Send webhook alert
     * @param {string} level 
     * @param {string} message 
     * @param {Array} alerts 
     */
    async sendWebhookAlert(level, message, alerts) {
        try {
            // This would integrate with your webhook system
            console.log(`📡 Would send ${level} webhook alert:`, message);
            
            // Example implementation:
            /*
            const response = await fetch(this.config.alertChannels.webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    level,
                    message,
                    alerts,
                    timestamp: new Date().toISOString(),
                    service: 'key-rotation-monitoring'
                })
            });
            */
            
        } catch (error) {
            console.error('Failed to send webhook alert:', error.message);
        }
    }

    /**
     * Send Slack alert
     * @param {string} level 
     * @param {string} message 
     * @param {Array} alerts 
     */
    async sendSlackAlert(level, message, alerts) {
        try {
            console.log(`💬 Would send ${level} Slack alert:`, message);
            
            // Example Slack webhook implementation:
            /*
            const slackMessage = {
                text: `🔑 Key Rotation Alert - ${level}`,
                attachments: [{
                    color: level === 'CRITICAL' ? 'danger' : 'warning',
                    fields: [{
                        title: 'Alert Details',
                        value: message,
                        short: false
                    }],
                    ts: Math.floor(Date.now() / 1000)
                }]
            };
            
            const response = await fetch(this.config.alertChannels.slack, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(slackMessage)
            });
            */
            
        } catch (error) {
            console.error('Failed to send Slack alert:', error.message);
        }
    }

    /**
     * Send email alert
     * @param {string} level 
     * @param {string} message 
     * @param {Array} alerts 
     */
    async sendEmailAlert(level, message, alerts) {
        try {
            console.log(`📧 Would send ${level} email alert to ${this.config.alertChannels.email}:`, message);
            
            // This would integrate with your email service (SendGrid, AWS SES, etc.)
            
        } catch (error) {
            console.error('Failed to send email alert:', error.message);
        }
    }

    /**
     * Log health status
     * @param {string} status 
     * @param {Array} alerts 
     */
    logHealthStatus(status, alerts) {
        const statusEmoji = {
            'healthy': '✅',
            'warning': '⚠️',
            'critical': '🚨',
            'error': '❌'
        };
        
        console.log(`${statusEmoji[status]} Overall Health: ${status.toUpperCase()}`);
        
        if (alerts.length > 0) {
            console.log(`📋 Active Alerts: ${alerts.length}`);
            alerts.forEach(alert => {
                console.log(`   - ${alert.type}: ${alert.message}`);
            });
        } else {
            console.log('✅ No active alerts');
        }
    }

    /**
     * Get current monitoring data
     * @returns {Object}
     */
    getMonitoringData() {
        return {
            ...this.monitoringData,
            isRunning: this.isRunning,
            checkInterval: this.config.checkInterval,
            keyStatuses: Object.fromEntries(this.monitoringData.keyStatuses)
        };
    }

    /**
     * Generate health report
     * @returns {Object}
     */
    async generateHealthReport() {
        await this.performHealthCheck();
        
        const report = {
            timestamp: new Date().toISOString(),
            overallStatus: this.monitoringData.healthStatus,
            totalAlerts: this.monitoringData.alerts.length,
            criticalAlerts: this.monitoringData.alerts.filter(a => a.severity === 'critical').length,
            warningAlerts: this.monitoringData.alerts.filter(a => a.severity === 'warning').length,
            keyStatuses: Object.fromEntries(this.monitoringData.keyStatuses),
            alerts: this.monitoringData.alerts,
            lastCheck: this.monitoringData.lastCheck
        };
        
        return report;
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    const service = new RotationMonitoringService({
        checkInterval: parseInt(process.env.MONITORING_INTERVAL) || 60 * 60 * 1000, // 1 hour
        email: process.env.ALERT_EMAIL,
        webhook: process.env.ALERT_WEBHOOK,
        slack: process.env.SLACK_WEBHOOK
    });

    switch (command) {
        case 'start':
            service.start();
            
            // Keep the process running
            process.on('SIGINT', () => {
                console.log('\n🛑 Received SIGINT, stopping monitoring...');
                service.stop();
                process.exit(0);
            });
            
            process.on('SIGTERM', () => {
                console.log('\n🛑 Received SIGTERM, stopping monitoring...');
                service.stop();
                process.exit(0);
            });
            
            // Keep alive
            setInterval(() => {
                // Just keep the process running
            }, 60000);
            
            break;

        case 'check':
            await service.performHealthCheck();
            console.log('\n📊 MONITORING DATA:');
            console.log(JSON.stringify(service.getMonitoringData(), null, 2));
            break;

        case 'report':
            const report = await service.generateHealthReport();
            console.log('📋 HEALTH REPORT:');
            console.log(JSON.stringify(report, null, 2));
            break;

        case 'status':
            const data = service.getMonitoringData();
            console.log('🔍 MONITORING STATUS:');
            console.log(JSON.stringify(data, null, 2));
            break;

        default:
            console.log('USAGE: node monitoring.js <command>');
            console.log('');
            console.log('COMMANDS:');
            console.log('  start    Start the monitoring service');
            console.log('  check    Perform immediate health check');
            console.log('  report   Generate comprehensive health report');
            console.log('  status   Show current monitoring status');
            console.log('');
            console.log('ENVIRONMENT VARIABLES:');
            console.log('  MONITORING_INTERVAL   Check interval in ms (default: 3600000)');
            console.log('  ALERT_EMAIL          Email address for critical alerts');
            console.log('  ALERT_WEBHOOK        Webhook URL for alerts');
            console.log('  SLACK_WEBHOOK        Slack webhook for notifications');
            process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = RotationMonitoringService;
