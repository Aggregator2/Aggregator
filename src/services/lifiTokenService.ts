import { lifiService } from './lifiService';
import { Token } from '../types/token';

export interface LiFiTokenServiceOptions {
  chains?: number[];
  forceRefresh?: boolean;
}

class LiFiTokenService {
  private tokenCache = new Map<number, Token[]>();
  private lastFetch = 0;
  private CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
  
  async getAllTokens(options: LiFiTokenServiceOptions = {}): Promise<Token[]> {
    const { chains, forceRefresh = false } = options;
    
    // Check if we need to refresh
    const now = Date.now();
    if (!forceRefresh && this.tokenCache.size > 0 && (now - this.lastFetch) < this.CACHE_DURATION) {
      console.log('Using cached LiFi tokens');
      return this.getCachedTokens(chains);
    }
    
    console.log('Fetching fresh tokens from LiFi...');
    
    try {
      // Get all supported chains from LiFi
      const lifiChains = await lifiService.getChains();
      console.log(`LiFi supports ${lifiChains.length} chains`);
      
      // Fetch tokens for each chain
      const allTokens: Token[] = [];
      const chainIds = chains || lifiChains.map(c => c.id);
      
      // Fetch tokens in parallel for better performance
      const tokenPromises = chainIds.map(async (chainId) => {
        try {
          const lifiTokens = await lifiService.getTokens(chainId);
          const converted = this.convertLiFiTokens(lifiTokens, chainId);
          this.tokenCache.set(chainId, converted);
          return converted;
        } catch (error) {
          console.error(`Failed to fetch tokens for chain ${chainId}:`, error);
          return [];
        }
      });
      
      const results = await Promise.all(tokenPromises);
      results.forEach(tokens => allTokens.push(...tokens));
      
      this.lastFetch = now;
      
      console.log(`Fetched ${allTokens.length} tokens from LiFi`);
      return allTokens;
      
    } catch (error) {
      console.error('Failed to fetch LiFi tokens:', error);
      
      // Return cached tokens if available
      if (this.tokenCache.size > 0) {
        console.log('Returning cached tokens due to error');
        return this.getCachedTokens(chains);
      }
      
      throw error;
    }
  }
  
  async getTokensForChain(chainId: number, forceRefresh = false): Promise<Token[]> {
    // Check cache first
    if (!forceRefresh && this.tokenCache.has(chainId)) {
      const cached = this.tokenCache.get(chainId);
      if (cached && cached.length > 0) {
        return cached;
      }
    }
    
    try {
      const lifiTokens = await lifiService.getTokens(chainId);
      const converted = this.convertLiFiTokens(lifiTokens, chainId);
      this.tokenCache.set(chainId, converted);
      return converted;
    } catch (error) {
      console.error(`Failed to fetch tokens for chain ${chainId}:`, error);
      return this.tokenCache.get(chainId) || [];
    }
  }
  
  private convertLiFiTokens(lifiTokens: any[], chainId: number): Token[] {
    return lifiTokens.map(token => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      chainId: chainId,
      logoURI: token.logoURI || token.logoUri,
      priceUSD: token.priceUSD ? parseFloat(token.priceUSD) : undefined,
      // Additional fields from LiFi
      coinGeckoId: token.coinGeckoId,
      tags: token.tags || [],
      verified: true, // LiFi tokens are verified
      source: 'LiFi'
    }));
  }
  
  private getCachedTokens(chains?: number[]): Token[] {
    const allTokens: Token[] = [];
    
    if (chains) {
      chains.forEach(chainId => {
        const tokens = this.tokenCache.get(chainId);
        if (tokens) {
          allTokens.push(...tokens);
        }
      });
    } else {
      this.tokenCache.forEach(tokens => {
        allTokens.push(...tokens);
      });
    }
    
    return allTokens;
  }
  
  clearCache() {
    this.tokenCache.clear();
    this.lastFetch = 0;
  }
  
  getCacheStats() {
    const stats = {
      totalTokens: 0,
      chainCount: this.tokenCache.size,
      tokensByChain: {} as Record<number, number>,
      lastFetch: this.lastFetch,
      cacheAge: Date.now() - this.lastFetch
    };
    
    this.tokenCache.forEach((tokens, chainId) => {
      stats.tokensByChain[chainId] = tokens.length;
      stats.totalTokens += tokens.length;
    });
    
    return stats;
  }
}

export const lifiTokenService = new LiFiTokenService();