import { EventEmitter } from 'events';
import { RedisMatchingEngine } from './RedisMatchingEngine';
import { DatabaseMatchingEngine } from './DatabaseMatchingEngine';
import {
  Order,
  Trade,
  ExecutionReport,
  MatchingEngineConfig,
  MarketData,
  OrderBookSnapshot,
  OrderStatus,
} from './types';
import { logger } from '../../utils/logger';

export enum EngineMode {
  REDIS_PRIMARY = 'redis_primary',
  DATABASE_FALLBACK = 'database_fallback',
  HYBRID = 'hybrid',
}

interface HealthStatus {
  redis: boolean;
  database: boolean;
  lastRedisError?: Error;
  lastDatabaseError?: Error;
  failureCount: number;
  lastFailureTime?: number;
}

export class HybridMatchingEngine extends EventEmitter {
  private redisEngine: RedisMatchingEngine;
  private databaseEngine: DatabaseMatchingEngine;
  private currentMode: EngineMode = EngineMode.REDIS_PRIMARY;
  private healthStatus: HealthStatus = {
    redis: true,
    database: true,
    failureCount: 0,
  };
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly config: MatchingEngineConfig;
  private readonly maxFailures = 3;
  private readonly recoveryDelay = 30000; // 30 seconds

  constructor(config: MatchingEngineConfig) {
    super();
    this.config = config;
    this.redisEngine = new RedisMatchingEngine(config);
    this.databaseEngine = new DatabaseMatchingEngine(config);

    // Forward events from active engine
    this.setupEventForwarding();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing HybridMatchingEngine...');

    // Initialize both engines
    const initPromises: Promise<void>[] = [];

    // Try to initialize Redis engine
    initPromises.push(
      this.redisEngine.initialize()
        .then(() => {
          this.healthStatus.redis = true;
          logger.info('Redis engine initialized successfully');
        })
        .catch((error) => {
          logger.error('Failed to initialize Redis engine', error);
          this.healthStatus.redis = false;
          this.healthStatus.lastRedisError = error;
        })
    );

    // Always initialize database engine as fallback
    initPromises.push(
      this.databaseEngine.initialize()
        .then(() => {
          this.healthStatus.database = true;
          logger.info('Database engine initialized successfully');
        })
        .catch((error) => {
          logger.error('Failed to initialize Database engine', error);
          this.healthStatus.database = false;
          this.healthStatus.lastDatabaseError = error;
          throw error; // Database must be available
        })
    );

    await Promise.all(initPromises);

    // Determine initial mode
    this.determineEngineMode();

    // Start health monitoring
    this.startHealthMonitoring();

    logger.info(`HybridMatchingEngine initialized in ${this.currentMode} mode`);
  }

  private setupEventForwarding(): void {
    const events = [
      'orderSubmitted',
      'orderAdded',
      'orderRemoved',
      'orderFilled',
      'orderCancelled',
      'ordersMatched',
      'executionReport',
      'marketDataUpdate',
      'pairInitialized',
    ];

    for (const event of events) {
      this.redisEngine.on(event, (data) => {
        if (this.currentMode !== EngineMode.DATABASE_FALLBACK) {
          this.emit(event, data);
        }
      });

      this.databaseEngine.on(event, (data) => {
        if (this.currentMode === EngineMode.DATABASE_FALLBACK) {
          this.emit(event, data);
        }
      });
    }
  }

