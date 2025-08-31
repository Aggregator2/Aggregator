import { ethers } from "ethers";
import { lifiService } from './lifiService';
import { CrossChainTokenMapper } from './crossChainTokenMapper';
import { CrossChainTokenResolver } from './crossChainTokenResolver';
import { lifiRateLimitService } from './rateLimiter';

export interface QuoteRequest {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  chainId: number;
  toChainId?: number; // For cross-chain swaps
  slippage?: number;
}

export interface QuoteResponse {
  buyAmount: string;
  source: string;
  estimatedGas?: string;
  priceImpact?: number;
  route?: any[];
  allowanceTarget?: string;
  minReceived?: string;
  slippagePercentage?: number;
  [key: string]: any; // Allow additional fields from specific APIs
}

// Chain configurations - All 47 chains supported by LiFi
export const CHAIN_CONFIG = {
  // Major EVM Chains
  1: {
    name: "Ethereum",
    nativeCurrency: "ETH",
    rpcUrls: [
      process.env.ETHEREUM_RPC || "https://eth.llamarpc.com",
      "https://rpc.ankr.com/eth",
      "https://ethereum.publicnode.com",
    ],
    quoters: ["lifi", "0x", "uniswap"],
  },
  56: {
    name: "BSC",
    nativeCurrency: "BNB",
    rpcUrls: ["https://bsc-dataseed1.binance.org", "https://rpc.ankr.com/bsc"],
    quoters: ["lifi"], // Only LiFi for BSC
  },
  137: {
    name: "Polygon",
    nativeCurrency: "POL",
    rpcUrls: ["https://polygon-rpc.com", "https://rpc.ankr.com/polygon"],
    quoters: ["lifi"], // LiFi only for now
  },
  42161: {
    name: "Arbitrum",
    nativeCurrency: "ETH",
    rpcUrls: [
      process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
      "https://arbitrum-one.publicnode.com",
    ],
    quoters: ["lifi"], // LiFi only for now
  },
  10: {
    name: "Optimism",
    nativeCurrency: "ETH",
    rpcUrls: ["https://mainnet.optimism.io", "https://rpc.ankr.com/optimism"],
    quoters: ["lifi"], // LiFi only for now
  },
  43114: {
    name: "Avalanche",
    nativeCurrency: "AVAX",
    rpcUrls: [
      "https://api.avax.network/ext/bc/C/rpc",
      "https://rpc.ankr.com/avalanche",
    ],
    quoters: ["lifi"], // LiFi only for now
  },
  250: {
    name: "Fantom",
    nativeCurrency: "FTM",
    rpcUrls: ["https://rpc.ftm.tools", "https://rpc.ankr.com/fantom"],
    quoters: ["lifi"], // LiFi only for now
  },
  8453: {
    name: "Base",
    nativeCurrency: "ETH",
    rpcUrls: ["https://mainnet.base.org"],
    quoters: ["lifi", "0x"],
  },
  
  // Layer 2s and Sidechains
  100: {
    name: "Gnosis",
    nativeCurrency: "DAI",
    rpcUrls: ["https://rpc.gnosischain.com"],
    quoters: ["lifi", "0x"],
  },
  1284: {
    name: "Moonbeam",
    nativeCurrency: "GLMR",
    rpcUrls: ["https://rpc.api.moonbeam.network"],
    quoters: ["lifi"],
  },
  1285: {
    name: "Moonriver",
    nativeCurrency: "MOVR",
    rpcUrls: ["https://rpc.api.moonriver.moonbeam.network"],
    quoters: ["lifi"],
  },
  1313161554: {
    name: "Aurora",
    nativeCurrency: "ETH",
    rpcUrls: ["https://mainnet.aurora.dev"],
    quoters: ["lifi"],
  },
  42220: {
    name: "Celo",
    nativeCurrency: "CELO",
    rpcUrls: ["https://forno.celo.org"],
    quoters: ["lifi", "0x"],
  },
  
  // zkEVM Chains
  324: {
    name: "zkSync",
    nativeCurrency: "ETH",
    rpcUrls: ["https://mainnet.era.zksync.io"],
    quoters: ["lifi"],
  },
  1101: {
    name: "Polygon zkEVM",
    nativeCurrency: "ETH",
    rpcUrls: ["https://zkevm-rpc.com"],
    quoters: ["lifi"],
  },
  534352: {
    name: "Scroll",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.scroll.io"],
    quoters: ["lifi"],
  },
  59144: {
    name: "Linea",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.linea.build"],
    quoters: ["lifi"],
  },
  
  // Newer Chains
  81457: {
    name: "Blast",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.blast.io"],
    quoters: ["lifi"],
  },
  34443: {
    name: "Mode",
    nativeCurrency: "ETH",
    rpcUrls: ["https://mainnet.mode.network"],
    quoters: ["lifi"],
  },
  167000: {
    name: "Taiko",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.taiko.xyz"],
    quoters: ["lifi"],
  },
  5000: {
    name: "Mantle",
    nativeCurrency: "MNT",
    rpcUrls: ["https://rpc.mantle.xyz"],
    quoters: ["lifi"],
  },
  
  // Alternative L1s
  25: {
    name: "Cronos",
    nativeCurrency: "CRO",
    rpcUrls: ["https://evm.cronos.org"],
    quoters: ["lifi"],
  },
  122: {
    name: "FUSE",
    nativeCurrency: "FUSE",
    rpcUrls: ["https://rpc.fuse.io"],
    quoters: ["lifi"],
  },
  288: {
    name: "Boba",
    nativeCurrency: "ETH",
    rpcUrls: ["https://mainnet.boba.network"],
    quoters: ["lifi"],
  },
  1088: {
    name: "Metis",
    nativeCurrency: "METIS",
    rpcUrls: ["https://andromeda.metis.io/?owner=1088"],
    quoters: ["lifi"],
  },
  8217: {
    name: "Kaia",
    nativeCurrency: "KLAY",
    rpcUrls: ["https://public-node-api.klaytn.com/v1/cypress"],
    quoters: ["lifi"],
  },
  
  // New/Emerging Chains
  146: {
    name: "Sonic",
    nativeCurrency: "S",
    rpcUrls: ["https://rpc.sonic.game"],
    quoters: ["lifi"],
  },
  204: {
    name: "opBNB",
    nativeCurrency: "BNB",
    rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
    quoters: ["lifi"],
  },
  232: {
    name: "Lens",
    nativeCurrency: "GHO",
    rpcUrls: ["https://rpc.lens.dev"],
    quoters: ["lifi"],
  },
  480: {
    name: "World Chain",
    nativeCurrency: "ETH",
    rpcUrls: ["https://worldchain-mainnet.g.alchemy.com/public"],
    quoters: ["lifi"],
  },
  999: {
    name: "HyperEVM",
    nativeCurrency: "HYPE",
    rpcUrls: ["https://rpc.hyperliquid.xyz"],
    quoters: ["lifi"],
  },
  1135: {
    name: "Lisk",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.api.lisk.com"],
    quoters: ["lifi"],
  },
  1329: {
    name: "Sei",
    nativeCurrency: "SEI",
    rpcUrls: ["https://evm-rpc.sei-apis.com"],
    quoters: ["lifi"],
  },
  1625: {
    name: "Gravity",
    nativeCurrency: "G",
    rpcUrls: ["https://rpc.gravity.xyz"],
    quoters: ["lifi"],
  },
  1868: {
    name: "Soneium",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.soneium.org"],
    quoters: ["lifi"],
  },
  1923: {
    name: "Swellchain",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.swellnetwork.io"],
    quoters: ["lifi"],
  },
  2741: {
    name: "Abstract",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.abs.xyz"],
    quoters: ["lifi"],
  },
  13371: {
    name: "Immutable zkEVM",
    nativeCurrency: "IMX",
    rpcUrls: ["https://rpc.immutable.com"],
    quoters: ["lifi"],
  },
  21000000: {
    name: "Corn",
    nativeCurrency: "BTCN",
    rpcUrls: ["https://rpc.corn.fi"],
    quoters: ["lifi"],
  },
  30: {
    name: "Rootstock",
    nativeCurrency: "RBTC",
    rpcUrls: ["https://public-node.rsk.co"],
    quoters: ["lifi"],
  },
  33139: {
    name: "Apechain",
    nativeCurrency: "APE",
    rpcUrls: ["https://rpc.apechain.com"],
    quoters: ["lifi"],
  },
  50: {
    name: "XDC",
    nativeCurrency: "XDC",
    rpcUrls: ["https://erpc.xinfin.network"],
    quoters: ["lifi"],
  },
  55244: {
    name: "Superposition",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.superposition.so"],
    quoters: ["lifi"],
  },
  57073: {
    name: "Ink",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc-gel.inkonchain.com"],
    quoters: ["lifi"],
  },
  60808: {
    name: "BOB",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.gobob.xyz"],
    quoters: ["lifi"],
  },
  80094: {
    name: "Berachain",
    nativeCurrency: "BERA",
    rpcUrls: ["https://bera-testnet.nodeinfra.com"],
    quoters: ["lifi"],
  },
  130: {
    name: "Unichain",
    nativeCurrency: "ETH",
    rpcUrls: ["https://rpc.unichain.org"],
    quoters: ["lifi"],
  },
  
  // Non-EVM Chains (for reference - handled differently)
  195: {
    name: "Tron",
    nativeCurrency: "TRX",
    rpcUrls: ["https://api.trongrid.io"],
    quoters: ["lifi", "justswap"],
  },
  101: {
    name: "Solana",
    nativeCurrency: "SOL",
    rpcUrls: ["https://api.mainnet-beta.solana.com"],
    quoters: ["lifi", "jupiter"],
  },
};

