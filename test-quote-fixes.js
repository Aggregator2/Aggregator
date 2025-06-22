#!/usr/bin/env node

/**
 * Test the quote error handling fixes
 */

const fetch = require('node-fetch');
const { ethers } = require('ethers');

const BASE_URL = 'http://localhost:3000';

// Test scenarios
const testScenarios = [
  {
    name: 'Valid quote - WETH to DAI',
    params: {
      sellToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      buyToken: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      sellAmount: ethers.parseEther('1').toString(),
      chainId: 1,
    },
    shouldSucceed: true,
  },
  {
    name: 'Same token swap',
    params: {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      sellAmount: '1000000',
      chainId: 1,
    },
    shouldSucceed: false,
    expectedError: 'Cannot swap the same token',
  },
  {
    name: 'Zero amount',
    params: {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      sellAmount: '0',
      chainId: 1,
    },
    shouldSucceed: false,
    expectedError: 'Sell amount must be greater than zero',
  },
  {
    name: 'Invalid token address',
    params: {
      sellToken: '0xinvalid',
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      sellAmount: '1000000',
      chainId: 1,
    },
    shouldSucceed: false,
    expectedError: 'Invalid token addresses',
  },
  {
    name: 'Obscure token pair (should use fallback)',
    params: {
      sellToken: '0x1234567890123456789012345678901234567890',
      buyToken: '0x0987654321098765432109876543210987654321',
      sellAmount: '1000000000000000000',
      chainId: 1,
    },
    shouldSucceed: true,
    expectFallback: true,
  },
];

async function runTests() {
  console.log('🧪 Testing Quote Error Handling Fixes\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const scenario of testScenarios) {
    console.log(`\nTesting: ${scenario.name}`);
    
    try {
      const response = await fetch(`${BASE_URL}/api/quote-profitable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenario.params),
      });
      
      const data = await response.json();
      
      if (scenario.shouldSucceed) {
        if (response.ok) {
          console.log(`✅ Success: Got quote from ${data.source || 'unknown'}`);
          
          if (scenario.expectFallback && data.source === 'fallback') {
            console.log('   ✓ Using fallback quote as expected');
          } else if (data.buyAmount) {
            console.log(`   ✓ Buy amount: ${data.buyAmount}`);
          }
          
          passed++;
        } else {
          console.log(`❌ Failed: Expected success but got error: ${data.error}`);
          failed++;
        }
      } else {
        if (!response.ok && data.error === scenario.expectedError) {
          console.log(`✅ Correctly rejected: ${data.error}`);
          passed++;
        } else if (!response.ok) {
          console.log(`⚠️ Rejected with different error: ${data.error}`);
          console.log(`   Expected: ${scenario.expectedError}`);
          failed++;
        } else {
          console.log(`❌ Should have failed but succeeded`);
          failed++;
        }
      }
      
    } catch (error) {
      console.log(`💥 Network error: ${error.message}`);
      failed++;
    }
  }
  
  // Test polling behavior
  console.log('\n\n📊 Testing Polling Behavior (15 seconds)...\n');
  
  let pollCount = 0;
  let errorCount = 0;
  const startTime = Date.now();
  
  const pollInterval = setInterval(async () => {
    pollCount++;
    
    try {
      const response = await fetch(`${BASE_URL}/api/quote-profitable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellToken: '0x1234567890123456789012345678901234567890', // Invalid token
          buyToken: '0x0987654321098765432109876543210987654321',
          sellAmount: '1000000000000000000',
          chainId: 1,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log(`[Poll ${pollCount}] ✓ Got quote from ${data.source}`);
      } else {
        errorCount++;
        console.log(`[Poll ${pollCount}] ✗ Error: ${data.error}`);
      }
      
    } catch (error) {
      errorCount++;
      console.log(`[Poll ${pollCount}] 💥 Network error`);
    }
    
    if (Date.now() - startTime > 15000) {
      clearInterval(pollInterval);
      
      console.log(`\nPolling Summary:`);
      console.log(`  Total polls: ${pollCount}`);
      console.log(`  Errors: ${errorCount}`);
      console.log(`  Success rate: ${((pollCount - errorCount) / pollCount * 100).toFixed(1)}%`);
      
      if (errorCount >= 3) {
        console.log(`  ⚠️ UI should have stopped auto-refresh after 3 consecutive errors`);
      }
      
      // Final summary
      console.log('\n' + '='.repeat(60));
      console.log(`FINAL RESULTS: ${passed} passed, ${failed} failed`);
      
      if (failed === 0) {
        console.log('✅ All error handling tests passed!');
      } else {
        console.log('❌ Some tests failed');
      }
    }
  }, 3000);
}

// Run tests
runTests().catch(console.error);