import * as promClient from 'prom-client';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { BusinessMetricsCollector } from './BusinessMetricsCollector';
import { TechnicalMetricsCollector } from './TechnicalMetricsCollector';
import { InfrastructureMetricsCollector } from './InfrastructureMetricsCollector';
import { EventEmitter } from 'events';

export interface DEXMetricsConfig {
  port: number;
  path: string;
  prefix: string;
  updateInterval: number;
  enableBusinessMetrics: boolean;
  enableTechnicalMetrics: boolean;
  enableInfrastructureMetrics: boolean;
  customLabels: Record<string, string>;
}

export class DEXMetricsExporter extends EventEmitter {
  private config: DEXMetricsConfig;
  private register: promClient.Registry;
  private businessCollector: BusinessMetricsCollector;
  private technicalCollector: TechnicalMetricsCollector;
  private infrastructureCollector: InfrastructureMetricsCollector;
  
  // Custom DEX-specific metrics
  private liquidityPoolMetrics: promClient.Gauge;
  private slippageMetrics: promClient.Histogram;
  private mevProtectionMetrics: promClient.Counter;
  private gasOptimizationMetrics: promClient.Gauge;
  private crossChainMetrics: promClient.Gauge;
  private yieldMetrics: promClient.Gauge;
  private governanceMetrics: promClient.Gauge;
  
  constructor(
    config: DEXMetricsConfig,
    db: Pool,
    redis: Redis
  ) {
    super();
    this.config = config;
    this.register = new promClient.Registry();
    
    // Set default labels
    this.register.setDefaultLabels({
      ...config.customLabels,
      dex: 'swappiq',
      environment: process.env.NODE_ENV || 'development',
    });
    
    // Initialize collectors
    this.businessCollector = new BusinessMetricsCollector(db, redis);
    this.technicalCollector = new TechnicalMetricsCollector(redis);
    this.infrastructureCollector = new InfrastructureMetricsCollector(redis, db);
    
    // Initialize custom DEX metrics
    this.initializeDEXMetrics();
    
    // Register all metrics
    this.registerAllMetrics();
  }

  private initializeDEXMetrics(): void {
    // Liquidity Pool Metrics
    this.liquidityPoolMetrics = new promClient.Gauge({
      name: `${this.config.prefix}_liquidity_pool_metrics`,
      help: 'Liquidity pool statistics',
      labelNames: ['pool', 'token_a', 'token_b', 'metric_type'],
      registers: [this.register],
    });

    // Slippage Metrics
    this.slippageMetrics = new promClient.Histogram({
      name: `${this.config.prefix}_slippage_percent`,
      help: 'Trade slippage percentage',
      labelNames: ['pair', 'trade_size_category'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.register],
    });

    // MEV Protection Metrics
    this.mevProtectionMetrics = new promClient.Counter({
      name: `${this.config.prefix}_mev_protection_events`,
      help: 'MEV protection events',
      labelNames: ['event_type', 'protection_method', 'success'],
      registers: [this.register],
    });

    // Gas Optimization Metrics
    this.gasOptimizationMetrics = new promClient.Gauge({
      name: `${this.config.prefix}_gas_optimization_savings`,
      help: 'Gas optimization savings',
      labelNames: ['optimization_type', 'chain'],
      registers: [this.register],
    });

    // Cross-chain Metrics
    this.crossChainMetrics = new promClient.Gauge({
      name: `${this.config.prefix}_cross_chain_metrics`,
      help: 'Cross-chain bridge and swap metrics',
      labelNames: ['source_chain', 'dest_chain', 'metric_type'],
      registers: [this.register],
    });

    // Yield/Rewards Metrics
    this.yieldMetrics = new promClient.Gauge({
      name: `${this.config.prefix}_yield_metrics`,
      help: 'Yield farming and rewards metrics',
      labelNames: ['pool', 'reward_token', 'metric_type'],
      registers: [this.register],
    });

    // Governance Metrics
    this.governanceMetrics = new promClient.Gauge({
      name: `${this.config.prefix}_governance_metrics`,
      help: 'DAO governance metrics',
      labelNames: ['proposal_status', 'metric_type'],
      registers: [this.register],
    });
  }

  private registerAllMetrics(): void {
    // Register default Node.js metrics
    promClient.collectDefaultMetrics({ register: this.register });
    
    // Register custom collectors based on config
    if (this.config.enableBusinessMetrics) {
      this.registerBusinessMetrics();
    }
    
    if (this.config.enableTechnicalMetrics) {
      this.registerTechnicalMetrics();
    }
    
    if (this.config.enableInfrastructureMetrics) {
      this.registerInfrastructureMetrics();
    }
  }

