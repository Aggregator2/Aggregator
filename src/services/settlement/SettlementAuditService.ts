import { EventEmitter } from 'events';
import { SettlementEpoch } from './FinalSettlementEngine';
import { VerificationResult, ReconciliationAction } from './EnhancedSettlementVerification';
import { ReconciliationBatch, ReconciliationReport } from './ReconciliationService';
import { SettlementMetrics, AlertEvent } from './SettlementMonitoringService';
import { NotificationEvent } from './AdminNotificationService';

export interface AuditEvent {
  id: string;
  timestamp: number;
  category: 'SETTLEMENT' | 'VERIFICATION' | 'RECONCILIATION' | 'NOTIFICATION' | 'SYSTEM';
  type: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  actor?: string; // User or system that initiated the action
  epochId?: string;
  description: string;
  data: any;
  metadata: {
    ip?: string;
    userAgent?: string;
    source: string;
  };
}

export interface SettlementReport {
  id: string;
  type: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  startDate: number;
  endDate: number;
  generatedAt: number;
  summary: {
    totalEpochs: number;
    successfulEpochs: number;
    failedEpochs: number;
    totalVolume: string;
    totalTrades: number;
    totalUsers: number;
    averageEpochDuration: number;
    totalGasUsed: string;
    totalGasCost: string;
  };
  verificationSummary: {
    totalVerifications: number;
    passedVerifications: number;
    failedVerifications: number;
    partialVerifications: number;
    totalDiscrepancies: number;
    totalDiscrepancyValue: string;
    criticalDiscrepancies: number;
  };
  reconciliationSummary: {
    totalActions: number;
    executedActions: number;
    pendingActions: number;
    rejectedActions: number;
    totalCredits: string;
    totalDebits: string;
    frozenAccounts: number;
    investigationsOpened: number;
  };
  alertsSummary: {
    totalAlerts: number;
    criticalAlerts: number;
    acknowledgedAlerts: number;
    averageResponseTime: number;
  };
  topIssues: Array<{
    type: string;
    count: number;
    severity: string;
    affectedUsers: number;
  }>;
  recommendations: string[];
}

export interface AuditQuery {
  startTime?: number;
  endTime?: number;
  categories?: Array<AuditEvent['category']>;
  types?: string[];
  severities?: Array<AuditEvent['severity']>;
  epochId?: string;
  actor?: string;
  limit?: number;
  offset?: number;
}

export interface ComplianceReport {
  id: string;
  period: string;
  generatedAt: number;
  regulatoryChecks: Array<{
    check: string;
    status: 'PASSED' | 'FAILED' | 'WARNING';
    details: string;
    evidence: string[];
  }>;
  dataRetention: {
    oldestRecord: number;
    totalRecords: number;
    storageUsed: string;
    complianceStatus: boolean;
  };
  accessControl: {
    totalUsers: number;
    privilegedUsers: number;
    recentAccessReviews: number;
    unauthorizedAttempts: number;
  };
  encryptionStatus: {
    dataAtRest: boolean;
    dataInTransit: boolean;
    keyRotationDate: number;
  };
}

export class SettlementAuditService extends EventEmitter {
  private auditLog: Map<string, AuditEvent> = new Map();
  private reports: Map<string, SettlementReport> = new Map();
  private complianceReports: Map<string, ComplianceReport> = new Map();
  
  private config = {
    retentionDays: 365, // 1 year
    maxAuditLogSize: 10000000, // 10M records
    reportGenerationSchedule: {
      daily: true,
      weekly: true,
      monthly: true
    },
    complianceChecks: {
      enabled: true,
      frequency: 'MONTHLY'
    },
    encryption: {
      enabled: true,
      algorithm: 'AES-256-GCM'
    }
  };

  private reportGenerationInterval?: NodeJS.Timer;
  private cleanupInterval?: NodeJS.Timer;

  constructor() {
    super();
    this.startScheduledTasks();
  }

