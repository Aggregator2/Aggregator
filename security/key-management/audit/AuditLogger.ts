import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';

export interface AuditConfig {
  storage: 'file' | 'database' | 's3';
  retention: number; // days
  encryption: boolean;
  fileConfig?: {
    directory: string;
    rotationSize: number; // MB
    format: 'json' | 'csv';
  };
  databaseConfig?: {
    connectionString: string;
    tableName: string;
  };
  s3Config?: {
    bucket: string;
    prefix: string;
    region: string;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    };
  };
  encryptionKey?: Buffer;
  tamperProof?: boolean;
  realTime?: boolean;
}

export interface AuditEntry {
  id: string;
  timestamp: Date;
  action: string;
  actor: string;
  resource?: string;
  details: any;
  result?: 'success' | 'failure';
  duration?: number;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  hash?: string;
  previousHash?: string;
}

export interface AuditQuery {
  startTime?: Date;
  endTime?: Date;
  action?: string | string[];
  actor?: string;
  resource?: string;
  result?: 'success' | 'failure';
  limit?: number;
  offset?: number;
}

export interface AuditReport {
  period: { start: Date; end: Date };
  totalEntries: number;
  entriesByAction: Record<string, number>;
  entriesByActor: Record<string, number>;
  failureRate: number;
  topFailures: { action: string; count: number; rate: number }[];
  suspiciousActivities: AuditEntry[];
}

export class AuditLogger extends EventEmitter {
  private config: AuditConfig;
  private s3Client?: S3Client;
  private dbPool?: Pool;
  private currentFile?: string;
  private currentFileSize: number = 0;
  private buffer: AuditEntry[] = [];
  private flushInterval?: NodeJS.Timeout;
  private encryptionKey?: Buffer;
  private lastHash?: string;
  private initialized: boolean = false;

  constructor(config: AuditConfig) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('📝 Initializing Audit Logger...');

