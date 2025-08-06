import { EventEmitter } from 'events';
import { RedisOrderBook } from '../redis/RedisOrderBook';
import { RedisConnectionPool, getConnectionPool } from '../redis/RedisConnectionPool';
import {
  Order,
  OrderType,
  OrderStatus,
  OrderSide,
  TimeInForce,
  Trade,
  ExecutionReport,
  MatchingEngineConfig,
  MarketData,
  OrderBookSnapshot,
} from './types';
import { db, TransactionClient } from '../../database/config';
import { OrderRepository } from '../../database/repositories/OrderRepository';
import { TradeRepository } from '../../database/repositories/TradeRepository';
import { UserBalanceRepository } from '../../database/repositories/UserBalanceRepository';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { Cluster, Redis } from 'ioredis';

export class RedisMatchingEngine extends EventEmitter {
  private redisOrderBooks: Map<string, RedisOrderBook>;
  private config: MatchingEngineConfig;
  private orderRepo: OrderRepository;
  private tradeRepo: TradeRepository;
  private balanceRepo: UserBalanceRepository;
  private marketData: Map<string, MarketData>;
  private connectionPool: RedisConnectionPool;
  private persistenceQueue: Trade[] = [];
  private persistenceTimer?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(config: MatchingEngineConfig) {
    super();
    this.redisOrderBooks = new Map();
    this.config = config;
    this.orderRepo = new OrderRepository();
    this.tradeRepo = new TradeRepository();
    this.balanceRepo = new UserBalanceRepository();
    this.marketData = new Map();
    
    // Initialize connection pool with high-performance settings
    this.connectionPool = getConnectionPool({
      minConnections: 10,
      maxConnections: 50,
      connectionTimeout: 3000,
      healthCheckInterval: 5000,
    });
  }

  async initialize(): Promise<void> {
    try {
      // Initialize database connection
      await db.connect();
      
      // Initialize Redis order books
      await this.initializeRedisOrderBooks();
      
      // Load active orders from database (cache warming)
      await this.loadActiveOrders();
      
      // Start periodic tasks
      this.startPeriodicTasks();
      
      // Start persistence queue processing
      this.startPersistenceProcessor();
      
      logger.info('RedisMatchingEngine initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RedisMatchingEngine', error);
      throw error;
    }
  }

  private async initializeRedisOrderBooks(): Promise<void> {
    const pairs = Object.keys(this.config.tickSize);
    
    for (const pair of pairs) {
      // Get dedicated connection for each order book
      const conn = await this.connectionPool.getConnection();
      const redisOrderBook = new RedisOrderBook(pair, this.config.tickSize[pair] || 0.01, conn);
      
      // Set up event forwarding
      redisOrderBook.on('orderAdded', (data) => this.emit('orderAdded', data));
      redisOrderBook.on('orderRemoved', (data) => this.emit('orderRemoved', data));
      redisOrderBook.on('ordersMatched', (data) => this.emit('ordersMatched', data));
      
      this.redisOrderBooks.set(pair, redisOrderBook);
      
      // Initialize market data
      this.marketData.set(pair, {
        pair,
        lastPrice: 0,
        bidPrice: 0,
        askPrice: 0,
        bidQuantity: 0,
        askQuantity: 0,
        volume24h: 0,
        high24h: 0,
        low24h: Infinity,
        openPrice24h: 0,
        lastUpdateTime: Date.now(),
      });
    }
  }

  private async loadActiveOrders(): Promise<void> {
    logger.info('Starting cache warming from database...');
    
    const pairs = Object.keys(this.config.tickSize);
    const startTime = Date.now();
    
    // Use parallel loading for efficiency
    await Promise.all(pairs.map(async (pair) => {
      try {
        const activeOrders = await this.orderRepo.getActiveOrdersByPair(pair);
        const orderBook = this.redisOrderBooks.get(pair);
        
        if (!orderBook) {
          logger.error(`Order book not found for pair ${pair}`);
          return;
        }
        
        // Batch add orders to Redis
        const batchSize = 100;
        for (let i = 0; i < activeOrders.length; i += batchSize) {
          const batch = activeOrders.slice(i, i + batchSize);
          await Promise.all(batch.map(order => orderBook.addOrder(order)));
        }
        
        logger.info(`Loaded ${activeOrders.length} active orders for ${pair}`);
      } catch (error) {
        logger.error(`Failed to load orders for ${pair}`, error);
      }
    }));
    
    const loadTime = Date.now() - startTime;
    logger.info(`Cache warming completed in ${loadTime}ms`);
  }

