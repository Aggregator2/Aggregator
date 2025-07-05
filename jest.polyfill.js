// Polyfills for Jest environment to handle Node.js specific APIs

// Add setImmediate polyfill for Winston logger
if (typeof global.setImmediate === 'undefined') {
  global.setImmediate = (callback, ...args) => {
    return setTimeout(callback, 0, ...args);
  };
}

if (typeof global.clearImmediate === 'undefined') {
  global.clearImmediate = (immediateId) => {
    clearTimeout(immediateId);
  };
}

// Add process.nextTick polyfill if needed
if (typeof global.process === 'undefined') {
  global.process = require('process');
}

// Ensure Buffer is available globally
if (typeof global.Buffer === 'undefined') {
  global.Buffer = require('buffer').Buffer;
}

// Mock crypto if needed for tests
if (typeof global.crypto === 'undefined') {
  const { webcrypto } = require('crypto');
  global.crypto = webcrypto;
}