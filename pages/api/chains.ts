import { NextApiRequest, NextApiResponse } from 'next';
import { unifiedSwapService } from '../../src/services/unifiedSwapService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const chains = await unifiedSwapService.getChains();
    
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({
      success: true,
      chains,
      count: chains.length
    });
  } catch (error) {
    console.error('Error fetching chains:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chains',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}