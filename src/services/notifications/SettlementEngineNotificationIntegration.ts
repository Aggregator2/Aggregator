import { EventEmitter } from 'events';
import { createLogger } from '../../utils/production-logger';
import { NotificationService } from './NotificationService';
import { SettlementEngine } from '../settlement/SettlementEngine';
import { FinalSettlementEngine } from '../settlement/FinalSettlementEngine';
import { Settlement, SettlementStatus, SettlementEvent } from '../settlement/types';

const logger = createLogger('SettlementEngineNotificationIntegration');

export class SettlementEngineNotificationIntegration {
  private notificationService: NotificationService;
  private settlementEngine?: SettlementEngine | FinalSettlementEngine;
  private isInitialized: boolean = false;
  
  constructor(settlementEngine?: SettlementEngine | FinalSettlementEngine) {
    this.notificationService = NotificationService.getInstance();
    this.settlementEngine = settlementEngine;
  }
  
  /**
   * Initialize notification integration
   */
  initialize(settlementEngine?: SettlementEngine | FinalSettlementEngine): void {
    if (this.isInitialized) {
      logger.warn('SettlementEngine notification integration already initialized');
      return;
    }
    
    if (settlementEngine) {
      this.settlementEngine = settlementEngine;
    }
    
    if (!this.settlementEngine) {
      throw new Error('SettlementEngine instance required for initialization');
    }
    
    // Listen to settlement events
    this.settlementEngine.on('settlementEvent', this.handleSettlementEvent.bind(this));
    this.settlementEngine.on('settlementInitiated', this.handleSettlementInitiated.bind(this));
    this.settlementEngine.on('settlementCompleted', this.handleSettlementCompleted.bind(this));
    this.settlementEngine.on('settlementFailed', this.handleSettlementFailed.bind(this));
    this.settlementEngine.on('verificationFailed', this.handleVerificationFailed.bind(this));
    this.settlementEngine.on('verificationSucceeded', this.handleVerificationSucceeded.bind(this));
    this.settlementEngine.on('reconciliationStarted', this.handleReconciliationStarted.bind(this));
    
    // FinalSettlementEngine specific events
    if (settlementEngine instanceof FinalSettlementEngine) {
      this.settlementEngine.on('epochStarted', this.handleEpochStarted.bind(this));
      this.settlementEngine.on('epochCompleted', this.handleEpochCompleted.bind(this));
      this.settlementEngine.on('bundleExecuted', this.handleBundleExecuted.bind(this));
      this.settlementEngine.on('recoveryScheduled', this.handleRecoveryScheduled.bind(this));
    }
    
    this.isInitialized = true;
    logger.info('SettlementEngine notification integration initialized');
  }
  
  /**
   * Shutdown notification integration
   */
  shutdown(): void {
    if (!this.isInitialized || !this.settlementEngine) return;
    
    // Remove all listeners
    this.settlementEngine.removeAllListeners('settlementEvent');
    this.settlementEngine.removeAllListeners('settlementInitiated');
    this.settlementEngine.removeAllListeners('settlementCompleted');
    this.settlementEngine.removeAllListeners('settlementFailed');
    this.settlementEngine.removeAllListeners('verificationFailed');
    this.settlementEngine.removeAllListeners('verificationSucceeded');
    this.settlementEngine.removeAllListeners('reconciliationStarted');
    
    if (this.settlementEngine instanceof FinalSettlementEngine) {
      this.settlementEngine.removeAllListeners('epochStarted');
      this.settlementEngine.removeAllListeners('epochCompleted');
      this.settlementEngine.removeAllListeners('bundleExecuted');
      this.settlementEngine.removeAllListeners('recoveryScheduled');
    }
    
    this.isInitialized = false;
    logger.info('SettlementEngine notification integration shut down');
  }
  
  /**
   * Handle generic settlement event
   */
  private async handleSettlementEvent(event: SettlementEvent): Promise<void> {
    try {
      // Handle specific event types that might not have dedicated handlers
      switch (event.type) {
        case 'NETTING_COMPLETED':
          await this.handleNettingCompleted(event);
          break;
        case 'CLEARING_STARTED':
          await this.handleClearingStarted(event);
          break;
        default:
          logger.debug('Unhandled settlement event type', { type: event.type });
      }
    } catch (error) {
      logger.error('Failed to handle settlement event', error, { type: event.type });
    }
  }
  
  /**
   * Handle settlement initiated
   */
  private async handleSettlementInitiated(data: {
    settlementId: string;
    userId?: string;
    amount?: string;
    trades?: number;
    estimatedTime?: string;
  }): Promise<void> {
    try {
      if (data.userId) {
        await this.notificationService.notifySettlementInitiated(
          data.userId,
          data.settlementId,
          data.amount || 'Multiple assets',
          data.estimatedTime
        );
      }
      
      logger.debug('Settlement initiated notification sent', {
        settlementId: data.settlementId,
        userId: data.userId,
      });
    } catch (error) {
      logger.error('Failed to send settlement initiated notification', error, data);
    }
  }
  
  /**
   * Handle settlement completed
   */
  private async handleSettlementCompleted(data: {
    settlementId: string;
    userId?: string;
    amount?: string;
    txHash?: string;
    settlements?: Settlement[];
  }): Promise<void> {
    try {
      // Handle batch settlements
      if (data.settlements) {
        const userSettlements = this.groupSettlementsByUser(data.settlements);
        
        await Promise.all(
          Array.from(userSettlements.entries()).map(async ([userId, settlements]) => {
            const totalAmount = this.calculateTotalAmount(settlements);
            await this.notificationService.notifySettlementCompleted(
              userId,
              data.settlementId,
              totalAmount,
              data.txHash || '0x...'
            );
          })
        );
      } else if (data.userId) {
        // Single user settlement
        await this.notificationService.notifySettlementCompleted(
          data.userId,
          data.settlementId,
          data.amount || 'Settlement',
          data.txHash || '0x...'
        );
      }
      
      logger.debug('Settlement completed notification sent', {
        settlementId: data.settlementId,
        userCount: data.settlements?.length || 1,
      });
    } catch (error) {
      logger.error('Failed to send settlement completed notification', error, data);
    }
  }
  
