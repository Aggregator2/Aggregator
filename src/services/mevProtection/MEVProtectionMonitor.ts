import { EventEmitter } from 'events';
import { MEVProtectionService, MEVProtectionProvider, MEVProtectionMetrics, ProtectedTransaction } from './MEVProtectionService';
import { MEVProtectedSettlementEngine, MEVProtectionStats } from '../settlement/MEVProtectedSettlementEngine';
import express from 'express';

export interface MEVMonitoringConfig {
  updateInterval?: number; // milliseconds
  metricsRetentionPeriod?: number; // milliseconds
  alertThresholds?: {
    failureRateThreshold?: number; // percentage
    averageConfirmationTimeThreshold?: number; // milliseconds
    providerHealthCheckInterval?: number; // milliseconds
  };
}

export interface MEVProviderStatus {
  provider: MEVProtectionProvider;
  isHealthy: boolean;
  lastHealthCheck: number;
  successRate: number;
  averageResponseTime: number;
  totalTransactions: number;
  failureCount: number;
}

export interface MEVAlert {
  id: string;
  type: 'PROVIDER_DOWN' | 'HIGH_FAILURE_RATE' | 'SLOW_CONFIRMATION' | 'NO_HEALTHY_PROVIDERS';
  severity: 'WARNING' | 'CRITICAL';
  provider?: MEVProtectionProvider;
  message: string;
  timestamp: number;
  metadata?: any;
}

export interface MEVMetricsSnapshot {
  timestamp: number;
  totalBundles: number;
  protectedBundles: number;
  failedProtection: number;
  successRate: number;
  gassSaved: string;
  frontRunsAvoided: number;
  sandwichAttacksAvoided: number;
  averageConfirmationTime: number;
  providerStats: MEVProviderStatus[];
  activeAlerts: MEVAlert[];
}

export class MEVProtectionMonitor extends EventEmitter {
  private mevService: MEVProtectionService;
  private settlementEngine: MEVProtectedSettlementEngine;
  private config: MEVMonitoringConfig;
  private metricsHistory: MEVMetricsSnapshot[] = [];
  private alerts: Map<string, MEVAlert> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(
    mevService: MEVProtectionService,
    settlementEngine: MEVProtectedSettlementEngine,
    config: MEVMonitoringConfig = {}
  ) {
    super();
    this.mevService = mevService;
    this.settlementEngine = settlementEngine;
    this.config = {
      updateInterval: 60000, // 1 minute
      metricsRetentionPeriod: 86400000, // 24 hours
      alertThresholds: {
        failureRateThreshold: 20, // 20%
        averageConfirmationTimeThreshold: 300000, // 5 minutes
        providerHealthCheckInterval: 300000, // 5 minutes
        ...config.alertThresholds
      },
      ...config
    };

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen to MEV service events
    this.mevService.on('transactionSubmitted', (tx: ProtectedTransaction) => {
      this.emit('mev:transactionSubmitted', {
        txId: tx.id,
        provider: tx.provider,
        timestamp: Date.now()
      });
    });

    this.mevService.on('transactionConfirmed', (tx: ProtectedTransaction) => {
      this.emit('mev:transactionConfirmed', {
        txId: tx.id,
        provider: tx.provider,
        gasUsed: tx.gasUsed?.toString(),
        confirmationTime: tx.confirmedAt! - tx.submittedAt!,
        timestamp: Date.now()
      });
    });

    this.mevService.on('transactionFailed', (tx: ProtectedTransaction) => {
      this.emit('mev:transactionFailed', {
        txId: tx.id,
        provider: tx.provider,
        error: tx.error,
        timestamp: Date.now()
      });
    });

    // Listen to settlement engine events
    this.settlementEngine.on('mevProtection:submitted', (data) => {
      this.emit('settlement:mevSubmitted', data);
    });

    this.settlementEngine.on('mevProtection:confirmed', (data) => {
      this.emit('settlement:mevConfirmed', data);
    });

    this.settlementEngine.on('mevProtection:failed', (data) => {
      this.emit('settlement:mevFailed', data);
    });
  }

