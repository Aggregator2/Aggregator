import * as promClient from 'prom-client';
import { EventEmitter } from 'events';
import express from 'express';
import { Server } from 'http';

// Define metric types
export interface TradingMetrics {
  // WebSocket metrics
  wsConnections: number;
  wsConnectionsTotal: number;
  wsMessagesIn: number;
  wsMessagesOut: number;
  wsMessageLatency: number[];
  wsErrors: Map<string, number>;
  
  // Order metrics
  ordersSubmitted: number;
  ordersExecuted: number;
  ordersCancelled: number;
  ordersRejected: number;
  orderLatency: number[];
  orderBookDepth: Map<string, { bids: number; asks: number }>;
  
  // Trade metrics
  tradesExecuted: number;
  tradeVolume: Map<string, number>;
  tradeValue: Map<string, number>;
  
  // System metrics
  cpuUsage: number;
  memoryUsage: number;
  eventLoopLag: number;
  gcCount: number;
  gcDuration: number;
}

export class PrometheusMetricsExporter extends EventEmitter {
  private register: promClient.Registry;
  private app: express.Application;
  private server?: Server;
  
  // Counters
  private wsConnectionsTotal: promClient.Counter;
  private wsMessagesInTotal: promClient.Counter;
  private wsMessagesOutTotal: promClient.Counter;
  private wsErrorsTotal: promClient.Counter;
  private ordersTotal: promClient.Counter;
  private tradesTotal: promClient.Counter;
  private slaViolationsTotal: promClient.Counter;
  
  // Gauges
  private wsConnectionsActive: promClient.Gauge;
  private orderBookDepthGauge: promClient.Gauge;
  private cpuUsageGauge: promClient.Gauge;
  private memoryUsageGauge: promClient.Gauge;
  private eventLoopLagGauge: promClient.Gauge;
  
  // Histograms
  private wsMessageLatencyHist: promClient.Histogram;
  private orderLatencyHist: promClient.Histogram;
  private tradeLatencyHist: promClient.Histogram;
  
  // Summaries
  private orderValueSummary: promClient.Summary;
  private tradeVolumeSummary: promClient.Summary;
  
  // Custom collectors
  private customCollectors: Map<string, () => void> = new Map();

  constructor(private port: number = 9090) {
    super();
    this.register = new promClient.Registry();
    this.app = express();
    
    // Set default labels
    this.register.setDefaultLabels({
      app: 'trading-system',
      environment: process.env.NODE_ENV || 'development',
    });
    
    // Initialize metrics
    this.initializeMetrics();
    
    // Setup HTTP endpoint
    this.setupHttpEndpoint();
    
    // Collect default metrics
    promClient.collectDefaultMetrics({ register: this.register });
  }

