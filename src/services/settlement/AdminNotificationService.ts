import { EventEmitter } from 'events';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { WebClient } from '@slack/web-api';

export interface NotificationConfig {
  channels: {
    email: EmailConfig;
    slack: SlackConfig;
    pagerDuty: PagerDutyConfig;
    webhook: WebhookConfig;
    sms: SMSConfig;
  };
  recipients: NotificationRecipient[];
  templates: Map<string, NotificationTemplate>;
  rateLimits: {
    perHour: number;
    perDay: number;
  };
  quiet: {
    enabled: boolean;
    start: string; // "22:00"
    end: string; // "06:00"
    timezone: string;
  };
}

export interface EmailConfig {
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
  from: string;
}

export interface SlackConfig {
  enabled: boolean;
  token: string;
  defaultChannel: string;
  criticalChannel: string;
}

export interface PagerDutyConfig {
  enabled: boolean;
  integrationKey: string;
  serviceId: string;
}

export interface WebhookConfig {
  enabled: boolean;
  endpoints: Array<{
    url: string;
    secret?: string;
    events: string[];
  }>;
}

export interface SMSConfig {
  enabled: boolean;
  provider: 'twilio' | 'sns';
  config: any;
}

export interface NotificationRecipient {
  id: string;
  name: string;
  role: 'admin' | 'operator' | 'viewer';
  channels: {
    email?: string;
    slack?: string;
    phone?: string;
  };
  preferences: {
    severities: Array<'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'>;
    types: string[];
    quietHours: boolean;
  };
}

export interface NotificationTemplate {
  id: string;
  name: string;
  channels: Array<'email' | 'slack' | 'pagerduty' | 'webhook' | 'sms'>;
  subject: string;
  body: string;
  slackBlocks?: any[];
  variables: string[];
}

export interface NotificationEvent {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  title: string;
  message: string;
  data: any;
  timestamp: number;
  source: string;
}

export interface NotificationDelivery {
  notificationId: string;
  recipientId: string;
  channel: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  error?: string;
  sentAt?: number;
}

export class AdminNotificationService extends EventEmitter {
  private config: NotificationConfig;
  private emailTransporter?: nodemailer.Transporter;
  private slackClient?: WebClient;
  private notificationQueue: NotificationEvent[] = [];
  private deliveryLog: Map<string, NotificationDelivery[]> = new Map();
  private rateLimitCounters: Map<string, { hour: number; day: number; resetHour: number; resetDay: number }> = new Map();
  private isProcessing: boolean = false;

  constructor(config: NotificationConfig) {
    super();
    this.config = config;
    this.initializeChannels();
    this.startQueueProcessor();
  }

  private initializeChannels(): void {
    // Initialize email
    if (this.config.channels.email.enabled) {
      this.emailTransporter = nodemailer.createTransporter(this.config.channels.email.smtp);
    }

    // Initialize Slack
    if (this.config.channels.slack.enabled) {
      this.slackClient = new WebClient(this.config.channels.slack.token);
    }

    // Initialize other channels as needed
  }

