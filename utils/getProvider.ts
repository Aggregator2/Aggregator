import { ethers } from 'ethers';

/**
 * Get the appropriate provider based on the connected chain
 */
export async function getProvider(): Promise<ethers.BrowserProvider | null> {
  if (typeof window === 'undefined' || !window.ethereum) {
    console.warn('[getProvider] No ethereum provider available');
    return null;
  }

  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    
    // Get the connected network
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    
    console.log('[getProvider] Connected to network:', {
      chainId,
      name: network.name,
      expectedChainId: process.env.NEXT_PUBLIC_CHAIN_ID
    });
    
    // Check if we're on the expected network
    const expectedChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 1);
    if (chainId !== expectedChainId) {
      console.warn(`[getProvider] Wrong network. Expected ${expectedChainId}, got ${chainId}`);
      
      // Try to switch to the correct network
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${expectedChainId.toString(16)}` }],
        });
        
        // Return new provider after switch
        return new ethers.BrowserProvider(window.ethereum);
      } catch (switchError: any) {
        console.error('[getProvider] Failed to switch network:', switchError);
        // Return provider anyway, but it's on wrong network
        return provider;
      }
    }
    
    return provider;
  } catch (error) {
    console.error('[getProvider] Error creating provider:', error);
    return null;
  }
}

/**
 * Get a fallback JSON-RPC provider for mainnet
 */
export function getFallbackProvider(): ethers.JsonRpcProvider {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_MAINNET || 'https://eth.llamarpc.com';
  return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Token addresses by chain ID
 */
export const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  1: { // Mainnet
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  137: { // Polygon
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  },
  42161: { // Arbitrum
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  10: { // Optimism
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  8453: { // Base
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    WETH: '0x4200000000000000000000000000000000000006',
  }
};

/**
 * Get token address for current chain
 */
export function getTokenAddress(symbol: string, chainId: number): string | undefined {
  const chainTokens = TOKEN_ADDRESSES[chainId];
  if (!chainTokens) {
    console.warn(`[getTokenAddress] No token addresses for chain ${chainId}`);
    return undefined;
  }
  
  const address = chainTokens[symbol.toUpperCase()];
  if (!address) {
    console.warn(`[getTokenAddress] No address for ${symbol} on chain ${chainId}`);
  }
  
  return address;
}