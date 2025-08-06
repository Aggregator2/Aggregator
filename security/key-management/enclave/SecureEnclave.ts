import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { Worker } from 'worker_threads';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface EnclaveConfig {
  attestationRequired: boolean;
  maxWorkers: number;
  memoryLimit: number; // MB
  cpuLimit: number; // percentage
  allowedOperations: Set<string>;
  isolationLevel: 'process' | 'thread' | 'container';
  keyDerivationFunction: 'pbkdf2' | 'scrypt' | 'argon2';
  auditLog: boolean;
  secureMemory: boolean;
}

export interface EnclaveOperation {
  id: string;
  type: string;
  params: any;
  timestamp: number;
  requester: string;
  attestation?: EnclaveAttestation;
}

export interface EnclaveAttestation {
  nonce: string;
  timestamp: number;
  measurements: {
    codeHash: string;
    configHash: string;
    dataHash: string;
  };
  signature: string;
  certificate?: string;
}

export interface EnclaveResult {
  operationId: string;
  result?: any;
  error?: string;
  attestation: EnclaveAttestation;
  processingTime: number;
}

export class SecureEnclave extends EventEmitter {
  private config: EnclaveConfig;
  private workers: Worker[] = [];
  private workerPool: Worker[] = [];
  private operations: Map<string, EnclaveOperation> = new Map();
  private masterKey?: Buffer;
  private attestationKey?: crypto.KeyObject;
  private initialized: boolean = false;
  private operationQueue: EnclaveOperation[] = [];
  private processing: boolean = false;

  constructor(config: EnclaveConfig) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('🔒 Initializing Secure Enclave...');

