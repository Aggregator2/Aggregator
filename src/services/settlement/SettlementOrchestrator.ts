import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { MatchingEngine } from '../matchingEngine/MatchingEngine';
import { FinalSettlementEngine } from './FinalSettlementEngine';
import { Trade } from '../matchingEngine/types';
import { Trade as SettlementTrade } from './types';
import axios from 'axios';

export interface WebhookConfig {
  url: string;
  secret: string;
  retryAttempts: number;
  retryDelay: number;
}

export interface UserWebhook {
  userId: string;
  webhookUrl: string;
  secret: string;
  active: boolean;
}

export interface SettlementNotification {
  epochId: string;
  userId: string;
  settlements: Array<{
    token: string;
    netAmount: string;
    status: string;
  }>;
  timestamp: number;
  transactionHash?: string;
}

export interface OrchestratorConfig {
  provider: ethers.Provider;
  privateKey: string;
  settlementContractAddress: string;
  epochDuration: number; // in milliseconds
  webhookConfig?: WebhookConfig;
  enableAutoSettlement: boolean;
}

export class SettlementOrchestrator extends EventEmitter {
  private matchingEngine: MatchingEngine;
  private settlementEngine: FinalSettlementEngine;
  private userWebhooks: Map<string, UserWebhook> = new Map();
  private config: OrchestratorConfig;
  private isRunning: boolean = false;
  private tradeQueue: Trade[] = [];
  private processedTrades: Set<string> = new Set();

  constructor(
    matchingEngine: MatchingEngine,
    config: OrchestratorConfig
  ) {
    super();
    
    this.matchingEngine = matchingEngine;
    this.config = config;
    
    // Initialize settlement engine with configuration
    this.settlementEngine = new FinalSettlementEngine(
      config.provider,
      config.privateKey,
      config.settlementContractAddress,
      config.epochDuration
    );
    
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen to matching engine trade events
    this.matchingEngine.on('trade', this.handleNewTrade.bind(this));
    
    // Listen to settlement engine events
    this.settlementEngine.on('epochStarted', this.handleEpochStarted.bind(this));
    this.settlementEngine.on('epochFinalized', this.handleEpochFinalized.bind(this));
    this.settlementEngine.on('settlementConfirmed', this.handleSettlementConfirmed.bind(this));
    this.settlementEngine.on('verificationSucceeded', this.handleVerificationSucceeded.bind(this));
    this.settlementEngine.on('verificationFailed', this.handleVerificationFailed.bind(this));
  }

  // Start the orchestrator
  public start(): void {
    if (this.isRunning) {
      console.log('Settlement orchestrator is already running');
      return;
    }
    
    this.isRunning = true;
    
    // Process any queued trades
    this.processQueuedTrades();
    
    this.emit('orchestratorStarted', {
      epochDuration: this.config.epochDuration,
      contractAddress: this.config.settlementContractAddress,
      autoSettlement: this.config.enableAutoSettlement
    });
    
    console.log('Settlement orchestrator started');
  }

  // Stop the orchestrator
  public stop(): void {
    this.isRunning = false;
    this.emit('orchestratorStopped');
    console.log('Settlement orchestrator stopped');
  }

  // Handle new trade from matching engine
  private handleNewTrade(trade: Trade): void {
    if (!this.isRunning) {
      this.tradeQueue.push(trade);
      return;
    }
    
    // Check if trade was already processed
    if (this.processedTrades.has(trade.id)) {
      console.warn(`Trade ${trade.id} already processed`);
      return;
    }
    
    try {
      // Convert matching engine trade to settlement trade format
      const settlementTrade = this.convertToSettlementTrade(trade);
      
      // Add to current epoch
      this.settlementEngine.addTrade(settlementTrade);
      
      // Mark as processed
      this.processedTrades.add(trade.id);
      
      // Clean up old processed trades (keep last 10,000)
      if (this.processedTrades.size > 10000) {
        const trades = Array.from(this.processedTrades);
        this.processedTrades = new Set(trades.slice(-5000));
      }
      
      this.emit('tradeQueued', {
        tradeId: trade.id,
        epochId: this.settlementEngine.getCurrentEpoch()?.id
      });
      
    } catch (error) {
      console.error('Error processing trade:', error);
      this.emit('tradeProcessingError', { trade, error });
    }
  }

