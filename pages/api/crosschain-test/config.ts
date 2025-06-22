import { NextApiRequest, NextApiResponse } from 'next';
import { TestCrossChainRouter } from '../../../src/services/crossChainRouter/TestRouter';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Create test router instance
    const router = new TestCrossChainRouter();

    // Get supported chains
    const supportedChains = router.getSupportedChains();

    // Get chain details with popular tokens
    const chains = await Promise.all(
      supportedChains.map(async (chainId) => {
        try {
          const popularTokens = await router.getSupportedTokens(chainId);
          
          // Chain info mapping
          const chainInfo: Record<number, any> = {
            1: { name: 'Ethereum', symbol: 'ETH', explorer: 'https://etherscan.io' },
            56: { name: 'BNB Smart Chain', symbol: 'BNB', explorer: 'https://bscscan.com' },
            137: { name: 'Polygon', symbol: 'MATIC', explorer: 'https://polygonscan.com' },
            42161: { name: 'Arbitrum One', symbol: 'ETH', explorer: 'https://arbiscan.io' },
            10: { name: 'Optimism', symbol: 'ETH', explorer: 'https://optimistic.etherscan.io' },
            43114: { name: 'Avalanche', symbol: 'AVAX', explorer: 'https://snowtrace.io' },
            250: { name: 'Fantom', symbol: 'FTM', explorer: 'https://ftmscan.com' }
          };

          const info = chainInfo[chainId] || { name: `Chain ${chainId}`, symbol: 'UNKNOWN', explorer: '' };
          
          return {
            chainId,
            name: info.name,
            nativeCurrency: {
              symbol: info.symbol,
              decimals: 18
            },
            blockExplorer: info.explorer,
            isTestnet: false,
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

    // Get service info
    const serviceInfo = router.getServiceInfo();

    // Common token pairs for quick testing
    const commonPairs = [
      {
        name: 'ETH → USDC Cross-chain',
        description: 'Swap ETH on Ethereum to USDC on any supported chain',
        examples: [
          {
            from: { chainId: 1, token: '0x0000000000000000000000000000000000000000', symbol: 'ETH' },
            to: { chainId: 56, token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC' }
          },
          {
            from: { chainId: 1, token: '0x0000000000000000000000000000000000000000', symbol: 'ETH' },
            to: { chainId: 137, token: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC' }
          }
        ]
      },
      {
        name: 'USDC Bridging',
        description: 'Bridge USDC between different chains',
        examples: [
          {
            from: { chainId: 1, token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' },
            to: { chainId: 56, token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC' }
          },
          {
            from: { chainId: 137, token: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC' },
            to: { chainId: 42161, token: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC' }
          }
        ]
      },
      {
        name: 'Native Token Swaps',
        description: 'Swap between different native tokens',
        examples: [
          {
            from: { chainId: 1, token: '0x0000000000000000000000000000000000000000', symbol: 'ETH' },
            to: { chainId: 56, token: '0x0000000000000000000000000000000000000000', symbol: 'BNB' }
          },
          {
            from: { chainId: 137, token: '0x0000000000000000000000000000000000000000', symbol: 'MATIC' },
            to: { chainId: 43114, token: '0x0000000000000000000000000000000000000000', symbol: 'AVAX' }
          }
        ]
      }
    ];

    return res.status(200).json({
      success: true,
      testMode: true,
      config: {
        supportedChains: chains,
        supportedBridges: serviceInfo.supportedBridges,
        supportedDEXs: serviceInfo.supportedDEXs,
        features: {
          ...serviceInfo.features,
          maxStepsInRoute: 4,
          defaultSlippageTolerance: 300, // 3%
          maxSlippageTolerance: 5000,    // 50%
          simulationMode: true,
          realTimeGasEstimates: true,
          bridgeStatusTracking: true,
          testMode: true
        },
        limits: {
          minSwapAmountUSD: 1,      // Lower for testing
          maxSwapAmountUSD: 1000000,
          maxExecutionTime: 3600 // 1 hour
        },
        commonPairs,
        testingInfo: {
          description: 'This is a test version that uses mock data instead of real APIs',
          availableEndpoints: [
            'GET /api/crosschain-test/config - Get configuration and supported assets',
            'POST /api/crosschain-test/routes - Find all available routes',
            'POST /api/crosschain-test/quote - Get best route quote',
            'POST /api/crosschain-test/simulate - Simulate swap execution'
          ],
          sampleRequest: {
            sourceChainId: 1,
            destinationChainId: 56,
            sourceToken: '0x0000000000000000000000000000000000000000',
            destinationToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            sourceAmount: '1000000000000000000', // 1 ETH in wei
            recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e'
          }
        }
      },
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Config error:', error);
    
    return res.status(500).json({
      success: false,
      testMode: true,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}