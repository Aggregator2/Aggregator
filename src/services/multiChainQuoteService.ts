import { ethers } from 'ethers';

export interface QuoteRequest {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  chainId: number;
  slippage?: number;
}

export interface QuoteResponse {
  buyAmount: string;
  source: string;
  estimatedGas?: string;
  priceImpact?: number;
  route?: any[];
  allowanceTarget?: string;
}

// Chain configurations
export const CHAIN_CONFIG = {
  1: { // Ethereum
    name: 'Ethereum',
    nativeCurrency: 'ETH',
    rpcUrls: [
      process.env.ETHEREUM_RPC || 'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
      'https://ethereum.publicnode.com'
    ],
    quoters: ['uniswap', '1inch', 'paraswap', 'openocean']
  },
  56: { // BSC
    name: 'BSC',
    nativeCurrency: 'BNB',
    rpcUrls: [
      'https://bsc-dataseed1.binance.org',
      'https://rpc.ankr.com/bsc'
    ],
    quoters: ['pancakeswap', '1inch', 'openocean']
  },
  137: { // Polygon
    name: 'Polygon',
    nativeCurrency: 'MATIC',
    rpcUrls: [
      'https://polygon-rpc.com',
      'https://rpc.ankr.com/polygon'
    ],
    quoters: ['quickswap', '1inch', 'openocean']
  },
  42161: { // Arbitrum
    name: 'Arbitrum',
    nativeCurrency: 'ETH',
    rpcUrls: [
      process.env.ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-one.publicnode.com'
    ],
    quoters: ['uniswap', '1inch', 'openocean']
  },
  10: { // Optimism
    name: 'Optimism',
    nativeCurrency: 'ETH',
    rpcUrls: [
      'https://mainnet.optimism.io',
      'https://rpc.ankr.com/optimism'
    ],
    quoters: ['uniswap', '1inch', 'openocean']
  },
  43114: { // Avalanche
    name: 'Avalanche',
    nativeCurrency: 'AVAX',
    rpcUrls: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://rpc.ankr.com/avalanche'
    ],
    quoters: ['traderjoe', '1inch', 'openocean']
  },
  250: { // Fantom
    name: 'Fantom',
    nativeCurrency: 'FTM',
    rpcUrls: [
      'https://rpc.ftm.tools',
      'https://rpc.ankr.com/fantom'
    ],
    quoters: ['spookyswap', 'openocean']
  },
  // Tron (195 - custom ID for Tron)
  195: {
    name: 'Tron',
    nativeCurrency: 'TRX',
    rpcUrls: ['https://api.trongrid.io'],
    quoters: ['justswap', 'openocean']
  },
  // Solana (101)
  101: {
    name: 'Solana',
    nativeCurrency: 'SOL',
    rpcUrls: ['https://api.mainnet-beta.solana.com'],
    quoters: ['jupiter', 'openocean']
  }
};

// API configurations
const API_CONFIG = {
  // 1inch API (supports multiple chains) - Enhanced with proper authentication
  oneInch: {
    baseUrl: 'https://api.1inch.dev/swap/v6.0',
    chains: [1, 56, 137, 42161, 10, 43114, 250],
    headers: {
      'Authorization': process.env.ONEINCH_API_KEY ? `Bearer ${process.env.ONEINCH_API_KEY}` : '',
      'accept': 'application/json',
      'Content-Type': 'application/json'
    }
  },
  
  // OpenOcean API v4 (multi-chain with enhanced support)
  openOcean: {
    baseUrl: 'https://open-api.openocean.finance/v4',
    chains: [1, 56, 137, 42161, 10, 43114, 250, 195], // Including Tron
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  },
  
  // Paraswap API (Ethereum, Polygon, BSC, Avalanche)
  paraswap: {
    baseUrl: 'https://apiv5.paraswap.io',
    chains: [1, 137, 56, 43114],
    headers: {
      'Content-Type': 'application/json'
    }
  },
  
  // PancakeSwap API (BSC)
  pancakeswap: {
    baseUrl: 'https://api.pancakeswap.info/api/v2',
    chains: [56]
  },
  
  // Jupiter API (Solana)
  jupiter: {
    baseUrl: 'https://quote-api.jup.ag/v6',
    chains: [101]
  },
  
  // JustSwap API (Tron)
  justswap: {
    baseUrl: 'https://api.justswap.org/v1',
    chains: [195]
  }
};