  private registerBusinessMetrics(): void {
    // Business metrics are already registered in BusinessMetricsCollector
    // We just need to add them to our registry
    const businessMetrics = [
      'dex_orders_per_minute',
      'dex_trading_volume_24h_usd',
      'dex_trading_fees_24h_usd',
      'dex_active_users',
      'dex_total_value_locked_usd',
      'dex_market_spread_percent',
      'dex_liquidity_depth_usd',
      'dex_user_retention_rate',
      'dex_revenue_per_user_usd',
      'dex_market_share_percent',
    ];
    
    // Get metrics from default registry and add to our registry
    businessMetrics.forEach(metricName => {
      const metric = promClient.register.getSingleMetric(metricName);
      if (metric) {
        this.register.registerMetric(metric);
      }
    });
  }

  private registerTechnicalMetrics(): void {
    // Technical metrics registration
    const technicalMetrics = [
      'dex_http_request_duration_seconds',
      'dex_http_requests_total',
      'dex_http_request_errors_total',
      'dex_websocket_message_latency_seconds',
      'dex_order_processing_duration_seconds',
      'dex_database_query_duration_seconds',
      'dex_cache_hit_rate',
      'dex_service_uptime_seconds',
      'dex_error_rate_percent',
      'dex_throughput_per_second',
    ];
    
    technicalMetrics.forEach(metricName => {
      const metric = promClient.register.getSingleMetric(metricName);
      if (metric) {
        this.register.registerMetric(metric);
      }
    });
  }

  private registerInfrastructureMetrics(): void {
    // Infrastructure metrics registration
    const infrastructureMetrics = [
      'dex_cpu_usage_percent',
      'dex_memory_usage_bytes',
      'dex_disk_usage_bytes',
      'dex_network_bytes',
      'dex_nodejs_event_loop_lag_ms',
      'dex_nodejs_gc_duration_ms',
      'dex_database_connections',
      'dex_redis_memory_bytes',
    ];
    
    infrastructureMetrics.forEach(metricName => {
      const metric = promClient.register.getSingleMetric(metricName);
      if (metric) {
        this.register.registerMetric(metric);
      }
    });
  }

  async start(): Promise<void> {
    console.log(`🚀 Starting DEX Metrics Exporter on port ${this.config.port}${this.config.path}`);
    
    // Start all collectors
    const promises: Promise<void>[] = [];
    
    if (this.config.enableBusinessMetrics) {
      promises.push(this.businessCollector.start(this.config.updateInterval));
    }
    
    if (this.config.enableTechnicalMetrics) {
      // Technical collector doesn't have a start method as it's event-driven
      console.log('✅ Technical metrics collector ready');
    }
    
    if (this.config.enableInfrastructureMetrics) {
      promises.push(this.infrastructureCollector.start(this.config.updateInterval));
    }
    
    await Promise.all(promises);
    
    // Setup metric update listeners
    this.setupMetricListeners();
    
    // Start HTTP server for metrics endpoint
    this.startMetricsServer();
    
    console.log('✅ DEX Metrics Exporter started successfully');
  }

  private setupMetricListeners(): void {
    // Listen for business metric updates
    this.businessCollector.on('metrics-updated', (metrics) => {
      this.updateDEXSpecificMetrics(metrics);
    });
    
    // Listen for errors
    this.businessCollector.on('error', (error) => {
      this.emit('error', { collector: 'business', error });
    });
    
    this.infrastructureCollector.on('error', (error) => {
      this.emit('error', { collector: 'infrastructure', error });
    });
  }

  private updateDEXSpecificMetrics(businessMetrics: any): void {
    // Update liquidity pool metrics
    if (businessMetrics.liquidity) {
      for (const [pair, value] of Object.entries(businessMetrics.liquidity.byPair)) {
        const [tokenA, tokenB] = pair.split('/');
        this.liquidityPoolMetrics.set(
          { pool: pair, token_a: tokenA, token_b: tokenB, metric_type: 'tvl' },
          value as number
        );
        
        // Utilization rate
        this.liquidityPoolMetrics.set(
          { pool: pair, token_a: tokenA, token_b: tokenB, metric_type: 'utilization' },
          businessMetrics.liquidity.utilizationRate * 100
        );
      }
    }
    
    // Update market metrics (including slippage estimation)
    if (businessMetrics.market) {
      for (const [pair, priceImpact] of Object.entries(businessMetrics.market.priceImpact)) {
        // Categorize by trade size
        const categories = ['small', 'medium', 'large'];
        const category = categories[Math.floor(Math.random() * categories.length)]; // Would be based on actual trade size
        
        this.slippageMetrics.observe(
          { pair, trade_size_category: category },
          priceImpact as number
        );
      }
    }
  }

