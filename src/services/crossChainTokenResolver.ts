import { lifiService, LifiToken } from './lifiService';
import { NATIVE_TOKEN_ADDRESS, CrossChainTokenMapper } from './crossChainTokenMapper';

/**
 * Enhanced cross-chain token resolver that uses LiFi's token data
 * to find equivalent tokens across chains
 */
export class CrossChainTokenResolver {
  private static tokenCache = new Map<string, Map<number, LifiToken>>();
  private static symbolToTokens = new Map<string, Map<number, LifiToken>>();
  private static lastCacheUpdate = 0;
  private static readonly CACHE_DURATION = 60 * 60 * 1000; // 1 hour

  /**
   * Initialize or refresh the token cache from LiFi
   */
  private static async ensureCache() {
    const now = Date.now();
    if (now - this.lastCacheUpdate < this.CACHE_DURATION && this.tokenCache.size > 0) {
      return; // Cache is still fresh
    }

    console.log('Refreshing cross-chain token cache from LiFi...');
    
    try {
      const allTokens = await lifiService.getAllTokens();
      
      // Clear old cache
      this.tokenCache.clear();
      this.symbolToTokens.clear();
      
      // Build cache by token address and symbol
      allTokens.forEach((tokens, chainId) => {
        tokens.forEach(token => {
          // Cache by address
          const addressKey = token.address.toLowerCase();
          if (!this.tokenCache.has(addressKey)) {
            this.tokenCache.set(addressKey, new Map());
          }
          this.tokenCache.get(addressKey)!.set(chainId, token);
          
          // Cache by symbol
          const symbolKey = token.symbol.toUpperCase();
          if (!this.symbolToTokens.has(symbolKey)) {
            this.symbolToTokens.set(symbolKey, new Map());
          }
          this.symbolToTokens.get(symbolKey)!.set(chainId, token);
        });
      });
      
      this.lastCacheUpdate = now;
      console.log(`Token cache updated: ${this.tokenCache.size} unique addresses, ${this.symbolToTokens.size} unique symbols`);
    } catch (error) {
      console.error('Failed to refresh token cache:', error);
      throw error;
    }
  }

  /**
   * Resolve a token address from source chain to target chain
   * This method tries multiple strategies to find the equivalent token
   */
  static async resolveTokenAddress(
    sourceTokenAddress: string,
    sourceChainId: number,
    targetChainId: number
  ): Promise<string | null> {
    // Handle native token
    if (sourceTokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase() ||
        sourceTokenAddress.toLowerCase() === '0x0000000000000000000000000000000000000000') {
      return NATIVE_TOKEN_ADDRESS;
    }

    await this.ensureCache();

    // Strategy 1: Check our predefined mappings first
    const predefinedMapping = CrossChainTokenMapper.getMappedTokenAddress(
      sourceChainId,
      sourceTokenAddress,
      targetChainId
    );
    if (predefinedMapping) {
      console.log(`Found predefined mapping: ${sourceTokenAddress} -> ${predefinedMapping}`);
      return predefinedMapping;
    }

    // Strategy 2: Look up the token in LiFi's data
    const addressKey = sourceTokenAddress.toLowerCase();
    const tokenInstances = this.tokenCache.get(addressKey);
    
    if (!tokenInstances || !tokenInstances.has(sourceChainId)) {
      console.log(`Token ${sourceTokenAddress} not found on chain ${sourceChainId}`);
      return null;
    }

    const sourceToken = tokenInstances.get(sourceChainId)!;
    
    // Strategy 3: Find token with same symbol on target chain
    const symbolTokens = this.symbolToTokens.get(sourceToken.symbol.toUpperCase());
    if (symbolTokens && symbolTokens.has(targetChainId)) {
      const targetToken = symbolTokens.get(targetChainId)!;
      console.log(`Found token by symbol match: ${sourceToken.symbol} on chain ${targetChainId} -> ${targetToken.address}`);
      return targetToken.address;
    }

    // Strategy 4: Look for similar name patterns (e.g., "USDC", "USDC.e", "axlUSDC")
    const baseSymbol = this.extractBaseSymbol(sourceToken.symbol);
    const similarTokens = Array.from(this.symbolToTokens.entries())
      .filter(([symbol]) => this.extractBaseSymbol(symbol) === baseSymbol)
      .flatMap(([_, tokens]) => Array.from(tokens.entries()))
      .filter(([chainId]) => chainId === targetChainId);

    if (similarTokens.length > 0) {
      // Prefer exact matches, then bridged versions
      const sortedMatches = similarTokens.sort(([_, a], [__, b]) => {
        // Exact match gets highest priority
        if (a.symbol.toUpperCase() === sourceToken.symbol.toUpperCase()) return -1;
        if (b.symbol.toUpperCase() === sourceToken.symbol.toUpperCase()) return 1;
        
        // Prefer shorter symbols (less likely to be bridged versions)
        return a.symbol.length - b.symbol.length;
      });

      const bestMatch = sortedMatches[0][1];
      console.log(`Found similar token: ${sourceToken.symbol} -> ${bestMatch.symbol} on chain ${targetChainId} -> ${bestMatch.address}`);
      return bestMatch.address;
    }

    console.log(`No equivalent token found for ${sourceToken.symbol} (${sourceTokenAddress}) on chain ${targetChainId}`);
    return null;
  }