export class MultiChainQuoteService {
  
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { chainId } = request;
    const chainConfig = CHAIN_CONFIG[chainId];
    
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
        if (quote) {
          return quote;
        }
      } catch (error) {
        console.warn(`${quoter} failed for chain ${chainId}:`, error);
        lastError = error as Error;
        continue;
      }
    }
    
    // Try fallback rates as last resort
    try {
      return await this.getFallbackQuote(request);
    } catch (fallbackError) {
      throw lastError || fallbackError;
    }
  }
  
  private async getQuoteFromSource(source: string, request: QuoteRequest): Promise<QuoteResponse | null> {
    switch (source) {
      case '1inch':
        return this.get1inchQuote(request);
      case 'openocean':
        return this.getOpenOceanQuote(request);
      case 'paraswap':
        return this.getParaswapQuote(request);
      case 'uniswap':
        return this.getUniswapQuote(request);
      case 'pancakeswap':
        return this.getPancakeSwapQuote(request);
      case 'quickswap':
        return this.getQuickSwapQuote(request);
      case 'traderjoe':
        return this.getTraderJoeQuote(request);
      case 'jupiter':
        return this.getJupiterQuote(request);
      case 'justswap':
        return this.getJustSwapQuote(request);
      default:
        return null;
    }
  }
  
  // 1inch API integration with enhanced error handling
  private async get1inchQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { chainId, sellToken, buyToken, sellAmount, slippage = 1 } = request;
    
    if (!API_CONFIG.oneInch.chains.includes(chainId)) {
      throw new Error(`1inch not available for chain ${chainId}`);
    }

    // Check if API key is available
    if (!process.env.ONEINCH_API_KEY) {
      throw new Error('1inch API key not configured');
    }
    
    const url = `${API_CONFIG.oneInch.baseUrl}/${chainId}/quote`;
    const params = new URLSearchParams({
      src: sellToken,
      dst: buyToken,
      amount: ethers.parseUnits(sellAmount, 18).toString(),
      fee: '0',
      slippage: slippage.toString(),
      includeTokensInfo: 'true',
      includeProtocols: 'true'
    });
    
    console.log(`1inch API call: ${url}?${params}`);
    
    const response = await fetch(`${url}?${params}`, {
      headers: API_CONFIG.oneInch.headers,
      method: 'GET'
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('1inch API error response:', errorText);
      
      if (response.status === 401) {
        throw new Error('1inch API: Invalid API key');
      } else if (response.status === 429) {
        throw new Error('1inch API: Rate limit exceeded');
      } else if (response.status === 400) {
        throw new Error('1inch API: Invalid request parameters');
      }
      
      throw new Error(`1inch API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.dstAmount) {
      throw new Error('1inch API: No quote amount returned');
    }
    
    return {
      buyAmount: data.dstAmount,
      source: '1inch',
      estimatedGas: data.estimatedGas,
      priceImpact: parseFloat(data.priceImpact || '0'),
      allowanceTarget: data.to,
      route: data.protocols
    };
  }
  
  // OpenOcean API v4 integration with enhanced support
  private async getOpenOceanQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { chainId, sellToken, buyToken, sellAmount, slippage = 1 } = request;
    
    if (!API_CONFIG.openOcean.chains.includes(chainId)) {
      throw new Error(`OpenOcean not available for chain ${chainId}`);
    }
    
    // Map our chain IDs to OpenOcean chain identifiers
    const chainMapping: Record<number, string> = {
      1: 'eth',
      56: 'bsc', 
      137: 'polygon',
      42161: 'arbitrum',
      10: 'optimism',
      43114: 'avax',
      250: 'fantom',
      195: 'tron'
    };
    
    const openOceanChain = chainMapping[chainId];
    if (!openOceanChain) {
      throw new Error(`OpenOcean chain mapping not found for ${chainId}`);
    }
    
    const url = `${API_CONFIG.openOcean.baseUrl}/${openOceanChain}/quote`;
    
    // Adjust amount based on chain (Tron uses different decimals)
    let adjustedAmount: string;
    if (chainId === 195) { // Tron
      adjustedAmount = (parseFloat(sellAmount) * 1e6).toString(); // TRX uses 6 decimals
    } else if (chainId === 101) { // Solana
      adjustedAmount = (parseFloat(sellAmount) * 1e9).toString(); // SOL uses 9 decimals
    } else {
      adjustedAmount = ethers.parseUnits(sellAmount, 18).toString();
    }
    
    const params = new URLSearchParams({
      inTokenAddress: sellToken,
      outTokenAddress: buyToken,
      amount: adjustedAmount,
      slippage: slippage.toString(),
      gasPrice: '5',
      account: '0x0000000000000000000000000000000000000001' // Dummy account for quotes
    });
    
    console.log(`OpenOcean API call: ${url}?${params}`);
    
    const response = await fetch(`${url}?${params}`, {
      headers: API_CONFIG.openOcean.headers,
      method: 'GET'
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenOcean API error response:', errorText);
      
      if (response.status === 400) {
        throw new Error('OpenOcean API: Invalid parameters or token pair not supported');
      } else if (response.status === 429) {
        throw new Error('OpenOcean API: Rate limit exceeded');
      }
      
      throw new Error(`OpenOcean API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.data || !data.data.outAmount) {
      throw new Error('OpenOcean API: No quote amount returned');
    }
    
    return {
      buyAmount: data.data.outAmount,
      source: `OpenOcean (${openOceanChain})`,
      estimatedGas: data.data.estimatedGas,
      priceImpact: parseFloat(data.data.priceImpact || '0'),
      route: data.data.path
    };
  }
  
  // Paraswap API integration
  private async getParaswapQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { chainId, sellToken, buyToken, sellAmount } = request;
    
    if (!API_CONFIG.paraswap.chains.includes(chainId)) {
      throw new Error(`Paraswap not available for chain ${chainId}`);
    }
    
    const url = `${API_CONFIG.paraswap.baseUrl}/prices`;
    const params = new URLSearchParams({
      srcToken: sellToken,
      destToken: buyToken,
      amount: ethers.parseUnits(sellAmount, 18).toString(),
      network: chainId.toString(),
      side: 'SELL'
    });
    
    const response = await fetch(`${url}?${params}`, {
      headers: API_CONFIG.paraswap.headers
    });
    
    if (!response.ok) {
      throw new Error(`Paraswap API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      buyAmount: data.priceRoute.destAmount,
      source: 'Paraswap',
      route: data.priceRoute.bestRoute
    };
  }
  
  // Jupiter API (Solana)
  private async getJupiterQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { sellToken, buyToken, sellAmount, slippage = 1 } = request;
    
    const url = `${API_CONFIG.jupiter.baseUrl}/quote`;
    const params = new URLSearchParams({
      inputMint: sellToken,
      outputMint: buyToken,
      amount: (parseFloat(sellAmount) * 1e9).toString(), // Solana uses 9 decimals
      slippageBps: (slippage * 100).toString()
    });
    
    const response = await fetch(`${url}?${params}`);
    
    if (!response.ok) {
      throw new Error(`Jupiter API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      buyAmount: data.outAmount,
      source: 'Jupiter',
      priceImpact: parseFloat(data.priceImpactPct || '0'),
      route: data.routePlan
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
    
    // Implementation would use existing Uniswap quoter logic
    throw new Error('Uniswap implementation moved to main quote API');
  }
  
  // PancakeSwap (BSC)
  private async getPancakeSwapQuote(request: QuoteRequest): Promise<QuoteResponse> {
    // PancakeSwap doesn't have a direct quote API, so we'll use their router contract
    throw new Error('PancakeSwap quotes require on-chain calls - using 1inch/OpenOcean instead');
  }
  
  // QuickSwap (Polygon)
  private async getQuickSwapQuote(request: QuoteRequest): Promise<QuoteResponse> {
    // Similar to PancakeSwap, use aggregators
    throw new Error('QuickSwap quotes require on-chain calls - using 1inch/OpenOcean instead');
  }
  
  // TraderJoe (Avalanche)
  private async getTraderJoeQuote(request: QuoteRequest): Promise<QuoteResponse> {
    throw new Error('TraderJoe quotes require on-chain calls - using 1inch/OpenOcean instead');
  }
  
  // JustSwap (Tron)
  private async getJustSwapQuote(request: QuoteRequest): Promise<QuoteResponse> {
    // JustSwap API would go here - using OpenOcean for now
    throw new Error('JustSwap API integration pending - using OpenOcean instead');
  }
  
  // Fallback quote using static rates
  private async getFallbackQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { sellToken, buyToken, sellAmount } = request;
    
    // Comprehensive fallback rates (expanded for all chains)
    const FALLBACK_RATES: Record<string, Record<string, number>> = {
      // Ethereum mainnet
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { // WETH
        "0x6b175474e89094c44da98b954eedeac495271d0f": 2400, // DAI
        "0xa0b86a33e6417a2f0a87c1a8abe4e74b8d6fcb3b6": 2400, // USDC
        "0xdac17f958d2ee523a2206206994597c13d831ec7": 2400, // USDT
      },
      "0x6b175474e89094c44da98b954eedeac495271d0f": { // DAI
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 0.000416, // WETH
        "0xa0b86a33e6417a2f0a87c1a8abe4e74b8d6fcb3b6": 1, // USDC
      },
      
      // BSC
      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": { // WBNB
        "0xe9e7cea3dedca5984780bafc599bd69add087d56": 300, // BUSD
        "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": 300, // USDC
        "0x55d398326f99059ff775485246999027b3197955": 300, // USDT
      },
      "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82": { // CAKE
        "0xe9e7cea3dedca5984780bafc599bd69add087d56": 3, // BUSD
        "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": 3, // USDC
      },
      
      // Polygon
      "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": { // WMATIC
        "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063": 0.8, // DAI
        "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": 0.8, // USDC
        "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": 0.8, // USDT
      },
      "0x831753dd7087cac61ab5644b308642cc1c33dc13": { // QUICK
        "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": 0.05, // USDC
      },
      
      // Avalanche
      "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7": { // WAVAX
        "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7": 15, // USDT
        "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": 15, // USDC
      },
      "0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd": { // JOE
        "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": 0.25, // USDC
      },
      
      // Arbitrum (existing)
      "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": { // WETH
        "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": 2400, // DAI
      },
      
      // Fantom
      "0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83": { // WFTM
        "0x049d68029688eabf473097a2fc38ef61633a3c7a": 2.5, // fUSDT
      },
      "0x841fad6eae12c286d1fd18d1d525dffa75c7effe": { // BOO
        "0x049d68029688eabf473097a2fc38ef61633a3c7a": 1.2, // fUSDT
      },
      
      // Tron (TRC-20 addresses)
      "tr7nhqjekqxgtci8q8zy4pl8otszgjlj6t": { // TRX (native)
        "tr7nhqjekqxgtci8q8zy4pl8otszgjlj6t": 0.06, // USDT-TRC20
      },
      
      // Optimism
      "0x4200000000000000000000000000000000000006": { // WETH
        "0x7f5c764cbc14f9669b88837ca1490cca17c31607": 2400, // USDC
      },
    };
    
    const sellTokenLower = sellToken.toLowerCase();
    const buyTokenLower = buyToken.toLowerCase();
    
    if (FALLBACK_RATES[sellTokenLower]?.[buyTokenLower]) {
      const rate = FALLBACK_RATES[sellTokenLower][buyTokenLower];
      const amountIn = parseFloat(sellAmount);
      
      if (isNaN(amountIn) || amountIn <= 0) {
        throw new Error("Invalid sell amount");
      }
      
      const estimatedOut = amountIn * rate;
      
      if (isNaN(estimatedOut) || estimatedOut <= 0) {
        throw new Error("Invalid rate calculation");
      }
      
      const buyAmountWei = ethers.parseUnits(estimatedOut.toFixed(18), 18);
      
      return {
        buyAmount: buyAmountWei.toString(),
        source: "Fallback Rate"
      };
    }
    
    throw new Error("No quote available for this token pair");
  }
}

export const multiChainQuoteService = new MultiChainQuoteService();