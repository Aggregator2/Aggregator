import { WebSocketService, ChannelType as BaseChannelType } from './WebSocketService';
import { StateChannelSettlementBridge } from '../stateChannels/StateChannelSettlementBridge';
import { StateManager, ChannelState, Trade } from '../../stateChannels/StateManager';
import { HFTOptimizedInstantFinality, HFTMetrics } from '../../stateChannels/HFTOptimizedInstantFinality';
import { InstantTrade } from '../../stateChannels/InstantFinality';

// Extend channel types for state channels
export enum StateChannelType {
  STATE_CHANNEL = 'state_channel',
  INSTANT_TRADES = 'instant_trades',
  CHANNEL_METRICS = 'channel_metrics',
  SETTLEMENT_STATUS = 'settlement_status'
}

export interface StateChannelWebSocketConfig {
  enableRealtimeMetrics: boolean;
  metricsInterval: number; // milliseconds
  enableInstantTradeNotifications: boolean;
  enableSettlementUpdates: boolean;
}

export class StateChannelWebSocketExtension {
  private wsService: WebSocketService;
  private settlementBridge: StateChannelSettlementBridge;
  private stateManager: StateManager;
  private instantFinality: HFTOptimizedInstantFinality;
  private config: StateChannelWebSocketConfig;
  private metricsTimer?: NodeJS.Timer;

  constructor(
    wsService: WebSocketService,
    settlementBridge: StateChannelSettlementBridge,
    stateManager: StateManager,
    instantFinality: HFTOptimizedInstantFinality,
    config: StateChannelWebSocketConfig
  ) {
    this.wsService = wsService;
    this.settlementBridge = settlementBridge;
    this.stateManager = stateManager;
    this.instantFinality = instantFinality;
    this.config = config;

    this.setupEventListeners();
    this.extendWebSocketHandlers();
    
    if (config.enableRealtimeMetrics) {
      this.startMetricsStreaming();
    }
  }

  private setupEventListeners(): void {
    // State channel events
    this.stateManager.on('channelInitialized', (channelId: string, state: ChannelState) => {
      this.broadcastChannelUpdate(channelId, 'initialized', state);
    });

    this.stateManager.on('stateUpdated', (channelId: string, state: ChannelState, trades: Trade[]) => {
      this.broadcastChannelUpdate(channelId, 'updated', state, trades);
    });

    this.stateManager.on('tradeProposed', (channelId: string, trade: Trade) => {
      this.broadcastChannelUpdate(channelId, 'trade_proposed', null, [trade]);
    });

    // Instant finality events
    if (this.config.enableInstantTradeNotifications) {
      this.instantFinality.on('instantTradeInitiated', (trade: InstantTrade) => {
        this.broadcastInstantTrade(trade, 'initiated');
      });

      this.instantFinality.on('instantTradeConfirmed', (trade: InstantTrade, signer: string) => {
        this.broadcastInstantTrade(trade, 'confirmed', { signer });
      });

      this.instantFinality.on('instantTradeExecuted', (trade: InstantTrade) => {
        this.broadcastInstantTrade(trade, 'executed');
      });

      this.instantFinality.on('hftTradeExecuted', (trade: InstantTrade) => {
        this.broadcastInstantTrade(trade, 'hft_executed');
      });

      this.instantFinality.on('zeroConfTradeExecuted', (trade: InstantTrade) => {
        this.broadcastInstantTrade(trade, 'zero_conf_executed');
      });
    }

    // Settlement bridge events
    if (this.config.enableSettlementUpdates) {
      this.settlementBridge.on('channelCreated', (channelId: string) => {
        this.broadcastSettlementUpdate(channelId, 'channel_created');
      });

      this.settlementBridge.on('settlementInitiated', (channelId: string, settlementId: string) => {
        this.broadcastSettlementUpdate(channelId, 'settlement_initiated', { settlementId });
      });

      this.settlementBridge.on('channelFinalized', (channelId: string, settlement: any) => {
        this.broadcastSettlementUpdate(channelId, 'channel_finalized', { settlement });
      });

      this.settlementBridge.on('emergencySettlement', (channelId: string) => {
        this.broadcastSettlementUpdate(channelId, 'emergency_settlement');
      });
    }
  }

