require('dotenv').config();
const axios = require('axios');

// Test configuration
const TEST_CASES = {
  singleChain: [
    {
      name: 'ETH to USDC on Ethereum',
      params: {
        chainId: 1,
        sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        sellAmount: '1000000000000000000', // 1 ETH
        user: '0x0000000000000000000000000000000000000001',
        slippagePercentage: 0.5
      }
    },
    {
      name: 'USDC to USDT on Polygon',
      params: {
        chainId: 137,
        sellToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
        buyToken: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
        sellAmount: '1000000', // 1 USDC
        user: '0x0000000000000000000000000000000000000001',
        slippagePercentage: 0.5
      }
    },
    {
      name: 'BNB to BUSD on BSC',
      params: {
        chainId: 56,
        sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // BNB
        buyToken: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
        sellAmount: '1000000000000000000', // 1 BNB
        user: '0x0000000000000000000000000000000000000001',
        slippagePercentage: 0.5
      }
    }
  ],
  crossChain: [
    {
      name: 'ETH on Ethereum to MATIC on Polygon',
      params: {
        sourceChainId: 1,
        destinationChainId: 137,
        sourceToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
        destinationToken: '0x0000000000000000000000000000000000001010', // MATIC
        sourceAmount: '1000000000000000000', // 1 ETH
        recipientAddress: '0x0000000000000000000000000000000000000001',
        slippageTolerance: 300
      }
    },
    {
      name: 'USDC Ethereum to USDC Polygon',
      params: {
        sourceChainId: 1,
        destinationChainId: 137,
        sourceToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
        destinationToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Polygon
        sourceAmount: '1000000', // 1 USDC
        recipientAddress: '0x0000000000000000000000000000000000000001',
        slippageTolerance: 300
      }
    },
    {
      name: 'BNB on BSC to ETH on Ethereum',
      params: {
        sourceChainId: 56,
        destinationChainId: 1,
        sourceToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // BNB
        destinationToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
        sourceAmount: '1000000000000000000', // 1 BNB
        recipientAddress: '0x0000000000000000000000000000000000000001',
        slippageTolerance: 300
      }
    },
    {
      name: 'USDT BSC to USDT Arbitrum',
      params: {
        sourceChainId: 56,
        destinationChainId: 42161,
        sourceToken: '0x55d398326f99059fF775485246999027B3197955', // USDT on BSC
        destinationToken: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT on Arbitrum
        sourceAmount: '1000000', // 1 USDT
        recipientAddress: '0x0000000000000000000000000000000000000001',
        slippageTolerance: 300
      }
    }
  ]
};

// Test the normal quote API
async function testNormalQuote(testCase) {
  console.log(`\n🔍 Testing Normal Quote: ${testCase.name}`);
  console.log('Parameters:', JSON.stringify(testCase.params, null, 2));
  
  try {
    const response = await axios.post('http://localhost:3000/api/quote-profitable', testCase.params);
    
    if (response.data.error) {
      console.error('❌ Error:', response.data.error);
      return false;
    }
    
    console.log('✅ Success! Quote received:');
    console.log(`  - Buy Amount: ${response.data.buyAmount}`);
    console.log(`  - Min Received: ${response.data.minReceived}`);
    console.log(`  - Price: ${response.data.price}`);
    console.log(`  - Source: ${response.data.source}`);
    console.log(`  - Gas: ${response.data.gas || 'N/A'}`);
    
    return true;
  } catch (error) {
    console.error('❌ Request failed:', error.response?.data || error.message);
    return false;
  }
}

// Test the cross-chain quote API
async function testCrossChainQuote(testCase) {
  console.log(`\n🌉 Testing Cross-Chain Quote: ${testCase.name}`);
  console.log('Parameters:', JSON.stringify(testCase.params, null, 2));
  
  try {
    const response = await axios.post('http://localhost:3000/api/crosschain/quote', testCase.params);
    
    if (response.data.error) {
      console.error('❌ Error:', response.data.error);
      return false;
    }
    
    console.log('✅ Success! Cross-chain quote received:');
    console.log(`  - Output Amount: ${response.data.quote.outputAmount}`);
    console.log(`  - Price Impact: ${response.data.quote.priceImpact}`);
    console.log(`  - Execution Time: ${response.data.quote.executionTime} seconds`);
    console.log(`  - Total Fee USD: $${response.data.quote.totalFeeUSD}`);
    console.log(`  - Route ID: ${response.data.quote.route.id}`);
    console.log(`  - Steps: ${response.data.quote.route.numberOfSteps}`);
    
    return true;
  } catch (error) {
    console.error('❌ Request failed:', error.response?.data || error.message);
    return false;
  }
}

// Test LI.FI API key
async function testLiFiApiKey() {
  console.log('\n🔑 Testing LI.FI API Key...');
  
  try {
    const response = await axios.get('https://li.quest/v1/keys/test', {
      headers: {
        'x-lifi-api-key': process.env.LIFI_API_KEY
      }
    });
    
    console.log('✅ LI.FI API Key is valid!');
    console.log('Response:', response.data);
    return true;
  } catch (error) {
    console.error('❌ LI.FI API Key test failed:', error.response?.data || error.message);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Quote System Tests');
  console.log('================================\n');
  
  // Test API key first
  const apiKeyValid = await testLiFiApiKey();
  if (!apiKeyValid) {
    console.log('\n⚠️  Warning: LI.FI API key is not valid. Some features might be rate-limited.');
  }
  
  // Test single-chain quotes
  console.log('\n\n📊 SINGLE-CHAIN QUOTE TESTS');
  console.log('===========================');
  
  let singleChainSuccess = 0;
  for (const testCase of TEST_CASES.singleChain) {
    const success = await testNormalQuote(testCase);
    if (success) singleChainSuccess++;
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
  }
  
  // Test cross-chain quotes
  console.log('\n\n🌐 CROSS-CHAIN QUOTE TESTS');
  console.log('==========================');
  
  let crossChainSuccess = 0;
  for (const testCase of TEST_CASES.crossChain) {
    const success = await testCrossChainQuote(testCase);
    if (success) crossChainSuccess++;
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
  }
  
  // Summary
  console.log('\n\n📈 TEST SUMMARY');
  console.log('===============');
  console.log(`Single-Chain Quotes: ${singleChainSuccess}/${TEST_CASES.singleChain.length} passed`);
  console.log(`Cross-Chain Quotes: ${crossChainSuccess}/${TEST_CASES.crossChain.length} passed`);
  console.log(`Total: ${singleChainSuccess + crossChainSuccess}/${TEST_CASES.singleChain.length + TEST_CASES.crossChain.length} passed`);
  
  if (singleChainSuccess + crossChainSuccess === TEST_CASES.singleChain.length + TEST_CASES.crossChain.length) {
    console.log('\n✅ All tests passed!');
  } else {
    console.log('\n❌ Some tests failed. Please check the logs above.');
  }
}

// Run the tests
runTests().catch(console.error);