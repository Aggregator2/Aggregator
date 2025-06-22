import type { NextApiRequest, NextApiResponse } from 'next';
import { getRoutes } from '@lifi/sdk';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Test WETH to USDC on Ethereum
    const routeRequest = {
      fromChainId: 1,
      toChainId: 1,
      fromTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      fromAmount: '1000000000000000000', // 1 WETH
      options: {
        slippage: 0.005,
        allowSwitchChain: false,
        bridges: {
          allow: []
        }
      }
    };
    
    console.log('Testing LiFi directly with:', routeRequest);
    
    const result = await getRoutes(routeRequest);
    
    res.status(200).json({
      success: true,
      routesFound: result.routes?.length || 0,
      routes: result.routes?.map(route => ({
        id: route.id,
        fromAmount: route.fromAmount,
        toAmount: route.toAmount,
        toAmountMin: route.toAmountMin,
        steps: route.steps?.length || 0,
        tool: route.steps?.[0]?.tool,
        action: route.steps?.[0]?.action
      }))
    });
  } catch (error: any) {
    console.error('LiFi test error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data
    });
  }
}