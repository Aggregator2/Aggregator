export type TokenType = 'ERC-20' | 'BEP-20' | 'TRC-20' | 'SPL' | 'ASA' | 'IBC' | 'NATIVE' | 'FA1.2' | 'other';

export interface Token {
  symbol: string;
  name: string;
  address: string;
  logoURI: string;
  chainId: number;
  type: TokenType;
  decimals: number;
  tags?: string[];
  extensions?: {
    coingeckoId?: string;
    website?: string;
    description?: string;
    explorer?: string;
    marketCapRank?: number;
    currentPrice?: number;
    verified?: boolean;
    priceSource?: string;
    lastPriceUpdate?: number;
    metaplexUri?: string;
    creators?: any[];
    source?: string;
    twitter?: string;
    telegram?: string;
    marketCap?: number;
    rank?: number;
    autoImported?: boolean;
    importedAt?: string;
    verificationSource?: string;
    priority?: number;
    tokenLevel?: string;
    vip?: boolean;
    issuerAddr?: string;
    totalSupply?: string;
    circulatingSupply?: string;
    holdersCount?: number;
    priceInTrx?: number;
    priceInUsd?: number;
    volume24h?: number;
    isNative?: boolean;
  };
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer?: string;
  type: 'EVM' | 'TRON' | 'SOLANA' | 'COSMOS' | 'ALGORAND' | 'STELLAR' | 'CARDANO' | 'TEZOS';
}

export interface TokenList {
  name: string;
  timestamp: string;
  version: {
    major: number;
    minor: number;
    patch: number;
  };
  tokens: Token[];
}

export interface TokenBalance {
  token: Token;
  balance: string;
  balanceUSD?: number;
  price?: number;
}

export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  1: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://etherscan.io',
    type: 'EVM'
  },
  56: {
    chainId: 56,
    name: 'BNB Smart Chain',
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    blockExplorer: 'https://bscscan.com',
    type: 'EVM'
  },
  137: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    blockExplorer: 'https://polygonscan.com',
    type: 'EVM'
  },
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://arbiscan.io',
    type: 'EVM'
  },
  10: {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://optimistic.etherscan.io',
    type: 'EVM'
  },
  43114: {
    chainId: 43114,
    name: 'Avalanche C-Chain',
    rpcUrl: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    blockExplorer: 'https://snowtrace.io',
    type: 'EVM'
  },
  1001: {
    chainId: 1001,
    name: 'TRON Mainnet',
    rpcUrl: process.env.TRON_RPC_URL || 'https://api.trongrid.io',
    nativeCurrency: { name: 'TRON', symbol: 'TRX', decimals: 6 },
    blockExplorer: 'https://tronscan.org',
    type: 'TRON'
  },
  101: {
    chainId: 101,
    name: 'Solana Mainnet',
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
    blockExplorer: 'https://explorer.solana.com',
    type: 'SOLANA'
  },
  118: {
    chainId: 118,
    name: 'Cosmos Hub',
    rpcUrl: process.env.COSMOS_RPC_URL || 'https://cosmos-rpc.polkachu.com',
    nativeCurrency: { name: 'Cosmos', symbol: 'ATOM', decimals: 6 },
    blockExplorer: 'https://www.mintscan.io/cosmos',
    type: 'COSMOS'
  },
  301: {
    chainId: 301,
    name: 'Algorand',
    rpcUrl: process.env.ALGORAND_RPC_URL || 'https://mainnet-api.algonode.cloud',
    nativeCurrency: { name: 'Algorand', symbol: 'ALGO', decimals: 6 },
    blockExplorer: 'https://algoexplorer.io',
    type: 'ALGORAND'
  },
  0: {
    chainId: 0,
    name: 'Stellar',
    rpcUrl: process.env.STELLAR_RPC_URL || 'https://horizon.stellar.org',
    nativeCurrency: { name: 'Stellar Lumens', symbol: 'XLM', decimals: 7 },
    blockExplorer: 'https://stellarchain.io',
    type: 'STELLAR'
  },
  2024: {
    chainId: 2024,
    name: 'Cardano',
    rpcUrl: process.env.CARDANO_RPC_URL || 'https://cardano-mainnet.blockfrost.io/api/v0',
    nativeCurrency: { name: 'Cardano', symbol: 'ADA', decimals: 6 },
    blockExplorer: 'https://cardanoscan.io',
    type: 'CARDANO'
  },
  1729: {
    chainId: 1729,
    name: 'Tezos',
    rpcUrl: process.env.TEZOS_RPC_URL || 'https://mainnet.api.tez.ie',
    nativeCurrency: { name: 'Tezos', symbol: 'XTZ', decimals: 6 },
    blockExplorer: 'https://tzstats.com',
    type: 'TEZOS'
  }
};