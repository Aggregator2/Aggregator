import { ethers } from 'ethers';
import axios from 'axios';
import { TokenInfo, ChainConfig, ChainType } from './types';

export class TokenService {
  private providers: Map<number, ethers.Provider>;
  private tokenCache: Map<string, TokenInfo> = new Map();
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly PRICE_CACHE_TTL = 60000; // 1 minute

  constructor(providers?: Map<number, ethers.Provider>) {
    this.providers = providers || this.createDefaultProviders();
  }

  private createDefaultProviders(): Map<number, ethers.Provider> {
    const providers = new Map<number, ethers.Provider>();
    
    // Add providers for major chains
    const rpcUrls: Record<number, string> = {
      1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      56: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      137: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      42161: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      10: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
      43114: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      250: process.env.FANTOM_RPC_URL || 'https://rpc.ftm.tools'
    };

    for (const [chainId, rpcUrl] of Object.entries(rpcUrls)) {
      providers.set(Number(chainId), new ethers.JsonRpcProvider(rpcUrl));
    }

    return providers;
  }

  async getTokenInfo(chainId: number, tokenAddress: string): Promise<TokenInfo> {
    const cacheKey = `${chainId}-${tokenAddress.toLowerCase()}`;
    
    if (this.tokenCache.has(cacheKey)) {
      return this.tokenCache.get(cacheKey)!;
    }

    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider for chain ${chainId}`);
    }

    // Handle native token (both zero address and the special 0xEeee address)
    if (tokenAddress === ethers.ZeroAddress || 
        tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      const chainConfig = this.getChainConfig(chainId);
      const nativeToken: TokenInfo = {
        address: tokenAddress, // Keep the original address
        symbol: chainConfig.nativeCurrency.symbol,
        name: chainConfig.nativeCurrency.symbol,
        decimals: chainConfig.nativeCurrency.decimals,
        chainId,
        priceUSD: await this.getNativeTokenPrice(chainId)
      };
      this.tokenCache.set(cacheKey, nativeToken);
      return nativeToken;
    }

    // Get token info from contract
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function symbol() view returns (string)', 
       'function name() view returns (string)', 
       'function decimals() view returns (uint8)'],
      provider
    );

    try {
      const [symbol, name, decimals] = await Promise.all([
        tokenContract.symbol().catch(() => 'UNKNOWN'),
        tokenContract.name().catch(() => 'Unknown Token'),
        tokenContract.decimals().catch(() => 18)
      ]);

      const tokenInfo: TokenInfo = {
        address: tokenAddress,
        symbol,
        name,
        decimals,
        chainId,
        priceUSD: await this.getTokenPrice(chainId, tokenAddress)
      };

      this.tokenCache.set(cacheKey, tokenInfo);
      return tokenInfo;
    } catch (error: any) {
      console.error('Token info error:', error);
      throw new Error(`Failed to get token info for ${tokenAddress} on chain ${chainId}: ${error.message}`);
    }
  }

  async getTokenBySymbol(chainId: number, symbol: string): Promise<TokenInfo | null> {
    // Common token addresses by chain
    const tokenAddresses: Record<number, Record<string, string>> = {
      1: { // Ethereum
        'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        'WETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F'
      },
      56: { // BSC
        'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        'USDT': '0x55d398326f99059fF775485246999027B3197955',
        'WETH': '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
        'WBTC': '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
        'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56'
      },
      137: { // Polygon
        'USDC': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        'USDT': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        'WETH': '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        'WBTC': '0x1bfd67037b42cf73acF2047067bd4F2C47D9BfD6',
        'DAI': '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'
      }
      // Add more chains as needed
    };

    const addresses = tokenAddresses[chainId];
    if (!addresses || !addresses[symbol]) {
      return null;
    }

    return this.getTokenInfo(chainId, addresses[symbol]);
  }

  async getTokenBalance(chainId: number, tokenAddress: string, userAddress: string): Promise<string> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider for chain ${chainId}`);
    }

    // Handle native token (both zero address and the special 0xEeee address)
    if (tokenAddress === ethers.ZeroAddress || 
        tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      return (await provider.getBalance(userAddress)).toString();
    }

    // ERC20 token
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );

    return (await tokenContract.balanceOf(userAddress)).toString();
  }

  async getTokenPrice(chainId: number, tokenAddress: string): Promise<number> {
    // Check if it's a native token
    if (tokenAddress === ethers.ZeroAddress || 
        tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      return this.getNativeTokenPrice(chainId);
    }
    
    const cacheKey = `price-${chainId}-${tokenAddress.toLowerCase()}`;
    const cached = this.priceCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.PRICE_CACHE_TTL) {
      return cached.price;
    }

    try {
      // Use CoinGecko API (you'd want to use your own API key in production)
      const chainIdToPlatform: Record<number, string> = {
        1: 'ethereum',
        56: 'binance-smart-chain',
        137: 'polygon-pos',
        42161: 'arbitrum-one',
        10: 'optimistic-ethereum',
        43114: 'avalanche',
        250: 'fantom'
      };

      const platform = chainIdToPlatform[chainId];
      if (!platform) return 0;

      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/token_price/${platform}`,
        {
          params: {
            contract_addresses: tokenAddress,
            vs_currencies: 'usd'
          }
        }
      );

      const price = response.data[tokenAddress.toLowerCase()]?.usd || 0;
      this.priceCache.set(cacheKey, { price, timestamp: Date.now() });
      
      return price;
    } catch (error) {
      console.error('Error fetching token price:', error);
      return 0;
    }
  }

  async getNativeTokenPrice(chainId: number): Promise<number> {
    const cacheKey = `native-price-${chainId}`;
    const cached = this.priceCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.PRICE_CACHE_TTL) {
      return cached.price;
    }
    
    const nativeTokenIds: Record<number, string> = {
      1: 'ethereum',
      56: 'binancecoin',
      137: 'matic-network',
      42161: 'ethereum', // Arbitrum uses ETH
      10: 'ethereum', // Optimism uses ETH
      43114: 'avalanche-2',
      250: 'fantom'
    };

    const tokenId = nativeTokenIds[chainId];
    if (!tokenId) return 0;

    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: {
            ids: tokenId,
            vs_currencies: 'usd'
          }
        }
      );

      const price = response.data[tokenId]?.usd || 0;
      this.priceCache.set(cacheKey, { price, timestamp: Date.now() });
      return price;
    } catch (error) {
      console.error('Error fetching native token price:', error);
      // Return fallback prices
      const fallbackPrices: Record<number, number> = {
        1: 3500,    // ETH
        56: 600,    // BNB
        137: 1.2,   // MATIC
        42161: 3500, // ETH on Arbitrum
        10: 3500,   // ETH on Optimism
        43114: 40,  // AVAX
        250: 0.5    // FTM
      };
      return fallbackPrices[chainId] || 0;
    }
  }

  async getGasPrice(chainId: number): Promise<bigint> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider for chain ${chainId}`);
    }

    const feeData = await provider.getFeeData();
    return feeData.gasPrice || 0n;
  }

  getChainConfig(chainId: number): ChainConfig {
    const configs: Record<number, ChainConfig> = {
      1: {
        chainId: 1,
        name: 'Ethereum',
        type: ChainType.EVM,
        rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://etherscan.io',
        isTestnet: false
      },
      56: {
        chainId: 56,
        name: 'BNB Smart Chain',
        type: ChainType.EVM,
        rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
        nativeCurrency: { symbol: 'BNB', decimals: 18 },
        blockExplorer: 'https://bscscan.com',
        isTestnet: false
      },
      137: {
        chainId: 137,
        name: 'Polygon',
        type: ChainType.EVM,
        rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
        nativeCurrency: { symbol: 'MATIC', decimals: 18 },
        blockExplorer: 'https://polygonscan.com',
        isTestnet: false
      },
      42161: {
        chainId: 42161,
        name: 'Arbitrum One',
        type: ChainType.EVM,
        rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://arbiscan.io',
        isTestnet: false
      },
      10: {
        chainId: 10,
        name: 'Optimism',
        type: ChainType.EVM,
        rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://optimistic.etherscan.io',
        isTestnet: false
      },
      43114: {
        chainId: 43114,
        name: 'Avalanche',
        type: ChainType.EVM,
        rpcUrl: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
        nativeCurrency: { symbol: 'AVAX', decimals: 18 },
        blockExplorer: 'https://snowtrace.io',
        isTestnet: false
      },
      250: {
        chainId: 250,
        name: 'Fantom',
        type: ChainType.EVM,
        rpcUrl: process.env.FANTOM_RPC_URL || 'https://rpc.ftm.tools',
        nativeCurrency: { symbol: 'FTM', decimals: 18 },
        blockExplorer: 'https://ftmscan.com',
        isTestnet: false
      }
    };

    const config = configs[chainId];
    if (!config) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    return config;
  }

  async getPopularTokens(chainId: number): Promise<TokenInfo[]> {
    // Return common tokens for each chain
    const popularSymbols = ['USDC', 'USDT', 'WETH', 'WBTC', 'DAI'];
    const tokens: TokenInfo[] = [];

    for (const symbol of popularSymbols) {
      try {
        const token = await this.getTokenBySymbol(chainId, symbol);
        if (token) tokens.push(token);
      } catch (error) {
        // Skip if token doesn't exist on this chain
      }
    }

    return tokens;
  }
}