import axios from 'axios';
import { getChains, getTokens, getQuote, getRoutes } from '@lifi/sdk';
import { lifiLogger } from '../utils/devLogger';
import { lifiRateLimitService } from './rateLimiter';

const LIFI_BASE_URL = 'https://li.quest/v1';

export interface LifiChain {
  id: number;
  name: string;
  logoURI?: string;
  nativeToken: {
    symbol: string;
    name: string;
    address: string;
    decimals: number;
    logoURI?: string;
  };
}

export interface LifiToken {
  symbol: string;
  name: string;
  address: string;
  chainId: number;
  decimals: number;
  logoURI?: string;
  priceUSD?: string;
}

export interface LifiQuoteRequest {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress?: string;
  slippage?: number;
}

export interface LifiRoute {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  gasCostUSD?: string;
  containsSwitchChain: boolean;
  steps: any[];
  tags: string[];
}

class LifiService {
  private chainsCache: Map<number, LifiChain> = new Map();
  private tokensCache: Map<number, LifiToken[]> = new Map();
  private allTokensCache: Map<number, LifiToken[]> | null = null;
  private cacheTimestamp: number = 0;
  private allTokensCacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private isLoading: boolean = false;

  async getChains(): Promise<LifiChain[]> {
    try {
      // Use SDK method
      const chains = await getChains();
      
      // Cache chains
      chains.forEach((chain: any) => {
        this.chainsCache.set(chain.id, chain);
      });
      
      return chains;
    } catch (error) {
      lifiLogger.error('Error fetching LI.FI chains:', error);
      throw error;
    }
  }

  async getTokens(chainId?: number): Promise<LifiToken[]> {
    // Check cache first
    if (chainId && this.tokensCache.has(chainId) && Date.now() - this.cacheTimestamp < this.CACHE_DURATION) {
      return this.tokensCache.get(chainId)!;
    }

    try {
      // Use SDK method - if no chainId, get ALL tokens
      const tokensResponse = await getTokens(chainId ? { chains: [chainId] } : {});
      
      if (chainId) {
        const tokens = tokensResponse.tokens[chainId] || [];
        // Cache tokens for specific chain
        this.tokensCache.set(chainId, tokens);
        this.cacheTimestamp = Date.now();
        return tokens;
      } else {
        // Return all tokens from all chains
        const allTokens: LifiToken[] = [];
        Object.entries(tokensResponse.tokens).forEach(([chain, tokens]) => {
          allTokens.push(...(tokens as LifiToken[]));
        });
        return allTokens;
      }
    } catch (error) {
      lifiLogger.error(`Error fetching tokens:`, error);
      throw error;
    }
  }

