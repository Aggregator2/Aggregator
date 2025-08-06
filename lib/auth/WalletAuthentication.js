/**
 * @title Wallet Authentication System (EIP-4361)
 * @author DEX Security Team
 * @notice Ethereum wallet authentication using Sign-In with Ethereum (SIWE)
 * @dev Implements EIP-4361 standard for secure wallet-based authentication
 */

const { ethers } = require('ethers');
const { SiweMessage } = require('siwe');
const crypto = require('crypto');

class WalletAuthentication {
    constructor(config) {
        this.config = {
            domain: config.domain || 'localhost',
            origin: config.origin || 'http://localhost:3000',
            chainId: config.chainId || 1, // Mainnet
            version: config.version || '1',
            statementTemplate: config.statementTemplate || 'Sign in to DEX Platform',
            sessionDuration: config.sessionDuration || 86400000, // 24 hours
            nonceExpiry: config.nonceExpiry || 600000, // 10 minutes
            requireValidChain: config.requireValidChain || true,
            supportedChains: config.supportedChains || [1, 5, 137, 80001], // Mainnet, Goerli, Polygon, Mumbai
            ...config
        };

        // Nonce management for replay protection
        this.nonces = new Map(); // nonce -> { address, timestamp, used }
        this.addressNonces = new Map(); // address -> Set of nonces
        
        // ENS resolver for address verification
        this.ensResolver = config.ensResolver || null;
        
        // Security monitoring
        this.securityLogger = config.securityLogger || console;
        
        this._startNonceCleanup();
    }

