const crypto = require('crypto');
const ethers = require('ethers');
const fs = require('fs').promises;
const path = require('path');

/**
 * Key Rotation Manager for Meta Aggregator 2.0
 * Handles secure rotation of private keys used for backend signing and escrow operations
 */
class KeyRotationManager {
    constructor(config = {}) {
        this.config = {
            rotationInterval: config.rotationInterval || 30 * 24 * 60 * 60 * 1000, // 30 days
            keyStorePath: config.keyStorePath || path.join(process.cwd(), 'security', 'keys'),
            backupPath: config.backupPath || path.join(process.cwd(), 'security', 'backups'),
            logPath: config.logPath || path.join(process.cwd(), 'security', 'rotation.log'),
            ...config
        };
        
        this.keyTypes = {
            PRIVATE_KEY: 'backend_signing',
            ARBITER_PRIVATE_KEY: 'escrow_arbiter'
        };
        
        this.currentVersions = new Map();
        this.rotationHistory = [];
    }    /**
     * Generate a new Ethereum key pair
     * @returns {Object} { privateKey, publicKey, address }
     */
    generateKeyPair() {
        const wallet = ethers.Wallet.createRandom();
        return {
            privateKey: wallet.privateKey,
            publicKey: wallet.signingKey.publicKey,
            address: wallet.address,
            mnemonic: wallet.mnemonic?.phrase
        };
    }    /**
     * Get current key version for a key type
     * @param {string} keyType 
     * @returns {number}
     */
    getCurrentVersion(keyType) {
        // Check if we have a cached version
        if (this.currentVersions.has(keyType)) {
            return this.currentVersions.get(keyType);
        }
        
        // Try to detect version from existing key files
        const detectedVersion = this.detectVersionFromFiles(keyType);
        if (detectedVersion > 1) {
            this.currentVersions.set(keyType, detectedVersion);
            return detectedVersion;
        }
        
        return 1;
    }

    /**
     * Detect the latest version from existing key files
     * @param {string} keyType 
     * @returns {number}
     */
    detectVersionFromFiles(keyType) {
        try {
            const fs = require('fs');
            const path = require('path');
            const keyDir = path.join(__dirname, '..', 'keys');
            
            if (!fs.existsSync(keyDir)) {
                return 1;
            }
            
            const files = fs.readdirSync(keyDir);
            let maxVersion = 1;
            
            for (const file of files) {
                if (file.startsWith(keyType + '_v') && file.endsWith('.json')) {
                    const versionMatch = file.match(/_v(\d+)\.json$/);
                    if (versionMatch) {
                        const version = parseInt(versionMatch[1]);
                        maxVersion = Math.max(maxVersion, version);
                    }
                }
            }
            
            return maxVersion;
        } catch (error) {
            console.error('Error detecting version from files:', error);
            return 1;
        }
    }

