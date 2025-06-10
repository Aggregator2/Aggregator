#!/usr/bin/env node

const KeyRotationManager = require('./KeyRotationManager');
// Using native setTimeout instead of node-cron for simplicity

/**
 * Scheduled Key Rotation Service
 * Automatically rotates keys based on predefined schedule
 */

class ScheduledRotationService {
    constructor(config = {}) {
        this.config = {
            // Default: Check every day at 2 AM
            schedulePattern: config.schedulePattern || '0 2 * * *',
            rotationIntervalDays: config.rotationIntervalDays || 30,
            enableNotifications: config.enableNotifications !== false,
            dryRun: config.dryRun || false,
            ...config
        };
        
        this.rotationManager = new KeyRotationManager({
            rotationInterval: this.config.rotationIntervalDays * 24 * 60 * 60 * 1000
        });
        
        this.isRunning = false;
        this.nextRotationCheck = null;
    }

    /**
     * Send notification about rotation event
     * @param {Object} event 
     */
    async sendNotification(event) {
        if (!this.config.enableNotifications) return;

        const message = this.formatNotificationMessage(event);
        console.log('📧 NOTIFICATION:', message);
        
        // Here you could integrate with:
        // - Email service (SendGrid, AWS SES)
        // - Slack webhooks
        // - Discord webhooks
        // - SMS service (Twilio)
        // - PagerDuty for emergencies
        
        // Example webhook notification (commented out):
        /*
        if (this.config.webhookUrl) {
            try {
                await fetch(this.config.webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: message,
                        timestamp: new Date().toISOString(),
                        event: event
                    })
                });
            } catch (error) {
                console.error('Failed to send webhook notification:', error);
            }
        }
        */
    }

    /**
     * Format notification message
     * @param {Object} event 
     * @returns {string}
     */
    formatNotificationMessage(event) {
        switch (event.type) {
            case 'rotation_due':
                return `🔄 Key rotation due for ${event.keyType}. Age: ${event.age} days`;
            case 'rotation_success':
                return `✅ Key rotation successful for ${event.keyType}. New version: ${event.newVersion}`;
            case 'rotation_failed':
                return `❌ Key rotation failed for ${event.keyType}. Error: ${event.error}`;
            case 'service_started':
                return `🚀 Scheduled rotation service started. Next check: ${event.nextCheck}`;
            case 'service_stopped':
                return `🛑 Scheduled rotation service stopped`;
            default:
                return `📝 Rotation event: ${JSON.stringify(event)}`;
        }
    }

    /**
     * Check if keys need rotation and perform if necessary
     */
    async performScheduledCheck() {
        console.log(`🔍 Performing scheduled rotation check at ${new Date().toISOString()}`);
        
        try {
            const status = await this.rotationManager.getRotationStatus();
            const rotationsNeeded = [];
            
            // Check each key type
            for (const [keyType, info] of Object.entries(status)) {
                if (info.isDue) {
                    rotationsNeeded.push(keyType);
                    
                    await this.sendNotification({
                        type: 'rotation_due',
                        keyType,
                        currentVersion: info.currentVersion,
                        age: Math.floor((Date.now() - info.lastRotation) / (24 * 60 * 60 * 1000))
                    });
                }
            }

            if (rotationsNeeded.length === 0) {
                console.log('✅ No key rotations needed at this time');
                return;
            }

            console.log(`🔄 Keys needing rotation: ${rotationsNeeded.join(', ')}`);

            // Perform rotations if not in dry-run mode
            if (this.config.dryRun) {
                console.log('🧪 DRY RUN MODE: Would rotate keys but taking no action');
                return;
            }

            for (const keyType of rotationsNeeded) {
                try {
                    console.log(`🔄 Starting scheduled rotation for ${keyType}...`);
                    
                    const result = await this.rotationManager.rotateKey(keyType, {
                        trigger: 'scheduled',
                        rotatedBy: 'scheduled_service',
                        reason: 'scheduled_rotation_due'
                    });

                    console.log(`✅ Scheduled rotation successful for ${keyType}`);
                    
                    await this.sendNotification({
                        type: 'rotation_success',
                        keyType,
                        oldVersion: result.oldVersion,
                        newVersion: result.newVersion,
                        newAddress: result.newAddress
                    });
                    
                } catch (error) {
                    console.error(`❌ Scheduled rotation failed for ${keyType}:`, error.message);
                    
                    await this.sendNotification({
                        type: 'rotation_failed',
                        keyType,
                        error: error.message
                    });
                }
            }
            
        } catch (error) {
            console.error('❌ Scheduled check failed:', error.message);
        }
    }

