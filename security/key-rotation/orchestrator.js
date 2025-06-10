#!/usr/bin/env node

const KeyRotationManager = require('./KeyRotationManager');
const ScheduledRotationService = require('./scheduled-rotation');
const EventBasedRotationService = require('./event-rotation');
const RotationMonitoringService = require('./monitoring');
const KeyRotationTestSuite = require('./test-suite');
const fs = require('fs').promises;
const path = require('path');

/**
 * Key Rotation System Orchestrator
 * Manages all key rotation services and provides unified interface
 */
class KeyRotationOrchestrator {
    constructor(config = {}) {
        this.config = {
            // Environment
            environment: config.environment || process.env.NODE_ENV || 'development',
            
            // Rotation settings
            rotationIntervalDays: config.rotationIntervalDays || 30,
            schedulePattern: config.schedulePattern || '0 2 * * *', // Daily at 2 AM
            
            // Monitoring settings
            monitoringIntervalMinutes: config.monitoringIntervalMinutes || 60,
            enableAlerts: config.enableAlerts !== false,
            
            // Security settings
            encryptionPassword: config.encryptionPassword || process.env.KEY_ENCRYPTION_PASSWORD,
            emergencyRotationEnabled: config.emergencyRotationEnabled !== false,
            
            // Paths
            keyStorePath: config.keyStorePath || path.join(process.cwd(), 'security', 'keys'),
            backupPath: config.backupPath || path.join(process.cwd(), 'security', 'backups'),
            logPath: config.logPath || path.join(process.cwd(), 'security', 'rotation.log'),
            
            // Alert channels
            alertEmail: config.alertEmail || process.env.ALERT_EMAIL,
            alertWebhook: config.alertWebhook || process.env.ALERT_WEBHOOK,
            slackWebhook: config.slackWebhook || process.env.SLACK_WEBHOOK,
            
            ...config
        };
        
        this.services = {
            rotationManager: null,
            scheduledService: null,
            eventService: null,
            monitoringService: null
        };
        
        this.isInitialized = false;
        this.runningServices = new Set();
    }

    /**
     * Initialize all services
     */
    async initialize() {
        if (this.isInitialized) {
            console.log('⚠️  Key rotation system already initialized');
            return;
        }

        console.log('🚀 Initializing Key Rotation System...');
        console.log(`🌍 Environment: ${this.config.environment}`);
        console.log(`⏰ Rotation Interval: ${this.config.rotationIntervalDays} days`);
        console.log(`📅 Schedule Pattern: ${this.config.schedulePattern}`);
        
        try {
            // Create necessary directories
            await this.createDirectories();
            
            // Initialize core rotation manager
            this.services.rotationManager = new KeyRotationManager({
                rotationInterval: this.config.rotationIntervalDays * 24 * 60 * 60 * 1000,
                keyStorePath: this.config.keyStorePath,
                backupPath: this.config.backupPath,
                logPath: this.config.logPath
            });
            
            // Initialize scheduled rotation service
            this.services.scheduledService = new ScheduledRotationService({
                schedulePattern: this.config.schedulePattern,
                rotationIntervalDays: this.config.rotationIntervalDays,
                enableNotifications: this.config.enableAlerts,
                dryRun: this.config.environment === 'development'
            });
            
            // Initialize event-based rotation service
            this.services.eventService = new EventBasedRotationService({
                maxFailedAttempts: 5,
                suspiciousActivityThreshold: 10,
                rotationCooldown: 60 * 60 * 1000, // 1 hour
                enableAutoRotation: this.config.emergencyRotationEnabled
            });
            
            // Initialize monitoring service
            this.services.monitoringService = new RotationMonitoringService({
                checkInterval: this.config.monitoringIntervalMinutes * 60 * 1000,
                alertChannels: {
                    email: this.config.alertEmail,
                    webhook: this.config.alertWebhook,
                    slack: this.config.slackWebhook
                }
            });
            
            // Set up event listeners between services
            this.setupServiceIntegration();
            
            console.log('✅ Key rotation system initialized successfully');
            this.isInitialized = true;
            
        } catch (error) {
            console.error('❌ Failed to initialize key rotation system:', error.message);
            throw error;
        }
    }

    /**
     * Create necessary directories
     */
    async createDirectories() {
        const directories = [
            this.config.keyStorePath,
            this.config.backupPath,
            path.dirname(this.config.logPath)
        ];
        
        for (const dir of directories) {
            await fs.mkdir(dir, { recursive: true });
        }
        
        console.log('📁 Created directory structure');
    }

