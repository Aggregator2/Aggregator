import { createLogger } from '../../utils/production-logger';
import { getWebSocketManager } from '../../config/websocket.config';
import { getPrismaClient } from '../../config/database.config';
import { 
  NotificationPayload,
  NotificationPreferences,
  NotificationType
} from '../../types/notifications';

const logger = createLogger('WebSocketNotificationService');
const prisma = getPrismaClient();

export class WebSocketNotificationService {
  private static instance: WebSocketNotificationService;
  
  private constructor() {}
  
  static getInstance(): WebSocketNotificationService {
    if (!WebSocketNotificationService.instance) {
      WebSocketNotificationService.instance = new WebSocketNotificationService();
    }
    return WebSocketNotificationService.instance;
  }
  
  /**
   * Send notification to user via WebSocket
   */
  async sendNotification(
    userId: string,
    payload: NotificationPayload
  ): Promise<boolean> {
    const timer = logger.startTimer('websocket_notification');
    
    try {
      // Check user preferences
      const preferences = await this.getUserPreferences(userId);
      if (!this.shouldSendNotification(payload.notification.type, preferences)) {
        logger.info('Notification blocked by user preferences', {
          userId,
          notificationType: payload.notification.type,
        });
        return true; // Consider it delivered since user doesn't want it
      }
      
      // Check if user is in do-not-disturb mode
      if (this.isInDoNotDisturb(preferences)) {
        logger.info('User in do-not-disturb mode', { userId });
        return false; // Will retry later
      }
      
      // Get WebSocket manager
      const wsManager = getWebSocketManager();
      
      // Send notification to all user's connections
      const sent = await wsManager.sendToUser(userId, {
        type: 'notification',
        data: payload,
      });
      
      timer();
      
      if (sent) {
        logger.info('WebSocket notification sent', {
          userId,
          notificationId: payload.notification.id,
        });
        
        // Increment unread count
        await this.incrementUnreadCount(userId);
      } else {
        logger.warn('User not connected via WebSocket', { userId });
      }
      
      return sent;
    } catch (error) {
      timer();
      logger.error('Failed to send WebSocket notification', error, {
        userId,
        notificationId: payload.notification.id,
      });
      throw error;
    }
  }
  
  /**
   * Send notification to multiple users
   */
  async broadcastNotification(
    userIds: string[],
    payload: NotificationPayload
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const sent = await this.sendNotification(userId, payload);
          results.set(userId, sent);
        } catch (error) {
          results.set(userId, false);
        }
      })
    );
    
    return results;
  }
  
  /**
   * Send notification to all connected users
   */
  async sendSystemNotification(payload: NotificationPayload): Promise<void> {
    const wsManager = getWebSocketManager();
    
    await wsManager.broadcast({
      type: 'system_notification',
      data: payload,
    });
    
    logger.info('System notification broadcasted', {
      notificationId: payload.notification.id,
    });
  }
  
  /**
   * Get user preferences
   */
  private async getUserPreferences(userId: string): Promise<NotificationPreferences | null> {
    const preferences = await prisma.notificationPreferences.findUnique({
      where: { userId },
    });
    
    if (!preferences) return null;
    
    return {
      userId: preferences.userId,
      webhooks: [],
      channels: preferences.channels as any,
      emailNotifications: preferences.emailNotifications,
      smsNotifications: preferences.smsNotifications,
      pushNotifications: preferences.pushNotifications,
      doNotDisturb: preferences.doNotDisturb,
      doNotDisturbStart: preferences.doNotDisturbStart || undefined,
      doNotDisturbEnd: preferences.doNotDisturbEnd || undefined,
    };
  }
  
  /**
   * Check if notification should be sent based on preferences
   */
  private shouldSendNotification(
    type: NotificationType | string,
    preferences: NotificationPreferences | null
  ): boolean {
    if (!preferences) return true; // Default to sending if no preferences
    
    // Check if WebSocket is enabled for this notification type
    const channels = preferences.channels[type as NotificationType];
    if (!channels || !channels.includes('websocket' as any)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Check if user is in do-not-disturb mode
   */
  private isInDoNotDisturb(preferences: NotificationPreferences | null): boolean {
    if (!preferences || !preferences.doNotDisturb) return false;
    
    if (!preferences.doNotDisturbStart || !preferences.doNotDisturbEnd) {
      return preferences.doNotDisturb; // Always on if no time range
    }
    
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    // Handle time range that crosses midnight
    if (preferences.doNotDisturbStart > preferences.doNotDisturbEnd) {
      return currentTime >= preferences.doNotDisturbStart || currentTime <= preferences.doNotDisturbEnd;
    } else {
      return currentTime >= preferences.doNotDisturbStart && currentTime <= preferences.doNotDisturbEnd;
    }
  }
  
  /**
   * Increment unread notification count
   */
  private async incrementUnreadCount(userId: string): Promise<void> {
    const wsManager = getWebSocketManager();
    
    // Get current unread count
    const unreadCount = await prisma.notification.count({
      where: {
        userId,
        read: false,
      }
    });
    
    // Send updated count
    await wsManager.sendToUser(userId, {
      type: 'unread_count',
      data: { count: unreadCount },
    });
  }
  
  /**
   * Mark notifications as read
   */
  async markAsRead(userId: string, notificationIds: string[]): Promise<void> {
    await prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        userId,
      },
      data: {
        read: true,
        readAt: new Date(),
      }
    });
    
    // Update unread count
    await this.incrementUnreadCount(userId);
    
    logger.info('Notifications marked as read', {
      userId,
      count: notificationIds.length,
    });
  }
  
  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      }
    });
    
    // Send zero unread count
    const wsManager = getWebSocketManager();
    await wsManager.sendToUser(userId, {
      type: 'unread_count',
      data: { count: 0 },
    });
    
    logger.info('All notifications marked as read', { userId });
  }
  
  /**
   * Get notification history for user
   */
  async getNotificationHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any[]> {
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        deliveries: {
          select: {
            channel: true,
            status: true,
            deliveredAt: true,
          }
        }
      }
    });
    
    return notifications;
  }
  
  /**
   * Subscribe to notification updates
   */
  async subscribeToUpdates(userId: string, connectionId: string): Promise<void> {
    const wsManager = getWebSocketManager();
    
    // Send initial unread count
    const unreadCount = await prisma.notification.count({
      where: {
        userId,
        read: false,
      }
    });
    
    await wsManager.sendToConnection(connectionId, {
      type: 'unread_count',
      data: { count: unreadCount },
    });
    
    // Send recent notifications
    const recentNotifications = await this.getNotificationHistory(userId, 10);
    
    await wsManager.sendToConnection(connectionId, {
      type: 'recent_notifications',
      data: recentNotifications,
    });
    
    logger.info('User subscribed to notification updates', {
      userId,
      connectionId,
    });
  }
}