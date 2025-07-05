// Token Registry for special token handling and LiFi integration
export interface TokenWarning {
  type: 'rebasing' | 'fee-on-transfer' | 'non-standard-approval' | 'deprecated' | 'high-risk';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  helpText?: string;
}

// LiFi-compatible token interface
export interface LiFiTokenInfo {
  address: string;
  symbol: string;
  name: string;
  chainId: number;
  decimals: number;
  logoURI?: string;
  priceUSD?: string;
  coinGeckoId?: string;
  tags?: string[];
}

export interface SpecialTokenConfig {
  address: string;
  chainId: number;
  warnings: TokenWarning[];
  customDecimals?: number;
  feePercentage?: number; // For fee-on-transfer tokens
  isWrappedNative?: boolean;
  requiresSpecialApproval?: boolean;
  blacklisted?: boolean;
}

// Registry of special tokens that require custom handling
export const SPECIAL_TOKENS: SpecialTokenConfig[] = [
  // Rebasing Tokens
  {
    address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // stETH (Ethereum)
    chainId: 1,
    warnings: [{
      type: 'rebasing',
      severity: 'warning',
      message: 'stETH is a rebasing token. Your balance may change over time.',
      helpText: 'Consider wrapping to wstETH for consistent balance.'
    }]
  },
  {
    address: '0xd46ba6d942050d489dbd938a2c909a5d5039a161', // AMPL (Ethereum)
    chainId: 1,
    warnings: [{
      type: 'rebasing',
      severity: 'critical',
      message: 'AMPL is a rebasing token with daily supply adjustments.',
      helpText: 'Your token balance will change based on the daily rebase.'
    }]
  },
  
  // Fee-on-Transfer Tokens
  {
    address: '0x7e396bfc8a2f84748701167c2d622f041a1d7a17', // UNIDX (Example fee token)
    chainId: 1,
    feePercentage: 2,
    warnings: [{
      type: 'fee-on-transfer',
      severity: 'warning',
      message: 'This token charges a 2% fee on transfers.',
      helpText: 'You will receive less than the quoted amount due to transfer fees.'
    }]
  },
  
  // Non-standard Approval Tokens
  {
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT (Ethereum)
    chainId: 1,
    requiresSpecialApproval: true,
    warnings: [{
      type: 'non-standard-approval',
      severity: 'info',
      message: 'USDT requires approval to be set to 0 before changing.',
      helpText: 'We handle this automatically for you.'
    }]
  },
  {
    address: '0x8e870d67f660d95d5be530380d0ec0bd388289e1', // USDP (Pax Dollar)
    chainId: 1,
    requiresSpecialApproval: true,
    warnings: [{
      type: 'non-standard-approval',
      severity: 'info',
      message: 'USDP requires special approval handling.',
      helpText: 'We handle this automatically for you.'
    }]
  },
  
  // Different Decimals
  {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC (6 decimals)
    chainId: 1,
    customDecimals: 6,
    warnings: []
  },
  {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC (8 decimals)
    chainId: 1,
    customDecimals: 8,
    warnings: []
  },
  
  // Wrapped Native Tokens
  {
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH (Ethereum)
    chainId: 1,
    isWrappedNative: true,
    warnings: []
  },
  {
    address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB (BSC)
    chainId: 56,
    isWrappedNative: true,
    warnings: []
  },
  {
    address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC (Polygon)
    chainId: 137,
    isWrappedNative: true,
    warnings: []
  },
  
  // Blacklisted/Scam Tokens (examples)
  {
    address: '0x0000000000000000000000000000000000000001', // Example scam token
    chainId: 1,
    blacklisted: true,
    warnings: [{
      type: 'high-risk',
      severity: 'critical',
      message: 'This token has been flagged as potentially fraudulent.',
      helpText: 'We strongly recommend avoiding this token.'
    }]
  }
];

// Token blacklist - addresses that should never be shown
export const TOKEN_BLACKLIST: Set<string> = new Set([
  '0x0000000000000000000000000000000000000001', // Example scam
  // Add more blacklisted addresses here
]);

