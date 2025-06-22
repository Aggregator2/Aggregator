const axios = require('axios');

async function debugQuote() {
  console.log('🔍 Debugging Quote System\n');
  
  // Set environment variable
  process.env.LIFI_API_KEY = 'e411f45a-05ed-47d7-aea8-def36d94442e.dcb8f395-2612-41e7-85b2-cb1d1de85502';
  console.log('LiFi API Key set:', process.env.LIFI_API_KEY ? '✅' : '❌');
  
  // Skip multiChainQuoteService test for now
  console.log('\n1. Skipping multiChainQuoteService test (build required)');
  
  // Test API endpoint
  console.log('\n2. Testing API endpoint...');
  try {
    const response = await axios.post('http://localhost:3000/api/quote-profitable', {
      sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      sellAmount: '1000000000000000000',
      chainId: 1
    }, {
      timeout: 10000
    });
    
    console.log('✅ API quote success!');
    console.log('Source:', response.data.source);
    console.log('Buy Amount:', response.data.buyAmount);
  } catch (error) {
    console.log('❌ API quote failed:', error.response?.data?.error || error.message);
  }
  
  // Test LiFi SDK directly
  console.log('\n3. Testing LiFi SDK directly...');
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
    
    console.log('✅ LiFi SDK success!');
    console.log('Routes found:', result.routes?.length || 0);
    if (result.routes && result.routes.length > 0) {
      console.log('Best route amount:', result.routes[0].toAmount);
    }
  } catch (error) {
    console.log('❌ LiFi SDK failed:', error.message);
  }
}

debugQuote().catch(console.error);