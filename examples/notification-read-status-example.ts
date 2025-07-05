/**
 * Example: Notification Read/Unread Status Implementation
 * 
 * This example demonstrates how the notification system handles read/unread status
 * with database persistence and real-time updates.
 */

import { notificationService } from '../src/services/notifications/NotificationService';
import { WebSocketService } from '../src/services/websocket/WebSocketService';
import { NotificationWebSocketHandlers } from '../src/services/websocket/NotificationWebSocketHandlers';
import { 
  NotificationType, 
  NotificationEvent, 
  NotificationPriority 
} from '../src/types/notifications';

// Example 1: Creating a notification (defaults to unread)
async function createOrderNotification(userId: string, orderId: string) {
  const notification = await notificationService.createNotification({
    userId,
    type: NotificationType.ORDER,
    event: NotificationEvent.ORDER_FILLED,
    title: 'Order Filled',
    message: `Your order #${orderId} has been filled`,
    data: {
      orderId,
      symbol: 'BTC/USD',
      quantity: '0.5',
      price: '45000',
      side: 'buy'
    },
    priority: NotificationPriority.HIGH
  });

  console.log('Created notification:', {
    id: notification.id,
    read: notification.read,        // false by default
    readAt: notification.readAt      // undefined by default
  });

  return notification;
}

// Example 2: Marking a single notification as read
async function markNotificationAsRead(notificationId: string, userId: string) {
  const updatedNotification = await notificationService.updateNotification(
    notificationId,
    userId,
    { read: true }
  );

  console.log('Marked as read:', {
    id: updatedNotification.id,
    read: updatedNotification.read,      // true
    readAt: updatedNotification.readAt    // timestamp when marked as read
  });

  // This automatically triggers:
  // 1. 'notification:updated' event
  // 2. 'notification:read' event
  // 3. WebSocket update to connected clients
  // 4. Unread count update
}

// Example 3: Marking all notifications as read
async function markAllAsRead(userId: string) {
  const count = await notificationService.markAllAsRead(userId);
  
  console.log(`Marked ${count} notifications as read`);
  
  // This automatically triggers:
  // 1. 'notification:allRead' event
  // 2. WebSocket update setting unread count to 0
}

// Example 4: Querying notifications by read status
async function getUnreadNotifications(userId: string) {
  const { notifications, unreadCount } = await notificationService.getNotifications({
    userId,
    read: false,  // Only unread notifications
    limit: 20
  });

  console.log(`Found ${unreadCount} unread notifications`);
  
  return notifications;
}

// Example 5: Batch update multiple notifications
async function batchMarkAsRead(userId: string, notificationIds: string[]) {
  const updates = await Promise.all(
    notificationIds.map(id => 
      notificationService.updateNotification(id, userId, { read: true })
    )
  );

  console.log(`Marked ${updates.length} notifications as read`);
  return updates;
}

// Example 6: React component handling real-time updates
const NotificationExample = () => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { socket } = useWebSocket();

  useEffect(() => {
    if (!socket) return;

    // Listen for read status updates
    socket.on('notification:read', (event) => {
      setNotifications(prev => 
        prev.map(n => n.id === event.notification.id 
          ? { ...n, read: true, readAt: event.notification.readAt }
          : n
        )
      );
    });

    // Listen for unread count updates
    socket.on('notifications:unreadCount', (data) => {
      setUnreadCount(data.count);
    });

    // Listen for all marked as read
    socket.on('notifications:allRead', () => {
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    });

    return () => {
      socket.off('notification:read');
      socket.off('notifications:unreadCount');
      socket.off('notifications:allRead');
    };
  }, [socket]);

  const handleMarkAsRead = async (notificationId: string) => {
    await fetch(`/api/notifications/${notificationId}/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
  };

  const handleMarkAllAsRead = async () => {
    await fetch('/api/notifications/read-all', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
  };

  return (
    <div>
      <div className="notification-header">
        <h3>Notifications</h3>
        {unreadCount > 0 && (
          <button onClick={handleMarkAllAsRead}>
            Mark all as read
          </button>
        )}
      </div>
      
      {notifications.map(notification => (
        <div 
          key={notification.id} 
          className={`notification ${!notification.read ? 'unread' : ''}`}
          onClick={() => !notification.read && handleMarkAsRead(notification.id)}
        >
          <div className="notification-content">
            <h4>{notification.title}</h4>
            <p>{notification.message}</p>
            <span className="timestamp">
              {formatDistanceToNow(notification.createdAt)} ago
            </span>
          </div>
          {!notification.read && <span className="unread-indicator">●</span>}
        </div>
      ))}
    </div>
  );
};

// Example 7: API endpoint for batch marking as read
app.put('/api/notifications/batch-read', async (req, res) => {
  const { userId, notificationIds } = req.body;
  
  const results = await Promise.all(
    notificationIds.map(async (id) => {
      try {
        const notification = await notificationService.updateNotification(
          id,
          userId,
          { read: true }
        );
        return { success: true, notification };
      } catch (error) {
        return { success: false, error: error.message, notificationId: id };
      }
    })
  );

  const successCount = results.filter(r => r.success).length;
  
  res.json({
    updated: successCount,
    total: notificationIds.length,
    results
  });
});

// Example 8: Database query for read/unread statistics
async function getNotificationStats(userId: string) {
  const [total, unread, read] = await Promise.all([
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, read: false } }),
    prisma.notification.count({ where: { userId, read: true } })
  ]);

  return {
    total,
    unread,
    read,
    readPercentage: total > 0 ? (read / total * 100).toFixed(1) : 0
  };
}

// Example 9: Scheduled cleanup of old read notifications
async function cleanupOldReadNotifications() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const deleted = await prisma.notification.deleteMany({
    where: {
      read: true,
      readAt: { lt: thirtyDaysAgo }
    }
  });

  console.log(`Deleted ${deleted.count} old read notifications`);
}

// Example 10: WebSocket handler setup
function setupNotificationHandlers(io: Server) {
  const wsService = new WebSocketService(io);
  const notificationHandlers = new NotificationWebSocketHandlers(wsService);

  // The handlers automatically listen for:
  // - notification:created
  // - notification:updated
  // - notification:read
  // - notification:allRead
  
  // And emit to clients:
  // - notification:new
  // - notification:update
  // - notification:read
  // - notifications:unreadCount
  // - notifications:allRead
}

export {
  createOrderNotification,
  markNotificationAsRead,
  markAllAsRead,
  getUnreadNotifications,
  batchMarkAsRead,
  getNotificationStats,
  cleanupOldReadNotifications
};