import { WebSocketService } from './WebSocketService';
import { notificationEventEmitter } from '../notifications/NotificationEventEmitter';
import { 
  Notification, 
  NotificationWebSocketEvent,
  NotificationType,
  NotificationEvent,
  NotificationPriority
} from '../../types/notifications';
import { Order, OrderStatus } from '../matchingEngine/types';
import { logger } from '../../utils/logger';

export class NotificationWebSocketHandlers {
  private wsService: WebSocketService;

  constructor(wsService: WebSocketService) {
    this.wsService = wsService;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Listen for order status changes from matching engine
    this.wsService.on('order:status:changed', this.handleOrderStatusChange.bind(this));
    
    // Listen for trade executions
    this.wsService.on('trade:executed', this.handleTradeExecuted.bind(this));
    
    // Listen for settlement events
    this.wsService.on('settlement:completed', this.handleSettlementCompleted.bind(this));
    
    // Listen for notification-specific events from NotificationService
    notificationEventEmitter.on('notification:created', this.handleNotificationCreated.bind(this));
    notificationEventEmitter.on('notification:updated', this.handleNotificationUpdated.bind(this));
    notificationEventEmitter.on('notification:deleted', this.handleNotificationDeleted.bind(this));
    notificationEventEmitter.on('notification:read', this.handleNotificationRead.bind(this));
    notificationEventEmitter.on('notification:allRead', this.handleAllNotificationsRead.bind(this));
  }

