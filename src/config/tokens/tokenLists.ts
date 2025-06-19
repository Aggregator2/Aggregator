export interface TokenListSource {
  name: string;
  url: string;
  description: string;
  chainIds: number[];
  priority: number; // Higher = more trusted
  updateFrequency: 'hourly' | 'daily' | 'weekly';
}

export const TOKEN_LIST_SOURCES: TokenListSource[] = [
  // Uniswap Lists (Highest Priority)
  {
    name: 'Uniswap Default',
    url: 'https://tokens.uniswap.org/',
    description: 'Uniswap official token list',
    chainIds: [1, 10, 42161, 137],
    priority: 100,
    updateFrequency: 'daily'
  },
  {
    name: 'Uniswap Extended',
    url: 'https://extendedtokens.uniswap.org/',
    description: 'Extended Uniswap token list',
    chainIds: [1, 10, 42161, 137],
    priority: 90,
    updateFrequency: 'daily'
  },
  
  // CoinGecko (Very High Priority)
  {
    name: 'CoinGecko',
    url: 'https://tokens.coingecko.com/uniswap/all.json',
    description: 'CoinGecko curated token list',
    chainIds: [1, 56, 137, 43114, 42161, 10],
    priority: 95,
    updateFrequency: 'daily'
  },
  
  // 1inch (High Priority)
  {
    name: '1inch',
    url: 'https://wispy-bird-88a7.uniswap.workers.dev/?url=http://tokens.1inch.eth.link',
    description: '1inch token list',
    chainIds: [1, 56, 137, 43114, 42161, 10],
    priority: 85,
    updateFrequency: 'daily'
  },
  
  // Chain-Specific Lists
  {
    name: 'PancakeSwap Default',
    url: 'https://tokens.pancakeswap.finance/pancakeswap-default.json',
    description: 'PancakeSwap default token list',
    chainIds: [56],
    priority: 90,
    updateFrequency: 'daily'
  },
  {
    name: 'PancakeSwap Extended',
    url: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json',
    description: 'PancakeSwap extended token list',
    chainIds: [56],
    priority: 80,
    updateFrequency: 'daily'
  },
  {
    name: 'QuickSwap Default',
    url: 'https://unpkg.com/quickswap-default-token-list@1.2.28/build/quickswap-default.tokenlist.json',
    description: 'QuickSwap default token list',
    chainIds: [137],
    priority: 85,
    updateFrequency: 'daily'
  },
  {
    name: 'Pangolin',
    url: 'https://raw.githubusercontent.com/pangolindex/tokenlists/main/aeb.tokenlist.json',
    description: 'Pangolin token list for Avalanche',
    chainIds: [43114],
    priority: 85,
    updateFrequency: 'daily'
  },
  {
    name: 'TraderJoe',
    url: 'https://raw.githubusercontent.com/traderjoe-xyz/joe-tokenlists/main/mc.tokenlist.json',
    description: 'TraderJoe token list for Avalanche',
    chainIds: [43114],
    priority: 80,
    updateFrequency: 'daily'
  },
  {
    name: 'Solana Token List',
    url: 'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json',
    description: 'Official Solana token list',
    chainIds: [101],
    priority: 95,
    updateFrequency: 'daily'
  },
  {
    name: 'Serum Token List',
    url: 'https://raw.githubusercontent.com/project-serum/serum-ts/master/packages/token-list/src/tokens/serum.tokenlist.json',
    description: 'Serum DEX token list',
    chainIds: [101],
    priority: 80,
    updateFrequency: 'daily'
  },
  
  // Community Lists
  {
    name: 'Compound',
    url: 'https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json',
    description: 'Compound protocol token list',
    chainIds: [1],
    priority: 80,
    updateFrequency: 'weekly'
  },
  {
    name: 'Aave',
    url: 'https://tokenlist.aave.eth.link',
    description: 'Aave protocol token list',
    chainIds: [1, 137, 43114],
    priority: 80,
    updateFrequency: 'weekly'
  },
  {
    name: 'SushiSwap',
    url: 'https://token-list.sushi.com/',
    description: 'SushiSwap token list',
    chainIds: [1, 56, 137, 43114, 42161],
    priority: 75,
    updateFrequency: 'daily'
  },
  {
    name: 'Gemini',
    url: 'https://www.gemini.com/uniswap/manifest.json',
    description: 'Gemini exchange token list',
    chainIds: [1],
    priority: 85,
    updateFrequency: 'weekly'
  },
  {
    name: 'Consensys',
    url: 'https://tokens.consensys.net/tokens-list.json',
    description: 'Consensys curated token list',
    chainIds: [1],
    priority: 70,
    updateFrequency: 'weekly'
  }
];

