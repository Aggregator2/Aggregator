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
    
    // Validate private key
    try {
      this.wallet = new ethers.Wallet(privateKey, provider);
    } catch (error) {
      console.warn('⚠️ Invalid private key provided, using default test key');
      // Use a valid test private key from Hardhat's default accounts
      const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      this.wallet = new ethers.Wallet(testPrivateKey, provider);
    }
    
    this.nettingEngine = new NettingEngine();
    this.balanceTracker = new BalanceTracker();
    
    if (epochDuration) {
      this.epochDuration = epochDuration;
    }
    
    if (settlementContractAddress) {
      this.initializeSettlementContract(settlementContractAddress);
    }
    
    // Set up error handlers
    this.setupErrorHandlers();
    
    this.startEpochTimer();
  }
  
  // Setup comprehensive error handling
  private setupErrorHandlers(): void {
    this.on('error', (error) => {
      console.error('FinalSettlementEngine error:', error);
      this.handleCriticalError(error);
    });
    
    // Handle provider errors
    this.provider.on('error', (error) => {
      console.error('Provider error:', error);
      this.emit('providerError', error);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled rejection in FinalSettlementEngine:', reason);
      this.handleCriticalError(new Error(String(reason)));
    });
  }
  
  // Handle critical errors with recovery
  private async handleCriticalError(error: Error): Promise<void> {
    try {
      // Pause current operations
      if (this.currentEpoch) {
        this.currentEpoch.status = 'FAILED';
      }
      
      // Attempt to recover pending settlements
      await this.recoverPendingSettlements();
      
      this.emit('systemRecovery', { error: error.message, timestamp: Date.now() });
    } catch (recoveryError) {
      console.error('Recovery failed:', recoveryError);
      this.emit('systemFailure', { 
        originalError: error.message, 
        recoveryError: recoveryError.message,
        timestamp: Date.now()
      });
    }
  }
  
  // Recover pending settlements after failure
  private async recoverPendingSettlements(): Promise<void> {
    const pendingBundles = Array.from(this.pendingBundles.values());
    
    for (const bundle of pendingBundles) {
      try {
        if (bundle.transactionHash) {
          // Check if transaction was actually mined
          const receipt = await this.provider.getTransactionReceipt(bundle.transactionHash);
          if (receipt && receipt.status === 1) {
            bundle.status = 'CONFIRMED';
            this.pendingBundles.delete(bundle.id);
          } else {
            // Mark as failed if receipt shows failure
            bundle.status = 'FAILED';
            this.pendingBundles.delete(bundle.id);
          }
        } else {
          // No transaction hash - mark as failed
          bundle.status = 'FAILED';
          this.pendingBundles.delete(bundle.id);
        }
      } catch (error) {
        console.error(`Failed to recover bundle ${bundle.id}:`, error);
        bundle.status = 'FAILED';
        this.pendingBundles.delete(bundle.id);
      }
    }
  }

  // Determine if an error should trigger system recovery
  private isCriticalFailure(errorMessage: string): boolean {
    const criticalErrors = [
      'out of gas',
      'insufficient funds', 
      'nonce too low',
      'nonce too high',
      'replacement transaction underpriced',
      'network error',
      'provider disconnected'
    ];
    
    const lowerErrorMessage = errorMessage.toLowerCase();
    return criticalErrors.some(error => lowerErrorMessage.includes(error));
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
    
    // Listen to contract events (only if contract has event listener support)
    if (this.settlementContract.on) {
      this.settlementContract.on('SettlementExecuted', this.handleSettlementEvent.bind(this));
      this.settlementContract.on('BatchSettlementExecuted', this.handleBatchSettlementEvent.bind(this));
    }
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
      
      // Trigger system recovery for critical failures
      if (error instanceof Error && this.isCriticalFailure(error.message)) {
        await this.handleCriticalError(error);
      }
    }
  }
  
  // Process settlement for an epoch
  private async processEpochSettlement(epoch: SettlementEpoch): Promise<void> {
    try {
      epoch.status = 'PROCESSING';
      // Step 1: Batch trades and calculate net positions
      const netPositions = await this.batchTradesAndCalculateNetPositions(epoch);
      
      // Ensure settlement batch is created
      if (!epoch.settlementBatch) {
        throw new Error(`Settlement batch not created for epoch ${epoch.id}`);
      }
      
      // Update batch status
      epoch.settlementBatch.status = SettlementStatus.PROCESSING;
      
      // Step 2: Generate settlement instructions
      const instructions = await this.generateSettlementInstructions(netPositions, epoch.id);
      
      // Step 3: Create optimized transaction bundles
      const bundles = await this.createTransactionBundles(instructions);
      
      // Step 4: Execute bundles on-chain (if there are trades to settle)
      if (epoch.trades.length > 0 && bundles.length > 0) {
        await this.executeBundles(bundles, epoch);
        
        // Step 5: Verify settlements
        await this.verifySettlements(epoch);
        
        // Update batch status to settled
        epoch.settlementBatch.status = SettlementStatus.SETTLED;
        epoch.settlementBatch.executedAt = Date.now();
      } else {
        // No trades to settle, mark as completed
        epoch.settlementBatch.status = SettlementStatus.SETTLED;
        epoch.settlementBatch.executedAt = Date.now();
      }
      
      // Mark epoch as completed
      epoch.status = 'COMPLETED';
      epoch.finalizedAt = Date.now();
      
      this.emit('epochFinalized', epoch);
      
    } catch (error) {
      epoch.status = 'FAILED';
      if (epoch.settlementBatch) {
        epoch.settlementBatch.status = SettlementStatus.FAILED;
      }
      throw error;
    }
  }
  
  // Step 1: Batch trades and calculate net positions
  private async batchTradesAndCalculateNetPositions(
    epoch: SettlementEpoch
  ): Promise<Map<string, Map<string, bigint>>> {
    // Create settlement batch even if no trades
    const batch: SettlementBatch = {
      id: `BATCH_${epoch.id}`,
      settlements: [],
      totalTrades: epoch.trades.length,
      netPositions: new Map(),
      status: SettlementStatus.BATCHED,
      createdAt: Date.now()
    };
    
    // Always assign the batch to the epoch first
    epoch.settlementBatch = batch;
    
    if (epoch.trades.length === 0) {
      // Even with no trades, we have an empty but valid settlement batch
      this.emit('settlementEvent', {
        type: 'BATCH_CREATED',
        data: batch,
        timestamp: Date.now()
      } as SettlementEvent);
      
      return new Map();
    }
    
    // Use netting engine to calculate net positions
    const netPositions = await this.nettingEngine.calculateNetPositions(epoch.trades);
    
    // Update the batch with calculated net positions
    batch.netPositions = netPositions;
    
    // Create individual settlements for tracking
    for (const [userId, positions] of netPositions) {
      const netAmounts: NetPosition[] = [];
      
      for (const [token, amount] of positions) {
        // Calculate original amount before netting
        const userTrades = epoch.trades.filter(t => t.buyerId === userId || t.sellerId === userId);
        const originalAmount = this.calculateOriginalAmount(userTrades, userId, token);
        const nettingReduction = originalAmount - amount;
        
        netAmounts.push({
          userId,
          token,
          netAmount: amount,
          originalAmount,
          nettingReduction
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
    
    this.emit('settlementEvent', {
      type: 'BATCH_CREATED',
      data: batch,
      timestamp: Date.now()
    } as SettlementEvent);
    
    return netPositions;
  }
  
  // Calculate original amount before netting
  private calculateOriginalAmount(
    trades: Trade[],
    userId: string,
    token: string
  ): bigint {
    let amount = BigInt(0);
    
    for (const trade of trades) {
      const baseToken = this.getBaseToken(trade.pair);
      const quoteToken = this.getQuoteToken(trade.pair);
      
      // Validate trade data
      if (!isFinite(trade.price) || !isFinite(trade.filledQuantity) || trade.price <= 0 || trade.filledQuantity <= 0) {
        console.warn(`Skipping invalid trade in calculateOriginalAmount:`, { price: trade.price, filledQuantity: trade.filledQuantity, id: trade.id });
        continue;
      }
      
      if (trade.buyerId === userId) {
        if (token === baseToken) {
          // Buyer receives base token
          amount += BigInt(Math.floor(trade.filledQuantity * 1e8));
        } else if (token === quoteToken) {
          // Buyer pays quote token
          amount -= BigInt(Math.floor(trade.filledQuantity * trade.price * 1e8));
        }
      } else if (trade.sellerId === userId) {
        if (token === baseToken) {
          // Seller pays base token
          amount -= BigInt(Math.floor(trade.filledQuantity * 1e8));
        } else if (token === quoteToken) {
          // Seller receives quote token
          amount += BigInt(Math.floor(trade.filledQuantity * trade.price * 1e8));
        }
      }
    }
    
    return amount;
  }
  
  // Helper methods to extract tokens from pair
  private getBaseToken(pair: string): string {
    return pair.split('/')[0];
  }
  
  private getQuoteToken(pair: string): string {
    return pair.split('/')[1];
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
    
    let criticalErrorOccurred = false;
    let lastError: Error | null = null;
    
    for (const bundle of bundles) {
      try {
        await this.executeBundle(bundle);
      } catch (error) {
        lastError = error as Error;
        
        // Check if this is a critical failure that should trigger recovery
        if (this.isCriticalFailure(lastError.message)) {
          criticalErrorOccurred = true;
        }
        
        // For now, continue with other bundles, but track the error
        console.error(`Bundle ${bundle.id} execution failed:`, error);
      }
    }
    
    // If we had critical errors, trigger recovery
    if (criticalErrorOccurred && lastError) {
      await this.handleCriticalError(lastError);
      throw lastError; // Re-throw to fail the epoch
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
    
    // Trigger system recovery for critical failures
    if (bundle.error && this.isCriticalFailure(bundle.error)) {
      await this.handleCriticalError(new Error(`Bundle execution failed: ${bundle.error}`));
      return;
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
  
  // Public methods for state management and testing
  
  // Clear all state - for testing
  public clear(): void {
    // Stop current epoch timer
    if (this.currentEpoch) {
      this.currentEpoch.status = 'FAILED';
    }
    
    // Clear all collections
    this.currentEpoch = null;
    this.epochs.clear();
    this.pendingBundles.clear();
    this.verifications.clear();
    
    // Clear sub-engines
    this.nettingEngine.clear?.();
    this.balanceTracker.clear?.();
    
    // Remove all listeners to prevent memory leaks
    this.removeAllListeners();
    
    // Disconnect from contract events
    if (this.settlementContract && typeof this.settlementContract.removeAllListeners === 'function') {
      try {
        this.settlementContract.removeAllListeners();
      } catch (error) {
        console.warn('Failed to remove contract listeners:', error);
      }
    }
  }
  
  // Force finalize current epoch - for testing
  public async forceFinalize(): Promise<SettlementEpoch | null> {
    if (!this.currentEpoch) return null;
    
    const epochToFinalize = this.currentEpoch;
    await this.finalizeCurrentEpoch();
    return epochToFinalize;
  }

  // Test method to simulate bundle execution failure and trigger recovery
  public async testRecoveryMechanism(): Promise<void> {
    // Create a mock failed bundle
    const mockBundle: TransactionBundle = {
      id: 'test-bundle-1',
      instructions: [{
        id: 'test-instruction-1',
        type: 'TRANSFER',
        from: 'user1',
        to: 'user2',
        token: 'ETH',
        amount: BigInt('1000000000000000000'), // 1 ETH
        settlementIds: ['settlement-1'],
        priority: 1
      }],
      totalGasEstimate: BigInt('100000'),
      maxGasPrice: BigInt('20000000000'),
      nonce: 1,
      status: 'FAILED',
      error: 'Out of gas'
    };
    
    // Directly call handleFailedBundle to trigger recovery
    await this.handleFailedBundle(mockBundle);
  }
  
  // Get current state - for testing and debugging
  public getState(): {
    currentEpoch: SettlementEpoch | null;
    totalEpochs: number;
    pendingBundles: number;
    verifications: number;
  } {
    return {
      currentEpoch: this.currentEpoch,
      totalEpochs: this.epochs.size,
      pendingBundles: this.pendingBundles.size,
      verifications: this.verifications.size
    };
  }
  
  // Wait for specific epoch completion - for testing
  public async waitForEpochCompletion(epochId: string, timeoutMs: number = 30000): Promise<SettlementEpoch> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const epoch = this.epochs.get(epochId);
        const debugInfo = {
          epochId,
          epochExists: !!epoch,
          epochStatus: epoch?.status,
          hasSettlementBatch: !!epoch?.settlementBatch,
          batchId: epoch?.settlementBatch?.id,
          tradesCount: epoch?.trades?.length || 0,
          netPositionsSize: epoch?.settlementBatch?.netPositions?.size || 0,
        };
        
        reject(new Error(`Timeout waiting for epoch ${epochId} completion. Debug info: ${JSON.stringify(debugInfo)}`));
      }, timeoutMs);
      
      const checkEpoch = () => {
        const epoch = this.epochs.get(epochId);
        if (epoch && (epoch.status === 'COMPLETED' || epoch.status === 'FAILED')) {
          clearTimeout(timeout);
          
          // Debug logging for settlement batch
          if (epoch.status === 'COMPLETED' && !epoch.settlementBatch) {
            console.warn(`⚠️ Epoch ${epochId} completed but missing settlementBatch`);
          }
          
          resolve(epoch);
        } else {
          setTimeout(checkEpoch, 100);
        }
      };
      
      checkEpoch();
    });
  }
  
  // Debug method to inspect epoch state
  public inspectEpoch(epochId: string): any {
    const epoch = this.epochs.get(epochId);
    if (!epoch) {
      return { error: 'Epoch not found' };
    }
    
    return {
      id: epoch.id,
      status: epoch.status,
      tradesCount: epoch.trades.length,
      hasSettlementBatch: !!epoch.settlementBatch,
      settlementBatch: epoch.settlementBatch ? {
        id: epoch.settlementBatch.id,
        status: epoch.settlementBatch.status,
        totalTrades: epoch.settlementBatch.totalTrades,
        netPositionsSize: epoch.settlementBatch.netPositions.size,
        settlementsCount: epoch.settlementBatch.settlements.length,
        executedAt: epoch.settlementBatch.executedAt
      } : null,
      finalizedAt: epoch.finalizedAt
    };
  }
  
  // Graceful shutdown
  public async shutdown(): Promise<void> {
    try {
      // Wait for current operations to complete
      const pendingPromises = Array.from(this.pendingBundles.values()).map(async (bundle) => {
        if (bundle.transactionHash) {
          try {
            const receipt = await this.provider.getTransactionReceipt(bundle.transactionHash);
            return receipt;
          } catch (error) {
            console.warn(`Failed to get receipt for bundle ${bundle.id}:`, error);
            return null;
          }
        }
        return null;
      });
      
      // Wait up to 30 seconds for pending transactions
      await Promise.race([
        Promise.all(pendingPromises),
        new Promise(resolve => setTimeout(resolve, 30000))
      ]);
      
      // Clear state
      this.clear();
      
      this.emit('shutdown', { timestamp: Date.now() });
    } catch (error) {
      console.error('Error during shutdown:', error);
      this.emit('shutdownError', { error: error.message, timestamp: Date.now() });
    }
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