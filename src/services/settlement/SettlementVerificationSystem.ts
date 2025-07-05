import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { FinalSettlementEngine, SettlementEpoch } from './FinalSettlementEngine';
import { EnhancedSettlementVerification, VerificationResult } from './EnhancedSettlementVerification';
import { SettlementMonitoringService, MonitoringConfig, SettlementMetrics, AlertEvent } from './SettlementMonitoringService';
import { ReconciliationService, ReconciliationConfig, ReconciliationReport } from './ReconciliationService';
import { AdminNotificationService, NotificationConfig } from './AdminNotificationService';
import { SettlementAuditService, SettlementReport } from './SettlementAuditService';

export interface SystemConfig {
  provider: ethers.Provider;
  executorPrivateKey: string;
  monitoring: MonitoringConfig;
  reconciliation: ReconciliationConfig;
  notification: NotificationConfig;
  audit: {
    enabled: boolean;
    reportingEnabled: boolean;
    complianceEnabled: boolean;
  };
}

export interface SystemHealth {
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  timestamp: number;
  components: {
    settlement: 'UP' | 'DOWN' | 'DEGRADED';
    verification: 'UP' | 'DOWN' | 'DEGRADED';
    monitoring: 'UP' | 'DOWN' | 'DEGRADED';
    reconciliation: 'UP' | 'DOWN' | 'DEGRADED';
    notifications: 'UP' | 'DOWN' | 'DEGRADED';
    audit: 'UP' | 'DOWN' | 'DEGRADED';
  };
  metrics: {
    epochsProcessed24h: number;
    verificationSuccess24h: number;
    activeAlerts: number;
    pendingReconciliations: number;
    notificationsSent24h: number;
  };
  issues: Array<{
    component: string;
    issue: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    timestamp: number;
  }>;
}

export class SettlementVerificationSystem extends EventEmitter {
  private settlementEngine: FinalSettlementEngine;
  private verificationService: EnhancedSettlementVerification;
  private monitoringService: SettlementMonitoringService;
  private reconciliationService: ReconciliationService;
  private notificationService: AdminNotificationService;
  private auditService: SettlementAuditService;
  
  private config: SystemConfig;
  private isRunning: boolean = false;
  private healthCheckInterval?: NodeJS.Timer;
  private systemHealth: SystemHealth;

  constructor(
    settlementEngine: FinalSettlementEngine,
    config: SystemConfig
  ) {
    super();
    this.settlementEngine = settlementEngine;
    this.config = config;
    
    // Initialize services
    this.verificationService = new EnhancedSettlementVerification(config.provider);
    this.monitoringService = new SettlementMonitoringService(
      settlementEngine,
      config.provider,
      config.monitoring
    );
    this.reconciliationService = new ReconciliationService(
      config.reconciliation,
      config.provider,
      config.executorPrivateKey
    );
    this.notificationService = new AdminNotificationService(config.notification);
    this.auditService = new SettlementAuditService();
    
    // Initialize health status
    this.systemHealth = {
      status: 'HEALTHY',
      timestamp: Date.now(),
      components: {
        settlement: 'UP',
        verification: 'UP',
        monitoring: 'UP',
        reconciliation: 'UP',
        notifications: 'UP',
        audit: 'UP'
      },
      metrics: {
        epochsProcessed24h: 0,
        verificationSuccess24h: 0,
        activeAlerts: 0,
        pendingReconciliations: 0,
        notificationsSent24h: 0
      },
      issues: []
    };
    
    this.setupEventIntegration();
  }

