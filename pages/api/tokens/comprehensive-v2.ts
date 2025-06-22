import type { NextApiRequest, NextApiResponse } from 'next';
import { comprehensiveTokenService } from '../../../src/services/comprehensiveTokenService';

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
      includeTopTokens = 'true',
      includeTrending = 'true',
      source = 'all'
    } = req.query;

    const limitNum = Math.min(parseInt(limit as string), 500);
    const offsetNum = parseInt(offset as string);
    const chainIdNum = chainId ? parseInt(chainId as string) : undefined;
    const includeTop = includeTopTokens === 'true';
    const includeTrend = includeTrending === 'true';

    console.log('Comprehensive tokens API v2 request:', {
      chainId: chainIdNum,
      search,
      limit: limitNum,
      offset: offsetNum,
      includeTopTokens: includeTop,
      includeTrending: includeTrend,
      source
    });

    let result;

    if (search && typeof search === 'string') {
      // Search across all sources
      console.log(`Searching for: "${search}"`);
      const searchResults = await comprehensiveTokenService.searchTokensAcrossSources(
        search, 
        limitNum
      );
      
      // Filter by chain if specified
      const filteredResults = chainIdNum 
        ? searchResults.filter(token => token.chainId === chainIdNum)
        : searchResults;
        
      result = {
        tokens: filteredResults.slice(offsetNum, offsetNum + limitNum),
        stats: {
          total: filteredResults.length,
          searched: search,
          byChain: filteredResults.reduce((acc, token) => {
            acc[token.chainId] = (acc[token.chainId] || 0) + 1;
            return acc;
          }, {} as Record<number, number>),
          lastUpdate: Date.now()
        },
        sources: ['CoinGecko', 'Jupiter', 'TronScan']
      };
    } else if (chainIdNum) {
      // Get popular tokens for specific chain
      console.log(`Getting popular tokens for chain ${chainIdNum}`);
      const popularTokens = await comprehensiveTokenService.getPopularTokensByChain(
        chainIdNum, 
        limitNum + offsetNum
      );
      
      const paginatedTokens = popularTokens.slice(offsetNum, offsetNum + limitNum);
      
      result = {
        tokens: paginatedTokens,
        stats: {
          total: popularTokens.length,
          byChain: { [chainIdNum]: popularTokens.length },
          lastUpdate: Date.now()
        },
        sources: [`Chain-${chainIdNum}-specific`]
      };
    } else {
      // Get comprehensive token discovery with free price quotes
      console.log('Getting comprehensive token discovery with free price quotes');
      
      const chains = chainIdNum ? [chainIdNum] : undefined;
      const discoveryResult = await comprehensiveTokenService.discoverTokensWithPrices({
        chains,
        includeTopTokens: includeTop,
        includeTrending: includeTrend,
        maxTokensPerChain: 150
      });
      
      // Apply pagination
      const paginatedTokens = discoveryResult.tokens.slice(offsetNum, offsetNum + limitNum);
      
      result = {
        tokens: paginatedTokens,
        stats: {
          ...discoveryResult.stats,
          priceStats: discoveryResult.priceStats
        },
        sources: [...discoveryResult.sources, 'Free Quote APIs']
      };
    }

    const response = {
      tokens: result.tokens,
      pagination: {
        total: result.stats.total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < result.stats.total
      },
      stats: result.stats,
      metadata: {
        query: search || null,
        chainId: chainIdNum || null,
        includeTopTokens: includeTop,
        includeTrending: includeTrend,
        source,
        isLoading: false,
        lastUpdate: Date.now(),
        cacheStatus: 'live',
        version: 'v2-comprehensive',
        sources: result.sources,
        capabilities: [
          'multi-chain',
          'real-time-search',
          'trending-tokens',
          'verified-tokens',
          'free-price-quotes',
          'cross-source-aggregation',
          '0x-api-pricing',
          'jupiter-pricing',
          'paraswap-pricing'
        ]
      }
    };

    // Set cache headers based on request type
    if (search) {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes for search
    } else {
      res.setHeader('Cache-Control', 'public, max-age=600'); // 10 minutes for general lists
    }

    console.log(`Returning ${result.tokens.length} tokens from ${result.sources.length} sources`);
    
    return res.status(200).json(response);

  } catch (error) {
    console.error('Error in comprehensive tokens API v2:', error);
    
    return res.status(500).json({
      error: 'Failed to load comprehensive token data',
      details: error instanceof Error ? error.message : 'Unknown error',
      tokens: [],
      metadata: {
        version: 'v2-comprehensive',
        error: true,
        sources: []
      }
    });
  }
}