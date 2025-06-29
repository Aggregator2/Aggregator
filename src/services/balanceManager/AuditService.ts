import { EventEmitter } from 'events';
import { Address } from 'viem';
import { BalanceUpdate, BalanceSnapshot, Balance } from './types';
import { BalanceManager } from './BalanceManager';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  userId: string;
  details: Record<string, any>;
  severity: AuditSeverity;
}

export enum AuditEventType {
  BALANCE_UPDATE = 'BALANCE_UPDATE',
  WITHDRAWAL_REQUEST = 'WITHDRAWAL_REQUEST',
  EMERGENCY_WITHDRAWAL = 'EMERGENCY_WITHDRAWAL',
  BALANCE_VERIFICATION_FAILED = 'BALANCE_VERIFICATION_FAILED',
  RECONCILIATION_DISCREPANCY = 'RECONCILIATION_DISCREPANCY',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  ADMIN_ACTION = 'ADMIN_ACTION',
}

export enum AuditSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface AuditReport {
  startDate: Date;
  endDate: Date;
  totalEvents: number;
  eventsByType: Record<AuditEventType, number>;
  eventsBySeverity: Record<AuditSeverity, number>;
  flaggedUsers: string[];
  summary: string;
}

export class AuditService extends EventEmitter {
  private auditEvents: AuditEvent[] = [];
  private balanceManager: BalanceManager;
  private suspiciousActivityThresholds = {
    largeWithdrawalThreshold: 1000000n, // 1M units
    frequentActivityThreshold: 10, // activities per hour
    rapidBalanceChangeThreshold: 0.5, // 50% of balance
  };

  constructor(balanceManager: BalanceManager) {
    super();
    this.balanceManager = balanceManager;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.balanceManager.on('balanceUpdate', (update: BalanceUpdate) => {
      this.logBalanceUpdate(update);
      this.checkSuspiciousActivity(update);
    });

    this.balanceManager.on('withdrawalRequested', (withdrawal: any) => {
      this.logWithdrawalRequest(withdrawal);
    });

    this.balanceManager.on('reconciliationCompleted', (result: any) => {
      if (!result.isReconciled) {
        this.logReconciliationDiscrepancy(result);
      }
    });
  }

  private async logBalanceUpdate(update: BalanceUpdate): Promise<void> {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      eventType: AuditEventType.BALANCE_UPDATE,
      userId: update.userId,
      details: {
        tokenAddress: update.tokenAddress,
        amount: update.amount.toString(),
        type: update.type,
        reason: update.reason,
        previousBalance: update.previousBalance.toString(),
        newBalance: update.newBalance.toString(),
        referenceId: update.referenceId,
      },
      severity: this.calculateUpdateSeverity(update),
    };

