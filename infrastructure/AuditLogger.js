/**
 * @fileoverview Comprehensive Audit Logging System for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Centralized audit logging with compliance, forensics, and monitoring
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

/**
 * Comprehensive Audit Logging System
 */
class AuditLogger extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Output destinations
            outputs: {
                file: {
                    enabled: config.outputs?.file?.enabled !== false,
                    path: config.outputs?.file?.path || '/var/log/swappiq/audit.log',
                    maxSize: config.outputs?.file?.maxSize || 100 * 1024 * 1024, // 100MB
                    maxFiles: config.outputs?.file?.maxFiles || 50,
                    compression: config.outputs?.file?.compression !== false
                },
                syslog: {
                    enabled: config.outputs?.syslog?.enabled || false,
                    host: config.outputs?.syslog?.host || 'localhost',
                    port: config.outputs?.syslog?.port || 514,
                    facility: config.outputs?.syslog?.facility || 'local0'
                },
                database: {
                    enabled: config.outputs?.database?.enabled || false,
                    connectionString: config.outputs?.database?.connectionString || null,
                    table: config.outputs?.database?.table || 'audit_logs',
                    batchSize: config.outputs?.database?.batchSize || 100
                },
                elasticsearch: {
                    enabled: config.outputs?.elasticsearch?.enabled || false,
                    nodes: config.outputs?.elasticsearch?.nodes || ['http://localhost:9200'],
                    index: config.outputs?.elasticsearch?.index || 'swappiq-audit',
                    maxRetries: config.outputs?.elasticsearch?.maxRetries || 3
                },
                webhook: {
                    enabled: config.outputs?.webhook?.enabled || false,
                    url: config.outputs?.webhook?.url || null,
                    headers: config.outputs?.webhook?.headers || {},
                    timeout: config.outputs?.webhook?.timeout || 5000
                }
            },
            
            // Event categorization
            categories: {
                security: {
                    enabled: config.categories?.security?.enabled !== false,
                    retention: config.categories?.security?.retention || 2555200000, // 30 days
                    encryption: config.categories?.security?.encryption !== false
                },
                financial: {
                    enabled: config.categories?.financial?.enabled !== false,
                    retention: config.categories?.financial?.retention || 220752000000, // 7 years
                    encryption: config.categories?.financial?.encryption !== false
                },
                access: {
                    enabled: config.categories?.access?.enabled !== false,
                    retention: config.categories?.access?.retention || 7776000000, // 90 days
                    encryption: config.categories?.access?.encryption || false
                },
                admin: {
                    enabled: config.categories?.admin?.enabled !== false,
                    retention: config.categories?.admin?.retention || 31536000000, // 1 year
                    encryption: config.categories?.admin?.encryption !== false
                },
                error: {
                    enabled: config.categories?.error?.enabled !== false,
                    retention: config.categories?.error?.retention || 2555200000, // 30 days
                    encryption: config.categories?.error?.encryption || false
                }
            },
            
            // Security settings
            security: {
                encryption: {
                    enabled: config.security?.encryption?.enabled !== false,
                    algorithm: config.security?.encryption?.algorithm || 'aes-256-gcm',
                    keyRotationInterval: config.security?.encryption?.keyRotationInterval || 86400000
                },
                integrity: {
                    enabled: config.security?.integrity?.enabled !== false,
                    algorithm: config.security?.integrity?.algorithm || 'sha256',
                    chainValidation: config.security?.integrity?.chainValidation !== false
                },
                access: {
                    requireAuthentication: config.security?.access?.requireAuthentication !== false,
                    allowedRoles: config.security?.access?.allowedRoles || ['admin', 'auditor'],
                    apiKeyRequired: config.security?.access?.apiKeyRequired || false
                }
            },
            
            // Performance settings
            performance: {
                async: config.performance?.async !== false,
                bufferSize: config.performance?.bufferSize || 1000,
                flushInterval: config.performance?.flushInterval || 5000,
                compression: config.performance?.compression !== false,
                sampling: {
                    enabled: config.performance?.sampling?.enabled || false,
                    rate: config.performance?.sampling?.rate || 0.1, // 10%
                    categories: config.performance?.sampling?.categories || ['access']
                }
            },
            
            // Compliance settings
            compliance: {
                gdpr: {
                    enabled: config.compliance?.gdpr?.enabled || false,
                    anonymization: config.compliance?.gdpr?.anonymization !== false,
                    dataSubjectRights: config.compliance?.gdpr?.dataSubjectRights !== false
                },
                sox: {
                    enabled: config.compliance?.sox?.enabled || false,
                    financialControls: config.compliance?.sox?.financialControls !== false,
                    changeManagement: config.compliance?.sox?.changeManagement !== false
                },
                pci: {
                    enabled: config.compliance?.pci?.enabled || false,
                    cardDataProtection: config.compliance?.pci?.cardDataProtection !== false
                },
                hipaa: {
                    enabled: config.compliance?.hipaa?.enabled || false,
                    phi_protection: config.compliance?.hipaa?.phi_protection !== false
                }
            },
            
            // Alerting settings
            alerting: {
                enabled: config.alerting?.enabled !== false,
                thresholds: {
                    errorRate: config.alerting?.thresholds?.errorRate || 0.05, // 5%
                    failedLogins: config.alerting?.thresholds?.failedLogins || 10,
                    privilegedAccess: config.alerting?.thresholds?.privilegedAccess || 5,
                    dataExfiltration: config.alerting?.thresholds?.dataExfiltration || 1000000 // 1MB
                },
                channels: {
                    email: config.alerting?.channels?.email || [],
                    slack: config.alerting?.channels?.slack || null,
                    webhook: config.alerting?.channels?.webhook || null
                }
            },
            
            ...config
        };

        this.state = {
            initialized: false,
            eventBuffer: [],
            lastFlush: Date.now(),
            encryptionKey: null,
            integrityChain: null,
            metrics: {
                eventsLogged: 0,
                eventsBuffered: 0,
                eventsFailed: 0,
                alertsTriggered: 0,
                encryptionOps: 0
            },
            outputs: new Map(),
            alertThresholds: new Map()
        };

        this.encryptionManager = null;
        this.integrityManager = null;
    }

    /**
     * Initialize audit logging system
     */
    async initialize() {
        try {
            await this._initializeOutputs();
            await this._initializeSecurity();
            await this._initializeIntegrity();
            await this._initializeAlerting();
            await this._startPeriodicFlush();
            
            this.state.initialized = true;
            
            // Log initialization
            await this.logEvent('AUDIT_SYSTEM_INITIALIZED', {
                timestamp: new Date().toISOString(),
                outputs: Object.keys(this.config.outputs).filter(o => this.config.outputs[o].enabled),
                security: {
                    encryption: this.config.security.encryption.enabled,
                    integrity: this.config.security.integrity.enabled
                }
            }, 'system', 'info');
            
            console.log('Audit Logging System initialized');
            
        } catch (error) {
            console.error('Failed to initialize Audit Logger:', error);
            throw error;
        }
    }

    /**
     * Log an audit event
     * @param {string} action Action performed
     * @param {Object} details Event details
     * @param {string} category Event category
     * @param {string} level Log level
     * @param {Object} context Additional context
     * @returns {Promise<string>} Event ID
     */
    async logEvent(action, details, category = 'general', level = 'info', context = {}) {
        try {
            if (!this.state.initialized) {
                throw new Error('Audit logger not initialized');
            }

            // Check if category is enabled
            if (!this._isCategoryEnabled(category)) {
                return null;
            }

            // Apply sampling if configured
            if (this._shouldSample(category)) {
                return null;
            }

            // Create event object
            const event = await this._createAuditEvent(action, details, category, level, context);
            
            // Apply encryption if required
            if (this._shouldEncryptEvent(category)) {
                event.encrypted = await this._encryptEventData(event);
                event.details = '[ENCRYPTED]';
            }

            // Add integrity protection
            if (this.config.security.integrity.enabled) {
                event.integrity = await this._addIntegrityProtection(event);
            }

            // Apply compliance transformations
            await this._applyComplianceTransformations(event);

            // Buffer or process immediately
            if (this.config.performance.async) {
                this.state.eventBuffer.push(event);
                this.state.metrics.eventsBuffered++;
                
                // Flush if buffer is full
                if (this.state.eventBuffer.length >= this.config.performance.bufferSize) {
                    await this._flushBuffer();
                }
            } else {
                await this._processEvent(event);
            }

            this.state.metrics.eventsLogged++;
            
            // Check alerting thresholds
            await this._checkAlertingThresholds(event);

            return event.id;

        } catch (error) {
            this.state.metrics.eventsFailed++;
            console.error('Failed to log audit event:', error);
            
            // Try to log the error itself
            try {
                await this._logInternalError('EVENT_LOGGING_FAILED', error, action);
            } catch (innerError) {
                console.error('Failed to log internal error:', innerError);
            }
            
            throw error;
        }
    }

    /**
     * Log security event
     */
    async logSecurityEvent(action, details, level = 'warning', context = {}) {
        return await this.logEvent(action, details, 'security', level, {
            ...context,
            securityEvent: true,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log financial transaction
     */
    async logFinancialEvent(action, details, context = {}) {
        return await this.logEvent(action, details, 'financial', 'info', {
            ...context,
            financialEvent: true,
            regulatory: true
        });
    }

    /**
     * Log access event
     */
    async logAccessEvent(action, details, level = 'info', context = {}) {
        return await this.logEvent(action, details, 'access', level, {
            ...context,
            accessEvent: true,
            userAgent: context.userAgent || 'unknown'
        });
    }

    /**
     * Log administrative action
     */
    async logAdminEvent(action, details, level = 'info', context = {}) {
        return await this.logEvent(action, details, 'admin', level, {
            ...context,
            adminEvent: true,
            privileged: true
        });
    }

    /**
     * Query audit logs
     * @param {Object} criteria Search criteria
     * @param {Object} options Query options
     * @returns {Array} Matching audit events
     */
    async queryLogs(criteria, options = {}) {
        try {
            // This would typically query from database/elasticsearch
            // For now, implement basic file-based search
            
            const {
                startDate,
                endDate,
                category,
                action,
                userId,
                level,
                limit = 100,
                offset = 0
            } = criteria;

            const {
                decrypt = false,
                includeIntegrity = false
            } = options;

            // Implement query logic based on enabled outputs
            if (this.config.outputs.elasticsearch.enabled) {
                return await this._queryElasticsearch(criteria, options);
            } else if (this.config.outputs.database.enabled) {
                return await this._queryDatabase(criteria, options);
            } else {
                return await this._queryFiles(criteria, options);
            }

        } catch (error) {
            console.error('Failed to query audit logs:', error);
            throw error;
        }
    }

    /**
     * Generate compliance report
     * @param {Object} reportConfig Report configuration
     * @returns {Object} Compliance report
     */
    async generateComplianceReport(reportConfig) {
        try {
            const {
                startDate,
                endDate,
                complianceFramework, // gdpr, sox, pci, hipaa
                includeMetrics = true,
                includeDetails = false
            } = reportConfig;

            const report = {
                framework: complianceFramework,
                period: { startDate, endDate },
                generatedAt: new Date().toISOString(),
                metrics: {},
                events: [],
                violations: [],
                recommendations: []
            };

            // Query relevant events
            const events = await this.queryLogs({
                startDate,
                endDate,
                category: this._getComplianceCategories(complianceFramework)
            });

            // Generate framework-specific report
            switch (complianceFramework) {
                case 'gdpr':
                    return await this._generateGDPRReport(report, events);
                case 'sox':
                    return await this._generateSOXReport(report, events);
                case 'pci':
                    return await this._generatePCIReport(report, events);
                case 'hipaa':
                    return await this._generateHIPAAReport(report, events);
                default:
                    throw new Error(`Unsupported compliance framework: ${complianceFramework}`);
            }

        } catch (error) {
            console.error('Failed to generate compliance report:', error);
            throw error;
        }
    }

    // ========== PRIVATE METHODS ==========

    async _createAuditEvent(action, details, category, level, context) {
        const eventId = crypto.randomBytes(16).toString('hex');
        
        return {
            id: eventId,
            timestamp: new Date().toISOString(),
            action,
            category,
            level,
            details: this._sanitizeDetails(details, category),
            context: this._sanitizeContext(context, category),
            source: {
                service: 'swappiq-protocol',
                version: process.env.SERVICE_VERSION || '1.0.0',
                instance: process.env.INSTANCE_ID || 'unknown',
                ip: context.sourceIP || 'unknown'
            },
            user: {
                id: context.userId || 'anonymous',
                role: context.userRole || 'unknown',
                session: context.sessionId || null
            },
            request: {
                id: context.requestId || null,
                method: context.method || null,
                path: context.path || null,
                userAgent: context.userAgent || null
            },
            compliance: {
                retention: this.config.categories[category]?.retention || 2555200000,
                classification: this._classifyEvent(action, category, details)
            }
        };
    }

    async _initializeOutputs() {
        // Initialize file output
        if (this.config.outputs.file.enabled) {
            await this._initializeFileOutput();
        }

        // Initialize database output
        if (this.config.outputs.database.enabled) {
            await this._initializeDatabaseOutput();
        }

        // Initialize Elasticsearch output
        if (this.config.outputs.elasticsearch.enabled) {
            await this._initializeElasticsearchOutput();
        }

        // Initialize Syslog output
        if (this.config.outputs.syslog.enabled) {
            await this._initializeSyslogOutput();
        }

        // Initialize Webhook output
        if (this.config.outputs.webhook.enabled) {
            await this._initializeWebhookOutput();
        }
    }

    async _initializeFileOutput() {
        const logDir = path.dirname(this.config.outputs.file.path);
        
        try {
            await fs.mkdir(logDir, { recursive: true });
            
            // Test write access
            await fs.access(logDir, fs.constants.W_OK);
            
            this.state.outputs.set('file', {
                type: 'file',
                enabled: true,
                path: this.config.outputs.file.path
            });
            
        } catch (error) {
            console.warn('File output initialization failed:', error.message);
            this.config.outputs.file.enabled = false;
        }
    }

    async _initializeDatabaseOutput() {
        try {
            // This would initialize database connection
            // For now, just mark as available
            this.state.outputs.set('database', {
                type: 'database',
                enabled: true,
                table: this.config.outputs.database.table
            });
            
        } catch (error) {
            console.warn('Database output initialization failed:', error.message);
            this.config.outputs.database.enabled = false;
        }
    }

    async _initializeElasticsearchOutput() {
        try {
            // This would initialize Elasticsearch client
            this.state.outputs.set('elasticsearch', {
                type: 'elasticsearch',
                enabled: true,
                index: this.config.outputs.elasticsearch.index
            });
            
        } catch (error) {
            console.warn('Elasticsearch output initialization failed:', error.message);
            this.config.outputs.elasticsearch.enabled = false;
        }
    }

    async _initializeSyslogOutput() {
        try {
            this.state.outputs.set('syslog', {
                type: 'syslog',
                enabled: true,
                host: this.config.outputs.syslog.host
            });
            
        } catch (error) {
            console.warn('Syslog output initialization failed:', error.message);
            this.config.outputs.syslog.enabled = false;
        }
    }

    async _initializeWebhookOutput() {
        try {
            this.state.outputs.set('webhook', {
                type: 'webhook',
                enabled: true,
                url: this.config.outputs.webhook.url
            });
            
        } catch (error) {
            console.warn('Webhook output initialization failed:', error.message);
            this.config.outputs.webhook.enabled = false;
        }
    }

    async _initializeSecurity() {
        if (this.config.security.encryption.enabled) {
            // Generate encryption key
            this.state.encryptionKey = crypto.randomBytes(32);
            
            // Initialize encryption manager
            this.encryptionManager = new EventEncryptionManager({
                algorithm: this.config.security.encryption.algorithm,
                key: this.state.encryptionKey
            });
        }
    }

    async _initializeIntegrity() {
        if (this.config.security.integrity.enabled) {
            this.integrityManager = new IntegrityManager({
                algorithm: this.config.security.integrity.algorithm,
                chainValidation: this.config.security.integrity.chainValidation
            });
        }
    }

    async _initializeAlerting() {
        if (!this.config.alerting.enabled) return;

        // Initialize alert thresholds tracking
        for (const [metric, threshold] of Object.entries(this.config.alerting.thresholds)) {
            this.state.alertThresholds.set(metric, {
                threshold,
                current: 0,
                lastReset: Date.now(),
                triggered: false
            });
        }
    }

    async _startPeriodicFlush() {
        if (!this.config.performance.async) return;

        setInterval(async () => {
            try {
                if (this.state.eventBuffer.length > 0) {
                    await this._flushBuffer();
                }
            } catch (error) {
                console.error('Periodic flush failed:', error);
            }
        }, this.config.performance.flushInterval);
    }

    async _flushBuffer() {
        if (this.state.eventBuffer.length === 0) return;

        const eventsToProcess = [...this.state.eventBuffer];
        this.state.eventBuffer = [];

        for (const event of eventsToProcess) {
            try {
                await this._processEvent(event);
            } catch (error) {
                console.error('Failed to process buffered event:', error);
                this.state.metrics.eventsFailed++;
            }
        }

        this.state.lastFlush = Date.now();
    }

    async _processEvent(event) {
        const promises = [];

        // Send to all enabled outputs
        for (const [outputType, output] of this.state.outputs.entries()) {
            if (output.enabled) {
                promises.push(this._sendToOutput(outputType, event));
            }
        }

        await Promise.allSettled(promises);
    }

    async _sendToOutput(outputType, event) {
        try {
            switch (outputType) {
                case 'file':
                    return await this._writeToFile(event);
                case 'database':
                    return await this._writeToDatabase(event);
                case 'elasticsearch':
                    return await this._writeToElasticsearch(event);
                case 'syslog':
                    return await this._writeToSyslog(event);
                case 'webhook':
                    return await this._sendToWebhook(event);
                default:
                    throw new Error(`Unknown output type: ${outputType}`);
            }
        } catch (error) {
            console.error(`Failed to send to ${outputType}:`, error);
            throw error;
        }
    }

    async _writeToFile(event) {
        const logLine = JSON.stringify(event) + '\n';
        await fs.appendFile(this.config.outputs.file.path, logLine);
    }

    async _writeToDatabase(event) {
        // Implementation would insert into database
        console.log('Writing to database:', event.id);
    }

    async _writeToElasticsearch(event) {
        // Implementation would send to Elasticsearch
        console.log('Writing to Elasticsearch:', event.id);
    }

    async _writeToSyslog(event) {
        // Implementation would send to syslog
        console.log('Writing to Syslog:', event.id);
    }

    async _sendToWebhook(event) {
        // Implementation would send HTTP POST to webhook
        console.log('Sending to Webhook:', event.id);
    }

    _isCategoryEnabled(category) {
        return this.config.categories[category]?.enabled !== false;
    }

    _shouldSample(category) {
        if (!this.config.performance.sampling.enabled) return false;
        if (!this.config.performance.sampling.categories.includes(category)) return false;
        
        return Math.random() > this.config.performance.sampling.rate;
    }

    _shouldEncryptEvent(category) {
        return this.config.categories[category]?.encryption !== false &&
               this.config.security.encryption.enabled;
    }

    async _encryptEventData(event) {
        if (!this.encryptionManager) return null;
        
        this.state.metrics.encryptionOps++;
        return await this.encryptionManager.encrypt(event.details);
    }

    async _addIntegrityProtection(event) {
        if (!this.integrityManager) return null;
        
        return await this.integrityManager.addProtection(event);
    }

    async _applyComplianceTransformations(event) {
        // Apply GDPR anonymization
        if (this.config.compliance.gdpr.enabled && 
            this.config.compliance.gdpr.anonymization) {
            await this._applyGDPRAnonymization(event);
        }

        // Apply other compliance transformations as needed
    }

    async _applyGDPRAnonymization(event) {
        // Anonymize PII fields
        const piiFields = ['email', 'phone', 'address', 'name'];
        
        for (const field of piiFields) {
            if (event.details[field]) {
                event.details[field] = this._anonymizeField(event.details[field]);
            }
        }
    }

    _anonymizeField(value) {
        // Simple anonymization - hash the value
        return crypto.createHash('sha256').update(value).digest('hex').substring(0, 8);
    }

    _sanitizeDetails(details, category) {
        // Remove sensitive fields based on category
        const sensitiveFields = ['password', 'privateKey', 'secret', 'token'];
        const sanitized = { ...details };
        
        for (const field of sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        }
        
        return sanitized;
    }

    _sanitizeContext(context, category) {
        // Sanitize context information
        return {
            ...context,
            // Remove potential sensitive data
            password: context.password ? '[REDACTED]' : undefined
        };
    }

    _classifyEvent(action, category, details) {
        // Classify event for compliance purposes
        const classifications = [];
        
        if (category === 'financial') classifications.push('FINANCIAL_RECORD');
        if (category === 'security') classifications.push('SECURITY_EVENT');
        if (action.includes('LOGIN')) classifications.push('ACCESS_CONTROL');
        if (action.includes('TRANSFER')) classifications.push('FINANCIAL_TRANSACTION');
        
        return classifications;
    }

    async _checkAlertingThresholds(event) {
        if (!this.config.alerting.enabled) return;

        // Check various thresholds
        await this._checkErrorRateThreshold(event);
        await this._checkFailedLoginThreshold(event);
        await this._checkPrivilegedAccessThreshold(event);
    }

    async _checkErrorRateThreshold(event) {
        if (event.level === 'error') {
            const threshold = this.state.alertThresholds.get('errorRate');
            if (threshold) {
                threshold.current++;
                
                if (threshold.current > threshold.threshold && !threshold.triggered) {
                    threshold.triggered = true;
                    await this._triggerAlert('ERROR_RATE_EXCEEDED', {
                        current: threshold.current,
                        threshold: threshold.threshold
                    });
                }
            }
        }
    }

    async _checkFailedLoginThreshold(event) {
        if (event.action === 'LOGIN_FAILED') {
            const threshold = this.state.alertThresholds.get('failedLogins');
            if (threshold) {
                threshold.current++;
                
                if (threshold.current > threshold.threshold && !threshold.triggered) {
                    threshold.triggered = true;
                    await this._triggerAlert('FAILED_LOGIN_THRESHOLD_EXCEEDED', {
                        current: threshold.current,
                        threshold: threshold.threshold,
                        userId: event.user.id
                    });
                }
            }
        }
    }

    async _checkPrivilegedAccessThreshold(event) {
        if (event.context.privileged) {
            const threshold = this.state.alertThresholds.get('privilegedAccess');
            if (threshold) {
                threshold.current++;
                
                if (threshold.current > threshold.threshold && !threshold.triggered) {
                    threshold.triggered = true;
                    await this._triggerAlert('PRIVILEGED_ACCESS_THRESHOLD_EXCEEDED', {
                        current: threshold.current,
                        threshold: threshold.threshold
                    });
                }
            }
        }
    }

    async _triggerAlert(alertType, details) {
        this.state.metrics.alertsTriggered++;
        
        // Send alert through configured channels
        const alert = {
            type: alertType,
            timestamp: new Date().toISOString(),
            details,
            severity: this._getAlertSeverity(alertType)
        };

        // Email alerts
        if (this.config.alerting.channels.email.length > 0) {
            await this._sendEmailAlert(alert);
        }

        // Slack alerts
        if (this.config.alerting.channels.slack) {
            await this._sendSlackAlert(alert);
        }

        // Webhook alerts
        if (this.config.alerting.channels.webhook) {
            await this._sendWebhookAlert(alert);
        }

        this.emit('alert', alert);
    }

    _getAlertSeverity(alertType) {
        const severityMap = {
            'ERROR_RATE_EXCEEDED': 'high',
            'FAILED_LOGIN_THRESHOLD_EXCEEDED': 'medium',
            'PRIVILEGED_ACCESS_THRESHOLD_EXCEEDED': 'high'
        };
        
        return severityMap[alertType] || 'medium';
    }

    async _sendEmailAlert(alert) {
        // Implementation would send email
        console.log('Email alert:', alert.type);
    }

    async _sendSlackAlert(alert) {
        // Implementation would send to Slack
        console.log('Slack alert:', alert.type);
    }

    async _sendWebhookAlert(alert) {
        // Implementation would send to webhook
        console.log('Webhook alert:', alert.type);
    }

    async _logInternalError(action, error, originalAction) {
        try {
            const errorEvent = {
                id: crypto.randomBytes(16).toString('hex'),
                timestamp: new Date().toISOString(),
                action,
                category: 'error',
                level: 'error',
                details: {
                    error: error.message,
                    stack: error.stack,
                    originalAction
                },
                internal: true
            };

            // Try to write directly to file to avoid recursion
            if (this.config.outputs.file.enabled) {
                await this._writeToFile(errorEvent);
            }
        } catch (innerError) {
            console.error('Failed to log internal error:', innerError);
        }
    }

    /**
     * Get audit logging metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            bufferSize: this.state.eventBuffer.length,
            lastFlush: this.state.lastFlush,
            outputs: Array.from(this.state.outputs.keys()),
            alertThresholds: Object.fromEntries(this.state.alertThresholds)
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            // Flush any remaining buffered events
            if (this.state.eventBuffer.length > 0) {
                await this._flushBuffer();
            }

            // Close output connections
            for (const [outputType, output] of this.state.outputs.entries()) {
                if (output.cleanup) {
                    await output.cleanup();
                }
            }

            console.log('Audit Logging System cleaned up');
        } catch (error) {
            console.error('Error during audit logger cleanup:', error);
        }
    }
}

// ========== SUPPORTING CLASSES ==========

class EventEncryptionManager {
    constructor(config) {
        this.algorithm = config.algorithm;
        this.key = config.key;
    }

    async encrypt(data) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipher(this.algorithm, this.key);
        
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
        encrypted += cipher.final('base64');
        
        const authTag = cipher.getAuthTag();
        
        return {
            algorithm: this.algorithm,
            iv: iv.toString('base64'),
            authTag: authTag.toString('base64'),
            data: encrypted
        };
    }

    async decrypt(encryptedData) {
        const decipher = crypto.createDecipher(this.algorithm, this.key);
        decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'base64'));
        
        let decrypted = decipher.update(encryptedData.data, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        
        return JSON.parse(decrypted);
    }
}

class IntegrityManager {
    constructor(config) {
        this.algorithm = config.algorithm;
        this.chainValidation = config.chainValidation;
        this.lastHash = null;
    }

    async addProtection(event) {
        const eventData = JSON.stringify(event);
        const hash = crypto.createHash(this.algorithm).update(eventData).digest('hex');
        
        const integrity = {
            algorithm: this.algorithm,
            hash,
            timestamp: new Date().toISOString()
        };

        if (this.chainValidation && this.lastHash) {
            const chainHash = crypto.createHash(this.algorithm)
                .update(this.lastHash + hash)
                .digest('hex');
            integrity.chainHash = chainHash;
        }

        this.lastHash = hash;
        return integrity;
    }

    async verifyIntegrity(event) {
        const eventDataCopy = { ...event };
        delete eventDataCopy.integrity;
        
        const eventData = JSON.stringify(eventDataCopy);
        const computedHash = crypto.createHash(this.algorithm).update(eventData).digest('hex');
        
        return computedHash === event.integrity.hash;
    }
}

module.exports = { 
    AuditLogger, 
    EventEncryptionManager, 
    IntegrityManager 
};