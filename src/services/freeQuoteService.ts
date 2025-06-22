import { Token } from '../types/token';

export interface QuoteSource {
  name: string;
  url: string;
  chains: number[];
  type: 'aggregator' | 'dex';
}

export interface TokenQuote {
  token: Token;
  price: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  source: string;
  timestamp: number;
}

class FreeQuoteService {
  private cache = new Map<string, { data: TokenQuote; timestamp: number }>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  private quoteSources: Record<number, QuoteSource[]> = {
    1: [ // Ethereum
      { name: '0x API', url: 'https://api.0x.org', chains: [1], type: 'aggregator' },
      { name: '1inch', url: 'https://api.1inch.dev/swap/v5.2/1', chains: [1], type: 'aggregator' }
    ],
    56: [ // BSC
      { name: '0x API BSC', url: 'https://bsc.api.0x.org', chains: [56], type: 'aggregator' },
      { name: '1inch BSC', url: 'https://api.1inch.dev/swap/v5.2/56', chains: [56], type: 'aggregator' }
    ],
    137: [ // Polygon
      { name: '0x API Polygon', url: 'https://polygon.api.0x.org', chains: [137], type: 'aggregator' },
      { name: '1inch Polygon', url: 'https://api.1inch.dev/swap/v5.2/137', chains: [137], type: 'aggregator' }
    ],
    42161: [ // Arbitrum
      { name: '0x API Arbitrum', url: 'https://arbitrum.api.0x.org', chains: [42161], type: 'aggregator' }
    ],
    10: [ // Optimism
      { name: '0x API Optimism', url: 'https://optimism.api.0x.org', chains: [10], type: 'aggregator' }
    ],
    43114: [ // Avalanche
      { name: 'Paraswap', url: 'https://api.paraswap.io', chains: [43114], type: 'aggregator' },
      { name: 'OpenOcean', url: 'https://open-api.openocean.finance', chains: [43114], type: 'aggregator' }
    ],
    250: [ // Fantom
      { name: 'OpenOcean Fantom', url: 'https://open-api.openocean.finance', chains: [250], type: 'aggregator' }
    ],
    101: [ // Solana
      { name: 'Jupiter', url: 'https://quote-api.jup.ag', chains: [101], type: 'aggregator' }
    ]
  };

  private async fetchWithCache(url: string, cacheKey: string): Promise<any> {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Response is not JSON');
      }

      const text = await response.text();
      
