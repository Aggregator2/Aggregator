import { EventEmitter } from 'events';
import { Trade } from '../matchingEngine/types';
import {
  Settlement,
  SettlementStatus,
  SettlementCycle,
  SettlementEvent,
  SettlementMetrics,
  UserBalance,
  NetPosition,
  SettlementBatch
} from './types';
import { AtomicSwapEngine } from './AtomicSwapEngine';
import { NettingEngine } from './NettingEngine';
import { ClearingHouse } from './ClearingHouse';
import { BalanceTracker } from './BalanceTracker';
import { ReconciliationEngine } from './ReconciliationEngine';

export class SettlementEngine extends EventEmitter {
  private atomicSwapEngine: AtomicSwapEngine;
  private nettingEngine: NettingEngine;
  private clearingHouse: ClearingHouse;
  private balanceTracker: BalanceTracker;
  private reconciliationEngine: ReconciliationEngine;
  
  private pendingTrades: Map<string, Trade> = new Map();
  private settlements: Map<string, Settlement> = new Map();
  private batches: Map<string, SettlementBatch> = new Map();
  private settlementCycle: SettlementCycle;
  private cycleDuration: number;
  private lastCycleTime: number;
  private isProcessing: boolean = false;
  
  private metrics: SettlementMetrics = {
    totalTrades: 0,
    totalSettlements: 0,
    pendingSettlements: 0,
    nettingEfficiency: 0,
    averageSettlementTime: 0,
    failureRate: 0,
    reconciliationAccuracy: 0
  };

  constructor(
    cycle: SettlementCycle = SettlementCycle.HOURLY,
    cycleDuration: number = 3600000 // 1 hour in ms
  ) {
    super();
    this.settlementCycle = cycle;
    this.cycleDuration = cycleDuration;
    this.lastCycleTime = Date.now();
    
    // Initialize sub-engines
    this.atomicSwapEngine = new AtomicSwapEngine();
    this.nettingEngine = new NettingEngine();
    this.clearingHouse = new ClearingHouse();
    this.balanceTracker = new BalanceTracker();
    this.reconciliationEngine = new ReconciliationEngine(this.balanceTracker);
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Start settlement cycle
    if (cycle !== SettlementCycle.CONTINUOUS) {
      this.startSettlementCycle();
    }
  }
  
  private setupEventListeners(): void {
    // Listen to sub-engine events
    this.atomicSwapEngine.on('swapCompleted', (swap) => {
      this.emit('settlementEvent', {
        type: 'SETTLEMENT_EXECUTED',
        data: swap,
        timestamp: Date.now()
      } as SettlementEvent);
    });
    
    this.nettingEngine.on('nettingCompleted', (netPositions) => {
      this.emit('settlementEvent', {
        type: 'NETTING_COMPLETED',
        data: netPositions,
        timestamp: Date.now()
      } as SettlementEvent);
    });
    
    this.clearingHouse.on('marginCall', (member) => {
      this.handleMarginCall(member);
    });
    
    this.reconciliationEngine.on('discrepancyFound', (discrepancy) => {
      this.handleDiscrepancy(discrepancy);
    });
  }
  
  // Main entry point for processing trades
  public async processTrade(trade: Trade): Promise<void> {
    try {
      // Update metrics
      this.metrics.totalTrades++;
      
      // Add to pending trades
      this.pendingTrades.set(trade.id, trade);
      
      // Update balance tracker with pending trade
      await this.balanceTracker.updatePendingTrade(trade);
      
      // Check if continuous settlement
      if (this.settlementCycle === SettlementCycle.CONTINUOUS) {
        await this.processImmediateSettlement(trade);
      }
      
      // Emit event
      this.emit('settlementEvent', {
        type: 'TRADE_MATCHED',
        data: trade,
        timestamp: Date.now()
      } as SettlementEvent);
      
    } catch (error) {
      console.error('Error processing trade:', error);
      throw error;
    }
  }
  
