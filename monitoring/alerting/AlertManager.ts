import { EventEmitter } from 'events';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import { SLAViolation } from '../sla/SLAMonitor';

export interface AlertConfig {
  email?: {
    enabled: boolean;
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      auth: {
        user: string;
        pass: string;
      };
    };
    recipients: string[];
    from: string;
  };
  slack?: {
    enabled: boolean;
    webhookUrl: string;
    channel: string;
    username?: string;
  };
  pagerduty?: {
    enabled: boolean;
    integrationKey: string;
    serviceId: string;
  };
  webhook?: {
    enabled: boolean;
    url: string;
    headers?: Record<string, string>;
  };
  thresholds: {
    criticalDelay: number; // seconds before critical alert
    aggregationWindow: number; // seconds to aggregate alerts
    maxAlertsPerWindow: number;
  };
}

export interface Alert {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: number;
  metadata?: any;
  source: string;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolved?: boolean;
  resolvedAt?: number;
}

export class AlertManager extends EventEmitter {
  private config: AlertConfig;
  private emailTransporter?: nodemailer.Transporter;
  private alerts: Map<string, Alert> = new Map();
  private alertQueue: Alert[] = [];
  private processingInterval?: NodeJS.Timeout;
  private aggregationBuffer: Map<string, Alert[]> = new Map();

  constructor(config: AlertConfig) {
    super();
    this.config = config;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Setup email transporter
    if (this.config.email?.enabled) {
      this.emailTransporter = nodemailer.createTransport(this.config.email.smtp);
      
      // Verify email configuration
      try {
        await this.emailTransporter.verify();
        console.log('✅ Email alerting configured successfully');
      } catch (error) {
        console.error('❌ Email configuration error:', error);
      }
    }

    // Start alert processing
    this.startProcessing();
  }