  /**
   * Start the verification system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('System is already running');
    }
    
    this.isRunning = true;
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    // Log system start
    this.auditService.logAuditEvent({
      category: 'SYSTEM',
      type: 'SYSTEM_STARTED',
      severity: 'INFO',
      actor: 'SYSTEM',
      description: 'Settlement verification system started',
      data: { config: this.config },
      metadata: { source: 'VerificationSystem' }
    });
    
    // Notify administrators
    await this.notificationService.notify({
      type: 'SYSTEM_STARTED',
      severity: 'INFO',
      title: 'Settlement Verification System Started',
      message: 'The settlement verification system has been started successfully',
      data: { timestamp: Date.now() },
      source: 'VerificationSystem'
    });
    
    this.emit('system:started');
  }

  /**
   * Stop the verification system
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    // Stop all services
    this.monitoringService.stop();
    this.auditService.stop();
    
    // Log system stop
    this.auditService.logAuditEvent({
      category: 'SYSTEM',
      type: 'SYSTEM_STOPPED',
      severity: 'INFO',
      actor: 'SYSTEM',
      description: 'Settlement verification system stopped',
      data: { timestamp: Date.now() },
      metadata: { source: 'VerificationSystem' }
    });
    
    // Notify administrators
    await this.notificationService.notify({
      type: 'SYSTEM_STOPPED',
      severity: 'WARNING',
      title: 'Settlement Verification System Stopped',
      message: 'The settlement verification system has been stopped',
      data: { timestamp: Date.now() },
      source: 'VerificationSystem'
    });
    
    this.emit('system:stopped');
  }

  /**
   * Setup event integration between services
   */
  private setupEventIntegration(): void {
    // Settlement Engine -> Audit Service
    this.settlementEngine.on('epochStarted', (epoch: SettlementEpoch) => {
      this.auditService.logSettlementEvent(epoch, 'EPOCH_STARTED');
    });
    
    this.settlementEngine.on('epochFinalized', (epoch: SettlementEpoch) => {
      this.auditService.logSettlementEvent(epoch, 'EPOCH_FINALIZED');
    });
    
    this.settlementEngine.on('epochFailed', (data: any) => {
      this.auditService.logAuditEvent({
        category: 'SETTLEMENT',
        type: 'EPOCH_FAILED',
        severity: 'ERROR',
        epochId: data.epochId,
        description: `Settlement epoch ${data.epochId} failed`,
        data,
        metadata: { source: 'SettlementEngine' }
      });
    });
    
    // Verification Service -> Audit Service
    this.verificationService.on('verification:completed', (result: VerificationResult) => {
      this.auditService.logVerificationEvent(result);
    });
    
    // Monitoring Service -> Notification Service
    this.monitoringService.on('alert:created', async (alert: AlertEvent) => {
      await this.notificationService.notify({
        type: `ALERT_${alert.type}`,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        data: alert.data,
        source: 'MonitoringService'
      });
    });
    
    // Monitoring Service -> Reconciliation Service
    this.monitoringService.on('reconciliation:required', async (data: any) => {
      const verificationResult = this.verificationService.getVerificationResult(data.verificationId);
      if (verificationResult) {
        const actions = await this.verificationService.createReconciliationActions(verificationResult);
        await this.reconciliationService.createReconciliationBatch(verificationResult, actions);
      }
    });
    
    // Reconciliation Service -> Audit Service
    this.reconciliationService.on('batch:created', (data: any) => {
      this.auditService.logAuditEvent({
        category: 'RECONCILIATION',
        type: 'BATCH_CREATED',
        severity: 'INFO',
        description: `Reconciliation batch created with ${data.actionCount} actions`,
        data,
        metadata: { source: 'ReconciliationService' }
      });
    });
    
    this.reconciliationService.on('batch:approved', (data: any) => {
      this.auditService.logAuditEvent({
        category: 'RECONCILIATION',
        type: 'BATCH_APPROVED',
        severity: 'INFO',
        actor: data.approver,
        description: `Reconciliation batch ${data.batchId} approved`,
        data,
        metadata: { source: 'ReconciliationService' }
      });
    });
    
    this.reconciliationService.on('batch:completed', async (report: ReconciliationReport) => {
      this.auditService.logAuditEvent({
        category: 'RECONCILIATION',
        type: 'BATCH_COMPLETED',
        severity: 'INFO',
        epochId: report.epochId,
        description: `Reconciliation batch ${report.batchId} completed`,
        data: report,
        metadata: { source: 'ReconciliationService' }
      });
      
      // Notify administrators of completion
      await this.notificationService.notify({
        type: 'RECONCILIATION_COMPLETED',
        severity: 'INFO',
        title: 'Reconciliation Batch Completed',
        message: `Batch ${report.batchId} completed: ${report.executedActions}/${report.totalActions} actions executed`,
        data: report,
        source: 'ReconciliationService'
      });
    });
    
    // Notification Service -> Audit Service
    this.notificationService.on('notification:sent', (data: any) => {
      this.auditService.logAuditEvent({
        category: 'NOTIFICATION',
        type: 'NOTIFICATION_SENT',
        severity: 'INFO',
        description: `Notification sent via ${data.channel} to ${data.recipientId}`,
        data,
        metadata: { source: 'NotificationService' }
      });
    });
    
    // Audit Service -> Report Generation
    this.auditService.on('report:schedule', async (schedule: any) => {
      await this.generateScheduledReport(schedule);
    });
  }