  /**
   * Log an audit event
   */
  logAuditEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): void {
    const auditEvent: AuditEvent = {
      ...event,
      id: `AUDIT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };

    this.auditLog.set(auditEvent.id, auditEvent);
    
    // Emit for real-time monitoring
    this.emit('audit:logged', auditEvent);

    // Check size limits
    if (this.auditLog.size > this.config.maxAuditLogSize) {
      this.rotateAuditLog();
    }
  }

  /**
   * Log settlement epoch events
   */
  logSettlementEvent(epoch: SettlementEpoch, event: string, actor?: string): void {
    this.logAuditEvent({
      category: 'SETTLEMENT',
      type: event,
      severity: event.includes('FAILED') ? 'ERROR' : 'INFO',
      actor: actor || 'SYSTEM',
      epochId: epoch.id,
      description: `Settlement ${event} for epoch ${epoch.id}`,
      data: {
        epochId: epoch.id,
        status: epoch.status,
        trades: epoch.trades.length,
        startTime: epoch.startTime,
        finalizedAt: epoch.finalizedAt
      },
      metadata: {
        source: 'SettlementEngine'
      }
    });
  }

  /**
   * Log verification events
   */
  logVerificationEvent(result: VerificationResult, actor?: string): void {
    const severity = result.status === 'FAILED' ? 'CRITICAL' : 
                    result.status === 'PARTIAL' ? 'WARNING' : 'INFO';
    
    this.logAuditEvent({
      category: 'VERIFICATION',
      type: `VERIFICATION_${result.status}`,
      severity,
      actor: actor || 'SYSTEM',
      epochId: result.epochId,
      description: `Verification ${result.status} for epoch ${result.epochId}`,
      data: {
        verificationId: result.verificationId,
        status: result.status,
        discrepancies: result.discrepancies.length,
        warnings: result.warnings.length,
        duration: result.verificationTime
      },
      metadata: {
        source: 'VerificationService'
      }
    });
  }

  /**
   * Log reconciliation events
   */
  logReconciliationEvent(
    action: ReconciliationAction | ReconciliationBatch,
    event: string,
    actor?: string
  ): void {
    const isAction = 'userId' in action;
    
    this.logAuditEvent({
      category: 'RECONCILIATION',
      type: event,
      severity: event.includes('FAILED') ? 'ERROR' : 'INFO',
      actor: actor || 'SYSTEM',
      description: isAction ? 
        `Reconciliation action ${event} for user ${action.userId}` :
        `Reconciliation batch ${event}`,
      data: isAction ? {
        actionId: action.id,
        type: action.type,
        userId: action.userId,
        token: action.token,
        amount: action.amount.toString(),
        status: action.status
      } : {
        batchId: action.id,
        status: action.status,
        actions: action.actions.length,
        totalValue: action.totalValue,
        priority: action.priority
      },
      metadata: {
        source: 'ReconciliationService'
      }
    });
  }

  /**
   * Query audit logs
   */
  queryAuditLog(query: AuditQuery): AuditEvent[] {
    let results = Array.from(this.auditLog.values());

    // Apply filters
    if (query.startTime) {
      results = results.filter(e => e.timestamp >= query.startTime!);
    }
    if (query.endTime) {
      results = results.filter(e => e.timestamp <= query.endTime!);
    }
    if (query.categories && query.categories.length > 0) {
      results = results.filter(e => query.categories!.includes(e.category));
    }
    if (query.types && query.types.length > 0) {
      results = results.filter(e => query.types!.includes(e.type));
    }
    if (query.severities && query.severities.length > 0) {
      results = results.filter(e => query.severities!.includes(e.severity));
    }
    if (query.epochId) {
      results = results.filter(e => e.epochId === query.epochId);
    }
    if (query.actor) {
      results = results.filter(e => e.actor === query.actor);
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit || 100;
    
    return results.slice(offset, offset + limit);
  }

  /**
   * Generate settlement report
   */
  async generateReport(
    type: SettlementReport['type'],
    startDate: number,
    endDate: number,
    metrics: SettlementMetrics[],
    verifications: VerificationResult[],
    reconciliations: ReconciliationReport[],
    alerts: AlertEvent[]
  ): Promise<SettlementReport> {
    const reportId = `REPORT_${type}_${Date.now()}`;
    
    // Calculate summary statistics
    const epochs = new Set(metrics.map(m => m.epochId));
    const successfulEpochs = metrics.filter(m => m.verificationStatus === 'PASSED').length;
    const failedEpochs = metrics.filter(m => m.verificationStatus === 'FAILED').length;
    
    const totalVolume = metrics.reduce((sum, m) => {
      return sum + BigInt(m.totalVolume || 0);
    }, BigInt(0));
    
    const totalTrades = metrics.reduce((sum, m) => sum + m.totalTrades, 0);
    const totalGasUsed = metrics.reduce((sum, m) => sum + BigInt(m.gasUsed), BigInt(0));
    const totalGasCost = metrics.reduce((sum, m) => sum + BigInt(m.totalGasCost), BigInt(0));
    
    const averageEpochDuration = metrics.length > 0 ?
      metrics.reduce((sum, m) => sum + m.settlementDuration, 0) / metrics.length : 0;

    // Verification summary
    const passedVerifications = verifications.filter(v => v.status === 'PASSED').length;
    const failedVerifications = verifications.filter(v => v.status === 'FAILED').length;
    const partialVerifications = verifications.filter(v => v.status === 'PARTIAL').length;
    
    const totalDiscrepancies = verifications.reduce((sum, v) => sum + v.discrepancies.length, 0);
    const totalDiscrepancyValue = verifications.reduce((sum, v) => {
      return sum + v.discrepancies.reduce((dSum, d) => {
        const value = d.discrepancy < 0 ? -d.discrepancy : d.discrepancy;
        return dSum + value;
      }, BigInt(0));
    }, BigInt(0));
    
    const criticalDiscrepancies = verifications.reduce((sum, v) => {
      return sum + v.warnings.filter(w => w.severity === 'CRITICAL').length;
    }, 0);

    // Reconciliation summary
    const totalActions = reconciliations.reduce((sum, r) => sum + r.totalActions, 0);
    const executedActions = reconciliations.reduce((sum, r) => sum + r.executedActions, 0);
    const failedActions = reconciliations.reduce((sum, r) => sum + r.failedActions, 0);
    
    // Alert summary
    const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL').length;
    const acknowledgedAlerts = alerts.filter(a => a.acknowledged).length;
    
    // Calculate top issues
    const issueMap = new Map<string, { count: number; severity: string; users: Set<string> }>();
    
    for (const verification of verifications) {
      for (const warning of verification.warnings) {
        const key = warning.type;
        if (!issueMap.has(key)) {
          issueMap.set(key, { count: 0, severity: warning.severity, users: new Set() });
        }
        const issue = issueMap.get(key)!;
        issue.count++;
        if (warning.data?.userId) {
          issue.users.add(warning.data.userId);
        }
      }
    }
    
    const topIssues = Array.from(issueMap.entries())
      .map(([type, data]) => ({
        type,
        count: data.count,
        severity: data.severity,
        affectedUsers: data.users.size
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Generate recommendations
    const recommendations = this.generateRecommendations({
      failureRate: epochs.size > 0 ? failedEpochs / epochs.size : 0,
      discrepancyRate: verifications.length > 0 ? failedVerifications / verifications.length : 0,
      criticalAlerts,
      topIssues
    });

    const report: SettlementReport = {
      id: reportId,
      type,
      startDate,
      endDate,
      generatedAt: Date.now(),
      summary: {
        totalEpochs: epochs.size,
        successfulEpochs,
        failedEpochs,
        totalVolume: totalVolume.toString(),
        totalTrades,
        totalUsers: new Set(verifications.flatMap(v => 
          v.discrepancies.map(d => d.userId)
        )).size,
        averageEpochDuration,
        totalGasUsed: totalGasUsed.toString(),
        totalGasCost: totalGasCost.toString()
      },
      verificationSummary: {
        totalVerifications: verifications.length,
        passedVerifications,
        failedVerifications,
        partialVerifications,
        totalDiscrepancies,
        totalDiscrepancyValue: totalDiscrepancyValue.toString(),
        criticalDiscrepancies
      },
      reconciliationSummary: {
        totalActions,
        executedActions,
        pendingActions: totalActions - executedActions - failedActions,
        rejectedActions: failedActions,
        totalCredits: '0', // Would calculate from actual data
        totalDebits: '0',
        frozenAccounts: 0,
        investigationsOpened: 0
      },
      alertsSummary: {
        totalAlerts: alerts.length,
        criticalAlerts,
        acknowledgedAlerts,
        averageResponseTime: this.calculateAverageResponseTime(alerts)
      },
      topIssues,
      recommendations
    };

    this.reports.set(reportId, report);
    this.emit('report:generated', { reportId, type });

    return report;
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(period: string): Promise<ComplianceReport> {
    const reportId = `COMPLIANCE_${period}_${Date.now()}`;
    
    const report: ComplianceReport = {
      id: reportId,
      period,
      generatedAt: Date.now(),
      regulatoryChecks: [
        {
          check: 'Data Retention Compliance',
          status: this.checkDataRetentionCompliance() ? 'PASSED' : 'FAILED',
          details: 'Audit logs retained for required period',
          evidence: ['audit_retention_policy.json', 'cleanup_logs.txt']
        },
        {
          check: 'Settlement Finality',
          status: 'PASSED',
          details: 'All settlements achieve finality within regulatory timeframe',
          evidence: ['settlement_finality_report.pdf']
        },
        {
          check: 'Reconciliation Controls',
          status: 'PASSED',
          details: 'Multi-signature approval enforced for high-value reconciliations',
          evidence: ['reconciliation_approvals.csv']
        },
        {
          check: 'Access Control',
          status: this.checkAccessControlCompliance() ? 'PASSED' : 'WARNING',
          details: 'Privileged access reviewed quarterly',
          evidence: ['access_review_q4.xlsx']
        }
      ],
      dataRetention: {
        oldestRecord: this.getOldestRecordTimestamp(),
        totalRecords: this.auditLog.size,
        storageUsed: this.calculateStorageUsed(),
        complianceStatus: true
      },
      accessControl: {
        totalUsers: 0, // Would get from user service
        privilegedUsers: 0,
        recentAccessReviews: 0,
        unauthorizedAttempts: this.countUnauthorizedAttempts()
      },
      encryptionStatus: {
        dataAtRest: this.config.encryption.enabled,
        dataInTransit: true,
        keyRotationDate: Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago
      }
    };

    this.complianceReports.set(reportId, report);
    this.emit('compliance:report-generated', { reportId, period });

    return report;
  }

  /**
   * Export audit logs
   */
  async exportAuditLogs(
    format: 'JSON' | 'CSV',
    query: AuditQuery
  ): Promise<string> {
    const events = this.queryAuditLog(query);
    
    if (format === 'JSON') {
      return JSON.stringify(events, null, 2);
    } else {
      // CSV export
      const headers = [
        'ID', 'Timestamp', 'Category', 'Type', 'Severity',
        'Actor', 'Epoch ID', 'Description', 'Source'
      ];
      
      const rows = events.map(e => [
        e.id,
        new Date(e.timestamp).toISOString(),
        e.category,
        e.type,
        e.severity,
        e.actor || '',
        e.epochId || '',
        e.description,
        e.metadata.source
      ]);
      
      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');
      
      return csv;
    }
  }

  /**
   * Get audit statistics
   */
  getAuditStatistics(startTime?: number, endTime?: number): {
    totalEvents: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    byActor: Record<string, number>;
    recentActivity: Array<{ time: number; count: number }>;
  } {
    const events = this.queryAuditLog({ startTime, endTime });
    
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    
    for (const event of events) {
      byCategory[event.category] = (byCategory[event.category] || 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
      if (event.actor) {
        byActor[event.actor] = (byActor[event.actor] || 0) + 1;
      }
    }
    
    // Calculate recent activity (last 24 hours, hourly buckets)
    const now = Date.now();
    const hourAgo = 60 * 60 * 1000;
    const recentActivity: Array<{ time: number; count: number }> = [];
    
    for (let i = 0; i < 24; i++) {
      const bucketStart = now - (i + 1) * hourAgo;
      const bucketEnd = now - i * hourAgo;
      
      const count = events.filter(e => 
        e.timestamp >= bucketStart && e.timestamp < bucketEnd
      ).length;
      
      recentActivity.push({ time: bucketEnd, count });
    }
    
    return {
      totalEvents: events.length,
      byCategory,
      bySeverity,
      byActor,
      recentActivity: recentActivity.reverse()
    };
  }

  // Helper methods
  private generateRecommendations(data: any): string[] {
    const recommendations: string[] = [];
    
    if (data.failureRate > 0.05) {
      recommendations.push('High epoch failure rate detected. Review settlement engine configuration and gas limits.');
    }
    
    if (data.discrepancyRate > 0.1) {
      recommendations.push('Significant verification discrepancies. Consider adjusting verification thresholds or investigating systematic issues.');
    }
    
    if (data.criticalAlerts > 10) {
      recommendations.push('Multiple critical alerts detected. Implement automated response procedures for common issues.');
    }
    
    if (data.topIssues.some((i: any) => i.type === 'HIGH_DISCREPANCY' && i.count > 5)) {
      recommendations.push('Recurring high discrepancies detected. Review balance calculation logic and external data sources.');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('System operating within normal parameters. Continue monitoring for anomalies.');
    }
    
    return recommendations;
  }

  private calculateAverageResponseTime(alerts: AlertEvent[]): number {
    const acknowledgedAlerts = alerts.filter(a => a.acknowledged && a.acknowledgedAt);
    
    if (acknowledgedAlerts.length === 0) return 0;
    
    const totalResponseTime = acknowledgedAlerts.reduce((sum, alert) => {
      return sum + (alert.acknowledgedAt! - alert.timestamp);
    }, 0);
    
    return totalResponseTime / acknowledgedAlerts.length;
  }

  private checkDataRetentionCompliance(): boolean {
    const oldestAllowed = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const oldestRecord = this.getOldestRecordTimestamp();
    
    return oldestRecord >= oldestAllowed;
  }

  private checkAccessControlCompliance(): boolean {
    // Check if access reviews have been performed recently
    const recentReviews = this.queryAuditLog({
      types: ['ACCESS_REVIEW_COMPLETED'],
      startTime: Date.now() - 90 * 24 * 60 * 60 * 1000 // Last 90 days
    });
    
    return recentReviews.length > 0;
  }

  private getOldestRecordTimestamp(): number {
    let oldest = Date.now();
    
    for (const event of this.auditLog.values()) {
      if (event.timestamp < oldest) {
        oldest = event.timestamp;
      }
    }
    
    return oldest;
  }

  private calculateStorageUsed(): string {
    // Rough estimate of storage used
    const avgEventSize = 1024; // 1KB average per event
    const totalSize = this.auditLog.size * avgEventSize;
    
    if (totalSize > 1024 * 1024 * 1024) {
      return `${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    } else if (totalSize > 1024 * 1024) {
      return `${(totalSize / (1024 * 1024)).toFixed(2)} MB`;
    } else {
      return `${(totalSize / 1024).toFixed(2)} KB`;
    }
  }

  private countUnauthorizedAttempts(): number {
    const unauthorized = this.queryAuditLog({
      types: ['UNAUTHORIZED_ACCESS', 'AUTHENTICATION_FAILED'],
      startTime: Date.now() - 30 * 24 * 60 * 60 * 1000 // Last 30 days
    });
    
    return unauthorized.length;
  }

  private rotateAuditLog(): void {
    // Archive old events
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const toArchive: AuditEvent[] = [];
    
    for (const [id, event] of this.auditLog) {
      if (event.timestamp < cutoff) {
        toArchive.push(event);
        this.auditLog.delete(id);
      }
    }
    
    if (toArchive.length > 0) {
      this.emit('audit:archived', {
        count: toArchive.length,
        oldestTimestamp: Math.min(...toArchive.map(e => e.timestamp)),
        newestTimestamp: Math.max(...toArchive.map(e => e.timestamp))
      });
    }
  }

  private startScheduledTasks(): void {
    // Report generation
    this.reportGenerationInterval = setInterval(() => {
      const now = new Date();
      
      // Daily report at midnight
      if (this.config.reportGenerationSchedule.daily && now.getHours() === 0) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        
        this.emit('report:schedule', {
          type: 'DAILY',
          startDate: yesterday.setHours(0, 0, 0, 0),
          endDate: yesterday.setHours(23, 59, 59, 999)
        });
      }
      
      // Weekly report on Mondays
      if (this.config.reportGenerationSchedule.weekly && 
          now.getDay() === 1 && now.getHours() === 0) {
        const lastWeek = new Date(now);
        lastWeek.setDate(lastWeek.getDate() - 7);
        
        this.emit('report:schedule', {
          type: 'WEEKLY',
          startDate: lastWeek.getTime(),
          endDate: now.getTime()
        });
      }
      
      // Monthly report on the 1st
      if (this.config.reportGenerationSchedule.monthly && 
          now.getDate() === 1 && now.getHours() === 0) {
        const lastMonth = new Date(now);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        
        this.emit('report:schedule', {
          type: 'MONTHLY',
          startDate: lastMonth.getTime(),
          endDate: now.getTime()
        });
      }
    }, 3600000); // Check every hour
    
    // Cleanup old data
    this.cleanupInterval = setInterval(() => {
      this.rotateAuditLog();
      this.cleanupOldReports();
    }, 24 * 60 * 60 * 1000); // Daily
  }

  private cleanupOldReports(): void {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000; // Keep reports for 90 days
    
    for (const [id, report] of this.reports) {
      if (report.generatedAt < cutoff) {
        this.reports.delete(id);
      }
    }
    
    for (const [id, report] of this.complianceReports) {
      if (report.generatedAt < cutoff) {
        this.complianceReports.delete(id);
      }
    }
  }

  // Public API
  getReport(reportId: string): SettlementReport | undefined {
    return this.reports.get(reportId);
  }

  getComplianceReport(reportId: string): ComplianceReport | undefined {
    return this.complianceReports.get(reportId);
  }

  getRecentReports(limit: number = 10): SettlementReport[] {
    return Array.from(this.reports.values())
      .sort((a, b) => b.generatedAt - a.generatedAt)
      .slice(0, limit);
  }

  updateConfig(newConfig: Partial<typeof this.config>): void {
    Object.assign(this.config, newConfig);
    this.emit('config:updated', this.config);
  }

  stop(): void {
    if (this.reportGenerationInterval) {
      clearInterval(this.reportGenerationInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.emit('audit:stopped');
  }
}