  // Start monitoring
  async start(): Promise<void> {
    // Initial metrics collection
    await this.collectMetrics();

    // Start periodic metrics collection
    this.monitoringInterval = setInterval(async () => {
      await this.collectMetrics();
      this.cleanupOldMetrics();
      await this.checkAlertConditions();
    }, this.config.updateInterval!);

    // Start health checks
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.alertThresholds!.providerHealthCheckInterval!);

    this.emit('monitor:started');
  }

  // Stop monitoring
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    this.emit('monitor:stopped');
  }

  // Collect current metrics
  private async collectMetrics(): Promise<MEVMetricsSnapshot> {
    const mevMetrics = this.mevService.getMetrics();
    const settlementStats = this.settlementEngine.getMEVProtectionStats();
    const providerHealth = await this.getProviderStatuses();

    const snapshot: MEVMetricsSnapshot = {
      timestamp: Date.now(),
      totalBundles: settlementStats.totalBundles,
      protectedBundles: settlementStats.protectedBundles,
      failedProtection: settlementStats.failedProtection,
      successRate: settlementStats.totalBundles > 0 
        ? (settlementStats.protectedBundles / settlementStats.totalBundles) * 100 
        : 100,
      gassSaved: settlementStats.gassSaved.toString(),
      frontRunsAvoided: settlementStats.frontRunsAvoided,
      sandwichAttacksAvoided: settlementStats.sandwichAttacksAvoided,
      averageConfirmationTime: settlementStats.averageConfirmationTime,
      providerStats: providerHealth,
      activeAlerts: Array.from(this.alerts.values())
    };

    this.metricsHistory.push(snapshot);
    this.emit('metrics:collected', snapshot);

    return snapshot;
  }

  // Get provider statuses
  private async getProviderStatuses(): Promise<MEVProviderStatus[]> {
    const providers = [
      MEVProtectionProvider.FLASHBOTS,
      MEVProtectionProvider.BLOXROUTE,
      MEVProtectionProvider.EDEN,
      MEVProtectionProvider.MISTX,
      MEVProtectionProvider.SECURE_RPC,
      MEVProtectionProvider.STANDARD
    ];

    const statuses: MEVProviderStatus[] = [];
    const metrics = this.mevService.getMetrics();

    for (const provider of providers) {
      const isHealthy = await this.mevService.checkProviderHealth(provider);
      const stats = metrics.providerStats.get(provider);

      statuses.push({
        provider,
        isHealthy,
        lastHealthCheck: Date.now(),
        successRate: stats && stats.attempts > 0 
          ? (stats.successes / stats.attempts) * 100 
          : 0,
        averageResponseTime: stats?.avgResponseTime || 0,
        totalTransactions: stats?.attempts || 0,
        failureCount: stats?.failures || 0
      });
    }

    return statuses;
  }

  // Perform health checks
  private async performHealthChecks(): Promise<void> {
    const health = await this.settlementEngine.checkMEVProtectionHealth();
    
    if (!health.healthy) {
      this.createAlert({
        id: 'no-healthy-providers',
        type: 'NO_HEALTHY_PROVIDERS',
        severity: 'CRITICAL',
        message: 'No healthy MEV protection providers available',
        timestamp: Date.now(),
        metadata: { providers: health.providers }
      });
    } else {
      this.resolveAlert('no-healthy-providers');
    }

    // Check individual providers
    for (const [provider, isHealthy] of Object.entries(health.providers)) {
      if (!isHealthy && provider !== MEVProtectionProvider.STANDARD) {
        this.createAlert({
          id: `provider-down-${provider}`,
          type: 'PROVIDER_DOWN',
          severity: 'WARNING',
          provider: provider as MEVProtectionProvider,
          message: `MEV provider ${provider} is not healthy`,
          timestamp: Date.now()
        });
      } else {
        this.resolveAlert(`provider-down-${provider}`);
      }
    }
  }

  // Check alert conditions
  private async checkAlertConditions(): Promise<void> {
    const latest = this.metricsHistory[this.metricsHistory.length - 1];
    if (!latest) return;

    // Check failure rate
    const failureRate = 100 - latest.successRate;
    if (failureRate > this.config.alertThresholds!.failureRateThreshold!) {
      this.createAlert({
        id: 'high-failure-rate',
        type: 'HIGH_FAILURE_RATE',
        severity: 'CRITICAL',
        message: `MEV protection failure rate is ${failureRate.toFixed(2)}%`,
        timestamp: Date.now(),
        metadata: { failureRate }
      });
    } else {
      this.resolveAlert('high-failure-rate');
    }

    // Check confirmation time
    if (latest.averageConfirmationTime > this.config.alertThresholds!.averageConfirmationTimeThreshold!) {
      this.createAlert({
        id: 'slow-confirmation',
        type: 'SLOW_CONFIRMATION',
        severity: 'WARNING',
        message: `Average confirmation time is ${(latest.averageConfirmationTime / 1000).toFixed(2)}s`,
        timestamp: Date.now(),
        metadata: { averageConfirmationTime: latest.averageConfirmationTime }
      });
    } else {
      this.resolveAlert('slow-confirmation');
    }
  }

  // Create or update alert
  private createAlert(alert: MEVAlert): void {
    const existing = this.alerts.get(alert.id);
    if (!existing) {
      this.alerts.set(alert.id, alert);
      this.emit('alert:created', alert);
    }
  }

  // Resolve alert
  private resolveAlert(alertId: string): void {
    if (this.alerts.has(alertId)) {
      const alert = this.alerts.get(alertId)!;
      this.alerts.delete(alertId);
      this.emit('alert:resolved', alert);
    }
  }

  // Clean up old metrics
  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - this.config.metricsRetentionPeriod!;
    this.metricsHistory = this.metricsHistory.filter(m => m.timestamp > cutoff);
  }

  // Get current metrics
  getCurrentMetrics(): MEVMetricsSnapshot | null {
    return this.metricsHistory[this.metricsHistory.length - 1] || null;
  }

  // Get metrics history
  getMetricsHistory(duration?: number): MEVMetricsSnapshot[] {
    if (!duration) return this.metricsHistory;
    
    const cutoff = Date.now() - duration;
    return this.metricsHistory.filter(m => m.timestamp > cutoff);
  }

  // Get active alerts
  getActiveAlerts(): MEVAlert[] {
    return Array.from(this.alerts.values());
  }

  // Get provider performance summary
  getProviderPerformance(): { [key: string]: any } {
    const latest = this.getCurrentMetrics();
    if (!latest) return {};

    const summary: { [key: string]: any } = {};
    
    for (const status of latest.providerStats) {
      summary[status.provider] = {
        health: status.isHealthy ? 'HEALTHY' : 'UNHEALTHY',
        successRate: `${status.successRate.toFixed(2)}%`,
        avgResponseTime: `${status.averageResponseTime.toFixed(0)}ms`,
        totalTransactions: status.totalTransactions,
        failures: status.failureCount
      };
    }

    return summary;
  }

  // Create monitoring API router
  createMonitoringRouter(): express.Router {
    const router = express.Router();

    // Current metrics endpoint
    router.get('/metrics', (req, res) => {
      const metrics = this.getCurrentMetrics();
      res.json(metrics || { error: 'No metrics available' });
    });

    // Metrics history endpoint
    router.get('/metrics/history', (req, res) => {
      const duration = req.query.duration ? parseInt(req.query.duration as string) : undefined;
      const history = this.getMetricsHistory(duration);
      res.json(history);
    });

    // Provider status endpoint
    router.get('/providers', async (req, res) => {
      const statuses = await this.getProviderStatuses();
      res.json(statuses);
    });

    // Alerts endpoint
    router.get('/alerts', (req, res) => {
      const alerts = this.getActiveAlerts();
      res.json(alerts);
    });

    // Provider performance endpoint
    router.get('/performance', (req, res) => {
      const performance = this.getProviderPerformance();
      res.json(performance);
    });

    // Health check endpoint
    router.get('/health', async (req, res) => {
      const health = await this.settlementEngine.checkMEVProtectionHealth();
      res.json(health);
    });

    return router;
  }
}