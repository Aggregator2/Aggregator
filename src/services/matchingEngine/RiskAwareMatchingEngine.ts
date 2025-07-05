import { EnhancedMatchingEngine } from './EnhancedMatchingEngine';
import { RiskManagementService, RiskCheckResult } from '../riskManagement/RiskManagementService';
import { 
  Order, 
  OrderType, 
  OrderStatus, 
  ExecutionReport, 
  MatchingEngineConfig,
  Trade 
} from './types';

export interface RiskAwareMatchingEngineConfig extends MatchingEngineConfig {
  riskCheckEnabled: boolean;
  blockOnRejection: boolean;
  allowReviewOrders: boolean;
  riskCheckTimeout?: number; // milliseconds
}

export class RiskAwareMatchingEngine extends EnhancedMatchingEngine {
  private riskService: RiskManagementService;
  private riskConfig: RiskAwareMatchingEngineConfig;
  private pendingReviewOrders: Map<string, Order> = new Map();
  private rejectedOrdersLog: Map<string, any> = new Map();

  constructor(
    config: RiskAwareMatchingEngineConfig,
    riskService: RiskManagementService
  ) {
    super(config);
    this.riskConfig = config;
    this.riskService = riskService;
    
    this.setupRiskEventHandlers();
  }

  private setupRiskEventHandlers(): void {
    // Listen to risk alerts
    this.riskService.on('riskAlert', (alert) => {
      this.emit('riskAlert', alert);
    });

    // Listen to user blacklist events
    this.riskService.on('userBlacklisted', (data) => {
      this.handleUserBlacklisted(data.userId);
    });

    // Listen to trade events to update risk service
    this.on('trade', (data) => {
      this.riskService.addTradeToHistory(data.trade);
    });
  }