// API configurations
const API_CONFIG = {
  // OpenOcean API v3 (multi-chain with enhanced support)
  openOcean: {
    baseUrl: "https://open-api.openocean.finance/v3",
    chains: [1, 56, 137, 42161, 10, 43114, 250, 195], // Including Tron
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  },

  // Paraswap API (Ethereum, Polygon, BSC, Avalanche)
  paraswap: {
    baseUrl: "https://apiv5.paraswap.io",
    chains: [1, 137, 56, 43114],
    headers: {
      "Content-Type": "application/json",
    },
  },

  // PancakeSwap API (BSC)
  pancakeswap: {
    baseUrl: "https://api.pancakeswap.info/api/v2",
    chains: [56],
  },

  // Jupiter API (Solana)
  jupiter: {
    baseUrl: "https://lite-api.jup.ag/swap/v1",
    chains: [101],
  },

  // JustSwap API (Tron)
  justswap: {
    baseUrl: "https://api.justswap.org/v1",
    chains: [195],
  },
};

export class MultiChainQuoteService {
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { chainId } = request;
    const chainConfig = CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG];

    if (!chainConfig) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    // Try different quote sources in order of preference
    const quoters = chainConfig.quoters;
    let lastError: Error | null = null;

    for (const quoter of quoters) {
      try {
        console.log(`Trying ${quoter} for chain ${chainId}...`);
        const quote = await this.getQuoteFromSource(quoter, request);
        if (quote && this.validateQuote(quote, request)) {
          console.log(`Successfully got valid quote from ${quoter}`);
          return quote;
        }
      } catch (error) {
        console.log(`${quoter} failed:`, (error as Error).message);
        lastError = error as Error;
        continue;
      }
    }

    // Try fallback rates as last resort
    try {
      const fallbackQuote = await this.getFallbackQuote(request);
      if (this.validateQuote(fallbackQuote, request)) {
        return fallbackQuote;
      }
      throw new Error("Invalid fallback quote");
    } catch (fallbackError) {
      throw lastError || fallbackError;
    }
  }

  /**
   * Validates a quote response to ensure it meets health check criteria
   */
  private validateQuote(
    quote: QuoteResponse | null,
    request: QuoteRequest
  ): boolean {
    if (!quote) return false;

    // Check 1: Quote must have a non-zero buyAmount
    const buyAmount = BigInt(quote.buyAmount || "0");
    if (buyAmount <= 0n) {
      console.warn("Quote validation failed: zero or negative buyAmount");
      return false;
    }

    // Check 2: Price impact should be reasonable (less than 50%)
    if (quote.priceImpact && quote.priceImpact > 50) {
      console.warn(
        "Quote validation failed: price impact too high",
        quote.priceImpact
      );
      return false;
    }

    // Check 3: Source must be defined
    if (!quote.source) {
      console.warn("Quote validation failed: no source specified");
      return false;
    }

    // Check 4: For on-chain quotes, verify required fields
    if (quote.to && quote.data) {
      // Validate ethereum address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(quote.to)) {
        console.warn("Quote validation failed: invalid to address");
        return false;
      }

      // Validate data is hex
      if (!/^0x[a-fA-F0-9]*$/.test(quote.data)) {
        console.warn("Quote validation failed: invalid transaction data");
        return false;
      }
    }

    // Check 5: Reasonable exchange rate (prevent extreme outliers)
    // Skip rate validation for now - tokens have different decimals
    // This check is too simplistic and causes valid quotes to fail
    // TODO: Implement proper decimal-aware rate validation

    return true;
  }

  private async getQuoteFromSource(
    source: string,
    request: QuoteRequest
  ): Promise<QuoteResponse | null> {
    switch (source) {
      case "lifi":
        return this.getLiFiQuote(request);
      case "0x":
        return this.get0xQuote(request);
      case "uniswap":
        return this.getUniswapQuote(request);
      case "jupiter":
        return this.getJupiterQuote(request);
      case "justswap":
        return this.getJustSwapQuote(request);
      default:
        throw new Error(`Quote source ${source} not supported`);
    }
  }

  // LiFi API integration (Primary quote source)
  private async getLiFiQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { chainId, sellToken, buyToken, sellAmount, slippage = 1 } = request;
    
    try {
      console.log('Trying LiFi for quote...');
      console.log('LIFI_API_KEY available:', !!process.env.LIFI_API_KEY);

      // Check rate limit before making request
      const rateLimitResult = lifiRateLimitService.canMakeRequest(process.env.LIFI_API_KEY);
      if (!rateLimitResult.allowed) {
        const waitTime = Math.ceil((rateLimitResult.retryAfter || 0) / 1000);
        throw new Error(`LiFi API rate limit exceeded. Try again in ${waitTime} seconds.`);
      }
      
      // Import getRoutes from LiFi SDK
      const { getRoutes } = require('@lifi/sdk');
      
      // Detect if this is a cross-chain swap by checking if tokens are from different chains
      const toChainId = request.toChainId || chainId;
      const isCrossChain = toChainId !== chainId;
      
      // For cross-chain swaps, we need to map the tokens to the correct addresses on their respective chains
      let mappedSellToken = sellToken;
      let mappedBuyToken = buyToken;
      
      if (isCrossChain) {
        // First, ensure the sell token exists on the source chain
        const sellTokenExists = await CrossChainTokenResolver.tokenExistsOnChain(sellToken, chainId);
        if (!sellTokenExists && sellToken.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
          console.warn(`Sell token ${sellToken} not found on chain ${chainId}, attempting resolution...`);
          // Try to find the correct address for this token on the source chain
          const resolvedSellToken = await CrossChainTokenResolver.resolveTokenAddress(sellToken, 1, chainId); // Assume it might be an Ethereum address
          if (resolvedSellToken) {
            mappedSellToken = resolvedSellToken;
            console.log(`Resolved sell token to ${mappedSellToken} on chain ${chainId}`);
          }
        }
        
        // Now handle the buy token on the destination chain
        try {
          // Check if this is a same-token cross-chain swap (e.g., USDC on chain A to USDC on chain B)
          const sellTokenInfo = await CrossChainTokenResolver.getTokenInfo(mappedSellToken, chainId);
          const isSameTokenSwap = sellTokenInfo && buyToken.toLowerCase() === sellToken.toLowerCase();
          
          if (isSameTokenSwap) {
            // Same token swap - find the equivalent token on destination chain
            const resolvedBuyToken = await CrossChainTokenResolver.resolveTokenAddress(sellToken, chainId, toChainId);
            if (resolvedBuyToken) {
              mappedBuyToken = resolvedBuyToken;
              console.log(`Same-token cross-chain resolution: ${sellToken} on chain ${chainId} -> ${mappedBuyToken} on chain ${toChainId}`);
            } else {
              console.warn(`Cannot find ${sellTokenInfo.symbol} on chain ${toChainId}`);
              // Keep original buy token - might be native token or user error
            }
          } else {
            // Different token swap - verify the buy token exists on destination chain
            const buyTokenExists = await CrossChainTokenResolver.tokenExistsOnChain(buyToken, toChainId);
            if (!buyTokenExists && buyToken.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
              console.warn(`Buy token ${buyToken} not found on chain ${toChainId}`);
              
              // Try to resolve the buy token - it might be using wrong chain's address
              const buyTokenInfo = await CrossChainTokenResolver.getTokenInfo(buyToken, chainId);
              if (buyTokenInfo) {
                // Token exists on source chain, find it on destination chain
                const resolvedToken = await CrossChainTokenResolver.resolveTokenAddress(buyToken, chainId, toChainId);
                if (resolvedToken) {
                  mappedBuyToken = resolvedToken;
                  console.log(`Resolved buy token ${buyTokenInfo.symbol} to ${mappedBuyToken} on chain ${toChainId}`);
                } else {
                  console.warn(`Token ${buyTokenInfo.symbol} not available on chain ${toChainId}`);
                }
              }
            }
            console.log(`Cross-chain swap: ${sellTokenInfo?.symbol || 'Unknown'} on chain ${chainId} -> different token on chain ${toChainId}`);
            
            // Log the final token addresses being used
            const buyTokenInfoFinal = await CrossChainTokenResolver.getTokenInfo(mappedBuyToken, toChainId);
            console.log(`Final token mapping: ${mappedSellToken} (${sellTokenInfo?.symbol || 'Unknown'}) on chain ${chainId} -> ${mappedBuyToken} (${buyTokenInfoFinal?.symbol || 'Unknown'}) on chain ${toChainId}`);
          }
        } catch (error) {
          console.error('Error resolving cross-chain tokens:', error);
          // Fall back to original behavior
          mappedBuyToken = buyToken;
        }
      } else {
        // For same-chain swaps, just verify tokens exist
        const [sellTokenInfo, buyTokenInfo] = await Promise.all([
          CrossChainTokenResolver.getTokenInfo(sellToken, chainId),
          CrossChainTokenResolver.getTokenInfo(buyToken, chainId)
        ]);
        
        if (!sellTokenInfo && sellToken.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
          console.warn(`Sell token ${sellToken} not found on chain ${chainId}`);
        }
        if (!buyTokenInfo && buyToken.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
          console.warn(`Buy token ${buyToken} not found on chain ${chainId}`);
        }
      }
      
      // Check cache first
      const cacheParams = {
        fromChainId: chainId,
        toChainId: toChainId,
        fromTokenAddress: mappedSellToken,
        toTokenAddress: mappedBuyToken,
        fromAmount: sellAmount
      };
      
      const cachedQuote = lifiRateLimitService.getCachedQuote(cacheParams);
      if (cachedQuote) {
        console.log('Returning cached LiFi quote');
        return cachedQuote;
      }

      // Use getRoutes which is more flexible than getQuote
      const routeRequest = {
        fromChainId: chainId,
        toChainId: toChainId,
        fromTokenAddress: mappedSellToken, // Use the mapped sell token address
        toTokenAddress: mappedBuyToken, // Use the mapped buy token address
        fromAmount: sellAmount,
        options: {
          slippage: slippage / 100, // Convert percentage to decimal
          allowSwitchChain: isCrossChain, // Enable chain switching for cross-chain
          bridges: isCrossChain ? {
            allow: ['hop', 'cbridge', 'stargate', 'across', 'optimism', 'polygon', 'arbitrum', 'gnosis', 'multichain']
          } : {
            allow: [] // No bridges for same-chain swaps
          },
          integrator: 'multi-chain-swap', // Add integrator
          apiKey: process.env.LIFI_API_KEY // Use API key from env
        }
      };
      
      console.log('LiFi route request:', JSON.stringify({...routeRequest, options: {...routeRequest.options, apiKey: 'hidden'}}));
      const result = await getRoutes(routeRequest);
      console.log('LiFi result:', result.routes?.length || 0, 'routes found');
      
      if (!result.routes || result.routes.length === 0) {
        // Provide more context about why no routes are available
        if (isCrossChain) {
          const sourceChainName = CHAIN_CONFIG[chainId]?.name || `Chain ${chainId}`;
          const destChainName = CHAIN_CONFIG[toChainId]?.name || `Chain ${toChainId}`;
          throw new Error(
            `No cross-chain routes available from ${sourceChainName} to ${destChainName}. ` +
            `This could mean: 1) The token pair lacks liquidity on bridges, ` +
            `2) The destination token doesn't exist on ${destChainName}, or ` +
            `3) No bridges currently support this route. Try a different token pair or check token availability.`
          );
        } else {
          throw new Error('No swap routes available for this token pair. The tokens may lack liquidity or be incompatible.');
        }
      }
      
      // Get the best route (first one is usually the best)
      const bestRoute = result.routes[0];
      
      console.log('LiFi route details:', {
        id: bestRoute.id,
        fromAmount: bestRoute.fromAmount,
        toAmount: bestRoute.toAmount,
        toAmountMin: bestRoute.toAmountMin,
        steps: bestRoute.steps?.length || 0,
        tool: bestRoute.steps?.[0]?.tool
      });
      
      console.log('LiFi - returning quote with buyAmount:', bestRoute.toAmount);
      
      // Calculate total gas estimate
      let totalGas = '0';
      if (bestRoute.steps) {
        bestRoute.steps.forEach(step => {
          if (step.estimate?.gasCosts) {
            step.estimate.gasCosts.forEach(gasCost => {
              totalGas = (BigInt(totalGas) + BigInt(gasCost.amount || '0')).toString();
            });
          }
        });
      }
      
      const quoteResponse = {
        buyAmount: bestRoute.toAmount,
        source: 'LiFi',
        estimatedGas: totalGas || '200000',
        priceImpact: bestRoute.steps?.[0]?.estimate?.slippage || 0,
        route: bestRoute.steps,
        minReceived: bestRoute.toAmountMin,
        to: bestRoute.steps?.[0]?.estimate?.approvalAddress || '0x0000000000000000000000000000000000000000',
        data: bestRoute.steps?.[0]?.transactionRequest?.data || '0x',
        value: bestRoute.steps?.[0]?.transactionRequest?.value || '0',
        gas: totalGas || '200000',
        gasPrice: '5000000000', // 5 gwei default
        price: Number(ethers.formatUnits(bestRoute.toAmount, 18)) / Number(ethers.formatUnits(sellAmount, 18)),
        sources: [{name: 'LiFi', proportion: '1'}]
      };

      // Cache the quote response
      lifiRateLimitService.cacheQuote(cacheParams, quoteResponse);
      
      return quoteResponse;
    } catch (error: any) {
      console.log('LiFi error:', error.message);
      
      // Handle rate limit specifically
      if (error.response?.status === 429 || error.message.includes('rate limit')) {
        console.log('LiFi rate limit detected, updating rate limiter');
        
        // Extract retry-after from headers if available
        const retryAfter = error.response?.headers?.['retry-after'];
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter) : 7100; // Default to 2 hours as mentioned in error
        
        lifiRateLimitService.handleRateLimit(retryAfterSeconds, process.env.LIFI_API_KEY);
        
        throw new Error(`LiFi API rate limit exceeded. Retry after ${Math.ceil(retryAfterSeconds / 60)} minutes.`);
      }
      
      if (error.response?.data) {
        console.log('LiFi error details:', JSON.stringify(error.response.data));
      }
      throw error;
    }
  }

  // 0x API integration (FREE - no API key required)
  private async get0xQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { chainId, sellToken, buyToken, sellAmount, slippage = 1 } = request;

    // 0x API endpoints for different chains
    const zeroXEndpoints: Record<number, string> = {
      1: "https://api.0x.org",
      56: "https://bsc.api.0x.org",
      137: "https://polygon.api.0x.org",
      42161: "https://arbitrum.api.0x.org",
      10: "https://optimism.api.0x.org",
      43114: "https://avalanche.api.0x.org",
    };

    const baseUrl = zeroXEndpoints[chainId];
    if (!baseUrl) {
      throw new Error(`0x API not available for chain ${chainId}`);
    }

    const url = `${baseUrl}/swap/v1/quote`;
    const params = new URLSearchParams({
      sellToken,
      buyToken,
      sellAmount,
      slippagePercentage: slippage.toString(),
    });

    // Add optional API key if available
    const headers: any = {
      Accept: "application/json",
    };

    if (process.env.ZEROX_API_KEY) {
      headers["0x-api-key"] = process.env.ZEROX_API_KEY;
      console.log(
        "Using 0x API key:",
        process.env.ZEROX_API_KEY.substring(0, 8) + "..."
      );
    } else {
      console.log("WARNING: No ZEROX_API_KEY found in environment");
    }

    try {
      const response = await fetch(`${url}?${params}`, {
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("0x API unauthorized - API key may be required");
        }
        if (response.status === 429) {
          throw new Error("0x API rate limit exceeded");
        }
        throw new Error(`0x API error: ${response.statusText}`);
      }

      const data = await response.json();

      console.log("Successfully got quote from 0x Protocol");

      return {
        buyAmount: data.buyAmount,
        source: "0x Protocol",
        estimatedGas: data.estimatedGas,
        price: data.price,
        to: data.to,
        data: data.data,
        value: data.value,
        gasPrice: data.gasPrice,
      };
    } catch (error) {
      if (process.env.DEBUG) {
        console.error("0x API error:", error);
      }
      throw error;
    }
  }

  // OpenOcean API v3 integration with enhanced support
  private async getOpenOceanQuote(
    request: QuoteRequest
  ): Promise<QuoteResponse> {
    const { chainId, sellToken, buyToken, sellAmount, slippage = 1 } = request;

    if (!API_CONFIG.openOcean.chains.includes(chainId)) {
      throw new Error(`OpenOcean not available for chain ${chainId}`);
    }

    // Map our chain IDs to OpenOcean chain identifiers
    const chainMapping: Record<number, string> = {
      1: "eth",
      56: "bsc",
      137: "polygon",
      42161: "arbitrum",
      10: "optimism",
      43114: "avax",
      250: "fantom",
      195: "tron",
    };

    const openOceanChain = chainMapping[chainId];
    if (!openOceanChain) {
      throw new Error(`OpenOcean chain mapping not found for ${chainId}`);
    }

    const url = `${API_CONFIG.openOcean.baseUrl}/${openOceanChain}/quote`;

    // The sellAmount is already a parsed bigint string, no need to parse again
    const adjustedAmount = sellAmount;

    const params = new URLSearchParams({
      inTokenAddress: sellToken,
      outTokenAddress: buyToken,
      amount: adjustedAmount,
      slippage: slippage.toString(),
      gasPrice: "5",
      account: "0x0000000000000000000000000000000000000001", // Dummy account for quotes
    });

    // Only log on debug mode
    if (process.env.DEBUG) {
      console.log(`OpenOcean API call: ${url}?${params}`);
    }

    const response = await fetch(`${url}?${params}`, {
      headers: API_CONFIG.openOcean.headers,
      method: "GET",
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (process.env.DEBUG) {
        console.error("OpenOcean API error response:", errorText);
      }

      if (response.status === 400) {
        throw new Error(
          "OpenOcean API: Invalid parameters or token pair not supported"
        );
      } else if (response.status === 429) {
        throw new Error("OpenOcean API: Rate limit exceeded");
      }

      throw new Error(
        `OpenOcean API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Check for API-specific error responses
    if (data.code !== 200 && data.msg) {
      throw new Error(`OpenOcean API: ${data.msg}`);
    }

    if (!data.data || !data.data.outAmount) {
      if (process.env.DEBUG) {
        console.log("OpenOcean response:", JSON.stringify(data, null, 2));
      }

      // Check if it's a liquidity issue
      if (data.msg && data.msg.includes("liquidity")) {
        throw new Error("OpenOcean API: Insufficient liquidity for this pair");
      }

      throw new Error("OpenOcean API: No quote amount returned");
    }

    return {
      buyAmount: data.data.outAmount,
      source: `OpenOcean (${openOceanChain})`,
      estimatedGas: data.data.estimatedGas,
      priceImpact: parseFloat(data.data.priceImpact || "0"),
      route: data.data.path,
    };
  }

  // Paraswap API integration
  private async getParaswapQuote(
    request: QuoteRequest
  ): Promise<QuoteResponse> {
    const { chainId, sellToken, buyToken, sellAmount } = request;

    if (!API_CONFIG.paraswap.chains.includes(chainId)) {
      throw new Error(`Paraswap not available for chain ${chainId}`);
    }

    const url = `${API_CONFIG.paraswap.baseUrl}/prices`;
    const params = new URLSearchParams({
      srcToken: sellToken,
      destToken: buyToken,
      amount: sellAmount, // Already parsed
      network: chainId.toString(),
      side: "SELL",
    });

    const response = await fetch(`${url}?${params}`, {
      headers: API_CONFIG.paraswap.headers,
    });

    if (!response.ok) {
      throw new Error(`Paraswap API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      buyAmount: data.priceRoute.destAmount,
      source: "Paraswap",
      route: data.priceRoute.bestRoute,
    };
  }

  // Jupiter API (Solana)
  private async getJupiterQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { sellToken, buyToken, sellAmount, slippage = 1 } = request;

    const url = `${API_CONFIG.jupiter.baseUrl}/quote`;
    const params = new URLSearchParams({
      inputMint: sellToken,
      outputMint: buyToken,
      amount: ethers.parseUnits(ethers.formatUnits(sellAmount, 18), 9).toString(), // Convert from 18 to 9 decimals for Solana
      slippageBps: (slippage * 100).toString(),
      swapMode: "ExactIn",
    });

    const response = await fetch(`${url}?${params}`);

    if (!response.ok) {
      throw new Error(`Jupiter API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      buyAmount: data.outAmount,
      source: "Jupiter",
      priceImpact: parseFloat(data.priceImpactPct || "0"),
      route: data.routePlan,
    };
  }

  // Uniswap V3 (existing implementation)
  private async getUniswapQuote(request: QuoteRequest): Promise<QuoteResponse> {
    // Use existing Uniswap V3 quoter logic
    const { chainId, sellToken, buyToken, sellAmount } = request;

    const QUOTER_ADDRESSES: Record<number, string> = {
      1: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
      42161: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
      137: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
      10: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
    };

    if (!QUOTER_ADDRESSES[chainId]) {
      throw new Error(`Uniswap not available for chain ${chainId}`);
    }

    // Uniswap requires on-chain calls which are not implemented
    throw new Error(
      "Uniswap quotes require on-chain integration - use external APIs instead"
    );
  }

  // PancakeSwap (BSC)
  private async getPancakeSwapQuote(
    request: QuoteRequest
  ): Promise<QuoteResponse> {
    // PancakeSwap doesn't have a direct quote API, so we'll use their router contract
    throw new Error(
      "PancakeSwap quotes require on-chain calls - using 1inch/OpenOcean instead"
    );
  }

  // QuickSwap (Polygon)
  private async getQuickSwapQuote(
    request: QuoteRequest
  ): Promise<QuoteResponse> {
    // Similar to PancakeSwap, use aggregators
    throw new Error(
      "QuickSwap quotes require on-chain calls - using 1inch/OpenOcean instead"
    );
  }

  // TraderJoe (Avalanche)
  private async getTraderJoeQuote(
    request: QuoteRequest
  ): Promise<QuoteResponse> {
    throw new Error(
      "TraderJoe quotes require on-chain calls - using 1inch/OpenOcean instead"
    );
  }

  // JustSwap (Tron)
  private async getJustSwapQuote(
    request: QuoteRequest
  ): Promise<QuoteResponse> {
    // JustSwap API would go here - using OpenOcean for now
    throw new Error(
      "JustSwap API integration pending - using OpenOcean instead"
    );
  }

  // No fallback quotes - only use real external APIs
  private async getFallbackQuote(
    _request: QuoteRequest
  ): Promise<QuoteResponse> {
    throw new Error(
      "No external quote providers available for this token pair. Please try again later when APIs are available."
    );
  }
}

export const multiChainQuoteService = new MultiChainQuoteService();
