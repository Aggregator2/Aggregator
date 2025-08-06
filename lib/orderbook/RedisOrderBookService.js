const Redis = require('ioredis');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');

/**
 * High-performance order book service using Redis sorted sets
 * Supports millions of orders with O(log n) operations
 */
class RedisOrderBookService extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Redis clients
    this.redis = new Redis({
      host: config.redisHost || 'localhost',
      port: config.redisPort || 6379,
      db: config.redisDb || 0,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      ...config.redisOptions
    });

    // Separate client for pub/sub
    this.pubClient = this.redis.duplicate();
    this.subClient = this.redis.duplicate();
    
    // Configuration
    this.config = {
      batchSize: config.batchSize || 1000,
      batchInterval: config.batchInterval || 100, // ms
      snapshotInterval: config.snapshotInterval || 60000, // 1 minute
      maxOrdersPerLevel: config.maxOrdersPerLevel || 10000,
      pricePrecision: config.pricePrecision || 8,
      amountPrecision: config.amountPrecision || 8,
      ...config
    };
    
    // State
    this.pairs = new Map(); // trading pair configurations
    this.batchQueues = new Map(); // batch processing queues
    this.snapshotTimers = new Map(); // snapshot scheduling
    this.metrics = {
      ordersProcessed: 0,
      batchesProcessed: 0,
      snapshotsCreated: 0,
      lastProcessingTime: 0
    };
    
    // Initialize pub/sub
    this.setupPubSub();
    
    // Lua scripts for atomic operations
    this.scripts = this.loadLuaScripts();
  }

  /**
   * Initialize a trading pair
   */
  async initializePair(pair, config = {}) {
    const pairConfig = {
      baseAsset: config.baseAsset,
      quoteAsset: config.quoteAsset,
      minPrice: config.minPrice || 0.00000001,
      maxPrice: config.maxPrice || 1000000,
      minAmount: config.minAmount || 0.00000001,
      tickSize: config.tickSize || 0.00000001,
      ...config
    };
    
    this.pairs.set(pair, pairConfig);
    
    // Initialize batch queue
    this.batchQueues.set(pair, []);
    this.startBatchProcessor(pair);
    
    // Initialize snapshot timer
    this.startSnapshotTimer(pair);
    
    // Create initial empty order book structure
    await this.initializeOrderBookKeys(pair);
    
    return pairConfig;
  }

  /**
   * Add order to order book using Redis sorted sets
   * O(log n) complexity
   */
  async addOrder(order) {
    const startTime = performance.now();
    
    // Validate order
    this.validateOrder(order);
    
    // Add to batch queue for processing
    const queue = this.batchQueues.get(order.pair);
    if (!queue) {
      throw new Error(`Trading pair ${order.pair} not initialized`);
    }
    
    queue.push({
      action: 'add',
      order: {
        ...order,
        timestamp: Date.now(),
        sequenceId: await this.getNextSequenceId(order.pair)
      }
    });
    
    // Process immediately if batch is full
    if (queue.length >= this.config.batchSize) {
      await this.processBatch(order.pair);
    }
    
    this.metrics.lastProcessingTime = performance.now() - startTime;
    
    return order;
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId, pair) {
    const queue = this.batchQueues.get(pair);
    if (!queue) {
      throw new Error(`Trading pair ${pair} not initialized`);
    }
    
    queue.push({
      action: 'cancel',
      orderId,
      pair,
      timestamp: Date.now()
    });
    
    if (queue.length >= this.config.batchSize) {
      await this.processBatch(pair);
    }
  }

  /**
   * Update order (cancel and replace atomically)
   */
  async updateOrder(orderId, pair, updates) {
    const queue = this.batchQueues.get(pair);
    if (!queue) {
      throw new Error(`Trading pair ${pair} not initialized`);
    }
    
    queue.push({
      action: 'update',
      orderId,
      pair,
      updates,
      timestamp: Date.now()
    });
    
    if (queue.length >= this.config.batchSize) {
      await this.processBatch(pair);
    }
  }

  /**
   * Get order book snapshot with price level aggregation
   */
  async getOrderBook(pair, depth = 20) {
    const multi = this.redis.multi();
    
    // Get best bids (highest prices first)
    multi.zrevrange(`ob:${pair}:bids:prices`, 0, depth - 1, 'WITHSCORES');
    
    // Get best asks (lowest prices first)
    multi.zrange(`ob:${pair}:asks:prices`, 0, depth - 1, 'WITHSCORES');
    
    const [[, bids], [, asks]] = await multi.exec();
    
    // Format and aggregate by price level
    const formatLevels = async (levels, side) => {
      const formatted = [];
      
      for (let i = 0; i < levels.length; i += 2) {
        const price = levels[i];
        const aggregatedAmount = levels[i + 1];
        
        // Get individual orders at this price level if needed
        const ordersKey = `ob:${pair}:${side}:orders:${price}`;
        const orderCount = await this.redis.zcard(ordersKey);
        
        formatted.push({
          price: parseFloat(price),
          amount: parseFloat(aggregatedAmount),
          orderCount,
          total: parseFloat(price) * parseFloat(aggregatedAmount)
        });
      }
      
      return formatted;
    };
    
    const [formattedBids, formattedAsks] = await Promise.all([
      formatLevels(bids, 'bids'),
      formatLevels(asks, 'asks')
    ]);
    
    return {
      pair,
      timestamp: Date.now(),
      sequenceId: await this.redis.get(`ob:${pair}:sequence`),
      bids: formattedBids,
      asks: formattedAsks,
      spread: formattedAsks[0] && formattedBids[0] 
        ? formattedAsks[0].price - formattedBids[0].price 
        : null
    };
  }

  /**
   * Get market depth data
   */
  async getMarketDepth(pair, priceRange = 0.1) {
    const orderBook = await this.getOrderBook(pair, 1);
    if (!orderBook.bids[0] || !orderBook.asks[0]) {
      return { bids: [], asks: [] };
    }
    
    const midPrice = (orderBook.bids[0].price + orderBook.asks[0].price) / 2;
    const minPrice = midPrice * (1 - priceRange);
    const maxPrice = midPrice * (1 + priceRange);
    
    const multi = this.redis.multi();
    
    // Get all bids within range
    multi.zrevrangebyscore(`ob:${pair}:bids:prices`, maxPrice, minPrice, 'WITHSCORES');
    
    // Get all asks within range
    multi.zrangebyscore(`ob:${pair}:asks:prices`, minPrice, maxPrice, 'WITHSCORES');
    
    const [[, bids], [, asks]] = await multi.exec();
    
    // Aggregate depth data
    const aggregateDepth = (levels) => {
      const depth = [];
      let cumulativeAmount = 0;
      let cumulativeTotal = 0;
      
      for (let i = 0; i < levels.length; i += 2) {
        const price = parseFloat(levels[i]);
        const amount = parseFloat(levels[i + 1]);
        
        cumulativeAmount += amount;
        cumulativeTotal += price * amount;
        
        depth.push({
          price,
          amount,
          cumulativeAmount,
          cumulativeTotal
        });
      }
      
      return depth;
    };
    
    return {
      pair,
      timestamp: Date.now(),
      midPrice,
      bids: aggregateDepth(bids),
      asks: aggregateDepth(asks)
    };
  }

  /**
   * Process batch of order operations
   */
  async processBatch(pair) {
    const queue = this.batchQueues.get(pair);
    if (!queue || queue.length === 0) return;
    
    const batch = queue.splice(0, this.config.batchSize);
    const startTime = performance.now();
    
    const pipeline = this.redis.pipeline();
    const notifications = [];
    
    for (const operation of batch) {
      switch (operation.action) {
        case 'add':
          await this.addOrderToPipeline(pipeline, operation.order, notifications);
          break;
          
        case 'cancel':
          await this.cancelOrderInPipeline(pipeline, operation.orderId, operation.pair, notifications);
          break;
          
        case 'update':
          await this.updateOrderInPipeline(pipeline, operation, notifications);
          break;
      }
    }
    
    // Execute pipeline
    await pipeline.exec();
    
    // Publish notifications
    if (notifications.length > 0) {
      await this.publishBatchNotifications(pair, notifications);
    }
    
    // Update metrics
    this.metrics.ordersProcessed += batch.length;
    this.metrics.batchesProcessed++;
    this.metrics.lastBatchProcessingTime = performance.now() - startTime;
    
    // Emit batch processed event
    this.emit('batchProcessed', {
      pair,
      operationsCount: batch.length,
      processingTime: this.metrics.lastBatchProcessingTime
    });
  }

  /**
   * Add order to Redis pipeline
   */
  async addOrderToPipeline(pipeline, order, notifications) {
    const side = order.side.toLowerCase();
    const price = this.normalizePrice(order.price);
    const amount = this.normalizeAmount(order.amount);
    
    // Store order data
    pipeline.hset(
      `ob:${order.pair}:orders`,
      order.id,
      JSON.stringify({
        id: order.id,
        userId: order.userId,
        pair: order.pair,
        side: order.side,
        type: order.type,
        price: order.price,
        amount: order.amount,
        remainingAmount: order.amount,
        status: 'open',
        timestamp: order.timestamp,
        sequenceId: order.sequenceId
      })
    );
    
    // Add to price level
    pipeline.zincrby(`ob:${order.pair}:${side}:prices`, amount, price);
    
    // Add to orders at price level
    pipeline.zadd(
      `ob:${order.pair}:${side}:orders:${price}`,
      order.timestamp,
      order.id
    );
    
    // Add to user's orders
    pipeline.sadd(`ob:${order.pair}:users:${order.userId}`, order.id);
    
    // Update sequence
    pipeline.set(`ob:${order.pair}:sequence`, order.sequenceId);
    
    // Add notification
    notifications.push({
      type: 'orderAdded',
      data: order,
      timestamp: Date.now()
    });
  }

  /**
   * Cancel order in pipeline
   */
  async cancelOrderInPipeline(pipeline, orderId, pair, notifications) {
    // Get order data first
    const orderData = await this.redis.hget(`ob:${pair}:orders`, orderId);
    if (!orderData) return;
    
    const order = JSON.parse(orderData);
    const side = order.side.toLowerCase();
    const price = this.normalizePrice(order.price);
    
    // Remove from orders hash
    pipeline.hdel(`ob:${pair}:orders`, orderId);
    
    // Decrease amount at price level
    pipeline.zincrby(
      `ob:${pair}:${side}:prices`,
      -order.remainingAmount,
      price
    );
    
    // Remove from price level orders
    pipeline.zrem(`ob:${pair}:${side}:orders:${price}`, orderId);
    
    // Remove from user's orders
    pipeline.srem(`ob:${pair}:users:${order.userId}`, orderId);
    
    // Clean up empty price levels
    pipeline.zremrangebyscore(`ob:${pair}:${side}:prices`, 0, 0);
    
    // Add notification
    notifications.push({
      type: 'orderCancelled',
      data: { orderId, order },
      timestamp: Date.now()
    });
  }

  /**
   * Create order book snapshot for recovery
   */
  async createSnapshot(pair) {
    const startTime = performance.now();
    
    // Get current sequence ID
    const sequenceId = await this.redis.get(`ob:${pair}:sequence`) || 0;
    
    // Get all order data
    const orders = await this.redis.hgetall(`ob:${pair}:orders`);
    
    // Get price levels
    const [bids, asks] = await Promise.all([
      this.redis.zrevrange(`ob:${pair}:bids:prices`, 0, -1, 'WITHSCORES'),
      this.redis.zrange(`ob:${pair}:asks:prices`, 0, -1, 'WITHSCORES')
    ]);
    
    const snapshot = {
      pair,
      timestamp: Date.now(),
      sequenceId,
      orders: Object.entries(orders).map(([id, data]) => ({
        id,
        ...JSON.parse(data)
      })),
      orderBook: {
        bids: this.formatPriceLevels(bids),
        asks: this.formatPriceLevels(asks)
      }
    };
    
    // Store snapshot
    const snapshotKey = `ob:${pair}:snapshots:${Date.now()}`;
    await this.redis.setex(
      snapshotKey,
      86400, // 24 hour TTL
      JSON.stringify(snapshot)
    );
    
    // Keep only last 10 snapshots
    const snapshotKeys = await this.redis.keys(`ob:${pair}:snapshots:*`);
    if (snapshotKeys.length > 10) {
      const keysToDelete = snapshotKeys
        .sort()
        .slice(0, snapshotKeys.length - 10);
      await this.redis.del(...keysToDelete);
    }
    
    this.metrics.snapshotsCreated++;
    this.metrics.lastSnapshotTime = performance.now() - startTime;
    
    this.emit('snapshotCreated', {
      pair,
      sequenceId,
      processingTime: this.metrics.lastSnapshotTime
    });
    
    return snapshot;
  }

  /**
   * Restore order book from snapshot
   */
  async restoreFromSnapshot(pair, snapshotTimestamp) {
    const snapshotKey = snapshotTimestamp 
      ? `ob:${pair}:snapshots:${snapshotTimestamp}`
      : await this.getLatestSnapshotKey(pair);
    
    if (!snapshotKey) {
      throw new Error('No snapshot found');
    }
    
    const snapshotData = await this.redis.get(snapshotKey);
    if (!snapshotData) {
      throw new Error('Snapshot data not found');
    }
    
    const snapshot = JSON.parse(snapshotData);
    
    // Clear current order book
    await this.clearOrderBook(pair);
    
    // Restore orders
    const pipeline = this.redis.pipeline();
    
    for (const order of snapshot.orders) {
      pipeline.hset(
        `ob:${pair}:orders`,
        order.id,
        JSON.stringify(order)
      );
      
      const side = order.side.toLowerCase();
      const price = this.normalizePrice(order.price);
      
      pipeline.zincrby(
        `ob:${pair}:${side}:prices`,
        order.remainingAmount,
        price
      );
      
      pipeline.zadd(
        `ob:${pair}:${side}:orders:${price}`,
        order.timestamp,
        order.id
      );
      
      pipeline.sadd(`ob:${pair}:users:${order.userId}`, order.id);
    }
    
    // Restore sequence ID
    pipeline.set(`ob:${pair}:sequence`, snapshot.sequenceId);
    
    await pipeline.exec();
    
    this.emit('snapshotRestored', {
      pair,
      snapshotTimestamp: snapshot.timestamp,
      ordersRestored: snapshot.orders.length
    });
    
    return snapshot;
  }

  /**
   * WebSocket notification publishing
   */
  async publishBatchNotifications(pair, notifications) {
    const channel = `orderbook:${pair}`;
    
    // Group notifications by type for efficiency
    const grouped = notifications.reduce((acc, notif) => {
      if (!acc[notif.type]) acc[notif.type] = [];
      acc[notif.type].push(notif.data);
      return acc;
    }, {});
    
    // Publish grouped notifications
    for (const [type, data] of Object.entries(grouped)) {
      await this.pubClient.publish(channel, JSON.stringify({
        type,
        pair,
        data,
        timestamp: Date.now(),
        sequenceId: await this.redis.get(`ob:${pair}:sequence`)
      }));
    }
  }

  /**
   * Subscribe to order book updates
   */
  subscribeToOrderBook(pair, callback) {
    const channel = `orderbook:${pair}`;
    
    this.subClient.subscribe(channel);
    
    this.subClient.on('message', (receivedChannel, message) => {
      if (receivedChannel === channel) {
        try {
          const data = JSON.parse(message);
          callback(data);
        } catch (error) {
          console.error('Failed to parse order book message:', error);
        }
      }
    });
    
    return () => {
      this.subClient.unsubscribe(channel);
    };
  }

  /**
   * Get order book statistics
   */
  async getStatistics(pair) {
    const multi = this.redis.multi();
    
    multi.zcard(`ob:${pair}:bids:prices`);
    multi.zcard(`ob:${pair}:asks:prices`);
    multi.hlen(`ob:${pair}:orders`);
    multi.get(`ob:${pair}:sequence`);
    
    const [[, bidLevels], [, askLevels], [, totalOrders], [, sequenceId]] = await multi.exec();
    
    // Get best bid/ask
    const [bestBid] = await this.redis.zrevrange(`ob:${pair}:bids:prices`, 0, 0, 'WITHSCORES');
    const [bestAsk] = await this.redis.zrange(`ob:${pair}:asks:prices`, 0, 0, 'WITHSCORES');
    
    return {
      pair,
      timestamp: Date.now(),
      bidLevels: parseInt(bidLevels),
      askLevels: parseInt(askLevels),
      totalOrders: parseInt(totalOrders),
      sequenceId: parseInt(sequenceId) || 0,
      bestBid: bestBid ? parseFloat(bestBid) : null,
      bestAsk: bestAsk ? parseFloat(bestAsk) : null,
      spread: bestBid && bestAsk ? parseFloat(bestAsk) - parseFloat(bestBid) : null,
      metrics: this.metrics
    };
  }

  /**
   * Memory optimization - clear old filled orders
   */
  async cleanupFilledOrders(pair, retentionHours = 24) {
    const cutoffTime = Date.now() - (retentionHours * 60 * 60 * 1000);
    
    // Get all orders
    const orders = await this.redis.hgetall(`ob:${pair}:orders`);
    
    const pipeline = this.redis.pipeline();
    let cleaned = 0;
    
    for (const [orderId, orderData] of Object.entries(orders)) {
      const order = JSON.parse(orderData);
      
      if (order.status === 'filled' && order.timestamp < cutoffTime) {
        pipeline.hdel(`ob:${pair}:orders`, orderId);
        pipeline.srem(`ob:${pair}:users:${order.userId}`, orderId);
        cleaned++;
      }
    }
    
    await pipeline.exec();
    
    this.emit('cleanupCompleted', {
      pair,
      ordersRemoved: cleaned
    });
    
    return cleaned;
  }

  // Helper methods

  validateOrder(order) {
    if (!order.id || !order.pair || !order.side || !order.price || !order.amount) {
      throw new Error('Invalid order: missing required fields');
    }
    
    const pairConfig = this.pairs.get(order.pair);
    if (!pairConfig) {
      throw new Error(`Trading pair ${order.pair} not configured`);
    }
    
    if (order.price < pairConfig.minPrice || order.price > pairConfig.maxPrice) {
      throw new Error('Order price out of range');
    }
    
    if (order.amount < pairConfig.minAmount) {
      throw new Error('Order amount below minimum');
    }
  }

  normalizePrice(price) {
    return parseFloat(price).toFixed(this.config.pricePrecision);
  }

  normalizeAmount(amount) {
    return parseFloat(amount).toFixed(this.config.amountPrecision);
  }

  formatPriceLevels(levels) {
    const formatted = [];
    for (let i = 0; i < levels.length; i += 2) {
      formatted.push({
        price: parseFloat(levels[i]),
        amount: parseFloat(levels[i + 1])
      });
    }
    return formatted;
  }

  async getNextSequenceId(pair) {
    return await this.redis.incr(`ob:${pair}:sequence`);
  }

  async initializeOrderBookKeys(pair) {
    const multi = this.redis.multi();
    
    multi.set(`ob:${pair}:sequence`, 0);
    multi.del(`ob:${pair}:bids:prices`);
    multi.del(`ob:${pair}:asks:prices`);
    multi.del(`ob:${pair}:orders`);
    
    await multi.exec();
  }

  async clearOrderBook(pair) {
    const keys = await this.redis.keys(`ob:${pair}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async getLatestSnapshotKey(pair) {
    const keys = await this.redis.keys(`ob:${pair}:snapshots:*`);
    return keys.sort().pop();
  }

  startBatchProcessor(pair) {
    setInterval(() => {
      this.processBatch(pair);
    }, this.config.batchInterval);
  }

  startSnapshotTimer(pair) {
    const timer = setInterval(() => {
      this.createSnapshot(pair);
    }, this.config.snapshotInterval);
    
    this.snapshotTimers.set(pair, timer);
  }

  setupPubSub() {
    this.subClient.on('error', (error) => {
      console.error('Redis subscription error:', error);
      this.emit('error', error);
    });
    
    this.pubClient.on('error', (error) => {
      console.error('Redis publish error:', error);
      this.emit('error', error);
    });
  }

  loadLuaScripts() {
    // Lua scripts for atomic operations
    return {
      // Atomic order matching script
      matchOrder: `
        local orderKey = KEYS[1]
        local priceKey = KEYS[2]
        local ordersAtPriceKey = KEYS[3]
        local orderId = ARGV[1]
        local amount = tonumber(ARGV[2])
        
        -- Check if order exists
        local orderData = redis.call('hget', orderKey, orderId)
        if not orderData then
          return nil
        end
        
        -- Update order amount
        local order = cjson.decode(orderData)
        order.remainingAmount = order.remainingAmount - amount
        
        if order.remainingAmount <= 0 then
          -- Remove order
          redis.call('hdel', orderKey, orderId)
          redis.call('zrem', ordersAtPriceKey, orderId)
        else
          -- Update order
          redis.call('hset', orderKey, orderId, cjson.encode(order))
        end
        
        -- Update price level
        redis.call('zincrby', priceKey, -amount, order.price)
        
        return order
      `
    };
  }

  async disconnect() {
    // Clear timers
    for (const timer of this.snapshotTimers.values()) {
      clearInterval(timer);
    }
    
    // Close Redis connections
    await this.redis.quit();
    await this.pubClient.quit();
    await this.subClient.quit();
  }
}

module.exports = RedisOrderBookService;