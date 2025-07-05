import { FinalSettlementEngine, TransactionBundle, SettlementInstruction } from './FinalSettlementEngine';
import { MEVProtectionService, MEVProtectionProvider, MEVProtectionConfig, ProtectedTransaction } from '../mevProtection/MEVProtectionService';
import { ethers } from 'ethers';
import { EventEmitter } from 'events';

export interface MEVProtectedSettlementConfig {
  mevProtection: MEVProtectionConfig;
  settlementContractAddress: string;
  epochDuration: number;
  prioritizeLargeSettlements?: boolean;
  simulateBeforeSending?: boolean;
  maxRetries?: number;
  bundleTimeout?: number;
}

export interface MEVProtectionStats {
  totalBundles: number;
  protectedBundles: number;
  failedProtection: number;
  gassSaved: bigint;
  frontRunsAvoided: number;
  sandwichAttacksAvoided: number;
  averageConfirmationTime: number;
  providerUsage: Map<MEVProtectionProvider, number>;
}

export class MEVProtectedSettlementEngine extends FinalSettlementEngine {
  private mevProtectionService: MEVProtectionService;
  private mevConfig: MEVProtectedSettlementConfig;
  private protectedTransactions: Map<string, ProtectedTransaction[]> = new Map();
  private mevStats: MEVProtectionStats;

  constructor(
    provider: ethers.Provider,
    privateKey: string,
    config: MEVProtectedSettlementConfig
  ) {
    super(provider, privateKey, config.settlementContractAddress, config.epochDuration);
    
    this.mevConfig = config;
    
    // Initialize MEV protection service
    this.mevProtectionService = new MEVProtectionService(
      provider,
      this.wallet,
      config.mevProtection
    );

    this.mevStats = {
      totalBundles: 0,
      protectedBundles: 0,
      failedProtection: 0,
      gassSaved: BigInt(0),
      frontRunsAvoided: 0,
      sandwichAttacksAvoided: 0,
      averageConfirmationTime: 0,
      providerUsage: new Map()
    };

    this.setupMEVEventHandlers();
  }

  private setupMEVEventHandlers(): void {
    this.mevProtectionService.on('transactionSubmitted', (tx: ProtectedTransaction) => {
      this.emit('mevProtection:submitted', {
        txId: tx.id,
        provider: tx.provider,
        bundleHash: tx.bundleHash
      });
    });

    this.mevProtectionService.on('transactionConfirmed', (tx: ProtectedTransaction) => {
      this.emit('mevProtection:confirmed', {
        txId: tx.id,
        txHash: tx.txHash,
        gasUsed: tx.gasUsed,
        confirmationTime: tx.confirmedAt! - tx.submittedAt!
      });

      // Update stats
      if (tx.confirmedAt && tx.submittedAt) {
        const confirmationTime = tx.confirmedAt - tx.submittedAt;
        this.mevStats.averageConfirmationTime = 
          (this.mevStats.averageConfirmationTime * this.mevStats.protectedBundles + confirmationTime) / 
          (this.mevStats.protectedBundles + 1);
      }
      this.mevStats.protectedBundles++;
    });

    this.mevProtectionService.on('transactionFailed', (tx: ProtectedTransaction) => {
      this.emit('mevProtection:failed', {
        txId: tx.id,
        error: tx.error,
        provider: tx.provider
      });
      
      this.mevStats.failedProtection++;
    });
  }