  private extendWebSocketHandlers(): void {
    // Listen for subscription requests
    this.wsService.on('client:subscribed', ({ clientId, channel }) => {
      const [channelType, ...params] = channel.split(':');
      
      switch (channelType) {
        case StateChannelType.STATE_CHANNEL:
          if (params[0]) {
            this.sendChannelSnapshot(clientId, params[0]);
          }
          break;
          
        case StateChannelType.INSTANT_TRADES:
          if (params[0]) {
            this.sendPendingTrades(clientId, params[0]);
          }
          break;
          
        case StateChannelType.CHANNEL_METRICS:
          this.sendChannelMetrics(clientId);
          break;
      }
    });

    // Handle state channel specific requests
    this.wsService.on('request:channel:snapshot', ({ channelId, clientId }) => {
      this.sendChannelSnapshot(clientId, channelId);
    });

    this.wsService.on('request:channel:history', ({ channelId, clientId }) => {
      this.sendChannelHistory(clientId, channelId);
    });

    this.wsService.on('request:hft:metrics', ({ clientId }) => {
      this.sendHFTMetrics(clientId);
    });
  }

  private broadcastChannelUpdate(
    channelId: string,
    eventType: string,
    state: ChannelState | null,
    trades?: Trade[]
  ): void {
    const channel = `${StateChannelType.STATE_CHANNEL}:${channelId}`;
    
    const data = {
      channelId,
      eventType,
      state: state ? {
        nonce: state.nonce,
        balances: Object.fromEntries(state.balances),
        stateRoot: state.stateRoot,
        timestamp: state.timestamp
      } : null,
      trades: trades?.map(t => ({
        id: t.id,
        from: t.from,
        to: t.to,
        amount: t.amount.toString(),
        timestamp: t.timestamp
      }))
    };

    this.wsService['io'].to(channel).emit('channel:update', {
      channel,
      data,
      timestamp: Date.now()
    });
  }

  private broadcastInstantTrade(
    trade: InstantTrade,
    eventType: string,
    additionalData?: any
  ): void {
    const channel = `${StateChannelType.INSTANT_TRADES}:${trade.channelId}`;
    
    const data = {
      tradeId: trade.id,
      channelId: trade.channelId,
      eventType,
      trade: {
        from: trade.from,
        to: trade.to,
        amount: trade.amount.toString(),
        timestamp: trade.timestamp,
        executed: trade.executed
      },
      finalityProof: {
        tradeHash: trade.finalityProof.tradeHash,
        signatureCount: trade.finalityProof.signatures.size,
        timestamp: trade.finalityProof.timestamp
      },
      ...additionalData
    };

    this.wsService['io'].to(channel).emit('instant:trade', {
      channel,
      data,
      timestamp: Date.now()
    });

    // Also broadcast to global instant trades channel
    this.wsService['io'].to(StateChannelType.INSTANT_TRADES).emit('instant:trade:global', {
      data,
      timestamp: Date.now()
    });
  }

  private broadcastSettlementUpdate(
    channelId: string,
    eventType: string,
    additionalData?: any
  ): void {
    const channel = `${StateChannelType.SETTLEMENT_STATUS}:${channelId}`;
    
    const data = {
      channelId,
      eventType,
      ...additionalData
    };

    this.wsService['io'].to(channel).emit('settlement:update', {
      channel,
      data,
      timestamp: Date.now()
    });
  }