// Helper functions
export function getTokenWarnings(address: string, chainId: number): TokenWarning[] {
  const specialToken = SPECIAL_TOKENS.find(
    t => t.address.toLowerCase() === address.toLowerCase() && t.chainId === chainId
  );
  return specialToken?.warnings || [];
}

export function isTokenBlacklisted(address: string, chainId: number): boolean {
  const specialToken = SPECIAL_TOKENS.find(
    t => t.address.toLowerCase() === address.toLowerCase() && t.chainId === chainId
  );
  return specialToken?.blacklisted || TOKEN_BLACKLIST.has(address.toLowerCase());
}

export function getTokenFeePercentage(address: string, chainId: number): number {
  const specialToken = SPECIAL_TOKENS.find(
    t => t.address.toLowerCase() === address.toLowerCase() && t.chainId === chainId
  );
  return specialToken?.feePercentage || 0;
}

export function requiresSpecialApproval(address: string, chainId: number): boolean {
  const specialToken = SPECIAL_TOKENS.find(
    t => t.address.toLowerCase() === address.toLowerCase() && t.chainId === chainId
  );
  return specialToken?.requiresSpecialApproval || false;
}

export function isWrappedNativeToken(address: string, chainId: number): boolean {
  const specialToken = SPECIAL_TOKENS.find(
    t => t.address.toLowerCase() === address.toLowerCase() && t.chainId === chainId
  );
  return specialToken?.isWrappedNative || false;
}

export function getActualDecimals(address: string, chainId: number, defaultDecimals: number): number {
  const specialToken = SPECIAL_TOKENS.find(
    t => t.address.toLowerCase() === address.toLowerCase() && t.chainId === chainId
  );
  return specialToken?.customDecimals ?? defaultDecimals;
}

