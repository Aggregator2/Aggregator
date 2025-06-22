const axios = require('axios');

const TEST_BASE_URL = 'http://localhost:3000/api';

// Test tokens to check
const TEST_TOKENS = [
  {
    name: 'USDC on Ethereum',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
    targetChains: [56, 137, 42161] // BSC, Polygon, Arbitrum
  },
  {
    name: 'Native Token',
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    chainId: 1,
    targetChains: [56, 137, 42161]
  },
  {
    name: 'Unknown Token',
    address: '0xf88b137cfa667065955abd17525e89edcf4d6426',
    chainId: 1,
    targetChains: [56, 137]
  }
];

async function testTokenResolution() {
  console.log('Testing Cross-Chain Token Resolution\n');
  console.log('=====================================\n');

  for (const testToken of TEST_TOKENS) {
    console.log(`\n📍 Testing: ${testToken.name}`);
    console.log(`   Address: ${testToken.address}`);
    console.log(`   Source Chain: ${testToken.chainId}\n`);

    // First, check token info on source chain
    try {
      const response = await axios.post(`${TEST_BASE_URL}/crosschain/check-token`, {
        tokenAddress: testToken.address,
        sourceChainId: testToken.chainId
      });

      const data = response.data;
      if (data.tokenInfo) {
        console.log(`   ✅ Token found on chain ${testToken.chainId}:`);
        console.log(`      Symbol: ${data.tokenInfo.symbol}`);
        console.log(`      Name: ${data.tokenInfo.name}`);
        console.log(`      Available on ${data.totalChains} chains: ${data.availableChains.join(', ')}`);
      } else {
        console.log(`   ❌ Token not found on chain ${testToken.chainId}`);
      }
    } catch (error) {
      console.log(`   ❌ Error checking token: ${error.response?.data?.error || error.message}`);
    }

    // Then check resolution to target chains
    for (const targetChain of testToken.targetChains) {
      try {
        const response = await axios.post(`${TEST_BASE_URL}/crosschain/check-token`, {
          tokenAddress: testToken.address,
          sourceChainId: testToken.chainId,
          targetChainId: targetChain
        });

        const data = response.data;
        if (data.available) {
          console.log(`\n   🔄 Chain ${testToken.chainId} → ${targetChain}:`);
          console.log(`      ✅ Token available`);
          console.log(`      Target address: ${data.targetAddress}`);
          if (data.tokenInfo) {
            console.log(`      Symbol: ${data.tokenInfo.symbol}`);
          }
        } else {
          console.log(`\n   🔄 Chain ${testToken.chainId} → ${targetChain}:`);
          console.log(`      ❌ ${data.message}`);
        }
      } catch (error) {
        console.log(`\n   🔄 Chain ${testToken.chainId} → ${targetChain}:`);
        console.log(`      ❌ Error: ${error.response?.data?.error || error.message}`);
      }
    }
  }

  // Test a cross-chain quote with proper token resolution
  console.log('\n\n📊 Testing Cross-Chain Quote with Token Resolution\n');
  console.log('================================================\n');

  try {
    // Test USDC from Ethereum to Polygon
    const quoteResponse = await axios.post(`${TEST_BASE_URL}/quote-profitable`, {
      sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC (Ethereum address)
      sellAmount: '1000000000000000000', // 1 ETH
      chainId: 1,
      toChainId: 137, // Polygon
      user: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fA7e'
    });

    const quote = quoteResponse.data;
    console.log('✅ Cross-chain quote successful!');
    console.log(`   From: ETH on Ethereum`);
    console.log(`   To: USDC on Polygon`);
    console.log(`   Buy Amount: ${quote.buyAmount}`);
    console.log(`   Sources: ${quote.sources?.map(s => s.name).join(', ') || 'N/A'}`);
  } catch (error) {
    console.log('❌ Cross-chain quote failed:');
    console.log(`   Error: ${error.response?.data?.error || error.message}`);
    if (error.response?.data?.details) {
      console.log(`   Details: ${error.response.data.details}`);
    }
  }
}

// Run the test
testTokenResolution().catch(console.error);