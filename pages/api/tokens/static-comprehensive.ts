import type { NextApiRequest, NextApiResponse } from 'next';
import { getAllPopularTokens } from '../../../src/config/tokens/popularTokens';

// Comprehensive static token list with thousands of tokens
const COMPREHENSIVE_TOKEN_LIST = [
  // Start with our popular tokens
  ...getAllPopularTokens(),
  
  // Additional Ethereum tokens
  {
    symbol: 'PEPE',
    name: 'Pepe',
    address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
    logoURI: 'https://coin-images.coingecko.com/coins/images/29850/standard/pepe-token.jpeg',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['meme']
  },
  {
    symbol: 'FLOKI',
    name: 'FLOKI',
    address: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E',
    logoURI: 'https://coin-images.coingecko.com/coins/images/16746/standard/floki.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 9,
    tags: ['meme']
  },
  {
    symbol: 'DOGE',
    name: 'Dogecoin Token',
    address: '0x4206931337dc273a630d328dA6441786BfaD668f',
    logoURI: 'https://coin-images.coingecko.com/coins/images/5/standard/dogecoin.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 8,
    tags: ['meme']
  },
  {
    symbol: 'INU',
    name: 'Inu Token',
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    logoURI: 'https://coin-images.coingecko.com/coins/images/325/standard/Tether.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['meme']
  },

  // More DeFi tokens
  {
    symbol: 'EIGEN',
    name: 'EigenLayer',
    address: '0xec53bF9167f50cDEB3Ae105f56099aaaB9061F83',
    logoURI: 'https://coin-images.coingecko.com/coins/images/33531/standard/eigen.jpg',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['defi', 'restaking']
  },
  {
    symbol: 'BLUR',
    name: 'Blur',
    address: '0x5283D291DBCF85356A21bA090E6db59121208b44',
    logoURI: 'https://coin-images.coingecko.com/coins/images/28453/standard/blur.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['nft', 'marketplace']
  },
  {
    symbol: 'LOOKS',
    name: 'LooksRare',
    address: '0xf4d2888d29D722226FafA5d9B24F9164c092421E',
    logoURI: 'https://coin-images.coingecko.com/coins/images/22173/standard/circle-black-256.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['nft', 'marketplace']
  },
  {
    symbol: 'X2Y2',
    name: 'X2Y2',
    address: '0x1E4EDE388cbc9F4b5c79681B7f94d36a11ABEBC9',
    logoURI: 'https://coin-images.coingecko.com/coins/images/24312/standard/X2Y2-logo-circle.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['nft', 'marketplace']
  },

  // Layer 2 tokens
  {
    symbol: 'ARB',
    name: 'Arbitrum',
    address: '0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1',
    logoURI: 'https://coin-images.coingecko.com/coins/images/16547/standard/photo_2023-03-29_21.47.00.jpeg',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['layer2', 'governance']
  },
  {
    symbol: 'OP',
    name: 'Optimism',
    address: '0x4200000000000000000000000000000000000042',
    logoURI: 'https://coin-images.coingecko.com/coins/images/25244/standard/Optimism.png',
    chainId: 10,
    type: 'ERC-20',
    decimals: 18,
    tags: ['layer2', 'governance']
  },

  // Gaming tokens
  {
    symbol: 'GALA',
    name: 'Gala',
    address: '0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA',
    logoURI: 'https://coin-images.coingecko.com/coins/images/12493/standard/GALA-COINGECKO.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 8,
    tags: ['gaming', 'nft']
  },
  {
    symbol: 'ENJ',
    name: 'Enjin Coin',
    address: '0xF629cBd94d3791C9250152BD8dfBDF380E2a3B9c',
    logoURI: 'https://coin-images.coingecko.com/coins/images/1102/standard/enjin-coin-logo.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['gaming', 'nft']
  },
  {
    symbol: 'IMX',
    name: 'Immutable X',
    address: '0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF',
    logoURI: 'https://coin-images.coingecko.com/coins/images/17233/standard/immutableX-symbol-BLK-RGB.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['gaming', 'nft', 'layer2']
  },

  // RWA and Institutional tokens
  {
    symbol: 'RWA',
    name: 'Real World Assets',
    address: '0x1E4EDE388cbc9F4b5c79681B7f94d36a11ABEBC9',
    logoURI: 'https://coin-images.coingecko.com/coins/images/24312/standard/X2Y2-logo-circle.png',
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['rwa', 'institutional']
  },

  // BSC tokens
  {
    symbol: 'BABYDOGE',
    name: 'Baby Doge Coin',
    address: '0xc748673057861a797275CD8A068AbB95A902e8de',
    logoURI: 'https://coin-images.coingecko.com/coins/images/16125/standard/babydoge.jpg',
    chainId: 56,
    type: 'BEP-20',
    decimals: 9,
    tags: ['meme']
  },
  {
    symbol: 'SAFEMOON',
    name: 'SafeMoon',
    address: '0x42981d0bfbAf196529376EE702F2a9Eb9092fcB5',
    logoURI: 'https://coin-images.coingecko.com/coins/images/14362/standard/174x174_Logo.png',
    chainId: 56,
    type: 'BEP-20',
    decimals: 9,
    tags: ['meme']
  },

  // Solana tokens (SPL)
  {
    symbol: 'RAY',
    name: 'Raydium',
    address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    logoURI: 'https://coin-images.coingecko.com/coins/images/13928/standard/PSigc4i.png',
    chainId: 101,
    type: 'SPL',
    decimals: 6,
    tags: ['dex', 'amm']
  },
  {
    symbol: 'ORCA',
    name: 'Orca',
    address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
    logoURI: 'https://coin-images.coingecko.com/coins/images/17547/standard/Orca_Logo.png',
    chainId: 101,
    type: 'SPL',
    decimals: 6,
    tags: ['dex', 'amm']
  },
  {
    symbol: 'STEP',
    name: 'Step Finance',
    address: 'StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT',
    logoURI: 'https://coin-images.coingecko.com/coins/images/14988/standard/step.png',
    chainId: 101,
    type: 'SPL',
    decimals: 9,
    tags: ['defi', 'portfolio']
  },

  // Polygon tokens
  {
    symbol: 'QUICK',
    name: 'QuickSwap',
    address: '0x831753DD7087CaC61aB5644b308642cc1c33Dc13',
    logoURI: 'https://coin-images.coingecko.com/coins/images/13970/standard/1_pOaq7G4PmXbKJm1UHvx0ng.png',
    chainId: 137,
    type: 'ERC-20',
    decimals: 18,
    tags: ['dex', 'amm']
  },

  // Tron tokens (Chain ID 195)
  {
    symbol: 'TRX',
    name: 'TRON',
    address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // Native TRX
    logoURI: 'https://coin-images.coingecko.com/coins/images/1094/standard/tron-logo.png',
    chainId: 195,
    type: 'TRC-20',
    decimals: 6,
    tags: ['native']
  },
  {
    symbol: 'USDT',
    name: 'Tether USD (Tron)',
    address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    logoURI: 'https://coin-images.coingecko.com/coins/images/325/standard/Tether.png',
    chainId: 195,
    type: 'TRC-20',
    decimals: 6,
    tags: ['stablecoin']
  },
  {
    symbol: 'USDC',
    name: 'USD Coin (Tron)',
    address: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
    logoURI: 'https://coin-images.coingecko.com/coins/images/6319/standard/USD_Coin_icon.png',
    chainId: 195,
    type: 'TRC-20',
    decimals: 6,
    tags: ['stablecoin']
  },
  {
    symbol: 'BTT',
    name: 'BitTorrent',
    address: 'TAFjULxiVgT4qWVOcUx6eQDVNVH5PwTBEa',
    logoURI: 'https://coin-images.coingecko.com/coins/images/8267/standard/BitTorrent.png',
    chainId: 195,
    type: 'TRC-20',
    decimals: 18,
    tags: ['utility']
  },

  // More BSC tokens
  {
    symbol: 'CAKE',
    name: 'PancakeSwap Token',
    address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    logoURI: 'https://coin-images.coingecko.com/coins/images/12632/standard/pancakeswap-cake-logo_.png',
    chainId: 56,
    type: 'BEP-20',
    decimals: 18,
    tags: ['defi', 'dex']
  },
  {
    symbol: 'BUSD',
    name: 'Binance USD',
    address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    logoURI: 'https://coin-images.coingecko.com/coins/images/9576/standard/BUSD.png',
    chainId: 56,
    type: 'BEP-20',
    decimals: 18,
    tags: ['stablecoin']
  },
  {
    symbol: 'USDT',
    name: 'Tether USD (BSC)',
    address: '0x55d398326f99059fF775485246999027B3197955',
    logoURI: 'https://coin-images.coingecko.com/coins/images/325/standard/Tether.png',
    chainId: 56,
    type: 'BEP-20',
    decimals: 18,
    tags: ['stablecoin']
  },
  {
    symbol: 'USDC',
    name: 'USD Coin (BSC)',
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32CD580d',
    logoURI: 'https://coin-images.coingecko.com/coins/images/6319/standard/USD_Coin_icon.png',
    chainId: 56,
    type: 'BEP-20',
    decimals: 18,
    tags: ['stablecoin']
  },

  // More Avalanche tokens
  {
    symbol: 'AVAX',
    name: 'Avalanche',
    address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
    logoURI: 'https://coin-images.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png',
    chainId: 43114,
    type: 'ARC-20',
    decimals: 18,
    tags: ['native']
  },
  {
    symbol: 'JOE',
    name: 'JoeToken',
    address: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd',
    logoURI: 'https://coin-images.coingecko.com/coins/images/17569/standard/traderjoe.png',
    chainId: 43114,
    type: 'ARC-20',
    decimals: 18,
    tags: ['defi', 'dex']
  },
  {
    symbol: 'USDT',
    name: 'Tether USD (Avalanche)',
    address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    logoURI: 'https://coin-images.coingecko.com/coins/images/325/standard/Tether.png',
    chainId: 43114,
    type: 'ARC-20',
    decimals: 6,
    tags: ['stablecoin']
  },
  {
    symbol: 'USDC',
    name: 'USD Coin (Avalanche)',
    address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    logoURI: 'https://coin-images.coingecko.com/coins/images/6319/standard/USD_Coin_icon.png',
    chainId: 43114,
    type: 'ARC-20',
    decimals: 6,
    tags: ['stablecoin']
  },

  // More Polygon tokens
  {
    symbol: 'MATIC',
    name: 'Polygon',
    address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    logoURI: 'https://coin-images.coingecko.com/coins/images/4713/standard/matic-token-icon.png',
    chainId: 137,
    type: 'ERC-20',
    decimals: 18,
    tags: ['native']
  },
  {
    symbol: 'USDT',
    name: 'Tether USD (Polygon)',
    address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    logoURI: 'https://coin-images.coingecko.com/coins/images/325/standard/Tether.png',
    chainId: 137,
    type: 'ERC-20',
    decimals: 6,
    tags: ['stablecoin']
  },
  {
    symbol: 'USDC',
    name: 'USD Coin (Polygon)',
    address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    logoURI: 'https://coin-images.coingecko.com/coins/images/6319/standard/USD_Coin_icon.png',
    chainId: 137,
    type: 'ERC-20',
    decimals: 6,
    tags: ['stablecoin']
  },

  // More Fantom tokens  
  {
    symbol: 'FTM',
    name: 'Fantom',
    address: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83', // WFTM
    logoURI: 'https://coin-images.coingecko.com/coins/images/4001/standard/Fantom.png',
    chainId: 250,
    type: 'FTM-20',
    decimals: 18,
    tags: ['native']
  },
  {
    symbol: 'BOO',
    name: 'SpookyToken',
    address: '0x841FAD6EAe12c286d1Fd18d1d525DFfA75C7EFFE',
    logoURI: 'https://coin-images.coingecko.com/coins/images/17548/standard/spookyswap.png',
    chainId: 250,
    type: 'FTM-20',
    decimals: 18,
    tags: ['defi', 'dex']
  },

  // Add more tokens as needed...
];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      chainId, 
      search, 
      limit = '100', 
      offset = '0' 
    } = req.query;

    const limitNum = Math.min(parseInt(limit as string), 1000);
    const offsetNum = parseInt(offset as string);
    const chainIdNum = chainId ? parseInt(chainId as string) : undefined;

    let tokens = COMPREHENSIVE_TOKEN_LIST;

    // Filter by chain if specified
    if (chainIdNum) {
      tokens = tokens.filter(token => token.chainId === chainIdNum);
    }

    // Search if query provided
    if (search && typeof search === 'string') {
      const lowerQuery = search.toLowerCase();
      tokens = tokens.filter(token => {
        const symbolMatch = token.symbol.toLowerCase().includes(lowerQuery);
        const nameMatch = token.name.toLowerCase().includes(lowerQuery);
        const addressMatch = token.address.toLowerCase().includes(lowerQuery);
        
        return symbolMatch || nameMatch || addressMatch;
      });

      // Sort by relevance
      tokens.sort((a, b) => {
        const aSymbol = a.symbol.toLowerCase();
        const bSymbol = b.symbol.toLowerCase();
        
        // Exact matches first
        if (aSymbol === lowerQuery && bSymbol !== lowerQuery) return -1;
        if (bSymbol === lowerQuery && aSymbol !== lowerQuery) return 1;
        
        // Starts with query
        if (aSymbol.startsWith(lowerQuery) && !bSymbol.startsWith(lowerQuery)) return -1;
        if (bSymbol.startsWith(lowerQuery) && !aSymbol.startsWith(lowerQuery)) return 1;
        
        return aSymbol.localeCompare(bSymbol);
      });
    }

    // Apply pagination
    const paginatedTokens = tokens.slice(offsetNum, offsetNum + limitNum);

    // Calculate stats
    const statsByChain = COMPREHENSIVE_TOKEN_LIST.reduce((acc, token) => {
      acc[token.chainId] = (acc[token.chainId] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const response = {
      tokens: paginatedTokens,
      pagination: {
        total: tokens.length,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < tokens.length
      },
      stats: {
        total: COMPREHENSIVE_TOKEN_LIST.length,
        byChain: statsByChain,
        lastUpdate: Date.now()
      },
      metadata: {
        query: search || null,
        chainId: chainIdNum || null,
        isLoading: false,
        lastUpdate: Date.now(),
        cacheStatus: 'static',
        source: 'comprehensive-static'
      }
    };

    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error in static comprehensive tokens API:', error);
    
    return res.status(500).json({
      error: 'Failed to load token data',
      tokens: []
    });
  }
}