import { EventEmitter } from 'events';
import { getQuote, getStatus, executeRoute } from '@lifi/sdk';
import { ethers } from 'ethers';
import { db, TransactionClient } from '../../database/config';
import { logger } from '../../utils/logger';

export interface CrossChainSettlement {
  id: string;
  settlementEpochId: string;
  userId: string;
  sourceChainId: number;
  targetChainId: number;
  sourceToken: string;
  targetToken: string;
  sourceAmount: string;
  targetAmount: string;
  targetAmountMin: string;
  status: 'PENDING' | 'QUOTE_RECEIVED' | 'EXECUTING' | 'MONITORING' | 'COMPLETED' | 'FAILED';
  lifiRouteId?: string;
  bridgeTransactionHash?: string;
  sourceTransactionHash?: string;
  targetTransactionHash?: string;
  executionStarted?: Date;
  executionCompleted?: Date;
  errorMessage?: string;
  metadata?: any;
}

export interface BridgeQuote {
  routeId: string;
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  estimatedGas: string;
  estimatedTime: number;
  tool: string;
  toolDetails: any;
}

export interface BridgeMonitoringStatus {
  transactionId: string;
  status: 'PENDING' | 'DONE' | 'FAILED' | 'NOT_FOUND';
  sourceChainStatus?: string;
  targetChainStatus?: string;
  sourceTransactionHash?: string;
  targetTransactionHash?: string;
  substatus?: string;
  errorMessage?: string;
}

export class CrossChainSettlementService extends EventEmitter {
  private wallets: Map<number, ethers.Wallet> = new Map();
  private providers: Map<number, ethers.Provider> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private pendingSettlements: Map<string, CrossChainSettlement> = new Map();

