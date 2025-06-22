import { NextApiRequest, NextApiResponse } from 'next';
import { unifiedSwapService } from '../../../src/services/unifiedSwapService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { chainId } = req.query;
  
  if (!chainId || typeof chainId !== 'string') {
    return res.status(400).json({ error: 'Chain ID is required' });
  }

  const chainIdNum = parseInt(chainId, 10);
  
  if (isNaN(chainIdNum)) {
    return res.status(400).json({ error: 'Invalid chain ID' });
  }

  try {
    const tokens = await unifiedSwapService.getTokensForChain(chainIdNum);
    
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({
      success: true,
      chainId: chainIdNum,
      tokens,
      count: tokens.length
    });
  } catch (error) {
    console.error(`Error fetching tokens for chain ${chainIdNum}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tokens',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}