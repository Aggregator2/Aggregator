import Redis from 'ioredis';
import { RedisOrderBookStore } from '../../src/services/orderBookDatabase/RedisOrderBookStore';
import { OrderBookDatabaseConfig } from '../../src/services/orderBookDatabase/config';
import { Order, Trade, OrderBookUpdate } from '../../src/services/matchingEngine/types';

describe('Redis Integration Tests', () => {
  let redis: Redis;
  let redisStore: RedisOrderBookStore;
  let config: OrderBookDatabaseConfig;

  // Helper function to wait for subscription confirmation
  const waitForSubscription = async (channel: string, maxAttempts = 20): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      const channels = await redis.pubsub('CHANNELS', channel);
      if (channels.includes(channel)) {
        // Add small delay to ensure subscriber is fully ready
        await new Promise(resolve => setTimeout(resolve, 50));
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  };

  // Helper function to wait for unsubscription confirmation
  const waitForUnsubscription = async (channel: string, maxAttempts = 20): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      const channels = await redis.pubsub('CHANNELS', channel);
      if (!channels.includes(channel)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  };

  beforeAll(async () => {
    // Test configuration
    config = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: 1, // Use separate DB for tests
        keyPrefix: 'test:swappiq:',
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        connectTimeout: 10000
      },
      orderExpiration: {
        enabled: true,
        defaultTTL: 86400,
        customTTL: {
          'ETH/USDC': 7200
        }
      }
    };

    // Create Redis connection for testing
    redis = new Redis(config.redis);
    redisStore = new RedisOrderBookStore(config);

    // Wait for connections and verify with PING
    await new Promise((resolve, reject) => {
      let attempts = 0;
      const checkConnection = async () => {
        try {
          const pong = await redis.ping();
          if (pong === 'PONG') {
            resolve(undefined);
          } else {
            throw new Error('Invalid PING response');
          }
        } catch (err) {
          attempts++;
          if (attempts < 5) {
            setTimeout(checkConnection, 200);
          } else {
            reject(new Error('Failed to connect to Redis'));
          }
        }
      };
      checkConnection();
    });

    // Clear test data
    const keys = await redis.keys(`${config.redis.keyPrefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterEach(async () => {
    // Unsubscribe from all channels after each test
    const channels = await redis.pubsub('CHANNELS', `${config.redis.keyPrefix}channel:*`);
    for (const channel of channels) {
      await redisStore.unsubscribeFromOrderBook(channel.replace(`${config.redis.keyPrefix}channel:`, ''));
    }
    // Small delay to ensure unsubscriptions are processed
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    // Cleanup
    const keys = await redis.keys(`${config.redis.keyPrefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    await redisStore.close();
    await redis.quit();
  });

  describe('Redis Connection Tests', () => {
    test('should connect to Redis successfully', async () => {
      const ping = await redis.ping();
      expect(ping).toBe('PONG');
    });

    test('should handle connection errors gracefully', async () => {
      const badConfig: OrderBookDatabaseConfig = {
        ...config,
        redis: {
          ...config.redis,
          host: 'invalid-host',
          connectTimeout: 1000,
          maxRetriesPerRequest: 1
        }
      };

      const badStore = new RedisOrderBookStore(badConfig);
      
      // Listen for error event
      const errorPromise = new Promise((resolve) => {
        badStore.on('error', (err) => {
          expect(err).toBeDefined();
          resolve(err);
        });
      });

      await errorPromise;
      await badStore.close();
    });

    test('should emit connected event', async () => {
      const newStore = new RedisOrderBookStore(config);
      
      const connectedPromise = new Promise<void>((resolve) => {
        newStore.on('connected', () => {
          resolve();
        });
      });

      // Wait for connected event with timeout
      await Promise.race([
        connectedPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout waiting for connected event')), 5000)
        )
      ]);

      await newStore.close();
    }, 10000);
  });

  describe('Order Storage Tests', () => {
    test('should store order in Redis', async () => {
      const order: Order = {
        id: 'order-1',
        userId: 'user-1',
        pair: 'ETH/USDC',
        side: 'BUY',
        type: 'LIMIT',
        price: 2000,
        quantity: 1,
        filledQuantity: 0,
        status: 'OPEN',
        timeInForce: 'GTC',
        timestamp: Date.now(),
        lastUpdateTime: Date.now(),
        clientOrderId: 'client-1',
        metadata: { source: 'test' }
      };

      await redisStore.storeOrder(order);

      // Verify order stored
      const storedData = await redis.hgetall(`${config.redis.keyPrefix}order:${order.id}`);
      expect(storedData.id).toBe(order.id);
      expect(storedData.userId).toBe(order.userId);
      expect(storedData.pair).toBe(order.pair);
      expect(parseFloat(storedData.price)).toBe(order.price);
    });

    test('should set TTL on orders when expiration enabled', async () => {
      const order: Order = {
        id: 'order-ttl-1',
        userId: 'user-1',
        pair: 'ETH/USDC',
        side: 'SELL',
        type: 'LIMIT',
        price: 2100,
        quantity: 0.5,
        filledQuantity: 0,
        status: 'OPEN',
        timeInForce: 'GTC',
        timestamp: Date.now(),
        lastUpdateTime: Date.now()
      };

      await redisStore.storeOrder(order);

      const ttl = await redis.ttl(`${config.redis.keyPrefix}order:${order.id}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(7200); // Custom TTL for ETH/USDC
    });

    test('should add order to user and pair indices', async () => {
      const order: Order = {
        id: 'order-index-1',
        userId: 'user-2',
        pair: 'BTC/USDC',
        side: 'BUY',
        type: 'LIMIT',
        price: 50000,
        quantity: 0.1,
        filledQuantity: 0,
        status: 'OPEN',
        timeInForce: 'GTC',
        timestamp: Date.now(),
        lastUpdateTime: Date.now()
      };

      await redisStore.storeOrder(order);

      // Check user index
      const userOrders = await redis.smembers(`${config.redis.keyPrefix}user:${order.userId}:orders`);
      expect(userOrders).toContain(order.id);

      // Check pair index
      const pairOrders = await redis.smembers(`${config.redis.keyPrefix}pair:${order.pair}:orders`);
      expect(pairOrders).toContain(order.id);
    });
  });

  describe('Order Book Management Tests', () => {
    test('should add order to order book', async () => {
      const order: Order = {
        id: 'book-order-1',
        userId: 'user-1',
        pair: 'ETH/USDC',
        side: 'BUY',
        type: 'LIMIT',
        price: 1950,
        quantity: 2,
        filledQuantity: 0,
        status: 'OPEN',
        timeInForce: 'GTC',
        timestamp: Date.now(),
        lastUpdateTime: Date.now()
      };

      let updateReceived = false;
      redisStore.on('orderbook:update', (channel: string, update: OrderBookUpdate) => {
        updateReceived = true;
        expect(update.type).toBe('ADD');
        expect(update.price).toBe(order.price);
        expect(update.orderId).toBe(order.id);
      });

      await redisStore.addToOrderBook(order);

      // Verify order in book
      const bookKey = `${config.redis.keyPrefix}${order.pair}:bids`;
      const prices = await redis.zrange(bookKey, 0, -1);
      expect(prices).toContain(order.price.toString());

      // Verify volume
      const volumeKey = `${bookKey}:volume`;
      const volume = await redis.hget(volumeKey, order.price.toString());
      expect(parseInt(volume!)).toBe(order.quantity);
    });

    test('should remove order from order book', async () => {
      const order: Order = {
        id: 'book-order-2',
        userId: 'user-1',
        pair: 'ETH/USDC',
        side: 'SELL',
        type: 'LIMIT',
        price: 2050,
        quantity: 1.5,
        filledQuantity: 0,
        status: 'OPEN',
        timeInForce: 'GTC',
        timestamp: Date.now(),
        lastUpdateTime: Date.now()
      };

      // Add order first
      await redisStore.addToOrderBook(order);

      // Remove order
      await redisStore.removeFromOrderBook(order);

      // Verify order removed
      const bookKey = `${config.redis.keyPrefix}${order.pair}:asks`;
      const levelKey = `${bookKey}:${order.price}`;
      const levelOrders = await redis.lrange(levelKey, 0, -1);
      
      const orderInLevel = levelOrders.some(o => {
        const parsed = JSON.parse(o);
        return parsed.id === order.id;
      });
      
      expect(orderInLevel).toBe(false);
    });

    test('should get order book snapshot', async () => {
      // Add multiple orders
      const orders: Order[] = [
        {
          id: 'snap-bid-1',
          userId: 'user-1',
          pair: 'SOL/USDC',
          side: 'BUY',
          type: 'LIMIT',
          price: 145,
          quantity: 10,
          filledQuantity: 0,
          status: 'OPEN',
          timeInForce: 'GTC',
          timestamp: Date.now(),
          lastUpdateTime: Date.now()
        },
        {
          id: 'snap-bid-2',
          userId: 'user-2',
          pair: 'SOL/USDC',
          side: 'BUY',
          type: 'LIMIT',
          price: 144,
          quantity: 15,
          filledQuantity: 0,
          status: 'OPEN',
          timeInForce: 'GTC',
          timestamp: Date.now(),
          lastUpdateTime: Date.now()
        },
        {
          id: 'snap-ask-1',
          userId: 'user-3',
          pair: 'SOL/USDC',
          side: 'SELL',
          type: 'LIMIT',
          price: 146,
          quantity: 8,
          filledQuantity: 0,
          status: 'OPEN',
          timeInForce: 'GTC',
          timestamp: Date.now(),
          lastUpdateTime: Date.now()
        }
      ];

      for (const order of orders) {
        await redisStore.addToOrderBook(order);
      }

      // Get snapshot
      const snapshot = await redisStore.getOrderBookSnapshot('SOL/USDC', 10);

      expect(snapshot.pair).toBe('SOL/USDC');
      expect(snapshot.bids.length).toBeGreaterThanOrEqual(2);
      expect(snapshot.asks.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.bids[0].price).toBe(145); // Highest bid first
      expect(snapshot.asks[0].price).toBe(146); // Lowest ask first
    });
  });

  describe('Trade Storage Tests', () => {
    test('should store trade in Redis', async () => {
      const trade: Trade = {
        id: 'trade-1',
        pair: 'ETH/USDC',
        takerOrderId: 'order-1',
        makerOrderId: 'order-2',
        price: 2000,
        quantity: 0.5,
        takerSide: 'BUY',
        timestamp: Date.now(),
        takerFee: 0.001,
        makerFee: 0.0005
      };

      await redisStore.storeTrade(trade);

      // Verify trade stored
      const storedData = await redis.hgetall(`${config.redis.keyPrefix}trade:${trade.id}`);
      expect(storedData.id).toBe(trade.id);
      expect(storedData.pair).toBe(trade.pair);
      expect(parseFloat(storedData.price)).toBe(trade.price);
      expect(parseFloat(storedData.quantity)).toBe(trade.quantity);
    });

    test('should add trade to history', async () => {
      const trade: Trade = {
        id: 'trade-history-1',
        pair: 'BTC/USDC',
        takerOrderId: 'order-3',
        makerOrderId: 'order-4',
        price: 50000,
        quantity: 0.1,
        takerSide: 'SELL',
        timestamp: Date.now(),
        takerFee: 0.001,
        makerFee: 0.0005
      };

      await redisStore.storeTrade(trade);

      // Check trade in history
      const tradeIds = await redis.zrange(
        `${config.redis.keyPrefix}${trade.pair}:trades`,
        0,
        -1
      );
      expect(tradeIds).toContain(trade.id);
    });

    test('should get recent trades', async () => {
      const pair = 'DOT/USDC';
      const trades: Trade[] = [];

      // Add multiple trades
      for (let i = 0; i < 5; i++) {
        const trade: Trade = {
          id: `recent-trade-${i}`,
          pair,
          takerOrderId: `order-t-${i}`,
          makerOrderId: `order-m-${i}`,
          price: 10 + i * 0.1,
          quantity: 100,
          takerSide: i % 2 === 0 ? 'BUY' : 'SELL',
          timestamp: Date.now() + i * 1000,
          takerFee: 0.001,
          makerFee: 0.0005
        };
        trades.push(trade);
        await redisStore.storeTrade(trade);
      }

      // Get recent trades
      const recentTrades = await redisStore.getRecentTrades(pair, 3);

      expect(recentTrades.length).toBe(3);
      expect(recentTrades[0].id).toBe('recent-trade-4'); // Most recent first
      expect(recentTrades[1].id).toBe('recent-trade-3');
      expect(recentTrades[2].id).toBe('recent-trade-2');
    });
  });

  describe('Pub/Sub Tests', () => {
    test('should subscribe to order book updates', async () => {
      const pair = 'AVAX/USDC';
      const channel = `${config.redis.keyPrefix}channel:${pair}`;
      
      await redisStore.subscribeToOrderBook(pair);

      // Wait for subscription confirmation
      const subscribed = await waitForSubscription(channel);
      expect(subscribed).toBe(true);
    }, 10000);

    test('should unsubscribe from order book updates', async () => {
      const pair = 'MATIC/USDC';
      const channel = `${config.redis.keyPrefix}channel:${pair}`;
      
      // Subscribe first
      await redisStore.subscribeToOrderBook(pair);
      
      // Wait for subscription confirmation
      const subscribed = await waitForSubscription(channel);
      expect(subscribed).toBe(true);
      
      // Then unsubscribe
      await redisStore.unsubscribeFromOrderBook(pair);

      // Wait for unsubscribe confirmation
      const unsubscribed = await waitForUnsubscription(channel);
      expect(unsubscribed).toBe(true);
    }, 10000);

    test('should receive published updates', async () => {
      const pair = 'UNI/USDC';
      const channel = `${config.redis.keyPrefix}channel:${pair}`;
      const testUpdate: OrderBookUpdate = {
        type: 'ADD',
        side: 'BUY',
        price: 5.5,
        quantity: 1000,
        orderId: 'test-order-pub',
        timestamp: Date.now(),
        sequenceNumber: 1
      };

      // Create promise for update before subscribing
      const updatePromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for orderbook update'));
        }, 10000); // 10 second timeout

        const handler = (receivedChannel: string, update: OrderBookUpdate) => {
          if (receivedChannel === channel) {
            clearTimeout(timeout);
            try {
              expect(update.type).toBe(testUpdate.type);
              expect(update.price).toBe(testUpdate.price);
              expect(update.orderId).toBe(testUpdate.orderId);
              redisStore.removeListener('orderbook:update', handler);
              resolve();
            } catch (err) {
              reject(err);
            }
          }
        };

        redisStore.on('orderbook:update', handler);
      });

      // Subscribe to the channel
      await redisStore.subscribeToOrderBook(pair);

      // Wait for subscription to be ready
      const subscribed = await waitForSubscription(channel);
      if (!subscribed) {
        throw new Error(`Failed to confirm subscription to ${channel}`);
      }

      // Publish update
      await redis.publish(channel, JSON.stringify(testUpdate));

      // Wait for the update to be received
      await updatePromise;
    }, 15000); // 15 second test timeout
  });

  describe('Failover and Recovery Tests', () => {
    test('should handle temporary Redis disconnection', async () => {
      // This test simulates network issues
      const order: Order = {
        id: 'failover-order-1',
        userId: 'user-1',
        pair: 'ETH/USDC',
        side: 'BUY',
        type: 'LIMIT',
        price: 1900,
        quantity: 1,
        filledQuantity: 0,
        status: 'OPEN',
        timeInForce: 'GTC',
        timestamp: Date.now(),
        lastUpdateTime: Date.now()
      };

      // Store order successfully
      await redisStore.storeOrder(order);

      // Verify stored
      const stored = await redis.exists(`${config.redis.keyPrefix}order:${order.id}`);
      expect(stored).toBe(1);
    });

    test('should handle concurrent operations', async () => {
      const promises: Promise<void>[] = [];
      const orderCount = 10;

      // Create multiple orders concurrently
      for (let i = 0; i < orderCount; i++) {
        const order: Order = {
          id: `concurrent-order-${i}`,
          userId: `user-${i % 3}`,
          pair: 'ETH/USDC',
          side: i % 2 === 0 ? 'BUY' : 'SELL',
          type: 'LIMIT',
          price: 2000 + i,
          quantity: 0.1 * (i + 1),
          filledQuantity: 0,
          status: 'OPEN',
          timeInForce: 'GTC',
          timestamp: Date.now(),
          lastUpdateTime: Date.now()
        };

        promises.push(redisStore.storeOrder(order));
        promises.push(redisStore.addToOrderBook(order));
      }

      // Wait for all operations
      await Promise.all(promises);

      // Verify all orders stored
      for (let i = 0; i < orderCount; i++) {
        const exists = await redis.exists(`${config.redis.keyPrefix}order:concurrent-order-${i}`);
        expect(exists).toBe(1);
      }
    });
  });

  describe('Connection Pool Tests', () => {
    test('should handle multiple simultaneous connections', async () => {
      const operations: Promise<any>[] = [];

      // Perform multiple operations simultaneously
      for (let i = 0; i < 20; i++) {
        operations.push(
          redis.ping(),
          redis.set(`${config.redis.keyPrefix}test:${i}`, `value-${i}`),
          redis.get(`${config.redis.keyPrefix}test:${i}`)
        );
      }

      const results = await Promise.all(operations);
      
      // Verify all operations succeeded
      expect(results.filter(r => r === 'PONG').length).toBe(20);
      expect(results.filter(r => r === 'OK').length).toBe(20);
    });
  });

  describe('Data Persistence Tests', () => {
    test('should persist data across reconnections', async () => {
      const testKey = `${config.redis.keyPrefix}persist:test`;
      const testValue = 'persistent-value';

      // Set value
      await redis.set(testKey, testValue);

      // Create new connection
      const newRedis = new Redis(config.redis);
      
      // Verify value persisted
      const retrievedValue = await newRedis.get(testKey);
      expect(retrievedValue).toBe(testValue);

      await newRedis.quit();
    });

    test('should handle cleanup of expired orders', async () => {
      const expiredCount = await redisStore.cleanupExpiredOrders();
      expect(typeof expiredCount).toBe('number');
      expect(expiredCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance Tests', () => {
    test('should handle high-frequency updates', async () => {
      const startTime = Date.now();
      const updateCount = 1000;
      const pair = 'PERF/USDC';

      // Rapid order book updates
      for (let i = 0; i < updateCount; i++) {
        const order: Order = {
          id: `perf-order-${i}`,
          userId: 'perf-user',
          pair,
          side: i % 2 === 0 ? 'BUY' : 'SELL',
          type: 'LIMIT',
          price: 100 + (i % 10) * 0.1,
          quantity: 10,
          filledQuantity: 0,
          status: 'OPEN',
          timeInForce: 'GTC',
          timestamp: Date.now(),
          lastUpdateTime: Date.now()
        };

        await redisStore.addToOrderBook(order);
      }

      const duration = Date.now() - startTime;
      const opsPerSecond = (updateCount / duration) * 1000;

      console.log(`Performance: ${opsPerSecond.toFixed(2)} ops/sec`);
      expect(opsPerSecond).toBeGreaterThan(100); // At least 100 ops/sec
    });

    test('should efficiently retrieve large snapshots', async () => {
      const pair = 'LARGE/USDC';
      
      // Add many orders
      for (let i = 0; i < 100; i++) {
        const order: Order = {
          id: `large-order-${i}`,
          userId: 'user-1',
          pair,
          side: i < 50 ? 'BUY' : 'SELL',
          type: 'LIMIT',
          price: i < 50 ? 100 - i * 0.1 : 100 + (i - 50) * 0.1,
          quantity: 100,
          filledQuantity: 0,
          status: 'OPEN',
          timeInForce: 'GTC',
          timestamp: Date.now(),
          lastUpdateTime: Date.now()
        };

        await redisStore.addToOrderBook(order);
      }

      const startTime = Date.now();
      const snapshot = await redisStore.getOrderBookSnapshot(pair, 50);
      const retrievalTime = Date.now() - startTime;

      expect(snapshot.bids.length).toBeLessThanOrEqual(50);
      expect(snapshot.asks.length).toBeLessThanOrEqual(50);
      expect(retrievalTime).toBeLessThan(100); // Should be fast
    });
  });
});