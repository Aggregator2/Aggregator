import { EventEmitter } from 'events';
import { ethers } from 'ethers';

export interface BalanceSnapshot {
  userId: string;
  token: string;
  balance: bigint;
  blockNumber: number;
  timestamp: number;
}

export interface BalanceChange {
  userId: string;
  token: string;
  previousBalance: bigint;
  currentBalance: bigint;
  expectedChange: bigint;
  actualChange: bigint;
  discrepancy: bigint;
  percentage: number; // Discrepancy percentage
}

export interface VerificationResult {
  epochId: string;
  verificationId: string;
  status: 'PASSED' | 'FAILED' | 'PARTIAL';
  startBlock: number;
  endBlock: number;
  totalUsers: number;
  totalTokens: number;
  totalTransactions: number;
  discrepancies: BalanceChange[];
  warnings: VerificationWarning[];
  gasUsed: bigint;
  verificationTime: number;
  timestamp: number;
}

export interface VerificationWarning {
  type: 'MISSING_USER' | 'MISSING_TOKEN' | 'STALE_BALANCE' | 'HIGH_DISCREPANCY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  data: any;
}

export interface ReconciliationAction {
  id: string;
  type: 'CREDIT' | 'DEBIT' | 'INVESTIGATE' | 'FREEZE';
  userId: string;
  token: string;
  amount: bigint;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'EXECUTED' | 'REJECTED';
  createdAt: number;
  executedAt?: number;
}

export class EnhancedSettlementVerification extends EventEmitter {
  private provider: ethers.Provider;
  private snapshotCache: Map<string, BalanceSnapshot> = new Map();
  private verificationResults: Map<string, VerificationResult> = new Map();
  private reconciliationActions: Map<string, ReconciliationAction> = new Map();
  
  // Configurable thresholds
  private config = {
    discrepancyThreshold: 100, // Wei/smallest unit
    discrepancyPercentageThreshold: 0.01, // 0.01%
    staleBalanceThreshold: 3600000, // 1 hour
    maxVerificationRetries: 3,
    parallelVerifications: 10,
    snapshotRetention: 7 * 24 * 60 * 60 * 1000 // 7 days
  };

  constructor(provider: ethers.Provider) {
    super();
    this.provider = provider;
    this.startCleanupTimer();
  }

