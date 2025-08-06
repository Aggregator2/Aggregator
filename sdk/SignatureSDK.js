/**
 * @fileoverview SwappiQ Signature Verification SDK
 * @author SwappiQ Protocol
 * @description JavaScript/TypeScript SDK for interacting with the signature verification system
 */

const ethers = require('ethers');

/**
 * EIP-712 Domain and Type definitions
 */
const DOMAIN_TYPES = {
    name: 'string',
    version: 'string',
    chainId: 'uint256',
    verifyingContract: 'address'
};

const ORDER_TYPES = {
    Order: [
        { name: 'trader', type: 'address' },
        { name: 'baseToken', type: 'address' },
        { name: 'quoteToken', type: 'address' },
        { name: 'side', type: 'uint8' },
        { name: 'amount', type: 'uint256' },
        { name: 'price', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'salt', type: 'uint256' },
        { name: 'chainId', type: 'uint256' }
    ]
};

const MULTISIG_ORDER_TYPES = {
    MultiSigOrder: [
        { name: 'trader', type: 'address' },
        { name: 'baseToken', type: 'address' },
        { name: 'quoteToken', type: 'address' },
        { name: 'side', type: 'uint8' },
        { name: 'amount', type: 'uint256' },
        { name: 'price', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'salt', type: 'uint256' },
        { name: 'chainId', type: 'uint256' },
        { name: 'requiredSignatures', type: 'uint256' },
        { name: 'signers', type: 'address[]' }
    ]
};

const AUTHORIZATION_TYPES = {
    Authorization: [
        { name: 'owner', type: 'address' },
        { name: 'delegate', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'chainId', type: 'uint256' }
    ]
};

const CROSS_CHAIN_TYPES = {
    CrossChainOrder: [
        { name: 'trader', type: 'address' },
        { name: 'baseToken', type: 'address' },
        { name: 'quoteToken', type: 'address' },
        { name: 'side', type: 'uint8' },
        { name: 'amount', type: 'uint256' },
        { name: 'price', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'salt', type: 'uint256' },
        { name: 'sourceChain', type: 'uint256' },
        { name: 'targetChain', type: 'uint256' },
        { name: 'bridgeId', type: 'bytes32' }
    ]
};

/**
 * Hardware wallet device configurations
 */
const HARDWARE_WALLET_CONFIGS = {
    LEDGER: {
        deviceType: 'ledger',
        requiresExtendedDeadline: true,
        deadlineExtension: 300, // 5 minutes
        supportedApps: ['Ethereum', 'Polygon', 'Arbitrum']
    },
    TREZOR: {
        deviceType: 'trezor',
        requiresExtendedDeadline: true,
        deadlineExtension: 300, // 5 minutes
        supportedApps: ['Ethereum', 'Polygon']
    },
    METAMASK: {
        deviceType: 'metamask',
        requiresExtendedDeadline: false,
        deadlineExtension: 0,
        supportedApps: ['Browser Extension']
    }
};

/**
 * SignatureSDK class for managing signature verification
 */
class SignatureSDK {
    /**
     * Constructor
     * @param {Object} config Configuration object
     * @param {string} config.contractAddress Signature verification contract address
     * @param {Object} config.provider Ethers provider
     * @param {string} config.name EIP-712 domain name
     * @param {string} config.version EIP-712 domain version
     * @param {number} config.chainId Chain ID
     */
    constructor(config) {
        this.contractAddress = config.contractAddress;
        this.provider = config.provider;
        this.domain = {
            name: config.name || 'SwappiQ Protocol',
            version: config.version || '1.0.0',
            chainId: config.chainId || 1,
            verifyingContract: config.contractAddress
        };
        
        this.signatureCache = new Map();
        this.hardwareWalletSupport = true;
    }

    /**
     * Create and sign a standard order
     * @param {Object} orderParams Order parameters
     * @param {ethers.Signer} signer Ethers signer
     * @param {Object} options Additional options
     * @returns {Promise<Object>} Signed order object
     */
    async signOrder(orderParams, signer, options = {}) {
        try {
            const order = {
                trader: orderParams.trader,
                baseToken: orderParams.baseToken,
                quoteToken: orderParams.quoteToken,
                side: orderParams.side, // 0 = buy, 1 = sell
                amount: ethers.BigNumber.from(orderParams.amount),
                price: ethers.BigNumber.from(orderParams.price),
                deadline: orderParams.deadline || Math.floor(Date.now() / 1000) + 3600, // 1 hour default
                salt: orderParams.salt || this.generateSalt(),
                chainId: this.domain.chainId
            };

            // Check if hardware wallet and adjust deadline
            const signerAddress = await signer.getAddress();
            if (await this.isHardwareWallet(signerAddress)) {
                const hwConfig = await this.getHardwareWalletConfig(signerAddress);
                if (hwConfig.requiresExtendedDeadline) {
                    order.deadline += HARDWARE_WALLET_CONFIGS[hwConfig.deviceType.toUpperCase()]?.deadlineExtension || 300;
                }
            }

            // Sign with EIP-712
            const signature = await signer._signTypedData(this.domain, ORDER_TYPES, order);
            
            const signedOrder = {
                ...order,
                signature,
                sigType: await this.detectSignatureType(signerAddress)
            };

            // Cache signature for performance
            if (options.cache !== false) {
                this.cacheSignature(signedOrder);
            }

            return signedOrder;
        } catch (error) {
            throw new Error(`Failed to sign order: ${error.message}`);
        }
    }

