import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { ReconciliationAction, VerificationResult } from './EnhancedSettlementVerification';

export interface ReconciliationConfig {
  autoApprovalThreshold: string; // Amount below which actions are auto-approved
  requireMultiSig: boolean;
  requiredApprovals: number;
  reconciliationContract?: string;
  maxRetries: number;
  retryDelay: number;
}

export interface ReconciliationBatch {
  id: string;
  actions: ReconciliationAction[];
  status: 'PENDING' | 'APPROVED' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  createdAt: number;
  approvals: Map<string, ApprovalRecord>;
  executionResults: Map<string, ExecutionResult>;
  totalValue: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ApprovalRecord {
  approver: string;
  timestamp: number;
  signature?: string;
  comments?: string;
}

export interface ExecutionResult {
  actionId: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  txHash?: string;
  gasUsed?: string;
  error?: string;
  timestamp: number;
}

export interface ReconciliationReport {
  batchId: string;
  epochId: string;
  totalActions: number;
  executedActions: number;
  failedActions: number;
  totalReconciled: Map<string, string>; // token -> amount
  gasSpent: string;
  duration: number;
  timestamp: number;
}

export class ReconciliationService extends EventEmitter {
  private config: ReconciliationConfig;
  private provider: ethers.Provider;
  private executorWallet: ethers.Wallet;
  private reconciliationBatches: Map<string, ReconciliationBatch> = new Map();
  private executionQueue: ReconciliationBatch[] = [];
  private isProcessing: boolean = false;
  private reconciliationContract?: ethers.Contract;

  constructor(
    config: ReconciliationConfig,
    provider: ethers.Provider,
    executorPrivateKey: string
  ) {
    super();
    this.config = config;
    this.provider = provider;
    this.executorWallet = new ethers.Wallet(executorPrivateKey, provider);

    if (config.reconciliationContract) {
      this.initializeContract(config.reconciliationContract);
    }

    this.startQueueProcessor();
  }

  private initializeContract(address: string): void {
    const abi = [
      'function reconcileBalances(address[] users, address[] tokens, int256[] amounts, bytes32 batchId) external',
      'function emergencyPause() external',
      'function unpause() external',
      'function approveReconciliation(bytes32 batchId, bytes signature) external',
      'function getRequiredApprovals() view returns (uint256)',
      'event ReconciliationExecuted(bytes32 indexed batchId, address indexed executor)',
      'event ReconciliationApproved(bytes32 indexed batchId, address indexed approver)'
    ];

    this.reconciliationContract = new ethers.Contract(address, abi, this.executorWallet);
  }

  /**
   * Create a reconciliation batch from verification results
   */
  async createReconciliationBatch(
    verificationResult: VerificationResult,
    actions: ReconciliationAction[]
  ): Promise<ReconciliationBatch> {
    const batchId = `BATCH_${Date.now()}_${verificationResult.epochId}`;
    
    // Calculate total value and priority
    let totalValue = BigInt(0);
    let maxDiscrepancy = 0;
    
    for (const action of actions) {
      totalValue += action.amount;
      
      // Find corresponding discrepancy
      const discrepancy = verificationResult.discrepancies.find(
        d => d.userId === action.userId && d.token === action.token
      );
      
      if (discrepancy && discrepancy.percentage > maxDiscrepancy) {
        maxDiscrepancy = discrepancy.percentage;
      }
    }

    // Determine priority based on value and discrepancy
    let priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (maxDiscrepancy > 10 || totalValue > BigInt(1000000000000)) { // > 10% or > $1M
      priority = 'CRITICAL';
    } else if (maxDiscrepancy > 5 || totalValue > BigInt(100000000000)) { // > 5% or > $100k
      priority = 'HIGH';
    } else if (maxDiscrepancy > 1 || totalValue > BigInt(10000000000)) { // > 1% or > $10k
      priority = 'MEDIUM';
    }

    const batch: ReconciliationBatch = {
      id: batchId,
      actions,
      status: 'PENDING',
      createdAt: Date.now(),
      approvals: new Map(),
      executionResults: new Map(),
      totalValue: totalValue.toString(),
      priority
    };

    this.reconciliationBatches.set(batchId, batch);

    // Auto-approve if below threshold
    if (BigInt(batch.totalValue) <= BigInt(this.config.autoApprovalThreshold)) {
      await this.autoApproveBatch(batch);
    }

    this.emit('batch:created', {
      batchId,
      actionCount: actions.length,
      totalValue: batch.totalValue,
      priority
    });

    return batch;
  }

