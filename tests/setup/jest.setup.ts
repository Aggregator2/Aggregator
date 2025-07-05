import { TextEncoder, TextDecoder } from 'util';

// Polyfill for TextEncoder/TextDecoder in Node.js environment
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

// Set test timeout
jest.setTimeout(30000); // 30 seconds

// Mock console methods to reduce noise in tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.error = (...args: any[]) => {
  // Filter out expected errors
  const errorString = args.join(' ');
  if (
    errorString.includes('MatchingEngine error in test:') ||
    errorString.includes('SettlementEngine error in test:') ||
    errorString.includes('Error during test cleanup:') ||
    errorString.includes('No existing Hardhat node found')
  ) {
    return; // Suppress these expected errors
  }
  originalConsoleError(...args);
};

console.warn = (...args: any[]) => {
  // Filter out expected warnings
  const warnString = args.join(' ');
  if (
    warnString.includes('Invalid private key provided') ||
    warnString.includes('No PRIVATE_KEY found in .env')
  ) {
    return; // Suppress these expected warnings
  }
  originalConsoleWarn(...args);
};

// Cleanup function to restore console
afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});