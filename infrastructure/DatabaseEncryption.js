/**
 * @fileoverview Database Encryption at Rest for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Field-level encryption with multiple key management providers
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * Comprehensive Database Encryption System
 */
class DatabaseEncryption extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Encryption settings
            encryption: {
                algorithm: config.encryption?.algorithm || 'aes-256-gcm',
                keySize: config.encryption?.keySize || 32, // 256 bits
                ivSize: config.encryption?.ivSize || 16,
                tagSize: config.encryption?.tagSize || 16,
                keyDerivation: config.encryption?.keyDerivation || 'pbkdf2',
                iterations: config.encryption?.iterations || 100000,
                ...config.encryption
            },
            
            // Key management
            keyManagement: {
                provider: config.keyManagement?.provider || 'local', // local, aws, vault
                rotationInterval: config.keyManagement?.rotationInterval || 86400000, // 24 hours
                keyVersions: config.keyManagement?.keyVersions || 5,
                autoRotation: config.keyManagement?.autoRotation !== false,
                ...config.keyManagement
            },
            
            // Field configuration
            fields: {
                encrypted: config.fields?.encrypted || [
                    'privateKey', 'mnemonic', 'password', 'email', 
                    'phone', 'address', 'taxId', 'bankAccount'
                ],
                searchable: config.fields?.searchable || ['email', 'phone'],
                sensitive: config.fields?.sensitive || ['privateKey', 'mnemonic', 'password'],
                ...config.fields
            },
            
            // Performance settings
            performance: {
                cacheEnabled: config.performance?.cacheEnabled !== false,
                cacheTTL: config.performance?.cacheTTL || 300000, // 5 minutes
                batchSize: config.performance?.batchSize || 100,
                connectionPoolSize: config.performance?.connectionPoolSize || 10,
                ...config.performance
            },
            
            // Compliance settings
            compliance: {
                auditLogging: config.compliance?.auditLogging !== false,
                keyEscrow: config.compliance?.keyEscrow || false,
                dataResidency: config.compliance?.dataResidency || 'global',
                retentionPeriod: config.compliance?.retentionPeriod || 2555200000, // 30 days
                ...config.compliance
            },
            
            auditLogging: config.auditLogging !== false,
            ...config
        };

        this.state = {
            initialized: false,
            keyCache: new Map(),
            encryptionStats: {
                fieldsEncrypted: 0,
                fieldsDecrypted: 0,
                keysRotated: 0,
                errors: 0
            },
            activeKeys: new Map(),
            rotationSchedule: new Map()
        };

        this.keyManager = null;
        this.auditLogger = null;
    }

    /**
     * Initialize database encryption system
     */
    async initialize() {
        try {
            await this._initializeKeyManager();
            await this._initializeAuditLogging();
            await this._loadActiveKeys();
            await this._scheduleKeyRotation();
            
            this.state.initialized = true;
            console.log('Database Encryption System initialized');
            
            this.emit('initialized', {
                provider: this.config.keyManagement.provider,
                fieldsConfigured: this.config.fields.encrypted.length
            });
            
        } catch (error) {
            console.error('Failed to initialize Database Encryption:', error);
            throw error;
        }
    }

    /**
     * Encrypt a field value
     * @param {string} fieldName Field identifier
     * @param {any} data Data to encrypt
     * @param {Object} options Encryption options
     * @returns {Object} Encrypted data with metadata
     */
    async encryptField(fieldName, data, options = {}) {
        try {
            if (!this.state.initialized) {
                throw new Error('Database encryption not initialized');
            }

            if (!this._shouldEncryptField(fieldName)) {
                return { encrypted: false, data };
            }

            // Get encryption key
            const keyInfo = await this._getEncryptionKey(fieldName, options.keyVersion);
            
            // Prepare data for encryption
            const serializedData = this._serializeData(data);
            
            // Generate IV
            const iv = crypto.randomBytes(this.config.encryption.ivSize);
            
            // Encrypt data
            const cipher = crypto.createCipher(this.config.encryption.algorithm, keyInfo.key);
            cipher.setAutoPadding(true);
            
            let encrypted = cipher.update(serializedData, 'utf8', 'base64');
            encrypted += cipher.final('base64');
            
            // Get authentication tag for GCM mode
            const authTag = cipher.getAuthTag ? cipher.getAuthTag() : null;
            
            // Create searchable hash if needed
            const searchableHash = this._isSearchableField(fieldName) 
                ? this._createSearchableHash(serializedData, keyInfo.key)
                : null;

            const result = {
                encrypted: true,
                data: encrypted,
                iv: iv.toString('base64'),
                keyId: keyInfo.id,
                keyVersion: keyInfo.version,
                algorithm: this.config.encryption.algorithm,
                timestamp: new Date().toISOString(),
                searchableHash,
                authTag: authTag ? authTag.toString('base64') : null
            };

            // Update statistics
            this.state.encryptionStats.fieldsEncrypted++;
            
            // Audit log
            await this._auditLog('FIELD_ENCRYPTED', {
                fieldName,
                keyId: keyInfo.id,
                algorithm: this.config.encryption.algorithm,
                dataSize: serializedData.length
            });

            return result;

        } catch (error) {
            this.state.encryptionStats.errors++;
            console.error('Field encryption failed:', error);
            throw error;
        }
    }

    /**
     * Decrypt a field value
     * @param {string} fieldName Field identifier
     * @param {Object} encryptedData Encrypted data object
     * @param {Object} options Decryption options
     * @returns {any} Decrypted data
     */
    async decryptField(fieldName, encryptedData, options = {}) {
        try {
            if (!encryptedData.encrypted) {
                return encryptedData.data;
            }

            // Get decryption key
            const keyInfo = await this._getDecryptionKey(
                encryptedData.keyId, 
                encryptedData.keyVersion
            );
            
            // Prepare for decryption
            const iv = Buffer.from(encryptedData.iv, 'base64');
            const authTag = encryptedData.authTag 
                ? Buffer.from(encryptedData.authTag, 'base64') 
                : null;

            // Decrypt data
            const decipher = crypto.createDecipher(
                encryptedData.algorithm, 
                keyInfo.key
            );
            
            if (authTag) {
                decipher.setAuthTag(authTag);
            }
            
            let decrypted = decipher.update(encryptedData.data, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            
            // Deserialize data
            const result = this._deserializeData(decrypted);
            
            // Update statistics
            this.state.encryptionStats.fieldsDecrypted++;
            
            // Audit log for sensitive fields
            if (this._isSensitiveField(fieldName)) {
                await this._auditLog('SENSITIVE_FIELD_ACCESSED', {
                    fieldName,
                    keyId: encryptedData.keyId,
                    accessContext: options.context || 'unknown'
                });
            }

            return result;

        } catch (error) {
            this.state.encryptionStats.errors++;
            console.error('Field decryption failed:', error);
            throw error;
        }
    }

    /**
     * Search encrypted fields using searchable hashes
     * @param {string} fieldName Field to search
     * @param {any} searchValue Value to search for
     * @returns {string} Searchable hash for database query
     */
    async createSearchableHash(fieldName, searchValue) {
        if (!this._isSearchableField(fieldName)) {
            throw new Error(`Field ${fieldName} is not configured as searchable`);
        }

        const keyInfo = await this._getEncryptionKey(fieldName);
        const serializedValue = this._serializeData(searchValue);
        
        return this._createSearchableHash(serializedValue, keyInfo.key);
    }

    /**
     * Batch encrypt multiple fields
     * @param {Object} data Object with field names as keys
     * @param {Object} options Batch options
     * @returns {Object} Object with encrypted fields
     */
    async encryptBatch(data, options = {}) {
        const result = {};
        const errors = [];
        
        for (const [fieldName, value] of Object.entries(data)) {
            try {
                result[fieldName] = await this.encryptField(fieldName, value, options);
            } catch (error) {
                errors.push({ fieldName, error: error.message });
                if (!options.continueOnError) {
                    throw error;
                }
            }
        }

        return {
            data: result,
            errors: errors.length > 0 ? errors : null
        };
    }

    /**
     * Batch decrypt multiple fields
     * @param {Object} encryptedData Object with encrypted field data
     * @param {Object} options Batch options
     * @returns {Object} Object with decrypted fields
     */
    async decryptBatch(encryptedData, options = {}) {
        const result = {};
        const errors = [];
        
        for (const [fieldName, encryptedValue] of Object.entries(encryptedData)) {
            try {
                result[fieldName] = await this.decryptField(fieldName, encryptedValue, options);
            } catch (error) {
                errors.push({ fieldName, error: error.message });
                if (!options.continueOnError) {
                    throw error;
                }
            }
        }

        return {
            data: result,
            errors: errors.length > 0 ? errors : null
        };
    }

    /**
     * Rotate encryption keys
     * @param {string} fieldName Optional specific field
     * @returns {Object} Rotation results
     */
    async rotateKeys(fieldName = null) {
        try {
            const fieldsToRotate = fieldName 
                ? [fieldName] 
                : this.config.fields.encrypted;

            const results = [];
            
            for (const field of fieldsToRotate) {
                const oldKeyInfo = await this._getEncryptionKey(field);
                const newKeyInfo = await this.keyManager.generateKey(field);
                
                // Update active key
                this.state.activeKeys.set(field, newKeyInfo);
                
                results.push({
                    fieldName: field,
                    oldKeyId: oldKeyInfo.id,
                    newKeyId: newKeyInfo.id,
                    rotatedAt: new Date().toISOString()
                });
                
                this.state.encryptionStats.keysRotated++;
            }

            await this._auditLog('KEYS_ROTATED', {
                fieldsRotated: results.length,
                rotationResults: results
            });

            this.emit('keysRotated', { results });
            
            return { success: true, results };

        } catch (error) {
            console.error('Key rotation failed:', error);
            throw error;
        }
    }

    // ========== PRIVATE METHODS ==========

    async _initializeKeyManager() {
        const provider = this.config.keyManagement.provider;
        
        switch (provider) {
            case 'aws':
                this.keyManager = new AWSKeyManager(this.config.keyManagement);
                break;
            case 'vault':
                this.keyManager = new VaultKeyManager(this.config.keyManagement);
                break;
            case 'local':
            default:
                this.keyManager = new LocalKeyManager(this.config.keyManagement);
                break;
        }
        
        await this.keyManager.initialize();
    }

    async _loadActiveKeys() {
        for (const fieldName of this.config.fields.encrypted) {
            try {
                const keyInfo = await this.keyManager.getLatestKey(fieldName);
                this.state.activeKeys.set(fieldName, keyInfo);
            } catch (error) {
                // Generate new key if none exists
                const newKeyInfo = await this.keyManager.generateKey(fieldName);
                this.state.activeKeys.set(fieldName, newKeyInfo);
            }
        }
    }

    async _scheduleKeyRotation() {
        if (!this.config.keyManagement.autoRotation) return;
        
        const rotationInterval = this.config.keyManagement.rotationInterval;
        
        setInterval(async () => {
            try {
                await this.rotateKeys();
            } catch (error) {
                console.error('Scheduled key rotation failed:', error);
            }
        }, rotationInterval);
    }

    async _getEncryptionKey(fieldName, keyVersion = null) {
        const cacheKey = `${fieldName}:${keyVersion || 'latest'}`;
        
        if (this.config.performance.cacheEnabled && this.state.keyCache.has(cacheKey)) {
            const cached = this.state.keyCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.config.performance.cacheTTL) {
                return cached.keyInfo;
            }
        }

        const keyInfo = keyVersion 
            ? await this.keyManager.getKey(fieldName, keyVersion)
            : await this.keyManager.getLatestKey(fieldName);

        if (this.config.performance.cacheEnabled) {
            this.state.keyCache.set(cacheKey, {
                keyInfo,
                timestamp: Date.now()
            });
        }

        return keyInfo;
    }

    async _getDecryptionKey(keyId, keyVersion) {
        return await this.keyManager.getKey(keyId, keyVersion);
    }

    _shouldEncryptField(fieldName) {
        return this.config.fields.encrypted.includes(fieldName);
    }

    _isSearchableField(fieldName) {
        return this.config.fields.searchable.includes(fieldName);
    }

    _isSensitiveField(fieldName) {
        return this.config.fields.sensitive.includes(fieldName);
    }

    _serializeData(data) {
        if (typeof data === 'string') return data;
        return JSON.stringify(data);
    }

    _deserializeData(data) {
        try {
            return JSON.parse(data);
        } catch {
            return data; // Return as string if not JSON
        }
    }

    _createSearchableHash(data, key) {
        // Create deterministic hash for equality searches
        const hmac = crypto.createHmac('sha256', key);
        hmac.update(data);
        return hmac.digest('hex');
    }

    async _initializeAuditLogging() {
        if (!this.config.auditLogging) return;

        const winston = require('winston');
        
        this.auditLogger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({
                    filename: '/var/log/swappiq/database-encryption.log',
                    maxsize: 100 * 1024 * 1024,
                    maxFiles: 10
                })
            ]
        });
    }

    async _auditLog(action, details) {
        if (!this.auditLogger) return;

        this.auditLogger.info('DB_ENCRYPTION_AUDIT', {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'DatabaseEncryption'
        });
    }

    /**
     * Get encryption statistics
     */
    getStats() {
        return {
            ...this.state.encryptionStats,
            activeKeys: this.state.activeKeys.size,
            cachedKeys: this.state.keyCache.size,
            fieldsConfigured: this.config.fields.encrypted.length,
            provider: this.config.keyManagement.provider
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        if (this.keyManager) {
            await this.keyManager.cleanup();
        }
        
        this.state.keyCache.clear();
        this.state.activeKeys.clear();
        
        console.log('Database Encryption System cleaned up');
    }
}

