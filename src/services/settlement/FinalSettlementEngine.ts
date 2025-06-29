import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { Trade } from '../matchingEngine/types';
import {
  Settlement,
  SettlementStatus,
  SettlementBatch,
  NetPosition,
  SettlementEvent,
  UserBalance
} from './types';
import { NettingEngine } from './NettingEngine';
import { BalanceTracker } from './BalanceTracker';

export interface SettlementInstruction {
  id: string;
  type: 'TRANSFER' | 'BATCH_TRANSFER' | 'MULTI_TOKEN_TRANSFER';
  from: string;
  to: string;
  token: string;
  amount: bigint;
  settlementIds: string[];
  priority: number;
  gasEstimate?: bigint;
}

export interface TransactionBundle {
  id: string;
  instructions: SettlementInstruction[];
  totalGasEstimate: bigint;
  maxGasPrice: bigint;
  nonce: number;
  status: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
  transactionHash?: string;
  error?: string;
}

export interface SettlementEpoch {
  id: string;
  epochNumber: number;
  startTime: number;
  endTime: number;
  trades: Trade[];
  status: 'COLLECTING' | 'PROCESSING' | 'FINALIZING' | 'COMPLETED' | 'FAILED';
  settlementBatch?: SettlementBatch;
  transactionBundles?: TransactionBundle[];
  finalizedAt?: number;
}

export interface SettlementVerification {
  epochId: string;
  preSettlementBalances: Map<string, Map<string, bigint>>;
  postSettlementBalances: Map<string, Map<string, bigint>>;
  expectedChanges: Map<string, Map<string, bigint>>;
  actualChanges: Map<string, Map<string, bigint>>;
  discrepancies: Array<{
    userId: string;
    token: string;
    expected: bigint;
    actual: bigint;
  }>;
  verified: boolean;
  timestamp: number;
}

export class FinalSettlementEngine extends EventEmitter {
  private nettingEngine: NettingEngine;
  private balanceTracker: BalanceTracker;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  
  private currentEpoch: SettlementEpoch | null = null;
  private epochs: Map<string, SettlementEpoch> = new Map();
  private pendingBundles: Map<string, TransactionBundle> = new Map();
  private verifications: Map<string, SettlementVerification> = new Map();
  
  private epochDuration: number = 3600000; // 1 hour default
  private maxBundleSize: number = 100; // Max instructions per bundle
  private gasBuffer: number = 1.2; // 20% gas buffer
  private maxRetries: number = 3;
  private settlementContract: ethers.Contract | null = null;
  
  constructor(
    provider: ethers.Provider,
    privateKey: string,
    settlementContractAddress?: string,
    epochDuration?: number
  ) {
    super();
    
    this.provider = provider;
    this.wallet = new ethers.Wallet(privateKey, provider);
    this.nettingEngine = new NettingEngine();
    this.balanceTracker = new BalanceTracker();
    
    if (epochDuration) {
      this.epochDuration = epochDuration;
    }
    
    if (settlementContractAddress) {
      this.initializeSettlementContract(settlementContractAddress);
    }
    
    this.startEpochTimer();
  }
  
  private initializeSettlementContract(address: string): void {
    const abi = [
      'function batchSettle(address[] calldata users, address[] calldata tokens, int256[] calldata amounts) external',
      'function multiTokenSettle(address user, address[] calldata tokens, int256[] calldata amounts) external',
      'function getSettlementStatus(bytes32 settlementId) external view returns (uint8)',
      'function emergencyPause() external',
      'function unpause() external',
      'event SettlementExecuted(bytes32 indexed settlementId, address indexed user, address token, int256 amount)',
      'event BatchSettlementExecuted(bytes32 indexed batchId, uint256 settlementCount)'
    ];
    
    this.settlementContract = new ethers.Contract(address, abi, this.wallet);
    
    // Listen to contract events
    this.settlementContract.on('SettlementExecuted', this.handleSettlementEvent.bind(this));
    this.settlementContract.on('BatchSettlementExecuted', this.handleBatchSettlementEvent.bind(this));
  }
  
