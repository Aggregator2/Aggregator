// Jest setup for integration tests (Node.js environment)

// Polyfill for missing Node.js globals that tests might expect
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.crypto = require('crypto');

// Mock console methods for cleaner test output
global.console = {
  ...console,
  // Uncomment to silence console output during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Set up test timeouts
jest.setTimeout(30000);

// Mock external services for integration tests
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    isOpen: false,
  })),
}));

// Mock WebSocket for tests that don't need real WebSocket connections
jest.mock('ws', () => ({
  WebSocketServer: jest.fn(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
  WebSocket: jest.fn(() => ({
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    readyState: 1, // OPEN
  })),
}));

// Mock ethers provider for blockchain tests
jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn(() => ({
      getNetwork: jest.fn(),
      getBlockNumber: jest.fn(),
      getBalance: jest.fn(),
    })),
    Wallet: jest.fn(() => ({
      address: '0x1234567890123456789012345678901234567890',
      signMessage: jest.fn(),
    })),
    Contract: jest.fn(() => ({
      deployed: jest.fn(),
      functions: {},
    })),
    formatEther: jest.fn(),
    parseEther: jest.fn(),
  }
}));