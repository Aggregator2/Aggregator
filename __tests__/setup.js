// Test setup file for Jest

// Add TextEncoder/TextDecoder polyfills for Node environment
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Import cleanup utilities
const { setupTests, cleanupTests } = require('./utils/testCleanup');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-only';
process.env.DATABASE_URL = 'file:./test.db';
process.env.BACKEND_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to suppress console logs during tests
  // log: jest.fn(),
  // error: jest.fn(),
  // warn: jest.fn(),
  // info: jest.fn(),
  debug: jest.fn(),
};

// Global test utilities
global.testUtils = {
  // Helper to wait for async operations
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Helper to create mock Next.js API request
  createMockReq: (options = {}) => ({
    method: options.method || 'GET',
    headers: options.headers || {},
    query: options.query || {},
    body: options.body || {},
    cookies: options.cookies || {},
    ...options
  }),
  
  // Helper to create mock Next.js API response
  createMockRes: () => {
    const res = {
      _status: 200,
      _json: null,
      _headers: {},
    };
    
    res.status = jest.fn((code) => {
      res._status = code;
      return res;
    });
    
    res.json = jest.fn((data) => {
      res._json = data;
      return res;
    });
    
    res.setHeader = jest.fn((key, value) => {
      res._headers[key] = value;
      return res;
    });
    
    res.send = jest.fn(() => res);
    res.end = jest.fn(() => res);
    
    return res;
  }
};

// Global setup and cleanup hooks
beforeEach(() => {
  setupTests();
});

afterEach(async () => {
  await cleanupTests();
});

// Clean up after tests
afterAll(async () => {
  // Final cleanup
  await cleanupTests({
    database: true,
    redis: true,
    modules: true, // Reset all modules
  });
  
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 500));
});