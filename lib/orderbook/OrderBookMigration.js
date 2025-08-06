/**
 * Order Book Migration Tool
 * Migrates from in-memory Map storage to Redis-based storage
 */

const Redis = require('ioredis');
const { performance } = require('perf_hooks');

class OrderBookMigration {
  constructor(config = {}) {
    this.redis = new Redis({
      host: config.redisHost || 'localhost',
      port: config.redisPort || 6379,
      db: config.redisDb || 0,
      ...config.redisOptions
    });
    
    this.config = {
      batchSize: config.batchSize || 1000,
      pricePrecision: config.pricePrecision || 8,
      amountPrecision: config.amountPrecision || 8,
      ...config
    };
    
    this.stats = {
      ordersProcessed: 0,
      pairsProcessed: 0,
      errors: 0,
      startTime: null,
      endTime: null
    };
  }

  /**
   * Migrate from in-memory order book to Redis
   * @param {Map} inMemoryOrderBooks - Map of pair -> order book data
   * @param {Object} options - Migration options
   */
  async migrate(inMemoryOrderBooks, options = {}) {
    console.log('🚀 Starting order book migration to Redis...');
    this.stats.startTime = Date.now();
    
    try {
      // Validate input
      if (!inMemoryOrderBooks || !(inMemoryOrderBooks instanceof Map)) {
        throw new Error('Invalid input: expected Map of order books');
      }
      
      // Process each trading pair
      for (const [pair, orderBook] of inMemoryOrderBooks) {
        await this.migratePair(pair, orderBook, options);
        this.stats.pairsProcessed++;
      }
      
      // Create indexes for efficient queries
      await this.createIndexes();
      
      // Verify migration
      if (options.verify !== false) {
        await this.verifyMigration(inMemoryOrderBooks);
      }
      
      this.stats.endTime = Date.now();
      const duration = (this.stats.endTime - this.stats.startTime) / 1000;
      
      console.log('✅ Migration completed successfully!');
      console.log(`📊 Statistics:`);
      console.log(`   - Pairs processed: ${this.stats.pairsProcessed}`);
      console.log(`   - Orders processed: ${this.stats.ordersProcessed}`);
      console.log(`   - Errors: ${this.stats.errors}`);
      console.log(`   - Duration: ${duration.toFixed(2)}s`);
      console.log(`   - Orders/second: ${(this.stats.ordersProcessed / duration).toFixed(2)}`);
      
      return this.stats;
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  /**
   * Migrate a single trading pair
   */
  async migratePair(pair, orderBook, options) {
    console.log(`📦 Migrating pair: ${pair}`);
    const startTime = performance.now();
    
    // Initialize pair structure
    await this.initializePairStructure(pair);
    
    // Create pipeline for batch operations
    const pipeline = this.redis.pipeline();
    let batchCount = 0;
    
    // Process buy orders (bids)
    if (orderBook.bids) {
      await this.processSide(pair, 'bids', orderBook.bids, pipeline, batchCount);
    }
    
    // Process sell orders (asks)
    if (orderBook.asks) {
      await this.processSide(pair, 'asks', orderBook.asks, pipeline, batchCount);
    }
    
    // Process order metadata
    if (orderBook.orders) {
      await this.processOrders(pair, orderBook.orders, pipeline, batchCount);
    }
    
    // Execute final batch
    if (pipeline.length > 0) {
      await pipeline.exec();
    }
    
    // Migrate additional data
    await this.migrateAdditionalData(pair, orderBook);
    
    const duration = performance.now() - startTime;
    console.log(`   ✓ Pair ${pair} migrated in ${duration.toFixed(2)}ms`);
  }

  /**
   * Process one side of the order book (bids or asks)
   */
  async processSide(pair, side, orders, pipeline, batchCount) {
    const priceKey = `ob:${pair}:${side}:prices`;
    
    // Group orders by price level
    const priceLevels = new Map();
    
    for (const order of orders) {
      const price = this.normalizePrice(order.price);
      
      if (!priceLevels.has(price)) {
        priceLevels.set(price, {
          totalAmount: 0,
          orders: []
        });
      }
      
      const level = priceLevels.get(price);
      level.totalAmount += order.amount || order.remainingAmount || 0;
      level.orders.push(order);
    }
    
    // Add price levels to Redis
    for (const [price, level] of priceLevels) {
      // Add aggregated amount at price level
      pipeline.zadd(priceKey, level.totalAmount, price);
      
      // Add individual orders at this price
      const ordersKey = `ob:${pair}:${side}:orders:${price}`;
      
      for (const order of level.orders) {
        pipeline.zadd(
          ordersKey,
          order.timestamp || Date.now(),
          order.id
        );
        
        batchCount++;
        
        // Execute batch if needed
        if (batchCount >= this.config.batchSize) {
          await pipeline.exec();
          pipeline.length = 0;
          batchCount = 0;
        }
      }
    }
    
    return batchCount;
  }

  /**
   * Process order metadata
   */
  async processOrders(pair, orders, pipeline, batchCount) {
    const ordersKey = `ob:${pair}:orders`;
    
    for (const order of orders) {
      // Ensure order has all required fields
      const orderData = {
        id: order.id,
        userId: order.userId || order.user || 'unknown',
        pair: pair,
        side: order.side,
        type: order.type || 'limit',
        price: order.price,
        amount: order.amount || order.size,
        remainingAmount: order.remainingAmount || order.amount || order.size,
        filledAmount: order.filledAmount || 0,
        status: order.status || 'open',
        timestamp: order.timestamp || Date.now(),
        sequenceId: order.sequenceId || 0
      };
      
      // Store order data
      pipeline.hset(ordersKey, order.id, JSON.stringify(orderData));
      
      // Add to user's orders
      if (orderData.userId !== 'unknown') {
        pipeline.sadd(`ob:${pair}:users:${orderData.userId}`, order.id);
      }
      
      this.stats.ordersProcessed++;
      batchCount++;
      
      // Execute batch if needed
      if (batchCount >= this.config.batchSize) {
        await pipeline.exec();
        pipeline.length = 0;
        batchCount = 0;
      }
    }
    
    return batchCount;
  }

  /**
   * Migrate additional data (matches, trades, etc.)
   */
  async migrateAdditionalData(pair, orderBook) {
    const pipeline = this.redis.pipeline();
    
    // Migrate sequence number
    if (orderBook.sequence !== undefined) {
      pipeline.set(`ob:${pair}:sequence`, orderBook.sequence);
    }
    
    // Migrate matches/trades
    if (orderBook.matches || orderBook.trades) {
      const matches = orderBook.matches || orderBook.trades;
      const matchesKey = `ob:${pair}:matches`;
      
      for (const match of matches) {
        pipeline.hset(matchesKey, match.id, JSON.stringify(match));
      }
    }
    
    // Migrate market statistics
    if (orderBook.stats) {
      pipeline.hset(`ob:stats`, pair, JSON.stringify(orderBook.stats));
    }
    
    await pipeline.exec();
  }

  /**
   * Initialize Redis structure for a trading pair
   */
  async initializePairStructure(pair) {
    const multi = this.redis.multi();
    
    // Initialize sequence counter
    multi.setnx(`ob:${pair}:sequence`, 0);
    
    // Create stream for real-time updates
    multi.xadd(`ob:${pair}:stream`, 'MAXLEN', '~', '10000', '*',
      'event', 'migration_start',
      'timestamp', Date.now()
    );
    
    await multi.exec();
  }

  /**
   * Create Redis indexes for efficient queries
   */
  async createIndexes() {
    console.log('🔍 Creating indexes...');
    
    // Note: Redis doesn't have traditional indexes, but we can create
    // auxiliary data structures for efficient lookups
    
    // Create pair index
    const pairs = await this.redis.keys('ob:*:sequence');
    const pairList = pairs.map(key => key.split(':')[1]);
    
    if (pairList.length > 0) {
      await this.redis.sadd('ob:pairs', ...pairList);
    }
    
    // Create user index for each pair
    for (const pair of pairList) {
      const users = await this.redis.keys(`ob:${pair}:users:*`);
      const userIds = users.map(key => key.split(':').pop());
      
      if (userIds.length > 0) {
        await this.redis.sadd(`ob:${pair}:user_index`, ...userIds);
      }
    }
  }

  /**
   * Verify migration accuracy
   */
  async verifyMigration(inMemoryOrderBooks) {
    console.log('🔍 Verifying migration...');
    let verified = true;
    
    for (const [pair, inMemoryBook] of inMemoryOrderBooks) {
      // Get Redis order book
      const redisBook = await this.getRedisOrderBook(pair);
      
      // Compare order counts
      const inMemoryOrderCount = this.countOrders(inMemoryBook);
      const redisOrderCount = await this.redis.hlen(`ob:${pair}:orders`);
      
      if (inMemoryOrderCount !== parseInt(redisOrderCount)) {
        console.error(`❌ Order count mismatch for ${pair}: ` +
          `In-memory: ${inMemoryOrderCount}, Redis: ${redisOrderCount}`);
        verified = false;
        this.stats.errors++;
      }
      
      // Verify price levels
      const verifyResult = await this.verifyPriceLevels(pair, inMemoryBook, redisBook);
      if (!verifyResult) {
        verified = false;
        this.stats.errors++;
      }
    }
    
    if (verified) {
      console.log('✅ Migration verification passed!');
    } else {
      console.error('❌ Migration verification failed!');
    }
    
    return verified;
  }

  /**
   * Get order book from Redis for verification
   */
  async getRedisOrderBook(pair) {
    const multi = this.redis.multi();
    
    multi.zrevrange(`ob:${pair}:bids:prices`, 0, -1, 'WITHSCORES');
    multi.zrange(`ob:${pair}:asks:prices`, 0, -1, 'WITHSCORES');
    multi.hgetall(`ob:${pair}:orders`);
    
    const [[, bids], [, asks], [, orders]] = await multi.exec();
    
    return {
      bids: this.parsePriceLevels(bids),
      asks: this.parsePriceLevels(asks),
      orders: Object.values(orders).map(data => JSON.parse(data))
    };
  }

  /**
   * Verify price levels match
   */
  async verifyPriceLevels(pair, inMemoryBook, redisBook) {
    // Compare bid levels
    const inMemoryBidPrices = new Set(
      inMemoryBook.bids?.map(order => this.normalizePrice(order.price)) || []
    );
    const redisBidPrices = new Set(
      redisBook.bids.map(level => this.normalizePrice(level.price))
    );
    
    if (!this.areSetsEqual(inMemoryBidPrices, redisBidPrices)) {
      console.error(`❌ Bid price levels mismatch for ${pair}`);
      return false;
    }
    
    // Compare ask levels
    const inMemoryAskPrices = new Set(
      inMemoryBook.asks?.map(order => this.normalizePrice(order.price)) || []
    );
    const redisAskPrices = new Set(
      redisBook.asks.map(level => this.normalizePrice(level.price))
    );
    
    if (!this.areSetsEqual(inMemoryAskPrices, redisAskPrices)) {
      console.error(`❌ Ask price levels mismatch for ${pair}`);
      return false;
    }
    
    return true;
  }

  /**
   * Rollback migration (cleanup Redis data)
   */
  async rollback(pairs) {
    console.log('🔄 Rolling back migration...');
    
    const pipeline = this.redis.pipeline();
    
    for (const pair of pairs) {
      // Get all keys for this pair
      const keys = await this.redis.keys(`ob:${pair}:*`);
      
      if (keys.length > 0) {
        pipeline.del(...keys);
      }
    }
    
    // Remove from pairs set
    if (pairs.length > 0) {
      pipeline.srem('ob:pairs', ...pairs);
    }
    
    await pipeline.exec();
    
    console.log('✅ Rollback completed');
  }

  /**
   * Helper methods
   */
  
  countOrders(orderBook) {
    let count = 0;
    
    if (orderBook.orders) {
      count = orderBook.orders.length;
    } else {
      if (orderBook.bids) count += orderBook.bids.length;
      if (orderBook.asks) count += orderBook.asks.length;
    }
    
    return count;
  }

  parsePriceLevels(levels) {
    const parsed = [];
    
    for (let i = 0; i < levels.length; i += 2) {
      parsed.push({
        price: parseFloat(levels[i]),
        amount: parseFloat(levels[i + 1])
      });
    }
    
    return parsed;
  }

  normalizePrice(price) {
    return parseFloat(price).toFixed(this.config.pricePrecision);
  }

  normalizeAmount(amount) {
    return parseFloat(amount).toFixed(this.config.amountPrecision);
  }

  areSetsEqual(set1, set2) {
    if (set1.size !== set2.size) return false;
    
    for (const item of set1) {
      if (!set2.has(item)) return false;
    }
    
    return true;
  }

  /**
   * Export current Redis state back to in-memory format
   */
  async exportToMemory(pairs) {
    const orderBooks = new Map();
    
    for (const pair of pairs) {
      const orderBook = await this.getRedisOrderBook(pair);
      orderBooks.set(pair, orderBook);
    }
    
    return orderBooks;
  }

  /**
   * Close Redis connection
   */
  async disconnect() {
    await this.redis.quit();
  }
}

module.exports = OrderBookMigration;