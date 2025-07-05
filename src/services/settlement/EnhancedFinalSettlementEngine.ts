import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { db, TransactionClient } from '../../database/config';
import { SettlementRepository } from '../../database/repositories/SettlementRepository';
import { UserBalanceRepository } from '../../database/repositories/UserBalanceRepository';
import { TradeRepository } from '../../database/repositories/TradeRepository';
import { CrossChainSettlementService } from './CrossChainSettlementService';
import { BridgeMonitoringService } from './BridgeMonitoringService';
import { logger } from '../../utils/logger';

export interface CrossChainTrade {
  id: string;
  userId: string;
  sourceChainId: number;
  targetChainId: number;
  sourceToken: string;
  targetToken: string;
  amount: string;
  side: 'BUY' | 'SELL';
  pair: string;
}

export interface SettlementConfiguration {
  epochDuration: number;
  batchSize: number;
  crossChainEnabled: boolean;
  supportedChains: number[];
  maxBridgeAmount: string;
  bridgeSlippage: number;
}

export class EnhancedFinalSettlementEngine extends EventEmitter {
  private settlementRepo: SettlementRepository;
  private balanceRepo: UserBalanceRepository;
  private tradeRepo: TradeRepository;
  private crossChainService: CrossChainSettlementService;
  private bridgeMonitoring: BridgeMonitoringService;
  
  private config: SettlementConfiguration;
  private isProcessing: boolean = false;
  private epochTimer: NodeJS.Timeout | null = null;
  private pendingCrossChainSettlements: Map<string, string[]> = new Map(); // epochId -> settlementIds
  
  constructor(config: Partial<SettlementConfiguration> = {}) {
    super();
    
    this.config = {
      epochDuration: 3600000, // 1 hour
      batchSize: 1000,
      crossChainEnabled: true,
      supportedChains: [1, 137, 42161, 10, 56], // ETH, Polygon, Arbitrum, Optimism, BSC
      maxBridgeAmount: '100000', // $100k max per bridge
      bridgeSlippage: 0.5, // 0.5% slippage
      ...config,
    };
    
    this.settlementRepo = new SettlementRepository();
    this.balanceRepo = new UserBalanceRepository();
    this.tradeRepo = new TradeRepository();
    this.crossChainService = new CrossChainSettlementService();
    this.bridgeMonitoring = new BridgeMonitoringService();
  }

  async initialize(): Promise<void> {
    try {
      // Initialize database
      await db.connect();
      
      // Initialize cross-chain services
      if (this.config.crossChainEnabled) {
        await this.crossChainService.initialize();
        await this.bridgeMonitoring.initialize(8081); // WebSocket port for monitoring
        
        // Listen to bridge events
        this.setupBridgeEventListeners();
      }
      
      // Start epoch timer
      await this.startEpochTimer();
      
      logger.info('EnhancedFinalSettlementEngine initialized', {
        epochDuration: this.config.epochDuration,
        crossChainEnabled: this.config.crossChainEnabled,
        supportedChains: this.config.supportedChains,
      });
    } catch (error) {
      logger.error('Failed to initialize EnhancedFinalSettlementEngine', error);
      throw error;
    }
  }

  private setupBridgeEventListeners(): void {
    // Listen to cross-chain service events
    this.crossChainService.on('quoteReceived', ({ settlementId, quote }) => {
      logger.info('Cross-chain quote received', { settlementId, toAmount: quote.toAmount });
    });
    
    this.crossChainService.on('executionStarted', ({ settlementId, transactionHash }) => {
      logger.info('Cross-chain execution started', { settlementId, transactionHash });
      // Start monitoring
      this.bridgeMonitoring.startMonitoring(
        settlementId,
        transactionHash,
        0, // Will be fetched from settlement
        0,
        { source: 'settlement_engine' }
      );
    });
    
    // Listen to monitoring events
    this.bridgeMonitoring.on('bridgeCompleted', async ({ settlementId, targetTransactionHash }) => {
      logger.info('Bridge completed', { settlementId, targetTransactionHash });
      await this.handleCrossChainCompletion(settlementId);
    });
    
    this.bridgeMonitoring.on('bridgeFailed', async ({ settlementId, error }) => {
      logger.error('Bridge failed', { settlementId, error });
      await this.handleCrossChainFailure(settlementId, error);
    });
    
    this.bridgeMonitoring.on('bridgeStuck', async ({ settlementId }) => {
      logger.warn('Bridge stuck', { settlementId });
      // Could implement recovery mechanisms here
    });
  }

