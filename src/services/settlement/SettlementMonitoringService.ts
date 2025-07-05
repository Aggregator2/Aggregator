import { EventEmitter } from 'events';
import { FinalSettlementEngine, SettlementEpoch, SettlementVerification } from './FinalSettlementEngine';
import { EnhancedSettlementVerification, VerificationResult, ReconciliationAction } from './EnhancedSettlementVerification';
import { ethers } from 'ethers';

export interface MonitoringConfig {
  verificationEnabled: boolean;
  autoReconciliation: boolean;
  alertThresholds: {
    criticalDiscrepancyCount: number;
    criticalDiscrepancyValue: string; // In USD or base units
    failureRate: number; // Percentage
    gasSpendLimit: string; // Wei
  };
  notifications: {
    email: boolean;
    slack: boolean;
    pagerDuty: boolean;
    webhooks: string[];
  };
  monitoring: {
    interval: number; // ms
    retentionDays: number;
    metricsEnabled: boolean;
  };
}

export interface SettlementMetrics {
  epochId: string;
  timestamp: number;
  totalTrades: number;
  totalVolume: string;
  settlementDuration: number;
  gasUsed: string;
  gasPrice: string;
  totalGasCost: string;
  verificationStatus: 'PASSED' | 'FAILED' | 'PARTIAL' | 'SKIPPED';
  discrepancyCount: number;
  discrepancyValue: string;
  reconciliationActions: number;
  successRate: number;
}

export interface AlertEvent {
  id: string;
  type: 'VERIFICATION_FAILED' | 'HIGH_DISCREPANCY' | 'GAS_LIMIT_EXCEEDED' | 
        'RECONCILIATION_REQUIRED' | 'SYSTEM_ERROR' | 'EPOCH_FAILED';
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  epochId?: string;
  title: string;
  message: string;
  data: any;
  timestamp: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
}

export interface HealthStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  lastCheck: number;
  epochsProcessed24h: number;
  successRate24h: number;
  averageGasCost24h: string;
  pendingReconciliations: number;
  activeAlerts: number;
  components: {
    settlementEngine: 'UP' | 'DOWN';
    verification: 'UP' | 'DOWN';
    blockchain: 'UP' | 'DOWN';
    notifications: 'UP' | 'DOWN';
  };
}

export class SettlementMonitoringService extends EventEmitter {
  private settlementEngine: FinalSettlementEngine;
  private verificationService: EnhancedSettlementVerification;
  private config: MonitoringConfig;
  
  private metrics: Map<string, SettlementMetrics> = new Map();
  private alerts: Map<string, AlertEvent> = new Map();
  private healthStatus: HealthStatus;
  private monitoringInterval?: NodeJS.Timer;
  private metricsInterval?: NodeJS.Timer;

  constructor(
    settlementEngine: FinalSettlementEngine,
    provider: ethers.Provider,
    config: MonitoringConfig
  ) {
    super();
    this.settlementEngine = settlementEngine;
    this.verificationService = new EnhancedSettlementVerification(provider);
    this.config = config;
    
    this.healthStatus = {
      status: 'HEALTHY',
      lastCheck: Date.now(),
      epochsProcessed24h: 0,
      successRate24h: 100,
      averageGasCost24h: '0',
      pendingReconciliations: 0,
      activeAlerts: 0,
      components: {
        settlementEngine: 'UP',
        verification: 'UP',
        blockchain: 'UP',
        notifications: 'UP'
      }
    };

    this.setupEventListeners();
    this.startMonitoring();
  }

  private setupEventListeners(): void {
    // Settlement engine events
    this.settlementEngine.on('epochStarted', this.handleEpochStarted.bind(this));
    this.settlementEngine.on('epochFinalized', this.handleEpochFinalized.bind(this));
    this.settlementEngine.on('epochFailed', this.handleEpochFailed.bind(this));
    this.settlementEngine.on('verificationFailed', this.handleVerificationFailed.bind(this));
    this.settlementEngine.on('bundleExecuted', this.handleBundleExecuted.bind(this));
    this.settlementEngine.on('emergencyPause', this.handleEmergencyPause.bind(this));

    // Verification service events
    this.verificationService.on('verification:completed', this.handleVerificationCompleted.bind(this));
    this.verificationService.on('verification:failed', this.handleVerificationAlert.bind(this));
    this.verificationService.on('reconciliation:actions-created', this.handleReconciliationCreated.bind(this));
    this.verificationService.on('account:freeze-requested', this.handleAccountFreeze.bind(this));
    this.verificationService.on('investigation:required', this.handleInvestigationRequired.bind(this));
  }

