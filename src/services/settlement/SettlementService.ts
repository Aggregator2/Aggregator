import { ethers } from 'ethers';
import { MatchingEngine } from '../matchingEngine/MatchingEngine';
import { MatchingEngineConfig } from '../matchingEngine/types';
import { SettlementOrchestrator, OrchestratorConfig } from './SettlementOrchestrator';
import { FinalSettlementEngine } from './FinalSettlementEngine';
import { EventEmitter } from 'events';

export interface SettlementServiceConfig {
  // Provider configuration
  providerUrl: string;
  privateKey: string;
  
  // Settlement configuration
  settlementContractAddress: string;
  epochDuration: number; // in milliseconds
  
  // Matching engine configuration
  matchingEngineConfig: MatchingEngineConfig;
  
  // Webhook configuration
  enableWebhooks: boolean;
  webhookRetryAttempts?: number;
  webhookRetryDelay?: number;
  
  // Features
  enableAutoSettlement: boolean;
  enableEmergencyPause: boolean;
  
  // Performance
  maxTradesPerEpoch?: number;
  maxBundleSize?: number;
}

export class SettlementService extends EventEmitter {
  private config: SettlementServiceConfig;
  private provider: ethers.Provider;
  private matchingEngine: MatchingEngine;
  private orchestrator: SettlementOrchestrator;
  private isInitialized: boolean = false;

  constructor(config: SettlementServiceConfig) {
    super();
    this.config = config;
    
    // Initialize provider
    this.provider = new ethers.JsonRpcProvider(config.providerUrl);
    
    // Initialize matching engine
    this.matchingEngine = new MatchingEngine(config.matchingEngineConfig);
    
    // Initialize orchestrator
    const orchestratorConfig: OrchestratorConfig = {
      provider: this.provider,
      privateKey: config.privateKey,
      settlementContractAddress: config.settlementContractAddress,
      epochDuration: config.epochDuration,
      enableAutoSettlement: config.enableAutoSettlement,
      webhookConfig: config.enableWebhooks ? {
        url: '', // Will be set per user
        secret: '', // Will be set per user
        retryAttempts: config.webhookRetryAttempts || 3,
        retryDelay: config.webhookRetryDelay || 1000
      } : undefined
    };
    
    this.orchestrator = new SettlementOrchestrator(this.matchingEngine, orchestratorConfig);
    
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Forward matching engine events
    this.matchingEngine.on('trade', (trade) => {
      this.emit('trade', trade);
    });
    
    this.matchingEngine.on('orderAdded', (order) => {
      this.emit('orderAdded', order);
    });
    
    this.matchingEngine.on('orderFilled', (order) => {
      this.emit('orderFilled', order);
    });
    
    // Forward orchestrator events
    this.orchestrator.on('epochStarted', (data) => {
      this.emit('epochStarted', data);
    });
    
    this.orchestrator.on('epochFinalized', (data) => {
      this.emit('epochFinalized', data);
    });
    
    this.orchestrator.on('settlementConfirmed', (data) => {
      this.emit('settlementConfirmed', data);
    });
    
    this.orchestrator.on('webhookDelivered', (data) => {
      this.emit('webhookDelivered', data);
    });
    
    this.orchestrator.on('webhookFailed', (data) => {
      this.emit('webhookFailed', data);
    });
  }

