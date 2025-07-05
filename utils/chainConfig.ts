// Comprehensive chain configurations for all supported networks

export interface ChainConfig {
  chainId: string | number;
  chainName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  chainType?: 'evm' | 'solana' | 'tron';
}

// EVM Chain Configurations
export const ETHEREUM_CHAIN_CONFIG: ChainConfig = {
  chainId: '0x1',
  chainName: 'Ethereum Mainnet',
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://eth.llamarpc.com'],
  blockExplorerUrls: ['https://etherscan.io/'],
};

export const ARBITRUM_CHAIN_CONFIG: ChainConfig = {
  chainId: '0xa4b1', // 42161 in hex
  chainName: 'Arbitrum One',
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one.publicnode.com',
  ],
  blockExplorerUrls: ['https://arbiscan.io/'],
};

export const BSC_CHAIN_CONFIG: ChainConfig = {
  chainId: '0x38', // 56 in hex
  chainName: 'BNB Smart Chain',
  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
  },
  rpcUrls: ['https://bsc-dataseed1.binance.org'],
  blockExplorerUrls: ['https://bscscan.com/'],
};

export const POLYGON_CHAIN_CONFIG: ChainConfig = {
  chainId: '0x89', // 137 in hex
  chainName: 'Polygon',
  nativeCurrency: {
    name: 'MATIC',
    symbol: 'MATIC',
    decimals: 18,
  },
  rpcUrls: ['https://polygon-rpc.com'],
  blockExplorerUrls: ['https://polygonscan.com/'],
};

export const OPTIMISM_CHAIN_CONFIG: ChainConfig = {
  chainId: '0xa', // 10 in hex
  chainName: 'Optimism',
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://mainnet.optimism.io'],
  blockExplorerUrls: ['https://optimistic.etherscan.io/'],
};

export const AVALANCHE_CHAIN_CONFIG: ChainConfig = {
  chainId: '0xa86a', // 43114 in hex
  chainName: 'Avalanche C-Chain',
  nativeCurrency: {
    name: 'Avalanche',
    symbol: 'AVAX',
    decimals: 18,
  },
  rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
  blockExplorerUrls: ['https://snowtrace.io/'],
};

export const BASE_CHAIN_CONFIG: ChainConfig = {
  chainId: '0x2105', // 8453 in hex
  chainName: 'Base',
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://mainnet.base.org'],
  blockExplorerUrls: ['https://basescan.org/'],
};

// Non-EVM Chain Configurations
export const SOLANA_CHAIN_CONFIG: ChainConfig = {
  chainId: 101, // Solana uses numeric chain ID
  chainName: 'Solana',
  nativeCurrency: {
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9,
  },
  rpcUrls: ['https://api.mainnet-beta.solana.com'],
  blockExplorerUrls: ['https://solscan.io/'],
  chainType: 'solana',
};

export const TRON_CHAIN_CONFIG: ChainConfig = {
  chainId: 195, // Tron chain ID
  chainName: 'Tron',
  nativeCurrency: {
    name: 'Tronix',
    symbol: 'TRX',
    decimals: 6,
  },
  rpcUrls: ['https://api.trongrid.io'],
  blockExplorerUrls: ['https://tronscan.org/'],
  chainType: 'tron',
};

// All supported chains
export const SUPPORTED_CHAINS: ChainConfig[] = [
  ETHEREUM_CHAIN_CONFIG,
  ARBITRUM_CHAIN_CONFIG,
  BSC_CHAIN_CONFIG,
  POLYGON_CHAIN_CONFIG,
  OPTIMISM_CHAIN_CONFIG,
  AVALANCHE_CHAIN_CONFIG,
  BASE_CHAIN_CONFIG,
  SOLANA_CHAIN_CONFIG,
  TRON_CHAIN_CONFIG,
];

// Chain ID to config mapping
export const CHAIN_CONFIGS: Record<string | number, ChainConfig> = {
  '0x1': ETHEREUM_CHAIN_CONFIG,
  '0xa4b1': ARBITRUM_CHAIN_CONFIG,
  '0x38': BSC_CHAIN_CONFIG,
  '0x89': POLYGON_CHAIN_CONFIG,
  '0xa': OPTIMISM_CHAIN_CONFIG,
  '0xa86a': AVALANCHE_CHAIN_CONFIG,
  '0x2105': BASE_CHAIN_CONFIG,
  101: SOLANA_CHAIN_CONFIG,
  195: TRON_CHAIN_CONFIG,
};

// Function to add EVM chain to MetaMask
export async function addEVMChain(chainConfig: ChainConfig) {
  if (chainConfig.chainType && chainConfig.chainType !== 'evm') {
    return { success: false, error: `${chainConfig.chainName} is not an EVM chain` };
  }

  if (typeof window !== 'undefined' && window.ethereum) {
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [chainConfig],
      });
      return { success: true };
    } catch (error) {
      console.error(`Failed to add ${chainConfig.chainName}:`, error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'MetaMask not available' };
}

// Function to switch to EVM chain
export async function switchToEVMChain(chainConfig: ChainConfig) {
  if (chainConfig.chainType && chainConfig.chainType !== 'evm') {
    return { success: false, error: `${chainConfig.chainName} is not an EVM chain` };
  }

  if (typeof window !== 'undefined' && window.ethereum) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainConfig.chainId }],
      });
      return { success: true };
    } catch (error) {
      // If chain is not added, try to add it
      if (error.code === 4902) {
        return await addEVMChain(chainConfig);
      }
      console.error(`Failed to switch to ${chainConfig.chainName}:`, error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'MetaMask not available' };
}

// Legacy functions for backward compatibility
export async function addArbitrumChain() {
  return addEVMChain(ARBITRUM_CHAIN_CONFIG);
}

export async function switchToArbitrum() {
  return switchToEVMChain(ARBITRUM_CHAIN_CONFIG);
}

// Helper function to get chain name by ID
export function getChainName(chainId: string | number): string {
  const config = CHAIN_CONFIGS[chainId];
  return config ? config.chainName : `Unknown Chain (${chainId})`;
}

// Helper function to check if chain is supported
export function isChainSupported(chainId: string | number): boolean {
  return chainId in CHAIN_CONFIGS;
}

// Helper function to get native currency symbol
export function getNativeCurrencySymbol(chainId: string | number): string {
  const config = CHAIN_CONFIGS[chainId];
  return config ? config.nativeCurrency.symbol : 'UNKNOWN';
}