import { Cluster, Redis } from 'ioredis';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { RedisClusterConfig } from './RedisClusterConfig';
import {
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
  Trade,
} from '../matchingEngine/types';

interface OrderBookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export class RedisOrderBook extends EventEmitter {
  private redis: Redis | Cluster;
  private readonly pair: string;
  private readonly tickSize: number;
  private readonly keyPrefix: string;
  
  // Redis keys
  private readonly BIDS_KEY: string;
  private readonly ASKS_KEY: string;
  private readonly ORDERS_KEY: string;
  private readonly PRICE_LEVELS_KEY: string;
  private readonly SEQUENCE_KEY: string;
  
  // Lua scripts for atomic operations
  private readonly ADD_ORDER_SCRIPT = `
    local pair = KEYS[1]
    local side = KEYS[2]
    local orderId = ARGV[1]
    local price = tonumber(ARGV[2])
    local quantity = tonumber(ARGV[3])
    local orderData = ARGV[4]
    
    -- Store order data
    redis.call('HSET', pair .. ':orders', orderId, orderData)
    
    -- Add to sorted set (price book)
    local bookKey = pair .. ':' .. side
    redis.call('ZADD', bookKey, price, orderId)
    
    -- Update price level
    local levelKey = pair .. ':levels:' .. side .. ':' .. tostring(price)
    redis.call('HINCRBY', levelKey, 'quantity', quantity)
    redis.call('HINCRBY', levelKey, 'count', 1)
    redis.call('RPUSH', levelKey .. ':orders', orderId)
    
    -- Increment sequence
    return redis.call('INCR', pair .. ':sequence')
  `;
  
  private readonly REMOVE_ORDER_SCRIPT = `
    local pair = KEYS[1]
    local side = KEYS[2]
    local orderId = ARGV[1]
    local price = tonumber(ARGV[2])
    local quantity = tonumber(ARGV[3])
    
    -- Remove from orders hash
    local orderData = redis.call('HGET', pair .. ':orders', orderId)
    if not orderData then
      return nil
    end
    redis.call('HDEL', pair .. ':orders', orderId)
    
    -- Remove from sorted set
    local bookKey = pair .. ':' .. side
    redis.call('ZREM', bookKey, orderId)
    
    -- Update price level
    local levelKey = pair .. ':levels:' .. side .. ':' .. tostring(price)
    local newQuantity = redis.call('HINCRBY', levelKey, 'quantity', -quantity)
    local newCount = redis.call('HINCRBY', levelKey, 'count', -1)
    
    -- Remove from order list at this level
    redis.call('LREM', levelKey .. ':orders', 1, orderId)
    
    -- Clean up empty price level
    if newCount <= 0 then
      redis.call('DEL', levelKey, levelKey .. ':orders')
    end
    
    -- Increment sequence
    redis.call('INCR', pair .. ':sequence')
    
    return orderData
  `;
  
  private readonly MATCH_ORDERS_SCRIPT = `
    local pair = KEYS[1]
    local side = ARGV[1] -- taker side
    local takerId = ARGV[2]
    local takerPrice = tonumber(ARGV[3])
    local takerQuantity = tonumber(ARGV[4])
    local takerType = ARGV[5]
    
    local trades = {}
    local remainingQuantity = takerQuantity
    local makerSide = side == 'buy' and 'asks' or 'bids'
    local bookKey = pair .. ':' .. makerSide
    
    -- Get matching orders
    local matchingOrders
    if side == 'buy' then
      -- For buy orders, get asks <= price (or all for market)
      if takerType == 'market' then
        matchingOrders = redis.call('ZRANGE', bookKey, 0, -1, 'WITHSCORES')
      else
        matchingOrders = redis.call('ZRANGEBYSCORE', bookKey, '-inf', takerPrice, 'WITHSCORES')
      end
    else
      -- For sell orders, get bids >= price (or all for market)
      if takerType == 'market' then
        matchingOrders = redis.call('ZREVRANGE', bookKey, 0, -1, 'WITHSCORES')
      else
        matchingOrders = redis.call('ZREVRANGEBYSCORE', bookKey, takerPrice, '+inf', 'WITHSCORES')
      end
    end
    
    -- Process matches
    local i = 1
    while i < #matchingOrders and remainingQuantity > 0 do
      local makerId = matchingOrders[i]
      local makerPrice = tonumber(matchingOrders[i + 1])
      
      -- Get maker order data
      local makerData = redis.call('HGET', pair .. ':orders', makerId)
      if makerData then
        local makerOrder = cjson.decode(makerData)
        local availableQuantity = makerOrder.quantity - makerOrder.filledQuantity
        local tradeQuantity = math.min(availableQuantity, remainingQuantity)
        
        if tradeQuantity > 0 then
          -- Create trade
          local trade = {
            makerId = makerId,
            makerPrice = makerPrice,
            quantity = tradeQuantity,
            timestamp = redis.call('TIME')[1]
          }
          table.insert(trades, cjson.encode(trade))
          
          -- Update maker order
          makerOrder.filledQuantity = makerOrder.filledQuantity + tradeQuantity
          if makerOrder.filledQuantity >= makerOrder.quantity then
            -- Remove filled order
            redis.call('HDEL', pair .. ':orders', makerId)
            redis.call('ZREM', bookKey, makerId)
            
            -- Update level
            local levelKey = pair .. ':levels:' .. makerSide .. ':' .. tostring(makerPrice)
            redis.call('HINCRBY', levelKey, 'quantity', -availableQuantity)
            redis.call('HINCRBY', levelKey, 'count', -1)
            redis.call('LREM', levelKey .. ':orders', 1, makerId)
          else
            -- Update partially filled order
            redis.call('HSET', pair .. ':orders', makerId, cjson.encode(makerOrder))
          end
          
          remainingQuantity = remainingQuantity - tradeQuantity
        end
      end
      
      i = i + 2
    end
    
    -- Increment sequence
    redis.call('INCR', pair .. ':sequence')
    
    return {remainingQuantity, trades}
  `;

