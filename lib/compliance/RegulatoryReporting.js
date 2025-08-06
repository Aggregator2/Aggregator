const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { createHash } = require('crypto');

/**
 * Regulatory Reporting System
 * Handles automated SAR filing, transaction reports, tax forms, and audit trails
 */
class RegulatoryReporting extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            reportsDir: config.reportsDir || '/workspace/reports/regulatory',
            templatesDir: config.templatesDir || '/workspace/templates/regulatory',
            encryptionKey: config.encryptionKey || crypto.randomBytes(32),
            fincen: {
                bsaId: config.fincen?.bsaId,
                apiEndpoint: config.fincen?.apiEndpoint || 'https://bsaefiling.fincen.treas.gov/api'
            },
            irs: {
                tin: config.irs?.tin,
                apiEndpoint: config.irs?.apiEndpoint || 'https://fire.irs.gov'
            },
            auditLog: {
                retention: config.auditLog?.retention || 2555, // 7 years in days
                blockchain: config.auditLog?.blockchain || false
            },
            ...config
        };
        
        // Report generators
        this.generators = {
            sar: new SARGenerator(this.config),
            ctr: new CTRGenerator(this.config),
            form8300: new Form8300Generator(this.config),
            form1099k: new Form1099KGenerator(this.config),
            dailyTransaction: new DailyTransactionReporter(this.config),
            gdpr: new GDPRReporter(this.config)
        };
        
        // Audit trail manager
        this.auditTrail = new AuditTrailManager(this.config);
        
        // Initialize directories
        this.initializeDirectories();
    }
    
    /**
     * Initialize report directories
     */
    async initializeDirectories() {
        const dirs = [
            this.config.reportsDir,
            path.join(this.config.reportsDir, 'sar'),
            path.join(this.config.reportsDir, 'ctr'),
            path.join(this.config.reportsDir, 'tax'),
            path.join(this.config.reportsDir, 'daily'),
            path.join(this.config.reportsDir, 'gdpr'),
            path.join(this.config.reportsDir, 'audit')
        ];
        
        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
        }
    }
    
    /**
     * File Suspicious Activity Report (SAR)
     */
    async fileSAR(suspiciousActivity) {
        try {
            // Generate SAR
            const sar = await this.generators.sar.generate(suspiciousActivity);
            
            // Validate SAR data
            const validation = await this.validateSAR(sar);
            if (!validation.valid) {
                throw new Error(`SAR validation failed: ${validation.errors.join(', ')}`);
            }
            
            // Create audit entry
            const auditId = await this.auditTrail.logAction({
                action: 'sar_generation',
                reportType: 'SAR',
                reportId: sar.id,
                data: sar,
                timestamp: Date.now()
            });
            
            // File with FinCEN (if configured)
            if (this.config.fincen.bsaId) {
                const filingResult = await this.fileWithFinCEN(sar);
                sar.filingResult = filingResult;
            }
            
            // Store encrypted report
            await this.storeReport('sar', sar);
            
            // Update audit trail
            await this.auditTrail.updateEntry(auditId, {
                status: 'filed',
                filingDetails: sar.filingResult
            });
            
            this.emit('sarFiled', { sar, auditId });
            
            return {
                reportId: sar.id,
                status: 'filed',
                filingNumber: sar.filingResult?.confirmationNumber,
                auditId
            };
            
        } catch (error) {
            console.error('SAR filing error:', error);
            this.emit('error', { type: 'sar_filing', error });
            throw error;
        }
    }
    
    /**
     * Generate Currency Transaction Report (CTR)
     */
    async generateCTR(transactions) {
        try {
            const ctr = await this.generators.ctr.generate(transactions);
            
            // Create audit entry
            const auditId = await this.auditTrail.logAction({
                action: 'ctr_generation',
                reportType: 'CTR',
                reportId: ctr.id,
                data: ctr,
                timestamp: Date.now()
            });
            
            // Store report
            await this.storeReport('ctr', ctr);
            
            this.emit('ctrGenerated', { ctr, auditId });
            
            return {
                reportId: ctr.id,
                status: 'generated',
                auditId
            };
            
        } catch (error) {
            console.error('CTR generation error:', error);
            throw error;
        }
    }
    
    /**
     * Generate tax forms (1099-K)
     */
    async generateTaxForms(year, userTransactions) {
        try {
            const forms = [];
            
            for (const [userId, transactions] of Object.entries(userTransactions)) {
                const userSummary = this.calculateUserTaxSummary(transactions);
                
                // Generate 1099-K if threshold met
                if (userSummary.grossAmount >= 600 || userSummary.transactionCount >= 1) {
                    const form1099k = await this.generators.form1099k.generate({
                        userId,
                        year,
                        transactions,
                        summary: userSummary
                    });
                    
                    forms.push(form1099k);
                    
                    // Store form
                    await this.storeReport('tax', form1099k);
                }
            }
            
            // Create audit entry
            const auditId = await this.auditTrail.logAction({
                action: 'tax_forms_generation',
                reportType: '1099-K',
                year,
                formsGenerated: forms.length,
                timestamp: Date.now()
            });
            
            this.emit('taxFormsGenerated', { year, forms: forms.length, auditId });
            
            return {
                year,
                formsGenerated: forms.length,
                forms: forms.map(f => ({ formId: f.id, userId: f.userId })),
                auditId
            };
            
        } catch (error) {
            console.error('Tax form generation error:', error);
            throw error;
        }
    }
    
    /**
     * Generate daily transaction report
     */
    async generateDailyReport(date) {
        try {
            const report = await this.generators.dailyTransaction.generate(date);
            
            // Create audit entry
            const auditId = await this.auditTrail.logAction({
                action: 'daily_report_generation',
                reportType: 'daily_transaction',
                date,
                reportId: report.id,
                timestamp: Date.now()
            });
            
            // Store report
            await this.storeReport('daily', report);
            
            // Check for reporting thresholds
            await this.checkReportingThresholds(report);
            
            this.emit('dailyReportGenerated', { report, auditId });
            
            return {
                reportId: report.id,
                date,
                summary: report.summary,
                auditId
            };
            
        } catch (error) {
            console.error('Daily report generation error:', error);
            throw error;
        }
    }
    
    /**
     * Generate GDPR-compliant data export
     */
    async generateGDPRExport(userId) {
        try {
            const export_ = await this.generators.gdpr.generate(userId);
            
            // Create audit entry
            const auditId = await this.auditTrail.logAction({
                action: 'gdpr_export',
                reportType: 'gdpr_data_export',
                userId,
                exportId: export_.id,
                timestamp: Date.now()
            });
            
            // Store encrypted export
            await this.storeReport('gdpr', export_, true);
            
            this.emit('gdprExportGenerated', { userId, exportId: export_.id, auditId });
            
            return {
                exportId: export_.id,
                userId,
                generatedAt: export_.generatedAt,
                expiresAt: export_.expiresAt,
                downloadUrl: export_.downloadUrl,
                auditId
            };
            
        } catch (error) {
            console.error('GDPR export generation error:', error);
            throw error;
        }
    }
    
    /**
     * Get audit trail for report
     */
    async getAuditTrail(reportId, options = {}) {
        return await this.auditTrail.getTrail(reportId, options);
    }
    
    /**
     * Validate SAR data
     */
    async validateSAR(sar) {
        const errors = [];
        
        // Required fields validation
        const requiredFields = [
            'filingInstitution',
            'suspectInformation',
            'suspiciousActivity',
            'narrative'
        ];
        
        for (const field of requiredFields) {
            if (!sar[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        }
        
        // Validate suspect information
        if (sar.suspectInformation) {
            if (!sar.suspectInformation.lastName && !sar.suspectInformation.businessName) {
                errors.push('Either last name or business name is required');
            }
        }
        
        // Validate narrative
        if (sar.narrative && sar.narrative.length < 100) {
            errors.push('Narrative must be at least 100 characters');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * File with FinCEN
     */
    async fileWithFinCEN(report) {
        // In production, this would integrate with FinCEN BSA E-Filing system
        return {
            status: 'filed',
            confirmationNumber: `BSA-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            filedAt: new Date().toISOString()
        };
    }
    
    /**
     * Store encrypted report
     */
    async storeReport(type, report, encrypt = true) {
        const filename = `${type}_${report.id}_${Date.now()}.json`;
        const filepath = path.join(this.config.reportsDir, type, filename);
        
        let data = JSON.stringify(report, null, 2);
        
        if (encrypt) {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(
                'aes-256-gcm',
                this.config.encryptionKey,
                iv
            );
            
            const encrypted = Buffer.concat([
                cipher.update(data, 'utf8'),
                cipher.final()
            ]);
            
            const authTag = cipher.getAuthTag();
            
            data = JSON.stringify({
                encrypted: encrypted.toString('base64'),
                iv: iv.toString('base64'),
                authTag: authTag.toString('base64')
            });
        }
        
        await fs.writeFile(filepath, data);
        
        // Create checksum
        const checksum = createHash('sha256').update(data).digest('hex');
        await fs.writeFile(`${filepath}.checksum`, checksum);
        
        return filepath;
    }
    
    /**
     * Calculate user tax summary
     */
    calculateUserTaxSummary(transactions) {
        const summary = {
            grossAmount: 0,
            fees: 0,
            netAmount: 0,
            transactionCount: transactions.length,
            monthlyBreakdown: {}
        };
        
        for (const tx of transactions) {
            summary.grossAmount += tx.amount;
            summary.fees += tx.fee || 0;
            
            const month = new Date(tx.timestamp).getMonth() + 1;
            if (!summary.monthlyBreakdown[month]) {
                summary.monthlyBreakdown[month] = {
                    gross: 0,
                    count: 0
                };
            }
            
            summary.monthlyBreakdown[month].gross += tx.amount;
            summary.monthlyBreakdown[month].count++;
        }
        
        summary.netAmount = summary.grossAmount - summary.fees;
        
        return summary;
    }
    
    /**
     * Check reporting thresholds
     */
    async checkReportingThresholds(report) {
        // Check for large cash transactions
        const largeCashTransactions = report.transactions.filter(tx => 
            tx.amountUSD >= 10000 && tx.paymentMethod === 'cash'
        );
        
        if (largeCashTransactions.length > 0) {
            for (const tx of largeCashTransactions) {
                await this.generateForm8300(tx);
            }
        }
        
        // Check for suspicious patterns
        const suspiciousPatterns = this.detectSuspiciousPatterns(report.transactions);
        if (suspiciousPatterns.length > 0) {
            this.emit('suspiciousPatternsDetected', {
                patterns: suspiciousPatterns,
                reportId: report.id
            });
        }
    }
    
    /**
     * Generate Form 8300 for large cash transactions
     */
    async generateForm8300(transaction) {
        const form = await this.generators.form8300.generate(transaction);
        await this.storeReport('tax', form);
        
        this.emit('form8300Generated', {
            formId: form.id,
            transactionId: transaction.id
        });
        
        return form;
    }
    
    /**
     * Detect suspicious patterns in daily transactions
     */
    detectSuspiciousPatterns(transactions) {
        const patterns = [];
        
        // Rapid succession of transactions
        const rapidTransactions = this.findRapidTransactions(transactions);
        if (rapidTransactions.length > 0) {
            patterns.push({
                type: 'rapid_succession',
                transactions: rapidTransactions
            });
        }
        
        // Round amount transactions
        const roundAmounts = transactions.filter(tx => 
            tx.amount % 1000 === 0 && tx.amount >= 5000
        );
        if (roundAmounts.length > 5) {
            patterns.push({
                type: 'round_amounts',
                transactions: roundAmounts.map(tx => tx.id)
            });
        }
        
        return patterns;
    }
    
    /**
     * Find rapid succession transactions
     */
    findRapidTransactions(transactions) {
        const rapid = [];
        const sorted = transactions.sort((a, b) => a.timestamp - b.timestamp);
        
        for (let i = 1; i < sorted.length; i++) {
            const timeDiff = sorted[i].timestamp - sorted[i-1].timestamp;
            if (timeDiff < 60000 && // Less than 1 minute
                sorted[i].userId === sorted[i-1].userId) {
                rapid.push(sorted[i].id);
            }
        }
        
        return rapid;
    }
}

/**
 * SAR Generator
 */
class SARGenerator {
    constructor(config) {
        this.config = config;
    }
    
    async generate(suspiciousActivity) {
        const sar = {
            id: `SAR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            version: '2.0',
            filingInstitution: {
                name: 'SwappiQ Protocol',
                tin: this.config.irs.tin,
                address: this.config.companyAddress,
                contact: this.config.complianceOfficer
            },
            suspectInformation: this.formatSuspectInfo(suspiciousActivity),
            suspiciousActivity: this.formatSuspiciousActivity(suspiciousActivity),
            narrative: this.generateNarrative(suspiciousActivity),
            lawEnforcementContact: suspiciousActivity.lawEnforcementNotified || false,
            filingDate: new Date().toISOString(),
            reportingPeriod: {
                start: suspiciousActivity.startDate,
                end: suspiciousActivity.endDate || new Date().toISOString()
            }
        };
        
        return sar;
    }
    
    formatSuspectInfo(activity) {
        return {
            individualOrEntity: activity.userType || 'individual',
            lastName: activity.user?.lastName,
            firstName: activity.user?.firstName,
            businessName: activity.user?.businessName,
            address: activity.user?.address,
            identification: {
                type: activity.user?.idType,
                number: activity.user?.idNumber ? this.maskId(activity.user.idNumber) : null,
                country: activity.user?.idCountry
            },
            dateOfBirth: activity.user?.dateOfBirth,
            occupation: activity.user?.occupation
        };
    }
    
    formatSuspiciousActivity(activity) {
        return {
            typeOfActivity: activity.violations.map(v => v.type),
            transactionDetails: {
                totalAmount: activity.totalAmount,
                numberOfTransactions: activity.transactionCount,
                dateRange: {
                    start: activity.startDate,
                    end: activity.endDate
                }
            },
            instrumentsUsed: activity.instruments || ['cryptocurrency'],
            suspiciousPatterns: activity.patterns,
            redFlags: activity.redFlags
        };
    }
    
    generateNarrative(activity) {
        let narrative = `Suspicious activity detected for user ${activity.userId}. `;
        narrative += `The activity involved ${activity.transactionCount} transactions `;
        narrative += `totaling $${activity.totalAmount.toLocaleString()} `;
        narrative += `between ${new Date(activity.startDate).toLocaleDateString()} `;
        narrative += `and ${new Date(activity.endDate).toLocaleDateString()}. `;
        
        narrative += '\n\nViolations detected:\n';
        for (const violation of activity.violations) {
            narrative += `- ${violation.description}\n`;
        }
        
        if (activity.patterns && activity.patterns.length > 0) {
            narrative += '\n\nSuspicious patterns identified:\n';
            for (const pattern of activity.patterns) {
                narrative += `- ${pattern.description}\n`;
            }
        }
        
        narrative += '\n\n' + (activity.additionalInfo || '');
        
        return narrative;
    }
    
    maskId(id) {
        // Mask all but last 4 digits
        return id.slice(0, -4).replace(/./g, '*') + id.slice(-4);
    }
}

/**
 * CTR Generator
 */
class CTRGenerator {
    constructor(config) {
        this.config = config;
    }
    
    async generate(transactions) {
        const ctr = {
            id: `CTR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            version: '1.0',
            filingInstitution: {
                name: 'SwappiQ Protocol',
                tin: this.config.irs.tin
            },
            personInvolved: this.extractPersonInfo(transactions),
            transactions: transactions.map(tx => ({
                date: new Date(tx.timestamp).toISOString(),
                amount: tx.amountUSD,
                type: tx.type,
                accountNumber: this.maskAccount(tx.accountId),
                method: tx.method
            })),
            totalAmount: transactions.reduce((sum, tx) => sum + tx.amountUSD, 0),
            multipleTransactions: transactions.length > 1,
            generatedAt: new Date().toISOString()
        };
        
        return ctr;
    }
    
    extractPersonInfo(transactions) {
        const person = transactions[0].user;
        return {
            name: `${person.firstName} ${person.lastName}`,
            address: person.address,
            identification: {
                type: person.idType,
                number: this.maskId(person.idNumber)
            },
            dateOfBirth: person.dateOfBirth
        };
    }
    
    maskAccount(account) {
        return account.slice(0, 4) + '****' + account.slice(-4);
    }
    
    maskId(id) {
        return id.slice(0, -4).replace(/./g, '*') + id.slice(-4);
    }
}

/**
 * Form 8300 Generator
 */
class Form8300Generator {
    constructor(config) {
        this.config = config;
    }
    
    async generate(transaction) {
        return {
            id: `F8300-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            formType: '8300',
            transaction: {
                date: new Date(transaction.timestamp).toISOString(),
                amount: transaction.amountUSD,
                type: 'cryptocurrency_exchange'
            },
            payer: transaction.user,
            businessReceiving: {
                name: 'SwappiQ Protocol',
                tin: this.config.irs.tin,
                address: this.config.companyAddress
            },
            generatedAt: new Date().toISOString()
        };
    }
}

/**
 * Form 1099-K Generator
 */
class Form1099KGenerator {
    constructor(config) {
        this.config = config;
    }
    
    async generate(data) {
        const { userId, year, summary } = data;
        
        return {
            id: `1099K-${year}-${userId}-${Date.now()}`,
            formType: '1099-K',
            taxYear: year,
            payer: {
                name: 'SwappiQ Protocol',
                tin: this.config.irs.tin,
                address: this.config.companyAddress
            },
            payee: {
                userId,
                tin: data.userTin,
                name: data.userName,
                address: data.userAddress
            },
            paymentCardTransactions: {
                grossAmount: summary.grossAmount,
                cardNotPresent: summary.transactionCount
            },
            monthlyAmounts: summary.monthlyBreakdown,
            generatedAt: new Date().toISOString()
        };
    }
}

/**
 * Daily Transaction Reporter
 */
class DailyTransactionReporter {
    constructor(config) {
        this.config = config;
    }
    
    async generate(date) {
        // Fetch transactions for the date
        const transactions = []; // Would fetch from database
        
        const report = {
            id: `DAILY-${date}-${Date.now()}`,
            date,
            summary: {
                totalVolume: 0,
                transactionCount: 0,
                uniqueUsers: new Set(),
                largeTransactions: [],
                suspiciousActivities: []
            },
            transactions: [],
            generatedAt: new Date().toISOString()
        };
        
        // Process transactions
        for (const tx of transactions) {
            report.summary.totalVolume += tx.amountUSD;
            report.summary.transactionCount++;
            report.summary.uniqueUsers.add(tx.userId);
            
            if (tx.amountUSD >= 10000) {
                report.summary.largeTransactions.push(tx.id);
            }
            
            report.transactions.push({
                id: tx.id,
                userId: tx.userId,
                amount: tx.amountUSD,
                timestamp: tx.timestamp,
                type: tx.type
            });
        }
        
        report.summary.uniqueUsers = report.summary.uniqueUsers.size;
        
        return report;
    }
}

/**
 * GDPR Reporter
 */
class GDPRReporter {
    constructor(config) {
        this.config = config;
    }
    
    async generate(userId) {
        // Collect all user data
        const userData = await this.collectUserData(userId);
        
        const export_ = {
            id: `GDPR-${userId}-${Date.now()}`,
            userId,
            generatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
            data: userData,
            format: 'json',
            downloadUrl: `/api/gdpr/download/${userId}/${Date.now()}`
        };
        
        return export_;
    }
    
    async collectUserData(userId) {
        // Collect all data related to user
        return {
            profile: {}, // User profile data
            transactions: [], // Transaction history
            kyc: {}, // KYC data (sanitized)
            communications: [], // Communications
            activityLog: [] // Activity log
        };
    }
}

/**
 * Audit Trail Manager
 */
class AuditTrailManager {
    constructor(config) {
        this.config = config;
        this.entries = new Map();
    }
    
    async logAction(action) {
        const entry = {
            id: `AUDIT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            ...action,
            hash: this.calculateHash(action),
            previousHash: this.getLastHash()
        };
        
        this.entries.set(entry.id, entry);
        
        // Store in blockchain if configured
        if (this.config.auditLog.blockchain) {
            await this.storeOnBlockchain(entry);
        }
        
        return entry.id;
    }
    
    async updateEntry(entryId, updates) {
        const entry = this.entries.get(entryId);
        if (!entry) return;
        
        const updated = {
            ...entry,
            ...updates,
            updatedAt: Date.now()
        };
        
        updated.hash = this.calculateHash(updated);
        this.entries.set(entryId, updated);
    }
    
    async getTrail(reportId, options = {}) {
        const trail = [];
        
        for (const [id, entry] of this.entries) {
            if (entry.reportId === reportId || 
                (entry.data && entry.data.id === reportId)) {
                trail.push(entry);
            }
        }
        
        return trail.sort((a, b) => a.timestamp - b.timestamp);
    }
    
    calculateHash(data) {
        return createHash('sha256')
            .update(JSON.stringify(data))
            .digest('hex');
    }
    
    getLastHash() {
        const entries = Array.from(this.entries.values());
        if (entries.length === 0) return '0';
        return entries[entries.length - 1].hash;
    }
    
    async storeOnBlockchain(entry) {
        // Store hash on blockchain for immutability
        console.log('Storing audit entry on blockchain:', entry.hash);
    }
}

module.exports = RegulatoryReporting;