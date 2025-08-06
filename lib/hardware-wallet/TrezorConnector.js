/**
 * Trezor Hardware Wallet Connector
 * Integrates with Trezor devices for secure multi-signature operations
 */

import TrezorConnect from '@trezor/connect-web';
import { ethers } from 'ethers';

class TrezorConnector {
  constructor(config = {}) {
    this.config = {
      chainId: config.chainId || 1,
      derivationPath: config.derivationPath || "m/44'/60'/0'/0/0",
      manifest: config.manifest || {
        email: 'support@swappiq.com',
        appUrl: 'https://swappiq.com'
      },
      ...config
    };
    
    this.initialized = false;
    this.deviceInfo = null;
  }

  /**
   * Initialize Trezor Connect
   */
  async init() {
    if (this.initialized) return;

    try {
      await TrezorConnect.init({
        lazyLoad: true,
        manifest: this.config.manifest,
        debug: this.config.debug || false
      });

      this.initialized = true;
      console.log('Trezor Connect initialized');
    } catch (error) {
      console.error('Failed to initialize Trezor Connect:', error);
      throw error;
    }
  }

  /**
   * Get device information
   */
  async getDeviceInfo() {
    await this.init();

    const result = await TrezorConnect.getFeatures();

    if (!result.success) {
      throw new Error(result.payload.error);
    }

    this.deviceInfo = {
      id: result.payload.device_id,
      label: result.payload.label,
      model: result.payload.model,
      firmwareVersion: `${result.payload.major_version}.${result.payload.minor_version}.${result.payload.patch_version}`,
      initialized: result.payload.initialized,
      bootloaderMode: result.payload.bootloader_mode
    };

    return this.deviceInfo;
  }

  /**
   * Get Ethereum address
   * @param {number} accountIndex - Account index in derivation path
   * @param {boolean} showOnDevice - Display address on device
   */
  async getAddress(accountIndex = 0, showOnDevice = false) {
    await this.init();

    const path = this._getDerivationPath(accountIndex);
    const result = await TrezorConnect.ethereumGetAddress({
      path,
      showOnTrezor: showOnDevice
    });

    if (!result.success) {
      throw new Error(result.payload.error);
    }

    return {
      address: result.payload.address,
      path: path,
      serializedPath: result.payload.serializedPath
    };
  }

  /**
   * Sign message for multi-sig
   * @param {string} message - Message to sign
   * @param {number} accountIndex - Account index
   */
  async signMessage(message, accountIndex = 0) {
    await this.init();

    const path = this._getDerivationPath(accountIndex);
    
    const result = await TrezorConnect.ethereumSignMessage({
      path,
      message,
      hex: false // Message is not hex encoded
    });

    if (!result.success) {
      if (result.payload.code === 'Failure_ActionCancelled') {
        throw new Error('User cancelled signature on Trezor device');
      }
      throw new Error(result.payload.error);
    }

    // Parse signature
    const signature = result.payload.signature;
    const r = '0x' + signature.slice(0, 64);
    const s = '0x' + signature.slice(64, 128);
    const v = parseInt(signature.slice(128, 130), 16);

    return {
      signature: '0x' + signature,
      r,
      s,
      v,
      address: result.payload.address
    };
  }

  /**
   * Sign typed data (EIP-712)
   * @param {object} data - EIP-712 typed data
   * @param {number} accountIndex - Account index
   */
  async signTypedData(data, accountIndex = 0) {
    await this.init();

    const path = this._getDerivationPath(accountIndex);

    // Trezor requires specific format for EIP-712
    const result = await TrezorConnect.ethereumSignTypedData({
      path,
      data: {
        types: data.types,
        primaryType: data.primaryType,
        domain: data.domain,
        message: data.message
      },
      metamask_v4_compat: true
    });

    if (!result.success) {
      if (result.payload.code === 'Failure_ActionCancelled') {
        throw new Error('User cancelled signature on Trezor device');
      }
      throw new Error(result.payload.error);
    }

    const signature = result.payload.signature;
    const r = '0x' + signature.slice(2, 66);
    const s = '0x' + signature.slice(66, 130);
    const v = parseInt(signature.slice(130, 132), 16);

    return {
      signature,
      r,
      s,
      v,
      address: result.payload.address
    };
  }