  private async startEpochTimer(): Promise<void> {
    const latestEpoch = await this.settlementRepo.getLatestEpoch();
    
    if (!latestEpoch || latestEpoch.status === 'SETTLED' || latestEpoch.status === 'FAILED') {
      await this.startNewEpoch();
    } else if (latestEpoch.status === 'PENDING' && new Date() > latestEpoch.endTime) {
      await this.processSettlementEpoch(latestEpoch.id);
    }

    this.epochTimer = setInterval(async () => {
      try {
        await this.checkAndProcessEpochs();
      } catch (error) {
        logger.error('Error in epoch timer', error);
      }
    }, 60000); // Check every minute
  }

  private async checkAndProcessEpochs(): Promise<void> {
    if (this.isProcessing) return;

    const latestEpoch = await this.settlementRepo.getLatestEpoch();
    
    if (!latestEpoch) {
      await this.startNewEpoch();
      return;
    }

    if (latestEpoch.status === 'PENDING' && new Date() > latestEpoch.endTime) {
      await this.processSettlementEpoch(latestEpoch.id);
      await this.startNewEpoch();
    }
  }

  private async startNewEpoch(): Promise<void> {
    const latestEpoch = await this.settlementRepo.getLatestEpoch();
    const epochNumber = latestEpoch ? latestEpoch.epochNumber + 1 : 1;
    
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + this.config.epochDuration);
    
    const newEpoch = await this.settlementRepo.createSettlementEpoch(
      epochNumber,
      startTime,
      endTime
    );
    
    logger.info('Started new settlement epoch', {
      epochId: newEpoch.id,
      epochNumber: newEpoch.epochNumber,
    });
    