  private startProcessing(): void {
    this.processingInterval = setInterval(() => {
      this.processAlertQueue();
      this.processAggregatedAlerts();
    }, 1000); // Process every second
  }

  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
  }

  // Main alert creation method
  async createAlert(alert: Omit<Alert, 'id' | 'timestamp'>): Promise<void> {
    const fullAlert: Alert = {
      ...alert,
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    this.alerts.set(fullAlert.id, fullAlert);
    this.emit('alert-created', fullAlert);

    // Add to queue for processing
    this.alertQueue.push(fullAlert);
    
    // Log the alert
    console.log(`🚨 Alert: [${fullAlert.severity.toUpperCase()}] ${fullAlert.title}`);

    // For critical alerts, process immediately
    if (fullAlert.severity === 'critical') {
      await this.sendAlert(fullAlert);
    }
  }

  // Create alert from SLA violation
  async createAlertFromSLAViolation(violation: SLAViolation): Promise<void> {
    await this.createAlert({
      type: `sla_violation_${violation.type}`,
      severity: violation.severity,
      title: `SLA Violation: ${violation.metric}`,
      message: violation.message,
      source: 'sla_monitor',
      metadata: {
        violation,
        threshold: violation.threshold,
        actual: violation.actual,
        duration: violation.duration,
      },
    });
  }

  private async processAlertQueue(): Promise<void> {
    if (this.alertQueue.length === 0) return;

    // Group alerts by type for aggregation
    const alertsToProcess = [...this.alertQueue];
    this.alertQueue = [];

    for (const alert of alertsToProcess) {
      const key = `${alert.type}_${alert.severity}`;
      
      if (!this.aggregationBuffer.has(key)) {
        this.aggregationBuffer.set(key, []);
      }
      
      this.aggregationBuffer.get(key)!.push(alert);
    }
  }

  private async processAggregatedAlerts(): Promise<void> {
    const now = Date.now();
    
    for (const [key, alerts] of this.aggregationBuffer) {
      // Check if aggregation window has passed
      const oldestAlert = alerts[0];
      if (now - oldestAlert.timestamp > this.config.thresholds.aggregationWindow * 1000) {
        // Send aggregated alert
        if (alerts.length === 1) {
          await this.sendAlert(alerts[0]);
        } else {
          await this.sendAggregatedAlert(key, alerts);
        }
        
        // Clear the buffer
        this.aggregationBuffer.delete(key);
      } else if (alerts.length >= this.config.thresholds.maxAlertsPerWindow) {
        // Send if we hit the max alerts threshold
        await this.sendAggregatedAlert(key, alerts);
        this.aggregationBuffer.delete(key);
      }
    }
  }

  private async sendAlert(alert: Alert): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.config.email?.enabled) {
      promises.push(this.sendEmailAlert(alert));
    }

    if (this.config.slack?.enabled) {
      promises.push(this.sendSlackAlert(alert));
    }

    if (this.config.pagerduty?.enabled && alert.severity === 'critical') {
      promises.push(this.sendPagerDutyAlert(alert));
    }

    if (this.config.webhook?.enabled) {
      promises.push(this.sendWebhookAlert(alert));
    }

    await Promise.allSettled(promises);
    this.emit('alert-sent', alert);
  }

  private async sendAggregatedAlert(key: string, alerts: Alert[]): Promise<void> {
    const firstAlert = alerts[0];
    const aggregatedAlert: Alert = {
      ...firstAlert,
      id: `aggregated-${Date.now()}`,
      title: `[Aggregated x${alerts.length}] ${firstAlert.title}`,
      message: `${alerts.length} similar alerts in ${this.config.thresholds.aggregationWindow}s window\n\nFirst: ${firstAlert.message}\nLast: ${alerts[alerts.length - 1].message}`,
      metadata: {
        aggregatedAlerts: alerts.map(a => ({ id: a.id, timestamp: a.timestamp })),
        count: alerts.length,
      },
    };

    await this.sendAlert(aggregatedAlert);
  }

  private async sendEmailAlert(alert: Alert): Promise<void> {
    if (!this.emailTransporter || !this.config.email) return;

    const severityColors = {
      low: '#2196F3',
      medium: '#FF9800',
      high: '#F44336',
      critical: '#D32F2F',
    };

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: ${severityColors[alert.severity]}; color: white; padding: 20px; border-radius: 5px 5px 0 0;">
          <h2 style="margin: 0;">${alert.severity.toUpperCase()} Alert</h2>
          <p style="margin: 5px 0 0 0;">${alert.title}</p>
        </div>
        <div style="background-color: #f5f5f5; padding: 20px; border: 1px solid #ddd; border-top: none;">
          <p><strong>Time:</strong> ${new Date(alert.timestamp).toLocaleString()}</p>
          <p><strong>Source:</strong> ${alert.source}</p>
          <p><strong>Message:</strong></p>
          <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 10px 0;">
            ${alert.message.replace(/\n/g, '<br>')}
          </div>
          ${alert.metadata ? `
            <p><strong>Additional Details:</strong></p>
            <pre style="background-color: white; padding: 15px; border-radius: 5px; overflow-x: auto;">
${JSON.stringify(alert.metadata, null, 2)}
            </pre>
          ` : ''}
        </div>
        <div style="background-color: #333; color: #999; padding: 10px; text-align: center; font-size: 12px;">
          Alert ID: ${alert.id}
        </div>
      </div>
    `;

    try {
      await this.emailTransporter.sendMail({
        from: this.config.email.from,
        to: this.config.email.recipients.join(', '),
        subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        html,
        text: `${alert.title}\n\n${alert.message}\n\nTime: ${new Date(alert.timestamp).toLocaleString()}\nSource: ${alert.source}`,
      });
    } catch (error) {
      console.error('Failed to send email alert:', error);
    }
  }

  private async sendSlackAlert(alert: Alert): Promise<void> {
    if (!this.config.slack) return;

    const severityEmojis = {
      low: ':information_source:',
      medium: ':warning:',
      high: ':exclamation:',
      critical: ':rotating_light:',
    };

    const severityColors = {
      low: '#2196F3',
      medium: '#FF9800',
      high: '#F44336',
      critical: '#D32F2F',
    };

    const payload = {
      channel: this.config.slack.channel,
      username: this.config.slack.username || 'Alert Bot',
      icon_emoji: severityEmojis[alert.severity],
      attachments: [
        {
          color: severityColors[alert.severity],
          title: alert.title,
          text: alert.message,
          fields: [
            {
              title: 'Severity',
              value: alert.severity.toUpperCase(),
              short: true,
            },
            {
              title: 'Source',
              value: alert.source,
              short: true,
            },
            {
              title: 'Time',
              value: new Date(alert.timestamp).toLocaleString(),
              short: true,
            },
            {
              title: 'Alert ID',
              value: alert.id,
              short: true,
            },
          ],
          footer: 'Trading System Alerts',
          ts: Math.floor(alert.timestamp / 1000),
        },
      ],
    };

    try {
      await axios.post(this.config.slack.webhookUrl, payload);
    } catch (error) {
      console.error('Failed to send Slack alert:', error);
    }
  }

  private async sendPagerDutyAlert(alert: Alert): Promise<void> {
    if (!this.config.pagerduty) return;

    const payload = {
      routing_key: this.config.pagerduty.integrationKey,
      event_action: 'trigger',
      dedup_key: alert.id,
      payload: {
        summary: alert.title,
        source: alert.source,
        severity: 'critical',
        timestamp: new Date(alert.timestamp).toISOString(),
        custom_details: {
          message: alert.message,
          metadata: alert.metadata,
        },
      },
    };

    try {
      await axios.post('https://events.pagerduty.com/v2/enqueue', payload);
    } catch (error) {
      console.error('Failed to send PagerDuty alert:', error);
    }
  }

  private async sendWebhookAlert(alert: Alert): Promise<void> {
    if (!this.config.webhook) return;

    try {
      await axios.post(
        this.config.webhook.url,
        alert,
        { headers: this.config.webhook.headers }
      );
    } catch (error) {
      console.error('Failed to send webhook alert:', error);
    }
  }

  // Alert management methods
  acknowledgeAlert(alertId: string, acknowledgedBy: string): void {
    const alert = this.alerts.get(alertId);
    if (alert && !alert.acknowledged) {
      alert.acknowledged = true;
      alert.acknowledgedBy = acknowledgedBy;
      alert.acknowledgedAt = Date.now();
      
      this.emit('alert-acknowledged', alert);
      
      // If PagerDuty is enabled, acknowledge there too
      if (this.config.pagerduty?.enabled && alert.severity === 'critical') {
        this.acknowledgePagerDutyAlert(alert);
      }
    }
  }

  resolveAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      
      this.emit('alert-resolved', alert);
      
      // If PagerDuty is enabled, resolve there too
      if (this.config.pagerduty?.enabled && alert.severity === 'critical') {
        this.resolvePagerDutyAlert(alert);
      }
    }
  }

  private async acknowledgePagerDutyAlert(alert: Alert): Promise<void> {
    if (!this.config.pagerduty) return;

    try {
      await axios.post('https://events.pagerduty.com/v2/enqueue', {
        routing_key: this.config.pagerduty.integrationKey,
        event_action: 'acknowledge',
        dedup_key: alert.id,
      });
    } catch (error) {
      console.error('Failed to acknowledge PagerDuty alert:', error);
    }
  }

  private async resolvePagerDutyAlert(alert: Alert): Promise<void> {
    if (!this.config.pagerduty) return;

    try {
      await axios.post('https://events.pagerduty.com/v2/enqueue', {
        routing_key: this.config.pagerduty.integrationKey,
        event_action: 'resolve',
        dedup_key: alert.id,
      });
    } catch (error) {
      console.error('Failed to resolve PagerDuty alert:', error);
    }
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(a => !a.resolved)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getAlertHistory(limit: number = 100): Alert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getAlertStats(): {
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    bySeverity: Record<string, number>;
    bySource: Record<string, number>;
  } {
    const alerts = Array.from(this.alerts.values());
    const stats = {
      total: alerts.length,
      active: 0,
      acknowledged: 0,
      resolved: 0,
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
      bySource: {} as Record<string, number>,
    };

    for (const alert of alerts) {
      if (!alert.resolved) stats.active++;
      if (alert.acknowledged) stats.acknowledged++;
      if (alert.resolved) stats.resolved++;
      
      stats.bySeverity[alert.severity]++;
      stats.bySource[alert.source] = (stats.bySource[alert.source] || 0) + 1;
    }

    return stats;
  }
}