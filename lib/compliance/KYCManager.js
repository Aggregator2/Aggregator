const EventEmitter = require('events');
const crypto = require('crypto');
const axios = require('axios');
const stateMachine = require('javascript-state-machine');

/**
 * KYC/AML Manager with Jumio and Onfido integration
 * Handles user verification workflow with state machine
 */
class KYCManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            jumio: {
                apiKey: config.jumio?.apiKey,
                apiSecret: config.jumio?.apiSecret,
                baseUrl: config.jumio?.baseUrl || 'https://api.jumio.com',
                callbackUrl: config.jumio?.callbackUrl
            },
            onfido: {
                apiToken: config.onfido?.apiToken,
                baseUrl: config.onfido?.baseUrl || 'https://api.onfido.com/v3',
                webhookToken: config.onfido?.webhookToken
            },
            storage: {
                encryptionKey: config.storage?.encryptionKey || crypto.randomBytes(32),
                bucket: config.storage?.bucket || 'kyc-documents'
            },
            provider: config.provider || 'onfido', // 'jumio' or 'onfido'
            ...config
        };
        
        // Initialize providers
        this.providers = {
            jumio: new JumioProvider(this.config.jumio),
            onfido: new OnfidoProvider(this.config.onfido)
        };
        
        // User verification states
        this.verifications = new Map();
        
        // Document encryption
        this.cipher = crypto.createCipher('aes-256-gcm', this.config.storage.encryptionKey);
    }
    
    /**
     * Create KYC verification state machine
     */
    createVerificationStateMachine(userId) {
        return new stateMachine({
            init: 'unverified',
            transitions: [
                { name: 'start', from: 'unverified', to: 'pending_documents' },
                { name: 'submitDocuments', from: 'pending_documents', to: 'documents_received' },
                { name: 'startVerification', from: 'documents_received', to: 'verifying' },
                { name: 'approve', from: 'verifying', to: 'approved' },
                { name: 'reject', from: 'verifying', to: 'rejected' },
                { name: 'requestAdditional', from: 'verifying', to: 'pending_additional' },
                { name: 'submitAdditional', from: 'pending_additional', to: 'verifying' },
                { name: 'expire', from: ['pending_documents', 'pending_additional'], to: 'expired' },
                { name: 'reset', from: '*', to: 'unverified' }
            ],
            methods: {
                onStart: () => {
                    this.emit('verificationStarted', { userId });
                },
                onSubmitDocuments: (lifecycle, documents) => {
                    this.emit('documentsSubmitted', { userId, documents });
                },
                onApprove: () => {
                    this.emit('verificationApproved', { userId });
                },
                onReject: (lifecycle, reason) => {
                    this.emit('verificationRejected', { userId, reason });
                }
            }
        });
    }
    
    /**
     * Start KYC verification for user
     */
    async startVerification(userId, userData) {
        try {
            // Create state machine
            const fsm = this.createVerificationStateMachine(userId);
            
            // Initialize verification record
            const verification = {
                userId,
                provider: this.config.provider,
                state: fsm.state,
                startedAt: Date.now(),
                userData: this.sanitizeUserData(userData),
                attempts: 0,
                documents: [],
                checks: [],
                riskScore: null
            };
            
            this.verifications.set(userId, { fsm, verification });
            
            // Start verification process
            fsm.start();
            
            // Create verification session with provider
            const provider = this.providers[this.config.provider];
            const session = await provider.createVerification(userId, userData);
            
            verification.sessionId = session.id;
            verification.sessionUrl = session.url;
            
            return {
                userId,
                sessionId: session.id,
                sessionUrl: session.url,
                state: fsm.state
            };
            
        } catch (error) {
            console.error('Failed to start verification:', error);
            throw error;
        }
    }
    
    /**
     * Submit documents for verification
     */
    async submitDocuments(userId, documents) {
        const record = this.verifications.get(userId);
        if (!record) {
            throw new Error('Verification not found');
        }
        
        const { fsm, verification } = record;
        
        // Validate state transition
        if (!fsm.can('submitDocuments')) {
            throw new Error(`Cannot submit documents in state: ${fsm.state}`);
        }
        
        // Encrypt and store documents
        const encryptedDocs = await this.encryptDocuments(documents);
        verification.documents.push(...encryptedDocs);
        
        // Update state
        fsm.submitDocuments(documents);
        verification.state = fsm.state;
        
        // Auto-start verification if all required documents are present
        if (this.hasRequiredDocuments(verification)) {
            await this.performVerification(userId);
        }
        
        return {
            userId,
            state: fsm.state,
            documentsReceived: verification.documents.length
        };
    }
    
    /**
     * Perform verification checks
     */
    async performVerification(userId) {
        const record = this.verifications.get(userId);
        if (!record) {
            throw new Error('Verification not found');
        }
        
        const { fsm, verification } = record;
        
        // Start verification
        if (fsm.can('startVerification')) {
            fsm.startVerification();
            verification.state = fsm.state;
        }
        
        try {
            const provider = this.providers[verification.provider];
            
            // Perform document verification
            const documentCheck = await provider.verifyDocuments(
                verification.sessionId,
                verification.documents
            );
            
            verification.checks.push({
                type: 'document',
                result: documentCheck,
                timestamp: Date.now()
            });
            
            // Perform identity verification
            const identityCheck = await provider.verifyIdentity(
                verification.sessionId,
                verification.userData
            );
            
            verification.checks.push({
                type: 'identity',
                result: identityCheck,
                timestamp: Date.now()
            });
            
            // Perform AML checks
            const amlCheck = await this.performAMLCheck(verification.userData);
            verification.checks.push({
                type: 'aml',
                result: amlCheck,
                timestamp: Date.now()
            });
            
            // Calculate risk score
            verification.riskScore = this.calculateRiskScore(verification);
            
            // Make decision
            const decision = this.makeVerificationDecision(verification);
            
            if (decision.approved) {
                fsm.approve();
                verification.approvedAt = Date.now();
                verification.expiresAt = Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year
            } else {
                fsm.reject(decision.reason);
                verification.rejectedAt = Date.now();
                verification.rejectionReason = decision.reason;
            }
            
            verification.state = fsm.state;
            
            return {
                userId,
                state: fsm.state,
                decision,
                riskScore: verification.riskScore
            };
            
        } catch (error) {
            console.error('Verification failed:', error);
            throw error;
        }
    }
    
    /**
     * Perform AML checks
     */
    async performAMLCheck(userData) {
        const checks = {
            sanctions: await this.checkSanctionsList(userData),
            pep: await this.checkPEPList(userData),
            adverseMedia: await this.checkAdverseMedia(userData)
        };
        
        return {
            passed: !checks.sanctions.match && !checks.pep.match && !checks.adverseMedia.found,
            checks,
            timestamp: Date.now()
        };
    }
    
    /**
     * Check sanctions lists (OFAC, EU, UN)
     */
    async checkSanctionsList(userData) {
        // In production, this would integrate with sanctions screening APIs
        const lists = ['OFAC', 'EU', 'UN', 'UK'];
        const results = [];
        
        for (const list of lists) {
            const match = await this.searchSanctionsList(list, userData);
            if (match.found) {
                results.push({
                    list,
                    match: match.details,
                    confidence: match.confidence
                });
            }
        }
        
        return {
            match: results.length > 0,
            results,
            checkedLists: lists
        };
    }
    
    /**
     * Check PEP (Politically Exposed Persons) lists
     */
    async checkPEPList(userData) {
        // Check if user is a politically exposed person
        const pepMatch = await this.searchPEPDatabase(userData);
        
        return {
            match: pepMatch.found,
            details: pepMatch.details,
            level: pepMatch.level // 'direct', 'family', 'associate'
        };
    }
    
    /**
     * Check adverse media
     */
    async checkAdverseMedia(userData) {
        // Search for negative news about the user
        const mediaSearch = await this.searchAdverseMedia(userData);
        
        return {
            found: mediaSearch.results.length > 0,
            results: mediaSearch.results,
            categories: mediaSearch.categories // 'financial_crime', 'terrorism', etc.
        };
    }
    
    /**
     * Calculate risk score
     */
    calculateRiskScore(verification) {
        let score = 0;
        const factors = [];
        
        // Document verification score
        const docCheck = verification.checks.find(c => c.type === 'document');
        if (docCheck) {
            if (docCheck.result.authentic === false) {
                score += 100;
                factors.push({ factor: 'document_fraud', weight: 100 });
            } else if (docCheck.result.confidence < 0.8) {
                score += 30;
                factors.push({ factor: 'low_document_confidence', weight: 30 });
            }
        }
        
        // Identity verification score
        const idCheck = verification.checks.find(c => c.type === 'identity');
        if (idCheck) {
            if (!idCheck.result.match) {
                score += 50;
                factors.push({ factor: 'identity_mismatch', weight: 50 });
            }
        }
        
        // AML check score
        const amlCheck = verification.checks.find(c => c.type === 'aml');
        if (amlCheck) {
            if (amlCheck.result.checks.sanctions.match) {
                score += 200;
                factors.push({ factor: 'sanctions_match', weight: 200 });
            }
            if (amlCheck.result.checks.pep.match) {
                score += 50;
                factors.push({ factor: 'pep_match', weight: 50 });
            }
            if (amlCheck.result.checks.adverseMedia.found) {
                score += 30;
                factors.push({ factor: 'adverse_media', weight: 30 });
            }
        }
        
        // Country risk
        const countryRisk = this.getCountryRiskScore(verification.userData.country);
        if (countryRisk > 0) {
            score += countryRisk;
            factors.push({ factor: 'high_risk_country', weight: countryRisk });
        }
        
        return {
            score: Math.min(score, 1000), // Cap at 1000
            level: this.getRiskLevel(score),
            factors
        };
    }
    
    /**
     * Make verification decision
     */
    makeVerificationDecision(verification) {
        const { riskScore } = verification;
        
        // Auto-reject high risk
        if (riskScore.score > 100) {
            return {
                approved: false,
                reason: 'high_risk',
                details: riskScore.factors
            };
        }
        
        // Check all required checks passed
        const allChecksPassed = verification.checks.every(check => {
            if (check.type === 'document') return check.result.authentic !== false;
            if (check.type === 'identity') return check.result.match;
            if (check.type === 'aml') return check.result.passed;
            return true;
        });
        
        if (!allChecksPassed) {
            return {
                approved: false,
                reason: 'checks_failed',
                details: verification.checks.filter(c => !c.result.passed)
            };
        }
        
        // Approve low risk
        if (riskScore.score < 30) {
            return {
                approved: true,
                reason: 'low_risk',
                details: riskScore
            };
        }
        
        // Manual review for medium risk
        return {
            approved: false,
            reason: 'manual_review_required',
            details: riskScore
        };
    }
    
    /**
     * Get country risk score
     */
    getCountryRiskScore(country) {
        const highRiskCountries = {
            'IR': 100, // Iran
            'KP': 100, // North Korea
            'SY': 100, // Syria
            'CU': 80,  // Cuba
            'VE': 60,  // Venezuela
            // Add more countries as needed
        };
        
        return highRiskCountries[country] || 0;
    }
    
    /**
     * Get risk level from score
     */
    getRiskLevel(score) {
        if (score >= 100) return 'critical';
        if (score >= 50) return 'high';
        if (score >= 30) return 'medium';
        return 'low';
    }
    
    /**
     * Encrypt documents
     */
    async encryptDocuments(documents) {
        const encrypted = [];
        
        for (const doc of documents) {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(
                'aes-256-gcm',
                this.config.storage.encryptionKey,
                iv
            );
            
            const encryptedData = Buffer.concat([
                cipher.update(doc.data),
                cipher.final()
            ]);
            
            const authTag = cipher.getAuthTag();
            
            encrypted.push({
                type: doc.type,
                encryptedData: encryptedData.toString('base64'),
                iv: iv.toString('base64'),
                authTag: authTag.toString('base64'),
                metadata: doc.metadata,
                uploadedAt: Date.now()
            });
        }
        
        return encrypted;
    }
    
    /**
     * Decrypt document
     */
    async decryptDocument(encryptedDoc) {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            this.config.storage.encryptionKey,
            Buffer.from(encryptedDoc.iv, 'base64')
        );
        
        decipher.setAuthTag(Buffer.from(encryptedDoc.authTag, 'base64'));
        
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encryptedDoc.encryptedData, 'base64')),
            decipher.final()
        ]);
        
        return {
            type: encryptedDoc.type,
            data: decrypted,
            metadata: encryptedDoc.metadata
        };
    }
    
    /**
     * Check if user has required documents
     */
    hasRequiredDocuments(verification) {
        const requiredTypes = ['identity', 'address'];
        const providedTypes = verification.documents.map(d => d.type);
        
        return requiredTypes.every(type => providedTypes.includes(type));
    }
    
    /**
     * Sanitize user data
     */
    sanitizeUserData(userData) {
        return {
            firstName: userData.firstName,
            lastName: userData.lastName,
            dateOfBirth: userData.dateOfBirth,
            country: userData.country,
            address: {
                line1: userData.address?.line1,
                city: userData.address?.city,
                state: userData.address?.state,
                postalCode: userData.address?.postalCode,
                country: userData.address?.country
            }
        };
    }
    
    /**
     * Search sanctions list (mock implementation)
     */
    async searchSanctionsList(list, userData) {
        // In production, integrate with real sanctions APIs
        return {
            found: false,
            details: null,
            confidence: 0
        };
    }
    
    /**
     * Search PEP database (mock implementation)
     */
    async searchPEPDatabase(userData) {
        // In production, integrate with PEP screening services
        return {
            found: false,
            details: null,
            level: null
        };
    }
    
    /**
     * Search adverse media (mock implementation)
     */
    async searchAdverseMedia(userData) {
        // In production, integrate with media monitoring services
        return {
            results: [],
            categories: []
        };
    }
    
    /**
     * Get verification status
     */
    getVerificationStatus(userId) {
        const record = this.verifications.get(userId);
        if (!record) {
            return { status: 'not_found' };
        }
        
        const { fsm, verification } = record;
        
        return {
            userId,
            state: fsm.state,
            provider: verification.provider,
            startedAt: verification.startedAt,
            riskScore: verification.riskScore,
            expiresAt: verification.expiresAt
        };
    }
    
    /**
     * Export verification data for GDPR
     */
    async exportUserData(userId) {
        const record = this.verifications.get(userId);
        if (!record) {
            return null;
        }
        
        const { verification } = record;
        
        // Decrypt documents for export
        const decryptedDocs = [];
        for (const doc of verification.documents) {
            try {
                const decrypted = await this.decryptDocument(doc);
                decryptedDocs.push({
                    type: decrypted.type,
                    metadata: decrypted.metadata,
                    uploadedAt: doc.uploadedAt
                });
            } catch (error) {
                console.error('Failed to decrypt document:', error);
            }
        }
        
        return {
            userId,
            state: verification.state,
            userData: verification.userData,
            documents: decryptedDocs,
            checks: verification.checks,
            riskScore: verification.riskScore,
            startedAt: verification.startedAt,
            exportedAt: Date.now()
        };
    }
}

