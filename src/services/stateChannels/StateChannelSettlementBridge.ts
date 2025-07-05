import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { StateManager, ChannelState, Trade } from '../../stateChannels/StateManager';
import { FinalSettlementEngine } from '../settlement/EnhancedFinalSettlementEngine';
import { SettlementService } from '../settlement/SettlementService';
import { BridgeMonitoringService } from '../settlement/BridgeMonitoringService';
import { InstantFinalityEngine } from '../../stateChannels/InstantFinality';

export interface ChannelSettlement {
  channelId: string;
  participants: string[];
  finalBalances: Map<string, ethers.BigNumber>;
  settlementTxHash?: string;
  timestamp: number;
  nonce: number;
}

export interface HFTChannelConfig {
  minChannelDuration: number; // minimum milliseconds before settlement
  maxUnsettledTrades: number;
  settlementBatchSize: number;
  autoSettleThreshold: ethers.BigNumber; // auto-settle when net position exceeds
  emergencySettlementEnabled: boolean;
}

export class StateChannelSettlementBridge extends EventEmitter {
  private stateManager: StateManager;
  private settlementEngine: FinalSettlementEngine;
  private settlementService: SettlementService;
  private bridgeMonitor: BridgeMonitoringService;
  private instantFinality: InstantFinalityEngine;
  
  private pendingSettlements: Map<string, ChannelSettlement>;
  private channelMetrics: Map<string, ChannelMetrics>;
  private config: HFTChannelConfig;
  
  constructor(
    stateManager: StateManager,
    settlementEngine: FinalSettlementEngine,
    settlementService: SettlementService,
    bridgeMonitor: BridgeMonitoringService,
    instantFinality: InstantFinalityEngine,
    config: HFTChannelConfig
  ) {
    super();
    this.stateManager = stateManager;
    this.settlementEngine = settlementEngine;
    this.settlementService = settlementService;
    this.bridgeMonitor = bridgeMonitor;
    this.instantFinality = instantFinality;
    this.config = config;
    
    this.pendingSettlements = new Map();
    this.channelMetrics = new Map();
    
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for channel state updates
    this.stateManager.on('stateUpdated', this.handleStateUpdate.bind(this));
    this.stateManager.on('channelInitialized', this.handleChannelInitialized.bind(this));
    
    // Listen for instant finality confirmations
    this.instantFinality.on('tradeFinalized', this.handleInstantTrade.bind(this));
    
    // Listen for settlement engine events
    this.settlementEngine.on('epochCompleted', this.handleEpochCompleted.bind(this));
  }

  private async handleChannelInitialized(channelId: string, state: ChannelState): Promise<void> {
    const metrics: ChannelMetrics = {
      channelId,
      createdAt: Date.now(),
      totalTrades: 0,
      totalVolume: ethers.BigNumber.from(0),
      lastActivityAt: Date.now(),
      avgTradeLatency: 0,
      netPositions: new Map()
    };
    
    this.channelMetrics.set(channelId, metrics);
    this.emit('channelCreated', channelId, state);
  }

  private async handleStateUpdate(
    channelId: string,
    state: ChannelState,
    trades: Trade[]
  ): Promise<void> {
    const metrics = this.channelMetrics.get(channelId);
    if (!metrics) return;
    
    // Update metrics
    metrics.totalTrades += trades.length;
    metrics.lastActivityAt = Date.now();
    
    for (const trade of trades) {
      metrics.totalVolume = metrics.totalVolume.add(trade.amount);
    }
    
    // Calculate net positions
    const netPositions = this.calculateNetPositions(state);
    metrics.netPositions = netPositions;
    
    // Check if auto-settlement is needed
    if (this.shouldAutoSettle(channelId, netPositions)) {
      await this.initiateSettlement(channelId, state);
    }
    
    this.emit('channelUpdated', channelId, state, metrics);
  }

  private async handleInstantTrade(channelId: string, trade: Trade): Promise<void> {
    // Record instant trade for performance tracking
    const metrics = this.channelMetrics.get(channelId);
    if (metrics) {
      const latency = Date.now() - trade.timestamp;
      metrics.avgTradeLatency = 
        (metrics.avgTradeLatency * metrics.totalTrades + latency) / (metrics.totalTrades + 1);
    }
    
    this.emit('instantTradeExecuted', channelId, trade);
  }

  private calculateNetPositions(state: ChannelState): Map<string, ethers.BigNumber> {
    const netPositions = new Map<string, ethers.BigNumber>();
    
    // Calculate net position changes from initial state
    state.balances.forEach((balance, participant) => {
      const initialBalance = this.getInitialBalance(state.channelId, participant);
      const netPosition = balance.sub(initialBalance);
      netPositions.set(participant, netPosition);
    });
    
    return netPositions;
  }

