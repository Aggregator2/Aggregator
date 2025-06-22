import { NextApiRequest, NextApiResponse } from 'next';
import { CrossChainRouter } from '../../../src/services/crossChainRouter';
import { CrossChainSwapRequest } from '../../../src/services/crossChainRouter/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      sourceChainId,
      destinationChainId,
      sourceToken,
      destinationToken,
      sourceAmount,
      recipientAddress,
      slippageTolerance
    } = req.body;

    // Validate required fields
    if (!sourceChainId || !destinationChainId || !sourceToken || 
        !destinationToken || !sourceAmount || !recipientAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create router instance
    const router = new CrossChainRouter();

    // Build request
    const swapRequest: CrossChainSwapRequest = {
      sourceChainId,
      destinationChainId,
      sourceToken,
      destinationToken,
      sourceAmount,
      recipientAddress,
      slippageTolerance: slippageTolerance || 300
    };

    // Get quote (best route)
    const quote = await router.getQuote(swapRequest);

    // Get gas estimate for the route
    const gasEstimate = await router.estimateGasCosts(quote.route);

    return res.status(200).json({
      success: true,
      quote: {
        outputAmount: quote.outputAmount,
        priceImpact: quote.priceImpact,
        executionTime: quote.executionTime,
        totalFeeUSD: quote.totalFeeUSD,
        gasEstimate: {
          totalGasUnits: gasEstimate.totalGasUnits,
          totalGasCostUSD: gasEstimate.totalGasCostUSD,
          breakdown: gasEstimate.breakdown
        },
        route: {
          id: quote.route.id,
          reliability: quote.route.reliability,
          numberOfSteps: quote.route.steps.length,
          bridgesUsed: [...new Set(quote.route.steps.filter(s => s.type === 'bridge').map(s => s.protocol))],
          dexesUsed: [...new Set(quote.route.steps.filter(s => s.type === 'swap').map(s => s.protocol))]
        }
      },
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Cross-chain quote error:', error);
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}