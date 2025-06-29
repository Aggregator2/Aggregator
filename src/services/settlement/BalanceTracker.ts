import { EventEmitter } from 'events';
import { Trade } from '../matchingEngine/types';
import { UserBalance, Settlement } from './types';

interface BalanceSnapshot {
  timestamp: number;
  balances: Map<string, Map<string, bigint>>;
  pendingSettlements: Map<string, Map<string, bigint>>;
}

interface BalanceUpdate {
  userId: string;
  token: string;
  previousBalance: bigint;
  newBalance: bigint;
  change: bigint;
  reason: 'TRADE' | 'SETTLEMENT' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE';
  reference: string;
  timestamp: number;
}

export class BalanceTracker extends EventEmitter {
  private balances: Map<string, UserBalance> = new Map();
  private balanceHistory: BalanceUpdate[] = [];
  private snapshots: BalanceSnapshot[] = [];
  private maxHistorySize: number = 10000;
  private snapshotInterval: number = 3600000; // 1 hour
  private lastSnapshotTime: number = Date.now();
  
  constructor() {
    super();
    this.startSnapshotScheduler();
  }
  
  // Get user balance
  public getUserBalance(userId: string): UserBalance | undefined {
    return this.balances.get(userId);
  }
  
  // Get balance for specific token
  public getTokenBalance(userId: string, token: string): bigint {
    const userBalance = this.balances.get(userId);
    if (!userBalance) return BigInt(0);
    
    return userBalance.balances.get(token) || BigInt(0);
  }
  
  // Update balance for pending trade
  public async updatePendingTrade(trade: Trade): Promise<void> {
    const baseToken = this.getBaseToken(trade.pair);
    const quoteToken = this.getQuoteToken(trade.pair);
    const tradeValue = BigInt(Math.floor(trade.price * trade.filledQuantity * 1e8));
    const quantity = BigInt(Math.floor(trade.filledQuantity * 1e8));
    
    // Update buyer's pending settlements
    this.updatePendingSettlement(trade.buyerId, baseToken, quantity);
    this.updatePendingSettlement(trade.buyerId, quoteToken, -tradeValue);
    
    // Update seller's pending settlements
    this.updatePendingSettlement(trade.sellerId, baseToken, -quantity);
    this.updatePendingSettlement(trade.sellerId, quoteToken, tradeValue);
    
    // Account for fees in pending settlements
    if (trade.buyerFee > 0) {
      const buyerFee = BigInt(Math.floor(trade.buyerFee * 1e8));
      this.updatePendingSettlement(trade.buyerId, quoteToken, -buyerFee);
    }
    
    if (trade.sellerFee > 0) {
      const sellerFee = BigInt(Math.floor(trade.sellerFee * 1e8));
      this.updatePendingSettlement(trade.sellerId, quoteToken, -sellerFee);
    }
    
    this.emit('pendingTradeUpdated', trade);
  }
  
  // Apply settlement to balances
  public async applySettlement(settlement: Settlement): Promise<void> {
    for (const position of settlement.netAmounts) {
      const previousBalance = this.getTokenBalance(position.userId, position.token);
      const newBalance = previousBalance + position.netAmount;
      
      // Update balance
      this.updateBalance(
        position.userId,
        position.token,
        newBalance,
        'SETTLEMENT',
        settlement.id
      );
      
      // Clear pending settlement for this user/token
      this.clearPendingSettlement(position.userId, position.token);
    }
    
    this.emit('settlementApplied', settlement);
  }
  
  // Update user balance
  private updateBalance(
    userId: string,
    token: string,
    newBalance: bigint,
    reason: BalanceUpdate['reason'],
    reference: string
  ): void {
    // Ensure user exists
    if (!this.balances.has(userId)) {
      this.balances.set(userId, {
        userId,
        balances: new Map(),
        pendingSettlements: new Map(),
        lastUpdated: Date.now()
      });
    }
    
    const userBalance = this.balances.get(userId)!;
    const previousBalance = userBalance.balances.get(token) || BigInt(0);
    
    // Update balance
    userBalance.balances.set(token, newBalance);
    userBalance.lastUpdated = Date.now();
    
    // Record update
    const update: BalanceUpdate = {
      userId,
      token,
      previousBalance,
      newBalance,
      change: newBalance - previousBalance,
      reason,
      reference,
      timestamp: Date.now()
    };
    
    this.balanceHistory.push(update);
    this.trimHistory();
    
    this.emit('balanceUpdated', update);
  }
  
