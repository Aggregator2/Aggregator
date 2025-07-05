import { ethers } from 'ethers';
import { MEVProtectionConfig, MEVProtectionProvider } from './MEVProtectionService';
import { MEVProtectedSettlementConfig } from '../settlement/MEVProtectedSettlementEngine';

// Example MEV Protection Configuration
// Copy this file to mev.config.ts and update with your actual values

// Environment-specific configurations
const configs = {
  // Production configuration
  production: {
    mevProtection: {
      // Primary provider for production
      primaryProvider: MEVProtectionProvider.FLASHBOTS,
      
      // Fallback providers in order of preference
      fallbackProviders: [
        MEVProtectionProvider.BLOXROUTE,
        MEVProtectionProvider.EDEN,
        MEVProtectionProvider.MISTX,
        MEVProtectionProvider.SECURE_RPC,
        MEVProtectionProvider.STANDARD // Last resort
      ],
      
      // Flashbots configuration
      flashbotsRelayUrl: 'https://relay.flashbots.net',
      flashbotsAuthSigner: new ethers.Wallet(process.env.FLASHBOTS_AUTH_KEY || ethers.randomBytes(32)),
      
      // bloXroute configuration
      bloxrouteAuthHeader: process.env.BLOXROUTE_AUTH_HEADER || '',
      
      // Eden Network configuration
      edenRpcUrl: 'https://api.edennetwork.io/v1/rpc',
      
      // mistX configuration
      mistxApiKey: process.env.MISTX_API_KEY || '',
      
      // Secure RPC configuration
      secureRpcUrl: process.env.SECURE_RPC_URL || '',
      
      // Transaction settings
      maxBlocksInFuture: 25,
      simulationEnabled: true,
      bundleTimeout: 120000, // 2 minutes
      retryAttempts: 3,
      retryDelay: 1000 // 1 second
    } as MEVProtectionConfig,
    
    // Settlement configuration
    settlement: {
      settlementContractAddress: process.env.SETTLEMENT_CONTRACT_ADDRESS || '',
      epochDuration: 300000, // 5 minutes
      prioritizeLargeSettlements: true,
      simulateBeforeSending: true,
      maxRetries: 3,
      bundleTimeout: 120000 // 2 minutes
    }
  },
  
  // Staging configuration
  staging: {
    mevProtection: {
      primaryProvider: MEVProtectionProvider.FLASHBOTS,
      fallbackProviders: [
        MEVProtectionProvider.SECURE_RPC,
        MEVProtectionProvider.STANDARD
      ],
      
      // Goerli testnet Flashbots
      flashbotsRelayUrl: 'https://relay-goerli.flashbots.net',
      flashbotsAuthSigner: new ethers.Wallet(process.env.FLASHBOTS_AUTH_KEY || ethers.randomBytes(32)),
      
      // Staging secure RPC
      secureRpcUrl: process.env.STAGING_SECURE_RPC_URL || '',
      
      maxBlocksInFuture: 10,
      simulationEnabled: true,
      bundleTimeout: 60000, // 1 minute
      retryAttempts: 2,
      retryDelay: 2000 // 2 seconds
    } as MEVProtectionConfig,
    
    settlement: {
      settlementContractAddress: process.env.STAGING_SETTLEMENT_CONTRACT || '',
      epochDuration: 60000, // 1 minute for faster testing
      prioritizeLargeSettlements: true,
      simulateBeforeSending: true,
      maxRetries: 2,
      bundleTimeout: 60000
    }
  },
  
  // Development configuration
  development: {
    mevProtection: {
      primaryProvider: MEVProtectionProvider.STANDARD,
      fallbackProviders: [],
      
      maxBlocksInFuture: 5,
      simulationEnabled: false,
      bundleTimeout: 30000, // 30 seconds
      retryAttempts: 1,
      retryDelay: 1000
    } as MEVProtectionConfig,
    
    settlement: {
      settlementContractAddress: '0x0000000000000000000000000000000000000000',
      epochDuration: 30000, // 30 seconds for development
      prioritizeLargeSettlements: false,
      simulateBeforeSending: false,
      maxRetries: 1,
      bundleTimeout: 30000
    }
  }
};

