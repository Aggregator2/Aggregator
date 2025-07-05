import { createLogger } from '../../utils/production-logger';
import { getPrismaClient, getRedisClient } from '../../config/database.config';
import { WebhookDeliveryService } from './WebhookDeliveryService';
import { WebSocketNotificationService } from './WebSocketNotificationService';
import { EmailNotificationService } from './EmailNotificationService';
import { 
  Notification, 
  NotificationChannel, 
  NotificationStatus,
  NotificationPayload,
  NotificationDelivery,
  WebhookConfig
} from '../../types/notifications';

const logger = createLogger('NotificationQueueService');
const prisma = getPrismaClient();

interface QueuedNotification {
  notificationId: string;
  userId: string;
  channels: NotificationChannel[];
  priority: string;
  timestamp: string;
}

export class NotificationQueueService {
  private static instance: NotificationQueueService;
  private webhookService: WebhookDeliveryService;
  private websocketService?: WebSocketNotificationService;
  private emailService?: EmailNotificationService;
  private processingInterval?: NodeJS.Timeout;
  private retryInterval?: NodeJS.Timeout;
  
  private constructor() {
    this.webhookService = WebhookDeliveryService.getInstance();
  }
  
  static getInstance(): NotificationQueueService {
    if (!NotificationQueueService.instance) {
      NotificationQueueService.instance = new NotificationQueueService();
    }
    return NotificationQueueService.instance;
  }
  
  /**
   * Initialize the queue service and start processing
   */
  async initialize(
    websocketService?: WebSocketNotificationService,
    emailService?: EmailNotificationService
  ): Promise<void> {
    this.websocketService = websocketService;
    this.emailService = emailService;
    
    // Start processing queues
    this.startQueueProcessing();
    this.startRetryProcessing();
    
    logger.info('Notification queue service initialized');
  }
  
  /**
   * Shutdown the queue service
   */
  async shutdown(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
    }
    
