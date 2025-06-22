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

    console.log('Simulating swap for:', swapRequest);

    // Simulate the swap
    const simulation = await router.simulateSwap(swapRequest);

    if (!simulation.success) {
      return res.status(400).json({
        success: false,
        testMode: true,
        error: 'Simulation failed',
        warnings: simulation.warnings
      });
    }

    // Build detailed execution plan with transaction data
    const detailedPlan = await Promise.all(
      simulation.executionPlan.map(async (step, index) => {
        try {
          const txData = await router.buildTransaction(
            simulation.route, 
            index, 
            recipientAddress
          );
          
          return {
            ...step,
            transaction: {
              to: txData.to,
              data: txData.data.slice(0, 50) + '...', // Truncate for display
              value: txData.value,
              gasLimit: txData.gasLimit,
              chainId: txData.chainId
            },
            estimatedGasCostUSD: parseFloat((parseFloat(txData.gasLimit) * 0.00000002 * 2000).toFixed(2)) // Mock calculation
          };
        } catch (error) {
          return {
            ...step,
            error: error instanceof Error ? error.message : 'Failed to build transaction'
          };
        }
      })
    );

    // Format amounts for display
    const formatAmount = (amount: string, decimals: number) => {
      try {
        return ethers.utils.formatUnits(amount, decimals);
      } catch {
        return amount;
      }
    };

    const sourceTokenInfo = simulation.route.steps[0]?.fromToken;
    const destTokenInfo = simulation.route.steps[simulation.route.steps.length - 1]?.toToken;

    return res.status(200).json({
      success: true,
      testMode: true,
      simulation: {
        route: {
          id: simulation.route.id,
          inputAmount: formatAmount(sourceAmount, sourceTokenInfo?.decimals || 18),
          inputToken: sourceTokenInfo?.symbol || 'UNKNOWN',
          outputAmount: formatAmount(simulation.route.estimatedOutput, destTokenInfo?.decimals || 18),
          outputToken: destTokenInfo?.symbol || 'UNKNOWN',
          numberOfSteps: simulation.route.steps.length,
          priceImpact: simulation.route.priceImpact,
          reliability: simulation.route.reliability
        },
        execution: {
          totalSteps: simulation.executionPlan.length,
          totalEstimatedTime: simulation.totalEstimatedTime,
          totalEstimatedTimeMinutes: Math.round(simulation.totalEstimatedTime / 60),
          totalEstimatedGasUSD: simulation.totalEstimatedGasUSD,
          steps: detailedPlan
        },
        risks: {
          warnings: simulation.warnings,
          riskLevel: simulation.warnings.length === 0 ? 'Low' : 
                   simulation.warnings.length <= 2 ? 'Medium' : 'High',
          recommendations: [
            'Review all transaction steps before execution',
            'Ensure sufficient balance on source chain',
            'Consider gas costs on all involved chains',
            'Monitor bridge completion times'
          ]
        }
      },
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Cross-chain simulation error:', error);
    
    return res.status(500).json({
      success: false,
      testMode: true,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}