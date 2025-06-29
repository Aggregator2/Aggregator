import { Balance, BalanceUpdate, BalanceSnapshot, WithdrawalRequest } from './types';
import { Address } from 'viem';
import fs from 'fs/promises';
import path from 'path';

export interface StorageConfig {
  dataDir: string;
  backupInterval: number; // minutes
  compressionEnabled: boolean;
}

export class BalanceStorage {
  private config: StorageConfig;
  private backupTimer?: NodeJS.Timeout;

  constructor(config: StorageConfig) {
    this.config = config;
    this.initializeStorage();
  }

  private async initializeStorage(): Promise<void> {
    // Create data directories
    const dirs = [
      this.config.dataDir,
      path.join(this.config.dataDir, 'balances'),
      path.join(this.config.dataDir, 'updates'),
      path.join(this.config.dataDir, 'snapshots'),
      path.join(this.config.dataDir, 'withdrawals'),
      path.join(this.config.dataDir, 'backups'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Start backup timer
    if (this.config.backupInterval > 0) {
      this.backupTimer = setInterval(
        () => this.performBackup(),
        this.config.backupInterval * 60 * 1000
      );
    }
  }

  public async saveBalance(balance: Balance): Promise<void> {
    const key = `${balance.userId}-${balance.tokenAddress.toLowerCase()}`;
    const filePath = path.join(this.config.dataDir, 'balances', `${key}.json`);
    
    await fs.writeFile(
      filePath,
      JSON.stringify({
        ...balance,
        available: balance.available.toString(),
        locked: balance.locked.toString(),
        lastUpdated: balance.lastUpdated.toISOString(),
      }, null, 2)
    );
  }

  public async loadBalance(userId: string, tokenAddress: Address): Promise<Balance | null> {
    const key = `${userId}-${tokenAddress.toLowerCase()}`;
    const filePath = path.join(this.config.dataDir, 'balances', `${key}.json`);
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      return {
        ...parsed,
        available: BigInt(parsed.available),
        locked: BigInt(parsed.locked),
        lastUpdated: new Date(parsed.lastUpdated),
      };
    } catch (error) {
      return null;
    }
  }

  public async saveBalanceUpdate(update: BalanceUpdate): Promise<void> {
    const fileName = `${update.timestamp.getTime()}-${update.id}.json`;
    const filePath = path.join(this.config.dataDir, 'updates', fileName);
    
    await fs.writeFile(
      filePath,
      JSON.stringify({
        ...update,
        amount: update.amount.toString(),
        previousBalance: update.previousBalance.toString(),
        newBalance: update.newBalance.toString(),
        timestamp: update.timestamp.toISOString(),
      }, null, 2)
    );
  }

  public async loadBalanceUpdates(
    userId?: string,
    tokenAddress?: Address,
    startDate?: Date,
    endDate?: Date
  ): Promise<BalanceUpdate[]> {
    const updateFiles = await fs.readdir(path.join(this.config.dataDir, 'updates'));
    const updates: BalanceUpdate[] = [];
    
    for (const file of updateFiles) {
      const filePath = path.join(this.config.dataDir, 'updates', file);
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      const update: BalanceUpdate = {
        ...parsed,
        amount: BigInt(parsed.amount),
        previousBalance: BigInt(parsed.previousBalance),
        newBalance: BigInt(parsed.newBalance),
        timestamp: new Date(parsed.timestamp),
      };
      
      // Apply filters
      if (userId && update.userId !== userId) continue;
      if (tokenAddress && update.tokenAddress.toLowerCase() !== tokenAddress.toLowerCase()) continue;
      if (startDate && update.timestamp < startDate) continue;
      if (endDate && update.timestamp > endDate) continue;
      
      updates.push(update);
    }
    
    return updates.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  public async saveSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    const fileName = `${snapshot.timestamp.getTime()}-${snapshot.id}.json`;
    const filePath = path.join(this.config.dataDir, 'snapshots', fileName);
    
    await fs.writeFile(
      filePath,
      JSON.stringify({
        ...snapshot,
        balance: snapshot.balance.toString(),
        blockNumber: snapshot.blockNumber.toString(),
        timestamp: snapshot.timestamp.toISOString(),
      }, null, 2)
    );
  }

  public async loadSnapshots(
    userId?: string,
    tokenAddress?: Address,
    startDate?: Date,
    endDate?: Date
  ): Promise<BalanceSnapshot[]> {
    const snapshotFiles = await fs.readdir(path.join(this.config.dataDir, 'snapshots'));
    const snapshots: BalanceSnapshot[] = [];
    
    for (const file of snapshotFiles) {
      const filePath = path.join(this.config.dataDir, 'snapshots', file);
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      const snapshot: BalanceSnapshot = {
        ...parsed,
        balance: BigInt(parsed.balance),
        blockNumber: BigInt(parsed.blockNumber),
        timestamp: new Date(parsed.timestamp),
      };
      
      // Apply filters
      if (userId && snapshot.userId !== userId) continue;
      if (tokenAddress && snapshot.tokenAddress.toLowerCase() !== tokenAddress.toLowerCase()) continue;
      if (startDate && snapshot.timestamp < startDate) continue;
      if (endDate && snapshot.timestamp > endDate) continue;
      
      snapshots.push(snapshot);
    }
    
    return snapshots.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  public async saveWithdrawalRequest(request: WithdrawalRequest): Promise<void> {
    const filePath = path.join(this.config.dataDir, 'withdrawals', `${request.id}.json`);
    
    await fs.writeFile(
      filePath,
      JSON.stringify({
        ...request,
        amount: request.amount.toString(),
        requestedAt: request.requestedAt.toISOString(),
        processedAt: request.processedAt?.toISOString(),
      }, null, 2)
    );
  }

  public async loadWithdrawalRequest(id: string): Promise<WithdrawalRequest | null> {
    const filePath = path.join(this.config.dataDir, 'withdrawals', `${id}.json`);
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      return {
        ...parsed,
        amount: BigInt(parsed.amount),
        requestedAt: new Date(parsed.requestedAt),
        processedAt: parsed.processedAt ? new Date(parsed.processedAt) : undefined,
      };
    } catch (error) {
      return null;
    }
  }

  private async performBackup(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.config.dataDir, 'backups', timestamp);
    
    await fs.mkdir(backupDir, { recursive: true });
    
    // Copy all data directories
    const dirs = ['balances', 'updates', 'snapshots', 'withdrawals'];
    
    for (const dir of dirs) {
      const sourceDir = path.join(this.config.dataDir, dir);
      const targetDir = path.join(backupDir, dir);
      
      await fs.mkdir(targetDir, { recursive: true });
      
      const files = await fs.readdir(sourceDir);
      for (const file of files) {
        await fs.copyFile(
          path.join(sourceDir, file),
          path.join(targetDir, file)
        );
      }
    }
    
    // Clean old backups (keep last 7 days)
    const backups = await fs.readdir(path.join(this.config.dataDir, 'backups'));
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    
    for (const backup of backups) {
      const backupPath = path.join(this.config.dataDir, 'backups', backup);
      const stats = await fs.stat(backupPath);
      
      if (stats.mtimeMs < cutoff) {
        await fs.rm(backupPath, { recursive: true });
      }
    }
  }