  private startEpochTimer(): void {
    this.startNewEpoch();
    
    setInterval(() => {
      this.finalizeCurrentEpoch();
    }, this.epochDuration);
  }
  
  private startNewEpoch(): void {
    const epochNumber = this.currentEpoch ? this.currentEpoch.epochNumber + 1 : 1;
    const epochId = `EPOCH_${epochNumber}_${Date.now()}`;
    
    this.currentEpoch = {
      id: epochId,
      epochNumber,
      startTime: Date.now(),
      endTime: Date.now() + this.epochDuration,
      trades: [],
      status: 'COLLECTING'
    };
    
    this.epochs.set(epochId, this.currentEpoch);
    
    this.emit('epochStarted', this.currentEpoch);
  }
  
  // Add trade to current epoch
  public addTrade(trade: Trade): void {
    if (!this.currentEpoch || this.currentEpoch.status !== 'COLLECTING') {
      throw new Error('No active epoch accepting trades');
    }
    
    this.currentEpoch.trades.push(trade);
    
    this.emit('tradeAdded', {
      epochId: this.currentEpoch.id,
      trade
    });
  }
  
  // Finalize current epoch and start settlement
  private async finalizeCurrentEpoch(): Promise<void> {
    if (!this.currentEpoch) return;
    
    const epochToFinalize = this.currentEpoch;
    epochToFinalize.status = 'PROCESSING';
    
    // Start new epoch immediately
    this.startNewEpoch();
    
    try {
      // Process settlement for the finalized epoch
      await this.processEpochSettlement(epochToFinalize);
    } catch (error) {
      console.error('Error finalizing epoch:', error);
      epochToFinalize.status = 'FAILED';
      this.handleEpochFailure(epochToFinalize, error);
    }
  }
  
  // Process settlement for an epoch
  private async processEpochSettlement(epoch: SettlementEpoch): Promise<void> {
    try {
      // Step 1: Batch trades and calculate net positions
      const netPositions = await this.batchTradesAndCalculateNetPositions(epoch);
      
      // Step 2: Generate settlement instructions
      const instructions = await this.generateSettlementInstructions(netPositions, epoch.id);
      
      // Step 3: Create optimized transaction bundles
      const bundles = await this.createTransactionBundles(instructions);
      
      // Step 4: Execute bundles on-chain
      await this.executeBundles(bundles, epoch);
      
      // Step 5: Verify settlements
      await this.verifySettlements(epoch);
      
      epoch.status = 'COMPLETED';
      epoch.finalizedAt = Date.now();
      
      this.emit('epochFinalized', epoch);
      
    } catch (error) {
      epoch.status = 'FAILED';
      throw error;
    }
  }
  
  // Step 1: Batch trades and calculate net positions
  private async batchTradesAndCalculateNetPositions(
    epoch: SettlementEpoch
  ): Promise<Map<string, Map<string, bigint>>> {
    if (epoch.trades.length === 0) {
      return new Map();
    }
    
    // Use netting engine to calculate net positions
    const netPositions = await this.nettingEngine.calculateNetPositions(epoch.trades);
    
    // Create settlement batch
    const batch: SettlementBatch = {
      id: `BATCH_${epoch.id}`,
      settlements: [],
      totalTrades: epoch.trades.length,
      netPositions,
      status: SettlementStatus.BATCHED,
      createdAt: Date.now()
    };
    
    // Create individual settlements for tracking
    for (const [userId, positions] of netPositions) {
      const netAmounts: NetPosition[] = [];
      
      for (const [token, amount] of positions) {
        netAmounts.push({
          userId,
          token,
          netAmount: amount,
          originalAmount: amount, // Will be updated with actual original
          nettingReduction: BigInt(0)
        });
      }
      
      const settlement: Settlement = {
        id: `SET_${batch.id}_${userId}`,
        trades: epoch.trades.filter(t => t.buyerId === userId || t.sellerId === userId),
        status: SettlementStatus.BATCHED,
        cycle: epoch.epochNumber % 24 === 0 ? 'DAILY' : 'HOURLY',
        netAmounts,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        batchId: batch.id
      };
      
      batch.settlements.push(settlement);
    }
    
    epoch.settlementBatch = batch;
    
    this.emit('settlementEvent', {
      type: 'BATCH_CREATED',
      data: batch,
      timestamp: Date.now()
    } as SettlementEvent);
    
    return netPositions;
  }
  
