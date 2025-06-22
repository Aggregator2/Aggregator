// Token Registry for special token handling
export interface TokenWarning {
  type: 'rebasing' | 'fee-on-transfer' | 'non-standard-approval' | 'deprecated' | 'high-risk';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  helpText?: string;
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
    customDecimals: 6
  },
  {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC (8 decimals)
    chainId: 1,
    customDecimals: 8
  },
  
  // Wrapped Native Tokens
  {
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH (Ethereum)
    chainId: 1,
    isWrappedNative: true
  },
  {
    address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB (BSC)
    chainId: 56,
    isWrappedNative: true
  },
  {
    address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC (Polygon)
    chainId: 137,
    isWrappedNative: true
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