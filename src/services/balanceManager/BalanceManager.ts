import { Address } from 'viem';
import { EventEmitter } from 'events';
import { 
  Balance, 
  BalanceUpdate, 
  BalanceUpdateType, 
  BalanceUpdateReason,
  BalanceProof,
  WithdrawalRequest,
  WithdrawalStatus,
  BalanceSnapshot,
  SnapshotType,
  ReconciliationResult,
  ReconciliationAction
} from './types';
import { MerkleTree } from 'merkletreejs';
import { keccak256 } from 'viem';
import crypto from 'crypto';

export class BalanceManager extends EventEmitter {
  private balances: Map<string, Balance> = new Map();
  private balanceUpdates: BalanceUpdate[] = [];
  private balanceSnapshots: BalanceSnapshot[] = [];
  private withdrawalRequests: Map<string, WithdrawalRequest> = new Map();
  private updateNonce: number = 0;

  constructor() {
    super();
  }

  private getBalanceKey(userId: string, tokenAddress: Address): string {
    return `${userId}-${tokenAddress.toLowerCase()}`;
  }

  public async getBalance(userId: string, tokenAddress: Address): Promise<Balance> {
    const key = this.getBalanceKey(userId, tokenAddress);
    let balance = this.balances.get(key);
    
    if (!balance) {
      balance = {
        userId,
        address: userId as Address,
        tokenAddress,
        available: 0n,
        locked: 0n,
        lastUpdated: new Date(),
        nonce: 0,
      };
      this.balances.set(key, balance);
    }
    
    return balance;
  }

  public async updateBalance(
    userId: string,
    tokenAddress: Address,
    amount: bigint,
    type: BalanceUpdateType,
    reason: BalanceUpdateReason,
    referenceId?: string,
    metadata?: Record<string, any>
  ): Promise<BalanceUpdate> {
    const balance = await this.getBalance(userId, tokenAddress);
    const previousBalance = balance.available;
    
    if (type === BalanceUpdateType.CREDIT) {
      balance.available += amount;
    } else {
      if (balance.available < amount) {
        throw new Error('Insufficient balance');
      }
      balance.available -= amount;
    }
    
    balance.lastUpdated = new Date();
    balance.nonce++;
    
    const update: BalanceUpdate = {
      id: crypto.randomUUID(),
      userId,
      tokenAddress,
      amount,
      type,
      reason,
      referenceId,
      previousBalance,
      newBalance: balance.available,
      timestamp: new Date(),
      metadata,
    };
    
    this.balanceUpdates.push(update);
    this.emit('balanceUpdate', update);
    
    // Create snapshot for significant events
    if (reason === BalanceUpdateReason.DEPOSIT || 
        reason === BalanceUpdateReason.WITHDRAWAL ||
        reason === BalanceUpdateReason.EMERGENCY_WITHDRAWAL) {
      await this.createSnapshot(userId, tokenAddress, 
        reason === BalanceUpdateReason.DEPOSIT ? SnapshotType.POST_DEPOSIT : SnapshotType.PRE_WITHDRAWAL
      );
    }
    
    return update;
  }

  public async lockBalance(userId: string, tokenAddress: Address, amount: bigint): Promise<void> {
    const balance = await this.getBalance(userId, tokenAddress);
    
    if (balance.available < amount) {
      throw new Error('Insufficient available balance to lock');
    }
    
    balance.available -= amount;
    balance.locked += amount;
    balance.lastUpdated = new Date();
    balance.nonce++;
    
    this.emit('balanceLocked', { userId, tokenAddress, amount });
  }

  public async unlockBalance(userId: string, tokenAddress: Address, amount: bigint): Promise<void> {
    const balance = await this.getBalance(userId, tokenAddress);
    
    if (balance.locked < amount) {
      throw new Error('Insufficient locked balance to unlock');
    }
    
    balance.locked -= amount;
    balance.available += amount;
    balance.lastUpdated = new Date();
    balance.nonce++;
    
    this.emit('balanceUnlocked', { userId, tokenAddress, amount });
  }

  public async processDeposit(
    userId: string,
    tokenAddress: Address,
    amount: bigint,
    txHash: string
  ): Promise<BalanceUpdate> {
    return await this.updateBalance(
      userId,
      tokenAddress,
      amount,
      BalanceUpdateType.CREDIT,
      BalanceUpdateReason.DEPOSIT,
      txHash,
      { txHash }
    );
  }

