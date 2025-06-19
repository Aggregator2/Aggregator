import { Token } from '../../types/wallet';
import { coinGeckoService } from './coinGeckoService';
import { solanaTokenService } from './solanaTokenService';
import { tronTokenService } from './tronTokenService';

export interface TokenDiscoveryOptions {
  chains?: number[];
  includeTopTokens?: boolean;
  includeTrending?: boolean;
  maxTokensPerChain?: number;
  searchQuery?: string;
}

export interface TokenStats {
  total: number;
  byChain: Record<number, number>;
  bySource: Record<string, number>;
  lastUpdate: number;
}

class ComprehensiveTokenService {
  private tokenCache = new Map<string, Token[]>();
  private cacheTimeout = 15 * 60 * 1000; // 15 minutes
  private lastUpdate = new Map<string, number>();

  constructor() {}

  // Main method to discover tokens from all sources
  async discoverTokens(options: TokenDiscoveryOptions = {}): Promise<{
    tokens: Token[];
    stats: TokenStats;
    sources: string[];
  }> {
    const {
      chains = [1, 56, 137, 42161, 10, 43114, 250, 195, 101],
      includeTopTokens = true,
      includeTrending = true,
      maxTokensPerChain = 200,
      searchQuery
    } = options;

    console.log('Starting comprehensive token discovery...', { chains, includeTopTokens, includeTrending });

    const allTokens = new Map<string, Token>(); // Use Map to deduplicate
    const sources: string[] = [];
    const sourceStats: Record<string, number> = {};

    try {
      // 1. Get tokens from CoinGecko (most comprehensive)
      if (includeTopTokens) {
        console.log('Fetching tokens from CoinGecko...');
        try {
          const cgTokens = await coinGeckoService.getTokensList(true);
          let count = 0;
          
          for (const cgToken of cgTokens) {
            const convertedTokens = coinGeckoService.convertToTokenFormat(cgToken);
            
            for (const token of convertedTokens) {
              if (chains.includes(token.chainId)) {
                const key = `${token.chainId}-${token.address.toLowerCase()}`;
                if (!allTokens.has(key)) {
                  allTokens.set(key, token);
                  count++;
                }
              }
            }
          }
          
          sources.push('CoinGecko');
          sourceStats['CoinGecko'] = count;
          console.log(`Added ${count} tokens from CoinGecko`);
        } catch (error) {
          console.warn('CoinGecko tokens failed:', error);
        }
      }

      // 2. Get Solana tokens from Jupiter (if Solana is requested)
      if (chains.includes(101)) {
        console.log('Fetching Solana tokens from Jupiter...');
        try {
          const solanaTokens = await solanaTokenService.getComprehensiveTokenList();
          let count = 0;
          
          for (const token of solanaTokens.slice(0, maxTokensPerChain)) {
            const key = `${token.chainId}-${token.address.toLowerCase()}`;
            if (!allTokens.has(key)) {
              allTokens.set(key, token);
              count++;
            }
          }
          
          sources.push('Jupiter (Solana)');
          sourceStats['Jupiter'] = count;
          console.log(`Added ${count} Solana tokens from Jupiter`);
        } catch (error) {
          console.warn('Solana tokens failed:', error);
        }
      }

      // 3. Get Tron tokens from TronScan (if Tron is requested)
      if (chains.includes(195)) {
        console.log('Fetching Tron tokens from TronScan...');
        try {
          const tronTokens = await tronTokenService.getComprehensiveTokenList();
          let count = 0;
          
          for (const token of tronTokens.slice(0, maxTokensPerChain)) {
            const key = `${token.chainId}-${token.address.toLowerCase()}`;
            if (!allTokens.has(key)) {
              allTokens.set(key, token);
              count++;
            }
          }
          
          sources.push('TronScan');
          sourceStats['TronScan'] = count;
          console.log(`Added ${count} Tron tokens from TronScan`);
        } catch (error) {
          console.warn('Tron tokens failed:', error);
        }
      }

      // 4. Get trending tokens if requested
      if (includeTrending) {
        console.log('Fetching trending tokens...');
        try {
          const trendingTokens = await coinGeckoService.getTrendingTokens();
          let count = 0;
          
          for (const token of trendingTokens) {
            if (chains.includes(token.chainId)) {
              const key = `${token.chainId}-${token.address.toLowerCase()}`;
              if (!allTokens.has(key)) {
                allTokens.set(key, { ...token, tags: [...token.tags, 'trending'] });
                count++;
              } else {
                // Add trending tag to existing token
                const existingToken = allTokens.get(key)!;
                existingToken.tags = [...new Set([...existingToken.tags, 'trending'])];
              }
            }
          }
          
          sourceStats['Trending'] = count;
          console.log(`Added ${count} trending tokens`);
        } catch (error) {
          console.warn('Trending tokens failed:', error);
        }
      }

      // 5. Apply search filter if provided
      let finalTokens = Array.from(allTokens.values());
      
      if (searchQuery && searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        finalTokens = finalTokens.filter(token => 
          token.symbol.toLowerCase().includes(query) ||
          token.name.toLowerCase().includes(query) ||
          token.address.toLowerCase().includes(query)
        );
      }

      // 6. Sort tokens by relevance (verified first, then by market cap rank, then alphabetically)
      finalTokens.sort((a, b) => {
        // Verified tokens first
        const aVerified = a.extensions?.verified || false;
        const bVerified = b.extensions?.verified || false;
        if (aVerified !== bVerified) return bVerified ? 1 : -1;
        
        // Then by market cap rank (lower is better)
        const aRank = a.extensions?.marketCapRank || 999999;
        const bRank = b.extensions?.marketCapRank || 999999;
        if (aRank !== bRank) return aRank - bRank;
        
        // Then alphabetically by symbol
        return a.symbol.localeCompare(b.symbol);
      });

      // 7. Calculate stats
      const chainStats: Record<number, number> = {};
      for (const token of finalTokens) {
        chainStats[token.chainId] = (chainStats[token.chainId] || 0) + 1;
      }

      const stats: TokenStats = {
        total: finalTokens.length,
        byChain: chainStats,
        bySource: sourceStats,
        lastUpdate: Date.now()
      };

      console.log('Token discovery completed:', stats);

      return {
        tokens: finalTokens,
        stats,
        sources
      };

    } catch (error) {
      console.error('Comprehensive token discovery failed:', error);
      
      // Return empty result on total failure
      return {
        tokens: [],
        stats: {
          total: 0,
          byChain: {},
          bySource: {},
          lastUpdate: Date.now()
        },
        sources: []
      };
    }
  }