    /**
     * Start the scheduled rotation service
     */
    start() {
        if (this.isRunning) {
            console.log('⚠️  Scheduled rotation service is already running');
            return;
        }

        console.log('🚀 Starting scheduled key rotation service...');
        console.log(`📅 Schedule: ${this.config.schedulePattern}`);
        console.log(`⏰ Rotation interval: ${this.config.rotationIntervalDays} days`);
        console.log(`🧪 Dry run mode: ${this.config.dryRun ? 'ON' : 'OFF'}`);        // Schedule the rotation checks using simple timeout
        const scheduleNextCheck = () => {
            // Calculate milliseconds until next 2 AM
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(2, 0, 0, 0);
            const msUntilNext = tomorrow.getTime() - now.getTime();
            
            this.scheduledTimeout = setTimeout(async () => {
                await this.performScheduledCheck();
                scheduleNextCheck(); // Reschedule for next day
            }, msUntilNext);
        };

        scheduleNextCheck();
        this.isRunning = true;

        // Calculate next check time
        this.updateNextCheckTime();

        console.log(`✅ Scheduled rotation service started`);
        console.log(`⏰ Next check: ${this.nextRotationCheck}`);

        // Send startup notification
        this.sendNotification({
            type: 'service_started',
            nextCheck: this.nextRotationCheck,
            schedule: this.config.schedulePattern
        });
    }

    /**
     * Stop the scheduled rotation service
     */
    stop() {
        if (!this.isRunning) {
            console.log('⚠️  Scheduled rotation service is not running');
            return;
        }        console.log('🛑 Stopping scheduled key rotation service...');
        
        if (this.scheduledTimeout) {
            clearTimeout(this.scheduledTimeout);
            this.scheduledTimeout = null;
        }

        this.isRunning = false;
        this.nextRotationCheck = null;

        console.log('✅ Scheduled rotation service stopped');
        
        // Send shutdown notification
        this.sendNotification({
            type: 'service_stopped'
        });
    }

    /**
     * Update next check time for display
     */
    updateNextCheckTime() {
        // This is a simplified calculation - in production you'd want to use a proper cron parser
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(2, 0, 0, 0); // 2 AM
        
        this.nextRotationCheck = tomorrow.toISOString();
    }

    /**
     * Get service status
     * @returns {Object}
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            schedulePattern: this.config.schedulePattern,
            rotationIntervalDays: this.config.rotationIntervalDays,
            nextCheck: this.nextRotationCheck,
            dryRun: this.config.dryRun
        };
    }

    /**
     * Perform immediate check (for testing)
     */
    async checkNow() {
        console.log('🔍 Performing immediate rotation check...');
        await this.performScheduledCheck();
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    const service = new ScheduledRotationService({
        dryRun: args.includes('--dry-run'),
        schedulePattern: process.env.ROTATION_SCHEDULE || '0 2 * * *', // Daily at 2 AM
        rotationIntervalDays: parseInt(process.env.ROTATION_INTERVAL_DAYS) || 30
    });

    switch (command) {
        case 'start':
            service.start();
            
            // Keep the process running
            process.on('SIGINT', () => {
                console.log('\n🛑 Received SIGINT, stopping service...');
                service.stop();
                process.exit(0);
            });
            
            process.on('SIGTERM', () => {
                console.log('\n🛑 Received SIGTERM, stopping service...');
                service.stop();
                process.exit(0);
            });
            
            // Keep alive
            setInterval(() => {
                // Just keep the process running
            }, 60000);
            
            break;

        case 'stop':
            // In a real implementation, you'd send a signal to a running service
            console.log('To stop the service, send SIGINT or SIGTERM to the running process');
            break;

        case 'status':
            const keyStatus = await service.rotationManager.getRotationStatus();
            console.log('🔑 KEY STATUS:');
            console.log(JSON.stringify(keyStatus, null, 2));
            
            console.log('\n🔧 SERVICE STATUS:');
            console.log(JSON.stringify(service.getStatus(), null, 2));
            break;

        case 'check':
            await service.checkNow();
            break;

        default:
            console.log('USAGE: node scheduled-rotation.js <command>');
            console.log('');
            console.log('COMMANDS:');
            console.log('  start    Start the scheduled rotation service');
            console.log('  stop     Stop the scheduled rotation service');
            console.log('  status   Show current status');
            console.log('  check    Perform immediate rotation check');
            console.log('');
            console.log('OPTIONS:');
            console.log('  --dry-run    Run in dry-run mode (no actual rotations)');
            console.log('');
            console.log('ENVIRONMENT VARIABLES:');
            console.log('  ROTATION_SCHEDULE         Cron pattern (default: "0 2 * * *")');
            console.log('  ROTATION_INTERVAL_DAYS    Days between rotations (default: 30)');
            process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = ScheduledRotationService;
