/**
 * @fileoverview Secrets Management System for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Secure secrets management using Vault, AWS KMS, and Azure Key Vault
 */

const AWS = require('aws-sdk');
const axios = require('axios');
const crypto = require('crypto');

/**
 * Universal Secrets Manager supporting multiple backends
 */
class SecretsManager {
    constructor(config) {
        this.config = {
            provider: config.provider || 'vault', // 'vault', 'aws-kms', 'azure-kv'
            vaultUrl: config.vaultUrl,
            vaultToken: config.vaultToken,
            awsRegion: config.awsRegion || 'us-east-1',
            azureKeyVaultUrl: config.azureKeyVaultUrl,
            encryptionEnabled: config.encryptionEnabled !== false,
            cacheEnabled: config.cacheEnabled !== false,
            cacheTTL: config.cacheTTL || 300000, // 5 minutes
            auditLogging: config.auditLogging !== false,
            rotationEnabled: config.rotationEnabled !== false,
            rotationInterval: config.rotationInterval || 30 * 24 * 60 * 60 * 1000, // 30 days
            ...config
        };

        this.secretsCache = new Map();
        this.auditLogger = null;
        this.rotationScheduler = null;
        this.encryptionKey = null;

        this.initialize();
    }

    /**
     * Initialize secrets manager
     */
    async initialize() {
        try {
            await this._initializeProvider();
            await this._initializeEncryption();
            await this._initializeAuditLogging();
            await this._scheduleRotation();
            
            console.log(`Secrets Manager initialized with provider: ${this.config.provider}`);
        } catch (error) {
            console.error('Failed to initialize Secrets Manager:', error);
            throw error;
        }
    }

    /**
     * Initialize the secrets provider
     */
    async _initializeProvider() {
        switch (this.config.provider) {
            case 'vault':
                await this._initializeVault();
                break;
            case 'aws-kms':
                await this._initializeAWSKMS();
                break;
            case 'azure-kv':
                await this._initializeAzureKeyVault();
                break;
            default:
                throw new Error(`Unsupported secrets provider: ${this.config.provider}`);
        }
    }

    /**
     * Initialize HashiCorp Vault
     */
    async _initializeVault() {
        if (!this.config.vaultUrl || !this.config.vaultToken) {
            throw new Error('Vault URL and token are required for Vault provider');
        }

        // Test connection to Vault
        try {
            const response = await axios.get(`${this.config.vaultUrl}/v1/sys/health`, {
                headers: {
                    'X-Vault-Token': this.config.vaultToken
                },
                timeout: 5000
            });

            if (!response.data.initialized) {
                throw new Error('Vault is not initialized');
            }

            if (response.data.sealed) {
                throw new Error('Vault is sealed');
            }
        } catch (error) {
            throw new Error(`Failed to connect to Vault: ${error.message}`);
        }

        this.vault = {
            url: this.config.vaultUrl,
            token: this.config.vaultToken,
            headers: {
                'X-Vault-Token': this.config.vaultToken,
                'Content-Type': 'application/json'
            }
        };
    }

    /**
     * Initialize AWS KMS
     */
    async _initializeAWSKMS() {
        this.kms = new AWS.KMS({
            region: this.config.awsRegion,
            credentials: this.config.awsCredentials
        });

        this.secretsManager = new AWS.SecretsManager({
            region: this.config.awsRegion,
            credentials: this.config.awsCredentials
        });

        // Test KMS access
        try {
            await this.kms.listKeys({ Limit: 1 }).promise();
        } catch (error) {
            throw new Error(`Failed to access AWS KMS: ${error.message}`);
        }
    }

    /**
     * Initialize Azure Key Vault
     */
    async _initializeAzureKeyVault() {
        const { DefaultAzureCredential } = require('@azure/identity');
        const { SecretClient } = require('@azure/keyvault-secrets');
        const { CryptographyClient } = require('@azure/keyvault-keys');

        this.azureCredential = new DefaultAzureCredential();
        this.secretClient = new SecretClient(
            this.config.azureKeyVaultUrl,
            this.azureCredential
        );

        // Test connection
        try {
            const testIterator = this.secretClient.listPropertiesOfSecrets();
            await testIterator.next();
        } catch (error) {
            throw new Error(`Failed to connect to Azure Key Vault: ${error.message}`);
        }
    }

