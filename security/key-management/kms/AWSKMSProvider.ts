import { EventEmitter } from 'events';
import {
  KMSClient,
  CreateKeyCommand,
  EncryptCommand,
  DecryptCommand,
  SignCommand,
  VerifyCommand,
  GenerateDataKeyCommand,
  ListKeysCommand,
  DescribeKeyCommand,
  ScheduleKeyDeletionCommand,
  CreateAliasCommand,
  UpdateAliasCommand,
  GetPublicKeyCommand,
  CreateGrantCommand,
  RetireGrantCommand,
  ListGrantsCommand,
  KeySpec,
  KeyUsageType,
  SigningAlgorithmSpec,
  EncryptionAlgorithmSpec,
  Tag
} from '@aws-sdk/client-kms';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

export interface KMSConfig {
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  assumeRole?: {
    roleArn: string;
    sessionName: string;
    duration?: number;
  };
  defaultKeySpec?: KeySpec;
  defaultKeyUsage?: KeyUsageType;
  tags?: Tag[];
  multiRegion?: boolean;
  keyPolicy?: any;
}

export interface KMSKey {
  keyId: string;
  arn: string;
  alias?: string;
  keySpec: KeySpec;
  keyUsage: KeyUsageType;
  enabled: boolean;
  creationDate: Date;
  description?: string;
  multiRegion: boolean;
  metadata?: any;
}

export interface DataKey {
  plaintext: Buffer;
  ciphertext: Buffer;
  keyId: string;
}

export interface EncryptionContext {
  [key: string]: string;
}

export class AWSKMSProvider extends EventEmitter {
  private config: KMSConfig;
  private kmsClient: KMSClient;
  private stsClient?: STSClient;
  private keys: Map<string, KMSKey> = new Map();
  private aliases: Map<string, string> = new Map();
  private dataKeyCache: Map<string, DataKey> = new Map();
  private operationCount: number = 0;

  constructor(config: KMSConfig) {
    super();
    this.config = config;
    this.kmsClient = this.createKMSClient();
  }

  private createKMSClient(): KMSClient {
    const clientConfig: any = {
      region: this.config.region
    };

    if (this.config.credentials) {
      clientConfig.credentials = this.config.credentials;
    }

    return new KMSClient(clientConfig);
  }

  async initialize(): Promise<void> {
    console.log('🔐 Initializing AWS KMS provider...');

    try {
      // Assume role if configured
      if (this.config.assumeRole) {
        await this.assumeRole();
      }

      // Load existing keys
      await this.loadKeys();

      console.log(`✅ AWS KMS initialized with ${this.keys.size} keys`);
      this.emit('initialized');

    } catch (error) {
      console.error('❌ AWS KMS initialization failed:', error);
      throw error;
    }
  }

  private async assumeRole(): Promise<void> {
    if (!this.config.assumeRole) return;

    this.stsClient = new STSClient({ region: this.config.region });

    const command = new AssumeRoleCommand({
      RoleArn: this.config.assumeRole.roleArn,
      RoleSessionName: this.config.assumeRole.sessionName,
      DurationSeconds: this.config.assumeRole.duration || 3600
    });

    const response = await this.stsClient.send(command);

    if (response.Credentials) {
      // Update KMS client with assumed role credentials
      this.kmsClient = new KMSClient({
        region: this.config.region,
        credentials: {
          accessKeyId: response.Credentials.AccessKeyId!,
          secretAccessKey: response.Credentials.SecretAccessKey!,
          sessionToken: response.Credentials.SessionToken!
        }
      });

      console.log(`✅ Assumed role: ${this.config.assumeRole.roleArn}`);
    }
  }

  private async loadKeys(): Promise<void> {
    const listCommand = new ListKeysCommand({});
    const response = await this.kmsClient.send(listCommand);

    if (response.Keys) {
      for (const key of response.Keys) {
        if (key.KeyId) {
          try {
            const keyDetails = await this.describeKey(key.KeyId);
            this.keys.set(key.KeyId, keyDetails);
          } catch (error) {
            console.warn(`Failed to load key ${key.KeyId}:`, error);
          }
        }
      }
    }
  }