  // Update pending settlement
  private updatePendingSettlement(
    userId: string,
    token: string,
    amount: bigint
  ): void {
    if (!this.balances.has(userId)) {
      this.balances.set(userId, {
        userId,
        balances: new Map(),
        pendingSettlements: new Map(),
        lastUpdated: Date.now()
      });
    }
    
    const userBalance = this.balances.get(userId)!;
    const current = userBalance.pendingSettlements.get(token) || BigInt(0);
    userBalance.pendingSettlements.set(token, current + amount);
  }
  
  // Clear pending settlement
  private clearPendingSettlement(userId: string, token: string): void {
    const userBalance = this.balances.get(userId);
    if (!userBalance) return;
    
    userBalance.pendingSettlements.delete(token);
  }
  
  // Process deposit
  public async processDeposit(
    userId: string,
    token: string,
    amount: bigint,
    txHash: string
  ): Promise<void> {
    const currentBalance = this.getTokenBalance(userId, token);
    const newBalance = currentBalance + amount;
    
    this.updateBalance(userId, token, newBalance, 'DEPOSIT', txHash);
    
    this.emit('depositProcessed', {
      userId,
      token,
      amount,
      txHash,
      newBalance
    });
  }
  
  // Process withdrawal
  public async processWithdrawal(
    userId: string,
    token: string,
    amount: bigint,
    txHash: string
  ): Promise<void> {
    const currentBalance = this.getTokenBalance(userId, token);
    
    if (currentBalance < amount) {
      throw new Error('Insufficient balance for withdrawal');
    }
    
    const newBalance = currentBalance - amount;
    
    this.updateBalance(userId, token, newBalance, 'WITHDRAWAL', txHash);
    
    this.emit('withdrawalProcessed', {
      userId,
      token,
      amount,
      txHash,
      newBalance
    });
  }
  
  // Get balance history for user
  public getBalanceHistory(
    userId: string,
    token?: string,
    limit: number = 100
  ): BalanceUpdate[] {
    let history = this.balanceHistory.filter(update => 
      update.userId === userId &&
      (!token || update.token === token)
    );
    
    return history.slice(-limit);
  }
  
  // Get aggregated balances for all users
  public getAggregatedBalances(): Map<string, bigint> {
    const aggregated = new Map<string, bigint>();
    
    for (const [userId, userBalance] of this.balances) {
      for (const [token, balance] of userBalance.balances) {
        const current = aggregated.get(token) || BigInt(0);
        aggregated.set(token, current + balance);
      }
    }
    
    return aggregated;
  }
  
  // Get pending settlements summary
  public getPendingSettlementsSummary(): Map<string, bigint> {
    const summary = new Map<string, bigint>();
    
    for (const [userId, userBalance] of this.balances) {
      for (const [token, pending] of userBalance.pendingSettlements) {
        const current = summary.get(token) || BigInt(0);
        summary.set(token, current + bigIntAbs(pending));
      }
    }
    
    return summary;
  }
  
  // Create balance snapshot
  private createSnapshot(): void {
    const snapshot: BalanceSnapshot = {
      timestamp: Date.now(),
      balances: new Map(),
      pendingSettlements: new Map()
    };
    
    // Deep copy balances
    for (const [userId, userBalance] of this.balances) {
      snapshot.balances.set(userId, new Map(userBalance.balances));
      snapshot.pendingSettlements.set(userId, new Map(userBalance.pendingSettlements));
    }
    
    this.snapshots.push(snapshot);
    
    // Keep only last 24 snapshots (24 hours)
    if (this.snapshots.length > 24) {
      this.snapshots.shift();
    }
    
    this.lastSnapshotTime = Date.now();
    this.emit('snapshotCreated', snapshot);
  }
  
