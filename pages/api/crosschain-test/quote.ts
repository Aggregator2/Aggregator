import { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { TestCrossChainRouter } from '../../../src/services/crossChainRouter/TestRouter';
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

    // Create test router instance
    const router = new TestCrossChainRouter();

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

    console.log('Getting test quote for:', swapRequest);

    // Get quote (best route)
    const quote = await router.getQuote(swapRequest);

    // Get gas estimate for the route
    const gasEstimate = await router.estimateGasCosts(quote.route);

    // Format token amounts for display
    const formatAmount = (amount: string, decimals: number) => {
      try {
        return ethers.utils.formatUnits(amount, decimals);
      } catch {
        return amount;
      }
    };

    const sourceTokenInfo = quote.route.steps[0]?.fromToken;
    const destTokenInfo = quote.route.steps[quote.route.steps.length - 1]?.toToken;

    return res.status(200).json({
      success: true,
      testMode: true,
      quote: {
        inputAmount: formatAmount(sourceAmount, sourceTokenInfo?.decimals || 18),
        inputToken: sourceTokenInfo?.symbol || 'UNKNOWN',
        outputAmount: formatAmount(quote.outputAmount, destTokenInfo?.decimals || 18),
        outputToken: destTokenInfo?.symbol || 'UNKNOWN',
        priceImpact: quote.priceImpact,
        priceImpactPercent: (quote.priceImpact / 100).toFixed(2),
        executionTime: quote.executionTime,
        executionTimeMinutes: Math.round(quote.executionTime / 60),
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
          dexesUsed: [...new Set(quote.route.steps.filter(s => s.type === 'swap').map(s => s.protocol))],
          path: quote.route.steps.map(step => ({
            type: step.type,
            protocol: step.protocol,
            fromSymbol: step.fromToken.symbol,
            toSymbol: step.toToken.symbol,
            chainId: step.chainId
          }))
        }
      },
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Cross-chain test quote error:', error);
    
    return res.status(500).json({
      success: false,
      testMode: true,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}