  private startMonitoring(): void {
    // Main monitoring loop
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck();
      this.checkPendingReconciliations();
      this.cleanupOldData();
    }, this.config.monitoring.interval);

    // Metrics collection
    if (this.config.monitoring.metricsEnabled) {
      this.metricsInterval = setInterval(() => {
        this.collectMetrics();
      }, 60000); // Every minute
    }

    this.emit('monitoring:started');
  }

  /**
   * Monitor settlement epoch and trigger verification
   */
  private async handleEpochFinalized(epoch: SettlementEpoch): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Skip verification if disabled
      if (!this.config.verificationEnabled) {
        this.createMetric(epoch, 'SKIPPED', startTime);
        return;
      }

      // Extract expected changes from epoch
      const expectedChanges = epoch.settlementBatch?.netPositions;
      if (!expectedChanges) {
        throw new Error('No settlement batch found in epoch');
      }

      // Get unique users and tokens
      const users = new Set<string>();
      const tokens = new Set<string>();
      
      for (const [userId, positions] of expectedChanges) {
        users.add(userId);
        for (const token of positions.keys()) {
          tokens.add(token);
        }
      }

      // Take pre-settlement snapshots (should have been done before settlement)
      await this.verificationService.takePreSettlementSnapshot(
        Array.from(users),
        Array.from(tokens),
        epoch.id
      );

      // Take post-settlement snapshots
      await this.verificationService.takePostSettlementSnapshot(
        Array.from(users),
        Array.from(tokens),
        epoch.id,
        epoch.transactionBundles?.[0]?.transactionHash ? 
          await this.getTransactionBlock(epoch.transactionBundles[0].transactionHash) : 
          undefined
      );

      // Verify settlement
      const verificationResult = await this.verificationService.verifySettlement(
        epoch.id,
        expectedChanges,
        epoch.transactionBundles?.[0]?.transactionHash
      );

      // Create metric
      this.createMetric(epoch, verificationResult.status, startTime, verificationResult);

      // Handle verification results
      if (verificationResult.status === 'FAILED') {
        await this.handleFailedVerification(epoch, verificationResult);
      } else if (verificationResult.status === 'PARTIAL') {
        await this.handlePartialVerification(epoch, verificationResult);
      }

    } catch (error) {
      this.createAlert({
        type: 'SYSTEM_ERROR',
        severity: 'ERROR',
        epochId: epoch.id,
        title: 'Verification Error',
        message: `Failed to verify epoch ${epoch.id}`,
        data: { error: error instanceof Error ? error.message : 'Unknown error' }
      });

      this.createMetric(epoch, 'FAILED', startTime);
    }
  }

  /**
   * Handle failed verification
   */
  private async handleFailedVerification(
    epoch: SettlementEpoch,
    verificationResult: VerificationResult
  ): Promise<void> {
    // Create critical alert
    this.createAlert({
      type: 'VERIFICATION_FAILED',
      severity: 'CRITICAL',
      epochId: epoch.id,
      title: 'Settlement Verification Failed',
      message: `Epoch ${epoch.id} verification failed with ${verificationResult.discrepancies.length} discrepancies`,
      data: {
        discrepancyCount: verificationResult.discrepancies.length,
        totalValue: this.calculateTotalDiscrepancyValue(verificationResult.discrepancies),
        affectedUsers: new Set(verificationResult.discrepancies.map(d => d.userId)).size
      }
    });

    // Trigger reconciliation if enabled
    if (this.config.autoReconciliation) {
      const actions = await this.verificationService.createReconciliationActions(verificationResult);
      
      this.emit('reconciliation:required', {
        epochId: epoch.id,
        verificationId: verificationResult.verificationId,
        actionCount: actions.length
      });
    }

    // Notify administrators
    await this.notifyAdministrators({
      type: 'VERIFICATION_FAILED',
      epoch,
      verificationResult
    });
  }

  /**
   * Handle partial verification (some discrepancies)
   */
  private async handlePartialVerification(
    epoch: SettlementEpoch,
    verificationResult: VerificationResult
  ): Promise<void> {
    const totalValue = this.calculateTotalDiscrepancyValue(verificationResult.discrepancies);
    
    // Check if discrepancies exceed thresholds
    if (verificationResult.discrepancies.length >= this.config.alertThresholds.criticalDiscrepancyCount ||
        parseFloat(totalValue) >= parseFloat(this.config.alertThresholds.criticalDiscrepancyValue)) {
      
      this.createAlert({
        type: 'HIGH_DISCREPANCY',
        severity: 'WARNING',
        epochId: epoch.id,
        title: 'High Settlement Discrepancies',
        message: `Epoch ${epoch.id} has significant discrepancies`,
        data: {
          discrepancyCount: verificationResult.discrepancies.length,
          totalValue,
          threshold: this.config.alertThresholds.criticalDiscrepancyValue
        }
      });

      // Notify administrators
      await this.notifyAdministrators({
        type: 'HIGH_DISCREPANCY',
        epoch,
        verificationResult
      });
    }

    // Create reconciliation actions for discrepancies
    if (this.config.autoReconciliation) {
      await this.verificationService.createReconciliationActions(verificationResult);
    }
  }

  /**
   * Notify administrators based on configuration
   */
  private async notifyAdministrators(notification: any): Promise<void> {
    const { type, epoch, verificationResult, alert } = notification;

    // Email notification
    if (this.config.notifications.email) {
      this.emit('notification:email', {
        subject: `Settlement Alert: ${type}`,
        body: this.formatNotificationBody(notification),
        priority: type === 'VERIFICATION_FAILED' ? 'high' : 'normal'
      });
    }

    // Slack notification
    if (this.config.notifications.slack) {
      this.emit('notification:slack', {
        channel: '#settlements',
        text: `🚨 Settlement Alert: ${type}`,
        attachments: [{
          color: type === 'VERIFICATION_FAILED' ? 'danger' : 'warning',
          fields: this.formatSlackFields(notification)
        }]
      });
    }

    // PagerDuty for critical alerts
    if (this.config.notifications.pagerDuty && 
        (type === 'VERIFICATION_FAILED' || type === 'EPOCH_FAILED')) {
      this.emit('notification:pagerduty', {
        incident_key: `settlement_${epoch?.id || 'unknown'}`,
        event_type: 'trigger',
        description: `Settlement ${type}`,
        details: notification
      });
    }

    // Webhook notifications
    for (const webhook of this.config.notifications.webhooks) {
      this.emit('notification:webhook', {
        url: webhook,
        payload: {
          type: 'SETTLEMENT_ALERT',
          timestamp: Date.now(),
          data: notification
        }
      });
    }
  }

  /**
   * Create and store metrics
   */
  private createMetric(
    epoch: SettlementEpoch,
    verificationStatus: 'PASSED' | 'FAILED' | 'PARTIAL' | 'SKIPPED',
    startTime: number,
    verificationResult?: VerificationResult
  ): void {
    const gasUsed = epoch.transactionBundles?.reduce(
      (sum, bundle) => sum + (bundle.totalGasEstimate || BigInt(0)),
      BigInt(0)
    ) || BigInt(0);

    const metric: SettlementMetrics = {
      epochId: epoch.id,
      timestamp: Date.now(),
      totalTrades: epoch.trades.length,
      totalVolume: this.calculateEpochVolume(epoch),
      settlementDuration: (epoch.finalizedAt || Date.now()) - epoch.startTime,
      gasUsed: gasUsed.toString(),
      gasPrice: '0', // Would get from bundles
      totalGasCost: '0', // Would calculate
      verificationStatus,
      discrepancyCount: verificationResult?.discrepancies.length || 0,
      discrepancyValue: verificationResult ? 
        this.calculateTotalDiscrepancyValue(verificationResult.discrepancies) : '0',
      reconciliationActions: 0,
      successRate: verificationStatus === 'PASSED' ? 100 : 
                   verificationStatus === 'PARTIAL' ? 90 : 0
    };

    this.metrics.set(epoch.id, metric);
    
    this.emit('metric:created', metric);
  }

  /**
   * Create and store alerts
   */
  private createAlert(params: Omit<AlertEvent, 'id' | 'timestamp' | 'acknowledged'>): void {
    const alert: AlertEvent = {
      ...params,
      id: `ALERT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      acknowledged: false
    };

    this.alerts.set(alert.id, alert);
    this.emit('alert:created', alert);

    // Update health status
    this.healthStatus.activeAlerts = this.getActiveAlerts().length;
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(): Promise<void> {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Calculate 24h metrics
    const metrics24h = Array.from(this.metrics.values())
      .filter(m => m.timestamp > dayAgo);

    this.healthStatus.epochsProcessed24h = metrics24h.length;
    this.healthStatus.successRate24h = metrics24h.length > 0
      ? metrics24h.filter(m => m.verificationStatus === 'PASSED').length / metrics24h.length * 100
      : 100;

    const totalGas = metrics24h.reduce((sum, m) => sum + BigInt(m.totalGasCost || 0), BigInt(0));
    this.healthStatus.averageGasCost24h = metrics24h.length > 0
      ? (totalGas / BigInt(metrics24h.length)).toString()
      : '0';

    this.healthStatus.pendingReconciliations = 
      this.verificationService.getPendingReconciliations().length;

    // Check component health
    try {
      // Check settlement engine
      const currentEpoch = this.settlementEngine.getCurrentEpoch();
      this.healthStatus.components.settlementEngine = currentEpoch ? 'UP' : 'DOWN';

      // Check blockchain connection
      const blockNumber = await this.verificationService['provider'].getBlockNumber();
      this.healthStatus.components.blockchain = blockNumber > 0 ? 'UP' : 'DOWN';

      // Determine overall health
      const failureRate = 100 - this.healthStatus.successRate24h;
      if (failureRate > this.config.alertThresholds.failureRate ||
          this.healthStatus.activeAlerts > 5 ||
          Object.values(this.healthStatus.components).includes('DOWN')) {
        this.healthStatus.status = 'UNHEALTHY';
      } else if (failureRate > this.config.alertThresholds.failureRate / 2 ||
                 this.healthStatus.activeAlerts > 2) {
        this.healthStatus.status = 'DEGRADED';
      } else {
        this.healthStatus.status = 'HEALTHY';
      }

    } catch (error) {
      this.healthStatus.status = 'UNHEALTHY';
      this.healthStatus.components.blockchain = 'DOWN';
    }

    this.healthStatus.lastCheck = now;
    this.emit('health:updated', this.healthStatus);
  }

  /**
   * Check and alert on pending reconciliations
   */
  private checkPendingReconciliations(): void {
    const pending = this.verificationService.getPendingReconciliations();
    
    if (pending.length > 10) {
      this.createAlert({
        type: 'RECONCILIATION_REQUIRED',
        severity: 'WARNING',
        title: 'High Pending Reconciliations',
        message: `${pending.length} reconciliation actions pending approval`,
        data: {
          count: pending.length,
          oldestAge: pending.length > 0 
            ? Date.now() - Math.min(...pending.map(p => p.createdAt))
            : 0
        }
      });
    }
  }

  /**
   * Clean up old data based on retention policy
   */
  private cleanupOldData(): void {
    const cutoff = Date.now() - this.config.monitoring.retentionDays * 24 * 60 * 60 * 1000;

    // Clean metrics
    for (const [epochId, metric] of this.metrics) {
      if (metric.timestamp < cutoff) {
        this.metrics.delete(epochId);
      }
    }

    // Clean acknowledged alerts
    for (const [alertId, alert] of this.alerts) {
      if (alert.acknowledged && alert.timestamp < cutoff) {
        this.alerts.delete(alertId);
      }
    }
  }

  // Event handlers
  private handleEpochStarted(epoch: SettlementEpoch): void {
    this.emit('monitor:epoch-started', { epochId: epoch.id });
  }

  private handleEpochFailed(data: any): void {
    this.createAlert({
      type: 'EPOCH_FAILED',
      severity: 'CRITICAL',
      epochId: data.epochId,
      title: 'Settlement Epoch Failed',
      message: `Epoch ${data.epochId} failed to process`,
      data
    });
  }

  private handleVerificationFailed(data: any): void {
    // Already handled in handleEpochFinalized
  }

  private handleVerificationCompleted(result: VerificationResult): void {
    this.emit('monitor:verification-completed', {
      epochId: result.epochId,
      status: result.status,
      discrepancies: result.discrepancies.length
    });
  }

  private handleVerificationAlert(data: any): void {
    // Additional verification alerts
  }

  private handleBundleExecuted(data: any): void {
    this.emit('monitor:bundle-executed', data);
  }

  private handleEmergencyPause(data: any): void {
    this.createAlert({
      type: 'SYSTEM_ERROR',
      severity: 'CRITICAL',
      title: 'Emergency Pause Activated',
      message: 'Settlement system has been paused',
      data
    });
  }

  private handleReconciliationCreated(data: any): void {
    this.emit('monitor:reconciliation-created', data);
  }

  private handleAccountFreeze(data: any): void {
    this.createAlert({
      type: 'RECONCILIATION_REQUIRED',
      severity: 'CRITICAL',
      title: 'Account Freeze Requested',
      message: `Account ${data.userId} requires freezing`,
      data
    });
  }

  private handleInvestigationRequired(data: any): void {
    this.createAlert({
      type: 'RECONCILIATION_REQUIRED',
      severity: 'WARNING',
      title: 'Investigation Required',
      message: `Transaction requires investigation for ${data.userId}`,
      data
    });
  }

  // Helper methods
  private calculateEpochVolume(epoch: SettlementEpoch): string {
    // Calculate total volume from trades
    const volume = epoch.trades.reduce((sum, trade) => {
      return sum + (parseFloat(trade.price) * parseFloat(trade.quantity));
    }, 0);
    return volume.toString();
  }

  private calculateTotalDiscrepancyValue(discrepancies: any[]): string {
    // Sum absolute values of discrepancies
    const total = discrepancies.reduce((sum, d) => {
      const value = d.discrepancy < 0 ? -d.discrepancy : d.discrepancy;
      return sum + value;
    }, BigInt(0));
    return total.toString();
  }

  private async getTransactionBlock(txHash: string): Promise<number | undefined> {
    try {
      const receipt = await this.verificationService['provider'].getTransactionReceipt(txHash);
      return receipt?.blockNumber;
    } catch {
      return undefined;
    }
  }

  private formatNotificationBody(notification: any): string {
    return JSON.stringify(notification, null, 2);
  }

  private formatSlackFields(notification: any): any[] {
    const fields = [
      {
        title: 'Type',
        value: notification.type,
        short: true
      }
    ];

    if (notification.epoch) {
      fields.push({
        title: 'Epoch ID',
        value: notification.epoch.id,
        short: true
      });
    }

    if (notification.verificationResult) {
      fields.push({
        title: 'Discrepancies',
        value: notification.verificationResult.discrepancies.length,
        short: true
      });
    }

    return fields;
  }

  private collectMetrics(): void {
    // Collect system metrics
    const systemMetrics = {
      timestamp: Date.now(),
      health: this.healthStatus,
      activeAlerts: this.getActiveAlerts().length,
      pendingReconciliations: this.healthStatus.pendingReconciliations,
      metricsCount: this.metrics.size
    };

    this.emit('metrics:collected', systemMetrics);
  }

  // Public API
  public getHealthStatus(): HealthStatus {
    return this.healthStatus;
  }

  public getMetrics(epochId?: string): SettlementMetrics[] {
    if (epochId) {
      const metric = this.metrics.get(epochId);
      return metric ? [metric] : [];
    }
    return Array.from(this.metrics.values());
  }

  public getActiveAlerts(): AlertEvent[] {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.acknowledged);
  }

  public acknowledgeAlert(alertId: string, acknowledgedBy: string): void {
    const alert = this.alerts.get(alertId);
    if (alert && !alert.acknowledged) {
      alert.acknowledged = true;
      alert.acknowledgedBy = acknowledgedBy;
      alert.acknowledgedAt = Date.now();
      
      this.emit('alert:acknowledged', {
        alertId,
        acknowledgedBy
      });
    }
  }

  public async triggerManualVerification(epochId: string): Promise<VerificationResult | null> {
    const epoch = this.settlementEngine.getEpoch(epochId);
    if (!epoch || !epoch.settlementBatch) {
      return null;
    }

    const verificationResult = await this.verificationService.verifySettlement(
      epochId,
      epoch.settlementBatch.netPositions
    );

    return verificationResult;
  }

  public updateConfig(newConfig: Partial<MonitoringConfig>): void {
    Object.assign(this.config, newConfig);
    this.emit('config:updated', this.config);
  }

  public stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    this.emit('monitoring:stopped');
  }
}