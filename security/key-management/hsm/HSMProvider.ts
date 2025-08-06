import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as pkcs11js from 'pkcs11js';
import { promisify } from 'util';

export interface HSMConfig {
  library: string; // Path to PKCS#11 library
  slot: number;
  pin: string;
  keyLabel: string;
  mechanism: {
    sign: number;
    verify: number;
    encrypt: number;
    decrypt: number;
  };
  retry: {
    attempts: number;
    delay: number;
  };
}

export interface KeyMetadata {
  id: string;
  label: string;
  type: 'EC' | 'RSA' | 'AES';
  algorithm: string;
  size: number;
  created: Date;
  rotatedAt?: Date;
  usage: string[];
  attributes: {
    encrypt: boolean;
    decrypt: boolean;
    sign: boolean;
    verify: boolean;
    wrap: boolean;
    unwrap: boolean;
    derive: boolean;
  };
}

export interface SignatureResult {
  signature: Buffer;
  keyId: string;
  algorithm: string;
  timestamp: number;
}

export class HSMProvider extends EventEmitter {
  private config: HSMConfig;
  private pkcs11: any;
  private session?: any;
  private initialized: boolean = false;
  private keys: Map<string, KeyMetadata> = new Map();
  private operationCount: number = 0;
  private lastHealthCheck: number = 0;

  constructor(config: HSMConfig) {
    super();
    this.config = config;
    this.pkcs11 = new pkcs11js.PKCS11();
  }

  async initialize(): Promise<void> {
    try {
      console.log('🔐 Initializing HSM provider...');
      
      // Load PKCS#11 library
      this.pkcs11.load(this.config.library);
      this.pkcs11.C_Initialize();
      
      // Get slot info
      const slots = this.pkcs11.C_GetSlotList(true);
      if (slots.length === 0) {
        throw new Error('No HSM slots available');
      }
      
      const slotId = this.config.slot < slots.length ? slots[this.config.slot] : slots[0];
      const slotInfo = this.pkcs11.C_GetSlotInfo(slotId);
      console.log(`✅ Connected to HSM: ${slotInfo.manufacturerID}`);
      
      // Open session
      this.session = this.pkcs11.C_OpenSession(
        slotId,
        pkcs11js.CKF_SERIAL_SESSION | pkcs11js.CKF_RW_SESSION
      );
      
      // Login
      this.pkcs11.C_Login(this.session, pkcs11js.CKU_USER, this.config.pin);
      
      // Load existing keys
      await this.loadKeys();
      
      this.initialized = true;
      this.emit('initialized');
      
      // Start health monitoring
      this.startHealthMonitoring();
      
    } catch (error) {
      console.error('❌ HSM initialization failed:', error);
      throw error;
    }
  }

  private async loadKeys(): Promise<void> {
    const template = [
      { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PRIVATE_KEY }
    ];
    
    this.pkcs11.C_FindObjectsInit(this.session, template);
    
    try {
      const handles = this.pkcs11.C_FindObjects(this.session, 100);
      
      for (const handle of handles) {
        const attrs = this.pkcs11.C_GetAttributeValue(this.session, handle, [
          { type: pkcs11js.CKA_ID },
          { type: pkcs11js.CKA_LABEL },
          { type: pkcs11js.CKA_KEY_TYPE },
          { type: pkcs11js.CKA_MODULUS_BITS },
          { type: pkcs11js.CKA_ENCRYPT },
          { type: pkcs11js.CKA_DECRYPT },
          { type: pkcs11js.CKA_SIGN },
          { type: pkcs11js.CKA_VERIFY },
          { type: pkcs11js.CKA_WRAP },
          { type: pkcs11js.CKA_UNWRAP },
          { type: pkcs11js.CKA_DERIVE }
        ]);
        
        const keyId = attrs[0].value.toString('hex');
        const label = attrs[1].value.toString();
        
        const metadata: KeyMetadata = {
          id: keyId,
          label: label,
          type: this.getKeyType(attrs[2].value),
          algorithm: this.getKeyAlgorithm(attrs[2].value),
          size: attrs[3].value || 0,
          created: new Date(), // Would retrieve from HSM if supported
          usage: this.getKeyUsage(attrs),
          attributes: {
            encrypt: attrs[4].value,
            decrypt: attrs[5].value,
            sign: attrs[6].value,
            verify: attrs[7].value,
            wrap: attrs[8].value,
            unwrap: attrs[9].value,
            derive: attrs[10].value
          }
        };
        
        this.keys.set(keyId, metadata);
      }
      
    } finally {
      this.pkcs11.C_FindObjectsFinal(this.session);
    }
    
    console.log(`✅ Loaded ${this.keys.size} keys from HSM`);
  }