  /**
   * Take balance snapshots before settlement
   */
  async takePreSettlementSnapshot(
    userIds: string[],
    tokens: string[],
    epochId: string
  ): Promise<Map<string, Map<string, BalanceSnapshot>>> {
    const blockNumber = await this.provider.getBlockNumber();
    const timestamp = Date.now();
    const snapshots = new Map<string, Map<string, BalanceSnapshot>>();

    // Process in batches for performance
    const batchSize = this.config.parallelVerifications;
    
    for (let i = 0; i < userIds.length; i += batchSize) {
      const userBatch = userIds.slice(i, i + batchSize);
      
      await Promise.all(userBatch.map(async (userId) => {
        const userSnapshots = new Map<string, BalanceSnapshot>();
        
        for (const token of tokens) {
          try {
            const balance = await this.getTokenBalance(userId, token);
            const snapshot: BalanceSnapshot = {
              userId,
              token,
              balance,
              blockNumber,
              timestamp
            };
            
            userSnapshots.set(token, snapshot);
            this.cacheSnapshot(epochId, userId, token, 'PRE', snapshot);
          } catch (error) {
            this.emit('snapshot:error', {
              userId,
              token,
              phase: 'PRE',
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
        
        snapshots.set(userId, userSnapshots);
      }));
    }

    this.emit('snapshot:completed', {
      epochId,
      phase: 'PRE',
      users: snapshots.size,
      tokens: tokens.length,
      blockNumber
    });

    return snapshots;
  }

  /**
   * Take balance snapshots after settlement
   */
  async takePostSettlementSnapshot(
    userIds: string[],
    tokens: string[],
    epochId: string,
    settlementBlock?: number
  ): Promise<Map<string, Map<string, BalanceSnapshot>>> {
    // Wait for settlement to be confirmed if block provided
    if (settlementBlock) {
      await this.waitForBlock(settlementBlock + 2); // Wait 2 confirmations
    }

    const blockNumber = await this.provider.getBlockNumber();
    const timestamp = Date.now();
    const snapshots = new Map<string, Map<string, BalanceSnapshot>>();

    const batchSize = this.config.parallelVerifications;
    
    for (let i = 0; i < userIds.length; i += batchSize) {
      const userBatch = userIds.slice(i, i + batchSize);
      
      await Promise.all(userBatch.map(async (userId) => {
        const userSnapshots = new Map<string, BalanceSnapshot>();
        
        for (const token of tokens) {
          try {
            const balance = await this.getTokenBalance(userId, token, blockNumber);
            const snapshot: BalanceSnapshot = {
              userId,
              token,
              balance,
              blockNumber,
              timestamp
            };
            
            userSnapshots.set(token, snapshot);
            this.cacheSnapshot(epochId, userId, token, 'POST', snapshot);
          } catch (error) {
            this.emit('snapshot:error', {
              userId,
              token,
              phase: 'POST',
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
        
        snapshots.set(userId, userSnapshots);
      }));
    }

    this.emit('snapshot:completed', {
      epochId,
      phase: 'POST',
      users: snapshots.size,
      tokens: tokens.length,
      blockNumber
    });

    return snapshots;
  }

  /**
   * Verify settlement by comparing expected vs actual balance changes
   */
  async verifySettlement(
    epochId: string,
    expectedChanges: Map<string, Map<string, bigint>>,
    settlementTxHash?: string
  ): Promise<VerificationResult> {
    const verificationId = `VERIFY_${epochId}_${Date.now()}`;
    const startTime = Date.now();
    const discrepancies: BalanceChange[] = [];
    const warnings: VerificationWarning[] = [];
    
    let startBlock = 0;
    let endBlock = 0;
    let gasUsed = BigInt(0);

    // Get transaction details if provided
    if (settlementTxHash) {
      const receipt = await this.provider.getTransactionReceipt(settlementTxHash);
      if (receipt) {
        startBlock = receipt.blockNumber - 1;
        endBlock = receipt.blockNumber;
        gasUsed = receipt.gasUsed;
      }
    }

    // Get all unique users and tokens
    const allUsers = new Set<string>();
    const allTokens = new Set<string>();
    
    for (const [userId, tokens] of expectedChanges) {
      allUsers.add(userId);
      for (const token of tokens.keys()) {
        allTokens.add(token);
      }
    }

    // Verify each user's balance changes
    for (const userId of allUsers) {
      const expectedUserChanges = expectedChanges.get(userId) || new Map();
      
      for (const token of allTokens) {
        try {
          const expectedChange = expectedUserChanges.get(token) || BigInt(0);
          
          // Get cached snapshots
          const preSnapshot = this.getCachedSnapshot(epochId, userId, token, 'PRE');
          const postSnapshot = this.getCachedSnapshot(epochId, userId, token, 'POST');
          
          if (!preSnapshot || !postSnapshot) {
            warnings.push({
              type: 'MISSING_USER',
              severity: 'HIGH',
              message: `Missing snapshot for user ${userId} token ${token}`,
              data: { userId, token }
            });
            continue;
          }

          // Check for stale balances
          if (Date.now() - preSnapshot.timestamp > this.config.staleBalanceThreshold) {
            warnings.push({
              type: 'STALE_BALANCE',
              severity: 'MEDIUM',
              message: `Stale balance snapshot for user ${userId}`,
              data: { userId, token, age: Date.now() - preSnapshot.timestamp }
            });
          }

          const actualChange = postSnapshot.balance - preSnapshot.balance;
          const discrepancy = actualChange - expectedChange;
          const discrepancyAbs = discrepancy < 0 ? -discrepancy : discrepancy;
          
          // Calculate percentage (avoid division by zero)
          const percentage = preSnapshot.balance > 0 
            ? Number(discrepancyAbs * BigInt(10000) / preSnapshot.balance) / 100
            : 0;

          // Check if discrepancy is significant
          if (discrepancyAbs > BigInt(this.config.discrepancyThreshold) || 
              percentage > this.config.discrepancyPercentageThreshold) {
            
            const balanceChange: BalanceChange = {
              userId,
              token,
              previousBalance: preSnapshot.balance,
              currentBalance: postSnapshot.balance,
              expectedChange,
              actualChange,
              discrepancy,
              percentage
            };
            
            discrepancies.push(balanceChange);

            // Add warning for high discrepancy
            if (percentage > 1) { // > 1%
              warnings.push({
                type: 'HIGH_DISCREPANCY',
                severity: 'CRITICAL',
                message: `High discrepancy detected: ${percentage.toFixed(2)}%`,
                data: balanceChange
              });
            }
          }
        } catch (error) {
          warnings.push({
            type: 'MISSING_TOKEN',
            severity: 'MEDIUM',
            message: `Error verifying balance for ${userId} - ${token}`,
            data: { userId, token, error: error instanceof Error ? error.message : 'Unknown' }
          });
        }
      }
    }

    // Determine verification status
    let status: 'PASSED' | 'FAILED' | 'PARTIAL';
    if (discrepancies.length === 0) {
      status = 'PASSED';
    } else if (discrepancies.length > allUsers.size * 0.1) { // > 10% of users affected
      status = 'FAILED';
    } else {
      status = 'PARTIAL';
    }

    const result: VerificationResult = {
      epochId,
      verificationId,
      status,
      startBlock,
      endBlock,
      totalUsers: allUsers.size,
      totalTokens: allTokens.size,
      totalTransactions: expectedChanges.size,
      discrepancies,
      warnings,
      gasUsed,
      verificationTime: Date.now() - startTime,
      timestamp: Date.now()
    };

    this.verificationResults.set(verificationId, result);
    
    this.emit('verification:completed', result);

    if (status !== 'PASSED') {
      this.emit('verification:failed', {
        epochId,
        discrepancyCount: discrepancies.length,
        criticalWarnings: warnings.filter(w => w.severity === 'CRITICAL').length
      });
    }

    return result;
  }

  /**
   * Create reconciliation actions for discrepancies
   */
  async createReconciliationActions(
    verificationResult: VerificationResult
  ): Promise<ReconciliationAction[]> {
    const actions: ReconciliationAction[] = [];

    for (const discrepancy of verificationResult.discrepancies) {
      const actionId = `RECON_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      let actionType: 'CREDIT' | 'DEBIT' | 'INVESTIGATE' | 'FREEZE';
      let reason: string;

      // Determine action based on discrepancy
      if (discrepancy.discrepancy > 0) {
        // User received more than expected
        if (discrepancy.percentage > 5) {
          actionType = 'FREEZE';
          reason = `Critical overpayment: ${discrepancy.percentage.toFixed(2)}% more than expected`;
        } else {
          actionType = 'DEBIT';
          reason = `Overpayment correction: ${discrepancy.discrepancy.toString()} units`;
        }
      } else {
        // User received less than expected
        if (discrepancy.percentage > 5) {
          actionType = 'INVESTIGATE';
          reason = `Critical underpayment: ${discrepancy.percentage.toFixed(2)}% less than expected`;
        } else {
          actionType = 'CREDIT';
          reason = `Underpayment correction: ${(-discrepancy.discrepancy).toString()} units`;
        }
      }

      const action: ReconciliationAction = {
        id: actionId,
        type: actionType,
        userId: discrepancy.userId,
        token: discrepancy.token,
        amount: discrepancy.discrepancy < 0 ? -discrepancy.discrepancy : discrepancy.discrepancy,
        reason,
        status: 'PENDING',
        createdAt: Date.now()
      };

      actions.push(action);
      this.reconciliationActions.set(actionId, action);
    }

    this.emit('reconciliation:actions-created', {
      verificationId: verificationResult.verificationId,
      actionCount: actions.length,
      actions: actions.map(a => ({
        id: a.id,
        type: a.type,
        userId: a.userId,
        amount: a.amount.toString()
      }))
    });

    return actions;
  }

  /**
   * Execute approved reconciliation actions
   */
  async executeReconciliationAction(
    actionId: string,
    executor: ethers.Signer
  ): Promise<ethers.TransactionReceipt | null> {
    const action = this.reconciliationActions.get(actionId);
    if (!action) {
      throw new Error('Reconciliation action not found');
    }

    if (action.status !== 'APPROVED') {
      throw new Error('Action must be approved before execution');
    }

    try {
      let receipt: ethers.TransactionReceipt | null = null;

      switch (action.type) {
        case 'CREDIT':
          // Execute credit transaction
          receipt = await this.executeCreditAction(action, executor);
          break;
          
        case 'DEBIT':
          // Execute debit transaction
          receipt = await this.executeDebitAction(action, executor);
          break;
          
        case 'FREEZE':
          // Freeze user account (emit event, actual implementation depends on system)
          this.emit('account:freeze-requested', {
            userId: action.userId,
            reason: action.reason
          });
          break;
          
        case 'INVESTIGATE':
          // Create investigation ticket
          this.emit('investigation:required', {
            userId: action.userId,
            token: action.token,
            amount: action.amount.toString(),
            reason: action.reason
          });
          break;
      }

      action.status = 'EXECUTED';
      action.executedAt = Date.now();

      this.emit('reconciliation:action-executed', {
        actionId,
        type: action.type,
        txHash: receipt?.hash
      });

      return receipt;
    } catch (error) {
      action.status = 'REJECTED';
      this.emit('reconciliation:action-failed', {
        actionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Approve reconciliation action
   */
  approveReconciliationAction(actionId: string, approver: string): void {
    const action = this.reconciliationActions.get(actionId);
    if (!action) {
      throw new Error('Reconciliation action not found');
    }

    if (action.status !== 'PENDING') {
      throw new Error('Action is not in pending state');
    }

    action.status = 'APPROVED';
    
    this.emit('reconciliation:action-approved', {
      actionId,
      approver,
      timestamp: Date.now()
    });
  }

  // Helper methods
  private async getTokenBalance(
    userAddress: string,
    tokenAddress: string,
    blockNumber?: number
  ): Promise<bigint> {
    // ERC20 ABI for balanceOf
    const abi = ['function balanceOf(address account) view returns (uint256)'];
    const contract = new ethers.Contract(tokenAddress, abi, this.provider);
    
    try {
      const balance = await contract.balanceOf(userAddress, { blockTag: blockNumber });
      return balance;
    } catch (error) {
      // Handle native token (ETH)
      if (tokenAddress === '0x0000000000000000000000000000000000000000') {
        return await this.provider.getBalance(userAddress, blockNumber);
      }
      throw error;
    }
  }

  private async waitForBlock(targetBlock: number): Promise<void> {
    let currentBlock = await this.provider.getBlockNumber();
    
    while (currentBlock < targetBlock) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      currentBlock = await this.provider.getBlockNumber();
    }
  }

  private cacheSnapshot(
    epochId: string,
    userId: string,
    token: string,
    phase: 'PRE' | 'POST',
    snapshot: BalanceSnapshot
  ): void {
    const key = `${epochId}_${userId}_${token}_${phase}`;
    this.snapshotCache.set(key, snapshot);
  }

  private getCachedSnapshot(
    epochId: string,
    userId: string,
    token: string,
    phase: 'PRE' | 'POST'
  ): BalanceSnapshot | undefined {
    const key = `${epochId}_${userId}_${token}_${phase}`;
    return this.snapshotCache.get(key);
  }

  private async executeCreditAction(
    action: ReconciliationAction,
    executor: ethers.Signer
  ): Promise<ethers.TransactionReceipt> {
    // This would interact with your settlement contract to credit the user
    // Simplified example:
    const abi = ['function creditUser(address user, address token, uint256 amount)'];
    const contract = new ethers.Contract('SETTLEMENT_CONTRACT_ADDRESS', abi, executor);
    
    const tx = await contract.creditUser(action.userId, action.token, action.amount);
    return await tx.wait();
  }

  private async executeDebitAction(
    action: ReconciliationAction,
    executor: ethers.Signer
  ): Promise<ethers.TransactionReceipt> {
    // This would interact with your settlement contract to debit the user
    const abi = ['function debitUser(address user, address token, uint256 amount)'];
    const contract = new ethers.Contract('SETTLEMENT_CONTRACT_ADDRESS', abi, executor);
    
    const tx = await contract.debitUser(action.userId, action.token, action.amount);
    return await tx.wait();
  }

  private startCleanupTimer(): void {
    // Clean old snapshots periodically
    setInterval(() => {
      const cutoff = Date.now() - this.config.snapshotRetention;
      
      for (const [key, snapshot] of this.snapshotCache) {
        if (snapshot.timestamp < cutoff) {
          this.snapshotCache.delete(key);
        }
      }
    }, 3600000); // Every hour
  }

  // Public query methods
  getVerificationResult(verificationId: string): VerificationResult | undefined {
    return this.verificationResults.get(verificationId);
  }

  getReconciliationAction(actionId: string): ReconciliationAction | undefined {
    return this.reconciliationActions.get(actionId);
  }

  getPendingReconciliations(): ReconciliationAction[] {
    return Array.from(this.reconciliationActions.values())
      .filter(action => action.status === 'PENDING');
  }

  updateConfig(newConfig: Partial<typeof this.config>): void {
    Object.assign(this.config, newConfig);
    this.emit('config:updated', this.config);
  }
}