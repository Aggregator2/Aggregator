import { Token, TokenList, SUPPORTED_CHAINS } from '../../types/token';
import { POPULAR_TOKENS, getPopularTokensForChain } from '../../config/tokens/popularTokens';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

export class TokenService {
  private tokenCache: Map<string, Token[]> = new Map();
  private lastFetchTime: Map<string, number> = new Map();
  private readonly CACHE_DURATION = 3600000; // 1 hour

  async fetchTokensForChain(chainId: number): Promise<Token[]> {
    const cacheKey = `chain-${chainId}`;
    const lastFetch = this.lastFetchTime.get(cacheKey) || 0;
    
    if (Date.now() - lastFetch < this.CACHE_DURATION && this.tokenCache.has(cacheKey)) {
      return this.tokenCache.get(cacheKey)!;
    }

    try {
      let tokens: Token[] = [];

      switch (chainId) {
        case 1: // Ethereum
        case 56: // BSC
        case 137: // Polygon
        case 42161: // Arbitrum
        case 10: // Optimism
        case 43114: // Avalanche
          tokens = await this.fetchEVMTokens(chainId);
          break;
        case 1001: // TRON
          tokens = await this.fetchTronTokens();
          break;
        case 101: // Solana
          tokens = await this.fetchSolanaTokens();
          break;
        case 118: // Cosmos
          tokens = await this.fetchCosmosTokens();
          break;
        case 301: // Algorand
          tokens = await this.fetchAlgorandTokens();
          break;
        case 0: // Stellar
          tokens = await this.fetchStellarTokens();
          break;
        case 2024: // Cardano
          tokens = await this.fetchCardanoTokens();
          break;
        case 1729: // Tezos
          tokens = await this.fetchTezosTokens();
          break;
        default:
          logger.warn(`Unsupported chain ID: ${chainId}`);
          tokens = getPopularTokensForChain(chainId);
      }

      this.tokenCache.set(cacheKey, tokens);
      this.lastFetchTime.set(cacheKey, Date.now());

      // Store in database for persistence
      await this.storeTokensInDB(tokens);

      return tokens;
    } catch (error) {
      logger.error('Error fetching tokens:', error);
      // Fall back to database
      return this.getTokensFromDB(chainId);
    }
  }

  private async fetchEVMTokens(chainId: number): Promise<Token[]> {
    try {
      // Primary source: Uniswap token list
      const response = await axios.get('https://tokens.coingecko.com/uniswap/all.json');
      const tokenList: TokenList = response.data;
      
      const chainTokens = tokenList.tokens
        .filter(token => token.chainId === chainId)
        .map(token => ({
          ...token,
          type: this.getTokenTypeForChain(chainId)
        }));

      // Additional sources based on chain
      // Additional token sources based on chain
      let additionalTokens: Token[] = [];

      if (chainId === 56) {
        // Fetch PancakeSwap tokens for BSC
        try {
          const pancakeResponse = await axios.get('https://tokens.pancakeswap.finance/pancakeswap-extended.json');
          additionalTokens = pancakeResponse.data.tokens
            .filter((token: any) => token.chainId === 56)
            .map((token: any) => ({
              ...token,
              type: 'BEP-20'
            }));
        } catch (error) {
          logger.warn('Failed to fetch PancakeSwap tokens:', error);
        }
      } else if (chainId === 43114) {
        // Fetch Avalanche tokens from Pangolin
        try {
          const pangollinResponse = await axios.get('https://raw.githubusercontent.com/pangolindex/tokenlists/main/aeb.tokenlist.json');
          additionalTokens = pangollinResponse.data.tokens
            .filter((token: any) => token.chainId === 43114)
            .map((token: any) => ({
              ...token,
              type: 'ERC-20'
            }));
        } catch (error) {
          logger.warn('Failed to fetch Pangolin tokens:', error);
        }
      }

      // Merge with popular tokens and deduplicate
      const popularTokens = getPopularTokensForChain(chainId);
      const allTokens = [...chainTokens, ...additionalTokens, ...popularTokens];
      
      const tokenMap = new Map(allTokens.map(t => [t.address.toLowerCase(), t]));
      return Array.from(tokenMap.values());
    } catch (error) {
      logger.error('Error fetching EVM tokens:', error);
      return [];
    }
  }

  private async fetchTronTokens(): Promise<Token[]> {
    try {
      const response = await axios.get('https://apilist.tronscan.org/api/token_trc20', {
        params: {
          limit: 1000,
          start: 0,
          sort: '-volume24h'
        }
      });

      return response.data.trc20_tokens.map((token: any) => ({
        symbol: token.symbol,
        name: token.name,
        address: token.contract_address,
        logoURI: token.icon_url || '',
        chainId: 1001,
        type: 'TRC-20',
        decimals: token.decimals,
        extensions: {
          website: token.home_page,
          description: token.token_desc
        }
      }));
    } catch (error) {
      logger.error('Error fetching TRON tokens:', error);
      return [];
    }
  }

  private async fetchSolanaTokens(): Promise<Token[]> {
    try {
      const response = await axios.get('https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json');
      const tokenList: TokenList = response.data;

      return tokenList.tokens
        .filter(token => token.chainId === 101)
        .map(token => ({
          ...token,
          type: 'SPL'
        }));
    } catch (error) {
      logger.error('Error fetching Solana tokens:', error);
      return [];
    }
  }

