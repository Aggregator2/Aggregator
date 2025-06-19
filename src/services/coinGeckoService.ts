import { Token } from '../../types/wallet';

export interface CoinGeckoToken {
  id: string;
  symbol: string;
  name: string;
  platforms: {
    ethereum?: string;
    'binance-smart-chain'?: string;
    'polygon-pos'?: string;
    avalanche?: string;
    arbitrum?: string;
    optimism?: string;
    fantom?: string;
    tron?: string;
    solana?: string;
  };
  image?: {
    thumb?: string;
    small?: string;
    large?: string;
  };
  market_cap_rank?: number;
  current_price?: number;
}

export interface CoinGeckoSearchResult {
  coins: Array<{
    id: string;
    name: string;
    symbol: string;
    thumb: string;
    market_cap_rank: number;
  }>;
}

class CoinGeckoService {
  private apiKey: string;
  private baseUrl = 'https://api.coingecko.com/api/v3';
  private proApiUrl = 'https://pro-api.coingecko.com/api/v3';
  private cache = new Map<string, { data: any; timestamp: number }>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.apiKey = process.env.COINGECKO_API_KEY || '';
  }

  private getApiUrl(): string {
    return this.apiKey ? this.proApiUrl : this.baseUrl;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['x-cg-pro-api-key'] = this.apiKey;
    }

    return headers;
  }

  private async fetchWithCache(url: string, cacheKey: string): Promise<any> {
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await fetch(url, {
        headers: this.getHeaders()
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please upgrade to CoinGecko Pro API.');
        }
        throw new Error(`CoinGecko API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache the response
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      console.error('CoinGecko API error:', error);
      throw error;
    }
  }

  // Get comprehensive token list with platform addresses
  async getTokensList(includeTopTokens = true): Promise<CoinGeckoToken[]> {
    const cacheKey = `tokens_list_${includeTopTokens}`;
    
    try {
      const url = `${this.getApiUrl()}/coins/list?include_platform=true`;
      const data = await this.fetchWithCache(url, cacheKey);
      
      // If we want top tokens, get market data too
      if (includeTopTokens) {
        const marketUrl = `${this.getApiUrl()}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`;
        const marketData = await this.fetchWithCache(marketUrl, 'top_tokens_market');
        
        // Merge platform data with market data
        const platformMap = new Map(data.map((token: any) => [token.id, token]));
        
        return marketData.map((token: any) => {
          const platformData = platformMap.get(token.id);
          return {
            id: token.id,
            symbol: token.symbol,
            name: token.name,
            platforms: platformData?.platforms || {},
            image: token.image,
            market_cap_rank: token.market_cap_rank,
            current_price: token.current_price
          };
        });
      }

      return data.map((token: any) => ({
        id: token.id,
        symbol: token.symbol,
        name: token.name,
        platforms: token.platforms || {}
      }));
    } catch (error) {
      console.error('Failed to fetch CoinGecko tokens list:', error);
      return [];
    }
  }

  // Search for tokens
  async searchTokens(query: string): Promise<CoinGeckoSearchResult> {
    const cacheKey = `search_${query.toLowerCase()}`;
    
    try {
      const url = `${this.getApiUrl()}/search?query=${encodeURIComponent(query)}`;
      return await this.fetchWithCache(url, cacheKey);
    } catch (error) {
      console.error('Failed to search CoinGecko tokens:', error);
      return { coins: [] };
    }
  }

  // Get token details by ID
  async getTokenById(id: string): Promise<CoinGeckoToken | null> {
    const cacheKey = `token_${id}`;
    
    try {
      const url = `${this.getApiUrl()}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
      const data = await this.fetchWithCache(url, cacheKey);
      
      return {
        id: data.id,
        symbol: data.symbol,
        name: data.name,
        platforms: data.platforms || {},
        image: data.image,
        market_cap_rank: data.market_cap_rank,
        current_price: data.market_data?.current_price?.usd
      };
    } catch (error) {
      console.error(`Failed to fetch token ${id}:`, error);
      return null;
    }
  }

  // Convert CoinGecko token to our Token format
  convertToTokenFormat(cgToken: CoinGeckoToken): Token[] {
    const tokens: Token[] = [];
    const platforms = cgToken.platforms;

    // Map platform names to chain IDs
    const platformToChain = {
      ethereum: 1,
      'binance-smart-chain': 56,
      'polygon-pos': 137,
      avalanche: 43114,
      arbitrum: 42161,
      optimism: 10,
      fantom: 250,
      tron: 195,
      solana: 101
    };

    // Create token for each platform where it exists
    Object.entries(platformToChain).forEach(([platform, chainId]) => {
      const address = platforms[platform as keyof typeof platforms];
      if (address && address !== '') {
        tokens.push({
          symbol: cgToken.symbol.toUpperCase(),
          name: cgToken.name,
          address: address,
          chainId: chainId,
          type: this.getTokenType(chainId),
          decimals: 18, // Default, should be fetched from contract
          logoURI: cgToken.image?.large || cgToken.image?.small || cgToken.image?.thumb,
          tags: ['coingecko'],
          extensions: {
            coingeckoId: cgToken.id,
            marketCapRank: cgToken.market_cap_rank,
            currentPrice: cgToken.current_price,
            verified: cgToken.market_cap_rank ? cgToken.market_cap_rank <= 1000 : false
          }
        });
      }
    });

    return tokens;
  }

  private getTokenType(chainId: number): string {
    const typeMap: Record<number, string> = {
      1: 'ERC-20',
      56: 'BEP-20',
      137: 'ERC-20',
      43114: 'ARC-20',
      42161: 'ERC-20',
      10: 'ERC-20',
      250: 'FTM-20',
      195: 'TRC-20',
      101: 'SPL'
    };
    return typeMap[chainId] || 'ERC-20';
  }

  // Get trending tokens
  async getTrendingTokens(): Promise<Token[]> {
    const cacheKey = 'trending_tokens';
    
    try {
      const url = `${this.getApiUrl()}/search/trending`;
      const data = await this.fetchWithCache(url, cacheKey);
      
      const tokens: Token[] = [];
      
      for (const trendingCoin of data.coins) {
        const coinData = await this.getTokenById(trendingCoin.item.id);
        if (coinData) {
          tokens.push(...this.convertToTokenFormat(coinData));
        }
      }
      
      return tokens;
    } catch (error) {
      console.error('Failed to fetch trending tokens:', error);
      return [];
    }
  }

  // Get tokens by market cap ranking
  async getTopTokensByMarketCap(limit = 100): Promise<Token[]> {
    const cacheKey = `top_tokens_${limit}`;
    
    try {
      const url = `${this.getApiUrl()}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`;
      const data = await this.fetchWithCache(url, cacheKey);
      
      const tokens: Token[] = [];
      
      for (const marketToken of data) {
        const coinData = await this.getTokenById(marketToken.id);
        if (coinData) {
          tokens.push(...this.convertToTokenFormat(coinData));
        }
      }
      
      return tokens;
    } catch (error) {
      console.error('Failed to fetch top tokens:', error);
      return [];
    }
  }

  // Get price data for tokens
  async getTokenPrices(tokenIds: string[]): Promise<Record<string, number>> {
    const cacheKey = `prices_${tokenIds.join(',')}`;
    
    try {
      const ids = tokenIds.join(',');
      const url = `${this.getApiUrl()}/simple/price?ids=${ids}&vs_currencies=usd`;
      const data = await this.fetchWithCache(url, cacheKey);
      
      const prices: Record<string, number> = {};
      Object.entries(data).forEach(([id, priceData]: [string, any]) => {
        prices[id] = priceData.usd;
      });
      
      return prices;
    } catch (error) {
      console.error('Failed to fetch token prices:', error);
      return {};
    }
  }
}

export const coinGeckoService = new CoinGeckoService();