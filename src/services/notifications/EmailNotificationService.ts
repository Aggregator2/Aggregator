import { createLogger } from '../../utils/production-logger';
import { NotificationPayload } from '../../types/notifications';

const logger = createLogger('EmailNotificationService');

export class EmailNotificationService {
  private static instance: EmailNotificationService;
  
  private constructor() {}
  
  static getInstance(): EmailNotificationService {
    if (!EmailNotificationService.instance) {
      EmailNotificationService.instance = new EmailNotificationService();
    }
    return EmailNotificationService.instance;
  }
  
  /**
   * Send notification via email
   */
  async sendNotification(
    userId: string,
    payload: NotificationPayload
  ): Promise<void> {
    // TODO: Implement email sending logic
    // This would typically use a service like SendGrid, AWS SES, etc.
    
    logger.info('Email notification sent (stub)', {
      userId,
      notificationId: payload.notification.id,
      type: payload.notification.type,
    });
    
    // For now, just log the email that would be sent
    const emailContent = this.formatEmailContent(payload);
    logger.debug('Email content', { userId, content: emailContent });
  }
  
  /**
   * Format notification as email content
   */
  private formatEmailContent(payload: NotificationPayload): {
    subject: string;
    html: string;
    text: string;
  } {
    const { notification } = payload;
    
    return {
      subject: notification.title,
      html: `
        <h2>${notification.title}</h2>
        <p>${notification.message}</p>
        ${this.formatNotificationData(notification.data)}
        <hr>
        <p style="color: #666; font-size: 12px;">
          This notification was sent at ${payload.timestamp}
        </p>
      `,
      text: `${notification.title}\n\n${notification.message}\n\n${JSON.stringify(notification.data, null, 2)}`,
    };
  }
  
  /**
   * Format notification data as HTML
   */
  private formatNotificationData(data: any): string {
    if (!data || Object.keys(data).length === 0) return '';
    
    let html = '<h3>Details:</h3><ul>';
    
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        html += `<li><strong>${this.formatKey(key)}:</strong> ${value}</li>`;
      }
    }
    
    html += '</ul>';
    return html;
  }
  
  /**
   * Format key for display
   */
  private formatKey(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }
}