  constructor() {
    super();
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Initialize providers for supported chains
    const chainConfigs = [
      { chainId: 1, rpc: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com' },
      { chainId: 137, rpc: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com' },
      { chainId: 42161, rpc: process.env.ARBITRUM_RPC_URL || 'https://arbitrum.llamarpc.com' },
      { chainId: 10, rpc: process.env.OPTIMISM_RPC_URL || 'https://optimism.llamarpc.com' },
      { chainId: 56, rpc: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com' },
    ];

    for (const config of chainConfigs) {
      const provider = new ethers.JsonRpcProvider(config.rpc);
      this.providers.set(config.chainId, provider);

      // Initialize wallet if private key is available
      const privateKey = process.env.SETTLEMENT_PRIVATE_KEY;
      if (privateKey) {
        const wallet = new ethers.Wallet(privateKey, provider);
        this.wallets.set(config.chainId, wallet);
      }
    }
  }

  async initialize(): Promise<void> {
    // Start monitoring for pending settlements
    this.startMonitoring();
    
    // Load pending settlements from database
    await this.loadPendingSettlements();
    
    logger.info('CrossChainSettlementService initialized', {
      supportedChains: Array.from(this.providers.keys()),
      walletsConfigured: Array.from(this.wallets.keys()),
    });
  }

  async requestCrossChainSettlement(
    settlementEpochId: string,
    userId: string,
    sourceChainId: number,
    targetChainId: number,
    sourceToken: string,
    targetToken: string,
    amount: string,
    slippage: number = 0.5
  ): Promise<CrossChainSettlement> {
    const settlementId = this.generateSettlementId();
    
    try {
      // Create initial settlement record
      const settlement: CrossChainSettlement = {
        id: settlementId,
        settlementEpochId,
        userId,
        sourceChainId,
        targetChainId,
        sourceToken,
        targetToken,
        sourceAmount: amount,
        targetAmount: '0',
        targetAmountMin: '0',
        status: 'PENDING',
      };

      // Save to database
      await this.saveSettlement(settlement);
      
      // Get wallet for source chain
      const wallet = this.wallets.get(sourceChainId);
      if (!wallet) {
        throw new Error(`No wallet configured for chain ${sourceChainId}`);
      }

      // Get quote from LiFi
      const quote = await this.getQuoteFromLiFi(
        sourceChainId,
        targetChainId,
        sourceToken,
        targetToken,
        amount,
        wallet.address,
        slippage
      );

      // Update settlement with quote details
      settlement.lifiRouteId = quote.routeId;
      settlement.targetAmount = quote.toAmount;
      settlement.targetAmountMin = quote.toAmountMin;
      settlement.status = 'QUOTE_RECEIVED';
      settlement.metadata = {
        quote,
        estimatedTime: quote.estimatedTime,
        tool: quote.tool,
      };

      await this.updateSettlement(settlement);
      
      this.emit('quoteReceived', { settlementId, quote });
      
      return settlement;
    } catch (error) {
      logger.error('Failed to request cross-chain settlement', { settlementId, error });
      
      // Update settlement status to failed
      await this.updateSettlement({
        id: settlementId,
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      
      throw error;
    }
  }

  async executeCrossChainSettlement(settlementId: string): Promise<string> {
    const settlement = await this.getSettlement(settlementId);
    if (!settlement) {
      throw new Error(`Settlement ${settlementId} not found`);
    }

    if (settlement.status !== 'QUOTE_RECEIVED') {
      throw new Error(`Settlement ${settlementId} is not ready for execution`);
    }

    const wallet = this.wallets.get(settlement.sourceChainId);
    if (!wallet) {
      throw new Error(`No wallet configured for chain ${settlement.sourceChainId}`);
    }

    try {
      // Update status to executing
      settlement.status = 'EXECUTING';
      settlement.executionStarted = new Date();
      await this.updateSettlement(settlement);

      // Execute the route through LiFi
      const route = settlement.metadata?.quote;
      if (!route) {
        throw new Error('No route found in settlement metadata');
      }

      // Check and approve tokens if needed
      await this.ensureTokenApproval(
        settlement.sourceChainId,
        settlement.sourceToken,
        settlement.sourceAmount,
        wallet
      );

      // Execute the bridge transaction
      const execution = await executeRoute(route, {
        signer: wallet,
        updateCallback: (update: any) => {
          logger.info('Bridge execution update', { settlementId, update });
          this.emit('executionUpdate', { settlementId, update });
        },
      });

      // Get the transaction hash
      const txHash = execution.transactionHash;
      
      // Update settlement with transaction hash
      settlement.bridgeTransactionHash = txHash;
      settlement.sourceTransactionHash = txHash;
      settlement.status = 'MONITORING';
      await this.updateSettlement(settlement);

      // Add to pending settlements for monitoring
      this.pendingSettlements.set(settlementId, settlement);

      this.emit('executionStarted', { settlementId, transactionHash: txHash });

      return txHash;
    } catch (error) {
      logger.error('Failed to execute cross-chain settlement', { settlementId, error });
      
      settlement.status = 'FAILED';
      settlement.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateSettlement(settlement);
      
      throw error;
    }
  }

  private async getQuoteFromLiFi(
    fromChainId: number,
    toChainId: number,
    fromToken: string,
    toToken: string,
    fromAmount: string,
    fromAddress: string,
    slippage: number
  ): Promise<BridgeQuote> {
    const quoteRequest = {
      fromChain: fromChainId.toString(),
      toChain: toChainId.toString(),
      fromToken,
      toToken,
      fromAmount,
      fromAddress,
      toAddress: fromAddress, // Same address on target chain
      slippage: slippage / 100,
      integrator: 'settlement-engine',
      // Prefer fast and reliable bridges
      allowBridges: ['stargate', 'across', 'hop', 'cbridge'],
      denyBridges: [],
    };

    const response = await getQuote(quoteRequest);
    
    if (!response.routes || response.routes.length === 0) {
      throw new Error('No routes available for this cross-chain transfer');
    }

    // Select the best route (first one is usually optimal)
    const route = response.routes[0];
    
    return {
      routeId: route.id,
      fromChainId,
      toChainId,
      fromToken,
      toToken,
      fromAmount,
      toAmount: route.toAmount,
      toAmountMin: route.toAmountMin,
      estimatedGas: route.gasCostUSD || '0',
      estimatedTime: this.calculateEstimatedTime(route),
      tool: route.steps[0]?.tool || 'unknown',
      toolDetails: route,
    };
  }

  private calculateEstimatedTime(route: any): number {
    // Calculate total estimated time from route steps
    let totalTime = 0;
    for (const step of route.steps || []) {
      totalTime += step.estimate?.executionDuration || 300; // Default 5 minutes per step
    }
    return totalTime;
  }

  private async ensureTokenApproval(
    chainId: number,
    tokenAddress: string,
    amount: string,
    wallet: ethers.Wallet
  ): Promise<void> {
    // Skip approval for native tokens
    if (tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      return;
    }

    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function approve(address spender, uint256 amount) returns (bool)'],
      wallet
    );

    // Get LiFi contract address for this chain
    const lifiContractAddress = this.getLiFiContractAddress(chainId);
    
    // Approve max amount for convenience (in production, use exact amount)
    const tx = await tokenContract.approve(lifiContractAddress, ethers.MaxUint256);
    await tx.wait();
    
    logger.info('Token approval completed', { chainId, tokenAddress, txHash: tx.hash });
  }

  private getLiFiContractAddress(chainId: number): string {
    // LiFi Diamond contract addresses
    const addresses: { [key: number]: string } = {
      1: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // Ethereum
      137: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // Polygon
      42161: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // Arbitrum
      10: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // Optimism
      56: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // BSC
    };
    
    return addresses[chainId] || '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
  }

  private startMonitoring(): void {
    // Monitor pending settlements every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      await this.monitorPendingSettlements();
    }, 30000);
  }

  private async monitorPendingSettlements(): Promise<void> {
    const pendingIds = Array.from(this.pendingSettlements.keys());
    
    for (const settlementId of pendingIds) {
      try {
        const settlement = this.pendingSettlements.get(settlementId);
        if (!settlement || !settlement.bridgeTransactionHash) continue;

        const status = await this.checkBridgeStatus(
          settlement.bridgeTransactionHash,
          settlement.sourceChainId,
          settlement.targetChainId
        );

        if (status.status === 'DONE') {
          // Update settlement as completed
          settlement.status = 'COMPLETED';
          settlement.targetTransactionHash = status.targetTransactionHash;
          settlement.executionCompleted = new Date();
          await this.updateSettlement(settlement);
          
          // Remove from pending
          this.pendingSettlements.delete(settlementId);
          
          this.emit('settlementCompleted', {
            settlementId,
            sourceTransactionHash: status.sourceTransactionHash,
            targetTransactionHash: status.targetTransactionHash,
          });
        } else if (status.status === 'FAILED') {
          // Update settlement as failed
          settlement.status = 'FAILED';
          settlement.errorMessage = status.errorMessage || 'Bridge transaction failed';
          await this.updateSettlement(settlement);
          
          // Remove from pending
          this.pendingSettlements.delete(settlementId);
          
          this.emit('settlementFailed', {
            settlementId,
            error: status.errorMessage,
          });
        }
      } catch (error) {
        logger.error('Error monitoring settlement', { settlementId, error });
      }
    }
  }

  async checkBridgeStatus(
    transactionHash: string,
    fromChainId: number,
    toChainId: number
  ): Promise<BridgeMonitoringStatus> {
    try {
      const status = await getStatus({
        transactionHash,
        fromChain: fromChainId,
        toChain: toChainId,
      });

      return {
        transactionId: transactionHash,
        status: status.status as any,
        sourceChainStatus: status.sending?.txStatus,
        targetChainStatus: status.receiving?.txStatus,
        sourceTransactionHash: status.sending?.txHash,
        targetTransactionHash: status.receiving?.txHash,
        substatus: status.substatus,
        errorMessage: status.error,
      };
    } catch (error) {
      logger.error('Error checking bridge status', { transactionHash, error });
      
      return {
        transactionId: transactionHash,
        status: 'NOT_FOUND',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async loadPendingSettlements(): Promise<void> {
    const query = `
      SELECT * FROM cross_chain_settlements
      WHERE status IN ('EXECUTING', 'MONITORING')
      ORDER BY created_at ASC
    `;

    try {
      const results = await db.query<any>(query);
      
      for (const row of results) {
        const settlement = this.mapToSettlement(row);
        this.pendingSettlements.set(settlement.id, settlement);
      }
      
      logger.info(`Loaded ${results.length} pending settlements for monitoring`);
    } catch (error) {
      logger.error('Error loading pending settlements', error);
    }
  }

  private async saveSettlement(settlement: CrossChainSettlement): Promise<void> {
    const query = `
      INSERT INTO cross_chain_settlements (
        id, settlement_epoch_id, user_id, source_chain_id, target_chain_id,
        source_token, target_token, source_amount, target_amount, target_amount_min,
        status, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;

    const params = [
      settlement.id,
      settlement.settlementEpochId,
      settlement.userId,
      settlement.sourceChainId,
      settlement.targetChainId,
      settlement.sourceToken,
      settlement.targetToken,
      settlement.sourceAmount,
      settlement.targetAmount,
      settlement.targetAmountMin,
      settlement.status,
      JSON.stringify(settlement.metadata || {}),
    ];

    await db.query(query, params);
  }

  private async updateSettlement(updates: Partial<CrossChainSettlement>): Promise<void> {
    if (!updates.id) return;

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(updates.status);
    }
    if (updates.lifiRouteId !== undefined) {
      setClauses.push(`lifi_route_id = $${paramIndex++}`);
      params.push(updates.lifiRouteId);
    }
    if (updates.bridgeTransactionHash !== undefined) {
      setClauses.push(`bridge_transaction_hash = $${paramIndex++}`);
      params.push(updates.bridgeTransactionHash);
    }
    if (updates.sourceTransactionHash !== undefined) {
      setClauses.push(`source_transaction_hash = $${paramIndex++}`);
      params.push(updates.sourceTransactionHash);
    }
    if (updates.targetTransactionHash !== undefined) {
      setClauses.push(`target_transaction_hash = $${paramIndex++}`);
      params.push(updates.targetTransactionHash);
    }
    if (updates.targetAmount !== undefined) {
      setClauses.push(`target_amount = $${paramIndex++}`);
      params.push(updates.targetAmount);
    }
    if (updates.targetAmountMin !== undefined) {
      setClauses.push(`target_amount_min = $${paramIndex++}`);
      params.push(updates.targetAmountMin);
    }
    if (updates.executionStarted !== undefined) {
      setClauses.push(`execution_started = $${paramIndex++}`);
      params.push(updates.executionStarted);
    }
    if (updates.executionCompleted !== undefined) {
      setClauses.push(`execution_completed = $${paramIndex++}`);
      params.push(updates.executionCompleted);
    }
    if (updates.errorMessage !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`);
      params.push(updates.errorMessage);
    }
    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(updates.metadata));
    }

    if (setClauses.length === 0) return;

    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(updates.id);

    const query = `
      UPDATE cross_chain_settlements
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `;

    await db.query(query, params);
  }

  private async getSettlement(settlementId: string): Promise<CrossChainSettlement | null> {
    const query = 'SELECT * FROM cross_chain_settlements WHERE id = $1';
    const result = await db.queryOne<any>(query, [settlementId]);
    return result ? this.mapToSettlement(result) : null;
  }

  private mapToSettlement(row: any): CrossChainSettlement {
    return {
      id: row.id,
      settlementEpochId: row.settlement_epoch_id,
      userId: row.user_id,
      sourceChainId: row.source_chain_id,
      targetChainId: row.target_chain_id,
      sourceToken: row.source_token,
      targetToken: row.target_token,
      sourceAmount: row.source_amount,
      targetAmount: row.target_amount || '0',
      targetAmountMin: row.target_amount_min || '0',
      status: row.status,
      lifiRouteId: row.lifi_route_id,
      bridgeTransactionHash: row.bridge_transaction_hash,
      sourceTransactionHash: row.source_transaction_hash,
      targetTransactionHash: row.target_transaction_hash,
      executionStarted: row.execution_started,
      executionCompleted: row.execution_completed,
      errorMessage: row.error_message,
      metadata: row.metadata,
    };
  }

  private generateSettlementId(): string {
    return `CCS_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async shutdown(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.removeAllListeners();
    logger.info('CrossChainSettlementService shut down');
  }
}