  // Override submitOrder to add risk checks
  async submitOrder(orderRequest: Partial<Order>): Promise<ExecutionReport> {
    // First validate the order normally
    try {
      this.validateOrder(orderRequest);
    } catch (error) {
      // Return immediate rejection for basic validation failures
      const order: Order = {
        id: this.generateOrderId(),
        userId: orderRequest.userId!,
        pair: orderRequest.pair!,
        side: orderRequest.side!,
        type: orderRequest.type!,
        price: orderRequest.price || 0,
        quantity: orderRequest.quantity!,
        filledQuantity: 0,
        status: OrderStatus.CANCELLED,
        timeInForce: orderRequest.timeInForce || 'GTC',
        timestamp: Date.now(),
        lastUpdateTime: Date.now(),
        clientOrderId: orderRequest.clientOrderId,
        metadata: orderRequest.metadata
      };

      const report = this.generateExecutionReport(order, []);
      report.message = error.message;
      
      this.emit('orderRejected', { order, reason: error.message });
      this.emit('executionReport', report);
      
      return report;
    }

    // Create order object
    const order: Order = {
      id: this.generateOrderId(),
      userId: orderRequest.userId!,
      pair: orderRequest.pair!,
      side: orderRequest.side!,
      type: orderRequest.type!,
      price: orderRequest.price || 0,
      quantity: orderRequest.quantity!,
      filledQuantity: 0,
      status: OrderStatus.PENDING,
      timeInForce: orderRequest.timeInForce || 'GTC',
      timestamp: Date.now(),
      lastUpdateTime: Date.now(),
      clientOrderId: orderRequest.clientOrderId,
      metadata: orderRequest.metadata
    };

    // Perform risk checks if enabled
    if (this.riskConfig.riskCheckEnabled) {
      try {
        const riskCheckResult = await this.performRiskCheck(order);
        
        if (riskCheckResult.result === RiskCheckResult.REJECTED) {
          // Order rejected by risk management
          order.status = OrderStatus.CANCELLED;
          order.metadata = {
            ...order.metadata,
            rejectionReason: 'RISK_CHECK_FAILED',
            riskErrors: riskCheckResult.errors
          };
          
          const report = this.generateExecutionReport(order, []);
          report.message = this.formatRiskRejectionMessage(riskCheckResult.errors);
          
          // Log rejected order
          this.rejectedOrdersLog.set(order.id, {
            order,
            riskCheckResult,
            timestamp: Date.now()
          });
          
          // Store order but don't process it
          this.orders.set(order.id, order);
          
          this.emit('orderRejected', { 
            order, 
            reason: 'Risk check failed',
            riskErrors: riskCheckResult.errors
          });
          this.emit('executionReport', report);
          
          return report;
        } else if (riskCheckResult.result === RiskCheckResult.REQUIRES_REVIEW) {
          // Order requires manual review
          if (this.riskConfig.allowReviewOrders) {
            order.status = OrderStatus.PENDING;
            order.metadata = {
              ...order.metadata,
              requiresReview: true,
              riskWarnings: riskCheckResult.warnings
            };
            
            this.pendingReviewOrders.set(order.id, order);
            this.orders.set(order.id, order);
            
            const report = this.generateExecutionReport(order, []);
            report.message = 'Order pending risk review';
            
            this.emit('orderPendingReview', {
              order,
              riskWarnings: riskCheckResult.warnings
            });
            this.emit('executionReport', report);
            
            return report;
          } else {
            // Treat as rejection if review not allowed
            order.status = OrderStatus.CANCELLED;
            order.metadata = {
              ...order.metadata,
              rejectionReason: 'REQUIRES_REVIEW',
              riskWarnings: riskCheckResult.warnings
            };
            
            const report = this.generateExecutionReport(order, []);
            report.message = 'Order requires review but review is disabled';
            
            this.orders.set(order.id, order);
            
            this.emit('orderRejected', { 
              order, 
              reason: 'Requires review',
              riskWarnings: riskCheckResult.warnings
            });
            this.emit('executionReport', report);
            
            return report;
          }
        }
        
        // Risk check passed - add risk metrics to order metadata
        order.metadata = {
          ...order.metadata,
          riskMetrics: riskCheckResult.metrics,
          riskWarnings: riskCheckResult.warnings
        };
        
      } catch (error) {
        // Risk check error - decide based on configuration
        if (this.riskConfig.blockOnRejection) {
          order.status = OrderStatus.CANCELLED;
          order.metadata = {
            ...order.metadata,
            rejectionReason: 'RISK_CHECK_ERROR',
            error: error.message
          };
          
          const report = this.generateExecutionReport(order, []);
          report.message = `Risk check error: ${error.message}`;
          
          this.orders.set(order.id, order);
          
          this.emit('orderRejected', { 
            order, 
            reason: 'Risk check error',
            error: error.message
          });
          this.emit('executionReport', report);
          
          return report;
        } else {
          // Log error but continue processing
          console.error('Risk check error (non-blocking):', error);
          order.metadata = {
            ...order.metadata,
            riskCheckError: error.message
          };
        }
      }
    }

    // Process order normally using parent class method
    return super.submitOrder(order);
  }