  async generateKey(params: {
    label: string;
    type: 'EC' | 'RSA' | 'AES';
    size?: number;
    curve?: string;
    usage: ('sign' | 'verify' | 'encrypt' | 'decrypt' | 'wrap' | 'unwrap' | 'derive')[];
  }): Promise<KeyMetadata> {
    this.ensureInitialized();
    
    console.log(`🔑 Generating ${params.type} key: ${params.label}`);
    
    let publicKeyTemplate: any[] = [];
    let privateKeyTemplate: any[] = [];
    const keyId = crypto.randomBytes(16);
    
    // Common attributes
    const commonAttrs = [
      { type: pkcs11js.CKA_TOKEN, value: true },
      { type: pkcs11js.CKA_PRIVATE, value: true },
      { type: pkcs11js.CKA_ID, value: keyId },
      { type: pkcs11js.CKA_LABEL, value: params.label }
    ];
    
    // Set usage attributes
    const usageAttrs = [
      { type: pkcs11js.CKA_ENCRYPT, value: params.usage.includes('encrypt') },
      { type: pkcs11js.CKA_DECRYPT, value: params.usage.includes('decrypt') },
      { type: pkcs11js.CKA_SIGN, value: params.usage.includes('sign') },
      { type: pkcs11js.CKA_VERIFY, value: params.usage.includes('verify') },
      { type: pkcs11js.CKA_WRAP, value: params.usage.includes('wrap') },
      { type: pkcs11js.CKA_UNWRAP, value: params.usage.includes('unwrap') },
      { type: pkcs11js.CKA_DERIVE, value: params.usage.includes('derive') }
    ];
    
    switch (params.type) {
      case 'RSA':
        publicKeyTemplate = [
          ...commonAttrs,
          { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PUBLIC_KEY },
          { type: pkcs11js.CKA_KEY_TYPE, value: pkcs11js.CKK_RSA },
          { type: pkcs11js.CKA_MODULUS_BITS, value: params.size || 2048 },
          { type: pkcs11js.CKA_PUBLIC_EXPONENT, value: Buffer.from([0x01, 0x00, 0x01]) },
          ...usageAttrs.filter(a => [pkcs11js.CKA_ENCRYPT, pkcs11js.CKA_VERIFY, pkcs11js.CKA_WRAP].includes(a.type))
        ];
        
        privateKeyTemplate = [
          ...commonAttrs,
          { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PRIVATE_KEY },
          { type: pkcs11js.CKA_KEY_TYPE, value: pkcs11js.CKK_RSA },
          { type: pkcs11js.CKA_SENSITIVE, value: true },
          { type: pkcs11js.CKA_EXTRACTABLE, value: false },
          ...usageAttrs.filter(a => [pkcs11js.CKA_DECRYPT, pkcs11js.CKA_SIGN, pkcs11js.CKA_UNWRAP].includes(a.type))
        ];
        break;
        
      case 'EC':
        const curveOid = this.getCurveOid(params.curve || 'P-256');
        publicKeyTemplate = [
          ...commonAttrs,
          { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PUBLIC_KEY },
          { type: pkcs11js.CKA_KEY_TYPE, value: pkcs11js.CKK_EC },
          { type: pkcs11js.CKA_EC_PARAMS, value: curveOid },
          ...usageAttrs.filter(a => [pkcs11js.CKA_VERIFY, pkcs11js.CKA_DERIVE].includes(a.type))
        ];
        
        privateKeyTemplate = [
          ...commonAttrs,
          { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PRIVATE_KEY },
          { type: pkcs11js.CKA_KEY_TYPE, value: pkcs11js.CKK_EC },
          { type: pkcs11js.CKA_SENSITIVE, value: true },
          { type: pkcs11js.CKA_EXTRACTABLE, value: false },
          ...usageAttrs.filter(a => [pkcs11js.CKA_SIGN, pkcs11js.CKA_DERIVE].includes(a.type))
        ];
        break;
        
      case 'AES':
        // AES is a secret key, not a key pair
        const secretKeyTemplate = [
          ...commonAttrs,
          { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_SECRET_KEY },
          { type: pkcs11js.CKA_KEY_TYPE, value: pkcs11js.CKK_AES },
          { type: pkcs11js.CKA_VALUE_LEN, value: (params.size || 256) / 8 },
          { type: pkcs11js.CKA_SENSITIVE, value: true },
          { type: pkcs11js.CKA_EXTRACTABLE, value: false },
          ...usageAttrs.filter(a => [pkcs11js.CKA_ENCRYPT, pkcs11js.CKA_DECRYPT, pkcs11js.CKA_WRAP, pkcs11js.CKA_UNWRAP].includes(a.type))
        ];
        
        const handle = this.pkcs11.C_GenerateKey(
          this.session,
          { mechanism: pkcs11js.CKM_AES_KEY_GEN },
          secretKeyTemplate
        );
        
        const metadata = this.createKeyMetadata(keyId.toString('hex'), params);
        this.keys.set(metadata.id, metadata);
        
        this.emit('key-generated', metadata);
        this.operationCount++;
        
        return metadata;
        
      default:
        throw new Error(`Unsupported key type: ${params.type}`);
    }
    
    // Generate key pair for RSA/EC
    if (params.type !== 'AES') {
      const mechanism = params.type === 'RSA' 
        ? { mechanism: pkcs11js.CKM_RSA_PKCS_KEY_PAIR_GEN }
        : { mechanism: pkcs11js.CKM_EC_KEY_PAIR_GEN };
        
      const { publicKey, privateKey } = this.pkcs11.C_GenerateKeyPair(
        this.session,
        mechanism,
        publicKeyTemplate,
        privateKeyTemplate
      );
    }
    
    const metadata = this.createKeyMetadata(keyId.toString('hex'), params);
    this.keys.set(metadata.id, metadata);
    
    this.emit('key-generated', metadata);
    this.operationCount++;
    
    return metadata;
  }

