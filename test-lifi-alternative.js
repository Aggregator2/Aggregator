const { getQuote, getRoutes } = require('@lifi/sdk');

async function testLiFiAlternatives() {
  console.log('Testing LiFi with different parameters...\n');
  
  const testCases = [
    {
      name: 'With real wallet address',
      params: {
        fromChain: '1',
        toChain: '1',
        fromToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        toToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        fromAmount: '1000000000000000000',
        fromAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f89234', // Real wallet
        toAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f89234',
        slippage: 0.005,
      }
    },
    {
      name: 'Using getRoutes instead of getQuote',
      useRoutes: true,
      params: {
        fromChainId: 1,
        toChainId: 1,
        fromTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        fromAmount: '1000000000000000000',
        options: {
          slippage: 0.005,
          allowSwitchChain: false,
          bridges: {
            allow: []
          }
        }
      }
    },
    {
      name: 'ETH to USDC (using ETH address)',
      params: {
        fromChain: '1',
        toChain: '1',
        fromToken: '0x0000000000000000000000000000000000000000', // Native ETH
        toToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        fromAmount: '1000000000000000000',
        fromAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f89234',
        toAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f89234',
        slippage: 0.005,
      }
    },
    {
      name: 'USDC to USDT',
      params: {
        fromChain: '1',
        toChain: '1',
        fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        toToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        fromAmount: '1000000000', // 1000 USDC
        fromAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f89234',
        toAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f89234',
        slippage: 0.005,
      }
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\nTesting: ${testCase.name}`);
    console.log('Params:', JSON.stringify(testCase.params, null, 2));
    
    try {
      let result;
      
      if (testCase.useRoutes) {
        result = await getRoutes(testCase.params);
        console.log(`✅ Got ${result.routes?.length || 0} routes`);
        
        if (result.routes && result.routes.length > 0) {
          const route = result.routes[0];
          console.log('Best route:', {
            id: route.id,
            fromAmount: route.fromAmount,
            toAmount: route.toAmount,
            toAmountMin: route.toAmountMin,
            steps: route.steps?.length || 0
          });
        }
      } else {
        result = await getQuote(testCase.params);
        console.log(`✅ Got ${result.routes?.length || 0} routes`);
        
        if (result.routes && result.routes.length > 0) {
          const route = result.routes[0];
          console.log('Best route:', {
            id: route.id,
            fromAmount: route.fromAmount,
            toAmount: route.toAmount,
            toAmountMin: route.toAmountMin,
            steps: route.steps?.length || 0
          });
        }
      }
    } catch (error) {
      console.log('❌ Error:', error.message);
      if (error.response?.data) {
        console.log('Details:', JSON.stringify(error.response.data, null, 2));
      }
    }
  }
}

testLiFiAlternatives().catch(console.error);