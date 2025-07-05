// Custom test environment to fix jsdom/tough-cookie issues
const { TestEnvironment } = require('jest-environment-jsdom');

class CustomJSDOMEnvironment extends TestEnvironment {
  constructor(...args) {
    super(...args);
    
    // Fix for tough-cookie module resolution
    this.global.TextEncoder = TextEncoder;
    this.global.TextDecoder = TextDecoder;
    
    // Polyfill for missing crypto in jsdom
    if (typeof this.global.crypto === 'undefined') {
      const crypto = require('crypto');
      this.global.crypto = {
        getRandomValues: (arr) => crypto.randomBytes(arr.length),
        randomUUID: () => crypto.randomUUID(),
      };
    }
  }
  
  async setup() {
    await super.setup();
  }
  
  async teardown() {
    await super.teardown();
  }
}

module.exports = CustomJSDOMEnvironment;