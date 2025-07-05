import { notificationService } from '../NotificationService';
import { notificationEventEmitter } from '../NotificationEventEmitter';
import { 
  NotificationType, 
  NotificationEvent, 
  NotificationPriority,
  Notification 
} from '../../../types/notifications';

describe('Notification Read/Unread Status', () => {
  let createdNotifications: Notification[] = [];
  const testUserId = 'test_user_123';

  beforeEach(() => {
    createdNotifications = [];
  });

  afterEach(async () => {
    // Clean up created notifications
    for (const notification of createdNotifications) {
      try {
        await notificationService.deleteNotification(notification.id, testUserId);
      } catch (error) {
        // Ignore errors if notification already deleted
      }
    }
  });

  describe('Database Storage', () => {
    it('should create notification with read=false by default', async () => {
      const notification = await notificationService.createNotification({
        userId: testUserId,
        type: NotificationType.ORDER,
        event: NotificationEvent.ORDER_FILLED,
        title: 'Order Filled',
        message: 'Your order has been filled',
        data: { orderId: '123' }
      });

      createdNotifications.push(notification);

      expect(notification.read).toBe(false);
      expect(notification.readAt).toBeUndefined();
    });

    it('should update read status to true with timestamp', async () => {
      // Create notification
      const notification = await notificationService.createNotification({
        userId: testUserId,
        type: NotificationType.ORDER,
        event: NotificationEvent.ORDER_FILLED,
        title: 'Order Filled',
        message: 'Your order has been filled',
        data: { orderId: '124' }
      });

      createdNotifications.push(notification);

      // Mark as read
      const beforeUpdate = new Date();
      const updatedNotification = await notificationService.updateNotification(
        notification.id,
        testUserId,
        { read: true }
      );

      expect(updatedNotification.read).toBe(true);
      expect(updatedNotification.readAt).toBeDefined();
      expect(new Date(updatedNotification.readAt!).getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
    });

    it('should mark all notifications as read', async () => {
      // Create multiple notifications
      const notifications = await Promise.all([
        notificationService.createNotification({
          userId: testUserId,
          type: NotificationType.ORDER,
          event: NotificationEvent.ORDER_FILLED,
          title: 'Order 1',
          message: 'Order 1 filled',
          data: { orderId: '125' }
        }),
        notificationService.createNotification({
          userId: testUserId,
          type: NotificationType.ORDER,
          event: NotificationEvent.ORDER_FILLED,
          title: 'Order 2',
          message: 'Order 2 filled',
          data: { orderId: '126' }
        }),
        notificationService.createNotification({
          userId: testUserId,
          type: NotificationType.TRADE,
          event: NotificationEvent.TRADE_EXECUTED,
          title: 'Trade Executed',
          message: 'Your trade was executed',
          data: { tradeId: '789' }
        })
      ]);

      createdNotifications.push(...notifications);

      // Mark all as read
      const count = await notificationService.markAllAsRead(testUserId);
      expect(count).toBe(3);

      // Verify all are marked as read
      const { notifications: allNotifications } = await notificationService.getNotifications({
        userId: testUserId,
        read: false
      });

      expect(allNotifications.length).toBe(0);
    });

    it('should correctly filter by read status', async () => {
      // Create mix of read and unread notifications
      const unreadNotif = await notificationService.createNotification({
        userId: testUserId,
        type: NotificationType.ORDER,
        event: NotificationEvent.ORDER_FILLED,
        title: 'Unread Order',
        message: 'This is unread',
        data: { orderId: '127' }
      });

      const readNotif = await notificationService.createNotification({
        userId: testUserId,
        type: NotificationType.ORDER,
        event: NotificationEvent.ORDER_FILLED,
        title: 'Read Order',
        message: 'This is read',
        data: { orderId: '128' }
      });

      createdNotifications.push(unreadNotif, readNotif);

      // Mark one as read
      await notificationService.updateNotification(
        readNotif.id,
        testUserId,
        { read: true }
      );

      // Query unread only
      const { notifications: unreadList, unreadCount } = await notificationService.getNotifications({
        userId: testUserId,
        read: false
      });

      expect(unreadCount).toBe(1);
      expect(unreadList.length).toBe(1);
      expect(unreadList[0].id).toBe(unreadNotif.id);

      // Query read only
      const { notifications: readList } = await notificationService.getNotifications({
        userId: testUserId,
        read: true
      });

      expect(readList.length).toBe(1);
      expect(readList[0].id).toBe(readNotif.id);
    });
  });

  describe('Real-time Updates', () => {
    it('should emit notification:updated event when marking as read', async (done) => {
      const notification = await notificationService.createNotification({
        userId: testUserId,
        type: NotificationType.ORDER,
        event: NotificationEvent.ORDER_FILLED,
        title: 'Test Order',
        message: 'Test message',
        data: { orderId: '129' }
      });

      createdNotifications.push(notification);

      // Listen for update event
      notificationEventEmitter.once('notification:updated', (updatedNotif) => {
        expect(updatedNotif.id).toBe(notification.id);
        expect(updatedNotif.read).toBe(true);
        done();
      });

      // Mark as read
      await notificationService.updateNotification(
        notification.id,
        testUserId,
        { read: true }
      );
    });

    it('should emit notification:read event specifically for read status changes', async (done) => {
      const notification = await notificationService.createNotification({
        userId: testUserId,
        type: NotificationType.ORDER,
        event: NotificationEvent.ORDER_FILLED,
        title: 'Test Order',
        message: 'Test message',
        data: { orderId: '130' }
      });

      createdNotifications.push(notification);

      // Listen for read event
      notificationEventEmitter.once('notification:read', (data) => {
        expect(data.notification.id).toBe(notification.id);
        expect(data.notification.read).toBe(true);
        expect(data.userId).toBe(testUserId);
        done();
      });

      // Mark as read
      await notificationService.updateNotification(
        notification.id,
        testUserId,
        { read: true }
      );
    });

    it('should emit notification:allRead event when marking all as read', async (done) => {
      // Create multiple notifications
      const notifications = await Promise.all([
        notificationService.createNotification({
          userId: testUserId,
          type: NotificationType.ORDER,
          event: NotificationEvent.ORDER_FILLED,
          title: 'Order 1',
          message: 'Order 1 filled',
          data: { orderId: '131' }
        }),
        notificationService.createNotification({
          userId: testUserId,
          type: NotificationType.ORDER,
          event: NotificationEvent.ORDER_FILLED,
          title: 'Order 2',
          message: 'Order 2 filled',
          data: { orderId: '132' }
        })
      ]);

      createdNotifications.push(...notifications);

      // Listen for allRead event
      notificationEventEmitter.once('notification:allRead', (data) => {
        expect(data.userId).toBe(testUserId);
        expect(data.count).toBe(2);
        done();
      });

      // Mark all as read
      await notificationService.markAllAsRead(testUserId);
    });
  });

  describe('TypeScript Types', () => {
    it('should have correct TypeScript types for read status', () => {
      // This is a compile-time test
      const notification: Notification = {
        id: 'test',
        userId: 'user',
        type: NotificationType.ORDER,
        event: NotificationEvent.ORDER_FILLED,
        title: 'Test',
        message: 'Test',
        read: false, // boolean
        readAt: undefined, // Date | undefined
        archived: false,
        channels: [],
        deliveryStatus: {},
        priority: NotificationPriority.MEDIUM,
        createdAt: new Date()
      };

      // TypeScript will error if types are incorrect
      expect(typeof notification.read).toBe('boolean');
      expect(notification.readAt).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle marking already read notification as read', async () => {
      const notification = await notificationService.createNotification({
        userId: testUserId,
        type: NotificationType.ORDER,
        event: NotificationEvent.ORDER_FILLED,
        title: 'Test Order',
        message: 'Test message',
        data: { orderId: '133' }
      });

      createdNotifications.push(notification);

      // Mark as read first time
      const firstUpdate = await notificationService.updateNotification(
        notification.id,
        testUserId,
        { read: true }
      );

      const firstReadAt = firstUpdate.readAt;

      // Mark as read again
      const secondUpdate = await notificationService.updateNotification(
        notification.id,
        testUserId,
        { read: true }
      );

      // readAt should remain the same
      expect(secondUpdate.readAt).toEqual(firstReadAt);
    });

    it('should handle marking read notification as unread', async () => {
      const notification = await notificationService.createNotification({
        userId: testUserId,
        type: NotificationType.ORDER,
        event: NotificationEvent.ORDER_FILLED,
        title: 'Test Order',
        message: 'Test message',
        data: { orderId: '134' }
      });

      createdNotifications.push(notification);

      // Mark as read
      await notificationService.updateNotification(
        notification.id,
        testUserId,
        { read: true }
      );

      // Mark as unread
      const unreadNotification = await notificationService.updateNotification(
        notification.id,
        testUserId,
        { read: false }
      );

      expect(unreadNotification.read).toBe(false);
      expect(unreadNotification.readAt).toBe(null);
    });
  });
});