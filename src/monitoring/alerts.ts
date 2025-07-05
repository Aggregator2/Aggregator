import { EventEmitter } from 'events';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { createLogger } from '../utils/production-logger';

const logger = createLogger('AlertManager');

// Alert severity levels
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

// Alert types
export enum AlertType {
  // System alerts
  HIGH_CPU_USAGE = 'high_cpu_usage',
  HIGH_MEMORY_USAGE = 'high_memory_usage',
  LOW_DISK_SPACE = 'low_disk_space',
  
  // Service alerts
  SERVICE_DOWN = 'service_down',
  DATABASE_CONNECTION_FAILED = 'database_connection_failed',
  EXTERNAL_API_ERROR = 'external_api_error',
  
  // Trading alerts
  ORDER_FAILED = 'order_failed',
  SETTLEMENT_FAILED = 'settlement_failed',
  LARGE_SLIPPAGE = 'large_slippage',
  INSUFFICIENT_LIQUIDITY = 'insufficient_liquidity',
  
  // Security alerts
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  UNAUTHORIZED_ACCESS = 'unauthorized_access',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  
  // Business alerts
  LOW_BALANCE = 'low_balance',
  HIGH_GAS_PRICE = 'high_gas_price',
  PROFIT_THRESHOLD = 'profit_threshold',
  VOLUME_SPIKE = 'volume_spike',
}

// Alert interface
export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  resolved?: boolean;
  resolvedAt?: Date;
}

// Alert rule interface
export interface AlertRule {
  id: string;
  type: AlertType;
  condition: (value: any) => boolean;
  threshold: any;
  severity: AlertSeverity;
  cooldown: number; // milliseconds
  lastTriggered?: Date;
}

// Alert manager class
export class AlertManager extends EventEmitter {
  private alerts: Map<string, Alert> = new Map();
  private rules: Map<string, AlertRule> = new Map();
  private emailTransporter?: nodemailer.Transporter;
  
  constructor() {
    super();
    this.initializeRules();
    this.initializeEmailTransporter();
  }
  
  // Initialize default alert rules
  private initializeRules() {
    // System alerts
    this.addRule({
      id: 'cpu-usage',
      type: AlertType.HIGH_CPU_USAGE,
      condition: (usage: number) => usage > 80,
      threshold: 80,
      severity: AlertSeverity.WARNING,
      cooldown: 5 * 60 * 1000, // 5 minutes
    });
    
    this.addRule({
      id: 'memory-usage',
      type: AlertType.HIGH_MEMORY_USAGE,
      condition: (usage: number) => usage > 85,
      threshold: 85,
      severity: AlertSeverity.WARNING,
      cooldown: 5 * 60 * 1000,
    });
    
    // Trading alerts
    this.addRule({
      id: 'settlement-failure-rate',
      type: AlertType.SETTLEMENT_FAILED,
      condition: (rate: number) => rate > 5,
      threshold: 5,
      severity: AlertSeverity.ERROR,
      cooldown: 15 * 60 * 1000,
    });
    
    this.addRule({
      id: 'high-slippage',
      type: AlertType.LARGE_SLIPPAGE,
      condition: (slippage: number) => slippage > 2,
      threshold: 2,
      severity: AlertSeverity.WARNING,
      cooldown: 10 * 60 * 1000,
    });
    
    // Business alerts
    this.addRule({
      id: 'low-hot-wallet-balance',
      type: AlertType.LOW_BALANCE,
      condition: (balance: number) => balance < 0.5,
      threshold: 0.5,
      severity: AlertSeverity.ERROR,
      cooldown: 30 * 60 * 1000,
    });
    
    this.addRule({
      id: 'high-gas-price',
      type: AlertType.HIGH_GAS_PRICE,
      condition: (gasPrice: number) => gasPrice > 200,
      threshold: 200,
      severity: AlertSeverity.WARNING,
      cooldown: 10 * 60 * 1000,
    });
  }
  
  // Initialize email transporter
  private initializeEmailTransporter() {
    if (process.env.ALERT_EMAIL_SMTP_HOST) {
      this.emailTransporter = nodemailer.createTransporter({
        host: process.env.ALERT_EMAIL_SMTP_HOST,
        port: parseInt(process.env.ALERT_EMAIL_SMTP_PORT || '587'),
        secure: process.env.ALERT_EMAIL_SMTP_PORT === '465',
        auth: {
          user: process.env.ALERT_EMAIL_SMTP_USER,
          pass: process.env.ALERT_EMAIL_SMTP_PASS,
        },
      });
    }
  }
  
  // Add alert rule
  addRule(rule: AlertRule) {
    this.rules.set(rule.id, rule);
  }
  
