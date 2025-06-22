import { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { TestCrossChainRouter } from '../../../src/services/crossChainRouter/TestRouter';
import { CrossChainSwapRequest } from '../../../src/services/crossChainRouter/types';

interface RouteRequestBody {
  sourceChainId: number;
  destinationChainId: number;
  sourceToken: string;
  destinationToken: string;
  sourceAmount: string;
  recipientAddress: string;
  slippageTolerance?: number;
  maxPriceImpact?: number;
  preferredBridges?: string[];
  excludeBridges?: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body: RouteRequestBody = req.body;

    // Validate request body
    if (!body.sourceChainId || !body.destinationChainId) {
      return res.status(400).json({ error: 'Missing chain IDs' });
    }

    if (!body.sourceToken || !body.destinationToken) {
      return res.status(400).json({ error: 'Missing token addresses' });
    }

    if (!body.sourceAmount || !body.recipientAddress) {
      return res.status(400).json({ error: 'Missing amount or recipient address' });
    }

    // Validate recipient address
    if (!ethers.utils.isAddress(body.recipientAddress)) {
      return res.status(400).json({ error: 'Invalid recipient address' });
    }

    // Validate amount
    try {
      const amount = ethers.BigNumber.from(body.sourceAmount);
      if (amount.lte(0)) {
        return res.status(400).json({ error: 'Amount must be greater than 0' });
      }
    } catch (error) {
      return res.status(400).json({ error: 'Invalid amount format' });
    }

    // Create test router instance
    const router = new TestCrossChainRouter();

    // Build request
    const swapRequest: CrossChainSwapRequest = {
      sourceChainId: body.sourceChainId,
      destinationChainId: body.destinationChainId,
      sourceToken: body.sourceToken,
      destinationToken: body.destinationToken,
      sourceAmount: body.sourceAmount,
      recipientAddress: body.recipientAddress,
      slippageTolerance: body.slippageTolerance || 300, // Default 3%
      maxPriceImpact: body.maxPriceImpact,
      preferredBridges: body.preferredBridges,
      excludeBridges: body.excludeBridges
    };

    // Get routes
    console.log('Finding routes for test request:', swapRequest);
    const routes = await router.getRoutes(swapRequest);

    // Format response
    const formattedRoutes = routes.map(route => ({
      id: route.id,
      estimatedOutput: route.estimatedOutput,
      totalFeeUSD: route.totalFeeUSD,
      totalGasCostUSD: route.totalGasCostUSD,
      estimatedTime: route.estimatedTime,
      priceImpact: route.priceImpact,
      reliability: route.reliability,
      numberOfSteps: route.steps.length,
      steps: route.steps.map(step => ({
        type: step.type,
        chainId: step.chainId,
        protocol: step.protocol,
        fromToken: {
          address: step.fromToken.address,
          symbol: step.fromToken.symbol,
          name: step.fromToken.name,
          decimals: step.fromToken.decimals
        },
        toToken: {
          address: step.toToken.address,
          symbol: step.toToken.symbol,
          name: step.toToken.name,
          decimals: step.toToken.decimals
        },
        fromAmount: step.fromAmount,
        estimatedToAmount: step.estimatedToAmount,
        gasCost: step.gasCost
      }))
    }));

    return res.status(200).json({
      success: true,
      testMode: true,
      routes: formattedRoutes,
      bestRoute: formattedRoutes[0], // Best route is first
      serviceInfo: router.getServiceInfo(),
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Cross-chain test route error:', error);
    
    return res.status(500).json({
      success: false,
      testMode: true,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}