  public async processWithdrawal(
    userId: string,
    tokenAddress: Address,
    amount: bigint,
    withdrawalId: string
  ): Promise<BalanceUpdate> {
    const withdrawal = this.withdrawalRequests.get(withdrawalId);
    if (!withdrawal) {
      throw new Error('Withdrawal request not found');
    }
    
    return await this.updateBalance(
      userId,
      tokenAddress,
      amount,
      BalanceUpdateType.DEBIT,
      BalanceUpdateReason.WITHDRAWAL,
      withdrawalId,
      { withdrawalId }
    );
  }

  public async processTrade(
    buyerId: string,
    sellerId: string,
    baseToken: Address,
    quoteToken: Address,
    baseAmount: bigint,
    quoteAmount: bigint,
    tradeId: string
  ): Promise<{ buyerUpdates: BalanceUpdate[], sellerUpdates: BalanceUpdate[] }> {
    // Lock balances first
    await this.lockBalance(buyerId, quoteToken, quoteAmount);
    await this.lockBalance(sellerId, baseToken, baseAmount);
    
    try {
      // Process buyer updates
      const buyerDebit = await this.updateBalance(
        buyerId,
        quoteToken,
        quoteAmount,
        BalanceUpdateType.DEBIT,
        BalanceUpdateReason.TRADE_BUY,
        tradeId
      );
      
      const buyerCredit = await this.updateBalance(
        buyerId,
        baseToken,
        baseAmount,
        BalanceUpdateType.CREDIT,
        BalanceUpdateReason.TRADE_BUY,
        tradeId
      );
      
      // Process seller updates
      const sellerDebit = await this.updateBalance(
        sellerId,
        baseToken,
        baseAmount,
        BalanceUpdateType.DEBIT,
        BalanceUpdateReason.TRADE_SELL,
        tradeId
      );
      
      const sellerCredit = await this.updateBalance(
        sellerId,
        quoteToken,
        quoteAmount,
        BalanceUpdateType.CREDIT,
        BalanceUpdateReason.TRADE_SELL,
        tradeId
      );
      
      // Unlock remaining locked balances
      await this.unlockBalance(buyerId, quoteToken, 0n);
      await this.unlockBalance(sellerId, baseToken, 0n);
      
      return {
        buyerUpdates: [buyerDebit, buyerCredit],
        sellerUpdates: [sellerDebit, sellerCredit],
      };
    } catch (error) {
      // Rollback on error
      await this.unlockBalance(buyerId, quoteToken, quoteAmount);
      await this.unlockBalance(sellerId, baseToken, baseAmount);
      throw error;
    }
  }

  public async createWithdrawalRequest(
    userId: string,
    tokenAddress: Address,
    amount: bigint,
    emergency: boolean = false
  ): Promise<WithdrawalRequest> {
    const balance = await this.getBalance(userId, tokenAddress);
    
    if (!emergency && balance.available < amount) {
      throw new Error('Insufficient balance for withdrawal');
    }
    
    const request: WithdrawalRequest = {
      id: crypto.randomUUID(),
      userId,
      tokenAddress,
      amount,
      status: WithdrawalStatus.PENDING,
      requestedAt: new Date(),
      emergencyWithdrawal: emergency,
    };
    
    this.withdrawalRequests.set(request.id, request);
    
    if (!emergency) {
      await this.lockBalance(userId, tokenAddress, amount);
    }
    
    this.emit('withdrawalRequested', request);
    return request;
  }

  public async processEmergencyWithdrawal(
    userId: string,
    tokenAddress: Address
  ): Promise<WithdrawalRequest> {
    const balance = await this.getBalance(userId, tokenAddress);
    const totalBalance = balance.available + balance.locked;
    
    if (totalBalance === 0n) {
      throw new Error('No balance to withdraw');
    }
    
    // Create emergency withdrawal request
    const request = await this.createWithdrawalRequest(
      userId,
      tokenAddress,
      totalBalance,
      true
    );
    
    // Update balance
    await this.updateBalance(
      userId,
      tokenAddress,
      totalBalance,
      BalanceUpdateType.DEBIT,
      BalanceUpdateReason.EMERGENCY_WITHDRAWAL,
      request.id
    );
    
    // Clear locked balance
    balance.locked = 0n;
    
    return request;
  }

  public async verifyBalance(userId: string, tokenAddress: Address): Promise<boolean> {
    const balance = await this.getBalance(userId, tokenAddress);
    const updates = this.getBalanceHistory(userId, tokenAddress);
    
    let calculatedBalance = 0n;
    for (const update of updates) {
      if (update.type === BalanceUpdateType.CREDIT) {
        calculatedBalance += update.amount;
      } else {
        calculatedBalance -= update.amount;
      }
    }
    
    return calculatedBalance === balance.available;
  }