    logger.info('Notification queue service shut down');
  }
  
  /**
   * Queue a notification for delivery
   */
  async queueNotification(
    notification: Notification,
    channels?: NotificationChannel[]
  ): Promise<void> {
    const timer = logger.startTimer('queue_notification');
    
    try {
      // Use specified channels or notification's default channels
      const deliveryChannels = channels || notification.channels;
      
      // Create delivery records for each channel
      const deliveries = await Promise.all(
        deliveryChannels.map(channel => 
          prisma.notificationDelivery.create({
            data: {
              notificationId: notification.id,
              channel,
              status: NotificationStatus.PENDING,
              attempts: 0,
            }
          })
        )
      );
      
      // Add to Redis queue for immediate processing
      const redis = getRedisClient();
      const queueData: QueuedNotification = {
        notificationId: notification.id,
        userId: notification.userId,
        channels: deliveryChannels,
        priority: notification.priority,
        timestamp: new Date().toISOString(),
      };
      
      // Use priority queue (ZADD with priority score)
      const priorityScore = this.getPriorityScore(notification.priority);
      await redis.zadd(
        'notification:queue',
        priorityScore,
        JSON.stringify(queueData)
      );
      
      timer();
      logger.info('Notification queued for delivery', {
        notificationId: notification.id,
        channels: deliveryChannels,
        priority: notification.priority,
      });
      
    } catch (error) {
      timer();
      logger.error('Failed to queue notification', error, {
        notificationId: notification.id,
      });
      throw error;
    }
  }
  
  /**
   * Process notifications from the queue
   */
  private startQueueProcessing(): void {
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueue();
      } catch (error) {
        logger.error('Error processing notification queue', error);
      }
    }, 1000); // Process every second
  }
  
  /**
   * Process retry queue for failed deliveries
   */
  private startRetryProcessing(): void {
    this.retryInterval = setInterval(async () => {
      try {
        await this.processRetries();
      } catch (error) {
        logger.error('Error processing retry queue', error);
      }
    }, 10000); // Check for retries every 10 seconds
  }
  
  /**
   * Process pending notifications from the queue
   */
  private async processQueue(): Promise<void> {
    const redis = getRedisClient();
    
    // Get highest priority notification
    const items = await redis.zrevrange('notification:queue', 0, 0);
    if (items.length === 0) return;
    
    const queueData: QueuedNotification = JSON.parse(items[0]);
    
    // Remove from queue
    await redis.zrem('notification:queue', items[0]);
    
    // Fetch full notification data
    const notification = await prisma.notification.findUnique({
      where: { id: queueData.notificationId },
      include: {
        deliveries: {
          where: {
            status: NotificationStatus.PENDING,
          }
        }
      }
    });
    
    if (!notification) {
      logger.warn('Notification not found', { notificationId: queueData.notificationId });
      return;
    }
    
    // Process each pending delivery
    await Promise.all(
      notification.deliveries.map(delivery => 
        this.processDelivery(notification, delivery)
      )
    );
  }
  
  /**
   * Process a single notification delivery
   */
  private async processDelivery(
    notification: Notification,
    delivery: NotificationDelivery
  ): Promise<void> {
    const timer = logger.startTimer('process_delivery');
    
    try {
      // Update delivery status to processing
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationStatus.RETRYING,
          lastAttemptAt: new Date(),
        }
      });
      
      // Prepare notification payload
      const payload: NotificationPayload = {
        notification,
        timestamp: new Date().toISOString(),
      };
      
      // Deliver based on channel
      switch (delivery.channel) {
        case NotificationChannel.WEBHOOK:
          await this.deliverViaWebhook(notification.userId, payload, delivery);
          break;
          
        case NotificationChannel.WEBSOCKET:
          await this.deliverViaWebSocket(notification.userId, payload, delivery);
          break;
          
        case NotificationChannel.EMAIL:
          await this.deliverViaEmail(notification.userId, payload, delivery);
          break;
          
        default:
          logger.warn('Unknown notification channel', { channel: delivery.channel });
      }
      
      timer();
    } catch (error) {
      timer();
      logger.error('Failed to process delivery', error, {
        deliveryId: delivery.id,
        channel: delivery.channel,
      });
    }
  }
  
  /**
   * Deliver notification via webhook
   */
  private async deliverViaWebhook(
    userId: string,
    payload: NotificationPayload,
    delivery: NotificationDelivery
  ): Promise<void> {
    // Get user's active webhooks for this notification type
    const webhooks = await prisma.webhookConfig.findMany({
      where: {
        userId,
        active: true,
        events: {
          has: payload.notification.type,
        }
      }
    });
    
    if (webhooks.length === 0) {
      // No webhooks configured, mark as failed
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationStatus.FAILED,
          error: 'No active webhooks configured',
        }
      });
      return;
    }
    
    // Deliver to each webhook
    await Promise.all(
      webhooks.map(webhook => 
        this.webhookService.deliverWebhook(webhook, payload, delivery)
      )
    );
  }
  
  /**
   * Deliver notification via WebSocket
   */
  private async deliverViaWebSocket(
    userId: string,
    payload: NotificationPayload,
    delivery: NotificationDelivery
  ): Promise<void> {
    if (!this.websocketService) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationStatus.FAILED,
          error: 'WebSocket service not available',
        }
      });
      return;
    }
    
    try {
      const delivered = await this.websocketService.sendNotification(userId, payload);
      
      if (delivered) {
        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: NotificationStatus.DELIVERED,
            deliveredAt: new Date(),
          }
        });
      } else {
        // User not connected, will retry later
        await this.scheduleRetry(delivery);
      }
    } catch (error) {
      await this.scheduleRetry(delivery, error as Error);
    }
  }
  
  /**
   * Deliver notification via email
   */
  private async deliverViaEmail(
    userId: string,
    payload: NotificationPayload,
    delivery: NotificationDelivery
  ): Promise<void> {
    if (!this.emailService) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationStatus.FAILED,
          error: 'Email service not available',
        }
      });
      return;
    }
    
    try {
      await this.emailService.sendNotification(userId, payload);
      
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationStatus.DELIVERED,
          deliveredAt: new Date(),
        }
      });
    } catch (error) {
      await this.scheduleRetry(delivery, error as Error);
    }
  }
  
  /**
   * Schedule a delivery for retry with exponential backoff
   */
  private async scheduleRetry(
    delivery: NotificationDelivery,
    error?: Error
  ): Promise<void> {
    const attempts = (delivery.attempts || 0) + 1;
    const maxAttempts = 5;
    
    if (attempts >= maxAttempts) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationStatus.FAILED,
          error: error?.message || 'Max retry attempts exceeded',
          attempts,
        }
      });
      return;
    }
    
    // Calculate exponential backoff
    const backoffSeconds = Math.pow(2, attempts - 1) * 60; // 1min, 2min, 4min, 8min
    const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);
    
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: NotificationStatus.RETRYING,
        attempts,
        nextRetryAt,
        error: error?.message,
      }
    });
    
    logger.info('Delivery scheduled for retry', {
      deliveryId: delivery.id,
      attempts,
      nextRetryAt,
    });
  }
  
  /**
   * Process deliveries that are ready for retry
   */
  private async processRetries(): Promise<void> {
    const now = new Date();
    
    // Find deliveries ready for retry
    const deliveries = await prisma.notificationDelivery.findMany({
      where: {
        status: NotificationStatus.RETRYING,
        nextRetryAt: {
          lte: now,
        }
      },
      include: {
        notification: true,
      }
    });
    
    if (deliveries.length === 0) return;
    
    logger.info(`Processing ${deliveries.length} retries`);
    
    // Process each retry
    await Promise.all(
      deliveries.map(delivery => 
        this.processDelivery(delivery.notification, delivery)
      )
    );
  }
  
  /**
   * Get priority score for queue ordering
   */
  private getPriorityScore(priority: string): number {
    const now = Date.now();
    switch (priority) {
      case 'urgent':
        return now + 1000000;
      case 'high':
        return now + 100000;
      case 'medium':
        return now + 10000;
      case 'low':
        return now;
      default:
        return now;
    }
  }
  
  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    pending: number;
    processing: number;
    retrying: number;
    delivered: number;
    failed: number;
  }> {
    const [pending, processing, retrying, delivered, failed] = await Promise.all([
      prisma.notificationDelivery.count({ where: { status: NotificationStatus.PENDING } }),
      prisma.notificationDelivery.count({ where: { status: NotificationStatus.RETRYING, nextRetryAt: null } }),
      prisma.notificationDelivery.count({ where: { status: NotificationStatus.RETRYING, nextRetryAt: { not: null } } }),
      prisma.notificationDelivery.count({ where: { status: NotificationStatus.DELIVERED } }),
      prisma.notificationDelivery.count({ where: { status: NotificationStatus.FAILED } }),
    ]);
    
    return {
      pending,
      processing,
      retrying,
      delivered,
      failed,
    };
  }
}