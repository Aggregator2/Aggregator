import { Token, TokenType } from '../types/token';
import { logger } from '../utils/logger';
import { lifiService, LifiToken } from './lifiService';
import { getMockTokens } from './mockTokenService';
import { 
  FALLBACK_TOKENS, 
  LiFiTokenInfo, 
  mergeLiFiWithFallback,
  getFallbackTokensForChain,
  isTokenBlacklisted 
} from '../config/tokenRegistry';

// Removed external token sources that return 404 errors
// LiFi is now the primary source with local fallbacks

// LiFi service handles its own caching internally

export class TokenAggregator {
  private static instance: TokenAggregator;
  private allTokens: Token[] = [];
  private tokensByChain: Record<number, Token[]> = {};
  private lastUpdate: number = 0;
  private isLoading: boolean = false;
  private loadingPromise: Promise<void> | null = null;

  static getInstance(): TokenAggregator {
    if (!TokenAggregator.instance) {
      TokenAggregator.instance = new TokenAggregator();
    }
    return TokenAggregator.instance;
  }

  // Removed fetchTokenList - no longer using external URLs

  // Removed parseTokenList - no longer parsing external token lists

  // Removed parseToken - no longer parsing external token data

  // Removed inferChainId - no longer needed

  getTokenType(chainId: number, tokenData: any): TokenType {
    // Determine token standard based on chain
    switch (chainId) {
      case 1: // Ethereum
      case 42161: // Arbitrum
      case 10: // Optimism
        return (tokenData.type as TokenType) || 'ERC-20';
      case 56: // BSC
        return 'BEP-20';
      case 137: // Polygon
        return 'ERC-20';
      case 101: // Solana
        return 'SPL';
      case 43114: // Avalanche
        return 'ERC-20';
      case 250: // Fantom
        return 'ERC-20';
      case 1001: // Tron
        return 'TRC-20';
      default:
        return 'ERC-20';
    }
  }

  convertLifiToken(lifiToken: LifiToken): Token {
    return {
      symbol: lifiToken.symbol.toUpperCase(),
      name: lifiToken.name,
      address: lifiToken.address,
      chainId: lifiToken.chainId,
      type: this.getTokenType(lifiToken.chainId, {}),
      decimals: lifiToken.decimals,
      logoURI: lifiToken.logoURI,
      tags: ['lifi'],
      extensions: {
        source: 'lifi',
        verified: true,
        priceUSD: lifiToken.priceUSD
      }
    };
  }

  async loadTokensFromLifi(): Promise<Token[]> {
    try {
      logger.info('Loading tokens from LiFi...');
      const startTime = Date.now();

      // Get all tokens from LiFi
      const lifiTokensMap = await lifiService.getAllTokens();
      const tokens: Token[] = [];

      // Convert LiFi tokens to our format and merge with fallbacks
      for (const [chainId, lifiTokens] of lifiTokensMap.entries()) {
        // Convert LiFi tokens
        const convertedLifiTokens = lifiTokens.map(token => this.convertLifiToken(token));
        
        // Merge with fallback tokens for this chain
        const fallbackTokens = getFallbackTokensForChain(chainId)
          .map(token => this.convertLiFiTokenInfoToToken(token));
        
        const mergedTokens = this.mergeTokenLists([convertedLifiTokens, fallbackTokens]);
        tokens.push(...mergedTokens);
      }

      // If no tokens loaded, add all fallback tokens
      if (tokens.length === 0) {
        logger.warn('No LiFi tokens loaded, using all fallback tokens');
        const allFallbackTokens = FALLBACK_TOKENS.map(token => 
          this.convertLiFiTokenInfoToToken(token)
        );
        tokens.push(...allFallbackTokens);
      }

      const loadTime = Date.now() - startTime;
      logger.info(`Loaded ${tokens.length} tokens from LiFi + fallbacks in ${loadTime}ms`);
      
      return tokens;
    } catch (error) {
      logger.error('Failed to load tokens from LiFi:', error);
      throw error; // Re-throw to trigger fallback in performTokenLoad
    }
  }

  async loadAllTokens(): Promise<void> {
    // Prevent concurrent loading
    if (this.isLoading) {
      if (this.loadingPromise) {
        return this.loadingPromise;
      }
      return;
    }

    this.isLoading = true;
    
    this.loadingPromise = this.performTokenLoad();
    
    try {
      await this.loadingPromise;
    } finally {
      this.isLoading = false;
      this.loadingPromise = null;
    }
  }