// ========== KEY MANAGER IMPLEMENTATIONS ==========

class LocalKeyManager {
    constructor(config) {
        this.config = config;
        this.keys = new Map();
        this.keyVersions = new Map();
    }

    async initialize() {
        console.log('Local Key Manager initialized');
    }

    async generateKey(fieldName) {
        const keyId = crypto.randomBytes(16).toString('hex');
        const key = crypto.randomBytes(32); // 256-bit key
        const version = this._getNextVersion(fieldName);
        
        const keyInfo = {
            id: keyId,
            key: key,
            fieldName,
            version,
            createdAt: new Date().toISOString(),
            algorithm: 'aes-256-gcm'
        };

        this.keys.set(`${fieldName}:${version}`, keyInfo);
        this._updateLatestVersion(fieldName, version);
        
        return keyInfo;
    }

    async getKey(fieldName, version) {
        const key = this.keys.get(`${fieldName}:${version}`);
        if (!key) {
            throw new Error(`Key not found: ${fieldName}:${version}`);
        }
        return key;
    }

    async getLatestKey(fieldName) {
        const latestVersion = this.keyVersions.get(fieldName) || 1;
        return await this.getKey(fieldName, latestVersion);
    }

    _getNextVersion(fieldName) {
        const currentVersion = this.keyVersions.get(fieldName) || 0;
        return currentVersion + 1;
    }

