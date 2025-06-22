#!/usr/bin/env node

const https = require('https');
const http = require('http');

// Test configuration
const API_URL = 'http://localhost:3000/api/quote-profitable';
const TEST_DELAY = 2000; // 2 seconds between tests

// Test cases covering various scenarios
const testCases = [
  // Ethereum mainnet tests
  {
    name: 'ETH to USDC (Mainnet)',
    data: {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellAmount: '1000000000000000000', // 1 WETH
      chainId: 1
    },
    expectedBuyAmount: '3000000000' // ~$3500 in USDC (6 decimals)
  },
  {
    name: 'USDC to USDT (Stablecoin pair)',
    data: {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      sellAmount: '1000000000', // 1000 USDC
      chainId: 1
    },
    expectedBuyAmount: '990000000' // ~$1000 with small spread
  },
  {
    name: 'Small amount WETH to DAI',
    data: {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      buyToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      sellAmount: '100000000000000000', // 0.1 WETH
      chainId: 1
    },
    expectedBuyAmount: '300000000000000000000' // ~$350 in DAI
  },
  
  // Arbitrum tests
  {
    name: 'WETH to USDT (Arbitrum)',
    data: {
      sellToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
      buyToken: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
      sellAmount: '1000000000000000000', // 1 WETH
      chainId: 42161
    },
    expectedBuyAmount: '3000000000' // ~$3500 in USDT
  },
  
  // BSC tests
  {
    name: 'BNB to USDT (BSC)',
    data: {
      sellToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
      buyToken: '0x55d398326f99059fF775485246999027B3197955', // USDT
      sellAmount: '1000000000000000000', // 1 BNB
      chainId: 56
    },
    expectedBuyAmount: '500000000000000000000' // ~$600 in USDT
  },
  
  // Polygon tests
  {
    name: 'MATIC to USDC (Polygon)',
    data: {
      sellToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
      buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
      sellAmount: '1000000000000000000000', // 1000 MATIC
      chainId: 137
    },
    expectedBuyAmount: '1000000000' // ~$1200 in USDC
  },
  
  // Edge cases
  {
    name: 'Very small amount',
    data: {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellAmount: '1000000000000', // 0.000001 WETH
      chainId: 1
    },
    expectedBuyAmount: '3000' // ~$0.0035 in USDC
  },
  {
    name: 'Large amount',
    data: {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      sellAmount: '1000000000000', // 1M USDC
      chainId: 1
    },
    expectedBuyAmount: '990000000000' // ~$1M USDT
  }
];

// Helper function to make API request
function makeRequest(testCase) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(testCase.data);
    
    const options = {
      hostname: 'localhost',
      port: 3004,
      path: '/api/quote-profitable',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    
    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          resolve({ testCase, response, statusCode: res.statusCode });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${responseData}`));
        }
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.write(data);
    req.end();
  });
}

// Validate response
function validateResponse(result) {
  const { testCase, response, statusCode } = result;
  const errors = [];
  
  if (statusCode !== 200) {
    errors.push(`HTTP ${statusCode}: ${response.error || 'Unknown error'}`);
    return { success: false, errors };
  }
  
  // Check required fields
  const requiredFields = ['sellToken', 'buyToken', 'sellAmount', 'buyAmount', 'price', 'source'];
  for (const field of requiredFields) {
    if (!response[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Validate buyAmount is reasonable
  if (response.buyAmount) {
    const buyAmount = BigInt(response.buyAmount);
    const expectedAmount = BigInt(testCase.expectedBuyAmount);
    
    // Allow 20% deviation from expected
    const minAmount = (expectedAmount * 80n) / 100n;
    const maxAmount = (expectedAmount * 120n) / 100n;
    
    if (buyAmount < minAmount || buyAmount > maxAmount) {
      errors.push(`Buy amount ${buyAmount} outside expected range [${minAmount}, ${maxAmount}]`);
    }
  }
  
  // Check price is positive
  if (response.price && response.price <= 0) {
    errors.push(`Invalid price: ${response.price}`);
  }
  
  // Check source is defined
  if (!response.source || response.source === '') {
    errors.push('Source not defined');
  }
  
  return {
    success: errors.length === 0,
    errors
  };
}

// Main test runner
async function runTests() {
  console.log('🧪 Starting Quote System Tests\n');
  console.log('Waiting for server to be ready...\n');
  
  // Wait for server
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const results = {
    total: testCases.length,
    passed: 0,
    failed: 0,
    details: []
  };
  
  for (const testCase of testCases) {
    process.stdout.write(`Testing: ${testCase.name}... `);
    
    try {
      const result = await makeRequest(testCase);
      const validation = validateResponse(result);
      
      if (validation.success) {
        console.log('✅ PASSED');
        results.passed++;
        results.details.push({
          name: testCase.name,
          status: 'passed',
          response: {
            buyAmount: result.response.buyAmount,
            price: result.response.price,
            source: result.response.source
          }
        });
      } else {
        console.log('❌ FAILED');
        console.log(`  Errors: ${validation.errors.join(', ')}`);
        results.failed++;
        results.details.push({
          name: testCase.name,
          status: 'failed',
          errors: validation.errors,
          response: result.response
        });
      }
    } catch (error) {
      console.log('❌ ERROR');
      console.log(`  ${error.message}`);
      results.failed++;
      results.details.push({
        name: testCase.name,
        status: 'error',
        error: error.message
      });
    }
    
    // Delay between tests
    await new Promise(resolve => setTimeout(resolve, TEST_DELAY));
  }
  
  // Print summary
  console.log('\n📊 Test Summary:');
  console.log(`Total: ${results.total}`);
  console.log(`Passed: ${results.passed} (${(results.passed/results.total*100).toFixed(1)}%)`);
  console.log(`Failed: ${results.failed} (${(results.failed/results.total*100).toFixed(1)}%)`);
  
  // Print detailed results for failed tests
  if (results.failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.details
      .filter(d => d.status !== 'passed')
      .forEach(d => {
        console.log(`\n- ${d.name}`);
        if (d.errors) {
          d.errors.forEach(e => console.log(`  • ${e}`));
        } else if (d.error) {
          console.log(`  • ${d.error}`);
        }
      });
  }
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(console.error);