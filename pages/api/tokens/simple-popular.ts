import type { NextApiRequest, NextApiResponse } from 'next';
import { getAllPopularTokens } from '../../../src/config/tokens/popularTokens';
import { SUPPORTED_CHAINS } from '../../../src/types/token';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { chainId, limit } = req.query;
    
    const chainIdNum = chainId ? parseInt(chainId as string) : undefined;
    const limitNum = limit ? parseInt(limit as string) : 1000; // Return all tokens by default

    // Get all popular tokens
    let tokens = getAllPopularTokens();

    // Filter by chain if specified
    if (chainIdNum) {
      tokens = tokens.filter(token => token.chainId === chainIdNum);
    }

    // Sort by priority (if available) or just take first ones
    tokens = tokens.sort((a, b) => {
      const aPriority = a.extensions?.priority || 0;
      const bPriority = b.extensions?.priority || 0;
      return bPriority - aPriority;
    });

    // Limit results
    tokens = tokens.slice(0, limitNum);

    return res.status(200).json({
      tokens,
      total: tokens.length,
      chainId: chainIdNum
    });
  } catch (error) {
    console.error('Error fetching popular tokens:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}