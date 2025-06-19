import axios from 'axios';
import { logger } from '../utils/logger';

interface Alert {
  level: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  context?: any;
  timestamp: Date;
}

export class AlertService {
  private readonly slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  private readonly emailApiKey = process.env.EMAIL_API_KEY;
  private readonly emailEndpoint = process.env.EMAIL_ENDPOINT;

  async sendAlert(alert: Alert): Promise<void> {
    try {
      await Promise.allSettled([
        this.sendSlackAlert(alert),
        this.sendEmailAlert(alert),
        this.logAlert(alert)
      ]);
    } catch (error) {
      logger.error('Failed to send alert:', error);
    }
  }

  private async sendSlackAlert(alert: Alert): Promise<void> {
    if (!this.slackWebhookUrl) return;

    const color = this.getSlackColor(alert.level);
    const emoji = this.getEmoji(alert.level);
    
    const payload = {
      text: `${emoji} ${alert.title}`,
      attachments: [
        {
          color,
          fields: [
            {
              title: 'Level',
              value: alert.level.toUpperCase(),
              short: true
            },
            {
              title: 'Time',
              value: alert.timestamp.toISOString(),
              short: true
            },
            {
              title: 'Message',
              value: alert.message,
              short: false
            }
          ],
          footer: 'Aggregator DEX Monitoring',
          ts: Math.floor(alert.timestamp.getTime() / 1000)
        }
      ]
    };

    if (alert.context) {
      payload.attachments[0].fields.push({
        title: 'Context',
        value: `\`\`\`${JSON.stringify(alert.context, null, 2)}\`\`\``,
        short: false
      });
    }

    await axios.post(this.slackWebhookUrl, payload);
  }

  private async sendEmailAlert(alert: Alert): Promise<void> {
    if (!this.emailApiKey || !this.emailEndpoint) return;

    const payload = {
      to: process.env.ALERT_EMAIL || 'admin@aggregator.dev',
      subject: `[${alert.level.toUpperCase()}] ${alert.title}`,
      html: this.generateEmailHtml(alert)
    };

    await axios.post(this.emailEndpoint, payload, {
      headers: {
        'Authorization': `Bearer ${this.emailApiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  private logAlert(alert: Alert): void {
    const logMethod = alert.level === 'critical' || alert.level === 'error' ? 'error' : 
                     alert.level === 'warning' ? 'warn' : 'info';
    
    logger[logMethod]('ALERT: ' + alert.title, {
      level: alert.level,
      message: alert.message,
      context: alert.context,
      timestamp: alert.timestamp
    });
  }

  private getSlackColor(level: string): string {
    switch (level) {
      case 'critical': return 'danger';
      case 'error': return 'danger';
      case 'warning': return 'warning';
      default: return 'good';
    }
  }

  private getEmoji(level: string): string {
    switch (level) {
      case 'critical': return '🚨';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  }

  private generateEmailHtml(alert: Alert): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
            <h2 style="color: ${this.getEmailColor(alert.level)};">
              ${this.getEmoji(alert.level)} ${alert.title}
            </h2>
            <p><strong>Level:</strong> ${alert.level.toUpperCase()}</p>
            <p><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
            <p><strong>Message:</strong></p>
            <div style="background: white; padding: 15px; border-radius: 4px; border-left: 4px solid ${this.getEmailColor(alert.level)};">
              ${alert.message}
            </div>
            ${alert.context ? `
              <p><strong>Context:</strong></p>
              <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto;">
${JSON.stringify(alert.context, null, 2)}
              </pre>
            ` : ''}
            <hr style="margin: 20px 0;">
            <p style="color: #666; font-size: 12px;">
              This alert was sent by Aggregator DEX monitoring system.
            </p>
          </div>
        </body>
      </html>
    `;
  }

  private getEmailColor(level: string): string {
    switch (level) {
      case 'critical': return '#dc3545';
      case 'error': return '#dc3545';
      case 'warning': return '#ffc107';
      default: return '#17a2b8';
    }
  }

  // Convenience methods for different alert levels
  async critical(title: string, message: string, context?: any): Promise<void> {
    await this.sendAlert({
      level: 'critical',
      title,
      message,
      context,
      timestamp: new Date()
    });
  }

  async error(title: string, message: string, context?: any): Promise<void> {
    await this.sendAlert({
      level: 'error',
      title,
      message,
      context,
      timestamp: new Date()
    });
  }

  async warning(title: string, message: string, context?: any): Promise<void> {
    await this.sendAlert({
      level: 'warning',
      title,
      message,
      context,
      timestamp: new Date()
    });
  }

  async info(title: string, message: string, context?: any): Promise<void> {
    await this.sendAlert({
      level: 'info',
      title,
      message,
      context,
      timestamp: new Date()
    });
  }
}

export const alertService = new AlertService();