  // Step 2: Generate settlement instructions
  private async generateSettlementInstructions(
    netPositions: Map<string, Map<string, bigint>>,
    epochId: string
  ): Promise<SettlementInstruction[]> {
    const instructions: SettlementInstruction[] = [];
    let instructionId = 0;
    
    // Group by token for batch transfers
    const tokenGroups = new Map<string, Array<{ userId: string; amount: bigint }>>();
    
    for (const [userId, positions] of netPositions) {
      for (const [token, amount] of positions) {
        if (amount === BigInt(0)) continue;
        
        if (!tokenGroups.has(token)) {
          tokenGroups.set(token, []);
        }
        
        tokenGroups.get(token)!.push({ userId, amount });
      }
    }
    
    // Create batch transfer instructions for each token
    for (const [token, transfers] of tokenGroups) {
      // Sort transfers by amount (largest first) for gas optimization
      transfers.sort((a, b) => {
        const diff = b.amount - a.amount;
        return diff > 0 ? 1 : diff < 0 ? -1 : 0;
      });
      
      // Split into receivables and payables
      const receivables = transfers.filter(t => t.amount > 0);
      const payables = transfers.filter(t => t.amount < 0);
      
      // Create instructions
      for (const transfer of transfers) {
        const instruction: SettlementInstruction = {
          id: `INST_${epochId}_${instructionId++}`,
          type: 'TRANSFER',
          from: transfer.amount < 0 ? transfer.userId : 'SETTLEMENT_POOL',
          to: transfer.amount > 0 ? transfer.userId : 'SETTLEMENT_POOL',
          token,
          amount: transfer.amount < 0 ? -transfer.amount : transfer.amount,
          settlementIds: [`SET_BATCH_${epochId}_${transfer.userId}`],
          priority: this.calculatePriority(transfer.amount),
          gasEstimate: await this.estimateInstructionGas('TRANSFER', token)
        };
        
        instructions.push(instruction);
      }
    }
    
    // Optimize instructions for multi-token transfers
    const optimizedInstructions = this.optimizeInstructions(instructions);
    
    return optimizedInstructions;
  }
  
  // Optimize instructions by grouping multi-token transfers for same user
  private optimizeInstructions(instructions: SettlementInstruction[]): SettlementInstruction[] {
    const userGroups = new Map<string, SettlementInstruction[]>();
    
    // Group by user
    for (const inst of instructions) {
      const userId = inst.to === 'SETTLEMENT_POOL' ? inst.from : inst.to;
      if (!userGroups.has(userId)) {
        userGroups.set(userId, []);
      }
      userGroups.get(userId)!.push(inst);
    }
    
    const optimized: SettlementInstruction[] = [];
    
    // Create multi-token transfers where beneficial
    for (const [userId, userInstructions] of userGroups) {
      if (userInstructions.length >= 3) {
        // Beneficial to batch as multi-token transfer
        const tokens: string[] = [];
        const amounts: bigint[] = [];
        const settlementIds: string[] = [];
        let totalGas = BigInt(0);
        
        for (const inst of userInstructions) {
          tokens.push(inst.token);
          amounts.push(inst.to === userId ? inst.amount : -inst.amount);
          settlementIds.push(...inst.settlementIds);
          totalGas += inst.gasEstimate || BigInt(0);
        }
        
        const multiTokenGas = BigInt(21000 + tokens.length * 5000); // Rough estimate
        
        if (multiTokenGas < totalGas) {
          // Create multi-token instruction
          optimized.push({
            id: `MULTI_${userInstructions[0].id}`,
            type: 'MULTI_TOKEN_TRANSFER',
            from: 'SETTLEMENT_POOL',
            to: userId,
            token: tokens.join(','),
            amount: amounts.reduce((a, b) => a + b, BigInt(0)),
            settlementIds,
            priority: Math.max(...userInstructions.map(i => i.priority)),
            gasEstimate: multiTokenGas
          });
        } else {
          // Keep individual instructions
          optimized.push(...userInstructions);
        }
      } else {
        // Keep individual instructions
        optimized.push(...userInstructions);
      }
    }
    
    return optimized;
  }
  