      // Try to parse JSON
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        // Log the first 200 chars of the response for debugging
        console.error('Failed to parse JSON response:', text.substring(0, 200));
        throw new Error('Invalid JSON response');
      }
      
      // Cache successful result
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });
      
      return data;
    } catch (error) {
      // Don't log full error to avoid spam
      throw error;
    }
  }

  // Get token price via 0x API
  private async get0xPrice(token: Token): Promise<TokenQuote | null> {
    try {
      const sources = this.quoteSources[token.chainId];
      const zeroXSource = sources?.find(s => s.name.includes('0x'));
      
      if (!zeroXSource) return null;

      // Use USDC as the quote token for price reference
      const usdcAddresses: Record<number, string> = {
        1: '0xA0b86a33E6441B8C992d0ae47a1e54bd2dd82Fc6', // USDC on Ethereum
        56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC on BSC
        137: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Polygon
        42161: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC on Arbitrum
        10: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607' // USDC on Optimism
      };

      const quoteToken = usdcAddresses[token.chainId];
      if (!quoteToken) return null;

      const url = `${zeroXSource.url}/swap/v1/price?sellToken=${token.address}&buyToken=${quoteToken}&sellAmount=1000000000000000000`; // 1 token
      
      const data = await this.fetchWithCache(url, `0x_${token.chainId}_${token.address}`);
      
      if (data && data.price) {
        return {
          token,
          price: parseFloat(data.price),
          volume24h: data.estimatedGas ? parseFloat(data.estimatedGas) : undefined,
          source: zeroXSource.name,
          timestamp: Date.now()
        };
      }
      
      return null;
    } catch (error) {
      console.error(`Failed to get 0x price for ${token.symbol}:`, error);
      return null;
    }
  }

  // Get token price via 1inch API
  private async get1inchPrice(token: Token): Promise<TokenQuote | null> {
    // Skip 1inch for now as it requires API key
    return null;
    
    /* Disabled until API key is available
    try {
      const sources = this.quoteSources[token.chainId];
      const oneInchSource = sources?.find(s => s.name.includes('1inch'));
      
      if (!oneInchSource) return null;

      // Use USDC as quote token
      const usdcAddresses: Record<number, string> = {
        1: '0xA0b86a33E6441B8C992d0ae47a1e54bd2dd82Fc6',
        56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        137: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
      };

      const quoteToken = usdcAddresses[token.chainId];
      if (!quoteToken) return null;

      const url = `${oneInchSource.url}/quote?fromTokenAddress=${token.address}&toTokenAddress=${quoteToken}&amount=1000000000000000000`;
      
      const data = await this.fetchWithCache(url, `1inch_${token.chainId}_${token.address}`);
      
      if (data && data.toTokenAmount) {
        const price = parseFloat(data.toTokenAmount) / 1000000; // Adjust for USDC decimals
        return {
          token,
          price,
          source: oneInchSource.name,
          timestamp: Date.now()
        };
      }
      
      return null;
    } catch (error) {
      console.error(`Failed to get 1inch price for ${token.symbol}:`, error);
      return null;
    }
    */
  }

  // Get token price via Jupiter (Solana)
  private async getJupiterPrice(token: Token): Promise<TokenQuote | null> {
    try {
      if (token.chainId !== 101) return null;

      // Use USDC on Solana as quote token
      const usdcSolana = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      
      const url = `https://quote-api.jup.ag/v6/quote?inputMint=${token.address}&outputMint=${usdcSolana}&amount=1000000000&slippageBps=50`;
      
      const data = await this.fetchWithCache(url, `jupiter_${token.address}`);
      
      if (data && data.outAmount) {
        const price = parseFloat(data.outAmount) / 1000000; // Adjust for USDC decimals
        return {
          token,
          price,
          source: 'Jupiter',
          timestamp: Date.now()
        };
      }
      
      return null;
    } catch (error) {
      console.error(`Failed to get Jupiter price for ${token.symbol}:`, error);
      return null;
    }
  }

  // Get token price via Paraswap (Avalanche)
  private async getParaswapPrice(token: Token): Promise<TokenQuote | null> {
    try {
      if (token.chainId !== 43114) return null;

      const usdcAvalanche = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'; // USDC on Avalanche
      
      const url = `https://api.paraswap.io/prices/?srcToken=${token.address}&destToken=${usdcAvalanche}&amount=1000000000000000000&srcDecimals=${token.decimals}&destDecimals=6&network=43114`;
      
      const data = await this.fetchWithCache(url, `paraswap_${token.address}`);
      
      if (data && data.priceRoute && data.priceRoute.destAmount) {
        const price = parseFloat(data.priceRoute.destAmount) / 1000000;
        return {
          token,
          price,
          source: 'Paraswap',
          timestamp: Date.now()
        };
      }
      
      return null;
    } catch (error) {
      console.error(`Failed to get Paraswap price for ${token.symbol}:`, error);
      return null;
    }
  }

  // Main method to get token quote from any available source
  async getTokenQuote(token: Token): Promise<TokenQuote | null> {
    const cacheKey = `quote_${token.chainId}_${token.address}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      let quote: TokenQuote | null = null;

      // Try different sources based on chain
      switch (token.chainId) {
        case 101: // Solana
          quote = await this.getJupiterPrice(token);
          break;
          
        case 43114: // Avalanche
          quote = await this.getParaswapPrice(token);
          if (!quote) quote = await this.get0xPrice(token);
          break;
          
        default: // EVM chains
          // Try 0x first, then 1inch as fallback
          quote = await this.get0xPrice(token);
          if (!quote) quote = await this.get1inchPrice(token);
          break;
      }

      // Cache successful result
      if (quote) {
        this.cache.set(cacheKey, {
          data: quote,
          timestamp: Date.now()
        });
      }

      return quote;
    } catch (error) {
      console.error(`Failed to get quote for ${token.symbol}:`, error);
      return null;
    }
  }

  // Get quotes for multiple tokens
  async getMultipleTokenQuotes(tokens: Token[]): Promise<TokenQuote[]> {
    const quotes: TokenQuote[] = [];
    
    // Process in batches to avoid overwhelming APIs
    const batchSize = 10;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      
      const batchPromises = batch.map(token => this.getTokenQuote(token));
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          quotes.push(result.value);
        }
      }
      
      // Small delay between batches to be respectful to APIs
      if (i + batchSize < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return quotes;
  }

  // Get supported chains
  getSupportedChains(): number[] {
    return Object.keys(this.quoteSources).map(Number);
  }

  // Get available sources for a chain
  getSourcesForChain(chainId: number): QuoteSource[] {
    return this.quoteSources[chainId] || [];
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
  }
}

export const freeQuoteService = new FreeQuoteService();