    /**
     * Setup integration between services
     */
    setupServiceIntegration() {
        // Forward event service rotation events to monitoring
        this.services.eventService.on('rotation_completed', (event) => {
            console.log('🔄 Event-triggered rotation completed:', event.keyType);
        });
        
        this.services.eventService.on('rotation_failed', (event) => {
            console.error('❌ Event-triggered rotation failed:', event.keyType, event.error);
        });
        
        console.log('🔗 Service integration configured');
    }

    /**
     * Start all services
     */
    async startAllServices() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        console.log('🚀 Starting all key rotation services...');
        
        try {
            // Start monitoring service first
            if (!this.runningServices.has('monitoring')) {
                this.services.monitoringService.start();
                this.runningServices.add('monitoring');
                console.log('✅ Monitoring service started');
            }
            
            // Start scheduled rotation service
            if (!this.runningServices.has('scheduled')) {
                this.services.scheduledService.start();
                this.runningServices.add('scheduled');
                console.log('✅ Scheduled rotation service started');
            }
            
            // Event service is always listening (doesn't need explicit start)
            this.runningServices.add('events');
            console.log('✅ Event-based rotation service active');
            
            console.log('🎉 All key rotation services are now running');
            
            // Log current status
            await this.getSystemStatus();
            
        } catch (error) {
            console.error('❌ Failed to start services:', error.message);
            throw error;
        }
    }

    /**
     * Stop all services
     */
    async stopAllServices() {
        console.log('🛑 Stopping all key rotation services...');
        
        try {
            if (this.runningServices.has('scheduled')) {
                this.services.scheduledService.stop();
                this.runningServices.delete('scheduled');
                console.log('✅ Scheduled rotation service stopped');
            }
            
            if (this.runningServices.has('monitoring')) {
                this.services.monitoringService.stop();
                this.runningServices.delete('monitoring');
                console.log('✅ Monitoring service stopped');
            }
            
            this.runningServices.delete('events');
            console.log('✅ Event-based rotation service deactivated');
            
            console.log('🏁 All services stopped');
            
        } catch (error) {
            console.error('❌ Error stopping services:', error.message);
        }
    }

    /**
     * Get comprehensive system status
     */
    async getSystemStatus() {
        if (!this.isInitialized) {
            return { status: 'not_initialized' };
        }
        
        try {
            // Get rotation status
            const rotationStatus = await this.services.rotationManager.getRotationStatus();
            
            // Get monitoring data
            const monitoringData = this.services.monitoringService.getMonitoringData();
            
            // Get scheduled service status
            const scheduledStatus = this.services.scheduledService.getStatus();
            
            const systemStatus = {
                timestamp: new Date().toISOString(),
                environment: this.config.environment,
                initialized: this.isInitialized,
                runningServices: Array.from(this.runningServices),
                services: {
                    rotation: {
                        keyStatuses: rotationStatus
                    },
                    monitoring: {
                        healthStatus: monitoringData.healthStatus,
                        alertCount: monitoringData.alerts?.length || 0,
                        lastCheck: monitoringData.lastCheck,
                        isRunning: monitoringData.isRunning
                    },
                    scheduled: {
                        isRunning: scheduledStatus.isRunning,
                        nextCheck: scheduledStatus.nextCheck,
                        dryRun: scheduledStatus.dryRun
                    }
                },
                config: {
                    rotationIntervalDays: this.config.rotationIntervalDays,
                    schedulePattern: this.config.schedulePattern,
                    alertsEnabled: this.config.enableAlerts,
                    emergencyRotationEnabled: this.config.emergencyRotationEnabled
                }
            };
            
            console.log('📊 SYSTEM STATUS:');
            console.log(`   Environment: ${systemStatus.environment}`);
            console.log(`   Running Services: ${systemStatus.runningServices.join(', ')}`);
            console.log(`   Health Status: ${systemStatus.services.monitoring.healthStatus}`);
            console.log(`   Active Alerts: ${systemStatus.services.monitoring.alertCount}`);
            
            return systemStatus;
            
        } catch (error) {
            console.error('❌ Failed to get system status:', error.message);
            return { status: 'error', error: error.message };
        }
    }

    /**
     * Perform immediate rotation for specific key
     */
    async rotateKey(keyType, options = {}) {
        if (!this.isInitialized) {
            throw new Error('System not initialized');
        }
        
        console.log(`🔄 Performing manual rotation for ${keyType}...`);
        
        try {
            const result = await this.services.rotationManager.rotateKey(keyType, {
                trigger: 'manual',
                rotatedBy: 'orchestrator',
                ...options
            });
            
            console.log(`✅ Manual rotation completed for ${keyType}`);
            
            // Trigger monitoring check after rotation
            setTimeout(() => {
                this.services.monitoringService.performHealthCheck();
            }, 1000);
            
            return result;
            
        } catch (error) {
            console.error(`❌ Manual rotation failed for ${keyType}:`, error.message);
            throw error;
        }
    }

    /**
     * Perform emergency rotation
     */
    async emergencyRotation(keyType, reason = 'manual_emergency') {
        if (!this.isInitialized) {
            throw new Error('System not initialized');
        }
        
        console.log(`🚨 EMERGENCY ROTATION for ${keyType}...`);
        
        try {
            const result = await this.services.rotationManager.emergencyRotateKey(keyType, reason);
            
            console.log(`✅ Emergency rotation completed for ${keyType}`);
            
            // Immediate monitoring check
            await this.services.monitoringService.performHealthCheck();
            
            return result;
            
        } catch (error) {
            console.error(`❌ Emergency rotation failed for ${keyType}:`, error.message);
            throw error;
        }
    }

    /**
     * Run system tests
     */
    async runTests() {
        console.log('🧪 Running key rotation system tests...');
        
        const testSuite = new KeyRotationTestSuite({
            useTestKeys: true,
            cleanupAfterTests: true
        });
        
        const results = await testSuite.runAllTests();
        
        if (results.success) {
            console.log('✅ All tests passed');
        } else {
            console.log(`❌ ${results.failedTests} tests failed`);
        }
        
        return results;
    }

    /**
     * Generate system health report
     */
    async generateHealthReport() {
        if (!this.isInitialized) {
            throw new Error('System not initialized');
        }
        
        console.log('📋 Generating comprehensive health report...');
        
        const report = await this.services.monitoringService.generateHealthReport();
        const systemStatus = await this.getSystemStatus();
        
        const comprehensiveReport = {
            timestamp: new Date().toISOString(),
            systemStatus,
            healthReport: report,
            recommendations: this.generateRecommendations(report, systemStatus)
        };
        
        return comprehensiveReport;
    }

    /**
     * Generate recommendations based on system status
     */
    generateRecommendations(healthReport, systemStatus) {
        const recommendations = [];
        
        // Check for critical alerts
        if (healthReport.criticalAlerts > 0) {
            recommendations.push({
                priority: 'critical',
                type: 'immediate_action',
                message: `${healthReport.criticalAlerts} critical alerts require immediate attention`
            });
        }
        
        // Check for overdue rotations
        for (const [keyType, status] of Object.entries(healthReport.keyStatuses)) {
            if (status.alerts?.some(a => a.type === 'rotation_overdue')) {
                recommendations.push({
                    priority: 'high',
                    type: 'rotation_needed',
                    message: `Key rotation overdue for ${keyType}`,
                    action: `Run: node orchestrator.js rotate ${keyType}`
                });
            }
        }
        
        // Check service health
        if (!systemStatus.services.monitoring.isRunning) {
            recommendations.push({
                priority: 'medium',
                type: 'service_issue',
                message: 'Monitoring service is not running',
                action: 'Start monitoring service'
            });
        }
        
        if (!systemStatus.services.scheduled.isRunning) {
            recommendations.push({
                priority: 'medium',
                type: 'service_issue',
                message: 'Scheduled rotation service is not running',
                action: 'Start scheduled rotation service'
            });
        }
        
        return recommendations;
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const subCommand = args[1];

    const orchestrator = new KeyRotationOrchestrator({
        environment: process.env.NODE_ENV || 'development',
        rotationIntervalDays: parseInt(process.env.ROTATION_INTERVAL_DAYS) || 30,
        schedulePattern: process.env.ROTATION_SCHEDULE || '0 2 * * *',
        monitoringIntervalMinutes: parseInt(process.env.MONITORING_INTERVAL) || 60,
        encryptionPassword: process.env.KEY_ENCRYPTION_PASSWORD,
        alertEmail: process.env.ALERT_EMAIL,
        alertWebhook: process.env.ALERT_WEBHOOK,
        slackWebhook: process.env.SLACK_WEBHOOK
    });

    try {
        switch (command) {
            case 'start':
                await orchestrator.startAllServices();
                
                // Keep the process running
                process.on('SIGINT', async () => {
                    console.log('\n🛑 Received SIGINT, stopping services...');
                    await orchestrator.stopAllServices();
                    process.exit(0);
                });
                
                process.on('SIGTERM', async () => {
                    console.log('\n🛑 Received SIGTERM, stopping services...');
                    await orchestrator.stopAllServices();
                    process.exit(0);
                });
                
                // Keep alive
                setInterval(() => {
                    // Just keep the process running
                }, 60000);
                
                break;

            case 'stop':
                await orchestrator.stopAllServices();
                break;

            case 'status':
                await orchestrator.getSystemStatus();
                break;

            case 'rotate':
                if (!subCommand) {
                    console.log('❌ Please specify key type to rotate');
                    console.log('   Available: PRIVATE_KEY, ARBITER_PRIVATE_KEY');
                    process.exit(1);
                }
                
                await orchestrator.initialize();
                const result = await orchestrator.rotateKey(subCommand);
                console.log('🎉 Rotation completed:', result);
                break;

            case 'emergency':
                if (!subCommand) {
                    console.log('❌ Please specify key type for emergency rotation');
                    console.log('   Available: PRIVATE_KEY, ARBITER_PRIVATE_KEY');
                    process.exit(1);
                }
                
                const reason = args[2] || 'manual_emergency';
                await orchestrator.initialize();
                const emergencyResult = await orchestrator.emergencyRotation(subCommand, reason);
                console.log('🚨 Emergency rotation completed:', emergencyResult);
                break;

            case 'test':
                const testResults = await orchestrator.runTests();
                process.exit(testResults.success ? 0 : 1);
                break;

            case 'report':
                await orchestrator.initialize();
                const report = await orchestrator.generateHealthReport();
                
                // Save report
                const reportPath = path.join(process.cwd(), 'security', 'health-report.json');
                await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
                
                console.log('📋 HEALTH REPORT:');
                console.log(JSON.stringify(report, null, 2));
                console.log(`\n📄 Report saved to: ${reportPath}`);
                break;

            case 'init':
                await orchestrator.initialize();
                console.log('✅ Key rotation system initialized');
                break;

            default:
                console.log('Meta Aggregator 2.0 - Key Rotation System Orchestrator');
                console.log('');
                console.log('USAGE: node orchestrator.js <command> [options]');
                console.log('');
                console.log('COMMANDS:');
                console.log('  start                Start all key rotation services');
                console.log('  stop                 Stop all services');
                console.log('  status               Show system status');
                console.log('  rotate <keyType>     Manually rotate specific key');
                console.log('  emergency <keyType>  Emergency rotation for specific key');
                console.log('  test                 Run system tests');
                console.log('  report               Generate comprehensive health report');
                console.log('  init                 Initialize system (create directories, etc.)');
                console.log('');
                console.log('KEY TYPES:');
                console.log('  PRIVATE_KEY         Backend signing key');
                console.log('  ARBITER_PRIVATE_KEY Escrow arbiter key');
                console.log('');
                console.log('ENVIRONMENT VARIABLES:');
                console.log('  NODE_ENV                     Environment (development/production)');
                console.log('  ROTATION_INTERVAL_DAYS       Days between rotations (default: 30)');
                console.log('  ROTATION_SCHEDULE            Cron pattern (default: "0 2 * * *")');
                console.log('  MONITORING_INTERVAL          Minutes between health checks (default: 60)');
                console.log('  KEY_ENCRYPTION_PASSWORD      Password for key encryption');
                console.log('  ALERT_EMAIL                  Email for critical alerts');
                console.log('  ALERT_WEBHOOK                Webhook URL for alerts');
                console.log('  SLACK_WEBHOOK                Slack webhook for notifications');
                console.log('');
                console.log('EXAMPLES:');
                console.log('  node orchestrator.js start');
                console.log('  node orchestrator.js rotate PRIVATE_KEY');
                console.log('  node orchestrator.js emergency ARBITER_PRIVATE_KEY security_breach');
                console.log('  node orchestrator.js test');
                console.log('  node orchestrator.js report');
                process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ Command failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = KeyRotationOrchestrator;