  // Check alert rule
  async checkRule(ruleId: string, value: any): Promise<boolean> {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    
    // Check cooldown
    if (rule.lastTriggered) {
      const timeSinceLastTrigger = Date.now() - rule.lastTriggered.getTime();
      if (timeSinceLastTrigger < rule.cooldown) {
        return false;
      }
    }
    
    // Check condition
    if (rule.condition(value)) {
      rule.lastTriggered = new Date();
      await this.createAlert({
        type: rule.type,
        severity: rule.severity,
        title: this.getAlertTitle(rule.type),
        message: this.getAlertMessage(rule.type, value, rule.threshold),
        metadata: { value, threshold: rule.threshold },
      });
      return true;
    }
    
    return false;
  }
  
  // Create alert
  async createAlert(alertData: Omit<Alert, 'id' | 'timestamp'>): Promise<Alert> {
    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...alertData,
    };
    
    this.alerts.set(alert.id, alert);
    this.emit('alert', alert);
    
    // Send notifications based on severity
    await this.sendNotifications(alert);
    
    logger.warn('Alert created', {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
    });
    
    return alert;
  }
  
  // Send notifications
  private async sendNotifications(alert: Alert) {
    const promises: Promise<any>[] = [];
    
    // Always send to monitoring systems
    promises.push(this.sendToAlertManager(alert));
    
    // Send based on severity
    switch (alert.severity) {
      case AlertSeverity.CRITICAL:
        promises.push(this.sendToPagerDuty(alert));
        promises.push(this.sendToSlack(alert));
        promises.push(this.sendEmail(alert));
        break;
        
      case AlertSeverity.ERROR:
        promises.push(this.sendToSlack(alert));
        promises.push(this.sendEmail(alert));
        break;
        
      case AlertSeverity.WARNING:
        promises.push(this.sendToSlack(alert));
        break;
        
      case AlertSeverity.INFO:
        // Just log, no external notifications
        break;
    }
    
    await Promise.allSettled(promises);
  }
  
  // Send to Alert Manager (Prometheus)
  private async sendToAlertManager(alert: Alert) {
    if (!process.env.ALERT_MANAGER_URL) return;
    
    try {
      await axios.post(`${process.env.ALERT_MANAGER_URL}/api/v1/alerts`, [{
        labels: {
          alertname: alert.type,
          severity: alert.severity,
          service: 'aggregator',
          environment: process.env.NODE_ENV,
        },
        annotations: {
          summary: alert.title,
          description: alert.message,
        },
        generatorURL: `${process.env.APP_URL}/alerts/${alert.id}`,
      }]);
    } catch (error) {
      logger.error('Failed to send alert to Alert Manager', error);
    }
  }
  
  // Send to Slack
  private async sendToSlack(alert: Alert) {
    if (!process.env.ALERT_SLACK_WEBHOOK) return;
    
    try {
      const color = this.getSlackColor(alert.severity);
      await axios.post(process.env.ALERT_SLACK_WEBHOOK, {
        attachments: [{
          color,
          title: alert.title,
          text: alert.message,
          fields: [
            {
              title: 'Type',
              value: alert.type,
              short: true,
            },
            {
              title: 'Severity',
              value: alert.severity.toUpperCase(),
              short: true,
            },
            {
              title: 'Time',
              value: alert.timestamp.toISOString(),
              short: true,
            },
            {
              title: 'Environment',
              value: process.env.NODE_ENV,
              short: true,
            },
          ],
          footer: 'Aggregator Alert System',
          ts: Math.floor(alert.timestamp.getTime() / 1000),
        }],
      });
    } catch (error) {
      logger.error('Failed to send alert to Slack', error);
    }
  }
  
  // Send to PagerDuty
  private async sendToPagerDuty(alert: Alert) {
    if (!process.env.ALERT_PAGERDUTY_KEY) return;
    
    try {
      await axios.post('https://events.pagerduty.com/v2/enqueue', {
        routing_key: process.env.ALERT_PAGERDUTY_KEY,
        event_action: 'trigger',
        payload: {
          summary: alert.title,
          severity: alert.severity,
          source: 'aggregator',
          component: this.getComponent(alert.type),
          custom_details: {
            message: alert.message,
            type: alert.type,
            metadata: alert.metadata,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to send alert to PagerDuty', error);
    }
  }
  
  // Send email
  private async sendEmail(alert: Alert) {
    if (!this.emailTransporter || !process.env.ALERT_EMAIL_TO) return;
    
    try {
      await this.emailTransporter.sendMail({
        from: process.env.ALERT_EMAIL_FROM,
        to: process.env.ALERT_EMAIL_TO,
        subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        html: this.getEmailHtml(alert),
      });
    } catch (error) {
      logger.error('Failed to send alert email', error);
    }
  }
  
  // Resolve alert
  async resolveAlert(alertId: string) {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.resolved) return;
    
    alert.resolved = true;
    alert.resolvedAt = new Date();
    
    this.emit('alert:resolved', alert);
    
    logger.info('Alert resolved', {
      alertId: alert.id,
      type: alert.type,
      duration: alert.resolvedAt.getTime() - alert.timestamp.getTime(),
    });
  }
  
  // Get active alerts
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved);
  }
  
  // Get alerts by type
  getAlertsByType(type: AlertType): Alert[] {
    return Array.from(this.alerts.values()).filter(alert => alert.type === type);
  }
  
  // Helper methods
  private getAlertTitle(type: AlertType): string {
    const titles: Record<AlertType, string> = {
      [AlertType.HIGH_CPU_USAGE]: 'High CPU Usage Detected',
      [AlertType.HIGH_MEMORY_USAGE]: 'High Memory Usage Detected',
      [AlertType.LOW_DISK_SPACE]: 'Low Disk Space',
      [AlertType.SERVICE_DOWN]: 'Service Down',
      [AlertType.DATABASE_CONNECTION_FAILED]: 'Database Connection Failed',
      [AlertType.EXTERNAL_API_ERROR]: 'External API Error',
      [AlertType.ORDER_FAILED]: 'Order Execution Failed',
      [AlertType.SETTLEMENT_FAILED]: 'Settlement Failed',
      [AlertType.LARGE_SLIPPAGE]: 'Large Slippage Detected',
      [AlertType.INSUFFICIENT_LIQUIDITY]: 'Insufficient Liquidity',
      [AlertType.SUSPICIOUS_ACTIVITY]: 'Suspicious Activity Detected',
      [AlertType.UNAUTHORIZED_ACCESS]: 'Unauthorized Access Attempt',
      [AlertType.RATE_LIMIT_EXCEEDED]: 'Rate Limit Exceeded',
      [AlertType.LOW_BALANCE]: 'Low Wallet Balance',
      [AlertType.HIGH_GAS_PRICE]: 'High Gas Price',
      [AlertType.PROFIT_THRESHOLD]: 'Profit Threshold Alert',
      [AlertType.VOLUME_SPIKE]: 'Trading Volume Spike',
    };
    
    return titles[type] || 'Unknown Alert';
  }
  
  private getAlertMessage(type: AlertType, value: any, threshold: any): string {
    switch (type) {
      case AlertType.HIGH_CPU_USAGE:
        return `CPU usage is at ${value}%, exceeding threshold of ${threshold}%`;
      case AlertType.HIGH_MEMORY_USAGE:
        return `Memory usage is at ${value}%, exceeding threshold of ${threshold}%`;
      case AlertType.SETTLEMENT_FAILED:
        return `Settlement failure rate is ${value}%, exceeding threshold of ${threshold}%`;
      case AlertType.LARGE_SLIPPAGE:
        return `Slippage of ${value}% detected, exceeding threshold of ${threshold}%`;
      case AlertType.LOW_BALANCE:
        return `Wallet balance is ${value} ETH, below threshold of ${threshold} ETH`;
      case AlertType.HIGH_GAS_PRICE:
        return `Gas price is ${value} gwei, exceeding threshold of ${threshold} gwei`;
      default:
        return `Alert triggered: ${JSON.stringify({ value, threshold })}`;
    }
  }
  
  private getSlackColor(severity: AlertSeverity): string {
    const colors = {
      [AlertSeverity.INFO]: '#36a64f',
      [AlertSeverity.WARNING]: '#ff9900',
      [AlertSeverity.ERROR]: '#ff0000',
      [AlertSeverity.CRITICAL]: '#990000',
    };
    
    return colors[severity];
  }
  
  private getComponent(type: AlertType): string {
    if (type.includes('order') || type.includes('settlement')) return 'trading';
    if (type.includes('cpu') || type.includes('memory') || type.includes('disk')) return 'system';
    if (type.includes('database')) return 'database';
    if (type.includes('api')) return 'external';
    if (type.includes('security') || type.includes('suspicious')) return 'security';
    return 'general';
  }
  
  private getEmailHtml(alert: Alert): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: ${this.getEmailColor(alert.severity)};">
              ${alert.title}
            </h2>
            <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
            <p><strong>Type:</strong> ${alert.type}</p>
            <p><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
            <p><strong>Environment:</strong> ${process.env.NODE_ENV}</p>
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <p>${alert.message}</p>
            ${alert.metadata ? `
              <h3>Additional Details:</h3>
              <pre style="background: #f5f5f5; padding: 10px; overflow: auto;">
${JSON.stringify(alert.metadata, null, 2)}
              </pre>
            ` : ''}
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <p style="color: #666; font-size: 12px;">
              This is an automated alert from the Aggregator system.
            </p>
          </div>
        </body>
      </html>
    `;
  }
  
  private getEmailColor(severity: AlertSeverity): string {
    const colors = {
      [AlertSeverity.INFO]: '#36a64f',
      [AlertSeverity.WARNING]: '#ff9900',
      [AlertSeverity.ERROR]: '#ff0000',
      [AlertSeverity.CRITICAL]: '#990000',
    };
    
    return colors[severity];
  }
}

// Singleton instance
let alertManager: AlertManager | null = null;

export const getAlertManager = (): AlertManager => {
  if (!alertManager) {
    alertManager = new AlertManager();
  }
  return alertManager;
};