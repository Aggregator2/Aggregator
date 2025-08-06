import { EventEmitter } from 'events';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

export interface VaultConfig {
  address: string;
  token?: string;
  roleId?: string;
  secretId?: string;
  namespace?: string;
  tlsConfig?: {
    ca?: string;
    cert?: string;
    key?: string;
    rejectUnauthorized?: boolean;
  };
  mount?: {
    kv?: string;
    transit?: string;
    database?: string;
    pki?: string;
  };
  retry?: {
    attempts: number;
    delay: number;
  };
}

export interface VaultSecret {
  path: string;
  data: any;
  metadata?: {
    created_time: string;
    deletion_time?: string;
    destroyed?: boolean;
    version: number;
  };
  lease_duration?: number;
  lease_id?: string;
}

export interface DatabaseCredentials {
  username: string;
  password: string;
  connection_string?: string;
  lease_id: string;
  lease_duration: number;
  renewable: boolean;
}

export interface TransitKey {
  name: string;
  type: 'aes256-gcm96' | 'chacha20-poly1305' | 'ed25519' | 'ecdsa-p256' | 'rsa-2048' | 'rsa-4096';
  derived: boolean;
  exportable: boolean;
  allow_plaintext_backup: boolean;
  keys: {
    [version: string]: number;
  };
  min_decryption_version: number;
  min_encryption_version: number;
  latest_version: number;
}

export class VaultProvider extends EventEmitter {
  private config: VaultConfig;
  private client: AxiosInstance;
  private token?: string;
  private tokenRenewInterval?: NodeJS.Timeout;
  private leases: Map<string, any> = new Map();
  private operationCount: number = 0;

  constructor(config: VaultConfig) {
    super();
    this.config = config;
    this.client = this.createClient();
  }

  private createClient(): AxiosInstance {
    const headers: any = {
      'Content-Type': 'application/json'
    };

    if (this.config.namespace) {
      headers['X-Vault-Namespace'] = this.config.namespace;
    }

    if (this.config.token) {
      headers['X-Vault-Token'] = this.config.token;
      this.token = this.config.token;
    }

    return axios.create({
      baseURL: this.config.address,
      headers,
      timeout: 30000,
      httpsAgent: this.config.tlsConfig ? {
        ca: this.config.tlsConfig.ca,
        cert: this.config.tlsConfig.cert,
        key: this.config.tlsConfig.key,
        rejectUnauthorized: this.config.tlsConfig.rejectUnauthorized
      } : undefined
    });
  }

  async initialize(): Promise<void> {
    console.log('🔐 Initializing HashiCorp Vault provider...');

    try {
      // Authenticate if using AppRole
      if (this.config.roleId && this.config.secretId) {
        await this.authenticateAppRole();
      }

      // Verify connection
      await this.checkHealth();

      // Start token renewal
      if (this.token) {
        await this.setupTokenRenewal();
      }

      console.log('✅ Vault provider initialized');
      this.emit('initialized');

    } catch (error) {
      console.error('❌ Vault initialization failed:', error);
      throw error;
    }
  }

  private async authenticateAppRole(): Promise<void> {
    const response = await this.client.post('/v1/auth/approle/login', {
      role_id: this.config.roleId,
      secret_id: this.config.secretId
    });

    if (response.data.auth) {
      this.token = response.data.auth.client_token;
      this.client.defaults.headers['X-Vault-Token'] = this.token;

      console.log('✅ Authenticated with AppRole');
      this.emit('authenticated', {
        policies: response.data.auth.policies,
        lease_duration: response.data.auth.lease_duration
      });
    }
  }

  private async checkHealth(): Promise<void> {
    const response = await this.client.get('/v1/sys/health');
    
    if (response.data.sealed) {
      throw new Error('Vault is sealed');
    }

    if (!response.data.initialized) {
      throw new Error('Vault is not initialized');
    }
  }

  private async setupTokenRenewal(): Promise<void> {
    // Get token info
    const response = await this.client.get('/v1/auth/token/lookup-self');
    const ttl = response.data.data.ttl;

    if (ttl > 0) {
      // Renew token at 80% of TTL
      const renewInterval = Math.floor(ttl * 0.8 * 1000);

      this.tokenRenewInterval = setInterval(async () => {
        try {
          await this.renewToken();
        } catch (error) {
          console.error('Failed to renew token:', error);
          this.emit('error', error);
        }
      }, renewInterval);
    }
  }

  private async renewToken(): Promise<void> {
    const response = await this.client.post('/v1/auth/token/renew-self');
    
    console.log('✅ Token renewed successfully');
    this.emit('token-renewed', {
      lease_duration: response.data.auth.lease_duration
    });
  }

  // KV Secret Operations
  async writeSecret(path: string, data: any): Promise<VaultSecret> {
    const mount = this.config.mount?.kv || 'secret';
    const fullPath = `/v1/${mount}/data/${path}`;

    const response = await this.client.post(fullPath, {
      data,
      options: {
        cas: 0 // Check-and-set for concurrent access control
      }
    });

    const secret: VaultSecret = {
      path,
      data,
      metadata: response.data.data?.metadata
    };

    this.operationCount++;
    this.emit('secret-written', { path });

    return secret;
  }

