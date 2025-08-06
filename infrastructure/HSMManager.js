/**
 * @fileoverview HSM (Hardware Security Module) Manager for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Secure private key management using HSM integration
 */

const AWS = require('aws-sdk');
const { CloudHSMV2 } = require('aws-sdk');
const crypto = require('crypto');
const ethers = require('ethers');

/**
 * HSM Manager class for secure key management
 * Supports AWS CloudHSM, Azure Dedicated HSM, and local HSM solutions
 */
class HSMManager {
    constructor(config) {
        this.config = {
            provider: config.provider || 'aws', // 'aws', 'azure', 'local'
            region: config.region || 'us-east-1',
            clusterId: config.clusterId,
            certificates: config.certificates || {},
            keyRotationInterval: config.keyRotationInterval || 30 * 24 * 60 * 60 * 1000, // 30 days
            backupEnabled: config.backupEnabled || true,
            auditLogging: config.auditLogging || true,
            ...config
        };

        this.hsm = null;
        this.keyCache = null; // Will be initialized as SecureCache
        this.auditLogger = null;
        this.keyRotationScheduler = null;
        this.connectionPool = null;
        this.failoverManager = null;
        this.safeKeyRotation = null;

        this._initializeSecureComponents();
        this.initialize();
    }

    /**
     * Initialize secure components
     */
    _initializeSecureComponents() {
        // Initialize secure cache
        this.keyCache = new SecureCache({
            ttl: 300000, // 5 minutes
            maxSize: 1000
        });
        
        // Initialize connection pool
        this.connectionPool = new HSMConnectionPool({
            maxConnections: this.config.maxConnections || 10,
            connectionTimeout: this.config.connectionTimeout || 5000
        });
        
        // Initialize failover manager
        this.failoverManager = new HSMFailoverManager(
            this.config.primary || this.config,
            this.config.backups || []
        );
        
        // Initialize safe key rotation
        this.safeKeyRotation = new SafeKeyRotation(this);
    }

    /**
     * Initialize HSM connection and services
     */
    async initialize() {
        try {
            await this._initializeHSM();
            await this._initializeAuditLogging();
            await this._scheduleKeyRotation();
            
            console.log(`HSM Manager initialized with provider: ${this.config.provider}`);
        } catch (error) {
            console.error('Failed to initialize HSM Manager:', error);
            throw error;
        }
    }

    /**
     * Initialize HSM connection based on provider
     */
    async _initializeHSM() {
        switch (this.config.provider) {
            case 'aws':
                await this._initializeAWSCloudHSM();
                break;
            case 'azure':
                await this._initializeAzureHSM();
                break;
            case 'local':
                await this._initializeLocalHSM();
                break;
            default:
                throw new Error(`Unsupported HSM provider: ${this.config.provider}`);
        }
    }

    /**
     * Initialize AWS CloudHSM
     */
    async _initializeAWSCloudHSM() {
        this.cloudHSM = new CloudHSMV2({
            region: this.config.region,
            credentials: this.config.credentials
        });

        // Verify cluster exists and is active
        const cluster = await this.cloudHSM.describeClusters({
            Filters: {
                clusterIds: [this.config.clusterId]
            }
        }).promise();

        if (!cluster.Clusters || cluster.Clusters.length === 0) {
            throw new Error(`HSM Cluster ${this.config.clusterId} not found`);
        }

        const clusterState = cluster.Clusters[0].State;
        if (clusterState !== 'ACTIVE') {
            throw new Error(`HSM Cluster is not active. Current state: ${clusterState}`);
        }

        // Initialize CloudHSM client library
        const { CloudHsmClient } = require('@aws-crypto/client-node');
        this.hsm = new CloudHsmClient({
            credentials: this.config.hsmCredentials,
            libraryPath: this.config.libraryPath || '/opt/cloudhsm/lib/libcloudhsm_pkcs11.so'
        });

        await this.hsm.connect();
    }

