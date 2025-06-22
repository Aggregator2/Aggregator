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
      slippageTolerance,
      routeId, // Optional: use specific route
      simulate = true // Default to simulation mode
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

    if (simulate) {
      // Simulation mode - just validate and return execution plan
      const routes = await router.getRoutes(swapRequest);
      const selectedRoute = routeId ? 
        routes.find(r => r.id === routeId) || routes[0] : 
        routes[0];

      // Check user balance
      const hasBalance = await router['checkUserBalance'](
        sourceChainId,
        sourceToken,
        sourceAmount,
        recipientAddress
      );

      // Build transactions for each step
      const executionPlan = [];
      for (let i = 0; i < selectedRoute.steps.length; i++) {
        try {
          const tx = await router.buildTransaction(selectedRoute, i, recipientAddress);
          executionPlan.push({
            stepIndex: i,
            stepType: selectedRoute.steps[i].type,
            chainId: selectedRoute.steps[i].chainId,
            protocol: selectedRoute.steps[i].protocol,
            transaction: {
              to: tx.to,
              data: tx.data,
              value: tx.value,
              gasLimit: tx.gasLimit,
              chainId: tx.chainId
            },
            fromToken: selectedRoute.steps[i].fromToken,
            toToken: selectedRoute.steps[i].toToken,
            fromAmount: selectedRoute.steps[i].fromAmount,
            estimatedToAmount: selectedRoute.steps[i].estimatedToAmount
          });
        } catch (error) {
          executionPlan.push({
            stepIndex: i,
            stepType: selectedRoute.steps[i].type,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return res.status(200).json({
        success: true,
        simulation: true,
        route: selectedRoute,
        hasBalance,
        executionPlan,
        warnings: hasBalance ? [] : ['Insufficient balance for execution'],
        timestamp: Date.now()
      });
    } else {
      // Real execution mode (requires proper authentication and signing)
      // In production, this would require:
      // 1. User authentication
      // 2. Signature verification
      // 3. Proper wallet integration
      // 4. Transaction monitoring

      return res.status(501).json({
        success: false,
        error: 'Real execution not implemented. Use simulation mode for testing.'
      });

      // Example of real execution (commented out for safety):
      /*
      const result = await router.executeSwap(swapRequest);
      
      return res.status(200).json({
        success: result.success,
        executionResult: result,
        timestamp: Date.now()
      });
      */
    }

  } catch (error) {
    console.error('Cross-chain execution error:', error);
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}