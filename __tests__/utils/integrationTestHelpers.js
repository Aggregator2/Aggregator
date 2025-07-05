/**
 * Integration test helpers for database and Redis cleanup
 */

const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const { registerConnection, registerSingleton } = require('./testCleanup');

// Test database configuration
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'file:./test.db';

/**
 * Create a test database client
 */
function createTestPrismaClient() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: TEST_DATABASE_URL,
      },
    },
    log: process.env.DEBUG_TESTS ? ['query', 'info', 'warn', 'error'] : [],
  });

  // Register for cleanup
  registerSingleton('testPrisma', prisma);
  registerConnection(prisma);

  return prisma;
}

/**
 * Create a test Redis client
 */
function createTestRedisClient(options = {}) {
  const redis = new Redis({
    host: process.env.TEST_REDIS_HOST || 'localhost',
    port: process.env.TEST_REDIS_PORT || 6379,
    db: process.env.TEST_REDIS_DB || 15, // Use DB 15 for tests
    password: process.env.TEST_REDIS_PASSWORD,
    lazyConnect: true,
    ...options,
  });

  // Register for cleanup
  registerConnection(redis);

  return redis;
}

/**
 * Clean up test database
 */
async function cleanupTestDatabase(prisma) {
  try {
    // Delete in correct order to avoid foreign key constraints
    await prisma.$transaction([
      // Clear notification-related tables
      prisma.notificationDelivery.deleteMany({}),
      prisma.notification.deleteMany({}),
      prisma.notificationPreference.deleteMany({}),
      
      // Clear order-related tables
      prisma.orderExecution.deleteMany({}),
      prisma.orderHistory.deleteMany({}),
      prisma.trade.deleteMany({}),
      prisma.order.deleteMany({}),
      
      // Clear settlement-related tables
      prisma.settlementProof.deleteMany({}),
      prisma.settlement.deleteMany({}),
      prisma.settlementEpoch.deleteMany({}),
      
      // Clear webhook-related tables
      prisma.webhookDelivery.deleteMany({}),
      prisma.webhook.deleteMany({}),
      
      // Clear user-related tables
      prisma.apiKey.deleteMany({}),
      prisma.session.deleteMany({}),
      prisma.user.deleteMany({}),
    ]);
  } catch (error) {
    console.error('Error cleaning up test database:', error);
    // If transaction fails, try deleting tables individually
    const tables = [
      'notificationDelivery',
      'notification',
      'notificationPreference',
      'orderExecution',
      'orderHistory',
      'trade',
      'order',
      'settlementProof',
      'settlement',
      'settlementEpoch',
      'webhookDelivery',
      'webhook',
      'apiKey',
      'session',
      'user',
    ];
    
    for (const table of tables) {
      try {
        await prisma[table].deleteMany({});
      } catch (tableError) {
        console.error(`Failed to clean table ${table}:`, tableError.message);
      }
    }
  }
}

/**
 * Clean up test Redis
 */
async function cleanupTestRedis(redis) {
  try {
    // Clear all keys in the test database
    await redis.flushdb();
  } catch (error) {
    console.error('Error cleaning up test Redis:', error);
  }
}

/**
 * Create test data helpers
 */
const testDataHelpers = {
  createTestUser: async (prisma, overrides = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        walletAddress: `0x${Math.random().toString(16).slice(2, 42).padEnd(40, '0')}`,
        role: 'USER',
        isActive: true,
        ...overrides,
      },
    });
    return user;
  },

  createTestOrder: async (prisma, userId, overrides = {}) => {
    const order = await prisma.order.create({
      data: {
        userId,
        sellToken: `0x${Math.random().toString(16).slice(2, 42).padEnd(40, '0')}`,
        buyToken: `0x${Math.random().toString(16).slice(2, 42).padEnd(40, '0')}`,
        sellAmount: '1000000000000000000',
        buyAmount: '2000000000',
        status: 'PENDING',
        validTo: Math.floor(Date.now() / 1000) + 3600,
        kind: 'sell',
        partiallyFillable: false,
        signature: `0x${Math.random().toString(16).slice(2, 132).padEnd(130, '0')}`,
        ...overrides,
      },
    });
    return order;
  },

  createTestApiKey: async (prisma, userId, overrides = {}) => {
    const apiKey = await prisma.apiKey.create({
      data: {
        userId,
        name: 'Test API Key',
        key: `test_${Math.random().toString(36).substring(2)}`,
        hashedKey: `hashed_${Math.random().toString(36).substring(2)}`,
        permissions: ['read:orders', 'write:orders'],
        ...overrides,
      },
    });
    return apiKey;
  },
};

/**
 * Setup test environment
 */
async function setupTestEnvironment() {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  
  // Create test clients
  const prisma = createTestPrismaClient();
  const redis = createTestRedisClient();
  
  // Connect to services
  await redis.connect();
  
  return { prisma, redis };
}

/**
 * Teardown test environment
 */
async function teardownTestEnvironment(prisma, redis) {
  // Clean up data
  await cleanupTestDatabase(prisma);
  await cleanupTestRedis(redis);
  
  // Disconnect
  await prisma.$disconnect();
  redis.disconnect();
}

module.exports = {
  createTestPrismaClient,
  createTestRedisClient,
  cleanupTestDatabase,
  cleanupTestRedis,
  testDataHelpers,
  setupTestEnvironment,
  teardownTestEnvironment,
  TEST_DATABASE_URL,
};