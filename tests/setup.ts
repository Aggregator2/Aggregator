// Test setup file for comprehensive tests
import { jest } from '@jest/globals';

// Increase timeout for integration tests
jest.setTimeout(120000);

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.ETHEREUM_RPC_URL = 'http://localhost:8545';
process.env.PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.SETTLEMENT_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Global test utilities
global.testUtils = {
  async waitForEvent(emitter: any, eventName: string, timeout = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${eventName}`));
      }, timeout);

      emitter.once(eventName, (data: any) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  },

  generateRandomAddress(): string {
    const chars = '0123456789abcdef';
    let address = '0x';
    for (let i = 0; i < 40; i++) {
      address += chars[Math.floor(Math.random() * chars.length)];
    }
    return address;
  },

  async measureExecutionTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;
    return { result, duration };
  },
};

// Mock external services
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getBlockNumber: jest.fn().mockResolvedValue(1000),
      getFeeData: jest.fn().mockResolvedValue({
        gasPrice: BigInt(20000000000), // 20 gwei
      }),
      getBalance: jest.fn().mockResolvedValue(BigInt(10000000000000000000)), // 10 ETH
      getTransactionReceipt: jest.fn().mockResolvedValue({
        status: 1,
        gasUsed: BigInt(100000),
      }),
    })),
  };
});

// Mock IPFS
jest.mock('ipfs-http-client', () => ({
  create: jest.fn().mockReturnValue({
    add: jest.fn().mockResolvedValue({ path: 'QmMockHash' }),
    cat: jest.fn().mockResolvedValue(Buffer.from('mock data')),
    pin: {
      add: jest.fn().mockResolvedValue(true),
    },
  }),
}));

// Clean up after tests
afterAll(async () => {
  // Clean up any remaining timers
  jest.clearAllTimers();
  
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 100));
});