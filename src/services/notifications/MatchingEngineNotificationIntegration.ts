import { EventEmitter } from 'events';
import { createLogger } from '../../utils/production-logger';
import { NotificationService } from './NotificationService';
import { MatchingEngine } from '../matchingEngine/MatchingEngine';
import { Order, OrderStatus, Trade, ExecutionReport } from '../matchingEngine/types';

const logger = createLogger('MatchingEngineNotificationIntegration');

export class MatchingEngineNotificationIntegration {
  private notificationService: NotificationService;
  private matchingEngine: MatchingEngine;
  private isInitialized: boolean = false;
  
  constructor(matchingEngine: MatchingEngine) {
    this.notificationService = NotificationService.getInstance();
    this.matchingEngine = matchingEngine;
  }
  
  /**
   * Initialize notification integration
   */
  initialize(): void {
    if (this.isInitialized) {
      logger.warn('MatchingEngine notification integration already initialized');
      return;
    }
    
    // Listen to order events
    this.matchingEngine.on('orderFilled', this.handleOrderFilled.bind(this));
    this.matchingEngine.on('orderPartiallyFilled', this.handleOrderPartiallyFilled.bind(this));
    this.matchingEngine.on('orderCancelled', this.handleOrderCancelled.bind(this));
    this.matchingEngine.on('orderFailed', this.handleOrderFailed.bind(this));
    this.matchingEngine.on('executionReport', this.handleExecutionReport.bind(this));
    
    // Listen to trade events
    this.matchingEngine.on('tradeExecuted', this.handleTradeExecuted.bind(this));
    
    this.isInitialized = true;
    logger.info('MatchingEngine notification integration initialized');
  }
  
  /**
   * Shutdown notification integration
   */
  shutdown(): void {
    if (!this.isInitialized) return;
    
    // Remove all listeners
    this.matchingEngine.removeAllListeners('orderFilled');
    this.matchingEngine.removeAllListeners('orderPartiallyFilled');
    this.matchingEngine.removeAllListeners('orderCancelled');
    this.matchingEngine.removeAllListeners('orderFailed');
    this.matchingEngine.removeAllListeners('executionReport');
    this.matchingEngine.removeAllListeners('tradeExecuted');
    
    this.isInitialized = false;
    logger.info('MatchingEngine notification integration shut down');
  }
  
  /**
   * Handle order filled event
   */
  private async handleOrderFilled(order: Order): Promise<void> {
    try {
      await this.notificationService.notifyOrderFilled(
        order.userId,
        order.id,
        order.pair,
        order.quantity.toString(),
        order.price.toString(),
        order.side
      );
      
      logger.debug('Order filled notification sent', {
        orderId: order.id,
        userId: order.userId,
      });
    } catch (error) {
      logger.error('Failed to send order filled notification', error, {
        orderId: order.id,
        userId: order.userId,
      });
    }
  }
  
  /**
   * Handle order partially filled event
   */
  private async handleOrderPartiallyFilled(order: Order): Promise<void> {
    try {
      await this.notificationService.notifyOrderPartiallyFilled(
        order.userId,
        order.id,
        order.pair,
        order.filledQuantity.toString(),
        order.quantity.toString(),
        order.price.toString(),
        order.side
      );
      
      logger.debug('Order partially filled notification sent', {
        orderId: order.id,
        userId: order.userId,
      });
    } catch (error) {
      logger.error('Failed to send order partially filled notification', error, {
        orderId: order.id,
        userId: order.userId,
      });
    }
  }
  
  /**
   * Handle order cancelled event
   */
  private async handleOrderCancelled(order: Order): Promise<void> {
    try {
      await this.notificationService.notifyOrderCancelled(
        order.userId,
        order.id,
        order.pair,
        order.metadata?.cancelReason as string | undefined
      );
      
      logger.debug('Order cancelled notification sent', {
        orderId: order.id,
        userId: order.userId,
      });
    } catch (error) {
      logger.error('Failed to send order cancelled notification', error, {
        orderId: order.id,
        userId: order.userId,
      });
    }
  }
  
