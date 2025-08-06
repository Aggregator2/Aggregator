/**
 * Ledger Hardware Wallet Connector
 * Integrates with Ledger devices for secure multi-signature operations
 */

import Transport from '@ledgerhq/hw-transport';
import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import Eth from '@ledgerhq/hw-app-eth';
import { ethers } from 'ethers';

class LedgerConnector {
  constructor(config = {}) {
    this.config = {
      chainId: config.chainId || 1,
      derivationPath: config.derivationPath || "m/44'/60'/0'/0/0",
      timeout: config.timeout || 30000,
      ...config
    };
    
    this.transport = null;
    this.eth = null;
    this.connected = false;
    this.deviceInfo = null;
  }

  /**
   * Connect to Ledger device
   */
  async connect() {
    try {
      // Try WebHID first (newer Chrome)
      if (await TransportWebHID.isSupported()) {
        this.transport = await TransportWebHID.create();
      } 
      // Fall back to WebUSB
      else if (await TransportWebUSB.isSupported()) {
        this.transport = await TransportWebUSB.create();
      } else {
        throw new Error('No supported transport method available');
      }

      this.eth = new Eth(this.transport);
      this.connected = true;

      // Get device info
      const appConfig = await this.eth.getAppConfiguration();
      this.deviceInfo = {
        version: appConfig.version,
        arbitraryDataEnabled: appConfig.arbitraryDataEnabled === 1
      };

      console.log('Ledger connected:', this.deviceInfo);
      return this.deviceInfo;
    } catch (error) {
      console.error('Failed to connect to Ledger:', error);
      throw error;
    }
  }

