import { Token } from '../../types/wallet';

export interface SolanaTokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  description?: string;
  image?: string;
  creators?: Array<{
    address: string;
    verified: boolean;
    share: number;
  }>;
  collection?: {
    name: string;
    family: string;
  };
  attributes?: Array<{
    trait_type: string;
    value: string;
  }>;
}

export interface JupiterTokenInfo {
  address: string;
  chainId: 101;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
  extensions?: {
    coingeckoId?: string;
    website?: string;
    twitter?: string;
    telegram?: string;
  };
}

class SolanaTokenService {
  private jupiterApiUrl = 'https://token.jup.ag/all';
  private metaplexApiUrl = 'https://api.metaplex.solana.com/v1';
  private solanaRpcUrl = 'https://api.mainnet-beta.solana.com';
  private cache = new Map<string, { data: any; timestamp: number }>();
  private cacheTimeout = 10 * 60 * 1000; // 10 minutes

  constructor() {}

  private async fetchWithCache(url: string, cacheKey: string): Promise<any> {
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache the response
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      console.error('Solana API error:', error);
      throw error;
    }
  }

  // Get all Jupiter tokens (most comprehensive Solana token list)
  async getJupiterTokens(): Promise<JupiterTokenInfo[]> {
    const cacheKey = 'jupiter_tokens';
    
    try {
      const data = await this.fetchWithCache(this.jupiterApiUrl, cacheKey);
      return data;
    } catch (error) {
      console.error('Failed to fetch Jupiter tokens:', error);
      return [];
    }
  }

  // Get token metadata from Metaplex
  async getMetaplexMetadata(mintAddress: string): Promise<SolanaTokenMetadata | null> {
    const cacheKey = `metaplex_${mintAddress}`;
    
    try {
      // Try to get metadata from Metaplex Digital Asset Standard
      const url = `${this.metaplexApiUrl}/assets/${mintAddress}`;
      const data = await this.fetchWithCache(url, cacheKey);
      
      if (data && data.content) {
        return {
          mint: mintAddress,
          name: data.content.metadata?.name || '',
          symbol: data.content.metadata?.symbol || '',
          uri: data.content.json_uri || '',
          description: data.content.metadata?.description,
          image: data.content.files?.[0]?.uri || data.content.metadata?.image,
          creators: data.creators,
          collection: data.grouping?.[0],
          attributes: data.content.metadata?.attributes
        };
      }

      return null;
    } catch (error) {
      console.error(`Failed to fetch Metaplex metadata for ${mintAddress}:`, error);
      return null;
    }
  }

  // Get token metadata from URI (for tokens using off-chain metadata)
  async getTokenMetadataFromUri(uri: string): Promise<Partial<SolanaTokenMetadata> | null> {
    const cacheKey = `metadata_uri_${uri}`;
    
    try {
      const data = await this.fetchWithCache(uri, cacheKey);
      return {
        name: data.name,
        symbol: data.symbol,
        description: data.description,
        image: data.image,
        attributes: data.attributes
      };
    } catch (error) {
      console.error(`Failed to fetch metadata from URI ${uri}:`, error);
      return null;
    }
  }

  // Search tokens by name or symbol
  async searchTokens(query: string): Promise<JupiterTokenInfo[]> {
    try {
      const allTokens = await this.getJupiterTokens();
      const searchTerm = query.toLowerCase();
      
      return allTokens.filter(token => 
        token.name.toLowerCase().includes(searchTerm) ||
        token.symbol.toLowerCase().includes(searchTerm) ||
        token.address.toLowerCase().includes(searchTerm)
      ).slice(0, 50); // Limit results
    } catch (error) {
      console.error('Failed to search Solana tokens:', error);
      return [];
    }
  }

  // Get popular/trending Solana tokens
  async getPopularTokens(limit = 50): Promise<JupiterTokenInfo[]> {
    try {
      const allTokens = await this.getJupiterTokens();
      
      // Filter for tokens with good metadata and sort by some criteria
      return allTokens
        .filter(token => 
          token.logoURI && 
          token.name && 
          token.symbol &&
          !token.name.includes('Unknown') &&
          token.symbol.length <= 10
        )
        .slice(0, limit);
    } catch (error) {
      console.error('Failed to fetch popular Solana tokens:', error);
      return [];
    }
  }

  // Convert Jupiter token to our Token format
  convertJupiterToTokenFormat(jupiterToken: JupiterTokenInfo): Token {
    return {
      symbol: jupiterToken.symbol,
      name: jupiterToken.name,
      address: jupiterToken.address,
      chainId: 101, // Solana
      type: 'SPL',
      decimals: jupiterToken.decimals,
      logoURI: jupiterToken.logoURI,
      tags: jupiterToken.tags || ['solana'],
      extensions: {
        source: 'jupiter',
        coingeckoId: jupiterToken.extensions?.coingeckoId,
        website: jupiterToken.extensions?.website,
        twitter: jupiterToken.extensions?.twitter,
        verified: !!(jupiterToken.logoURI && jupiterToken.extensions?.coingeckoId)
      }
    };
  }

  // Get comprehensive Solana token list
  async getComprehensiveTokenList(): Promise<Token[]> {
    try {
      const [jupiterTokens, popularTokens] = await Promise.all([
        this.getJupiterTokens(),
        this.getPopularTokens(100)
      ]);

      // Convert all tokens to our format
      const allTokens = jupiterTokens.map(token => this.convertJupiterToTokenFormat(token));
      
      // Add some popular tokens with enhanced metadata
      const enhancedTokens = await Promise.all(
        popularTokens.slice(0, 20).map(async (token) => {
          const metaplexData = await this.getMetaplexMetadata(token.address);
          const baseToken = this.convertJupiterToTokenFormat(token);
          
          if (metaplexData) {
            return {
              ...baseToken,
              name: metaplexData.name || baseToken.name,
              extensions: {
                ...baseToken.extensions,
                description: metaplexData.description,
                metaplexUri: metaplexData.uri,
                hasMetaplex: true
              }
            };
          }
          
          return baseToken;
        })
      );

      // Combine and deduplicate
      const tokenMap = new Map();
      
      // Add enhanced tokens first (higher priority)
      enhancedTokens.forEach(token => {
        tokenMap.set(token.address, token);
      });
      
      // Add remaining tokens
      allTokens.forEach(token => {
        if (!tokenMap.has(token.address)) {
          tokenMap.set(token.address, token);
        }
      });

      return Array.from(tokenMap.values());
    } catch (error) {
      console.error('Failed to get comprehensive Solana token list:', error);
      return [];
    }
  }

  // Validate Solana address format
  isValidSolanaAddress(address: string): boolean {
    // Solana addresses are base58 encoded and typically 32-44 characters
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(address);
  }

  // Get token account info (for validating tokens exist)
  async getTokenAccountInfo(mintAddress: string): Promise<any> {
    const cacheKey = `account_info_${mintAddress}`;
    
    try {
      const response = await fetch(this.solanaRpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [
            mintAddress,
            {
              encoding: 'jsonParsed'
            }
          ]
        })
      });

      const data = await response.json();
      
      if (data.result && data.result.value) {
        this.cache.set(cacheKey, {
          data: data.result.value,
          timestamp: Date.now()
        });
        return data.result.value;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get Solana account info:', error);
      return null;
    }
  }
}

export const solanaTokenService = new SolanaTokenService();