  async sign(keyId: string, data: Buffer, algorithm?: string): Promise<SignatureResult> {
    this.ensureInitialized();
    
    const metadata = this.keys.get(keyId);
    if (!metadata) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    if (!metadata.attributes.sign) {
      throw new Error(`Key ${keyId} does not have sign capability`);
    }
    
    // Find private key handle
    const keyHandle = await this.findKeyHandle(keyId, pkcs11js.CKO_PRIVATE_KEY);
    
    // Determine mechanism
    const mechanism = algorithm ? this.getMechanism(algorithm) : this.config.mechanism.sign;
    
    // Initialize signing
    this.pkcs11.C_SignInit(this.session, { mechanism }, keyHandle);
    
    // Sign data
    const signature = this.pkcs11.C_Sign(this.session, data);
    
    const result: SignatureResult = {
      signature: Buffer.from(signature),
      keyId,
      algorithm: algorithm || this.getAlgorithmName(mechanism),
      timestamp: Date.now()
    };
    
    this.emit('signature-created', result);
    this.operationCount++;
    
    return result;
  }

  async verify(keyId: string, data: Buffer, signature: Buffer, algorithm?: string): Promise<boolean> {
    this.ensureInitialized();
    
    const metadata = this.keys.get(keyId);
    if (!metadata) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    // Find public key handle
    const keyHandle = await this.findKeyHandle(keyId, pkcs11js.CKO_PUBLIC_KEY);
    
    // Determine mechanism
    const mechanism = algorithm ? this.getMechanism(algorithm) : this.config.mechanism.verify;
    
    try {
      // Initialize verification
      this.pkcs11.C_VerifyInit(this.session, { mechanism }, keyHandle);
      
      // Verify signature
      this.pkcs11.C_Verify(this.session, data, signature);
      
      this.operationCount++;
      return true;
      
    } catch (error) {
      // Verification failed
      return false;
    }
  }

