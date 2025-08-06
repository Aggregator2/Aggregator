/**
 * @title Two-Factor Authentication System
 * @author DEX Security Team
 * @notice Comprehensive 2FA system with TOTP, backup codes, and hardware key support
 * @dev Implements enterprise-grade 2FA with multiple methods and security monitoring
 */

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

class TwoFactorAuthentication {
    constructor(config) {
        this.config = {
            serviceName: config.serviceName || 'DEX Platform',
            issuer: config.issuer || 'DEX',
            secretLength: config.secretLength || 32,
            window: config.window || 2, // Allow 2 time windows for clock drift
            backupCodeLength: config.backupCodeLength || 8,
            backupCodeCount: config.backupCodeCount || 10,
            maxAttempts: config.maxAttempts || 3,
            attemptWindow: config.attemptWindow || 300000, // 5 minutes
            enableHardwareKeys: config.enableHardwareKeys || false,
            enableSMS: config.enableSMS || false,
            enableEmail: config.enableEmail || false,
            ...config
        };

        // 2FA storage (in production, use database)
        this.userSecrets = new Map(); // userId -> 2FA data
        this.attemptTracking = new Map(); // userId -> attempt data
        this.backupCodes = new Map(); // userId -> backup codes
        this.hardwareKeys = new Map(); // userId -> hardware key data

        // Security and monitoring
        this.securityMonitor = new TwoFactorSecurityMonitor(config);
        this.notificationService = new TwoFactorNotificationService(config);

        // Method handlers
        this.totpHandler = new TOTPHandler(config);
        this.backupCodeHandler = new BackupCodeHandler(config);
        this.hardwareKeyHandler = new HardwareKeyHandler(config);
        this.smsHandler = config.enableSMS ? new SMSHandler(config) : null;
        this.emailHandler = config.enableEmail ? new EmailHandler(config) : null;

        this._startBackgroundTasks();
    }