  // Process immediate settlement for continuous mode
  private async processImmediateSettlement(trade: Trade): Promise<void> {
    const settlement: Settlement = {
      id: `SET_${trade.id}`,
      trades: [trade],
      status: SettlementStatus.PENDING,
      cycle: SettlementCycle.CONTINUOUS,
      netAmounts: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    await this.executeSettlement(settlement);
  }
  
  // Start settlement cycle for batch processing
  private startSettlementCycle(): void {
    setInterval(async () => {
      if (!this.isProcessing) {
        await this.processBatchSettlement();
      }
    }, this.cycleDuration);
  }
  
  // Process batch settlement
  public async processBatchSettlement(): Promise<void> {
    if (this.isProcessing || this.pendingTrades.size === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    try {
      // Create batch
      const batchId = `BATCH_${Date.now()}`;
      const trades = Array.from(this.pendingTrades.values());
      
      // Run netting engine
      const netPositions = await this.nettingEngine.calculateNetPositions(trades);
      
      // Create settlement batch
      const batch: SettlementBatch = {
        id: batchId,
        settlements: [],
        totalTrades: trades.length,
        netPositions: netPositions,
        status: SettlementStatus.BATCHED,
        createdAt: Date.now()
      };
      
      // Create settlements from net positions
      const settlements = await this.createSettlementsFromNetPositions(
        netPositions,
        trades,
        batchId
      );
      
      batch.settlements = settlements;
      this.batches.set(batchId, batch);
      
      // Execute settlements through clearing house
      await this.executeBatchSettlement(batch);
      
      // Clear pending trades
      this.pendingTrades.clear();
      
      // Update metrics
      this.updateMetrics(batch);
      
      // Emit event
      this.emit('settlementEvent', {
        type: 'BATCH_CREATED',
        data: batch,
        timestamp: Date.now()
      } as SettlementEvent);
      
    } catch (error) {
      console.error('Batch settlement error:', error);
      this.handleSettlementFailure(error);
    } finally {
      this.isProcessing = false;
      this.lastCycleTime = Date.now();
    }
  }
  
  // Create settlements from net positions
  private async createSettlementsFromNetPositions(
    netPositions: Map<string, Map<string, bigint>>,
    trades: Trade[],
    batchId: string
  ): Promise<Settlement[]> {
    const settlements: Settlement[] = [];
    
    for (const [userId, positions] of netPositions) {
      const userTrades = trades.filter(t => 
        t.buyerId === userId || t.sellerId === userId
      );
      
      const netAmounts: NetPosition[] = [];
      for (const [token, amount] of positions) {
        netAmounts.push({
          userId,
          token,
          netAmount: amount,
          originalAmount: this.calculateOriginalAmount(userTrades, userId, token),
          nettingReduction: BigInt(0) // Will be calculated
        });
      }
      
      // Calculate netting reduction
      netAmounts.forEach(pos => {
        pos.nettingReduction = pos.originalAmount - pos.netAmount;
      });
      
      const settlement: Settlement = {
        id: `SET_${batchId}_${userId}`,
        trades: userTrades,
        status: SettlementStatus.NETTING,
        cycle: this.settlementCycle,
        netAmounts,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        batchId
      };
      
      settlements.push(settlement);
      this.settlements.set(settlement.id, settlement);
    }
    
    return settlements;
  }
  
  // Calculate original amount before netting
  private calculateOriginalAmount(
    trades: Trade[],
    userId: string,
    token: string
  ): bigint {
    let amount = BigInt(0);
    
    for (const trade of trades) {
      if (trade.buyerId === userId && this.getBaseToken(trade.pair) === token) {
        amount -= BigInt(Math.floor(trade.price * trade.filledQuantity));
      } else if (trade.sellerId === userId && this.getQuoteToken(trade.pair) === token) {
        amount += BigInt(Math.floor(trade.filledQuantity));
      }
    }
    
    return amount;
  }
  
  // Execute individual settlement
  private async executeSettlement(settlement: Settlement): Promise<void> {
    try {
      settlement.status = SettlementStatus.CLEARING;
      settlement.updatedAt = Date.now();
      
      // Process through clearing house
      await this.clearingHouse.processSettlement(settlement);
      
      // Execute atomic swaps
      const swapIds = await this.atomicSwapEngine.createSwapsFromSettlement(settlement);
      
      // Wait for swaps to complete
      await this.atomicSwapEngine.executeSwaps(swapIds);
      
      // Update balances
      await this.balanceTracker.applySettlement(settlement);
      
      // Mark as settled
      settlement.status = SettlementStatus.SETTLED;
      settlement.settledAt = Date.now();
      settlement.updatedAt = Date.now();
      
      this.metrics.totalSettlements++;
      
    } catch (error) {
      settlement.status = SettlementStatus.FAILED;
      settlement.error = error.message;
      settlement.updatedAt = Date.now();
      throw error;
    }
  }
  
  // Execute batch settlement
  private async executeBatchSettlement(batch: SettlementBatch): Promise<void> {
    try {
      batch.status = SettlementStatus.CLEARING;
      
      // Process all settlements in batch
      const settlementPromises = batch.settlements.map(settlement => 
        this.executeSettlement(settlement)
      );
      
      await Promise.all(settlementPromises);
      
      batch.status = SettlementStatus.SETTLED;
      batch.executedAt = Date.now();
      
    } catch (error) {
      batch.status = SettlementStatus.FAILED;
      throw error;
    }
  }
  
  // Handle margin call from clearing house
  private async handleMarginCall(member: any): Promise<void> {
    // Implement margin call handling logic
    console.warn('Margin call for member:', member.userId);
    // Could trigger liquidation or request additional collateral
  }
  
  // Handle reconciliation discrepancy
  private async handleDiscrepancy(discrepancy: any): Promise<void> {
    console.error('Reconciliation discrepancy found:', discrepancy);
    // Implement discrepancy resolution logic
  }
  
  // Handle settlement failure
  private handleSettlementFailure(error: Error): void {
    this.metrics.failureRate = 
      (this.metrics.failureRate * this.metrics.totalSettlements + 1) / 
      (this.metrics.totalSettlements + 1);
    
    this.emit('settlementEvent', {
      type: 'SETTLEMENT_FAILED',
      data: { error: error.message },
      timestamp: Date.now()
    } as SettlementEvent);
  }
  
  // Update metrics
  private updateMetrics(batch: SettlementBatch): void {
    const efficiency = this.nettingEngine.calculateNettingEfficiency(batch);
    this.metrics.nettingEfficiency = 
      (this.metrics.nettingEfficiency * this.metrics.totalSettlements + efficiency) / 
      (this.metrics.totalSettlements + batch.settlements.length);
    
    const avgTime = batch.executedAt! - batch.createdAt;
    this.metrics.averageSettlementTime = 
      (this.metrics.averageSettlementTime * this.metrics.totalSettlements + avgTime) / 
      (this.metrics.totalSettlements + batch.settlements.length);
  }
  
  // Helper methods
  private getBaseToken(pair: string): string {
    return pair.split('/')[0];
  }
  
  private getQuoteToken(pair: string): string {
    return pair.split('/')[1];
  }
  
  // Public API methods
  public async getSettlement(settlementId: string): Promise<Settlement | undefined> {
    return this.settlements.get(settlementId);
  }
  
  public async getUserBalance(userId: string): Promise<UserBalance | undefined> {
    return this.balanceTracker.getUserBalance(userId);
  }
  
  public getMetrics(): SettlementMetrics {
    return { ...this.metrics };
  }
  
  public async startReconciliation(): Promise<void> {
    await this.reconciliationEngine.performReconciliation();
  }
  
  public setCycle(cycle: SettlementCycle, duration?: number): void {
    this.settlementCycle = cycle;
    if (duration) {
      this.cycleDuration = duration;
    }
  }
}