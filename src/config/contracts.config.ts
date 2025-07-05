import { ethers } from 'ethers';

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  settlementContract: string;
  escrowContract: string;
  treasuryAddress?: string;
  blockConfirmations: number;
  gasLimitMultiplier: number;
  maxGasPrice?: bigint;
}

export interface ContractAddresses {
  ethereum: ChainConfig;
  polygon: ChainConfig;
  arbitrum: ChainConfig;
  base: ChainConfig;
  solana?: {
    rpcUrl: string;
    programId: string;
  };
}

// Get contract addresses based on environment
export const getContractAddresses = (): ContractAddresses => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    return {
      ethereum: {
        chainId: 1,
        name: 'Ethereum Mainnet',
        rpcUrl: process.env.ETH_MAINNET_RPC_URL!,
        settlementContract: process.env.ETH_MAINNET_SETTLEMENT_CONTRACT!,
        escrowContract: process.env.ETH_MAINNET_ESCROW_CONTRACT!,
        treasuryAddress: process.env.ETH_MAINNET_TREASURY_ADDRESS,
        blockConfirmations: 3,
        gasLimitMultiplier: 1.2,
        maxGasPrice: ethers.parseUnits(process.env.SETTLEMENT_MAX_GAS_PRICE_GWEI || '500', 'gwei'),
      },
      polygon: {
        chainId: 137,
        name: 'Polygon',
        rpcUrl: process.env.POLYGON_RPC_URL!,
        settlementContract: process.env.POLYGON_SETTLEMENT_CONTRACT!,
        escrowContract: process.env.POLYGON_ESCROW_CONTRACT!,
        blockConfirmations: 30,
        gasLimitMultiplier: 1.3,
        maxGasPrice: ethers.parseUnits('1000', 'gwei'),
      },
      arbitrum: {
        chainId: 42161,
        name: 'Arbitrum One',
        rpcUrl: process.env.ARBITRUM_RPC_URL!,
        settlementContract: process.env.ARBITRUM_SETTLEMENT_CONTRACT!,
        escrowContract: process.env.ARBITRUM_ESCROW_CONTRACT!,
        blockConfirmations: 1,
        gasLimitMultiplier: 1.1,
        maxGasPrice: ethers.parseUnits('10', 'gwei'),
      },
      base: {
        chainId: 8453,
        name: 'Base',
        rpcUrl: process.env.BASE_RPC_URL!,
        settlementContract: process.env.BASE_SETTLEMENT_CONTRACT!,
        escrowContract: process.env.BASE_ESCROW_CONTRACT!,
        blockConfirmations: 3,
        gasLimitMultiplier: 1.2,
        maxGasPrice: ethers.parseUnits('50', 'gwei'),
      },
      solana: process.env.SOLANA_RPC_URL ? {
        rpcUrl: process.env.SOLANA_RPC_URL,
        programId: process.env.SOLANA_SETTLEMENT_PROGRAM_ID!,
      } : undefined,
    };
  } else {
    // Testnet configuration for development
    return {
      ethereum: {
        chainId: 11155111, // Sepolia
        name: 'Sepolia Testnet',
        rpcUrl: process.env.ETH_SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_KEY',
        settlementContract: '0x1234567890123456789012345678901234567890',
        escrowContract: '0x0987654321098765432109876543210987654321',
        blockConfirmations: 2,
        gasLimitMultiplier: 1.5,
      },
      polygon: {
        chainId: 80001, // Mumbai
        name: 'Polygon Mumbai',
        rpcUrl: process.env.POLYGON_MUMBAI_RPC_URL || 'https://rpc-mumbai.maticvigil.com',
        settlementContract: '0x1234567890123456789012345678901234567890',
        escrowContract: '0x0987654321098765432109876543210987654321',
        blockConfirmations: 10,
        gasLimitMultiplier: 1.5,
      },
      arbitrum: {
        chainId: 421614, // Arbitrum Sepolia
        name: 'Arbitrum Sepolia',
        rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
        settlementContract: '0x1234567890123456789012345678901234567890',
        escrowContract: '0x0987654321098765432109876543210987654321',
        blockConfirmations: 1,
        gasLimitMultiplier: 1.3,
      },
      base: {
        chainId: 84532, // Base Sepolia
        name: 'Base Sepolia',
        rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
        settlementContract: '0x1234567890123456789012345678901234567890',
        escrowContract: '0x0987654321098765432109876543210987654321',
        blockConfirmations: 2,
        gasLimitMultiplier: 1.3,
      },
    };
  }
};

