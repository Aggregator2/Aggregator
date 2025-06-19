import type { NextApiRequest, NextApiResponse } from 'next';
import { tokenListManager } from '../../../src/services/tokenListManager';
import { searchPopularTokens } from '../../../src/config/tokens/popularTokens';
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
    const { 
      q, 
      chainId, 
      limit, 
      includeUnverified, 
      minPriority,
      tokenType,
      sortBy 
    } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    if (q.length < 1) {
      return res.status(400).json({ error: 'Query must be at least 1 character' });
    }

    const limitNum = limit ? Math.min(parseInt(limit as string), 200) : 50;
    const chainIdNum = chainId ? parseInt(chainId as string) : undefined;
    const minPriorityNum = minPriority ? parseInt(minPriority as string) : 0;

    if (chainIdNum && !SUPPORTED_CHAINS[chainIdNum]) {
      return res.status(400).json({ error: 'Unsupported chain ID' });
    }

    // Search from token list manager (comprehensive)
    const tokenListResults = await tokenListManager.searchTokens(q, chainIdNum);
    
    // Search popular tokens (fast fallback)
    const popularResults = searchPopularTokens(q);
    
    // Combine and deduplicate
    const allResults = [...popularResults, ...tokenListResults];
    const uniqueResults = allResults.filter((token, index, self) => 
      index === self.findIndex(t => 
        t.address.toLowerCase() === token.address.toLowerCase() && 
        t.chainId === token.chainId
      )
    );

    // Apply filters
    let filteredResults = uniqueResults;

    // Filter by chain
    if (chainIdNum) {
      filteredResults = filteredResults.filter(token => token.chainId === chainIdNum);
    }

    // Filter by token type
    if (tokenType && typeof tokenType === 'string') {
      filteredResults = filteredResults.filter(token => token.type === tokenType);
    }

    // Filter by priority
    if (minPriorityNum > 0) {
      filteredResults = filteredResults.filter(token => 
        (token.extensions?.priority || 0) >= minPriorityNum
      );
    }

    // Filter by verification status
    if (includeUnverified !== 'true') {
      filteredResults = filteredResults.filter(token => 
        token.extensions?.verified !== false
      );
    }

    // Sort results
    const sortedResults = filteredResults.sort((a, b) => {
      const aSymbol = a.symbol.toLowerCase();
      const bSymbol = b.symbol.toLowerCase();
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const query = q.toLowerCase();

      if (sortBy === 'priority') {
        return (b.extensions?.priority || 0) - (a.extensions?.priority || 0);
      }

      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }

      // Default: relevance sorting
      // Exact symbol match
      if (aSymbol === query && bSymbol !== query) return -1;
      if (bSymbol === query && aSymbol !== query) return 1;

      // Symbol starts with query
      if (aSymbol.startsWith(query) && !bSymbol.startsWith(query)) return -1;
      if (bSymbol.startsWith(query) && !aSymbol.startsWith(query)) return 1;

      // Name starts with query
      if (aName.startsWith(query) && !bName.startsWith(query)) return -1;
      if (bName.startsWith(query) && !aName.startsWith(query)) return 1;

      // Priority as tiebreaker
      const aPriority = a.extensions?.priority || 0;
      const bPriority = b.extensions?.priority || 0;
      if (aPriority !== bPriority) return bPriority - aPriority;

      // Alphabetical by symbol
      return aSymbol.localeCompare(bSymbol);
    });

    const limitedResults = sortedResults.slice(0, limitNum);

    // Group results by chain
    const resultsByChain: Record<number, any> = {};
    const resultsByType: Record<string, any> = {};
    
    limitedResults.forEach(token => {
      // By chain
      if (!resultsByChain[token.chainId]) {
        resultsByChain[token.chainId] = {
          chainName: SUPPORTED_CHAINS[token.chainId]?.name || 'Unknown',
          chainType: SUPPORTED_CHAINS[token.chainId]?.type || 'Unknown',
          tokens: []
        };
      }
      resultsByChain[token.chainId].tokens.push(token);

      // By token type
      if (!resultsByType[token.type]) {
        resultsByType[token.type] = {
          typeName: token.type,
          count: 0,
          tokens: []
        };
      }
      resultsByType[token.type].count++;
      resultsByType[token.type].tokens.push(token);
    });

    // Calculate search statistics
    const stats = {
      totalMatches: sortedResults.length,
      returnedResults: limitedResults.length,
      sourceBreakdown: limitedResults.reduce((acc, token) => {
        const source = token.extensions?.source || 'unknown';
        acc[source] = (acc[source] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      verificationStatus: {
        verified: limitedResults.filter(t => t.extensions?.verified === true).length,
        unverified: limitedResults.filter(t => t.extensions?.verified === false).length,
        unknown: limitedResults.filter(t => t.extensions?.verified === undefined).length
      },
      chainDistribution: Object.entries(resultsByChain).map(([chainId, data]) => ({
        chainId: parseInt(chainId),
        chainName: (data as any).chainName,
        count: (data as any).tokens.length
      }))
    };

    // Suggestions for common misspellings or similar tokens
    const suggestions = [];
    if (limitedResults.length === 0) {
      // Could implement fuzzy search here
      suggestions.push(
        'Try searching with fewer characters',
        'Check the spelling of the token symbol',
        'Try searching by token name instead of symbol'
      );
    }

    return res.status(200).json({
      query: q,
      filters: {
        chainId: chainIdNum,
        tokenType,
        minPriority: minPriorityNum,
        includeUnverified: includeUnverified === 'true',
        sortBy: sortBy || 'relevance'
      },
      results: limitedResults,
      resultsByChain,
      resultsByType,
      stats,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      pagination: {
        limit: limitNum,
        hasMore: sortedResults.length > limitNum,
        total: sortedResults.length
      }
    });
  } catch (error) {
    logger.error('Error in enhanced token search:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}