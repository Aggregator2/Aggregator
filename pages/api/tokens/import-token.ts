import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';

// ERC-20 ABI for basic token info
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
];

// RPC endpoints for different chains
const RPC_ENDPOINTS: Record<number, string[]> = {
  1: [
    process.env.ETHEREUM_RPC || 'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
    'https://ethereum.publicnode.com'
  ],
  56: [
    'https://bsc-dataseed1.binance.org',
    'https://rpc.ankr.com/bsc'
  ],
  137: [
    'https://polygon-rpc.com',
    'https://rpc.ankr.com/polygon'
  ],
  43114: [
    'https://api.avax.network/ext/bc/C/rpc',
    'https://rpc.ankr.com/avalanche'
  ],
  42161: [
    'https://arb1.arbitrum.io/rpc',
    'https://rpc.ankr.com/arbitrum'
  ],
  10: [
    'https://mainnet.optimism.io',
    'https://rpc.ankr.com/optimism'
  ],
  250: [
    'https://rpc.ftm.tools',
    'https://rpc.ankr.com/fantom'
  ]
};

async function getProviderForChain(chainId: number): Promise<ethers.JsonRpcProvider | null> {
  const endpoints = RPC_ENDPOINTS[chainId];
  if (!endpoints) return null;

  for (const endpoint of endpoints) {
    try {
      const provider = new ethers.JsonRpcProvider(endpoint);
      // Test the provider
      await provider.getBlockNumber();
      return provider;
    } catch (error) {
      continue;
    }
  }

  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { address, chainId = 1, userAddress } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'Token address is required' });
    }

    // Validate address format for EVM chains
    if (chainId !== 101 && !ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid token address format' });
    }

    // Special handling for Solana
    if (chainId === 101) {
      return res.status(400).json({ 
        error: 'Solana token import not yet supported. Please use the search to find SPL tokens.' 
      });
    }

    // Get provider for the chain
    const provider = await getProviderForChain(chainId);
    if (!provider) {
      return res.status(400).json({ 
        error: `Chain ${chainId} not supported for token import` 
      });
    }

    // Create contract instance
    const contract = new ethers.Contract(address, ERC20_ABI, provider);

    // Fetch token information
    const [name, symbol, decimals, totalSupply] = await Promise.allSettled([
      contract.name(),
      contract.symbol(),
      contract.decimals(),
      contract.totalSupply()
    ]);

    // Check if we got valid responses
    if (name.status === 'rejected' || symbol.status === 'rejected') {
      return res.status(400).json({ 
        error: 'Invalid token contract or contract does not implement ERC-20 standard' 
      });
    }

    const tokenDecimals = decimals.status === 'fulfilled' ? decimals.value : 18;
    const tokenTotalSupply = totalSupply.status === 'fulfilled' ? totalSupply.value.toString() : '0';

    // Get token type based on chain
    const getTokenType = (chainId: number): string => {
      switch (chainId) {
        case 1:
        case 42161:
        case 10:
        case 137:
          return 'ERC-20';
        case 56:
          return 'BEP-20';
        case 43114:
          return 'ARC-20';
        case 250:
          return 'FTM-20';
        default:
          return 'ERC-20';
      }
    };

    // Create token object
    const token = {
      symbol: symbol.value.toUpperCase(),
      name: name.value,
      address: address,
      chainId,
      type: getTokenType(chainId),
      decimals: Number(tokenDecimals),
      logoURI: `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${getBlockchainName(chainId)}/assets/${address}/logo.png`,
      tags: ['imported', 'custom'],
      extensions: {
        source: 'user-import',
        verified: false,
        importedBy: userAddress || 'anonymous',
        importedAt: new Date().toISOString(),
        totalSupply: tokenTotalSupply,
        onChainVerified: true
      }
    };

    return res.status(200).json({
      success: true,
      token,
      message: 'Token imported successfully'
    });

  } catch (error) {
    console.error('Token import error:', error);

    let errorMessage = 'Failed to import token';
    
    if (error instanceof Error) {
      if (error.message.includes('network')) {
        errorMessage = 'Network error. Please try again.';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Request timeout. Please try again.';
      } else if (error.message.includes('revert')) {
        errorMessage = 'Invalid token contract.';
      } else {
        errorMessage = error.message;
      }
    }

    return res.status(500).json({
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
}

function getBlockchainName(chainId: number): string {
  const chainNames: Record<number, string> = {
    1: 'ethereum',
    56: 'smartchain',
    137: 'polygon',
    43114: 'avalanchec',
    42161: 'arbitrum',
    10: 'optimism',
    250: 'fantom'
  };

  return chainNames[chainId] || 'ethereum';
}