  // Initialize the service
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Settlement service already initialized');
    }
    
    try {
      // Verify provider connection
      const network = await this.provider.getNetwork();
      console.log(`Connected to network: ${network.name} (chainId: ${network.chainId})`);
      
      // Verify settlement contract
      const code = await this.provider.getCode(this.config.settlementContractAddress);
      if (code === '0x') {
        throw new Error('Settlement contract not deployed at specified address');
      }
      
      // Initialize default trading pairs
      this.initializeDefaultPairs();
      
      // Start the orchestrator
      this.orchestrator.start();
      
      this.isInitialized = true;
      
      this.emit('initialized', {
        network: network.name,
        chainId: network.chainId,
        settlementContract: this.config.settlementContractAddress,
        epochDuration: this.config.epochDuration
      });
      
      console.log('Settlement service initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize settlement service:', error);
      throw error;
    }
  }

  // Initialize default trading pairs
  private initializeDefaultPairs(): void {
    const defaultPairs = [
      { pair: 'ETH/USDC', tickSize: 0.01 },
      { pair: 'BTC/USDC', tickSize: 0.1 },
      { pair: 'ETH/USDT', tickSize: 0.01 },
      { pair: 'BTC/USDT', tickSize: 0.1 }
    ];
    
    for (const { pair, tickSize } of defaultPairs) {
      this.matchingEngine.initializePair(pair, tickSize);
    }
  }

  // Submit an order to the matching engine
  public async submitOrder(orderRequest: any): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    return this.matchingEngine.submitOrder(orderRequest);
  }

  // Cancel an order
  public async cancelOrder(orderId: string, userId?: string): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    return this.matchingEngine.cancelOrder(orderId, userId);
  }

  // Get order book snapshot
  public getOrderBook(pair: string): any {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    return this.matchingEngine.getOrderBookSnapshot(pair);
  }

  // Get market data
  public getMarketData(pair: string): any {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    return this.matchingEngine.getMarketData(pair);
  }

  // Register webhook for a user
  public registerWebhook(userId: string, webhookUrl: string, secret?: string): void {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    if (!this.config.enableWebhooks) {
      throw new Error('Webhooks are not enabled');
    }
    
    this.orchestrator.registerWebhook(userId, webhookUrl, secret);
  }

  // Unregister webhook for a user
  public unregisterWebhook(userId: string): void {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    this.orchestrator.unregisterWebhook(userId);
  }

  // Get service status
  public getStatus(): any {
    return {
      initialized: this.isInitialized,
      matching: {
        pairs: this.matchingEngine.getTradingPairs(),
        ordersCount: this.matchingEngine.getOrders().length,
        tradesCount: this.matchingEngine.getRecentTrades('', 1000).length
      },
      settlement: this.isInitialized ? this.orchestrator.getStatus() : null,
      config: {
        epochDuration: this.config.epochDuration,
        settlementContract: this.config.settlementContractAddress,
        webhooksEnabled: this.config.enableWebhooks,
        autoSettlement: this.config.enableAutoSettlement
      }
    };
  }

  // Get user orders
  public getUserOrders(userId: string, pair?: string, status?: any): any[] {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    return this.matchingEngine.getOrders(userId, pair, status);
  }

  // Get recent trades
  public getRecentTrades(pair: string, limit: number = 100): any[] {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    return this.matchingEngine.getRecentTrades(pair, limit);
  }

  // Emergency pause
  public async emergencyPause(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    if (!this.config.enableEmergencyPause) {
      throw new Error('Emergency pause not enabled');
    }
    
    // Stop the orchestrator
    this.orchestrator.stop();
    
    // Pause settlement contract
    const settlementEngine = this.orchestrator['settlementEngine'];
    await settlementEngine.emergencyPause();
    
    this.emit('emergencyPause', {
      timestamp: Date.now()
    });
  }

  // Resume after emergency pause
  public async resume(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Settlement service not initialized');
    }
    
    // Resume the orchestrator
    this.orchestrator.start();
    
    this.emit('resumed', {
      timestamp: Date.now()
    });
  }

  // Get the orchestrator instance
  public getOrchestrator(): SettlementOrchestrator {
    return this.orchestrator;
  }
  
  // Get the settlement engine instance
  public getSettlementEngine(): FinalSettlementEngine {
    return this.orchestrator['settlementEngine'];
  }
  
  // Get the matching engine instance
  public getMatchingEngine(): MatchingEngine {
    return this.matchingEngine;
  }

  // Shutdown the service
  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }
    
    // Stop the orchestrator
    this.orchestrator.stop();
    
    // Clear matching engine
    this.matchingEngine.clear();
    
    this.isInitialized = false;
    
    this.emit('shutdown', {
      timestamp: Date.now()
    });
  }

}

// Factory function to create settlement service
export function createSettlementService(config: SettlementServiceConfig): SettlementService {
  return new SettlementService(config);
}

// Default configuration
export const defaultSettlementConfig: SettlementServiceConfig = {
  providerUrl: process.env.RPC_URL || 'http://localhost:8545',
  privateKey: process.env.SETTLEMENT_PRIVATE_KEY || process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  settlementContractAddress: process.env.SETTLEMENT_CONTRACT || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  epochDuration: parseInt(process.env.EPOCH_DURATION || '3600000'), // 1 hour
  matchingEngineConfig: {
    maxOrderBookDepth: 1000,
    minOrderSize: {
      'ETH/USDC': 0.001,
      'BTC/USDC': 0.00001,
      'ETH/USDT': 0.001,
      'BTC/USDT': 0.00001
    },
    maxOrderSize: {
      'ETH/USDC': 1000,
      'BTC/USDC': 100,
      'ETH/USDT': 1000,
      'BTC/USDT': 100
    },
    tickSize: {
      'ETH/USDC': 0.01,
      'BTC/USDC': 0.1,
      'ETH/USDT': 0.01,
      'BTC/USDT': 0.1
    },
    makerFeeRate: 0.001, // 0.1%
    takerFeeRate: 0.002, // 0.2%
    enableStopOrders: false,
    enableIcebergOrders: false
  },
  enableWebhooks: true,
  webhookRetryAttempts: 3,
  webhookRetryDelay: 1000,
  enableAutoSettlement: true,
  enableEmergencyPause: true,
  maxTradesPerEpoch: 10000,
  maxBundleSize: 100
};