  private async performTokenLoad(): Promise<void> {
    logger.info('Starting LiFi-primary token loading...');
    
    const startTime = Date.now();
    let allTokens: Token[] = [];

    try {
      // Primary source: LiFi service
      allTokens = await this.loadTokensFromLifi();
      logger.info(`Loaded ${allTokens.length} tokens from LiFi`);
      
      // If LiFi returned insufficient tokens, add fallbacks
      if (allTokens.length < 50) {
        logger.warn('LiFi returned few tokens, adding fallback tokens');
        const fallbackTokens = this.getDefaultTokens();
        allTokens = this.mergeTokenLists([allTokens, fallbackTokens]);
      }

    } catch (error) {
      logger.error('LiFi failed, trying mock tokens and fallbacks:', error);
      
      try {
        // Try mock tokens first (quick workaround)
        const mockTokenData = await getMockTokens();
        const mockTokens = mockTokenData.ethereum.map(token => this.convertMockTokenToToken(token));
        
        // Also add local fallback tokens
        const fallbackTokens = this.getDefaultTokens();
        allTokens = this.mergeTokenLists([mockTokens, fallbackTokens]);
        
        logger.info(`Using ${mockTokens.length} mock tokens + ${fallbackTokens.length} fallback tokens`);
      } catch (mockError) {
        logger.error('Mock tokens also failed, using only fallback tokens:', mockError);
        
        // Final fallback to local token registry
        allTokens = this.getDefaultTokens();
        logger.info(`Using ${allTokens.length} fallback tokens only`);
      }
    }

    if (allTokens.length === 0) {
      logger.error('No tokens available from any source');
      return;
    }

    // Filter out blacklisted tokens
    const filteredTokens = allTokens.filter(token => 
      !isTokenBlacklisted(token.address, token.chainId)
    );
    
    // Deduplicate tokens
    const uniqueTokens = this.deduplicateTokens(filteredTokens);
    
    // Sort by chain and popularity
    uniqueTokens.sort((a, b) => {
      if (a.chainId !== b.chainId) {
        return a.chainId - b.chainId;
      }
      return a.symbol.localeCompare(b.symbol);
    });

    this.allTokens = uniqueTokens;
    this.tokensByChain = this.groupTokensByChain(uniqueTokens);
    this.lastUpdate = Date.now();

    const loadTime = Date.now() - startTime;
    logger.info(`Loaded ${uniqueTokens.length} unique tokens in ${loadTime}ms`);
    
    // Log breakdown by chain
    for (const [chainId, tokens] of Object.entries(this.tokensByChain)) {
      logger.info(`Chain ${chainId}: ${tokens.length} tokens`);
    }
  }

  // Convert mock token to our Token format
  convertMockTokenToToken(mockToken: any): Token {
    return {
      symbol: mockToken.symbol.toUpperCase(),
      name: mockToken.name,
      address: mockToken.address,
      chainId: mockToken.chainId,
      type: this.getTokenType(mockToken.chainId, {}),
      decimals: mockToken.decimals,
      logoURI: mockToken.logoURI,
      tags: ['mock'],
      extensions: {
        source: 'mock',
        verified: true
      }
    };
  }

  // Convert LiFiTokenInfo to our Token format
  convertLiFiTokenInfoToToken(lifiToken: LiFiTokenInfo): Token {
    return {
      symbol: lifiToken.symbol.toUpperCase(),
      name: lifiToken.name,
      address: lifiToken.address,
      chainId: lifiToken.chainId,
      type: this.getTokenType(lifiToken.chainId, {}),
      decimals: lifiToken.decimals,
      logoURI: lifiToken.logoURI,
      tags: lifiToken.tags || ['fallback'],
      extensions: {
        source: 'fallback',
        verified: true,
        coinGeckoId: lifiToken.coinGeckoId,
        priceUSD: lifiToken.priceUSD
      }
    };
  }

  // Get default tokens from local registry
  getDefaultTokens(): Token[] {
    return FALLBACK_TOKENS.map(token => this.convertLiFiTokenInfoToToken(token));
  }

