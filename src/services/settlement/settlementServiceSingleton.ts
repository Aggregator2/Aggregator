import { SettlementService, SettlementServiceConfig } from './SettlementService';
import { MatchingEngine } from '../matchingEngine/MatchingEngine';
import { SettlementOrchestrator } from './SettlementOrchestrator';
import { FinalSettlementEngine } from './FinalSettlementEngine';
import { ethers } from 'ethers';
import Redis from 'ioredis';

let settlementService: SettlementService | null = null;
let orchestrator: SettlementOrchestrator | null = null;
let settlementEngine: FinalSettlementEngine | null = null;
let matchingEngine: MatchingEngine | null = null;
let redisClient: Redis | null = null;

// Initialize Redis client for settlement tracking
function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });
  }
  return redisClient;
}

// Get or create the settlement service instance
export async function getSettlementService(): Promise<SettlementService> {
  if (!settlementService) {
    const config: SettlementServiceConfig = {
      // Provider configuration
      providerUrl: process.env.RPC_URL || 'http://localhost:8545',
      privateKey: process.env.SETTLEMENT_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      
      // Settlement configuration
      settlementContractAddress: process.env.SETTLEMENT_CONTRACT || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      epochDuration: parseInt(process.env.SETTLEMENT_EPOCH_DURATION || '300000'), // 5 minutes default
      
      // Matching engine configuration
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
        makerFeeRate: 0.001,
        takerFeeRate: 0.002,
        enableStopOrders: false,
        enableIcebergOrders: false
      },
      
      // Webhook configuration
      enableWebhooks: true,
      webhookRetryAttempts: 3,
      webhookRetryDelay: 1000,
      
      // Features
      enableAutoSettlement: true,
      enableEmergencyPause: true,
      
      // Performance
      maxTradesPerEpoch: 10000,
      maxBundleSize: 100
    };

    settlementService = new SettlementService(config);
    await settlementService.initialize();
    
    // Get instances for direct access
    orchestrator = settlementService.getOrchestrator();
    settlementEngine = settlementService.getSettlementEngine();
    matchingEngine = settlementService.getMatchingEngine();
    
    // Start the orchestrator
    orchestrator.start();
  }
  
  return settlementService;
}

// Get the orchestrator instance
export async function getOrchestrator(): Promise<SettlementOrchestrator> {
  if (!orchestrator) {
    await getSettlementService();
  }
  return orchestrator!;
}

// Get the settlement engine instance
export async function getSettlementEngine(): Promise<FinalSettlementEngine> {
  if (!settlementEngine) {
    await getSettlementService();
  }
  return settlementEngine!;
}

// Get the matching engine instance
export async function getMatchingEngine(): Promise<MatchingEngine> {
  if (!matchingEngine) {
    await getSettlementService();
  }
  return matchingEngine!;
}

// Settlement status tracking in Redis
export interface SettlementStatus {
  status: 'active' | 'inactive' | 'processing' | 'error';
  pendingSettlements: number;
  lastSettlement: number | null;
  currentEpoch: string | null;
  processedTrades: number;
  failedSettlements: number;
  successfulSettlements: number;
}

export async function getSettlementStatus(): Promise<SettlementStatus> {
  const redis = getRedisClient();
  const orchestratorInstance = await getOrchestrator();
  
  // Get real-time status from orchestrator
  const orchestratorStatus = orchestratorInstance.getStatus();
  
  // Get additional metrics from Redis
  const pendingSettlements = await redis.llen('settlements:pending');
  const lastSettlement = await redis.get('settlements:last_processed');
  const failedCount = await redis.get('settlements:failed_count') || '0';
  const successCount = await redis.get('settlements:success_count') || '0';
  
  return {
    status: orchestratorStatus.isRunning ? 'active' : 'inactive',
    pendingSettlements,
    lastSettlement: lastSettlement ? parseInt(lastSettlement) : null,
    currentEpoch: orchestratorStatus.currentEpoch?.id || null,
    processedTrades: orchestratorStatus.processedTrades || 0,
    failedSettlements: parseInt(failedCount),
    successfulSettlements: parseInt(successCount)
  };
}

// Create a new settlement batch
export async function createSettlementBatch(trades: any[]): Promise<string> {
  const redis = getRedisClient();
  const batchId = `BATCH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Store batch in Redis
  await redis.setex(
    `settlements:batch:${batchId}`,
    86400, // 24 hour TTL
    JSON.stringify({
      id: batchId,
      trades,
      status: 'pending',
      createdAt: Date.now()
    })
  );
  
  // Add to pending queue
  await redis.lpush('settlements:pending', batchId);
  
  return batchId;
}

// Process a settlement batch
export async function processSettlement(batchId: string): Promise<void> {
  const redis = getRedisClient();
  const engineInstance = await getSettlementEngine();
  
  try {
    // Get batch from Redis
    const batchData = await redis.get(`settlements:batch:${batchId}`);
    if (!batchData) {
      throw new Error('Batch not found');
    }
    
    const batch = JSON.parse(batchData);
    
    // Update status
    batch.status = 'processing';
    await redis.setex(`settlements:batch:${batchId}`, 86400, JSON.stringify(batch));
    
    // Add trades to current epoch
    for (const trade of batch.trades) {
      engineInstance.addTrade(trade);
    }
    
    // Update metrics
    await redis.incr('settlements:success_count');
    await redis.set('settlements:last_processed', Date.now().toString());
    
    // Update batch status
    batch.status = 'completed';
    batch.completedAt = Date.now();
    await redis.setex(`settlements:batch:${batchId}`, 86400, JSON.stringify(batch));
    
  } catch (error) {
    // Update failure metrics
    await redis.incr('settlements:failed_count');
    
    // Update batch status
    const batchData = await redis.get(`settlements:batch:${batchId}`);
    if (batchData) {
      const batch = JSON.parse(batchData);
      batch.status = 'failed';
      batch.error = error.message;
      await redis.setex(`settlements:batch:${batchId}`, 86400, JSON.stringify(batch));
    }
    
    throw error;
  }
}

// Generate merkle proof for a settlement
export async function generateMerkleProof(settlementId: string, userId: string): Promise<any> {
  const engineInstance = await getSettlementEngine();
  
  // This would typically use the MerkleSettlementProof service
  // For now, return a mock proof structure
  const leaves = ['0x' + settlementId, '0x' + userId];
  const root = ethers.keccak256(ethers.concat(leaves));
  
  return {
    settlementId,
    userId,
    proof: {
      root,
      leaves,
      path: ['0x' + Buffer.from('left').toString('hex'), '0x' + Buffer.from('right').toString('hex')],
      index: 0
    },
    timestamp: Date.now()
  };
}

// Cleanup function for graceful shutdown
export async function cleanup(): Promise<void> {
  if (orchestrator) {
    orchestrator.stop();
  }
  
  if (redisClient) {
    await redisClient.quit();
  }
  
  if (settlementService) {
    await settlementService.shutdown();
  }
}