// Get configuration based on environment
export function getMEVProtectionConfig(env: string = process.env.NODE_ENV || 'development'): MEVProtectedSettlementConfig {
  const config = configs[env] || configs.development;
  
  return {
    mevProtection: config.mevProtection,
    ...config.settlement
  } as MEVProtectedSettlementConfig;
}

// Validate configuration
export function validateMEVConfig(config: MEVProtectedSettlementConfig): string[] {
  const errors: string[] = [];
  
  // Check required fields
  if (!config.settlementContractAddress) {
    errors.push('Settlement contract address is required');
  }
  
  if (!config.epochDuration || config.epochDuration < 1000) {
    errors.push('Epoch duration must be at least 1000ms');
  }
  
  // Check provider configuration
  const mevConfig = config.mevProtection;
  
  if (mevConfig.primaryProvider === MEVProtectionProvider.FLASHBOTS) {
    if (!mevConfig.flashbotsRelayUrl) {
      errors.push('Flashbots relay URL is required when using Flashbots');
    }
    if (!mevConfig.flashbotsAuthSigner) {
      errors.push('Flashbots auth signer is required when using Flashbots');
    }
  }
  
  if (mevConfig.primaryProvider === MEVProtectionProvider.BLOXROUTE || 
      mevConfig.fallbackProviders.includes(MEVProtectionProvider.BLOXROUTE)) {
    if (!mevConfig.bloxrouteAuthHeader) {
      errors.push('bloXroute auth header is required when using bloXroute');
    }
  }
  
  if (mevConfig.primaryProvider === MEVProtectionProvider.MISTX || 
      mevConfig.fallbackProviders.includes(MEVProtectionProvider.MISTX)) {
    if (!mevConfig.mistxApiKey) {
      errors.push('mistX API key is required when using mistX');
    }
  }
  
  return errors;
}

// Provider-specific configurations
export const providerConfigs = {
  // Mainnet endpoints
  mainnet: {
    flashbots: {
      relay: 'https://relay.flashbots.net',
      status: 'https://relay.flashbots.net/status'
    },
    bloxroute: {
      gateway: 'https://api.blxrbdn.com',
      cloudApi: 'https://api.bloxroute.com'
    },
    eden: {
      rpc: 'https://api.edennetwork.io/v1/rpc',
      relay: 'https://relay.edennetwork.io'
    },
    mistx: {
      api: 'https://api.mistx.io/v1'
    }
  },
  
  // Goerli testnet endpoints
  goerli: {
    flashbots: {
      relay: 'https://relay-goerli.flashbots.net',
      status: 'https://relay-goerli.flashbots.net/status'
    }
  }
};

// Monitoring configuration
export const monitoringConfig = {
  production: {
    updateInterval: 60000, // 1 minute
    metricsRetentionPeriod: 604800000, // 7 days
    alertThresholds: {
      failureRateThreshold: 10, // 10% in production
      averageConfirmationTimeThreshold: 180000, // 3 minutes
      providerHealthCheckInterval: 300000 // 5 minutes
    }
  },
  staging: {
    updateInterval: 30000, // 30 seconds
    metricsRetentionPeriod: 86400000, // 1 day
    alertThresholds: {
      failureRateThreshold: 20, // 20% in staging
      averageConfirmationTimeThreshold: 300000, // 5 minutes
      providerHealthCheckInterval: 180000 // 3 minutes
    }
  },
  development: {
    updateInterval: 10000, // 10 seconds
    metricsRetentionPeriod: 3600000, // 1 hour
    alertThresholds: {
      failureRateThreshold: 50, // 50% in development
      averageConfirmationTimeThreshold: 600000, // 10 minutes
      providerHealthCheckInterval: 60000 // 1 minute
    }
  }
};

// Gas configuration by network
export const gasConfig = {
  mainnet: {
    maxFeePerGas: ethers.parseUnits('300', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('3', 'gwei'),
    gasBufferPercentage: 10
  },
  goerli: {
    maxFeePerGas: ethers.parseUnits('100', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
    gasBufferPercentage: 20
  }
};

// Export default configuration
export default getMEVProtectionConfig();