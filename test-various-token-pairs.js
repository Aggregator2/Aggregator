const axios = require('axios');

const TEST_PAIRS = [
  // Ethereum mainnet
  { 
    chainId: 1,
    sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    sellAmount: '1000000000000000000', // 1 ETH
    name: 'ETH → USDC (Ethereum)'
  },
  {
    chainId: 1,
    sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    sellAmount: '1000000000', // 1000 USDC
    name: 'USDC → USDT (Ethereum)'
  },
  // BSC
  {
    chainId: 56,
    sellToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    buyToken: '0x55d398326f99059fF775485246999027B3197955', // BSC-USD (USDT)
    sellAmount: '1000000000000000000', // 1 BNB
    name: 'BNB → USDT (BSC)'
  },
  // Polygon
  {
    chainId: 137,
    sellToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
    sellAmount: '1000000000000000000', // 1 MATIC
    name: 'MATIC → USDC (Polygon)'
  },
  // Arbitrum
  {
    chainId: 42161,
    sellToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    buyToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    sellAmount: '1000000000000000000', // 1 ETH
    name: 'ETH → USDC (Arbitrum)'
  }
];

async function testMultipleTokenPairs() {
  console.log('🔍 Testing Multiple Token Pairs with LiFi\n');
  
  let successCount = 0;
  let failureCount = 0;
  
  for (const pair of TEST_PAIRS) {
    console.log(`\nTesting: ${pair.name}`);
    console.log(`  Chain ID: ${pair.chainId}`);
    
    try {
      const response = await axios.post('http://localhost:3000/api/quote-profitable', {
        sellToken: pair.sellToken,
        buyToken: pair.buyToken,
        sellAmount: pair.sellAmount,
        chainId: pair.chainId,
        slippagePercentage: 1
      });
      
      const quote = response.data;
      console.log(`  ✅ Success!`);
      console.log(`  Source: ${quote.source}`);
      console.log(`  Buy Amount: ${quote.buyAmount}`);
      console.log(`  Price: ${quote.price}`);
      console.log(`  Gas: ${quote.gas || 'N/A'}`);
      
      if (quote.source === 'LiFi') {
        successCount++;
      } else {
        console.log(`  ⚠️  Using fallback source: ${quote.source}`);
      }
      
    } catch (error) {
      console.log(`  ❌ Failed: ${error.response?.data?.message || error.message}`);
      failureCount++;
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`  Total tests: ${TEST_PAIRS.length}`);
  console.log(`  LiFi quotes: ${successCount}`);
  console.log(`  Failures: ${failureCount}`);
  console.log(`  Success rate: ${(successCount / TEST_PAIRS.length * 100).toFixed(1)}%`);
}

testMultipleTokenPairs().catch(console.error);