    /**
     * Store a secret
     * @param {string} path Secret path/name
     * @param {Object|string} value Secret value
     * @param {Object} options Storage options
     * @returns {Object} Storage result
     */
    async setSecret(path, value, options = {}) {
        try {
            this._validatePath(path);
            
            const secretData = {
                value: typeof value === 'string' ? value : JSON.stringify(value),
                metadata: {
                    createdAt: new Date().toISOString(),
                    createdBy: options.createdBy || 'system',
                    description: options.description || '',
                    tags: options.tags || [],
                    expiresAt: options.expiresAt,
                    rotationEnabled: options.rotationEnabled || false,
                    rotationInterval: options.rotationInterval || this.config.rotationInterval
                }
            };

            // Encrypt if enabled
            if (this.config.encryptionEnabled) {
                secretData.value = await this._encrypt(secretData.value);
                secretData.encrypted = true;
            }

            let result;
            switch (this.config.provider) {
                case 'vault':
                    result = await this._setVaultSecret(path, secretData, options);
                    break;
                case 'aws-kms':
                    result = await this._setAWSSecret(path, secretData, options);
                    break;
                case 'azure-kv':
                    result = await this._setAzureSecret(path, secretData, options);
                    break;
            }

            // Clear cache for this path
            this._clearCache(path);

            // Audit log
            await this._auditLog('SECRET_STORED', {
                path,
                provider: this.config.provider,
                encrypted: secretData.encrypted,
                metadata: secretData.metadata
            });

            return result;
        } catch (error) {
            await this._auditLog('SECRET_STORE_FAILED', { path, error: error.message });
            throw error;
        }
    }

    /**
     * Retrieve a secret
     * @param {string} path Secret path/name
     * @param {Object} options Retrieval options
     * @returns {Object} Secret data
     */
    async getSecret(path, options = {}) {
        try {
            this._validatePath(path);

            // Check cache first
            if (this.config.cacheEnabled && !options.bypassCache) {
                const cached = this._getCached(path);
                if (cached) {
                    await this._auditLog('SECRET_RETRIEVED', { path, source: 'cache' });
                    return cached;
                }
            }

            let secretData;
            switch (this.config.provider) {
                case 'vault':
                    secretData = await this._getVaultSecret(path, options);
                    break;
                case 'aws-kms':
                    secretData = await this._getAWSSecret(path, options);
                    break;
                case 'azure-kv':
                    secretData = await this._getAzureSecret(path, options);
                    break;
            }

            if (!secretData) {
                throw new Error(`Secret not found: ${path}`);
            }

            // Decrypt if needed
            if (secretData.encrypted && this.config.encryptionEnabled) {
                secretData.value = await this._decrypt(secretData.value);
            }

            // Parse JSON if applicable
            try {
                secretData.value = JSON.parse(secretData.value);
            } catch {
                // Keep as string if not valid JSON
            }

            // Cache the result
            if (this.config.cacheEnabled) {
                this._setCached(path, secretData);
            }

            await this._auditLog('SECRET_RETRIEVED', { 
                path, 
                source: this.config.provider,
                encrypted: secretData.encrypted 
            });

            return secretData;
        } catch (error) {
            await this._auditLog('SECRET_RETRIEVAL_FAILED', { path, error: error.message });
            throw error;
        }
    }

    /**
     * Delete a secret
     * @param {string} path Secret path/name
     * @returns {boolean} Success status
     */
    async deleteSecret(path) {
        try {
            this._validatePath(path);

            let result;
            switch (this.config.provider) {
                case 'vault':
                    result = await this._deleteVaultSecret(path);
                    break;
                case 'aws-kms':
                    result = await this._deleteAWSSecret(path);
                    break;
                case 'azure-kv':
                    result = await this._deleteAzureSecret(path);
                    break;
            }

            // Clear cache
            this._clearCache(path);

            await this._auditLog('SECRET_DELETED', { path });
            return result;
        } catch (error) {
            await this._auditLog('SECRET_DELETION_FAILED', { path, error: error.message });
            throw error;
        }
    }

    /**
     * List secrets
     * @param {string} pathPrefix Path prefix to filter by
     * @returns {Array} List of secret paths
     */
    async listSecrets(pathPrefix = '') {
        try {
            let secrets;
            switch (this.config.provider) {
                case 'vault':
                    secrets = await this._listVaultSecrets(pathPrefix);
                    break;
                case 'aws-kms':
                    secrets = await this._listAWSSecrets(pathPrefix);
                    break;
                case 'azure-kv':
                    secrets = await this._listAzureSecrets(pathPrefix);
                    break;
            }

            await this._auditLog('SECRETS_LISTED', { pathPrefix, count: secrets.length });
            return secrets;
        } catch (error) {
            await this._auditLog('SECRETS_LIST_FAILED', { pathPrefix, error: error.message });
            throw error;
        }
    }