  private async describeKey(keyId: string): Promise<KMSKey> {
    const command = new DescribeKeyCommand({ KeyId: keyId });
    const response = await this.kmsClient.send(command);

    if (!response.KeyMetadata) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const metadata = response.KeyMetadata;

    return {
      keyId: metadata.KeyId!,
      arn: metadata.Arn!,
      keySpec: metadata.CustomerMasterKeySpec || metadata.KeySpec!,
      keyUsage: metadata.KeyUsage!,
      enabled: metadata.Enabled!,
      creationDate: metadata.CreationDate!,
      description: metadata.Description,
      multiRegion: metadata.MultiRegion || false,
      metadata
    };
  }

  async createKey(params: {
    description?: string;
    keySpec?: KeySpec;
    keyUsage?: KeyUsageType;
    alias?: string;
    tags?: Tag[];
    multiRegion?: boolean;
    bypassPolicyLockoutSafetyCheck?: boolean;
  }): Promise<KMSKey> {
    console.log(`🔑 Creating KMS key: ${params.description || 'unnamed'}`);

    const command = new CreateKeyCommand({
      Description: params.description,
      KeySpec: params.keySpec || this.config.defaultKeySpec || KeySpec.RSA_2048,
      KeyUsage: params.keyUsage || this.config.defaultKeyUsage || KeyUsageType.SIGN_VERIFY,
      Tags: params.tags || this.config.tags,
      MultiRegion: params.multiRegion || this.config.multiRegion,
      KeyPolicy: this.config.keyPolicy,
      BypassPolicyLockoutSafetyCheck: params.bypassPolicyLockoutSafetyCheck
    });

    const response = await this.kmsClient.send(command);

    if (!response.KeyMetadata) {
      throw new Error('Failed to create key');
    }

    const key: KMSKey = {
      keyId: response.KeyMetadata.KeyId!,
      arn: response.KeyMetadata.Arn!,
      keySpec: response.KeyMetadata.CustomerMasterKeySpec || response.KeyMetadata.KeySpec!,
      keyUsage: response.KeyMetadata.KeyUsage!,
      enabled: true,
      creationDate: new Date(),
      description: params.description,
      multiRegion: params.multiRegion || false,
      metadata: response.KeyMetadata
    };

    this.keys.set(key.keyId, key);

    // Create alias if specified
    if (params.alias) {
      await this.createAlias(key.keyId, params.alias);
      key.alias = params.alias;
    }

    this.emit('key-created', key);
    this.operationCount++;

    return key;
  }

  async createAlias(keyId: string, aliasName: string): Promise<void> {
    // Ensure alias has correct format
    const formattedAlias = aliasName.startsWith('alias/') ? aliasName : `alias/${aliasName}`;

    const command = new CreateAliasCommand({
      AliasName: formattedAlias,
      TargetKeyId: keyId
    });

    await this.kmsClient.send(command);
    this.aliases.set(formattedAlias, keyId);

    console.log(`✅ Created alias ${formattedAlias} for key ${keyId}`);
  }

  async encrypt(
    keyId: string,
    plaintext: Buffer,
    context?: EncryptionContext,
    algorithm?: EncryptionAlgorithmSpec
  ): Promise<Buffer> {
    const command = new EncryptCommand({
      KeyId: keyId,
      Plaintext: plaintext,
      EncryptionContext: context,
      EncryptionAlgorithm: algorithm
    });

    const response = await this.kmsClient.send(command);

    if (!response.CiphertextBlob) {
      throw new Error('Encryption failed');
    }

    this.operationCount++;
    this.emit('data-encrypted', { keyId, size: plaintext.length });

    return Buffer.from(response.CiphertextBlob);
  }