  /**
   * Approve a reconciliation batch
   */
  async approveBatch(
    batchId: string,
    approver: string,
    signature?: string,
    comments?: string
  ): Promise<void> {
    const batch = this.reconciliationBatches.get(batchId);
    if (!batch) {
      throw new Error('Batch not found');
    }

    if (batch.status !== 'PENDING') {
      throw new Error('Batch is not in pending state');
    }

    // Check if already approved by this approver
    if (batch.approvals.has(approver)) {
      throw new Error('Already approved by this approver');
    }

    // Add approval
    batch.approvals.set(approver, {
      approver,
      timestamp: Date.now(),
      signature,
      comments
    });

    // If using contract, submit approval on-chain
    if (this.reconciliationContract && signature) {
      try {
        const tx = await this.reconciliationContract.approveReconciliation(
          ethers.id(batchId),
          signature
        );
        await tx.wait();
      } catch (error) {
        this.emit('approval:failed', {
          batchId,
          approver,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
      }
    }

    this.emit('batch:approved', {
      batchId,
      approver,
      approvalCount: batch.approvals.size,
      requiredApprovals: this.config.requiredApprovals
    });

    // Check if enough approvals
    if (batch.approvals.size >= this.config.requiredApprovals) {
      batch.status = 'APPROVED';
      this.executionQueue.push(batch);
      
      this.emit('batch:ready-for-execution', {
        batchId,
        approvalCount: batch.approvals.size
      });
    }
  }

  /**
   * Auto-approve batch if below threshold
   */
  private async autoApproveBatch(batch: ReconciliationBatch): Promise<void> {
    const systemApprover = 'SYSTEM_AUTO_APPROVAL';
    
    batch.approvals.set(systemApprover, {
      approver: systemApprover,
      timestamp: Date.now(),
      comments: `Auto-approved: amount below threshold ${this.config.autoApprovalThreshold}`
    });

    batch.status = 'APPROVED';
    this.executionQueue.push(batch);

    this.emit('batch:auto-approved', {
      batchId: batch.id,
      totalValue: batch.totalValue,
      threshold: this.config.autoApprovalThreshold
    });
  }

  /**
   * Process execution queue
   */
  private async startQueueProcessor(): Promise<void> {
    setInterval(async () => {
      if (!this.isProcessing && this.executionQueue.length > 0) {
        await this.processNextBatch();
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Process next batch in queue
   */
  private async processNextBatch(): Promise<void> {
    if (this.executionQueue.length === 0) return;

    this.isProcessing = true;
    const batch = this.executionQueue.shift()!;

    try {
      batch.status = 'EXECUTING';
      await this.executeBatch(batch);
      batch.status = 'COMPLETED';
      
      // Generate report
      const report = this.generateReport(batch);
      this.emit('batch:completed', report);
      
    } catch (error) {
      batch.status = 'FAILED';
      this.emit('batch:failed', {
        batchId: batch.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Retry logic
      if (this.shouldRetry(batch)) {
        setTimeout(() => {
          batch.status = 'APPROVED';
          this.executionQueue.push(batch);
        }, this.config.retryDelay);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Execute a reconciliation batch
   */
  private async executeBatch(batch: ReconciliationBatch): Promise<void> {
    const startTime = Date.now();
    
    this.emit('batch:execution-started', {
      batchId: batch.id,
      actionCount: batch.actions.length
    });

    if (this.reconciliationContract) {
      // Execute via contract
      await this.executeBatchViaContract(batch);
    } else {
      // Execute directly
      await this.executeBatchDirectly(batch);
    }

    this.emit('batch:execution-completed', {
      batchId: batch.id,
      duration: Date.now() - startTime,
      successCount: Array.from(batch.executionResults.values())
        .filter(r => r.status === 'SUCCESS').length
    });
  }

  /**
   * Execute batch via reconciliation contract
   */
  private async executeBatchViaContract(batch: ReconciliationBatch): Promise<void> {
    // Group actions by type for efficient execution
    const credits: ReconciliationAction[] = [];
    const debits: ReconciliationAction[] = [];
    const investigations: ReconciliationAction[] = [];
    const freezes: ReconciliationAction[] = [];

    for (const action of batch.actions) {
      switch (action.type) {
        case 'CREDIT':
          credits.push(action);
          break;
        case 'DEBIT':
          debits.push(action);
          break;
        case 'INVESTIGATE':
          investigations.push(action);
          break;
        case 'FREEZE':
          freezes.push(action);
          break;
      }
    }

    // Execute credits
    if (credits.length > 0) {
      await this.executeCredits(credits, batch);
    }

    // Execute debits
    if (debits.length > 0) {
      await this.executeDebits(debits, batch);
    }

    // Handle investigations
    for (const action of investigations) {
      batch.executionResults.set(action.id, {
        actionId: action.id,
        status: 'SUCCESS',
        timestamp: Date.now()
      });
      
      this.emit('investigation:created', {
        actionId: action.id,
        userId: action.userId,
        token: action.token,
        reason: action.reason
      });
    }

    // Handle freezes
    for (const action of freezes) {
      batch.executionResults.set(action.id, {
        actionId: action.id,
        status: 'SUCCESS',
        timestamp: Date.now()
      });
      
      this.emit('account:frozen', {
        actionId: action.id,
        userId: action.userId,
        reason: action.reason
      });
    }
  }

  /**
   * Execute credits via contract
   */
  private async executeCredits(
    credits: ReconciliationAction[],
    batch: ReconciliationBatch
  ): Promise<void> {
    const users: string[] = [];
    const tokens: string[] = [];
    const amounts: bigint[] = [];

    for (const action of credits) {
      users.push(action.userId);
      tokens.push(action.token);
      amounts.push(action.amount);
    }

    try {
      const tx = await this.reconciliationContract!.reconcileBalances(
        users,
        tokens,
        amounts,
        ethers.id(batch.id),
        {
          gasLimit: 3000000
        }
      );

      const receipt = await tx.wait();

      // Mark all as successful
      for (const action of credits) {
        batch.executionResults.set(action.id, {
          actionId: action.id,
          status: 'SUCCESS',
          txHash: receipt.hash,
          gasUsed: receipt.gasUsed.toString(),
          timestamp: Date.now()
        });
      }

    } catch (error) {
      // Mark all as failed
      for (const action of credits) {
        batch.executionResults.set(action.id, {
          actionId: action.id,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        });
      }
      throw error;
    }
  }

  /**
   * Execute debits via contract
   */
  private async executeDebits(
    debits: ReconciliationAction[],
    batch: ReconciliationBatch
  ): Promise<void> {
    // Similar to credits but with negative amounts
    const users: string[] = [];
    const tokens: string[] = [];
    const amounts: bigint[] = [];

    for (const action of debits) {
      users.push(action.userId);
      tokens.push(action.token);
      amounts.push(-action.amount); // Negative for debits
    }

    try {
      const tx = await this.reconciliationContract!.reconcileBalances(
        users,
        tokens,
        amounts,
        ethers.id(batch.id),
        {
          gasLimit: 3000000
        }
      );

      const receipt = await tx.wait();

      for (const action of debits) {
        batch.executionResults.set(action.id, {
          actionId: action.id,
          status: 'SUCCESS',
          txHash: receipt.hash,
          gasUsed: receipt.gasUsed.toString(),
          timestamp: Date.now()
        });
      }

    } catch (error) {
      for (const action of debits) {
        batch.executionResults.set(action.id, {
          actionId: action.id,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        });
      }
      throw error;
    }
  }

  /**
   * Execute batch directly (without contract)
   */
  private async executeBatchDirectly(batch: ReconciliationBatch): Promise<void> {
    // This would require direct token transfers
    // Implementation depends on your token contracts
    
    for (const action of batch.actions) {
      try {
        // Simulate execution
        batch.executionResults.set(action.id, {
          actionId: action.id,
          status: 'SUCCESS',
          timestamp: Date.now()
        });
        
        this.emit('action:executed', {
          actionId: action.id,
          type: action.type,
          userId: action.userId,
          amount: action.amount.toString()
        });
        
      } catch (error) {
        batch.executionResults.set(action.id, {
          actionId: action.id,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Check if batch should be retried
   */
  private shouldRetry(batch: ReconciliationBatch): boolean {
    const retryCount = (batch as any).retryCount || 0;
    return retryCount < this.config.maxRetries;
  }

  /**
   * Generate reconciliation report
   */
  private generateReport(batch: ReconciliationBatch): ReconciliationReport {
    const totalReconciled = new Map<string, string>();
    let gasSpent = BigInt(0);
    let executedActions = 0;
    let failedActions = 0;

    // Aggregate results
    for (const action of batch.actions) {
      const result = batch.executionResults.get(action.id);
      
      if (result?.status === 'SUCCESS') {
        executedActions++;
        
        // Add to token totals
        const current = totalReconciled.get(action.token) || '0';
        totalReconciled.set(
          action.token,
          (BigInt(current) + action.amount).toString()
        );
        
        // Add gas
        if (result.gasUsed) {
          gasSpent += BigInt(result.gasUsed);
        }
      } else {
        failedActions++;
      }
    }

    return {
      batchId: batch.id,
      epochId: batch.id.split('_').pop() || '',
      totalActions: batch.actions.length,
      executedActions,
      failedActions,
      totalReconciled,
      gasSpent: gasSpent.toString(),
      duration: Date.now() - batch.createdAt,
      timestamp: Date.now()
    };
  }

  /**
   * Emergency pause reconciliation
   */
  async emergencyPause(): Promise<void> {
    if (this.reconciliationContract) {
      const tx = await this.reconciliationContract.emergencyPause();
      await tx.wait();
    }
    
    // Clear execution queue
    this.executionQueue = [];
    this.isProcessing = false;
    
    this.emit('reconciliation:paused', {
      timestamp: Date.now(),
      pendingBatches: this.executionQueue.length
    });
  }

  // Public query methods
  getBatch(batchId: string): ReconciliationBatch | undefined {
    return this.reconciliationBatches.get(batchId);
  }

  getPendingBatches(): ReconciliationBatch[] {
    return Array.from(this.reconciliationBatches.values())
      .filter(batch => batch.status === 'PENDING');
  }

  getExecutionQueue(): ReconciliationBatch[] {
    return [...this.executionQueue];
  }

  getApprovalStatus(batchId: string): {
    approved: number;
    required: number;
    approvers: string[];
  } {
    const batch = this.reconciliationBatches.get(batchId);
    if (!batch) {
      return { approved: 0, required: this.config.requiredApprovals, approvers: [] };
    }

    return {
      approved: batch.approvals.size,
      required: this.config.requiredApprovals,
      approvers: Array.from(batch.approvals.keys())
    };
  }

  updateConfig(newConfig: Partial<ReconciliationConfig>): void {
    Object.assign(this.config, newConfig);
    this.emit('config:updated', this.config);
  }
}