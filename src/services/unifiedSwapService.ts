import { lifiService, LifiToken, LifiChain, LifiQuoteRequest, LifiRoute } from './lifiService';
import { uniswapFallbackService, UniswapQuoteRequest, UniswapQuoteResponse } from './uniswapFallbackService';

export interface UnifiedToken {
  symbol: string;
  name: string;
  address: string;
  chainId: number;
  decimals: number;
  logoURI?: string;
  source: 'lifi' | 'uniswap' | 'cached';
}

export interface UnifiedChain {
  id: number;
  name: string;
  logoURI?: string;
  nativeToken?: UnifiedToken;
}

export interface UnifiedQuoteRequest {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress?: string;
  slippage?: number;
}

export interface UnifiedQuoteResponse {
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  route: any;
  provider: 'lifi' | 'uniswap';
  estimatedGas?: string;
  priceImpact?: string;
}

class UnifiedSwapService {
  private chainsCache: UnifiedChain[] = [];
  private tokensCache: Map<number, UnifiedToken[]> = new Map();
  private lastFetchTime: number = 0;
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  async initializeChains(): Promise<UnifiedChain[]> {
    try {
      const lifiChains = await lifiService.getChains();
      this.chainsCache = lifiChains.map(chain => ({
        id: chain.id,
        name: chain.name,
        logoURI: chain.logoURI,
        nativeToken: chain.nativeToken ? {
          ...chain.nativeToken,
          chainId: chain.id,
          source: 'lifi' as const
        } : undefined
      }));
      
      this.lastFetchTime = Date.now();
      return this.chainsCache;
    } catch (error) {
      console.error('Failed to initialize chains:', error);
      return this.chainsCache; // Return cached data if available
    }
  }

  async getChains(): Promise<UnifiedChain[]> {
    if (this.chainsCache.length === 0 || Date.now() - this.lastFetchTime > this.CACHE_DURATION) {
      await this.initializeChains();
    }
    return this.chainsCache;
  }

  async getTokensForChain(chainId: number): Promise<UnifiedToken[]> {
    // Check cache first
    if (this.tokensCache.has(chainId) && Date.now() - this.lastFetchTime < this.CACHE_DURATION) {
      return this.tokensCache.get(chainId)!;
    }

    try {
      const lifiTokens = await lifiService.getTokens(chainId);
      const unifiedTokens: UnifiedToken[] = lifiTokens.map(token => ({
        ...token,
        source: 'lifi' as const
      }));
      
      this.tokensCache.set(chainId, unifiedTokens);
      return unifiedTokens;
    } catch (error) {
      console.error(`Failed to get tokens for chain ${chainId}:`, error);
      return this.tokensCache.get(chainId) || [];
    }
  }

  async getAllTokens(): Promise<Map<number, UnifiedToken[]>> {
    const chains = await this.getChains();
    const allTokens = new Map<number, UnifiedToken[]>();
    
    // Fetch tokens for all chains in parallel
    const promises = chains.map(async (chain) => {
      const tokens = await this.getTokensForChain(chain.id);
      allTokens.set(chain.id, tokens);
    });
    
    await Promise.all(promises);
    return allTokens;
  }

  async getQuote(request: UnifiedQuoteRequest): Promise<UnifiedQuoteResponse> {
    // Try LI.FI first
    try {
      const lifiRequest: LifiQuoteRequest = {
        fromChain: request.fromChain,
        toChain: request.toChain,
        fromToken: request.fromToken,
        toToken: request.toToken,
        fromAmount: request.fromAmount,
        fromAddress: request.fromAddress,
        toAddress: request.toAddress,
        slippage: request.slippage
      };
      
      const routes = await lifiService.getQuote(lifiRequest);
      
      if (routes.length > 0) {
        const bestRoute = routes[0]; // LI.FI returns sorted routes
        return {
          fromAmount: bestRoute.fromAmount,
          toAmount: bestRoute.toAmount,
          toAmountMin: bestRoute.toAmountMin,
          route: bestRoute,
          provider: 'lifi',
          estimatedGas: bestRoute.gasCostUSD,
          priceImpact: undefined
        };
      }
    } catch (error) {
      console.error('LI.FI quote failed:', error);
      
      // If it's Ethereum mainnet, try Uniswap fallback
      if (request.fromChain === 1 && request.toChain === 1) {
        return this.getUniswapQuote(request);
      }
      
      throw error;
    }

    throw new Error('No routes found');
  }

  private async getUniswapQuote(request: UnifiedQuoteRequest): Promise<UnifiedQuoteResponse> {
    const uniswapRequest: UniswapQuoteRequest = {
      tokenIn: request.fromToken,
      tokenOut: request.toToken,
      amountIn: request.fromAmount,
      recipient: request.fromAddress,
      slippageTolerance: request.slippage
    };
    
    const quote = await uniswapFallbackService.getQuote(uniswapRequest);
    
    const slippage = request.slippage || 0.5;
    const slippageMultiplier = Math.floor((100 - slippage) * 100); // e.g., 0.5% = 9950
    const toAmountMin = (BigInt(quote.amountOut) * BigInt(slippageMultiplier) / BigInt(10000)).toString();
    
    return {
      fromAmount: request.fromAmount,
      toAmount: quote.amountOut,
      toAmountMin: toAmountMin,
      route: { provider: 'uniswap', route: quote.route },
      provider: 'uniswap',
      estimatedGas: quote.gasEstimate,
      priceImpact: quote.priceImpact
    };
  }

  async executeSwap(quote: UnifiedQuoteResponse, userAddress: string) {
    if (quote.provider === 'lifi') {
      return lifiService.executeSwap(quote.route as LifiRoute, userAddress);
    } else if (quote.provider === 'uniswap') {
      // For Uniswap, we return the transaction to be signed by the user
      const request: UniswapQuoteRequest = {
        tokenIn: quote.route.route[0],
        tokenOut: quote.route.route[1],
        amountIn: quote.fromAmount,
        recipient: userAddress,
        slippageTolerance: 0.5
      };
      
      return uniswapFallbackService.buildSwapTransaction(request, {
        amountOut: quote.toAmount,
        priceImpact: quote.priceImpact || '0',
        route: quote.route.route,
        gasEstimate: quote.estimatedGas || '200000'
      });
    }
    
    throw new Error('Invalid quote provider');
  }

  // Utility methods
  clearCache() {
    this.chainsCache = [];
    this.tokensCache.clear();
    this.lastFetchTime = 0;
    lifiService.clearCache();
  }

  getCachedChains(): UnifiedChain[] {
    return this.chainsCache;
  }

  getCachedTokens(chainId?: number): UnifiedToken[] {
    if (chainId) {
      return this.tokensCache.get(chainId) || [];
    }
    
    const allTokens: UnifiedToken[] = [];
    this.tokensCache.forEach(tokens => {
      allTokens.push(...tokens);
    });
    return allTokens;
  }
}

export const unifiedSwapService = new UnifiedSwapService();