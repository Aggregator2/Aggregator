import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { OrderBookDatabaseConfig } from './config';
import { OrderBookDatabase } from './OrderBookDatabase';
import { PriceLevelIndex } from './PriceLevelIndex';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface BackupMetadata {
  id: string;
  timestamp: Date;
  type: 'full' | 'incremental';
  size: number;
  compressed: boolean;
  location: 'local' | 's3';
  path: string;
  stats: {
    orders: number;
    trades: number;
    snapshots: number;
  };
}

export class BackupManager extends EventEmitter {
  private config: OrderBookDatabaseConfig;
  private database: OrderBookDatabase;
  private s3Client?: S3Client;
  private backupInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;
  private lastBackup?: Date;
  private backupHistory: BackupMetadata[] = [];

  constructor(database: OrderBookDatabase, config: OrderBookDatabaseConfig) {
    super();
    this.database = database;
    this.config = config;

    // Initialize S3 client if configured
    if (config.backup.s3) {
      this.s3Client = new S3Client({
        region: config.backup.s3.region,
        credentials: {
          accessKeyId: config.backup.s3.accessKeyId,
          secretAccessKey: config.backup.s3.secretAccessKey
        }
      });
    }
  }

  // Start backup scheduler
  async start(): Promise<void> {
    if (!this.config.backup.enabled || this.isRunning) return;

    this.isRunning = true;

    // Create local backup directory if needed
    if (this.config.backup.local) {
      await fs.mkdir(this.config.backup.local.path, { recursive: true });
    }

    // Start periodic backups
    this.backupInterval = setInterval(() => {
      this.performBackup().catch(err => {
        console.error('Backup failed:', err);
        this.emit('backup:error', err);
      });
    }, this.config.backup.interval);

    // Perform initial backup
    await this.performBackup();

    this.emit('started');
    console.log('Backup manager started');
  }

