import { EventEmitter } from 'events';
import { HSMProvider, HSMConfig } from './hsm/HSMProvider';
import { AWSKMSProvider, KMSConfig } from './kms/AWSKMSProvider';
import { VaultProvider, VaultConfig } from './vault/VaultProvider';
import { KeyRotationService, RotationPolicy } from './rotation/KeyRotationService';
import { SecureEnclave, EnclaveConfig } from './enclave/SecureEnclave';
import { AuditLogger } from './audit/AuditLogger';
import * as crypto from 'crypto';

export interface KeyManagementConfig {
  hsm?: HSMConfig;
  kms?: KMSConfig;
  vault?: VaultConfig;
  enclave?: EnclaveConfig;
  rotation?: {
    enabled: boolean;
    policies: RotationPolicy[];
  };
  audit: {
    enabled: boolean;
    storage: 'file' | 'database' | 's3';
    retention: number; // days
    encryption: boolean;
  };
  keyHierarchy: {
    masterKeyProvider: 'hsm' | 'kms' | 'vault';
    keyDerivationPath: string;
  };
}

export interface KeyReference {
  id: string;
  provider: 'hsm' | 'kms' | 'vault' | 'enclave';
  type: 'master' | 'encryption' | 'signing' | 'api' | 'database';
  purpose: string;
  created: Date;
  lastUsed?: Date;
  rotationSchedule?: string;
  metadata?: any;
}

export interface CryptoOperation {
  id: string;
  type: 'encrypt' | 'decrypt' | 'sign' | 'verify' | 'derive';
  keyRef: KeyReference;
  timestamp: Date;
  success: boolean;
  duration: number;
  error?: string;
}

export class KeyManagementOrchestrator extends EventEmitter {
  private config: KeyManagementConfig;
  private providers: {
    hsm?: HSMProvider;
    kms?: AWSKMSProvider;
    vault?: VaultProvider;
  } = {};
  private enclave?: SecureEnclave;
  private rotationService?: KeyRotationService;
  private auditLogger?: AuditLogger;
  private keyRegistry: Map<string, KeyReference> = new Map();
  private keyCache: Map<string, any> = new Map();
  private operationHistory: CryptoOperation[] = [];
  private initialized: boolean = false;

  constructor(config: KeyManagementConfig) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('🔐 Initializing Key Management Orchestrator...');

