import { createLogger } from '../../utils/production-logger';
import { getPrismaClient } from '../../config/database.config';
import { NotificationQueueService } from './NotificationQueue';
import { WebhookDeliveryService } from './WebhookDeliveryService';
import { notificationEventEmitter } from './NotificationEventEmitter';
import { 
  Notification,
  NotificationType,
  NotificationEvent,
  NotificationPriority,
  NotificationChannel,
  NotificationStatus,
  NotificationData,
  CreateNotificationInput,
  UpdateNotificationInput,
  NotificationFilter,
  NotificationStats,
  NotificationPreferences,
  WebhookConfig
} from '../../types/notifications';

const logger = createLogger('NotificationService');
const prisma = getPrismaClient();

export class NotificationService {
  private static instance: NotificationService;
  private queueService: NotificationQueueService;
  private webhookService: WebhookDeliveryService;
  
  private constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.queueService = new NotificationQueueService(redisUrl);
    this.webhookService = WebhookDeliveryService.getInstance();
  }
  
  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }
  
  /**
   * Create and queue a notification
   */
  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    const timer = logger.startTimer('create_notification');
    
    try {
      // Get user preferences to determine channels
      const preferences = await this.getUserNotificationPreferences(input.userId, input.event);
      
      // Determine which channels to use
      const channels = await this.determineNotificationChannels(
        input.userId,
        input.type,
        input.event,
        input.priority || NotificationPriority.MEDIUM,
        preferences
      );
      
      // Create notification record
      const notification = await prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          event: input.event,
          title: input.title,
          message: input.message,
          data: input.data as any,
          priority: input.priority || NotificationPriority.MEDIUM,
          groupId: input.groupId,
          expiresAt: input.expiresAt,
          read: false,
          archived: false,
          channels: channels as any,
          deliveryStatus: this.initializeDeliveryStatus(channels),
          status: NotificationStatus.PENDING,
        },
      });
      
      // Queue for delivery to each channel
      for (const channel of channels) {
        await this.queueService.queueNotification(
          notification as unknown as Notification,
          channel
        );
      }
      
      timer();
      logger.info('Notification created', {
        notificationId: notification.id,
        userId: input.userId,
        type: input.type,
        event: input.event,
        channels,
      });
      
      const fullNotification = notification as unknown as Notification;
      
      // Emit event for real-time updates
      notificationEventEmitter.emit('notification:created', fullNotification);
      
      return fullNotification;
    } catch (error) {
      timer();
      logger.error('Failed to create notification', error, input);
      throw error;
    }
  }
  
  /**
   * Update notification (mark as read, archive, etc.)
   */
  async updateNotification(
    notificationId: string,
    userId: string,
    update: UpdateNotificationInput
  ): Promise<Notification> {
    const notification = await prisma.notification.update({
      where: {
        id: notificationId,
        userId, // Ensure user owns the notification
      },
      data: {
        ...(update.read !== undefined && {
          read: update.read,
          readAt: update.read ? new Date() : null,
        }),
        ...(update.archived !== undefined && {
          archived: update.archived,
        }),
      },
    });
    
    logger.info('Notification updated', {
      notificationId,
      userId,
      update,
    });
    
    const fullNotification = notification as unknown as Notification;
    
    // Emit event for real-time updates
    notificationEventEmitter.emit('notification:updated', fullNotification);
    
    // Special event for read status changes
    if (update.read !== undefined) {
      notificationEventEmitter.emit('notification:read', {
        notification: fullNotification,
        userId
      });
    }
    
    return fullNotification;
  }
  
  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    await prisma.notification.delete({
      where: {
        id: notificationId,
        userId, // Ensure user owns the notification
      },
    });
    
    logger.info('Notification deleted', {
      notificationId,
      userId,
    });
    
    // Emit event for real-time updates
    notificationEventEmitter.emit('notification:deleted', {
      notificationId,
      userId
    });
  }
  
  /**
   * Get notifications with filtering
   */
  async getNotifications(filter: NotificationFilter): Promise<{
    notifications: Notification[];
    total: number;
    unreadCount: number;
  }> {
    const where: any = {};
    
    if (filter.userId) where.userId = filter.userId;
    if (filter.type) where.type = filter.type;
    if (filter.event) where.event = filter.event;
    if (filter.read !== undefined) where.read = filter.read;
    if (filter.archived !== undefined) where.archived = filter.archived;
    if (filter.priority) where.priority = filter.priority;
    if (filter.groupId) where.groupId = filter.groupId;
    
    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }
    
    // Exclude expired notifications
    where.OR = [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
    ];
    
    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.limit || 20,
        skip: filter.offset || 0,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          ...where,
          read: false,
        },
      }),
    ]);
    
    return {
      notifications: notifications as unknown as Notification[],
      total,
      unreadCount,
    };
  }
  
  /**
   * Get notification statistics for a user
   */
  async getNotificationStats(userId: string): Promise<NotificationStats> {
    const [total, unread, byType, byPriority] = await Promise.all([
      prisma.notification.count({
        where: { userId },
      }),
      prisma.notification.count({
        where: { userId, read: false },
      }),
      prisma.notification.groupBy({
        by: ['type'],
        where: { userId },
        _count: true,
      }),
      prisma.notification.groupBy({
        by: ['priority'],
        where: { userId },
        _count: true,
      }),
    ]);
    
    const typeStats: Record<NotificationType, number> = {} as any;
    byType.forEach(item => {
      typeStats[item.type as NotificationType] = item._count;
    });
    
    const priorityStats: Record<NotificationPriority, number> = {} as any;
    byPriority.forEach(item => {
      priorityStats[item.priority as NotificationPriority] = item._count;
    });
    
    return {
      totalCount: total,
      unreadCount: unread,
      byType: typeStats,
      byPriority: priorityStats,
    };
  }
  
  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });
    
    logger.info('Marked all notifications as read', {
      userId,
      count: result.count,
    });
    
    // Emit event for real-time updates
    notificationEventEmitter.emit('notification:allRead', {
      userId,
      count: result.count
    });
    
    return result.count;
  }
  
  /**
   * Get user notification preferences
   */
  async getUserNotificationPreferences(
    userId: string,
    event: NotificationEvent
  ): Promise<NotificationPreferences[]> {
    const preferences = await prisma.notificationPreferences.findMany({
      where: {
        userId,
        enabled: true,
      },
    });
    
    // Filter by event subscription
    return preferences.filter(pref => {
      const eventKey = this.eventToPreferenceKey(event);
      return pref[eventKey] === true;
    }) as unknown as NotificationPreferences[];
  }
  
  /**
   * Update user notification preferences
   */
  async updateNotificationPreferences(
    userId: string,
    channel: NotificationChannel,
    preferences: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    const updated = await prisma.notificationPreferences.upsert({
      where: {
        userId_channel: {
          userId,
          channel: channel as any,
        },
      },
      update: preferences as any,
      create: {
        userId,
        channel: channel as any,
        ...preferences,
      } as any,
    });
    
    logger.info('Updated notification preferences', {
      userId,
      channel,
    });
    
    return updated as unknown as NotificationPreferences;
  }
  
  /**
   * Test webhook configuration
   */
  async testWebhook(userId: string, webhookUrl: string, secret?: string): Promise<{
    success: boolean;
    statusCode?: number;
    error?: string;
    duration?: number;
  }> {
    const webhook: WebhookConfig = {
      id: 'test',
      userId,
      url: webhookUrl,
      secret,
      active: true,
      events: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    return await this.webhookService.testWebhook(webhook);
  }
  
  /**
   * Determine which channels to use for a notification
   */
  private async determineNotificationChannels(
    userId: string,
    type: NotificationType,
    event: NotificationEvent,
    priority: NotificationPriority,
    preferences: NotificationPreferences[]
  ): Promise<NotificationChannel[]> {
    const channels = new Set<NotificationChannel>();
    
    // Add channels from user preferences
    for (const pref of preferences) {
      if (pref.enabled) {
        channels.add(pref.channel);
      }
    }
    
    // For urgent notifications, always include WebSocket
    if (priority === NotificationPriority.URGENT) {
      channels.add(NotificationChannel.WEBSOCKET);
    }
    
    // If no channels configured, use WebSocket as default
    if (channels.size === 0) {
      channels.add(NotificationChannel.WEBSOCKET);
    }
    
    return Array.from(channels);
  }
  
  /**
   * Initialize delivery status for channels
   */
  private initializeDeliveryStatus(
    channels: NotificationChannel[]
  ): Record<NotificationChannel, NotificationStatus> {
    const status: any = {};
    
    for (const channel of channels) {
      status[channel] = NotificationStatus.PENDING;
    }
    
    return status;
  }
  
  /**
   * Map event to preference key
   */
  private eventToPreferenceKey(event: NotificationEvent): string {
    const mapping: Record<NotificationEvent, string> = {
      [NotificationEvent.ORDER_CREATED]: 'orderCreated',
      [NotificationEvent.ORDER_FILLED]: 'orderFilled',
      [NotificationEvent.ORDER_PARTIALLY_FILLED]: 'orderPartiallyFilled',
      [NotificationEvent.ORDER_CANCELLED]: 'orderCancelled',
      [NotificationEvent.ORDER_REJECTED]: 'orderRejected',
      [NotificationEvent.TRADE_EXECUTED]: 'tradeExecuted',
      [NotificationEvent.SETTLEMENT_COMPLETED]: 'settlementCompleted',
      [NotificationEvent.DEPOSIT_RECEIVED]: 'depositReceived',
      [NotificationEvent.WITHDRAWAL_COMPLETED]: 'withdrawalCompleted',
      [NotificationEvent.SYSTEM_MAINTENANCE]: 'true', // Always allowed
      [NotificationEvent.SYSTEM_UPDATE]: 'true', // Always allowed
    };
    
    return mapping[event] || 'true';
  }
  
  /**
   * Clean up expired notifications
   */
  async cleanupExpiredNotifications(): Promise<number> {
    const result = await prisma.notification.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    
    logger.info('Cleaned up expired notifications', {
      count: result.count,
    });
    
    return result.count;
  }
}

// Export singleton instance
export const notificationService = NotificationService.getInstance();