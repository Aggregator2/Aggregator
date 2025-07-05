const request = require('supertest');
const { faker } = require('@faker-js/faker');
const jwt = require('jsonwebtoken');
const { registerMock, registerConnection } = require('../utils/testCleanup');

// Mock Next.js modules
jest.mock('next/config', () => () => ({
  serverRuntimeConfig: {},
  publicRuntimeConfig: {}
}));

// Mock the database/prisma client
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    order: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $disconnect: jest.fn(),
  })),
}));

// Mock the balance validation service
jest.mock('../../src/services/balanceValidation/BalanceValidationService', () => ({
  BalanceValidationService: jest.fn().mockImplementation(() => ({
    validateBalance: jest.fn().mockResolvedValue(true),
    getBalance: jest.fn().mockResolvedValue({ balance: '1000000000000000000' }), // 1 ETH
  })),
}));

// Import after mocks
const submitOrderHandler = require('../../pages/api/submitOrder');
const { createServer } = require('http');
const { apiResolver } = require('next/dist/server/api-utils/node');

describe('/api/submitOrder', () => {
  let server;
  let mockPrisma;
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-only';

  // Helper function to create a valid JWT
  const createValidToken = (userId = faker.string.uuid()) => {
    return jwt.sign(
      { 
        userId, 
        email: faker.internet.email(),
        role: 'USER' 
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  };

  // Helper function to create test server
  const createTestServer = (handler) => {
    return createServer((req, res) => {
      return apiResolver(
        req,
        res,
        undefined,
        handler,
        {
          previewModeId: '',
          previewModeEncryptionKey: '',
          previewModeSigningKey: '',
        },
        false
      );
    });
  };

  beforeAll(() => {
    // Set up environment variables
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.BACKEND_PRIVATE_KEY = '0x' + faker.string.hexadecimal({ length: 64, prefix: false });
    
    // Create test server
    server = createTestServer(submitOrderHandler);
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Get fresh prisma mock
    const { PrismaClient } = require('@prisma/client');
    mockPrisma = new PrismaClient();
    registerMock(mockPrisma);
  });
  
  afterEach(() => {
    // Additional cleanup specific to this test
    // The global cleanup in setup.js will handle the rest
  });

  afterAll((done) => {
    server.close(() => {
      done();
    });
  });

  describe('Authentication Tests', () => {
    it('should return 401 when no authorization header is provided', async () => {
      const response = await request(server)
        .post('/api/submitOrder')
        .send({
          order: generateValidOrder(),
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Unauthorized');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', 'Bearer invalid-token-here')
        .send({
          order: generateValidOrder(),
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 401 when expired token is provided', async () => {
      const expiredToken = jwt.sign(
        { userId: faker.string.uuid() },
        JWT_SECRET,
        { expiresIn: '-1h' } // Already expired
      );

      const response = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({
          order: generateValidOrder(),
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(response.status).toBe(401);
    });
  });

  describe('Validation Tests', () => {
    it('should return 400 when order is missing', async () => {
      const response = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${createValidToken()}`)
        .send({
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing order or signature');
    });

    it('should return 400 when signature is missing', async () => {
      const response = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${createValidToken()}`)
        .send({
          order: generateValidOrder()
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing order or signature');
    });

    it('should return 422 when order has invalid structure', async () => {
      const invalidOrder = {
        // Missing required fields
        sellAmount: '1000',
        // Invalid types
        validTo: 'not-a-number',
      };

      const response = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${createValidToken()}`)
        .send({
          order: invalidOrder,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 422 when amounts are negative', async () => {
      const orderWithNegativeAmount = generateValidOrder({
        sellAmount: '-1000000000000000000'
      });

      const response = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${createValidToken()}`)
        .send({
          order: orderWithNegativeAmount,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(response.status).toBe(422);
    });
  });

  describe('Successful Order Submission', () => {
    it('should successfully submit order with valid data and authentication', async () => {
      const userId = faker.string.uuid();
      const token = createValidToken(userId);
      const order = generateValidOrder({ user: userId });
      
      // Mock successful user lookup
      mockPrisma.user.findUnique.mockResolvedValue({
        id: userId,
        email: faker.internet.email(),
        walletAddress: order.wallet
      });

      // Mock successful order creation
      const mockCreatedOrder = {
        id: faker.string.uuid(),
        ...order,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      mockPrisma.order.create.mockResolvedValue(mockCreatedOrder);

      const response = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${token}`)
        .send({
          order,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('orderId');
      
      // Verify database interactions
      expect(mockPrisma.order.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          status: 'PENDING'
        })
      });
    });

    it('should validate balance before submitting order', async () => {
      const { BalanceValidationService } = require('../../src/services/balanceValidation/BalanceValidationService');
      const mockBalanceService = new BalanceValidationService();
      
      const userId = faker.string.uuid();
      const token = createValidToken(userId);
      const order = generateValidOrder({ user: userId });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: userId,
        walletAddress: order.wallet
      });
      mockPrisma.order.create.mockResolvedValue({ id: faker.string.uuid() });

      await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${token}`)
        .send({
          order,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(mockBalanceService.validateBalance).toHaveBeenCalled();
    });

    it('should return 400 when balance is insufficient', async () => {
      const { BalanceValidationService } = require('../../src/services/balanceValidation/BalanceValidationService');
      const mockBalanceService = new BalanceValidationService();
      
      // Mock insufficient balance
      mockBalanceService.validateBalance.mockResolvedValue(false);
      
      const userId = faker.string.uuid();
      const token = createValidToken(userId);
      const order = generateValidOrder({ user: userId });

      const response = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${token}`)
        .send({
          order,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Insufficient balance');
    });
  });

  describe('Edge Cases', () => {
    it('should handle database errors gracefully', async () => {
      const userId = faker.string.uuid();
      const token = createValidToken(userId);
      const order = generateValidOrder({ user: userId });

      // Mock database error
      mockPrisma.order.create.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(server)
        .post('/api/submitOrder')
        .set('Authorization', `Bearer ${token}`)
        .send({
          order,
          signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle concurrent order submissions', async () => {
      const userId = faker.string.uuid();
      const token = createValidToken(userId);
      
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
      mockPrisma.order.create.mockResolvedValue({ id: faker.string.uuid() });

      // Submit multiple orders concurrently
      const promises = Array(5).fill(null).map(() => 
        request(server)
          .post('/api/submitOrder')
          .set('Authorization', `Bearer ${token}`)
          .send({
            order: generateValidOrder({ user: userId }),
            signature: faker.string.hexadecimal({ length: 132, prefix: '0x' })
          })
      );

      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      expect(mockPrisma.order.create).toHaveBeenCalledTimes(5);
    });
  });

  // Helper function to generate valid order
  function generateValidOrder(overrides = {}) {
    const sellToken = faker.finance.ethereumAddress();
    const buyToken = faker.finance.ethereumAddress();
    
    return {
      sellToken,
      buyToken,
      sellAmount: faker.number.bigInt({ min: 1000000000000000n, max: 1000000000000000000n }).toString(),
      buyAmount: faker.number.bigInt({ min: 1000000000000000n, max: 1000000000000000000n }).toString(),
      validTo: Math.floor(Date.now() / 1000) + 3600, // Valid for 1 hour
      appData: faker.string.hexadecimal({ length: 64, prefix: '0x' }),
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      receiver: faker.finance.ethereumAddress(),
      user: faker.string.uuid(),
      signingScheme: 'eip712',
      nonce: faker.number.int({ min: 1, max: 1000000 }),
      wallet: faker.finance.ethereumAddress(),
      ...overrides
    };
  }
});