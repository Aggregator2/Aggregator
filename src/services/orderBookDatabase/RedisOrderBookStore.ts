import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { Order, OrderBookSnapshot, OrderBookUpdate, Trade } from '../matchingEngine/types';
import { OrderBookDatabaseConfig } from './config';

export class RedisOrderBookStore extends EventEmitter {
  private redis: Redis;
  private subscriber: Redis;
  private publisher: Redis;
  private config: OrderBookDatabaseConfig;
  private scriptSHA: Map<string, string> = new Map();

  constructor(config: OrderBookDatabaseConfig) {
    super();
    this.config = config;
    
    // Create Redis connections
    this.redis = new Redis(config.redis);
    this.subscriber = new Redis(config.redis);
    this.publisher = new Redis(config.redis);

    this.setupRedisEvents();
    this.loadLuaScripts();
  }

  private setupRedisEvents(): void {
    this.redis.on('error', (err) => {
      console.error('Redis error:', err);
      this.emit('error', err);
    });

    this.redis.on('connect', () => {
      console.log('Connected to Redis');
      this.emit('connected');
    });

    this.subscriber.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        this.emit('orderbook:update', channel, data);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    });
  }

  private async loadLuaScripts(): Promise<void> {
    // Lua script for atomic order matching
    const matchOrderScript = `
      local pair = KEYS[1]
      local orderId = KEYS[2]
      local orderData = ARGV[1]
      local timestamp = ARGV[2]
      
      -- Parse order data
      local order = cjson.decode(orderData)
      
      -- Get opposite side order book
      local bookKey = pair .. ':' .. (order.side == 'BUY' and 'asks' or 'bids')
      local trades = {}
      
      -- Match orders
      local prices = redis.call('ZRANGE', bookKey, 0, -1)
      for _, price in ipairs(prices) do
        if order.filledQuantity >= order.quantity then
          break
        end
        
        -- Check if price matches
        local priceNum = tonumber(price)
        if (order.side == 'BUY' and priceNum <= order.price) or 
           (order.side == 'SELL' and priceNum >= order.price) then
          
          -- Get orders at this price level
          local levelKey = bookKey .. ':' .. price
          local levelOrders = redis.call('LRANGE', levelKey, 0, -1)
          
          for _, levelOrderData in ipairs(levelOrders) do
            if order.filledQuantity >= order.quantity then
              break
            end
            
            local levelOrder = cjson.decode(levelOrderData)
            local matchQty = math.min(
              order.quantity - order.filledQuantity,
              levelOrder.quantity - levelOrder.filledQuantity
            )
            
            -- Create trade
            table.insert(trades, {
              takerOrderId = order.id,
              makerOrderId = levelOrder.id,
              price = priceNum,
              quantity = matchQty,
              timestamp = timestamp
            })
            
            -- Update filled quantities
            order.filledQuantity = order.filledQuantity + matchQty
            levelOrder.filledQuantity = levelOrder.filledQuantity + matchQty
            
            -- Update or remove maker order
            if levelOrder.filledQuantity >= levelOrder.quantity then
              redis.call('LREM', levelKey, 1, levelOrderData)
            else
              -- Update order in list (this is simplified, in production use LSET with index)
              redis.call('LREM', levelKey, 1, levelOrderData)
              redis.call('RPUSH', levelKey, cjson.encode(levelOrder))
            end
          end
          
          -- Remove empty price level
          if redis.call('LLEN', levelKey) == 0 then
            redis.call('ZREM', bookKey, price)
          end
        end
      end
      
      return cjson.encode({order = order, trades = trades})
    `;

    // Load script
    const sha = await this.redis.script('LOAD', matchOrderScript);
    this.scriptSHA.set('matchOrder', sha);
  }

  // Store order in Redis
  async storeOrder(order: Order): Promise<void> {
    const key = `${this.config.redis.keyPrefix}order:${order.id}`;
    const pipeline = this.redis.pipeline();
    
    // Store order data
    pipeline.hset(key, {
      id: order.id,
      userId: order.userId,
      pair: order.pair,
      side: order.side,
      type: order.type,
      price: order.price.toString(),
      quantity: order.quantity.toString(),
      filledQuantity: order.filledQuantity.toString(),
      status: order.status,
      timeInForce: order.timeInForce,
      timestamp: order.timestamp.toString(),
      lastUpdateTime: order.lastUpdateTime.toString(),
      clientOrderId: order.clientOrderId || '',
      metadata: JSON.stringify(order.metadata || {})
    });

    // Set expiration if configured
    if (this.config.orderExpiration.enabled) {
      const ttl = this.config.orderExpiration.customTTL?.[order.pair] || 
                  this.config.orderExpiration.defaultTTL || 86400;
      pipeline.expire(key, ttl);
    }

    // Add to user index
    pipeline.sadd(`${this.config.redis.keyPrefix}user:${order.userId}:orders`, order.id);
    
    // Add to pair index
    pipeline.sadd(`${this.config.redis.keyPrefix}pair:${order.pair}:orders`, order.id);

    await pipeline.exec();
  }

  // Add order to order book
  async addToOrderBook(order: Order): Promise<void> {
    const bookSide = order.side === 'BUY' ? 'bids' : 'asks';
    const bookKey = `${this.config.redis.keyPrefix}${order.pair}:${bookSide}`;
    const levelKey = `${bookKey}:${order.price}`;
    
    const pipeline = this.redis.pipeline();
    
    // Add price to sorted set
    pipeline.zadd(bookKey, order.price, order.price.toString());
    
    // Add order to price level
    pipeline.rpush(levelKey, JSON.stringify(order));
    
    // Update aggregated volume at price level
    const volumeKey = `${bookKey}:volume`;
    pipeline.hincrby(volumeKey, order.price.toString(), order.quantity - order.filledQuantity);
    
    await pipeline.exec();
    
    // Publish update
    const update: OrderBookUpdate = {
      type: 'ADD',
      side: order.side,
      price: order.price,
      quantity: order.quantity - order.filledQuantity,
      orderId: order.id,
      timestamp: Date.now(),
      sequenceNumber: await this.getNextSequence(order.pair)
    };
    
    await this.publishUpdate(order.pair, update);
  }

  // Remove order from order book
  async removeFromOrderBook(order: Order): Promise<void> {
    const bookSide = order.side === 'BUY' ? 'bids' : 'asks';
    const bookKey = `${this.config.redis.keyPrefix}${order.pair}:${bookSide}`;
    const levelKey = `${bookKey}:${order.price}`;
    
    const pipeline = this.redis.pipeline();
    
    // Remove order from price level
    pipeline.lrem(levelKey, 0, JSON.stringify(order));
    
    // Check if level is empty and remove if so
    const levelLength = await this.redis.llen(levelKey);
    if (levelLength <= 1) {
      pipeline.zrem(bookKey, order.price.toString());
      pipeline.hdel(`${bookKey}:volume`, order.price.toString());
    } else {
      // Update volume
      pipeline.hincrby(`${bookKey}:volume`, order.price.toString(), -(order.quantity - order.filledQuantity));
    }
    
    await pipeline.exec();
    
    // Publish update
    const update: OrderBookUpdate = {
      type: 'REMOVE',
      side: order.side,
      price: order.price,
      quantity: order.quantity - order.filledQuantity,
      orderId: order.id,
      timestamp: Date.now(),
      sequenceNumber: await this.getNextSequence(order.pair)
    };
    
    await this.publishUpdate(order.pair, update);
  }

  // Get order book snapshot
  async getOrderBookSnapshot(pair: string, depth: number = 50): Promise<OrderBookSnapshot> {
    const bidsKey = `${this.config.redis.keyPrefix}${pair}:bids`;
    const asksKey = `${this.config.redis.keyPrefix}${pair}:asks`;
    
    // Get top bids and asks
    const [bids, asks] = await Promise.all([
      this.redis.zrevrange(bidsKey, 0, depth - 1, 'WITHSCORES'),
      this.redis.zrange(asksKey, 0, depth - 1, 'WITHSCORES')
    ]);
    
    // Parse and format levels
    const bidLevels = [];
    const askLevels = [];
    
    for (let i = 0; i < bids.length; i += 2) {
      const price = parseFloat(bids[i]);
      const volumeKey = `${bidsKey}:volume`;
      const volume = await this.redis.hget(volumeKey, price.toString());
      
      bidLevels.push({
        price,
        quantity: parseFloat(volume || '0'),
        orders: [] // Orders can be fetched separately if needed
      });
    }
    
    for (let i = 0; i < asks.length; i += 2) {
      const price = parseFloat(asks[i]);
      const volumeKey = `${asksKey}:volume`;
      const volume = await this.redis.hget(volumeKey, price.toString());
      
      askLevels.push({
        price,
        quantity: parseFloat(volume || '0'),
        orders: []
      });
    }
    
    return {
      pair,
      bids: bidLevels,
      asks: askLevels,
      lastUpdateTime: Date.now(),
      sequenceNumber: await this.getCurrentSequence(pair)
    };
  }

  // Store trade
  async storeTrade(trade: Trade): Promise<void> {
    const key = `${this.config.redis.keyPrefix}trade:${trade.id}`;
    const pipeline = this.redis.pipeline();
    
    // Store trade data
    pipeline.hset(key, {
      id: trade.id,
      pair: trade.pair,
      takerOrderId: trade.takerOrderId,
      makerOrderId: trade.makerOrderId,
      price: trade.price.toString(),
      quantity: trade.quantity.toString(),
      takerSide: trade.takerSide,
      timestamp: trade.timestamp.toString(),
      takerFee: trade.takerFee.toString(),
      makerFee: trade.makerFee.toString()
    });
    
    // Add to trade history sorted set
    pipeline.zadd(
      `${this.config.redis.keyPrefix}${trade.pair}:trades`,
      trade.timestamp,
      trade.id
    );
    
    // Keep only recent trades (e.g., last 1000)
    pipeline.zremrangebyrank(`${this.config.redis.keyPrefix}${trade.pair}:trades`, 0, -1001);
    
    await pipeline.exec();
  }

  // Get recent trades
  async getRecentTrades(pair: string, limit: number = 100): Promise<Trade[]> {
    const tradeIds = await this.redis.zrevrange(
      `${this.config.redis.keyPrefix}${pair}:trades`,
      0,
      limit - 1
    );
    
    if (tradeIds.length === 0) return [];
    
    const pipeline = this.redis.pipeline();
    for (const tradeId of tradeIds) {
      pipeline.hgetall(`${this.config.redis.keyPrefix}trade:${tradeId}`);
    }
    
    const results = await pipeline.exec();
    const trades: Trade[] = [];
    
    for (const [err, data] of results) {
      if (!err && data) {
        trades.push({
          id: data.id,
          pair: data.pair,
          takerOrderId: data.takerOrderId,
          makerOrderId: data.makerOrderId,
          price: parseFloat(data.price),
          quantity: parseFloat(data.quantity),
          takerSide: data.takerSide,
          timestamp: parseInt(data.timestamp),
          takerFee: parseFloat(data.takerFee),
          makerFee: parseFloat(data.makerFee)
        });
      }
    }
    
    return trades;
  }

  // Subscribe to order book updates
  async subscribeToOrderBook(pair: string): Promise<void> {
    const channel = `${this.config.redis.keyPrefix}channel:${pair}`;
    await this.subscriber.subscribe(channel);
  }

  // Unsubscribe from order book updates
  async unsubscribeFromOrderBook(pair: string): Promise<void> {
    const channel = `${this.config.redis.keyPrefix}channel:${pair}`;
    await this.subscriber.unsubscribe(channel);
  }

  // Publish order book update
  private async publishUpdate(pair: string, update: OrderBookUpdate): Promise<void> {
    const channel = `${this.config.redis.keyPrefix}channel:${pair}`;
    await this.publisher.publish(channel, JSON.stringify(update));
  }

  // Get next sequence number
  private async getNextSequence(pair: string): Promise<number> {
    const key = `${this.config.redis.keyPrefix}${pair}:sequence`;
    return await this.redis.incr(key);
  }

  // Get current sequence number
  private async getCurrentSequence(pair: string): Promise<number> {
    const key = `${this.config.redis.keyPrefix}${pair}:sequence`;
    const seq = await this.redis.get(key);
    return parseInt(seq || '0');
  }

  // Cleanup expired orders
  async cleanupExpiredOrders(): Promise<number> {
    if (!this.config.orderExpiration.enabled) return 0;
    
    let cleaned = 0;
    const cursor = '0';
    
    // Scan for expired orders
    const [newCursor, keys] = await this.redis.scan(
      cursor,
      'MATCH',
      `${this.config.redis.keyPrefix}order:*`,
      'COUNT',
      100
    );
    
    for (const key of keys) {
      const ttl = await this.redis.ttl(key);
      if (ttl === -2) {
        // Key has expired
        cleaned++;
      }
    }
    
    return cleaned;
  }

  // Close connections
  async close(): Promise<void> {
    await Promise.all([
      this.redis.quit(),
      this.subscriber.quit(),
      this.publisher.quit()
    ]);
  }
}