  // Search across all token sources
  async searchTokensAcrossSources(query: string, maxResults = 50): Promise<Token[]> {
    console.log(`Searching for tokens with query: "${query}"`);
    
    const allResults = new Map<string, Token>();
    
    try {
      // Search CoinGecko
      const cgSearch = await coinGeckoService.searchTokens(query);
      for (const coin of cgSearch.coins.slice(0, 20)) {
        const coinData = await coinGeckoService.getTokenById(coin.id);
        if (coinData) {
          const tokens = coinGeckoService.convertToTokenFormat(coinData);
          for (const token of tokens) {
            const key = `${token.chainId}-${token.address.toLowerCase()}`;
            allResults.set(key, token);
          }
        }
      }

      // Search Solana tokens
      const solanaResults = await solanaTokenService.searchTokens(query);
      for (const solanaToken of solanaResults.slice(0, 10)) {
        const token = solanaTokenService.convertJupiterToTokenFormat(solanaToken);
        const key = `${token.chainId}-${token.address.toLowerCase()}`;
        allResults.set(key, token);
      }

      // Search Tron tokens
      const tronResults = await tronTokenService.searchTokens(query, 10);
      for (const tronToken of tronResults) {
        const token = tronTokenService.convertToTokenFormat(tronToken);
        const key = `${token.chainId}-${token.address.toLowerCase()}`;
        allResults.set(key, token);
      }

      const results = Array.from(allResults.values()).slice(0, maxResults);
      console.log(`Found ${results.length} tokens matching "${query}"`);
      
      return results;
    } catch (error) {
      console.error('Cross-source token search failed:', error);
      return [];
    }
  }