    this.emit('epochStarted', newEpoch);
  }

  async processSettlementEpoch(epochId: string): Promise<any> {
    if (this.isProcessing) {
      throw new Error('Settlement processing already in progress');
    }

    this.isProcessing = true;
    
    try {
      logger.info('Starting settlement processing', { epochId });
      
      const epoch = await this.settlementRepo.updateEpochStatus(
        epochId,
        'PROCESSING',
        { processingStartedAt: new Date() }
      );
      
      if (!epoch) {
        throw new Error(`Epoch ${epochId} not found`);
      }

      // Get trades for settlement
      const trades = await this.settlementRepo.getTradesForSettlement(
        epoch.startTime,
        epoch.endTime,
        this.config.batchSize * 10
      );
      
      // Separate cross-chain and same-chain trades
      const { crossChainTrades, sameChainTrades } = this.categorizeTrades(trades);
      
      logger.info('Trade categorization', {
        total: trades.length,
        crossChain: crossChainTrades.length,
        sameChain: sameChainTrades.length,
      });

      // Process same-chain settlements first
      const sameChainResult = await this.processSameChainSettlements(
        epochId,
        sameChainTrades
      );
      
      // Process cross-chain settlements
      let crossChainResult = null;
      if (this.config.crossChainEnabled && crossChainTrades.length > 0) {
        crossChainResult = await this.processCrossChainSettlements(
          epochId,
          crossChainTrades
        );
      }
      
      // Update epoch status
      await this.settlementRepo.updateEpochStatus(
        epochId,
        'SETTLED',
        {
          totalTrades: trades.length,
          settledTrades: sameChainResult.settledCount + (crossChainResult?.initiated || 0),
          failedTrades: sameChainResult.failedCount,
          processingCompletedAt: new Date(),
        }
      );
      
      const result = {
        epochId,
        sameChainResult,
        crossChainResult,
        totalTrades: trades.length,
      };
      
      logger.info('Settlement processing completed', result);
      this.emit('settlementCompleted', result);
      
      return result;
    } catch (error) {
      logger.error('Settlement processing failed', { epochId, error });
      
      await this.settlementRepo.updateEpochStatus(
        epochId,
        'FAILED',
        {
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          processingCompletedAt: new Date(),
        }
      );
      
      this.emit('settlementFailed', { epochId, error });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private categorizeTrades(trades: any[]): {
    crossChainTrades: CrossChainTrade[];
    sameChainTrades: any[];
  } {
    const crossChainTrades: CrossChainTrade[] = [];
    const sameChainTrades: any[] = [];
    
    for (const trade of trades) {
      // Parse chain info from trade metadata or pair
      // This is a simplified example - in production, you'd have proper chain mapping
      const tradeChainInfo = this.extractChainInfo(trade);
      
      if (tradeChainInfo.isCrossChain) {
        crossChainTrades.push({
          id: trade.id,
          userId: trade.takerSide === 'BUY' ? trade.takerUserId : trade.makerUserId,
          sourceChainId: tradeChainInfo.sourceChainId,
          targetChainId: tradeChainInfo.targetChainId,
          sourceToken: tradeChainInfo.sourceToken,
          targetToken: tradeChainInfo.targetToken,
          amount: trade.quantity.toString(),
          side: trade.takerSide,
          pair: trade.pair,
        });
      } else {
        sameChainTrades.push(trade);
      }
    }
    
    return { crossChainTrades, sameChainTrades };
  }

  private extractChainInfo(trade: any): {
    isCrossChain: boolean;
    sourceChainId: number;
    targetChainId: number;
    sourceToken: string;
    targetToken: string;
  } {
    // Check if trade has cross-chain metadata
    if (trade.metadata?.crossChain) {
      return {
        isCrossChain: true,
        sourceChainId: trade.metadata.sourceChainId,
        targetChainId: trade.metadata.targetChainId,
        sourceToken: trade.metadata.sourceToken,
        targetToken: trade.metadata.targetToken,
      };
    }
    
    // Check if pair indicates cross-chain (e.g., "ETH.mainnet/USDC.polygon")
    const pairMatch = trade.pair.match(/^(.+)\.(\w+)\/(.+)\.(\w+)$/);
    if (pairMatch) {
      const [, baseToken, baseChain, quoteToken, quoteChain] = pairMatch;
      const chainMap: { [key: string]: number } = {
        'mainnet': 1,
        'ethereum': 1,
        'polygon': 137,
        'arbitrum': 42161,
        'optimism': 10,
        'bsc': 56,
      };
      
      const sourceChainId = chainMap[baseChain.toLowerCase()];
      const targetChainId = chainMap[quoteChain.toLowerCase()];
      
      if (sourceChainId && targetChainId && sourceChainId !== targetChainId) {
        return {
          isCrossChain: true,
          sourceChainId,
          targetChainId,
          sourceToken: baseToken,
          targetToken: quoteToken,
        };
      }
    }
    
    // Default to same-chain
    return {
      isCrossChain: false,
      sourceChainId: 1, // Default to mainnet
      targetChainId: 1,
      sourceToken: '',
      targetToken: '',
    };
  }

  private async processSameChainSettlements(
    epochId: string,
    trades: any[]
  ): Promise<{ settledCount: number; failedCount: number }> {
    // Calculate net positions
    const netPositions = this.calculateNetPositions(trades);
    
    // Process in transaction
    return await db.transaction(async (client: TransactionClient) => {
      const settlementDetails = this.createSettlementDetails(epochId, netPositions, trades);
      await this.settlementRepo.createSettlementDetails(settlementDetails, client);
      
      let settledCount = 0;
      let failedCount = 0;
      
      for (const position of netPositions) {
        try {
          await this.processUserSettlement(position, epochId, client);
          settledCount++;
        } catch (error) {
          logger.error('Failed to settle user position', { 
            userId: position.userId, 
            currency: position.currency, 
            error 
          });
          failedCount++;
        }
      }
      
      // Mark trades as settled
      const tradeIds = trades.map(t => t.id);
      await this.settlementRepo.markTradesAsSettled(tradeIds, epochId, client);
      
      return { settledCount, failedCount };
    });
  }

  private async processCrossChainSettlements(
    epochId: string,
    trades: CrossChainTrade[]
  ): Promise<{ initiated: number; failed: number }> {
    // Group trades by user and chain pair
    const groupedTrades = this.groupCrossChainTrades(trades);
    const crossChainSettlementIds: string[] = [];
    
    let initiated = 0;
    let failed = 0;
    
    for (const group of groupedTrades) {
      try {
        // Check if amount exceeds max bridge amount
        const amount = parseFloat(group.totalAmount);
        const maxAmount = parseFloat(this.config.maxBridgeAmount);
        
        if (amount > maxAmount) {
          logger.warn('Cross-chain amount exceeds maximum', {
            userId: group.userId,
            amount: group.totalAmount,
            maxAmount: this.config.maxBridgeAmount,
          });
          
          // Could split into multiple bridges or handle differently
          failed++;
          continue;
        }
        
        // Request cross-chain settlement
        const settlement = await this.crossChainService.requestCrossChainSettlement(
          epochId,
          group.userId,
          group.sourceChainId,
          group.targetChainId,
          group.sourceToken,
          group.targetToken,
          group.totalAmount,
          this.config.bridgeSlippage
        );
        
        // Execute the bridge
        await this.crossChainService.executeCrossChainSettlement(settlement.id);
        
        crossChainSettlementIds.push(settlement.id);
        initiated++;
        
        // Mark trades as pending cross-chain settlement
        await this.markTradesAsPendingCrossChain(group.tradeIds, settlement.id);
        
      } catch (error) {
        logger.error('Failed to initiate cross-chain settlement', {
          userId: group.userId,
          error,
        });
        failed++;
      }
    }
    
    // Store cross-chain settlement IDs for this epoch
    this.pendingCrossChainSettlements.set(epochId, crossChainSettlementIds);
    
    return { initiated, failed };
  }

  private groupCrossChainTrades(trades: CrossChainTrade[]): Array<{
    userId: string;
    sourceChainId: number;
    targetChainId: number;
    sourceToken: string;
    targetToken: string;
    totalAmount: string;
    tradeIds: string[];
  }> {
    const groups = new Map<string, any>();
    
    for (const trade of trades) {
      const key = `${trade.userId}:${trade.sourceChainId}:${trade.targetChainId}:${trade.sourceToken}:${trade.targetToken}`;
      
      if (!groups.has(key)) {
        groups.set(key, {
          userId: trade.userId,
          sourceChainId: trade.sourceChainId,
          targetChainId: trade.targetChainId,
          sourceToken: trade.sourceToken,
          targetToken: trade.targetToken,
          totalAmount: '0',
          tradeIds: [],
        });
      }
      
      const group = groups.get(key);
      group.totalAmount = (parseFloat(group.totalAmount) + parseFloat(trade.amount)).toString();
      group.tradeIds.push(trade.id);
    }
    
    return Array.from(groups.values());
  }

  private calculateNetPositions(trades: any[]): any[] {
    const positions = new Map<string, any>();
    
    for (const trade of trades) {
      const [baseCurrency, quoteCurrency] = trade.pair.split('/');
      const baseAmount = trade.quantity;
      const quoteAmount = trade.price * trade.quantity;
      
      // Process taker
      if (trade.takerSide === 'BUY') {
        this.updatePosition(positions, trade.takerUserId, baseCurrency, baseAmount - trade.takerFee);
        this.updatePosition(positions, trade.takerUserId, quoteCurrency, -quoteAmount);
        
        this.updatePosition(positions, trade.makerUserId, quoteCurrency, quoteAmount - trade.makerFee);
        this.updatePosition(positions, trade.makerUserId, baseCurrency, -baseAmount);
      } else {
        this.updatePosition(positions, trade.takerUserId, quoteCurrency, quoteAmount - trade.takerFee);
        this.updatePosition(positions, trade.takerUserId, baseCurrency, -baseAmount);
        
        this.updatePosition(positions, trade.makerUserId, baseCurrency, baseAmount - trade.makerFee);
        this.updatePosition(positions, trade.makerUserId, quoteCurrency, -quoteAmount);
      }
    }
    
    return Array.from(positions.values()).filter(pos => Math.abs(pos.netAmount) > 0.00000001);
  }

  private updatePosition(positions: Map<string, any>, userId: string, currency: string, amount: number): void {
    const key = `${userId}:${currency}`;
    const existing = positions.get(key);
    
    if (existing) {
      existing.netAmount += amount;
      existing.tradeCount++;
    } else {
      positions.set(key, {
        userId,
        currency,
        netAmount: amount,
        tradeCount: 1,
      });
    }
  }

  private createSettlementDetails(epochId: string, netPositions: any[], trades: any[]): any[] {
    return netPositions.map(position => ({
      settlementEpochId: epochId,
      tradeId: `NET_${position.userId}_${position.currency}`,
      userId: position.userId,
      currency: position.currency,
      amount: position.netAmount,
    }));
  }

  private async processUserSettlement(
    position: any,
    epochId: string,
    client: TransactionClient
  ): Promise<void> {
    const currentBalance = await this.balanceRepo.getBalance(position.userId, position.currency);
    const balanceBefore = currentBalance?.availableBalance || 0;
    
    await this.balanceRepo.updateBalance(
      position.userId,
      position.currency,
      position.netAmount,
      0,
      `Settlement epoch ${epochId}`,
      client
    );
    
    await this.settlementRepo.updateSettlementDetail(
      epochId,
      `NET_${position.userId}_${position.currency}`,
      position.userId,
      position.currency,
      {
        balanceBefore,
        balanceAfter: balanceBefore + position.netAmount,
        status: 'SETTLED',
        processedAt: new Date(),
      },
      client
    );
  }

  private async markTradesAsPendingCrossChain(
    tradeIds: string[],
    crossChainSettlementId: string
  ): Promise<void> {
    const query = `
      UPDATE trades
      SET 
        settlement_status = 'pending',
        metadata = jsonb_set(
          COALESCE(metadata, '{}'), 
          '{crossChainSettlementId}', 
          $2::jsonb
        )
      WHERE id = ANY($1)
    `;
    
    await db.query(query, [tradeIds, JSON.stringify(crossChainSettlementId)]);
  }

  private async handleCrossChainCompletion(settlementId: string): Promise<void> {
    // Update trades as settled
    const query = `
      UPDATE trades
      SET settlement_status = 'settled'
      WHERE metadata->>'crossChainSettlementId' = $1
    `;
    
    await db.query(query, [settlementId]);
    
    this.emit('crossChainSettlementCompleted', { settlementId });
  }

  private async handleCrossChainFailure(settlementId: string, error: string): Promise<void> {
    // Update trades as failed
    const query = `
      UPDATE trades
      SET 
        settlement_status = 'failed',
        metadata = jsonb_set(
          metadata, 
          '{settlementError}', 
          $2::jsonb
        )
      WHERE metadata->>'crossChainSettlementId' = $1
    `;
    
    await db.query(query, [settlementId, JSON.stringify(error)]);
    
    this.emit('crossChainSettlementFailed', { settlementId, error });
  }

  async getSettlementStatus(epochId: string): Promise<any> {
    const epoch = await this.settlementRepo.getSettlementEpochById(epochId);
    const stats = await this.settlementRepo.getEpochStats(epochId);
    const crossChainSettlements = this.pendingCrossChainSettlements.get(epochId) || [];
    
    return {
      epoch,
      stats,
      crossChainSettlements,
      monitoringMetrics: this.bridgeMonitoring.getMetrics(),
    };
  }

  async shutdown(): Promise<void> {
    if (this.epochTimer) {
      clearInterval(this.epochTimer);
    }
    
    await this.crossChainService.shutdown();
    await this.bridgeMonitoring.shutdown();
    
    this.removeAllListeners();
    logger.info('EnhancedFinalSettlementEngine shut down');
  }
}