import { Token } from '../../types/wallet';

export interface TronTokenInfo {
  tokenId: string;
  tokenName: string;
  tokenAbbr: string;
  tokenDecimal: number;
  tokenCanShow: number;
  tokenType: string;
  tokenLogo: string;
  tokenLevel: string;
  issuerAddr: string;
  vip: boolean;
  market_info?: {
    priceInTrx: number;
    priceInUsd: number;
    volume24hInTrx: number;
    volume24hInUsd: number;
  };
  total_supply?: string;
  circulating_supply?: string;
  holders_count?: number;
}

export interface TronScanResponse {
  data: TronTokenInfo[];
  total: number;
  rangeTotal: number;
}

class TronTokenService {
  private apiKey: string;
  private baseUrl = 'https://apilist.tronscanapi.com/api';
  private cache = new Map<string, { data: any; timestamp: number }>();
  private cacheTimeout = 10 * 60 * 1000; // 10 minutes

  constructor() {
    this.apiKey = process.env.TRON_API_KEY || '5b324f5c-6644-48e7-b492-84285a6c97b8';
  }

  private getHeaders(): Record<string, string> {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'TRON-PRO-API-KEY': this.apiKey
    };
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
        throw new Error(`TronScan API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache the response
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      console.error('TronScan API error:', error);
      throw error;
    }
  }

  // Get all TRC-20 tokens
  async getTRC20Tokens(limit = 100, start = 0): Promise<TronScanResponse> {
    const cacheKey = `trc20_tokens_${limit}_${start}`;
    
    try {
      const url = `${this.baseUrl}/token_trc20?sort=-market_info.priceInUsd&limit=${limit}&start=${start}&verifier=all&showAll=1`;
      return await this.fetchWithCache(url, cacheKey);
    } catch (error) {
      console.error('Failed to fetch TRC-20 tokens:', error);
      return { data: [], total: 0, rangeTotal: 0 };
    }
  }

  // Get popular TRC-20 tokens (sorted by market cap/volume)
  async getPopularTokens(limit = 50): Promise<TronTokenInfo[]> {
    try {
      const response = await this.getTRC20Tokens(limit, 0);
      return response.data.filter(token => 
        token.tokenCanShow === 1 && 
        token.tokenLogo && 
        token.market_info
      );
    } catch (error) {
      console.error('Failed to fetch popular Tron tokens:', error);
      return [];
    }
  }

  // Search for tokens
  async searchTokens(query: string, limit = 20): Promise<TronTokenInfo[]> {
    const cacheKey = `search_tron_${query.toLowerCase()}_${limit}`;
    
    try {
      const url = `${this.baseUrl}/token_trc20?search=${encodeURIComponent(query)}&sort=-holders&limit=${limit}&start=0&verifier=all`;
      const response = await this.fetchWithCache(url, cacheKey);
      return response.data || [];
    } catch (error) {
      console.error('Failed to search Tron tokens:', error);
      return [];
    }
  }

  // Get token details by contract address
  async getTokenDetails(contractAddress: string): Promise<TronTokenInfo | null> {
    const cacheKey = `tron_token_${contractAddress}`;
    
    try {
      const url = `${this.baseUrl}/token_trc20/${contractAddress}`;
      const data = await this.fetchWithCache(url, cacheKey);
      return data;
    } catch (error) {
      console.error(`Failed to fetch Tron token details for ${contractAddress}:`, error);
      return null;
    }
  }

  // Get trending tokens
  async getTrendingTokens(limit = 20): Promise<TronTokenInfo[]> {
    try {
      const url = `${this.baseUrl}/token_trc20?sort=-market_info.volume24hInUsd&limit=${limit}&start=0&verifier=all&showAll=1`;
      const response = await this.fetchWithCache(url, 'trending_tron_tokens');
      return response.data.filter(token => 
        token.market_info && 
        token.market_info.volume24hInUsd > 1000
      );
    } catch (error) {
      console.error('Failed to fetch trending Tron tokens:', error);
      return [];
    }
  }

  // Get verified tokens only
  async getVerifiedTokens(limit = 100): Promise<TronTokenInfo[]> {
    try {
      const url = `${this.baseUrl}/token_trc20?sort=-market_info.priceInUsd&limit=${limit}&start=0&verifier=verified&showAll=1`;
      const response = await this.fetchWithCache(url, 'verified_tron_tokens');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch verified Tron tokens:', error);
      return [];
    }
  }

  // Convert TronScan token to our Token format
  convertToTokenFormat(tronToken: TronTokenInfo): Token {
    return {
      symbol: tronToken.tokenAbbr,
      name: tronToken.tokenName,
      address: tronToken.tokenId,
      chainId: 195, // Tron
      type: 'TRC-20',
      decimals: tronToken.tokenDecimal,
      logoURI: tronToken.tokenLogo || `https://static.tronscan.org/production/logo/new/${tronToken.tokenId}.png`,
      tags: this.getTokenTags(tronToken),
      extensions: {
        source: 'tronscan',
        tokenLevel: tronToken.tokenLevel,
        vip: tronToken.vip,
        verified: tronToken.tokenLevel === 'blue' || tronToken.vip,
        issuerAddr: tronToken.issuerAddr,
        totalSupply: tronToken.total_supply,
        circulatingSupply: tronToken.circulating_supply,
        holdersCount: tronToken.holders_count,
        priceInTrx: tronToken.market_info?.priceInTrx,
        priceInUsd: tronToken.market_info?.priceInUsd,
        volume24h: tronToken.market_info?.volume24hInUsd
      }
    };
  }

  private getTokenTags(token: TronTokenInfo): string[] {
    const tags = ['tron', 'trc20'];
    
    if (token.vip) tags.push('vip');
    if (token.tokenLevel === 'blue') tags.push('verified');
    if (token.market_info?.volume24hInUsd && token.market_info.volume24hInUsd > 10000) {
      tags.push('high-volume');
    }
    if (token.holders_count && token.holders_count > 1000) {
      tags.push('popular');
    }
    
    return tags;
  }

  // Get comprehensive Tron token list
  async getComprehensiveTokenList(): Promise<Token[]> {
    try {
      const [popularTokens, verifiedTokens, trendingTokens] = await Promise.all([
        this.getPopularTokens(50),
        this.getVerifiedTokens(30),
        this.getTrendingTokens(20)
      ]);

      // Combine and deduplicate tokens
      const tokenMap = new Map<string, Token>();
      
      // Add popular tokens first
      popularTokens.forEach(token => {
        const formattedToken = this.convertToTokenFormat(token);
        tokenMap.set(token.tokenId, formattedToken);
      });
      
      // Add verified tokens
      verifiedTokens.forEach(token => {
        if (!tokenMap.has(token.tokenId)) {
          const formattedToken = this.convertToTokenFormat(token);
          tokenMap.set(token.tokenId, formattedToken);
        }
      });
      
      // Add trending tokens
      trendingTokens.forEach(token => {
        if (!tokenMap.has(token.tokenId)) {
          const formattedToken = this.convertToTokenFormat(token);
          tokenMap.set(token.tokenId, formattedToken);
        }
      });

      return Array.from(tokenMap.values());
    } catch (error) {
      console.error('Failed to get comprehensive Tron token list:', error);
      return [];
    }
  }

  // Validate Tron address format
  isValidTronAddress(address: string): boolean {
    // Tron addresses start with 'T' and are 34 characters long (base58)
    const tronAddressRegex = /^T[A-Za-z1-9]{33}$/;
    return tronAddressRegex.test(address);
  }

  // Get account information
  async getAccountInfo(address: string): Promise<any> {
    const cacheKey = `tron_account_${address}`;
    
    try {
      const url = `${this.baseUrl}/account?address=${address}`;
      return await this.fetchWithCache(url, cacheKey);
    } catch (error) {
      console.error('Failed to get Tron account info:', error);
      return null;
    }
  }

  // Get token holders
  async getTokenHolders(contractAddress: string, limit = 20): Promise<any[]> {
    const cacheKey = `tron_holders_${contractAddress}_${limit}`;
    
    try {
      const url = `${this.baseUrl}/token_trc20/${contractAddress}/holders?limit=${limit}&start=0`;
      const response = await this.fetchWithCache(url, cacheKey);
      return response.data || [];
    } catch (error) {
      console.error('Failed to get Tron token holders:', error);
      return [];
    }
  }

  // Get native TRX info
  getTRXToken(): Token {
    return {
      symbol: 'TRX',
      name: 'TRON',
      address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', // TRX native token address
      chainId: 195,
      type: 'TRC-20',
      decimals: 6,
      logoURI: 'https://coin-images.coingecko.com/coins/images/1094/standard/tron-logo.png',
      tags: ['native', 'tron'],
      extensions: {
        source: 'native',
        verified: true,
        isNative: true
      }
    };
  }
}

export const tronTokenService = new TronTokenService();