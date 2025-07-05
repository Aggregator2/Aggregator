// Jest setup file for WebSocket and Redis tests

// Increase timeout for integration tests
jest.setTimeout(60000);

// Mock console errors in test environment
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: any[]) => {
    // Ignore specific WebSocket/Redis connection errors during tests
    const errorString = args.join(' ');
    if (
      errorString.includes('WebSocket') ||
      errorString.includes('Redis') ||
      errorString.includes('ECONNREFUSED') ||
      errorString.includes('timeout')
    ) {
      return;
    }
    originalError.apply(console, args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Global test utilities
global.testUtils = {
  // Wait for condition with timeout
  waitFor: async (condition: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timeout waiting for condition');
  },

  // Generate test data
  generateTestOrder: (overrides = {}) => ({
    id: `test-order-${Date.now()}-${Math.random()}`,
    userId: 'test-user',
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
    ...overrides
  }),

  generateTestTrade: (overrides = {}) => ({
    id: `test-trade-${Date.now()}-${Math.random()}`,
    pair: 'ETH/USDC',
    takerOrderId: 'taker-order',
    makerOrderId: 'maker-order',
    price: 2000,
    quantity: 0.5,
    takerSide: 'BUY',
    timestamp: Date.now(),
    takerFee: 0.001,
    makerFee: 0.0005,
    ...overrides
  })
};

// Cleanup function for Redis
global.cleanupRedis = async (redis: any, keyPrefix: string) => {
  const keys = await redis.keys(`${keyPrefix}*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
};

// Mock timers for controlled testing
global.advanceTimersByTime = (ms: number) => {
  const now = Date.now();
  Date.now = jest.fn(() => now + ms);
};

// Environment setup
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Declare global types
declare global {
  namespace NodeJS {
    interface Global {
      testUtils: {
        waitFor: (condition: () => boolean | Promise<boolean>, timeout?: number) => Promise<void>;
        generateTestOrder: (overrides?: any) => any;
        generateTestTrade: (overrides?: any) => any;
      };
      cleanupRedis: (redis: any, keyPrefix: string) => Promise<void>;
      advanceTimersByTime: (ms: number) => void;
    }
  }
}