    /**
     * Generate versioned key identifier
     * @param {string} keyType 
     * @param {number} version 
     * @returns {string}
     */
    getVersionedKeyId(keyType, version) {
        return `${keyType}_v${version}`;
    }    /**
     * Securely store encrypted key
     * @param {string} keyId 
     * @param {string} privateKey 
     * @param {string} encryptionPassword 
     */
    async storeEncryptedKey(keyId, privateKey, encryptionPassword) {
        // Use modern encryption instead of deprecated createCipher
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(encryptionPassword, 'salt', 32);
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(privateKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const keyData = {
            keyId,
            encrypted,
            iv: iv.toString('hex'),
            timestamp: new Date().toISOString(),
            algorithm: algorithm
        };

        const keyPath = path.join(this.config.keyStorePath, `${keyId}.json`);
        await fs.mkdir(path.dirname(keyPath), { recursive: true });
        await fs.writeFile(keyPath, JSON.stringify(keyData, null, 2));

        return keyPath;
    }    /**
     * Retrieve and decrypt stored key
     * @param {string} keyId 
     * @param {string} encryptionPassword 
     * @returns {string} decrypted private key
     */
    async retrieveDecryptedKey(keyId, encryptionPassword) {
        const keyPath = path.join(this.config.keyStorePath, `${keyId}.json`);
        const keyData = JSON.parse(await fs.readFile(keyPath, 'utf8'));

        // Use modern decryption
        const algorithm = keyData.algorithm || 'aes-256-cbc';
        const key = crypto.scryptSync(encryptionPassword, 'salt', 32);
        const iv = Buffer.from(keyData.iv, 'hex');
        
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        let decrypted = decipher.update(keyData.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Backup old key before rotation
     * @param {string} keyType 
     * @param {string} privateKey 
     * @param {number} version 
     */
    async backupOldKey(keyType, privateKey, version) {
        const backupId = `${keyType}_v${version}_backup_${Date.now()}`;
        const backupPath = path.join(this.config.backupPath, `${backupId}.json`);
        
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        
        const backupData = {
            keyType,
            version,
            privateKey: privateKey.substring(0, 10) + '...', // Only store prefix for reference
            timestamp: new Date().toISOString(),
            status: 'revoked'
        };

        await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
        return backupPath;
    }

    /**
     * Log rotation event
     * @param {Object} rotationEvent 
     */
    async logRotation(rotationEvent) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            ...rotationEvent
        };

        this.rotationHistory.push(logEntry);

        const logLine = `${logEntry.timestamp} - ${logEntry.action} - ${logEntry.keyType} - ${logEntry.trigger} - ${logEntry.rotatedBy}\n`;
        
        await fs.mkdir(path.dirname(this.config.logPath), { recursive: true });
        await fs.appendFile(this.config.logPath, logLine);
    }

    /**
     * Update environment configuration with new key
     * @param {string} keyType 
     * @param {string} newPrivateKey 
     */
    async updateEnvironmentConfig(keyType, newPrivateKey) {
        const envPath = path.join(process.cwd(), '.env.local');
        let envContent = '';
        
        try {
            envContent = await fs.readFile(envPath, 'utf8');
        } catch (error) {
            console.warn('Environment file not found, creating new one');
        }

        // Update or add the key
        const keyPattern = new RegExp(`^${keyType}=.*$`, 'm');
        const newKeyLine = `${keyType}=${newPrivateKey}`;

        if (keyPattern.test(envContent)) {
            envContent = envContent.replace(keyPattern, newKeyLine);
        } else {
            envContent += `\n${newKeyLine}`;
        }

        await fs.writeFile(envPath, envContent);
    }

    /**
     * Validate new key works correctly
     * @param {string} privateKey 
     * @returns {boolean}
     */
    async validateNewKey(privateKey) {
        try {
            const wallet = new ethers.Wallet(privateKey);
            
            // Test signing a simple message
            const message = "test_signature_" + Date.now();
            const signature = await wallet.signMessage(message);
            
            // Verify the signature
            const recovered = ethers.verifyMessage(message, signature);
            
            return recovered.toLowerCase() === wallet.address.toLowerCase();
        } catch (error) {
            console.error('Key validation failed:', error);
            return false;
        }
    }

    /**
     * Main key rotation function
     * @param {string} keyType 
     * @param {Object} options 
     */
    async rotateKey(keyType, options = {}) {
        const {
            trigger = 'manual',
            rotatedBy = 'system',
            reason = 'scheduled_rotation',
            encryptionPassword = process.env.KEY_ENCRYPTION_PASSWORD || 'default_password'
        } = options;

        console.log(`Starting key rotation for ${keyType}...`);

        try {
            // 1. Generate new key pair
            const newKeyPair = this.generateKeyPair();
            console.log(`Generated new key pair for ${keyType}`);
            console.log(`New address: ${newKeyPair.address}`);

            // 2. Validate new key
            const isValid = await this.validateNewKey(newKeyPair.privateKey);
            if (!isValid) {
                throw new Error('New key validation failed');
            }

            // 3. Get current version and increment
            const currentVersion = this.getCurrentVersion(keyType);
            const newVersion = currentVersion + 1;
            const newKeyId = this.getVersionedKeyId(keyType, newVersion);

            // 4. Backup old key if exists
            try {
                const oldKey = process.env[keyType];
                if (oldKey) {
                    await this.backupOldKey(keyType, oldKey, currentVersion);
                    console.log(`Backed up old key version ${currentVersion}`);
                }
            } catch (error) {
                console.warn('Could not backup old key:', error.message);
            }

            // 5. Store new encrypted key
            await this.storeEncryptedKey(newKeyId, newKeyPair.privateKey, encryptionPassword);
            console.log(`Stored encrypted key: ${newKeyId}`);

            // 6. Update environment configuration
            await this.updateEnvironmentConfig(keyType, newKeyPair.privateKey);
            console.log(`Updated environment configuration for ${keyType}`);

            // 7. Update version tracking
            this.currentVersions.set(keyType, newVersion);

            // 8. Log rotation event
            await this.logRotation({
                action: 'key_rotated',
                keyType,
                oldVersion: currentVersion,
                newVersion,
                newAddress: newKeyPair.address,
                trigger,
                rotatedBy,
                reason,
                success: true
            });

            console.log(`Key rotation completed successfully for ${keyType}`);
            console.log(`New version: ${newVersion}`);
            console.log(`New address: ${newKeyPair.address}`);

            return {
                success: true,
                keyType,
                oldVersion: currentVersion,
                newVersion,
                newAddress: newKeyPair.address,
                keyId: newKeyId
            };

        } catch (error) {
            console.error(`Key rotation failed for ${keyType}:`, error);
            
            // Log failure
            await this.logRotation({
                action: 'key_rotation_failed',
                keyType,
                trigger,
                rotatedBy,
                reason,
                error: error.message,
                success: false
            });

            throw error;
        }
    }

    /**
     * Emergency key rotation (faster, minimal validation)
     * @param {string} keyType 
     * @param {string} reason 
     */
    async emergencyRotateKey(keyType, reason = 'security_breach') {
        console.log(`EMERGENCY KEY ROTATION for ${keyType} - Reason: ${reason}`);
        
        return this.rotateKey(keyType, {
            trigger: 'emergency',
            rotatedBy: 'emergency_system',
            reason: reason
        });
    }

    /**
     * Check if key rotation is due based on schedule
     * @param {string} keyType 
     * @returns {boolean}
     */
    async isRotationDue(keyType) {
        try {
            const keyId = this.getVersionedKeyId(keyType, this.getCurrentVersion(keyType));
            const keyPath = path.join(this.config.keyStorePath, `${keyId}.json`);
            const keyData = JSON.parse(await fs.readFile(keyPath, 'utf8'));
            
            const keyAge = Date.now() - new Date(keyData.timestamp).getTime();
            return keyAge > this.config.rotationInterval;
        } catch (error) {
            // If we can't read the key file, consider rotation due
            return true;
        }
    }

    /**
     * Get rotation status for all keys
     * @returns {Object}
     */
    async getRotationStatus() {
        const status = {};
        
        for (const keyType of Object.keys(this.keyTypes)) {
            const currentVersion = this.getCurrentVersion(keyType);
            const isDue = await this.isRotationDue(keyType);
            
            status[keyType] = {
                currentVersion,
                isDue,
                keyId: this.getVersionedKeyId(keyType, currentVersion)
            };
        }
        
        return status;
    }
}

module.exports = KeyRotationManager;
