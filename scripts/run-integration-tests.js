#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

/**
 * Run integration tests with proper setup
 */
async function runIntegrationTests() {
  console.log('🚀 Starting integration test runner...\n');

  // Start Hardhat node if not already running
  const isHardhatRunning = await checkHardhatNode();
  let hardhatProcess = null;

  if (!isHardhatRunning) {
    console.log('📦 Starting Hardhat node...');
    hardhatProcess = await startHardhatNode();
    console.log('✅ Hardhat node started\n');
  } else {
    console.log('✅ Hardhat node already running\n');
  }

  try {
    // Run the tests
    console.log('🧪 Running integration tests...\n');
    await runTests();
    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Tests failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    if (hardhatProcess) {
      console.log('\n🧹 Stopping Hardhat node...');
      hardhatProcess.kill();
    }
  }
}

/**
 * Check if Hardhat node is running
 */
async function checkHardhatNode() {
  try {
    const response = await fetch('http://localhost:8545', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1
      })
    });
    
    const data = await response.json();
    return data.result === '0x7a69'; // Hardhat chainId
  } catch (error) {
    return false;
  }
}

/**
 * Start Hardhat node
 */
function startHardhatNode() {
  return new Promise((resolve, reject) => {
    const hardhat = spawn('npx', ['hardhat', 'node'], {
      stdio: 'pipe',
      shell: true,
      detached: false
    });

    let started = false;

    hardhat.stdout.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(output);
      
      if (output.includes('Started HTTP') && !started) {
        started = true;
        setTimeout(() => resolve(hardhat), 2000);
      }
    });

    hardhat.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    hardhat.on('error', reject);

    // Timeout
    setTimeout(() => {
      if (!started) {
        hardhat.kill();
        reject(new Error('Hardhat node failed to start'));
      }
    }, 30000);
  });
}

/**
 * Run the actual tests
 */
function runTests() {
  return new Promise((resolve, reject) => {
    const testFile = process.argv[2] || 'tests/integration/end-to-end-trading-fixed.test.ts';
    
    const jest = spawn('npx', [
      'jest',
      testFile,
      '--config', 'jest.config.integration.js',
      '--verbose',
      '--runInBand',
      '--forceExit'
    ], {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        FORCE_COLOR: '1'
      }
    });

    jest.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Tests exited with code ${code}`));
      }
    });

    jest.on('error', reject);
  });
}

// Run the script
runIntegrationTests().catch(console.error);