  // Merge multiple token lists, removing duplicates
  mergeTokenLists(tokenLists: Token[][]): Token[] {
    const allTokens: Token[] = [];
    tokenLists.forEach(list => allTokens.push(...list));
    return this.deduplicateTokens(allTokens);
  }

  // Removed platformToChainId - no longer using CoinGecko

  deduplicateTokens(tokens: Token[]): Token[] {
    const seen = new Set<string>();
    const unique: Token[] = [];

    for (const token of tokens) {
      const key = `${token.chainId}-${token.address.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(token);
      }
    }

    return unique;
  }

  groupTokensByChain(tokens: Token[]): Record<number, Token[]> {
    const grouped: Record<number, Token[]> = {};

    for (const token of tokens) {
      if (!grouped[token.chainId]) {
        grouped[token.chainId] = [];
      }
      grouped[token.chainId].push(token);
    }

    return grouped;
  }

  getAllTokens(): Token[] {
    try {
      return this.allTokens || [];
    } catch (error) {
      console.error('Error getting all tokens:', error);
      return [];
    }
  }

  getTokensByChain(chainId: number): Token[] {
    try {
      if (!chainId || !this.tokensByChain) return [];
      return this.tokensByChain[chainId] || [];
    } catch (error) {
      console.error(`Error getting tokens for chain ${chainId}:`, error);
      return [];
    }
  }

  searchTokens(query: string, chainId?: number): Token[] {
    try {
      const tokens = chainId ? this.getTokensByChain(chainId) : this.getAllTokens();
      
      if (!query || typeof query !== 'string') {
        return tokens.slice(0, 100);
      }

      const lowerQuery = query.toLowerCase().trim();
      if (lowerQuery.length === 0) {
        return tokens.slice(0, 100);
      }

      const results = tokens.filter(token => {
        try {
          const symbolMatch = token.symbol && token.symbol.toLowerCase().includes(lowerQuery);
          const nameMatch = token.name && token.name.toLowerCase().includes(lowerQuery);
          const addressMatch = token.address && token.address.toLowerCase().includes(lowerQuery);
          
          return symbolMatch || nameMatch || addressMatch;
        } catch (filterError) {
          return false;
        }
      });

      return results.sort((a, b) => {
        try {
          const aSymbol = a.symbol ? a.symbol.toLowerCase() : '';
          const bSymbol = b.symbol ? b.symbol.toLowerCase() : '';
          
          // Exact matches first
          if (aSymbol === lowerQuery && bSymbol !== lowerQuery) return -1;
          if (bSymbol === lowerQuery && aSymbol !== lowerQuery) return 1;
          
          // Starts with query
          if (aSymbol.startsWith(lowerQuery) && !bSymbol.startsWith(lowerQuery)) return -1;
          if (bSymbol.startsWith(lowerQuery) && !aSymbol.startsWith(lowerQuery)) return 1;
          
          // Market cap rank (if available)
          const aRank = a.extensions?.rank || Infinity;
          const bRank = b.extensions?.rank || Infinity;
          if (aRank !== bRank) return aRank - bRank;
          
          return aSymbol.localeCompare(bSymbol);
        } catch (sortError) {
          return 0;
        }
      });
    } catch (error) {
      console.error('Error searching tokens:', error);
      return [];
    }
  }

  getStats(): { total: number; byChain: Record<number, number>; lastUpdate: number } {
    try {
      const byChain: Record<number, number> = {};
      
      if (this.tokensByChain) {
        for (const [chainId, tokens] of Object.entries(this.tokensByChain)) {
          if (tokens && Array.isArray(tokens)) {
            byChain[parseInt(chainId)] = tokens.length;
          }
        }
      }

      return {
        total: this.allTokens ? this.allTokens.length : 0,
        byChain,
        lastUpdate: this.lastUpdate || 0
      };
    } catch (error) {
      console.error('Error getting token stats:', error);
      return {
        total: 0,
        byChain: {},
        lastUpdate: 0
      };
    }
  }

  async refreshTokens(): Promise<void> {
    // Clear existing data to prevent conflicts
    this.allTokens = [];
    this.tokensByChain = {};
    this.lastUpdate = 0;
    
    // Force a fresh load
    await this.loadAllTokens();
  }
}

// Export singleton instance
export const tokenAggregator = TokenAggregator.getInstance();