  public async exportData(exportPath: string): Promise<void> {
    const exportData = {
      timestamp: new Date().toISOString(),
      balances: await this.loadAllBalances(),
      updates: await this.loadBalanceUpdates(),
      snapshots: await this.loadSnapshots(),
      withdrawals: await this.loadAllWithdrawals(),
    };
    
    await fs.writeFile(
      exportPath,
      JSON.stringify(exportData, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value, 
        2
      )
    );
  }

  private async loadAllBalances(): Promise<Balance[]> {
    const balanceFiles = await fs.readdir(path.join(this.config.dataDir, 'balances'));
    const balances: Balance[] = [];
    
    for (const file of balanceFiles) {
      const filePath = path.join(this.config.dataDir, 'balances', file);
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      balances.push({
        ...parsed,
        available: BigInt(parsed.available),
        locked: BigInt(parsed.locked),
        lastUpdated: new Date(parsed.lastUpdated),
      });
    }
    
    return balances;
  }

  private async loadAllWithdrawals(): Promise<WithdrawalRequest[]> {
    const withdrawalFiles = await fs.readdir(path.join(this.config.dataDir, 'withdrawals'));
    const withdrawals: WithdrawalRequest[] = [];
    
    for (const file of withdrawalFiles) {
      const filePath = path.join(this.config.dataDir, 'withdrawals', file);
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      withdrawals.push({
        ...parsed,
        amount: BigInt(parsed.amount),
        requestedAt: new Date(parsed.requestedAt),
        processedAt: parsed.processedAt ? new Date(parsed.processedAt) : undefined,
      });
    }
    
    return withdrawals;
  }

  public stop(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }
  }
}