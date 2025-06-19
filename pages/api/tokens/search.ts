import type { NextApiRequest, NextApiResponse } from 'next';
import { tokenService } from '../../../src/services/blockchain/tokenService';
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
    const { q, chainId, limit } = req.query;
    
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    if (q.length < 1) {
      return res.status(400).json({ error: 'Query must be at least 1 character' });
    }

    const limitNum = limit ? Math.min(parseInt(limit as string), 100) : 50;
    
    let searchResults;

    if (chainId) {
      const chainIdNum = parseInt(chainId as string);
      
      if (!SUPPORTED_CHAINS[chainIdNum]) {
        return res.status(400).json({ error: 'Unsupported chain ID' });
      }
      
      // Search tokens for specific chain
      searchResults = await tokenService.searchTokens(q, chainIdNum);
    } else {
      // Search across all chains
      searchResults = await tokenService.searchTokens(q);
    }

    // Also search popular tokens for quick results
    const popularResults = searchPopularTokens(q);
    
    // Merge results and deduplicate
    const allResults = [...popularResults, ...searchResults];
    const uniqueResults = allResults.filter((token, index, self) => 
      index === self.findIndex(t => 
        t.address.toLowerCase() === token.address.toLowerCase() && 
        t.chainId === token.chainId
      )
    );

    // Sort by relevance (exact symbol match first, then starts with, then contains)
    const sortedResults = uniqueResults.sort((a, b) => {
      const aSymbol = a.symbol.toLowerCase();
      const bSymbol = b.symbol.toLowerCase();
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const query = q.toLowerCase();

      // Exact symbol match
      if (aSymbol === query && bSymbol !== query) return -1;
      if (bSymbol === query && aSymbol !== query) return 1;

      // Symbol starts with query
      if (aSymbol.startsWith(query) && !bSymbol.startsWith(query)) return -1;
      if (bSymbol.startsWith(query) && !aSymbol.startsWith(query)) return 1;

      // Name starts with query
      if (aName.startsWith(query) && !bName.startsWith(query)) return -1;
      if (bName.startsWith(query) && !aName.startsWith(query)) return 1;

      // Alphabetical by symbol
      return aSymbol.localeCompare(bSymbol);
    });

    const limitedResults = sortedResults.slice(0, limitNum);

    // Group results by chain for better presentation
    const resultsByChain: Record<number, any> = {};
    
    limitedResults.forEach(token => {
      if (!resultsByChain[token.chainId]) {
        resultsByChain[token.chainId] = {
          chainName: SUPPORTED_CHAINS[token.chainId]?.name || 'Unknown',
          tokens: []
        };
      }
      resultsByChain[token.chainId].tokens.push(token);
    });

    return res.status(200).json({
      query: q,
      chainId: chainId ? parseInt(chainId as string) : null,
      totalResults: limitedResults.length,
      maxResults: limitNum,
      results: limitedResults,
      resultsByChain
    });
  } catch (error) {
    logger.error('Error searching tokens:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}