  // Override executeBundle to use MEV protection
  protected async executeBundle(bundle: TransactionBundle): Promise<void> {
    this.mevStats.totalBundles++;
    
    let retries = 0;
    const maxRetries = this.mevConfig.maxRetries || this.maxRetries;
    
    while (retries < maxRetries) {
      try {
        bundle.status = 'SUBMITTED';
        this.pendingBundles.set(bundle.id, bundle);
        
        // Determine urgency based on bundle size and value
        const urgency = this.determineBundleUrgency(bundle);
        
        // Execute based on bundle type
        let protectedTx: ProtectedTransaction;
        
        if (this.settlementContract) {
          // Use MEV protection for settlement contract calls
          protectedTx = await this.executeBundleViaContractWithMEV(bundle, urgency);
        } else {
          // Direct transfers with MEV protection
          protectedTx = await this.executeBundleDirectlyWithMEV(bundle, urgency);
        }
        
        // Store protected transaction
        if (!this.protectedTransactions.has(bundle.id)) {
          this.protectedTransactions.set(bundle.id, []);
        }
        this.protectedTransactions.get(bundle.id)!.push(protectedTx);
        
        // Update provider usage stats
        const currentUsage = this.mevStats.providerUsage.get(protectedTx.provider) || 0;
        this.mevStats.providerUsage.set(protectedTx.provider, currentUsage + 1);
        
        // Wait for confirmation
        const confirmationTimeout = this.mevConfig.bundleTimeout || 120000; // 2 minutes
        const startTime = Date.now();
        
        while (protectedTx.status === 'SUBMITTED' && Date.now() - startTime < confirmationTimeout) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const updated = this.mevProtectionService.getTransaction(protectedTx.id);
          if (updated) {
            protectedTx = updated;
          }
        }
        
        if (protectedTx.status === 'CONFIRMED') {
          bundle.status = 'CONFIRMED';
          bundle.transactionHash = protectedTx.txHash;
          this.pendingBundles.delete(bundle.id);
          
          // Calculate gas saved
          if (protectedTx.gasUsed && protectedTx.effectiveGasPrice) {
            const standardGasPrice = (await this.provider.getFeeData()).gasPrice || BigInt(0);
            const gasSaved = protectedTx.gasUsed * (standardGasPrice - protectedTx.effectiveGasPrice);
            if (gasSaved > 0) {
              this.mevStats.gassSaved += gasSaved;
            }
          }
          
          this.emit('bundleExecuted', {
            bundleId: bundle.id,
            transactionHash: protectedTx.txHash,
            gasUsed: protectedTx.gasUsed?.toString(),
            provider: protectedTx.provider,
            mevProtected: true
          });
          
          return;
        } else {
          throw new Error(`Transaction failed: ${protectedTx.error || 'Timeout'}`);
        }
        
      } catch (error: any) {
        retries++;
        bundle.error = error.message;
        
        if (retries >= maxRetries) {
          bundle.status = 'FAILED';
          this.pendingBundles.delete(bundle.id);
          
          this.emit('bundleFailed', {
            bundleId: bundle.id,
            error: error.message,
            retries,
            mevProtected: true
          });
          
          // Handle failed settlement
          await this.handleFailedBundle(bundle);
          throw error;
        }
        
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
      }
    }
  }

  private async executeBundleViaContractWithMEV(
    bundle: TransactionBundle,
    urgency: 'LOW' | 'MEDIUM' | 'HIGH'
  ): Promise<ProtectedTransaction> {
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
    
    // Prepare transaction
    const tx: ethers.TransactionRequest = {
      to: this.settlementContract!.target,
      data: this.settlementContract!.interface.encodeFunctionData(
        'batchSettle',
        [users, tokens, amounts]
      ),
      gasLimit: bundle.totalGasEstimate,
      maxFeePerGas: bundle.maxGasPrice,
      nonce: bundle.nonce
    };
    
    // Simulate if enabled
    if (this.mevConfig.simulateBeforeSending) {
      const simulation = await this.mevProtectionService.simulateTransaction(tx);
      if (!simulation.success) {
        throw new Error(`Transaction simulation failed: ${simulation.error}`);
      }
    }
    
    // Send via MEV protection
    return await this.mevProtectionService.sendProtectedTransaction(tx, {
      urgency,
      settlementBatchId: bundle.id
    });
  }

  private async executeBundleDirectlyWithMEV(
    bundle: TransactionBundle,
    urgency: 'LOW' | 'MEDIUM' | 'HIGH'
  ): Promise<ProtectedTransaction> {
    // For direct transfers, we'd need to implement token transfer logic
    // This is a placeholder - in production, you'd handle each token type
    throw new Error('Direct bundle execution with MEV protection not implemented');
  }

  private determineBundleUrgency(bundle: TransactionBundle): 'LOW' | 'MEDIUM' | 'HIGH' {
    // Calculate total value
    let totalValue = BigInt(0);
    for (const instruction of bundle.instructions) {
      totalValue += instruction.amount;
    }
    
    // Determine urgency based on value and priority
    const avgPriority = bundle.instructions.reduce((sum, inst) => sum + inst.priority, 0) / bundle.instructions.length;
    
    if (avgPriority >= 80 || totalValue > BigInt(1000000000000)) { // High priority or > $1M
      return 'HIGH';
    } else if (avgPriority >= 50 || totalValue > BigInt(100000000000)) { // Medium priority or > $100k
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  // Get MEV protection statistics
  public getMEVProtectionStats(): MEVProtectionStats {
    const metrics = this.mevProtectionService.getMetrics();
    
    return {
      ...this.mevStats,
      gassSaved: this.mevStats.gassSaved + metrics.totalGasSaved,
      averageConfirmationTime: metrics.averageConfirmationTime || this.mevStats.averageConfirmationTime
    };
  }

  // Get protected transactions for a bundle
  public getProtectedTransactions(bundleId: string): ProtectedTransaction[] {
    return this.protectedTransactions.get(bundleId) || [];
  }

  // Check MEV protection health
  public async checkMEVProtectionHealth(): Promise<{
    healthy: boolean;
    providers: { [key: string]: boolean };
  }> {
    const providers = [
      MEVProtectionProvider.FLASHBOTS,
      MEVProtectionProvider.BLOXROUTE,
      MEVProtectionProvider.EDEN,
      MEVProtectionProvider.MISTX,
      MEVProtectionProvider.SECURE_RPC,
      MEVProtectionProvider.STANDARD
    ];
    
    const health: { [key: string]: boolean } = {};
    let anyHealthy = false;
    
    for (const provider of providers) {
      const isHealthy = await this.mevProtectionService.checkProviderHealth(provider);
      health[provider] = isHealthy;
      if (isHealthy && provider !== MEVProtectionProvider.STANDARD) {
        anyHealthy = true;
      }
    }
    
    return {
      healthy: anyHealthy,
      providers: health
    };
  }

  // Estimate MEV risk for a bundle
  public estimateMEVRisk(bundle: TransactionBundle): {
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    estimatedMEV: bigint;
    vulnerabilities: string[];
  } {
    const vulnerabilities: string[] = [];
    let estimatedMEV = BigInt(0);
    let riskScore = 0;
    
    // Analyze each instruction
    for (const instruction of bundle.instructions) {
      // Large transfers are more attractive to MEV
      if (instruction.amount > BigInt(100000000000)) { // > $100k
        vulnerabilities.push('Large value transfer attractive to MEV bots');
        riskScore += 30;
        estimatedMEV += instruction.amount * BigInt(1) / BigInt(1000); // 0.1% potential MEV
      }
      
      // Multiple token transfers in one bundle
      if (bundle.instructions.length > 5) {
        vulnerabilities.push('Multiple transfers increase attack surface');
        riskScore += 20;
      }
      
      // High gas transactions are more vulnerable
      if (instruction.gasEstimate && instruction.gasEstimate > BigInt(200000)) {
        vulnerabilities.push('High gas usage increases frontrunning incentive');
        riskScore += 10;
      }
    }
    
    // Determine risk level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    if (riskScore >= 50) {
      riskLevel = 'HIGH';
    } else if (riskScore >= 30) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }
    
    return {
      riskLevel,
      estimatedMEV,
      vulnerabilities
    };
  }

  // Override emergency pause to cancel pending MEV transactions
  public async emergencyPause(): Promise<void> {
    // Cancel all pending MEV transactions
    for (const [bundleId, transactions] of this.protectedTransactions) {
      for (const tx of transactions) {
        if (tx.status === 'SUBMITTED') {
          await this.mevProtectionService.cancelTransaction(tx.id);
        }
      }
    }
    
    // Call parent emergency pause
    await super.emergencyPause();
    
    this.emit('mevProtection:emergencyPause', {
      cancelledTransactions: this.protectedTransactions.size
    });
  }
}