  /**
   * Handle settlement failed
   */
  private async handleSettlementFailed(data: {
    settlementId: string;
    userId?: string;
    amount?: string;
    error?: string;
    bundleId?: string;
  }): Promise<void> {
    try {
      const reason = data.error || 'Settlement processing failed';
      
      if (data.userId) {
        await this.notificationService.notifySettlementFailed(
          data.userId,
          data.settlementId,
          data.amount || 'Settlement',
          reason
        );
      }
      
      logger.debug('Settlement failed notification sent', {
        settlementId: data.settlementId,
        userId: data.userId,
        reason,
      });
    } catch (error) {
      logger.error('Failed to send settlement failed notification', error, data);
    }
  }
  
  /**
   * Handle verification failed
   */
  private async handleVerificationFailed(data: {
    epochId: string;
    discrepancies: Array<{
      userId: string;
      token: string;
      expected: bigint;
      actual: bigint;
    }>;
  }): Promise<void> {
    try {
      // Notify affected users about verification issues
      const affectedUsers = new Set(data.discrepancies.map(d => d.userId));
      
      await Promise.all(
        Array.from(affectedUsers).map(userId =>
          this.notificationService.notifySettlementFailed(
            userId,
            data.epochId,
            'Settlement verification',
            'Balance verification failed. Support team has been notified.'
          )
        )
      );
      
      logger.warn('Verification failed notifications sent', {
        epochId: data.epochId,
        affectedUsers: affectedUsers.size,
      });
    } catch (error) {
      logger.error('Failed to send verification failed notifications', error, data);
    }
  }
  
  /**
   * Handle verification succeeded
   */
  private async handleVerificationSucceeded(data: {
    epochId: string;
  }): Promise<void> {
    logger.info('Settlement verification succeeded', { epochId: data.epochId });
    // Typically no user notification needed for successful verification
  }
  
  /**
   * Handle reconciliation started
   */
  private async handleReconciliationStarted(data: {
    epochId: string;
    discrepancyCount: number;
  }): Promise<void> {
    logger.info('Settlement reconciliation started', data);
    // Admin notification handled by monitoring system
  }
  
  /**
   * Handle netting completed
   */
  private async handleNettingCompleted(event: SettlementEvent): Promise<void> {
    logger.debug('Netting completed', { data: event.data });
    // No user notification needed for internal netting process
  }
  
  /**
   * Handle clearing started
   */
  private async handleClearingStarted(event: SettlementEvent): Promise<void> {
    logger.debug('Clearing started', { data: event.data });
    // No user notification needed for internal clearing process
  }
  
  /**
   * Handle epoch started (FinalSettlementEngine)
   */
  private async handleEpochStarted(data: {
    epochId: string;
    epochNumber: number;
    startTime: number;
  }): Promise<void> {
    logger.info('Settlement epoch started', data);
    // No user notification needed for epoch start
  }
  
  /**
   * Handle epoch completed (FinalSettlementEngine)
   */
  private async handleEpochCompleted(data: {
    epochId: string;
    epochNumber: number;
    settlements?: number;
    status: string;
  }): Promise<void> {
    logger.info('Settlement epoch completed', data);
    // Notifications for individual settlements handled separately
  }
  
  /**
   * Handle bundle executed (FinalSettlementEngine)
   */
  private async handleBundleExecuted(data: {
    bundleId: string;
    transactionHash: string;
    instructionCount: number;
    gasUsed?: bigint;
  }): Promise<void> {
    logger.info('Settlement bundle executed on-chain', {
      bundleId: data.bundleId,
      txHash: data.transactionHash,
      instructions: data.instructionCount,
    });
    // Transaction-level notifications handled at settlement level
  }
  
  /**
   * Handle recovery scheduled (FinalSettlementEngine)
   */
  private async handleRecoveryScheduled(data: {
    originalBundleId: string;
    instructionCount: number;
    nextEpochId: string;
  }): Promise<void> {
    logger.warn('Settlement recovery scheduled', data);
    // Users notified through settlement failed notifications
  }
  
  /**
   * Group settlements by user
   */
  private groupSettlementsByUser(settlements: Settlement[]): Map<string, Settlement[]> {
    const userSettlements = new Map<string, Settlement[]>();
    
    for (const settlement of settlements) {
      // Extract user IDs from trades
      const userIds = new Set<string>();
      for (const trade of settlement.trades) {
        userIds.add(trade.buyerId);
        userIds.add(trade.sellerId);
      }
      
      // Add settlement to each user's list
      for (const userId of userIds) {
        if (!userSettlements.has(userId)) {
          userSettlements.set(userId, []);
        }
        userSettlements.get(userId)!.push(settlement);
      }
    }
    
    return userSettlements;
  }
  
  /**
   * Calculate total amount from settlements
   */
  private calculateTotalAmount(settlements: Settlement[]): string {
    // Simplified calculation - in real implementation would aggregate by token
    let totalTrades = 0;
    for (const settlement of settlements) {
      totalTrades += settlement.trades.length;
    }
    return `${totalTrades} trades`;
  }
}