  private initializeMetrics(): void {
    // WebSocket Counters
    this.wsConnectionsTotal = new promClient.Counter({
      name: 'websocket_connections_total',
      help: 'Total number of WebSocket connections established',
      labelNames: ['status'],
      registers: [this.register],
    });
    
    this.wsMessagesInTotal = new promClient.Counter({
      name: 'websocket_messages_received_total',
      help: 'Total number of WebSocket messages received',
      labelNames: ['type'],
      registers: [this.register],
    });
    
    this.wsMessagesOutTotal = new promClient.Counter({
      name: 'websocket_messages_sent_total',
      help: 'Total number of WebSocket messages sent',
      labelNames: ['type'],
      registers: [this.register],
    });
    
    this.wsErrorsTotal = new promClient.Counter({
      name: 'websocket_errors_total',
      help: 'Total number of WebSocket errors',
      labelNames: ['type', 'code'],
      registers: [this.register],
    });
    
    // Order Counters
    this.ordersTotal = new promClient.Counter({
      name: 'orders_total',
      help: 'Total number of orders',
      labelNames: ['pair', 'side', 'type', 'status'],
      registers: [this.register],
    });
    
    this.tradesTotal = new promClient.Counter({
      name: 'trades_total',
      help: 'Total number of trades executed',
      labelNames: ['pair', 'side'],
      registers: [this.register],
    });
    
    this.slaViolationsTotal = new promClient.Counter({
      name: 'sla_violations_total',
      help: 'Total number of SLA violations',
      labelNames: ['type', 'severity'],
      registers: [this.register],
    });
    
    // Gauges
    this.wsConnectionsActive = new promClient.Gauge({
      name: 'websocket_connections_active',
      help: 'Current number of active WebSocket connections',
      registers: [this.register],
    });
    
    this.orderBookDepthGauge = new promClient.Gauge({
      name: 'order_book_depth',
      help: 'Current order book depth',
      labelNames: ['pair', 'side'],
      registers: [this.register],
    });
    
    this.cpuUsageGauge = new promClient.Gauge({
      name: 'process_cpu_usage_percent',
      help: 'Process CPU usage percentage',
      registers: [this.register],
    });
    
    this.memoryUsageGauge = new promClient.Gauge({
      name: 'process_memory_usage_bytes',
      help: 'Process memory usage in bytes',
      labelNames: ['type'],
      registers: [this.register],
    });
    
    this.eventLoopLagGauge = new promClient.Gauge({
      name: 'nodejs_event_loop_lag_seconds',
      help: 'Node.js event loop lag in seconds',
      registers: [this.register],
    });
    
    // Histograms
    this.wsMessageLatencyHist = new promClient.Histogram({
      name: 'websocket_message_latency_seconds',
      help: 'WebSocket message round-trip latency',
      labelNames: ['type'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.register],
    });
    
    this.orderLatencyHist = new promClient.Histogram({
      name: 'order_processing_latency_seconds',
      help: 'Order processing latency',
      labelNames: ['pair', 'type', 'status'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.register],
    });
    
    this.tradeLatencyHist = new promClient.Histogram({
      name: 'trade_execution_latency_seconds',
      help: 'Trade execution latency',
      labelNames: ['pair'],
      buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
      registers: [this.register],
    });
    
    // Summaries
    this.orderValueSummary = new promClient.Summary({
      name: 'order_value_usd',
      help: 'Order value in USD',
      labelNames: ['pair', 'side'],
      percentiles: [0.5, 0.9, 0.95, 0.99],
      maxAgeSeconds: 600,
      ageBuckets: 5,
      registers: [this.register],
    });
    
    this.tradeVolumeSummary = new promClient.Summary({
      name: 'trade_volume',
      help: 'Trade volume',
      labelNames: ['pair'],
      percentiles: [0.5, 0.9, 0.95, 0.99],
      maxAgeSeconds: 600,
      ageBuckets: 5,
      registers: [this.register],
    });
  }

