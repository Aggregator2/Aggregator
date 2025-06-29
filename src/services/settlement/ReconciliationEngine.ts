import { EventEmitter } from 'events';
import { 
  ReconciliationReport, 
  ReconciliationDiscrepancy,
  UserBalance 
} from './types';
import { BalanceTracker } from './BalanceTracker';

interface ReconciliationConfig {
  schedule: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MANUAL';
  tolerance: bigint; // Acceptable difference threshold
  autoResolve: boolean;
  maxDiscrepancyAge: number; // ms
}

interface OnChainBalanceProvider {
  getBalance(userId: string, token: string): Promise<bigint>;
  getAllBalances(): Promise<Map<string, Map<string, bigint>>>;
}

export class ReconciliationEngine extends EventEmitter {
  private balanceTracker: BalanceTracker;
  private onChainProvider: OnChainBalanceProvider | null = null;
  private reports: Map<string, ReconciliationReport> = new Map();
  private activeReport: ReconciliationReport | null = null;
  private config: ReconciliationConfig;
  private isReconciling: boolean = false;
  private lastReconciliation: number = 0;
  
  constructor(
    balanceTracker: BalanceTracker,
    config?: Partial<ReconciliationConfig>
  ) {
    super();
    this.balanceTracker = balanceTracker;
    
    this.config = {
      schedule: config?.schedule || 'DAILY',
      tolerance: config?.tolerance || BigInt(1000), // Default 0.00001 tokens
      autoResolve: config?.autoResolve || false,
      maxDiscrepancyAge: config?.maxDiscrepancyAge || 86400000 // 24 hours
    };
    
    if (this.config.schedule !== 'MANUAL') {
      this.startScheduler();
    }
  }
  
  // Set on-chain balance provider
  public setOnChainProvider(provider: OnChainBalanceProvider): void {
    this.onChainProvider = provider;
  }
  
  // Perform reconciliation
  public async performReconciliation(): Promise<ReconciliationReport> {
    if (this.isReconciling) {
      throw new Error('Reconciliation already in progress');
    }
    
    if (!this.onChainProvider) {
      throw new Error('On-chain balance provider not set');
    }
    
    this.isReconciling = true;
    
    try {
      const report = await this.createReport();
      this.activeReport = report;
      
      this.emit('reconciliationStarted', report);
      
      // Get balances
      const offChainBalances = await this.getOffChainBalances();
      const onChainBalances = await this.onChainProvider.getAllBalances();
      
      // Compare balances
      const discrepancies = await this.compareBalances(
        offChainBalances,
        onChainBalances
      );
      
      // Update report
      report.offChainBalances = offChainBalances;
      report.onChainBalances = onChainBalances;
      report.discrepancies = discrepancies;
      report.pendingCount = discrepancies.filter(d => !d.resolved).length;
      
      // Auto-resolve if enabled
      if (this.config.autoResolve) {
        await this.autoResolveDiscrepancies(report);
      }
      
      // Finalize report
      report.status = 'COMPLETED';
      report.endTime = Date.now();
      
      this.reports.set(report.id, report);
      this.lastReconciliation = Date.now();
      this.activeReport = null;
      
      this.emit('reconciliationCompleted', report);
      
      return report;
      
    } catch (error) {
      if (this.activeReport) {
        this.activeReport.status = 'FAILED';
        this.reports.set(this.activeReport.id, this.activeReport);
      }
      throw error;
    } finally {
      this.isReconciling = false;
    }
  }
  
  // Create new reconciliation report
  private async createReport(): Promise<ReconciliationReport> {
    return {
      id: `REC_${Date.now()}`,
      startTime: Date.now(),
      endTime: 0,
      offChainBalances: new Map(),
      onChainBalances: new Map(),
      discrepancies: [],
      status: 'IN_PROGRESS',
      resolvedCount: 0,
      pendingCount: 0
    };
  }
  
  // Get off-chain balances
  private async getOffChainBalances(): Promise<Map<string, UserBalance>> {
    const balances = new Map<string, UserBalance>();
    const exported = this.balanceTracker.exportBalances();
    
    for (const [userId, userData] of Object.entries(exported.users)) {
      const userBalance: UserBalance = {
        userId,
        balances: new Map(Object.entries(userData.balances).map(
          ([token, balance]) => [token, BigInt(balance)]
        )),
        pendingSettlements: new Map(Object.entries(userData.pendingSettlements).map(
          ([token, amount]) => [token, BigInt(amount)]
        )),
        lastUpdated: userData.lastUpdated
      };
      
      balances.set(userId, userBalance);
    }
    
    return balances;
  }
  
