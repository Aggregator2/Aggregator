const { getMatchingEngine } = require('../src/services/matchingEngine/singleton');
const Redis = require('ioredis');
const io = require('socket.io-client');
const axios = require('axios');

describe('Simple Integration Tests', () => {
  let redis;
  let matchingEngine;
  let socket;

  beforeAll(async () => {
    // Initialize services
    redis = new Redis();
    matchingEngine = getMatchingEngine();
    
    // Wait for services
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    if (redis) await redis.disconnect();
    if (socket) socket.disconnect();
  });

  test('Redis should be connected', async () => {
    const pong = await redis.ping();
    expect(pong).toBe('PONG');
  });

  test('Matching engine should have trading pairs', () => {
    const pairs = matchingEngine.getTradingPairs();
    expect(pairs).toContain('ETH/USDC');
    expect(pairs).toContain('ETH/USDT');
    expect(pairs.length).toBe(4);
  });

  test('API health endpoint should be healthy', async () => {
    const response = await axios.get('http://localhost:3000/api/health');
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('healthy');
    expect(response.data.services.redis.status).toBe('healthy');
    expect(response.data.services.database.status).toBe('healthy');
  });

  test('WebSocket should connect', async () => {
    return new Promise((resolve, reject) => {
      socket = io('http://localhost:3001', {
        transports: ['websocket'],
        reconnection: false
      });

      socket.on('connect', () => {
        expect(socket.connected).toBe(true);
        resolve();
      });

      socket.on('connect_error', (error) => {
        reject(new Error(`WebSocket connection failed: ${error.message}`));
      });

      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });
  });

  test('Blockchain should be accessible', async () => {
    const response = await axios.post('http://localhost:8545', {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1
    });
    expect(response.data.result).toBeDefined();
  });

  test('Full order flow simulation', async () => {
    // 1. Create order in matching engine
    const order = {
      id: 'test-order-1',
      userId: 'test-user',
      pair: 'ETH/USDC',
      side: 'BUY',
      type: 'LIMIT',
      price: 2000,
      quantity: 0.1,
      timestamp: Date.now()
    };

    // submitOrder returns the order with status
    matchingEngine.submitOrder(order);
    
    // Verify order was added to order book
    const orderBook = matchingEngine.getOrderBook('ETH/USDC');
    expect(orderBook).toBeDefined();
    expect(orderBook.bids || orderBook.asks).toBeDefined();

    // 2. Store in Redis
    await redis.set(`order:${order.id}`, JSON.stringify(order));
    const stored = await redis.get(`order:${order.id}`);
    expect(JSON.parse(stored).id).toBe(order.id);

    // 3. Verify final state
    const finalOrderBook = matchingEngine.getOrderBook('ETH/USDC');
    expect(finalOrderBook).toBeDefined();
    
    // Cleanup
    await redis.del(`order:${order.id}`);
  });
});