    /**
     * Create and sign a multi-signature order
     * @param {Object} orderParams Order parameters
     * @param {Array<ethers.Signer>} signers Array of signers
     * @param {number} requiredSignatures Required number of signatures
     * @returns {Promise<Object>} Multi-signed order object
     */
    async signMultiSigOrder(orderParams, signers, requiredSignatures) {
        try {
            const signerAddresses = await Promise.all(
                signers.map(signer => signer.getAddress())
            );

            const order = {
                trader: orderParams.trader, // Multi-sig wallet address
                baseToken: orderParams.baseToken,
                quoteToken: orderParams.quoteToken,
                side: orderParams.side,
                amount: ethers.BigNumber.from(orderParams.amount),
                price: ethers.BigNumber.from(orderParams.price),
                deadline: orderParams.deadline || Math.floor(Date.now() / 1000) + 3600,
                salt: orderParams.salt || this.generateSalt(),
                chainId: this.domain.chainId,
                requiredSignatures: requiredSignatures,
                signers: signerAddresses
            };

            // Sign with each signer
            const signatures = [];
            for (const signer of signers) {
                try {
                    const signature = await signer._signTypedData(this.domain, MULTISIG_ORDER_TYPES, order);
                    signatures.push(signature);
                } catch (error) {
                    console.warn(`Signer ${await signer.getAddress()} failed to sign: ${error.message}`);
                }
            }

            return {
                ...order,
                signatures
            };
        } catch (error) {
            throw new Error(`Failed to sign multi-sig order: ${error.message}`);
        }
    }

    /**
     * Create and sign a cross-chain order
     * @param {Object} orderParams Order parameters including chain info
     * @param {ethers.Signer} signer Ethers signer
     * @returns {Promise<Object>} Signed cross-chain order
     */
    async signCrossChainOrder(orderParams, signer) {
        try {
            const order = {
                trader: orderParams.trader,
                baseToken: orderParams.baseToken,
                quoteToken: orderParams.quoteToken,
                side: orderParams.side,
                amount: ethers.BigNumber.from(orderParams.amount),
                price: ethers.BigNumber.from(orderParams.price),
                deadline: orderParams.deadline || Math.floor(Date.now() / 1000) + 3600,
                salt: orderParams.salt || this.generateSalt(),
                sourceChain: orderParams.sourceChain,
                targetChain: orderParams.targetChain,
                bridgeId: orderParams.bridgeId || ethers.utils.formatBytes32String('default')
            };

            const signature = await signer._signTypedData(this.domain, CROSS_CHAIN_TYPES, order);

            return {
                ...order,
                signature
            };
        } catch (error) {
            throw new Error(`Failed to sign cross-chain order: ${error.message}`);
        }
    }

    /**
     * Sign delegation authorization
     * @param {string} delegate Address to delegate to
     * @param {number} deadline Delegation deadline
     * @param {ethers.Signer} signer Owner signer
     * @returns {Promise<Object>} Signed delegation
     */
    async signDelegation(delegate, deadline, signer) {
        try {
            const owner = await signer.getAddress();
            const nonce = await this.getNonce(owner);

            const authorization = {
                owner,
                delegate,
                deadline: deadline || Math.floor(Date.now() / 1000) + 86400, // 24 hours default
                nonce,
                chainId: this.domain.chainId
            };

            const signature = await signer._signTypedData(this.domain, AUTHORIZATION_TYPES, authorization);

            return {
                ...authorization,
                signature
            };
        } catch (error) {
            throw new Error(`Failed to sign delegation: ${error.message}`);
        }
    }