  private async fetchCosmosTokens(): Promise<Token[]> {
    try {
      // Return popular Cosmos tokens as the base set
      const popularTokens = getPopularTokensForChain(118);
      
      // In a full implementation, you would fetch from Cosmos Chain Registry
      // https://raw.githubusercontent.com/cosmos/chain-registry/master/assetlist.json
      
      return popularTokens;
    } catch (error) {
      logger.error('Error fetching Cosmos tokens:', error);
      return getPopularTokensForChain(118);
    }
  }

  private async fetchAlgorandTokens(): Promise<Token[]> {
    try {
      // Return popular Algorand tokens as the base set
      const popularTokens = getPopularTokensForChain(301);
      
      // In a full implementation, you would fetch from Algorand Asset Directory
      // https://api.algonode.io/v2/assets
      
      return popularTokens;
    } catch (error) {
      logger.error('Error fetching Algorand tokens:', error);
      return getPopularTokensForChain(301);
    }
  }

  private async fetchStellarTokens(): Promise<Token[]> {
    try {
      // Return popular Stellar tokens as the base set
      const popularTokens = getPopularTokensForChain(0);
      
      // In a full implementation, you would fetch from Stellar Asset Directory
      // https://api.stellar.org/assets
      
      return popularTokens;
    } catch (error) {
      logger.error('Error fetching Stellar tokens:', error);
      return getPopularTokensForChain(0);
    }
  }

  private async fetchCardanoTokens(): Promise<Token[]> {
    try {
      // Return popular Cardano tokens as the base set
      const popularTokens = getPopularTokensForChain(2024);
      
      // In a full implementation, you would fetch from Cardano Token Registry
      // https://tokens.cardano.org/metadata
      
      return popularTokens;
    } catch (error) {
      logger.error('Error fetching Cardano tokens:', error);
      return getPopularTokensForChain(2024);
    }
  }

  private async fetchTezosTokens(): Promise<Token[]> {
    try {
      // Return popular Tezos tokens as the base set
      const popularTokens = getPopularTokensForChain(1729);
      
      // In a full implementation, you would fetch from Better Call Dev API
      // https://api.better-call.dev/v1/tokens/mainnet
      
      return popularTokens;
    } catch (error) {
      logger.error('Error fetching Tezos tokens:', error);
      return getPopularTokensForChain(1729);
    }
  }

  private getTokenTypeForChain(chainId: number): 'ERC-20' | 'BEP-20' | 'TRC-20' | 'SPL' | 'ASA' | 'IBC' | 'NATIVE' | 'FA1.2' | 'other' {
    switch (chainId) {
      case 1:
      case 42161:
      case 10:
      case 137:
      case 43114:
        return 'ERC-20';
      case 56:
        return 'BEP-20';
      case 1001:
        return 'TRC-20';
      case 101:
        return 'SPL';
      case 118:
        return 'IBC';
      case 301:
        return 'ASA';
      case 1729:
        return 'FA1.2';
      default:
        return 'other';
    }
  }

  async searchTokens(query: string, chainId?: number): Promise<Token[]> {
    const allTokens: Token[] = [];

    if (chainId) {
      const tokens = await this.fetchTokensForChain(chainId);
      allTokens.push(...tokens);
    } else {
      // Search across all supported chains
      for (const chain of Object.values(SUPPORTED_CHAINS)) {
        const tokens = await this.fetchTokensForChain(chain.chainId);
        allTokens.push(...tokens);
      }
    }

    const lowerQuery = query.toLowerCase();
    return allTokens.filter(token => 
      token.symbol.toLowerCase().includes(lowerQuery) ||
      token.name.toLowerCase().includes(lowerQuery) ||
      token.address.toLowerCase().includes(lowerQuery)
    );
  }

  private async storeTokensInDB(tokens: Token[]): Promise<void> {
    // Store tokens in a database table for offline access
    // This would require adding a Token model to Prisma schema
    // For now, we'll just log
    logger.info(`Cached ${tokens.length} tokens`);
  }

  private async getTokensFromDB(chainId: number): Promise<Token[]> {
    // Retrieve tokens from database
    // This would query the Token model in Prisma
    return [];
  }

  async getPopularTokens(chainId: number, limit = 20): Promise<Token[]> {
    // Get popular tokens from our curated list
    const popularTokens = getPopularTokensForChain(chainId);
    
    if (popularTokens.length >= limit) {
      return popularTokens.slice(0, limit);
    }

    // If we need more tokens, fetch from the full list
    try {
      const allTokens = await this.fetchTokensForChain(chainId);
      const popularSymbols = popularTokens.map(t => t.symbol.toUpperCase());
      
      const additionalTokens = allTokens
        .filter(token => !popularSymbols.includes(token.symbol.toUpperCase()))
        .slice(0, limit - popularTokens.length);
      
      return [...popularTokens, ...additionalTokens].slice(0, limit);
    } catch (error) {
      logger.error('Error fetching additional tokens:', error);
      return popularTokens.slice(0, limit);
    }
  }
}

export const tokenService = new TokenService();