  /**
   * Generate scheduled report
   */
  private async generateScheduledReport(schedule: any): Promise<void> {
    try {
      // Gather data for the report
      const metrics = this.monitoringService.getMetrics();
      const verifications: VerificationResult[] = []; // Would get from verification service
      const reconciliations: ReconciliationReport[] = []; // Would get from reconciliation service
      const alerts = this.monitoringService.getActiveAlerts();
      
      // Generate report
      const report = await this.auditService.generateReport(
        schedule.type,
        schedule.startDate,
        schedule.endDate,
        metrics,
        verifications,
        reconciliations,
        alerts
      );
      
      // Notify administrators
      await this.notificationService.notify({
        type: 'REPORT_GENERATED',
        severity: 'INFO',
        title: `${schedule.type} Settlement Report Generated`,
        message: `Report ${report.id} has been generated for period ${new Date(schedule.startDate).toDateString()} to ${new Date(schedule.endDate).toDateString()}`,
        data: {
          reportId: report.id,
          summary: report.summary
        },
        source: 'AuditService'
      });
      
    } catch (error) {
      this.emit('error', {
        component: 'ReportGeneration',
        error: error instanceof Error ? error.message : 'Unknown error',
        schedule
      });
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 60000); // Every minute
    
    // Perform initial health check
    this.performHealthCheck();
  }

