require('dotenv').config({ path: '.env.local' });

async function testLiFiIntegration() {
  console.log('🔍 Testing LiFi Integration End-to-End\n');
  
  // Test 1: Direct LiFi SDK
  console.log('1. Direct LiFi SDK Test:');
  try {
    const { getRoutes } = require('@lifi/sdk');
    
    const result = await getRoutes({
      fromChainId: 1,
      toChainId: 1,
      fromTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      fromAmount: '1000000000000000000',
      options: {
        slippage: 0.01,
        allowSwitchChain: false,
        bridges: { allow: [] },
        integrator: 'multi-chain-swap',
        apiKey: process.env.LIFI_API_KEY
      }
    });
    
    if (result.routes && result.routes.length > 0) {
      console.log('✅ LiFi SDK works! Routes:', result.routes.length);
      console.log('   Best route amount:', result.routes[0].toAmount);
      console.log('   Tool:', result.routes[0].steps?.[0]?.tool);
    }
  } catch (error) {
    console.log('❌ LiFi SDK failed:', error.message);
  }
  
  // Test 2: API Endpoint
  console.log('\n2. API Endpoint Test:');
  try {
    const axios = require('axios');
    const response = await axios.post('http://localhost:3000/api/quote-profitable', {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      sellAmount: '1000000000000000000',
      chainId: 1
    }, { timeout: 10000 });
    
    console.log('✅ API Response:');
    console.log('   Source:', response.data.source);
    console.log('   Buy Amount:', response.data.buyAmount);
    console.log('   Original Quote Source:', response.data.originalQuote?.source);
  } catch (error) {
    console.log('❌ API failed:', error.response?.data?.error || error.message);
  }
  
  // Test 3: Check profitableQuoteService logs
  console.log('\n3. Analyzing flow - see server logs for:');
  console.log('   - [ProfitableQuoteService] logs');
  console.log('   - MultiChainQuoteService logs');
  console.log('   - LiFi integration logs');
}

testLiFiIntegration().catch(console.error);