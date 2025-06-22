const axios = require('axios');

const EDGE_CASE_PAIRS = [
  // Cross-chain quote (should fail gracefully)
  {
    chainId: 1,
    sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on Ethereum
    buyToken: '0x55d398326f99059fF775485246999027B3197955', // BSC-USD on BSC
    sellAmount: '1000000000000000000',
    name: 'Cross-chain quote (should fail)',
    expectFailure: true
  },
  // Small cap token
  {
    chainId: 1,
    sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    buyToken: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', // SUSHI
    sellAmount: '1000000000000000000',
    name: 'ETH → SUSHI (small cap)'
  },
  // Wrapped token to native equivalent
  {
    chainId: 1,
    sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    buyToken: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
    sellAmount: '1000000000000000000',
    name: 'WETH → WBTC'
  },
  // Stablecoin precision test
  {
    chainId: 1,
    sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC (6 decimals)
    buyToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI (18 decimals)
    sellAmount: '1000000', // 1 USDC
    name: 'USDC → DAI (decimal precision)'
  },
  // Large amount
  {
    chainId: 1,
    sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    sellAmount: '100000000000000000000', // 100 ETH
    name: 'Large amount: 100 ETH → USDC'
  }
];

async function testEdgeCases() {
  console.log('🔍 Testing Edge Cases with LiFi\n');
  
  let successCount = 0;
  let expectedFailures = 0;
  let unexpectedFailures = 0;
  
  for (const pair of EDGE_CASE_PAIRS) {
    console.log(`\nTesting: ${pair.name}`);
    
    try {
      const response = await axios.post('http://localhost:3000/api/quote-profitable', {
        sellToken: pair.sellToken,
        buyToken: pair.buyToken,
        sellAmount: pair.sellAmount,
        chainId: pair.chainId,
        slippagePercentage: 1
      });
      
      const quote = response.data;
      
      if (pair.expectFailure) {
        console.log(`  ⚠️  Unexpected success for expected failure case`);
        console.log(`  Source: ${quote.source}`);
      } else {
        console.log(`  ✅ Success!`);
        console.log(`  Source: ${quote.source}`);
        console.log(`  Buy Amount: ${quote.buyAmount}`);
        successCount++;
      }
      
    } catch (error) {
      if (pair.expectFailure) {
        console.log(`  ✅ Expected failure: ${error.response?.data?.message || error.message}`);
        expectedFailures++;
      } else {
        console.log(`  ❌ Unexpected failure: ${error.response?.data?.message || error.message}`);
        unexpectedFailures++;
      }
    }
  }
  
  console.log('\n📊 Edge Case Summary:');
  console.log(`  Successful quotes: ${successCount}`);
  console.log(`  Expected failures: ${expectedFailures}`);
  console.log(`  Unexpected failures: ${unexpectedFailures}`);
}

testEdgeCases().catch(console.error);