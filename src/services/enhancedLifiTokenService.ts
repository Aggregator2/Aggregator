import { lifiService, LifiToken } from './lifiService';
import { lifiTokenService } from './lifiTokenService';
import { 
  LiFiTokenInfo, 
  FALLBACK_TOKENS, 
  getFallbackTokensForChain, 
  mergeLiFiWithFallback,
  getTokenWarnings,
  isTokenBlacklisted,
  getNativeTokenInfo,
  getWrappedNativeTokenInfo,
  NATIVE_TOKEN_ADDRESSES,
  WRAPPED_NATIVE_ADDRESSES
} from '../config/tokenRegistry';
import { Token } from '../types/token';

export interface EnhancedToken extends LiFiTokenInfo {
  warnings?: Array<{
    type: string;
    severity: string;
    message: string;
    helpText?: string;
  }>;
  isBlacklisted?: boolean;
  isNative?: boolean;
  isWrappedNative?: boolean;
  verified: boolean;
  source: 'LiFi' | 'Registry' | 'Fallback';
}

export interface TokenServiceOptions {
  chains?: number[];
  forceRefresh?: boolean;
  includeBlacklisted?: boolean;
  includeWarnings?: boolean;
}

class EnhancedLiFiTokenService {
  private enhancedTokenCache = new Map<number, EnhancedToken[]>();
  private lastFetch = 0;
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
  private isLoading = false;

