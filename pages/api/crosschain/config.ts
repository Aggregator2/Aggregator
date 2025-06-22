import { NextApiRequest, NextApiResponse } from 'next';
import { CrossChainRouter } from '../../../src/services/crossChainRouter';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Create router instance
    const router = new CrossChainRouter();

    // Get supported chains
    const supportedChains = router.getSupportedChains();

    // Get chain details
    const chains = await Promise.all(
      supportedChains.map(async (chainId) => {
        try {
          const config = router['tokenService'].getChainConfig(chainId);
          const popularTokens = await router.getSupportedTokens(chainId);
          
          return {
            chainId,
            name: config.name,
            type: config.type,
            nativeCurrency: config.nativeCurrency,
            blockExplorer: config.blockExplorer,
            isTestnet: config.isTestnet,
            popularTokens: popularTokens.map(token => ({
              address: token.address,
              symbol: token.symbol,
              name: token.name,
              decimals: token.decimals
            }))
          };
        } catch (error) {
          return {
            chainId,
            error: 'Could not get chain config'
          };
        }
      })
    );

    // Get supported bridges
    const bridgeAggregator = router['bridgeAggregator'];
    const supportedBridges = bridgeAggregator.getSupportedBridges();

    // Get supported DEXs
    const dexAggregator = router['dexAggregator'];
    const supportedDEXs = dexAggregator.getSupportedDEXs();

    return res.status(200).json({
      success: true,
      config: {
        supportedChains: chains,
        supportedBridges,
        supportedDEXs,
        features: {
          maxStepsInRoute: 4,
          defaultSlippageTolerance: 300, // 3%
          maxSlippageTolerance: 5000,    // 50%
          simulationMode: true,
          realTimeGasEstimates: true,
          bridgeStatusTracking: true
        },
        limits: {
          minSwapAmountUSD: 10,
          maxSwapAmountUSD: 1000000,
          maxExecutionTime: 3600 // 1 hour
        }
      },
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Config error:', error);
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}