  // Compare off-chain and on-chain balances
  private async compareBalances(
    offChain: Map<string, UserBalance>,
    onChain: Map<string, Map<string, bigint>>
  ): Promise<ReconciliationDiscrepancy[]> {
    const discrepancies: ReconciliationDiscrepancy[] = [];
    const allUsers = new Set([...offChain.keys(), ...onChain.keys()]);
    
    for (const userId of allUsers) {
      const offChainUser = offChain.get(userId);
      const onChainUser = onChain.get(userId);
      
      // Get all tokens for this user
      const allTokens = new Set<string>();
      if (offChainUser) {
        offChainUser.balances.forEach((_, token) => allTokens.add(token));
      }
      if (onChainUser) {
        onChainUser.forEach((_, token) => allTokens.add(token));
      }
      
      // Compare each token
      for (const token of allTokens) {
        const offChainBalance = offChainUser?.balances.get(token) || BigInt(0);
        const onChainBalance = onChainUser?.get(token) || BigInt(0);
        const difference = offChainBalance - onChainBalance;
        
        // Check if difference exceeds tolerance
        if (bigIntAbs(difference) > this.config.tolerance) {
          const discrepancy: ReconciliationDiscrepancy = {
            userId,
            token,
            offChainBalance,
            onChainBalance,
            difference,
            type: this.classifyDiscrepancy(difference, offChainUser),
            resolved: false
          };
          
          discrepancies.push(discrepancy);
          this.emit('discrepancyFound', discrepancy);
        }
      }
    }
    
    return discrepancies;
  }
  
  // Classify discrepancy type
  private classifyDiscrepancy(
    difference: bigint,
    offChainUser: UserBalance | undefined
  ): ReconciliationDiscrepancy['type'] {
    if (!offChainUser || offChainUser.pendingSettlements.size > 0) {
      return 'MISSING_SETTLEMENT';
    }
    
    if (difference > 0) {
      return 'DOUBLE_SETTLEMENT';
    }
    
    return 'BALANCE_MISMATCH';
  }
  
  // Auto-resolve discrepancies
  private async autoResolveDiscrepancies(
    report: ReconciliationReport
  ): Promise<void> {
    for (const discrepancy of report.discrepancies) {
      if (discrepancy.resolved) continue;
      
      try {
        const resolved = await this.tryAutoResolve(discrepancy);
        
        if (resolved) {
          discrepancy.resolved = true;
          report.resolvedCount++;
          report.pendingCount--;
          
          this.emit('discrepancyResolved', discrepancy);
        }
      } catch (error) {
        console.error(`Failed to auto-resolve discrepancy:`, error);
      }
    }
  }
  
  // Try to auto-resolve a discrepancy
  private async tryAutoResolve(
    discrepancy: ReconciliationDiscrepancy
  ): Promise<boolean> {
    switch (discrepancy.type) {
      case 'MISSING_SETTLEMENT':
        // Check if there are pending settlements
        const userBalance = await this.balanceTracker.getUserBalance(discrepancy.userId);
        if (userBalance) {
          const pending = userBalance.pendingSettlements.get(discrepancy.token);
          if (pending && pending === discrepancy.difference) {
            discrepancy.resolution = 'Pending settlement matches difference';
            return true;
          }
        }
        break;
        
      case 'DOUBLE_SETTLEMENT':
        // Check recent settlement history
        const history = this.balanceTracker.getBalanceHistory(
          discrepancy.userId,
          discrepancy.token,
          50
        );
        
        // Look for duplicate settlements
        const settlementMap = new Map<string, number>();
        for (const update of history) {
          if (update.reason === 'SETTLEMENT') {
            const count = settlementMap.get(update.reference) || 0;
            settlementMap.set(update.reference, count + 1);
            
            if (count > 0) {
              discrepancy.resolution = `Duplicate settlement found: ${update.reference}`;
              return true;
            }
          }
        }
        break;
        
      case 'BALANCE_MISMATCH':
        // Small mismatches might be due to rounding
        if (bigIntAbs(discrepancy.difference) < BigInt(10000)) {
          discrepancy.resolution = 'Rounding difference within acceptable range';
          return true;
        }
        break;
    }
    
    return false;
  }
  