  async encrypt(keyId: string, data: Buffer, algorithm?: string): Promise<Buffer> {
    this.ensureInitialized();
    
    const metadata = this.keys.get(keyId);
    if (!metadata) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    if (!metadata.attributes.encrypt) {
      throw new Error(`Key ${keyId} does not have encrypt capability`);
    }
    
    // Find key handle (public key for RSA, secret key for AES)
    const keyHandle = await this.findKeyHandle(
      keyId,
      metadata.type === 'AES' ? pkcs11js.CKO_SECRET_KEY : pkcs11js.CKO_PUBLIC_KEY
    );
    
    // Determine mechanism
    const mechanism = algorithm ? this.getMechanism(algorithm) : this.config.mechanism.encrypt;
    
    // Initialize encryption
    this.pkcs11.C_EncryptInit(this.session, { mechanism }, keyHandle);
    
    // Encrypt data
    const encrypted = this.pkcs11.C_Encrypt(this.session, data);
    
    this.operationCount++;
    
    return Buffer.from(encrypted);
  }

  async decrypt(keyId: string, data: Buffer, algorithm?: string): Promise<Buffer> {
    this.ensureInitialized();
    
    const metadata = this.keys.get(keyId);
    if (!metadata) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    if (!metadata.attributes.decrypt) {
      throw new Error(`Key ${keyId} does not have decrypt capability`);
    }
    
    // Find key handle (private key for RSA, secret key for AES)
    const keyHandle = await this.findKeyHandle(
      keyId,
      metadata.type === 'AES' ? pkcs11js.CKO_SECRET_KEY : pkcs11js.CKO_PRIVATE_KEY
    );
    
    // Determine mechanism
    const mechanism = algorithm ? this.getMechanism(algorithm) : this.config.mechanism.decrypt;
    
    // Initialize decryption
    this.pkcs11.C_DecryptInit(this.session, { mechanism }, keyHandle);
    
    // Decrypt data
    const decrypted = this.pkcs11.C_Decrypt(this.session, data);
    
    this.operationCount++;
    
    return Buffer.from(decrypted);
  }

  async wrapKey(wrappingKeyId: string, keyToWrapId: string, algorithm?: string): Promise<Buffer> {
    this.ensureInitialized();
    
    const wrappingKey = this.keys.get(wrappingKeyId);
    if (!wrappingKey || !wrappingKey.attributes.wrap) {
      throw new Error(`Wrapping key ${wrappingKeyId} not found or cannot wrap`);
    }
    
    const keyToWrap = this.keys.get(keyToWrapId);
    if (!keyToWrap) {
      throw new Error(`Key to wrap ${keyToWrapId} not found`);
    }
    
    const wrappingHandle = await this.findKeyHandle(wrappingKeyId, pkcs11js.CKO_SECRET_KEY);
    const toWrapHandle = await this.findKeyHandle(keyToWrapId, pkcs11js.CKO_SECRET_KEY);
    
    const mechanism = algorithm ? this.getMechanism(algorithm) : pkcs11js.CKM_AES_KEY_WRAP;
    
    const wrapped = this.pkcs11.C_WrapKey(
      this.session,
      { mechanism },
      wrappingHandle,
      toWrapHandle
    );
    
    this.operationCount++;
    
    return Buffer.from(wrapped);
  }

