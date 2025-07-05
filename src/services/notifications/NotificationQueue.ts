import Redis from 'redis';
import Bull, { Queue, Job, JobOptions } from 'bull';
import { NotificationChannel, NotificationEvent, Notification, WebhookDelivery } from '../../types/notifications';
import { logger } from '../../utils/logger';

export interface NotificationJob {
  notificationId: string;
  userId: string;
  channel: NotificationChannel;
  data: any;
  attempt?: number;
}

export interface WebhookJob {
  deliveryId: string;
  notificationId: string;
  webhookUrl: string;
  payload: any;
  secret?: string;
  attempt: number;
}

export class NotificationQueueService {
  private redisClient: Redis.RedisClient;
  private notificationQueue: Queue<NotificationJob>;
  private webhookQueue: Queue<WebhookJob>;
  private emailQueue: Queue<NotificationJob>;
  private smsQueue: Queue<NotificationJob>;

  constructor(redisUrl: string) {
    // Initialize Redis client
    this.redisClient = Redis.createClient(redisUrl);
    
    // Initialize queues
    this.notificationQueue = new Bull('notifications', redisUrl);
    this.webhookQueue = new Bull('webhooks', redisUrl);
    this.emailQueue = new Bull('emails', redisUrl);
    this.smsQueue = new Bull('sms', redisUrl);

    this.setupErrorHandlers();
  }

  private setupErrorHandlers(): void {
    this.redisClient.on('error', (error) => {
      logger.error('Redis client error:', error);
    });

    this.notificationQueue.on('error', (error) => {
      logger.error('Notification queue error:', error);
    });

    this.webhookQueue.on('error', (error) => {
      logger.error('Webhook queue error:', error);
    });
  }

  /**
   * Add notification to the appropriate queue
   */
  async queueNotification(
    notification: Notification,
    channel: NotificationChannel
  ): Promise<void> {
    const job: NotificationJob = {
      notificationId: notification.id,
      userId: notification.userId,
      channel,
      data: notification,
      attempt: 1
    };

    const options: JobOptions = {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: true,
      removeOnFail: false
    };

    switch (channel) {
      case NotificationChannel.WEBSOCKET:
        // WebSocket notifications are handled in real-time, not queued
        await this.handleWebSocketNotification(notification);
        break;
        
      case NotificationChannel.WEBHOOK:
        await this.notificationQueue.add('webhook', job, options);
        break;
        
      case NotificationChannel.EMAIL:
        await this.emailQueue.add('send', job, {
          ...options,
          delay: this.getEmailDelay(notification)
        });
        break;
        
      case NotificationChannel.SMS:
        await this.smsQueue.add('send', job, options);
        break;
    }

    logger.info(`Queued ${channel} notification`, {
      notificationId: notification.id,
      userId: notification.userId
    });
  }

  /**
   * Queue webhook delivery with exponential backoff
   */
  async queueWebhookDelivery(
    delivery: WebhookDelivery,
    payload: any,
    secret?: string
  ): Promise<void> {
    const job: WebhookJob = {
      deliveryId: delivery.id,
      notificationId: delivery.notificationId,
      webhookUrl: delivery.webhookUrl,
      payload,
      secret,
      attempt: delivery.attemptNumber
    };

    // Calculate exponential backoff delay
    const delay = this.calculateBackoffDelay(delivery.attemptNumber);

    await this.webhookQueue.add('deliver', job, {
      attempts: 1, // We handle retries manually
      delay,
      removeOnComplete: true,
      removeOnFail: false
    });

    logger.info('Queued webhook delivery', {
      deliveryId: delivery.id,
      attempt: delivery.attemptNumber,
      delay
    });
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    // Base delay: 1 second
    // Max delay: 24 hours
    const baseDelay = 1000;
    const maxDelay = 24 * 60 * 60 * 1000;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 1m, 2m, 4m, 8m, 16m, 32m, 1h, 2h...
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    
    // Add jitter (±10%) to prevent thundering herd
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    
    return Math.floor(delay + jitter);
  }

  /**
   * Get email delay based on batch settings
   */
  private getEmailDelay(notification: Notification): number {
    // TODO: Implement batch notification logic
    // For now, send immediately
    return 0;
  }

  /**
   * Handle WebSocket notification (real-time)
   */
  private async handleWebSocketNotification(notification: Notification): Promise<void> {
    // Store in Redis for WebSocket service to pick up
    const key = `ws:notification:${notification.userId}`;
    await this.setRedisValue(key, JSON.stringify(notification), 60); // 60 second TTL
    
    // Publish to Redis channel for WebSocket service
    await this.publishToRedis(`notifications:${notification.userId}`, {
      type: 'notification:new',
      notification,
      timestamp: new Date()
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    notifications: any;
    webhooks: any;
    emails: any;
    sms: any;
  }> {
    const [notificationStats, webhookStats, emailStats, smsStats] = await Promise.all([
      this.getQueueInfo(this.notificationQueue),
      this.getQueueInfo(this.webhookQueue),
      this.getQueueInfo(this.emailQueue),
      this.getQueueInfo(this.smsQueue)
    ]);

    return {
      notifications: notificationStats,
      webhooks: webhookStats,
      emails: emailStats,
      sms: smsStats
    };
  }

  private async getQueueInfo(queue: Queue): Promise<any> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount()
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + delayed
    };
  }

  /**
   * Batch notifications for a user
   */
  async batchUserNotifications(userId: string): Promise<Notification[]> {
    const key = `batch:${userId}`;
    const batch = await this.getRedisValue(key);
    
    if (!batch) {
      return [];
    }

    const notifications: Notification[] = JSON.parse(batch);
    await this.deleteRedisKey(key);
    
    return notifications;
  }

  /**
   * Add notification to batch
   */
  async addToBatch(notification: Notification, batchIntervalMinutes: number): Promise<void> {
    const key = `batch:${notification.userId}`;
    const ttl = batchIntervalMinutes * 60;
    
    const existing = await this.getRedisValue(key);
    const batch: Notification[] = existing ? JSON.parse(existing) : [];
    
    batch.push(notification);
    await this.setRedisValue(key, JSON.stringify(batch), ttl);
  }

  // Redis helper methods
  private async setRedisValue(key: string, value: string, ttl?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ttl) {
        this.redisClient.setex(key, ttl, value, (err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        this.redisClient.set(key, value, (err) => {
          if (err) reject(err);
          else resolve();
        });
      }
    });
  }

  private async getRedisValue(key: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      this.redisClient.get(key, (err, value) => {
        if (err) reject(err);
        else resolve(value);
      });
    });
  }

  private async deleteRedisKey(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.redisClient.del(key, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async publishToRedis(channel: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.redisClient.publish(channel, JSON.stringify(data), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    await Promise.all([
      this.notificationQueue.close(),
      this.webhookQueue.close(),
      this.emailQueue.close(),
      this.smsQueue.close()
    ]);
    
    this.redisClient.quit();
  }
}