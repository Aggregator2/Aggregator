// Test cross-chain functionality with proper token mapping
const fetch = require('node-fetch');

// Test cases for cross-chain swaps
const testCases = [
  {
    name: 'ETH to USDC on BSC',
    params: {
      sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH on Ethereum
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC address (will be mapped to BSC)
      sellAmount: '1000000000000000000', // 1 ETH
      chainId: 1, // Ethereum
      toChainId: 56, // BSC
      slippagePercentage: 1
    }
  },
  {
    name: 'USDC on Ethereum to USDT on Polygon',
    params: {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
      buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT (will be mapped to Polygon)
      sellAmount: '1000000', // 1 USDC (6 decimals)
      chainId: 1, // Ethereum
      toChainId: 137, // Polygon
      slippagePercentage: 1
    }
  },
  {
    name: 'BNB to MATIC',
    params: {
      sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // BNB native
      buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // MATIC native
      sellAmount: '1000000000000000000', // 1 BNB
      chainId: 56, // BSC
      toChainId: 137, // Polygon
      slippagePercentage: 1
    }
  },
  {
    name: 'Same chain swap - ETH to USDC on Ethereum',
    params: {
      sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellAmount: '1000000000000000000', // 1 ETH
      chainId: 1, // Ethereum
      toChainId: 1, // Same chain
      slippagePercentage: 1
    }
  }
];

async function testQuote(testCase) {
  console.log(`\n🧪 Testing: ${testCase.name}`);
  console.log('Request params:', JSON.stringify(testCase.params, null, 2));
  
  try {
    const response = await fetch('http://localhost:3001/api/quote-profitable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testCase.params)
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Success!');
      console.log('Quote details:');
      console.log(`  Buy Amount: ${data.buyAmount}`);
      console.log(`  Min Received: ${data.minReceived}`);
      console.log(`  Price: ${data.price}`);
      console.log(`  Source: ${data.source}`);
      console.log(`  Gas: ${data.gas}`);
      
      if (testCase.params.chainId !== testCase.params.toChainId) {
        console.log('  🌉 Cross-chain swap detected');
      }
    } else {
      console.log('❌ Error:', data.error);
      if (data.details) {
        console.log('Details:', data.details);
      }
    }
  } catch (error) {
    console.log('❌ Network error:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Starting cross-chain quote tests...');
  console.log('================================');
  
  // Check if server is running
  try {
    await fetch('http://localhost:3001');
  } catch (error) {
    console.error('❌ Server is not running at http://localhost:3001');
    console.log('Please start the server with: npm run dev');
    return;
  }
  
  // Run all test cases
  for (const testCase of testCases) {
    await testQuote(testCase);
    // Wait a bit between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n✅ All tests completed!');
}

// Run the tests
runTests().catch(console.error);