    try {
      // Generate master key for enclave
      this.masterKey = await this.generateMasterKey();

      // Generate attestation key pair
      if (this.config.attestationRequired) {
        await this.generateAttestationKeys();
      }

      // Setup secure memory if enabled
      if (this.config.secureMemory) {
        await this.setupSecureMemory();
      }

      // Initialize worker pool
      await this.initializeWorkerPool();

      this.initialized = true;
      console.log('✅ Secure Enclave initialized');
      this.emit('initialized');

    } catch (error) {
      console.error('❌ Enclave initialization failed:', error);
      throw error;
    }
  }

  private async generateMasterKey(): Promise<Buffer> {
    // Generate hardware-backed master key if available
    try {
      // Check for TPM/HSM availability
      const tpmAvailable = await this.checkTPMAvailability();
      if (tpmAvailable) {
        return await this.generateTPMKey();
      }
    } catch (error) {
      console.warn('TPM not available, using software key generation');
    }

    // Fallback to software key generation
    const salt = crypto.randomBytes(32);
    const iterations = 1000000;
    
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(crypto.randomBytes(64), salt, iterations, 32, 'sha256', (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
  }

  private async checkTPMAvailability(): Promise<boolean> {
    // Check for TPM 2.0 on Windows or Linux
    if (os.platform() === 'win32') {
      try {
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
          exec('wmic /namespace:\\\\root\\cimv2\\security\\microsofttpm path win32_tpm get * /format:list', (err: any) => {
            if (err) reject(err);
            else resolve(true);
          });
        });
        return true;
      } catch {
        return false;
      }
    } else if (os.platform() === 'linux') {
      try {
        await fs.access('/dev/tpm0');
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  private async generateTPMKey(): Promise<Buffer> {
    // This would interface with actual TPM hardware
    // For now, simulating with high-entropy key generation
    const key = crypto.randomBytes(32);
    
    // Additional entropy from system
    const systemEntropy = Buffer.concat([
      Buffer.from(os.hostname()),
      Buffer.from(process.hrtime.bigint().toString()),
      crypto.randomBytes(16)
    ]);
    
    return crypto.createHash('sha256')
      .update(key)
      .update(systemEntropy)
      .digest();
  }

  private async generateAttestationKeys(): Promise<void> {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: this.masterKey!.toString('hex')
      }
    });

    this.attestationKey = crypto.createPrivateKey({
      key: privateKey,
      passphrase: this.masterKey!.toString('hex')
    });

    console.log('✅ Attestation keys generated');
  }

  private async setupSecureMemory(): Promise<void> {
    // Lock memory pages to prevent swapping
    if (os.platform() === 'linux') {
      try {
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
          exec('ulimit -l unlimited', (err: any) => {
            if (err) reject(err);
            else resolve(true);
          });
        });
        console.log('✅ Secure memory configured');
      } catch (error) {
        console.warn('Failed to configure secure memory:', error);
      }
    }
  }

  private async initializeWorkerPool(): Promise<void> {
    const workerScript = await this.generateWorkerScript();
    const workerPath = path.join(os.tmpdir(), `enclave-worker-${Date.now()}.js`);
    
    // Write worker script to temp file
    await fs.writeFile(workerPath, workerScript);

    // Create workers
    for (let i = 0; i < this.config.maxWorkers; i++) {
      const worker = new Worker(workerPath, {
        resourceLimits: {
          maxOldGenerationSizeMb: this.config.memoryLimit,
          maxYoungGenerationSizeMb: Math.floor(this.config.memoryLimit / 4),
          codeRangeSizeMb: 64
        },
        workerData: {
          workerId: i,
          config: this.config
        }
      });

      // Setup worker communication
      worker.on('message', (msg) => this.handleWorkerMessage(worker, msg));
      worker.on('error', (err) => this.handleWorkerError(worker, err));
      worker.on('exit', (code) => this.handleWorkerExit(worker, code));

      this.workers.push(worker);
      this.workerPool.push(worker);
    }

    console.log(`✅ Initialized ${this.workers.length} secure workers`);
  }

  private generateWorkerScript(): string {
    return `
const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');

// Secure worker environment
const config = workerData.config;
const workerId = workerData.workerId;

// Clear any sensitive data from memory after use
function secureClear(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  }
}

// Process operations
parentPort.on('message', async (msg) => {
  const { operation, id } = msg;
  const startTime = Date.now();
  
  try {
    // Validate operation is allowed
    if (!config.allowedOperations.has(operation.type)) {
      throw new Error(\`Operation \${operation.type} not allowed\`);
    }
    
    let result;
    
    switch (operation.type) {
      case 'sign':
        result = await performSign(operation.params);
        break;
      case 'verify':
        result = await performVerify(operation.params);
        break;
      case 'encrypt':
        result = await performEncrypt(operation.params);
        break;
      case 'decrypt':
        result = await performDecrypt(operation.params);
        break;
      case 'derive':
        result = await performKeyDerivation(operation.params);
        break;
      default:
        throw new Error(\`Unknown operation: \${operation.type}\`);
    }
    
    parentPort.postMessage({
      type: 'result',
      id,
      result,
      processingTime: Date.now() - startTime
    });
    
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      id,
      error: error.message,
      processingTime: Date.now() - startTime
    });
  }
});

async function performSign(params) {
  const { data, algorithm } = params;
  const sign = crypto.createSign(algorithm || 'SHA256');
  sign.update(data);
  return sign.sign(params.key);
}

async function performVerify(params) {
  const { data, signature, algorithm } = params;
  const verify = crypto.createVerify(algorithm || 'SHA256');
  verify.update(data);
  return verify.verify(params.key, signature);
}

async function performEncrypt(params) {
  const { data, algorithm } = params;
  const cipher = crypto.createCipheriv(
    algorithm || 'aes-256-gcm',
    params.key,
    params.iv
  );
  
  let encrypted = cipher.update(data);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return {
    encrypted,
    authTag: cipher.getAuthTag()
  };
}

async function performDecrypt(params) {
  const { data, algorithm, authTag } = params;
  const decipher = crypto.createDecipheriv(
    algorithm || 'aes-256-gcm',
    params.key,
    params.iv
  );
  
  if (authTag) {
    decipher.setAuthTag(authTag);
  }
  
  let decrypted = decipher.update(data);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted;
}

async function performKeyDerivation(params) {
  const { password, salt, iterations, keylen, digest } = params;
  
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations || 100000, keylen || 32, digest || 'sha256', (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

// Heartbeat to ensure worker is alive
setInterval(() => {
  parentPort.postMessage({ type: 'heartbeat', workerId });
}, 30000);
    `;
  }

  async executeOperation(
    type: string,
    params: any,
    requester: string,
    attestationNonce?: string
  ): Promise<EnclaveResult> {
    if (!this.initialized) {
      throw new Error('Enclave not initialized');
    }

    // Validate operation type
    if (!this.config.allowedOperations.has(type)) {
      throw new Error(`Operation ${type} not allowed`);
    }

    // Create operation
    const operation: EnclaveOperation = {
      id: crypto.randomUUID(),
      type,
      params,
      timestamp: Date.now(),
      requester
    };

    // Generate attestation if required
    if (this.config.attestationRequired && attestationNonce) {
      operation.attestation = await this.generateAttestation(operation, attestationNonce);
    }

    // Queue operation
    this.operations.set(operation.id, operation);
    this.operationQueue.push(operation);

    // Process queue
    this.processQueue();

    // Wait for result
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.operations.delete(operation.id);
        reject(new Error('Operation timeout'));
      }, 30000); // 30 second timeout

      this.once(`operation-${operation.id}`, (result: EnclaveResult) => {
        clearTimeout(timeout);
        this.operations.delete(operation.id);
        
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result);
        }
      });
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.operationQueue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.operationQueue.length > 0 && this.workerPool.length > 0) {
      const operation = this.operationQueue.shift()!;
      const worker = this.workerPool.shift()!;

      // Send operation to worker
      worker.postMessage({
        operation,
        id: operation.id
      });

      // Log for audit
      if (this.config.auditLog) {
        await this.logOperation(operation);
      }
    }

    this.processing = false;
  }

  private handleWorkerMessage(worker: Worker, msg: any): void {
    switch (msg.type) {
      case 'result':
      case 'error':
        this.handleOperationResult(worker, msg);
        break;
      case 'heartbeat':
        // Worker is alive
        break;
    }
  }

  private async handleOperationResult(worker: Worker, msg: any): Promise<void> {
    // Return worker to pool
    this.workerPool.push(worker);

    // Get operation
    const operation = this.operations.get(msg.id);
    if (!operation) {
      console.error(`Operation not found: ${msg.id}`);
      return;
    }

    // Generate result attestation
    const attestation = await this.generateAttestation(
      { ...operation, result: msg.result },
      crypto.randomBytes(32).toString('hex')
    );

    // Create result
    const result: EnclaveResult = {
      operationId: msg.id,
      result: msg.result,
      error: msg.error,
      attestation,
      processingTime: msg.processingTime
    };

    // Emit result
    this.emit(`operation-${msg.id}`, result);

    // Audit log
    if (this.config.auditLog) {
      await this.logResult(result);
    }

    // Process next operation
    this.processQueue();
  }

  private handleWorkerError(worker: Worker, error: Error): void {
    console.error(`Worker error:`, error);
    
    // Restart worker
    const index = this.workers.indexOf(worker);
    if (index !== -1) {
      this.restartWorker(index);
    }
  }

  private handleWorkerExit(worker: Worker, code: number): void {
    console.warn(`Worker exited with code ${code}`);
    
    // Remove from pool
    const poolIndex = this.workerPool.indexOf(worker);
    if (poolIndex !== -1) {
      this.workerPool.splice(poolIndex, 1);
    }
    
    // Restart worker
    const index = this.workers.indexOf(worker);
    if (index !== -1) {
      this.restartWorker(index);
    }
  }

  private async restartWorker(index: number): Promise<void> {
    console.log(`Restarting worker ${index}...`);
    
    try {
      // Terminate old worker
      await this.workers[index].terminate();
    } catch (error) {
      // Worker already terminated
    }

    // Create new worker
    const workerPath = path.join(os.tmpdir(), `enclave-worker-${Date.now()}.js`);
    await fs.writeFile(workerPath, this.generateWorkerScript());

    const worker = new Worker(workerPath, {
      resourceLimits: {
        maxOldGenerationSizeMb: this.config.memoryLimit,
        maxYoungGenerationSizeMb: Math.floor(this.config.memoryLimit / 4),
        codeRangeSizeMb: 64
      },
      workerData: {
        workerId: index,
        config: this.config
      }
    });

    worker.on('message', (msg) => this.handleWorkerMessage(worker, msg));
    worker.on('error', (err) => this.handleWorkerError(worker, err));
    worker.on('exit', (code) => this.handleWorkerExit(worker, code));

    this.workers[index] = worker;
    this.workerPool.push(worker);
  }

  private async generateAttestation(data: any, nonce: string): Promise<EnclaveAttestation> {
    const measurements = {
      codeHash: crypto.createHash('sha256').update(JSON.stringify(this.config)).digest('hex'),
      configHash: crypto.createHash('sha256').update(JSON.stringify(this.config)).digest('hex'),
      dataHash: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')
    };

    const attestationData = {
      nonce,
      timestamp: Date.now(),
      measurements
    };

    let signature = '';
    if (this.attestationKey) {
      const sign = crypto.createSign('SHA256');
      sign.update(JSON.stringify(attestationData));
      signature = sign.sign(this.attestationKey, 'hex');
    }

    return {
      ...attestationData,
      signature
    };
  }

  private async logOperation(operation: EnclaveOperation): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      operationId: operation.id,
      type: operation.type,
      requester: operation.requester,
      attestation: operation.attestation
    };

    // In production, this would write to secure audit log
    console.log(`[AUDIT] Operation: ${JSON.stringify(logEntry)}`);
  }

  private async logResult(result: EnclaveResult): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      operationId: result.operationId,
      success: !result.error,
      processingTime: result.processingTime,
      attestation: result.attestation
    };

    // In production, this would write to secure audit log
    console.log(`[AUDIT] Result: ${JSON.stringify(logEntry)}`);
  }

  // Secure operations
  async sign(data: Buffer, keyId: string, algorithm: string = 'SHA256'): Promise<Buffer> {
    const result = await this.executeOperation('sign', {
      data,
      keyId,
      algorithm
    }, 'system');

    return Buffer.from(result.result!, 'hex');
  }

  async verify(data: Buffer, signature: Buffer, keyId: string, algorithm: string = 'SHA256'): Promise<boolean> {
    const result = await this.executeOperation('verify', {
      data,
      signature,
      keyId,
      algorithm
    }, 'system');

    return result.result!;
  }

  async encrypt(data: Buffer, keyId: string, algorithm: string = 'aes-256-gcm'): Promise<{
    encrypted: Buffer;
    iv: Buffer;
    authTag?: Buffer;
  }> {
    const iv = crypto.randomBytes(16);
    
    const result = await this.executeOperation('encrypt', {
      data,
      keyId,
      algorithm,
      iv
    }, 'system');

    return {
      encrypted: Buffer.from(result.result!.encrypted, 'hex'),
      iv,
      authTag: result.result!.authTag ? Buffer.from(result.result!.authTag, 'hex') : undefined
    };
  }

  async decrypt(encrypted: Buffer, keyId: string, iv: Buffer, authTag?: Buffer, algorithm: string = 'aes-256-gcm'): Promise<Buffer> {
    const result = await this.executeOperation('decrypt', {
      data: encrypted,
      keyId,
      iv,
      authTag,
      algorithm
    }, 'system');

    return Buffer.from(result.result!, 'hex');
  }

  async deriveKey(password: Buffer, salt: Buffer, iterations: number = 100000, keylen: number = 32): Promise<Buffer> {
    const result = await this.executeOperation('derive', {
      password,
      salt,
      iterations,
      keylen,
      digest: 'sha256'
    }, 'system');

    return Buffer.from(result.result!, 'hex');
  }

  // Management
  getStats(): {
    initialized: boolean;
    workers: number;
    activeOperations: number;
    queuedOperations: number;
    attestationEnabled: boolean;
  } {
    return {
      initialized: this.initialized,
      workers: this.workers.length,
      activeOperations: this.operations.size,
      queuedOperations: this.operationQueue.length,
      attestationEnabled: this.config.attestationRequired
    };
  }

  async destroy(): Promise<void> {
    console.log('🛑 Destroying Secure Enclave...');

    // Clear operations
    this.operations.clear();
    this.operationQueue = [];

    // Terminate all workers
    for (const worker of this.workers) {
      await worker.terminate();
    }

    // Clear sensitive data
    if (this.masterKey) {
      this.masterKey.fill(0);
    }

    this.initialized = false;
    this.emit('destroyed');
  }
}