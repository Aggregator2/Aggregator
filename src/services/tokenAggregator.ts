import { Token, TokenType } from '../types/token';
import { logger } from '../utils/logger';

// Token list sources for different chains
const TOKEN_LIST_SOURCES = {
  // Ethereum
  ethereum: [
    'https://tokens.uniswap.org',
    'https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json',
    'https://tokens.1inch.io',
    'https://raw.githubusercontent.com/sushiswap/default-token-list/master/tokens/mainnet.json',
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/tokenlist.json'
  ],
  // BSC
  bsc: [
    'https://tokens.pancakeswap.finance/pancakeswap-extended.json',
    'https://raw.githubusercontent.com/pancakeswap/pancake-frontend/develop/src/config/constants/tokenLists/pancake-extended.json',
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/tokenlist.json'
  ],
  // Polygon
  polygon: [
    'https://unpkg.com/quickswap-default-token-list@1.0.91/build/quickswap-default.tokenlist.json',
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/tokenlist.json'
  ],
  // Solana
  solana: [
    'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json',
    'https://cache.jup.ag/tokens'
  ],
  // Avalanche
  avalanche: [
    'https://raw.githubusercontent.com/traderjoe-xyz/joe-tokenlists/main/joe.tokenlist.json',
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/tokenlist.json'
  ],
  // Arbitrum
  arbitrum: [
    'https://bridge.arbitrum.io/token-list-42161.json',
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/tokenlist.json'
  ],
  // Optimism
  optimism: [
    'https://static.optimism.io/optimism.tokenlist.json',
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/tokenlist.json'
  ],
  // Fantom
  fantom: [
    'https://raw.githubusercontent.com/SpookySwap/spooky-info/master/src/constants/token/spookyswap.json',
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/fantom/tokenlist.json'
  ]
};

// CoinGecko API for additional token data
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Cache for token lists
const tokenCache = new Map<string, { tokens: Token[]; timestamp: number }>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

export class TokenAggregator {
  private static instance: TokenAggregator;
  private allTokens: Token[] = [];
  private tokensByChain: Record<number, Token[]> = {};
  private lastUpdate: number = 0;

  static getInstance(): TokenAggregator {
    if (!TokenAggregator.instance) {
      TokenAggregator.instance = new TokenAggregator();
    }
    return TokenAggregator.instance;
  }