    _updateLatestVersion(fieldName, version) {
        this.keyVersions.set(fieldName, version);
    }

    async cleanup() {
        this.keys.clear();
        this.keyVersions.clear();
    }
}

class AWSKeyManager {
    constructor(config) {
        this.config = config;
        this.kms = null;
    }

    async initialize() {
        const AWS = require('aws-sdk');
        this.kms = new AWS.KMS({
            region: this.config.region || 'us-east-1'
        });
        console.log('AWS Key Manager initialized');
    }

    async generateKey(fieldName) {
        const params = {
            Description: `Encryption key for field: ${fieldName}`,
            KeyUsage: 'ENCRYPT_DECRYPT',
            KeySpec: 'SYMMETRIC_DEFAULT'
        };

        const result = await this.kms.createKey(params).promise();
        
        return {
            id: result.KeyMetadata.KeyId,
            arn: result.KeyMetadata.Arn,
            fieldName,
            version: 1,
            createdAt: result.KeyMetadata.CreationDate.toISOString(),
            algorithm: 'aes-256-gcm'
        };
    }

    async getKey(keyId, version) {
        const params = { KeyId: keyId };
        const result = await this.kms.describeKey(params).promise();
        
        return {
            id: result.KeyMetadata.KeyId,
            arn: result.KeyMetadata.Arn,
            version,
            algorithm: 'aes-256-gcm'
        };
    }