    /**
     * Initialize Azure Dedicated HSM
     */
    async _initializeAzureHSM() {
        const { DefaultAzureCredential } = require('@azure/identity');
        const { KeyVaultManagementClient } = require('@azure/arm-keyvault');

        this.azureCredential = new DefaultAzureCredential();
        this.keyVaultClient = new KeyVaultManagementClient(
            this.azureCredential,
            this.config.subscriptionId
        );

        // Verify HSM exists and is accessible
        try {
            await this.keyVaultClient.vaults.get(
                this.config.resourceGroupName,
                this.config.hsmName
            );
        } catch (error) {
            throw new Error(`Azure HSM ${this.config.hsmName} not accessible: ${error.message}`);
        }
    }

    /**
     * Initialize local HSM (e.g., Thales, SafeNet)
     */
    async _initializeLocalHSM() {
        // This would integrate with local HSM via PKCS#11
        const pkcs11 = require('pkcs11js');
        
        this.hsm = new pkcs11.PKCS11();
        this.hsm.load(this.config.libraryPath);
        
        this.hsm.C_Initialize();
        
        // Get slot list
        const slots = this.hsm.C_GetSlotList(true);
        if (slots.length === 0) {
            throw new Error('No HSM slots available');
        }
        
        this.slotId = slots[0];
        
        // Open session
        this.session = this.hsm.C_OpenSession(this.slotId, 
            pkcs11.CKF_SERIAL_SESSION | pkcs11.CKF_RW_SESSION);
        
        // Login to HSM
        this.hsm.C_Login(this.session, pkcs11.CKU_USER, this.config.pin);
    }

    /**
     * Generate a new private key in HSM
     * @param {string} keyId Unique identifier for the key
     * @param {Object} options Key generation options
     * @returns {Object} Key metadata
     */
    async generateKey(keyId, options = {}) {
        try {
            // Enhanced input validation
            this._validateKeyIdSecure(keyId);
            this._validateOptions(options);
            
            const keyMetadata = {
                keyId,
                algorithm: options.algorithm || 'secp256k1',
                purpose: options.purpose || 'signing',
                createdAt: new Date().toISOString(),
                rotationDue: new Date(Date.now() + this.config.keyRotationInterval).toISOString(),
                usage: options.usage || ['sign', 'verify']
            };

            // Use failover manager for resilient key generation
            const keyHandle = await this.failoverManager.executeWithFailover(async (hsm) => {
                switch (this.config.provider) {
                    case 'aws':
                        return await this._generateAWSKey(keyId, keyMetadata);
                    case 'azure':
                        return await this._generateAzureKey(keyId, keyMetadata);
                    case 'local':
                        return await this._generateLocalKey(keyId, keyMetadata);
                    default:
                        throw new Error(`Unsupported provider: ${this.config.provider}`);
                }
            });

            // Cache key metadata securely
            this.keyCache.set(keyId, {
                ...keyMetadata,
                handle: keyHandle,
                lastUsed: new Date().toISOString()
            });

            // Audit log
            await this._auditLog('KEY_GENERATED', {
                keyId,
                algorithm: keyMetadata.algorithm,
                purpose: keyMetadata.purpose
            });

            return keyMetadata;
        } catch (error) {
            await this._auditLog('KEY_GENERATION_FAILED', { keyId, error: error.message });
            throw error;
        }
    }

    /**
     * Sign data using HSM-stored key
     * @param {string} keyId Key identifier
     * @param {Buffer|string} data Data to sign
     * @param {Object} options Signing options
     * @returns {string} Signature
     */
    async sign(keyId, data, options = {}) {
        try {
            this._validateKeyId(keyId);
            
            const keyInfo = this.keyCache.get(keyId);
            if (!keyInfo) {
                throw new Error(`Key ${keyId} not found in cache`);
            }

            // Convert data to hash if needed
            const hash = options.hash || crypto.createHash('sha256').update(data).digest();
            
            let signature;
            switch (this.config.provider) {
                case 'aws':
                    signature = await this._signAWS(keyInfo.handle, hash, options);
                    break;
                case 'azure':
                    signature = await this._signAzure(keyInfo.handle, hash, options);
                    break;
                case 'local':
                    signature = await this._signLocal(keyInfo.handle, hash, options);
                    break;
            }

            // Update last used timestamp
            keyInfo.lastUsed = new Date().toISOString();
            this.keyCache.set(keyId, keyInfo);

            // Audit log
            await this._auditLog('SIGNATURE_CREATED', {
                keyId,
                dataHash: hash.toString('hex'),
                signatureLength: signature.length
            });

            return signature;
        } catch (error) {
            await this._auditLog('SIGNATURE_FAILED', { keyId, error: error.message });
            throw error;
        }
    }