  private shouldAutoSettle(
    channelId: string,
    netPositions: Map<string, ethers.BigNumber>
  ): boolean {
    // Check if any participant's net position exceeds threshold
    for (const [_, position] of netPositions) {
      if (position.abs().gt(this.config.autoSettleThreshold)) {
        return true;
      }
    }
    
    // Check if channel has too many unsettled trades
    const metrics = this.channelMetrics.get(channelId);
    if (metrics && metrics.totalTrades >= this.config.maxUnsettledTrades) {
      return true;
    }
    
    return false;
  }

  async initiateSettlement(
    channelId: string,
    state: ChannelState,
    isFinal: boolean = false
  ): Promise<string> {
    const participants = Array.from(state.balances.keys());
    
    const settlement: ChannelSettlement = {
      channelId,
      participants,
      finalBalances: new Map(state.balances),
      timestamp: Date.now(),
      nonce: state.nonce
    };
    
    this.pendingSettlements.set(channelId, settlement);
    
    try {
      // Convert channel state to settlement trades
      const settlementTrades = await this.convertToSettlementTrades(settlement);
      
      // Submit to settlement engine
      const settlementId = await this.settlementEngine.submitTrades(settlementTrades);
      
      // If final settlement, mark channel for closure
      if (isFinal) {
        await this.finalizeChannel(channelId, settlementId);
      }
      
      this.emit('settlementInitiated', channelId, settlementId, settlement);
      return settlementId;
      
    } catch (error) {
      this.emit('settlementError', channelId, error);
      throw error;
    }
  }

  private async convertToSettlementTrades(settlement: ChannelSettlement): Promise<any[]> {
    const trades: any[] = [];
    const netPositions = new Map<string, ethers.BigNumber>();
    
    // Calculate net positions
    settlement.finalBalances.forEach((balance, participant) => {
      const initialBalance = this.getInitialBalance(settlement.channelId, participant);
      const netPosition = balance.sub(initialBalance);
      netPositions.set(participant, netPosition);
    });
    
    // Create settlement trades for net positions
    netPositions.forEach((position, participant) => {
      if (!position.isZero()) {
        trades.push({
          channelId: settlement.channelId,
          participant,
          netAmount: position,
          timestamp: settlement.timestamp,
          nonce: settlement.nonce,
          type: position.gt(0) ? 'credit' : 'debit'
        });
      }
    });
    
    return trades;
  }

  async performPeriodicSettlement(channelId: string): Promise<void> {
    const state = this.stateManager.getState(channelId);
    if (!state) {
      throw new Error('Channel not found');
    }
    
    const metrics = this.channelMetrics.get(channelId);
    if (!metrics) return;
    
    // Check minimum channel duration
    const channelAge = Date.now() - metrics.createdAt;
    if (channelAge < this.config.minChannelDuration) {
      return;
    }
    
    await this.initiateSettlement(channelId, state, false);
  }

  async emergencySettle(channelId: string): Promise<void> {
    if (!this.config.emergencySettlementEnabled) {
      throw new Error('Emergency settlement not enabled');
    }
    
    const state = this.stateManager.getState(channelId);
    if (!state) {
      throw new Error('Channel not found');
    }
    
    // Force immediate settlement
    await this.initiateSettlement(channelId, state, true);
    this.emit('emergencySettlement', channelId);
  }

  private async finalizeChannel(channelId: string, settlementId: string): Promise<void> {
    const settlement = this.pendingSettlements.get(channelId);
    if (!settlement) return;
    
    settlement.settlementTxHash = settlementId;
    
    // Clean up channel data
    this.pendingSettlements.delete(channelId);
    this.channelMetrics.delete(channelId);
    
    this.emit('channelFinalized', channelId, settlement);
  }

  private async handleEpochCompleted(epochNumber: number): Promise<void> {
    // Process any pending channel settlements in this epoch
    for (const [channelId, settlement] of this.pendingSettlements) {
      if (settlement.settlementTxHash) {
        await this.finalizeChannel(channelId, settlement.settlementTxHash);
      }
    }
  }

  getChannelMetrics(channelId: string): ChannelMetrics | undefined {
    return this.channelMetrics.get(channelId);
  }

  getAllChannelMetrics(): ChannelMetrics[] {
    return Array.from(this.channelMetrics.values());
  }

  private getInitialBalance(channelId: string, participant: string): ethers.BigNumber {
    // Get initial balance from first state in history
    const history = this.stateManager.getStateHistory(channelId);
    if (history.length > 0) {
      return history[0].balances.get(participant) || ethers.BigNumber.from(0);
    }
    return ethers.BigNumber.from(0);
  }
}

interface ChannelMetrics {
  channelId: string;
  createdAt: number;
  totalTrades: number;
  totalVolume: ethers.BigNumber;
  lastActivityAt: number;
  avgTradeLatency: number;
  netPositions: Map<string, ethers.BigNumber>;
}