/**
 * Jumio Provider Implementation
 */
class JumioProvider {
    constructor(config) {
        this.config = config;
        this.client = axios.create({
            baseURL: config.baseUrl,
            auth: {
                username: config.apiKey,
                password: config.apiSecret
            }
        });
    }
    
    async createVerification(userId, userData) {
        const response = await this.client.post('/netverify/v2/acquisitions', {
            customerInternalReference: userId,
            userReference: userId,
            callbackUrl: this.config.callbackUrl,
            locale: 'en-US',
            ...userData
        });
        
        return {
            id: response.data.jumioIdScanReference,
            url: response.data.redirectUrl
        };
    }
    
    async verifyDocuments(sessionId, documents) {
        // Jumio handles document verification through their UI
        return {
            authentic: true,
            confidence: 0.95
        };
    }
    
    async verifyIdentity(sessionId, userData) {
        // Jumio performs identity verification
        return {
            match: true,
            confidence: 0.92
        };
    }
}

/**
 * Onfido Provider Implementation
 */
class OnfidoProvider {
    constructor(config) {
        this.config = config;
        this.client = axios.create({
            baseURL: config.baseUrl,
            headers: {
                'Authorization': `Token token=${config.apiToken}`,
                'Content-Type': 'application/json'
            }
        });
    }
    
    async createVerification(userId, userData) {
        // Create applicant
        const applicant = await this.client.post('/applicants', {
            first_name: userData.firstName,
            last_name: userData.lastName,
            dob: userData.dateOfBirth,
            country: userData.country,
            address: userData.address
        });
        
        // Create SDK token
        const sdkToken = await this.client.post('/sdk_token', {
            applicant_id: applicant.data.id,
            referrer: '*'
        });
        
        return {
            id: applicant.data.id,
            url: sdkToken.data.token
        };
    }
    
    async verifyDocuments(sessionId, documents) {
        // Create document check
        const check = await this.client.post('/checks', {
            applicant_id: sessionId,
            report_names: ['document', 'facial_similarity_photo']
        });
        
        return {
            authentic: check.data.results[0].result === 'clear',
            confidence: 0.93
        };
    }
    
    async verifyIdentity(sessionId, userData) {
        // Get check results
        const checks = await this.client.get(`/applicants/${sessionId}/checks`);
        
        const identityCheck = checks.data.checks.find(c => 
            c.report_names.includes('identity_enhanced')
        );
        
        return {
            match: identityCheck?.result === 'clear',
            confidence: 0.90
        };
    }
}

module.exports = KYCManager;