  private startPeriodicTasks(): void {
    // Cancel expired orders every minute
    setInterval(async () => {
      if (this.isShuttingDown) return;
      
      try {
        const cancelledCount = await this.orderRepo.cancelExpiredOrders();
        if (cancelledCount > 0) {
          logger.info(`Cancelled ${cancelledCount} expired orders`);
        }
      } catch (error) {
        logger.error('Error cancelling expired orders', error);
      }
    }, 60000);

    // Update market data every second for real-time performance
    setInterval(async () => {
      if (this.isShuttingDown) return;
      await this.updateAllMarketData();
    }, 1000);

    // Sync Redis state with database every 5 minutes
    setInterval(async () => {
      if (this.isShuttingDown) return;
      await this.syncRedisWithDatabase();
    }, 300000);
  }

  private startPersistenceProcessor(): void {
    this.persistenceTimer = setInterval(async () => {
      if (this.isShuttingDown || this.persistenceQueue.length === 0) return;
      
      // Process trades in batches
      const batch = this.persistenceQueue.splice(0, 100);
      
      try {
        await this.tradeRepo.createBulkTrades(batch);
        logger.debug(`Persisted ${batch.length} trades to database`);
      } catch (error) {
        logger.error('Failed to persist trades', error);
        // Re-add to queue on failure
        this.persistenceQueue.unshift(...batch);
      }
    }, 1000); // Process every second
  }

  initializePair(pair: string, tickSize?: number): void {
    if (!this.redisOrderBooks.has(pair)) {
      const pairTickSize = tickSize || this.config.tickSize[pair] || 0.01;
      
      this.connectionPool.getConnection().then(conn => {
        const redisOrderBook = new RedisOrderBook(pair, pairTickSize, conn);
        
        // Set up event forwarding
        redisOrderBook.on('orderAdded', (data) => this.emit('orderAdded', data));
        redisOrderBook.on('orderRemoved', (data) => this.emit('orderRemoved', data));
        redisOrderBook.on('ordersMatched', (data) => this.emit('ordersMatched', data));
        
        this.redisOrderBooks.set(pair, redisOrderBook);
        
        // Initialize market data
        this.marketData.set(pair, {
          pair,
          lastPrice: 0,
          bidPrice: 0,
          askPrice: 0,
          bidQuantity: 0,
          askQuantity: 0,
          volume24h: 0,
          high24h: 0,
          low24h: Infinity,
          openPrice24h: 0,
          lastUpdateTime: Date.now(),
        });
        
        this.emit('pairInitialized', { pair, tickSize: pairTickSize });
      }).catch(error => {
        logger.error(`Failed to initialize pair ${pair}`, error);
      });
    }
  }

