import type { NextApiRequest, NextApiResponse } from 'next';
import { tokenService } from '../../../src/services/blockchain/tokenService';
import { SUPPORTED_CHAINS } from '../../../src/types/token';
import { logger } from '../../../src/utils/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { chainId, limit } = req.query;
    
    if (chainId) {
      const chainIdNum = parseInt(chainId as string);
      
      if (!SUPPORTED_CHAINS[chainIdNum]) {
        return res.status(400).json({ error: 'Unsupported chain ID' });
      }
      
      const limitNum = limit ? parseInt(limit as string) : 20;
      const tokens = await tokenService.getPopularTokens(chainIdNum, limitNum);
      
      return res.status(200).json({
        chainId: chainIdNum,
        chainName: SUPPORTED_CHAINS[chainIdNum].name,
        tokens,
        count: tokens.length
      });
    }

    // Return popular tokens for all chains
    const allPopularTokens: Record<number, any> = {};
    
    for (const [chainIdStr, chainConfig] of Object.entries(SUPPORTED_CHAINS)) {
      const chainIdNum = parseInt(chainIdStr);
      const limitNum = limit ? parseInt(limit as string) : 10;
      
      try {
        const tokens = await tokenService.getPopularTokens(chainIdNum, limitNum);
        allPopularTokens[chainIdNum] = {
          chainName: chainConfig.name,
          tokens,
          count: tokens.length
        };
      } catch (error) {
        logger.warn(`Failed to fetch tokens for chain ${chainIdNum}:`, error);
        allPopularTokens[chainIdNum] = {
          chainName: chainConfig.name,
          tokens: [],
          count: 0,
          error: 'Failed to fetch tokens'
        };
      }
    }

    return res.status(200).json(allPopularTokens);
  } catch (error) {
    logger.error('Error fetching popular tokens:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}