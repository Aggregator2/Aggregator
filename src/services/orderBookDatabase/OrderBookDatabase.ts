import { EventEmitter } from 'events';
import { RedisOrderBookStore } from './RedisOrderBookStore';
import { PostgresOrderHistoryStore } from './PostgresOrderHistoryStore';
import { OrderBookDatabaseConfig } from './config';
import { Order, Trade, OrderBookSnapshot, ExecutionReport, OrderBookUpdate } from '../matchingEngine/types';

export class OrderBookDatabase extends EventEmitter {
  private redisStore: RedisOrderBookStore;
  private postgresStore: PostgresOrderHistoryStore;
  private config: OrderBookDatabaseConfig;
  private isInitialized: boolean = false;
  private orderQueue: Order[] = [];
  private tradeQueue: Trade[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(config: OrderBookDatabaseConfig) {
    super();
    this.config = config;
    this.redisStore = new RedisOrderBookStore(config);
    this.postgresStore = new PostgresOrderHistoryStore(config);

    this.setupEventHandlers();
    this.startPeriodicFlush();
  }

  private setupEventHandlers(): void {
    // Redis events
    this.redisStore.on('error', (err) => this.emit('redis:error', err));
    this.redisStore.on('connected', () => this.emit('redis:connected'));
    this.redisStore.on('orderbook:update', (channel, update) => {
      this.emit('orderbook:update', channel, update);
    });

    // PostgreSQL events
    this.postgresStore.on('error', (err) => this.emit('postgres:error', err));
    this.postgresStore.on('connected', () => this.emit('postgres:connected'));
  }

  // Initialize database connections and schema
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Initialize PostgreSQL schema
      await this.postgresStore.initializeSchema();
      
      // Start expiration cleanup if enabled
      if (this.config.orderExpiration.enabled) {
        this.startExpirationCleanup();
      }

      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      this.emit('initialization:error', error);
      throw error;
    }
  }

  // Add order to both Redis and PostgreSQL
  async addOrder(order: Order): Promise<void> {
    // Store in Redis for fast access
    await this.redisStore.storeOrder(order);
    
    // Add to order book if OPEN
    if (order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED') {
      await this.redisStore.addToOrderBook(order);
    }
    
    // Queue for PostgreSQL batch insert
    this.queueOrderForPersistence(order);
  }

  // Update order
  async updateOrder(order: Order): Promise<void> {
    const oldOrder = await this.getOrder(order.id);
    
    if (oldOrder) {
      // Remove from order book if necessary
      if ((oldOrder.status === 'OPEN' || oldOrder.status === 'PARTIALLY_FILLED') &&
          (order.status === 'FILLED' || order.status === 'CANCELLED')) {
        await this.redisStore.removeFromOrderBook(oldOrder);
      }
    }
    
    // Update in Redis
    await this.redisStore.storeOrder(order);
    
    // Queue for PostgreSQL update
    this.queueOrderForPersistence(order);
  }

  // Remove order from order book
  async removeOrder(orderId: string): Promise<void> {
    const order = await this.getOrder(orderId);
    if (order && (order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED')) {
      await this.redisStore.removeFromOrderBook(order);
      order.status = 'CANCELLED';
      order.lastUpdateTime = Date.now();
      await this.updateOrder(order);
    }
  }

  // Get order by ID
  async getOrder(orderId: string): Promise<Order | null> {
    const key = `${this.config.redis.keyPrefix}order:${orderId}`;
    const data = await this.redisStore['redis'].hgetall(key);
    
    if (!data || Object.keys(data).length === 0) {
      return null;
    }
    
    return {
      id: data.id,
      userId: data.userId,
      pair: data.pair,
      side: data.side as any,
      type: data.type as any,
      price: parseFloat(data.price),
      quantity: parseFloat(data.quantity),
      filledQuantity: parseFloat(data.filledQuantity),
      status: data.status as any,
      timeInForce: data.timeInForce as any,
      timestamp: parseInt(data.timestamp),
      lastUpdateTime: parseInt(data.lastUpdateTime),
      clientOrderId: data.clientOrderId || undefined,
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined
    };
  }

  // Add trade
  async addTrade(trade: Trade): Promise<void> {
    // Store in Redis for recent trades
    await this.redisStore.storeTrade(trade);
    
    // Queue for PostgreSQL batch insert
    this.queueTradeForPersistence(trade);
  }

  // Get order book snapshot
  async getOrderBookSnapshot(pair: string, depth: number = 50): Promise<OrderBookSnapshot> {
    return await this.redisStore.getOrderBookSnapshot(pair, depth);
  }

  // Get recent trades
  async getRecentTrades(pair: string, limit: number = 100): Promise<Trade[]> {
    return await this.redisStore.getRecentTrades(pair, limit);
  }

  // Get order history from PostgreSQL
  async getOrderHistory(
    userId?: string,
    pair?: string,
    status?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100,
    offset: number = 0
  ): Promise<Order[]> {
    return await this.postgresStore.getOrderHistory(
      userId,
      pair,
      status,
      startDate,
      endDate,
      limit,
      offset
    );
  }

  // Get trade history from PostgreSQL
  async getTradeHistory(
    pair?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100,
    offset: number = 0
  ): Promise<Trade[]> {
    return await this.postgresStore.getTradeHistory(
      pair,
      startDate,
      endDate,
      limit,
      offset
    );
  }

  // Subscribe to order book updates
  async subscribeToOrderBook(pair: string): Promise<void> {
    await this.redisStore.subscribeToOrderBook(pair);
  }

  // Unsubscribe from order book updates
  async unsubscribeFromOrderBook(pair: string): Promise<void> {
    await this.redisStore.unsubscribeFromOrderBook(pair);
  }

  // Save execution report
  async saveExecutionReport(report: ExecutionReport): Promise<void> {
    await this.postgresStore.saveExecutionReport(report);
  }

  // Queue order for batch persistence
  private queueOrderForPersistence(order: Order): void {
    this.orderQueue.push(order);
    
    if (this.orderQueue.length >= this.config.performance.batchSize) {
      this.flushOrderQueue();
    }
  }

  // Queue trade for batch persistence
  private queueTradeForPersistence(trade: Trade): void {
    this.tradeQueue.push(trade);
    
    if (this.tradeQueue.length >= this.config.performance.batchSize) {
      this.flushTradeQueue();
    }
  }

  // Flush order queue to PostgreSQL
  private async flushOrderQueue(): Promise<void> {
    if (this.orderQueue.length === 0) return;
    
    const orders = [...this.orderQueue];
    this.orderQueue = [];
    
    try {
      await this.postgresStore.saveOrdersBatch(orders);
    } catch (error) {
      console.error('Failed to flush order queue:', error);
      // Re-queue failed orders
      this.orderQueue.unshift(...orders);
    }
  }

  // Flush trade queue to PostgreSQL
  private async flushTradeQueue(): Promise<void> {
    if (this.tradeQueue.length === 0) return;
    
    const trades = [...this.tradeQueue];
    this.tradeQueue = [];
    
    try {
      // Save trades individually (can be optimized with batch insert)
      for (const trade of trades) {
        await this.postgresStore.saveTrade(trade);
      }
    } catch (error) {
      console.error('Failed to flush trade queue:', error);
      // Re-queue failed trades
      this.tradeQueue.unshift(...trades);
    }
  }

  // Start periodic flush
  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flushOrderQueue();
      this.flushTradeQueue();
    }, this.config.performance.flushInterval);
  }

  // Start expiration cleanup
  private startExpirationCleanup(): void {
    setInterval(async () => {
      try {
        const redisExpired = await this.redisStore.cleanupExpiredOrders();
        const postgresExpired = await this.postgresStore.cleanupExpiredOrders();
        
        if (redisExpired > 0 || postgresExpired > 0) {
          this.emit('orders:expired', { redis: redisExpired, postgres: postgresExpired });
        }
      } catch (error) {
        console.error('Expiration cleanup failed:', error);
      }
    }, this.config.orderExpiration.checkInterval);
  }

  // Get database statistics
  async getStatistics(): Promise<any> {
    const postgresStats = await this.postgresStore.getStatistics();
    
    return {
      postgres: postgresStats,
      redis: {
        connected: this.redisStore['redis'].status === 'ready'
      },
      queues: {
        orders: this.orderQueue.length,
        trades: this.tradeQueue.length
      }
    };
  }

  // Health check
  async healthCheck(): Promise<{
    redis: boolean;
    postgres: boolean;
    overall: boolean;
  }> {
    try {
      // Check Redis
      const redisPing = await this.redisStore['redis'].ping();
      const redisHealthy = redisPing === 'PONG';
      
      // Check PostgreSQL
      const pgResult = await this.postgresStore['pool'].query('SELECT 1');
      const postgresHealthy = pgResult.rows.length > 0;
      
      return {
        redis: redisHealthy,
        postgres: postgresHealthy,
        overall: redisHealthy && postgresHealthy
      };
    } catch (error) {
      return {
        redis: false,
        postgres: false,
        overall: false
      };
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    // Stop timers
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    // Flush remaining queues
    await this.flushOrderQueue();
    await this.flushTradeQueue();
    
    // Close connections
    await Promise.all([
      this.redisStore.close(),
      this.postgresStore.close()
    ]);
    
    this.emit('shutdown');
  }
}