  public async generateBalanceProof(userId: string, tokenAddress: Address): Promise<BalanceProof> {
    const balance = await this.getBalance(userId, tokenAddress);
    const allBalances = Array.from(this.balances.values());
    
    // Create leaves for Merkle tree
    const leaves = allBalances.map(b => {
      const data = `${b.userId}-${b.tokenAddress}-${b.available.toString()}-${b.nonce}`;
      return keccak256(Buffer.from(data));
    });
    
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const leaf = keccak256(Buffer.from(`${userId}-${tokenAddress}-${balance.available.toString()}-${balance.nonce}`));
    const proof = tree.getHexProof(leaf);
    
    // Generate signature
    const message = `${userId}-${tokenAddress}-${balance.available.toString()}-${balance.nonce}-${Date.now()}`;
    const signature = crypto.createHash('sha256').update(message).digest('hex');
    
    return {
      userId,
      tokenAddress,
      balance: balance.available,
      nonce: balance.nonce,
      timestamp: new Date(),
      merkleRoot: tree.getHexRoot(),
      merkleProof: proof,
      signature,
    };
  }

  public async reconcileWithOnChain(
    userId: string,
    tokenAddress: Address,
    onChainBalance: bigint
  ): Promise<ReconciliationResult> {
    const offChainBalance = await this.getBalance(userId, tokenAddress);
    const totalOffChain = offChainBalance.available + offChainBalance.locked;
    const difference = totalOffChain - onChainBalance;
    
    const actions: ReconciliationAction[] = [];
    
    if (difference !== 0n) {
      if (Math.abs(Number(difference)) < 1000) {
        // Small difference, adjust off-chain
        actions.push({
          type: 'ADJUST_OFF_CHAIN',
          amount: difference,
          reason: 'Small discrepancy, adjusting off-chain balance',
          executed: false,
        });
      } else {
        // Large difference, needs investigation
        actions.push({
          type: 'INVESTIGATE',
          amount: difference,
          reason: 'Large discrepancy detected, manual investigation required',
          executed: false,
        });
      }
    }
    
    const result: ReconciliationResult = {
      userId,
      tokenAddress,
      offChainBalance: totalOffChain,
      onChainBalance,
      difference,
      isReconciled: difference === 0n,
      timestamp: new Date(),
      actions,
    };
    
    // Execute automatic adjustments
    for (const action of actions) {
      if (action.type === 'ADJUST_OFF_CHAIN' && Math.abs(Number(action.amount)) < 1000) {
        await this.updateBalance(
          userId,
          tokenAddress,
          action.amount > 0n ? action.amount : -action.amount,
          action.amount > 0n ? BalanceUpdateType.DEBIT : BalanceUpdateType.CREDIT,
          BalanceUpdateReason.RECONCILIATION,
          undefined,
          { reconciliationResult: result }
        );
        action.executed = true;
      }
    }
    
    // Create reconciliation snapshot
    await this.createSnapshot(userId, tokenAddress, SnapshotType.RECONCILIATION);
    
    this.emit('reconciliationCompleted', result);
    return result;
  }

  public getBalanceHistory(userId: string, tokenAddress: Address): BalanceUpdate[] {
    return this.balanceUpdates.filter(
      update => update.userId === userId && 
                update.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );
  }

  public async createSnapshot(
    userId: string,
    tokenAddress: Address,
    type: SnapshotType,
    blockNumber?: bigint
  ): Promise<BalanceSnapshot> {
    const balance = await this.getBalance(userId, tokenAddress);
    
    const snapshot: BalanceSnapshot = {
      id: crypto.randomUUID(),
      userId,
      tokenAddress,
      balance: balance.available + balance.locked,
      blockNumber: blockNumber || 0n,
      timestamp: new Date(),
      snapshotType: type,
    };
    
    this.balanceSnapshots.push(snapshot);
    return snapshot;
  }

  public getSnapshots(userId: string, tokenAddress: Address): BalanceSnapshot[] {
    return this.balanceSnapshots.filter(
      snapshot => snapshot.userId === userId && 
                  snapshot.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );
  }

  public getAllBalances(): Balance[] {
    return Array.from(this.balances.values());
  }

  public getAuditTrail(
    userId?: string,
    startDate?: Date,
    endDate?: Date
  ): BalanceUpdate[] {
    let updates = [...this.balanceUpdates];
    
    if (userId) {
      updates = updates.filter(u => u.userId === userId);
    }
    
    if (startDate) {
      updates = updates.filter(u => u.timestamp >= startDate);
    }
    
    if (endDate) {
      updates = updates.filter(u => u.timestamp <= endDate);
    }
    
    return updates.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
}