  async submitOrder(orderRequest: Partial<Order>): Promise<ExecutionReport> {
    // Validate order
    this.validateOrder(orderRequest);

    // Create order object with UUID
    const order: Order = {
      id: uuidv4(),
      userId: orderRequest.userId!,
      pair: orderRequest.pair!,
      side: orderRequest.side!,
      type: orderRequest.type!,
      price: orderRequest.price || 0,
      quantity: orderRequest.quantity!,
      filledQuantity: 0,
      status: OrderStatus.PENDING,
      timeInForce: orderRequest.timeInForce || TimeInForce.GTC,
      timestamp: Date.now(),
      lastUpdateTime: Date.now(),
      clientOrderId: orderRequest.clientOrderId,
      metadata: orderRequest.metadata,
    };

    // Get Redis order book
    const orderBook = this.redisOrderBooks.get(order.pair);
    if (!orderBook) {
      throw new Error(`Order book not found for pair ${order.pair}`);
    }

    // Execute in transaction
    return await db.transaction(async (client: TransactionClient) => {
      try {
        // Lock user balance
        const [baseCurrency, quoteCurrency] = order.pair.split('/');
        const lockCurrency = order.side === OrderSide.BUY ? quoteCurrency : baseCurrency;
        const lockAmount = order.side === OrderSide.BUY 
          ? order.quantity * (order.price || Number.MAX_SAFE_INTEGER)
          : order.quantity;

        await this.balanceRepo.lockBalance(
          order.userId,
          lockCurrency,
          lockAmount,
          client
        );

        // Save order to database
        await this.orderRepo.createOrder(order, client);

        // Process order in Redis
        let executionReport: ExecutionReport;
        const trades: Trade[] = [];

        if (order.type === OrderType.MARKET) {
          executionReport = await this.processMarketOrderRedis(order, orderBook, trades, client);
        } else {
          executionReport = await this.processLimitOrderRedis(order, orderBook, trades, client);
        }

        // Add trades to persistence queue
        if (trades.length > 0) {
          this.persistenceQueue.push(...trades);
        }

        // Update order in database
        await this.orderRepo.updateOrder(
          order.id,
          {
            filledQuantity: order.filledQuantity,
            status: order.status,
            lastUpdateTime: order.lastUpdateTime,
          },
          client
        );

        // Process balance updates for executed trades
        await this.processTradeBalances(trades, client);

        // Emit events
        this.emit('orderSubmitted', order);
        this.emit('executionReport', executionReport);

        // Update market data asynchronously
        setImmediate(() => this.updateMarketData(order.pair, trades));

        return executionReport;
      } catch (error) {
        logger.error('Error processing order', { order, error });
        throw error;
      }
    });
  }

  private async processMarketOrderRedis(
    order: Order,
    orderBook: RedisOrderBook,
    tradesOut: Trade[],
    client: TransactionClient
  ): Promise<ExecutionReport> {
    // Set market order price to ensure matching
    if (order.side === OrderSide.BUY) {
      order.price = Number.MAX_SAFE_INTEGER;
    } else {
      order.price = 0.000001;
    }
    
    // Match orders in Redis
    const { remainingQuantity, trades } = await orderBook.matchOrders(order);
    tradesOut.push(...trades);

    // Check Time in Force constraints
    if (order.timeInForce === TimeInForce.FOK && order.filledQuantity < order.quantity) {
      // Fill or Kill - cancel if not fully filled
      order.status = OrderStatus.CANCELLED;
      order.lastUpdateTime = Date.now();
      
      // Revert trades
      tradesOut.length = 0;
      return this.generateExecutionReport(order, []);
    }

    // Calculate fees
    for (const trade of trades) {
      trade.takerFee = trade.quantity * trade.price * this.config.takerFeeRate;
      trade.makerFee = trade.quantity * trade.price * this.config.makerFeeRate;
    }

    // Update maker orders in Redis and database
    for (const trade of trades) {
      await orderBook.updateOrderFill(trade.makerOrderId, trade.quantity);
      
      // Update in database asynchronously
      setImmediate(async () => {
        try {
          const makerOrder = await orderBook.getOrder(trade.makerOrderId);
          if (makerOrder) {
            await this.orderRepo.updateOrder(
              makerOrder.id,
              {
                filledQuantity: makerOrder.filledQuantity,
                status: makerOrder.status,
                lastUpdateTime: Date.now(),
              }
            );
            
            if (makerOrder.status === OrderStatus.FILLED) {
              this.emit('orderFilled', makerOrder);
            }
          }
        } catch (error) {
          logger.error('Failed to update maker order in database', error);
        }
      });
    }

    // Update order status
    if (order.filledQuantity === 0) {
      order.status = OrderStatus.CANCELLED;
    } else if (order.filledQuantity < order.quantity) {
      order.status = OrderStatus.PARTIALLY_FILLED;
      if (order.timeInForce === TimeInForce.IOC) {
        order.status = OrderStatus.CANCELLED;
      }
    } else {
      order.status = OrderStatus.FILLED;
    }

    order.lastUpdateTime = Date.now();

    return this.generateExecutionReport(order, trades);
  }

