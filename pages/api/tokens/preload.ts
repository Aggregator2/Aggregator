import type { NextApiRequest, NextApiResponse } from 'next';
import { tokenLoader } from '../../../src/services/tokenLoader';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { refresh = false } = req.body;

    if (refresh) {
      await tokenLoader.refreshTokens();
    }

    const stats = tokenLoader.getStats();

    return res.status(200).json({
      success: true,
      message: 'Tokens preloaded successfully',
      stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Token preload error:', error);
    
    return res.status(500).json({
      error: 'Failed to preload tokens',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}