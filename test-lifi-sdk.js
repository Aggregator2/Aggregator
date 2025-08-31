// Test LiFi SDK directly
const { getRoutes } = require('@lifi/sdk');

async function testLiFi() {
  try {
    console.log('Testing LiFi SDK...');
    console.log('getRoutes function:', typeof getRoutes);
    
    const routesRequest = {
      fromChainId: 1,
      toChainId: 1,
      fromTokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      toTokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      fromAmount: '1000000',
      options: {
        slippage: 0.005,
        allowSwitchChain: false,
        bridges: { allow: [] },
        exchanges: {
          allow: ['uniswap', 'sushiswap', 'paraswap', '1inch', 'openocean']
        }
      }
    };
    
    console.log('Calling getRoutes...');
    const routes = await getRoutes(routesRequest, {
      apiKey: 'e411f45a-05ed-47d7-aea8-def36d94442e.dcb8f395-2612-41e7-85b2-cb1d1de85502'
    });
    
    console.log('Routes received:', routes);
  } catch (error) {
    console.error('Error:', error);
  }
}

testLiFi();