  private sendChannelSnapshot(clientId: string, channelId: string): void {
    const state = this.stateManager.getState(channelId);
    const metrics = this.settlementBridge.getChannelMetrics(channelId);
    const pendingTrades = this.stateManager.getPendingTrades(channelId);

    if (!state) {
      this.wsService.sendToClient(clientId, 'error', {
        message: 'Channel not found',
        channelId
      });
      return;
    }

    this.wsService.sendToClient(clientId, 'channel:snapshot', {
      channelId,
      state: {
        nonce: state.nonce,
        balances: Object.fromEntries(state.balances),
        stateRoot: state.stateRoot,
        timestamp: state.timestamp
      },
      metrics: metrics ? {
        totalTrades: metrics.totalTrades,
        totalVolume: metrics.totalVolume.toString(),
        avgTradeLatency: metrics.avgTradeLatency,
        lastActivityAt: metrics.lastActivityAt
      } : null,
      pendingTrades: pendingTrades.map(t => ({
        id: t.id,
        from: t.from,
        to: t.to,
        amount: t.amount.toString(),
        timestamp: t.timestamp
      }))
    });
  }

  private sendChannelHistory(clientId: string, channelId: string): void {
    const history = this.stateManager.getStateHistory(channelId);
    
    this.wsService.sendToClient(clientId, 'channel:history', {
      channelId,
      history: history.map(state => ({
        nonce: state.nonce,
        stateRoot: state.stateRoot,
        timestamp: state.timestamp,
        balances: Object.fromEntries(state.balances)
      }))
    });
  }

  private sendPendingTrades(clientId: string, channelId: string): void {
    const pendingTrades = this.instantFinality.getPendingTradesForChannel(channelId);
    
    this.wsService.sendToClient(clientId, 'instant:trades:pending', {
      channelId,
      trades: pendingTrades.map(trade => ({
        id: trade.id,
        from: trade.from,
        to: trade.to,
        amount: trade.amount.toString(),
        timestamp: trade.timestamp,
        signatureCount: trade.finalityProof.signatures.size,
        requiredSignatures: this.instantFinality.getConfig().requiredSignatures
      }))
    });
  }

  private sendChannelMetrics(clientId: string): void {
    const allMetrics = this.settlementBridge.getAllChannelMetrics();
    
    this.wsService.sendToClient(clientId, 'channel:metrics:all', {
      channels: allMetrics.map(m => ({
        channelId: m.channelId,
        totalTrades: m.totalTrades,
        totalVolume: m.totalVolume.toString(),
        avgTradeLatency: m.avgTradeLatency,
        lastActivityAt: m.lastActivityAt
      }))
    });
  }

  private sendHFTMetrics(clientId: string): void {
    const hftMetrics = this.instantFinality.getMetrics();
    
    this.wsService.sendToClient(clientId, 'hft:metrics', {
      metrics: hftMetrics
    });
  }

  private startMetricsStreaming(): void {
    this.metricsTimer = setInterval(() => {
      this.broadcastHFTMetrics();
    }, this.config.metricsInterval);
  }

  private broadcastHFTMetrics(): void {
    const metrics = this.instantFinality.getMetrics();
    const channel = StateChannelType.CHANNEL_METRICS;
    
    this.wsService['io'].to(channel).emit('metrics:update', {
      channel,
      data: metrics,
      timestamp: Date.now()
    });
  }

  public stop(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }
  }

  // Public methods for external use
  public broadcastChannelEvent(channelId: string, event: string, data: any): void {
    const channel = `${StateChannelType.STATE_CHANNEL}:${channelId}`;
    
    this.wsService['io'].to(channel).emit('channel:event', {
      channel,
      event,
      data,
      timestamp: Date.now()
    });
  }

  public notifyUserChannelUpdate(userId: string, channelId: string, update: any): void {
    const clients = this.wsService['getClientsByUserId'](userId);
    
    for (const client of clients) {
      client.socket.emit('user:channel:update', {
        channelId,
        update,
        timestamp: Date.now()
      });
    }
  }
}