// Provider management
const providers = new Map<number, ethers.JsonRpcProvider>();

export const getProvider = (chainId: number): ethers.JsonRpcProvider => {
  if (!providers.has(chainId)) {
    const contracts = getContractAddresses();
    const chain = Object.values(contracts).find(c => c && 'chainId' in c && c.chainId === chainId);
    
    if (!chain || !('rpcUrl' in chain)) {
      throw new Error(`No configuration found for chain ${chainId}`);
    }
    
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    providers.set(chainId, provider);
  }
  
  return providers.get(chainId)!;
};

// Contract instances
const contractInstances = new Map<string, ethers.Contract>();

export const getContract = (
  contractType: 'settlement' | 'escrow',
  chainId: number,
  abi: any[]
): ethers.Contract => {
  const key = `${contractType}-${chainId}`;
  
  if (!contractInstances.has(key)) {
    const contracts = getContractAddresses();
    const chain = Object.values(contracts).find(c => c && 'chainId' in c && c.chainId === chainId);
    
    if (!chain || !('chainId' in chain)) {
      throw new Error(`No configuration found for chain ${chainId}`);
    }
    
    const address = contractType === 'settlement' ? chain.settlementContract : chain.escrowContract;
    const provider = getProvider(chainId);
    
    // Get signer if available
    let signer: ethers.Signer | undefined;
    if (process.env.HOT_WALLET_PRIVATE_KEY) {
      signer = new ethers.Wallet(process.env.HOT_WALLET_PRIVATE_KEY, provider);
    }
    
    const contract = new ethers.Contract(address, abi, signer || provider);
    contractInstances.set(key, contract);
  }
  
  return contractInstances.get(key)!;
};

// Gas price management
export const getGasPrice = async (chainId: number): Promise<{
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}> => {
  const provider = getProvider(chainId);
  const contracts = getContractAddresses();
  const chain = Object.values(contracts).find(c => c && 'chainId' in c && c.chainId === chainId);
  
  if (!chain || !('maxGasPrice' in chain)) {
    throw new Error(`No configuration found for chain ${chainId}`);
  }
  
  const feeData = await provider.getFeeData();
  const multiplier = parseFloat(process.env.SETTLEMENT_GAS_PRICE_MULTIPLIER || '1.2');
  
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    // EIP-1559 transaction
    let maxFeePerGas = (feeData.maxFeePerGas * BigInt(Math.floor(multiplier * 100))) / 100n;
    let maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas * BigInt(Math.floor(multiplier * 100))) / 100n;
    
    // Apply max gas price cap if configured
    if (chain.maxGasPrice && maxFeePerGas > chain.maxGasPrice) {
      maxFeePerGas = chain.maxGasPrice;
      maxPriorityFeePerGas = maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : maxPriorityFeePerGas;
    }
    
    return {
      gasPrice: maxFeePerGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  } else if (feeData.gasPrice) {
    // Legacy transaction
    let gasPrice = (feeData.gasPrice * BigInt(Math.floor(multiplier * 100))) / 100n;
    
    // Apply max gas price cap if configured
    if (chain.maxGasPrice && gasPrice > chain.maxGasPrice) {
      gasPrice = chain.maxGasPrice;
    }
    
    return { gasPrice };
  }
  
  throw new Error('Unable to fetch gas price');
};

// Chain health check
export const checkChainHealth = async (chainId: number): Promise<{
  healthy: boolean;
  blockNumber?: number;
  latency?: number;
  error?: string;
}> => {
  try {
    const provider = getProvider(chainId);
    const start = Date.now();
    const blockNumber = await provider.getBlockNumber();
    const latency = Date.now() - start;
    
    return {
      healthy: true,
      blockNumber,
      latency,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

// Export ABIs (these would be imported from compiled contracts)
export const SETTLEMENT_ABI = [
  // Add your settlement contract ABI here
];

export const ESCROW_ABI = [
  // Add your escrow contract ABI here
];