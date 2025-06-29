import { EventEmitter } from 'events';
import { Order, OrderStatus, TimeInForce } from '../matchingEngine/types';
import { OrderBookDatabase } from './OrderBookDatabase';
import { OrderBookDatabaseConfig } from './config';

interface ExpirationTask {
  orderId: string;
  expiresAt: number;
  pair: string;
  userId: string;
}

export class OrderExpirationManager extends EventEmitter {
  private database: OrderBookDatabase;
  private config: OrderBookDatabaseConfig;
  private expirationQueue: Map<string, ExpirationTask>;
  private checkInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;
  private stats: {
    expired: number;
    checked: number;
    errors: number;
  };

  constructor(database: OrderBookDatabase, config: OrderBookDatabaseConfig) {
    super();
    this.database = database;
    this.config = config;
    this.expirationQueue = new Map();
    this.stats = {
      expired: 0,
      checked: 0,
      errors: 0
    };
  }

  // Start expiration manager
  start(): void {
    if (this.isRunning || !this.config.orderExpiration.enabled) return;
    
    this.isRunning = true;
    
    // Start periodic check
    this.checkInterval = setInterval(() => {
      this.checkExpiredOrders();
    }, this.config.orderExpiration.checkInterval);
    
    this.emit('started');
    console.log('Order expiration manager started');
  }

  // Stop expiration manager
  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    
    this.emit('stopped');
    console.log('Order expiration manager stopped');
  }

  // Add order to expiration queue
  addOrder(order: Order): void {
    if (!this.config.orderExpiration.enabled) return;
    
    // Skip if order is already filled or cancelled
    if (order.status === OrderStatus.FILLED || order.status === OrderStatus.CANCELLED) {
      return;
    }
    
    const expiresAt = this.calculateExpiration(order);
    if (!expiresAt) return;
    
    const task: ExpirationTask = {
      orderId: order.id,
      expiresAt,
      pair: order.pair,
      userId: order.userId
    };
    
    this.expirationQueue.set(order.id, task);
  }

  // Remove order from expiration queue
  removeOrder(orderId: string): void {
    this.expirationQueue.delete(orderId);
  }

  // Calculate order expiration time
  private calculateExpiration(order: Order): number | null {
    // Handle Time in Force
    switch (order.timeInForce) {
      case TimeInForce.IOC:
      case TimeInForce.FOK:
        // These are handled immediately by matching engine
        return null;
        
      case TimeInForce.DAY:
        // Expire at end of trading day
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
        return endOfDay.getTime();
        
      case TimeInForce.GTC:
      default:
        // Use configured TTL
        const ttl = this.config.orderExpiration.customTTL?.[order.pair] || 
                    this.config.orderExpiration.defaultTTL || 86400;
        return order.timestamp + (ttl * 1000);
    }
  }

  // Check and expire orders
  private async checkExpiredOrders(): Promise<void> {
    if (this.expirationQueue.size === 0) return;
    
    const now = Date.now();
    const expiredOrders: ExpirationTask[] = [];
    
    // Find expired orders
    for (const [orderId, task] of this.expirationQueue.entries()) {
      this.stats.checked++;
      
      if (task.expiresAt <= now) {
        expiredOrders.push(task);
        this.expirationQueue.delete(orderId);
      }
    }
    
    // Process expired orders
    for (const task of expiredOrders) {
      try {
        await this.expireOrder(task);
        this.stats.expired++;
      } catch (error) {
        this.stats.errors++;
        console.error(`Failed to expire order ${task.orderId}:`, error);
        this.emit('expiration:error', { orderId: task.orderId, error });
      }
    }
    
    if (expiredOrders.length > 0) {
      this.emit('orders:expired', {
        count: expiredOrders.length,
        orderIds: expiredOrders.map(t => t.orderId)
      });
    }
  }

  // Expire a single order
  private async expireOrder(task: ExpirationTask): Promise<void> {
    // Get current order state
    const order = await this.database.getOrder(task.orderId);
    if (!order) return;
    
    // Check if order is still active
    if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.PARTIALLY_FILLED) {
      return;
    }
    
    // Update order status
    order.status = OrderStatus.EXPIRED;
    order.lastUpdateTime = Date.now();
    
    // Update in database
    await this.database.updateOrder(order);
    
    // Emit event
    this.emit('order:expired', {
      orderId: order.id,
      userId: order.userId,
      pair: order.pair,
      remainingQuantity: order.quantity - order.filledQuantity
    });
  }

  // Bulk expire orders (for maintenance)
  async bulkExpireOrders(orderIds: string[]): Promise<{
    success: number;
    failed: number;
    errors: string[];
  }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    
    for (const orderId of orderIds) {
      try {
        const order = await this.database.getOrder(orderId);
        if (!order) {
          failed++;
          errors.push(`Order ${orderId} not found`);
          continue;
        }
        
        if (order.status === OrderStatus.OPEN || order.status === OrderStatus.PARTIALLY_FILLED) {
          order.status = OrderStatus.EXPIRED;
          order.lastUpdateTime = Date.now();
          await this.database.updateOrder(order);
          success++;
          
          this.emit('order:expired', {
            orderId: order.id,
            userId: order.userId,
            pair: order.pair,
            remainingQuantity: order.quantity - order.filledQuantity
          });
        } else {
          failed++;
          errors.push(`Order ${orderId} is not active (status: ${order.status})`);
        }
      } catch (error) {
        failed++;
        errors.push(`Order ${orderId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return { success, failed, errors };
  }

  // Get expiration queue size
  getQueueSize(): number {
    return this.expirationQueue.size;
  }

  // Get next expiration time
  getNextExpiration(): { orderId: string; expiresAt: Date } | null {
    if (this.expirationQueue.size === 0) return null;
    
    let nextTask: ExpirationTask | null = null;
    
    for (const task of this.expirationQueue.values()) {
      if (!nextTask || task.expiresAt < nextTask.expiresAt) {
        nextTask = task;
      }
    }
    
    return nextTask ? {
      orderId: nextTask.orderId,
      expiresAt: new Date(nextTask.expiresAt)
    } : null;
  }

  // Get statistics
  getStatistics(): typeof this.stats & {
    queueSize: number;
    isRunning: boolean;
    nextExpiration: Date | null;
  } {
    const next = this.getNextExpiration();
    
    return {
      ...this.stats,
      queueSize: this.expirationQueue.size,
      isRunning: this.isRunning,
      nextExpiration: next ? next.expiresAt : null
    };
  }

  // Reset statistics
  resetStatistics(): void {
    this.stats = {
      expired: 0,
      checked: 0,
      errors: 0
    };
  }

  // Export queue data for backup
  exportQueue(): ExpirationTask[] {
    return Array.from(this.expirationQueue.values());
  }

  // Import queue data from backup
  importQueue(tasks: ExpirationTask[]): void {
    this.expirationQueue.clear();
    
    for (const task of tasks) {
      this.expirationQueue.set(task.orderId, task);
    }
  }
}