const request = require('supertest');
const { faker } = require('@faker-js/faker');
const jwt = require('jsonwebtoken');

// Mock setup similar to submitOrder test
jest.mock('next/config', () => () => ({
  serverRuntimeConfig: {},
  publicRuntimeConfig: {}
}));

// In-memory store for integration testing
const orderStore = new Map();
const userStore = new Map();

// Mock Prisma with in-memory store
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    order: {
      create: jest.fn().mockImplementation(({ data }) => {
        const order = {
          id: faker.string.uuid(),
          ...data,
          status: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date()
        };
        orderStore.set(order.id, order);
        return Promise.resolve(order);
      }),
      findMany: jest.fn().mockImplementation(({ where }) => {
        const orders = Array.from(orderStore.values());
        if (where?.userId) {
          return Promise.resolve(orders.filter(o => o.userId === where.userId));
        }
        return Promise.resolve(orders);
      }),
      findUnique: jest.fn().mockImplementation(({ where }) => {
        return Promise.resolve(orderStore.get(where.id));
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const order = orderStore.get(where.id);
        if (order) {
          const updated = { ...order, ...data, updatedAt: new Date() };
          orderStore.set(where.id, updated);
          return Promise.resolve(updated);
        }
        return Promise.resolve(null);
      })
    },
    user: {
      findUnique: jest.fn().mockImplementation(({ where }) => {
        if (where.id) return Promise.resolve(userStore.get(where.id));
        if (where.email) {
          const users = Array.from(userStore.values());
          return Promise.resolve(users.find(u => u.email === where.email));
        }
        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation(({ data }) => {
        const user = {
          id: faker.string.uuid(),
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        userStore.set(user.id, user);
        return Promise.resolve(user);
      })
    },
    $disconnect: jest.fn(),
  })),
}));

// Mock balance service
jest.mock('../../src/services/balanceValidation/BalanceValidationService', () => ({
  BalanceValidationService: jest.fn().mockImplementation(() => ({
    validateBalance: jest.fn().mockResolvedValue(true),
    getBalance: jest.fn().mockResolvedValue({ balance: '1000000000000000000' }),
  })),
}));

// Import handlers
const submitOrderHandler = require('../../pages/api/submitOrder');
const ordersHandler = require('../../pages/api/orders');
const cancelOrderHandler = require('../../pages/api/cancelOrder');
const { createServer } = require('http');
const { apiResolver } = require('next/dist/server/api-utils/node');