  private async processLimitOrderRedis(
    order: Order,
    orderBook: RedisOrderBook,
    tradesOut: Trade[],
    client: TransactionClient
  ): Promise<ExecutionReport> {
    // Try to match immediately
    const { remainingQuantity, trades } = await orderBook.matchOrders(order);
    tradesOut.push(...trades);

    // Calculate fees
    for (const trade of trades) {
      trade.takerFee = trade.quantity * trade.price * this.config.takerFeeRate;
      trade.makerFee = trade.quantity * trade.price * this.config.makerFeeRate;
    }

    // Update maker orders
    for (const trade of trades) {
      await orderBook.updateOrderFill(trade.makerOrderId, trade.quantity);
      
      // Update database asynchronously
      setImmediate(async () => {
        try {
          const makerOrder = await orderBook.getOrder(trade.makerOrderId);
          if (makerOrder) {
            await this.orderRepo.updateOrder(
              makerOrder.id,
              {
                filledQuantity: makerOrder.filledQuantity,
                status: makerOrder.status,
                lastUpdateTime: Date.now(),
              }
            );
            
            if (makerOrder.status === OrderStatus.FILLED) {
              this.emit('orderFilled', makerOrder);
            }
          }
        } catch (error) {
          logger.error('Failed to update maker order in database', error);
        }
      });
    }

    // Check if order should be added to book
    if (remainingQuantity > 0) {
      // Check Time in Force
      if (order.timeInForce === TimeInForce.IOC || order.timeInForce === TimeInForce.FOK) {
        order.status = OrderStatus.CANCELLED;
        
        if (order.timeInForce === TimeInForce.FOK && order.filledQuantity > 0) {
          // Revert trades for FOK
          tradesOut.length = 0;
          return this.generateExecutionReport(order, []);
        }
      } else {
        // Add to order book
        order.status = order.filledQuantity > 0 ? OrderStatus.PARTIALLY_FILLED : OrderStatus.OPEN;
        await orderBook.addOrder(order);
        this.emit('orderAdded', order);
      }
    } else {
      order.status = OrderStatus.FILLED;
      this.emit('orderFilled', order);
    }

    order.lastUpdateTime = Date.now();

    return this.generateExecutionReport(order, trades);
  }

  private async processTradeBalances(trades: Trade[], client: TransactionClient): Promise<void> {
    for (const trade of trades) {
      const [baseCurrency, quoteCurrency] = trade.pair.split('/');
      
      // Get user IDs from orders
      const takerOrder = await this.orderRepo.getOrderById(trade.takerOrderId);
      const makerOrder = await this.orderRepo.getOrderById(trade.makerOrderId);
      
      if (!takerOrder || !makerOrder) {
        throw new Error('Order not found for trade balance processing');
      }

      const quoteAmount = trade.price * trade.quantity;

      // Process taker balances
      if (trade.takerSide === OrderSide.BUY) {
        // Taker buys base, sells quote
        await this.balanceRepo.updateBalance(
          takerOrder.userId,
          baseCurrency,
          trade.quantity - trade.takerFee, // Receive base minus fee
          0,
          `Trade ${trade.id}`,
          client
        );
        await this.balanceRepo.updateBalance(
          takerOrder.userId,
          quoteCurrency,
          -quoteAmount,
          -quoteAmount, // Unlock the locked amount
          `Trade ${trade.id}`,
          client
        );
      } else {
        // Taker sells base, buys quote
        await this.balanceRepo.updateBalance(
          takerOrder.userId,
          baseCurrency,
          -trade.quantity,
          -trade.quantity, // Unlock the locked amount
          `Trade ${trade.id}`,
          client
        );
        await this.balanceRepo.updateBalance(
          takerOrder.userId,
          quoteCurrency,
          quoteAmount - trade.takerFee, // Receive quote minus fee
          0,
          `Trade ${trade.id}`,
          client
        );
      }

      // Process maker balances
      if (trade.takerSide === OrderSide.BUY) {
        // Maker sells base, buys quote
        await this.balanceRepo.updateBalance(
          makerOrder.userId,
          baseCurrency,
          -trade.quantity,
          -trade.quantity, // Unlock the locked amount
          `Trade ${trade.id}`,
          client
        );
        await this.balanceRepo.updateBalance(
          makerOrder.userId,
          quoteCurrency,
          quoteAmount - trade.makerFee, // Receive quote minus fee
          0,
          `Trade ${trade.id}`,
          client
        );
      } else {
        // Maker buys base, sells quote
        await this.balanceRepo.updateBalance(
          makerOrder.userId,
          baseCurrency,
          trade.quantity - trade.makerFee, // Receive base minus fee
          0,
          `Trade ${trade.id}`,
          client
        );
        await this.balanceRepo.updateBalance(
          makerOrder.userId,
          quoteCurrency,
          -quoteAmount,
          -quoteAmount, // Unlock the locked amount
          `Trade ${trade.id}`,
          client
        );
      }
    }
  }