  /**
   * Extract base symbol from variations like "USDC", "USDC.e", "axlUSDC"
   */
  private static extractBaseSymbol(symbol: string): string {
    // Remove common prefixes
    const prefixes = ['axl', 'any', 'multi', 'm.', 'w', 'x', 'a', 's'];
    let base = symbol.toUpperCase();
    
    for (const prefix of prefixes) {
      if (base.toLowerCase().startsWith(prefix) && base.length > prefix.length) {
        base = base.substring(prefix.length);
      }
    }
    
    // Remove common suffixes
    const suffixes = ['.E', '.B', '.M', '-ERC20', '-BEP20', '-MATIC'];
    for (const suffix of suffixes) {
      if (base.endsWith(suffix)) {
        base = base.substring(0, base.length - suffix.length);
      }
    }
    
    return base;
  }

  /**
   * Get token info including symbol and decimals
   */
  static async getTokenInfo(
    tokenAddress: string,
    chainId: number
  ): Promise<LifiToken | null> {
    await this.ensureCache();
    
    const addressKey = tokenAddress.toLowerCase();
    const tokenInstances = this.tokenCache.get(addressKey);
    
    if (!tokenInstances || !tokenInstances.has(chainId)) {
      return null;
    }
    
    return tokenInstances.get(chainId)!;
  }

  /**
   * Check if a token exists on a specific chain
   */
  static async tokenExistsOnChain(
    tokenAddress: string,
    chainId: number
  ): Promise<boolean> {
    const tokenInfo = await this.getTokenInfo(tokenAddress, chainId);
    return tokenInfo !== null;
  }

  /**
   * Get all available chains for a token
   */
  static async getAvailableChains(tokenAddress: string): Promise<number[]> {
    await this.ensureCache();
    
    const addressKey = tokenAddress.toLowerCase();
    const tokenInstances = this.tokenCache.get(addressKey);
    
    if (!tokenInstances) {
      // Check by symbol as fallback
      const symbolMatches = Array.from(this.tokenCache.values())
        .filter(instances => {
          const firstInstance = instances.values().next().value;
          return firstInstance && instances.has(1) && 
                 instances.get(1)!.address.toLowerCase() === addressKey;
        });
      
      if (symbolMatches.length > 0) {
        const symbol = symbolMatches[0].values().next().value.symbol;
        const symbolTokens = this.symbolToTokens.get(symbol.toUpperCase());
        return symbolTokens ? Array.from(symbolTokens.keys()) : [];
      }
      
      return [];
    }
    
    return Array.from(tokenInstances.keys());
  }
}