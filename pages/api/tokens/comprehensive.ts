import type { NextApiRequest, NextApiResponse } from 'next';
import { tokenAggregator } from '../../../src/services/tokenAggregator';
import { SUPPORTED_CHAINS } from '../../../src/types/token';

// Background token loading flag
let isLoading = false;
let loadingPromise: Promise<void> | null = null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      chainId, 
      search, 
      limit = '100', 
      offset = '0',
      refresh = 'false' 
    } = req.query;

    const limitNum = Math.min(parseInt(limit as string), 1000);
    const offsetNum = parseInt(offset as string);
    const shouldRefresh = refresh === 'true';

    // Start loading tokens in background if not already loaded or refresh requested
    if (shouldRefresh || (!isLoading && tokenAggregator.getStats().total === 0)) {
      if (!loadingPromise) {
        isLoading = true;
        loadingPromise = tokenAggregator.loadAllTokens().finally(() => {
          isLoading = false;
          loadingPromise = null;
        });
      }
    }

    // If first time and still loading, wait for initial load
    if (isLoading && tokenAggregator.getStats().total === 0) {
      await loadingPromise;
    }

    let tokens;
    const chainIdNum = chainId ? parseInt(chainId as string) : undefined;

    if (search && typeof search === 'string') {
      // Search tokens
      tokens = tokenAggregator.searchTokens(search, chainIdNum);
    } else if (chainIdNum) {
      // Get tokens for specific chain
      tokens = tokenAggregator.getTokensByChain(chainIdNum);
    } else {
      // Get all tokens
      tokens = tokenAggregator.getAllTokens();
    }

    // Apply pagination
    const paginatedTokens = tokens.slice(offsetNum, offsetNum + limitNum);

    // Get statistics
    const stats = tokenAggregator.getStats();

    // Response with comprehensive data
    const response = {
      tokens: paginatedTokens,
      pagination: {
        total: tokens.length,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < tokens.length
      },
      stats,
      metadata: {
        query: search || null,
        chainId: chainIdNum || null,
        supportedChains: Object.keys(SUPPORTED_CHAINS).map(Number),
        isLoading,
        lastUpdate: stats.lastUpdate,
        cacheStatus: stats.lastUpdate > 0 ? 'cached' : 'fresh'
      }
    };

    // Set appropriate cache headers
    if (!shouldRefresh && stats.lastUpdate > 0) {
      res.setHeader('Cache-Control', 'public, max-age=1800'); // 30 minutes
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error in comprehensive tokens API:', error);
    
    // Try to return basic fallback data
    try {
      const stats = tokenAggregator.getStats();
      return res.status(500).json({
        error: 'Failed to load comprehensive token data',
        tokens: [],
        stats,
        metadata: {
          isLoading,
          hasError: true,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    } catch (fallbackError) {
      return res.status(500).json({
        error: 'Token service unavailable',
        tokens: []
      });
    }
  }
}