    /**
     * Get public key for a given key ID
     * @param {string} keyId Key identifier
     * @returns {string} Public key in hex format
     */
    async getPublicKey(keyId) {
        try {
            this._validateKeyId(keyId);
            
            const keyInfo = this.keyCache.get(keyId);
            if (!keyInfo) {
                throw new Error(`Key ${keyId} not found`);
            }

            if (keyInfo.publicKey) {
                return keyInfo.publicKey;
            }

            let publicKey;
            switch (this.config.provider) {
                case 'aws':
                    publicKey = await this._getPublicKeyAWS(keyInfo.handle);
                    break;
                case 'azure':
                    publicKey = await this._getPublicKeyAzure(keyInfo.handle);
                    break;
                case 'local':
                    publicKey = await this._getPublicKeyLocal(keyInfo.handle);
                    break;
            }

            // Cache public key
            keyInfo.publicKey = publicKey;
            this.keyCache.set(keyId, keyInfo);

            return publicKey;
        } catch (error) {
            await this._auditLog('PUBLIC_KEY_RETRIEVAL_FAILED', { keyId, error: error.message });
            throw error;
        }
    }

    /**
     * Rotate a key (generate new key and mark old one for deprecation)
     * @param {string} keyId Key to rotate
     * @returns {Object} New key metadata
     */
    async rotateKey(keyId) {
        return await this.safeKeyRotation.safeKeyRotation(keyId);
    }

    /**
     * Backup key to secure storage
     * @param {string} keyId Key to backup
     * @returns {string} Backup ID
     */
    async backupKey(keyId) {
        try {
            if (!this.config.backupEnabled) {
                throw new Error('Key backup is disabled');
            }

            const keyInfo = this.keyCache.get(keyId);
            if (!keyInfo) {
                throw new Error(`Key ${keyId} not found`);
            }

            const backupId = `backup_${keyId}_${Date.now()}`;
            
            // Export key in encrypted format
            const encryptedKey = await this._exportKeySecure(keyInfo.handle);
            
            // Store in secure backup location
            await this._storeBackup(backupId, encryptedKey, keyInfo);

            await this._auditLog('KEY_BACKED_UP', {
                keyId,
                backupId,
                backupLocation: this.config.backupLocation
            });

            return backupId;
        } catch (error) {
            await this._auditLog('KEY_BACKUP_FAILED', { keyId, error: error.message });
            throw error;
        }
    }

    /**
     * List all keys with their metadata
     * @returns {Array} Array of key metadata objects
     */
    async listKeys() {
        const keys = [];
        for (const [keyId, keyInfo] of this.keyCache.entries()) {
            if (!keyId.endsWith('_current')) {
                keys.push({
                    keyId,
                    algorithm: keyInfo.algorithm,
                    purpose: keyInfo.purpose,
                    status: keyInfo.status || 'active',
                    createdAt: keyInfo.createdAt,
                    lastUsed: keyInfo.lastUsed,
                    rotationDue: keyInfo.rotationDue
                });
            }
        }
        return keys;
    }

