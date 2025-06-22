import { ethers } from 'ethers';
import { TokenInfo, ChainConfig, ChainType } from './types';

export class MockTokenService {
  private providers: Map<number, ethers.Provider>;
  private mockTokens: Map<string, TokenInfo> = new Map();
  private mockPrices: Map<string, number> = new Map();

  constructor(providers?: Map<number, ethers.Provider>) {
    this.providers = providers || new Map();
    this.initializeMockData();
  }

  private initializeMockData() {
    // Mock popular tokens with realistic data
    const mockTokenData = [
      // Ethereum tokens
      { chainId: 1, address: ethers.ZeroAddress, symbol: 'ETH', name: 'Ethereum', decimals: 18, price: 2000 },
      { chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6, price: 1 },
      { chainId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6, price: 1 },
      { chainId: 1, address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, price: 2000 },
      { chainId: 1, address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, price: 45000 },
      { chainId: 1, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, price: 1 },

      // BSC tokens
      { chainId: 56, address: ethers.ZeroAddress, symbol: 'BNB', name: 'BNB', decimals: 18, price: 300 },
      { chainId: 56, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18, price: 1 },
      { chainId: 56, address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18, price: 1 },
      { chainId: 56, address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, price: 2000 },
      { chainId: 56, address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 18, price: 45000 },
      { chainId: 56, address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD', name: 'Binance USD', decimals: 18, price: 1 },

      // Polygon tokens
      { chainId: 137, address: ethers.ZeroAddress, symbol: 'MATIC', name: 'Polygon', decimals: 18, price: 0.8 },
      { chainId: 137, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', name: 'USD Coin', decimals: 6, price: 1 },
      { chainId: 137, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD', decimals: 6, price: 1 },
      { chainId: 137, address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, price: 2000 },
      { chainId: 137, address: '0x1bfd67037b42cf73acF2047067bd4F2C47D9BfD6', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, price: 45000 },
      { chainId: 137, address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, price: 1 },

      // Arbitrum tokens
      { chainId: 42161, address: ethers.ZeroAddress, symbol: 'ETH', name: 'Ethereum', decimals: 18, price: 2000 },
      { chainId: 42161, address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC', name: 'USD Coin', decimals: 6, price: 1 },
      { chainId: 42161, address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', name: 'Tether USD', decimals: 6, price: 1 },
      { chainId: 42161, address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, price: 2000 },
      { chainId: 42161, address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, price: 45000 },

      // Optimism tokens
      { chainId: 10, address: ethers.ZeroAddress, symbol: 'ETH', name: 'Ethereum', decimals: 18, price: 2000 },
      { chainId: 10, address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', symbol: 'USDC', name: 'USD Coin', decimals: 6, price: 1 },
      { chainId: 10, address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', name: 'Tether USD', decimals: 6, price: 1 },
      { chainId: 10, address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, price: 2000 },
      { chainId: 10, address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, price: 45000 },

      // Avalanche tokens
      { chainId: 43114, address: ethers.ZeroAddress, symbol: 'AVAX', name: 'Avalanche', decimals: 18, price: 25 },
      { chainId: 43114, address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', name: 'USD Coin', decimals: 6, price: 1 },
      { chainId: 43114, address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', symbol: 'USDT', name: 'Tether USD', decimals: 6, price: 1 },
      { chainId: 43114, address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, price: 2000 },
      { chainId: 43114, address: '0x50b7545627a5162F82A992c33b87aDc75187B218', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, price: 45000 }
    ];

    // Initialize mock data
    mockTokenData.forEach(token => {
      const tokenInfo: TokenInfo = {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        chainId: token.chainId,
        priceUSD: token.price
      };
      
      const key = `${token.chainId}-${token.address.toLowerCase()}`;
      this.mockTokens.set(key, tokenInfo);
      this.mockPrices.set(key, token.price);
    });
  }

  async getTokenInfo(chainId: number, tokenAddress: string): Promise<TokenInfo> {
    const key = `${chainId}-${tokenAddress.toLowerCase()}`;
    const token = this.mockTokens.get(key);
    
    if (token) {
      return token;
    }

    // Handle native token fallback
    if (tokenAddress === ethers.ZeroAddress) {
      const chainConfig = this.getChainConfig(chainId);
      return {
        address: ethers.ZeroAddress,
        symbol: chainConfig.nativeCurrency.symbol,
        name: chainConfig.nativeCurrency.symbol,
        decimals: chainConfig.nativeCurrency.decimals,
        chainId,
        priceUSD: await this.getNativeTokenPrice(chainId)
      };
    }

    // Return a generic token if not found
    return {
      address: tokenAddress,
      symbol: 'UNKNOWN',
      name: 'Unknown Token',
      decimals: 18,
      chainId,
      priceUSD: 0
    };
  }

  async getTokenBySymbol(chainId: number, symbol: string): Promise<TokenInfo | null> {
    // Find token by symbol on the specified chain
    for (const [key, token] of this.mockTokens.entries()) {
      if (token.chainId === chainId && token.symbol === symbol) {
        return token;
      }
    }
    return null;
  }

  async getTokenBalance(chainId: number, tokenAddress: string, userAddress: string): Promise<string> {
    // Return mock balance - enough for testing
    if (tokenAddress === ethers.ZeroAddress) {
      return ethers.parseEther('100').toString(); // 100 native tokens
    } else {
      const token = await this.getTokenInfo(chainId, tokenAddress);
      return ethers.parseUnits('10000', token.decimals).toString(); // 10,000 tokens
    }
  }

  async getTokenPrice(chainId: number, tokenAddress: string): Promise<number> {
    const key = `${chainId}-${tokenAddress.toLowerCase()}`;
    return this.mockPrices.get(key) || 0;
  }

  async getNativeTokenPrice(chainId: number): Promise<number> {
    const nativePrices: Record<number, number> = {
      1: 2000,    // ETH
      56: 300,    // BNB
      137: 0.8,   // MATIC
      42161: 2000, // ETH on Arbitrum
      10: 2000,   // ETH on Optimism
      43114: 25,  // AVAX
      250: 0.3    // FTM
    };
    
    return nativePrices[chainId] || 1;
  }

  async getGasPrice(chainId: number): Promise<bigint> {
    // Mock gas prices for different chains
    const gasPrices: Record<number, string> = {
      1: '30000000000',      // 30 gwei - Ethereum
      56: '5000000000',      // 5 gwei - BSC
      137: '50000000000',    // 50 gwei - Polygon
      42161: '100000000',    // 0.1 gwei - Arbitrum
      10: '1000000000',      // 1 gwei - Optimism
      43114: '25000000000',  // 25 gwei - Avalanche
      250: '30000000000'     // 30 gwei - Fantom
    };
    
    return BigInt(gasPrices[chainId] || '20000000000');
  }

  getChainConfig(chainId: number): ChainConfig {
    const configs: Record<number, ChainConfig> = {
      1: {
        chainId: 1,
        name: 'Ethereum',
        type: ChainType.EVM,
        rpcUrl: 'https://eth.llamarpc.com',
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://etherscan.io',
        isTestnet: false
      },
      56: {
        chainId: 56,
        name: 'BNB Smart Chain',
        type: ChainType.EVM,
        rpcUrl: 'https://bsc-dataseed.binance.org',
        nativeCurrency: { symbol: 'BNB', decimals: 18 },
        blockExplorer: 'https://bscscan.com',
        isTestnet: false
      },
      137: {
        chainId: 137,
        name: 'Polygon',
        type: ChainType.EVM,
        rpcUrl: 'https://polygon-rpc.com',
        nativeCurrency: { symbol: 'MATIC', decimals: 18 },
        blockExplorer: 'https://polygonscan.com',
        isTestnet: false
      },
      42161: {
        chainId: 42161,
        name: 'Arbitrum One',
        type: ChainType.EVM,
        rpcUrl: 'https://arb1.arbitrum.io/rpc',
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://arbiscan.io',
        isTestnet: false
      },
      10: {
        chainId: 10,
        name: 'Optimism',
        type: ChainType.EVM,
        rpcUrl: 'https://mainnet.optimism.io',
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://optimistic.etherscan.io',
        isTestnet: false
      },
      43114: {
        chainId: 43114,
        name: 'Avalanche',
        type: ChainType.EVM,
        rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
        nativeCurrency: { symbol: 'AVAX', decimals: 18 },
        blockExplorer: 'https://snowtrace.io',
        isTestnet: false
      },
      250: {
        chainId: 250,
        name: 'Fantom',
        type: ChainType.EVM,
        rpcUrl: 'https://rpc.ftm.tools',
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
    const tokens: TokenInfo[] = [];
    
    // Get all tokens for this chain
    for (const [key, token] of this.mockTokens.entries()) {
      if (token.chainId === chainId) {
        tokens.push(token);
      }
    }
    
    return tokens;
  }
}