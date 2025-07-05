import { ethers } from 'ethers';
import { StateManager } from '../../stateChannels/StateManager';
import { HFTOptimizedInstantFinality } from '../../stateChannels/HFTOptimizedInstantFinality';
import { StateChannelSDK } from '../../stateChannels';
import { StateChannelSettlementBridge } from './StateChannelSettlementBridge';
import { getSettlementEngine } from '../settlement/singleton';

let stateManager = null;
let instantFinality = null;
let stateChannelSDK = null;
let settlementBridge = null;

export async function getStateManager() {
  if (!stateManager) {
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545');
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001', provider);
    stateManager = new StateManager(signer);
  }
  return stateManager;
}

export async function getInstantFinality() {
  if (!instantFinality) {
    const manager = await getStateManager();
    
    const hftConfig = {
      requiredSignatures: parseInt(process.env.HFT_REQUIRED_SIGNATURES) || 2,
      maxTradeAmount: ethers.utils.parseEther(process.env.HFT_MAX_TRADE_AMOUNT || '1000'),
      minConfirmationTime: parseInt(process.env.HFT_MIN_CONFIRMATION_TIME) || 100,
      maxPendingTrades: parseInt(process.env.HFT_MAX_PENDING_TRADES) || 100,
      enableParallelExecution: process.env.HFT_PARALLEL_EXECUTION !== 'false',
      batchProcessingInterval: parseInt(process.env.HFT_BATCH_INTERVAL) || 50,
      maxBatchSize: parseInt(process.env.HFT_MAX_BATCH_SIZE) || 20,
      enableOptimisticExecution: process.env.HFT_OPTIMISTIC_EXECUTION !== 'false',
      memoryPoolSize: parseInt(process.env.HFT_MEMORY_POOL_SIZE) || 1000,
      signatureCacheSize: parseInt(process.env.HFT_SIGNATURE_CACHE_SIZE) || 10000,
      enableZeroConfirmation: process.env.HFT_ZERO_CONFIRMATION === 'true'
    };
    
    instantFinality = new HFTOptimizedInstantFinality(manager, hftConfig);
  }
  return instantFinality;
}

export async function getStateChannelSDK() {
  if (!stateChannelSDK) {
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545');
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001', provider);
    
    stateChannelSDK = new StateChannelSDK(
      provider,
      process.env.STATE_CHANNEL_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000',
      signer
    );
  }
  return stateChannelSDK;
}

export async function getSettlementBridge() {
  if (!settlementBridge) {
    const manager = await getStateManager();
    const finality = await getInstantFinality();
    const settlementEngine = await getSettlementEngine();
    
    const bridgeConfig = {
      minChannelDuration: parseInt(process.env.BRIDGE_MIN_CHANNEL_DURATION) || 60000,
      maxUnsettledTrades: parseInt(process.env.BRIDGE_MAX_UNSETTLED_TRADES) || 1000,
      settlementBatchSize: parseInt(process.env.BRIDGE_SETTLEMENT_BATCH_SIZE) || 100,
      autoSettleThreshold: ethers.utils.parseEther(process.env.BRIDGE_AUTO_SETTLE_THRESHOLD || '10000'),
      emergencySettlementEnabled: process.env.BRIDGE_EMERGENCY_SETTLEMENT !== 'false'
    };
    
    settlementBridge = new StateChannelSettlementBridge(
      manager,
      settlementEngine,
      settlementEngine.settlementService,
      settlementEngine.bridgeMonitor,
      finality,
      bridgeConfig
    );
  }
  return settlementBridge;
}

export async function cleanupServices() {
  if (instantFinality) {
    await instantFinality.cleanup();
    instantFinality = null;
  }
  
  stateManager = null;
  stateChannelSDK = null;
  settlementBridge = null;
}