  // Manually resolve discrepancy
  public async resolveDiscrepancy(
    reportId: string,
    discrepancyIndex: number,
    resolution: string,
    adjustBalance: boolean = false
  ): Promise<void> {
    const report = this.reports.get(reportId);
    if (!report) {
      throw new Error('Report not found');
    }
    
    const discrepancy = report.discrepancies[discrepancyIndex];
    if (!discrepancy) {
      throw new Error('Discrepancy not found');
    }
    
    if (discrepancy.resolved) {
      throw new Error('Discrepancy already resolved');
    }
    
    // Mark as resolved
    discrepancy.resolved = true;
    discrepancy.resolution = resolution;
    report.resolvedCount++;
    report.pendingCount--;
    
    // Adjust balance if requested
    if (adjustBalance) {
      // Update off-chain balance to match on-chain
      const currentBalance = this.balanceTracker.getTokenBalance(
        discrepancy.userId,
        discrepancy.token
      );
      
      const adjustment = discrepancy.onChainBalance - currentBalance;
      
      if (adjustment !== BigInt(0)) {
        await this.balanceTracker.processDeposit(
          discrepancy.userId,
          discrepancy.token,
          adjustment > 0 ? adjustment : -adjustment,
          `RECONCILIATION_${report.id}`
        );
      }
    }
    
    this.emit('discrepancyManuallyResolved', { discrepancy, resolution });
  }
  
  // Get reconciliation report
  public getReport(reportId: string): ReconciliationReport | undefined {
    return this.reports.get(reportId);
  }
  
  // Get all reports
  public getAllReports(limit: number = 10): ReconciliationReport[] {
    const reports = Array.from(this.reports.values());
    return reports.slice(-limit);
  }
  
  // Get pending discrepancies
  public getPendingDiscrepancies(): ReconciliationDiscrepancy[] {
    const pending: ReconciliationDiscrepancy[] = [];
    
    for (const report of this.reports.values()) {
      if (report.status === 'COMPLETED') {
        pending.push(...report.discrepancies.filter(d => !d.resolved));
      }
    }
    
    return pending;
  }
  
  // Clean up old discrepancies
  public cleanupOldDiscrepancies(): void {
    const cutoffTime = Date.now() - this.config.maxDiscrepancyAge;
    
    for (const report of this.reports.values()) {
      if (report.endTime < cutoffTime && report.pendingCount === 0) {
        this.reports.delete(report.id);
      }
    }
  }
  
  // Start scheduler
  private startScheduler(): void {
    const intervals = {
      HOURLY: 3600000,
      DAILY: 86400000,
      WEEKLY: 604800000,
      MANUAL: 0
    };
    
    const interval = intervals[this.config.schedule];
    if (interval > 0) {
      setInterval(async () => {
        try {
          await this.performReconciliation();
        } catch (error) {
          console.error('Scheduled reconciliation failed:', error);
        }
      }, interval);
    }
  }
  
  // Get statistics
  public getStatistics(): any {
    const totalDiscrepancies = Array.from(this.reports.values())
      .reduce((sum, report) => sum + report.discrepancies.length, 0);
    
    const resolvedDiscrepancies = Array.from(this.reports.values())
      .reduce((sum, report) => sum + report.resolvedCount, 0);
    
    const accuracy = totalDiscrepancies > 0
      ? (resolvedDiscrepancies / totalDiscrepancies) * 100
      : 100;
    
    return {
      totalReports: this.reports.size,
      lastReconciliation: this.lastReconciliation,
      totalDiscrepancies,
      resolvedDiscrepancies,
      pendingDiscrepancies: this.getPendingDiscrepancies().length,
      accuracy: Math.round(accuracy * 100) / 100,
      config: this.config
    };
  }
  
  // Update configuration
  public updateConfig(config: Partial<ReconciliationConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }
}

// Mock on-chain provider for testing
export class MockOnChainProvider implements OnChainBalanceProvider {
  private balances: Map<string, Map<string, bigint>> = new Map();
  
  async getBalance(userId: string, token: string): Promise<bigint> {
    return this.balances.get(userId)?.get(token) || BigInt(0);
  }
  
  async getAllBalances(): Promise<Map<string, Map<string, bigint>>> {
    return new Map(this.balances);
  }
  
  // For testing - set balance
  setBalance(userId: string, token: string, balance: bigint): void {
    if (!this.balances.has(userId)) {
      this.balances.set(userId, new Map());
    }
    this.balances.get(userId)!.set(token, balance);
  }
}

// Helper function
function bigIntAbs(a: bigint): bigint {
  return a < 0 ? -a : a;
}