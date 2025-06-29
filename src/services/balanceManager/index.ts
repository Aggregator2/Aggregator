export * from './types';
export * from './BalanceManager';
export * from './AuditService';
export * from './BalanceStorage';

import { BalanceManager } from './BalanceManager';
import { AuditService } from './AuditService';
import { BalanceStorage, StorageConfig } from './BalanceStorage';

export interface BalanceSystemConfig {
  storage?: StorageConfig;
  enableAudit?: boolean;
}

export class BalanceSystem {
  public readonly balanceManager: BalanceManager;
  public readonly auditService?: AuditService;
  public readonly storage?: BalanceStorage;

  constructor(config?: BalanceSystemConfig) {
    this.balanceManager = new BalanceManager();

    if (config?.enableAudit) {
      this.auditService = new AuditService(this.balanceManager);
    }

    if (config?.storage) {
      this.storage = new BalanceStorage(config.storage);
      this.setupStorageSync();
    }
  }

  private setupStorageSync(): void {
    if (!this.storage) return;

    // Save balance updates to storage
    this.balanceManager.on('balanceUpdate', async (update) => {
      await this.storage!.saveBalanceUpdate(update);
      const balance = await this.balanceManager.getBalance(update.userId, update.tokenAddress);
      await this.storage!.saveBalance(balance);
    });

    // Save withdrawal requests
    this.balanceManager.on('withdrawalRequested', async (request) => {
      await this.storage!.saveWithdrawalRequest(request);
    });
  }

  public async initialize(): Promise<void> {
    // Load existing data from storage if available
    if (this.storage) {
      console.log('Loading balance data from storage...');
      // Implementation would load and restore state
    }
  }

  public stop(): void {
    if (this.storage) {
      this.storage.stop();
    }
  }
}