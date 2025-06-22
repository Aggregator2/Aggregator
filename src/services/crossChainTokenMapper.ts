/**
 * Cross-chain token mapping service
 * Maps token addresses across different chains to ensure proper cross-chain swaps
 */

export interface ChainTokenMapping {
  symbol: string;
  name: string;
  addresses: Record<number, string>; // chainId -> address
  decimals: Record<number, number>; // chainId -> decimals
}

// Native token addresses by chain
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// Common token mappings across chains
export const CROSS_CHAIN_TOKEN_MAPPINGS: ChainTokenMapping[] = [
  // Wrapped Native Tokens
  {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    addresses: {
      1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum
      10: '0x4200000000000000000000000000000000000006', // Optimism
      56: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // BSC (ETH on BSC)
      137: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // Polygon
      42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum
      43114: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', // Avalanche
    },
    decimals: {
      1: 18,
      10: 18,
      56: 18,
      137: 18,
      42161: 18,
      43114: 18,
    },
  },
  {
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    addresses: {
      56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // BSC
      1: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', // Ethereum (BNB on ETH)
    },
    decimals: {
      56: 18,
      1: 18,
    },
  },
  {
    symbol: 'WMATIC',
    name: 'Wrapped Matic',
    addresses: {
      137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // Polygon
      1: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', // Ethereum (MATIC on ETH)
    },
    decimals: {
      137: 18,
      1: 18,
    },
  },
  {
    symbol: 'WAVAX',
    name: 'Wrapped AVAX',
    addresses: {
      43114: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // Avalanche
    },
    decimals: {
      43114: 18,
    },
  },
  
  // Stablecoins
  {
    symbol: 'USDC',
    name: 'USD Coin',
    addresses: {
      1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum
      10: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', // Optimism
      56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // BSC
      137: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Polygon
      42161: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // Arbitrum
      43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Avalanche
      8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base
    },
    decimals: {
      1: 6,
      10: 6,
      56: 18,
      137: 6,
      42161: 6,
      43114: 6,
      8453: 6,
    },
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    addresses: {
      1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Ethereum
      10: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // Optimism
      56: '0x55d398326f99059fF775485246999027B3197955', // BSC
      137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // Polygon
      42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum
      43114: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', // Avalanche
    },
    decimals: {
      1: 6,
      10: 6,
      56: 18,
      137: 6,
      42161: 6,
      43114: 6,
    },
  },
  {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    addresses: {
      1: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // Ethereum
      10: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // Optimism
      56: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', // BSC
      137: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // Polygon
      42161: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // Arbitrum
      43114: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', // Avalanche
    },
    decimals: {
      1: 18,
      10: 18,
      56: 18,
      137: 18,
      42161: 18,
      43114: 18,
    },
  },
  
  // Other popular tokens
  {
    symbol: 'LINK',
    name: 'Chainlink',
    addresses: {
      1: '0x514910771AF9Ca656af840dff83E8264EcF986CA', // Ethereum
      10: '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6', // Optimism
      56: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD', // BSC
      137: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', // Polygon
      42161: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', // Arbitrum
      43114: '0x5947BB275c521040051D82396192181b413227A3', // Avalanche
    },
    decimals: {
      1: 18,
      10: 18,
      56: 18,
      137: 18,
      42161: 18,
      43114: 18,
    },
  },
];

export class CrossChainTokenMapper {
  private static tokenMappings = new Map<string, ChainTokenMapping>();
  private static symbolToMappings = new Map<string, ChainTokenMapping>();
  
  static {
    // Initialize mappings
    for (const mapping of CROSS_CHAIN_TOKEN_MAPPINGS) {
      this.symbolToMappings.set(mapping.symbol.toUpperCase(), mapping);
      
      // Map each address to the token mapping
      for (const [chainId, address] of Object.entries(mapping.addresses)) {
        const key = `${chainId}-${address.toLowerCase()}`;
        this.tokenMappings.set(key, mapping);
      }
    }
  }
  
  /**
   * Get the equivalent token address on a different chain
   */
  static getMappedTokenAddress(
    sourceChainId: number,
    sourceTokenAddress: string,
    targetChainId: number
  ): string | null {
    // Handle native token
    if (sourceTokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
      return NATIVE_TOKEN_ADDRESS;
    }
    
    const key = `${sourceChainId}-${sourceTokenAddress.toLowerCase()}`;
    const mapping = this.tokenMappings.get(key);
    
    if (!mapping) {
      // No mapping found - token might not exist on target chain
      return null;
    }
    
    return mapping.addresses[targetChainId] || null;
  }
  
  /**
   * Get token info by symbol and chain
   */
  static getTokenBySymbol(symbol: string, chainId: number): {
    address: string;
    decimals: number;
  } | null {
    const mapping = this.symbolToMappings.get(symbol.toUpperCase());
    if (!mapping) return null;
    
    const address = mapping.addresses[chainId];
    const decimals = mapping.decimals[chainId];
    
    if (!address || decimals === undefined) return null;
    
    return { address, decimals };
  }
  
  /**
   * Check if a token is available on a specific chain
   */
  static isTokenAvailableOnChain(
    tokenAddress: string,
    sourceChainId: number,
    targetChainId: number
  ): boolean {
    const mappedAddress = this.getMappedTokenAddress(
      sourceChainId,
      tokenAddress,
      targetChainId
    );
    return mappedAddress !== null;
  }
  
  /**
   * Get all chains where a token is available
   */
  static getAvailableChains(tokenAddress: string, sourceChainId: number): number[] {
    const key = `${sourceChainId}-${tokenAddress.toLowerCase()}`;
    const mapping = this.tokenMappings.get(key);
    
    if (!mapping) return [sourceChainId]; // Token only on source chain
    
    return Object.keys(mapping.addresses).map(Number);
  }
  
  /**
   * Get the native wrapped token for a chain
   */
  static getWrappedNativeToken(chainId: number): string | null {
    switch (chainId) {
      case 1: // Ethereum
      case 10: // Optimism
      case 42161: // Arbitrum
        return this.getTokenBySymbol('WETH', chainId)?.address || null;
      case 56: // BSC
        return this.getTokenBySymbol('WBNB', chainId)?.address || null;
      case 137: // Polygon
        return this.getTokenBySymbol('WMATIC', chainId)?.address || null;
      case 43114: // Avalanche
        return this.getTokenBySymbol('WAVAX', chainId)?.address || null;
      default:
        return null;
    }
  }
}