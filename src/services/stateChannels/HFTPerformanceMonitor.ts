import { EventEmitter } from 'events';
import { HFTOptimizedInstantFinality, HFTMetrics } from '../../stateChannels/HFTOptimizedInstantFinality';
import { StateChannelSettlementBridge } from './StateChannelSettlementBridge';
import { StateChannelDatabase, getStateChannelDatabase } from '../../database/stateChannelDb';
import { InstantTrade } from '../../stateChannels/InstantFinality';

export interface PerformanceMetrics {
  channelId: string;
  timestamp: number;
  trades: {
    total: number;
    successful: number;
    failed: number;
    reverted: number;
  };
  latency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  throughput: {
    tradesPerSecond: number;
    volumePerSecond: string;
    peakTps: number;
  };
  signatures: {
    avgVerificationTime: number;
    cacheHitRate: number;
  };
  network: {
    messagesPerSecond: number;
    avgMessageSize: number;
    bandwidthUsage: number;
  };
}

export interface AlertThresholds {
  maxLatencyMs: number;
  minThroughputTps: number;
  maxFailureRate: number;
  maxQueueSize: number;
}

export class HFTPerformanceMonitor extends EventEmitter {
  private instantFinality: HFTOptimizedInstantFinality;
  private settlementBridge: StateChannelSettlementBridge;
  private db: StateChannelDatabase | null = null;
  
  private metricsHistory: Map<string, PerformanceMetrics[]> = new Map();
  private tradeLatencies: Map<string, number[]> = new Map();
  private tradeVolumes: Map<string, bigint[]> = new Map();
  private alertThresholds: AlertThresholds;
  
  private monitoringInterval?: NodeJS.Timer;
  private metricsInterval: number = 5000; // 5 seconds
  private retentionPeriod: number = 3600000; // 1 hour
  
  constructor(
    instantFinality: HFTOptimizedInstantFinality,
    settlementBridge: StateChannelSettlementBridge,
    alertThresholds: AlertThresholds
  ) {
    super();
    this.instantFinality = instantFinality;
    this.settlementBridge = settlementBridge;
    this.alertThresholds = alertThresholds;
    
    this.setupEventListeners();
  }

  async initialize(): Promise<void> {
    const database = await getStateChannelDatabase();
    this.db = new StateChannelDatabase(database);
  }

  private setupEventListeners(): void {
    // Monitor instant trades
    this.instantFinality.on('instantTradeInitiated', (trade: InstantTrade) => {
      this.recordTradeStart(trade);
    });

    this.instantFinality.on('hftTradeExecuted', (trade: InstantTrade) => {
      this.recordTradeCompletion(trade, 'success');
    });

    this.instantFinality.on('tradeProcessingError', (trade: InstantTrade, error: Error) => {
      this.recordTradeCompletion(trade, 'failed', error);
    });

    this.instantFinality.on('optimisticTradeReverted', (trade: InstantTrade) => {
      this.recordTradeCompletion(trade, 'reverted');
    });

    // Monitor settlement events
    this.settlementBridge.on('settlementInitiated', (channelId: string) => {
      this.recordSettlementEvent(channelId, 'initiated');
    });

    this.settlementBridge.on('settlementError', (channelId: string, error: Error) => {
      this.recordSettlementEvent(channelId, 'error', error);
    });
  }

  startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.collectAndAnalyzeMetrics();
    }, this.metricsInterval);
    
    this.emit('monitoring:started');
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    this.emit('monitoring:stopped');
  }

  private recordTradeStart(trade: InstantTrade): void {
    const channelId = trade.channelId;
    
    if (!this.tradeLatencies.has(channelId)) {
      this.tradeLatencies.set(channelId, []);
    }
    
    // Store trade start time
    (trade as any)._startTime = Date.now();
  }

  private recordTradeCompletion(
    trade: InstantTrade, 
    status: 'success' | 'failed' | 'reverted',
    error?: Error
  ): void {
    const channelId = trade.channelId;
    const startTime = (trade as any)._startTime || trade.timestamp;
    const latency = Date.now() - startTime;
    
    // Record latency
    const latencies = this.tradeLatencies.get(channelId) || [];
    latencies.push(latency);
    this.tradeLatencies.set(channelId, latencies);
    
    // Record volume if successful
    if (status === 'success') {
      const volumes = this.tradeVolumes.get(channelId) || [];
      volumes.push(BigInt(trade.amount.toString()));
      this.tradeVolumes.set(channelId, volumes);
    }
    
    // Check for alerts
    this.checkLatencyAlert(channelId, latency);
    
    // Emit trade completion event
    this.emit('trade:completed', {
      channelId,
      tradeId: trade.id,
      status,
      latency,
      error: error?.message
    });
  }

  private recordSettlementEvent(
    channelId: string, 
    event: string, 
    error?: Error
  ): void {
    this.emit('settlement:event', {
      channelId,
      event,
      timestamp: Date.now(),
      error: error?.message
    });
  }

  private async collectAndAnalyzeMetrics(): Promise<void> {
    const channels = this.settlementBridge.getAllChannelMetrics();
    
    for (const channelMetrics of channels) {
      const channelId = channelMetrics.channelId;
      const metrics = await this.calculateChannelMetrics(channelId);
      
      // Store metrics
      this.storeMetrics(channelId, metrics);
      
      // Check alerts
      this.checkAlerts(channelId, metrics);
      
      // Persist to database
      if (this.db) {
        await this.persistMetrics(channelId, metrics);
      }
      
      // Emit metrics update
      this.emit('metrics:updated', { channelId, metrics });
    }
    
    // Clean up old data
    this.cleanupOldData();
  }

  private async calculateChannelMetrics(channelId: string): Promise<PerformanceMetrics> {
    const latencies = this.tradeLatencies.get(channelId) || [];
    const volumes = this.tradeVolumes.get(channelId) || [];
    const hftMetrics = this.instantFinality.getMetrics();
    
    // Calculate latency statistics
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const latencyStats = {
      min: Math.min(...latencies) || 0,
      max: Math.max(...latencies) || 0,
      avg: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
      p50: this.percentile(sortedLatencies, 0.5),
      p95: this.percentile(sortedLatencies, 0.95),
      p99: this.percentile(sortedLatencies, 0.99)
    };
    
    // Calculate throughput
    const timeWindowMs = this.metricsInterval;
    const tradesInWindow = latencies.length;
    const volumeInWindow = volumes.reduce((a, b) => a + b, 0n);
    
    const throughput = {
      tradesPerSecond: (tradesInWindow / timeWindowMs) * 1000,
      volumePerSecond: ((volumeInWindow * 1000n) / BigInt(timeWindowMs)).toString(),
      peakTps: hftMetrics.throughput
    };
    
    // Trade statistics
    const trades = {
      total: tradesInWindow,
      successful: volumes.length,
      failed: 0, // Would need to track separately
      reverted: 0 // Would need to track separately
    };
    
    // Signature metrics
    const signatures = {
      avgVerificationTime: hftMetrics.signatureVerificationTime,
      cacheHitRate: 0.85 // Would need to track cache hits
    };
    
    // Network metrics (placeholder)
    const network = {
      messagesPerSecond: tradesInWindow * 2, // Rough estimate
      avgMessageSize: 512, // bytes
      bandwidthUsage: tradesInWindow * 2 * 512 // bytes/second
    };
    
    return {
      channelId,
      timestamp: Date.now(),
      trades,
      latency: latencyStats,
      throughput,
      signatures,
      network
    };
  }

  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }

  private storeMetrics(channelId: string, metrics: PerformanceMetrics): void {
    if (!this.metricsHistory.has(channelId)) {
      this.metricsHistory.set(channelId, []);
    }
    
    const history = this.metricsHistory.get(channelId)!;
    history.push(metrics);
    
    // Keep only recent metrics
    const cutoffTime = Date.now() - this.retentionPeriod;
    const recentMetrics = history.filter(m => m.timestamp > cutoffTime);
    this.metricsHistory.set(channelId, recentMetrics);
  }

  private checkAlerts(channelId: string, metrics: PerformanceMetrics): void {
    // Check latency alert
    if (metrics.latency.p99 > this.alertThresholds.maxLatencyMs) {
      this.emit('alert:high_latency', {
        channelId,
        latency: metrics.latency.p99,
        threshold: this.alertThresholds.maxLatencyMs
      });
    }
    
    // Check throughput alert
    if (metrics.throughput.tradesPerSecond < this.alertThresholds.minThroughputTps) {
      this.emit('alert:low_throughput', {
        channelId,
        throughput: metrics.throughput.tradesPerSecond,
        threshold: this.alertThresholds.minThroughputTps
      });
    }
    
    // Check failure rate
    const failureRate = (metrics.trades.failed + metrics.trades.reverted) / 
                       (metrics.trades.total || 1);
    if (failureRate > this.alertThresholds.maxFailureRate) {
      this.emit('alert:high_failure_rate', {
        channelId,
        failureRate,
        threshold: this.alertThresholds.maxFailureRate
      });
    }
  }

  private checkLatencyAlert(channelId: string, latency: number): void {
    if (latency > this.alertThresholds.maxLatencyMs) {
      this.emit('alert:trade_latency', {
        channelId,
        latency,
        threshold: this.alertThresholds.maxLatencyMs,
        timestamp: Date.now()
      });
    }
  }

  private async persistMetrics(channelId: string, metrics: PerformanceMetrics): Promise<void> {
    if (!this.db) return;
    
    try {
      await this.db.recordHFTMetrics({
        channelId,
        totalTrades: metrics.trades.total,
        avgLatency: metrics.latency.avg,
        p99Latency: metrics.latency.p99,
        throughput: metrics.throughput.tradesPerSecond,
        volumeTraded: metrics.throughput.volumePerSecond,
        periodStart: new Date(metrics.timestamp - this.metricsInterval).toISOString(),
        periodEnd: new Date(metrics.timestamp).toISOString()
      });
    } catch (error) {
      console.error('Failed to persist metrics:', error);
    }
  }

  private cleanupOldData(): void {
    const cutoffTime = Date.now() - this.retentionPeriod;
    
    // Clean up latency data
    for (const [channelId, latencies] of this.tradeLatencies) {
      // Keep only recent latencies (simplified - would need timestamps)
      if (latencies.length > 10000) {
        this.tradeLatencies.set(channelId, latencies.slice(-5000));
      }
    }
    
    // Clean up volume data
    for (const [channelId, volumes] of this.tradeVolumes) {
      if (volumes.length > 10000) {
        this.tradeVolumes.set(channelId, volumes.slice(-5000));
      }
    }
  }

  // Public methods
  getChannelMetrics(channelId: string): PerformanceMetrics | undefined {
    const history = this.metricsHistory.get(channelId);
    return history?.[history.length - 1];
  }

  getMetricsHistory(channelId: string, duration?: number): PerformanceMetrics[] {
    const history = this.metricsHistory.get(channelId) || [];
    
    if (duration) {
      const cutoffTime = Date.now() - duration;
      return history.filter(m => m.timestamp > cutoffTime);
    }
    
    return history;
  }

  async getAggregateMetrics(): Promise<{
    totalChannels: number;
    totalTrades: number;
    avgLatency: number;
    totalThroughput: number;
  }> {
    let totalTrades = 0;
    let totalLatency = 0;
    let totalThroughput = 0;
    let channelCount = 0;
    
    for (const [_, history] of this.metricsHistory) {
      if (history.length > 0) {
        const latest = history[history.length - 1];
        totalTrades += latest.trades.total;
        totalLatency += latest.latency.avg;
        totalThroughput += latest.throughput.tradesPerSecond;
        channelCount++;
      }
    }
    
    return {
      totalChannels: channelCount,
      totalTrades,
      avgLatency: channelCount > 0 ? totalLatency / channelCount : 0,
      totalThroughput
    };
  }

  updateAlertThresholds(thresholds: Partial<AlertThresholds>): void {
    this.alertThresholds = { ...this.alertThresholds, ...thresholds };
    this.emit('thresholds:updated', this.alertThresholds);
  }
}