// Comprehensive test for LiFi API integration
require('dotenv').config();
const { getRoutes } = require('@lifi/sdk');

async function testDirectLiFiAPI() {
  console.log('Testing direct LiFi API calls...\n');
  
  const lifiApiKey = process.env.LIFI_API_KEY || 'e411f45a-05ed-47d7-aea8-def36d94442e.dcb8f395-2612-41e7-85b2-cb1d1de85502';
  console.log('Using LiFi API key:', lifiApiKey ? 'Found' : 'Not found');
  
  const testCases = [
    {
      name: 'ETH -> USDC on Ethereum',
      fromChainId: 1,
      toChainId: 1,
      fromTokenAddress: '0x0000000000000000000000000000000000000000', // ETH native
      toTokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      fromAmount: '1000000000000000000', // 1 ETH
      expectDecimals: 6
    },
    {
      name: 'WETH -> USDC on Ethereum',
      fromChainId: 1,
      toChainId: 1,
      fromTokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
      toTokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      fromAmount: '1000000000000000000', // 1 WETH
      expectDecimals: 6
    },
    {
      name: '1INCH -> USDC on Ethereum',
      fromChainId: 1,
      toChainId: 1,
      fromTokenAddress: '0x111111111117dc0aa78b770fa6a738034120c302', // 1INCH
      toTokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      fromAmount: '1000000000000000000', // 1 1INCH
      expectDecimals: 6
    }
  ];

  for (const test of testCases) {
    console.log(`\nTesting: ${test.name}`);
    console.log(`From: ${test.fromTokenAddress}`);
    console.log(`To: ${test.toTokenAddress}`);
    console.log(`Amount: ${test.fromAmount}`);
    
    try {
      const routesRequest = {
        fromChainId: test.fromChainId,
        toChainId: test.toChainId,
        fromTokenAddress: test.fromTokenAddress,
        toTokenAddress: test.toTokenAddress,
        fromAmount: test.fromAmount,
        options: {
          slippage: 0.005, // 0.5%
          allowSwitchChain: false,
          bridges: { allow: [] }, // Same-chain swap only
          exchanges: {
            allow: ['uniswap', 'sushiswap', 'paraswap', '1inch', 'openocean']
          }
        }
      };
      
      console.log('Calling LiFi API...');
      const startTime = Date.now();
      
      const routes = await getRoutes(routesRequest, {
        apiKey: lifiApiKey
      });
      
      const endTime = Date.now();
      console.log(`API Response time: ${endTime - startTime}ms`);
      
      if (!routes || !routes.routes || routes.routes.length === 0) {
        console.log('❌ No routes found');
        continue;
      }
      
      console.log(`✅ Found ${routes.routes.length} routes`);
      
      const bestRoute = routes.routes[0];
      const toAmount = bestRoute.toAmount;
      const toAmountHuman = parseFloat(toAmount) / Math.pow(10, test.expectDecimals);
      
      console.log(`Best route details:`);
      console.log(`  - Tool: ${bestRoute.steps[0]?.tool || 'Unknown'}`);
      console.log(`  - To amount (raw): ${toAmount}`);
      console.log(`  - To amount (human): ${toAmountHuman.toFixed(2)} ${test.name.split(' -> ')[1].split(' ')[0]}`);
      console.log(`  - Gas estimate: ${bestRoute.gasCostUSD || 'N/A'} USD`);
      
      // Calculate effective rate
      const fromAmountHuman = parseFloat(test.fromAmount) / 1e18; // All test tokens have 18 decimals
      const effectiveRate = toAmountHuman / fromAmountHuman;
      console.log(`  - Effective rate: 1 ${test.name.split(' -> ')[0]} = ${effectiveRate.toFixed(2)} ${test.name.split(' -> ')[1].split(' ')[0]}`);
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      if (error.response) {
        console.log(`Response status: ${error.response.status}`);
        console.log(`Response data:`, error.response.data);
      }
    }
  }
}

async function testSwappiQEndpoint() {
  console.log('\n\n=== Testing SwappiQ Quote Endpoint ===\n');
  
  const fetch = require('node-fetch');
  
  const testQuote = {
    sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
    buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    sellAmount: '1000000000000000000', // 1 WETH
    chainId: 1,
    slippageTolerance: '0.5'
  };
  
  try {
    const response = await fetch('http://localhost:3000/api/quote-profitable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testQuote)
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Quote endpoint working!');
      console.log('Buy amount:', data.buyAmount);
      console.log('Platform fee:', data.platformFee);
      console.log('Fee breakdown:', data.feeBreakdown);
    } else {
      console.log('❌ Quote endpoint error:', data.error);
    }
  } catch (error) {
    console.log('❌ Failed to call endpoint:', error.message);
  }
}

// Run tests
async function runAllTests() {
  await testDirectLiFiAPI();
  await testSwappiQEndpoint();
}

runAllTests().catch(console.error);