  async getAllTokens(): Promise<Map<number, LifiToken[]>> {
    // Check cache first
    if (this.allTokensCache && Date.now() - this.allTokensCacheTimestamp < this.CACHE_DURATION) {
      lifiLogger.info('Returning cached LiFi tokens');
      return this.allTokensCache;
    }

    // Prevent concurrent loading
    if (this.isLoading) {
      lifiLogger.info('LiFi tokens loading in progress, waiting...');
      // Wait and return cached result if available
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.allTokensCache || new Map();
    }

    this.isLoading = true;

    try {
      lifiLogger.info('Loading all tokens from LiFi...');
      const startTime = Date.now();

      // Use SDK method to get all tokens at once (more efficient)
      const tokensResponse = await getTokens({});
      const allTokens = new Map<number, LifiToken[]>();
      
      // Process the response
      Object.entries(tokensResponse.tokens).forEach(([chainId, tokens]) => {
        allTokens.set(Number(chainId), tokens as LifiToken[]);
      });
      
      // Cache the result
      this.allTokensCache = allTokens;
      this.allTokensCacheTimestamp = Date.now();

      const loadTime = Date.now() - startTime;
      const totalTokens = Array.from(allTokens.values()).reduce((sum, tokens) => sum + tokens.length, 0);
      
      lifiLogger.info(`Loaded ${totalTokens} tokens for ${allTokens.size} chains in ${loadTime}ms`);
      return allTokens;

    } catch (error) {
      console.error('[LiFi] Failed to fetch all tokens from LiFi SDK, trying fallback:', error);
      if (error instanceof Error) {
        console.error('[LiFi] Primary error details:', {
          message: error.message,
          stack: error.stack
        });
      }
      
      try {
        // Fallback: fetch chains and tokens individually
        console.log('[LiFi] Attempting fallback method: fetching chains first...');
        const chains = await this.getChains();
        const allTokens = new Map<number, LifiToken[]>();
        
        // Fetch tokens for main chains only to avoid rate limits
        const mainChains = chains.filter(chain => [1, 56, 137, 42161, 10, 43114].includes(chain.id));
        console.log(`[LiFi] Fetching tokens for ${mainChains.length} main chains...`);
        
        // Fetch tokens for all chains in parallel (batch by 3 to avoid rate limits)
        const batchSize = 3;
        for (let i = 0; i < mainChains.length; i += batchSize) {
          const batch = mainChains.slice(i, i + batchSize);
          const promises = batch.map(async (chain) => {
            try {
              const tokens = await this.getTokens(chain.id);
              allTokens.set(chain.id, tokens);
              console.log(`[LiFi] Loaded ${tokens.length} tokens for chain ${chain.id}`);
            } catch (error) {
              console.error(`[LiFi] Failed to fetch tokens for chain ${chain.id}:`, error);
              allTokens.set(chain.id, []);
            }
          });
          
          await Promise.all(promises);
          
          // Small delay between batches
          if (i + batchSize < mainChains.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // Cache the fallback result
        this.allTokensCache = allTokens;
        this.allTokensCacheTimestamp = Date.now();
        
        const totalTokens = Array.from(allTokens.values()).reduce((sum, tokens) => sum + tokens.length, 0);
        console.log(`[LiFi] Fallback loaded ${totalTokens} tokens for ${allTokens.size} chains`);
        
        return allTokens;

      } catch (fallbackError) {
        console.error('[LiFi] Fallback method also failed:', fallbackError);
        if (fallbackError instanceof Error) {
          console.error('[LiFi] Fallback error details:', {
            message: fallbackError.message,
            stack: fallbackError.stack
          });
        }
        
        // Return cached data if available, even if stale
        if (this.allTokensCache) {
          console.warn('[LiFi] Returning stale cached data due to API failures');
          return this.allTokensCache;
        }
        
        // Last resort: return empty map
        console.error('[LiFi] No cached data available, returning empty map');
        return new Map();
      }
    } finally {
      this.isLoading = false;
    }
  }

  async getQuote(request: LifiQuoteRequest): Promise<LifiRoute[]> {
    try {
      // Check rate limit before making request
      const rateLimitResult = lifiRateLimitService.canMakeRequest(process.env.LIFI_API_KEY);
      if (!rateLimitResult.allowed) {
        const waitTime = Math.ceil((rateLimitResult.retryAfter || 0) / 1000);
        throw new Error(`LiFi API rate limit exceeded. Try again in ${waitTime} seconds.`);
      }

      // Use SDK method with correct parameters
      const quoteRequest = {
        fromChain: request.fromChain.toString(),
        toChain: request.toChain.toString(),
        fromToken: request.fromToken,
        toToken: request.toToken,
        fromAmount: request.fromAmount,
        fromAddress: request.fromAddress,
        toAddress: request.toAddress || request.fromAddress,
        slippage: (request.slippage || 0.5) / 100, // Convert percentage to decimal
        integrator: 'multi-chain-swap',
        allowBridges: ['hop', 'cbridge', 'stargate', 'across', 'optimism', 'arbitrum', 'polygon']
      };
      
      const quote = await getQuote(quoteRequest);
      
      return quote.routes || [];
    } catch (error: any) {
      // Handle rate limit specifically
      if (error.response?.status === 429 || error.message.includes('rate limit')) {
        lifiLogger.error('LiFi rate limit detected');
        const retryAfter = error.response?.headers?.['retry-after'];
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter) : 7200; // Default to 2 hours
        
        lifiRateLimitService.handleRateLimit(retryAfterSeconds, process.env.LIFI_API_KEY);
        throw new Error(`LiFi API rate limit exceeded. Retry after ${Math.ceil(retryAfterSeconds / 60)} minutes.`);
      }

      lifiLogger.error('Error fetching LI.FI quote:', error);
      
      // If it's a 400 error, it might be because the token pair is not supported
      if (error.response?.status === 400) {
        lifiLogger.error('LI.FI quote error details:', error.response?.data);
        throw new Error('Quote not available for this token pair');
      }
      
      throw error;
    }
  }

  async executeSwap(route: LifiRoute, userAddress: string) {
    try {
      const response = await axios.post(`${LIFI_BASE_URL}/advanced/routes`, {
        route,
        fromAddress: userAddress,
        toAddress: userAddress,
        integrator: 'multi-chain-swap'
      }, {
        headers: {
          'x-lifi-api-key': process.env.LIFI_API_KEY
        }
      });
      
      return response.data;
    } catch (error) {
      lifiLogger.error('Error executing LI.FI swap:', error);
      throw error;
    }
  }

  // Clear cache method for manual refresh
  clearCache() {
    this.chainsCache.clear();
    this.tokensCache.clear();
    this.allTokensCache = null;
    this.cacheTimestamp = 0;
    this.allTokensCacheTimestamp = 0;
    lifiLogger.info('LiFi cache cleared');
  }

  // Force refresh of token data
  async refreshTokens(): Promise<Map<number, LifiToken[]>> {
    this.clearCache();
    return await this.getAllTokens();
  }

  // Check if data is cached and fresh
  isCacheValid(): boolean {
    return this.allTokensCache !== null && 
           Date.now() - this.allTokensCacheTimestamp < this.CACHE_DURATION;
  }

  // Get cached data if available
  getCachedChains(): LifiChain[] {
    return Array.from(this.chainsCache.values());
  }

  getCachedTokens(chainId?: number): LifiToken[] {
    if (chainId) {
      return this.tokensCache.get(chainId) || [];
    }
    
    // Return all cached tokens
    const allTokens: LifiToken[] = [];
    this.tokensCache.forEach(tokens => {
      allTokens.push(...tokens);
    });
    return allTokens;
  }
}

export const lifiService = new LifiService();