  /**
   * Handle order status changes and send notifications
   */
  private async handleOrderStatusChange(data: {
    order: Order;
    previousStatus: OrderStatus;
    newStatus: OrderStatus;
    userId: string;
  }): Promise<void> {
    const { order, previousStatus, newStatus, userId } = data;

    // Determine notification event based on status change
    let event: NotificationEvent | null = null;
    let title: string = '';
    let message: string = '';
    let priority: NotificationPriority = NotificationPriority.MEDIUM;

    switch (newStatus) {
      case OrderStatus.FILLED:
        event = NotificationEvent.ORDER_FILLED;
        title = 'Order Filled';
        message = `Your ${order.side} order for ${order.quantity} ${order.pair} has been filled at ${order.price}`;
        priority = NotificationPriority.HIGH;
        break;

      case OrderStatus.PARTIALLY_FILLED:
        event = NotificationEvent.ORDER_PARTIALLY_FILLED;
        title = 'Order Partially Filled';
        message = `Your ${order.side} order for ${order.pair} has been partially filled (${order.filledQuantity}/${order.quantity})`;
        break;

      case OrderStatus.CANCELLED:
        event = NotificationEvent.ORDER_CANCELLED;
        title = 'Order Cancelled';
        message = `Your ${order.side} order for ${order.quantity} ${order.pair} has been cancelled`;
        priority = NotificationPriority.LOW;
        break;

      case OrderStatus.REJECTED:
        event = NotificationEvent.ORDER_REJECTED;
        title = 'Order Rejected';
        message = `Your ${order.side} order for ${order.quantity} ${order.pair} was rejected`;
        priority = NotificationPriority.HIGH;
        break;

      case OrderStatus.OPEN:
        if (previousStatus === OrderStatus.PENDING) {
          event = NotificationEvent.ORDER_CREATED;
          title = 'Order Created';
          message = `Your ${order.side} order for ${order.quantity} ${order.pair} has been created`;
        }
        break;
    }

    if (event) {
      const notification: Notification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type: NotificationType.ORDER,
        event,
        title,
        message,
        data: {
          orderId: order.id,
          orderType: order.type,
          side: order.side,
          symbol: order.pair,
          quantity: order.quantity.toString(),
          price: order.price?.toString(),
          filledQuantity: order.filledQuantity?.toString(),
          status: newStatus
        },
        read: false,
        archived: false,
        channels: [],
        deliveryStatus: {},
        priority,
        createdAt: new Date()
      };

      // Send via WebSocket
      this.sendNotificationToUser(userId, notification);
      
      // Emit event for notification service to process other channels
      this.wsService.emit('notification:process', notification);
    }
  }

  /**
   * Handle trade execution notifications
   */
  private async handleTradeExecuted(data: {
    trade: any; // Trade type from matching engine
    buyerUserId: string;
    sellerUserId: string;
  }): Promise<void> {
    const { trade, buyerUserId, sellerUserId } = data;

    // Create notification for buyer
    const buyerNotification: Notification = {
      id: `notif_${Date.now()}_buy_${Math.random().toString(36).substr(2, 9)}`,
      userId: buyerUserId,
      type: NotificationType.TRADE,
      event: NotificationEvent.TRADE_EXECUTED,
      title: 'Trade Executed',
      message: `Bought ${trade.quantity} ${trade.pair} at ${trade.price}`,
      data: {
        tradeId: trade.id,
        side: 'buy',
        symbol: trade.pair,
        quantity: trade.quantity.toString(),
        executionPrice: trade.price.toString(),
        fees: trade.buyerFee?.toString()
      },
      read: false,
      archived: false,
      channels: [],
      deliveryStatus: {},
      priority: NotificationPriority.HIGH,
      createdAt: new Date()
    };

    // Create notification for seller
    const sellerNotification: Notification = {
      id: `notif_${Date.now()}_sell_${Math.random().toString(36).substr(2, 9)}`,
      userId: sellerUserId,
      type: NotificationType.TRADE,
      event: NotificationEvent.TRADE_EXECUTED,
      title: 'Trade Executed',
      message: `Sold ${trade.quantity} ${trade.pair} at ${trade.price}`,
      data: {
        tradeId: trade.id,
        side: 'sell',
        symbol: trade.pair,
        quantity: trade.quantity.toString(),
        executionPrice: trade.price.toString(),
        fees: trade.sellerFee?.toString()
      },
      read: false,
      archived: false,
      channels: [],
      deliveryStatus: {},
      priority: NotificationPriority.HIGH,
      createdAt: new Date()
    };

    // Send notifications
    this.sendNotificationToUser(buyerUserId, buyerNotification);
    this.sendNotificationToUser(sellerUserId, sellerNotification);

    // Emit for other channels
    this.wsService.emit('notification:process', buyerNotification);
    this.wsService.emit('notification:process', sellerNotification);
  }

  /**
   * Handle settlement completion notifications
   */
  private async handleSettlementCompleted(data: {
    epochId: string;
    userSettlements: Array<{
      userId: string;
      currency: string;
      amount: string;
    }>;
  }): Promise<void> {
    const { epochId, userSettlements } = data;

    for (const settlement of userSettlements) {
      const notification: Notification = {
        id: `notif_${Date.now()}_settle_${Math.random().toString(36).substr(2, 9)}`,
        userId: settlement.userId,
        type: NotificationType.SETTLEMENT,
        event: NotificationEvent.SETTLEMENT_COMPLETED,
        title: 'Settlement Completed',
        message: `Settlement completed for ${settlement.amount} ${settlement.currency}`,
        data: {
          epochId,
          settlementAmount: settlement.amount,
          currency: settlement.currency
        },
        read: false,
        archived: false,
        channels: [],
        deliveryStatus: {},
        priority: NotificationPriority.MEDIUM,
        createdAt: new Date()
      };

      this.sendNotificationToUser(settlement.userId, notification);
      this.wsService.emit('notification:process', notification);
    }
  }

  /**
   * Handle notification created event
   */
  private handleNotificationCreated(notification: Notification): void {
    this.sendNotificationToUser(notification.userId, notification);
  }

  /**
   * Handle notification updated event
   */
  private handleNotificationUpdated(notification: Notification): void {
    const event: NotificationWebSocketEvent = {
      type: 'notification:update',
      notification,
      timestamp: new Date()
    };

    // Send to specific user
    this.wsService.sendToUser(notification.userId, 'notification:update', event);
  }

  /**
   * Handle notification deleted event
   */
  private handleNotificationDeleted(data: { notificationId: string; userId: string }): void {
    // Create a minimal notification object for the delete event
    const notification: Partial<Notification> = {
      id: data.notificationId,
      userId: data.userId
    };

    const event: NotificationWebSocketEvent = {
      type: 'notification:delete',
      notification: notification as Notification,
      timestamp: new Date()
    };

    this.wsService.sendToUser(data.userId, 'notification:delete', event);
  }

  /**
   * Handle notification read event
   */
  private handleNotificationRead(data: { notification: Notification; userId: string }): void {
    const event: NotificationWebSocketEvent = {
      type: 'notification:update',
      notification: data.notification,
      timestamp: new Date()
    };

    // Send to specific user
    this.wsService.sendToUser(data.userId, 'notification:read', event);
    
    // Also update unread count
    this.sendUnreadCountUpdate(data.userId);
  }

  /**
   * Handle all notifications marked as read
   */
  private handleAllNotificationsRead(data: { userId: string; count: number }): void {
    // Send event to user
    this.wsService.sendToUser(data.userId, 'notifications:allRead', {
      count: data.count,
      timestamp: new Date()
    });
    
    // Update unread count to 0
    this.wsService.sendToUser(data.userId, 'notifications:unreadCount', {
      count: 0,
      timestamp: new Date()
    });
  }

  /**
   * Send notification to user via WebSocket
   */
  private sendNotificationToUser(userId: string, notification: Notification): void {
    const event: NotificationWebSocketEvent = {
      type: 'notification:new',
      notification,
      timestamp: new Date()
    };

    // Send to user's notification channel
    const channel = `notifications:${userId}`;
    this.wsService.sendToChannel(channel, 'notification:new', event);

    // Also send to user-specific connection if available
    this.wsService.sendToUser(userId, 'notification:new', event);

    logger.info('Sent notification via WebSocket', {
      userId,
      notificationId: notification.id,
      type: notification.type,
      event: notification.event
    });
  }

  /**
   * Send unread count update
   */
  private async sendUnreadCountUpdate(userId: string): Promise<void> {
    try {
      // Get unread count from database
      const { getPrismaClient } = await import('../../config/database.config');
      const prisma = getPrismaClient();
      
      const unreadCount = await prisma.notification.count({
        where: {
          userId,
          read: false,
          archived: false
        }
      });

      this.wsService.sendToUser(userId, 'notifications:unreadCount', {
        count: unreadCount,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Failed to send unread count update', error);
    }
  }

  /**
   * Subscribe user to notification channel
   */
  subscribeUserToNotifications(userId: string, socketId: string): void {
    const channel = `notifications:${userId}`;
    this.wsService.subscribeToChannel(socketId, channel);
    
    logger.info('User subscribed to notifications', {
      userId,
      socketId,
      channel
    });
  }

  /**
   * Unsubscribe user from notification channel
   */
  unsubscribeUserFromNotifications(userId: string, socketId: string): void {
    const channel = `notifications:${userId}`;
    this.wsService.unsubscribeFromChannel(socketId, channel);
    
    logger.info('User unsubscribed from notifications', {
      userId,
      socketId,
      channel
    });
  }

  /**
   * Get notification statistics for WebSocket monitoring
   */
  getNotificationStats(): {
    connectedUsers: number;
    activeChannels: number;
    sentToday: number;
  } {
    // This would integrate with your WebSocket service stats
    return {
      connectedUsers: this.wsService.getConnectedUsersCount(),
      activeChannels: this.wsService.getActiveChannelsCount(),
      sentToday: 0 // Would need to track this separately
    };
  }
}

// Extend WebSocketService to add notification-specific methods
declare module './WebSocketService' {
  interface WebSocketService {
    sendToUser(userId: string, event: string, data: any): void;
    sendToChannel(channel: string, event: string, data: any): void;
    subscribeToChannel(socketId: string, channel: string): void;
    unsubscribeFromChannel(socketId: string, channel: string): void;
    getConnectedUsersCount(): number;
    getActiveChannelsCount(): number;
  }
}