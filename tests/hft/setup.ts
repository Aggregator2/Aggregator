/**
 * Test setup for HFT features
 */

import { TextEncoder, TextDecoder } from 'util';

// Polyfills for Node environment
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

// Performance monitoring setup
if (typeof global.gc === 'function') {
  // Force garbage collection before tests to get clean memory readings
  beforeEach(() => {
    global.gc();
  });
}

// Mock timers for controlled testing
beforeEach(() => {
  jest.useRealTimers(); // Use real timers for performance tests
});

// Cleanup after tests
afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// Global test timeout for long-running performance tests
jest.setTimeout(60000); // 60 seconds

// Suppress console logs during tests unless debugging
if (process.env.DEBUG_TESTS !== 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    // Keep error for debugging failures
    error: console.error,
  };
}

// Custom matchers for performance assertions
expect.extend({
  toBeWithinLatency(received: number, expected: number, tolerance: number = 0.1) {
    const pass = received <= expected * (1 + tolerance);
    return {
      pass,
      message: () =>
        pass
          ? `Expected latency ${received}ms to be greater than ${expected * (1 + tolerance)}ms`
          : `Expected latency ${received}ms to be within ${expected * (1 + tolerance)}ms`,
    };
  },
  
  toHaveThroughputAbove(received: number, minThroughput: number) {
    const pass = received >= minThroughput;
    return {
      pass,
      message: () =>
        pass
          ? `Expected throughput ${received} TPS to be less than ${minThroughput} TPS`
          : `Expected throughput ${received} TPS to be at least ${minThroughput} TPS`,
    };
  }
});

// Declare custom matchers for TypeScript
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinLatency(expected: number, tolerance?: number): R;
      toHaveThroughputAbove(minThroughput: number): R;
    }
  }
}