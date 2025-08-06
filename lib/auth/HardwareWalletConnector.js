/**
 * @fileoverview Hardware Wallet Integration for Ledger and Trezor
 * @author SwappiQ Protocol
 * @description Secure hardware wallet connectivity and transaction signing
 */

const EventEmitter = require('events');
const { ethers } = require('ethers');
const Transport = require('@ledgerhq/hw-transport-node-hid').default;
const AppEth = require('@ledgerhq/hw-app-eth').default;
const TrezorConnect = require('@trezor/connect').default;

/**
 * Hardware Wallet Connector
 * Supports Ledger and Trezor hardware wallets
 */
class HardwareWalletConnector extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Device settings
            devices: {
                ledger: {
                    enabled: config.devices?.ledger?.enabled !== false,
                    derivationPaths: config.devices?.ledger?.derivationPaths || [
                        "m/44'/60'/0'/0/0", // Ethereum default
                        "m/44'/60'/0'/0",   // Legacy
                        "m/44'/60'/1'/0/0", // Second account
                    ],
                    timeout: config.devices?.ledger?.timeout || 30000,
                    scrambleKey: config.devices?.ledger?.scrambleKey || 'w0w'
                },
                trezor: {
                    enabled: config.devices?.trezor?.enabled !== false,
                    manifest: config.devices?.trezor?.manifest || {
                        email: 'support@swappiq.protocol',
                        appUrl: 'https://swappiq.protocol'
                    },
                    derivationPaths: config.devices?.trezor?.derivationPaths || [
                        "m/44'/60'/0'/0/0"
                    ],
                    timeout: config.devices?.trezor?.timeout || 30000
                }
            },
            
            // Connection settings
            connection: {
                autoReconnect: config.connection?.autoReconnect !== false,
                reconnectInterval: config.connection?.reconnectInterval || 5000,
                maxReconnectAttempts: config.connection?.maxReconnectAttempts || 5,
                keepAlive: config.connection?.keepAlive !== false,
                keepAliveInterval: config.connection?.keepAliveInterval || 30000
            },
            
            // Transaction settings
            transaction: {
                confirmationTimeout: config.transaction?.confirmationTimeout || 60000,
                gasLimit: config.transaction?.gasLimit || 'auto',
                gasPriceMultiplier: config.transaction?.gasPriceMultiplier || 1.1,
                maxFeePerGas: config.transaction?.maxFeePerGas,
                maxPriorityFeePerGas: config.transaction?.maxPriorityFeePerGas
            },
            
            // Security settings
            security: {
                requireConfirmation: config.security?.requireConfirmation !== false,
                verifyAddresses: config.security?.verifyAddresses !== false,
                messagePrefix: config.security?.messagePrefix || '\x19Ethereum Signed Message:\n',
                allowBlindSigning: config.security?.allowBlindSigning || false
            },
            
            // UI settings
            ui: {
                showProgress: config.ui?.showProgress !== false,
                language: config.ui?.language || 'en',
                theme: config.ui?.theme || 'light'
            },
            
            auditLogging: config.auditLogging !== false,
            ...config
        };

        this.state = {
            connected: false,
            deviceType: null,
            currentDevice: null,
            transport: null,
            appEth: null,
            addresses: new Map(), // path -> address
            publicKeys: new Map(), // path -> publicKey
            
            metrics: {
                connectionsEstablished: 0,
                transactionsSigned: 0,
                messagesSigned: 0,
                errors: 0,
                averageSigningTime: 0
            }
        };

        this.reconnectTimer = null;
        this.keepAliveTimer = null;
        this.reconnectAttempts = 0;
        
        this.initialize();
    }

    /**
     * Initialize hardware wallet connector
     */
    async initialize() {
        try {
            // Initialize Trezor if enabled
            if (this.config.devices.trezor.enabled) {
                await this._initializeTrezor();
            }

            // Set up event handlers
            this._setupEventHandlers();

            console.log('Hardware Wallet Connector initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Hardware Wallet Connector:', error);
            throw error;
        }
    }

    /**
     * Connect to hardware wallet
     */
    async connect(deviceType = 'auto') {
        try {
            if (this.state.connected) {
                await this.disconnect();
            }

            let connected = false;

            if (deviceType === 'auto' || deviceType === 'ledger') {
                connected = await this._connectLedger();
                if (connected) {
                    this.state.deviceType = 'ledger';
                }
            }

            if (!connected && (deviceType === 'auto' || deviceType === 'trezor')) {
                connected = await this._connectTrezor();
                if (connected) {
                    this.state.deviceType = 'trezor';
                }
            }

            if (!connected) {
                throw new Error('No hardware wallet detected');
            }

            this.state.connected = true;
            this.state.metrics.connectionsEstablished++;
            
            // Start keep-alive if enabled
            if (this.config.connection.keepAlive) {
                this._startKeepAlive();
            }

            await this._auditLog('DEVICE_CONNECTED', {
                deviceType: this.state.deviceType,
                timestamp: Date.now()
            });

            this.emit('connected', {
                deviceType: this.state.deviceType
            });

            return {
                connected: true,
                deviceType: this.state.deviceType
            };

        } catch (error) {
            console.error('Hardware wallet connection failed:', error);
            this.state.metrics.errors++;
            
            if (this.config.connection.autoReconnect) {
                this._scheduleReconnect();
            }
            
            throw error;
        }
    }

    /**
     * Disconnect from hardware wallet
     */
    async disconnect() {
        try {
            this._stopKeepAlive();
            this._cancelReconnect();

            if (this.state.transport) {
                await this.state.transport.close();
                this.state.transport = null;
                this.state.appEth = null;
            }

            if (this.state.deviceType === 'trezor') {
                // Trezor cleanup if needed
            }

            this.state.connected = false;
            this.state.deviceType = null;
            this.state.currentDevice = null;
            this.state.addresses.clear();
            this.state.publicKeys.clear();

            await this._auditLog('DEVICE_DISCONNECTED', {
                timestamp: Date.now()
            });

            this.emit('disconnected');

        } catch (error) {
            console.error('Disconnect error:', error);
            throw error;
        }
    }

    /**
     * Get addresses from hardware wallet
     */
    async getAddresses(count = 5, startIndex = 0) {
        try {
            if (!this.state.connected) {
                throw new Error('No hardware wallet connected');
            }

            const addresses = [];
            const paths = this._getDerivationPaths(this.state.deviceType);

            for (let i = 0; i < Math.min(count, paths.length); i++) {
                const path = paths[startIndex + i] || this._generatePath(startIndex + i);
                const address = await this._getAddress(path);
                
                addresses.push({
                    address,
                    path,
                    index: startIndex + i
                });
            }

            return addresses;

        } catch (error) {
            console.error('Failed to get addresses:', error);
            this.state.metrics.errors++;
            throw error;
        }
    }

    /**
     * Sign transaction with hardware wallet
     */
    async signTransaction(transaction, derivationPath) {
        try {
            if (!this.state.connected) {
                throw new Error('No hardware wallet connected');
            }

            const startTime = Date.now();

            // Prepare transaction
            const tx = await this._prepareTransaction(transaction);

            // Show transaction details if confirmation required
            if (this.config.security.requireConfirmation) {
                this.emit('confirmationRequired', {
                    type: 'transaction',
                    details: tx
                });
            }

            let signedTx;
            
            if (this.state.deviceType === 'ledger') {
                signedTx = await this._signTransactionLedger(tx, derivationPath);
            } else if (this.state.deviceType === 'trezor') {
                signedTx = await this._signTransactionTrezor(tx, derivationPath);
            }

            const signingTime = Date.now() - startTime;
            this.state.metrics.transactionsSigned++;
            this.state.metrics.averageSigningTime = 
                (this.state.metrics.averageSigningTime + signingTime) / 2;

            await this._auditLog('TRANSACTION_SIGNED', {
                deviceType: this.state.deviceType,
                derivationPath,
                signingTime,
                txHash: ethers.utils.keccak256(signedTx)
            });

            this.emit('transactionSigned', {
                derivationPath,
                txHash: ethers.utils.keccak256(signedTx)
            });

            return signedTx;

        } catch (error) {
            console.error('Transaction signing failed:', error);
            this.state.metrics.errors++;
            throw error;
        }
    }

    /**
     * Sign message with hardware wallet
     */
    async signMessage(message, derivationPath) {
        try {
            if (!this.state.connected) {
                throw new Error('No hardware wallet connected');
            }

            const startTime = Date.now();

            // Show message if confirmation required
            if (this.config.security.requireConfirmation) {
                this.emit('confirmationRequired', {
                    type: 'message',
                    message
                });
            }

            let signature;
            
            if (this.state.deviceType === 'ledger') {
                signature = await this._signMessageLedger(message, derivationPath);
            } else if (this.state.deviceType === 'trezor') {
                signature = await this._signMessageTrezor(message, derivationPath);
            }

            const signingTime = Date.now() - startTime;
            this.state.metrics.messagesSigned++;

            await this._auditLog('MESSAGE_SIGNED', {
                deviceType: this.state.deviceType,
                derivationPath,
                signingTime,
                messageHash: ethers.utils.hashMessage(message)
            });

            this.emit('messageSigned', {
                derivationPath,
                messageHash: ethers.utils.hashMessage(message)
            });

            return signature;

        } catch (error) {
            console.error('Message signing failed:', error);
            this.state.metrics.errors++;
            throw error;
        }
    }

    /**
     * Sign typed data (EIP-712) with hardware wallet
     */
    async signTypedData(domain, types, value, derivationPath) {
        try {
            if (!this.state.connected) {
                throw new Error('No hardware wallet connected');
            }

            // Check if device supports EIP-712
            if (this.state.deviceType === 'ledger' && !this.config.security.allowBlindSigning) {
                throw new Error('Ledger requires blind signing for typed data');
            }

            const typedData = {
                domain,
                types,
                value
            };

            if (this.config.security.requireConfirmation) {
                this.emit('confirmationRequired', {
                    type: 'typedData',
                    data: typedData
                });
            }

            let signature;
            
            if (this.state.deviceType === 'ledger') {
                signature = await this._signTypedDataLedger(typedData, derivationPath);
            } else if (this.state.deviceType === 'trezor') {
                signature = await this._signTypedDataTrezor(typedData, derivationPath);
            }

            await this._auditLog('TYPED_DATA_SIGNED', {
                deviceType: this.state.deviceType,
                derivationPath,
                domain: domain.name
            });

            return signature;

        } catch (error) {
            console.error('Typed data signing failed:', error);
            this.state.metrics.errors++;
            throw error;
        }
    }

    /**
     * Get public key for derivation path
     */
    async getPublicKey(derivationPath) {
        try {
            if (!this.state.connected) {
                throw new Error('No hardware wallet connected');
            }

            // Check cache
            if (this.state.publicKeys.has(derivationPath)) {
                return this.state.publicKeys.get(derivationPath);
            }

            let publicKey;
            
            if (this.state.deviceType === 'ledger') {
                const result = await this.state.appEth.getAddress(derivationPath, false);
                publicKey = result.publicKey;
            } else if (this.state.deviceType === 'trezor') {
                const result = await TrezorConnect.getPublicKey({
                    path: derivationPath,
                    coin: 'eth'
                });
                
                if (!result.success) {
                    throw new Error(result.payload.error);
                }
                
                publicKey = result.payload.publicKey;
            }

            // Cache public key
            this.state.publicKeys.set(derivationPath, publicKey);

            return publicKey;

        } catch (error) {
            console.error('Failed to get public key:', error);
            throw error;
        }
    }

    // ========== PRIVATE METHODS ==========

    async _initializeTrezor() {
        TrezorConnect.init({
            ...this.config.devices.trezor.manifest,
            popup: false,
            webusb: true,
            debug: false
        });
    }

    _setupEventHandlers() {
        // Handle device events
        if (typeof window !== 'undefined' && window.navigator.usb) {
            window.navigator.usb.addEventListener('connect', (event) => {
                this.emit('deviceConnected', { device: event.device });
                if (this.config.connection.autoReconnect && !this.state.connected) {
                    this.connect('auto');
                }
            });

            window.navigator.usb.addEventListener('disconnect', (event) => {
                this.emit('deviceDisconnected', { device: event.device });
                if (this.state.connected) {
                    this.disconnect();
                }
            });
        }
    }

    async _connectLedger() {
        try {
            // Get Ledger transport
            this.state.transport = await Transport.create();
            this.state.appEth = new AppEth(this.state.transport);

            // Test connection
            const test = await this.state.appEth.getAddress("m/44'/60'/0'/0/0", false);
            
            this.state.currentDevice = {
                type: 'ledger',
                version: test.version
            };

            return true;

        } catch (error) {
            console.error('Ledger connection failed:', error);
            return false;
        }
    }

    async _connectTrezor() {
        try {
            const result = await TrezorConnect.getFeatures();
            
            if (!result.success) {
                return false;
            }

            this.state.currentDevice = {
                type: 'trezor',
                features: result.payload
            };

            return true;

        } catch (error) {
            console.error('Trezor connection failed:', error);
            return false;
        }
    }

    async _getAddress(derivationPath) {
        // Check cache
        if (this.state.addresses.has(derivationPath)) {
            return this.state.addresses.get(derivationPath);
        }

        let address;
        
        if (this.state.deviceType === 'ledger') {
            const result = await this.state.appEth.getAddress(
                derivationPath, 
                this.config.security.verifyAddresses
            );
            address = result.address;
        } else if (this.state.deviceType === 'trezor') {
            const result = await TrezorConnect.ethereumGetAddress({
                path: derivationPath,
                showOnTrezor: this.config.security.verifyAddresses
            });
            
            if (!result.success) {
                throw new Error(result.payload.error);
            }
            
            address = result.payload.address;
        }

        // Cache address
        this.state.addresses.set(derivationPath, address);

        return address;
    }

    _getDerivationPaths(deviceType) {
        return this.config.devices[deviceType].derivationPaths;
    }

    _generatePath(index) {
        return `m/44'/60'/0'/0/${index}`;
    }

    async _prepareTransaction(transaction) {
        const tx = { ...transaction };

        // Auto-detect gas limit if needed
        if (this.config.transaction.gasLimit === 'auto' && !tx.gasLimit) {
            // Would need provider to estimate gas
            tx.gasLimit = ethers.BigNumber.from('21000'); // Default for simple transfer
        }

        // Apply gas price multiplier
        if (tx.gasPrice && this.config.transaction.gasPriceMultiplier) {
            tx.gasPrice = ethers.BigNumber.from(tx.gasPrice)
                .mul(Math.floor(this.config.transaction.gasPriceMultiplier * 100))
                .div(100);
        }

        // EIP-1559 support
        if (this.config.transaction.maxFeePerGas) {
            tx.maxFeePerGas = this.config.transaction.maxFeePerGas;
            tx.maxPriorityFeePerGas = this.config.transaction.maxPriorityFeePerGas;
            delete tx.gasPrice;
        }

        return tx;
    }

    async _signTransactionLedger(transaction, derivationPath) {
        const tx = ethers.utils.serializeTransaction(transaction);
        const resolution = await this.state.appEth.resolveTransaction(tx);
        
        const sig = await this.state.appEth.signTransaction(
            derivationPath,
            tx,
            resolution
        );

        const signature = {
            r: '0x' + sig.r,
            s: '0x' + sig.s,
            v: parseInt(sig.v, 16)
        };

        return ethers.utils.serializeTransaction(transaction, signature);
    }

    async _signTransactionTrezor(transaction, derivationPath) {
        const result = await TrezorConnect.ethereumSignTransaction({
            path: derivationPath,
            transaction: {
                to: transaction.to,
                value: transaction.value?.toString() || '0x0',
                gasPrice: transaction.gasPrice?.toString(),
                gasLimit: transaction.gasLimit?.toString(),
                nonce: transaction.nonce?.toString() || '0x0',
                data: transaction.data || '0x',
                chainId: transaction.chainId
            }
        });

        if (!result.success) {
            throw new Error(result.payload.error);
        }

        const sig = result.payload;
        const signature = {
            r: sig.r,
            s: sig.s,
            v: sig.v
        };

        return ethers.utils.serializeTransaction(transaction, signature);
    }

    async _signMessageLedger(message, derivationPath) {
        const messageHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(message));
        const sig = await this.state.appEth.signPersonalMessage(
            derivationPath,
            messageHex.substring(2)
        );

        return ethers.utils.joinSignature({
            r: '0x' + sig.r,
            s: '0x' + sig.s,
            v: parseInt(sig.v, 16)
        });
    }

    async _signMessageTrezor(message, derivationPath) {
        const result = await TrezorConnect.ethereumSignMessage({
            path: derivationPath,
            message: ethers.utils.toUtf8Bytes(message)
        });

        if (!result.success) {
            throw new Error(result.payload.error);
        }

        return result.payload.signature;
    }

    async _signTypedDataLedger(typedData, derivationPath) {
        // Ledger requires EIP-712 hash
        const hash = ethers.utils._TypedDataEncoder.hash(
            typedData.domain,
            typedData.types,
            typedData.value
        );

        const sig = await this.state.appEth.signEIP712HashedMessage(
            derivationPath,
            hash.substring(2)
        );

        return ethers.utils.joinSignature({
            r: '0x' + sig.r,
            s: '0x' + sig.s,
            v: parseInt(sig.v, 16)
        });
    }

    async _signTypedDataTrezor(typedData, derivationPath) {
        const result = await TrezorConnect.ethereumSignTypedData({
            path: derivationPath,
            data: typedData,
            metamask_v4_compat: true
        });

        if (!result.success) {
            throw new Error(result.payload.error);
        }

        return result.payload.signature;
    }

    _startKeepAlive() {
        this.keepAliveTimer = setInterval(async () => {
            try {
                if (this.state.connected && this.state.deviceType === 'ledger') {
                    // Simple command to keep connection alive
                    await this.state.appEth.getAddress("m/44'/60'/0'/0/0", false);
                }
            } catch (error) {
                console.warn('Keep-alive failed:', error);
                this.disconnect();
            }
        }, this.config.connection.keepAliveInterval);
    }

    _stopKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    _scheduleReconnect() {
        if (this.reconnectAttempts >= this.config.connection.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectAttempts++;
            console.log(`Reconnection attempt ${this.reconnectAttempts}`);
            
            try {
                await this.connect('auto');
                this.reconnectAttempts = 0;
            } catch (error) {
                this._scheduleReconnect();
            }
        }, this.config.connection.reconnectInterval);
    }

    _cancelReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempts = 0;
    }

    async _auditLog(action, details) {
        if (!this.config.auditLogging) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'HardwareWalletConnector'
        };

        this.emit('auditLog', logEntry);
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            connected: this.state.connected,
            deviceType: this.state.deviceType,
            cachedAddresses: this.state.addresses.size,
            cachedPublicKeys: this.state.publicKeys.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        await this.disconnect();
        
        console.log('Hardware Wallet Connector cleaned up');
    }
}

module.exports = { HardwareWalletConnector };