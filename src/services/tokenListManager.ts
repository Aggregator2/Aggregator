import axios from 'axios';
import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { logger } from '../utils/logger';
import { Token, TokenList, SUPPORTED_CHAINS } from '../types/token';
import { 
  TOKEN_LIST_SOURCES, 
  CHAIN_API_ENDPOINTS, 
  AGGREGATOR_APIS, 
  CONTRACT_VERIFICATION_APIS,
  TokenListSource 
} from '../config/tokens/tokenLists';
import { providerService } from './blockchain/providerService';

const prisma = new PrismaClient();

interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  verified: boolean;
}

export class TokenListManager {
  private redis: Redis;
  private readonly CACHE_PREFIX = 'tokenlist:';
  private readonly METADATA_CACHE_PREFIX = 'token_metadata:';
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly RATE_LIMIT_PREFIX = 'ratelimit:tokenlist:';

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '2') // Separate DB for token lists
    });
  }

  async fetchAllTokenLists(): Promise<void> {
    logger.info('Starting token list synchronization');
    const startTime = Date.now();
    let totalTokens = 0;
    let successfulLists = 0;

    for (const source of TOKEN_LIST_SOURCES) {
      try {
        await this.rateLimitCheck(source.name);
        const tokens = await this.fetchTokenListFromSource(source);
        
        if (tokens.length > 0) {
          await this.cacheTokenList(source.name, tokens);
          await this.storeTokensInDatabase(tokens, source);
          totalTokens += tokens.length;
          successfulLists++;
          
          logger.info(`Fetched ${tokens.length} tokens from ${source.name}`);
        }
        
        // Small delay to be respectful to APIs
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.error(`Failed to fetch token list from ${source.name}:`, error);
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`Token list sync completed: ${totalTokens} tokens from ${successfulLists}/${TOKEN_LIST_SOURCES.length} sources in ${duration}ms`);
  }

  private async fetchTokenListFromSource(source: TokenListSource): Promise<Token[]> {
    try {
      const response = await axios.get(source.url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'TokenAggregator/1.0',
          'Accept': 'application/json'
        }
      });

      const tokenList: TokenList = response.data;
      
      if (!tokenList.tokens || !Array.isArray(tokenList.tokens)) {
        throw new Error('Invalid token list format');
      }

      // Filter tokens for supported chains
      const filteredTokens = tokenList.tokens.filter(token => 
        source.chainIds.includes(token.chainId) &&
        SUPPORTED_CHAINS[token.chainId]
      );

      // Add source metadata
      return filteredTokens.map(token => ({
        ...token,
        extensions: {
          ...token.extensions,
          source: source.name,
          priority: source.priority,
          lastUpdated: new Date().toISOString()
        }
      }));
    } catch (error) {
      logger.error(`Error fetching from ${source.url}:`, error);
      throw error;
    }
  }

  async fetchTokensFromChainAPI(chainId: number): Promise<Token[]> {
    const apiConfig = CHAIN_API_ENDPOINTS[chainId as keyof typeof CHAIN_API_ENDPOINTS];
    if (!apiConfig) {
      return [];
    }

    try {
      await this.rateLimitCheck(`chain_api_${chainId}`);
      
      const response = await axios.get(apiConfig.url, {
        params: (apiConfig as any).params || {},
        timeout: 30000
      });

      return this.parseChainAPIResponse(response.data, chainId, apiConfig.parser);
    } catch (error) {
      logger.error(`Error fetching tokens from chain ${chainId}:`, error);
      return [];
    }
  }

  private parseChainAPIResponse(data: any, chainId: number, parser: string): Token[] {
    switch (parser) {
      case 'tron':
        return this.parseTronTokens(data, chainId);
      case 'cosmos':
        return this.parseCosmosTokens(data, chainId);
      case 'algorand':
        return this.parseAlgorandTokens(data, chainId);
      case 'stellar':
        return this.parseStellarTokens(data, chainId);
      case 'cardano':
        return this.parseCardanoTokens(data, chainId);
      case 'tezos':
        return this.parseTezosTokens(data, chainId);
      default:
        return [];
    }
  }

  private parseTronTokens(data: any, chainId: number): Token[] {
    if (!data.trc20_tokens) return [];
    
    return data.trc20_tokens.map((token: any) => ({
      symbol: token.symbol || 'UNKNOWN',
      name: token.name || 'Unknown Token',
      address: token.contract_address,
      logoURI: token.icon_url || '',
      chainId,
      type: 'TRC-20' as const,
      decimals: token.decimals || 6,
      extensions: {
        volume24h: token.volume24h,
        holders: token.holders_count,
        source: 'TronScan'
      }
    }));
  }

  private parseCosmosTokens(data: any, chainId: number): Token[] {
    if (!data.assets) return [];
    
    return data.assets.map((asset: any) => ({
      symbol: asset.symbol || 'UNKNOWN',
      name: asset.name || asset.display || 'Unknown Token',
      address: asset.base || asset.denom,
      logoURI: asset.logo_URIs?.png || asset.logo_URIs?.svg || '',
      chainId,
      type: 'IBC' as const,
      decimals: asset.denom_units?.[1]?.exponent || 6,
      extensions: {
        description: asset.description,
        coingecko_id: asset.coingecko_id,
        source: 'Cosmos Chain Registry'
      }
    }));
  }

  private parseAlgorandTokens(data: any, chainId: number): Token[] {
    if (!data.assets) return [];
    
    return data.assets
      .filter((asset: any) => asset.deleted === false && asset.params?.name)
      .map((asset: any) => ({
        symbol: asset.params.unit_name || 'UNKNOWN',
        name: asset.params.name || 'Unknown Token',
        address: asset.index.toString(),
        logoURI: asset.params.url || '',
        chainId,
        type: 'ASA' as const,
        decimals: asset.params.decimals || 0,
        extensions: {
          total: asset.params.total,
          creator: asset.params.creator,
          source: 'Algorand Indexer'
        }
      }));
  }

  private parseStellarTokens(data: any, chainId: number): Token[] {
    if (!data._embedded?.records) return [];
    
    return data._embedded.records.map((asset: any) => ({
      symbol: asset.asset_code || 'UNKNOWN',
      name: asset.asset_code || 'Unknown Token',
      address: `${asset.asset_code}-${asset.asset_issuer}`,
      logoURI: '',
      chainId,
      type: 'other' as const,
      decimals: 7, // Stellar default
      extensions: {
        issuer: asset.asset_issuer,
        amount: asset.amount,
        source: 'Stellar Network'
      }
    }));
  }

  private parseCardanoTokens(data: any, chainId: number): Token[] {
    if (!Array.isArray(data)) return [];
    
    return data.map((token: any) => ({
      symbol: token.ticker || token.subject || 'UNKNOWN',
      name: token.name?.value || 'Unknown Token',
      address: token.subject,
      logoURI: token.logo?.value || '',
      chainId,
      type: 'other' as const,
      decimals: token.decimals?.value || 6,
      extensions: {
        policy: token.policy,
        description: token.description?.value,
        source: 'Cardano Token Registry'
      }
    }));
  }

  private parseTezosTokens(data: any, chainId: number): Token[] {
    if (!Array.isArray(data)) return [];
    
    return data.map((token: any) => ({
      symbol: token.symbol || 'UNKNOWN',
      name: token.name || 'Unknown Token',
      address: token.contract,
      logoURI: token.thumbnailUri || '',
      chainId,
      type: 'FA1.2' as const,
      decimals: token.decimals || 0,
      extensions: {
        standard: token.standard,
        totalSupply: token.totalSupply,
        source: 'Better Call Dev'
      }
    }));
  }

  async autoImportToken(address: string, chainId: number): Promise<Token | null> {
    try {
      // Check cache first
      const cacheKey = `${this.METADATA_CACHE_PREFIX}${chainId}:${address.toLowerCase()}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Validate address format
      if (!providerService.validateAddress(chainId, address)) {
        throw new Error('Invalid address format');
      }

      let metadata: TokenMetadata | null = null;

      // Try to fetch from blockchain
      if (SUPPORTED_CHAINS[chainId]?.type === 'EVM') {
        metadata = await this.fetchEVMTokenMetadata(address, chainId);
      } else {
        // For non-EVM chains, we might need specific implementations
        metadata = await this.fetchNonEVMTokenMetadata(address, chainId);
      }

      if (!metadata) {
        throw new Error('Could not fetch token metadata');
      }

      // Verify token on block explorer if possible
      const verification = await this.verifyTokenOnExplorer(address, chainId);
      
      const token: Token = {
        symbol: metadata.symbol,
        name: metadata.name,
        address,
        logoURI: metadata.logoURI || '',
        chainId,
        type: this.getTokenTypeForChain(chainId),
        decimals: metadata.decimals,
        extensions: {
          verified: verification.verified,
          autoImported: true,
          importedAt: new Date().toISOString(),
          verificationSource: verification.source
        }
      };

      // Cache the result
      await this.redis.setex(cacheKey, this.CACHE_TTL * 24, JSON.stringify(token)); // Cache for 24 hours
      
      // Store in database
      await this.storeTokensInDatabase([token], {
        name: 'Auto Import',
        priority: 10
      } as TokenListSource);

      logger.info(`Auto-imported token: ${token.symbol} (${address}) on chain ${chainId}`);
      return token;
    } catch (error) {
      logger.error(`Failed to auto-import token ${address} on chain ${chainId}:`, error);
      return null;
    }
  }

  private async fetchEVMTokenMetadata(address: string, chainId: number): Promise<TokenMetadata | null> {
    try {
      const provider = providerService.getProviderForChain(chainId);
      
      const erc20Abi = [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function totalSupply() view returns (uint256)'
      ];

      const contract = new ethers.Contract(address, erc20Abi, provider);
      
      const [name, symbol, decimals] = await Promise.all([
        contract.name().catch(() => 'Unknown Token'),
        contract.symbol().catch(() => 'UNKNOWN'),
        contract.decimals().catch(() => 18)
      ]);

      return {
        name: name.toString(),
        symbol: symbol.toString(),
        decimals: Number(decimals),
        verified: false // Will be updated by verification step
      };
    } catch (error) {
      logger.error(`Error fetching EVM token metadata for ${address}:`, error);
      return null;
    }
  }

  private async fetchNonEVMTokenMetadata(address: string, chainId: number): Promise<TokenMetadata | null> {
    // Implement chain-specific metadata fetching
    // This would involve calling chain-specific APIs or parsing on-chain data
    logger.warn(`Non-EVM token metadata fetching not implemented for chain ${chainId}`);
    return null;
  }

  private async verifyTokenOnExplorer(address: string, chainId: number): Promise<{ verified: boolean; source?: string }> {
    const explorerConfig = CONTRACT_VERIFICATION_APIS[chainId as keyof typeof CONTRACT_VERIFICATION_APIS];
    if (!explorerConfig || !explorerConfig.apiKey) {
      return { verified: false };
    }

    try {
      const response = await axios.get(explorerConfig.url, {
        params: {
          module: 'contract',
          action: 'getabi',
          address,
          apikey: explorerConfig.apiKey
        },
        timeout: 10000
      });

      const verified = response.data.status === '1' && response.data.result !== 'Contract source code not verified';
      
      return {
        verified,
        source: explorerConfig.name
      };
    } catch (error) {
      logger.warn(`Failed to verify token ${address} on ${explorerConfig.name}:`, error);
      return { verified: false };
    }
  }

  private getTokenTypeForChain(chainId: number): Token['type'] {
    const chain = SUPPORTED_CHAINS[chainId];
    if (!chain) return 'other';

    switch (chain.type) {
      case 'EVM':
        return chainId === 56 ? 'BEP-20' : 'ERC-20';
      case 'TRON':
        return 'TRC-20';
      case 'SOLANA':
        return 'SPL';
      case 'COSMOS':
        return 'IBC';
      case 'ALGORAND':
        return 'ASA';
      case 'TEZOS':
        return 'FA1.2';
      default:
        return 'other';
    }
  }

  private async cacheTokenList(sourceName: string, tokens: Token[]): Promise<void> {
    const cacheKey = `${this.CACHE_PREFIX}${sourceName}`;
    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(tokens));
  }

  private async storeTokensInDatabase(tokens: Token[], source: TokenListSource): Promise<void> {
    try {
      // In a real implementation, you would batch insert these tokens
      // with proper conflict resolution and metadata updates
      logger.info(`Would store ${tokens.length} tokens from ${source.name} in database`);
      
      // Example of how this might work:
      // await prisma.token.createMany({
      //   data: tokens.map(token => ({
      //     ...token,
      //     sourceId: source.name,
      //     priority: source.priority
      //   })),
      //   skipDuplicates: true
      // });
    } catch (error) {
      logger.error('Error storing tokens in database:', error);
    }
  }

  private async rateLimitCheck(identifier: string): Promise<void> {
    const key = `${this.RATE_LIMIT_PREFIX}${identifier}`;
    const count = await this.redis.incr(key);
    
    if (count === 1) {
      await this.redis.expire(key, 60); // 1 minute window
    }
    
    if (count > 30) { // Max 30 requests per minute
      throw new Error(`Rate limit exceeded for ${identifier}`);
    }
  }

  async getTokensByChain(chainId: number, limit = 100): Promise<Token[]> {
    const tokens: Token[] = [];
    
    // Get tokens from all sources for this chain
    for (const source of TOKEN_LIST_SOURCES.filter(s => s.chainIds.includes(chainId))) {
      const cacheKey = `${this.CACHE_PREFIX}${source.name}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        const sourceTokens: Token[] = JSON.parse(cached);
        tokens.push(...sourceTokens.filter(t => t.chainId === chainId));
      }
    }

    // Deduplicate by address (keep highest priority)
    const tokenMap = new Map<string, Token>();
    tokens.forEach(token => {
      const key = token.address.toLowerCase();
      const existing = tokenMap.get(key);
      
      if (!existing || (token.extensions?.priority || 0) > (existing.extensions?.priority || 0)) {
        tokenMap.set(key, token);
      }
    });

    return Array.from(tokenMap.values())
      .sort((a, b) => (b.extensions?.priority || 0) - (a.extensions?.priority || 0))
      .slice(0, limit);
  }

  async searchTokens(query: string, chainId?: number): Promise<Token[]> {
    const allTokens: Token[] = [];
    const searchChains = chainId ? [chainId] : Object.keys(SUPPORTED_CHAINS).map(Number);

    for (const chain of searchChains) {
      const chainTokens = await this.getTokensByChain(chain, 1000);
      allTokens.push(...chainTokens);
    }

    const lowerQuery = query.toLowerCase();
    return allTokens.filter(token => 
      token.symbol.toLowerCase().includes(lowerQuery) ||
      token.name.toLowerCase().includes(lowerQuery) ||
      token.address.toLowerCase().includes(lowerQuery)
    );
  }
}

export const tokenListManager = new TokenListManager();