// API endpoints for chain-specific token data
export const CHAIN_API_ENDPOINTS = {
  // TRON
  1001: {
    name: 'TronScan API',
    url: 'https://apilist.tronscan.org/api/token_trc20',
    params: { limit: 1000, start: 0, sort: '-volume24h' },
    parser: 'tron'
  },
  
  // Cosmos Hub
  118: {
    name: 'Cosmos Chain Registry',
    url: 'https://raw.githubusercontent.com/cosmos/chain-registry/master/cosmoshub/assetlist.json',
    parser: 'cosmos'
  },
  
  // Algorand
  301: {
    name: 'Algorand Indexer',
    url: 'https://mainnet-idx.algonode.cloud/v2/assets',
    params: { limit: 1000 },
    parser: 'algorand'
  },
  
  // Stellar
  0: {
    name: 'Stellar Assets',
    url: 'https://api.stellar.org/assets',
    params: { limit: 200, order: 'desc' },
    parser: 'stellar'
  },
  
  // Cardano
  2024: {
    name: 'Cardano Asset Registry',
    url: 'https://tokens.cardano.org/metadata',
    parser: 'cardano'
  },
  
  // Tezos
  1729: {
    name: 'Better Call Dev',
    url: 'https://api.better-call.dev/v1/tokens/mainnet',
    params: { size: 1000, offset: 0 },
    parser: 'tezos'
  }
};

// Aggregator APIs for cross-chain data
export const AGGREGATOR_APIS = {
  coingecko: {
    name: 'CoinGecko',
    baseUrl: 'https://api.coingecko.com/api/v3',
    endpoints: {
      coins: '/coins/list?include_platform=true',
      coinData: '/coins/{id}',
      platforms: '/asset_platforms'
    },
    rateLimit: 30 // requests per minute
  },
  coinmarketcap: {
    name: 'CoinMarketCap',
    baseUrl: 'https://pro-api.coinmarketcap.com/v1',
    endpoints: {
      listings: '/cryptocurrency/listings/latest',
      metadata: '/cryptocurrency/info',
      map: '/cryptocurrency/map'
    },
    requiresApiKey: true,
    rateLimit: 333 // requests per day for basic plan
  },
  oneinch: {
    name: '1inch',
    baseUrl: 'https://api.1inch.io/v5.0',
    endpoints: {
      tokens: '/{chainId}/tokens',
      spender: '/{chainId}/approve/spender'
    },
    rateLimit: 1000 // requests per day
  }
};

// Auto-import contract verification endpoints
export const CONTRACT_VERIFICATION_APIS = {
  1: { // Ethereum
    name: 'Etherscan',
    url: 'https://api.etherscan.io/api',
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  56: { // BSC
    name: 'BscScan',
    url: 'https://api.bscscan.com/api',
    apiKey: process.env.BSCSCAN_API_KEY
  },
  137: { // Polygon
    name: 'PolygonScan',
    url: 'https://api.polygonscan.com/api',
    apiKey: process.env.POLYGONSCAN_API_KEY
  },
  43114: { // Avalanche
    name: 'SnowTrace',
    url: 'https://api.snowtrace.io/api',
    apiKey: process.env.SNOWTRACE_API_KEY
  },
  42161: { // Arbitrum
    name: 'Arbiscan',
    url: 'https://api.arbiscan.io/api',
    apiKey: process.env.ARBISCAN_API_KEY
  },
  10: { // Optimism
    name: 'Optimistic Etherscan',
    url: 'https://api-optimistic.etherscan.io/api',
    apiKey: process.env.OPTIMISM_ETHERSCAN_API_KEY
  }
};