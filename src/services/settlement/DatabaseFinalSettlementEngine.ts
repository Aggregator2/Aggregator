import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { db, TransactionClient } from '../../database/config';
import { SettlementRepository } from '../../database/repositories/SettlementRepository';
import { UserBalanceRepository } from '../../database/repositories/UserBalanceRepository';
import { TradeRepository } from '../../database/repositories/TradeRepository';
import { logger } from '../../utils/logger';

export interface NetPosition {
  userId: string;
  currency: string;
  netAmount: number;
  tradeCount: number;
}

export interface SettlementResult {
  epochId: string;
  totalTrades: number;
  settledTrades: number;
  failedTrades: number;
  netPositions: NetPosition[];
  settlementProof?: string;
  completedAt: Date;
}

export class DatabaseFinalSettlementEngine extends EventEmitter {
  private settlementRepo: SettlementRepository;
  private balanceRepo: UserBalanceRepository;
  private tradeRepo: TradeRepository;
  private provider: ethers.Provider | null;
  private wallet: ethers.Wallet | null;
  private settlementContract: ethers.Contract | null = null;
  
  private epochDuration: number;
  private batchSize: number;
  private isProcessing: boolean = false;
  private epochTimer: NodeJS.Timeout | null = null;
  
  constructor(
    epochDuration: number = 3600000, // 1 hour default
    batchSize: number = 1000,
    provider?: ethers.Provider,
    privateKey?: string,
    settlementContractAddress?: string
  ) {
    super();
    
    this.settlementRepo = new SettlementRepository();
    this.balanceRepo = new UserBalanceRepository();
    this.tradeRepo = new TradeRepository();
    this.epochDuration = epochDuration;
    this.batchSize = batchSize;
    
    // Blockchain integration is optional
    if (provider && privateKey) {
      this.provider = provider;
      this.wallet = new ethers.Wallet(privateKey, provider);
      
      if (settlementContractAddress) {
        this.initializeSettlementContract(settlementContractAddress);
      }
    } else {
      this.provider = null;
      this.wallet = null;
    }
  }

  async initialize(): Promise<void> {
    try {
      // Ensure database is connected
      await db.connect();
      
      // Start epoch timer
      await this.startEpochTimer();
      
      logger.info('DatabaseFinalSettlementEngine initialized', {
        epochDuration: this.epochDuration,
        batchSize: this.batchSize,
        blockchainEnabled: !!this.provider,
      });
    } catch (error) {
      logger.error('Failed to initialize DatabaseFinalSettlementEngine', error);
      throw error;
    }
  }

  private initializeSettlementContract(address: string): void {
    if (!this.wallet) return;
    
    const abi = [
      'function batchSettle(address[] calldata users, address[] calldata tokens, int256[] calldata amounts) external',
      'function getSettlementStatus(bytes32 settlementId) external view returns (uint8)',
      'event BatchSettlementExecuted(bytes32 indexed batchId, uint256 settlementCount)',
    ];
    
    this.settlementContract = new ethers.Contract(address, abi, this.wallet);
  }

  private async startEpochTimer(): Promise<void> {
    // Check if there's an active epoch
    const latestEpoch = await this.settlementRepo.getLatestEpoch();
    
    if (!latestEpoch || latestEpoch.status === 'SETTLED' || latestEpoch.status === 'FAILED') {
      // Start new epoch immediately
      await this.startNewEpoch();
    } else if (latestEpoch.status === 'PENDING' && new Date() > latestEpoch.endTime) {
      // Process overdue epoch
      await this.processSettlementEpoch(latestEpoch.id);
    }

    // Set up periodic processing
    this.epochTimer = setInterval(async () => {
      try {
        await this.checkAndProcessEpochs();
      } catch (error) {
        logger.error('Error in epoch timer', error);
      }
    }, 60000); // Check every minute
  }

  private async checkAndProcessEpochs(): Promise<void> {
    if (this.isProcessing) {
      logger.warn('Settlement processing already in progress, skipping');
      return;
    }

    const latestEpoch = await this.settlementRepo.getLatestEpoch();
    
    if (!latestEpoch) {
      await this.startNewEpoch();
      return;
    }

    const now = new Date();
    
    if (latestEpoch.status === 'PENDING' && now > latestEpoch.endTime) {
      // Process completed epoch
      await this.processSettlementEpoch(latestEpoch.id);
      
      // Start new epoch
      await this.startNewEpoch();
    }
  }

