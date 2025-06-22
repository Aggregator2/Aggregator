import { NextApiRequest, NextApiResponse } from 'next';

// Mock revenue state for testing
let mockRevenueState = {
  totalRevenueUSD: 0,
  collectedFees: [],
  lastTransferTimestamp: 0
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // In production, this would use the actual RevenueAccumulator service
    // For testing, we'll use mock data
    
    const status = {
      ...mockRevenueState,
      transferThreshold: 50, // $50 USD
      revenueWallet: process.env.REVENUE_WALLET || '0xYourRevenueWalletHere',
      configured: !!process.env.REVENUE_WALLET && !!process.env.REVENUE_PRIVATE_KEY
    };
    
    console.log('[Revenue Status]', {
      totalUSD: status.totalRevenueUSD,
      feeCount: status.collectedFees.length,
      threshold: status.transferThreshold,
      wallet: status.revenueWallet
    });
    
    return res.status(200).json(status);
  } catch (error) {
    console.error('[Revenue Status Error]', error);
    return res.status(500).json({ 
      error: 'Failed to get revenue status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Helper function to simulate revenue accumulation (for testing)
export function addMockRevenue(amount: number, token: string = 'ETH') {
  mockRevenueState.collectedFees.push({
    feeAmount: amount.toString(),
    feeToken: token,
    tokenUsdPrice: token === 'ETH' ? 2000 : 1,
    timestamp: Date.now(),
    chainId: 1
  });
  
  const feeUSD = amount * (token === 'ETH' ? 2000 : 1);
  mockRevenueState.totalRevenueUSD += feeUSD;
  
  // Simulate transfer if threshold reached
  if (mockRevenueState.totalRevenueUSD >= 50 && mockRevenueState.lastTransferTimestamp === 0) {
    console.log('[Mock Revenue] Threshold reached! Would transfer to revenue wallet.');
    console.log(`[Mock Revenue] Transferring $${mockRevenueState.totalRevenueUSD.toFixed(2)} to ${process.env.REVENUE_WALLET || '0xYourRevenueWalletHere'}`);
    mockRevenueState.lastTransferTimestamp = Date.now();
    // Reset after "transfer"
    mockRevenueState.totalRevenueUSD = 0;
    mockRevenueState.collectedFees = [];
  }
}