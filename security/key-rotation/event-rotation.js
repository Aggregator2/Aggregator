#!/usr/bin/env node

const KeyRotationManager = require('./KeyRotationManager');
const EventEmitter = require('events');

/**
 * Event-Based Key Rotation Service
 * Triggers key rotation based on specific events like security alerts,
 * failed authentication attempts, or external triggers
 */

class EventBasedRotationService extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            maxFailedAttempts: config.maxFailedAttempts || 5,
            suspiciousActivityThreshold: config.suspiciousActivityThreshold || 10,
            rotationCooldown: config.rotationCooldown || 60 * 60 * 1000, // 1 hour
            enableAutoRotation: config.enableAutoRotation !== false,
            ...config
        };
        
        this.rotationManager = new KeyRotationManager();
        this.eventCounters = new Map();
        this.lastRotations = new Map();
        this.isMonitoring = false;
        
        // Set up event listeners
        this.setupEventListeners();
    }

    /**
     * Setup internal event listeners
     */
    setupEventListeners() {
        // Security breach detected
        this.on('security_breach', async (event) => {
            console.log('🚨 SECURITY BREACH DETECTED:', event);
            await this.handleSecurityBreach(event);
        });

        // Failed authentication attempts
        this.on('auth_failure', async (event) => {
            await this.handleAuthFailure(event);
        });

        // Suspicious activity detected
        this.on('suspicious_activity', async (event) => {
            await this.handleSuspiciousActivity(event);
        });

        // External trigger (API call, webhook, etc.)
        this.on('external_trigger', async (event) => {
            console.log('🔔 EXTERNAL ROTATION TRIGGER:', event);
            await this.handleExternalTrigger(event);
        });

        // Key compromise detected
        this.on('key_compromise', async (event) => {
            console.log('🚨 KEY COMPROMISE DETECTED:', event);
            await this.handleKeyCompromise(event);
        });

        // Anomaly detection
        this.on('anomaly_detected', async (event) => {
            await this.handleAnomalyDetection(event);
        });
    }

    /**
     * Check if rotation is in cooldown period
     * @param {string} keyType 
     * @returns {boolean}
     */
    isInCooldown(keyType) {
        const lastRotation = this.lastRotations.get(keyType);
        if (!lastRotation) return false;
        
        return (Date.now() - lastRotation) < this.config.rotationCooldown;
    }

    /**
     * Handle security breach event
     * @param {Object} event 
     */
    async handleSecurityBreach(event) {
        const { severity = 'high', affectedKeys = ['PRIVATE_KEY', 'ARBITER_PRIVATE_KEY'], source } = event;
        
        console.log(`🚨 HANDLING SECURITY BREACH - Severity: ${severity}`);
        
        if (severity === 'critical' || severity === 'high') {
            // Immediate rotation for all affected keys
            for (const keyType of affectedKeys) {
                if (this.isInCooldown(keyType)) {
                    console.log(`⏳ ${keyType} rotation skipped - in cooldown period`);
                    continue;
                }

                try {
                    console.log(`🔄 Emergency rotating ${keyType} due to security breach...`);
                    
                    const result = await this.rotationManager.emergencyRotateKey(
                        keyType, 
                        `security_breach_${severity}_${source || 'unknown'}`
                    );

                    this.lastRotations.set(keyType, Date.now());
                    
                    console.log(`✅ Emergency rotation completed for ${keyType}`);
                    
                    // Emit completion event
                    this.emit('rotation_completed', {
                        keyType,
                        trigger: 'security_breach',
                        severity,
                        result
                    });
                    
                } catch (error) {
                    console.error(`❌ Emergency rotation failed for ${keyType}:`, error.message);
                    
                    this.emit('rotation_failed', {
                        keyType,
                        trigger: 'security_breach',
                        error: error.message
                    });
                }
            }
        }
    }

    /**
     * Handle authentication failure events
     * @param {Object} event 
     */
    async handleAuthFailure(event) {
        const { keyType = 'PRIVATE_KEY', source, timestamp } = event;
        
        // Increment failure counter
        const countKey = `auth_failure_${keyType}`;
        const currentCount = this.eventCounters.get(countKey) || 0;
        this.eventCounters.set(countKey, currentCount + 1);
        
        console.log(`🔐 Auth failure #${currentCount + 1} for ${keyType} from ${source}`);
        
        // Check if threshold exceeded
        if (currentCount + 1 >= this.config.maxFailedAttempts) {
            console.log(`🚨 THRESHOLD EXCEEDED: ${currentCount + 1} failed attempts for ${keyType}`);
            
            // Reset counter
            this.eventCounters.set(countKey, 0);
            
            // Trigger rotation
            if (!this.isInCooldown(keyType) && this.config.enableAutoRotation) {
                try {
                    console.log(`🔄 Rotating ${keyType} due to excessive auth failures...`);
                    
                    const result = await this.rotationManager.rotateKey(keyType, {
                        trigger: 'auth_failure_threshold',
                        rotatedBy: 'event_service',
                        reason: `${currentCount + 1}_consecutive_auth_failures`
                    });

                    this.lastRotations.set(keyType, Date.now());
                    
                    console.log(`✅ Rotation completed for ${keyType} due to auth failures`);
                    
                    this.emit('rotation_completed', {
                        keyType,
                        trigger: 'auth_failure_threshold',
                        failureCount: currentCount + 1,
                        result
                    });
                    
                } catch (error) {
                    console.error(`❌ Auth failure rotation failed for ${keyType}:`, error.message);
                }
            }
        }
    }

    /**
     * Handle suspicious activity events
     * @param {Object} event 
     */
    async handleSuspiciousActivity(event) {
        const { activity, severity = 'medium', keyType = 'PRIVATE_KEY' } = event;
        
        // Increment suspicious activity counter
        const countKey = `suspicious_${keyType}`;
        const currentCount = this.eventCounters.get(countKey) || 0;
        this.eventCounters.set(countKey, currentCount + 1);
        
        console.log(`🕵️ Suspicious activity #${currentCount + 1} detected: ${activity}`);
        
        if (currentCount + 1 >= this.config.suspiciousActivityThreshold) {
            console.log(`🚨 SUSPICIOUS ACTIVITY THRESHOLD EXCEEDED for ${keyType}`);
            
            // Reset counter
            this.eventCounters.set(countKey, 0);
            
            if (severity === 'high' && !this.isInCooldown(keyType)) {
                // Trigger rotation for high severity
                try {
                    const result = await this.rotationManager.rotateKey(keyType, {
                        trigger: 'suspicious_activity',
                        rotatedBy: 'event_service',
                        reason: `suspicious_activity_threshold_${activity}`
                    });

                    this.lastRotations.set(keyType, Date.now());
                    
                    this.emit('rotation_completed', {
                        keyType,
                        trigger: 'suspicious_activity',
                        activity,
                        result
                    });
                    
                } catch (error) {
                    console.error(`❌ Suspicious activity rotation failed:`, error.message);
                }
            }
        }
    }

    /**
     * Handle external rotation triggers
     * @param {Object} event 
     */
    async handleExternalTrigger(event) {
        const { keyType, reason, requestedBy, immediate = false } = event;
        
        if (!keyType) {
            console.error('❌ External trigger missing keyType');
            return;
        }
        
        if (!immediate && this.isInCooldown(keyType)) {
            console.log(`⏳ External rotation for ${keyType} skipped - in cooldown period`);
            return;
        }
        
        try {
            console.log(`🔄 Processing external rotation trigger for ${keyType}...`);
            
            const result = await this.rotationManager.rotateKey(keyType, {
                trigger: 'external',
                rotatedBy: requestedBy || 'external_system',
                reason: reason || 'external_trigger'
            });

            this.lastRotations.set(keyType, Date.now());
            
            console.log(`✅ External rotation completed for ${keyType}`);
            
            this.emit('rotation_completed', {
                keyType,
                trigger: 'external',
                requestedBy,
                result
            });
            
        } catch (error) {
            console.error(`❌ External rotation failed for ${keyType}:`, error.message);
            
            this.emit('rotation_failed', {
                keyType,
                trigger: 'external',
                error: error.message
            });
        }
    }

    /**
     * Handle key compromise events
     * @param {Object} event 
     */
    async handleKeyCompromise(event) {
        const { keyType, evidence, severity = 'critical' } = event;
        
        console.log(`🚨 KEY COMPROMISE - ${keyType}: ${evidence}`);
        
        // Immediate emergency rotation regardless of cooldown
        try {
            const result = await this.rotationManager.emergencyRotateKey(
                keyType,
                `key_compromise_${evidence}`
            );

            this.lastRotations.set(keyType, Date.now());
            
            console.log(`✅ Emergency rotation completed for compromised ${keyType}`);
            
            this.emit('rotation_completed', {
                keyType,
                trigger: 'key_compromise',
                evidence,
                severity,
                result
            });
            
        } catch (error) {
            console.error(`❌ Compromise rotation failed for ${keyType}:`, error.message);
            
            this.emit('rotation_failed', {
                keyType,
                trigger: 'key_compromise',
                error: error.message
            });
        }
    }

    /**
     * Handle anomaly detection events
     * @param {Object} event 
     */
    async handleAnomalyDetection(event) {
        const { anomalyType, confidence, keyType = 'PRIVATE_KEY', details } = event;
        
        console.log(`🔍 ANOMALY DETECTED - Type: ${anomalyType}, Confidence: ${confidence}%`);
        
        // Only rotate for high-confidence anomalies
        if (confidence >= 85 && !this.isInCooldown(keyType)) {
            try {
                console.log(`🔄 Rotating ${keyType} due to high-confidence anomaly...`);
                
                const result = await this.rotationManager.rotateKey(keyType, {
                    trigger: 'anomaly_detection',
                    rotatedBy: 'anomaly_detection_system',
                    reason: `${anomalyType}_anomaly_${confidence}pct_confidence`
                });

                this.lastRotations.set(keyType, Date.now());
                
                this.emit('rotation_completed', {
                    keyType,
                    trigger: 'anomaly_detection',
                    anomalyType,
                    confidence,
                    result
                });
                
            } catch (error) {
                console.error(`❌ Anomaly rotation failed for ${keyType}:`, error.message);
            }
        }
    }

    /**
     * Start monitoring for events
     */
    start() {
        if (this.isMonitoring) {
            console.log('⚠️  Event-based rotation service is already running');
            return;
        }

        console.log('🚀 Starting event-based key rotation service...');
        console.log(`📊 Config: Max auth failures: ${this.config.maxFailedAttempts}`);
        console.log(`📊 Config: Suspicious activity threshold: ${this.config.suspiciousActivityThreshold}`);
        console.log(`📊 Config: Rotation cooldown: ${this.config.rotationCooldown / 1000}s`);
        console.log(`📊 Config: Auto rotation: ${this.config.enableAutoRotation ? 'ON' : 'OFF'}`);

        this.isMonitoring = true;
        
        // Clear old counters
        this.eventCounters.clear();
        
        console.log('✅ Event-based rotation service started');
        
        // Example of how to set up external monitoring integrations:
        this.setupExternalIntegrations();
    }

    /**
     * Stop monitoring for events
     */
    stop() {
        if (!this.isMonitoring) {
            console.log('⚠️  Event-based rotation service is not running');
            return;
        }

        console.log('🛑 Stopping event-based key rotation service...');
        
        this.isMonitoring = false;
        this.eventCounters.clear();
        this.removeAllListeners();
        
        console.log('✅ Event-based rotation service stopped');
    }

    /**
     * Setup external integrations (example implementations)
     */
    setupExternalIntegrations() {
        // Example: Monitor log files for suspicious activity
        // this.monitorLogFiles();
        
        // Example: Set up webhook endpoint for external triggers
        // this.setupWebhookEndpoint();
        
        // Example: Monitor blockchain for unusual activity
        // this.monitorBlockchainActivity();
        
        console.log('🔌 External integrations ready (implement as needed)');
    }

    /**
     * Get current service status
     * @returns {Object}
     */
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            config: this.config,
            eventCounters: Object.fromEntries(this.eventCounters),
            lastRotations: Object.fromEntries(this.lastRotations),
            listeners: this.listenerCount()
        };
    }

    /**
     * Reset event counters
     */
    resetCounters() {
        this.eventCounters.clear();
        console.log('🔄 Event counters reset');
    }
}