  constructor(pair: string, tickSize: number, redis?: Redis | Cluster) {
    super();
    this.pair = pair;
    this.tickSize = tickSize;
    this.keyPrefix = `orderbook:${pair}`;
    
    // Initialize Redis connection
    if (redis) {
      this.redis = redis;
    } else if (RedisClusterConfig.isClusterMode()) {
      this.redis = new Cluster(RedisClusterConfig.getClusterOptions());
    } else {
      this.redis = new Redis(RedisClusterConfig.getStandaloneConfig());
    }
    
    // Set up keys
    this.BIDS_KEY = `${this.keyPrefix}:bids`;
    this.ASKS_KEY = `${this.keyPrefix}:asks`;
    this.ORDERS_KEY = `${this.keyPrefix}:orders`;
    this.PRICE_LEVELS_KEY = `${this.keyPrefix}:levels`;
    this.SEQUENCE_KEY = `${this.keyPrefix}:sequence`;
    
    // Register Lua scripts
    this.registerScripts();
  }

  private async registerScripts(): Promise<void> {
    try {
      // Load scripts into Redis
      await this.redis.script('LOAD', this.ADD_ORDER_SCRIPT);
      await this.redis.script('LOAD', this.REMOVE_ORDER_SCRIPT);
      await this.redis.script('LOAD', this.MATCH_ORDERS_SCRIPT);
      
      logger.info(`Redis scripts loaded for orderbook ${this.pair}`);
    } catch (error) {
      logger.error('Failed to load Redis scripts', error);
    }
  }

  async addOrder(order: Order): Promise<number> {
    const orderData = JSON.stringify({
      ...order,
      timestamp: Date.now(),
    });
    
    const bookKey = order.side === OrderSide.BUY ? 'bids' : 'asks';
    
    try {
      const sequence = await this.redis.eval(
        this.ADD_ORDER_SCRIPT,
        2,
        this.keyPrefix,
        bookKey,
        order.id,
        order.price.toString(),
        order.quantity.toString(),
        orderData
      ) as number;
      
      this.emit('orderAdded', { order, sequence });
      return sequence;
    } catch (error) {
      logger.error('Failed to add order to Redis', { order, error });
      throw error;
    }
  }