    /**
     * Register a hardware wallet
     * @param {Object} config Hardware wallet configuration
     * @param {ethers.Signer} signer Owner signer
     * @returns {Promise<string>} Transaction hash
     */
    async registerHardwareWallet(config, signer) {
        try {
            const contract = new ethers.Contract(
                this.contractAddress,
                ['function registerHardwareWallet(address,string,bytes32,bool)'],
                signer
            );

            const deviceId = ethers.utils.formatBytes32String(config.deviceId);
            
            const tx = await contract.registerHardwareWallet(
                config.walletAddress,
                config.deviceType,
                deviceId,
                config.requiresExtendedDeadline || false
            );

            return tx.hash;
        } catch (error) {
            throw new Error(`Failed to register hardware wallet: ${error.message}`);
        }
    }

    /**
     * Register a multi-signature wallet
     * @param {Object} config Multi-sig wallet configuration
     * @param {ethers.Signer} signer Authorized signer
     * @returns {Promise<string>} Transaction hash
     */
    async registerMultiSigWallet(config, signer) {
        try {
            const contract = new ethers.Contract(
                this.contractAddress,
                ['function registerMultiSigWallet(address,uint256,address[])'],
                signer
            );

            const tx = await contract.registerMultiSigWallet(
                config.walletAddress,
                config.requiredSignatures,
                config.signers
            );

            return tx.hash;
        } catch (error) {
            throw new Error(`Failed to register multi-sig wallet: ${error.message}`);
        }
    }

    /**
     * Verify a signature on-chain
     * @param {Object} signedOrder Signed order object
     * @returns {Promise<Object>} Verification result
     */
    async verifySignature(signedOrder) {
        try {
            const contract = new ethers.Contract(
                this.contractAddress,
                ['function verifyOrderSignature((address,address,address,uint8,uint256,uint256,uint256,uint256,uint256,bytes,uint8)) returns (bool,bytes32)'],
                this.provider
            );

            const orderStruct = [
                signedOrder.trader,
                signedOrder.baseToken,
                signedOrder.quoteToken,
                signedOrder.side,
                signedOrder.amount,
                signedOrder.price,
                signedOrder.deadline,
                signedOrder.salt,
                signedOrder.chainId,
                signedOrder.signature,
                signedOrder.sigType || 0
            ];

            const [isValid, signatureHash] = await contract.verifyOrderSignature(orderStruct);

            return {
                isValid,
                signatureHash,
                order: signedOrder
            };
        } catch (error) {
            throw new Error(`Failed to verify signature: ${error.message}`);
        }
    }