// Fallback tokens when LiFi fails to load
export const FALLBACK_TOKENS: LiFiTokenInfo[] = [
  // Ethereum Mainnet (Chain ID: 1)
  {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    chainId: 1,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/eth.svg',
    coinGeckoId: 'ethereum',
    tags: ['native']
  },
  {
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    chainId: 1,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/eth.svg',
    coinGeckoId: 'weth',
    tags: ['wrapped']
  },
  {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    name: 'USD Coin',
    chainId: 1,
    decimals: 6,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/usdc.svg',
    coinGeckoId: 'usd-coin',
    tags: ['stablecoin']
  },
  {
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    symbol: 'USDT',
    name: 'Tether USD',
    chainId: 1,
    decimals: 6,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/usdt.svg',
    coinGeckoId: 'tether',
    tags: ['stablecoin']
  },
  {
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    chainId: 1,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/dai.svg',
    coinGeckoId: 'dai',
    tags: ['stablecoin']
  },
  {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    chainId: 1,
    decimals: 8,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/wbtc.svg',
    coinGeckoId: 'wrapped-bitcoin',
    tags: ['wrapped']
  },

  // Polygon (Chain ID: 137)
  {
    address: '0x0000000000000000000000000000000000001010',
    symbol: 'MATIC',
    name: 'Polygon',
    chainId: 137,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/matic.svg',
    coinGeckoId: 'matic-network',
    tags: ['native']
  },
  {
    address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
    symbol: 'WMATIC',
    name: 'Wrapped Matic',
    chainId: 137,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/matic.svg',
    coinGeckoId: 'wmatic',
    tags: ['wrapped']
  },
  {
    address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
    symbol: 'USDC',
    name: 'USD Coin (PoS)',
    chainId: 137,
    decimals: 6,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/usdc.svg',
    coinGeckoId: 'usd-coin',
    tags: ['stablecoin', 'pos']
  },
  {
    address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    symbol: 'USDT',
    name: 'Tether USD (PoS)',
    chainId: 137,
    decimals: 6,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/usdt.svg',
    coinGeckoId: 'tether',
    tags: ['stablecoin', 'pos']
  },
  {
    address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
    symbol: 'DAI',
    name: 'Dai Stablecoin (PoS)',
    chainId: 137,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/dai.svg',
    coinGeckoId: 'dai',
    tags: ['stablecoin', 'pos']
  },

  // Arbitrum One (Chain ID: 42161)
  {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    chainId: 42161,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/eth.svg',
    coinGeckoId: 'ethereum',
    tags: ['native']
  },
  {
    address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    chainId: 42161,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/eth.svg',
    coinGeckoId: 'weth',
    tags: ['wrapped']
  },
  {
    address: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
    symbol: 'USDC.e',
    name: 'USD Coin (Arb1)',
    chainId: 42161,
    decimals: 6,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/usdc.svg',
    coinGeckoId: 'usd-coin',
    tags: ['stablecoin']
  },
  {
    address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    symbol: 'USDC',
    name: 'USD Coin',
    chainId: 42161,
    decimals: 6,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/usdc.svg',
    coinGeckoId: 'usd-coin',
    tags: ['stablecoin']
  },

  // Optimism (Chain ID: 10)
  {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    chainId: 10,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/eth.svg',
    coinGeckoId: 'ethereum',
    tags: ['native']
  },
  {
    address: '0x4200000000000000000000000000000000000006',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    chainId: 10,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/eth.svg',
    coinGeckoId: 'weth',
    tags: ['wrapped']
  },
  {
    address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607',
    symbol: 'USDC',
    name: 'USD Coin',
    chainId: 10,
    decimals: 6,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/usdc.svg',
    coinGeckoId: 'usd-coin',
    tags: ['stablecoin']
  },

  // BSC (Chain ID: 56)
  {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'BNB',
    name: 'BNB',
    chainId: 56,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/bnb.svg',
    coinGeckoId: 'binancecoin',
    tags: ['native']
  },
  {
    address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    chainId: 56,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/bnb.svg',
    coinGeckoId: 'wbnb',
    tags: ['wrapped']
  },
  {
    address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    symbol: 'USDC',
    name: 'USD Coin',
    chainId: 56,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/usdc.svg',
    coinGeckoId: 'usd-coin',
    tags: ['stablecoin']
  },
  {
    address: '0x55d398326f99059ff775485246999027b3197955',
    symbol: 'USDT',
    name: 'Tether USD',
    chainId: 56,
    decimals: 18,
    logoURI: 'https://wallet-asset.matic.network/img/tokens/usdt.svg',
    coinGeckoId: 'tether',
    tags: ['stablecoin']
  }
];

// Native token addresses by chain
export const NATIVE_TOKEN_ADDRESSES: Record<number, string> = {
  1: '0x0000000000000000000000000000000000000000', // ETH
  137: '0x0000000000000000000000000000000000001010', // MATIC
  42161: '0x0000000000000000000000000000000000000000', // ETH on Arbitrum
  10: '0x0000000000000000000000000000000000000000', // ETH on Optimism
  56: '0x0000000000000000000000000000000000000000', // BNB
  43114: '0x0000000000000000000000000000000000000000', // AVAX
  250: '0x0000000000000000000000000000000000000000', // FTM
};

// Wrapped native token addresses by chain
export const WRAPPED_NATIVE_ADDRESSES: Record<number, string> = {
  1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
  42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH on Arbitrum
  10: '0x4200000000000000000000000000000000000006', // WETH on Optimism
  56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
  43114: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', // WAVAX
  250: '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83', // WFTM
};

// Convert SPECIAL_TOKENS to LiFi format for integration
export function convertSpecialTokensToLiFiFormat(): LiFiTokenInfo[] {
  return SPECIAL_TOKENS
    .filter(token => !token.blacklisted)
    .map(token => ({
      address: token.address,
      symbol: getTokenSymbolFromAddress(token.address, token.chainId),
      name: getTokenNameFromAddress(token.address, token.chainId),
      chainId: token.chainId,
      decimals: token.customDecimals || 18,
      logoURI: getTokenLogoURI(token.address, token.chainId),
      tags: getTagsForToken(token)
    }));
}

