import React, { useState, useEffect, useRef } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import DOMPurify from 'dompurify';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationWebSocketEvent
} from '../src/types/notifications';

interface NotificationCenterProps {
  userId: string;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ userId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { socket, isConnected } = useWebSocket();

  // Fetch notifications
  const fetchNotifications = async (offset = 0) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/notifications?userId=${encodeURIComponent(userId)}&limit=20&offset=${offset}`);
      const data = await response.json();
      
      if (offset === 0) {
        setNotifications(data.notifications);
      } else {
        setNotifications(prev => [...prev, ...data.notifications]);
      }
      
      setUnreadCount(data.unreadCount);
      setHasMore(data.notifications.length === 20);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  // Subscribe to WebSocket notifications
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Subscribe to notification channel
    socket.emit('subscribe:notifications', { userId });

    // Handle new notifications
    const handleNewNotification = (event: NotificationWebSocketEvent) => {
      if (event.type === 'notification:new') {
        setNotifications(prev => [event.notification, ...prev]);
        setUnreadCount(prev => prev + 1);
        
        // Show browser notification if permitted
        if (Notification.permission === 'granted') {
          new Notification(DOMPurify.sanitize(event.notification.title), {
            body: DOMPurify.sanitize(event.notification.message),
            icon: '/icon-192x192.png',
            tag: event.notification.id,
          });
        }
      } else if (event.type === 'notification:update') {
        setNotifications(prev => 
          prev.map(n => n.id === event.notification.id ? event.notification : n)
        );
        
        // Update unread count if notification was marked as read
        if (event.notification.read) {
          setUnreadCount(prev => Math.max(0, prev - 1));
        }
      } else if (event.type === 'notification:delete') {
        setNotifications(prev => prev.filter(n => n.id !== event.notification.id));
        if (!event.notification.read) {
          setUnreadCount(prev => Math.max(0, prev - 1));
        }
      }
    };

    socket.on('notification:new', handleNewNotification);
    socket.on('notification:update', handleNewNotification);
    socket.on('notification:delete', handleNewNotification);
    
    // Handle read status updates
    socket.on('notification:read', (event: NotificationWebSocketEvent) => {
      setNotifications(prev => 
        prev.map(n => n.id === event.notification.id 
          ? { ...n, read: true, readAt: event.notification.readAt } 
          : n
        )
      );
    });
    
    // Handle unread count updates
    socket.on('notifications:unreadCount', (data: { count: number }) => {
      setUnreadCount(data.count);
    });
    
    // Handle all notifications marked as read
    socket.on('notifications:allRead', () => {
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    });

    return () => {
      socket.emit('unsubscribe:notifications', { userId });
      socket.off('notification:new', handleNewNotification);
      socket.off('notification:update', handleNewNotification);
      socket.off('notification:delete', handleNewNotification);
      socket.off('notification:read');
      socket.off('notifications:unreadCount');
      socket.off('notifications:allRead');
    };
  }, [socket, isConnected, userId]);

  // Initial load
  useEffect(() => {
    fetchNotifications();
    
    // Request notification permission
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [userId]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mark notification as read
  const markAsRead = async (notificationId: string) => {
    try {
      await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DOMPurify.sanitize(userId) }),
      });
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    try {
      await fetch('/api/notifications/read-all', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DOMPurify.sanitize(userId) }),
      });
      
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  // Load more notifications
  const loadMore = () => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchNotifications(nextPage * 20);
    }
  };

  // Get notification icon
  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case NotificationType.ORDER:
        return '📄';
      case NotificationType.TRADE:
        return '💹';
      case NotificationType.SETTLEMENT:
        return '🏦';
      case NotificationType.DEPOSIT:
        return '⬇️';
      case NotificationType.WITHDRAWAL:
        return '⬆️';
      case NotificationType.SYSTEM:
        return '⚙️';
      default:
        return '🔔';
    }
  };

  // Get priority color
  const getPriorityColor = (priority: NotificationPriority) => {
    switch (priority) {
      case NotificationPriority.URGENT:
        return 'text-red-600';
      case NotificationPriority.HIGH:
        return 'text-orange-600';
      case NotificationPriority.MEDIUM:
        return 'text-blue-600';
      case NotificationPriority.LOW:
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  // Handle notification click
  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }

    // Navigate based on notification type
    switch (notification.type) {
      case NotificationType.ORDER:
        if (notification.data?.orderId) {
          window.location.href = `/orders/${encodeURIComponent(notification.data.orderId)}`;
        }
        break;
      case NotificationType.TRADE:
        if (notification.data?.tradeId) {
          window.location.href = `/trades/${encodeURIComponent(notification.data.tradeId)}`;
        }
        break;
      case NotificationType.SETTLEMENT:
        if (notification.data?.epochId) {
          window.location.href = `/settlements/${encodeURIComponent(notification.data.epochId)}`;
        }
        break;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="Notifications"
      >
        <svg 
          className="w-6 h-6 text-gray-600 dark:text-gray-300" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" 
          />
        </svg>
        
        {/* Unread Count Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-[600px] overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Mark all as read
                </button>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto max-h-[500px]">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No notifications yet
              </div>
            ) : (
              <>
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`
                      px-4 py-3 border-b border-gray-100 dark:border-gray-800 
                      hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer
                      ${!notification.read ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
                    `}
                  >
                    <div className="flex gap-3">
                      {/* Icon */}
                      <span className="text-2xl">
                        {getNotificationIcon(notification.type)}
                      </span>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className={`
                            font-medium text-sm
                            ${!notification.read ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}
                          `}>
                            {DOMPurify.sanitize(notification.title)}
                          </p>
                          <span className={`text-xs ${getPriorityColor(notification.priority)}`}>
                            {!notification.read && '●'}
                          </span>
                        </div>
                        
                        <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                          {DOMPurify.sanitize(notification.message)}
                        </p>
                        
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Load More */}
                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="w-full py-3 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
                  >
                    {loading ? 'Loading...' : 'Load more'}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <a
              href="/notifications"
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View all notifications →
            </a>
          </div>
        </div>
      )}
    </div>
  );
};