    this.auditEvents.push(event);
    this.emit('auditEvent', event);
  }

  private logWithdrawalRequest(withdrawal: any): void {
    const severity = withdrawal.emergencyWithdrawal ? AuditSeverity.HIGH : AuditSeverity.MEDIUM;
    
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      eventType: withdrawal.emergencyWithdrawal ? 
        AuditEventType.EMERGENCY_WITHDRAWAL : 
        AuditEventType.WITHDRAWAL_REQUEST,
      userId: withdrawal.userId,
      details: {
        withdrawalId: withdrawal.id,
        tokenAddress: withdrawal.tokenAddress,
        amount: withdrawal.amount.toString(),
        emergency: withdrawal.emergencyWithdrawal,
      },
      severity,
    };

    this.auditEvents.push(event);
    this.emit('auditEvent', event);
  }

  private logReconciliationDiscrepancy(result: any): void {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      eventType: AuditEventType.RECONCILIATION_DISCREPANCY,
      userId: result.userId,
      details: {
        tokenAddress: result.tokenAddress,
        offChainBalance: result.offChainBalance.toString(),
        onChainBalance: result.onChainBalance.toString(),
        difference: result.difference.toString(),
        actions: result.actions,
      },
      severity: Math.abs(Number(result.difference)) > 10000 ? 
        AuditSeverity.CRITICAL : AuditSeverity.HIGH,
    };

    this.auditEvents.push(event);
    this.emit('auditEvent', event);
  }

  private calculateUpdateSeverity(update: BalanceUpdate): AuditSeverity {
    // Large withdrawals
    if (update.amount > this.suspiciousActivityThresholds.largeWithdrawalThreshold) {
      return AuditSeverity.HIGH;
    }

    // Emergency withdrawals
    if (update.reason === 'EMERGENCY_WITHDRAWAL') {
      return AuditSeverity.HIGH;
    }

    // Admin adjustments
    if (update.reason === 'ADMIN_ADJUSTMENT') {
      return AuditSeverity.MEDIUM;
    }

    return AuditSeverity.LOW;
  }

  private async checkSuspiciousActivity(update: BalanceUpdate): Promise<void> {
    const recentActivity = this.getRecentUserActivity(update.userId, 60); // Last hour
    
    // Check for frequent activity
    if (recentActivity.length > this.suspiciousActivityThresholds.frequentActivityThreshold) {
      this.logSuspiciousActivity(update.userId, 'FREQUENT_ACTIVITY', {
        activityCount: recentActivity.length,
        timeWindow: '1 hour',
      });
    }

    // Check for rapid balance changes
    if (update.previousBalance > 0n) {
      const changeRatio = Number(update.amount) / Number(update.previousBalance);
      if (changeRatio > this.suspiciousActivityThresholds.rapidBalanceChangeThreshold) {
        this.logSuspiciousActivity(update.userId, 'RAPID_BALANCE_CHANGE', {
          changeRatio,
          amount: update.amount.toString(),
          previousBalance: update.previousBalance.toString(),
        });
      }
    }
  }

  private logSuspiciousActivity(userId: string, reason: string, details: any): void {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
      userId,
      details: {
        reason,
        ...details,
      },
      severity: AuditSeverity.HIGH,
    };

    this.auditEvents.push(event);
    this.emit('auditEvent', event);
    this.emit('suspiciousActivity', event);
  }

  public getRecentUserActivity(userId: string, minutes: number): AuditEvent[] {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    return this.auditEvents.filter(
      event => event.userId === userId && event.timestamp >= cutoff
    );
  }

  public async generateAuditReport(startDate: Date, endDate: Date): Promise<AuditReport> {
    const events = this.auditEvents.filter(
      event => event.timestamp >= startDate && event.timestamp <= endDate
    );

    const eventsByType: Record<AuditEventType, number> = {} as any;
    const eventsBySeverity: Record<AuditSeverity, number> = {} as any;
    const userActivityCount: Record<string, number> = {};

    for (const event of events) {
      // Count by type
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
      
      // Count by severity
      eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] || 0) + 1;
      
      // Track user activity
      userActivityCount[event.userId] = (userActivityCount[event.userId] || 0) + 1;
    }

    // Find flagged users (high activity or critical events)
    const flaggedUsers = Object.entries(userActivityCount)
      .filter(([userId, count]) => {
        const hasHighActivity = count > 50;
        const hasCriticalEvents = events.some(
          e => e.userId === userId && e.severity === AuditSeverity.CRITICAL
        );
        return hasHighActivity || hasCriticalEvents;
      })
      .map(([userId]) => userId);

    const report: AuditReport = {
      startDate,
      endDate,
      totalEvents: events.length,
      eventsByType,
      eventsBySeverity,
      flaggedUsers,
      summary: this.generateSummary(events, flaggedUsers),
    };

    return report;
  }

  private generateSummary(events: AuditEvent[], flaggedUsers: string[]): string {
    const criticalEvents = events.filter(e => e.severity === AuditSeverity.CRITICAL);
    const suspiciousEvents = events.filter(e => e.eventType === AuditEventType.SUSPICIOUS_ACTIVITY);
    
    return `Audit period: ${events.length} total events. ` +
           `${criticalEvents.length} critical events. ` +
           `${suspiciousEvents.length} suspicious activities detected. ` +
           `${flaggedUsers.length} users flagged for review.`;
  }

  public async verifyBalanceIntegrity(userId: string, tokenAddress: Address): Promise<boolean> {
    try {
      const isValid = await this.balanceManager.verifyBalance(userId, tokenAddress);
      
      if (!isValid) {
        const event: AuditEvent = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          eventType: AuditEventType.BALANCE_VERIFICATION_FAILED,
          userId,
          details: {
            tokenAddress,
            message: 'Balance verification failed - computed balance does not match stored balance',
          },
          severity: AuditSeverity.CRITICAL,
        };
        
        this.auditEvents.push(event);
        this.emit('auditEvent', event);
        this.emit('integrityCheckFailed', event);
      }
      
      return isValid;
    } catch (error) {
      return false;
    }
  }

  public getAuditEvents(filters?: {
    userId?: string;
    eventType?: AuditEventType;
    severity?: AuditSeverity;
    startDate?: Date;
    endDate?: Date;
  }): AuditEvent[] {
    let events = [...this.auditEvents];
    
    if (filters?.userId) {
      events = events.filter(e => e.userId === filters.userId);
    }
    
    if (filters?.eventType) {
      events = events.filter(e => e.eventType === filters.eventType);
    }
    
    if (filters?.severity) {
      events = events.filter(e => e.severity === filters.severity);
    }
    
    if (filters?.startDate) {
      events = events.filter(e => e.timestamp >= filters.startDate);
    }
    
    if (filters?.endDate) {
      events = events.filter(e => e.timestamp <= filters.endDate);
    }
    
    return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
}