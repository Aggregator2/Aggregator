/**
 * @fileoverview Two-Factor Authentication Manager for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Comprehensive 2FA implementation supporting TOTP, SMS, and backup codes
 */

const EventEmitter = require('events');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * Two-Factor Authentication Manager
 * Supports multiple 2FA methods for enhanced security
 */
class TwoFactorAuthManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // 2FA methods configuration
            methods: {
                totp: {
                    enabled: config.methods?.totp?.enabled !== false,
                    issuer: config.methods?.totp?.issuer || 'SwappiQ Protocol',
                    algorithm: config.methods?.totp?.algorithm || 'sha256',
                    digits: config.methods?.totp?.digits || 6,
                    period: config.methods?.totp?.period || 30,
                    window: config.methods?.totp?.window || 2, // Accept codes from ±2 windows
                    qrCodeSize: config.methods?.totp?.qrCodeSize || 256
                },
                
                sms: {
                    enabled: config.methods?.sms?.enabled || false,
                    provider: config.methods?.sms?.provider || 'twilio',
                    credentials: config.methods?.sms?.credentials || {},
                    codeLength: config.methods?.sms?.codeLength || 6,
                    codeExpiry: config.methods?.sms?.codeExpiry || 300000, // 5 minutes
                    messageTemplate: config.methods?.sms?.messageTemplate || 
                        'Your SwappiQ verification code is: {code}'
                },
                
                email: {
                    enabled: config.methods?.email?.enabled || false,
                    provider: config.methods?.email?.provider || 'sendgrid',
                    credentials: config.methods?.email?.credentials || {},
                    codeLength: config.methods?.email?.codeLength || 6,
                    codeExpiry: config.methods?.email?.codeExpiry || 600000, // 10 minutes
                    subject: config.methods?.email?.subject || 'SwappiQ Verification Code',
                    template: config.methods?.email?.template
                },
                
                webauthn: {
                    enabled: config.methods?.webauthn?.enabled || false,
                    rpName: config.methods?.webauthn?.rpName || 'SwappiQ Protocol',
                    rpId: config.methods?.webauthn?.rpId || 'swappiq.protocol',
                    attestation: config.methods?.webauthn?.attestation || 'none',
                    userVerification: config.methods?.webauthn?.userVerification || 'preferred'
                },
                
                backupCodes: {
                    enabled: config.methods?.backupCodes?.enabled !== false,
                    count: config.methods?.backupCodes?.count || 10,
                    length: config.methods?.backupCodes?.length || 10,
                    format: config.methods?.backupCodes?.format || 'alphanumeric' // numeric, alphanumeric
                }
            },
            
            // Security configuration
            security: {
                maxAttempts: config.security?.maxAttempts || 5,
                lockoutDuration: config.security?.lockoutDuration || 3600000, // 1 hour
                requireTwoMethods: config.security?.requireTwoMethods || false,
                allowMethodChange: config.security?.allowMethodChange !== false,
                enforceForOperations: config.security?.enforceForOperations || [
                    'withdraw',
                    'transfer',
                    'swap_large',
                    'settings_change'
                ],
                
                rateLimiting: {
                    enabled: config.security?.rateLimiting?.enabled !== false,
                    maxVerifications: config.security?.rateLimiting?.maxVerifications || 10,
                    windowMs: config.security?.rateLimiting?.windowMs || 900000 // 15 minutes
                }
            },
            
            // Storage configuration
            storage: {
                type: config.storage?.type || 'memory', // memory, redis, database
                encryption: config.storage?.encryption !== false,
                ttl: config.storage?.ttl || 86400000 // 24 hours
            },
            
            // Recovery configuration
            recovery: {
                enabled: config.recovery?.enabled !== false,
                methods: config.recovery?.methods || ['email', 'support'],
                supportEmail: config.recovery?.supportEmail || 'support@swappiq.protocol',
                recoveryQuestions: config.recovery?.recoveryQuestions || false
            },
            
            // Notification configuration
            notifications: {
                onEnable: config.notifications?.onEnable !== false,
                onDisable: config.notifications?.onDisable !== false,
                onMethodChange: config.notifications?.onMethodChange !== false,
                onFailedAttempts: config.notifications?.onFailedAttempts !== false,
                failedAttemptsThreshold: config.notifications?.failedAttemptsThreshold || 3
            },
            
            auditLogging: config.auditLogging !== false,
            ...config
        };

        this.state = {
            userSettings: new Map(), // userId -> 2FA settings
            pendingSetups: new Map(), // setupId -> setup data
            verificationCodes: new Map(), // userId -> pending codes
            failedAttempts: new Map(), // userId -> attempt count
            rateLimitMap: new Map(), // userId -> rate limit data
            
            metrics: {
                totalEnabled: 0,
                methodsUsage: {
                    totp: 0,
                    sms: 0,
                    email: 0,
                    webauthn: 0,
                    backupCodes: 0
                },
                verificationAttempts: 0,
                successfulVerifications: 0,
                failedVerifications: 0,
                lockouts: 0,
                recoveries: 0
            }
        };

        this.providers = {
            sms: null,
            email: null
        };

        this.storageAdapter = null;
        
        this.initialize();
    }

    /**
     * Initialize 2FA manager
     */
    async initialize() {
        try {
            await this._initializeProviders();
            await this._initializeStorage();
            await this._loadUserSettings();
            await this._startCleanupTasks();
            
            console.log('Two-Factor Auth Manager initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize 2FA Manager:', error);
            throw error;
        }
    }

    /**
     * Setup 2FA for a user
     */
    async setupTwoFactor(userId, method, options = {}) {
        try {
            // Check if method is enabled
            if (!this.config.methods[method]?.enabled) {
                throw new Error(`2FA method ${method} is not enabled`);
            }

            // Check if user already has this method
            const userSettings = this._getUserSettings(userId);
            if (userSettings.methods[method]?.enabled) {
                throw new Error(`${method} is already enabled for this user`);
            }

            // Generate setup data based on method
            let setupData;
            
            switch (method) {
                case 'totp':
                    setupData = await this._setupTOTP(userId, options);
                    break;
                case 'sms':
                    setupData = await this._setupSMS(userId, options);
                    break;
                case 'email':
                    setupData = await this._setupEmail(userId, options);
                    break;
                case 'webauthn':
                    setupData = await this._setupWebAuthn(userId, options);
                    break;
                case 'backupCodes':
                    setupData = await this._generateBackupCodes(userId);
                    break;
                default:
                    throw new Error(`Unknown 2FA method: ${method}`);
            }

            // Store pending setup
            const setupId = crypto.randomBytes(16).toString('hex');
            this.state.pendingSetups.set(setupId, {
                userId,
                method,
                setupData,
                createdAt: Date.now(),
                expiresAt: Date.now() + 600000 // 10 minutes
            });

            await this._auditLog('2FA_SETUP_INITIATED', {
                userId,
                method,
                setupId
            });

            return {
                setupId,
                method,
                ...setupData
            };

        } catch (error) {
            console.error('2FA setup failed:', error);
            throw error;
        }
    }

    /**
     * Confirm 2FA setup
     */
    async confirmSetup(setupId, verificationData) {
        try {
            const setup = this.state.pendingSetups.get(setupId);
            
            if (!setup) {
                throw new Error('Setup session not found or expired');
            }

            if (Date.now() > setup.expiresAt) {
                this.state.pendingSetups.delete(setupId);
                throw new Error('Setup session expired');
            }

            // Verify based on method
            let verified = false;
            
            switch (setup.method) {
                case 'totp':
                    verified = await this._verifyTOTP(
                        setup.setupData.secret,
                        verificationData.code
                    );
                    break;
                case 'sms':
                case 'email':
                    verified = await this._verifyCode(
                        setup.userId,
                        verificationData.code,
                        setup.method
                    );
                    break;
                case 'webauthn':
                    verified = await this._verifyWebAuthnRegistration(
                        setup.setupData,
                        verificationData
                    );
                    break;
                case 'backupCodes':
                    verified = true; // Backup codes don't need verification
                    break;
            }

            if (!verified) {
                throw new Error('Verification failed');
            }

            // Enable the method
            await this._enableMethod(setup.userId, setup.method, setup.setupData);

            // Clean up
            this.state.pendingSetups.delete(setupId);

            // Update metrics
            this.state.metrics.totalEnabled++;
            this.state.metrics.methodsUsage[setup.method]++;

            // Send notification
            if (this.config.notifications.onEnable) {
                await this._sendNotification(setup.userId, '2fa_enabled', {
                    method: setup.method
                });
            }

            await this._auditLog('2FA_ENABLED', {
                userId: setup.userId,
                method: setup.method
            });

            this.emit('twoFactorEnabled', {
                userId: setup.userId,
                method: setup.method
            });

            return {
                success: true,
                method: setup.method,
                backupCodes: setup.method === 'backupCodes' ? setup.setupData.codes : undefined
            };

        } catch (error) {
            console.error('2FA confirmation failed:', error);
            throw error;
        }
    }

    /**
     * Verify 2FA code
     */
    async verifyTwoFactor(userId, code, method = null, operation = null) {
        try {
            const startTime = Date.now();
            
            // Check rate limiting
            if (this.config.security.rateLimiting.enabled) {
                this._checkRateLimit(userId);
            }

            // Check lockout
            if (this._isLockedOut(userId)) {
                throw new Error('Account temporarily locked due to failed attempts');
            }

            // Get user settings
            const userSettings = this._getUserSettings(userId);
            
            if (!userSettings.enabled) {
                throw new Error('2FA not enabled for this user');
            }

            // Determine method if not specified
            if (!method) {
                method = userSettings.primaryMethod;
            }

            // Verify the method is enabled
            if (!userSettings.methods[method]?.enabled) {
                throw new Error(`2FA method ${method} not enabled for this user`);
            }

            // Perform verification
            let verified = false;
            
            switch (method) {
                case 'totp':
                    verified = await this._verifyTOTP(
                        userSettings.methods.totp.secret,
                        code
                    );
                    break;
                case 'sms':
                case 'email':
                    verified = await this._verifyCode(userId, code, method);
                    break;
                case 'webauthn':
                    verified = await this._verifyWebAuthnAssertion(
                        userId,
                        code // code is actually the assertion data
                    );
                    break;
                case 'backupCodes':
                    verified = await this._verifyBackupCode(userId, code);
                    break;
            }

            // Update metrics
            this.state.metrics.verificationAttempts++;

            if (verified) {
                // Reset failed attempts
                this.state.failedAttempts.delete(userId);
                this.state.metrics.successfulVerifications++;

                const verificationTime = Date.now() - startTime;

                await this._auditLog('2FA_VERIFICATION_SUCCESS', {
                    userId,
                    method,
                    operation,
                    verificationTime
                });

                this.emit('verificationSuccess', {
                    userId,
                    method,
                    operation
                });

                return {
                    verified: true,
                    method,
                    timestamp: Date.now()
                };
            } else {
                // Increment failed attempts
                this._incrementFailedAttempts(userId);
                this.state.metrics.failedVerifications++;

                await this._auditLog('2FA_VERIFICATION_FAILED', {
                    userId,
                    method,
                    operation
                });

                throw new Error('Invalid verification code');
            }

        } catch (error) {
            console.error('2FA verification failed:', error);
            throw error;
        }
    }

    /**
     * Disable 2FA method
     */
    async disableTwoFactor(userId, method, verificationCode) {
        try {
            // Verify current 2FA first
            await this.verifyTwoFactor(userId, verificationCode);

            const userSettings = this._getUserSettings(userId);
            
            if (!userSettings.methods[method]?.enabled) {
                throw new Error(`${method} is not enabled`);
            }

            // Check if this is the last method
            const enabledMethods = Object.keys(userSettings.methods)
                .filter(m => userSettings.methods[m].enabled);
            
            if (enabledMethods.length === 1 && enabledMethods[0] === method) {
                // Disabling all 2FA
                userSettings.enabled = false;
                userSettings.primaryMethod = null;
            }

            // Disable the method
            userSettings.methods[method] = { enabled: false };
            
            // Update primary method if needed
            if (userSettings.primaryMethod === method) {
                const remainingMethods = Object.keys(userSettings.methods)
                    .filter(m => userSettings.methods[m].enabled);
                userSettings.primaryMethod = remainingMethods[0] || null;
            }

            // Save settings
            await this._saveUserSettings(userId, userSettings);

            // Update metrics
            this.state.metrics.methodsUsage[method]--;
            if (!userSettings.enabled) {
                this.state.metrics.totalEnabled--;
            }

            // Send notification
            if (this.config.notifications.onDisable) {
                await this._sendNotification(userId, '2fa_disabled', { method });
            }

            await this._auditLog('2FA_DISABLED', {
                userId,
                method,
                allDisabled: !userSettings.enabled
            });

            this.emit('twoFactorDisabled', {
                userId,
                method,
                allDisabled: !userSettings.enabled
            });

            return {
                success: true,
                remainingMethods: Object.keys(userSettings.methods)
                    .filter(m => userSettings.methods[m].enabled)
            };

        } catch (error) {
            console.error('Failed to disable 2FA:', error);
            throw error;
        }
    }

    /**
     * Generate recovery codes
     */
    async generateRecoveryCodes(userId, verificationCode) {
        try {
            // Verify current 2FA
            await this.verifyTwoFactor(userId, verificationCode);

            const backupCodes = await this._generateBackupCodes(userId);
            
            // Enable backup codes method
            await this._enableMethod(userId, 'backupCodes', backupCodes);

            return {
                codes: backupCodes.codes,
                generated: Date.now()
            };

        } catch (error) {
            console.error('Failed to generate recovery codes:', error);
            throw error;
        }
    }

    /**
     * Check if operation requires 2FA
     */
    requiresTwoFactor(operation, userId = null) {
        // Check if operation is in enforced list
        if (this.config.security.enforceForOperations.includes(operation)) {
            // If userId provided, check if user has 2FA enabled
            if (userId) {
                const userSettings = this._getUserSettings(userId);
                return userSettings.enabled;
            }
            return true;
        }
        return false;
    }

    /**
     * Get user's 2FA status
     */
    getUserStatus(userId) {
        const userSettings = this._getUserSettings(userId);
        
        return {
            enabled: userSettings.enabled,
            methods: Object.keys(userSettings.methods)
                .filter(m => userSettings.methods[m].enabled),
            primaryMethod: userSettings.primaryMethod,
            backupCodesRemaining: userSettings.methods.backupCodes?.codes?.length || 0,
            lastVerification: userSettings.lastVerification
        };
    }

    // ========== PRIVATE METHODS ==========

    async _initializeProviders() {
        // Initialize SMS provider
        if (this.config.methods.sms.enabled) {
            // Would initialize Twilio or other SMS provider
        }

        // Initialize email provider
        if (this.config.methods.email.enabled) {
            // Would initialize SendGrid or other email provider
        }
    }

    async _initializeStorage() {
        // Initialize storage adapter based on config
        switch (this.config.storage.type) {
            case 'memory':
                // Already using in-memory maps
                break;
            case 'redis':
                // Would initialize Redis adapter
                break;
            case 'database':
                // Would initialize database adapter
                break;
        }
    }

    async _loadUserSettings() {
        // Load existing user settings from storage
        // For now, using in-memory storage
    }

    async _startCleanupTasks() {
        // Clean up expired data
        setInterval(() => {
            const now = Date.now();
            
            // Clean expired setups
            for (const [setupId, setup] of this.state.pendingSetups.entries()) {
                if (now > setup.expiresAt) {
                    this.state.pendingSetups.delete(setupId);
                }
            }
            
            // Clean expired verification codes
            for (const [userId, codes] of this.state.verificationCodes.entries()) {
                const validCodes = codes.filter(c => now < c.expiresAt);
                if (validCodes.length === 0) {
                    this.state.verificationCodes.delete(userId);
                } else {
                    this.state.verificationCodes.set(userId, validCodes);
                }
            }
            
            // Clean old rate limit data
            for (const [userId, data] of this.state.rateLimitMap.entries()) {
                if (now > data.resetTime) {
                    this.state.rateLimitMap.delete(userId);
                }
            }
        }, 60000); // Every minute
    }

    _getUserSettings(userId) {
        if (!this.state.userSettings.has(userId)) {
            this.state.userSettings.set(userId, {
                enabled: false,
                primaryMethod: null,
                methods: {
                    totp: { enabled: false },
                    sms: { enabled: false },
                    email: { enabled: false },
                    webauthn: { enabled: false },
                    backupCodes: { enabled: false }
                },
                createdAt: Date.now(),
                lastVerification: null
            });
        }
        
        return this.state.userSettings.get(userId);
    }

    async _saveUserSettings(userId, settings) {
        this.state.userSettings.set(userId, settings);
        
        // Would persist to storage adapter
        if (this.storageAdapter) {
            await this.storageAdapter.save(`user:${userId}:2fa`, settings);
        }
    }

    async _setupTOTP(userId, options) {
        const secret = speakeasy.generateSecret({
            name: `${this.config.methods.totp.issuer} (${options.email || userId})`,
            issuer: this.config.methods.totp.issuer,
            length: 32
        });

        const otpauth = speakeasy.otpauthURL({
            secret: secret.base32,
            label: options.email || userId,
            issuer: this.config.methods.totp.issuer,
            algorithm: this.config.methods.totp.algorithm,
            digits: this.config.methods.totp.digits,
            period: this.config.methods.totp.period
        });

        const qrCode = await QRCode.toDataURL(otpauth, {
            width: this.config.methods.totp.qrCodeSize
        });

        return {
            secret: secret.base32,
            qrCode,
            manualEntry: secret.base32
        };
    }

    async _setupSMS(userId, options) {
        if (!options.phoneNumber) {
            throw new Error('Phone number required for SMS 2FA');
        }

        // Generate and send verification code
        const code = this._generateVerificationCode(this.config.methods.sms.codeLength);
        await this._sendSMSCode(options.phoneNumber, code);

        // Store code for verification
        this._storeVerificationCode(userId, code, 'sms');

        return {
            phoneNumber: this._maskPhoneNumber(options.phoneNumber),
            codeSent: true
        };
    }

    async _setupEmail(userId, options) {
        if (!options.email) {
            throw new Error('Email address required for email 2FA');
        }

        // Generate and send verification code
        const code = this._generateVerificationCode(this.config.methods.email.codeLength);
        await this._sendEmailCode(options.email, code);

        // Store code for verification
        this._storeVerificationCode(userId, code, 'email');

        return {
            email: this._maskEmail(options.email),
            codeSent: true
        };
    }

    async _setupWebAuthn(userId, options) {
        // WebAuthn setup would return challenge for registration
        return {
            challenge: crypto.randomBytes(32).toString('base64'),
            rp: {
                name: this.config.methods.webauthn.rpName,
                id: this.config.methods.webauthn.rpId
            },
            user: {
                id: userId,
                name: options.username || userId,
                displayName: options.displayName || options.username || userId
            },
            attestation: this.config.methods.webauthn.attestation,
            authenticatorSelection: {
                userVerification: this.config.methods.webauthn.userVerification
            }
        };
    }

    async _generateBackupCodes(userId) {
        const codes = [];
        const count = this.config.methods.backupCodes.count;
        const length = this.config.methods.backupCodes.length;
        
        for (let i = 0; i < count; i++) {
            const code = this.config.methods.backupCodes.format === 'numeric'
                ? this._generateNumericCode(length)
                : this._generateAlphanumericCode(length);
            
            codes.push({
                code,
                used: false,
                createdAt: Date.now()
            });
        }

        return { codes: codes.map(c => c.code), rawCodes: codes };
    }

    async _enableMethod(userId, method, setupData) {
        const userSettings = this._getUserSettings(userId);
        
        userSettings.enabled = true;
        userSettings.methods[method] = {
            enabled: true,
            ...setupData,
            enabledAt: Date.now()
        };

        // Set as primary if first method
        if (!userSettings.primaryMethod) {
            userSettings.primaryMethod = method;
        }

        await this._saveUserSettings(userId, userSettings);
    }

    async _verifyTOTP(secret, code) {
        return speakeasy.totp.verify({
            secret,
            encoding: 'base32',
            token: code,
            algorithm: this.config.methods.totp.algorithm,
            digits: this.config.methods.totp.digits,
            period: this.config.methods.totp.period,
            window: this.config.methods.totp.window
        });
    }

    async _verifyCode(userId, code, method) {
        const codes = this.state.verificationCodes.get(userId) || [];
        const validCode = codes.find(c => 
            c.code === code && 
            c.method === method && 
            Date.now() < c.expiresAt
        );

        if (validCode) {
            // Remove used code
            this.state.verificationCodes.set(
                userId,
                codes.filter(c => c !== validCode)
            );
            return true;
        }

        return false;
    }

    async _verifyWebAuthnRegistration(setupData, verificationData) {
        // WebAuthn verification would validate the registration response
        // For now, simple validation
        return verificationData.challenge === setupData.challenge;
    }

    async _verifyWebAuthnAssertion(userId, assertionData) {
        // WebAuthn assertion verification
        return true; // Placeholder
    }

    async _verifyBackupCode(userId, code) {
        const userSettings = this._getUserSettings(userId);
        const backupCodes = userSettings.methods.backupCodes?.rawCodes || [];
        
        const validCode = backupCodes.find(c => c.code === code && !c.used);
        
        if (validCode) {
            validCode.used = true;
            validCode.usedAt = Date.now();
            await this._saveUserSettings(userId, userSettings);
            return true;
        }

        return false;
    }

    _generateVerificationCode(length) {
        const format = this.config.methods.backupCodes.format;
        return format === 'numeric'
            ? this._generateNumericCode(length)
            : this._generateAlphanumericCode(length);
    }

    _generateNumericCode(length) {
        let code = '';
        for (let i = 0; i < length; i++) {
            code += Math.floor(Math.random() * 10);
        }
        return code;
    }

    _generateAlphanumericCode(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < length; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    _storeVerificationCode(userId, code, method) {
        if (!this.state.verificationCodes.has(userId)) {
            this.state.verificationCodes.set(userId, []);
        }

        const codes = this.state.verificationCodes.get(userId);
        codes.push({
            code,
            method,
            createdAt: Date.now(),
            expiresAt: Date.now() + this.config.methods[method].codeExpiry
        });
    }

    async _sendSMSCode(phoneNumber, code) {
        if (!this.providers.sms) {
            console.log(`SMS Code for ${phoneNumber}: ${code}`);
            return;
        }

        // Send via SMS provider
        const message = this.config.methods.sms.messageTemplate.replace('{code}', code);
        await this.providers.sms.send(phoneNumber, message);
    }

    async _sendEmailCode(email, code) {
        if (!this.providers.email) {
            console.log(`Email Code for ${email}: ${code}`);
            return;
        }

        // Send via email provider
        await this.providers.email.send({
            to: email,
            subject: this.config.methods.email.subject,
            text: `Your verification code is: ${code}`,
            html: this.config.methods.email.template?.replace('{code}', code)
        });
    }

    _maskPhoneNumber(phoneNumber) {
        return phoneNumber.replace(/(\d{3})\d+(\d{2})/, '$1****$2');
    }

    _maskEmail(email) {
        const [local, domain] = email.split('@');
        const maskedLocal = local.substring(0, 3) + '***';
        return `${maskedLocal}@${domain}`;
    }

    _checkRateLimit(userId) {
        const now = Date.now();
        const windowStart = now - this.config.security.rateLimiting.windowMs;
        
        let userLimits = this.state.rateLimitMap.get(userId);
        
        if (!userLimits) {
            userLimits = { verifications: [], resetTime: now + this.config.security.rateLimiting.windowMs };
            this.state.rateLimitMap.set(userId, userLimits);
        }

        // Clean old verifications
        userLimits.verifications = userLimits.verifications.filter(time => time > windowStart);

        // Check limit
        if (userLimits.verifications.length >= this.config.security.rateLimiting.maxVerifications) {
            throw new Error('Rate limit exceeded for 2FA verifications');
        }

        // Add current verification
        userLimits.verifications.push(now);
    }

    _isLockedOut(userId) {
        const attempts = this.state.failedAttempts.get(userId);
        if (!attempts) return false;

        if (attempts.count >= this.config.security.maxAttempts) {
            if (Date.now() < attempts.lockedUntil) {
                return true;
            }
            // Reset after lockout expires
            this.state.failedAttempts.delete(userId);
        }

        return false;
    }

    _incrementFailedAttempts(userId) {
        let attempts = this.state.failedAttempts.get(userId);
        
        if (!attempts) {
            attempts = { count: 0, lockedUntil: 0 };
            this.state.failedAttempts.set(userId, attempts);
        }

        attempts.count++;

        if (attempts.count >= this.config.security.maxAttempts) {
            attempts.lockedUntil = Date.now() + this.config.security.lockoutDuration;
            this.state.metrics.lockouts++;
            
            // Send notification
            if (this.config.notifications.onFailedAttempts && 
                attempts.count === this.config.security.maxAttempts) {
                this._sendNotification(userId, 'account_locked', {
                    reason: 'failed_2fa_attempts',
                    until: new Date(attempts.lockedUntil).toISOString()
                });
            }
        } else if (this.config.notifications.onFailedAttempts && 
                   attempts.count >= this.config.notifications.failedAttemptsThreshold) {
            this._sendNotification(userId, 'failed_attempts_warning', {
                attempts: attempts.count,
                remaining: this.config.security.maxAttempts - attempts.count
            });
        }
    }

    async _sendNotification(userId, type, data) {
        this.emit('notification', {
            userId,
            type,
            data,
            timestamp: Date.now()
        });
    }

    async _auditLog(action, details) {
        if (!this.config.auditLogging) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'TwoFactorAuthManager'
        };

        this.emit('auditLog', logEntry);
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            pendingSetups: this.state.pendingSetups.size,
            activeUsers: this.state.userSettings.size,
            lockedAccounts: Array.from(this.state.failedAttempts.values())
                .filter(a => Date.now() < a.lockedUntil).length,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.state.userSettings.clear();
        this.state.pendingSetups.clear();
        this.state.verificationCodes.clear();
        this.state.failedAttempts.clear();
        this.state.rateLimitMap.clear();
        
        console.log('Two-Factor Auth Manager cleaned up');
    }
}

module.exports = { TwoFactorAuthManager };