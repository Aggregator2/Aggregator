import type { NextApiRequest, NextApiResponse } from 'next';
import { getAllPopularTokens, searchPopularTokens } from '../../../src/config/tokens/popularTokens';
import { SUPPORTED_CHAINS } from '../../../src/types/token';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { q, chainId, limit } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const limitNum = limit ? Math.min(parseInt(limit as string), 200) : 50;
    const chainIdNum = chainId ? parseInt(chainId as string) : undefined;

    // Search popular tokens
    let results = searchPopularTokens(q);

    // Filter by chain if specified
    if (chainIdNum) {
      results = results.filter(token => token.chainId === chainIdNum);
    }

    // Limit results
    results = results.slice(0, limitNum);

    return res.status(200).json({
      query: q,
      results,
      total: results.length
    });
  } catch (error) {
    console.error('Error in simple token search:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}