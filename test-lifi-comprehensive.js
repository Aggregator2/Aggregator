const axios = require('axios');

const PORT = 3009;
const API_URL = `http://localhost:${PORT}/api/quote-profitable`;

// Test cases with various token pairs
const testCases = [
  {
    name: 'ETH to USDC (Ethereum)',
    data: {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellAmount: '1000000000000000000', // 1 WETH
      chainId: 1
    }
  },
  {
    name: 'USDC to USDT (Stablecoin)',
    data: {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      sellAmount: '1000000000', // 1000 USDC
      chainId: 1
    }
  },
  {
    name: 'WETH to DAI (Ethereum)',
    data: {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      buyToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      sellAmount: '500000000000000000', // 0.5 WETH
      chainId: 1
    }
  },
  {
    name: 'LINK to WETH',
    data: {
      sellToken: '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      sellAmount: '100000000000000000000', // 100 LINK
      chainId: 1
    }
  },
  {
    name: 'UNI to USDC',
    data: {
      sellToken: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellAmount: '50000000000000000000', // 50 UNI
      chainId: 1
    }
  }
];

// Test token list endpoint
async function testTokenList() {
  console.log('\n📋 Testing Token List API...\n');
  
  try {
    const response = await axios.get(`http://localhost:${PORT}/api/tokens/comprehensive-v2`, {
      params: {
        chains: '1,56,137,42161'
      }
    });
    
    const { tokens, stats } = response.data;
    console.log(`✅ Token List Success:`);
    console.log(`   Total tokens: ${stats.total}`);
    console.log(`   Sources: ${Object.keys(stats.bySource).join(', ')}`);
    console.log(`   By source:`, stats.bySource);
    console.log(`   By chain:`, stats.byChain);
    
    // Check if LiFi is primary source
    if (stats.bySource.LiFi) {
      console.log(`   ✅ LiFi is active with ${stats.bySource.LiFi} tokens`);
    } else {
      console.log(`   ❌ LiFi is not active!`);
    }
    
    return tokens.length;
  } catch (error) {
    console.log(`❌ Token List Failed: ${error.message}`);
    return 0;
  }
}

// Test quote functionality
async function testQuote(testCase) {
  console.log(`\n🔄 Testing: ${testCase.name}`);
  
  try {
    const startTime = Date.now();
    const response = await axios.post(API_URL, testCase.data, {
      timeout: 60000 // 60 second timeout
    });
    const duration = Date.now() - startTime;
    
    const { buyAmount, source, price, minReceived } = response.data;
    
    console.log(`✅ Success in ${duration}ms:`);
    console.log(`   Source: ${source}`);
    console.log(`   Buy Amount: ${buyAmount}`);
    console.log(`   Price: ${price}`);
    console.log(`   Min Received: ${minReceived}`);
    
    // Check if LiFi was used
    if (source === 'LiFi') {
      console.log(`   ✅ Using LiFi as primary source!`);
    } else if (source === 'fallback') {
      console.log(`   ⚠️  Using fallback - LiFi may not have route`);
    }
    
    return { success: true, source, duration };
  } catch (error) {
    console.log(`❌ Failed: ${error.response?.data?.error || error.message}`);
    return { success: false, error: error.message };
  }
}

// Check LiFi integration
async function checkLiFiIntegration() {
  console.log('\n🔍 Checking LiFi Integration...\n');
  
  // Check if LiFi API key is set
  const hasApiKey = process.env.LIFI_API_KEY ? 'Yes' : 'No';
  console.log(`LiFi API Key configured: ${hasApiKey}`);
  
  // Test LiFi SDK directly
  try {
    const { getChains } = require('@lifi/sdk');
    const chains = await getChains();
    console.log(`✅ LiFi SDK working - ${chains.length} chains available`);
  } catch (error) {
    console.log(`❌ LiFi SDK error: ${error.message}`);
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Comprehensive LiFi Integration Tests\n');
  console.log(`Server: http://localhost:${PORT}`);
  console.log('Waiting for server to be ready...\n');
  
  // Wait for server
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Check LiFi integration
  await checkLiFiIntegration();
  
  // Test token list
  const tokenCount = await testTokenList();
  
  if (tokenCount < 500) {
    console.log(`\n⚠️  WARNING: Only ${tokenCount} tokens loaded. Expected 500+`);
  }
  
  // Test quotes
  console.log('\n📊 Testing Quotes...');
  
  const results = {
    total: testCases.length,
    lifi: 0,
    fallback: 0,
    failed: 0
  };
  
  for (const testCase of testCases) {
    const result = await testQuote(testCase);
    
    if (result.success) {
      if (result.source === 'LiFi') results.lifi++;
      else if (result.source === 'fallback') results.fallback++;
    } else {
      results.failed++;
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log('\n📈 Test Summary:');
  console.log(`Total tests: ${results.total}`);
  console.log(`LiFi quotes: ${results.lifi} (${(results.lifi/results.total*100).toFixed(1)}%)`);
  console.log(`Fallback quotes: ${results.fallback} (${(results.fallback/results.total*100).toFixed(1)}%)`);
  console.log(`Failed: ${results.failed}`);
  
  if (results.lifi === results.total) {
    console.log('\n✅ SUCCESS: LiFi is working 100% for all token pairs!');
  } else if (results.lifi > 0) {
    console.log('\n⚠️  PARTIAL SUCCESS: LiFi is working but not for all pairs');
  } else {
    console.log('\n❌ FAILURE: LiFi is not working properly');
  }
}

// Run tests
runTests().catch(console.error);