    /**
     * Revoke a signature
     * @param {string} signatureHash Hash of signature to revoke
     * @param {ethers.Signer} signer Authorized signer
     * @returns {Promise<string>} Transaction hash
     */
    async revokeSignature(signatureHash, signer) {
        try {
            const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
            const nonce = await this.getNonce(await signer.getAddress());

            const revocation = {
                signatureHash,
                deadline,
                nonce,
                chainId: this.domain.chainId
            };

            const REVOCATION_TYPES = {
                Revocation: [
                    { name: 'signatureHash', type: 'bytes32' },
                    { name: 'deadline', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                    { name: 'chainId', type: 'uint256' }
                ]
            };

            const signature = await signer._signTypedData(this.domain, REVOCATION_TYPES, revocation);

            const contract = new ethers.Contract(
                this.contractAddress,
                ['function revokeSignature(bytes32,uint256,bytes)'],
                signer
            );

            const tx = await contract.revokeSignature(signatureHash, deadline, signature);
            return tx.hash;
        } catch (error) {
            throw new Error(`Failed to revoke signature: ${error.message}`);
        }
    }

    /**
     * Utility functions
     */

    generateSalt() {
        return ethers.BigNumber.from(ethers.utils.randomBytes(32)).toString();
    }

    async getNonce(address) {
        try {
            const contract = new ethers.Contract(
                this.contractAddress,
                ['function nonces(address) view returns (uint256)'],
                this.provider
            );
            return await contract.nonces(address);
        } catch (error) {
            return 0;
        }
    }

    async isHardwareWallet(address) {
        try {
            const contract = new ethers.Contract(
                this.contractAddress,
                ['function hardwareWallets(address) view returns (bool,string,bytes32,address,uint256,bool)'],
                this.provider
            );
            const [isRegistered] = await contract.hardwareWallets(address);
            return isRegistered;
        } catch (error) {
            return false;
        }
    }

    async getHardwareWalletConfig(address) {
        try {
            const contract = new ethers.Contract(
                this.contractAddress,
                ['function getHardwareWalletInfo(address) view returns ((bool,string,bytes32,address,uint256,bool))'],
                this.provider
            );
            return await contract.getHardwareWalletInfo(address);
        } catch (error) {
            return null;
        }
    }

    async detectSignatureType(address) {
        if (await this.isHardwareWallet(address)) {
            return 2; // HARDWARE_WALLET
        }
        
        try {
            const contract = new ethers.Contract(
                this.contractAddress,
                ['function isMultiSigWallet(address) view returns (bool)'],
                this.provider
            );
            const isMultiSig = await contract.isMultiSigWallet(address);
            if (isMultiSig) {
                return 1; // MULTISIG
            }
        } catch (error) {
            // Ignore error
        }
        
        return 0; // STANDARD
    }

    cacheSignature(signedOrder) {
        const cacheKey = this.generateCacheKey(signedOrder);
        const cacheEntry = {
            order: signedOrder,
            timestamp: Date.now(),
            ttl: 3600000 // 1 hour in milliseconds
        };
        this.signatureCache.set(cacheKey, cacheEntry);
    }

    getCachedSignature(orderParams) {
        const cacheKey = this.generateCacheKey(orderParams);
        const cacheEntry = this.signatureCache.get(cacheKey);
        
        if (cacheEntry && (Date.now() - cacheEntry.timestamp) < cacheEntry.ttl) {
            return cacheEntry.order;
        }
        
        this.signatureCache.delete(cacheKey);
        return null;
    }

    generateCacheKey(order) {
        return ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['address', 'address', 'address', 'uint8', 'uint256', 'uint256', 'uint256'],
                [order.trader, order.baseToken, order.quoteToken, order.side, order.amount, order.price, order.deadline]
            )
        );
    }

    clearExpiredCache() {
        const now = Date.now();
        for (const [key, entry] of this.signatureCache.entries()) {
            if ((now - entry.timestamp) >= entry.ttl) {
                this.signatureCache.delete(key);
            }
        }
    }

    /**
     * Hardware wallet specific methods
     */

    async connectLedger(transport) {
        try {
            // This would integrate with @ledgerhq/hw-app-eth
            // Simplified implementation
            const ledgerApp = new LedgerEthApp(transport);
            const result = await ledgerApp.getAddress("44'/60'/0'/0/0");
            
            return {
                address: result.address,
                deviceType: 'ledger',
                deviceId: result.chainCode, // Use chain code as device ID
                requiresExtendedDeadline: true
            };
        } catch (error) {
            throw new Error(`Failed to connect to Ledger: ${error.message}`);
        }
    }

    async connectTrezor() {
        try {
            // This would integrate with @trezor/connect
            // Simplified implementation
            const result = await TrezorConnect.ethereumGetAddress({
                path: "m/44'/60'/0'/0/0"
            });
            
            if (result.success) {
                return {
                    address: result.payload.address,
                    deviceType: 'trezor',
                    deviceId: result.payload.serialNumber,
                    requiresExtendedDeadline: true
                };
            } else {
                throw new Error(result.payload.error);
            }
        } catch (error) {
            throw new Error(`Failed to connect to Trezor: ${error.message}`);
        }
    }

    /**
     * Batch operations for efficiency
     */

    async verifyMultipleSignatures(signedOrders) {
        const results = [];
        
        for (const order of signedOrders) {
            try {
                const result = await this.verifySignature(order);
                results.push(result);
            } catch (error) {
                results.push({
                    isValid: false,
                    error: error.message,
                    order
                });
            }
        }
        
        return results;
    }

    async batchRevokeSignatures(signatureHashes, signer) {
        const results = [];
        
        for (const hash of signatureHashes) {
            try {
                const txHash = await this.revokeSignature(hash, signer);
                results.push({ signatureHash: hash, txHash, success: true });
            } catch (error) {
                results.push({ 
                    signatureHash: hash, 
                    success: false, 
                    error: error.message 
                });
            }
        }
        
        return results;
    }
}

// Export classes and constants
module.exports = {
    SignatureSDK,
    DOMAIN_TYPES,
    ORDER_TYPES,
    MULTISIG_ORDER_TYPES,
    AUTHORIZATION_TYPES,
    CROSS_CHAIN_TYPES,
    HARDWARE_WALLET_CONFIGS
};

// Example usage in comments
/*
// Initialize SDK
const sdk = new SignatureSDK({
    contractAddress: '0x...',
    provider: new ethers.providers.JsonRpcProvider('...'),
    chainId: 1
});

// Sign a standard order
const signer = new ethers.Wallet(privateKey, provider);
const signedOrder = await sdk.signOrder({
    trader: '0x...',
    baseToken: '0x...',
    quoteToken: '0x...',
    side: 0, // buy
    amount: '1000000000000000000', // 1 token
    price: '2000000000000000000000' // 2000 price
}, signer);

// Verify signature
const verification = await sdk.verifySignature(signedOrder);
console.log('Signature valid:', verification.isValid);

// Register hardware wallet
await sdk.registerHardwareWallet({
    walletAddress: '0x...',
    deviceType: 'ledger',
    deviceId: 'device123',
    requiresExtendedDeadline: true
}, signer);
*/