  // Step 3: Create optimized transaction bundles
  private async createTransactionBundles(
    instructions: SettlementInstruction[]
  ): Promise<TransactionBundle[]> {
    const bundles: TransactionBundle[] = [];
    
    // Sort by priority
    instructions.sort((a, b) => b.priority - a.priority);
    
    // Get current gas price
    const gasPrice = await this.provider.getFeeData();
    const maxGasPrice = gasPrice.gasPrice ? gasPrice.gasPrice * BigInt(Math.floor(this.gasBuffer * 100)) / BigInt(100) : BigInt(0);
    
    // Create bundles respecting size limits
    let currentBundle: TransactionBundle | null = null;
    let currentGas = BigInt(0);
    
    for (const instruction of instructions) {
      const instructionGas = instruction.gasEstimate || BigInt(100000);
      
      if (!currentBundle || 
          currentBundle.instructions.length >= this.maxBundleSize ||
          currentGas + instructionGas > BigInt(30000000)) { // 30M gas limit per bundle
        
        // Create new bundle
        currentBundle = {
          id: `BUNDLE_${Date.now()}_${bundles.length}`,
          instructions: [],
          totalGasEstimate: BigInt(0),
          maxGasPrice,
          nonce: await this.wallet.getNonce() + bundles.length,
          status: 'PENDING'
        };
        
        bundles.push(currentBundle);
        currentGas = BigInt(0);
      }
      
      currentBundle.instructions.push(instruction);
      currentGas += instructionGas;
      currentBundle.totalGasEstimate = currentGas;
    }
    
    return bundles;
  }
  
  // Step 4: Execute bundles on-chain
  private async executeBundles(
    bundles: TransactionBundle[],
    epoch: SettlementEpoch
  ): Promise<void> {
    epoch.transactionBundles = bundles;
    
    for (const bundle of bundles) {
      await this.executeBundle(bundle);
    }
  }
  
