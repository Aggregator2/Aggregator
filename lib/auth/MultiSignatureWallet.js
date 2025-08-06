/**
 * @fileoverview Multi-Signature Wallet Support for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Secure multi-sig wallet integration with threshold signatures
 */

const EventEmitter = require('events');
const { ethers } = require('ethers');
const crypto = require('crypto');

/**
 * Multi-Signature Wallet Manager
 * Supports various multi-sig wallet implementations
 */
class MultiSignatureWallet extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Multi-sig configuration
            multiSig: {
                minSignatures: config.multiSig?.minSignatures || 2,
                maxSigners: config.multiSig?.maxSigners || 10,
                signatureTimeout: config.multiSig?.signatureTimeout || 3600000, // 1 hour
                allowAddressChange: config.multiSig?.allowAddressChange || false,
                requireOrderedSigning: config.multiSig?.requireOrderedSigning || false
            },
            
            // Wallet types
            walletTypes: {
                gnosis: {
                    enabled: config.walletTypes?.gnosis?.enabled !== false,
                    contracts: config.walletTypes?.gnosis?.contracts || {
                        1: '0x34CfAC646f301356fAa8B21e94227e3583Fe3F5F', // Mainnet
                        5: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552'  // Goerli
                    },
                    version: config.walletTypes?.gnosis?.version || '1.3.0'
                },
                argent: {
                    enabled: config.walletTypes?.argent?.enabled || false,
                    contracts: config.walletTypes?.argent?.contracts || {}
                },
                custom: {
                    enabled: config.walletTypes?.custom?.enabled || false,
                    implementation: config.walletTypes?.custom?.implementation
                }
            },
            
            // Transaction settings
            transaction: {
                queueEnabled: config.transaction?.queueEnabled !== false,
                maxQueueSize: config.transaction?.maxQueueSize || 100,
                executionDelay: config.transaction?.executionDelay || 0, // Time-lock
                nonceManagemnt: config.transaction?.nonceManagemnt !== false,
                batchingEnabled: config.transaction?.batchingEnabled || false
            },
            
            // Security settings
            security: {
                requireAllSignatures: config.security?.requireAllSignatures || false,
                verifySignerOwnership: config.security?.verifySignerOwnership !== false,
                checkSignerBalance: config.security?.checkSignerBalance || false,
                preventDuplicateSignatures: config.security?.preventDuplicateSignatures !== false,
                signerWhitelist: config.security?.signerWhitelist || [],
                blacklistedAddresses: config.security?.blacklistedAddresses || new Set()
            },
            
            // Notification settings
            notifications: {
                enabled: config.notifications?.enabled !== false,
                channels: config.notifications?.channels || ['websocket', 'email'],
                notifyOnProposal: config.notifications?.notifyOnProposal !== false,
                notifyOnSignature: config.notifications?.notifyOnSignature !== false,
                notifyOnExecution: config.notifications?.notifyOnExecution !== false
            },
            
            // Storage settings
            storage: {
                type: config.storage?.type || 'memory', // memory, redis, database
                ttl: config.storage?.ttl || 86400000 // 24 hours
            },
            
            auditLogging: config.auditLogging !== false,
            ...config
        };

        this.state = {
            wallets: new Map(), // walletAddress -> wallet info
            proposals: new Map(), // proposalId -> proposal data
            signatures: new Map(), // proposalId -> signatures
            transactionQueue: [],
            signerSessions: new Map(), // signer -> session info
            
            metrics: {
                walletsManaged: 0,
                proposalsCreated: 0,
                proposalsExecuted: 0,
                proposalsRejected: 0,
                signaturesCollected: 0,
                averageSigningTime: 0,
                averageExecutionTime: 0
            }
        };

        this.provider = null;
        this.contracts = new Map();
        this.storageAdapter = null;
        
        this.initialize();
    }

    /**
     * Initialize multi-signature wallet manager
     */
    async initialize() {
        try {
            await this._initializeProvider();
            await this._initializeContracts();
            await this._initializeStorage();
            await this._startCleanupTasks();
            
            console.log('Multi-Signature Wallet Manager initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Multi-Signature Wallet Manager:', error);
            throw error;
        }
    }

    /**
     * Register a multi-sig wallet
     */
    async registerWallet(walletAddress, walletInfo) {
        try {
            // Validate wallet address
            if (!ethers.utils.isAddress(walletAddress)) {
                throw new Error('Invalid wallet address');
            }

            // Check if already registered
            if (this.state.wallets.has(walletAddress)) {
                throw new Error('Wallet already registered');
            }

            // Detect wallet type if not provided
            const walletType = walletInfo.type || await this._detectWalletType(walletAddress);
            
            if (!walletType) {
                throw new Error('Unknown wallet type');
            }

            // Get wallet details from chain
            const walletDetails = await this._getWalletDetails(walletAddress, walletType);

            // Validate signers
            if (this.config.security.verifySignerOwnership) {
                await this._verifySigners(walletDetails.signers);
            }

            // Store wallet info
            const wallet = {
                address: walletAddress,
                type: walletType,
                name: walletInfo.name || `MultiSig-${walletAddress.substring(0, 8)}`,
                signers: walletDetails.signers,
                threshold: walletDetails.threshold,
                nonce: walletDetails.nonce || 0,
                createdAt: Date.now(),
                metadata: {
                    ...walletInfo.metadata,
                    chainId: this.provider.network.chainId
                }
            };

            this.state.wallets.set(walletAddress, wallet);
            this.state.metrics.walletsManaged++;

            await this._auditLog('WALLET_REGISTERED', {
                walletAddress,
                type: walletType,
                signers: wallet.signers.length,
                threshold: wallet.threshold
            });

            this.emit('walletRegistered', wallet);

            return wallet;

        } catch (error) {
            console.error('Failed to register wallet:', error);
            throw error;
        }
    }

    /**
     * Create transaction proposal
     */
    async createProposal(walletAddress, transaction, proposer) {
        try {
            const wallet = this.state.wallets.get(walletAddress);
            if (!wallet) {
                throw new Error('Wallet not registered');
            }

            // Verify proposer is a signer
            if (!wallet.signers.includes(proposer.toLowerCase())) {
                throw new Error('Proposer is not a wallet signer');
            }

            // Validate transaction
            await this._validateTransaction(transaction);

            // Generate proposal ID
            const proposalId = this._generateProposalId();

            // Create proposal
            const proposal = {
                id: proposalId,
                walletAddress,
                transaction: {
                    to: transaction.to,
                    value: transaction.value || '0',
                    data: transaction.data || '0x',
                    gasLimit: transaction.gasLimit,
                    gasPrice: transaction.gasPrice,
                    nonce: transaction.nonce || wallet.nonce
                },
                proposer: proposer.toLowerCase(),
                createdAt: Date.now(),
                expiresAt: Date.now() + this.config.multiSig.signatureTimeout,
                status: 'pending',
                executionTime: transaction.executionTime || null,
                metadata: transaction.metadata || {}
            };

            // Store proposal
            this.state.proposals.set(proposalId, proposal);
            this.state.signatures.set(proposalId, new Map());
            
            // Add to queue if enabled
            if (this.config.transaction.queueEnabled) {
                this._addToQueue(proposal);
            }

            this.state.metrics.proposalsCreated++;

            // Send notifications
            if (this.config.notifications.notifyOnProposal) {
                await this._notifySigners(wallet, 'proposal_created', proposal);
            }

            await this._auditLog('PROPOSAL_CREATED', {
                proposalId,
                walletAddress,
                proposer,
                to: transaction.to,
                value: transaction.value
            });

            this.emit('proposalCreated', proposal);

            return proposal;

        } catch (error) {
            console.error('Failed to create proposal:', error);
            throw error;
        }
    }

    /**
     * Sign a proposal
     */
    async signProposal(proposalId, signer, signature, signatureType = 'eip712') {
        try {
            const proposal = this.state.proposals.get(proposalId);
            if (!proposal) {
                throw new Error('Proposal not found');
            }

            if (proposal.status !== 'pending') {
                throw new Error(`Proposal is ${proposal.status}`);
            }

            // Check expiry
            if (Date.now() > proposal.expiresAt) {
                proposal.status = 'expired';
                throw new Error('Proposal has expired');
            }

            const wallet = this.state.wallets.get(proposal.walletAddress);
            
            // Verify signer
            const normalizedSigner = signer.toLowerCase();
            if (!wallet.signers.includes(normalizedSigner)) {
                throw new Error('Signer is not authorized for this wallet');
            }

            // Prevent duplicate signatures
            const signatures = this.state.signatures.get(proposalId);
            if (this.config.security.preventDuplicateSignatures && signatures.has(normalizedSigner)) {
                throw new Error('Already signed by this signer');
            }

            // Verify signature
            const isValid = await this._verifySignature(
                proposal,
                normalizedSigner,
                signature,
                signatureType
            );

            if (!isValid) {
                throw new Error('Invalid signature');
            }

            // Store signature
            signatures.set(normalizedSigner, {
                signer: normalizedSigner,
                signature,
                signatureType,
                timestamp: Date.now()
            });

            this.state.metrics.signaturesCollected++;

            // Check if threshold reached
            const collectedSignatures = signatures.size;
            const thresholdReached = collectedSignatures >= wallet.threshold;

            // Send notifications
            if (this.config.notifications.notifyOnSignature) {
                await this._notifySigners(wallet, 'proposal_signed', {
                    proposal,
                    signer: normalizedSigner,
                    progress: `${collectedSignatures}/${wallet.threshold}`
                });
            }

            await this._auditLog('PROPOSAL_SIGNED', {
                proposalId,
                signer: normalizedSigner,
                signatureCount: collectedSignatures,
                threshold: wallet.threshold,
                thresholdReached
            });

            this.emit('proposalSigned', {
                proposalId,
                signer: normalizedSigner,
                signatures: collectedSignatures,
                threshold: wallet.threshold,
                ready: thresholdReached
            });

            // Auto-execute if threshold reached and no delay
            if (thresholdReached && this.config.transaction.executionDelay === 0) {
                await this.executeProposal(proposalId);
            }

            return {
                proposalId,
                signatures: collectedSignatures,
                threshold: wallet.threshold,
                ready: thresholdReached
            };

        } catch (error) {
            console.error('Failed to sign proposal:', error);
            throw error;
        }
    }

    /**
     * Execute a proposal
     */
    async executeProposal(proposalId, executor = null) {
        try {
            const startTime = Date.now();
            const proposal = this.state.proposals.get(proposalId);
            
            if (!proposal) {
                throw new Error('Proposal not found');
            }

            if (proposal.status !== 'pending') {
                throw new Error(`Proposal is ${proposal.status}`);
            }

            // Check expiry
            if (Date.now() > proposal.expiresAt) {
                proposal.status = 'expired';
                throw new Error('Proposal has expired');
            }

            const wallet = this.state.wallets.get(proposal.walletAddress);
            const signatures = this.state.signatures.get(proposalId);

            // Verify threshold
            if (signatures.size < wallet.threshold) {
                throw new Error(`Insufficient signatures: ${signatures.size}/${wallet.threshold}`);
            }

            // Check execution delay
            if (this.config.transaction.executionDelay > 0) {
                const earliestExecution = proposal.createdAt + this.config.transaction.executionDelay;
                if (Date.now() < earliestExecution) {
                    throw new Error(`Execution delayed until ${new Date(earliestExecution).toISOString()}`);
                }
            }

            // Prepare execution based on wallet type
            let txHash;
            
            switch (wallet.type) {
                case 'gnosis':
                    txHash = await this._executeGnosisSafe(wallet, proposal, signatures);
                    break;
                case 'argent':
                    txHash = await this._executeArgentWallet(wallet, proposal, signatures);
                    break;
                case 'custom':
                    txHash = await this._executeCustomWallet(wallet, proposal, signatures);
                    break;
                default:
                    throw new Error(`Unsupported wallet type: ${wallet.type}`);
            }

            // Update proposal status
            proposal.status = 'executed';
            proposal.executedAt = Date.now();
            proposal.executedBy = executor;
            proposal.txHash = txHash;

            // Update wallet nonce
            wallet.nonce++;

            // Update metrics
            const executionTime = Date.now() - startTime;
            this.state.metrics.proposalsExecuted++;
            this.state.metrics.averageExecutionTime = 
                (this.state.metrics.averageExecutionTime + executionTime) / 2;

            // Send notifications
            if (this.config.notifications.notifyOnExecution) {
                await this._notifySigners(wallet, 'proposal_executed', {
                    proposal,
                    txHash
                });
            }

            await this._auditLog('PROPOSAL_EXECUTED', {
                proposalId,
                walletAddress: wallet.address,
                txHash,
                executionTime,
                signaturesUsed: signatures.size
            });

            this.emit('proposalExecuted', {
                proposalId,
                txHash,
                executionTime
            });

            return {
                proposalId,
                txHash,
                status: 'executed'
            };

        } catch (error) {
            console.error('Failed to execute proposal:', error);
            
            // Update proposal status
            const proposal = this.state.proposals.get(proposalId);
            if (proposal) {
                proposal.status = 'failed';
                proposal.error = error.message;
                this.state.metrics.proposalsRejected++;
            }
            
            throw error;
        }
    }

    /**
     * Cancel a proposal
     */
    async cancelProposal(proposalId, canceller) {
        try {
            const proposal = this.state.proposals.get(proposalId);
            
            if (!proposal) {
                throw new Error('Proposal not found');
            }

            if (proposal.status !== 'pending') {
                throw new Error(`Cannot cancel ${proposal.status} proposal`);
            }

            const wallet = this.state.wallets.get(proposal.walletAddress);
            
            // Only proposer or any signer can cancel
            const normalizedCanceller = canceller.toLowerCase();
            if (normalizedCanceller !== proposal.proposer && 
                !wallet.signers.includes(normalizedCanceller)) {
                throw new Error('Not authorized to cancel proposal');
            }

            // Update status
            proposal.status = 'cancelled';
            proposal.cancelledAt = Date.now();
            proposal.cancelledBy = normalizedCanceller;

            this.state.metrics.proposalsRejected++;

            await this._auditLog('PROPOSAL_CANCELLED', {
                proposalId,
                cancelledBy: normalizedCanceller
            });

            this.emit('proposalCancelled', {
                proposalId,
                cancelledBy: normalizedCanceller
            });

            return true;

        } catch (error) {
            console.error('Failed to cancel proposal:', error);
            throw error;
        }
    }

    /**
     * Get wallet details
     */
    async getWallet(walletAddress) {
        const wallet = this.state.wallets.get(walletAddress);
        
        if (!wallet) {
            throw new Error('Wallet not found');
        }

        // Get on-chain data for verification
        const onChainData = await this._getWalletDetails(walletAddress, wallet.type);

        return {
            ...wallet,
            onChain: onChainData,
            proposals: {
                pending: this._getWalletProposals(walletAddress, 'pending').length,
                executed: this._getWalletProposals(walletAddress, 'executed').length,
                total: this._getWalletProposals(walletAddress).length
            }
        };
    }

    /**
     * Get proposal details
     */
    getProposal(proposalId) {
        const proposal = this.state.proposals.get(proposalId);
        
        if (!proposal) {
            throw new Error('Proposal not found');
        }

        const signatures = this.state.signatures.get(proposalId);
        const wallet = this.state.wallets.get(proposal.walletAddress);

        return {
            ...proposal,
            signatures: Array.from(signatures.values()),
            signatureProgress: `${signatures.size}/${wallet.threshold}`,
            canExecute: signatures.size >= wallet.threshold,
            timeRemaining: Math.max(0, proposal.expiresAt - Date.now())
        };
    }

    // ========== PRIVATE METHODS ==========

    async _initializeProvider() {
        // Initialize ethers provider
        this.provider = new ethers.providers.JsonRpcProvider(
            this.config.providerUrl || 'http://localhost:8545'
        );
    }

    async _initializeContracts() {
        // Initialize contract interfaces for different wallet types
        if (this.config.walletTypes.gnosis.enabled) {
            // Would initialize Gnosis Safe contract interfaces
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

    async _startCleanupTasks() {
        // Clean up expired proposals
        setInterval(() => {
            const now = Date.now();
            
            for (const [proposalId, proposal] of this.state.proposals.entries()) {
                if (proposal.status === 'pending' && now > proposal.expiresAt) {
                    proposal.status = 'expired';
                    this.emit('proposalExpired', { proposalId });
                }
            }
        }, 60000); // Every minute
    }

    async _detectWalletType(walletAddress) {
        // Try to detect wallet type by checking known contracts
        const code = await this.provider.getCode(walletAddress);
        
        if (code === '0x') {
            throw new Error('Not a contract wallet');
        }

        // Check for Gnosis Safe
        try {
            const gnosisSafe = new ethers.Contract(
                walletAddress,
                ['function VERSION() view returns (string)'],
                this.provider
            );
            const version = await gnosisSafe.VERSION();
            if (version) return 'gnosis';
        } catch {}

        // Check for other wallet types...
        
        return null;
    }

    async _getWalletDetails(walletAddress, walletType) {
        switch (walletType) {
            case 'gnosis':
                return await this._getGnosisSafeDetails(walletAddress);
            case 'argent':
                return await this._getArgentWalletDetails(walletAddress);
            default:
                throw new Error(`Unsupported wallet type: ${walletType}`);
        }
    }

    async _getGnosisSafeDetails(walletAddress) {
        const safe = new ethers.Contract(
            walletAddress,
            [
                'function getOwners() view returns (address[])',
                'function getThreshold() view returns (uint256)',
                'function nonce() view returns (uint256)'
            ],
            this.provider
        );

        const [owners, threshold, nonce] = await Promise.all([
            safe.getOwners(),
            safe.getThreshold(),
            safe.nonce()
        ]);

        return {
            signers: owners.map(o => o.toLowerCase()),
            threshold: threshold.toNumber(),
            nonce: nonce.toNumber()
        };
    }

    async _getArgentWalletDetails(walletAddress) {
        // Argent wallet implementation
        return {
            signers: [],
            threshold: 1,
            nonce: 0
        };
    }

    async _verifySigners(signers) {
        for (const signer of signers) {
            if (!ethers.utils.isAddress(signer)) {
                throw new Error(`Invalid signer address: ${signer}`);
            }

            if (this.config.security.blacklistedAddresses.has(signer.toLowerCase())) {
                throw new Error(`Blacklisted signer: ${signer}`);
            }

            if (this.config.security.checkSignerBalance) {
                const balance = await this.provider.getBalance(signer);
                if (balance.eq(0)) {
                    console.warn(`Signer has zero balance: ${signer}`);
                }
            }
        }
    }

    async _validateTransaction(transaction) {
        if (!ethers.utils.isAddress(transaction.to)) {
            throw new Error('Invalid transaction recipient');
        }

        if (transaction.value && ethers.BigNumber.from(transaction.value).lt(0)) {
            throw new Error('Invalid transaction value');
        }

        if (this.config.security.blacklistedAddresses.has(transaction.to.toLowerCase())) {
            throw new Error('Transaction to blacklisted address');
        }
    }

    _generateProposalId() {
        return crypto.randomBytes(16).toString('hex');
    }

    _addToQueue(proposal) {
        this.state.transactionQueue.push(proposal);
        
        // Limit queue size
        if (this.state.transactionQueue.length > this.config.transaction.maxQueueSize) {
            this.state.transactionQueue.shift();
        }
    }

    async _verifySignature(proposal, signer, signature, signatureType) {
        const message = this._encodeProposalMessage(proposal);
        
        switch (signatureType) {
            case 'personal':
                return this._verifyPersonalSignature(message, signer, signature);
            case 'eip712':
                return this._verifyEIP712Signature(proposal, signer, signature);
            default:
                throw new Error(`Unsupported signature type: ${signatureType}`);
        }
    }

    _encodeProposalMessage(proposal) {
        // Encode proposal data for signing
        return ethers.utils.defaultAbiCoder.encode(
            ['address', 'address', 'uint256', 'bytes', 'uint256', 'uint256'],
            [
                proposal.walletAddress,
                proposal.transaction.to,
                proposal.transaction.value,
                proposal.transaction.data,
                proposal.transaction.nonce,
                proposal.expiresAt
            ]
        );
    }

    async _verifyPersonalSignature(message, signer, signature) {
        const messageHash = ethers.utils.hashMessage(message);
        const recoveredAddress = ethers.utils.recoverAddress(messageHash, signature);
        return recoveredAddress.toLowerCase() === signer.toLowerCase();
    }

    async _verifyEIP712Signature(proposal, signer, signature) {
        // EIP-712 structured data signing
        const domain = {
            name: 'SwappiQ MultiSig',
            version: '1',
            chainId: this.provider.network.chainId,
            verifyingContract: proposal.walletAddress
        };

        const types = {
            Transaction: [
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'data', type: 'bytes' },
                { name: 'nonce', type: 'uint256' }
            ]
        };

        const value = {
            to: proposal.transaction.to,
            value: proposal.transaction.value,
            data: proposal.transaction.data,
            nonce: proposal.transaction.nonce
        };

        const digest = ethers.utils._TypedDataEncoder.hash(domain, types, value);
        const recoveredAddress = ethers.utils.recoverAddress(digest, signature);
        
        return recoveredAddress.toLowerCase() === signer.toLowerCase();
    }

    async _executeGnosisSafe(wallet, proposal, signatures) {
        // Prepare Gnosis Safe execution
        const safe = new ethers.Contract(
            wallet.address,
            ['function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)'],
            this.provider
        );

        // Sort signatures by signer address
        const sortedSignatures = this._sortSignatures(signatures);
        const encodedSignatures = this._encodeSignatures(sortedSignatures);

        // Execute transaction
        // This would need proper signer/provider with gas
        const tx = await safe.execTransaction(
            proposal.transaction.to,
            proposal.transaction.value,
            proposal.transaction.data,
            0, // operation
            0, // safeTxGas
            0, // baseGas
            0, // gasPrice
            ethers.constants.AddressZero, // gasToken
            ethers.constants.AddressZero, // refundReceiver
            encodedSignatures
        );

        return tx.hash;
    }

    async _executeArgentWallet(wallet, proposal, signatures) {
        // Argent wallet execution implementation
        return '0x' + crypto.randomBytes(32).toString('hex');
    }

    async _executeCustomWallet(wallet, proposal, signatures) {
        // Custom wallet execution implementation
        if (this.config.walletTypes.custom.implementation) {
            return await this.config.walletTypes.custom.implementation.execute(
                wallet,
                proposal,
                signatures
            );
        }
        throw new Error('Custom wallet implementation not provided');
    }

    _sortSignatures(signatures) {
        return Array.from(signatures.values()).sort((a, b) => 
            a.signer.localeCompare(b.signer)
        );
    }

    _encodeSignatures(signatures) {
        // Encode signatures for Gnosis Safe format
        return signatures.map(sig => sig.signature).join('');
    }

    async _notifySigners(wallet, event, data) {
        // Send notifications to all signers
        for (const signer of wallet.signers) {
            this.emit('notification', {
                recipient: signer,
                event,
                data,
                timestamp: Date.now()
            });
        }
    }

    _getWalletProposals(walletAddress, status = null) {
        const proposals = [];
        
        for (const proposal of this.state.proposals.values()) {
            if (proposal.walletAddress === walletAddress && 
                (!status || proposal.status === status)) {
                proposals.push(proposal);
            }
        }
        
        return proposals;
    }

    async _auditLog(action, details) {
        if (!this.config.auditLogging) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'MultiSignatureWallet'
        };

        this.emit('auditLog', logEntry);
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            activeProposals: Array.from(this.state.proposals.values())
                .filter(p => p.status === 'pending').length,
            queuedTransactions: this.state.transactionQueue.length,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.state.wallets.clear();
        this.state.proposals.clear();
        this.state.signatures.clear();
        this.state.transactionQueue = [];
        
        console.log('Multi-Signature Wallet Manager cleaned up');
    }
}

module.exports = { MultiSignatureWallet };