  /**
   * Send notification to administrators
   */
  async notify(event: Omit<NotificationEvent, 'id' | 'timestamp'>): Promise<void> {
    const notification: NotificationEvent = {
      ...event,
      id: `NOTIF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };

    // Check if in quiet hours
    if (this.isInQuietHours() && event.severity !== 'CRITICAL') {
      this.notificationQueue.push(notification);
      return;
    }

    // Get eligible recipients
    const recipients = this.getEligibleRecipients(notification);
    
    if (recipients.length === 0) {
      this.emit('notification:no-recipients', notification);
      return;
    }

    // Create delivery records
    const deliveries: NotificationDelivery[] = [];
    
    for (const recipient of recipients) {
      // Check rate limits
      if (!this.checkRateLimit(recipient.id)) {
        continue;
      }

      // Determine channels to use
      const channels = this.determineChannels(notification, recipient);
      
      for (const channel of channels) {
        const delivery: NotificationDelivery = {
          notificationId: notification.id,
          recipientId: recipient.id,
          channel,
          status: 'PENDING',
          attempts: 0
        };
        deliveries.push(delivery);
      }
    }

    this.deliveryLog.set(notification.id, deliveries);

    // Process deliveries
    await this.processDeliveries(notification, deliveries);
  }

  /**
   * Process notification deliveries
   */
  private async processDeliveries(
    notification: NotificationEvent,
    deliveries: NotificationDelivery[]
  ): Promise<void> {
    const template = this.getTemplate(notification.type);
    
    for (const delivery of deliveries) {
      const recipient = this.config.recipients.find(r => r.id === delivery.recipientId);
      if (!recipient) continue;

      try {
        delivery.attempts++;
        
        switch (delivery.channel) {
          case 'email':
            await this.sendEmail(notification, recipient, template);
            break;
          case 'slack':
            await this.sendSlack(notification, recipient, template);
            break;
          case 'pagerduty':
            await this.sendPagerDuty(notification, template);
            break;
          case 'webhook':
            await this.sendWebhook(notification);
            break;
          case 'sms':
            await this.sendSMS(notification, recipient, template);
            break;
        }
        
        delivery.status = 'SENT';
        delivery.sentAt = Date.now();
        
        this.emit('notification:sent', {
          notificationId: notification.id,
          recipientId: recipient.id,
          channel: delivery.channel
        });
        
      } catch (error) {
        delivery.status = 'FAILED';
        delivery.error = error instanceof Error ? error.message : 'Unknown error';
        
        this.emit('notification:failed', {
          notificationId: notification.id,
          recipientId: recipient.id,
          channel: delivery.channel,
          error: delivery.error
        });
        
        // Retry logic
        if (delivery.attempts < 3) {
          setTimeout(() => {
            delivery.status = 'PENDING';
            this.processDeliveries(notification, [delivery]);
          }, 60000 * delivery.attempts); // Exponential backoff
        }
      }
    }
  }

  /**
   * Send email notification
   */
  private async sendEmail(
    notification: NotificationEvent,
    recipient: NotificationRecipient,
    template?: NotificationTemplate
  ): Promise<void> {
    if (!this.emailTransporter || !recipient.channels.email) {
      throw new Error('Email not configured');
    }

    const subject = template ? 
      this.interpolateTemplate(template.subject, notification) :
      `[${notification.severity}] ${notification.title}`;
      
    const body = template ?
      this.interpolateTemplate(template.body, notification) :
      this.formatEmailBody(notification);

    await this.emailTransporter.sendMail({
      from: this.config.channels.email.from,
      to: recipient.channels.email,
      subject,
      html: body,
      priority: notification.severity === 'CRITICAL' ? 'high' : 'normal'
    });
  }

  /**
   * Send Slack notification
   */
  private async sendSlack(
    notification: NotificationEvent,
    recipient: NotificationRecipient,
    template?: NotificationTemplate
  ): Promise<void> {
    if (!this.slackClient) {
      throw new Error('Slack not configured');
    }

    const channel = notification.severity === 'CRITICAL' ?
      this.config.channels.slack.criticalChannel :
      recipient.channels.slack || this.config.channels.slack.defaultChannel;

    const blocks = template?.slackBlocks || this.formatSlackBlocks(notification);

    await this.slackClient.chat.postMessage({
      channel,
      text: `${notification.severity}: ${notification.title}`,
      blocks,
      attachments: [{
        color: this.getSeverityColor(notification.severity),
        fields: [
          {
            title: 'Source',
            value: notification.source,
            short: true
          },
          {
            title: 'Time',
            value: new Date(notification.timestamp).toISOString(),
            short: true
          }
        ]
      }]
    });
  }

  /**
   * Send PagerDuty alert
   */
  private async sendPagerDuty(
    notification: NotificationEvent,
    template?: NotificationTemplate
  ): Promise<void> {
    if (!this.config.channels.pagerDuty.enabled || notification.severity !== 'CRITICAL') {
      return;
    }

    const payload = {
      routing_key: this.config.channels.pagerDuty.integrationKey,
      event_action: 'trigger',
      dedup_key: notification.id,
      payload: {
        summary: notification.title,
        source: notification.source,
        severity: 'error',
        custom_details: notification.data
      }
    };

    await axios.post('https://events.pagerduty.com/v2/enqueue', payload);
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(notification: NotificationEvent): Promise<void> {
    if (!this.config.channels.webhook.enabled) {
      return;
    }

    const endpoints = this.config.channels.webhook.endpoints.filter(
      ep => ep.events.includes(notification.type) || ep.events.includes('*')
    );

    for (const endpoint of endpoints) {
      const payload = {
        notification,
        timestamp: Date.now(),
        signature: this.generateWebhookSignature(notification, endpoint.secret)
      };

      await axios.post(endpoint.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': payload.signature
        }
      });
    }
  }

  /**
   * Send SMS notification
   */
  private async sendSMS(
    notification: NotificationEvent,
    recipient: NotificationRecipient,
    template?: NotificationTemplate
  ): Promise<void> {
    if (!this.config.channels.sms.enabled || !recipient.channels.phone) {
      return;
    }

    // Only send SMS for critical alerts
    if (notification.severity !== 'CRITICAL') {
      return;
    }

    const message = template ?
      this.interpolateTemplate(template.subject, notification) :
      `CRITICAL: ${notification.title} - ${notification.source}`;

    // Implementation depends on SMS provider
    this.emit('sms:send', {
      to: recipient.channels.phone,
      message
    });
  }

  /**
   * Process queued notifications
   */
  private startQueueProcessor(): void {
    setInterval(() => {
      if (!this.isInQuietHours() && this.notificationQueue.length > 0) {
        this.processQueue();
      }
    }, 60000); // Check every minute
  }

  private async processQueue(): Promise<void> {
    const toProcess = [...this.notificationQueue];
    this.notificationQueue = [];

    for (const notification of toProcess) {
      await this.notify(notification);
    }
  }

  /**
   * Check if currently in quiet hours
   */
  private isInQuietHours(): boolean {
    if (!this.config.quiet.enabled) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const startHour = parseInt(this.config.quiet.start.split(':')[0]);
    const endHour = parseInt(this.config.quiet.end.split(':')[0]);

    if (startHour <= endHour) {
      return currentHour >= startHour && currentHour < endHour;
    } else {
      return currentHour >= startHour || currentHour < endHour;
    }
  }

  /**
   * Get eligible recipients for notification
   */
  private getEligibleRecipients(notification: NotificationEvent): NotificationRecipient[] {
    return this.config.recipients.filter(recipient => {
      // Check severity preference
      if (!recipient.preferences.severities.includes(notification.severity)) {
        return false;
      }

      // Check type preference
      if (recipient.preferences.types.length > 0 && 
          !recipient.preferences.types.includes(notification.type)) {
        return false;
      }

      // Check quiet hours preference
      if (recipient.preferences.quietHours && this.isInQuietHours()) {
        return false;
      }

      return true;
    });
  }

  /**
   * Determine which channels to use
   */
  private determineChannels(
    notification: NotificationEvent,
    recipient: NotificationRecipient
  ): string[] {
    const channels: string[] = [];
    const template = this.getTemplate(notification.type);

    // Use template channels if available
    if (template) {
      for (const channel of template.channels) {
        if (this.isChannelAvailable(channel, recipient)) {
          channels.push(channel);
        }
      }
    } else {
      // Default channel selection based on severity
      switch (notification.severity) {
        case 'CRITICAL':
          if (this.isChannelAvailable('pagerduty', recipient)) channels.push('pagerduty');
          if (this.isChannelAvailable('sms', recipient)) channels.push('sms');
          if (this.isChannelAvailable('slack', recipient)) channels.push('slack');
          if (this.isChannelAvailable('email', recipient)) channels.push('email');
          break;
        case 'ERROR':
          if (this.isChannelAvailable('slack', recipient)) channels.push('slack');
          if (this.isChannelAvailable('email', recipient)) channels.push('email');
          break;
        case 'WARNING':
          if (this.isChannelAvailable('slack', recipient)) channels.push('slack');
          if (this.isChannelAvailable('email', recipient)) channels.push('email');
          break;
        case 'INFO':
          if (this.isChannelAvailable('email', recipient)) channels.push('email');
          break;
      }
    }

    // Always include webhooks
    if (this.config.channels.webhook.enabled) {
      channels.push('webhook');
    }

    return [...new Set(channels)]; // Remove duplicates
  }

  private isChannelAvailable(channel: string, recipient: NotificationRecipient): boolean {
    switch (channel) {
      case 'email':
        return this.config.channels.email.enabled && !!recipient.channels.email;
      case 'slack':
        return this.config.channels.slack.enabled && 
               (!!recipient.channels.slack || !!this.config.channels.slack.defaultChannel);
      case 'sms':
        return this.config.channels.sms.enabled && !!recipient.channels.phone;
      case 'pagerduty':
        return this.config.channels.pagerDuty.enabled;
      case 'webhook':
        return this.config.channels.webhook.enabled;
      default:
        return false;
    }
  }

  /**
   * Check rate limits
   */
  private checkRateLimit(recipientId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;

    let counter = this.rateLimitCounters.get(recipientId);
    if (!counter) {
      counter = { hour: 0, day: 0, resetHour: now, resetDay: now };
      this.rateLimitCounters.set(recipientId, counter);
    }

    // Reset counters if needed
    if (counter.resetHour < hourAgo) {
      counter.hour = 0;
      counter.resetHour = now;
    }
    if (counter.resetDay < dayAgo) {
      counter.day = 0;
      counter.resetDay = now;
    }

    // Check limits
    if (counter.hour >= this.config.rateLimits.perHour || 
        counter.day >= this.config.rateLimits.perDay) {
      return false;
    }

    // Increment counters
    counter.hour++;
    counter.day++;

    return true;
  }

  /**
   * Get notification template
   */
  private getTemplate(type: string): NotificationTemplate | undefined {
    return this.config.templates.get(type);
  }

  /**
   * Interpolate template variables
   */
  private interpolateTemplate(template: string, notification: NotificationEvent): string {
    let result = template;
    
    result = result.replace('{{severity}}', notification.severity);
    result = result.replace('{{title}}', notification.title);
    result = result.replace('{{message}}', notification.message);
    result = result.replace('{{source}}', notification.source);
    result = result.replace('{{timestamp}}', new Date(notification.timestamp).toISOString());
    
    // Replace data fields
    for (const [key, value] of Object.entries(notification.data)) {
      result = result.replace(`{{data.${key}}}`, String(value));
    }
    
    return result;
  }

  private formatEmailBody(notification: NotificationEvent): string {
    return `
      <h2>${notification.title}</h2>
      <p><strong>Severity:</strong> ${notification.severity}</p>
      <p><strong>Source:</strong> ${notification.source}</p>
      <p><strong>Time:</strong> ${new Date(notification.timestamp).toISOString()}</p>
      <p><strong>Message:</strong> ${notification.message}</p>
      <hr>
      <h3>Details:</h3>
      <pre>${JSON.stringify(notification.data, null, 2)}</pre>
    `;
  }

  private formatSlackBlocks(notification: NotificationEvent): any[] {
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: notification.title
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Severity:* ${notification.severity}`
          },
          {
            type: 'mrkdwn',
            text: `*Source:* ${notification.source}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: notification.message
        }
      }
    ];
  }

  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'CRITICAL': return '#FF0000';
      case 'ERROR': return '#FF6600';
      case 'WARNING': return '#FFCC00';
      case 'INFO': return '#0099FF';
      default: return '#808080';
    }
  }

  private generateWebhookSignature(notification: NotificationEvent, secret?: string): string {
    if (!secret) return '';
    
    const crypto = require('crypto');
    const payload = JSON.stringify(notification);
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  // Public methods
  addRecipient(recipient: NotificationRecipient): void {
    this.config.recipients.push(recipient);
    this.emit('recipient:added', recipient);
  }

  removeRecipient(recipientId: string): void {
    this.config.recipients = this.config.recipients.filter(r => r.id !== recipientId);
    this.emit('recipient:removed', recipientId);
  }

  updateRecipient(recipientId: string, updates: Partial<NotificationRecipient>): void {
    const recipient = this.config.recipients.find(r => r.id === recipientId);
    if (recipient) {
      Object.assign(recipient, updates);
      this.emit('recipient:updated', recipient);
    }
  }

  addTemplate(template: NotificationTemplate): void {
    this.config.templates.set(template.id, template);
    this.emit('template:added', template);
  }

  getDeliveryLog(notificationId?: string): NotificationDelivery[] {
    if (notificationId) {
      return this.deliveryLog.get(notificationId) || [];
    }
    
    const allDeliveries: NotificationDelivery[] = [];
    for (const deliveries of this.deliveryLog.values()) {
      allDeliveries.push(...deliveries);
    }
    return allDeliveries;
  }

  testNotification(recipientId: string, channel: string): Promise<void> {
    const testNotification: NotificationEvent = {
      id: 'TEST_' + Date.now(),
      type: 'TEST',
      severity: 'INFO',
      title: 'Test Notification',
      message: 'This is a test notification from the settlement system',
      data: { test: true },
      timestamp: Date.now(),
      source: 'AdminNotificationService'
    };

    const recipient = this.config.recipients.find(r => r.id === recipientId);
    if (!recipient) {
      throw new Error('Recipient not found');
    }

    const delivery: NotificationDelivery = {
      notificationId: testNotification.id,
      recipientId,
      channel,
      status: 'PENDING',
      attempts: 0
    };

    return this.processDeliveries(testNotification, [delivery]);
  }
}