    /**
     * Rotate a secret
     * @param {string} path Secret path to rotate
     * @param {Function} generator Function to generate new secret value
     * @returns {Object} New secret data
     */
    async rotateSecret(path, generator) {
        try {
            const currentSecret = await this.getSecret(path);
            const newValue = await generator(currentSecret.value);
            
            // Store new secret with rotation metadata
            const result = await this.setSecret(path, newValue, {
                description: `Rotated secret - ${new Date().toISOString()}`,
                rotationEnabled: true,
                previousVersion: currentSecret.metadata?.version || 1
            });

            await this._auditLog('SECRET_ROTATED', {
                path,
                rotationType: 'manual',
                previousVersion: currentSecret.metadata?.version
            });

            return result;
        } catch (error) {
            await this._auditLog('SECRET_ROTATION_FAILED', { path, error: error.message });
            throw error;
        }
    }

    // ========== VAULT IMPLEMENTATION ==========

    async _setVaultSecret(path, secretData, options) {
        const response = await axios.put(
            `${this.vault.url}/v1/secret/data/${path}`,
            {
                data: secretData,
                options: {
                    cas: options.cas || 0
                }
            },
            {
                headers: this.vault.headers,
                timeout: 10000
            }
        );

        return {
            version: response.data.data.version,
            createdTime: response.data.data.created_time
        };
    }

    async _getVaultSecret(path, options) {
        const url = options.version 
            ? `${this.vault.url}/v1/secret/data/${path}?version=${options.version}`
            : `${this.vault.url}/v1/secret/data/${path}`;

        const response = await axios.get(url, {
            headers: this.vault.headers,
            timeout: 10000
        });

        return response.data.data.data;
    }

    async _deleteVaultSecret(path) {
        await axios.delete(`${this.vault.url}/v1/secret/data/${path}`, {
            headers: this.vault.headers,
            timeout: 10000
        });
        return true;
    }

    async _listVaultSecrets(pathPrefix) {
        const response = await axios.get(
            `${this.vault.url}/v1/secret/metadata/${pathPrefix}?list=true`,
            {
                headers: this.vault.headers,
                timeout: 10000
            }
        );

        return response.data.data.keys || [];
    }

    // ========== AWS IMPLEMENTATION ==========

    async _setAWSSecret(path, secretData, options) {
        const params = {
            Name: path,
            SecretString: JSON.stringify(secretData),
            Description: options.description || 'SwappiQ Protocol Secret',
            KmsKeyId: options.kmsKeyId || this.config.defaultKmsKeyId
        };

        try {
            // Try to update existing secret
            const result = await this.secretsManager.updateSecret(params).promise();
            return { version: result.VersionId };
        } catch (error) {
            if (error.code === 'ResourceNotFoundException') {
                // Create new secret
                const result = await this.secretsManager.createSecret(params).promise();
                return { version: result.VersionId };
            }
            throw error;
        }
    }

    async _getAWSSecret(path, options) {
        const params = {
            SecretId: path,
            VersionId: options.version,
            VersionStage: options.versionStage || 'AWSCURRENT'
        };

        const result = await this.secretsManager.getSecretValue(params).promise();
        return JSON.parse(result.SecretString);
    }

    async _deleteAWSSecret(path) {
        await this.secretsManager.deleteSecret({
            SecretId: path,
            ForceDeleteWithoutRecovery: true
        }).promise();
        return true;
    }

    async _listAWSSecrets(pathPrefix) {
        const params = {
            Filters: pathPrefix ? [{
                Key: 'name',
                Values: [`${pathPrefix}*`]
            }] : []
        };

        const result = await this.secretsManager.listSecrets(params).promise();
        return result.SecretList.map(secret => secret.Name);
    }

    // ========== AZURE IMPLEMENTATION ==========

    async _setAzureSecret(path, secretData, options) {
        const secretOptions = {
            contentType: 'application/json',
            tags: options.tags || {},
            expiresOn: options.expiresAt ? new Date(options.expiresAt) : undefined
        };

        const result = await this.secretClient.setSecret(
            path,
            JSON.stringify(secretData),
            secretOptions
        );

        return { version: result.properties.version };
    }

    async _getAzureSecret(path, options) {
        const result = await this.secretClient.getSecret(path, {
            version: options.version
        });

        return JSON.parse(result.value);
    }

    async _deleteAzureSecret(path) {
        await this.secretClient.beginDeleteSecret(path);
        return true;
    }

    async _listAzureSecrets(pathPrefix) {
        const secrets = [];
        const iterator = this.secretClient.listPropertiesOfSecrets();

        for await (const secret of iterator) {
            if (!pathPrefix || secret.name.startsWith(pathPrefix)) {
                secrets.push(secret.name);
            }
        }

        return secrets;
    }

    // ========== ENCRYPTION/DECRYPTION ==========

    async _initializeEncryption() {
        if (!this.config.encryptionEnabled) return;

        // Generate or retrieve encryption key
        if (this.config.encryptionKey) {
            this.encryptionKey = Buffer.from(this.config.encryptionKey, 'hex');
        } else {
            // Generate a new key and store it securely
            this.encryptionKey = crypto.randomBytes(32);
            console.warn('Generated new encryption key. Store this securely:', this.encryptionKey.toString('hex'));
        }
    }

