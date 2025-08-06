/**
 * Enhanced Redis Order Book with Advanced Features
 * - Redis Sorted Sets for O(log n) operations
 * - Redis MULTI/EXEC for atomic matching
 * - Lua scripts for complex matching logic
 * - Redis Streams for real-time updates
 * - Redis pub/sub for WebSocket notifications
 */

const Redis = require('ioredis');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');

class EnhancedRedisOrderBook extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Redis connections
    this.redis = new Redis({
      host: config.redisHost || 'localhost',
      port: config.redisPort || 6379,
      db: config.redisDb || 0,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: false,
      ...config.redisOptions
    });

    // Separate connections for different purposes
    this.pubClient = this.redis.duplicate();
    this.subClient = this.redis.duplicate();
    this.streamClient = this.redis.duplicate();
    
    // Configuration
    this.config = {
      streamMaxLen: config.streamMaxLen || 10000,
      streamTrimInterval: config.streamTrimInterval || 60000, // 1 minute
      matchingBatchSize: config.matchingBatchSize || 100,
      pricePrecision: config.pricePrecision || 8,
      amountPrecision: config.amountPrecision || 8,
      enableMEVProtection: config.enableMEVProtection !== false,
      ...config
    };
    
    // State
    this.pairs = new Map();
    this.scripts = {};
    this.streamGroups = new Map();
    this.wsSubscriptions = new Map();
    
    // Performance metrics
    this.metrics = {
      ordersProcessed: 0,
      matchesExecuted: 0,
      streamEventsPublished: 0,
      avgMatchingLatency: 0
    };
    
    this.initialize();
  }

  async initialize() {
    // Load Lua scripts
    await this.loadLuaScripts();
    
    // Setup Redis Streams
    await this.setupStreams();
    
    // Setup pub/sub
    this.setupPubSub();
    
    // Start stream trimming
    this.startStreamMaintenance();
    
    console.log('🚀 Enhanced Redis Order Book initialized');
  }

  /**
   * Load Lua scripts for atomic operations
   */
  async loadLuaScripts() {
    // Complex order matching script
    this.scripts.matchOrders = await this.redis.script('LOAD', `
      -- Match orders with price-time priority
      local pair = KEYS[1]
      local side = ARGV[1] -- 'buy' or 'sell'
      local counterSide = side == 'buy' and 'sell' or 'buy'
      local maxMatches = tonumber(ARGV[2]) or 100
      
      local matches = {}
      local matchCount = 0
      
      -- Get best prices from counter side
      local counterPrices
      if counterSide == 'sell' then
        counterPrices = redis.call('ZRANGE', 'ob:' .. pair .. ':asks:prices', 0, -1, 'WITHSCORES')
      else
        counterPrices = redis.call('ZREVRANGE', 'ob:' .. pair .. ':bids:prices', 0, -1, 'WITHSCORES')
      end
      
      -- Get incoming order
      local incomingPrices
      if side == 'buy' then
        incomingPrices = redis.call('ZREVRANGE', 'ob:' .. pair .. ':bids:prices', 0, 0, 'WITHSCORES')
      else
        incomingPrices = redis.call('ZRANGE', 'ob:' .. pair .. ':asks:prices', 0, 0, 'WITHSCORES')
      end
      
      if #incomingPrices < 2 or #counterPrices < 2 then
        return cjson.encode({matches = {}, count = 0})
      end
      
      local incomingPrice = tonumber(incomingPrices[1])
      local incomingAmount = tonumber(incomingPrices[2])
      
      -- Match orders
      for i = 1, #counterPrices, 2 do
        local counterPrice = tonumber(counterPrices[i])
        local counterAmount = tonumber(counterPrices[i + 1])
        
        -- Check if prices cross
        local priceMatch = false
        if side == 'buy' then
          priceMatch = incomingPrice >= counterPrice
        else
          priceMatch = incomingPrice <= counterPrice
        end
        
        if priceMatch and matchCount < maxMatches then
          -- Get orders at this price level
          local ordersKey = 'ob:' .. pair .. ':' .. counterSide .. 's:orders:' .. counterPrices[i]
          local orders = redis.call('ZRANGE', ordersKey, 0, -1)
          
          for _, orderId in ipairs(orders) do
            local orderData = redis.call('HGET', 'ob:' .. pair .. ':orders', orderId)
            if orderData then
              local order = cjson.decode(orderData)
              
              -- Calculate match amount
              local matchAmount = math.min(incomingAmount, order.remainingAmount)
              
              -- Create match
              local match = {
                id = redis.call('INCR', 'ob:' .. pair .. ':match:id'),
                buyOrderId = side == 'buy' and 'incoming' or orderId,
                sellOrderId = side == 'sell' and 'incoming' or orderId,
                price = counterPrice,
                amount = matchAmount,
                timestamp = redis.call('TIME')[1]
              }
              
              table.insert(matches, match)
              matchCount = matchCount + 1
              
              -- Update order
              order.remainingAmount = order.remainingAmount - matchAmount
              order.filledAmount = (order.filledAmount or 0) + matchAmount
              
              if order.remainingAmount <= 0 then
                order.status = 'filled'
                redis.call('HDEL', 'ob:' .. pair .. ':orders', orderId)
                redis.call('ZREM', ordersKey, orderId)
              else
                order.status = 'partial'
                redis.call('HSET', 'ob:' .. pair .. ':orders', orderId, cjson.encode(order))
              end
              
              -- Update price level
              local newAmount = counterAmount - matchAmount
              if newAmount <= 0 then
                redis.call('ZREM', 'ob:' .. pair .. ':' .. counterSide .. 's:prices', counterPrices[i])
              else
                redis.call('ZADD', 'ob:' .. pair .. ':' .. counterSide .. 's:prices', newAmount, counterPrices[i])
              end
              
              incomingAmount = incomingAmount - matchAmount
              if incomingAmount <= 0 then
                break
              end
            end
          end
          
          if incomingAmount <= 0 then
            break
          end
        end
      end
      
      return cjson.encode({
        matches = matches,
        count = matchCount,
        remainingAmount = incomingAmount
      })
    `);

    // Atomic order placement with MEV protection
    this.scripts.placeOrder = await this.redis.script('LOAD', `
      local pair = KEYS[1]
      local orderId = ARGV[1]
      local userId = ARGV[2]
      local side = ARGV[3]
      local orderType = ARGV[4]
      local price = ARGV[5]
      local amount = tonumber(ARGV[6])
      local timestamp = ARGV[7]
      local mevProtection = ARGV[8] == 'true'
      
      -- MEV Protection: Add random delay for order visibility
      local visibility = timestamp
      if mevProtection then
        visibility = visibility + math.random(100, 500) -- 100-500ms random delay
      end
      
      -- Create order object
      local order = {
        id = orderId,
        userId = userId,
        pair = pair,
        side = side,
        type = orderType,
        price = tonumber(price),
        amount = amount,
        remainingAmount = amount,
        filledAmount = 0,
        status = 'open',
        timestamp = timestamp,
        visibility = visibility,
        sequenceId = redis.call('INCR', 'ob:' .. pair .. ':sequence')
      }
      
      -- Store order
      redis.call('HSET', 'ob:' .. pair .. ':orders', orderId, cjson.encode(order))
      
      -- Add to price level (only if visible)
      if tonumber(redis.call('TIME')[1]) >= visibility then
        local sideKey = side == 'buy' and 'bids' or 'asks'
        redis.call('ZINCRBY', 'ob:' .. pair .. ':' .. sideKey .. ':prices', amount, price)
        redis.call('ZADD', 'ob:' .. pair .. ':' .. sideKey .. ':orders:' .. price, timestamp, orderId)
      else
        -- Add to pending orders (MEV protection)
        redis.call('ZADD', 'ob:' .. pair .. ':pending', visibility, orderId)
      end
      
      -- Add to user orders
      redis.call('SADD', 'ob:' .. pair .. ':users:' .. userId, orderId)
      
      -- Add to stream for real-time updates
      redis.call('XADD', 'ob:' .. pair .. ':stream', 'MAXLEN', '~', '10000', '*',
        'event', 'order_placed',
        'orderId', orderId,
        'side', side,
        'price', price,
        'amount', tostring(amount),
        'timestamp', timestamp
      )
      
      return cjson.encode(order)
    `);

    // Cancel order atomically
    this.scripts.cancelOrder = await this.redis.script('LOAD', `
      local pair = KEYS[1]
      local orderId = ARGV[1]
      local userId = ARGV[2]
      
      -- Get order
      local orderData = redis.call('HGET', 'ob:' .. pair .. ':orders', orderId)
      if not orderData then
        return cjson.encode({error = 'Order not found'})
      end
      
      local order = cjson.decode(orderData)
      
      -- Verify ownership
      if order.userId ~= userId then
        return cjson.encode({error = 'Unauthorized'})
      end
      
      -- Remove from order book
      local sideKey = order.side == 'buy' and 'bids' or 'asks'
      redis.call('ZINCRBY', 'ob:' .. pair .. ':' .. sideKey .. ':prices', -order.remainingAmount, tostring(order.price))
      redis.call('ZREM', 'ob:' .. pair .. ':' .. sideKey .. ':orders:' .. order.price, orderId)
      
      -- Remove empty price levels
      local remaining = redis.call('ZSCORE', 'ob:' .. pair .. ':' .. sideKey .. ':prices', tostring(order.price))
      if remaining and tonumber(remaining) <= 0 then
        redis.call('ZREM', 'ob:' .. pair .. ':' .. sideKey .. ':prices', tostring(order.price))
      end
      
      -- Update order status
      order.status = 'cancelled'
      redis.call('HSET', 'ob:' .. pair .. ':orders', orderId, cjson.encode(order))
      
      -- Remove from user orders
      redis.call('SREM', 'ob:' .. pair .. ':users:' .. userId, orderId)
      
      -- Add to stream
      redis.call('XADD', 'ob:' .. pair .. ':stream', 'MAXLEN', '~', '10000', '*',
        'event', 'order_cancelled',
        'orderId', orderId,
        'side', order.side,
        'price', tostring(order.price),
        'amount', tostring(order.remainingAmount),
        'timestamp', redis.call('TIME')[1]
      )
      
      return cjson.encode(order)
    `);

    // Process pending orders (MEV protection)
    this.scripts.processPendingOrders = await this.redis.script('LOAD', `
      local pair = KEYS[1]
      local currentTime = tonumber(ARGV[1])
      
      -- Get orders that should now be visible
      local pendingOrders = redis.call('ZRANGEBYSCORE', 'ob:' .. pair .. ':pending', 0, currentTime)
      
      local processed = 0
      for _, orderId in ipairs(pendingOrders) do
        local orderData = redis.call('HGET', 'ob:' .. pair .. ':orders', orderId)
        if orderData then
          local order = cjson.decode(orderData)
          
          -- Add to order book
          local sideKey = order.side == 'buy' and 'bids' or 'asks'
          redis.call('ZINCRBY', 'ob:' .. pair .. ':' .. sideKey .. ':prices', order.remainingAmount, tostring(order.price))
          redis.call('ZADD', 'ob:' .. pair .. ':' .. sideKey .. ':orders:' .. order.price, order.timestamp, orderId)
          
          -- Remove from pending
          redis.call('ZREM', 'ob:' .. pair .. ':pending', orderId)
          
          processed = processed + 1
        end
      end
      
      return processed
    `);

    console.log('✅ Lua scripts loaded');
  }

  /**
   * Setup Redis Streams for real-time updates
   */
  async setupStreams() {
    // Create consumer groups for each pair
    for (const [pair] of this.pairs) {
      const streamKey = `ob:${pair}:stream`;
      
      try {
        await this.redis.xgroup('CREATE', streamKey, 'websocket-group', '$', 'MKSTREAM');
        this.streamGroups.set(pair, 'websocket-group');
      } catch (err) {
        if (!err.message.includes('BUSYGROUP')) {
          throw err;
        }
      }
    }
    
    // Start consuming streams
    this.consumeStreams();
  }

  /**
   * Consume Redis Streams and emit events
   */
  async consumeStreams() {
    const streamLoop = async () => {
      try {
        // Read from all pair streams
        const streams = [];
        const keys = [];
        
        for (const [pair] of this.pairs) {
          keys.push(`ob:${pair}:stream`);
          streams.push('>'); // Read new messages
        }
        
        if (keys.length === 0) {
          setTimeout(streamLoop, 100);
          return;
        }
        
        // XREADGROUP with blocking
        const results = await this.streamClient.xreadgroup(
          'GROUP', 'websocket-group', 'consumer-1',
          'BLOCK', 1000, // Block for 1 second
          'STREAMS', ...keys, ...streams
        );
        
        if (results) {
          for (const [streamKey, messages] of results) {
            const pair = streamKey.split(':')[1];
            
            for (const [messageId, fields] of messages) {
              const event = this.parseStreamEvent(fields);
              
              // Emit to WebSocket subscribers
              this.emitToWebSocket(pair, event);
              
              // Acknowledge message
              await this.streamClient.xack(streamKey, 'websocket-group', messageId);
              
              this.metrics.streamEventsPublished++;
            }
          }
        }
      } catch (error) {
        console.error('Stream consumption error:', error);
      }
      
      // Continue loop
      setImmediate(streamLoop);
    };
    
    streamLoop();
  }

  /**
   * Parse stream event fields
   */
  parseStreamEvent(fields) {
    const event = {};
    
    for (let i = 0; i < fields.length; i += 2) {
      event[fields[i]] = fields[i + 1];
    }
    
    // Parse numeric fields
    if (event.price) event.price = parseFloat(event.price);
    if (event.amount) event.amount = parseFloat(event.amount);
    if (event.timestamp) event.timestamp = parseInt(event.timestamp);
    
    return event;
  }

  /**
   * Setup Redis pub/sub for WebSocket notifications
   */
  setupPubSub() {
    this.subClient.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        this.emit(channel, data);
      } catch (error) {
        console.error('Pub/sub message parse error:', error);
      }
    });
    
    this.subClient.on('error', (error) => {
      console.error('Redis subscription error:', error);
      this.emit('error', error);
    });
  }

  /**
   * Initialize trading pair
   */
  async initializePair(pair, config = {}) {
    this.pairs.set(pair, {
      baseAsset: config.baseAsset,
      quoteAsset: config.quoteAsset,
      minPrice: config.minPrice || 0.00000001,
      maxPrice: config.maxPrice || 1000000,
      minAmount: config.minAmount || 0.00000001,
      tickSize: config.tickSize || 0.00000001,
      ...config
    });
    
    // Setup stream
    const streamKey = `ob:${pair}:stream`;
    try {
      await this.redis.xgroup('CREATE', streamKey, 'websocket-group', '$', 'MKSTREAM');
    } catch (err) {
      if (!err.message.includes('BUSYGROUP')) {
        throw err;
      }
    }
    
    // Initialize order book keys
    await this.redis.set(`ob:${pair}:sequence`, 0);
    
    // Start pending order processor
    this.startPendingOrderProcessor(pair);
    
    console.log(`✅ Trading pair ${pair} initialized`);
  }

  /**
   * Place order with atomic matching
   */
  async placeOrder(order) {
    const startTime = performance.now();
    
    // Validate order
    this.validateOrder(order);
    
    // Execute atomic order placement
    const result = await this.redis.evalsha(
      this.scripts.placeOrder,
      1,
      order.pair,
      order.id,
      order.userId,
      order.side,
      order.type || 'limit',
      this.normalizePrice(order.price),
      this.normalizeAmount(order.amount),
      Date.now(),
      String(order.mevProtection || this.config.enableMEVProtection)
    );
    
    const placedOrder = JSON.parse(result);
    
    // Attempt matching if market order or aggressive limit order
    if (order.type === 'market' || order.immediateOrCancel) {
      await this.attemptMatching(order.pair, order.side);
    }
    
    // Update metrics
    this.metrics.ordersProcessed++;
    this.metrics.avgMatchingLatency = 
      (this.metrics.avgMatchingLatency * (this.metrics.ordersProcessed - 1) + 
       (performance.now() - startTime)) / this.metrics.ordersProcessed;
    
    return placedOrder;
  }

  /**
   * Attempt to match orders
   */
  async attemptMatching(pair, side) {
    const startTime = performance.now();
    
    // Execute matching
    const result = await this.redis.evalsha(
      this.scripts.matchOrders,
      1,
      pair,
      side,
      this.config.matchingBatchSize
    );
    
    const { matches, count } = JSON.parse(result);
    
    if (count > 0) {
      // Process matches
      for (const match of matches) {
        await this.processMatch(pair, match);
      }
      
      this.metrics.matchesExecuted += count;
      
      // Emit matching complete event
      this.emit('matchingComplete', {
        pair,
        matchCount: count,
        latency: performance.now() - startTime
      });
    }
    
    return matches;
  }

  /**
   * Process a single match
   */
  async processMatch(pair, match) {
    // Add match to stream
    await this.redis.xadd(
      `ob:${pair}:stream`,
      'MAXLEN', '~', this.config.streamMaxLen,
      '*',
      'event', 'order_matched',
      'matchId', match.id,
      'buyOrderId', match.buyOrderId,
      'sellOrderId', match.sellOrderId,
      'price', String(match.price),
      'amount', String(match.amount),
      'timestamp', String(match.timestamp)
    );
    
    // Store match record
    await this.redis.hset(
      `ob:${pair}:matches`,
      match.id,
      JSON.stringify(match)
    );
    
    // Publish match event
    await this.pubClient.publish(
      `orderbook:${pair}:matches`,
      JSON.stringify(match)
    );
  }

  /**
   * Cancel order atomically
   */
  async cancelOrder(orderId, pair, userId) {
    const result = await this.redis.evalsha(
      this.scripts.cancelOrder,
      1,
      pair,
      orderId,
      userId
    );
    
    const response = JSON.parse(result);
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return response;
  }

  /**
   * Get order book snapshot
   */
  async getOrderBook(pair, depth = 20) {
    const multi = this.redis.multi();
    
    // Get best bids and asks
    multi.zrevrange(`ob:${pair}:bids:prices`, 0, depth - 1, 'WITHSCORES');
    multi.zrange(`ob:${pair}:asks:prices`, 0, depth - 1, 'WITHSCORES');
    multi.get(`ob:${pair}:sequence`);
    
    const [[, bids], [, asks], [, sequence]] = await multi.exec();
    
    // Format order book
    const formatLevels = (levels) => {
      const formatted = [];
      for (let i = 0; i < levels.length; i += 2) {
        formatted.push([
          parseFloat(levels[i]),  // price
          parseFloat(levels[i + 1]) // amount
        ]);
      }
      return formatted;
    };
    
    return {
      pair,
      sequence: parseInt(sequence) || 0,
      bids: formatLevels(bids),
      asks: formatLevels(asks),
      timestamp: Date.now()
    };
  }

  /**
   * Subscribe to order book updates via WebSocket
   */
  subscribeWebSocket(pair, clientId, callback) {
    const subscription = { clientId, callback };
    
    if (!this.wsSubscriptions.has(pair)) {
      this.wsSubscriptions.set(pair, new Set());
      
      // Subscribe to Redis channel
      this.subClient.subscribe(`orderbook:${pair}`);
    }
    
    this.wsSubscriptions.get(pair).add(subscription);
    
    // Return unsubscribe function
    return () => {
      const subs = this.wsSubscriptions.get(pair);
      if (subs) {
        subs.delete(subscription);
        
        if (subs.size === 0) {
          this.wsSubscriptions.delete(pair);
          this.subClient.unsubscribe(`orderbook:${pair}`);
        }
      }
    };
  }

  /**
   * Emit event to WebSocket subscribers
   */
  emitToWebSocket(pair, event) {
    const subscribers = this.wsSubscriptions.get(pair);
    
    if (subscribers) {
      for (const { callback } of subscribers) {
        try {
          callback(event);
        } catch (error) {
          console.error('WebSocket callback error:', error);
        }
      }
    }
  }

  /**
   * Process pending orders (MEV protection)
   */
  async processPendingOrders(pair) {
    const processed = await this.redis.evalsha(
      this.scripts.processPendingOrders,
      1,
      pair,
      Date.now()
    );
    
    if (processed > 0) {
      console.log(`Processed ${processed} pending orders for ${pair}`);
    }
  }

  /**
   * Start pending order processor
   */
  startPendingOrderProcessor(pair) {
    setInterval(() => {
      this.processPendingOrders(pair);
    }, 100); // Check every 100ms
  }

  /**
   * Start stream maintenance
   */
  startStreamMaintenance() {
    setInterval(async () => {
      // Trim streams to prevent unbounded growth
      for (const [pair] of this.pairs) {
        try {
          await this.redis.xtrim(`ob:${pair}:stream`, 'MAXLEN', '~', this.config.streamMaxLen);
        } catch (error) {
          console.error(`Failed to trim stream for ${pair}:`, error);
        }
      }
    }, this.config.streamTrimInterval);
  }

  /**
   * Get order by ID
   */
  async getOrder(pair, orderId) {
    const orderData = await this.redis.hget(`ob:${pair}:orders`, orderId);
    return orderData ? JSON.parse(orderData) : null;
  }

  /**
   * Get user orders
   */
  async getUserOrders(pair, userId) {
    const orderIds = await this.redis.smembers(`ob:${pair}:users:${userId}`);
    
    if (orderIds.length === 0) {
      return [];
    }
    
    const multi = this.redis.multi();
    
    for (const orderId of orderIds) {
      multi.hget(`ob:${pair}:orders`, orderId);
    }
    
    const results = await multi.exec();
    
    return results
      .map(([, data]) => data ? JSON.parse(data) : null)
      .filter(order => order !== null);
  }

  /**
   * Get recent matches
   */
  async getRecentMatches(pair, limit = 100) {
    const matches = await this.redis.hgetall(`ob:${pair}:matches`);
    
    return Object.values(matches)
      .map(data => JSON.parse(data))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get market statistics
   */
  async getMarketStats(pair, period = 86400000) { // 24 hours
    const now = Date.now();
    const since = now - period;
    
    // Get recent matches
    const matches = await this.getRecentMatches(pair, 1000);
    const periodMatches = matches.filter(m => m.timestamp >= since);
    
    if (periodMatches.length === 0) {
      return {
        pair,
        volume: 0,
        high: null,
        low: null,
        last: null,
        changePercent: 0,
        trades: 0
      };
    }
    
    // Calculate statistics
    const prices = periodMatches.map(m => m.price);
    const volume = periodMatches.reduce((sum, m) => sum + m.amount, 0);
    
    return {
      pair,
      volume,
      high: Math.max(...prices),
      low: Math.min(...prices),
      last: prices[0],
      changePercent: ((prices[0] - prices[prices.length - 1]) / prices[prices.length - 1]) * 100,
      trades: periodMatches.length
    };
  }

  /**
   * Helper methods
   */
  validateOrder(order) {
    if (!order.id || !order.pair || !order.side || !order.price || !order.amount || !order.userId) {
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
    
    if (!['buy', 'sell'].includes(order.side.toLowerCase())) {
      throw new Error('Invalid order side');
    }
  }

  normalizePrice(price) {
    return parseFloat(price).toFixed(this.config.pricePrecision);
  }

  normalizeAmount(amount) {
    return parseFloat(amount).toFixed(this.config.amountPrecision);
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      redisMemoryUsage: this.redis.info('memory'),
      connectedClients: this.wsSubscriptions.size,
      activePairs: this.pairs.size
    };
  }

  /**
   * Cleanup and disconnect
   */
  async disconnect() {
    // Unsubscribe from all channels
    await this.subClient.unsubscribe();
    
    // Close all Redis connections
    await this.redis.quit();
    await this.pubClient.quit();
    await this.subClient.quit();
    await this.streamClient.quit();
    
    console.log('✅ Enhanced Redis Order Book disconnected');
  }
}

module.exports = EnhancedRedisOrderBook;