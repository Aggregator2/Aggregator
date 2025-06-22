import type { NextApiRequest, NextApiResponse } from 'next';
import { getCrossChainRevenueTracker } from '../../../src/services/crossChainRevenueTracker';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const tracker = getCrossChainRevenueTracker();

    if (req.method === 'GET') {
      // Get cross-chain revenue breakdown
      const [revenueByChain, collectionStrategy] = await Promise.all([
        tracker.getRevenueByChain(),
        tracker.getCollectionStrategy()
      ]);

      // Calculate totals
      const totalRevenueUSD = revenueByChain.reduce((sum, chain) => sum + chain.totalRevenueUSD, 0);
      const totalFees = revenueByChain.reduce((sum, chain) => sum + chain.feeCount, 0);

      // Format response
      const response = {
        summary: {
          totalRevenueUSD: totalRevenueUSD.toFixed(2),
          totalFees,
          activeChains: revenueByChain.length,
          timestamp: new Date().toISOString()
        },
        
        chainBreakdown: revenueByChain.map(chain => ({
          chainId: chain.chainId,
          chainName: chain.chainName,
          revenue: {
            usd: chain.totalRevenueUSD.toFixed(2),
            feeCount: chain.feeCount
          },
          tokens: Object.entries(chain.tokenBreakdown).map(([token, data]) => ({
            token,
            symbol: data.symbol,
            amount: data.amount,
            valueUSD: data.valueUSD.toFixed(2),
            transactions: data.count
          })),
          gasOptimization: chain.gasEstimate
        })),
        
        collectionStrategy: {
          readyForCollection: collectionStrategy.immediateCollection,
          pendingBatch: collectionStrategy.batchCollection,
          recommendations: collectionStrategy.recommendations
        },
        
        // L2 specific optimizations
        l2Optimization: {
          polygon: {
            avgGasCostUSD: 0.01,
            rebateDistributionEnabled: true,
            batchSize: 100
          },
          arbitrum: {
            avgGasCostUSD: 0.05,
            rebateDistributionEnabled: true,
            batchSize: 50
          },
          optimism: {
            avgGasCostUSD: 0.03,
            rebateDistributionEnabled: true,
            batchSize: 75
          }
        }
      };

      return res.status(200).json(response);
    }

    if (req.method === 'POST') {
      const { action, chainId, params } = req.body;

      // Verify admin authorization
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      switch (action) {
        case 'trackFee':
          // Manually track a fee (for testing)
          await tracker.trackFeeCollection({
            chainId: params.chainId,
            feeAmount: params.feeAmount,
            feeToken: params.feeToken,
            tokenSymbol: params.tokenSymbol,
            tokenUsdPrice: params.tokenUsdPrice,
            transactionHash: params.transactionHash,
            userAddress: params.userAddress
          });
          
          return res.status(200).json({
            success: true,
            message: 'Fee tracked successfully'
          });

        case 'distributeRebates':
          // Distribute rebates on L2
          if (!params.recipients || !Array.isArray(params.recipients)) {
            return res.status(400).json({ error: 'Invalid recipients' });
          }

          const result = await tracker.distributeRebatesOnL2({
            chainId,
            recipients: params.recipients,
            dryRun: params.dryRun || false
          });

          return res.status(200).json({
            success: result.success,
            result
          });

        default:
          return res.status(400).json({ error: 'Invalid action' });
      }
    }
  } catch (error: any) {
    console.error('Cross-chain revenue status error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}