  async readSecret(path: string, version?: number): Promise<VaultSecret> {
    const mount = this.config.mount?.kv || 'secret';
    let fullPath = `/v1/${mount}/data/${path}`;

    if (version) {
      fullPath += `?version=${version}`;
    }

    const response = await this.client.get(fullPath);

    const secret: VaultSecret = {
      path,
      data: response.data.data.data,
      metadata: response.data.data.metadata
    };

    this.operationCount++;
    this.emit('secret-read', { path });

    return secret;
  }

  async deleteSecret(path: string): Promise<void> {
    const mount = this.config.mount?.kv || 'secret';
    const fullPath = `/v1/${mount}/metadata/${path}`;

    await this.client.delete(fullPath);

    this.operationCount++;
    this.emit('secret-deleted', { path });
  }

  async listSecrets(path: string): Promise<string[]> {
    const mount = this.config.mount?.kv || 'secret';
    const fullPath = `/v1/${mount}/metadata/${path}`;

    const response = await this.client.request({
      method: 'LIST',
      url: fullPath
    });

    return response.data.data.keys || [];
  }

  // Database Credential Management
  async getDatabaseCredentials(role: string): Promise<DatabaseCredentials> {
    const mount = this.config.mount?.database || 'database';
    const fullPath = `/v1/${mount}/creds/${role}`;

    const response = await this.client.get(fullPath);

    const credentials: DatabaseCredentials = {
      username: response.data.data.username,
      password: response.data.data.password,
      connection_string: response.data.data.connection_string,
      lease_id: response.data.lease_id,
      lease_duration: response.data.lease_duration,
      renewable: response.data.renewable
    };

    // Track lease for renewal
    this.trackLease(response.data.lease_id, response.data.lease_duration);

    this.operationCount++;
    this.emit('database-credentials-generated', { role });

    return credentials;
  }

  async rotateDatabaseCredentials(role: string): Promise<void> {
    const mount = this.config.mount?.database || 'database';
    const fullPath = `/v1/${mount}/rotate-root/${role}`;

    await this.client.post(fullPath);

    this.emit('database-credentials-rotated', { role });
  }

  // Transit Encryption Operations
  async createTransitKey(name: string, params?: {
    type?: TransitKey['type'];
    derived?: boolean;
    exportable?: boolean;
    allow_plaintext_backup?: boolean;
  }): Promise<void> {
    const mount = this.config.mount?.transit || 'transit';
    const fullPath = `/v1/${mount}/keys/${name}`;

    await this.client.post(fullPath, params || {});

    this.emit('transit-key-created', { name });
  }

  async encryptData(keyName: string, plaintext: Buffer, context?: string): Promise<{
    ciphertext: string;
    key_version: number;
  }> {
    const mount = this.config.mount?.transit || 'transit';
    const fullPath = `/v1/${mount}/encrypt/${keyName}`;

    const response = await this.client.post(fullPath, {
      plaintext: plaintext.toString('base64'),
      context: context ? Buffer.from(context).toString('base64') : undefined
    });

    this.operationCount++;

    return {
      ciphertext: response.data.data.ciphertext,
      key_version: response.data.data.key_version
    };
  }

  async decryptData(keyName: string, ciphertext: string, context?: string): Promise<Buffer> {
    const mount = this.config.mount?.transit || 'transit';
    const fullPath = `/v1/${mount}/decrypt/${keyName}`;

    const response = await this.client.post(fullPath, {
      ciphertext,
      context: context ? Buffer.from(context).toString('base64') : undefined
    });

    this.operationCount++;

    return Buffer.from(response.data.data.plaintext, 'base64');
  }

  async signData(keyName: string, data: Buffer, params?: {
    algorithm?: string;
    prehashed?: boolean;
    context?: string;
  }): Promise<{
    signature: string;
    public_key?: string;
  }> {
    const mount = this.config.mount?.transit || 'transit';
    const fullPath = `/v1/${mount}/sign/${keyName}`;

    const response = await this.client.post(fullPath, {
      input: data.toString('base64'),
      hash_algorithm: params?.algorithm || 'sha2-256',
      prehashed: params?.prehashed || false,
      context: params?.context ? Buffer.from(params.context).toString('base64') : undefined
    });

    this.operationCount++;

    return {
      signature: response.data.data.signature,
      public_key: response.data.data.public_key
    };
  }

  async verifySignature(keyName: string, data: Buffer, signature: string, params?: {
    algorithm?: string;
    prehashed?: boolean;
    context?: string;
  }): Promise<boolean> {
    const mount = this.config.mount?.transit || 'transit';
    const fullPath = `/v1/${mount}/verify/${keyName}`;

    const response = await this.client.post(fullPath, {
      input: data.toString('base64'),
      signature,
      hash_algorithm: params?.algorithm || 'sha2-256',
      prehashed: params?.prehashed || false,
      context: params?.context ? Buffer.from(params.context).toString('base64') : undefined
    });

    this.operationCount++;

    return response.data.data.valid;
  }