  /**
   * Perform system health check
   */
  private async performHealthCheck(): Promise<void> {
    const issues: typeof this.systemHealth.issues = [];
    
    try {
      // Check settlement engine
      const currentEpoch = this.settlementEngine.getCurrentEpoch();
      if (!currentEpoch) {
        this.systemHealth.components.settlement = 'DOWN';
        issues.push({
          component: 'settlement',
          issue: 'No active epoch',
          severity: 'HIGH',
          timestamp: Date.now()
        });
      } else {
        this.systemHealth.components.settlement = 'UP';
      }
      
      // Check monitoring service
      const monitoringHealth = this.monitoringService.getHealthStatus();
      if (monitoringHealth.status === 'UNHEALTHY') {
        this.systemHealth.components.monitoring = 'DOWN';
        issues.push({
          component: 'monitoring',
          issue: 'Monitoring service unhealthy',
          severity: 'HIGH',
          timestamp: Date.now()
        });
      } else if (monitoringHealth.status === 'DEGRADED') {
        this.systemHealth.components.monitoring = 'DEGRADED';
        issues.push({
          component: 'monitoring',
          issue: 'Monitoring service degraded',
          severity: 'MEDIUM',
          timestamp: Date.now()
        });
      } else {
        this.systemHealth.components.monitoring = 'UP';
      }
      
      // Update metrics
      this.systemHealth.metrics = {
        epochsProcessed24h: monitoringHealth.epochsProcessed24h,
        verificationSuccess24h: monitoringHealth.successRate24h,
        activeAlerts: monitoringHealth.activeAlerts,
        pendingReconciliations: monitoringHealth.pendingReconciliations,
        notificationsSent24h: 0 // Would get from notification service
      };
      
      // Check reconciliation service
      const pendingBatches = this.reconciliationService.getPendingBatches();
      if (pendingBatches.length > 50) {
        this.systemHealth.components.reconciliation = 'DEGRADED';
        issues.push({
          component: 'reconciliation',
          issue: `High pending reconciliations: ${pendingBatches.length}`,
          severity: 'MEDIUM',
          timestamp: Date.now()
        });
      } else {
        this.systemHealth.components.reconciliation = 'UP';
      }
      
      // Determine overall health
      const componentStatuses = Object.values(this.systemHealth.components);
      if (componentStatuses.includes('DOWN')) {
        this.systemHealth.status = 'CRITICAL';
      } else if (componentStatuses.includes('DEGRADED')) {
        this.systemHealth.status = 'DEGRADED';
      } else {
        this.systemHealth.status = 'HEALTHY';
      }
      
      this.systemHealth.timestamp = Date.now();
      this.systemHealth.issues = issues;
      
      // Emit health update
      this.emit('health:updated', this.systemHealth);
      
      // Alert on critical issues
      if (this.systemHealth.status === 'CRITICAL') {
        await this.notificationService.notify({
          type: 'SYSTEM_HEALTH_CRITICAL',
          severity: 'CRITICAL',
          title: 'System Health Critical',
          message: 'Settlement verification system health is critical',
          data: this.systemHealth,
          source: 'HealthMonitor'
        });
      }
      
    } catch (error) {
      this.emit('error', {
        component: 'HealthCheck',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Public API
  
  /**
   * Get system health status
   */
  getSystemHealth(): SystemHealth {
    return this.systemHealth;
  }

  /**
   * Trigger manual verification for an epoch
   */
  async triggerManualVerification(epochId: string): Promise<VerificationResult | null> {
    this.auditService.logAuditEvent({
      category: 'VERIFICATION',
      type: 'MANUAL_VERIFICATION_TRIGGERED',
      severity: 'INFO',
      epochId,
      actor: 'MANUAL',
      description: `Manual verification triggered for epoch ${epochId}`,
      data: { epochId },
      metadata: { source: 'VerificationSystem' }
    });
    
    return await this.monitoringService.triggerManualVerification(epochId);
  }

  /**
   * Approve reconciliation batch
   */
  async approveReconciliationBatch(
    batchId: string,
    approver: string,
    signature?: string,
    comments?: string
  ): Promise<void> {
    await this.reconciliationService.approveBatch(batchId, approver, signature, comments);
  }

  /**
   * Emergency pause
   */
  async emergencyPause(reason: string, initiator: string): Promise<void> {
    // Pause settlement engine
    await this.settlementEngine.emergencyPause();
    
    // Pause reconciliation
    await this.reconciliationService.emergencyPause();
    
    // Log event
    this.auditService.logAuditEvent({
      category: 'SYSTEM',
      type: 'EMERGENCY_PAUSE',
      severity: 'CRITICAL',
      actor: initiator,
      description: 'Emergency pause activated',
      data: { reason, initiator },
      metadata: { source: 'VerificationSystem' }
    });
    
    // Notify all administrators
    await this.notificationService.notify({
      type: 'EMERGENCY_PAUSE',
      severity: 'CRITICAL',
      title: 'Emergency Pause Activated',
      message: `System paused by ${initiator}: ${reason}`,
      data: { reason, initiator, timestamp: Date.now() },
      source: 'VerificationSystem'
    });
    
    this.emit('system:emergency-pause', { reason, initiator });
  }

  /**
   * Generate custom report
   */
  async generateCustomReport(
    startDate: number,
    endDate: number
  ): Promise<SettlementReport> {
    const metrics = this.monitoringService.getMetrics()
      .filter(m => m.timestamp >= startDate && m.timestamp <= endDate);
    
    const verifications: VerificationResult[] = []; // Would filter from verification service
    const reconciliations: ReconciliationReport[] = []; // Would filter from reconciliation service
    const alerts = this.monitoringService.getActiveAlerts()
      .filter(a => a.timestamp >= startDate && a.timestamp <= endDate);
    
    return await this.auditService.generateReport(
      'CUSTOM',
      startDate,
      endDate,
      metrics,
      verifications,
      reconciliations,
      alerts
    );
  }

  /**
   * Export audit logs
   */
  async exportAuditLogs(
    format: 'JSON' | 'CSV',
    query: any
  ): Promise<string> {
    return await this.auditService.exportAuditLogs(format, query);
  }

  /**
   * Get audit statistics
   */
  getAuditStatistics(startTime?: number, endTime?: number): any {
    return this.auditService.getAuditStatistics(startTime, endTime);
  }

  /**
   * Update system configuration
   */
  updateConfiguration(updates: Partial<SystemConfig>): void {
    if (updates.monitoring) {
      this.monitoringService.updateConfig(updates.monitoring);
    }
    if (updates.reconciliation) {
      this.reconciliationService.updateConfig(updates.reconciliation);
    }
    if (updates.notification) {
      // Would update notification service config
    }
    
    Object.assign(this.config, updates);
    
    this.auditService.logAuditEvent({
      category: 'SYSTEM',
      type: 'CONFIG_UPDATED',
      severity: 'INFO',
      actor: 'ADMIN',
      description: 'System configuration updated',
      data: updates,
      metadata: { source: 'VerificationSystem' }
    });
    
    this.emit('config:updated', this.config);
  }
}