describe('Order Flow Integration Test', () => {
  let server;
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-only';
  
  // Helper to create test server with multiple endpoints
  const createTestServer = () => {
    return createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      // Route to appropriate handler
      if (url.pathname === '/api/submitOrder' && req.method === 'POST') {
        return apiResolver(req, res, undefined, submitOrderHandler, {}, false);
      } else if (url.pathname === '/api/orders' && req.method === 'GET') {
        return apiResolver(req, res, undefined, ordersHandler, {}, false);
      } else if (url.pathname === '/api/cancelOrder' && req.method === 'POST') {
        return apiResolver(req, res, undefined, cancelOrderHandler, {}, false);
      } else {
        res.statusCode = 404;
        res.end('Not Found');
      }
    });
  };

  // Helper to create authenticated user
  const createAuthenticatedUser = () => {
    const user = {
      id: faker.string.uuid(),
      email: faker.internet.email(),
      walletAddress: faker.finance.ethereumAddress(),
      role: 'USER'
    };
    
    userStore.set(user.id, user);
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    return { user, token };
  };

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.BACKEND_PRIVATE_KEY = '0x' + faker.string.hexadecimal({ length: 64, prefix: false });
    server = createTestServer();
  });

  beforeEach(() => {
    // Clear in-memory stores
    orderStore.clear();
    userStore.clear();
    jest.clearAllMocks();
  });

  afterAll(() => {
    server.close();
  });

  describe('Complete Order Lifecycle', () => {
    it('should allow user to submit, view, and cancel an order', async () => {
      // Step 1: Create authenticated user
      const { user, token } = createAuthenticatedUser();
      
      // Step 2: Submit an order
      const order = {
        sellToken: faker.finance.ethereumAddress(),
        buyToken: faker.finance.ethereumAddress(),
        sellAmount: '1000000000000000000', // 1 ETH
        buyAmount: '3000000000', // 3000 USDC
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: faker.string.hexadecimal({ length: 64, prefix: '0x' }),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: user.walletAddress,
        user: user.id,
        signingScheme: 'eip712',
        nonce: 1,
        wallet: user.walletAddress
      };

      const submitResponse = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${token}`)
        .send({
          order,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(submitResponse.status).toBe(200);
      expect(submitResponse.body.success).toBe(true);
      expect(submitResponse.body.orderId).toBeDefined();
      
      const orderId = submitResponse.body.orderId;

      // Step 3: Verify order appears in user's order list
      const ordersResponse = await request(server)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .query({ userId: user.id });

      expect(ordersResponse.status).toBe(200);
      expect(Array.isArray(ordersResponse.body)).toBe(true);
      expect(ordersResponse.body.length).toBe(1);
      expect(ordersResponse.body[0].id).toBe(orderId);
      expect(ordersResponse.body[0].status).toBe('PENDING');

      // Step 4: Cancel the order
      const cancelResponse = await request(server)
        .post('/api/cancelOrder')
        .set('Authorization', `Bearer ${token}`)
        .send({
          orderId,
          userId: user.id
        });

      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body.success).toBe(true);

      // Step 5: Verify order status is updated
      const updatedOrdersResponse = await request(server)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .query({ userId: user.id });

      expect(updatedOrdersResponse.status).toBe(200);
      expect(updatedOrdersResponse.body[0].status).toBe('CANCELLED');
    });

    it('should handle multiple orders from same user', async () => {
      const { user, token } = createAuthenticatedUser();
      
      // Submit 3 orders
      const orderPromises = Array(3).fill(null).map((_, index) => 
        request(server)
          .post('/api/submitOrder')
          .set('Authorization', `Bearer ${token}`)
          .send({
            order: {
              sellToken: faker.finance.ethereumAddress(),
              buyToken: faker.finance.ethereumAddress(),
              sellAmount: faker.number.bigInt({ min: 1000000000000000n, max: 10000000000000000n }).toString(),
              buyAmount: faker.number.bigInt({ min: 1000000000n, max: 10000000000n }).toString(),
              validTo: Math.floor(Date.now() / 1000) + 3600,
              appData: faker.string.hexadecimal({ length: 64, prefix: '0x' }),
              feeAmount: '0',
              kind: index % 2 === 0 ? 'sell' : 'buy',
              partiallyFillable: index === 1,
              receiver: user.walletAddress,
              user: user.id,
              signingScheme: 'eip712',
              nonce: index + 1,
              wallet: user.walletAddress
            },
            signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
          })
      );

      const submitResponses = await Promise.all(orderPromises);
      
      // All should succeed
      submitResponses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Get all user orders
      const ordersResponse = await request(server)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .query({ userId: user.id });

      expect(ordersResponse.status).toBe(200);
      expect(ordersResponse.body.length).toBe(3);
      
      // Verify order properties
      expect(ordersResponse.body.filter(o => o.kind === 'sell').length).toBe(2);
      expect(ordersResponse.body.filter(o => o.kind === 'buy').length).toBe(1);
      expect(ordersResponse.body.filter(o => o.partiallyFillable === true).length).toBe(1);
    });

    it('should prevent users from cancelling orders they do not own', async () => {
      // Create two users
      const { user: user1, token: token1 } = createAuthenticatedUser();
      const { user: user2, token: token2 } = createAuthenticatedUser();

      // User 1 submits an order
      const order = {
        sellToken: faker.finance.ethereumAddress(),
        buyToken: faker.finance.ethereumAddress(),
        sellAmount: '1000000000000000000',
        buyAmount: '3000000000',
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: faker.string.hexadecimal({ length: 64, prefix: '0x' }),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: user1.walletAddress,
        user: user1.id,
        signingScheme: 'eip712',
        nonce: 1,
        wallet: user1.walletAddress
      };

      const submitResponse = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          order,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      const orderId = submitResponse.body.orderId;

      // User 2 tries to cancel User 1's order
      const cancelResponse = await request(server)
        .post('/api/cancelOrder')
        .set('Authorization', `Bearer ${token2}`)
        .send({
          orderId,
          userId: user2.id
        });

      expect(cancelResponse.status).toBe(403);
      expect(cancelResponse.body.error).toContain('Not authorized');

      // Verify order is still active
      const orderCheck = await request(server)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token1}`)
        .query({ userId: user1.id });

      expect(orderCheck.body[0].status).toBe('PENDING');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle expired tokens gracefully throughout the flow', async () => {
      const user = {
        id: faker.string.uuid(),
        email: faker.internet.email(),
        walletAddress: faker.finance.ethereumAddress()
      };
      userStore.set(user.id, user);

      // Create expired token
      const expiredToken = jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: '-1h' }
      );

      // Try to submit order with expired token
      const submitResponse = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({
          order: {
            sellToken: faker.finance.ethereumAddress(),
            buyToken: faker.finance.ethereumAddress(),
            sellAmount: '1000000000000000000',
            buyAmount: '3000000000',
            validTo: Math.floor(Date.now() / 1000) + 3600,
            appData: faker.string.hexadecimal({ length: 64, prefix: '0x' }),
            feeAmount: '0',
            kind: 'sell',
            partiallyFillable: false,
            receiver: user.walletAddress,
            user: user.id,
            signingScheme: 'eip712',
            nonce: 1,
            wallet: user.walletAddress
          },
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(submitResponse.status).toBe(401);

      // Try to get orders with expired token
      const ordersResponse = await request(server)
        .get('/api/orders')
        .set('Authorization', `Bearer ${expiredToken}`)
        .query({ userId: user.id });

      expect(ordersResponse.status).toBe(401);
    });

    it('should handle insufficient balance during order submission', async () => {
      const { BalanceValidationService } = require('../../src/services/balanceValidation/BalanceValidationService');
      const mockBalanceService = new BalanceValidationService();
      
      const { user, token } = createAuthenticatedUser();
      
      // First order succeeds
      mockBalanceService.validateBalance.mockResolvedValueOnce(true);
      
      const firstOrder = {
        sellToken: faker.finance.ethereumAddress(),
        buyToken: faker.finance.ethereumAddress(),
        sellAmount: '900000000000000000', // 0.9 ETH
        buyAmount: '2700000000',
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: faker.string.hexadecimal({ length: 64, prefix: '0x' }),
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        receiver: user.walletAddress,
        user: user.id,
        signingScheme: 'eip712',
        nonce: 1,
        wallet: user.walletAddress
      };

      const firstResponse = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${token}`)
        .send({
          order: firstOrder,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(firstResponse.status).toBe(200);
      
      // Second order fails due to insufficient balance
      mockBalanceService.validateBalance.mockResolvedValueOnce(false);
      
      const secondOrder = {
        ...firstOrder,
        sellAmount: '500000000000000000', // 0.5 ETH (but total would exceed balance)
        nonce: 2
      };

      const secondResponse = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${token}`)
        .send({
          order: secondOrder,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(secondResponse.status).toBe(400);
      expect(secondResponse.body.error).toContain('Insufficient balance');
    });
  });
});