  private async startNewEpoch(): Promise<void> {
    try {
      const latestEpoch = await this.settlementRepo.getLatestEpoch();
      const epochNumber = latestEpoch ? latestEpoch.epochNumber + 1 : 1;
      
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + this.epochDuration);
      
      const newEpoch = await this.settlementRepo.createSettlementEpoch(
        epochNumber,
        startTime,
        endTime
      );
      
      logger.info('Started new settlement epoch', {
        epochId: newEpoch.id,
        epochNumber: newEpoch.epochNumber,
        startTime: newEpoch.startTime,
        endTime: newEpoch.endTime,
      });
      
      this.emit('epochStarted', newEpoch);
    } catch (error) {
      logger.error('Error starting new epoch', error);
      throw error;
    }
  }

  async processSettlementEpoch(epochId: string): Promise<SettlementResult> {
    if (this.isProcessing) {
      throw new Error('Settlement processing already in progress');
    }

    this.isProcessing = true;
    
    try {
      logger.info('Starting settlement processing', { epochId });
      
      // Update epoch status
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
        this.batchSize * 10 // Get more trades than batch size
      );
      
      logger.info(`Found ${trades.length} trades for settlement`, { epochId });

      // Calculate net positions
      const netPositions = this.calculateNetPositions(trades);
      
      // Process settlement in transaction
      const result = await db.transaction(async (client: TransactionClient) => {
        // Create settlement details
        const settlementDetails = this.createSettlementDetails(epochId, netPositions, trades);
        await this.settlementRepo.createSettlementDetails(settlementDetails, client);
        
        // Process balance updates in batches
        let settledCount = 0;
        let failedCount = 0;
        const processedTradeIds: string[] = [];
        
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
            
            // Record failure
            await this.settlementRepo.updateSettlementDetail(
              epochId,
              '', // No specific trade ID for net positions
              position.userId,
              position.currency,
              {
                status: 'FAILED',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                processedAt: new Date(),
              },
              client
            );
          }
        }
        
        // Mark trades as settled
        const tradeIds = trades.map(t => t.id);
        const markedCount = await this.settlementRepo.markTradesAsSettled(
          tradeIds,
          epochId,
          client
        );
        
        // Update epoch with results
        const netPositionsMap: { [key: string]: { [currency: string]: number } } = {};
        netPositions.forEach(pos => {
          if (!netPositionsMap[pos.userId]) {
            netPositionsMap[pos.userId] = {};
          }
          netPositionsMap[pos.userId][pos.currency] = pos.netAmount;
        });
        
        await this.settlementRepo.updateEpochStatus(
          epochId,
          'SETTLED',
          {
            totalTrades: trades.length,
            settledTrades: markedCount,
            failedTrades: failedCount,
            totalVolume: trades.reduce((sum, t) => sum + (t.price * t.quantity), 0),
            netPositions: netPositionsMap,
            processingCompletedAt: new Date(),
          },
          client
        );
        
        return {
          epochId,
          totalTrades: trades.length,
          settledTrades: markedCount,
          failedTrades: failedCount,
          netPositions,
          completedAt: new Date(),
        };
      });
      
      // Submit to blockchain if configured
      if (this.settlementContract) {
        try {
          const proof = await this.submitToBlockchain(epochId, netPositions);
          await this.settlementRepo.updateEpochStatus(
            epochId,
            'SETTLED',
            { settlementProof: proof }
          );
          result.settlementProof = proof;
        } catch (error) {
          logger.error('Failed to submit to blockchain', { epochId, error });
          // Don't fail the settlement if blockchain submission fails
        }
      }
      
      logger.info('Settlement processing completed', result);
      this.emit('settlementCompleted', result);
      
      return result;
    } catch (error) {
      logger.error('Settlement processing failed', { epochId, error });
      
      // Update epoch status to failed
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

  private calculateNetPositions(trades: any[]): NetPosition[] {
    const positions = new Map<string, NetPosition>();
    
    for (const trade of trades) {
      const [baseCurrency, quoteCurrency] = trade.pair.split('/');
      const baseAmount = trade.quantity;
      const quoteAmount = trade.price * trade.quantity;
      
      // Process taker
      if (trade.takerSide === 'BUY') {
        // Taker receives base, pays quote
        this.updatePosition(positions, trade.takerUserId, baseCurrency, baseAmount - trade.takerFee);
        this.updatePosition(positions, trade.takerUserId, quoteCurrency, -quoteAmount);
        
        // Maker receives quote, pays base
        this.updatePosition(positions, trade.makerUserId, quoteCurrency, quoteAmount - trade.makerFee);
        this.updatePosition(positions, trade.makerUserId, baseCurrency, -baseAmount);
      } else {
        // Taker receives quote, pays base
        this.updatePosition(positions, trade.takerUserId, quoteCurrency, quoteAmount - trade.takerFee);
        this.updatePosition(positions, trade.takerUserId, baseCurrency, -baseAmount);
        
        // Maker receives base, pays quote
        this.updatePosition(positions, trade.makerUserId, baseCurrency, baseAmount - trade.makerFee);
        this.updatePosition(positions, trade.makerUserId, quoteCurrency, -quoteAmount);
      }
    }
    
    return Array.from(positions.values()).filter(pos => Math.abs(pos.netAmount) > 0.00000001);
  }

  private updatePosition(
    positions: Map<string, NetPosition>,
    userId: string,
    currency: string,
    amount: number
  ): void {
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

  private createSettlementDetails(
    epochId: string,
    netPositions: NetPosition[],
    trades: any[]
  ): Array<{
    settlementEpochId: string;
    tradeId: string;
    userId: string;
    currency: string;
    amount: number;
  }> {
    const details: any[] = [];
    
    // Create a detail for each net position
    // Since we're netting, we don't have individual trade IDs
    for (const position of netPositions) {
      details.push({
        settlementEpochId: epochId,
        tradeId: `NET_${position.userId}_${position.currency}`, // Synthetic ID
        userId: position.userId,
        currency: position.currency,
        amount: position.netAmount,
      });
    }
    
    return details;
  }

  private async processUserSettlement(
    position: NetPosition,
    epochId: string,
    client: TransactionClient
  ): Promise<void> {
    // Get current balance
    const currentBalance = await this.balanceRepo.getBalance(position.userId, position.currency);
    const balanceBefore = currentBalance?.availableBalance || 0;
    
    // Update balance
    await this.balanceRepo.updateBalance(
      position.userId,
      position.currency,
      position.netAmount,
      0,
      `Settlement epoch ${epochId}`,
      client
    );
    
    // Update settlement detail with balance info
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

  private async submitToBlockchain(epochId: string, netPositions: NetPosition[]): Promise<string> {
    if (!this.settlementContract || !this.provider) {
      throw new Error('Blockchain not configured');
    }

    // Group by currency for efficient submission
    const byCurrency = new Map<string, NetPosition[]>();
    for (const pos of netPositions) {
      const existing = byCurrency.get(pos.currency) || [];
      existing.push(pos);
      byCurrency.set(pos.currency, existing);
    }

    // Submit each currency batch
    const txHashes: string[] = [];
    
    for (const [currency, positions] of byCurrency) {
      const users = positions.map(p => p.userId);
      const amounts = positions.map(p => ethers.parseEther(p.netAmount.toString()));
      
      try {
        const tx = await this.settlementContract.batchSettle(
          users,
          Array(users.length).fill(currency), // Token addresses would go here
          amounts
        );
        
        const receipt = await tx.wait();
        txHashes.push(receipt.hash);
        
        logger.info('Blockchain settlement submitted', {
          epochId,
          currency,
          userCount: users.length,
          txHash: receipt.hash,
        });
      } catch (error) {
        logger.error('Blockchain submission failed', { epochId, currency, error });
        throw error;
      }
    }

    // Return combined proof
    return txHashes.join(',');
  }

  async getSettlementStatus(epochId: string): Promise<any> {
    const epoch = await this.settlementRepo.getSettlementEpochById(epochId);
    if (!epoch) {
      throw new Error(`Epoch ${epochId} not found`);
    }

    const stats = await this.settlementRepo.getEpochStats(epochId);
    const details = await this.settlementRepo.getSettlementDetails(epochId);

    return {
      epoch,
      stats,
      details: details.slice(0, 100), // Limit details returned
    };
  }

  async getRecentSettlements(limit: number = 10): Promise<any[]> {
    return await this.settlementRepo.getRecentEpochs(limit);
  }

  async shutdown(): Promise<void> {
    if (this.epochTimer) {
      clearInterval(this.epochTimer);
      this.epochTimer = null;
    }
    
    this.removeAllListeners();
    logger.info('DatabaseFinalSettlementEngine shut down');
  }
}