    try {
      // Setup encryption key
      if (this.config.encryption) {
        this.encryptionKey = this.config.encryptionKey || crypto.randomBytes(32);
      }

      // Initialize storage backend
      switch (this.config.storage) {
        case 'file':
          await this.initializeFileStorage();
          break;
        case 'database':
          await this.initializeDatabaseStorage();
          break;
        case 's3':
          await this.initializeS3Storage();
          break;
      }

      // Start flush interval for buffered writes
      if (this.config.realTime !== true) {
        this.flushInterval = setInterval(() => {
          this.flush().catch(console.error);
        }, 5000); // Flush every 5 seconds
      }

      // Load last hash for tamper-proof chain
      if (this.config.tamperProof) {
        this.lastHash = await this.loadLastHash();
      }

      this.initialized = true;
      console.log('✅ Audit Logger initialized');
      this.emit('initialized');

    } catch (error) {
      console.error('❌ Audit Logger initialization failed:', error);
      throw error;
    }
  }

  private async initializeFileStorage(): Promise<void> {
    if (!this.config.fileConfig) {
      throw new Error('File storage configuration required');
    }

    // Create audit directory
    await fs.mkdir(this.config.fileConfig.directory, { recursive: true });

    // Set current file
    await this.rotateFile();
  }

  private async initializeDatabaseStorage(): Promise<void> {
    if (!this.config.databaseConfig) {
      throw new Error('Database configuration required');
    }

    this.dbPool = new Pool({
      connectionString: this.config.databaseConfig.connectionString
    });

    // Create audit table if not exists
    await this.dbPool.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.databaseConfig.tableName} (
        id UUID PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        action VARCHAR(255) NOT NULL,
        actor VARCHAR(255) NOT NULL,
        resource VARCHAR(255),
        details JSONB,
        result VARCHAR(20),
        duration INTEGER,
        ip_address INET,
        user_agent TEXT,
        correlation_id UUID,
        hash VARCHAR(64),
        previous_hash VARCHAR(64),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON ${this.config.databaseConfig.tableName}(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON ${this.config.databaseConfig.tableName}(action);
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON ${this.config.databaseConfig.tableName}(actor);
      CREATE INDEX IF NOT EXISTS idx_audit_resource ON ${this.config.databaseConfig.tableName}(resource);
    `);

    console.log('✅ Database audit table ready');
  }

  private async initializeS3Storage(): Promise<void> {
    if (!this.config.s3Config) {
      throw new Error('S3 configuration required');
    }

    this.s3Client = new S3Client({
      region: this.config.s3Config.region,
      credentials: this.config.s3Config.credentials
    });

    console.log('✅ S3 client initialized');
  }

  async log(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'hash' | 'previousHash'>): Promise<void> {
    if (!this.initialized) {
      throw new Error('Audit logger not initialized');
    }

    // Create full audit entry
    const fullEntry: AuditEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date()
    };

    // Add tamper-proof hash if enabled
    if (this.config.tamperProof) {
      fullEntry.previousHash = this.lastHash;
      fullEntry.hash = this.calculateHash(fullEntry);
      this.lastHash = fullEntry.hash;
    }

    // Encrypt if enabled
    const entryToStore = this.config.encryption 
      ? await this.encryptEntry(fullEntry)
      : fullEntry;

    // Store based on mode
    if (this.config.realTime) {
      await this.writeEntry(entryToStore);
    } else {
      this.buffer.push(entryToStore);
      
      // Flush if buffer is full
      if (this.buffer.length >= 100) {
        await this.flush();
      }
    }

    this.emit('entry-logged', fullEntry);

    // Check for suspicious activity
    if (this.isSuspicious(fullEntry)) {
      this.emit('suspicious-activity', fullEntry);
    }
  }

  private async writeEntry(entry: AuditEntry): Promise<void> {
    switch (this.config.storage) {
      case 'file':
        await this.writeToFile(entry);
        break;
      case 'database':
        await this.writeToDatabase(entry);
        break;
      case 's3':
        await this.writeToS3(entry);
        break;
    }
  }

  private async writeToFile(entry: AuditEntry): Promise<void> {
    if (!this.config.fileConfig || !this.currentFile) {
      throw new Error('File storage not configured');
    }

    let content: string;
    if (this.config.fileConfig.format === 'json') {
      content = JSON.stringify(entry) + '\n';
    } else {
      // CSV format
      content = this.entryToCSV(entry) + '\n';
    }

    await fs.appendFile(this.currentFile, content);
    this.currentFileSize += Buffer.byteLength(content);

    // Rotate file if needed
    if (this.currentFileSize > this.config.fileConfig.rotationSize * 1024 * 1024) {
      await this.rotateFile();
    }
  }

  private async writeToDatabase(entry: AuditEntry): Promise<void> {
    if (!this.dbPool || !this.config.databaseConfig) {
      throw new Error('Database not configured');
    }

    await this.dbPool.query(
      `INSERT INTO ${this.config.databaseConfig.tableName} 
       (id, timestamp, action, actor, resource, details, result, duration, 
        ip_address, user_agent, correlation_id, hash, previous_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        entry.id,
        entry.timestamp,
        entry.action,
        entry.actor,
        entry.resource,
        JSON.stringify(entry.details),
        entry.result,
        entry.duration,
        entry.ipAddress,
        entry.userAgent,
        entry.correlationId,
        entry.hash,
        entry.previousHash
      ]
    );
  }

  private async writeToS3(entry: AuditEntry): Promise<void> {
    if (!this.s3Client || !this.config.s3Config) {
      throw new Error('S3 not configured');
    }

    const key = `${this.config.s3Config.prefix}/${new Date().toISOString().split('T')[0]}/${entry.id}.json`;
    
    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.config.s3Config.bucket,
      Key: key,
      Body: JSON.stringify(entry),
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256'
    }));
  }

  private async rotateFile(): Promise<void> {
    if (!this.config.fileConfig) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentFile = path.join(
      this.config.fileConfig.directory,
      `audit-${timestamp}.${this.config.fileConfig.format === 'json' ? 'jsonl' : 'csv'}`
    );
    this.currentFileSize = 0;

    // Write CSV header if needed
    if (this.config.fileConfig.format === 'csv') {
      await fs.writeFile(
        this.currentFile,
        'id,timestamp,action,actor,resource,result,duration,ip_address,correlation_id,hash\n'
      );
    }

    console.log(`📁 Rotated to new audit file: ${this.currentFile}`);
  }

  private entryToCSV(entry: AuditEntry): string {
    return [
      entry.id,
      entry.timestamp.toISOString(),
      entry.action,
      entry.actor,
      entry.resource || '',
      entry.result || '',
      entry.duration || '',
      entry.ipAddress || '',
      entry.correlationId || '',
      entry.hash || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entriesToFlush = [...this.buffer];
    this.buffer = [];

    for (const entry of entriesToFlush) {
      await this.writeEntry(entry);
    }

    this.emit('flushed', { count: entriesToFlush.length });
  }

  private calculateHash(entry: AuditEntry): string {
    const data = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      actor: entry.actor,
      resource: entry.resource,
      details: entry.details,
      previousHash: entry.previousHash
    });

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private async encryptEntry(entry: AuditEntry): Promise<AuditEntry> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(entry.details), 'utf8'),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return {
      ...entry,
      details: {
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64')
      }
    };
  }

  private async decryptEntry(entry: AuditEntry): Promise<AuditEntry> {
    if (!this.encryptionKey || !entry.details.encrypted) {
      return entry;
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(entry.details.iv, 'base64')
    );

    decipher.setAuthTag(Buffer.from(entry.details.authTag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(entry.details.encrypted, 'base64')),
      decipher.final()
    ]);

    return {
      ...entry,
      details: JSON.parse(decrypted.toString('utf8'))
    };
  }

  private isSuspicious(entry: AuditEntry): boolean {
    // Check for suspicious patterns
    const suspiciousActions = [
      'key_exported',
      'permission_escalated',
      'bulk_data_access',
      'configuration_changed',
      'audit_disabled'
    ];

    if (suspiciousActions.includes(entry.action)) {
      return true;
    }

    // Check for failed attempts
    if (entry.result === 'failure') {
      // Would track failure patterns
      return true;
    }

    // Check for unusual times
    const hour = entry.timestamp.getHours();
    if (hour < 6 || hour > 22) {
      // Activity outside business hours
      return true;
    }

    return false;
  }

  private async loadLastHash(): Promise<string | undefined> {
    // Load last hash based on storage type
    // Implementation depends on storage backend
    return undefined;
  }

  // Query methods
  async query(params: AuditQuery): Promise<AuditEntry[]> {
    switch (this.config.storage) {
      case 'file':
        return this.queryFiles(params);
      case 'database':
        return this.queryDatabase(params);
      case 's3':
        return this.queryS3(params);
      default:
        throw new Error('Unknown storage type');
    }
  }

  private async queryFiles(params: AuditQuery): Promise<AuditEntry[]> {
    if (!this.config.fileConfig) {
      throw new Error('File storage not configured');
    }

    const entries: AuditEntry[] = [];
    const files = await fs.readdir(this.config.fileConfig.directory);

    for (const file of files) {
      if (!file.startsWith('audit-')) continue;

      const content = await fs.readFile(
        path.join(this.config.fileConfig.directory, file),
        'utf-8'
      );

      const lines = content.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (this.config.fileConfig.format === 'json') {
          try {
            const entry = JSON.parse(line);
            if (this.matchesQuery(entry, params)) {
              entries.push(entry);
            }
          } catch (error) {
            // Skip invalid lines
          }
        }
      }
    }

    return entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(params.offset || 0, (params.offset || 0) + (params.limit || 100));
  }

  private async queryDatabase(params: AuditQuery): Promise<AuditEntry[]> {
    if (!this.dbPool || !this.config.databaseConfig) {
      throw new Error('Database not configured');
    }

    let query = `SELECT * FROM ${this.config.databaseConfig.tableName} WHERE 1=1`;
    const values: any[] = [];
    let paramCount = 0;

    if (params.startTime) {
      query += ` AND timestamp >= $${++paramCount}`;
      values.push(params.startTime);
    }

    if (params.endTime) {
      query += ` AND timestamp <= $${++paramCount}`;
      values.push(params.endTime);
    }

    if (params.action) {
      if (Array.isArray(params.action)) {
        query += ` AND action = ANY($${++paramCount})`;
        values.push(params.action);
      } else {
        query += ` AND action = $${++paramCount}`;
        values.push(params.action);
      }
    }

    if (params.actor) {
      query += ` AND actor = $${++paramCount}`;
      values.push(params.actor);
    }

    if (params.resource) {
      query += ` AND resource = $${++paramCount}`;
      values.push(params.resource);
    }

    if (params.result) {
      query += ` AND result = $${++paramCount}`;
      values.push(params.result);
    }

    query += ` ORDER BY timestamp DESC`;
    
    if (params.limit) {
      query += ` LIMIT $${++paramCount}`;
      values.push(params.limit);
    }

    if (params.offset) {
      query += ` OFFSET $${++paramCount}`;
      values.push(params.offset);
    }

    const result = await this.dbPool.query(query, values);
    
    return result.rows.map(row => ({
      ...row,
      details: row.details,
      timestamp: new Date(row.timestamp)
    }));
  }

  private async queryS3(params: AuditQuery): Promise<AuditEntry[]> {
    // S3 querying would require listing objects and filtering
    // For production, consider using S3 Select or Athena
    throw new Error('S3 querying not implemented');
  }

  private matchesQuery(entry: AuditEntry, params: AuditQuery): boolean {
    if (params.startTime && entry.timestamp < params.startTime) return false;
    if (params.endTime && entry.timestamp > params.endTime) return false;
    
    if (params.action) {
      const actions = Array.isArray(params.action) ? params.action : [params.action];
      if (!actions.includes(entry.action)) return false;
    }
    
    if (params.actor && entry.actor !== params.actor) return false;
    if (params.resource && entry.resource !== params.resource) return false;
    if (params.result && entry.result !== params.result) return false;
    
    return true;
  }

  // Reporting
  async generateReport(period: { start: Date; end: Date }): Promise<AuditReport> {
    const entries = await this.query({
      startTime: period.start,
      endTime: period.end,
      limit: 10000 // Reasonable limit for reporting
    });

    const entriesByAction: Record<string, number> = {};
    const entriesByActor: Record<string, number> = {};
    const failures: Record<string, number> = {};
    const suspiciousActivities: AuditEntry[] = [];

    for (const entry of entries) {
      // Count by action
      entriesByAction[entry.action] = (entriesByAction[entry.action] || 0) + 1;
      
      // Count by actor
      entriesByActor[entry.actor] = (entriesByActor[entry.actor] || 0) + 1;
      
      // Count failures
      if (entry.result === 'failure') {
        failures[entry.action] = (failures[entry.action] || 0) + 1;
      }
      
      // Collect suspicious activities
      if (this.isSuspicious(entry)) {
        suspiciousActivities.push(entry);
      }
    }

    // Calculate failure rate
    const totalFailures = Object.values(failures).reduce((sum, count) => sum + count, 0);
    const failureRate = entries.length > 0 ? (totalFailures / entries.length) * 100 : 0;

    // Top failures
    const topFailures = Object.entries(failures)
      .map(([action, count]) => ({
        action,
        count,
        rate: (count / (entriesByAction[action] || 1)) * 100
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      period,
      totalEntries: entries.length,
      entriesByAction,
      entriesByActor,
      failureRate,
      topFailures,
      suspiciousActivities: suspiciousActivities.slice(0, 100)
    };
  }

  // Maintenance
  async cleanup(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retention);

    switch (this.config.storage) {
      case 'file':
        await this.cleanupFiles(cutoffDate);
        break;
      case 'database':
        await this.cleanupDatabase(cutoffDate);
        break;
      case 's3':
        await this.cleanupS3(cutoffDate);
        break;
    }

    this.emit('cleanup-completed', { cutoffDate });
  }

  private async cleanupFiles(cutoffDate: Date): Promise<void> {
    if (!this.config.fileConfig) return;

    const files = await fs.readdir(this.config.fileConfig.directory);
    
    for (const file of files) {
      const filePath = path.join(this.config.fileConfig.directory, file);
      const stats = await fs.stat(filePath);
      
      if (stats.mtime < cutoffDate) {
        await fs.unlink(filePath);
        console.log(`🗑️ Deleted old audit file: ${file}`);
      }
    }
  }

  private async cleanupDatabase(cutoffDate: Date): Promise<void> {
    if (!this.dbPool || !this.config.databaseConfig) return;

    const result = await this.dbPool.query(
      `DELETE FROM ${this.config.databaseConfig.tableName} WHERE timestamp < $1`,
      [cutoffDate]
    );

    console.log(`🗑️ Deleted ${result.rowCount} old audit entries`);
  }

  private async cleanupS3(cutoffDate: Date): Promise<void> {
    // S3 cleanup would require listing and deleting old objects
    // Consider using S3 lifecycle policies instead
  }

  async close(): Promise<void> {
    // Flush any remaining entries
    await this.flush();

    // Stop flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    // Close database connection
    if (this.dbPool) {
      await this.dbPool.end();
    }

    this.emit('closed');
  }
}