    async _encrypt(data) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
        cipher.setAAD(iv);

        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();

        return JSON.stringify({
            iv: iv.toString('hex'),
            encrypted,
            authTag: authTag.toString('hex')
        });
    }

    async _decrypt(encryptedData) {
        const { iv, encrypted, authTag } = JSON.parse(encryptedData);
        
        const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
        decipher.setAAD(Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(authTag, 'hex'));

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    // ========== CACHING ==========

    _getCached(path) {
        const cached = this.secretsCache.get(path);
        if (!cached) return null;

        if (Date.now() > cached.expiresAt) {
            this.secretsCache.delete(path);
            return null;
        }

        return cached.data;
    }

    _setCached(path, data) {
        this.secretsCache.set(path, {
            data,
            expiresAt: Date.now() + this.config.cacheTTL
        });
    }

    _clearCache(path) {
        if (path) {
            this.secretsCache.delete(path);
        } else {
            this.secretsCache.clear();
        }
    }

    // ========== AUDIT LOGGING ==========

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
                    filename: '/var/log/swappiq/secrets-audit.log',
                    maxsize: 100 * 1024 * 1024, // 100MB
                    maxFiles: 10,
                    tailable: true
                })
            ]
        });
    }

    async _auditLog(action, details) {
        if (!this.auditLogger) return;

        const auditEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            provider: this.config.provider,
            source: 'SecretsManager',
            sessionId: process.env.SECRETS_SESSION_ID || 'unknown',
            userId: process.env.SECRETS_USER_ID || 'system'
        };

        this.auditLogger.info('SECRETS_AUDIT', auditEntry);
    }

    // ========== ROTATION SCHEDULING ==========

    async _scheduleRotation() {
        if (!this.config.rotationEnabled) return;

        this.rotationScheduler = setInterval(async () => {
            try {
                await this._checkAndRotateSecrets();
            } catch (error) {
                console.error('Automatic secret rotation failed:', error);
            }
        }, 24 * 60 * 60 * 1000); // Check daily
    }

    async _checkAndRotateSecrets() {
        // This would check for secrets that need rotation
        // Implementation depends on metadata stored with secrets
        console.log('Checking for secrets requiring rotation...');
    }

    // ========== UTILITY FUNCTIONS ==========

    _validatePath(path) {
        if (!path || typeof path !== 'string') {
            throw new Error('Secret path must be a non-empty string');
        }
        
        if (path.length > 512) {
            throw new Error('Secret path too long (max 512 characters)');
        }
        
        if (!/^[a-zA-Z0-9/_-]+$/.test(path)) {
            throw new Error('Secret path contains invalid characters');
        }
    }

    /**
     * Health check for secrets provider
     */
    async healthCheck() {
        try {
            switch (this.config.provider) {
                case 'vault':
                    await axios.get(`${this.vault.url}/v1/sys/health`, {
                        headers: this.vault.headers,
                        timeout: 5000
                    });
                    break;
                case 'aws-kms':
                    await this.kms.listKeys({ Limit: 1 }).promise();
                    break;
                case 'azure-kv':
                    const iterator = this.secretClient.listPropertiesOfSecrets();
                    await iterator.next();
                    break;
            }
            return { status: 'healthy', provider: this.config.provider };
        } catch (error) {
            return { status: 'unhealthy', provider: this.config.provider, error: error.message };
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        if (this.rotationScheduler) {
            clearInterval(this.rotationScheduler);
        }
        
        this._clearCache();
        
        await this._auditLog('SECRETS_MANAGER_SHUTDOWN', {});
        console.log('Secrets Manager cleaned up successfully');
    }
}

module.exports = { SecretsManager };

/**
 * Usage Examples:
 * 
 * // Initialize with Vault
 * const secretsManager = new SecretsManager({
 *     provider: 'vault',
 *     vaultUrl: 'https://vault.swappiq.com',
 *     vaultToken: process.env.VAULT_TOKEN,
 *     encryptionEnabled: true,
 *     cacheEnabled: true,
 *     auditLogging: true
 * });
 * 
 * // Store a secret
 * await secretsManager.setSecret('database/postgres/password', 'super-secret-password', {
 *     description: 'Production database password',
 *     tags: ['database', 'production'],
 *     rotationEnabled: true
 * });
 * 
 * // Retrieve a secret
 * const secret = await secretsManager.getSecret('database/postgres/password');
 * console.log(secret.value); // 'super-secret-password'
 * 
 * // Rotate a secret
 * await secretsManager.rotateSecret('api-key/external-service', async (currentValue) => {
 *     // Generate new API key
 *     return generateNewApiKey();
 * });
 */