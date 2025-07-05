import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { createLogger } from '../../utils/production-logger';
import { getPrismaClient } from '../../config/database.config';
import { 
  NotificationPayload, 
  NotificationDelivery,
  WebhookConfig,
  NotificationStatus,
  NotificationChannel
} from '../../types/notifications';

const logger = createLogger('WebhookDeliveryService');
const prisma = getPrismaClient();

export class WebhookDeliveryService {
  private static instance: WebhookDeliveryService;
  
  private constructor() {}
  
  static getInstance(): WebhookDeliveryService {
    if (!WebhookDeliveryService.instance) {
      WebhookDeliveryService.instance = new WebhookDeliveryService();
    }
    return WebhookDeliveryService.instance;
  }
  
  /**
   * Deliver notification via webhook
   */
  async deliverWebhook(
    webhook: WebhookConfig,
    payload: NotificationPayload,
    delivery: NotificationDelivery
  ): Promise<void> {
    const timer = logger.startTimer('webhook_delivery');
    
    try {
      // Generate signature if secret is configured
      const signature = webhook.secret 
        ? this.generateSignature(payload, webhook.secret)
        : undefined;
      
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
        'X-Notification-Id': payload.notification.id,
        'X-Notification-Type': payload.notification.type,
        'X-Timestamp': payload.timestamp,
        ...(signature && { 'X-Signature': signature }),
        ...(webhook.headers || {})
      };
      
      // Send webhook request
      const response = await axios.post(webhook.url, payload, {
        headers,
        timeout: 30000, // 30 seconds timeout
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
      });
      
      timer();
      
      // Check response status
      if (response.status >= 200 && response.status < 300) {
        await this.markDeliverySuccess(delivery.id);
        logger.info('Webhook delivered successfully', {
          webhookId: webhook.id,
          notificationId: payload.notification.id,
          status: response.status,
        });
      } else {
        // Client error (4xx) - don't retry
        await this.markDeliveryFailed(delivery.id, `HTTP ${response.status}: ${response.statusText}`);
        logger.warn('Webhook delivery failed with client error', {
          webhookId: webhook.id,
          notificationId: payload.notification.id,
          status: response.status,
          error: response.statusText,
        });
      }
    } catch (error) {
      timer();
      
      if (axios.isAxiosError(error)) {
        await this.handleDeliveryError(delivery, error);
      } else {
        await this.handleDeliveryError(delivery, new Error('Unknown error'));
      }
    }
  }
  
  /**
   * Generate HMAC signature for webhook payload
   */
  private generateSignature(payload: NotificationPayload, secret: string): string {
    const data = JSON.stringify(payload);
    return crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
  }
  
  /**
   * Handle delivery error and schedule retry
   */
  private async handleDeliveryError(
    delivery: NotificationDelivery,
    error: AxiosError | Error
  ): Promise<void> {
    const attempts = (delivery.attempts || 0) + 1;
    const maxAttempts = 5;
    
    logger.error('Webhook delivery failed', error, {
      deliveryId: delivery.id,
      attempts,
      error: error.message,
    });
    
    if (attempts >= maxAttempts) {
      await this.markDeliveryFailed(delivery.id, error.message);
      return;
    }
    
    // Calculate next retry time with exponential backoff
    const backoffSeconds = Math.pow(2, attempts - 1); // 1s, 2s, 4s, 8s, 16s
    const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);
    
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: NotificationStatus.RETRYING,
        attempts,
        lastAttemptAt: new Date(),
        nextRetryAt,
        error: error.message,
      },
    });
    
    logger.info('Webhook delivery scheduled for retry', {
      deliveryId: delivery.id,
      attempts,
      nextRetryAt,
    });
  }
  
  /**
   * Mark delivery as successful
   */
  private async markDeliverySuccess(deliveryId: string): Promise<void> {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: NotificationStatus.DELIVERED,
        deliveredAt: new Date(),
        error: null,
      },
    });
    
    // Update notification status if all deliveries are complete
    const delivery = await prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification: {
          include: {
            deliveries: true,
          },
        },
      },
    });
    
    if (delivery?.notification) {
      const allDelivered = delivery.notification.deliveries.every(
        d => d.status === NotificationStatus.DELIVERED || d.status === NotificationStatus.FAILED
      );
      
      if (allDelivered) {
        await prisma.notification.update({
          where: { id: delivery.notificationId },
          data: {
            status: NotificationStatus.DELIVERED,
            deliveredAt: new Date(),
          },
        });
      }
    }
  }
  
  /**
   * Mark delivery as failed
   */
  private async markDeliveryFailed(deliveryId: string, error: string): Promise<void> {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: NotificationStatus.FAILED,
        error,
        lastAttemptAt: new Date(),
      },
    });
    
    // Check if notification should be marked as failed
    const delivery = await prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification: {
          include: {
            deliveries: true,
          },
        },
      },
    });
    
    if (delivery?.notification) {
      const allFailed = delivery.notification.deliveries.every(
        d => d.status === NotificationStatus.FAILED
      );
      
      if (allFailed) {
        await prisma.notification.update({
          where: { id: delivery.notificationId },
          data: {
            status: NotificationStatus.FAILED,
          },
        });
      }
    }
  }
  
  /**
   * Verify webhook signature (for incoming webhooks)
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
  
  /**
   * Test webhook configuration
   */
  async testWebhook(webhook: WebhookConfig): Promise<{
    success: boolean;
    statusCode?: number;
    error?: string;
    duration?: number;
  }> {
    const testPayload: NotificationPayload = {
      notification: {
        id: 'test-' + Date.now(),
        userId: webhook.userId,
        type: 'order_placed' as any,
        priority: 'low' as any,
        title: 'Test Notification',
        message: 'This is a test webhook notification',
        data: {},
        channels: [NotificationChannel.WEBHOOK],
        status: NotificationStatus.PENDING,
        read: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      timestamp: new Date().toISOString(),
    };
    
    const start = Date.now();
    
    try {
      const signature = webhook.secret 
        ? this.generateSignature(testPayload, webhook.secret)
        : undefined;
      
      const headers = {
        'Content-Type': 'application/json',
        'X-Notification-Id': testPayload.notification.id,
        'X-Notification-Type': 'test',
        'X-Timestamp': testPayload.timestamp,
        ...(signature && { 'X-Signature': signature }),
        ...(webhook.headers || {})
      };
      
      const response = await axios.post(webhook.url, testPayload, {
        headers,
        timeout: 10000, // 10 seconds timeout for test
      });
      
      const duration = Date.now() - start;
      
      return {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - start;
      
      if (axios.isAxiosError(error)) {
        return {
          success: false,
          statusCode: error.response?.status,
          error: error.message,
          duration,
        };
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      };
    }
  }
}