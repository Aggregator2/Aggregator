import { NextApiRequest, NextApiResponse } from 'next';
import { CrossChainRouter } from '../../../src/services/crossChainRouter';
import { TransactionRecord } from '../../../src/services/crossChainRouter/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { routeId, transactions } = req.body;

    // Validate required fields
    if (!routeId || !transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Missing routeId or transactions' });
    }

    // Validate transaction records
    for (const tx of transactions) {
      if (!tx.stepIndex || !tx.chainId || !tx.txHash) {
        return res.status(400).json({ error: 'Invalid transaction record format' });
      }
    }

    // Create router instance
    const router = new CrossChainRouter();

    // Check swap status
    const status = await router.checkSwapStatus(routeId, transactions);

    // Get detailed transaction status for each transaction
    const detailedTransactions = await Promise.all(
      transactions.map(async (tx: TransactionRecord) => {
        try {
          // Get chain config to determine explorer URL
          const chainConfig = router['tokenService'].getChainConfig(tx.chainId);
          
          return {
            ...tx,
            explorerUrl: `${chainConfig.blockExplorer}/tx/${tx.txHash}`,
            chainName: chainConfig.name
          };
        } catch (error) {
          return {
            ...tx,
            error: 'Could not get chain info'
          };
        }
      })
    );

    return res.status(200).json({
      success: true,
      status: status.status,
      currentStep: status.currentStep,
      completedSteps: status.completedSteps,
      totalSteps: transactions.length,
      error: status.error,
      transactions: detailedTransactions,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Status check error:', error);
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}