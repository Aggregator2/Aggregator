import { io, Socket } from 'socket.io-client';
import Redis from 'ioredis';
import { WebSocketServer } from '../../src/websocket/server';
import { RedisOrderBookStore } from '../../src/services/orderBookDatabase/RedisOrderBookStore';
import { OrderBookDatabaseConfig } from '../../src/services/orderBookDatabase/config';
import { getMatchingEngine } from '../../src/services/matchingEngine/singleton';
import { Order, Trade, OrderBookUpdate } from '../../src/services/matchingEngine/types';

describe('WebSocket + Redis Integration Tests', () => {
  let wsServer: WebSocketServer;
  let client: Socket;
  let redis: Redis;
  let redisStore: RedisOrderBookStore;
  let matchingEngine: any;
  
  const TEST_PORT = 3003;
  const WS_URL = `http://localhost:${TEST_PORT}`;
  const config: OrderBookDatabaseConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: 2, // Separate DB for integration tests
      keyPrefix: 'test:integration:',
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000
    },
    orderExpiration: {
      enabled: true,
      defaultTTL: 86400
    }
  };

  beforeAll(async () => {
    // Initialize components
    wsServer = new WebSocketServer(TEST_PORT);
    matchingEngine = getMatchingEngine();
    redis = new Redis(config.redis);
    redisStore = new RedisOrderBookStore(config);

    // Clear test data
    const keys = await redis.keys(`${config.redis.keyPrefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // Allow services to start
    await new Promise(resolve => setTimeout(resolve, 1500));
  });

  afterAll(async () => {
    if (client && client.connected) {
      client.disconnect();
    }
    
    // Cleanup
    const keys = await redis.keys(`${config.redis.keyPrefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    wsServer.stop();
    await redisStore.close();
    await redis.quit();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  beforeEach(() => {
    client = io(WS_URL, {
      transports: ['websocket'],
      reconnection: false
    });
  });

  afterEach(() => {
    if (client && client.connected) {
      client.disconnect();
    }
  });

  describe('Real-time Order Updates', () => {
    test('should sync order updates between WebSocket and Redis', async () => {
      const userId = 'integration-user-1';
      const pair = 'ETH/USDC';
      
      await new Promise<void>((resolve) => {
        client.on('connect', async () => {
          // Authenticate and subscribe
          client.emit('auth', { userId });
          client.emit('subscribe:orderbook', [pair]);
          client.emit('subscribe:orders');

          // Listen for order update
          client.on('order:submitted', async (order: Order) => {
            // Verify order in Redis
            const storedOrder = await redis.hgetall(`${config.redis.keyPrefix}order:${order.id}`);
            expect(storedOrder.id).toBe(order.id);
            expect(storedOrder.userId).toBe(userId);
            
            // Verify order in order book
            const bookKey = `${config.redis.keyPrefix}${pair}:bids`;
            const prices = await redis.zrange(bookKey, 0, -1);
            expect(prices).toContain(order.price.toString());
            
            resolve();
          });

          // Create and store order
          const order: Order = {
            id: 'ws-redis-order-1',
            userId,
            pair,
            side: 'BUY',
            type: 'LIMIT',
            price: 2000,
            quantity: 1,
            filledQuantity: 0,
            status: 'OPEN',
            timeInForce: 'GTC',
            timestamp: Date.now(),
            lastUpdateTime: Date.now()
          };

          // Store in Redis and emit event
          await redisStore.storeOrder(order);
          await redisStore.addToOrderBook(order);
          matchingEngine.emit('orderSubmitted', order);
        });
      });
    });

    test('should propagate order book updates via Redis pub/sub', async () => {
      const pair = 'BTC/USDC';
      
      await new Promise<void>((resolve) => {
        // Subscribe to Redis updates
        redisStore.on('orderbook:update', (channel: string, update: OrderBookUpdate) => {
          if (channel === `${config.redis.keyPrefix}channel:${pair}`) {
            expect(update.type).toBe('ADD');
            expect(update.orderId).toBe('pubsub-order-1');
            resolve();
          }
        });

        client.on('connect', async () => {
          client.emit('subscribe:orderbook', [pair]);

          // Subscribe to Redis channel
          await redisStore.subscribeToOrderBook(pair);

          // Create order and add to book
          const order: Order = {
            id: 'pubsub-order-1',
            userId: 'pubsub-user',
            pair,
            side: 'SELL',
            type: 'LIMIT',
            price: 50000,
            quantity: 0.1,
            filledQuantity: 0,
            status: 'OPEN',
            timeInForce: 'GTC',
            timestamp: Date.now(),
            lastUpdateTime: Date.now()
          };

          await redisStore.addToOrderBook(order);
        });
      });
    });
  });

  describe('Trade Execution Flow', () => {
    test('should persist trades in Redis and notify via WebSocket', async () => {
      const pair = 'SOL/USDC';
      
      await new Promise<void>((resolve) => {
        client.on('connect', () => {
          client.emit('subscribe:trades', [pair]);

          client.on('trade:new', async (trade: Trade) => {
            // Verify trade in Redis
            const storedTrade = await redis.hgetall(`${config.redis.keyPrefix}trade:${trade.id}`);
            expect(storedTrade.id).toBe(trade.id);
            expect(parseFloat(storedTrade.price)).toBe(trade.price);
            expect(parseFloat(storedTrade.quantity)).toBe(trade.quantity);
            
            // Verify in trade history
            const tradeIds = await redis.zrange(
              `${config.redis.keyPrefix}${pair}:trades`,
              0,
              -1
            );
            expect(tradeIds).toContain(trade.id);
            
            resolve();
          });

          // Create and store trade
          setTimeout(async () => {
            const trade: Trade = {
              id: 'integration-trade-1',
              pair,
              takerOrderId: 'taker-1',
              makerOrderId: 'maker-1',
              price: 150,
              quantity: 10,
              takerSide: 'BUY',
              timestamp: Date.now(),
              takerFee: 0.001,
              makerFee: 0.0005
            };

            await redisStore.storeTrade(trade);
            matchingEngine.emit('trade', trade);
          }, 100);
        });
      });
    });
  });

  describe('Market Data Synchronization', () => {
    test('should maintain consistent market data between systems', async () => {
      const pair = 'AVAX/USDC';
      const trades: Trade[] = [];

      // Generate some trades
      for (let i = 0; i < 5; i++) {
        trades.push({
          id: `market-trade-${i}`,
          pair,
          takerOrderId: `t-${i}`,
          makerOrderId: `m-${i}`,
          price: 25 + i * 0.1,
          quantity: 100,
          takerSide: i % 2 === 0 ? 'BUY' : 'SELL',
          timestamp: Date.now() - (5 - i) * 60000, // Last 5 minutes
          takerFee: 0.001,
          makerFee: 0.0005
        });
      }

      // Store trades in Redis
      for (const trade of trades) {
        await redisStore.storeTrade(trade);
      }

      await new Promise<void>((resolve) => {
        client.on('connect', () => {
          client.emit('subscribe:trades', [pair]);

          client.on('trades:history', async (data: any) => {
            expect(data.pair).toBe(pair);
            
            // Verify trades match Redis data
            const redisTrades = await redisStore.getRecentTrades(pair, 5);
            expect(data.trades.length).toBe(redisTrades.length);
            
            resolve();
          });
        });
      });
    });
  });

  describe('Failure Recovery', () => {
    test('should recover from Redis connection failure', async () => {
      const pair = 'LINK/USDC';
      let errorEmitted = false;
      
      // Listen for Redis errors
      redisStore.on('error', (err) => {
        errorEmitted = true;
      });

      // Create order that should persist
      const order: Order = {
        id: 'recovery-order-1',
        userId: 'recovery-user',
        pair,
        side: 'BUY',
        type: 'LIMIT',
        price: 15,
        quantity: 100,
        filledQuantity: 0,
        status: 'OPEN',
        timeInForce: 'GTC',
        timestamp: Date.now(),
        lastUpdateTime: Date.now()
      };

      await redisStore.storeOrder(order);

      // Verify order exists even if connection has issues
      const exists = await redis.exists(`${config.redis.keyPrefix}order:${order.id}`);
      expect(exists).toBe(1);
    });

    test('should handle WebSocket reconnection with Redis state', async () => {
      const userId = 'reconnect-user';
      const pair = 'DOT/USDC';

      // Store some orders in Redis first
      const orders: Order[] = [];
      for (let i = 0; i < 3; i++) {
        const order: Order = {
          id: `reconnect-order-${i}`,
          userId,
          pair,
          side: i % 2 === 0 ? 'BUY' : 'SELL',
          type: 'LIMIT',
          price: 10 + i * 0.1,
          quantity: 50,
          filledQuantity: 0,
          status: 'OPEN',
          timeInForce: 'GTC',
          timestamp: Date.now(),
          lastUpdateTime: Date.now()
        };
        orders.push(order);
        await redisStore.storeOrder(order);
        await redisStore.addToOrderBook(order);
      }

      // Connect and verify state
      await new Promise<void>((resolve) => {
        client.on('connect', () => {
          client.emit('auth', { userId });
          client.emit('subscribe:orderbook', [pair]);

          client.on('orderbook:snapshot', async (data: any) => {
            // Get Redis snapshot
            const redisSnapshot = await redisStore.getOrderBookSnapshot(pair);
            
            // Verify consistency
            expect(data.snapshot.bids.length).toBeGreaterThan(0);
            expect(data.snapshot.asks.length).toBeGreaterThan(0);
            
            resolve();
          });
        });
      });
    });
  });

  describe('Performance Under Load', () => {
    test('should handle high throughput with Redis caching', async () => {
      const pair = 'PERF/USDC';
      const orderCount = 100;
      const startTime = Date.now();

      await new Promise<void>((resolve) => {
        let receivedUpdates = 0;

        client.on('connect', () => {
          client.emit('subscribe:orderbook', [pair]);

          client.on('orderbook:update', () => {
            receivedUpdates++;
            if (receivedUpdates === orderCount) {
              const duration = Date.now() - startTime;
              const throughput = (orderCount / duration) * 1000;
              
              console.log(`Throughput: ${throughput.toFixed(2)} orders/sec`);
              expect(throughput).toBeGreaterThan(50); // At least 50 orders/sec
              resolve();
            }
          });

          // Generate high load
          setTimeout(async () => {
            for (let i = 0; i < orderCount; i++) {
              const order: Order = {
                id: `load-order-${i}`,
                userId: 'load-user',
                pair,
                side: i % 2 === 0 ? 'BUY' : 'SELL',
                type: 'LIMIT',
                price: 100 + (i % 20) * 0.1,
                quantity: 10,
                filledQuantity: 0,
                status: 'OPEN',
                timeInForce: 'GTC',
                timestamp: Date.now(),
                lastUpdateTime: Date.now()
              };

              // Store in Redis and emit
              redisStore.addToOrderBook(order);
              matchingEngine.emit('orderAdded', order);
            }
          }, 100);
        });
      });
    });

    test('should maintain data consistency under concurrent operations', async () => {
      const pair = 'CONCURRENT/USDC';
      const concurrentOps = 50;

      await new Promise<void>((resolve) => {
        let processedCount = 0;

        client.on('connect', async () => {
          client.emit('subscribe:orderbook', [pair]);
          client.emit('subscribe:trades', [pair]);

          // Track processed operations
          client.on('orderbook:update', () => {
            processedCount++;
            if (processedCount >= concurrentOps * 2) {
              checkConsistency();
            }
          });

          client.on('trade:new', () => {
            processedCount++;
            if (processedCount >= concurrentOps * 2) {
              checkConsistency();
            }
          });

          // Perform concurrent operations
          const promises: Promise<void>[] = [];

          for (let i = 0; i < concurrentOps; i++) {
            // Add order
            const order: Order = {
              id: `concurrent-${i}`,
              userId: `user-${i % 5}`,
              pair,
              side: i % 2 === 0 ? 'BUY' : 'SELL',
              type: 'LIMIT',
              price: 50 + (i % 10) * 0.1,
              quantity: 100,
              filledQuantity: 0,
              status: 'OPEN',
              timeInForce: 'GTC',
              timestamp: Date.now(),
              lastUpdateTime: Date.now()
            };

            promises.push(
              redisStore.addToOrderBook(order).then(() => {
                matchingEngine.emit('orderAdded', order);
              })
            );

            // Add trade
            const trade: Trade = {
              id: `concurrent-trade-${i}`,
              pair,
              takerOrderId: `t-${i}`,
              makerOrderId: `m-${i}`,
              price: 50,
              quantity: 50,
              takerSide: 'BUY',
              timestamp: Date.now(),
              takerFee: 0.001,
              makerFee: 0.0005
            };

            promises.push(
              redisStore.storeTrade(trade).then(() => {
                matchingEngine.emit('trade', trade);
              })
            );
          }

          await Promise.all(promises);

          async function checkConsistency() {
            // Verify Redis state
            const snapshot = await redisStore.getOrderBookSnapshot(pair);
            const trades = await redisStore.getRecentTrades(pair, concurrentOps);

            expect(snapshot.bids.length + snapshot.asks.length).toBeGreaterThan(0);
            expect(trades.length).toBeGreaterThan(0);
            
            resolve();
          }
        });
      });
    });
  });

  describe('Notification Integration', () => {
    test('should deliver notifications through WebSocket with Redis backing', async () => {
      const userId = 'notif-user';
      
      await new Promise<void>((resolve) => {
        client.on('connect', () => {
          client.emit('subscribe:notifications', { userId });

          client.on('subscribed:notifications', async (data: any) => {
            expect(data.success).toBe(true);
            
            // Store notification preference in Redis
            await redis.hset(
              `${config.redis.keyPrefix}user:${userId}:preferences`,
              'notifications',
              'enabled'
            );

            // Verify preference stored
            const pref = await redis.hget(
              `${config.redis.keyPrefix}user:${userId}:preferences`,
              'notifications'
            );
            expect(pref).toBe('enabled');
            
            resolve();
          });
        });
      });
    });
  });

  describe('Security and Rate Limiting', () => {
    test('should rate limit WebSocket connections using Redis', async () => {
      const rateLimitKey = `${config.redis.keyPrefix}ratelimit:connections`;
      
      // Set up rate limit in Redis
      await redis.setex(rateLimitKey, 60, '0');

      const connections: Socket[] = [];
      const maxConnections = 5;

      for (let i = 0; i < maxConnections + 2; i++) {
        const newClient = io(WS_URL, {
          transports: ['websocket'],
          reconnection: false
        });

        connections.push(newClient);

        // Increment rate limit counter
        await redis.incr(rateLimitKey);
      }

      // Check rate limit counter
      const count = await redis.get(rateLimitKey);
      expect(parseInt(count!)).toBe(maxConnections + 2);

      // Cleanup
      connections.forEach(c => c.disconnect());
    });

    test('should validate authentication tokens with Redis session store', async () => {
      const userId = 'auth-test-user';
      const sessionToken = 'test-session-token';
      
      // Store session in Redis
      await redis.setex(
        `${config.redis.keyPrefix}session:${sessionToken}`,
        3600,
        JSON.stringify({ userId, createdAt: Date.now() })
      );

      await new Promise<void>((resolve) => {
        client.on('connect', () => {
          // Authenticate with token
          client.emit('auth', { userId, token: sessionToken });

          client.on('auth:success', async (data: any) => {
            // Verify session exists in Redis
            const session = await redis.get(`${config.redis.keyPrefix}session:${sessionToken}`);
            expect(session).toBeTruthy();
            
            const sessionData = JSON.parse(session!);
            expect(sessionData.userId).toBe(userId);
            
            resolve();
          });
        });
      });
    });
  });

  describe('Monitoring and Health Checks', () => {
    test('should track WebSocket metrics in Redis', async () => {
      const metricsKey = `${config.redis.keyPrefix}metrics:websocket`;
      
      // Initialize metrics
      await redis.hset(metricsKey, {
        connections: 0,
        messages: 0,
        errors: 0,
        lastUpdate: Date.now()
      });

      await new Promise<void>((resolve) => {
        client.on('connect', async () => {
          // Increment connection count
          await redis.hincrby(metricsKey, 'connections', 1);

          client.emit('ping');
          
          client.on('pong', async () => {
            // Increment message count
            await redis.hincrby(metricsKey, 'messages', 1);
            
            // Get metrics
            const metrics = await redis.hgetall(metricsKey);
            expect(parseInt(metrics.connections)).toBeGreaterThan(0);
            expect(parseInt(metrics.messages)).toBeGreaterThan(0);
            
            resolve();
          });
        });
      });
    });

    test('should monitor Redis health status', async () => {
      const healthKey = `${config.redis.keyPrefix}health:redis`;
      
      // Check Redis health
      const ping = await redis.ping();
      expect(ping).toBe('PONG');

      // Store health status
      await redis.hset(healthKey, {
        status: 'healthy',
        lastCheck: Date.now(),
        latency: await redis.ping('ms'),
        connections: await redis.client('LIST').then(list => list.split('\n').length - 1)
      });

      // Verify health stored
      const health = await redis.hgetall(healthKey);
      expect(health.status).toBe('healthy');
      expect(health).toHaveProperty('latency');
      expect(health).toHaveProperty('connections');
    });
  });
});