    try {
      // Initialize providers
      if (this.config.hsm) {
        this.providers.hsm = new HSMProvider(this.config.hsm);
        await this.providers.hsm.initialize();
      }

      if (this.config.kms) {
        this.providers.kms = new AWSKMSProvider(this.config.kms);
        await this.providers.kms.initialize();
      }

      if (this.config.vault) {
        this.providers.vault = new VaultProvider(this.config.vault);
        await this.providers.vault.initialize();
      }

      // Initialize secure enclave
      if (this.config.enclave) {
        this.enclave = new SecureEnclave(this.config.enclave);
        await this.enclave.initialize();
      }

      // Initialize rotation service
      if (this.config.rotation?.enabled) {
        this.rotationService = new KeyRotationService();
        await this.rotationService.initialize(this.providers);

        // Add rotation policies
        for (const policy of this.config.rotation.policies) {
          this.rotationService.addPolicy(policy);
        }
      }

      // Initialize audit logger
      if (this.config.audit.enabled) {
        this.auditLogger = new AuditLogger({
          storage: this.config.audit.storage,
          retention: this.config.audit.retention,
          encryption: this.config.audit.encryption
        });
        await this.auditLogger.initialize();
      }

      // Load existing keys
      await this.loadKeyRegistry();

      // Validate master key
      await this.validateMasterKey();

      this.initialized = true;
      console.log('✅ Key Management Orchestrator initialized');
      this.emit('initialized');

    } catch (error) {
      console.error('❌ Orchestrator initialization failed:', error);
      throw error;
    }
  }

  private async loadKeyRegistry(): Promise<void> {
    // Load keys from each provider
    let totalKeys = 0;

    if (this.providers.hsm) {
      const hsmKeys = this.providers.hsm.getKeys();
      for (const key of hsmKeys) {
        this.registerKey({
          id: key.id,
          provider: 'hsm',
          type: this.inferKeyType(key.label),
          purpose: key.label,
          created: key.created
        });
        totalKeys++;
      }
    }

    if (this.providers.kms) {
      const kmsKeys = this.providers.kms.getKeys();
      for (const key of kmsKeys) {
        this.registerKey({
          id: key.keyId,
          provider: 'kms',
          type: this.inferKeyType(key.description || key.alias || ''),
          purpose: key.description || key.alias || key.keyId,
          created: key.creationDate
        });
        totalKeys++;
      }
    }

    console.log(`✅ Loaded ${totalKeys} keys into registry`);
  }

  private inferKeyType(label: string): KeyReference['type'] {
    const normalized = label.toLowerCase();
    if (normalized.includes('master')) return 'master';
    if (normalized.includes('sign')) return 'signing';
    if (normalized.includes('encrypt')) return 'encryption';
    if (normalized.includes('api')) return 'api';
    if (normalized.includes('database') || normalized.includes('db')) return 'database';
    return 'encryption'; // default
  }

  private async validateMasterKey(): Promise<void> {
    const provider = this.config.keyHierarchy.masterKeyProvider;
    const masterKeyRef = Array.from(this.keyRegistry.values())
      .find(k => k.provider === provider && k.type === 'master');

    if (!masterKeyRef) {
      console.warn('⚠️ No master key found, generating new one...');
      await this.generateMasterKey();
    } else {
      console.log('✅ Master key validated');
    }
  }

  private async generateMasterKey(): Promise<KeyReference> {
    const provider = this.config.keyHierarchy.masterKeyProvider;
    
    switch (provider) {
      case 'hsm':
        if (!this.providers.hsm) {
          throw new Error('HSM provider not configured');
        }
        const hsmKey = await this.providers.hsm.generateKey({
          label: 'MASTER_KEY',
          type: 'AES',
          size: 256,
          usage: ['encrypt', 'decrypt', 'wrap', 'unwrap']
        });
        return this.registerKey({
          id: hsmKey.id,
          provider: 'hsm',
          type: 'master',
          purpose: 'Master key for key hierarchy',
          created: hsmKey.created
        });

      case 'kms':
        if (!this.providers.kms) {
          throw new Error('KMS provider not configured');
        }
        const kmsKey = await this.providers.kms.createKey({
          description: 'Master key for key hierarchy',
          keySpec: 'AES_256',
          keyUsage: 'ENCRYPT_DECRYPT',
          multiRegion: true
        });
        return this.registerKey({
          id: kmsKey.keyId,
          provider: 'kms',
          type: 'master',
          purpose: 'Master key for key hierarchy',
          created: kmsKey.creationDate
        });

      case 'vault':
        if (!this.providers.vault) {
          throw new Error('Vault provider not configured');
        }
        await this.providers.vault.createTransitKey('master-key', {
          type: 'aes256-gcm96',
          exportable: false,
          allow_plaintext_backup: false
        });
        return this.registerKey({
          id: 'master-key',
          provider: 'vault',
          type: 'master',
          purpose: 'Master key for key hierarchy',
          created: new Date()
        });

      default:
        throw new Error(`Unsupported master key provider: ${provider}`);
    }
  }

  private registerKey(ref: KeyReference): KeyReference {
    this.keyRegistry.set(ref.id, ref);
    this.emit('key-registered', ref);
    return ref;
  }

  // Key Operations
  async createKey(params: {
    type: KeyReference['type'];
    purpose: string;
    provider?: 'hsm' | 'kms' | 'vault';
    algorithm?: string;
    size?: number;
    rotationSchedule?: string;
  }): Promise<KeyReference> {
    const provider = params.provider || this.selectProvider(params.type);
    
    let keyId: string;
    const keyLabel = `${params.type.toUpperCase()}_${params.purpose.replace(/\s+/g, '_')}_${Date.now()}`;

    switch (provider) {
      case 'hsm':
        if (!this.providers.hsm) {
          throw new Error('HSM provider not available');
        }
        const hsmKey = await this.providers.hsm.generateKey({
          label: keyLabel,
          type: params.algorithm?.includes('RSA') ? 'RSA' : params.algorithm?.includes('EC') ? 'EC' : 'AES',
          size: params.size,
          usage: this.getKeyUsage(params.type)
        });
        keyId = hsmKey.id;
        break;

      case 'kms':
        if (!this.providers.kms) {
          throw new Error('KMS provider not available');
        }
        const kmsKey = await this.providers.kms.createKey({
          description: params.purpose,
          keySpec: this.getKMSKeySpec(params.algorithm, params.size),
          keyUsage: params.type === 'signing' ? 'SIGN_VERIFY' : 'ENCRYPT_DECRYPT',
          alias: keyLabel
        });
        keyId = kmsKey.keyId;
        break;

      case 'vault':
        if (!this.providers.vault) {
          throw new Error('Vault provider not available');
        }
        await this.providers.vault.createTransitKey(keyLabel, {
          type: this.getVaultKeyType(params.algorithm, params.size)
        });
        keyId = keyLabel;
        break;

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    const keyRef = this.registerKey({
      id: keyId,
      provider,
      type: params.type,
      purpose: params.purpose,
      created: new Date(),
      rotationSchedule: params.rotationSchedule
    });

    // Audit
    await this.audit('key_created', keyRef);

    return keyRef;
  }

  async encrypt(
    data: Buffer,
    keyId: string,
    context?: any
  ): Promise<{
    ciphertext: Buffer;
    metadata: {
      keyId: string;
      algorithm: string;
      timestamp: number;
    };
  }> {
    const keyRef = this.keyRegistry.get(keyId);
    if (!keyRef) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const startTime = Date.now();
    let ciphertext: Buffer;
    let algorithm: string;

    try {
      switch (keyRef.provider) {
        case 'hsm':
          ciphertext = await this.providers.hsm!.encrypt(keyId, data);
          algorithm = 'AES-256-GCM';
          break;

        case 'kms':
          ciphertext = await this.providers.kms!.encrypt(keyId, data, context);
          algorithm = 'AWS-KMS';
          break;

        case 'vault':
          const vaultResult = await this.providers.vault!.encryptData(
            keyId,
            data,
            context ? JSON.stringify(context) : undefined
          );
          ciphertext = Buffer.from(vaultResult.ciphertext, 'base64');
          algorithm = 'Vault-Transit';
          break;

        case 'enclave':
          if (!this.enclave) {
            throw new Error('Enclave not initialized');
          }
          const enclaveResult = await this.enclave.encrypt(data, keyId);
          ciphertext = enclaveResult.encrypted;
          algorithm = 'Enclave-AES-256-GCM';
          break;

        default:
          throw new Error(`Unknown provider: ${keyRef.provider}`);
      }

      // Record operation
      this.recordOperation({
        id: crypto.randomUUID(),
        type: 'encrypt',
        keyRef,
        timestamp: new Date(),
        success: true,
        duration: Date.now() - startTime
      });

      // Update key usage
      keyRef.lastUsed = new Date();

      // Audit
      await this.audit('data_encrypted', {
        keyId,
        dataSize: data.length,
        algorithm
      });

      return {
        ciphertext,
        metadata: {
          keyId,
          algorithm,
          timestamp: Date.now()
        }
      };

    } catch (error) {
      this.recordOperation({
        id: crypto.randomUUID(),
        type: 'encrypt',
        keyRef,
        timestamp: new Date(),
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      });
      throw error;
    }
  }

  async decrypt(
    ciphertext: Buffer,
    keyId: string,
    context?: any
  ): Promise<Buffer> {
    const keyRef = this.keyRegistry.get(keyId);
    if (!keyRef) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const startTime = Date.now();
    let plaintext: Buffer;

    try {
      switch (keyRef.provider) {
        case 'hsm':
          plaintext = await this.providers.hsm!.decrypt(keyId, ciphertext);
          break;

        case 'kms':
          const kmsResult = await this.providers.kms!.decrypt(ciphertext, context, keyId);
          plaintext = kmsResult.plaintext;
          break;

        case 'vault':
          plaintext = await this.providers.vault!.decryptData(
            keyId,
            ciphertext.toString('base64'),
            context ? JSON.stringify(context) : undefined
          );
          break;

        case 'enclave':
          if (!this.enclave) {
            throw new Error('Enclave not initialized');
          }
          // Enclave decrypt would need IV and authTag
          throw new Error('Enclave decryption requires additional parameters');

        default:
          throw new Error(`Unknown provider: ${keyRef.provider}`);
      }

      // Record operation
      this.recordOperation({
        id: crypto.randomUUID(),
        type: 'decrypt',
        keyRef,
        timestamp: new Date(),
        success: true,
        duration: Date.now() - startTime
      });

      // Update key usage
      keyRef.lastUsed = new Date();

      // Audit
      await this.audit('data_decrypted', {
        keyId,
        dataSize: plaintext.length
      });

      return plaintext;

    } catch (error) {
      this.recordOperation({
        id: crypto.randomUUID(),
        type: 'decrypt',
        keyRef,
        timestamp: new Date(),
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      });
      throw error;
    }
  }

  async sign(
    data: Buffer,
    keyId: string,
    algorithm?: string
  ): Promise<Buffer> {
    const keyRef = this.keyRegistry.get(keyId);
    if (!keyRef) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const startTime = Date.now();
    let signature: Buffer;

    try {
      switch (keyRef.provider) {
        case 'hsm':
          signature = (await this.providers.hsm!.sign(keyId, data, algorithm)).signature;
          break;

        case 'kms':
          signature = await this.providers.kms!.sign(
            keyId,
            data,
            algorithm as any || 'RSASSA_PKCS1_V1_5_SHA_256'
          );
          break;

        case 'vault':
          const vaultResult = await this.providers.vault!.signData(keyId, data, {
            algorithm: algorithm || 'sha2-256'
          });
          signature = Buffer.from(vaultResult.signature.split(':')[2], 'base64');
          break;

        case 'enclave':
          if (!this.enclave) {
            throw new Error('Enclave not initialized');
          }
          signature = await this.enclave.sign(data, keyId, algorithm || 'SHA256');
          break;

        default:
          throw new Error(`Unknown provider: ${keyRef.provider}`);
      }

      // Record operation
      this.recordOperation({
        id: crypto.randomUUID(),
        type: 'sign',
        keyRef,
        timestamp: new Date(),
        success: true,
        duration: Date.now() - startTime
      });

      // Audit
      await this.audit('data_signed', {
        keyId,
        algorithm: algorithm || 'default',
        signatureLength: signature.length
      });

      return signature;

    } catch (error) {
      this.recordOperation({
        id: crypto.randomUUID(),
        type: 'sign',
        keyRef,
        timestamp: new Date(),
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      });
      throw error;
    }
  }

  async verify(
    data: Buffer,
    signature: Buffer,
    keyId: string,
    algorithm?: string
  ): Promise<boolean> {
    const keyRef = this.keyRegistry.get(keyId);
    if (!keyRef) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const startTime = Date.now();
    let valid: boolean;

    try {
      switch (keyRef.provider) {
        case 'hsm':
          valid = await this.providers.hsm!.verify(keyId, data, signature, algorithm);
          break;

        case 'kms':
          valid = await this.providers.kms!.verify(
            keyId,
            data,
            signature,
            algorithm as any || 'RSASSA_PKCS1_V1_5_SHA_256'
          );
          break;

        case 'vault':
          const vaultSig = `vault:v1:${signature.toString('base64')}`;
          valid = await this.providers.vault!.verifySignature(keyId, data, vaultSig, {
            algorithm: algorithm || 'sha2-256'
          });
          break;

        case 'enclave':
          if (!this.enclave) {
            throw new Error('Enclave not initialized');
          }
          valid = await this.enclave.verify(data, signature, keyId, algorithm || 'SHA256');
          break;

        default:
          throw new Error(`Unknown provider: ${keyRef.provider}`);
      }

      // Record operation
      this.recordOperation({
        id: crypto.randomUUID(),
        type: 'verify',
        keyRef,
        timestamp: new Date(),
        success: true,
        duration: Date.now() - startTime
      });

      // Audit
      await this.audit('signature_verified', {
        keyId,
        algorithm: algorithm || 'default',
        valid
      });

      return valid;

    } catch (error) {
      this.recordOperation({
        id: crypto.randomUUID(),
        type: 'verify',
        keyRef,
        timestamp: new Date(),
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      });
      throw error;
    }
  }

  // Database credential management
  async getDatabaseCredentials(database: string, role: string): Promise<{
    username: string;
    password: string;
    connectionString?: string;
    ttl: number;
  }> {
    if (!this.providers.vault) {
      throw new Error('Vault provider required for database credentials');
    }

    const creds = await this.providers.vault.getDatabaseCredentials(role);

    // Audit
    await this.audit('database_credentials_retrieved', {
      database,
      role,
      username: creds.username,
      ttl: creds.lease_duration
    });

    return {
      username: creds.username,
      password: creds.password,
      connectionString: creds.connection_string,
      ttl: creds.lease_duration
    };
  }

  // API key management
  async generateAPIKey(params: {
    service: string;
    permissions: string[];
    expiry?: Date;
  }): Promise<{
    keyId: string;
    apiKey: string;
    secret: string;
  }> {
    // Generate API key components
    const keyId = crypto.randomUUID();
    const apiKey = crypto.randomBytes(32).toString('base64url');
    const secret = crypto.randomBytes(64).toString('base64url');

    // Hash secret for storage
    const hashedSecret = crypto.createHash('sha256').update(secret).digest();

    // Store in Vault
    if (this.providers.vault) {
      await this.providers.vault.writeSecret(`api-keys/${keyId}`, {
        service: params.service,
        permissions: params.permissions,
        hashedSecret: hashedSecret.toString('hex'),
        created: new Date().toISOString(),
        expiry: params.expiry?.toISOString()
      });
    }

    // Register key
    this.registerKey({
      id: keyId,
      provider: 'vault',
      type: 'api',
      purpose: `API key for ${params.service}`,
      created: new Date(),
      metadata: {
        service: params.service,
        permissions: params.permissions,
        expiry: params.expiry
      }
    });

    // Audit
    await this.audit('api_key_created', {
      keyId,
      service: params.service,
      permissions: params.permissions
    });

    return {
      keyId,
      apiKey,
      secret
    };
  }

  async validateAPIKey(apiKey: string, secret: string): Promise<{
    valid: boolean;
    keyId?: string;
    permissions?: string[];
  }> {
    if (!this.providers.vault) {
      throw new Error('Vault provider required for API key validation');
    }

    // Decode API key to get keyId
    const keyId = apiKey.split('.')[0]; // Assume format: keyId.random

    try {
      const stored = await this.providers.vault.readSecret(`api-keys/${keyId}`);
      
      // Verify secret
      const hashedSecret = crypto.createHash('sha256').update(secret).digest().toString('hex');
      const valid = hashedSecret === stored.data.hashedSecret;

      // Check expiry
      if (valid && stored.data.expiry) {
        const expiry = new Date(stored.data.expiry);
        if (expiry < new Date()) {
          return { valid: false };
        }
      }

      return {
        valid,
        keyId: valid ? keyId : undefined,
        permissions: valid ? stored.data.permissions : undefined
      };

    } catch (error) {
      return { valid: false };
    }
  }

  // Helper methods
  private selectProvider(keyType: KeyReference['type']): 'hsm' | 'kms' | 'vault' {
    // Select provider based on key type and availability
    switch (keyType) {
      case 'master':
        return this.config.keyHierarchy.masterKeyProvider;
      case 'signing':
        if (this.providers.hsm) return 'hsm';
        if (this.providers.kms) return 'kms';
        break;
      case 'encryption':
        if (this.providers.kms) return 'kms';
        if (this.providers.hsm) return 'hsm';
        break;
      case 'api':
      case 'database':
        if (this.providers.vault) return 'vault';
        break;
    }

    // Default to first available provider
    if (this.providers.hsm) return 'hsm';
    if (this.providers.kms) return 'kms';
    if (this.providers.vault) return 'vault';
    
    throw new Error('No key provider available');
  }

  private getKeyUsage(type: KeyReference['type']): string[] {
    switch (type) {
      case 'master':
        return ['encrypt', 'decrypt', 'wrap', 'unwrap'];
      case 'signing':
        return ['sign', 'verify'];
      case 'encryption':
        return ['encrypt', 'decrypt'];
      case 'api':
      case 'database':
        return ['encrypt', 'decrypt'];
      default:
        return ['encrypt', 'decrypt'];
    }
  }

  private getKMSKeySpec(algorithm?: string, size?: number): any {
    if (algorithm?.includes('RSA')) {
      return size === 4096 ? 'RSA_4096' : 'RSA_2048';
    }
    if (algorithm?.includes('EC')) {
      return 'ECC_NIST_P256';
    }
    return 'AES_256';
  }

  private getVaultKeyType(algorithm?: string, size?: number): any {
    if (algorithm?.includes('RSA')) {
      return size === 4096 ? 'rsa-4096' : 'rsa-2048';
    }
    if (algorithm?.includes('EC')) {
      return 'ecdsa-p256';
    }
    return 'aes256-gcm96';
  }

  private recordOperation(op: CryptoOperation): void {
    this.operationHistory.push(op);
    
    // Keep only last 1000 operations
    if (this.operationHistory.length > 1000) {
      this.operationHistory = this.operationHistory.slice(-1000);
    }

    this.emit('operation-recorded', op);
  }

  private async audit(action: string, details: any): Promise<void> {
    if (!this.auditLogger) return;

    await this.auditLogger.log({
      timestamp: new Date(),
      action,
      details,
      actor: 'system' // Would get from context
    });
  }

  // Management methods
  getKeyRegistry(): KeyReference[] {
    return Array.from(this.keyRegistry.values());
  }

  getKey(keyId: string): KeyReference | undefined {
    return this.keyRegistry.get(keyId);
  }

  getOperationHistory(limit: number = 100): CryptoOperation[] {
    return this.operationHistory.slice(-limit);
  }

  getStats(): {
    providers: string[];
    totalKeys: number;
    keysByType: Record<string, number>;
    keysByProvider: Record<string, number>;
    recentOperations: number;
    operationSuccessRate: number;
  } {
    const keysByType: Record<string, number> = {};
    const keysByProvider: Record<string, number> = {};

    for (const key of this.keyRegistry.values()) {
      keysByType[key.type] = (keysByType[key.type] || 0) + 1;
      keysByProvider[key.provider] = (keysByProvider[key.provider] || 0) + 1;
    }

    const successfulOps = this.operationHistory.filter(op => op.success).length;
    const operationSuccessRate = this.operationHistory.length > 0
      ? (successfulOps / this.operationHistory.length) * 100
      : 100;

    return {
      providers: Object.keys(this.providers).filter(p => this.providers[p]),
      totalKeys: this.keyRegistry.size,
      keysByType,
      keysByProvider,
      recentOperations: this.operationHistory.length,
      operationSuccessRate
    };
  }

  async close(): Promise<void> {
    console.log('🛑 Closing Key Management Orchestrator...');

    // Stop rotation service
    if (this.rotationService) {
      this.rotationService.stop();
    }

    // Close providers
    if (this.providers.hsm) {
      await this.providers.hsm.close();
    }

    if (this.providers.vault) {
      await this.providers.vault.close();
    }

    // Destroy enclave
    if (this.enclave) {
      await this.enclave.destroy();
    }

    // Close audit logger
    if (this.auditLogger) {
      await this.auditLogger.close();
    }

    // Clear sensitive data
    this.keyCache.clear();
    
    this.initialized = false;
    this.emit('closed');
  }
}