  // Convert matching engine trade to settlement trade format
  private convertToSettlementTrade(matchingTrade: Trade): SettlementTrade {
    // Parse the pair to get base and quote assets
    const [baseAsset, quoteAsset] = matchingTrade.pair.split('/');
    
    // Determine buyer and seller based on taker side
    const buyerId = matchingTrade.takerSide === 'BUY' 
      ? this.getOrderUserId(matchingTrade.takerOrderId)
      : this.getOrderUserId(matchingTrade.makerOrderId);
      
    const sellerId = matchingTrade.takerSide === 'SELL'
      ? this.getOrderUserId(matchingTrade.takerOrderId)
      : this.getOrderUserId(matchingTrade.makerOrderId);
    
    return {
      id: matchingTrade.id,
      buyerId,
      sellerId,
      baseAsset,
      quoteAsset,
      price: BigInt(Math.floor(matchingTrade.price * 1e18)), // Convert to 18 decimals
      baseQuantity: BigInt(Math.floor(matchingTrade.quantity * 1e18)),
      quoteQuantity: BigInt(Math.floor(matchingTrade.price * matchingTrade.quantity * 1e18)),
      buyerFee: BigInt(Math.floor(
        matchingTrade.takerSide === 'BUY' ? matchingTrade.takerFee * 1e18 : matchingTrade.makerFee * 1e18
      )),
      sellerFee: BigInt(Math.floor(
        matchingTrade.takerSide === 'SELL' ? matchingTrade.takerFee * 1e18 : matchingTrade.makerFee * 1e18
      )),
      timestamp: matchingTrade.timestamp,
      blockNumber: 0, // Will be set when confirmed on-chain
      transactionHash: '', // Will be set when confirmed
      status: 'PENDING'
    };
  }

  // Get user ID from order (would need to be implemented based on your order tracking)
  private getOrderUserId(orderId: string): string {
    // This would typically look up the order to get the user ID
    // For now, we'll extract from order ID if it contains user info
    // or you'd need to query the matching engine
    const order = this.matchingEngine.getOrder(orderId);
    return order?.userId || 'unknown';
  }

  // Process queued trades when orchestrator starts
  private processQueuedTrades(): void {
    while (this.tradeQueue.length > 0 && this.isRunning) {
      const trade = this.tradeQueue.shift()!;
      this.handleNewTrade(trade);
    }
  }

  // Handle epoch started event
  private handleEpochStarted(epoch: any): void {
    console.log(`New epoch started: ${epoch.id}`);
    
    this.emit('epochStarted', {
      epochId: epoch.id,
      epochNumber: epoch.epochNumber,
      startTime: epoch.startTime,
      endTime: epoch.endTime
    });
  }

  // Handle epoch finalized event
  private async handleEpochFinalized(epoch: any): Promise<void> {
    console.log(`Epoch finalized: ${epoch.id}`);
    
    this.emit('epochFinalized', {
      epochId: epoch.id,
      tradesCount: epoch.trades.length,
      status: epoch.status
    });
    
    // Send webhook notifications for the epoch
    if (epoch.settlementBatch && epoch.status === 'COMPLETED') {
      await this.sendEpochNotifications(epoch);
    }
  }

  // Handle settlement confirmed event
  private handleSettlementConfirmed(data: any): void {
    console.log(`Settlement confirmed: ${data.settlementId}`);
    
    this.emit('settlementConfirmed', data);
  }

  // Handle verification succeeded
  private async handleVerificationSucceeded(data: any): Promise<void> {
    console.log(`Verification succeeded for epoch: ${data.epochId}`);
    
    // Get epoch data
    const epoch = this.settlementEngine.getEpoch(data.epochId);
    if (!epoch || !epoch.settlementBatch) return;
    
    // Send success notifications
    await this.sendSettlementNotifications(epoch, 'SUCCESS');
  }

  // Handle verification failed
  private async handleVerificationFailed(data: any): Promise<void> {
    console.error(`Verification failed for epoch: ${data.epochId}`, data.discrepancies);
    
    // Get epoch data
    const epoch = this.settlementEngine.getEpoch(data.epochId);
    if (!epoch) return;
    
    // Send failure notifications
    await this.sendSettlementNotifications(epoch, 'FAILED');
    
    this.emit('verificationFailed', data);
  }

  // Send notifications for an epoch
  private async sendEpochNotifications(epoch: any): Promise<void> {
    if (!epoch.settlementBatch) return;
    
    const notifications: SettlementNotification[] = [];
    
    // Create notifications for each user
    for (const [userId, positions] of epoch.settlementBatch.netPositions) {
      const settlements = Array.from(positions.entries()).map(([token, amount]) => ({
        token,
        netAmount: amount.toString(),
        status: epoch.status
      }));
      
      if (settlements.length > 0) {
        notifications.push({
          epochId: epoch.id,
          userId,
          settlements,
          timestamp: Date.now(),
          transactionHash: epoch.transactionBundles?.[0]?.transactionHash
        });
      }
    }
    
    // Send notifications
    await this.sendNotifications(notifications);
  }