  private startMetricsServer(): void {
    const express = require('express');
    const app = express();
    
    // Add middleware for technical metrics collection
    app.use(this.technicalCollector.expressMiddleware());
    
    // Metrics endpoint
    app.get(this.config.path, async (req: any, res: any) => {
      try {
        res.set('Content-Type', this.register.contentType);
        const metrics = await this.register.metrics();
        res.end(metrics);
      } catch (error) {
        res.status(500).end(error.toString());
      }
    });
    
    // Health check endpoint
    app.get('/health', (req: any, res: any) => {
      res.json({
        status: 'healthy',
        collectors: {
          business: this.config.enableBusinessMetrics,
          technical: this.config.enableTechnicalMetrics,
          infrastructure: this.config.enableInfrastructureMetrics,
        },
        uptime: process.uptime(),
      });
    });
    
    // Custom metrics endpoints for debugging
    app.get('/metrics/business', async (req: any, res: any) => {
      const metrics = this.businessCollector.getCurrentMetrics();
      res.json(metrics);
    });
    
    app.get('/metrics/technical', async (req: any, res: any) => {
      const metrics = await this.technicalCollector.calculateMetrics();
      res.json(metrics);
    });
    
    app.get('/metrics/infrastructure', async (req: any, res: any) => {
      const metrics = await this.infrastructureCollector['collectAllMetrics']();
      res.json(metrics);
    });
    
    app.listen(this.config.port, () => {
      console.log(`📊 Metrics available at http://localhost:${this.config.port}${this.config.path}`);
    });
  }

  // Public methods for recording DEX-specific events
  
  recordLiquidityEvent(pool: string, tokenA: string, tokenB: string, type: 'add' | 'remove', amount: number): void {
    this.liquidityPoolMetrics.set(
      { pool, token_a: tokenA, token_b: tokenB, metric_type: `${type}_liquidity` },
      amount
    );
  }

  recordMEVProtection(eventType: string, method: string, success: boolean): void {
    this.mevProtectionMetrics.inc({
      event_type: eventType,
      protection_method: method,
      success: success.toString(),
    });
  }

  recordGasOptimization(type: string, chain: string, savedGwei: number): void {
    this.gasOptimizationMetrics.set(
      { optimization_type: type, chain },
      savedGwei
    );
  }

  recordCrossChainActivity(sourceChain: string, destChain: string, type: string, value: number): void {
    this.crossChainMetrics.set(
      { source_chain: sourceChain, dest_chain: destChain, metric_type: type },
      value
    );
  }

  recordYieldMetrics(pool: string, rewardToken: string, apy: number, totalStaked: number): void {
    this.yieldMetrics.set(
      { pool, reward_token: rewardToken, metric_type: 'apy' },
      apy
    );
    
    this.yieldMetrics.set(
      { pool, reward_token: rewardToken, metric_type: 'total_staked' },
      totalStaked
    );
  }

  recordGovernanceActivity(proposalStatus: string, type: string, value: number): void {
    this.governanceMetrics.set(
      { proposal_status: proposalStatus, metric_type: type },
      value
    );
  }

  // Get all metrics as JSON (useful for debugging)
  async getMetricsJSON(): Promise<any> {
    const [business, technical, infrastructure] = await Promise.all([
      this.businessCollector.getCurrentMetrics(),
      this.technicalCollector.calculateMetrics(),
      Promise.resolve(null), // Infrastructure metrics are internal
    ]);
    
    return {
      timestamp: Date.now(),
      business,
      technical,
      infrastructure,
      prometheus: await this.register.getMetricsAsJSON(),
    };
  }

  stop(): void {
    this.businessCollector.stop();
    this.infrastructureCollector.stop();
    
    this.emit('stopped');
  }
}

// Default configuration
export const defaultDEXMetricsConfig: DEXMetricsConfig = {
  port: 9090,
  path: '/metrics',
  prefix: 'swappiq',
  updateInterval: 60000, // 1 minute
  enableBusinessMetrics: true,
  enableTechnicalMetrics: true,
  enableInfrastructureMetrics: true,
  customLabels: {
    service: 'dex-api',
    version: process.env.npm_package_version || '1.0.0',
  },
};