    /**
     * Generate a secure nonce for wallet authentication
     * @param {string} address Ethereum address
     * @returns {Promise<Object>} Nonce and expiry information
     */
    async generateNonce(address) {
        try {
            // Validate address format
            if (!ethers.utils.isAddress(address)) {
                throw new WalletAuthError('Invalid Ethereum address format');
            }

            // Generate cryptographically secure nonce
            const nonce = crypto.randomBytes(32).toString('hex');
            const timestamp = Date.now();
            const expiresAt = timestamp + this.config.nonceExpiry;

            // Store nonce with metadata
            this.nonces.set(nonce, {
                address: address.toLowerCase(),
                timestamp,
                expiresAt,
                used: false,
                issuedBy: 'wallet_auth'
            });

            // Track nonces by address
            if (!this.addressNonces.has(address.toLowerCase())) {
                this.addressNonces.set(address.toLowerCase(), new Set());
            }
            this.addressNonces.get(address.toLowerCase()).add(nonce);

            await this.securityLogger.logNonceGeneration?.({
                address,
                nonce,
                expiresAt
            });

            return {
                nonce,
                expiresAt,
                message: this._buildSiweMessage(address, nonce, timestamp)
            };

        } catch (error) {
            await this.securityLogger.logNonceError?.({
                address,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Verify wallet signature using EIP-4361 (SIWE) standard
     * @param {string} address Ethereum address
     * @param {string} signature Signature from wallet
     * @param {string} message Original SIWE message
     * @param {Object} options Verification options
     * @returns {Promise<Object>} Verification result
     */
    async verifySignature(address, signature, message, options = {}) {
        try {
            // Parse SIWE message
            const siweMessage = new SiweMessage(message);
            
            // Basic validation
            await this._validateSiweMessage(siweMessage, address);
            
            // Verify nonce
            await this._verifyNonce(siweMessage.nonce, address);
            
            // Verify signature
            const verificationResult = await siweMessage.verify({
                signature,
                domain: this.config.domain,
                nonce: siweMessage.nonce,
                time: new Date().toISOString()
            });

            if (!verificationResult.success) {
                throw new WalletAuthError('Invalid signature verification');
            }

            // Mark nonce as used
            await this._markNonceAsUsed(siweMessage.nonce);

            // Additional security checks
            await this._performSecurityChecks(siweMessage, signature, options);

            const authResult = {
                success: true,
                address: siweMessage.address,
                chainId: siweMessage.chainId,
                domain: siweMessage.domain,
                issuedAt: siweMessage.issuedAt,
                expirationTime: siweMessage.expirationTime,
                verifiedAt: Date.now(),
                sessionId: crypto.randomUUID()
            };

            await this.securityLogger.logSuccessfulAuth?.({
                address,
                chainId: siweMessage.chainId,
                verifiedAt: authResult.verifiedAt
            });

            return authResult;

        } catch (error) {
            await this.securityLogger.logFailedAuth?.({
                address,
                error: error.message,
                message: message?.substring(0, 100) // Log partial message for debugging
            });
            throw error;
        }
    }

    /**
     * Generate Sign-In with Ethereum (SIWE) message
     * @param {string} address Ethereum address
     * @param {string} nonce Unique nonce
     * @param {number} timestamp Current timestamp
     * @param {Object} options Additional options
     * @returns {string} SIWE message
     */
    generateSiweMessage(address, nonce, timestamp = Date.now(), options = {}) {
        const issuedAt = new Date(timestamp).toISOString();
        const expirationTime = new Date(timestamp + this.config.sessionDuration).toISOString();
        
        const siweMessage = new SiweMessage({
            domain: this.config.domain,
            address,
            statement: options.statement || this.config.statementTemplate,
            uri: this.config.origin,
            version: this.config.version,
            chainId: options.chainId || this.config.chainId,
            nonce,
            issuedAt,
            expirationTime,
            notBefore: issuedAt,
            requestId: options.requestId || null,
            resources: options.resources || []
        });

        return siweMessage.prepareMessage();
    }

    /**
     * Verify ENS name ownership (if ENS resolver is available)
     * @param {string} address Ethereum address
     * @param {string} ensName ENS name to verify
     * @returns {Promise<boolean>} True if address owns ENS name
     */
    async verifyENSOwnership(address, ensName) {
        if (!this.ensResolver) {
            return false;
        }

        try {
            const resolvedAddress = await this.ensResolver.resolveName(ensName);
            return resolvedAddress?.toLowerCase() === address.toLowerCase();
        } catch (error) {
            console.warn('ENS verification failed:', error);
            return false;
        }
    }

    /**
     * Get wallet authentication statistics
     * @returns {Object} Authentication statistics
     */
    getWalletAuthStats() {
        const now = Date.now();
        const activeNonces = Array.from(this.nonces.values())
            .filter(n => !n.used && n.expiresAt > now).length;
        
        return {
            activeNonces,
            totalNonces: this.nonces.size,
            addressesWithNonces: this.addressNonces.size,
            supportedChains: this.config.supportedChains,
            nonceExpiry: this.config.nonceExpiry,
            sessionDuration: this.config.sessionDuration
        };
    }

    // =============================================================================
    // PRIVATE HELPER METHODS
    // =============================================================================

    /**
     * Build SIWE message for given parameters
     * @param {string} address Ethereum address
     * @param {string} nonce Unique nonce
     * @param {number} timestamp Current timestamp
     * @returns {string} SIWE message
     * @private
     */
    _buildSiweMessage(address, nonce, timestamp) {
        return this.generateSiweMessage(address, nonce, timestamp);
    }

    /**
     * Validate SIWE message structure and content
     * @param {SiweMessage} siweMessage Parsed SIWE message
     * @param {string} expectedAddress Expected Ethereum address
     * @private
     */
    async _validateSiweMessage(siweMessage, expectedAddress) {
        // Check address match
        if (siweMessage.address.toLowerCase() !== expectedAddress.toLowerCase()) {
            throw new WalletAuthError('Address mismatch in SIWE message');
        }

        // Check domain
        if (siweMessage.domain !== this.config.domain) {
            throw new WalletAuthError('Invalid domain in SIWE message');
        }

        // Check chain ID if required
        if (this.config.requireValidChain) {
            if (!this.config.supportedChains.includes(siweMessage.chainId)) {
                throw new WalletAuthError(`Unsupported chain ID: ${siweMessage.chainId}`);
            }
        }

        // Check expiration
        if (siweMessage.expirationTime) {
            const expirationTime = new Date(siweMessage.expirationTime).getTime();
            if (Date.now() > expirationTime) {
                throw new WalletAuthError('SIWE message has expired');
            }
        }

        // Check not before time
        if (siweMessage.notBefore) {
            const notBeforeTime = new Date(siweMessage.notBefore).getTime();
            if (Date.now() < notBeforeTime) {
                throw new WalletAuthError('SIWE message not yet valid');
            }
        }

        // Check URI
        if (siweMessage.uri !== this.config.origin) {
            throw new WalletAuthError('Invalid URI in SIWE message');
        }
    }

    /**
     * Verify nonce validity and prevent replay attacks
     * @param {string} nonce Nonce from SIWE message
     * @param {string} address Ethereum address
     * @private
     */
    async _verifyNonce(nonce, address) {
        const nonceData = this.nonces.get(nonce);
        
        if (!nonceData) {
            throw new WalletAuthError('Invalid or expired nonce');
        }

        if (nonceData.used) {
            throw new WalletAuthError('Nonce already used (replay attack detected)');
        }

        if (Date.now() > nonceData.expiresAt) {
            throw new WalletAuthError('Nonce has expired');
        }

        if (nonceData.address !== address.toLowerCase()) {
            throw new WalletAuthError('Nonce issued for different address');
        }
    }

    /**
     * Mark nonce as used to prevent replay attacks
     * @param {string} nonce Nonce to mark as used
     * @private
     */
    async _markNonceAsUsed(nonce) {
        const nonceData = this.nonces.get(nonce);
        if (nonceData) {
            nonceData.used = true;
            nonceData.usedAt = Date.now();
        }
    }

    /**
     * Perform additional security checks
     * @param {SiweMessage} siweMessage SIWE message
     * @param {string} signature Wallet signature
     * @param {Object} options Verification options
     * @private
     */
    async _performSecurityChecks(siweMessage, signature, options) {
        // Check for suspicious patterns
        await this._checkSuspiciousActivity(siweMessage.address);
        
        // Validate signature format
        if (!ethers.utils.isHexString(signature, 65)) {
            throw new WalletAuthError('Invalid signature format');
        }

        // Check timestamp freshness (prevent old message replay)
        if (siweMessage.issuedAt) {
            const issuedAt = new Date(siweMessage.issuedAt).getTime();
            const maxAge = 300000; // 5 minutes
            if (Date.now() - issuedAt > maxAge) {
                throw new WalletAuthError('SIWE message too old');
            }
        }

        // Rate limiting check (if enabled)
        if (options.checkRateLimit) {
            await this._checkRateLimit(siweMessage.address);
        }
    }

    /**
     * Check for suspicious authentication activity
     * @param {string} address Ethereum address
     * @private
     */
    async _checkSuspiciousActivity(address) {
        const addressNonces = this.addressNonces.get(address.toLowerCase());
        if (!addressNonces) return;

        // Check for excessive nonce generation
        const recentNonces = Array.from(this.nonces.values())
            .filter(n => n.address === address.toLowerCase() && 
                        Date.now() - n.timestamp < 3600000); // Last hour

        if (recentNonces.length > 20) { // More than 20 nonces in an hour
            await this.securityLogger.logSuspiciousActivity?.({
                address,
                reason: 'excessive_nonce_generation',
                count: recentNonces.length
            });
        }
    }

    /**
     * Check rate limiting for address
     * @param {string} address Ethereum address
     * @private
     */
    async _checkRateLimit(address) {
        // Implementation would check rate limits in Redis or database
        // For now, this is a placeholder
        const recentAttempts = Array.from(this.nonces.values())
            .filter(n => n.address === address.toLowerCase() && 
                        n.used && Date.now() - n.usedAt < 60000); // Last minute

        if (recentAttempts.length > 5) { // More than 5 successful auths per minute
            throw new WalletAuthError('Rate limit exceeded');
        }
    }

    /**
     * Start nonce cleanup process
     * @private
     */
    _startNonceCleanup() {
        // Clean up expired nonces every 5 minutes
        setInterval(() => {
            this._cleanupExpiredNonces();
        }, 300000);
    }

    /**
     * Clean up expired nonces
     * @private
     */
    _cleanupExpiredNonces() {
        const now = Date.now();
        const expiredNonces = [];

        for (const [nonce, data] of this.nonces.entries()) {
            if (now > data.expiresAt + 3600000) { // Keep for 1 hour after expiry for logging
                expiredNonces.push(nonce);
            }
        }

        for (const nonce of expiredNonces) {
            const data = this.nonces.get(nonce);
            this.nonces.delete(nonce);
            
            // Clean up from address mapping
            const addressNonces = this.addressNonces.get(data.address);
            if (addressNonces) {
                addressNonces.delete(nonce);
                if (addressNonces.size === 0) {
                    this.addressNonces.delete(data.address);
                }
            }
        }

        if (expiredNonces.length > 0) {
            console.log(`Cleaned up ${expiredNonces.length} expired nonces`);
        }
    }

    // =============================================================================
    // ADVANCED WALLET FEATURES
    // =============================================================================

    /**
     * Verify contract wallet signature (EIP-1271)
     * @param {string} contractAddress Contract wallet address
     * @param {string} signature Signature from contract
     * @param {string} message Original message
     * @param {Object} provider Ethereum provider
     * @returns {Promise<boolean>} True if signature is valid
     */
    async verifyContractSignature(contractAddress, signature, message, provider) {
        try {
            // EIP-1271 standard interface
            const EIP1271_INTERFACE = new ethers.utils.Interface([
                'function isValidSignature(bytes32 _hash, bytes _signature) view returns (bytes4)'
            ]);

            const contract = new ethers.Contract(contractAddress, EIP1271_INTERFACE, provider);
            const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(message));
            
            const result = await contract.isValidSignature(messageHash, signature);
            
            // EIP-1271 magic value for valid signature
            const EIP1271_MAGIC_VALUE = '0x1626ba7e';
            
            return result === EIP1271_MAGIC_VALUE;

        } catch (error) {
            console.error('Contract signature verification failed:', error);
            return false;
        }
    }

    /**
     * Generate typed data for EIP-712 signing
     * @param {string} address Ethereum address
     * @param {string} nonce Unique nonce
     * @param {Object} additionalData Additional typed data
     * @returns {Object} EIP-712 typed data
     */
    generateTypedData(address, nonce, additionalData = {}) {
        const domain = {
            name: 'DEX Platform',
            version: this.config.version,
            chainId: this.config.chainId,
            verifyingContract: additionalData.verifyingContract || ethers.constants.AddressZero
        };

        const types = {
            Authentication: [
                { name: 'address', type: 'address' },
                { name: 'nonce', type: 'string' },
                { name: 'timestamp', type: 'uint256' },
                { name: 'purpose', type: 'string' }
            ]
        };

        const value = {
            address,
            nonce,
            timestamp: Math.floor(Date.now() / 1000),
            purpose: additionalData.purpose || 'Sign in to DEX Platform'
        };

        return {
            domain,
            types,
            value,
            primaryType: 'Authentication'
        };
    }

    /**
     * Verify EIP-712 typed data signature
     * @param {Object} typedData EIP-712 typed data
     * @param {string} signature Signature
     * @param {string} expectedAddress Expected signer address
     * @returns {Promise<boolean>} True if signature is valid
     */
    async verifyTypedDataSignature(typedData, signature, expectedAddress) {
        try {
            const recoveredAddress = ethers.utils.verifyTypedData(
                typedData.domain,
                typedData.types,
                typedData.value,
                signature
            );

            return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();

        } catch (error) {
            console.error('Typed data signature verification failed:', error);
            return false;
        }
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get health status of wallet authentication system
     * @returns {Object} Health status
     */
    getHealthStatus() {
        const now = Date.now();
        const activeNonces = Array.from(this.nonces.values())
            .filter(n => !n.used && n.expiresAt > now).length;
        
        return {
            status: 'healthy',
            activeNonces,
            totalAddresses: this.addressNonces.size,
            nonceCleanupRunning: true,
            supportedChains: this.config.supportedChains,
            lastCleanup: now
        };
    }

    /**
     * Clear all nonces for an address (security measure)
     * @param {string} address Ethereum address
     * @returns {number} Number of nonces cleared
     */
    async clearNoncesForAddress(address) {
        const addressNonces = this.addressNonces.get(address.toLowerCase());
        if (!addressNonces) return 0;

        let cleared = 0;
        for (const nonce of addressNonces) {
            this.nonces.delete(nonce);
            cleared++;
        }

        this.addressNonces.delete(address.toLowerCase());

        await this.securityLogger.logNoncesCleared?.({
            address,
            count: cleared
        });

        return cleared;
    }
}

// =============================================================================
// WALLET AUTHENTICATION ERROR CLASS
// =============================================================================

class WalletAuthError extends Error {
    constructor(message, code = 'WALLET_AUTH_ERROR') {
        super(message);
        this.name = 'WalletAuthError';
        this.code = code;
    }
}

module.exports = { 
    WalletAuthentication, 
    WalletAuthError 
};