  async fetchTokenList(url: string): Promise<Token[]> {
    try {
      const cached = tokenCache.get(url);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.tokens;
      }

      logger.info(`Fetching token list from: ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'MetaAggregator/1.0'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const tokens = this.parseTokenList(data, url);

      // Cache the result
      tokenCache.set(url, { tokens, timestamp: Date.now() });

      logger.info(`Loaded ${tokens.length} tokens from ${url}`);
      return tokens;

    } catch (error) {
      logger.error(`Failed to fetch token list from ${url}:`, error);
      return [];
    }
  }

  parseTokenList(data: any, source: string): Token[] {
    const tokens: Token[] = [];

    try {
      // Handle different token list formats
      let tokenArray: any[] = [];

      if (data.tokens && Array.isArray(data.tokens)) {
        // Standard token list format (like Uniswap)
        tokenArray = data.tokens;
      } else if (Array.isArray(data)) {
        // Direct array format
        tokenArray = data;
      } else if (data.data && Array.isArray(data.data)) {
        // Some APIs return data in a wrapper
        tokenArray = data.data;
      } else if (data.result && Array.isArray(data.result)) {
        // Some APIs return result in a wrapper
        tokenArray = data.result;
      }

      for (const token of tokenArray) {
        try {
          const parsedToken = this.parseToken(token, source);
          if (parsedToken) {
            tokens.push(parsedToken);
          }
        } catch (error) {
          // Skip invalid tokens
          continue;
        }
      }

    } catch (error) {
      logger.error(`Error parsing token list from ${source}:`, error);
    }

    return tokens;
  }

  parseToken(tokenData: any, source: string): Token | null {
    try {
      // Extract required fields with fallbacks
      const symbol = tokenData.symbol || tokenData.ticker;
      const name = tokenData.name || tokenData.title;
      const address = tokenData.address || tokenData.contract || tokenData.mint;
      const chainId = tokenData.chainId || this.inferChainId(source, address);
      const decimals = tokenData.decimals || 18;

      if (!symbol || !name || !address || !chainId) {
        return null;
      }

      // Determine token type based on chain
      const type = this.getTokenType(chainId, tokenData);

      const token: Token = {
        symbol: symbol.toUpperCase(),
        name,
        address,
        chainId,
        type,
        decimals,
        logoURI: tokenData.logoURI || tokenData.logo || tokenData.image,
        tags: tokenData.tags || [],
        extensions: {
          source,
          verified: tokenData.verified || false,
          ...tokenData.extensions
        }
      };

      return token;

    } catch (error) {
      return null;
    }
  }

  inferChainId(source: string, address: string): number {
    // Infer chain ID from source URL and address format
    if (source.includes('pancakeswap') || source.includes('smartchain')) return 56;
    if (source.includes('polygon') || source.includes('matic')) return 137;
    if (source.includes('solana') || !address.startsWith('0x')) return 101;
    if (source.includes('avalanche')) return 43114;
    if (source.includes('arbitrum')) return 42161;
    if (source.includes('optimism')) return 10;
    if (source.includes('fantom')) return 250;
    if (source.includes('tron')) return 1001;
    
    // Default to Ethereum
    return 1;
  }

  getTokenType(chainId: number, tokenData: any): TokenType {
    // Determine token standard based on chain
    switch (chainId) {
      case 1: // Ethereum
      case 42161: // Arbitrum
      case 10: // Optimism
        return (tokenData.type as TokenType) || 'ERC-20';
      case 56: // BSC
        return 'BEP-20';
      case 137: // Polygon
        return 'ERC-20';
      case 101: // Solana
        return 'SPL';
      case 43114: // Avalanche
        return 'ERC-20';
      case 250: // Fantom
        return 'ERC-20';
      case 1001: // Tron
        return 'TRC-20';
      default:
        return 'ERC-20';
    }
  }

  async loadAllTokens(): Promise<void> {
    logger.info('Starting comprehensive token loading...');
    
    const startTime = Date.now();
    const allPromises: Promise<Token[]>[] = [];

    // Load tokens from all sources
    for (const [chain, sources] of Object.entries(TOKEN_LIST_SOURCES)) {
      for (const source of sources) {
        allPromises.push(this.fetchTokenList(source));
      }
    }

    // Load additional tokens from CoinGecko
    allPromises.push(this.fetchCoinGeckoTokens());

    try {
      const results = await Promise.allSettled(allPromises);
      const allTokens: Token[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allTokens.push(...result.value);
        }
      }

      // Deduplicate tokens
      const uniqueTokens = this.deduplicateTokens(allTokens);
      
      // Sort by chain and popularity
      uniqueTokens.sort((a, b) => {
        if (a.chainId !== b.chainId) {
          return a.chainId - b.chainId;
        }
        return a.symbol.localeCompare(b.symbol);
      });

      this.allTokens = uniqueTokens;
      this.tokensByChain = this.groupTokensByChain(uniqueTokens);
      this.lastUpdate = Date.now();

      const loadTime = Date.now() - startTime;
      logger.info(`Loaded ${uniqueTokens.length} unique tokens in ${loadTime}ms`);
      
      // Log breakdown by chain
      for (const [chainId, tokens] of Object.entries(this.tokensByChain)) {
        logger.info(`Chain ${chainId}: ${tokens.length} tokens`);
      }

    } catch (error) {
      logger.error('Error loading tokens:', error);
    }
  }

  async fetchCoinGeckoTokens(): Promise<Token[]> {
    try {
      // Fetch top 2000 coins from CoinGecko
      const response = await fetch(
        `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`,
        {
          headers: {
            'Accept': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const coins = await response.json();
      const tokens: Token[] = [];

      for (const coin of coins) {
        // Try to map CoinGecko coins to known contract addresses
        const platforms = coin.platforms || {};
        
        for (const [platform, address] of Object.entries(platforms)) {
          if (address && typeof address === 'string') {
            const chainId = this.platformToChainId(platform);
            if (chainId) {
              tokens.push({
                symbol: coin.symbol.toUpperCase(),
                name: coin.name,
                address: address as string,
                chainId,
                type: this.getTokenType(chainId, {}),
                decimals: 18, // Default, would need chain-specific lookup
                logoURI: coin.image,
                tags: ['coingecko'],
                extensions: {
                  source: 'coingecko',
                  verified: true,
                  coingeckoId: coin.id,
                  marketCap: coin.market_cap,
                  rank: coin.market_cap_rank
                }
              });
            }
          }
        }
      }

      logger.info(`Loaded ${tokens.length} tokens from CoinGecko`);
      return tokens;

    } catch (error) {
      logger.error('Error fetching CoinGecko tokens:', error);
      return [];
    }
  }

  platformToChainId(platform: string): number | null {
    const platformMap: Record<string, number> = {
      'ethereum': 1,
      'binance-smart-chain': 56,
      'polygon-pos': 137,
      'solana': 101,
      'avalanche': 43114,
      'arbitrum-one': 42161,
      'optimistic-ethereum': 10,
      'fantom': 250,
      'tron': 1001
    };

    return platformMap[platform] || null;
  }

  deduplicateTokens(tokens: Token[]): Token[] {
    const seen = new Set<string>();
    const unique: Token[] = [];

    for (const token of tokens) {
      const key = `${token.chainId}-${token.address.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(token);
      }
    }

    return unique;
  }