  async removeOrder(orderId: string, side: OrderSide, price: number, quantity: number): Promise<Order | null> {
    const bookKey = side === OrderSide.BUY ? 'bids' : 'asks';
    
    try {
      const orderData = await this.redis.eval(
        this.REMOVE_ORDER_SCRIPT,
        2,
        this.keyPrefix,
        bookKey,
        orderId,
        price.toString(),
        quantity.toString()
      ) as string | null;
      
      if (orderData) {
        const order = JSON.parse(orderData) as Order;
        this.emit('orderRemoved', { orderId, order });
        return order;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to remove order from Redis', { orderId, error });
      throw error;
    }
  }

  async matchOrders(takerOrder: Order): Promise<{ remainingQuantity: number; trades: Trade[] }> {
    const side = takerOrder.side;
    const type = takerOrder.type;
    
    try {
      const [remainingQuantity, tradesData] = await this.redis.eval(
        this.MATCH_ORDERS_SCRIPT,
        1,
        this.keyPrefix,
        side,
        takerOrder.id,
        takerOrder.price.toString(),
        takerOrder.quantity.toString(),
        type
      ) as [number, string[]];
      
      // Parse trades
      const trades: Trade[] = tradesData.map((tradeStr) => {
        const tradeData = JSON.parse(tradeStr);
        return {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          pair: this.pair,
          takerOrderId: takerOrder.id,
          makerOrderId: tradeData.makerId,
          price: tradeData.makerPrice,
          quantity: tradeData.quantity,
          takerSide: side,
          timestamp: parseInt(tradeData.timestamp) * 1000,
          takerFee: 0,
          makerFee: 0,
        };
      });
      
      // Update taker order filled quantity
      takerOrder.filledQuantity = takerOrder.quantity - remainingQuantity;
      
      this.emit('ordersMatched', { takerOrder, trades });
      
      return { remainingQuantity, trades };
    } catch (error) {
      logger.error('Failed to match orders in Redis', { takerOrder, error });
      throw error;
    }
  }

  async getBestBid(): Promise<OrderBookLevel | null> {
    try {
      const topBids = await this.redis.zrevrange(this.BIDS_KEY, 0, 0, 'WITHSCORES');
      if (topBids.length < 2) return null;
      
      const price = parseFloat(topBids[1]);
      const levelKey = `${this.PRICE_LEVELS_KEY}:bids:${price}`;
      const [quantity, count] = await this.redis.hmget(levelKey, 'quantity', 'count');
      
      return {
        price,
        quantity: parseFloat(quantity || '0'),
        orderCount: parseInt(count || '0'),
      };
    } catch (error) {
      logger.error('Failed to get best bid', error);
      return null;
    }
  }

  async getBestAsk(): Promise<OrderBookLevel | null> {
    try {
      const topAsks = await this.redis.zrange(this.ASKS_KEY, 0, 0, 'WITHSCORES');
      if (topAsks.length < 2) return null;
      
      const price = parseFloat(topAsks[1]);
      const levelKey = `${this.PRICE_LEVELS_KEY}:asks:${price}`;
      const [quantity, count] = await this.redis.hmget(levelKey, 'quantity', 'count');
      
      return {
        price,
        quantity: parseFloat(quantity || '0'),
        orderCount: parseInt(count || '0'),
      };
    } catch (error) {
      logger.error('Failed to get best ask', error);
      return null;
    }
  }

  async getOrderBookSnapshot(depth: number = 50): Promise<{
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    sequence: number;
  }> {
    try {
      // Use pipeline for efficiency
      const pipeline = this.redis.pipeline();
      
      // Get top bids and asks
      pipeline.zrevrange(this.BIDS_KEY, 0, depth - 1, 'WITHSCORES');
      pipeline.zrange(this.ASKS_KEY, 0, depth - 1, 'WITHSCORES');
      pipeline.get(this.SEQUENCE_KEY);
      
      const [bidsData, asksData, sequence] = await pipeline.exec();
      
      // Process bids
      const bids: OrderBookLevel[] = [];
      const bidsList = bidsData[1] as string[];
      for (let i = 0; i < bidsList.length; i += 2) {
        const price = parseFloat(bidsList[i + 1]);
        const levelKey = `${this.PRICE_LEVELS_KEY}:bids:${price}`;
        const [quantity, count] = await this.redis.hmget(levelKey, 'quantity', 'count');
        
        bids.push({
          price,
          quantity: parseFloat(quantity || '0'),
          orderCount: parseInt(count || '0'),
        });
      }
      
      // Process asks
      const asks: OrderBookLevel[] = [];
      const asksList = asksData[1] as string[];
      for (let i = 0; i < asksList.length; i += 2) {
        const price = parseFloat(asksList[i + 1]);
        const levelKey = `${this.PRICE_LEVELS_KEY}:asks:${price}`;
        const [quantity, count] = await this.redis.hmget(levelKey, 'quantity', 'count');
        
        asks.push({
          price,
          quantity: parseFloat(quantity || '0'),
          orderCount: parseInt(count || '0'),
        });
      }
      
      return {
        bids,
        asks,
        sequence: parseInt(sequence[1] as string || '0'),
      };
    } catch (error) {
      logger.error('Failed to get order book snapshot', error);
      return { bids: [], asks: [], sequence: 0 };
    }
  }

  async getOrder(orderId: string): Promise<Order | null> {
    try {
      const orderData = await this.redis.hget(this.ORDERS_KEY, orderId);
      return orderData ? JSON.parse(orderData) : null;
    } catch (error) {
      logger.error('Failed to get order', { orderId, error });
      return null;
    }
  }

  async updateOrderFill(orderId: string, filledQuantity: number): Promise<void> {
    try {
      const orderData = await this.redis.hget(this.ORDERS_KEY, orderId);
      if (orderData) {
        const order = JSON.parse(orderData);
        order.filledQuantity = filledQuantity;
        order.lastUpdateTime = Date.now();
        
        if (filledQuantity >= order.quantity) {
          order.status = OrderStatus.FILLED;
        } else {
          order.status = OrderStatus.PARTIALLY_FILLED;
        }
        
        await this.redis.hset(this.ORDERS_KEY, orderId, JSON.stringify(order));
      }
    } catch (error) {
      logger.error('Failed to update order fill', { orderId, error });
    }
  }

  async clear(): Promise<void> {
    try {
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      
      logger.info(`Cleared order book for ${this.pair}`);
    } catch (error) {
      logger.error('Failed to clear order book', error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}