  async cancelOrder(orderId: string, userId?: string): Promise<ExecutionReport> {
    return await db.transaction(async (client: TransactionClient) => {
      // Lock and fetch order
      const orders = await this.orderRepo.lockOrdersForMatching([orderId], client);
      const order = orders[0];
      
      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }

      if (userId && order.userId !== userId) {
        throw new Error('Unauthorized to cancel this order');
      }

      if (order.status === OrderStatus.FILLED || order.status === OrderStatus.CANCELLED) {
        throw new Error(`Order ${orderId} is already ${order.status}`);
      }

      // Remove from Redis order book
      const orderBook = this.redisOrderBooks.get(order.pair);
      if (orderBook) {
        await orderBook.removeOrder(orderId, order.side, order.price, order.quantity - order.filledQuantity);
      }

      // Update order status
      order.status = OrderStatus.CANCELLED;
      order.lastUpdateTime = Date.now();

      await this.orderRepo.updateOrder(
        order.id,
        {
          status: order.status,
          lastUpdateTime: order.lastUpdateTime,
        },
        client
      );

      // Unlock remaining balance
      const [baseCurrency, quoteCurrency] = order.pair.split('/');
      const remainingQuantity = order.quantity - order.filledQuantity;
      
      if (remainingQuantity > 0) {
        const unlockCurrency = order.side === OrderSide.BUY ? quoteCurrency : baseCurrency;
        const unlockAmount = order.side === OrderSide.BUY 
          ? remainingQuantity * order.price
          : remainingQuantity;

        await this.balanceRepo.unlockBalance(
          order.userId,
          unlockCurrency,
          unlockAmount,
          client
        );
      }

      const report = this.generateExecutionReport(order, []);
      
      this.emit('orderCancelled', order);
      this.emit('executionReport', report);

      return report;
    });
  }

  private generateExecutionReport(order: Order, trades: Trade[]): ExecutionReport {
    const totalValue = trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
    const averagePrice = trades.length > 0 && order.filledQuantity > 0 
      ? totalValue / order.filledQuantity 
      : 0;

    return {
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      executionId: `EXEC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: order.status,
      side: order.side,
      pair: order.pair,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      remainingQuantity: order.quantity - order.filledQuantity,
      averagePrice,
      trades,
      timestamp: Date.now(),
    };
  }

  private validateOrder(order: Partial<Order>): void {
    if (!order.userId) throw new Error('User ID is required');
    if (!order.pair) throw new Error('Trading pair is required');
    if (!order.side) throw new Error('Order side is required');
    if (!order.type) throw new Error('Order type is required');
    if (!order.quantity || order.quantity <= 0) throw new Error('Invalid quantity');

    // Check min/max order size
    const minSize = this.config.minOrderSize[order.pair!] || 0;
    const maxSize = this.config.maxOrderSize[order.pair!] || Infinity;
    
    if (order.quantity < minSize) {
      throw new Error(`Order size below minimum ${minSize}`);
    }
    if (order.quantity > maxSize) {
      throw new Error(`Order size above maximum ${maxSize}`);
    }

    // Validate limit order price
    if (order.type === OrderType.LIMIT) {
      if (!order.price || order.price <= 0) {
        throw new Error('Price is required for limit orders');
      }
      
      // Check tick size
      const tickSize = this.config.tickSize[order.pair!] || 0.01;
      if (order.price % tickSize !== 0) {
        throw new Error(`Price must be a multiple of tick size ${tickSize}`);
      }
    }
  }

  private async updateMarketData(pair: string, trades: Trade[]): Promise<void> {
    const marketData = this.marketData.get(pair);
    if (!marketData) return;

    // Update from trades if available
    if (trades.length > 0) {
      const lastTrade = trades[trades.length - 1];
      marketData.lastPrice = lastTrade.price;
    }

    // Get order book top from Redis
    const orderBook = this.redisOrderBooks.get(pair);
    if (orderBook) {
      const [bestBid, bestAsk] = await Promise.all([
        orderBook.getBestBid(),
        orderBook.getBestAsk()
      ]);
      
      marketData.bidPrice = bestBid ? bestBid.price : 0;
      marketData.bidQuantity = bestBid ? bestBid.quantity : 0;
      marketData.askPrice = bestAsk ? bestAsk.price : 0;
      marketData.askQuantity = bestAsk ? bestAsk.quantity : 0;
    }

    // Update stats from database periodically (handled by periodic task)
    marketData.lastUpdateTime = Date.now();

    this.emit('marketDataUpdate', marketData);
  }

  private async updateAllMarketData(): Promise<void> {
    const updates = Array.from(this.redisOrderBooks.keys()).map(async (pair) => {
      try {
        await this.updateMarketData(pair, []);
        
        // Update 24h stats from database every 10th update
        if (Math.random() < 0.1) {
          const stats = await this.tradeRepo.getMarketStats(pair);
          const marketData = this.marketData.get(pair);
          if (marketData) {
            marketData.volume24h = stats.volume24h;
            marketData.high24h = stats.high24h;
            marketData.low24h = stats.low24h;
          }
        }
      } catch (error) {
        logger.error(`Failed to update market data for ${pair}`, error);
      }
    });

    await Promise.all(updates);
  }

  private async syncRedisWithDatabase(): Promise<void> {
    logger.info('Starting Redis-Database sync...');
    
    try {
      // Sync each pair
      for (const [pair, orderBook] of this.redisOrderBooks) {
        const snapshot = await orderBook.getOrderBookSnapshot(1000);
        
        // Get all order IDs from snapshot
        const orderIds = new Set<string>();
        
        // Process bids and asks
        for (const level of [...snapshot.bids, ...snapshot.asks]) {
          // Note: We'd need to modify RedisOrderBook to include order IDs in snapshot
          // For now, this is a placeholder
        }
        
        logger.info(`Synced ${orderIds.size} orders for ${pair}`);
      }
    } catch (error) {
      logger.error('Failed to sync Redis with database', error);
    }
  }

  async getOrderBook(pair: string, depth: number = 50): Promise<OrderBookSnapshot | null> {
    const orderBook = this.redisOrderBooks.get(pair);
    if (!orderBook) return null;

    const snapshot = await orderBook.getOrderBookSnapshot(depth);
    
    return {
      pair,
      bids: snapshot.bids.map(level => ({
        price: level.price,
        quantity: level.quantity,
        orders: [], // Not loading individual orders for performance
      })),
      asks: snapshot.asks.map(level => ({
        price: level.price,
        quantity: level.quantity,
        orders: [], // Not loading individual orders for performance
      })),
      lastUpdateTime: Date.now(),
      sequenceNumber: snapshot.sequence,
    };
  }

  async getMarketData(pair: string): Promise<MarketData | null> {
    return this.marketData.get(pair) || null;
  }

  async getOrder(orderId: string): Promise<Order | null> {
    // Try Redis first
    for (const [pair, orderBook] of this.redisOrderBooks) {
      const order = await orderBook.getOrder(orderId);
      if (order) return order;
    }
    
    // Fall back to database
    return await this.orderRepo.getOrderById(orderId);
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
    return await this.orderRepo.getOrdersByUser(userId, filters);
  }

  async getRecentTrades(pair: string, limit: number = 100): Promise<Trade[]> {
    return await this.tradeRepo.getRecentTrades(pair, limit);
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    // Stop timers
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
    }
    
    // Process remaining persistence queue
    if (this.persistenceQueue.length > 0) {
      try {
        await this.tradeRepo.createBulkTrades(this.persistenceQueue);
        logger.info(`Persisted ${this.persistenceQueue.length} remaining trades`);
      } catch (error) {
        logger.error('Failed to persist remaining trades', error);
      }
    }
    
    // Disconnect Redis order books
    await Promise.all(
      Array.from(this.redisOrderBooks.values()).map(ob => ob.disconnect())
    );
    
    // Shutdown connection pool
    await this.connectionPool.shutdown();
    
    // Disconnect database
    await db.disconnect();
    
    this.removeAllListeners();
    logger.info('RedisMatchingEngine shut down');
  }
}