  async decrypt(
    ciphertext: Buffer,
    context?: EncryptionContext,
    keyId?: string
  ): Promise<{ plaintext: Buffer; keyId: string }> {
    const command = new DecryptCommand({
      CiphertextBlob: ciphertext,
      EncryptionContext: context,
      KeyId: keyId // Optional - KMS can determine from ciphertext
    });

    const response = await this.kmsClient.send(command);

    if (!response.Plaintext) {
      throw new Error('Decryption failed');
    }

    this.operationCount++;
    this.emit('data-decrypted', { keyId: response.KeyId });

    return {
      plaintext: Buffer.from(response.Plaintext),
      keyId: response.KeyId!
    };
  }

  async sign(
    keyId: string,
    message: Buffer,
    algorithm: SigningAlgorithmSpec,
    messageType: 'RAW' | 'DIGEST' = 'RAW'
  ): Promise<Buffer> {
    const command = new SignCommand({
      KeyId: keyId,
      Message: message,
      SigningAlgorithm: algorithm,
      MessageType: messageType
    });

    const response = await this.kmsClient.send(command);

    if (!response.Signature) {
      throw new Error('Signing failed');
    }

    this.operationCount++;
    this.emit('data-signed', { keyId, algorithm });

    return Buffer.from(response.Signature);
  }

  async verify(
    keyId: string,
    message: Buffer,
    signature: Buffer,
    algorithm: SigningAlgorithmSpec,
    messageType: 'RAW' | 'DIGEST' = 'RAW'
  ): Promise<boolean> {
    const command = new VerifyCommand({
      KeyId: keyId,
      Message: message,
      Signature: signature,
      SigningAlgorithm: algorithm,
      MessageType: messageType
    });

    const response = await this.kmsClient.send(command);

    this.operationCount++;

    return response.SignatureValid || false;
  }

  async generateDataKey(
    keyId: string,
    keySpec: 'AES_128' | 'AES_256' = 'AES_256',
    context?: EncryptionContext
  ): Promise<DataKey> {
    // Check cache first
    const cacheKey = `${keyId}-${keySpec}-${JSON.stringify(context || {})}`;
    const cached = this.dataKeyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const command = new GenerateDataKeyCommand({
      KeyId: keyId,
      KeySpec: keySpec,
      EncryptionContext: context
    });

    const response = await this.kmsClient.send(command);

    if (!response.Plaintext || !response.CiphertextBlob) {
      throw new Error('Data key generation failed');
    }

    const dataKey: DataKey = {
      plaintext: Buffer.from(response.Plaintext),
      ciphertext: Buffer.from(response.CiphertextBlob),
      keyId: response.KeyId!
    };

    // Cache the data key
    this.dataKeyCache.set(cacheKey, dataKey);

    this.operationCount++;
    this.emit('data-key-generated', { keyId, keySpec });

    return dataKey;
  }

  async getPublicKey(keyId: string): Promise<{
    publicKey: Buffer;
    keySpec: KeySpec;
    keyUsage: KeyUsageType;
    signingAlgorithms?: SigningAlgorithmSpec[];
  }> {
    const command = new GetPublicKeyCommand({ KeyId: keyId });
    const response = await this.kmsClient.send(command);

    if (!response.PublicKey) {
      throw new Error('Failed to get public key');
    }

    return {
      publicKey: Buffer.from(response.PublicKey),
      keySpec: response.CustomerMasterKeySpec || response.KeySpec!,
      keyUsage: response.KeyUsage!,
      signingAlgorithms: response.SigningAlgorithms
    };
  }

  async createGrant(params: {
    keyId: string;
    granteePrincipal: string;
    operations: string[];
    name?: string;
    constraints?: any;
    retiringPrincipal?: string;
  }): Promise<{ grantId: string; grantToken: string }> {
    const command = new CreateGrantCommand({
      KeyId: params.keyId,
      GranteePrincipal: params.granteePrincipal,
      Operations: params.operations,
      Name: params.name,
      Constraints: params.constraints,
      RetiringPrincipal: params.retiringPrincipal
    });

    const response = await this.kmsClient.send(command);

    if (!response.GrantId || !response.GrantToken) {
      throw new Error('Failed to create grant');
    }

    this.emit('grant-created', {
      keyId: params.keyId,
      grantId: response.GrantId,
      principal: params.granteePrincipal
    });

    return {
      grantId: response.GrantId,
      grantToken: response.GrantToken
    };
  }

