#!/usr/bin/env node

/**
 * Load test environment variables
 * This script loads the .env.test file and sets up the test environment
 */

const path = require('path');
const fs = require('fs');

// Load test environment variables
function loadTestEnv() {
  const envTestPath = path.join(__dirname, '..', '.env.test');
  
  if (!fs.existsSync(envTestPath)) {
    console.log('⚠️  .env.test file not found, using default test environment');
    // Set minimal test environment
    process.env.NODE_ENV = 'test';
    process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';
    return {};
  }

  // Read and parse .env.test file
  const envContent = fs.readFileSync(envTestPath, 'utf8');
  const envVars = {};
  let lineCount = 0;
  let loadedCount = 0;

  envContent.split('\n').forEach(line => {
    lineCount++;
    const trimmedLine = line.trim();
    
    // Skip comments and empty lines
    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      return;
    }

    // Parse KEY=VALUE format (allow mixed case and more flexible patterns)
    const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      // Only set if not already defined (allows override)
      if (!process.env[key]) {
        process.env[key] = value;
        envVars[key] = value;
        loadedCount++;
      }
    } else if (trimmedLine.includes('=')) {
      // Debug: log lines that contain = but don't match our pattern
      console.log(`⚠️  Could not parse line ${lineCount}: "${trimmedLine}"`);
    }
  });

  console.log(`✅ Loaded ${loadedCount} environment variables from .env.test`);
  
  // Set default values for critical variables if missing
  const defaults = {
    'NODE_ENV': 'test',
    'JWT_SECRET': 'test-secret-key-not-for-production',
    'DATABASE_URL': 'file:./test.db',
    'PRIVATE_KEY': '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    'CHAIN_ID': '31337'
  };

  Object.entries(defaults).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
      console.log(`🔧 Set default ${key}=${value}`);
    }
  });

  // Set NODE_ENV to test if not already set
  if (process.env.NODE_ENV !== 'test') {
    process.env.NODE_ENV = 'test';
    console.log('🔧 Set NODE_ENV=test');
  }

  console.log('🧪 Test environment ready!');
  
  return envVars;
}

// Export for use in other scripts
module.exports = { loadTestEnv };

// Run if called directly
if (require.main === module) {
  loadTestEnv();
}