  /**
   * Handle order failed event
   */
  private async handleOrderFailed(order: Order & { failureReason?: string }): Promise<void> {
    try {
      await this.notificationService.notifyOrderFailed(
        order.userId,
        order.id,
        order.pair,
        order.failureReason || 'Unknown error'
      );
      
      logger.debug('Order failed notification sent', {
        orderId: order.id,
        userId: order.userId,
      });
    } catch (error) {
      logger.error('Failed to send order failed notification', error, {
        orderId: order.id,
        userId: order.userId,
      });
    }
  }
  
  /**
   * Handle execution report event
   */
  private async handleExecutionReport(report: ExecutionReport): Promise<void> {
    // Check if this is a partial fill that wasn't already handled
    if (report.status === OrderStatus.PARTIALLY_FILLED && 
        report.filledQuantity > 0 && 
        report.filledQuantity < report.quantity) {
      
      // Get the order to find userId
      const order = (this.matchingEngine as any).orders?.get(report.orderId);
      if (!order) {
        logger.warn('Order not found for execution report', {
          orderId: report.orderId,
        });
        return;
      }
      
      try {
        await this.notificationService.notifyOrderPartiallyFilled(
          order.userId,
          report.orderId,
          report.pair,
          report.filledQuantity.toString(),
          report.quantity.toString(),
          report.averagePrice.toString(),
          report.side
        );
      } catch (error) {
        logger.error('Failed to send partial fill notification from execution report', error, {
          orderId: report.orderId,
        });
      }
    }
  }
  
  /**
   * Handle trade executed event
   */
  private async handleTradeExecuted(trade: Trade): Promise<void> {
    try {
      // Get orders involved in the trade
      const takerOrder = (this.matchingEngine as any).orders?.get(trade.takerOrderId);
      const makerOrder = (this.matchingEngine as any).orders?.get(trade.makerOrderId);
      
      if (!takerOrder || !makerOrder) {
        logger.warn('Orders not found for trade', {
          tradeId: trade.id,
          takerOrderId: trade.takerOrderId,
          makerOrderId: trade.makerOrderId,
        });
        return;
      }
      
      // Notify both parties
      await Promise.all([
        this.notificationService.notifyTradeExecuted(
          takerOrder.userId,
          trade.id,
          trade.pair,
          trade.quantity.toString(),
          trade.price.toString(),
          trade.takerSide
        ),
        this.notificationService.notifyTradeExecuted(
          makerOrder.userId,
          trade.id,
          trade.pair,
          trade.quantity.toString(),
          trade.price.toString(),
          trade.makerSide
        ),
      ]);
      
      logger.debug('Trade executed notifications sent', {
        tradeId: trade.id,
        takerUserId: takerOrder.userId,
        makerUserId: makerOrder.userId,
      });
    } catch (error) {
      logger.error('Failed to send trade executed notification', error, {
        tradeId: trade.id,
      });
    }
  }
  
  /**
   * Send batch notifications for multiple orders
   */
  async sendBatchOrderNotifications(
    orders: Order[],
    notificationType: 'filled' | 'cancelled' | 'failed',
    reason?: string
  ): Promise<void> {
    const notifications = await Promise.allSettled(
      orders.map(async (order) => {
        switch (notificationType) {
          case 'filled':
            return this.handleOrderFilled(order);
          case 'cancelled':
            return this.handleOrderCancelled(order);
          case 'failed':
            return this.handleOrderFailed({ ...order, failureReason: reason });
          default:
            throw new Error(`Unknown notification type: ${notificationType}`);
        }
      })
    );
    
    const failures = notifications.filter(n => n.status === 'rejected').length;
    if (failures > 0) {
      logger.warn(`${failures} batch notifications failed`, {
        total: orders.length,
        notificationType,
      });
    }
  }
}