    /**
     * Generate 2FA secret for user
     * @param {string} userId User ID
     * @param {string} userEmail User email
     * @returns {Promise<Object>} 2FA setup data
     */
    async generateSecret(userId, userEmail) {
        try {
            // Check if user already has 2FA enabled
            const existingSecret = this.userSecrets.get(userId);
            if (existingSecret && existingSecret.verified) {
                throw new TwoFactorError('2FA already enabled for this user');
            }

            // Generate secret
            const secret = speakeasy.generateSecret({
                name: `${this.config.serviceName} (${userEmail})`,
                issuer: this.config.issuer,
                length: this.config.secretLength
            });

            // Store temporary secret (not yet verified)
            const secretData = {
                userId,
                secret: secret.base32,
                tempSecret: true,
                verified: false,
                createdAt: Date.now(),
                verificationAttempts: 0,
                backupCodes: null,
                methods: {
                    totp: { enabled: false, secret: secret.base32 },
                    backupCodes: { enabled: false, codes: [] },
                    sms: { enabled: false, phoneNumber: null },
                    email: { enabled: false, emailAddress: userEmail },
                    hardwareKey: { enabled: false, keys: [] }
                }
            };

            this.userSecrets.set(userId, secretData);

            // Generate QR code
            const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

            await this.securityMonitor.log2FASecretGenerated({
                userId,
                userEmail,
                timestamp: Date.now()
            });

            return {
                secret: secret.base32,
                qrCode: qrCodeUrl,
                manualEntryKey: secret.base32,
                backupUrl: secret.otpauth_url
            };

        } catch (error) {
            await this.securityMonitor.log2FAError({
                action: 'generate_secret',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Verify and enable 2FA
     * @param {string} userId User ID
     * @param {string} token TOTP token
     * @param {Object} options Verification options
     * @returns {Promise<Object>} Verification result with backup codes
     */
    async verifyAndEnable(userId, token, options = {}) {
        try {
            const secretData = this.userSecrets.get(userId);
            if (!secretData || !secretData.tempSecret) {
                throw new TwoFactorError('No pending 2FA setup found');
            }

            // Verify TOTP token
            const isValid = this.totpHandler.verify(secretData.secret, token, {
                window: this.config.window
            });

            if (!isValid) {
                secretData.verificationAttempts++;
                
                if (secretData.verificationAttempts >= this.config.maxAttempts) {
                    this.userSecrets.delete(userId);
                    throw new TwoFactorError('Too many verification attempts. Please start over.');
                }
                
                throw new TwoFactorError('Invalid verification code');
            }

            // Generate backup codes
            const backupCodes = this._generateBackupCodes();
            const hashedBackupCodes = await Promise.all(
                backupCodes.map(code => bcrypt.hash(code, 10))
            );

            // Enable 2FA
            secretData.verified = true;
            secretData.tempSecret = false;
            secretData.enabledAt = Date.now();
            secretData.methods.totp.enabled = true;
            secretData.methods.backupCodes.enabled = true;
            secretData.methods.backupCodes.codes = hashedBackupCodes;

            // Store backup codes separately for easier access
            this.backupCodes.set(userId, {
                codes: hashedBackupCodes,
                usedCodes: new Set(),
                createdAt: Date.now()
            });

            await this.securityMonitor.log2FAEnabled({
                userId,
                methods: ['totp', 'backup_codes'],
                timestamp: Date.now()
            });

            // Send confirmation notification
            await this.notificationService.send2FAEnabledNotification(userId, {
                methods: ['TOTP', 'Backup Codes']
            });

            return {
                success: true,
                backupCodes,
                enabledMethods: ['totp', 'backup_codes'],
                message: 'Two-factor authentication has been successfully enabled'
            };

        } catch (error) {
            await this.securityMonitor.log2FAError({
                action: 'verify_and_enable',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Verify 2FA token for authentication
     * @param {string} userId User ID
     * @param {string} token 2FA token
     * @param {Object} options Verification options
     * @returns {Promise<Object>} Verification result
     */
    async verifyToken(userId, token, options = {}) {
        try {
            const secretData = this.userSecrets.get(userId);
            if (!secretData || !secretData.verified) {
                throw new TwoFactorError('2FA not enabled for this user');
            }

            // Check rate limiting
            await this._checkAttemptLimits(userId);

            let verificationResult = { valid: false, method: null };

            // Try TOTP first
            if (secretData.methods.totp.enabled) {
                const isValidTOTP = this.totpHandler.verify(
                    secretData.methods.totp.secret, 
                    token, 
                    { window: this.config.window }
                );
                
                if (isValidTOTP) {
                    verificationResult = { valid: true, method: 'totp' };
                }
            }

            // Try backup codes if TOTP failed
            if (!verificationResult.valid && secretData.methods.backupCodes.enabled) {
                const isValidBackup = await this._verifyBackupCode(userId, token);
                if (isValidBackup) {
                    verificationResult = { valid: true, method: 'backup_code' };
                }
            }

            // Try hardware key if available
            if (!verificationResult.valid && secretData.methods.hardwareKey.enabled) {
                const isValidHardware = await this.hardwareKeyHandler.verify(userId, token, options);
                if (isValidHardware) {
                    verificationResult = { valid: true, method: 'hardware_key' };
                }
            }

            if (!verificationResult.valid) {
                await this._recordFailedAttempt(userId);
                throw new TwoFactorError('Invalid 2FA token');
            }

            // Clear failed attempts on success
            this.attemptTracking.delete(userId);

            await this.securityMonitor.log2FAVerified({
                userId,
                method: verificationResult.method,
                timestamp: Date.now(),
                clientIp: options.clientIp,
                userAgent: options.userAgent
            });

            return {
                valid: true,
                method: verificationResult.method,
                verifiedAt: Date.now()
            };

        } catch (error) {
            await this.securityMonitor.log2FAError({
                action: 'verify_token',
                userId,
                error: error.message,
                clientIp: options.clientIp
            });
            throw error;
        }
    }

    /**
     * Disable 2FA for user
     * @param {string} userId User ID
     * @param {string} confirmationToken Current TOTP or backup code
     * @param {Object} options Disable options
     * @returns {Promise<void>}
     */
    async disable2FA(userId, confirmationToken, options = {}) {
        try {
            // Verify current token before disabling
            const verificationResult = await this.verifyToken(userId, confirmationToken, options);
            if (!verificationResult.valid) {
                throw new TwoFactorError('Invalid confirmation token');
            }

            // Remove all 2FA data
            this.userSecrets.delete(userId);
            this.backupCodes.delete(userId);
            this.hardwareKeys.delete(userId);
            this.attemptTracking.delete(userId);

            await this.securityMonitor.log2FADisabled({
                userId,
                disabledBy: options.disabledBy || 'user',
                timestamp: Date.now()
            });

            // Send security notification
            await this.notificationService.send2FADisabledNotification(userId);

        } catch (error) {
            await this.securityMonitor.log2FAError({
                action: 'disable_2fa',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Add SMS as 2FA method
     * @param {string} userId User ID
     * @param {string} phoneNumber Phone number
     * @param {string} confirmationToken Current 2FA token for verification
     * @returns {Promise<Object>} SMS setup result
     */
    async addSMSMethod(userId, phoneNumber, confirmationToken) {
        try {
            if (!this.smsHandler) {
                throw new TwoFactorError('SMS 2FA not enabled');
            }

            // Verify current 2FA token
            await this.verifyToken(userId, confirmationToken);

            const secretData = this.userSecrets.get(userId);
            if (!secretData) {
                throw new TwoFactorError('2FA not enabled');
            }

            // Validate phone number format
            const validatedPhone = this._validatePhoneNumber(phoneNumber);

            // Send verification SMS
            const verificationCode = await this.smsHandler.sendVerificationSMS(validatedPhone);

            // Store pending SMS setup
            secretData.methods.sms.pendingPhone = validatedPhone;
            secretData.methods.sms.verificationCode = verificationCode;
            secretData.methods.sms.verificationExpiry = Date.now() + 300000; // 5 minutes

            return {
                success: true,
                message: 'Verification SMS sent',
                phoneNumber: this._maskPhoneNumber(validatedPhone)
            };

        } catch (error) {
            await this.securityMonitor.log2FAError({
                action: 'add_sms_method',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Verify SMS and enable SMS 2FA
     * @param {string} userId User ID
     * @param {string} verificationCode SMS verification code
     * @returns {Promise<void>}
     */
    async verifySMSMethod(userId, verificationCode) {
        try {
            const secretData = this.userSecrets.get(userId);
            if (!secretData || !secretData.methods.sms.pendingPhone) {
                throw new TwoFactorError('No pending SMS verification');
            }

            const smsData = secretData.methods.sms;
            
            // Check expiry
            if (Date.now() > smsData.verificationExpiry) {
                throw new TwoFactorError('Verification code expired');
            }

            // Verify code
            if (smsData.verificationCode !== verificationCode) {
                throw new TwoFactorError('Invalid verification code');
            }

            // Enable SMS method
            smsData.enabled = true;
            smsData.phoneNumber = smsData.pendingPhone;
            smsData.enabledAt = Date.now();
            
            // Clear pending data
            delete smsData.pendingPhone;
            delete smsData.verificationCode;
            delete smsData.verificationExpiry;

            await this.securityMonitor.log2FAMethodAdded({
                userId,
                method: 'sms',
                timestamp: Date.now()
            });

        } catch (error) {
            await this.securityMonitor.log2FAError({
                action: 'verify_sms_method',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Generate new backup codes
     * @param {string} userId User ID
     * @param {string} confirmationToken Current 2FA token
     * @returns {Promise<Array>} New backup codes
     */
    async regenerateBackupCodes(userId, confirmationToken) {
        try {
            // Verify current token
            await this.verifyToken(userId, confirmationToken);

            const secretData = this.userSecrets.get(userId);
            if (!secretData) {
                throw new TwoFactorError('2FA not enabled');
            }

            // Generate new backup codes
            const newBackupCodes = this._generateBackupCodes();
            const hashedCodes = await Promise.all(
                newBackupCodes.map(code => bcrypt.hash(code, 10))
            );

            // Update stored codes
            secretData.methods.backupCodes.codes = hashedCodes;
            this.backupCodes.set(userId, {
                codes: hashedCodes,
                usedCodes: new Set(),
                createdAt: Date.now()
            });

            await this.securityMonitor.log2FABackupCodesRegenerated({
                userId,
                timestamp: Date.now()
            });

            return newBackupCodes;

        } catch (error) {
            await this.securityMonitor.log2FAError({
                action: 'regenerate_backup_codes',
                userId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get 2FA status for user
     * @param {string} userId User ID
     * @returns {Object} 2FA status
     */
    get2FAStatus(userId) {
        const secretData = this.userSecrets.get(userId);
        
        if (!secretData || !secretData.verified) {
            return {
                enabled: false,
                methods: [],
                setupRequired: false
            };
        }

        const enabledMethods = [];
        const methodDetails = {};

        for (const [methodName, methodData] of Object.entries(secretData.methods)) {
            if (methodData.enabled) {
                enabledMethods.push(methodName);
                methodDetails[methodName] = {
                    enabled: true,
                    enabledAt: methodData.enabledAt
                };

                if (methodName === 'sms' && methodData.phoneNumber) {
                    methodDetails[methodName].phoneNumber = this._maskPhoneNumber(methodData.phoneNumber);
                }
            }
        }

        return {
            enabled: true,
            methods: enabledMethods,
            methodDetails,
            enabledAt: secretData.enabledAt,
            setupRequired: false
        };
    }

    // =============================================================================
    // PRIVATE HELPER METHODS
    // =============================================================================

    /**
     * Generate backup codes
     * @returns {Array} Backup codes
     * @private
     */
    _generateBackupCodes() {
        const codes = [];
        for (let i = 0; i < this.config.backupCodeCount; i++) {
            const code = crypto.randomBytes(this.config.backupCodeLength / 2).toString('hex');
            codes.push(code.toUpperCase());
        }
        return codes;
    }

    /**
     * Verify backup code
     * @param {string} userId User ID
     * @param {string} code Backup code
     * @returns {Promise<boolean>} Verification result
     * @private
     */
    async _verifyBackupCode(userId, code) {
        const backupData = this.backupCodes.get(userId);
        if (!backupData) {
            return false;
        }

        // Check if code was already used
        if (backupData.usedCodes.has(code)) {
            return false;
        }

        // Verify against stored hashed codes
        for (const hashedCode of backupData.codes) {
            const isMatch = await bcrypt.compare(code, hashedCode);
            if (isMatch) {
                // Mark code as used
                backupData.usedCodes.add(code);
                return true;
            }
        }

        return false;
    }

    /**
     * Check rate limiting for 2FA attempts
     * @param {string} userId User ID
     * @private
     */
    async _checkAttemptLimits(userId) {
        const attempts = this.attemptTracking.get(userId);
        if (!attempts) {
            return;
        }

        const now = Date.now();
        const windowStart = now - this.config.attemptWindow;

        // Filter recent attempts
        const recentAttempts = attempts.filter(attempt => attempt.timestamp > windowStart);
        
        if (recentAttempts.length >= this.config.maxAttempts) {
            throw new TwoFactorError('Too many 2FA attempts. Please try again later.');
        }

        // Update attempts list
        this.attemptTracking.set(userId, recentAttempts);
    }

    /**
     * Record failed 2FA attempt
     * @param {string} userId User ID
     * @private
     */
    async _recordFailedAttempt(userId) {
        if (!this.attemptTracking.has(userId)) {
            this.attemptTracking.set(userId, []);
        }

        const attempts = this.attemptTracking.get(userId);
        attempts.push({
            timestamp: Date.now(),
            type: 'failed_verification'
        });

        // Keep only recent attempts
        const windowStart = Date.now() - this.config.attemptWindow;
        this.attemptTracking.set(userId, 
            attempts.filter(attempt => attempt.timestamp > windowStart)
        );
    }

    /**
     * Validate phone number format
     * @param {string} phoneNumber Phone number
     * @returns {string} Validated phone number
     * @private
     */
    _validatePhoneNumber(phoneNumber) {
        // Simple validation (production would use proper phone number library)
        const cleaned = phoneNumber.replace(/\D/g, '');
        if (cleaned.length < 10 || cleaned.length > 15) {
            throw new TwoFactorError('Invalid phone number format');
        }
        return `+${cleaned}`;
    }

    /**
     * Mask phone number for display
     * @param {string} phoneNumber Phone number
     * @returns {string} Masked phone number
     * @private
     */
    _maskPhoneNumber(phoneNumber) {
        if (phoneNumber.length < 4) return phoneNumber;
        const visible = phoneNumber.slice(-4);
        const masked = '*'.repeat(phoneNumber.length - 4);
        return masked + visible;
    }

    /**
     * Start background tasks
     * @private
     */
    _startBackgroundTasks() {
        // Clean up expired verification attempts every 10 minutes
        setInterval(() => {
            this._cleanupExpiredAttempts();
        }, 600000);

        // Security monitoring every 5 minutes
        setInterval(async () => {
            await this.securityMonitor.runSecurityCheck();
        }, 300000);
    }

    /**
     * Clean up expired verification attempts
     * @private
     */
    _cleanupExpiredAttempts() {
        const now = Date.now();
        const windowStart = now - this.config.attemptWindow;

        for (const [userId, attempts] of this.attemptTracking.entries()) {
            const validAttempts = attempts.filter(attempt => attempt.timestamp > windowStart);
            
            if (validAttempts.length === 0) {
                this.attemptTracking.delete(userId);
            } else {
                this.attemptTracking.set(userId, validAttempts);
            }
        }
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get 2FA statistics
     * @returns {Object} 2FA statistics
     */
    get2FAStatistics() {
        const totalUsers = this.userSecrets.size;
        const enabledUsers = Array.from(this.userSecrets.values())
            .filter(data => data.verified).length;
        
        const methodStats = {
            totp: 0,
            sms: 0,
            email: 0,
            hardwareKey: 0,
            backupCodes: 0
        };

        for (const secretData of this.userSecrets.values()) {
            if (secretData.verified) {
                for (const [method, data] of Object.entries(secretData.methods)) {
                    if (data.enabled) {
                        methodStats[method]++;
                    }
                }
            }
        }

        return {
            totalUsers,
            enabledUsers,
            enabledPercentage: totalUsers > 0 ? (enabledUsers / totalUsers * 100).toFixed(2) : 0,
            methodDistribution: methodStats,
            pendingSetups: Array.from(this.userSecrets.values())
                .filter(data => data.tempSecret && !data.verified).length
        };
    }

    /**
     * Check if user has 2FA enabled
     * @param {string} userId User ID
     * @returns {boolean} True if 2FA is enabled
     */
    is2FAEnabled(userId) {
        const secretData = this.userSecrets.get(userId);
        return secretData && secretData.verified;
    }

    /**
     * Get health status
     * @returns {Object} Health status
     */
    getHealthStatus() {
        const stats = this.get2FAStatistics();
        
        return {
            status: 'healthy',
            statistics: stats,
            features: {
                totp: true,
                backupCodes: true,
                sms: this.config.enableSMS,
                email: this.config.enableEmail,
                hardwareKeys: this.config.enableHardwareKeys
            },
            security: {
                maxAttempts: this.config.maxAttempts,
                attemptWindow: this.config.attemptWindow,
                secretLength: this.config.secretLength
            },
            timestamp: Date.now()
        };
    }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

class TOTPHandler {
    constructor(config) {
        this.config = config;
    }

    verify(secret, token, options = {}) {
        return speakeasy.totp.verify({
            secret,
            encoding: 'base32',
            token,
            window: options.window || 2
        });
    }

    generate(secret) {
        return speakeasy.totp({
            secret,
            encoding: 'base32'
        });
    }
}

class BackupCodeHandler {
    constructor(config) {
        this.config = config;
    }

    async verify(storedCodes, usedCodes, providedCode) {
        // Implementation would verify backup codes
        return false;
    }
}

class HardwareKeyHandler {
    constructor(config) {
        this.config = config;
    }

    async verify(userId, token, options) {
        // Implementation would verify hardware key challenges
        return false;
    }
}

class SMSHandler {
    constructor(config) {
        this.config = config;
    }

    async sendVerificationSMS(phoneNumber) {
        // Implementation would send SMS via provider (Twilio, etc.)
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(`SMS verification code for ${phoneNumber}: ${code}`);
        return code;
    }
}

class EmailHandler {
    constructor(config) {
        this.config = config;
    }

    async sendVerificationEmail(email) {
        // Implementation would send email verification
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(`Email verification code for ${email}: ${code}`);
        return code;
    }
}

class TwoFactorSecurityMonitor {
    constructor(config) {
        this.config = config;
    }

    async log2FASecretGenerated(data) {
        console.log('2FA secret generated:', data.userId);
    }

    async log2FAEnabled(data) {
        console.log('2FA enabled:', data.userId);
    }

    async log2FADisabled(data) {
        console.log('2FA disabled:', data.userId);
    }

    async log2FAVerified(data) {
        console.log('2FA verified:', data.userId, 'method:', data.method);
    }

    async log2FAMethodAdded(data) {
        console.log('2FA method added:', data.userId, 'method:', data.method);
    }

    async log2FABackupCodesRegenerated(data) {
        console.log('2FA backup codes regenerated:', data.userId);
    }

    async log2FAError(data) {
        console.error('2FA error:', data);
    }

    async runSecurityCheck() {
        console.log('Running 2FA security check');
    }
}

class TwoFactorNotificationService {
    constructor(config) {
        this.config = config;
    }

    async send2FAEnabledNotification(userId, data) {
        console.log(`2FA enabled notification sent to user ${userId}`);
    }

    async send2FADisabledNotification(userId) {
        console.log(`2FA disabled notification sent to user ${userId}`);
    }
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

class TwoFactorError extends Error {
    constructor(message, code = 'TWO_FACTOR_ERROR') {
        super(message);
        this.name = 'TwoFactorError';
        this.code = code;
    }
}

module.exports = {
    TwoFactorAuthentication,
    TOTPHandler,
    BackupCodeHandler,
    HardwareKeyHandler,
    SMSHandler,
    EmailHandler,
    TwoFactorSecurityMonitor,
    TwoFactorNotificationService,
    TwoFactorError
};