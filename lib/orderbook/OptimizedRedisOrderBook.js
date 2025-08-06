/**
 * Optimized Redis Order Book with Performance Enhancements
 * - Pipeline optimization for batch operations
 * - Redis Cluster support for horizontal scaling
 * - Redis Sentinel for high availability
 * - Connection pooling with optimal settings
 * - Circuit breaker pattern for fault tolerance
 */

const Redis = require('ioredis');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const CircuitBreaker = require('opossum');

class OptimizedRedisOrderBook extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Redis configuration
      redis: {
        enableCluster: config.redis?.enableCluster || false,
        enableSentinel: config.redis?.enableSentinel || false,
        clusterNodes: config.redis?.clusterNodes || [
          { host: 'localhost', port: 7000 },
          { host: 'localhost', port: 7001 },
          { host: 'localhost', port: 7002 }
        ],
        sentinels: config.redis?.sentinels || [
          { host: 'localhost', port: 26379 },
          { host: 'localhost', port: 26380 },
          { host: 'localhost', port: 26381 }
        ],
        masterName: config.redis?.masterName || 'mymaster',
        password: config.redis?.password,
        db: config.redis?.db || 0,
        ...config.redis
      },
      
      // Connection pool settings
      connectionPool: {
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        commandTimeout: 5000,
        enableOfflineQueue: true,
        lazyConnect: false,
        keepAlive: 10000,
        noDelay: true,
        connectionPoolSize: config.connectionPoolSize || 10,
        ...config.connectionPool
      },
      
      // Pipeline settings
      pipeline: {
        batchSize: config.pipeline?.batchSize || 1000,
        flushInterval: config.pipeline?.flushInterval || 10, // ms
        maxPipelineLength: config.pipeline?.maxPipelineLength || 10000,
        ...config.pipeline
      },
      
      // Circuit breaker settings
      circuitBreaker: {
        timeout: config.circuitBreaker?.timeout || 3000,
        errorThresholdPercentage: config.circuitBreaker?.errorThresholdPercentage || 50,
        resetTimeout: config.circuitBreaker?.resetTimeout || 30000,
        rollingCountTimeout: config.circuitBreaker?.rollingCountTimeout || 10000,
        rollingCountBuckets: config.circuitBreaker?.rollingCountBuckets || 10,
        ...config.circuitBreaker
      },
      
      // Order book settings
      pricePrecision: config.pricePrecision || 8,
      amountPrecision: config.amountPrecision || 8,
      ...config
    };
    
    // Initialize Redis connections
    this.initializeRedisConnections();
    
    // State management
    this.pairs = new Map();
    this.pipelines = new Map();
    this.pipelineTimers = new Map();
    this.circuitBreakers = new Map();
    
    // Performance metrics
    this.metrics = {
      pipelineOperations: 0,
      pipelineFlushes: 0,
      circuitBreakerTrips: 0,
      connectionPoolStats: {},
      avgBatchSize: 0,
      totalOperations: 0
    };
    
    // Load Lua scripts
    this.scripts = {};
    this.loadOptimizedScripts();
  }

  /**
   * Initialize Redis connections based on configuration
   */
  initializeRedisConnections() {
    const poolOptions = {
      ...this.config.connectionPool,
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        console.log(`Redis retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      }
    };

    if (this.config.redis.enableCluster) {
      // Redis Cluster setup
      this.redis = new Redis.Cluster(this.config.redis.clusterNodes, {
        redisOptions: poolOptions,
        enableReadyCheck: true,
        maxRedirections: 16,
        retryDelayOnFailover: 100,
        retryDelayOnClusterDown: 300,
        slotsRefreshTimeout: 2000,
        clusterRetryStrategy: (times) => Math.min(100 * times, 1000),
        dnsLookup: (address, callback) => callback(null, address),
        natMap: this.config.redis.natMap
      });
      
      console.log('🔷 Redis Cluster initialized');
      
    } else if (this.config.redis.enableSentinel) {
      // Redis Sentinel setup
      this.redis = new Redis({
        sentinels: this.config.redis.sentinels,
        name: this.config.redis.masterName,
        password: this.config.redis.password,
        sentinelPassword: this.config.redis.sentinelPassword,
        ...poolOptions,
        sentinelRetryStrategy: (times) => Math.min(times * 100, 3000),
        preferredSlaves: this.config.redis.preferredSlaves,
        sentinelCommandTimeout: 5000
      });
      
      console.log('🛡️ Redis Sentinel initialized');
      
    } else {
      // Standard Redis setup
      this.redis = new Redis({
        host: this.config.redis.host || 'localhost',
        port: this.config.redis.port || 6379,
        password: this.config.redis.password,
        db: this.config.redis.db,
        ...poolOptions
      });
      
      console.log('📍 Redis Standard initialized');
    }

    // Create connection pool
    this.connectionPool = [];
    for (let i = 0; i < this.config.connectionPool.connectionPoolSize; i++) {
      const conn = this.redis.duplicate();
      this.connectionPool.push(conn);
    }

    // Setup event handlers
    this.setupRedisEventHandlers();
    
    // Create specialized clients
    this.pubClient = this.redis.duplicate();
    this.subClient = this.redis.duplicate();
    this.streamClient = this.redis.duplicate();
  }

  /**
   * Setup Redis event handlers
   */
  setupRedisEventHandlers() {
    this.redis.on('connect', () => {
      console.log('✅ Redis connected');
      this.emit('redis:connected');
    });

    this.redis.on('error', (error) => {
      console.error('❌ Redis error:', error);
      this.emit('redis:error', error);
    });

    this.redis.on('close', () => {
      console.log('🔌 Redis connection closed');
      this.emit('redis:closed');
    });

    this.redis.on('reconnecting', (delay) => {
      console.log(`🔄 Redis reconnecting in ${delay}ms`);
      this.emit('redis:reconnecting', delay);
    });

    // Cluster-specific events
    if (this.config.redis.enableCluster) {
      this.redis.on('node error', (error, node) => {
        console.error(`Cluster node error [${node}]:`, error);
      });

      this.redis.on('+node', (node) => {
        console.log(`New cluster node added: ${node}`);
      });

      this.redis.on('-node', (node) => {
        console.log(`Cluster node removed: ${node}`);
      });
    }
  }

  /**
   * Load optimized Lua scripts
   */
  async loadOptimizedScripts() {
    // Batch order processing script
    this.scripts.batchProcessOrders = `
      local pair = KEYS[1]
      local operations = cjson.decode(ARGV[1])
      local results = {}
      
      for i, op in ipairs(operations) do
        if op.type == 'add' then
          -- Add order logic
          local sideKey = op.side == 'buy' and 'bids' or 'asks'
          redis.call('ZINCRBY', 'ob:' .. pair .. ':' .. sideKey .. ':prices', op.amount, op.price)
          redis.call('HSET', 'ob:' .. pair .. ':orders', op.id, cjson.encode(op))
          redis.call('ZADD', 'ob:' .. pair .. ':' .. sideKey .. ':orders:' .. op.price, op.timestamp, op.id)
          table.insert(results, {success = true, id = op.id})
          
        elseif op.type == 'cancel' then
          -- Cancel order logic
          local orderData = redis.call('HGET', 'ob:' .. pair .. ':orders', op.id)
          if orderData then
            local order = cjson.decode(orderData)
            local sideKey = order.side == 'buy' and 'bids' or 'asks'
            redis.call('ZINCRBY', 'ob:' .. pair .. ':' .. sideKey .. ':prices', -order.remainingAmount, order.price)
            redis.call('HDEL', 'ob:' .. pair .. ':orders', op.id)
            redis.call('ZREM', 'ob:' .. pair .. ':' .. sideKey .. ':orders:' .. order.price, op.id)
            table.insert(results, {success = true, id = op.id})
          else
            table.insert(results, {success = false, id = op.id, error = 'Order not found'})
          end
          
        elseif op.type == 'update' then
          -- Update order logic
          local orderData = redis.call('HGET', 'ob:' .. pair .. ':orders', op.id)
          if orderData then
            local order = cjson.decode(orderData)
            local sideKey = order.side == 'buy' and 'bids' or 'asks'
            
            -- Remove old amount
            redis.call('ZINCRBY', 'ob:' .. pair .. ':' .. sideKey .. ':prices', -order.remainingAmount, order.price)
            
            -- Update order
            order.price = op.newPrice or order.price
            order.remainingAmount = op.newAmount or order.remainingAmount
            
            -- Add new amount
            redis.call('ZINCRBY', 'ob:' .. pair .. ':' .. sideKey .. ':prices', order.remainingAmount, order.price)
            redis.call('HSET', 'ob:' .. pair .. ':orders', op.id, cjson.encode(order))
            
            table.insert(results, {success = true, id = op.id})
          else
            table.insert(results, {success = false, id = op.id, error = 'Order not found'})
          end
        end
      end
      
      return cjson.encode(results)
    `;

    // Optimized matching script with batching
    this.scripts.batchMatch = `
      local pair = KEYS[1]
      local maxMatches = tonumber(ARGV[1]) or 100
      local matches = {}
      
      -- Get best bid and ask
      local bestBid = redis.call('ZREVRANGE', 'ob:' .. pair .. ':bids:prices', 0, 0, 'WITHSCORES')
      local bestAsk = redis.call('ZRANGE', 'ob:' .. pair .. ':asks:prices', 0, 0, 'WITHSCORES')
      
      if #bestBid < 2 or #bestAsk < 2 then
        return cjson.encode({matches = {}, count = 0})
      end
      
      local bidPrice = tonumber(bestBid[1])
      local askPrice = tonumber(bestAsk[1])
      
      -- Check if prices cross
      if bidPrice >= askPrice then
        -- Get orders at these price levels
        local bidOrders = redis.call('ZRANGE', 'ob:' .. pair .. ':bids:orders:' .. bestBid[1], 0, -1)
        local askOrders = redis.call('ZRANGE', 'ob:' .. pair .. ':asks:orders:' .. bestAsk[1], 0, -1)
        
        -- Match orders
        local bidIdx = 1
        local askIdx = 1
        
        while bidIdx <= #bidOrders and askIdx <= #askOrders and #matches < maxMatches do
          local bidOrder = cjson.decode(redis.call('HGET', 'ob:' .. pair .. ':orders', bidOrders[bidIdx]))
          local askOrder = cjson.decode(redis.call('HGET', 'ob:' .. pair .. ':orders', askOrders[askIdx]))
          
          if bidOrder and askOrder then
            local matchAmount = math.min(bidOrder.remainingAmount, askOrder.remainingAmount)
            local matchPrice = askPrice -- Use ask price for matching
            
            -- Create match record
            local match = {
              id = redis.call('INCR', 'ob:' .. pair .. ':match:id'),
              buyOrderId = bidOrder.id,
              sellOrderId = askOrder.id,
              price = matchPrice,
              amount = matchAmount,
              timestamp = redis.call('TIME')[1]
            }
            
            table.insert(matches, match)
            
            -- Update orders
            bidOrder.remainingAmount = bidOrder.remainingAmount - matchAmount
            askOrder.remainingAmount = askOrder.remainingAmount - matchAmount
            
            if bidOrder.remainingAmount <= 0 then
              redis.call('HDEL', 'ob:' .. pair .. ':orders', bidOrder.id)
              redis.call('ZREM', 'ob:' .. pair .. ':bids:orders:' .. bestBid[1], bidOrder.id)
              bidIdx = bidIdx + 1
            else
              redis.call('HSET', 'ob:' .. pair .. ':orders', bidOrder.id, cjson.encode(bidOrder))
            end
            
            if askOrder.remainingAmount <= 0 then
              redis.call('HDEL', 'ob:' .. pair .. ':orders', askOrder.id)
              redis.call('ZREM', 'ob:' .. pair .. ':asks:orders:' .. bestAsk[1], askOrder.id)
              askIdx = askIdx + 1
            else
              redis.call('HSET', 'ob:' .. pair .. ':orders', askOrder.id, cjson.encode(askOrder))
            end
            
            -- Update price levels
            redis.call('ZINCRBY', 'ob:' .. pair .. ':bids:prices', -matchAmount, bestBid[1])
            redis.call('ZINCRBY', 'ob:' .. pair .. ':asks:prices', -matchAmount, bestAsk[1])
          end
        end
        
        -- Clean up empty price levels
        redis.call('ZREMRANGEBYSCORE', 'ob:' .. pair .. ':bids:prices', 0, 0)
        redis.call('ZREMRANGEBYSCORE', 'ob:' .. pair .. ':asks:prices', 0, 0)
      end
      
      return cjson.encode({matches = matches, count = #matches})
    `;
  }

  /**
   * Get or create pipeline for a trading pair
   */
  getPipeline(pair) {
    if (!this.pipelines.has(pair)) {
      const pipeline = this.redis.pipeline();
      this.pipelines.set(pair, {
        pipeline,
        operations: 0,
        lastFlush: Date.now()
      });
      
      // Setup auto-flush timer
      const timer = setInterval(() => {
        this.flushPipeline(pair);
      }, this.config.pipeline.flushInterval);
      
      this.pipelineTimers.set(pair, timer);
    }
    
    return this.pipelines.get(pair);
  }

  /**
   * Add operation to pipeline with circuit breaker
   */
  async addToPipeline(pair, operation) {
    const breaker = this.getCircuitBreaker(pair);
    
    return breaker.fire(async () => {
      const pipelineInfo = this.getPipeline(pair);
      
      // Add operation to pipeline
      switch (operation.type) {
        case 'addOrder':
          this.addOrderToPipeline(pipelineInfo.pipeline, operation);
          break;
        case 'cancelOrder':
          this.cancelOrderInPipeline(pipelineInfo.pipeline, operation);
          break;
        case 'updateOrder':
          this.updateOrderInPipeline(pipelineInfo.pipeline, operation);
          break;
      }
      
      pipelineInfo.operations++;
      
      // Check if we should flush
      if (pipelineInfo.operations >= this.config.pipeline.batchSize ||
          pipelineInfo.pipeline.length >= this.config.pipeline.maxPipelineLength) {
        await this.flushPipeline(pair);
      }
      
      return { success: true, operation: operation.type };
    });
  }

  /**
   * Flush pipeline for a trading pair
   */
  async flushPipeline(pair) {
    const pipelineInfo = this.pipelines.get(pair);
    if (!pipelineInfo || pipelineInfo.operations === 0) return;
    
    const startTime = performance.now();
    
    try {
      // Execute pipeline
      const results = await pipelineInfo.pipeline.exec();
      
      // Update metrics
      this.metrics.pipelineFlushes++;
      this.metrics.pipelineOperations += pipelineInfo.operations;
      this.metrics.avgBatchSize = 
        (this.metrics.avgBatchSize * (this.metrics.pipelineFlushes - 1) + pipelineInfo.operations) / 
        this.metrics.pipelineFlushes;
      
      // Reset pipeline
      pipelineInfo.pipeline = this.redis.pipeline();
      pipelineInfo.operations = 0;
      pipelineInfo.lastFlush = Date.now();
      
      // Emit metrics
      this.emit('pipeline:flushed', {
        pair,
        operations: results.length,
        duration: performance.now() - startTime
      });
      
      return results;
      
    } catch (error) {
      console.error(`Pipeline flush error for ${pair}:`, error);
      // Reset pipeline on error
      pipelineInfo.pipeline = this.redis.pipeline();
      pipelineInfo.operations = 0;
      throw error;
    }
  }

  /**
   * Get or create circuit breaker for a trading pair
   */
  getCircuitBreaker(pair) {
    if (!this.circuitBreakers.has(pair)) {
      const breaker = new CircuitBreaker(
        async (operation) => operation,
        this.config.circuitBreaker
      );
      
      // Circuit breaker event handlers
      breaker.on('open', () => {
        console.error(`Circuit breaker opened for ${pair}`);
        this.metrics.circuitBreakerTrips++;
        this.emit('circuitBreaker:open', { pair });
      });
      
      breaker.on('halfOpen', () => {
        console.log(`Circuit breaker half-open for ${pair}`);
        this.emit('circuitBreaker:halfOpen', { pair });
      });
      
      breaker.on('close', () => {
        console.log(`Circuit breaker closed for ${pair}`);
        this.emit('circuitBreaker:close', { pair });
      });
      
      this.circuitBreakers.set(pair, breaker);
    }
    
    return this.circuitBreakers.get(pair);
  }

  /**
   * Place order with optimizations
   */
  async placeOrder(order) {
    const operation = {
      type: 'addOrder',
      ...order,
      timestamp: Date.now()
    };
    
    return this.addToPipeline(order.pair, operation);
  }

  /**
   * Cancel order with optimizations
   */
  async cancelOrder(orderId, pair) {
    const operation = {
      type: 'cancelOrder',
      id: orderId,
      pair
    };
    
    return this.addToPipeline(pair, operation);
  }

  /**
   * Batch process multiple operations
   */
  async batchProcess(pair, operations) {
    const breaker = this.getCircuitBreaker(pair);
    
    return breaker.fire(async () => {
      const startTime = performance.now();
      
      // Use Lua script for atomic batch processing
      const result = await this.redis.eval(
        this.scripts.batchProcessOrders,
        1,
        pair,
        JSON.stringify(operations)
      );
      
      const results = JSON.parse(result);
      
      // Update metrics
      this.metrics.totalOperations += operations.length;
      
      this.emit('batch:processed', {
        pair,
        operations: operations.length,
        duration: performance.now() - startTime,
        results
      });
      
      return results;
    });
  }

  /**
   * Execute matching with batching
   */
  async executeMatching(pair, maxMatches = 100) {
    const breaker = this.getCircuitBreaker(pair);
    
    return breaker.fire(async () => {
      const result = await this.redis.eval(
        this.scripts.batchMatch,
        1,
        pair,
        maxMatches
      );
      
      return JSON.parse(result);
    });
  }

  /**
   * Get order book with connection pooling
   */
  async getOrderBook(pair, depth = 20) {
    // Use connection from pool
    const conn = this.getConnectionFromPool();
    
    try {
      const multi = conn.multi();
      
      multi.zrevrange(`ob:${pair}:bids:prices`, 0, depth - 1, 'WITHSCORES');
      multi.zrange(`ob:${pair}:asks:prices`, 0, depth - 1, 'WITHSCORES');
      multi.get(`ob:${pair}:sequence`);
      
      const [[, bids], [, asks], [, sequence]] = await multi.exec();
      
      return {
        pair,
        bids: this.formatPriceLevels(bids),
        asks: this.formatPriceLevels(asks),
        sequence: parseInt(sequence) || 0,
        timestamp: Date.now()
      };
      
    } finally {
      // Connection is automatically returned to pool
    }
  }

  /**
   * Get connection from pool
   */
  getConnectionFromPool() {
    // Round-robin connection selection
    const index = Math.floor(Math.random() * this.connectionPool.length);
    return this.connectionPool[index];
  }

  /**
   * Pipeline operation helpers
   */
  addOrderToPipeline(pipeline, order) {
    const side = order.side.toLowerCase();
    const sideKey = side === 'buy' ? 'bids' : 'asks';
    const price = this.normalizePrice(order.price);
    const amount = this.normalizeAmount(order.amount);
    
    pipeline.hset(
      `ob:${order.pair}:orders`,
      order.id,
      JSON.stringify({
        ...order,
        remainingAmount: order.amount,
        status: 'open'
      })
    );
    
    pipeline.zincrby(`ob:${order.pair}:${sideKey}:prices`, amount, price);
    pipeline.zadd(`ob:${order.pair}:${sideKey}:orders:${price}`, order.timestamp, order.id);
    pipeline.sadd(`ob:${order.pair}:users:${order.userId}`, order.id);
    pipeline.incr(`ob:${order.pair}:sequence`);
  }

  cancelOrderInPipeline(pipeline, operation) {
    // Note: This is a simplified version. In production, you'd need to
    // fetch the order first or use a Lua script for atomicity
    pipeline.hdel(`ob:${operation.pair}:orders`, operation.id);
  }

  updateOrderInPipeline(pipeline, operation) {
    // Note: This is a simplified version. In production, you'd need to
    // use a Lua script for atomic updates
    if (operation.newPrice || operation.newAmount) {
      pipeline.hset(
        `ob:${operation.pair}:orders`,
        operation.id,
        JSON.stringify({
          ...operation,
          price: operation.newPrice,
          amount: operation.newAmount
        })
      );
    }
  }

  /**
   * Health check with circuit breaker status
   */
  async healthCheck() {
    const health = {
      redis: {
        connected: this.redis.status === 'ready',
        mode: this.config.redis.enableCluster ? 'cluster' : 
               this.config.redis.enableSentinel ? 'sentinel' : 'standalone'
      },
      connectionPool: {
        size: this.connectionPool.length,
        active: this.connectionPool.filter(c => c.status === 'ready').length
      },
      circuitBreakers: {},
      pipelines: {},
      metrics: this.metrics
    };
    
    // Check circuit breakers
    for (const [pair, breaker] of this.circuitBreakers) {
      health.circuitBreakers[pair] = {
        state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
        stats: breaker.stats
      };
    }
    
    // Check pipelines
    for (const [pair, pipeline] of this.pipelines) {
      health.pipelines[pair] = {
        operations: pipeline.operations,
        lastFlush: pipeline.lastFlush
      };
    }
    
    // Cluster health (if applicable)
    if (this.config.redis.enableCluster) {
      try {
        const clusterInfo = await this.redis.cluster('info');
        health.redis.cluster = {
          state: clusterInfo.includes('cluster_state:ok') ? 'ok' : 'fail',
          nodes: await this.redis.cluster('nodes')
        };
      } catch (error) {
        health.redis.cluster = { error: error.message };
      }
    }
    
    return health;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('🔄 Shutting down optimized order book...');
    
    // Flush all pending pipelines
    for (const [pair] of this.pipelines) {
      await this.flushPipeline(pair);
    }
    
    // Clear timers
    for (const timer of this.pipelineTimers.values()) {
      clearInterval(timer);
    }
    
    // Close circuit breakers
    for (const breaker of this.circuitBreakers.values()) {
      breaker.shutdown();
    }
    
    // Close Redis connections
    await Promise.all([
      this.redis.quit(),
      this.pubClient.quit(),
      this.subClient.quit(),
      this.streamClient.quit(),
      ...this.connectionPool.map(conn => conn.quit())
    ]);
    
    console.log('✅ Shutdown complete');
  }

  /**
   * Utility methods
   */
  normalizePrice(price) {
    return parseFloat(price).toFixed(this.config.pricePrecision);
  }

  normalizeAmount(amount) {
    return parseFloat(amount).toFixed(this.config.amountPrecision);
  }

  formatPriceLevels(levels) {
    const formatted = [];
    for (let i = 0; i < levels.length; i += 2) {
      formatted.push([
        parseFloat(levels[i]),
        parseFloat(levels[i + 1])
      ]);
    }
    return formatted;
  }
}

module.exports = OptimizedRedisOrderBook;