// Helper functions for token metadata
function getTokenSymbolFromAddress(address: string, chainId: number): string {
  const symbolMap: Record<string, string> = {
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 'stETH',
    '0xd46ba6d942050d489dbd938a2c909a5d5039a161': 'AMPL',
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'WBNB',
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'WMATIC',
  };
  return symbolMap[address.toLowerCase()] || 'UNKNOWN';
}

function getTokenNameFromAddress(address: string, chainId: number): string {
  const nameMap: Record<string, string> = {
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 'Liquid staked Ether 2.0',
    '0xd46ba6d942050d489dbd938a2c909a5d5039a161': 'Ampleforth',
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 'Tether USD',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USD Coin',
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'Wrapped BTC',
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'Wrapped Ether',
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'Wrapped BNB',
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'Wrapped Matic',
  };
  return nameMap[address.toLowerCase()] || 'Unknown Token';
}

function getTokenLogoURI(address: string, chainId: number): string {
  const logoMap: Record<string, string> = {
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 'https://wallet-asset.matic.network/img/tokens/steth.svg',
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 'https://wallet-asset.matic.network/img/tokens/usdt.svg',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'https://wallet-asset.matic.network/img/tokens/usdc.svg',
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'https://wallet-asset.matic.network/img/tokens/wbtc.svg',
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'https://wallet-asset.matic.network/img/tokens/eth.svg',
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'https://wallet-asset.matic.network/img/tokens/bnb.svg',
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'https://wallet-asset.matic.network/img/tokens/matic.svg',
  };
  return logoMap[address.toLowerCase()];
}

function getTagsForToken(token: SpecialTokenConfig): string[] {
  const tags: string[] = [];
  
  if (token.isWrappedNative) tags.push('wrapped');
  if (token.warnings.some(w => w.type === 'rebasing')) tags.push('rebasing');
  if (token.warnings.some(w => w.type === 'fee-on-transfer')) tags.push('fee-on-transfer');
  if (token.requiresSpecialApproval) tags.push('special-approval');
  
  return tags;
}

// Get fallback tokens for a specific chain
export function getFallbackTokensForChain(chainId: number): LiFiTokenInfo[] {
  return FALLBACK_TOKENS.filter(token => token.chainId === chainId);
}

// Merge LiFi tokens with fallback tokens, prioritizing LiFi data
export function mergeLiFiWithFallback(lifiTokens: LiFiTokenInfo[], chainId: number): LiFiTokenInfo[] {
  const fallbackTokens = getFallbackTokensForChain(chainId);
  const lifiAddresses = new Set(lifiTokens.map(t => t.address.toLowerCase()));
  
  // Add fallback tokens that aren't already in LiFi data
  const additionalTokens = fallbackTokens.filter(
    token => !lifiAddresses.has(token.address.toLowerCase())
  );
  
  return [...lifiTokens, ...additionalTokens];
}

// Check if token is supported by LiFi or in fallback list
export function isTokenSupported(address: string, chainId: number): boolean {
  return FALLBACK_TOKENS.some(
    token => token.address.toLowerCase() === address.toLowerCase() && token.chainId === chainId
  );
}

// Get native token info for chain
export function getNativeTokenInfo(chainId: number): LiFiTokenInfo | null {
  return FALLBACK_TOKENS.find(
    token => token.chainId === chainId && token.tags?.includes('native')
  ) || null;
}

// Get wrapped native token info for chain
export function getWrappedNativeTokenInfo(chainId: number): LiFiTokenInfo | null {
  const wrappedAddress = WRAPPED_NATIVE_ADDRESSES[chainId];
  if (!wrappedAddress) return null;
  
  return FALLBACK_TOKENS.find(
    token => token.address.toLowerCase() === wrappedAddress.toLowerCase() && token.chainId === chainId
  ) || null;
}