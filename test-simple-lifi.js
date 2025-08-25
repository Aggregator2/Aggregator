// Simple test of LiFi API for 1INCH -> USDC
require('dotenv').config();
const { getRoutes } = require('@lifi/sdk');

async function test() {
  const lifiApiKey = process.env.LIFI_API_KEY || 'e411f45a-05ed-47d7-aea8-def36d94442e.dcb8f395-2612-41e7-85b2-cb1d1de85502';
  
  const routesRequest = {
    fromChainId: 1,
    toChainId: 1,
    fromTokenAddress: '0x111111111117dc0aa78b770fa6a738034120c302',
    toTokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    fromAmount: '1000000000000000000',
    options: {
      slippage: 0.005,
      allowSwitchChain: false,
      bridges: { allow: [] },
      exchanges: {
        allow: ['uniswap', 'sushiswap', 'paraswap', '1inch', 'openocean']
      }
    }
  };
  
  try {
    console.log('Calling LiFi API...');
    const routes = await getRoutes(routesRequest, {
      apiKey: lifiApiKey
    });
    
    if (routes && routes.routes && routes.routes.length > 0) {
      const bestRoute = routes.routes[0];
      const toAmount = bestRoute.toAmount;
      const toAmountHuman = parseFloat(toAmount) / 1e6; // USDC has 6 decimals
      
      console.log('Success!');
      console.log('1 1INCH =', toAmountHuman.toFixed(2), 'USDC');
      console.log('Raw amount:', toAmount);
      
      // Apply 0.3% platform fee
      const platformFeeBps = 30;
      const buyAmountBN = BigInt(toAmount);
      const platformFeeAmount = (buyAmountBN * BigInt(platformFeeBps)) / BigInt(10000);
      const buyAmountAfterFee = buyAmountBN - platformFeeAmount;
      
      console.log('After 0.3% fee:', (parseFloat(buyAmountAfterFee.toString()) / 1e6).toFixed(2), 'USDC');
    } else {
      console.log('No routes found');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();