    async getLatestKey(fieldName) {
        // Implementation would query AWS KMS for latest key
        throw new Error('AWS KMS integration requires additional implementation');
    }

    async cleanup() {
        // Cleanup AWS resources if needed
    }
}

class VaultKeyManager {
    constructor(config) {
        this.config = config;
        this.vault = null;
    }

    async initialize() {
        const vault = require('node-vault');
        this.vault = vault({
            endpoint: this.config.endpoint,
            token: this.config.token
        });
        console.log('Vault Key Manager initialized');
    }

    async generateKey(fieldName) {
        const keyData = {
            type: 'aes256-gcm96',
            exportable: false
        };

        const result = await this.vault.write(
            `transit/keys/${fieldName}`,
            keyData
        );

        return {
            id: fieldName,
            fieldName,
            version: 1,
            createdAt: new Date().toISOString(),
            algorithm: 'aes-256-gcm',
            vaultPath: `transit/keys/${fieldName}`
        };
    }

    async getKey(fieldName, version) {
        const result = await this.vault.read(`transit/keys/${fieldName}`);
        
        return {
            id: fieldName,
            fieldName,
            version,
            algorithm: 'aes-256-gcm',
            vaultPath: `transit/keys/${fieldName}`,
            keyInfo: result.data
        };
    }

    async getLatestKey(fieldName) {
        return await this.getKey(fieldName, 1);
    }

    async cleanup() {
        // Cleanup Vault connections if needed
    }
}

module.exports = { 
    DatabaseEncryption, 
    LocalKeyManager, 
    AWSKeyManager, 
    VaultKeyManager 
};