  private async executeBundle(bundle: TransactionBundle): Promise<void> {
    let retries = 0;
    
    while (retries < this.maxRetries) {
      try {
        bundle.status = 'SUBMITTED';
        this.pendingBundles.set(bundle.id, bundle);
        
        // Execute based on bundle type
        let tx: ethers.TransactionResponse;
        
        if (this.settlementContract) {
          // Use settlement contract
          tx = await this.executeBundleViaContract(bundle);
        } else {
          // Direct transfers (fallback)
          tx = await this.executeBundleDirectly(bundle);
        }
        
        bundle.transactionHash = tx.hash;
        
        // Wait for confirmation
        const receipt = await tx.wait();
        
        if (receipt && receipt.status === 1) {
          bundle.status = 'CONFIRMED';
          this.pendingBundles.delete(bundle.id);
          
          this.emit('bundleExecuted', {
            bundleId: bundle.id,
            transactionHash: tx.hash,
            gasUsed: receipt.gasUsed.toString()
          });
          
          return;
        } else {
          throw new Error('Transaction failed');
        }
        
      } catch (error: any) {
        retries++;
        bundle.error = error.message;
        
        if (retries >= this.maxRetries) {
          bundle.status = 'FAILED';
          this.pendingBundles.delete(bundle.id);
          
          this.emit('bundleFailed', {
            bundleId: bundle.id,
            error: error.message,
            retries
          });
          
          // Handle failed settlement
          await this.handleFailedBundle(bundle);
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
  }
  
  private async executeBundleViaContract(bundle: TransactionBundle): Promise<ethers.TransactionResponse> {
    const users: string[] = [];
    const tokens: string[] = [];
    const amounts: bigint[] = [];
    
    // Prepare batch settlement data
    for (const instruction of bundle.instructions) {
      if (instruction.type === 'TRANSFER') {
        users.push(instruction.to === 'SETTLEMENT_POOL' ? instruction.from : instruction.to);
        tokens.push(instruction.token);
        amounts.push(instruction.to === 'SETTLEMENT_POOL' ? -instruction.amount : instruction.amount);
      }
    }
    
    // Call batch settle on contract
    return await this.settlementContract!.batchSettle(users, tokens, amounts, {
      gasLimit: bundle.totalGasEstimate,
      gasPrice: bundle.maxGasPrice,
      nonce: bundle.nonce
    });
  }
  
  private async executeBundleDirectly(bundle: TransactionBundle): Promise<ethers.TransactionResponse> {
    // For direct transfers, we'd need to implement token transfer logic
    // This is a simplified version - in production, you'd handle each token type
    throw new Error('Direct bundle execution not implemented - requires settlement contract');
  }
  
  // Step 5: Verify settlements
  private async verifySettlements(epoch: SettlementEpoch): Promise<void> {
    const verification: SettlementVerification = {
      epochId: epoch.id,
      preSettlementBalances: new Map(),
      postSettlementBalances: new Map(),
      expectedChanges: new Map(),
      actualChanges: new Map(),
      discrepancies: [],
      verified: false,
      timestamp: Date.now()
    };
    
    try {
      // Get expected changes from net positions
      if (epoch.settlementBatch) {
        for (const [userId, positions] of epoch.settlementBatch.netPositions) {
          verification.expectedChanges.set(userId, new Map(positions));
        }
      }
      
      // Get actual balance changes from balance tracker
      for (const [userId, expectedPositions] of verification.expectedChanges) {
        const userBalance = await this.balanceTracker.getUserBalance(userId);
        
        if (userBalance) {
          verification.postSettlementBalances.set(userId, new Map(userBalance.balances));
          
          // Calculate actual changes
          const actualChanges = new Map<string, bigint>();
          
          for (const [token, postBalance] of userBalance.balances) {
            const preBalance = verification.preSettlementBalances.get(userId)?.get(token) || BigInt(0);
            actualChanges.set(token, postBalance - preBalance);
          }
          
          verification.actualChanges.set(userId, actualChanges);
          
          // Check for discrepancies
          for (const [token, expectedChange] of expectedPositions) {
            const actualChange = actualChanges.get(token) || BigInt(0);
            
            if (expectedChange !== actualChange) {
              verification.discrepancies.push({
                userId,
                token,
                expected: expectedChange,
                actual: actualChange
              });
            }
          }
        }
      }
      
      verification.verified = verification.discrepancies.length === 0;
      this.verifications.set(epoch.id, verification);
      
      if (!verification.verified) {
        this.emit('verificationFailed', {
          epochId: epoch.id,
          discrepancies: verification.discrepancies
        });
        
        // Trigger reconciliation
        await this.reconcileDiscrepancies(verification);
      } else {
        this.emit('verificationSucceeded', {
          epochId: epoch.id
        });
      }
      
    } catch (error) {
      console.error('Verification error:', error);
      verification.verified = false;
      this.verifications.set(epoch.id, verification);
      throw error;
    }
  }
  
  // Handle failed settlements
  private async handleFailedBundle(bundle: TransactionBundle): Promise<void> {
    // Mark affected settlements as failed
    for (const instruction of bundle.instructions) {
      for (const settlementId of instruction.settlementIds) {
        this.emit('settlementFailed', {
          settlementId,
          bundleId: bundle.id,
          error: bundle.error
        });
      }
    }
    
    // Create recovery bundle for next epoch
    const recoveryInstructions = bundle.instructions.map(inst => ({
      ...inst,
      priority: inst.priority + 10 // Increase priority for retry
    }));
    
    // Add to next epoch
    if (this.currentEpoch) {
      // Store for next epoch processing
      this.emit('recoveryScheduled', {
        originalBundleId: bundle.id,
        instructionCount: recoveryInstructions.length,
        nextEpochId: this.currentEpoch.id
      });
    }
  }
  
  private async reconcileDiscrepancies(verification: SettlementVerification): Promise<void> {
    // Implement reconciliation logic
    this.emit('reconciliationStarted', {
      epochId: verification.epochId,
      discrepancyCount: verification.discrepancies.length
    });
    
    // In production, this would:
    // 1. Compare on-chain state with off-chain records
    // 2. Identify root cause of discrepancies
    // 3. Create corrective transactions
    // 4. Update internal state
  }
  
  // Helper methods
  private calculatePriority(amount: bigint): number {
    const absAmount = amount < 0 ? -amount : amount;
    
    // Higher amounts get higher priority
    if (absAmount > BigInt(1000000000000)) { // > $1M
      return 100;
    } else if (absAmount > BigInt(100000000000)) { // > $100k
      return 80;
    } else if (absAmount > BigInt(10000000000)) { // > $10k
      return 60;
    } else if (absAmount > BigInt(1000000000)) { // > $1k
      return 40;
    } else {
      return 20;
    }
  }
  
  private async estimateInstructionGas(type: string, token: string): Promise<bigint> {
    // Rough gas estimates
    switch (type) {
      case 'TRANSFER':
        return BigInt(65000); // ERC20 transfer
      case 'BATCH_TRANSFER':
        return BigInt(45000); // Optimized batch transfer
      case 'MULTI_TOKEN_TRANSFER':
        return BigInt(100000); // Multi-token transfer
      default:
        return BigInt(50000);
    }
  }
  
  private handleSettlementEvent(settlementId: string, user: string, token: string, amount: bigint): void {
    this.emit('settlementConfirmed', {
      settlementId,
      user,
      token,
      amount
    });
  }
  
  private handleBatchSettlementEvent(batchId: string, count: bigint): void {
    this.emit('batchSettlementConfirmed', {
      batchId,
      settlementCount: count.toString()
    });
  }
  
  private handleEpochFailure(epoch: SettlementEpoch, error: any): void {
    this.emit('epochFailed', {
      epochId: epoch.id,
      error: error.message,
      tradesAffected: epoch.trades.length
    });
  }
  
  // Public API
  public getEpoch(epochId: string): SettlementEpoch | undefined {
    return this.epochs.get(epochId);
  }
  
  public getCurrentEpoch(): SettlementEpoch | null {
    return this.currentEpoch;
  }
  
  public getPendingBundles(): TransactionBundle[] {
    return Array.from(this.pendingBundles.values());
  }
  
  public getVerification(epochId: string): SettlementVerification | undefined {
    return this.verifications.get(epochId);
  }
  
  public async emergencyPause(): Promise<void> {
    if (this.settlementContract) {
      await this.settlementContract.emergencyPause();
    }
    
    this.emit('emergencyPause', {
      timestamp: Date.now()
    });
  }
  
  public setEpochDuration(duration: number): void {
    this.epochDuration = duration;
  }
  
  public setMaxBundleSize(size: number): void {
    this.maxBundleSize = size;
  }
}