  // Get popular tokens for each chain
  async getPopularTokensByChain(chainId: number, limit = 50): Promise<Token[]> {
    const cacheKey = `popular_${chainId}_${limit}`;
    
    try {
      // Check cache
      if (this.tokenCache.has(cacheKey)) {
        const lastUpdate = this.lastUpdate.get(cacheKey) || 0;
        if (Date.now() - lastUpdate < this.cacheTimeout) {
          return this.tokenCache.get(cacheKey)!;
        }
      }

      let tokens: Token[] = [];

      switch (chainId) {
        case 101: // Solana
          const solanaTokens = await solanaTokenService.getPopularTokens(limit);
          tokens = solanaTokens.map(t => solanaTokenService.convertJupiterToTokenFormat(t));
          break;
          
        case 195: // Tron
          const tronTokens = await tronTokenService.getPopularTokens(limit);
          tokens = tronTokens.map(t => tronTokenService.convertToTokenFormat(t));
          break;
          
        default: // Other chains via CoinGecko
          const cgTokens = await coinGeckoService.getTopTokensByMarketCap(100);
          tokens = cgTokens.filter(t => t.chainId === chainId).slice(0, limit);
          break;
      }

      // Cache results
      this.tokenCache.set(cacheKey, tokens);
      this.lastUpdate.set(cacheKey, Date.now());

      return tokens;
    } catch (error) {
      console.error(`Failed to get popular tokens for chain ${chainId}:`, error);
      return [];
    }
  }

  // Validate token address for any chain
  validateTokenAddress(address: string, chainId: number): boolean {
    switch (chainId) {
      case 101: // Solana
        return solanaTokenService.isValidSolanaAddress(address);
      case 195: // Tron
        return tronTokenService.isValidTronAddress(address);
      default: // EVM chains
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    }
  }

  // Get token details from any source
  async getTokenDetails(address: string, chainId: number): Promise<Token | null> {
    try {
      switch (chainId) {
        case 101: // Solana
          const solanaMetadata = await solanaTokenService.getMetaplexMetadata(address);
          if (solanaMetadata) {
            return {
              symbol: solanaMetadata.symbol,
              name: solanaMetadata.name,
              address: solanaMetadata.mint,
              chainId: 101,
              type: 'SPL',
              decimals: 9, // Default for Solana
              logoURI: solanaMetadata.image,
              tags: ['solana', 'metaplex'],
              extensions: {
                description: solanaMetadata.description,
                metaplexUri: solanaMetadata.uri,
                creators: solanaMetadata.creators
              }
            };
          }
          break;
          
        case 195: // Tron
          const tronDetails = await tronTokenService.getTokenDetails(address);
          if (tronDetails) {
            return tronTokenService.convertToTokenFormat(tronDetails);
          }
          break;
          
        default: // Other chains
          // Try to find via CoinGecko platform address
          const cgTokens = await coinGeckoService.getTokensList(false);
          for (const cgToken of cgTokens) {
            const tokens = coinGeckoService.convertToTokenFormat(cgToken);
            const match = tokens.find(t => 
              t.chainId === chainId && 
              t.address.toLowerCase() === address.toLowerCase()
            );
            if (match) return match;
          }
          break;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get token details:', error);
      return null;
    }
  }

  // Clear cache
  clearCache(): void {
    this.tokenCache.clear();
    this.lastUpdate.clear();
  }
}

export const comprehensiveTokenService = new ComprehensiveTokenService();