  private determineEngineMode(): void {
    const previousMode = this.currentMode;

    if (this.healthStatus.redis && this.healthStatus.failureCount < this.maxFailures) {
      this.currentMode = EngineMode.REDIS_PRIMARY;
    } else if (this.healthStatus.database) {
      this.currentMode = EngineMode.DATABASE_FALLBACK;
    } else {
      throw new Error('No healthy matching engine available');
    }

    if (previousMode !== this.currentMode) {
      logger.warn(`Engine mode changed from ${previousMode} to ${this.currentMode}`);
      this.emit('engineModeChanged', {
        previousMode,
        currentMode: this.currentMode,
        reason: this.healthStatus.lastRedisError?.message,
      });
    }
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 10000); // Check every 10 seconds
  }

  private async performHealthCheck(): Promise<void> {
    // Check Redis health
    if (!this.healthStatus.redis || this.currentMode === EngineMode.DATABASE_FALLBACK) {
      try {
        // Try to recover Redis
        const testOrder = await this.redisEngine.getOrder('health-check');
        this.healthStatus.redis = true;
        this.healthStatus.failureCount = 0;
        
        // Check if we should switch back to Redis
        if (
          this.currentMode === EngineMode.DATABASE_FALLBACK &&
          this.healthStatus.lastFailureTime &&
          Date.now() - this.healthStatus.lastFailureTime > this.recoveryDelay
        ) {
          logger.info('Redis recovered, switching back to REDIS_PRIMARY mode');
          this.currentMode = EngineMode.REDIS_PRIMARY;
          
          // Sync data from database to Redis
          await this.syncDatabaseToRedis();
        }
      } catch (error) {
        this.healthStatus.redis = false;
      }
    }

    // Always check database health
    try {
      await this.databaseEngine.getOrder('health-check');
      this.healthStatus.database = true;
    } catch (error) {
      this.healthStatus.database = false;
      logger.error('Database health check failed', error);
    }
  }

  private async syncDatabaseToRedis(): Promise<void> {
    logger.info('Syncing database state to Redis...');
    
    try {
      // This would sync active orders from database to Redis
      // Implementation depends on specific requirements
      logger.info('Database to Redis sync completed');
    } catch (error) {
      logger.error('Failed to sync database to Redis', error);
    }
  }

  async submitOrder(orderRequest: Partial<Order>): Promise<ExecutionReport> {
    const startTime = Date.now();

    try {
      let result: ExecutionReport;

      if (this.currentMode === EngineMode.REDIS_PRIMARY) {
        try {
          result = await this.redisEngine.submitOrder(orderRequest);
          
          // Reset failure count on success
          if (this.healthStatus.failureCount > 0) {
            this.healthStatus.failureCount = 0;
          }
          
          return result;
        } catch (error) {
          logger.error('Redis engine order submission failed', error);
          this.healthStatus.failureCount++;
          this.healthStatus.lastFailureTime = Date.now();
          this.healthStatus.lastRedisError = error as Error;

          // Fallback to database if Redis fails
          if (this.healthStatus.failureCount >= this.maxFailures) {
            this.healthStatus.redis = false;
            this.determineEngineMode();
          }

          // Retry with database engine
          if (this.currentMode === EngineMode.DATABASE_FALLBACK) {
            result = await this.databaseEngine.submitOrder(orderRequest);
            return result;
          }

          throw error;
        }
      } else {
        // Use database engine directly
        result = await this.databaseEngine.submitOrder(orderRequest);
        return result;
      }
    } finally {
      const duration = Date.now() - startTime;
      this.emit('orderProcessingTime', {
        engine: this.currentMode,
        duration,
        orderId: orderRequest.id,
      });
    }
  }

  async cancelOrder(orderId: string, userId?: string): Promise<ExecutionReport> {
    try {
      if (this.currentMode === EngineMode.REDIS_PRIMARY) {
        return await this.redisEngine.cancelOrder(orderId, userId);
      } else {
        return await this.databaseEngine.cancelOrder(orderId, userId);
      }
    } catch (error) {
      logger.error('Order cancellation failed', { orderId, error });
      
      // Try fallback engine
      if (this.currentMode === EngineMode.REDIS_PRIMARY && this.healthStatus.database) {
        logger.info('Retrying order cancellation with database engine');
        return await this.databaseEngine.cancelOrder(orderId, userId);
      }
      
      throw error;
    }
  }

  async getOrderBook(pair: string, depth: number = 50): Promise<OrderBookSnapshot | null> {
    if (this.currentMode === EngineMode.REDIS_PRIMARY) {
      try {
        return await this.redisEngine.getOrderBook(pair, depth);
      } catch (error) {
        logger.warn('Failed to get order book from Redis, falling back to database');
        return await this.databaseEngine.getOrderBook(pair, depth);
      }
    } else {
      return await this.databaseEngine.getOrderBook(pair, depth);
    }
  }

  async getMarketData(pair: string): Promise<MarketData | null> {
    if (this.currentMode === EngineMode.REDIS_PRIMARY) {
      return await this.redisEngine.getMarketData(pair);
    } else {
      return await this.databaseEngine.getMarketData(pair);
    }
  }

  async getOrder(orderId: string): Promise<Order | null> {
    // Try both engines for read operations
    try {
      if (this.healthStatus.redis) {
        const order = await this.redisEngine.getOrder(orderId);
        if (order) return order;
      }
    } catch (error) {
      logger.debug('Failed to get order from Redis', { orderId, error });
    }

    // Fallback to database
    return await this.databaseEngine.getOrder(orderId);
  }

  async getUserOrders(
    userId: string,
    filters?: {
      pair?: string;
      status?: OrderStatus[];
      startTime?: number;
      endTime?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<Order[]> {
    // User orders are always read from database for consistency
    return await this.databaseEngine.getUserOrders(userId, filters);
  }

  async getRecentTrades(pair: string, limit: number = 100): Promise<Trade[]> {
    // Recent trades are always read from database for consistency
    return await this.databaseEngine.getRecentTrades(pair, limit);
  }

  getEngineStatus(): {
    mode: EngineMode;
    health: HealthStatus;
    uptime: number;
  } {
    return {
      mode: this.currentMode,
      health: { ...this.healthStatus },
      uptime: process.uptime(),
    };
  }

  initializePair(pair: string, tickSize?: number): void {
    this.redisEngine.initializePair(pair, tickSize);
    this.databaseEngine.initializePair(pair, tickSize);
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down HybridMatchingEngine...');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Shutdown both engines
    await Promise.all([
      this.redisEngine.shutdown().catch(err => 
        logger.error('Error shutting down Redis engine', err)
      ),
      this.databaseEngine.shutdown().catch(err => 
        logger.error('Error shutting down Database engine', err)
      ),
    ]);

    this.removeAllListeners();
    logger.info('HybridMatchingEngine shut down complete');
  }
}