/**
 * Integration test setup
 */

const { 
  setupTestEnvironment, 
  teardownTestEnvironment,
  cleanupTestDatabase,
  cleanupTestRedis 
} = require('./utils/integrationTestHelpers');

// Store test environment resources
let testEnv = {};

// Setup before all tests
beforeAll(async () => {
  // Setup test environment
  testEnv = await setupTestEnvironment();
  
  // Initial cleanup to ensure clean state
  await cleanupTestDatabase(testEnv.prisma);
  await cleanupTestRedis(testEnv.redis);
});

// Cleanup after each test
afterEach(async () => {
  // Clean up test data after each test
  if (testEnv.prisma) {
    await cleanupTestDatabase(testEnv.prisma);
  }
  
  if (testEnv.redis) {
    await cleanupTestRedis(testEnv.redis);
  }
  
  // Clear all mocks
  jest.clearAllMocks();
});

// Teardown after all tests
afterAll(async () => {
  // Final cleanup and disconnect
  if (testEnv.prisma && testEnv.redis) {
    await teardownTestEnvironment(testEnv.prisma, testEnv.redis);
  }
  
  // Clear test environment
  testEnv = {};
});

// Make test environment available globally
global.testEnv = testEnv;