  // Send settlement notifications
  private async sendSettlementNotifications(epoch: any, status: 'SUCCESS' | 'FAILED'): Promise<void> {
    const notifications: SettlementNotification[] = [];
    
    if (!epoch.settlementBatch) return;
    
    for (const settlement of epoch.settlementBatch.settlements) {
      const userPositions = epoch.settlementBatch.netPositions.get(settlement.trades[0]?.buyerId || '');
      
      if (userPositions) {
        const settlements = Array.from(userPositions.entries()).map(([token, amount]) => ({
          token,
          netAmount: amount.toString(),
          status
        }));
        
        notifications.push({
          epochId: epoch.id,
          userId: settlement.trades[0]?.buyerId || '',
          settlements,
          timestamp: Date.now(),
          transactionHash: epoch.transactionBundles?.[0]?.transactionHash
        });
      }
    }
    
    await this.sendNotifications(notifications);
  }

  // Send webhook notifications
  private async sendNotifications(notifications: SettlementNotification[]): Promise<void> {
    const promises = notifications.map(notification => 
      this.sendWebhookNotification(notification)
    );
    
    await Promise.allSettled(promises);
  }

  // Send individual webhook notification
  private async sendWebhookNotification(notification: SettlementNotification): Promise<void> {
    const webhook = this.userWebhooks.get(notification.userId);
    
    if (!webhook || !webhook.active) {
      return;
    }
    
    const payload = {
      type: 'SETTLEMENT_NOTIFICATION',
      data: notification,
      timestamp: Date.now()
    };
    
    // Sign payload
    const signature = this.signWebhookPayload(payload, webhook.secret);
    
    let attempts = 0;
    const maxAttempts = this.config.webhookConfig?.retryAttempts || 3;
    const retryDelay = this.config.webhookConfig?.retryDelay || 1000;
    
    while (attempts < maxAttempts) {
      try {
        const response = await axios.post(webhook.webhookUrl, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': signature,
            'X-Timestamp': Date.now().toString()
          },
          timeout: 5000
        });
        
        if (response.status === 200) {
          this.emit('webhookDelivered', {
            userId: notification.userId,
            epochId: notification.epochId
          });
          return;
        }
      } catch (error) {
        attempts++;
        
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempts));
        } else {
          this.emit('webhookFailed', {
            userId: notification.userId,
            epochId: notification.epochId,
            error: error.message
          });
          
          // Disable webhook after repeated failures
          if (attempts >= 5) {
            webhook.active = false;
          }
        }
      }
    }
  }

  // Sign webhook payload
  private signWebhookPayload(payload: any, secret: string): string {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  // Register user webhook
  public registerWebhook(userId: string, webhookUrl: string, secret?: string): void {
    const webhookSecret = secret || this.generateWebhookSecret();
    
    this.userWebhooks.set(userId, {
      userId,
      webhookUrl,
      secret: webhookSecret,
      active: true
    });
    
    this.emit('webhookRegistered', { userId, webhookUrl });
  }

  // Unregister user webhook
  public unregisterWebhook(userId: string): void {
    this.userWebhooks.delete(userId);
    this.emit('webhookUnregistered', { userId });
  }

  // Generate webhook secret
  private generateWebhookSecret(): string {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }

  // Get orchestrator status
  public getStatus(): any {
    const currentEpoch = this.settlementEngine.getCurrentEpoch();
    const pendingBundles = this.settlementEngine.getPendingBundles();
    
    return {
      isRunning: this.isRunning,
      currentEpoch: currentEpoch ? {
        id: currentEpoch.id,
        epochNumber: currentEpoch.epochNumber,
        status: currentEpoch.status,
        tradesCount: currentEpoch.trades.length,
        startTime: currentEpoch.startTime,
        endTime: currentEpoch.endTime
      } : null,
      queuedTrades: this.tradeQueue.length,
      processedTrades: this.processedTrades.size,
      pendingBundles: pendingBundles.length,
      activeWebhooks: Array.from(this.userWebhooks.values()).filter(w => w.active).length,
      config: {
        epochDuration: this.config.epochDuration,
        settlementContract: this.config.settlementContractAddress,
        autoSettlement: this.config.enableAutoSettlement
      }
    };
  }

  // Get epoch history
  public getEpochHistory(limit: number = 10): any[] {
    const epochs: any[] = [];
    let currentEpoch = this.settlementEngine.getCurrentEpoch();
    
    if (currentEpoch) {
      epochs.push({
        id: currentEpoch.id,
        epochNumber: currentEpoch.epochNumber,
        status: currentEpoch.status,
        tradesCount: currentEpoch.trades.length,
        startTime: currentEpoch.startTime,
        endTime: currentEpoch.endTime,
        finalizedAt: currentEpoch.finalizedAt
      });
    }
    
    // Would need to implement epoch history storage in FinalSettlementEngine
    // For now, return current epoch only
    
    return epochs;
  }

  // Manual epoch finalization (for testing or emergency)
  public async finalizeCurrentEpoch(): Promise<void> {
    if (!this.config.enableAutoSettlement) {
      throw new Error('Auto settlement is disabled');
    }
    
    // This would trigger immediate finalization of current epoch
    // Implementation would need to be added to FinalSettlementEngine
    this.emit('manualFinalization', {
      epochId: this.settlementEngine.getCurrentEpoch()?.id
    });
  }
}