// CLI Interface and test events
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    const service = new EventBasedRotationService({
        enableAutoRotation: !args.includes('--no-auto'),
        maxFailedAttempts: parseInt(process.env.MAX_AUTH_FAILURES) || 5,
        suspiciousActivityThreshold: parseInt(process.env.SUSPICIOUS_THRESHOLD) || 10
    });

    switch (command) {
        case 'start':
            service.start();
            
            // Set up graceful shutdown
            process.on('SIGINT', () => {
                console.log('\n🛑 Received SIGINT, stopping service...');
                service.stop();
                process.exit(0);
            });
            
            // Keep alive and show example events
            console.log('\n📝 EXAMPLE EVENTS YOU CAN TRIGGER:');
            console.log('• Security breach: service.emit("security_breach", { severity: "high", source: "firewall" })');
            console.log('• Auth failure: service.emit("auth_failure", { keyType: "PRIVATE_KEY", source: "api" })');
            console.log('• External trigger: service.emit("external_trigger", { keyType: "PRIVATE_KEY", reason: "manual_request" })');
            
            setInterval(() => {}, 60000); // Keep alive
            break;

        case 'test':
            const testType = args[1];
            service.start();
            
            switch (testType) {
                case 'breach':
                    service.emit('security_breach', {
                        severity: 'high',
                        source: 'test_simulation',
                        affectedKeys: ['PRIVATE_KEY']
                    });
                    break;
                
                case 'auth':
                    // Simulate multiple auth failures
                    for (let i = 0; i < 6; i++) {
                        service.emit('auth_failure', {
                            keyType: 'PRIVATE_KEY',
                            source: `test_source_${i}`,
                            timestamp: Date.now()
                        });
                    }
                    break;
                
                case 'external':
                    service.emit('external_trigger', {
                        keyType: 'ARBITER_PRIVATE_KEY',
                        reason: 'test_external_trigger',
                        requestedBy: 'test_system'
                    });
                    break;
                
                default:
                    console.log('Available test types: breach, auth, external');
                    process.exit(1);
            }
            
            setTimeout(() => {
                service.stop();
                process.exit(0);
            }, 5000);
            break;

        case 'status':
            console.log('🔧 SERVICE STATUS:');
            console.log(JSON.stringify(service.getStatus(), null, 2));
            break;

        default:
            console.log('USAGE: node event-rotation.js <command>');
            console.log('');
            console.log('COMMANDS:');
            console.log('  start           Start the event-based rotation service');
            console.log('  test <type>     Test with simulated events (breach, auth, external)');
            console.log('  status          Show current status');
            console.log('');
            console.log('OPTIONS:');
            console.log('  --no-auto       Disable automatic rotations');
            console.log('');
            console.log('ENVIRONMENT VARIABLES:');
            console.log('  MAX_AUTH_FAILURES     Max failed auth attempts (default: 5)');
            console.log('  SUSPICIOUS_THRESHOLD  Suspicious activity threshold (default: 10)');
            process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = EventBasedRotationService;