  /**
   * Sign transaction
   * @param {object} transaction - Transaction object
   * @param {number} accountIndex - Account index
   */
  async signTransaction(transaction, accountIndex = 0) {
    await this.init();

    const path = this._getDerivationPath(accountIndex);

    // Convert transaction to Trezor format
    const trezorTx = {
      path,
      transaction: {
        to: transaction.to,
        value: ethers.utils.hexlify(transaction.value || 0),
        data: transaction.data || '0x',
        chainId: transaction.chainId || this.config.chainId,
        nonce: ethers.utils.hexlify(transaction.nonce),
        gasLimit: ethers.utils.hexlify(transaction.gasLimit),
        gasPrice: transaction.gasPrice ? ethers.utils.hexlify(transaction.gasPrice) : undefined,
        maxFeePerGas: transaction.maxFeePerGas ? ethers.utils.hexlify(transaction.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ? ethers.utils.hexlify(transaction.maxPriorityFeePerGas) : undefined
      }
    };

    const result = await TrezorConnect.ethereumSignTransaction(trezorTx);

    if (!result.success) {
      if (result.payload.code === 'Failure_ActionCancelled') {
        throw new Error('User cancelled transaction on Trezor device');
      }
      throw new Error(result.payload.error);
    }

    return {
      r: result.payload.r,
      s: result.payload.s,
      v: result.payload.v,
      serialized: ethers.utils.serializeTransaction(transaction, {
        r: result.payload.r,
        s: result.payload.s,
        v: parseInt(result.payload.v)
      })
    };
  }

  /**
   * Sign multi-signature order
   * @param {object} order - Order data
   * @param {number} accountIndex - Account index
   */
  async signMultiSigOrder(order, accountIndex = 0) {
    await this.init();

    // Create EIP-712 typed data for order
    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        Order: [
          { name: 'trader', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'price', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'expiry', type: 'uint256' }
        ]
      },
      primaryType: 'Order',
      domain: {
        name: 'SwappiQ Multi-Sig',
        version: '1',
        chainId: this.config.chainId,
        verifyingContract: order.verifyingContract
      },
      message: {
        trader: order.trader,
        token: order.token,
        amount: order.amount,
        price: order.price,
        nonce: order.nonce,
        expiry: order.expiry
      }
    };

    try {
      const signature = await this.signTypedData(typedData, accountIndex);
      const orderHash = ethers.utils._TypedDataEncoder.hash(
        typedData.domain,
        typedData.types,
        typedData.message
      );

      return {
        orderHash,
        signature: signature.signature,
        signer: signature.address,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Failed to sign multi-sig order:', error);
      throw error;
    }
  }

  /**
   * Get multiple addresses for threshold setup
   * @param {number} count - Number of addresses
   * @param {number} startIndex - Starting index
   */
  async getMultipleAddresses(count, startIndex = 0) {
    await this.init();

    const bundle = [];
    for (let i = 0; i < count; i++) {
      bundle.push({
        path: this._getDerivationPath(startIndex + i),
        showOnTrezor: false
      });
    }

    const result = await TrezorConnect.ethereumGetAddress({ bundle });

    if (!result.success) {
      throw new Error(result.payload.error);
    }

    return result.payload.map((addr, index) => ({
      address: addr.address,
      path: addr.path,
      serializedPath: addr.serializedPath,
      index: startIndex + index
    }));
  }

  /**
   * Sign multiple messages (batch signing)
   * @param {array} messages - Array of messages to sign
   * @param {number} accountIndex - Account index
   */
  async batchSign(messages, accountIndex = 0) {
    await this.init();

    const signatures = [];
    const path = this._getDerivationPath(accountIndex);

    // Trezor doesn't support batch signing natively, so we sign sequentially
    for (const message of messages) {
      try {
        const signature = await this.signMessage(message, accountIndex);
        signatures.push(signature);
      } catch (error) {
        console.error(`Failed to sign message: ${message}`, error);
        signatures.push({ error: error.message });
      }
    }

    return signatures;
  }

  /**
   * Verify device genuineness
   */
  async verifyDevice() {
    await this.init();

    // Get device features
    const features = await TrezorConnect.getFeatures();
    if (!features.success) {
      return {
        genuine: false,
        error: features.payload.error
      };
    }

    // In production, this would verify with Trezor's servers
    // For now, we check basic device properties
    const isGenuine = features.payload.vendor === 'trezor.io' &&
                     features.payload.initialized === true;

    return {
      genuine: isGenuine,
      vendor: features.payload.vendor,
      model: features.payload.model,
      firmwareVersion: `${features.payload.major_version}.${features.payload.minor_version}.${features.payload.patch_version}`
    };
  }

  /**
   * Export public keys for threshold setup
   * @param {number} count - Number of keys to export
   * @param {number} startIndex - Starting index
   */
  async exportPublicKeys(count, startIndex = 0) {
    await this.init();

    const bundle = [];
    for (let i = 0; i < count; i++) {
      bundle.push({
        path: this._getDerivationPath(startIndex + i)
      });
    }

    const result = await TrezorConnect.ethereumGetPublicKey({ bundle });

    if (!result.success) {
      throw new Error(result.payload.error);
    }

    return result.payload.map((key, index) => ({
      publicKey: key.publicKey,
      chainCode: key.chainCode,
      path: key.path,
      index: startIndex + index
    }));
  }

  /**
   * Helper: Get derivation path
   */
  _getDerivationPath(accountIndex) {
    const basePath = this.config.derivationPath.replace(/\/\d+$/, '');
    return `${basePath}/${accountIndex}`;
  }

  /**
   * Check if Trezor is supported
   */
  static isSupported() {
    // Check if we're in a secure context (HTTPS)
    const isSecureContext = window.location.protocol === 'https:' || 
                           window.location.hostname === 'localhost';
    
    // Check browser compatibility
    const isSupportedBrowser = !!(window.crypto && window.crypto.subtle);

    return {
      supported: isSecureContext && isSupportedBrowser,
      secureContext: isSecureContext,
      browserSupport: isSupportedBrowser
    };
  }

  /**
   * Dispose of Trezor connection
   */
  dispose() {
    TrezorConnect.dispose();
    this.initialized = false;
    this.deviceInfo = null;
  }
}

export default TrezorConnector;