  async rotateKey(keyId: string): Promise<KeyMetadata> {
    this.ensureInitialized();
    
    const oldKey = this.keys.get(keyId);
    if (!oldKey) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    console.log(`🔄 Rotating key: ${oldKey.label}`);
    
    // Generate new key with same parameters
    const newKey = await this.generateKey({
      label: `${oldKey.label}_rotated_${Date.now()}`,
      type: oldKey.type,
      size: oldKey.size,
      usage: oldKey.usage as any
    });
    
    // Mark old key as rotated
    oldKey.rotatedAt = new Date();
    
    // Archive old key (change label to indicate archived status)
    await this.updateKeyLabel(keyId, `ARCHIVED_${oldKey.label}`);
    
    this.emit('key-rotated', { oldKey, newKey });
    
    return newKey;
  }

  private async findKeyHandle(keyId: string, keyClass: number): Promise<any> {
    const template = [
      { type: pkcs11js.CKA_ID, value: Buffer.from(keyId, 'hex') },
      { type: pkcs11js.CKA_CLASS, value: keyClass }
    ];
    
    this.pkcs11.C_FindObjectsInit(this.session, template);
    
    try {
      const handles = this.pkcs11.C_FindObjects(this.session, 1);
      if (handles.length === 0) {
        throw new Error(`Key handle not found for ${keyId}`);
      }
      return handles[0];
    } finally {
      this.pkcs11.C_FindObjectsFinal(this.session);
    }
  }

  private async updateKeyLabel(keyId: string, newLabel: string): Promise<void> {
    const handle = await this.findKeyHandle(keyId, pkcs11js.CKO_PRIVATE_KEY);
    
    const template = [
      { type: pkcs11js.CKA_LABEL, value: newLabel }
    ];
    
    this.pkcs11.C_SetAttributeValue(this.session, handle, template);
  }

  private createKeyMetadata(keyId: string, params: any): KeyMetadata {
    return {
      id: keyId,
      label: params.label,
      type: params.type,
      algorithm: this.getKeyAlgorithmFromType(params.type, params.curve),
      size: params.size || (params.type === 'EC' ? 256 : 2048),
      created: new Date(),
      usage: params.usage,
      attributes: {
        encrypt: params.usage.includes('encrypt'),
        decrypt: params.usage.includes('decrypt'),
        sign: params.usage.includes('sign'),
        verify: params.usage.includes('verify'),
        wrap: params.usage.includes('wrap'),
        unwrap: params.usage.includes('unwrap'),
        derive: params.usage.includes('derive')
      }
    };
  }

  private getMechanism(algorithm: string): number {
    const mechanisms: { [key: string]: number } = {
      'RSA-PKCS': pkcs11js.CKM_RSA_PKCS,
      'RSA-OAEP': pkcs11js.CKM_RSA_PKCS_OAEP,
      'RSA-PSS': pkcs11js.CKM_RSA_PKCS_PSS,
      'ECDSA': pkcs11js.CKM_ECDSA,
      'ECDSA-SHA256': pkcs11js.CKM_ECDSA_SHA256,
      'AES-CBC': pkcs11js.CKM_AES_CBC,
      'AES-GCM': pkcs11js.CKM_AES_GCM,
      'AES-WRAP': pkcs11js.CKM_AES_KEY_WRAP
    };
    
    return mechanisms[algorithm] || pkcs11js.CKM_RSA_PKCS;
  }

  private getAlgorithmName(mechanism: number): string {
    const names: { [key: number]: string } = {
      [pkcs11js.CKM_RSA_PKCS]: 'RSA-PKCS',
      [pkcs11js.CKM_RSA_PKCS_OAEP]: 'RSA-OAEP',
      [pkcs11js.CKM_RSA_PKCS_PSS]: 'RSA-PSS',
      [pkcs11js.CKM_ECDSA]: 'ECDSA',
      [pkcs11js.CKM_ECDSA_SHA256]: 'ECDSA-SHA256',
      [pkcs11js.CKM_AES_CBC]: 'AES-CBC',
      [pkcs11js.CKM_AES_GCM]: 'AES-GCM'
    };
    
    return names[mechanism] || 'Unknown';
  }