  async retireGrant(grantToken?: string, grantId?: string, keyId?: string): Promise<void> {
    if (!grantToken && (!grantId || !keyId)) {
      throw new Error('Either grantToken or both grantId and keyId must be provided');
    }

    const command = new RetireGrantCommand({
      GrantToken: grantToken,
      GrantId: grantId,
      KeyId: keyId
    });

    await this.kmsClient.send(command);

    this.emit('grant-retired', { grantId, keyId });
  }

  async listGrants(keyId: string): Promise<any[]> {
    const command = new ListGrantsCommand({ KeyId: keyId });
    const response = await this.kmsClient.send(command);

    return response.Grants || [];
  }

  async scheduleKeyDeletion(keyId: string, pendingWindowInDays: number = 30): Promise<Date> {
    if (pendingWindowInDays < 7 || pendingWindowInDays > 30) {
      throw new Error('Pending window must be between 7 and 30 days');
    }

    const command = new ScheduleKeyDeletionCommand({
      KeyId: keyId,
      PendingWindowInDays: pendingWindowInDays
    });

    const response = await this.kmsClient.send(command);

    if (!response.DeletionDate) {
      throw new Error('Failed to schedule key deletion');
    }

    this.emit('key-deletion-scheduled', {
      keyId,
      deletionDate: response.DeletionDate
    });

    return response.DeletionDate;
  }

  async rotateKey(keyId: string, newAlias?: string): Promise<KMSKey> {
    console.log(`🔄 Rotating key: ${keyId}`);

    // Get existing key details
    const oldKey = await this.describeKey(keyId);

    // Create new key with same specifications
    const newKey = await this.createKey({
      description: `Rotated from ${oldKey.description || keyId}`,
      keySpec: oldKey.keySpec,
      keyUsage: oldKey.keyUsage,
      tags: [
        { TagKey: 'RotatedFrom', TagValue: keyId },
        { TagKey: 'RotationDate', TagValue: new Date().toISOString() }
      ],
      multiRegion: oldKey.multiRegion
    });

    // Update alias to point to new key
    if (newAlias || oldKey.alias) {
      const aliasName = newAlias || oldKey.alias;
      await this.updateAlias(aliasName!, newKey.keyId);
    }

    // Schedule old key for deletion
    await this.scheduleKeyDeletion(keyId, 30);

    this.emit('key-rotated', { oldKey, newKey });

    return newKey;
  }

  private async updateAlias(aliasName: string, targetKeyId: string): Promise<void> {
    const formattedAlias = aliasName.startsWith('alias/') ? aliasName : `alias/${aliasName}`;

    const command = new UpdateAliasCommand({
      AliasName: formattedAlias,
      TargetKeyId: targetKeyId
    });

    await this.kmsClient.send(command);
    this.aliases.set(formattedAlias, targetKeyId);
  }

  clearDataKeyCache(): void {
    // Clear plaintext from memory
    for (const dataKey of this.dataKeyCache.values()) {
      dataKey.plaintext.fill(0);
    }
    this.dataKeyCache.clear();
  }

  getKey(keyId: string): KMSKey | undefined {
    // Check by key ID
    let key = this.keys.get(keyId);
    
    // Check by alias
    if (!key && keyId.startsWith('alias/')) {
      const actualKeyId = this.aliases.get(keyId);
      if (actualKeyId) {
        key = this.keys.get(actualKeyId);
      }
    }

    return key;
  }

  getKeys(): KMSKey[] {
    return Array.from(this.keys.values());
  }

  getStats(): {
    keyCount: number;
    aliasCount: number;
    cachedDataKeys: number;
    operationCount: number;
  } {
    return {
      keyCount: this.keys.size,
      aliasCount: this.aliases.size,
      cachedDataKeys: this.dataKeyCache.size,
      operationCount: this.operationCount
    };
  }
}