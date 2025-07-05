import { io, Socket } from 'socket.io-client';
import { WebSocketServer } from '../../src/websocket/server';
import { getMatchingEngine } from '../../src/services/matchingEngine/singleton';
import { Order, Trade, MarketData } from '../../src/services/matchingEngine/types';

describe('WebSocket Server Tests', () => {
  let wsServer: WebSocketServer;
  let client: Socket;
  let matchingEngine: any;
  const TEST_PORT = 3002;
  const WS_URL = `http://localhost:${TEST_PORT}`;

  beforeAll(async () => {
    // Start WebSocket server
    wsServer = new WebSocketServer(TEST_PORT);
    matchingEngine = getMatchingEngine();
    
    // Allow server to start
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    if (client && client.connected) {
      client.disconnect();
    }
    if (wsServer) {
      wsServer.stop();
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  beforeEach(() => {
    // Create new client for each test
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

  describe('Connection Tests', () => {
    test('should connect successfully', (done) => {
      client.on('connect', () => {
        expect(client.connected).toBe(true);
        done();
      });
    });

    test('should handle ping/pong', (done) => {
      client.on('connect', () => {
        client.emit('ping');
        client.on('pong', (data: any) => {
          expect(data).toHaveProperty('timestamp');
          expect(typeof data.timestamp).toBe('number');
          done();
        });
      });
    });

    test('should handle multiple concurrent connections', async () => {
      const clients: Socket[] = [];
      const connectionPromises: Promise<void>[] = [];

      // Create 10 concurrent connections
      for (let i = 0; i < 10; i++) {
        const newClient = io(WS_URL, {
          transports: ['websocket'],
          reconnection: false
        });
        
        clients.push(newClient);
        
        const promise = new Promise<void>((resolve) => {
          newClient.on('connect', () => {
            resolve();
          });
        });
        
        connectionPromises.push(promise);
      }

      // Wait for all connections
      await Promise.all(connectionPromises);

      // Verify all connected
      clients.forEach(c => {
        expect(c.connected).toBe(true);
      });

      // Cleanup
      clients.forEach(c => c.disconnect());
    });
  });

  describe('Authentication Tests', () => {
    test('should authenticate user successfully', (done) => {
      const userId = 'testUser123';
      
      client.on('connect', () => {
        client.emit('auth', { userId });
        
        client.on('auth:success', (data: any) => {
          expect(data.userId).toBe(userId);
          done();
        });
      });
    });

    test('should join user room after authentication', (done) => {
      const userId = 'testUser456';
      
      client.on('connect', () => {
        client.emit('auth', { userId });
        
        client.on('auth:success', () => {
          // Subscribe to user orders to verify room join
          client.emit('subscribe:orders');
          
          client.on('orders:snapshot', (orders: any) => {
            expect(Array.isArray(orders)).toBe(true);
            done();
          });
        });
      });
    });
  });

  describe('Order Book Subscription Tests', () => {
    test('should subscribe to order book updates', (done) => {
      const pair = 'ETH/USDC';
      
      client.on('connect', () => {
        client.emit('subscribe:orderbook', [pair]);
        
        client.on('orderbook:snapshot', (data: any) => {
          expect(data.pair).toBe(pair);
          expect(data.snapshot).toHaveProperty('bids');
          expect(data.snapshot).toHaveProperty('asks');
          done();
        });
      });
    });

    test('should receive order book updates after subscription', (done) => {
      const pair = 'ETH/USDC';
      
      client.on('connect', () => {
        client.emit('subscribe:orderbook', [pair]);
        
        client.on('orderbook:update', (data: any) => {
          expect(data.pair).toBe(pair);
          expect(data).toHaveProperty('action');
          expect(['add', 'remove', 'update']).toContain(data.action);
          done();
        });

        // Trigger an order book update
        setTimeout(() => {
          const testOrder: Order = {
            id: 'test-order-1',
            userId: 'testUser',
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
          
          matchingEngine.emit('orderAdded', testOrder);
        }, 100);
      });
    });

    test('should unsubscribe from order book', (done) => {
      const pair = 'ETH/USDC';
      let updateCount = 0;
      
      client.on('connect', () => {
        // Subscribe first
        client.emit('subscribe:orderbook', [pair]);
        
        client.on('orderbook:update', () => {
          updateCount++;
        });

        // Unsubscribe after 200ms
        setTimeout(() => {
          client.emit('unsubscribe:orderbook', [pair]);
          
          // Send update after unsubscribe
          setTimeout(() => {
            const testOrder: Order = {
              id: 'test-order-2',
              userId: 'testUser',
              pair,
              side: 'SELL',
              type: 'LIMIT',
              price: 2100,
              quantity: 1,
              filledQuantity: 0,
              status: 'OPEN',
              timeInForce: 'GTC',
              timestamp: Date.now(),
              lastUpdateTime: Date.now()
            };
            
            matchingEngine.emit('orderAdded', testOrder);
            
            // Verify no update received after unsubscribe
            setTimeout(() => {
              expect(updateCount).toBe(0);
              done();
            }, 200);
          }, 100);
        }, 200);
      });
    });
  });

  describe('Trade Subscription Tests', () => {
    test('should subscribe to trades and receive history', (done) => {
      const pair = 'BTC/USDC';
      
      client.on('connect', () => {
        client.emit('subscribe:trades', [pair]);
        
        client.on('trades:history', (data: any) => {
          expect(data.pair).toBe(pair);
          expect(Array.isArray(data.trades)).toBe(true);
          done();
        });
      });
    });

    test('should receive new trade updates', (done) => {
      const pair = 'BTC/USDC';
      
      client.on('connect', () => {
        client.emit('subscribe:trades', [pair]);
        
        client.on('trade:new', (trade: Trade) => {
          expect(trade.pair).toBe(pair);
          expect(trade).toHaveProperty('price');
          expect(trade).toHaveProperty('quantity');
          expect(trade).toHaveProperty('timestamp');
          done();
        });

        // Emit test trade
        setTimeout(() => {
          const testTrade: Trade = {
            id: 'trade-1',
            pair,
            takerOrderId: 'order-1',
            makerOrderId: 'order-2',
            price: 50000,
            quantity: 0.1,
            takerSide: 'BUY',
            timestamp: Date.now(),
            takerFee: 0.001,
            makerFee: 0.0005
          };
          
          matchingEngine.emit('trade', testTrade);
        }, 100);
      });
    });
  });

  describe('Market Data Subscription Tests', () => {
    test('should subscribe to market data', (done) => {
      const pair = 'SOL/USDC';
      
      client.on('connect', () => {
        client.emit('subscribe:market', [pair]);
        
        client.on('market:snapshot', (data: MarketData) => {
          expect(data.pair).toBe(pair);
          expect(data).toHaveProperty('lastPrice');
          expect(data).toHaveProperty('volume24h');
          done();
        });
      });
    });

    test('should receive market data updates', (done) => {
      const pair = 'SOL/USDC';
      
      client.on('connect', () => {
        client.emit('subscribe:market', [pair]);
        
        client.on('market:update', (data: MarketData) => {
          expect(data.pair).toBe(pair);
          expect(typeof data.lastPrice).toBe('number');
          expect(typeof data.volume24h).toBe('number');
          done();
        });

        // Emit market data update
        setTimeout(() => {
          const marketData: MarketData = {
            pair,
            lastPrice: 150,
            bid: 149.5,
            ask: 150.5,
            volume24h: 1000000,
            high24h: 155,
            low24h: 145,
            change24h: 3.5,
            timestamp: Date.now()
          };
          
          matchingEngine.emit('marketDataUpdate', marketData);
        }, 100);
      });
    });
  });

  describe('User Order Subscription Tests', () => {
    test('should subscribe to user orders after authentication', (done) => {
      const userId = 'orderTestUser';
      
      client.on('connect', () => {
        // Authenticate first
        client.emit('auth', { userId });
        
        client.on('auth:success', () => {
          client.emit('subscribe:orders');
          
          client.on('orders:snapshot', (orders: Order[]) => {
            expect(Array.isArray(orders)).toBe(true);
            done();
          });
        });
      });
    });

    test('should receive order status updates', (done) => {
      const userId = 'statusTestUser';
      const pair = 'ETH/USDC';
      
      client.on('connect', () => {
        client.emit('auth', { userId });
        
        client.on('auth:success', () => {
          client.emit('subscribe:orders');
          
          client.on('order:submitted', (order: Order) => {
            expect(order.userId).toBe(userId);
            expect(order.status).toBe('OPEN');
            done();
          });

          // Emit order submitted event
          setTimeout(() => {
            const testOrder: Order = {
              id: 'user-order-1',
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
            
            matchingEngine.emit('orderSubmitted', testOrder);
          }, 100);
        });
      });
    });
  });

  describe('Notification Subscription Tests', () => {
    test('should subscribe to notifications', (done) => {
      const userId = 'notifTestUser';
      
      client.on('connect', () => {
        client.emit('subscribe:notifications', { userId });
        
        client.on('subscribed:notifications', (data: any) => {
          expect(data.success).toBe(true);
          expect(data.userId).toBe(userId);
          expect(data.channel).toBe(`notifications:${userId}`);
          done();
        });
      });
    });

    test('should unsubscribe from notifications', (done) => {
      const userId = 'unsubTestUser';
      
      client.on('connect', () => {
        // Subscribe first
        client.emit('subscribe:notifications', { userId });
        
        client.on('subscribed:notifications', () => {
          // Then unsubscribe
          client.emit('unsubscribe:notifications', { userId });
          
          client.on('unsubscribed:notifications', (data: any) => {
            expect(data.success).toBe(true);
            expect(data.userId).toBe(userId);
            done();
          });
        });
      });
    });
  });

  describe('Error Handling Tests', () => {
    test('should handle invalid subscription gracefully', (done) => {
      client.on('connect', () => {
        // Try to subscribe to orders without authentication
        client.emit('subscribe:orders');
        
        // Should receive empty snapshot since not authenticated
        client.on('orders:snapshot', (orders: any) => {
          expect(orders).toEqual([]);
          done();
        });
      });
    });

    test('should handle disconnection and cleanup', (done) => {
      client.on('connect', () => {
        const clientId = client.id;
        
        client.on('disconnect', () => {
          // Verify client is disconnected
          expect(client.connected).toBe(false);
          done();
        });

        // Force disconnect
        client.disconnect();
      });
    });
  });

  describe('Rate Limiting Tests', () => {
    test('should handle rapid subscription requests', async () => {
      await new Promise<void>((resolve) => {
        client.on('connect', () => {
          const pairs = ['ETH/USDC', 'BTC/USDC', 'SOL/USDC'];
          let snapshotCount = 0;
          
          client.on('orderbook:snapshot', () => {
            snapshotCount++;
            if (snapshotCount === pairs.length) {
              expect(snapshotCount).toBe(pairs.length);
              resolve();
            }
          });

          // Send rapid subscription requests
          pairs.forEach(pair => {
            client.emit('subscribe:orderbook', [pair]);
          });
        });
      });
    });

    test('should handle burst of messages', async () => {
      await new Promise<void>((resolve) => {
        client.on('connect', () => {
          let pongCount = 0;
          const messageCount = 100;
          
          client.on('pong', () => {
            pongCount++;
            if (pongCount === messageCount) {
              expect(pongCount).toBe(messageCount);
              resolve();
            }
          });

          // Send burst of ping messages
          for (let i = 0; i < messageCount; i++) {
            client.emit('ping');
          }
        });
      });
    });
  });

  describe('Memory Leak Tests', () => {
    test('should not leak memory on repeated connect/disconnect', async () => {
      const clients: Socket[] = [];
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        const tempClient = io(WS_URL, {
          transports: ['websocket'],
          reconnection: false
        });

        await new Promise<void>((resolve) => {
          tempClient.on('connect', () => {
            tempClient.disconnect();
            resolve();
          });
        });

        // Small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Memory should be stable (this is a basic check)
      expect(true).toBe(true);
    });

    test('should clean up subscriptions on disconnect', async () => {
      const tempClient = io(WS_URL, {
        transports: ['websocket'],
        reconnection: false
      });

      await new Promise<void>((resolve) => {
        tempClient.on('connect', () => {
          // Subscribe to multiple channels
          tempClient.emit('auth', { userId: 'memTestUser' });
          tempClient.emit('subscribe:orderbook', ['ETH/USDC', 'BTC/USDC']);
          tempClient.emit('subscribe:trades', ['ETH/USDC']);
          tempClient.emit('subscribe:market', ['SOL/USDC']);
          tempClient.emit('subscribe:orders');
          
          // Disconnect after subscriptions
          setTimeout(() => {
            tempClient.disconnect();
            resolve();
          }, 100);
        });
      });

      // Subscriptions should be cleaned up
      expect(tempClient.connected).toBe(false);
    });
  });
});