  private getKeyType(keyType: number): 'EC' | 'RSA' | 'AES' {
    switch (keyType) {
      case pkcs11js.CKK_RSA:
        return 'RSA';
      case pkcs11js.CKK_EC:
        return 'EC';
      case pkcs11js.CKK_AES:
        return 'AES';
      default:
        throw new Error(`Unknown key type: ${keyType}`);
    }
  }

  private getKeyAlgorithm(keyType: number): string {
    switch (keyType) {
      case pkcs11js.CKK_RSA:
        return 'RSA';
      case pkcs11js.CKK_EC:
        return 'ECDSA';
      case pkcs11js.CKK_AES:
        return 'AES';
      default:
        return 'Unknown';
    }
  }

  private getKeyAlgorithmFromType(type: string, curve?: string): string {
    switch (type) {
      case 'RSA':
        return 'RSA';
      case 'EC':
        return curve ? `ECDSA-${curve}` : 'ECDSA';
      case 'AES':
        return 'AES';
      default:
        return 'Unknown';
    }
  }

  private getKeyUsage(attrs: any[]): string[] {
    const usage: string[] = [];
    if (attrs[4].value) usage.push('encrypt');
    if (attrs[5].value) usage.push('decrypt');
    if (attrs[6].value) usage.push('sign');
    if (attrs[7].value) usage.push('verify');
    if (attrs[8].value) usage.push('wrap');
    if (attrs[9].value) usage.push('unwrap');
    if (attrs[10].value) usage.push('derive');
    return usage;
  }

  private getCurveOid(curveName: string): Buffer {
    const curves: { [key: string]: string } = {
      'P-256': '06082a8648ce3d030107',
      'P-384': '06052b81040022',
      'P-521': '06052b81040023',
      'secp256k1': '06052b8104000a'
    };
    
    const oid = curves[curveName];
    if (!oid) {
      throw new Error(`Unsupported curve: ${curveName}`);
    }
    
    return Buffer.from(oid, 'hex');
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('HSM provider not initialized');
    }
  }

  private startHealthMonitoring(): void {
    setInterval(() => {
      this.performHealthCheck();
    }, 60000); // Check every minute
  }

  private async performHealthCheck(): Promise<void> {
    try {
      // Get session info to verify connection
      const sessionInfo = this.pkcs11.C_GetSessionInfo(this.session);
      
      this.lastHealthCheck = Date.now();
      this.emit('health-check', {
        status: 'healthy',
        sessionState: sessionInfo.state,
        operationCount: this.operationCount,
        keyCount: this.keys.size
      });
      
    } catch (error) {
      this.emit('health-check', {
        status: 'unhealthy',
        error: error.message,
        lastHealthCheck: this.lastHealthCheck
      });
      
      // Try to reconnect
      await this.reconnect();
    }
  }

  private async reconnect(): Promise<void> {
    console.log('🔄 Attempting HSM reconnection...');
    
    try {
      // Close existing session
      if (this.session) {
        this.pkcs11.C_CloseSession(this.session);
      }
      
      // Reinitialize
      await this.initialize();
      
      console.log('✅ HSM reconnected successfully');
      
    } catch (error) {
      console.error('❌ HSM reconnection failed:', error);
      this.emit('error', error);
    }
  }

  getKeys(): KeyMetadata[] {
    return Array.from(this.keys.values());
  }

  getKey(keyId: string): KeyMetadata | undefined {
    return this.keys.get(keyId);
  }

  getStats(): {
    initialized: boolean;
    keyCount: number;
    operationCount: number;
    lastHealthCheck: number;
  } {
    return {
      initialized: this.initialized,
      keyCount: this.keys.size,
      operationCount: this.operationCount,
      lastHealthCheck: this.lastHealthCheck
    };
  }

  async close(): Promise<void> {
    if (this.session) {
      this.pkcs11.C_Logout(this.session);
      this.pkcs11.C_CloseSession(this.session);
    }
    
    this.pkcs11.C_Finalize();
    this.initialized = false;
    
    this.emit('closed');
  }
}