  groupTokensByChain(tokens: Token[]): Record<number, Token[]> {
    const grouped: Record<number, Token[]> = {};

    for (const token of tokens) {
      if (!grouped[token.chainId]) {
        grouped[token.chainId] = [];
      }
      grouped[token.chainId].push(token);
    }

    return grouped;
  }

  getAllTokens(): Token[] {
    return this.allTokens;
  }

  getTokensByChain(chainId: number): Token[] {
    return this.tokensByChain[chainId] || [];
  }

  searchTokens(query: string, chainId?: number): Token[] {
    const tokens = chainId ? this.getTokensByChain(chainId) : this.allTokens;
    const lowerQuery = query.toLowerCase();

    if (!query) return tokens.slice(0, 100);

    const results = tokens.filter(token => {
      const symbolMatch = token.symbol.toLowerCase().includes(lowerQuery);
      const nameMatch = token.name.toLowerCase().includes(lowerQuery);
      const addressMatch = token.address.toLowerCase().includes(lowerQuery);
      
      return symbolMatch || nameMatch || addressMatch;
    });

    return results.sort((a, b) => {
      const aSymbol = a.symbol.toLowerCase();
      const bSymbol = b.symbol.toLowerCase();
      
      // Exact matches first
      if (aSymbol === lowerQuery && bSymbol !== lowerQuery) return -1;
      if (bSymbol === lowerQuery && aSymbol !== lowerQuery) return 1;
      
      // Starts with query
      if (aSymbol.startsWith(lowerQuery) && !bSymbol.startsWith(lowerQuery)) return -1;
      if (bSymbol.startsWith(lowerQuery) && !aSymbol.startsWith(lowerQuery)) return 1;
      
      // Market cap rank (if available)
      const aRank = a.extensions?.rank || Infinity;
      const bRank = b.extensions?.rank || Infinity;
      if (aRank !== bRank) return aRank - bRank;
      
      return aSymbol.localeCompare(bSymbol);
    });
  }

  getStats(): { total: number; byChain: Record<number, number>; lastUpdate: number } {
    const byChain: Record<number, number> = {};
    for (const [chainId, tokens] of Object.entries(this.tokensByChain)) {
      byChain[parseInt(chainId)] = tokens.length;
    }

    return {
      total: this.allTokens.length,
      byChain,
      lastUpdate: this.lastUpdate
    };
  }

  async refreshTokens(): Promise<void> {
    await this.loadAllTokens();
  }
}

// Export singleton instance
export const tokenAggregator = TokenAggregator.getInstance();