  /**
   * Get all tokens with enhanced metadata and fallback support
   */
  async getAllTokens(options: TokenServiceOptions = {}): Promise<EnhancedToken[]> {
    const { 
      chains, 
      forceRefresh = false, 
      includeBlacklisted = false,
      includeWarnings = true 
    } = options;
    
    // Check cache first
    const now = Date.now();
    if (!forceRefresh && this.enhancedTokenCache.size > 0 && (now - this.lastFetch) < this.CACHE_DURATION) {
      console.log('Using cached enhanced tokens');
      return this.getCachedTokens(chains, includeBlacklisted);
    }
    
    // Prevent concurrent loading
    if (this.isLoading) {
      console.log('Enhanced tokens loading in progress, waiting...');
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.getCachedTokens(chains, includeBlacklisted);
    }

    this.isLoading = true;
    
    try {
      console.log('Fetching enhanced tokens with LiFi integration...');
      
      // Try to get tokens from LiFi first
      let allLifiTokens: Map<number, LifiToken[]>;
      
      try {
        allLifiTokens = await lifiService.getAllTokens();
        console.log(`LiFi returned tokens for ${allLifiTokens.size} chains`);
      } catch (lifiError) {
        console.error('LiFi failed, using fallback tokens only:', lifiError);
        allLifiTokens = new Map();
      }
      
      // Get supported chains (either specified or all chains with fallback tokens)
      const supportedChains = chains || this.getSupportedChains();
      
      // Process each chain
      for (const chainId of supportedChains) {
        const lifiTokens = allLifiTokens.get(chainId) || [];
        const enhancedTokens = await this.processChainTokens(
          chainId, 
          lifiTokens, 
          includeWarnings
        );
        
        // Filter out blacklisted tokens unless explicitly requested
        const filteredTokens = includeBlacklisted 
          ? enhancedTokens
          : enhancedTokens.filter(token => !token.isBlacklisted);
        
        this.enhancedTokenCache.set(chainId, filteredTokens);
      }
      
      this.lastFetch = now;
      
      const totalTokens = Array.from(this.enhancedTokenCache.values())
        .reduce((sum, tokens) => sum + tokens.length, 0);
      console.log(`Enhanced token service cached ${totalTokens} tokens for ${this.enhancedTokenCache.size} chains`);
      
      return this.getCachedTokens(chains, includeBlacklisted);
      
    } catch (error) {
      console.error('Failed to fetch enhanced tokens:', error);
      
      // Return cached tokens if available
      if (this.enhancedTokenCache.size > 0) {
        console.log('Returning cached enhanced tokens due to error');
        return this.getCachedTokens(chains, includeBlacklisted);
      }
      
      // Last resort: return only fallback tokens
      return this.getFallbackTokensOnly(chains, includeBlacklisted, includeWarnings);
      
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Get tokens for a specific chain with enhanced metadata
   */
  async getTokensForChain(
    chainId: number, 
    options: TokenServiceOptions = {}
  ): Promise<EnhancedToken[]> {
    const { forceRefresh = false, includeBlacklisted = false, includeWarnings = true } = options;
    
    // Check cache first
    if (!forceRefresh && this.enhancedTokenCache.has(chainId)) {
      const cached = this.enhancedTokenCache.get(chainId)!;
      return includeBlacklisted 
        ? cached 
        : cached.filter(token => !token.isBlacklisted);
    }
    
    try {
      console.log(`Fetching enhanced tokens for chain ${chainId}...`);
      
      // Try to get tokens from LiFi
      let lifiTokens: LifiToken[] = [];
      try {
        lifiTokens = await lifiService.getTokens(chainId);
        if (!lifiTokens) {
          lifiTokens = [];
        }
        console.log(`LiFi returned ${lifiTokens.length} tokens for chain ${chainId}`);
      } catch (lifiError) {
        console.error(`LiFi failed for chain ${chainId}, using fallback only:`, lifiError);
        lifiTokens = [];
      }
      
      const enhancedTokens = await this.processChainTokens(chainId, lifiTokens, includeWarnings);
      
      // Filter out blacklisted tokens unless explicitly requested
      const filteredTokens = includeBlacklisted 
        ? enhancedTokens
        : enhancedTokens.filter(token => !token.isBlacklisted);
      
      this.enhancedTokenCache.set(chainId, enhancedTokens);
      return filteredTokens;
      
    } catch (error) {
      console.error(`Failed to fetch enhanced tokens for chain ${chainId}:`, error);
      
      // Return cached tokens or fallback
      const cached = this.enhancedTokenCache.get(chainId);
      if (cached) {
        return includeBlacklisted 
          ? cached 
          : cached.filter(token => !token.isBlacklisted);
      }
      
      // Return fallback tokens for this chain
      return this.getFallbackTokensForChain(chainId, includeBlacklisted, includeWarnings);
    }
  }

  /**
   * Process tokens for a specific chain, merging LiFi data with registry data
   */
  private async processChainTokens(
    chainId: number, 
    lifiTokens: LifiToken[], 
    includeWarnings: boolean
  ): Promise<EnhancedToken[]> {
    // Ensure lifiTokens is an array
    const tokens = Array.isArray(lifiTokens) ? lifiTokens : [];
    
    // Convert LiFi tokens to our enhanced format
    const enhancedLifiTokens: EnhancedToken[] = tokens.map(token => ({
      ...token,
      chainId,
      warnings: includeWarnings ? getTokenWarnings(token.address, chainId) : undefined,
      isBlacklisted: isTokenBlacklisted(token.address, chainId),
      isNative: this.isNativeToken(token.address, chainId),
      isWrappedNative: this.isWrappedNativeToken(token.address, chainId),
      verified: true,
      source: 'LiFi' as const
    }));
    
    // Get fallback tokens for this chain
    const fallbackTokens = getFallbackTokensForChain(chainId);
    const lifiAddresses = new Set(tokens.map(t => t.address.toLowerCase()));
    
    // Add fallback tokens that aren't already in LiFi data
    const additionalTokens = fallbackTokens
      .filter(token => !lifiAddresses.has(token.address.toLowerCase()))
      .map(token => ({
        ...token,
        warnings: includeWarnings ? getTokenWarnings(token.address, chainId) : undefined,
        isBlacklisted: isTokenBlacklisted(token.address, chainId),
        isNative: this.isNativeToken(token.address, chainId),
        isWrappedNative: this.isWrappedNativeToken(token.address, chainId),
        verified: true,
        source: 'Fallback' as const
      }));
    
    // Ensure native token is always first, followed by wrapped native
    const allTokens = [...enhancedLifiTokens, ...additionalTokens];
    return this.sortTokensByPriority(allTokens);
  }

  /**
   * Sort tokens by priority (native first, then wrapped native, then stablecoins, then others)
   */
  private sortTokensByPriority(tokens: EnhancedToken[]): EnhancedToken[] {
    return tokens.sort((a, b) => {
      // Native tokens first
      if (a.isNative && !b.isNative) return -1;
      if (!a.isNative && b.isNative) return 1;
      
      // Wrapped native tokens second
      if (a.isWrappedNative && !b.isWrappedNative) return -1;
      if (!a.isWrappedNative && b.isWrappedNative) return 1;
      
      // Stablecoins third
      const aIsStable = a.tags?.includes('stablecoin') || ['USDC', 'USDT', 'DAI', 'BUSD'].includes(a.symbol);
      const bIsStable = b.tags?.includes('stablecoin') || ['USDC', 'USDT', 'DAI', 'BUSD'].includes(b.symbol);
      
      if (aIsStable && !bIsStable) return -1;
      if (!aIsStable && bIsStable) return 1;
      
      // Then by symbol alphabetically
      return a.symbol.localeCompare(b.symbol);
    });
  }

  /**
   * Check if token is native
   */
  private isNativeToken(address: string, chainId: number): boolean {
    const nativeAddress = NATIVE_TOKEN_ADDRESSES[chainId];
    return nativeAddress && address.toLowerCase() === nativeAddress.toLowerCase();
  }

  /**
   * Check if token is wrapped native
   */
  private isWrappedNativeToken(address: string, chainId: number): boolean {
    const wrappedAddress = WRAPPED_NATIVE_ADDRESSES[chainId];
    return wrappedAddress && address.toLowerCase() === wrappedAddress.toLowerCase();
  }

  /**
   * Get supported chains (chains that have fallback tokens)
   */
  private getSupportedChains(): number[] {
    const chains = new Set<number>();
    FALLBACK_TOKENS.forEach(token => chains.add(token.chainId));
    return Array.from(chains);
  }

  /**
   * Get cached tokens with optional filtering
   */
  private getCachedTokens(chains?: number[], includeBlacklisted = false): EnhancedToken[] {
    const allTokens: EnhancedToken[] = [];
    
    if (chains) {
      chains.forEach(chainId => {
        const tokens = this.enhancedTokenCache.get(chainId);
        if (tokens) {
          const filteredTokens = includeBlacklisted 
            ? tokens 
            : tokens.filter(token => !token.isBlacklisted);
          allTokens.push(...filteredTokens);
        }
      });
    } else {
      this.enhancedTokenCache.forEach(tokens => {
        const filteredTokens = includeBlacklisted 
          ? tokens 
          : tokens.filter(token => !token.isBlacklisted);
        allTokens.push(...filteredTokens);
      });
    }
    
    return allTokens;
  }

  /**
   * Get fallback tokens only (when LiFi completely fails)
   */
  private getFallbackTokensOnly(
    chains?: number[], 
    includeBlacklisted = false,
    includeWarnings = true
  ): EnhancedToken[] {
    const fallbackTokens = chains 
      ? FALLBACK_TOKENS.filter(token => chains.includes(token.chainId))
      : FALLBACK_TOKENS;
    
    return fallbackTokens
      .map(token => ({
        ...token,
        warnings: includeWarnings ? getTokenWarnings(token.address, token.chainId) : undefined,
        isBlacklisted: isTokenBlacklisted(token.address, token.chainId),
        isNative: this.isNativeToken(token.address, token.chainId),
        isWrappedNative: this.isWrappedNativeToken(token.address, token.chainId),
        verified: true,
        source: 'Fallback' as const
      }))
      .filter(token => includeBlacklisted || !token.isBlacklisted);
  }

  /**
   * Get fallback tokens for a specific chain
   */
  private getFallbackTokensForChain(
    chainId: number, 
    includeBlacklisted = false,
    includeWarnings = true
  ): EnhancedToken[] {
    return this.getFallbackTokensOnly([chainId], includeBlacklisted, includeWarnings);
  }

  /**
   * Search tokens by symbol or name
   */
  async searchTokens(
    query: string, 
    chainId?: number, 
    options: TokenServiceOptions = {}
  ): Promise<EnhancedToken[]> {
    const allTokens = chainId 
      ? await this.getTokensForChain(chainId, options)
      : await this.getAllTokens(options);
    
    const lowercaseQuery = query.toLowerCase();
    
    return allTokens.filter(token => 
      token.symbol.toLowerCase().includes(lowercaseQuery) ||
      token.name.toLowerCase().includes(lowercaseQuery) ||
      token.address.toLowerCase() === lowercaseQuery
    );
  }

  /**
   * Get token by address
   */
  async getTokenByAddress(
    address: string, 
    chainId: number, 
    options: TokenServiceOptions = {}
  ): Promise<EnhancedToken | null> {
    const tokens = await this.getTokensForChain(chainId, options);
    return tokens.find(token => 
      token.address.toLowerCase() === address.toLowerCase()
    ) || null;
  }

  /**
   * Get popular tokens for a chain (native, wrapped native, major stablecoins)
   */
  async getPopularTokens(chainId: number, limit = 10): Promise<EnhancedToken[]> {
    const tokens = await this.getTokensForChain(chainId, { includeWarnings: false });
    
    // Filter for popular tokens
    const popularTokens = tokens.filter(token => 
      token.isNative || 
      token.isWrappedNative ||
      token.tags?.includes('stablecoin') ||
      ['USDC', 'USDT', 'DAI', 'WBTC', 'WETH'].includes(token.symbol)
    );
    
    return popularTokens.slice(0, limit);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.enhancedTokenCache.clear();
    this.lastFetch = 0;
    console.log('Enhanced token cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const stats = {
      totalTokens: 0,
      chainCount: this.enhancedTokenCache.size,
      tokensByChain: {} as Record<number, number>,
      lastFetch: this.lastFetch,
      cacheAge: Date.now() - this.lastFetch,
      isStale: Date.now() - this.lastFetch > this.CACHE_DURATION
    };
    
    this.enhancedTokenCache.forEach((tokens, chainId) => {
      stats.tokensByChain[chainId] = tokens.length;
      stats.totalTokens += tokens.length;
    });
    
    return stats;
  }
}

// Export singleton instance
export const enhancedLifiTokenService = new EnhancedLiFiTokenService();