  async rotateTransitKey(keyName: string): Promise<void> {
    const mount = this.config.mount?.transit || 'transit';
    const fullPath = `/v1/${mount}/keys/${keyName}/rotate`;

    await this.client.post(fullPath);

    this.emit('transit-key-rotated', { keyName });
  }

  async rewrapData(keyName: string, ciphertext: string, context?: string): Promise<{
    ciphertext: string;
    key_version: number;
  }> {
    const mount = this.config.mount?.transit || 'transit';
    const fullPath = `/v1/${mount}/rewrap/${keyName}`;

    const response = await this.client.post(fullPath, {
      ciphertext,
      context: context ? Buffer.from(context).toString('base64') : undefined
    });

    return {
      ciphertext: response.data.data.ciphertext,
      key_version: response.data.data.key_version
    };
  }

  // PKI Operations
  async generateCertificate(role: string, params: {
    common_name: string;
    alt_names?: string[];
    ip_sans?: string[];
    ttl?: string;
  }): Promise<{
    certificate: string;
    private_key: string;
    ca_chain: string[];
    serial_number: string;
  }> {
    const mount = this.config.mount?.pki || 'pki';
    const fullPath = `/v1/${mount}/issue/${role}`;

    const response = await this.client.post(fullPath, params);

    this.operationCount++;
    this.emit('certificate-generated', { role, common_name: params.common_name });

    return {
      certificate: response.data.data.certificate,
      private_key: response.data.data.private_key,
      ca_chain: response.data.data.ca_chain,
      serial_number: response.data.data.serial_number
    };
  }

  // Lease Management
  private trackLease(leaseId: string, duration: number): void {
    const renewAt = Date.now() + (duration * 0.8 * 1000); // Renew at 80% of TTL

    this.leases.set(leaseId, {
      renewAt,
      duration,
      timeout: setTimeout(() => {
        this.renewLease(leaseId);
      }, renewAt - Date.now())
    });
  }

  private async renewLease(leaseId: string): Promise<void> {
    try {
      const response = await this.client.put('/v1/sys/leases/renew', {
        lease_id: leaseId
      });

      const lease = this.leases.get(leaseId);
      if (lease) {
        clearTimeout(lease.timeout);
        this.trackLease(leaseId, response.data.lease_duration);
      }

      this.emit('lease-renewed', { leaseId });
    } catch (error) {
      console.error(`Failed to renew lease ${leaseId}:`, error);
      this.emit('lease-renewal-failed', { leaseId, error });
    }
  }

  async revokeLease(leaseId: string): Promise<void> {
    await this.client.put('/v1/sys/leases/revoke', {
      lease_id: leaseId
    });

    const lease = this.leases.get(leaseId);
    if (lease) {
      clearTimeout(lease.timeout);
      this.leases.delete(leaseId);
    }

    this.emit('lease-revoked', { leaseId });
  }

  // Audit Operations
  async auditKeyOperation(operation: string, keyPath: string, metadata?: any): Promise<void> {
    // Write audit entry to Vault
    const auditPath = `audit/${operation}/${Date.now()}`;
    
    await this.writeSecret(auditPath, {
      operation,
      keyPath,
      timestamp: new Date().toISOString(),
      metadata,
      operator: this.token ? 'authenticated' : 'unauthenticated'
    });
  }

  // Policy Management
  async createPolicy(name: string, policy: string): Promise<void> {
    await this.client.put(`/v1/sys/policies/acl/${name}`, {
      policy
    });

    this.emit('policy-created', { name });
  }

  async getPolicy(name: string): Promise<string> {
    const response = await this.client.get(`/v1/sys/policies/acl/${name}`);
    return response.data.data.policy;
  }

  // Utility Methods
  async seal(): Promise<void> {
    await this.client.put('/v1/sys/seal');
    console.log('🔒 Vault sealed');
  }

  async unseal(key: string): Promise<{
    sealed: boolean;
    progress: number;
    threshold: number;
  }> {
    const response = await this.client.put('/v1/sys/unseal', { key });
    
    return {
      sealed: response.data.sealed,
      progress: response.data.progress,
      threshold: response.data.t
    };
  }

  getStats(): {
    operationCount: number;
    activeLeasesCount: number;
  } {
    return {
      operationCount: this.operationCount,
      activeLeasesCount: this.leases.size
    };
  }

  async close(): Promise<void> {
    // Clear token renewal
    if (this.tokenRenewInterval) {
      clearInterval(this.tokenRenewInterval);
    }

    // Revoke all tracked leases
    for (const [leaseId, lease] of this.leases) {
      clearTimeout(lease.timeout);
      try {
        await this.revokeLease(leaseId);
      } catch (error) {
        console.error(`Failed to revoke lease ${leaseId}:`, error);
      }
    }

    this.emit('closed');
  }
}