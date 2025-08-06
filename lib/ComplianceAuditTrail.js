/**
 * Compliance Audit Trail System
 * Comprehensive audit logging for regulatory compliance and security monitoring
 * Supports multiple compliance frameworks: SOX, GDPR, PCI-DSS, AML/KYC
 */

const { Pool } = require('pg');
const { EventEmitter } = require('events');
const Redis = require('ioredis');
const crypto = require('crypto');
const zlib = require('zlib');

class ComplianceAuditTrail extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            // Database configuration
            pgPool: config.pgPool || new Pool({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 5432,
                database: process.env.DB_NAME || 'settlement_queue',
                user: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASSWORD,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            }),
            
            // Redis for real-time alerting
            redis: config.redis || new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD,
            }),
            
            // Compliance settings
            complianceFrameworks: config.complianceFrameworks || ['SOX', 'GDPR', 'AML'],
            retentionPolicies: config.retentionPolicies || {
                'low': '1 year',
                'standard': '7 years',
                'high': '10 years',
                'critical': 'permanent'
            },
            
            // Security settings
            encryptionEnabled: config.encryptionEnabled !== false,
            signatureEnabled: config.signatureEnabled !== false,
            checksumEnabled: config.checksumEnabled !== false,
            encryptionKey: config.encryptionKey || process.env.AUDIT_ENCRYPTION_KEY,
            signingKey: config.signingKey || process.env.AUDIT_SIGNING_KEY,
            
            // Performance settings
            batchSize: config.batchSize || 100,
            compressionEnabled: config.compressionEnabled !== false,
            asyncLogging: config.asyncLogging !== false,
            bufferSize: config.bufferSize || 1000,
            
            // Alerting configuration
            alertingEnabled: config.alertingEnabled !== false,
            suspiciousActivityThresholds: config.suspiciousActivityThresholds || {
                failedLogins: 5,
                massiveDataAccess: 1000,
                offHoursActivity: true,
                privilegedAccess: true,
                dataExport: true
            },
            
            // Classification settings
            dataClassification: config.dataClassification || {
                'user_data': 'sensitive',
                'financial_data': 'critical',
                'system_config': 'high',
                'audit_logs': 'critical',
                'public_data': 'low'
            }
        };
        
        // Audit buffer for async processing
        this.auditBuffer = [];
        this.processingBuffer = false;
        
        // Event classification rules
        this.eventClassificationRules = new Map();
        this.complianceRules = new Map();
        
        // Metrics tracking
        this.metrics = {
            totalAuditEvents: 0,
            criticalEvents: 0,
            suspiciousActivities: 0,
            complianceViolations: 0,
            failedAudits: 0,
            avgProcessingTime: 0
        };
        
        // Active sessions tracking for anomaly detection
        this.activeSessions = new Map();
        this.userActivityPatterns = new Map();
        
        this.initialize();
    }
    
    async initialize() {
        try {
            // Initialize compliance framework rules
            this.initializeComplianceRules();
            
            // Initialize event classification
            this.initializeEventClassification();
            
            // Start background processors
            this.startBackgroundProcessors();
            
            // Test database connection
            await this.config.pgPool.query('SELECT 1');
            
            this.emit('ready');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    
    // =============================================================================
    // CORE AUDIT LOGGING FUNCTIONS
    // =============================================================================
    
    /**
     * Log audit event with full compliance context
     */
    async logAuditEvent(eventData) {
        const startTime = Date.now();
        
        try {
            // Validate and enrich event data
            const enrichedEvent = await this.enrichAuditEvent(eventData);
            
            // Classify event for compliance frameworks
            const classification = this.classifyEvent(enrichedEvent);
            
            // Check for suspicious activity patterns
            const suspiciousActivity = await this.detectSuspiciousActivity(enrichedEvent);
            
            // Create audit record
            const auditRecord = {
                event_id: enrichedEvent.eventId || this.generateEventId(),
                event_type: enrichedEvent.eventType,
                entity_type: enrichedEvent.entityType,
                entity_id: enrichedEvent.entityId,
                actor_type: enrichedEvent.actorType,
                actor_address: enrichedEvent.actorAddress,
                actor_id: enrichedEvent.actorId,
                ip_address: enrichedEvent.ipAddress,
                user_agent: enrichedEvent.userAgent,
                old_values: enrichedEvent.oldValues,
                new_values: enrichedEvent.newValues,
                changes: enrichedEvent.changes,
                action: enrichedEvent.action,
                resource: enrichedEvent.resource,
                method: enrichedEvent.method,
                endpoint: enrichedEvent.endpoint,
                session_id: enrichedEvent.sessionId,
                request_id: enrichedEvent.requestId,
                compliance_level: classification.level,
                retention_period: this.getRetentionPeriod(classification.level),
                is_sensitive: classification.isSensitive,
                metadata: {
                    ...enrichedEvent.metadata,
                    classification: classification,
                    suspiciousActivity: suspiciousActivity,
                    complianceFrameworks: this.getApplicableFrameworks(enrichedEvent),
                    dataClassification: this.classifyDataSensitivity(enrichedEvent),
                    processingTime: Date.now() - startTime
                },
                tags: this.generateTags(enrichedEvent, classification),
                checksum: null,
                signature: null
            };
            
            // Apply security measures
            if (this.config.checksumEnabled) {
                auditRecord.checksum = this.calculateChecksum(auditRecord);
            }
            
            if (this.config.signatureEnabled) {
                auditRecord.signature = await this.signAuditRecord(auditRecord);
            }
            
            // Process based on configuration
            if (this.config.asyncLogging && !suspiciousActivity.isHighRisk) {
                await this.bufferAuditEvent(auditRecord);
            } else {
                await this.writeAuditEventImmediate(auditRecord);
            }
            
            // Handle suspicious activity
            if (suspiciousActivity.isSuspicious) {
                await this.handleSuspiciousActivity(auditRecord, suspiciousActivity);
            }
            
            // Check compliance violations
            const violations = this.checkComplianceViolations(auditRecord);
            if (violations.length > 0) {
                await this.handleComplianceViolations(auditRecord, violations);
            }
            
            // Update metrics
            this.updateMetrics(auditRecord, startTime);
            
            // Emit event for real-time processing
            this.emit('auditLogged', auditRecord);
            
            return auditRecord;
            
        } catch (error) {
            this.metrics.failedAudits++;
            this.emit('auditError', { eventData, error });
            
            // Critical: ensure audit failures are logged to a separate system
            await this.logAuditFailure(eventData, error);
            
            throw error;
        }
    }
    
    /**
     * Batch audit logging for high-performance scenarios
     */
    async batchLogAuditEvents(events) {
        if (events.length === 0) return [];
        
        const results = [];
        const batches = this.chunkArray(events, this.config.batchSize);
        
        for (const batch of batches) {
            const batchResults = await this.processBatch(batch);
            results.push(...batchResults);
        }
        
        return results;
    }
    
    /**
     * Log user activity for pattern analysis
     */
    async logUserActivity(userId, activityData) {
        // Track user activity patterns for anomaly detection
        const userPattern = this.userActivityPatterns.get(userId) || {
            totalActions: 0,
            lastActivity: null,
            typicalHours: new Set(),
            typicalIPs: new Set(),
            typicalDevices: new Set(),
            riskScore: 0
        };
        
        // Update pattern
        userPattern.totalActions++;
        userPattern.lastActivity = new Date();
        userPattern.typicalHours.add(new Date().getHours());
        
        if (activityData.ipAddress) {
            userPattern.typicalIPs.add(activityData.ipAddress);
        }
        
        if (activityData.userAgent) {
            const deviceFingerprint = this.extractDeviceFingerprint(activityData.userAgent);
            userPattern.typicalDevices.add(deviceFingerprint);
        }
        
        // Calculate risk score
        userPattern.riskScore = this.calculateUserRiskScore(userPattern, activityData);
        
        this.userActivityPatterns.set(userId, userPattern);
        
        // Log the activity
        return await this.logAuditEvent({
            eventType: 'user_activity',
            entityType: 'user',
            entityId: userId,
            actorType: 'user',
            actorId: userId,
            action: activityData.action,
            resource: activityData.resource,
            metadata: {
                activityData,
                userPattern,
                riskScore: userPattern.riskScore
            }
        });
    }
    
    // =============================================================================
    // SUSPICIOUS ACTIVITY DETECTION
    // =============================================================================
    
    async detectSuspiciousActivity(eventData) {
        const suspiciousPatterns = [];
        let riskScore = 0;
        
        // Check for failed authentication attempts
        if (eventData.eventType === 'authentication_failed') {
            const recentFailures = await this.getRecentFailedAttempts(eventData.actorId);
            if (recentFailures >= this.config.suspiciousActivityThresholds.failedLogins) {
                suspiciousPatterns.push('excessive_failed_logins');
                riskScore += 0.8;
            }
        }
        
        // Check for off-hours activity
        if (this.config.suspiciousActivityThresholds.offHoursActivity) {
            const hour = new Date().getHours();
            if (hour < 6 || hour > 22) { // Outside business hours
                const userPattern = this.userActivityPatterns.get(eventData.actorId);
                if (userPattern && !userPattern.typicalHours.has(hour)) {
                    suspiciousPatterns.push('off_hours_activity');
                    riskScore += 0.4;
                }
            }
        }
        
        // Check for massive data access
        if (eventData.eventType === 'data_access' && eventData.metadata?.recordCount) {
            if (eventData.metadata.recordCount > this.config.suspiciousActivityThresholds.massiveDataAccess) {
                suspiciousPatterns.push('massive_data_access');
                riskScore += 0.9;
            }
        }
        
        // Check for privileged operations
        if (this.config.suspiciousActivityThresholds.privilegedAccess) {
            const privilegedActions = ['admin_access', 'config_change', 'user_creation', 'permission_grant'];
            if (privilegedActions.includes(eventData.eventType)) {
                suspiciousPatterns.push('privileged_operation');
                riskScore += 0.6;
            }
        }
        
        // Check for unusual IP addresses
        if (eventData.ipAddress) {
            const userPattern = this.userActivityPatterns.get(eventData.actorId);
            if (userPattern && userPattern.typicalIPs.size > 0 && !userPattern.typicalIPs.has(eventData.ipAddress)) {
                // Check if it's a completely new IP or just unusual
                const isNewIP = await this.isNewIPAddress(eventData.actorId, eventData.ipAddress);
                if (isNewIP) {
                    suspiciousPatterns.push('unusual_ip_address');
                    riskScore += 0.5;
                }
            }
        }
        
        // Check for data export activities
        if (this.config.suspiciousActivityThresholds.dataExport) {
            const exportActions = ['data_export', 'backup_download', 'report_generation'];
            if (exportActions.includes(eventData.action)) {
                suspiciousPatterns.push('data_export_activity');
                riskScore += 0.7;
            }
        }
        
        // Velocity checks - rapid successive actions
        const recentActions = await this.getRecentUserActions(eventData.actorId, 300); // Last 5 minutes
        if (recentActions.length > 50) { // More than 50 actions in 5 minutes
            suspiciousPatterns.push('high_velocity_activity');
            riskScore += 0.6;
        }
        
        return {
            isSuspicious: suspiciousPatterns.length > 0,
            isHighRisk: riskScore > 0.7,
            riskScore: Math.min(riskScore, 1.0),
            patterns: suspiciousPatterns,
            timestamp: new Date()
        };
    }
    
    async handleSuspiciousActivity(auditRecord, suspiciousActivity) {
        this.metrics.suspiciousActivities++;
        
        // Create alert record
        const alertData = {
            alertId: this.generateAlertId(),
            severity: suspiciousActivity.isHighRisk ? 'critical' : 'warning',
            auditEventId: auditRecord.event_id,
            actorId: auditRecord.actor_id,
            suspiciousPatterns: suspiciousActivity.patterns,
            riskScore: suspiciousActivity.riskScore,
            detectedAt: new Date(),
            status: 'open',
            metadata: {
                auditRecord: auditRecord,
                suspiciousActivity: suspiciousActivity
            }
        };
        
        // Store alert
        await this.storeSecurityAlert(alertData);
        
        // Publish real-time alert
        if (this.config.redis && this.config.alertingEnabled) {
            await this.config.redis.publish('security_alerts', JSON.stringify(alertData));
        }
        
        // Emit event for external systems
        this.emit('suspiciousActivity', alertData);
        
        // Auto-trigger security measures for high-risk activities
        if (suspiciousActivity.isHighRisk) {
            await this.triggerSecurityMeasures(auditRecord, suspiciousActivity);
        }
    }
    
    async triggerSecurityMeasures(auditRecord, suspiciousActivity) {
        const measures = [];
        
        // Account lockout for excessive failed logins
        if (suspiciousActivity.patterns.includes('excessive_failed_logins')) {
            measures.push({
                type: 'account_lockout',
                target: auditRecord.actor_id,
                duration: '15 minutes',
                reason: 'Excessive failed login attempts'
            });
        }
        
        // Rate limiting for high velocity activity
        if (suspiciousActivity.patterns.includes('high_velocity_activity')) {
            measures.push({
                type: 'rate_limit',
                target: auditRecord.actor_id,
                duration: '5 minutes',
                reason: 'Unusual activity velocity'
            });
        }
        
        // IP blocking for unusual access patterns
        if (suspiciousActivity.patterns.includes('unusual_ip_address') && suspiciousActivity.riskScore > 0.8) {
            measures.push({
                type: 'ip_block',
                target: auditRecord.ip_address,
                duration: '1 hour',
                reason: 'Suspicious IP address activity'
            });
        }
        
        // Execute security measures
        for (const measure of measures) {
            await this.executeSecurityMeasure(measure);
            
            // Log the security measure
            await this.logAuditEvent({
                eventType: 'security_measure_triggered',
                entityType: 'security_measure',
                entityId: measure.type,
                actorType: 'system',
                action: 'trigger',
                resource: 'security_system',
                metadata: {
                    measure: measure,
                    triggeringEvent: auditRecord.event_id,
                    suspiciousActivity: suspiciousActivity
                },
                compliance_level: 'critical'
            });
        }
        
        return measures;
    }
    
    // =============================================================================
    // COMPLIANCE FRAMEWORK IMPLEMENTATION
    // =============================================================================
    
    initializeComplianceRules() {
        // SOX (Sarbanes-Oxley) compliance rules
        this.complianceRules.set('SOX', {
            applicableEvents: [
                'financial_transaction',
                'accounting_change',
                'system_configuration',
                'user_privilege_change',
                'data_modification'
            ],
            requiredFields: ['actor_id', 'timestamp', 'action', 'old_values', 'new_values'],
            retentionPeriod: '7 years',
            encryptionRequired: true,
            signatureRequired: true,
            realTimeMonitoring: true
        });
        
        // GDPR compliance rules
        this.complianceRules.set('GDPR', {
            applicableEvents: [
                'personal_data_access',
                'personal_data_modification',
                'personal_data_deletion',
                'consent_given',
                'consent_withdrawn',
                'data_export_request'
            ],
            requiredFields: ['actor_id', 'timestamp', 'action', 'legal_basis', 'data_subject_id'],
            retentionPeriod: '3 years', // After data deletion
            encryptionRequired: true,
            dataMinimization: true,
            rightToErasure: true
        });
        
        // AML (Anti-Money Laundering) compliance rules
        this.complianceRules.set('AML', {
            applicableEvents: [
                'large_transaction',
                'suspicious_pattern',
                'kyc_verification',
                'transaction_monitoring',
                'report_filing'
            ],
            requiredFields: ['transaction_amount', 'actor_id', 'timestamp', 'risk_assessment'],
            retentionPeriod: '5 years',
            encryptionRequired: true,
            realTimeMonitoring: true,
            thresholdMonitoring: true
        });
        
        // PCI-DSS compliance rules
        this.complianceRules.set('PCI_DSS', {
            applicableEvents: [
                'payment_processing',
                'card_data_access',
                'security_configuration',
                'access_control_change'
            ],
            requiredFields: ['actor_id', 'timestamp', 'action', 'card_data_involved'],
            retentionPeriod: '1 year',
            encryptionRequired: true,
            accessControlRequired: true,
            secureLogging: true
        });
    }
    
    getApplicableFrameworks(eventData) {
        const applicable = [];
        
        for (const [framework, rules] of this.complianceRules) {
            if (rules.applicableEvents.includes(eventData.eventType) ||
                rules.applicableEvents.includes(eventData.action)) {
                applicable.push(framework);
            }
        }
        
        return applicable;
    }
    
    checkComplianceViolations(auditRecord) {
        const violations = [];
        const applicableFrameworks = auditRecord.metadata.complianceFrameworks;
        
        for (const framework of applicableFrameworks) {
            const rules = this.complianceRules.get(framework);
            if (!rules) continue;
            
            // Check required fields
            for (const field of rules.requiredFields) {
                if (!this.hasRequiredField(auditRecord, field)) {
                    violations.push({
                        framework: framework,
                        type: 'missing_required_field',
                        field: field,
                        severity: 'high'
                    });
                }
            }
            
            // Check encryption requirement
            if (rules.encryptionRequired && !this.isEncrypted(auditRecord)) {
                violations.push({
                    framework: framework,
                    type: 'encryption_required',
                    severity: 'critical'
                });
            }
            
            // Check signature requirement
            if (rules.signatureRequired && !auditRecord.signature) {
                violations.push({
                    framework: framework,
                    type: 'signature_required',
                    severity: 'high'
                });
            }
            
            // Framework-specific checks
            if (framework === 'GDPR') {
                violations.push(...this.checkGDPRCompliance(auditRecord));
            } else if (framework === 'AML') {
                violations.push(...this.checkAMLCompliance(auditRecord));
            }
        }
        
        return violations;
    }
    
    checkGDPRCompliance(auditRecord) {
        const violations = [];
        
        // Check for lawful basis when processing personal data
        if (auditRecord.event_type === 'personal_data_access' && 
            !auditRecord.metadata?.legal_basis) {
            violations.push({
                framework: 'GDPR',
                type: 'missing_legal_basis',
                severity: 'critical',
                article: 'Article 6'
            });
        }
        
        // Check data minimization principle
        if (auditRecord.is_sensitive && 
            auditRecord.metadata?.dataProcessed?.length > 10) {
            violations.push({
                framework: 'GDPR',
                type: 'potential_data_minimization_violation',
                severity: 'medium',
                article: 'Article 5(1)(c)'
            });
        }
        
        return violations;
    }
    
    checkAMLCompliance(auditRecord) {
        const violations = [];
        
        // Check for transaction monitoring thresholds
        if (auditRecord.event_type === 'large_transaction') {
            const amount = auditRecord.metadata?.transaction_amount;
            if (amount && amount >= 10000 && !auditRecord.metadata?.aml_report_filed) {
                violations.push({
                    framework: 'AML',
                    type: 'missing_suspicious_activity_report',
                    severity: 'critical',
                    regulation: 'BSA'
                });
            }
        }
        
        return violations;
    }
    
    async handleComplianceViolations(auditRecord, violations) {
        this.metrics.complianceViolations += violations.length;
        
        for (const violation of violations) {
            // Log compliance violation
            const violationRecord = {
                violationId: this.generateViolationId(),
                auditEventId: auditRecord.event_id,
                framework: violation.framework,
                violationType: violation.type,
                severity: violation.severity,
                detectedAt: new Date(),
                status: 'open',
                metadata: {
                    violation: violation,
                    auditRecord: auditRecord
                }
            };
            
            await this.storeComplianceViolation(violationRecord);
            
            // Send alert for critical violations
            if (violation.severity === 'critical') {
                await this.sendComplianceAlert(violationRecord);
            }
            
            this.emit('complianceViolation', violationRecord);
        }
    }
    
    // =============================================================================
    // DATA ENCRYPTION AND SECURITY
    // =============================================================================
    
    async encryptSensitiveData(data) {
        if (!this.config.encryptionEnabled || !this.config.encryptionKey) {
            return data;
        }
        
        try {
            const cipher = crypto.createCipher('aes-256-gcm', this.config.encryptionKey);
            const encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex') + cipher.final('hex');
            const authTag = cipher.getAuthTag();
            
            return {
                encrypted: encrypted,
                authTag: authTag.toString('hex'),
                algorithm: 'aes-256-gcm'
            };
        } catch (error) {
            throw new Error(`Encryption failed: ${error.message}`);
        }
    }
    
    async decryptSensitiveData(encryptedData) {
        if (!encryptedData.encrypted || !this.config.encryptionKey) {
            return encryptedData;
        }
        
        try {
            const decipher = crypto.createDecipher('aes-256-gcm', this.config.encryptionKey);
            decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
            
            const decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8') + decipher.final('utf8');
            return JSON.parse(decrypted);
        } catch (error) {
            throw new Error(`Decryption failed: ${error.message}`);
        }
    }
    
    async signAuditRecord(auditRecord) {
        if (!this.config.signatureEnabled || !this.config.signingKey) {
            return null;
        }
        
        const dataToSign = this.getSignableData(auditRecord);
        const signature = crypto
            .createHmac('sha256', this.config.signingKey)
            .update(dataToSign)
            .digest('hex');
            
        return signature;
    }
    
    async verifyAuditSignature(auditRecord) {
        if (!auditRecord.signature || !this.config.signingKey) {
            return false;
        }
        
        const dataToSign = this.getSignableData(auditRecord);
        const expectedSignature = crypto
            .createHmac('sha256', this.config.signingKey)
            .update(dataToSign)
            .digest('hex');
            
        return crypto.timingSafeEqual(
            Buffer.from(auditRecord.signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    }
    
    getSignableData(auditRecord) {
        // Create deterministic string from audit record
        const signableFields = [
            auditRecord.event_id,
            auditRecord.event_type,
            auditRecord.entity_type,
            auditRecord.entity_id,
            auditRecord.actor_id,
            auditRecord.action,
            auditRecord.timestamp || new Date().toISOString(),
            JSON.stringify(auditRecord.old_values || {}),
            JSON.stringify(auditRecord.new_values || {}),
            auditRecord.checksum
        ];
        
        return signableFields.join('|');
    }
    
    calculateChecksum(auditRecord) {
        const checksumData = {
            event_type: auditRecord.event_type,
            entity_type: auditRecord.entity_type,
            entity_id: auditRecord.entity_id,
            actor_id: auditRecord.actor_id,
            action: auditRecord.action,
            old_values: auditRecord.old_values,
            new_values: auditRecord.new_values,
            metadata: auditRecord.metadata
        };
        
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(checksumData))
            .digest('hex');
    }
    
    // =============================================================================
    // DATABASE OPERATIONS
    // =============================================================================
    
    async writeAuditEventImmediate(auditRecord) {
        const insertQuery = `
            INSERT INTO audit_log (
                event_id, event_type, entity_type, entity_id,
                actor_type, actor_address, actor_id, ip_address, user_agent,
                old_values, new_values, changes, action, resource,
                method, endpoint, session_id, request_id,
                compliance_level, retention_period, is_sensitive,
                metadata, tags, checksum, signature
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18,
                $19, $20, $21, $22, $23, $24, $25
            ) RETURNING id, timestamp
        `;
        
        const values = [
            auditRecord.event_id,
            auditRecord.event_type,
            auditRecord.entity_type,
            auditRecord.entity_id,
            auditRecord.actor_type,
            auditRecord.actor_address ? Buffer.from(auditRecord.actor_address.slice(2), 'hex') : null,
            auditRecord.actor_id,
            auditRecord.ip_address,
            auditRecord.user_agent,
            auditRecord.old_values ? JSON.stringify(auditRecord.old_values) : null,
            auditRecord.new_values ? JSON.stringify(auditRecord.new_values) : null,
            auditRecord.changes ? JSON.stringify(auditRecord.changes) : null,
            auditRecord.action,
            auditRecord.resource,
            auditRecord.method,
            auditRecord.endpoint,
            auditRecord.session_id,
            auditRecord.request_id,
            auditRecord.compliance_level,
            auditRecord.retention_period,
            auditRecord.is_sensitive,
            JSON.stringify(auditRecord.metadata),
            auditRecord.tags,
            auditRecord.checksum,
            auditRecord.signature
        ];
        
        const result = await this.config.pgPool.query(insertQuery, values);
        
        auditRecord.id = result.rows[0].id;
        auditRecord.timestamp = result.rows[0].timestamp;
        
        return auditRecord;
    }
    
    async bufferAuditEvent(auditRecord) {
        this.auditBuffer.push(auditRecord);
        
        if (this.auditBuffer.length >= this.config.bufferSize) {
            await this.flushAuditBuffer();
        }
    }
    
    async flushAuditBuffer() {
        if (this.processingBuffer || this.auditBuffer.length === 0) {
            return;
        }
        
        this.processingBuffer = true;
        const bufferToProcess = [...this.auditBuffer];
        this.auditBuffer = [];
        
        try {
            await this.batchInsertAuditEvents(bufferToProcess);
        } catch (error) {
            // Re-add failed events to buffer
            this.auditBuffer.unshift(...bufferToProcess);
            throw error;
        } finally {
            this.processingBuffer = false;
        }
    }
    
    async batchInsertAuditEvents(auditRecords) {
        const client = await this.config.pgPool.connect();
        
        try {
            await client.query('BEGIN');
            
            for (const record of auditRecords) {
                await this.insertSingleAuditRecord(client, record);
            }
            
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    
    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================
    
    enrichAuditEvent(eventData) {
        return {
            ...eventData,
            eventId: eventData.eventId || this.generateEventId(),
            timestamp: eventData.timestamp || new Date(),
            timezone: eventData.timezone || 'UTC',
            metadata: {
                ...eventData.metadata,
                systemVersion: process.env.npm_package_version,
                nodeVersion: process.version,
                platform: process.platform,
                auditSystemVersion: '1.0.0'
            }
        };
    }
    
    classifyEvent(eventData) {
        const classification = {
            level: 'standard',
            isSensitive: false,
            requiresEncryption: false,
            complianceFrameworks: []
        };
        
        // Classify based on event type
        const criticalEvents = [
            'authentication_failed',
            'privilege_escalation',
            'security_breach',
            'data_export',
            'system_configuration'
        ];
        
        const sensitiveEvents = [
            'personal_data_access',
            'financial_transaction',
            'payment_processing'
        ];
        
        if (criticalEvents.includes(eventData.eventType)) {
            classification.level = 'critical';
            classification.requiresEncryption = true;
        } else if (sensitiveEvents.includes(eventData.eventType)) {
            classification.level = 'high';
            classification.isSensitive = true;
            classification.requiresEncryption = true;
        }
        
        // Apply data classification rules
        const dataType = this.identifyDataType(eventData);
        const dataClassification = this.config.dataClassification[dataType];
        
        if (dataClassification) {
            classification.level = this.getHigherClassification(classification.level, dataClassification);
            if (dataClassification === 'sensitive' || dataClassification === 'critical') {
                classification.isSensitive = true;
                classification.requiresEncryption = true;
            }
        }
        
        return classification;
    }
    
    identifyDataType(eventData) {
        // Identify data type based on event characteristics
        if (eventData.entityType === 'user' || eventData.action?.includes('personal')) {
            return 'user_data';
        }
        
        if (eventData.action?.includes('financial') || eventData.action?.includes('payment')) {
            return 'financial_data';
        }
        
        if (eventData.action?.includes('config') || eventData.action?.includes('system')) {
            return 'system_config';
        }
        
        if (eventData.entityType === 'audit_log') {
            return 'audit_logs';
        }
        
        return 'public_data';
    }
    
    getRetentionPeriod(complianceLevel) {
        return this.config.retentionPolicies[complianceLevel] || this.config.retentionPolicies.standard;
    }
    
    generateTags(eventData, classification) {
        const tags = [];
        
        // Add basic tags
        tags.push(`event_type:${eventData.eventType}`);
        tags.push(`actor_type:${eventData.actorType}`);
        tags.push(`compliance_level:${classification.level}`);
        
        // Add framework tags
        for (const framework of classification.complianceFrameworks) {
            tags.push(`framework:${framework}`);
        }
        
        // Add sensitivity tags
        if (classification.isSensitive) {
            tags.push('sensitive_data');
        }
        
        return tags;
    }
    
    generateEventId() {
        return crypto.randomUUID();
    }
    
    generateAlertId() {
        return 'alert_' + crypto.randomBytes(16).toString('hex');
    }
    
    generateViolationId() {
        return 'violation_' + crypto.randomBytes(16).toString('hex');
    }
    
    updateMetrics(auditRecord, startTime) {
        this.metrics.totalAuditEvents++;
        
        if (auditRecord.compliance_level === 'critical') {
            this.metrics.criticalEvents++;
        }
        
        const processingTime = Date.now() - startTime;
        this.metrics.avgProcessingTime = this.updateAverageTime(
            this.metrics.avgProcessingTime,
            processingTime,
            this.metrics.totalAuditEvents
        );
    }
    
    updateAverageTime(currentAvg, newTime, count) {
        return ((currentAvg * (count - 1)) + newTime) / count;
    }
    
    startBackgroundProcessors() {
        // Flush audit buffer every 30 seconds
        setInterval(() => this.flushAuditBuffer(), 30000);
        
        // Clean up old activity patterns every hour
        setInterval(() => this.cleanupActivityPatterns(), 3600000);
        
        // Emit metrics every 5 minutes
        setInterval(() => this.emitMetrics(), 300000);
    }
    
    cleanupActivityPatterns() {
        const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
        
        for (const [userId, pattern] of this.userActivityPatterns) {
            if (pattern.lastActivity && pattern.lastActivity.getTime() < cutoff) {
                this.userActivityPatterns.delete(userId);
            }
        }
    }
    
    emitMetrics() {
        this.emit('metrics', {
            ...this.metrics,
            bufferSize: this.auditBuffer.length,
            activePatterns: this.userActivityPatterns.size,
            timestamp: new Date().toISOString()
        });
    }
    
    // =============================================================================
    // PUBLIC API
    // =============================================================================
    
    async searchAuditLog(criteria, options = {}) {
        const { limit = 100, offset = 0, orderBy = 'timestamp DESC' } = options;
        
        let query = 'SELECT * FROM audit_log WHERE 1=1';
        const params = [];
        let paramIndex = 1;
        
        // Build dynamic query based on criteria
        if (criteria.eventType) {
            query += ` AND event_type = $${paramIndex++}`;
            params.push(criteria.eventType);
        }
        
        if (criteria.actorId) {
            query += ` AND actor_id = $${paramIndex++}`;
            params.push(criteria.actorId);
        }
        
        if (criteria.entityType) {
            query += ` AND entity_type = $${paramIndex++}`;
            params.push(criteria.entityType);
        }
        
        if (criteria.startDate) {
            query += ` AND timestamp >= $${paramIndex++}`;
            params.push(criteria.startDate);
        }
        
        if (criteria.endDate) {
            query += ` AND timestamp <= $${paramIndex++}`;
            params.push(criteria.endDate);
        }
        
        query += ` ORDER BY ${orderBy} LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await this.config.pgPool.query(query, params);
        return result.rows;
    }
    
    async getComplianceReport(framework, startDate, endDate) {
        const query = `
            SELECT 
                event_type,
                COUNT(*) as event_count,
                COUNT(CASE WHEN compliance_level = 'critical' THEN 1 END) as critical_events,
                COUNT(CASE WHEN is_sensitive = true THEN 1 END) as sensitive_events
            FROM audit_log 
            WHERE $1 = ANY(tags) 
            AND timestamp BETWEEN $2 AND $3
            GROUP BY event_type
            ORDER BY event_count DESC
        `;
        
        const result = await this.config.pgPool.query(query, [
            `framework:${framework}`,
            startDate,
            endDate
        ]);
        
        return {
            framework: framework,
            period: { startDate, endDate },
            summary: result.rows,
            generatedAt: new Date()
        };
    }
    
    getMetrics() {
        return {
            ...this.metrics,
            bufferSize: this.auditBuffer.length,
            activePatterns: this.userActivityPatterns.size,
            lastUpdate: new Date().toISOString()
        };
    }
    
    async shutdown() {
        // Flush remaining buffer
        await this.flushAuditBuffer();
        
        // Close database connections
        await this.config.pgPool.end();
        
        // Close Redis connection
        if (this.config.redis) {
            await this.config.redis.quit();
        }
        
        this.emit('shutdown');
    }
}

module.exports = ComplianceAuditTrail;