  private setupHttpEndpoint(): void {
    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', this.register.contentType);
        const metrics = await this.register.metrics();
        res.end(metrics);
      } catch (error) {
        res.status(500).end(error);
      }
    });
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });
    
    // Custom metrics endpoint
    this.app.get('/metrics/custom', async (req, res) => {
      const customMetrics = await this.getCustomMetrics();
      res.json(customMetrics);
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`📊 Prometheus metrics available at http://localhost:${this.port}/metrics`);
        this.emit('started', { port: this.port });
        resolve();
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.emit('stopped');
    }
  }

  // WebSocket Metrics
  recordWebSocketConnection(status: 'success' | 'failed'): void {
    this.wsConnectionsTotal.inc({ status });
    if (status === 'success') {
      this.wsConnectionsActive.inc();
    }
  }

  recordWebSocketDisconnection(): void {
    this.wsConnectionsActive.dec();
  }

  recordWebSocketMessage(direction: 'in' | 'out', type: string): void {
    if (direction === 'in') {
      this.wsMessagesInTotal.inc({ type });
    } else {
      this.wsMessagesOutTotal.inc({ type });
    }
  }

  recordWebSocketError(type: string, code?: string): void {
    this.wsErrorsTotal.inc({ type, code: code || 'unknown' });
  }

  recordWebSocketLatency(type: string, latencyMs: number): void {
    this.wsMessageLatencyHist.observe({ type }, latencyMs / 1000);
  }

  // Order Metrics
  recordOrder(pair: string, side: string, type: string, status: string): void {
    this.ordersTotal.inc({ pair, side, type, status });
  }

  recordOrderLatency(pair: string, type: string, status: string, latencyMs: number): void {
    this.orderLatencyHist.observe({ pair, type, status }, latencyMs / 1000);
  }

  recordOrderValue(pair: string, side: string, valueUsd: number): void {
    this.orderValueSummary.observe({ pair, side }, valueUsd);
  }

  updateOrderBookDepth(pair: string, bids: number, asks: number): void {
    this.orderBookDepthGauge.set({ pair, side: 'bid' }, bids);
    this.orderBookDepthGauge.set({ pair, side: 'ask' }, asks);
  }

  // Trade Metrics
  recordTrade(pair: string, side: string, volume: number, latencyMs: number): void {
    this.tradesTotal.inc({ pair, side });
    this.tradeVolumeSummary.observe({ pair }, volume);
    this.tradeLatencyHist.observe({ pair }, latencyMs / 1000);
  }

  // System Metrics
  updateSystemMetrics(metrics: {
    cpuUsage: number;
    memoryUsage: NodeJS.MemoryUsage;
    eventLoopLag: number;
  }): void {
    this.cpuUsageGauge.set(metrics.cpuUsage);
    this.memoryUsageGauge.set({ type: 'heap_used' }, metrics.memoryUsage.heapUsed);
    this.memoryUsageGauge.set({ type: 'heap_total' }, metrics.memoryUsage.heapTotal);
    this.memoryUsageGauge.set({ type: 'rss' }, metrics.memoryUsage.rss);
    this.memoryUsageGauge.set({ type: 'external' }, metrics.memoryUsage.external);
    this.eventLoopLagGauge.set(metrics.eventLoopLag);
  }

  // SLA Metrics
  recordSLAViolation(type: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.slaViolationsTotal.inc({ type, severity });
    this.emit('sla-violation', { type, severity, timestamp: Date.now() });
  }

  // Custom Metrics
  registerCustomCollector(name: string, collector: () => void): void {
    this.customCollectors.set(name, collector);
  }

  private async getCustomMetrics(): Promise<any> {
    const metrics: any = {};
    
    for (const [name, collector] of this.customCollectors) {
      try {
        metrics[name] = await collector();
      } catch (error) {
        console.error(`Error collecting custom metric ${name}:`, error);
      }
    }
    
    return metrics;
  }

  // Batch update for efficiency
  batchUpdate(metrics: Partial<TradingMetrics>): void {
    if (metrics.wsConnections !== undefined) {
      this.wsConnectionsActive.set(metrics.wsConnections);
    }
    
    if (metrics.wsErrors) {
      for (const [type, count] of metrics.wsErrors) {
        this.wsErrorsTotal.inc({ type, code: 'batch' }, count);
      }
    }
    
    if (metrics.orderBookDepth) {
      for (const [pair, depth] of metrics.orderBookDepth) {
        this.updateOrderBookDepth(pair, depth.bids, depth.asks);
      }
    }
    
    if (metrics.cpuUsage !== undefined && metrics.memoryUsage !== undefined) {
      this.updateSystemMetrics({
        cpuUsage: metrics.cpuUsage,
        memoryUsage: process.memoryUsage(),
        eventLoopLag: metrics.eventLoopLag || 0,
      });
    }
  }

  // Get current metrics for reporting
  async getCurrentMetrics(): Promise<string> {
    return await this.register.metrics();
  }

  // Reset all metrics (useful for testing)
  reset(): void {
    this.register.resetMetrics();
  }
}

// Singleton instance
let instance: PrometheusMetricsExporter | null = null;

export function getMetricsExporter(port?: number): PrometheusMetricsExporter {
  if (!instance) {
    instance = new PrometheusMetricsExporter(port);
  }
  return instance;
}