  // Perform risk check with timeout
  private async performRiskCheck(order: Order): Promise<any> {
    const timeout = this.riskConfig.riskCheckTimeout || 5000; // 5 seconds default
    
    return Promise.race([
      this.riskService.validateOrder(order),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Risk check timeout')), timeout)
      )
    ]);
  }

  // Format risk rejection message for user
  private formatRiskRejectionMessage(errors: any[]): string {
    if (errors.length === 0) return 'Order rejected by risk management';
    
    // Group errors by type
    const errorMessages = errors.map(e => {
      switch (e.code) {
        case 'USER_BLACKLISTED':
          return 'Your account is restricted from trading';
        case 'ORDER_TOO_SMALL':
          return `Order size is below minimum (${e.details.minSize})`;
        case 'ORDER_TOO_LARGE':
          return `Order size exceeds maximum (${e.details.maxSize})`;
        case 'ORDER_VALUE_TOO_HIGH':
          return `Order value exceeds maximum (${e.details.maxValue})`;
        case 'MAX_POSITIONS_EXCEEDED':
          return `Maximum open positions reached (${e.details.maxPositions})`;
        case 'MAX_NOTIONAL_EXCEEDED':
          return `Total exposure would exceed limit`;
        case 'CONCENTRATION_LIMIT_EXCEEDED':
          return `Position concentration too high for ${e.details.symbol}`;
        case 'WASH_TRADING_DETECTED':
          return 'Trading pattern violates market rules';
        case 'DAILY_VOLUME_EXCEEDED':
          return 'Daily trading volume limit reached';
        case 'DAILY_TRADE_COUNT_EXCEEDED':
          return 'Daily trade count limit reached';
        case 'DAILY_LOSS_LIMIT_EXCEEDED':
          return 'Daily loss limit reached';
        default:
          return e.message || 'Order rejected by risk management';
      }
    });
    
    // Return first few error messages
    return errorMessages.slice(0, 3).join('; ');
  }

  // Approve a pending review order
  async approveReviewOrder(orderId: string, approverId: string): Promise<ExecutionReport> {
    const order = this.pendingReviewOrders.get(orderId);
    if (!order) {
      throw new Error('Order not found in pending review');
    }
    
    // Remove from pending
    this.pendingReviewOrders.delete(orderId);
    
    // Update metadata
    order.metadata = {
      ...order.metadata,
      requiresReview: false,
      approvedBy: approverId,
      approvedAt: Date.now()
    };
    
    // Process the order
    this.emit('orderReviewApproved', { order, approverId });
    
    // Process order normally
    return super.submitOrder(order);
  }

  // Reject a pending review order
  async rejectReviewOrder(orderId: string, rejectorId: string, reason: string): Promise<ExecutionReport> {
    const order = this.pendingReviewOrders.get(orderId);
    if (!order) {
      throw new Error('Order not found in pending review');
    }
    
    // Remove from pending
    this.pendingReviewOrders.delete(orderId);
    
    // Update order
    order.status = OrderStatus.CANCELLED;
    order.metadata = {
      ...order.metadata,
      requiresReview: false,
      rejectedBy: rejectorId,
      rejectedAt: Date.now(),
      rejectionReason: reason
    };
    
    const report = this.generateExecutionReport(order, []);
    report.message = `Order rejected after review: ${reason}`;
    
    this.emit('orderReviewRejected', { order, rejectorId, reason });
    this.emit('executionReport', report);
    
    return report;
  }

  // Handle user blacklisting
  private handleUserBlacklisted(userId: string): void {
    // Cancel all open orders for the user
    const userOrders = this.getOrders(userId).filter(
      o => o.status === OrderStatus.OPEN || o.status === OrderStatus.PARTIALLY_FILLED
    );
    
    for (const order of userOrders) {
      this.cancelOrder(order.id).catch(error => {
        console.error(`Failed to cancel order ${order.id} for blacklisted user:`, error);
      });
    }
    
    this.emit('userOrdersCancelled', { userId, orderCount: userOrders.length });
  }

  // Get risk profile for a user
  async getUserRiskProfile(userId: string): Promise<any> {
    return this.riskService.getUserRiskProfile(userId);
  }

  // Update user risk limits
  async updateUserRiskLimits(userId: string, limits: any): Promise<void> {
    this.riskService.setUserLimits(userId, limits);
  }

  // Get pending review orders
  getPendingReviewOrders(): Order[] {
    return Array.from(this.pendingReviewOrders.values());
  }

  // Get rejected orders log
  getRejectedOrders(userId?: string, limit: number = 100): any[] {
    const rejected = Array.from(this.rejectedOrdersLog.values());
    
    if (userId) {
      return rejected
        .filter(r => r.order.userId === userId)
        .slice(-limit);
    }
    
    return rejected.slice(-limit);
  }

  // Override to ensure we generate proper order IDs
  private generateOrderId(): string {
    return `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get risk service instance (for external access)
  getRiskService(): RiskManagementService {
    return this.riskService;
  }
}