import type { NextApiRequest, NextApiResponse } from 'next';
import { tokenListManager } from '../../../src/services/tokenListManager';
import { SUPPORTED_CHAINS } from '../../../src/types/token';
import { logger } from '../../../src/utils/logger';
import { nonceService } from '../../../src/services/nonceService';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { address, chainId, userAddress } = req.body;

    // Validation
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Token address is required' });
    }

    if (!chainId || typeof chainId !== 'number') {
      return res.status(400).json({ error: 'Chain ID is required' });
    }

    if (!SUPPORTED_CHAINS[chainId]) {
      return res.status(400).json({ error: 'Unsupported chain ID' });
    }

    // Rate limiting per user
    if (userAddress) {
      const rateLimitStatus = await nonceService.getRateLimitStatus(
        `token_import:${userAddress}`,
        10, // 10 imports per hour
        3600
      );

      if (!rateLimitStatus.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: rateLimitStatus.resetAt.toISOString()
        });
      }
    }

    // Attempt to auto-import the token
    const token = await tokenListManager.autoImportToken(address, chainId);

    if (!token) {
      return res.status(404).json({
        error: 'Token not found or invalid',
        details: 'Could not fetch token metadata from the blockchain'
      });
    }

    logger.info('Token auto-imported', {
      address,
      chainId,
      symbol: token.symbol,
      userAddress
    });

    res.status(200).json({
      success: true,
      token,
      message: 'Token imported successfully'
    });
  } catch (error: any) {
    logger.error('Token import error:', error);
    
    if (error.message.includes('Invalid address')) {
      return res.status(400).json({ error: 'Invalid token address format' });
    }
    
    if (error.message.includes('Rate limit')) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    res.status(500).json({ error: 'Failed to import token' });
  }
}