  // Start snapshot scheduler
  private startSnapshotScheduler(): void {
    setInterval(() => {
      this.createSnapshot();
    }, this.snapshotInterval);
  }
  
  // Get snapshot at specific time
  public getSnapshotAt(timestamp: number): BalanceSnapshot | undefined {
    // Find closest snapshot
    let closest: BalanceSnapshot | undefined;
    let minDiff = Number.MAX_SAFE_INTEGER;
    
    for (const snapshot of this.snapshots) {
      const diff = Math.abs(snapshot.timestamp - timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snapshot;
      }
    }
    
    return closest;
  }
  
  // Rebuild balances from history (for recovery)
  public async rebuildFromHistory(history: BalanceUpdate[]): Promise<void> {
    // Clear current state
    this.balances.clear();
    
    // Replay all updates
    for (const update of history) {
      if (!this.balances.has(update.userId)) {
        this.balances.set(update.userId, {
          userId: update.userId,
          balances: new Map(),
          pendingSettlements: new Map(),
          lastUpdated: update.timestamp
        });
      }
      
      const userBalance = this.balances.get(update.userId)!;
      userBalance.balances.set(update.token, update.newBalance);
      userBalance.lastUpdated = update.timestamp;
    }
    
    this.emit('balancesRebuilt', { updateCount: history.length });
  }
  
  // Export balances for reconciliation
  public exportBalances(): any {
    const exported: any = {
      timestamp: Date.now(),
      users: {}
    };
    
    for (const [userId, userBalance] of this.balances) {
      exported.users[userId] = {
        balances: Object.fromEntries(userBalance.balances),
        pendingSettlements: Object.fromEntries(userBalance.pendingSettlements),
        lastUpdated: userBalance.lastUpdated
      };
    }
    
    return exported;
  }
  
  // Validate balance integrity
  public validateIntegrity(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check for negative balances
    for (const [userId, userBalance] of this.balances) {
      for (const [token, balance] of userBalance.balances) {
        if (balance < 0) {
          errors.push(`Negative balance for ${userId} ${token}: ${balance}`);
        }
      }
    }
    
    // Check balance history consistency
    const rebuiltBalances = new Map<string, Map<string, bigint>>();
    
    for (const update of this.balanceHistory) {
      if (!rebuiltBalances.has(update.userId)) {
        rebuiltBalances.set(update.userId, new Map());
      }
      
      rebuiltBalances.get(update.userId)!.set(update.token, update.newBalance);
    }
    
    // Compare with current balances
    for (const [userId, userBalance] of this.balances) {
      const rebuilt = rebuiltBalances.get(userId);
      if (!rebuilt) continue;
      
      for (const [token, balance] of userBalance.balances) {
        const rebuiltBalance = rebuilt.get(token) || BigInt(0);
        if (balance !== rebuiltBalance) {
          errors.push(
            `Balance mismatch for ${userId} ${token}: ` +
            `current=${balance}, rebuilt=${rebuiltBalance}`
          );
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  // Trim history to max size
  private trimHistory(): void {
    if (this.balanceHistory.length > this.maxHistorySize) {
      this.balanceHistory = this.balanceHistory.slice(-this.maxHistorySize);
    }
  }
  
  // Helper methods
  private getBaseToken(pair: string): string {
    return pair.split('/')[0];
  }
  
  private getQuoteToken(pair: string): string {
    return pair.split('/')[1];
  }
  
  // Get statistics
  public getStatistics(): any {
    return {
      totalUsers: this.balances.size,
      totalBalanceUpdates: this.balanceHistory.length,
      snapshotCount: this.snapshots.length,
      lastSnapshotTime: this.lastSnapshotTime,
      aggregatedBalances: Object.fromEntries(this.getAggregatedBalances()),
      pendingSettlements: Object.fromEntries(this.getPendingSettlementsSummary())
    };
  }
}

// Helper function
function bigIntAbs(a: bigint): bigint {
  return a < 0 ? -a : a;
}