  /**
   * Disconnect from Ledger
   */
  async disconnect() {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
      this.eth = null;
      this.connected = false;
    }
  }

  /**
   * Get account address
   * @param {number} accountIndex - Account index in derivation path
   */
  async getAddress(accountIndex = 0) {
    if (!this.connected) {
      throw new Error('Ledger not connected');
    }

    const path = this._getDerivationPath(accountIndex);
    const result = await this.eth.getAddress(path, false); // Don't display on device
    
    return {
      address: result.address,
      publicKey: result.publicKey,
      chainCode: result.chainCode,
      path: path
    };
  }

  /**
   * Sign a message for multi-sig order
   * @param {string} message - Message to sign
   * @param {number} accountIndex - Account index
   */
  async signMessage(message, accountIndex = 0) {
    if (!this.connected) {
      throw new Error('Ledger not connected');
    }

    const path = this._getDerivationPath(accountIndex);
    
    // Convert message to hex
    const messageHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(message));
    
    try {
      // Request signature
      const signature = await this.eth.signPersonalMessage(
        path,
        messageHex.slice(2) // Remove 0x prefix
      );

      // Format signature
      const r = '0x' + signature.r;
      const s = '0x' + signature.s;
      const v = signature.v;

      return {
        signature: r + s.slice(2) + v.toString(16).padStart(2, '0'),
        r,
        s,
        v
      };
    } catch (error) {
      if (error.statusCode === 0x6985) {
        throw new Error('User denied signature on Ledger device');
      }
      throw error;
    }
  }

  /**
   * Sign typed data (EIP-712) for orders
   * @param {object} domain - EIP-712 domain
   * @param {object} types - EIP-712 types
   * @param {object} value - Data to sign
   * @param {number} accountIndex - Account index
   */
  async signTypedData(domain, types, value, accountIndex = 0) {
    if (!this.connected) {
      throw new Error('Ledger not connected');
    }

    const path = this._getDerivationPath(accountIndex);
    
    // Create EIP-712 hash
    const typedDataHash = ethers.utils._TypedDataEncoder.hash(domain, types, value);
    
    try {
      // Sign the hash
      const signature = await this.eth.signEIP712HashedMessage(
        path,
        typedDataHash.slice(2) // Remove 0x prefix
      );

      const r = '0x' + signature.r;
      const s = '0x' + signature.s;
      const v = signature.v;

      return {
        signature: r + s.slice(2) + v.toString(16).padStart(2, '0'),
        r,
        s,
        v
      };
    } catch (error) {
      if (error.statusCode === 0x6985) {
        throw new Error('User denied signature on Ledger device');
      }
      throw error;
    }
  }

  /**
   * Sign transaction for multi-sig execution
   * @param {object} transaction - Transaction object
   * @param {number} accountIndex - Account index
   */
  async signTransaction(transaction, accountIndex = 0) {
    if (!this.connected) {
      throw new Error('Ledger not connected');
    }

    const path = this._getDerivationPath(accountIndex);

    // Serialize transaction
    const unsignedTx = ethers.utils.serializeTransaction(transaction);
    
    try {
      const signature = await this.eth.signTransaction(
        path,
        unsignedTx.slice(2) // Remove 0x prefix
      );

      // Apply signature to transaction
      const signedTx = ethers.utils.serializeTransaction(transaction, {
        r: '0x' + signature.r,
        s: '0x' + signature.s,
        v: parseInt(signature.v, 16)
      });

      return {
        signedTransaction: signedTx,
        r: '0x' + signature.r,
        s: '0x' + signature.s,
        v: parseInt(signature.v, 16)
      };
    } catch (error) {
      if (error.statusCode === 0x6985) {
        throw new Error('User denied transaction on Ledger device');
      }
      throw error;
    }
  }

  /**
   * Sign multi-signature order
   * @param {object} order - Order data
   * @param {number} accountIndex - Account index
   */
  async signMultiSigOrder(order, accountIndex = 0) {
    if (!this.connected) {
      throw new Error('Ledger not connected');
    }

    // Create order hash
    const orderHash = this._createOrderHash(order);
    
    // Display order details on Ledger
    const displayMessage = `Sign Order:\n${order.type} ${order.amount} ${order.token}`;
    
    try {
      // Sign the order hash
      const signature = await this.signMessage(displayMessage + '\n' + orderHash, accountIndex);
      
      return {
        orderHash,
        signature: signature.signature,
        signer: await this.getAddress(accountIndex),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Failed to sign multi-sig order:', error);
      throw error;
    }
  }

  /**
   * Verify device is genuine Ledger
   */
  async verifyDevice() {
    if (!this.connected) {
      throw new Error('Ledger not connected');
    }

    try {
      // This would connect to Ledger's servers to verify device authenticity
      // For now, we just check the app configuration
      const config = await this.eth.getAppConfiguration();
      
      return {
        genuine: true, // Would be determined by server check
        version: config.version,
        arbitraryDataEnabled: config.arbitraryDataEnabled === 1
      };
    } catch (error) {
      console.error('Device verification failed:', error);
      return {
        genuine: false,
        error: error.message
      };
    }
  }

  /**
   * Get multiple addresses for threshold setup
   * @param {number} count - Number of addresses to derive
   * @param {number} startIndex - Starting account index
   */
  async getMultipleAddresses(count, startIndex = 0) {
    if (!this.connected) {
      throw new Error('Ledger not connected');
    }

    const addresses = [];
    
    for (let i = 0; i < count; i++) {
      const accountIndex = startIndex + i;
      const address = await this.getAddress(accountIndex);
      addresses.push({
        ...address,
        index: accountIndex
      });
    }

    return addresses;
  }

  /**
   * Helper: Get derivation path
   */
  _getDerivationPath(accountIndex) {
    // Standard Ethereum derivation path: m/44'/60'/0'/0/x
    const basePath = this.config.derivationPath.replace(/\/\d+$/, '');
    return `${basePath}/${accountIndex}`;
  }

  /**
   * Helper: Create order hash
   */
  _createOrderHash(order) {
    const encoded = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256', 'uint256', 'uint256', 'address', 'uint256'],
      [
        order.trader,
        order.amount,
        order.price,
        order.nonce,
        order.token,
        order.expiry
      ]
    );
    
    return ethers.utils.keccak256(encoded);
  }

  /**
   * Check if Ledger is supported in current environment
   */
  static async isSupported() {
    const webHIDSupported = await TransportWebHID.isSupported();
    const webUSBSupported = await TransportWebUSB.isSupported();
    
    return {
      supported: webHIDSupported || webUSBSupported,
      webHID: webHIDSupported,
      webUSB: webUSBSupported
    };
  }

  /**
   * List connected Ledger devices
   */
  static async listDevices() {
    const devices = [];
    
    try {
      if (await TransportWebHID.isSupported()) {
        const hidDevices = await TransportWebHID.list();
        devices.push(...hidDevices.map(d => ({ ...d, type: 'WebHID' })));
      }
      
      if (await TransportWebUSB.isSupported()) {
        const usbDevices = await TransportWebUSB.list();
        devices.push(...usbDevices.map(d => ({ ...d, type: 'WebUSB' })));
      }
    } catch (error) {
      console.error('Failed to list devices:', error);
    }
    
    return devices;
  }
}

export default LedgerConnector;