    /**
     * AWS-specific key generation
     */
    async _generateAWSKey(keyId, metadata) {
        const keyPolicy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: `arn:aws:iam::${this.config.accountId}:root` },
                Action: 'cloudhsm:*',
                Resource: '*'
            }]
        };

        // Create key in CloudHSM
        const keyHandle = await this.hsm.createKey({
            keyType: 'ECC_SECG_P256K1',
            keyUsage: ['SIGN_VERIFY'],
            keyPolicy: JSON.stringify(keyPolicy),
            description: `SwappiQ ${metadata.purpose} key: ${keyId}`
        });

        return keyHandle;
    }

    /**
     * AWS-specific signing
     */
    async _signAWS(keyHandle, hash, options) {
        const signResult = await this.hsm.sign({
            keyHandle: keyHandle,
            message: hash,
            signingAlgorithm: 'ECDSA_SHA_256'
        });

        return signResult.signature;
    }

    /**
     * Initialize audit logging
     */
    async _initializeAuditLogging() {
        if (!this.config.auditLogging) return;

        // Initialize structured logging
        const winston = require('winston');
        
        this.auditLogger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({
                    filename: '/var/log/swappiq/hsm-audit.log',
                    maxsize: 100 * 1024 * 1024, // 100MB
                    maxFiles: 10,
                    tailable: true
                }),
                new winston.transports.Console({
                    format: winston.format.simple()
                })
            ]
        });
    }

    /**
     * Log audit events
     */
    async _auditLog(action, details) {
        if (!this.auditLogger) return;

        const auditEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'HSMManager',
            version: '1.0.0',
            sessionId: this._getSessionId(),
            userId: this._getCurrentUserId()
        };

        this.auditLogger.info('HSM_AUDIT', auditEntry);

        // Also send to external audit system if configured
        if (this.config.externalAuditEndpoint) {
            try {
                await this._sendExternalAudit(auditEntry);
            } catch (error) {
                console.error('Failed to send external audit log:', error);
            }
        }
    }

    /**
     * Schedule automatic key rotation
     */
    async _scheduleKeyRotation() {
        if (!this.config.keyRotationInterval) return;

        this.keyRotationScheduler = setInterval(async () => {
            try {
                await this._checkAndRotateKeys();
            } catch (error) {
                console.error('Automatic key rotation failed:', error);
                await this._auditLog('AUTO_ROTATION_FAILED', { error: error.message });
            }
        }, 24 * 60 * 60 * 1000); // Check daily
    }

    /**
     * Check and rotate keys that are due for rotation
     */
    async _checkAndRotateKeys() {
        const now = new Date();
        
        for (const [keyId, keyInfo] of this.keyCache.entries()) {
            if (keyInfo.rotationDue && new Date(keyInfo.rotationDue) <= now) {
                console.log(`Rotating key ${keyId} due to scheduled rotation`);
                await this.rotateKey(keyId);
            }
        }
    }

    /**
     * Enhanced key ID validation with security checks
     */
    _validateKeyIdSecure(keyId) {
        if (!keyId || typeof keyId !== 'string') {
            throw new SecurityError('Invalid keyId parameter');
        }
        if (keyId.length > 128) {
            throw new SecurityError('KeyId too long');
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(keyId)) {
            throw new SecurityError('KeyId contains invalid characters');
        }
        // Check for common attack patterns
        const attackPatterns = ['../', '..\\', '<script', 'javascript:', 'DROP TABLE'];
        const lowerKeyId = keyId.toLowerCase();
        for (const pattern of attackPatterns) {
            if (lowerKeyId.includes(pattern.toLowerCase())) {
                throw new SecurityError('KeyId contains suspicious content');
            }
        }
    }

    /**
     * Validate options object
     */
    _validateOptions(options) {
        if (typeof options !== 'object' || options === null) {
            throw new SecurityError('Options must be a valid object');
        }
        
        const allowedKeys = ['algorithm', 'purpose', 'usage'];
        for (const key of Object.keys(options)) {
            if (!allowedKeys.includes(key)) {
                throw new SecurityError(`Invalid option key: ${key}`);
            }
        }
        
        if (options.algorithm && typeof options.algorithm !== 'string') {
            throw new SecurityError('Algorithm must be a string');
        }
        
        if (options.purpose && typeof options.purpose !== 'string') {
            throw new SecurityError('Purpose must be a string');
        }
    }

    /**
     * Get current session ID for audit logging
     */
    _getSessionId() {
        return process.env.HSM_SESSION_ID || 'unknown';
    }

    /**
     * Get current user ID for audit logging
     */
    _getCurrentUserId() {
        return process.env.HSM_USER_ID || 'system';
    }

    /**
     * Send audit log to external system
     */
    async _sendExternalAudit(auditEntry) {
        const axios = require('axios');
        
        await axios.post(this.config.externalAuditEndpoint, auditEntry, {
            headers: {
                'Authorization': `Bearer ${this.config.externalAuditToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            if (this.keyRotationScheduler) {
                clearInterval(this.keyRotationScheduler);
            }

            if (this.hsm) {
                switch (this.config.provider) {
                    case 'aws':
                        await this.hsm.disconnect();
                        break;
                    case 'local':
                        this.hsm.C_Logout(this.session);
                        this.hsm.C_CloseSession(this.session);
                        this.hsm.C_Finalize();
                        break;
                }
            }

            await this._auditLog('HSM_MANAGER_SHUTDOWN', {});
            console.log('HSM Manager cleaned up successfully');
        } catch (error) {
            console.error('Error during HSM Manager cleanup:', error);
        }
    }
}

/**
 * HSM Key Manager for Ethereum transactions
 * Provides Ethereum-specific signing capabilities
 */
class EthereumHSMSigner {
    constructor(hsmManager, keyId) {
        this.hsmManager = hsmManager;
        this.keyId = keyId;
        this.address = null;
    }

    /**
     * Get Ethereum address for this signer
     */
    async getAddress() {
        if (this.address) return this.address;

        const publicKey = await this.hsmManager.getPublicKey(this.keyId);
        
        // Convert compressed public key to Ethereum address
        const publicKeyBuffer = Buffer.from(publicKey, 'hex');
        const uncompressed = this._uncompressPublicKey(publicKeyBuffer);
        const address = ethers.utils.computeAddress(uncompressed);
        
        this.address = address;
        return address;
    }

    /**
     * Sign Ethereum transaction
     */
    async signTransaction(transaction) {
        const txHash = ethers.utils.keccak256(ethers.utils.serializeTransaction(transaction));
        const signature = await this.hsmManager.sign(this.keyId, Buffer.from(txHash.slice(2), 'hex'));
        
        // Convert HSM signature to Ethereum format
        const ethSignature = this._convertToEthereumSignature(signature);
        
        return ethers.utils.serializeTransaction(transaction, ethSignature);
    }

    /**
     * Sign typed data (EIP-712)
     */
    async _signTypedData(domain, types, value) {
        const digest = ethers.utils._TypedDataEncoder.hash(domain, types, value);
        const signature = await this.hsmManager.sign(this.keyId, Buffer.from(digest.slice(2), 'hex'));
        
        return this._convertToEthereumSignature(signature);
    }

    /**
     * Convert compressed public key to uncompressed format
     */
    _uncompressPublicKey(compressedKey) {
        const secp256k1 = require('secp256k1');
        return secp256k1.publicKeyConvert(compressedKey, false);
    }

    /**
     * Convert HSM signature to Ethereum format
     */
    _convertToEthereumSignature(hsmSignature) {
        // This would need to be adapted based on HSM signature format
        // HSM typically returns DER-encoded signatures that need conversion
        const { r, s, v } = this._parseDERSignature(hsmSignature);
        
        return {
            r: '0x' + r.toString('hex'),
            s: '0x' + s.toString('hex'),
            v: v
        };
    }

    /**
     * Parse DER-encoded signature
     */
    _parseDERSignature(derSignature) {
        // Simplified DER parsing - would need proper ASN.1 parser in production
        const r = derSignature.slice(4, 36);
        const s = derSignature.slice(38, 70);
        
        // Calculate recovery parameter v
        const v = 27; // This would need proper calculation based on signature
        
        return { r, s, v };
    }
}

module.exports = {
    HSMManager,
    EthereumHSMSigner
};

/**
 * Usage Example:
 * 
 * const hsmManager = new HSMManager({
 *     provider: 'aws',
 *     region: 'us-east-1',
 *     clusterId: 'cluster-abc123',
 *     keyRotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
 *     backupEnabled: true,
 *     auditLogging: true
 * });
 * 
 * // Generate new signing key
 * await hsmManager.generateKey('trading-key-1', {
 *     algorithm: 'secp256k1',
 *     purpose: 'order-signing'
 * });
 * 
 * // Create Ethereum signer
 * const signer = new EthereumHSMSigner(hsmManager, 'trading-key-1');
 * const address = await signer.getAddress();
 * 
 * // Sign transaction
 * const signedTx = await signer.signTransaction({
 *     to: '0x...',
 *     value: ethers.utils.parseEther('1.0'),
 *     gasLimit: 21000,
 *     gasPrice: ethers.utils.parseUnits('20', 'gwei')
 * });

/**
 * Security Error class
 */
class SecurityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SecurityError';
    }
}

/**
 * Secure cache with encryption and automatic cleanup
 */
class SecureCache {
    constructor(options = {}) {
        this.cache = new Map();
        this.ttl = options.ttl || 300000; // 5 minutes
        this.maxSize = options.maxSize || 1000;
        this.encryptionKey = crypto.randomBytes(32);
    }
    
    set(key, value) {
        // Encrypt value before storing
        const encrypted = this._encryptCacheEntry(value);
        this.cache.set(key, {
            data: encrypted,
            expiresAt: Date.now() + this.ttl
        });
        
        // Enforce size limit
        if (this.cache.size > this.maxSize) {
            this._evictOldest();
        }
        
        // Schedule automatic cleanup
        setTimeout(() => this._secureDelete(key), this.ttl);
    }
    
    get(key) {
        const entry = this.cache.get(key);
        if (!entry || Date.now() > entry.expiresAt) {
            this._secureDelete(key);
            return null;
        }
        
        return this._decryptCacheEntry(entry.data);
    }
    
    _encryptCacheEntry(value) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
        const data = JSON.stringify(value);
        
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return {
            iv: iv.toString('hex'),
            tag: cipher.getAuthTag().toString('hex'),
            data: encrypted
        };
    }
    
    _decryptCacheEntry(encrypted) {
        const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
        decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
        
        let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return JSON.parse(decrypted);
    }
    
    _secureDelete(key) {
        if (this.cache.has(key)) {
            const entry = this.cache.get(key);
            // Overwrite memory before deletion
            crypto.randomFillSync(Buffer.from(JSON.stringify(entry)));
            this.cache.delete(key);
        }
    }
    
    _evictOldest() {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) {
            this._secureDelete(oldestKey);
        }
    }
}

/**
 * HSM connection pool for performance optimization
 */
class HSMConnectionPool {
    constructor(config) {
        this.pools = new Map();
        this.maxConnections = config.maxConnections || 10;
        this.connectionTimeout = config.connectionTimeout || 5000;
    }
    
    async getConnection(provider) {
        if (!this.pools.has(provider)) {
            this.pools.set(provider, {
                connections: [],
                active: 0,
                waiting: []
            });
        }
        
        const pool = this.pools.get(provider);
        
        if (pool.connections.length > 0) {
            return pool.connections.pop();
        }
        
        if (pool.active < this.maxConnections) {
            pool.active++;
            return await this._createConnection(provider);
        }
        
        // Wait for available connection
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, this.connectionTimeout);
            
            pool.waiting.push({ resolve, reject, timeout });
        });
    }
    
    releaseConnection(provider, connection) {
        const pool = this.pools.get(provider);
        if (!pool) return;
        
        if (pool.waiting.length > 0) {
            const waiter = pool.waiting.shift();
            clearTimeout(waiter.timeout);
            waiter.resolve(connection);
        } else {
            pool.connections.push(connection);
        }
    }
    
    async _createConnection(provider) {
        // Mock implementation - would create actual HSM connection
        return { provider, id: crypto.randomUUID(), createdAt: Date.now() };
    }
}

/**
 * HSM failover manager for high availability
 */
class HSMFailoverManager {
    constructor(primaryHSM, backupHSMs) {
        this.primary = primaryHSM;
        this.backups = backupHSMs || [];
        this.currentHSM = primaryHSM;
        this.failoverInProgress = false;
    }
    
    async executeWithFailover(operation) {
        try {
            return await operation(this.currentHSM);
        } catch (error) {
            if (this._isHSMFailure(error) && !this.failoverInProgress) {
                return await this._performFailover(operation);
            }
            throw error;
        }
    }
    
    async _performFailover(operation) {
        this.failoverInProgress = true;
        
        try {
            for (const backupHSM of this.backups) {
                try {
                    await this._healthCheck(backupHSM);
                    this.currentHSM = backupHSM;
                    
                    console.log(`Failed over to backup HSM: ${backupHSM.name || 'unnamed'}`);
                    
                    return await operation(backupHSM);
                } catch (backupError) {
                    // Try next backup
                    continue;
                }
            }
            
            throw new Error('All HSM devices unavailable');
        } finally {
            this.failoverInProgress = false;
        }
    }
    
    _isHSMFailure(error) {
        const hsmErrorPatterns = [
            'HSM_UNAVAILABLE',
            'CONNECTION_LOST',
            'HARDWARE_FAILURE',
            'TIMEOUT'
        ];
        
        return hsmErrorPatterns.some(pattern => 
            error.message.includes(pattern) || error.code === pattern
        );
    }
    
    async _healthCheck(hsm) {
        // Mock health check - would ping actual HSM
        return true;
    }
}

/**
 * Safe key rotation with operation coordination
 */
class SafeKeyRotation {
    constructor(hsmManager) {
        this.hsm = hsmManager;
        this.operationsInProgress = new Set();
        this.rotationLock = false;
    }
    
    async safeKeyRotation(keyId) {
        // Wait for ongoing operations to complete
        await this._waitForOperationsToComplete();
        
        try {
            this.rotationLock = true;
            
            const oldKeyInfo = this.hsm.keyCache.get(keyId);
            if (!oldKeyInfo) {
                throw new Error(`Key ${keyId} not found for rotation`);
            }

            // Generate new key with rotated ID
            const newKeyId = `${keyId}_${Date.now()}`;
            const newKeyMetadata = await this.hsm.generateKey(newKeyId, {
                algorithm: oldKeyInfo.algorithm,
                purpose: oldKeyInfo.purpose,
                usage: oldKeyInfo.usage
            });

            // Mark old key as deprecated
            oldKeyInfo.status = 'deprecated';
            oldKeyInfo.deprecatedAt = new Date().toISOString();
            oldKeyInfo.replacedBy = newKeyId;
            this.hsm.keyCache.set(keyId, oldKeyInfo);

            // Update key mapping
            this.hsm.keyCache.set(keyId + '_current', newKeyMetadata);

            await this.hsm._auditLog('KEY_ROTATED', {
                oldKeyId: keyId,
                newKeyId: newKeyId,
                rotationReason: 'scheduled'
            });

            return newKeyMetadata;
        } finally {
            this.rotationLock = false;
        }
    }
    
    async executeWithRotationSafety(keyId, operation) {
        const operationId = crypto.randomUUID();
        this.operationsInProgress.add(operationId);
        
        try {
            // Check if rotation is in progress
            if (this.rotationLock) {
                throw new Error('Key rotation in progress, please retry');
            }
            
            return await operation(keyId);
        } finally {
            this.operationsInProgress.delete(operationId);
        }
    }
    
    async _waitForOperationsToComplete() {
        const timeout = 30000; // 30 seconds
        const startTime = Date.now();
        
        while (this.operationsInProgress.size > 0) {
            if (Date.now() - startTime > timeout) {
                throw new Error('Timeout waiting for operations to complete');
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}
 */