  // Stop backup scheduler
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = undefined;
    }

    this.emit('stopped');
    console.log('Backup manager stopped');
  }

  // Perform backup
  async performBackup(type: 'full' | 'incremental' = 'full'): Promise<BackupMetadata> {
    const backupId = this.generateBackupId();
    const timestamp = new Date();

    console.log(`Starting ${type} backup ${backupId}`);
    this.emit('backup:started', { id: backupId, type });

    try {
      // Collect backup data
      const backupData = await this.collectBackupData(type);
      
      // Serialize data
      const jsonData = JSON.stringify(backupData, null, 2);
      let data = Buffer.from(jsonData);
      
      // Compress if configured
      if (this.config.backup.local?.compress) {
        data = await gzip(data);
      }

      // Save backup
      const metadata = await this.saveBackup(backupId, data, {
        id: backupId,
        timestamp,
        type,
        size: data.length,
        compressed: this.config.backup.local?.compress || false,
        location: 'local',
        path: '',
        stats: {
          orders: backupData.orders?.length || 0,
          trades: backupData.trades?.length || 0,
          snapshots: backupData.snapshots?.length || 0
        }
      });

      // Clean up old backups
      await this.cleanupOldBackups();

      this.lastBackup = timestamp;
      this.backupHistory.push(metadata);
      
      this.emit('backup:completed', metadata);
      console.log(`Backup ${backupId} completed successfully`);
      
      return metadata;
    } catch (error) {
      this.emit('backup:failed', { id: backupId, error });
      throw error;
    }
  }

  // Collect data for backup
  private async collectBackupData(type: 'full' | 'incremental'): Promise<any> {
    const data: any = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      type
    };

    // Get database statistics for metadata
    const stats = await this.database.getStatistics();
    data.stats = stats;

    if (type === 'full') {
      // Full backup - export all data
      
      // Export active orders from Redis
      const activeOrders = await this.exportActiveOrders();
      data.orders = activeOrders;

      // Export recent trades from Redis
      const recentTrades = await this.exportRecentTrades();
      data.trades = recentTrades;

      // Export order book snapshots
      const snapshots = await this.exportOrderBookSnapshots();
      data.snapshots = snapshots;

      // Export price level index data
      const indexData = await this.exportPriceLevelIndexes();
      data.indexes = indexData;

      // Export configuration
      data.config = {
        pairs: await this.getConfiguredPairs(),
        tickSizes: this.config.redis.keyPrefix // Simplified for example
      };
    } else {
      // Incremental backup - only changes since last backup
      if (!this.lastBackup) {
        throw new Error('No previous backup found for incremental backup');
      }

      // Export orders modified since last backup
      const modifiedOrders = await this.database.getOrderHistory(
        undefined,
        undefined,
        undefined,
        this.lastBackup,
        new Date(),
        10000
      );
      data.orders = modifiedOrders;

      // Export trades since last backup
      const newTrades = await this.database.getTradeHistory(
        undefined,
        this.lastBackup,
        new Date(),
        10000
      );
      data.trades = newTrades;
    }

    return data;
  }

  // Export active orders from Redis
  private async exportActiveOrders(): Promise<any[]> {
    // This would iterate through all active orders in Redis
    // Simplified for example
    return [];
  }

  // Export recent trades
  private async exportRecentTrades(): Promise<any[]> {
    // Export recent trades from all pairs
    const pairs = await this.getConfiguredPairs();
    const allTrades: any[] = [];

    for (const pair of pairs) {
      const trades = await this.database.getRecentTrades(pair, 1000);
      allTrades.push(...trades);
    }

    return allTrades;
  }

  // Export order book snapshots
  private async exportOrderBookSnapshots(): Promise<any[]> {
    const pairs = await this.getConfiguredPairs();
    const snapshots: any[] = [];

    for (const pair of pairs) {
      const snapshot = await this.database.getOrderBookSnapshot(pair, 100);
      snapshots.push({
        pair,
        snapshot,
        timestamp: new Date().toISOString()
      });
    }

    return snapshots;
  }

  // Export price level indexes
  private async exportPriceLevelIndexes(): Promise<any> {
    // This would export the price level index data
    // Simplified for example
    return {};
  }

  // Get configured trading pairs
  private async getConfiguredPairs(): Promise<string[]> {
    // This would get all configured trading pairs
    return ['ETH/USDC', 'BTC/USDT', 'SOL/USDC']; // Example pairs
  }

  // Save backup to storage
  private async saveBackup(
    backupId: string,
    data: Buffer,
    metadata: BackupMetadata
  ): Promise<BackupMetadata> {
    const filename = `backup-${backupId}.json${metadata.compressed ? '.gz' : ''}`;

    // Save to local storage
    if (this.config.backup.local) {
      const localPath = path.join(this.config.backup.local.path, filename);
      await fs.writeFile(localPath, data);
      metadata.path = localPath;
      metadata.location = 'local';
    }

    // Save to S3
    if (this.config.backup.s3 && this.s3Client) {
      const s3Key = `${this.config.backup.s3.prefix || ''}${filename}`;
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.config.backup.s3.bucket,
        Key: s3Key,
        Body: data,
        ContentType: metadata.compressed ? 'application/gzip' : 'application/json',
        Metadata: {
          'backup-id': backupId,
          'backup-type': metadata.type,
          'backup-timestamp': metadata.timestamp.toISOString()
        }
      }));

      metadata.path = s3Key;
      metadata.location = 's3';
    }

    return metadata;
  }

  // Restore from backup
  async restoreFromBackup(backupId: string): Promise<void> {
    const metadata = this.backupHistory.find(b => b.id === backupId);
    if (!metadata) {
      throw new Error(`Backup ${backupId} not found`);
    }

    console.log(`Starting restore from backup ${backupId}`);
    this.emit('restore:started', { id: backupId });

    try {
      // Load backup data
      const data = await this.loadBackup(metadata);
      
      // Validate backup data
      this.validateBackupData(data);

      // Clear existing data (be careful in production!)
      console.log('Clearing existing data...');
      
      // Restore data
      console.log('Restoring data...');
      
      // Restore orders
      if (data.orders) {
        for (const order of data.orders) {
          await this.database.addOrder(order);
        }
      }

      // Restore trades
      if (data.trades) {
        for (const trade of data.trades) {
          await this.database.addTrade(trade);
        }
      }

      // Restore snapshots and indexes would go here

      this.emit('restore:completed', { id: backupId });
      console.log(`Restore from backup ${backupId} completed successfully`);
    } catch (error) {
      this.emit('restore:failed', { id: backupId, error });
      throw error;
    }
  }

  // Load backup from storage
  private async loadBackup(metadata: BackupMetadata): Promise<any> {
    let data: Buffer;

    if (metadata.location === 'local') {
      data = await fs.readFile(metadata.path);
    } else if (metadata.location === 's3' && this.s3Client) {
      const response = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.config.backup.s3!.bucket,
        Key: metadata.path
      }));
      
      if (!response.Body) {
        throw new Error('Empty backup file');
      }
      
      data = Buffer.from(await response.Body.transformToByteArray());
    } else {
      throw new Error('Invalid backup location');
    }

    // Decompress if needed
    if (metadata.compressed) {
      data = await gunzip(data);
    }

    return JSON.parse(data.toString());
  }

  // Validate backup data
  private validateBackupData(data: any): void {
    if (!data.version || !data.timestamp || !data.type) {
      throw new Error('Invalid backup format');
    }

    // Additional validation logic here
  }

  // Clean up old backups
  private async cleanupOldBackups(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.backup.retention);

    // Clean up local backups
    if (this.config.backup.local) {
      const files = await fs.readdir(this.config.backup.local.path);
      
      for (const file of files) {
        if (!file.startsWith('backup-')) continue;
        
        const filePath = path.join(this.config.backup.local.path, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          console.log(`Deleted old backup: ${file}`);
        }
      }
    }

    // Clean up S3 backups
    if (this.config.backup.s3 && this.s3Client) {
      const response = await this.s3Client.send(new ListObjectsV2Command({
        Bucket: this.config.backup.s3.bucket,
        Prefix: this.config.backup.s3.prefix || ''
      }));

      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.LastModified && object.LastModified < cutoffDate && object.Key) {
            // Delete old backup from S3
            console.log(`Would delete old S3 backup: ${object.Key}`);
          }
        }
      }
    }

    // Clean up backup history
    this.backupHistory = this.backupHistory.filter(b => b.timestamp >= cutoffDate);
  }

  // Generate backup ID
  private generateBackupId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  // Get backup history
  getBackupHistory(): BackupMetadata[] {
    return [...this.backupHistory];
  }

  // Get backup statistics
  getStatistics(): {
    lastBackup: Date | null;
    totalBackups: number;
    totalSize: number;
    isRunning: boolean;
  } {
    const totalSize = this.backupHistory.reduce((sum, b) => sum + b.size, 0);

    return {
      lastBackup: this.lastBackup || null,
      totalBackups: this.backupHistory.length,
      totalSize,
      isRunning: this.isRunning
    };
  }
}