const { getRoutes } = require('@lifi/sdk');

async function testLiFiDirect() {
  console.log('Testing LiFi directly with API key...\n');
  
  const routeRequest = {
    fromChainId: 1,
    toChainId: 1,
    fromTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    fromAmount: '1000000000000000000', // 1 WETH
    options: {
      slippage: 0.01,
      allowSwitchChain: false,
      bridges: {
        allow: []
      },
      integrator: 'multi-chain-swap',
      apiKey: 'e411f45a-05ed-47d7-aea8-def36d94442e.dcb8f395-2612-41e7-85b2-cb1d1de85502'
    }
  };
  
  console.log('Request:', JSON.stringify({...routeRequest, options: {...routeRequest.options, apiKey: 'hidden'}}, null, 2));
  
  try {
    const result = await getRoutes(routeRequest);
    console.log(`\n✅ Success! Got ${result.routes?.length || 0} routes\n`);
    
    if (result.routes && result.routes.length > 0) {
      result.routes.forEach((route, index) => {
        console.log(`Route ${index + 1}:`);
        console.log(`  ID: ${route.id}`);
        console.log(`  From: ${route.fromAmount} (${route.fromAmount / 1e18} WETH)`);
        console.log(`  To: ${route.toAmount} (${route.toAmount / 1e6} USDC)`);
        console.log(`  Min: ${route.toAmountMin} (${route.toAmountMin / 1e6} USDC)`);
        console.log(`  Steps: ${route.steps?.length || 0}`);
        if (route.steps && route.steps.length > 0) {
          console.log(`  Tool: ${route.steps[0].tool}`);
        }
        console.log('');
      });
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testLiFiDirect().catch(console.error);