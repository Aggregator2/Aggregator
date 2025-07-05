import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { NotificationType, NotificationPriority } from '../../src/types/notifications';

interface NotificationDropdownProps {
  notifications: any[];
  loading: boolean;
  onNotificationClick: (notificationId: string) => void;
  onMarkAllAsRead: () => void;
  onClose: () => void;
}

export const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  notifications,
  loading,
  onNotificationClick,
  onMarkAllAsRead,
  onClose
}) => {
  const getNotificationIcon = (type: NotificationType, priority: NotificationPriority) => {
    // For failed notifications
    if (type === NotificationType.ORDER_FAILED || 
        type === NotificationType.SETTLEMENT_FAILED) {
      return <XCircleIcon className="h-5 w-5 text-red-500" />;
    }
    
    // For completed notifications
    if (type === NotificationType.ORDER_FILLED || 
        type === NotificationType.SETTLEMENT_COMPLETED) {
      return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
    }
    
    // For urgent notifications
    if (priority === NotificationPriority.URGENT) {
      return <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />;
    }
    
    // Default info icon
    return <InformationCircleIcon className="h-5 w-5 text-blue-500" />;
  };

  const getPriorityBadge = (priority: NotificationPriority) => {
    const colors = {
      [NotificationPriority.LOW]: 'bg-gray-100 text-gray-600',
      [NotificationPriority.MEDIUM]: 'bg-blue-100 text-blue-600',
      [NotificationPriority.HIGH]: 'bg-orange-100 text-orange-600',
      [NotificationPriority.URGENT]: 'bg-red-100 text-red-600'
    };

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[priority]}`}>
        {priority}
      </span>
    );
  };

  return (
    <div className="absolute right-0 mt-2 w-96 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Notifications
          </h3>
          {notifications.length > 0 && (
            <button
              onClick={onMarkAllAsRead}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Mark all as read
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <ArrowPathIcon className="h-6 w-6 text-gray-400 animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
            No notifications
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                onClick={() => onNotificationClick(notification.id)}
                className={`px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors ${
                  !notification.read ? 'bg-blue-50 dark:bg-gray-700/50' : ''
                }`}
              >
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 mt-1">
                    {getNotificationIcon(notification.type, notification.priority)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {notification.title}
                      </p>
                      {!notification.read && (
                        <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full" />
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {notification.message}
                    </p>
                    {notification.data && Object.keys(notification.data).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {notification.data.orderId && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Order: {notification.data.orderId.slice(0, 8)}...
                          </p>
                        )}
                        {notification.data.pair && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Pair: {notification.data.pair}
                          </p>
                        )}
                        {notification.data.amount && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Amount: {notification.data.amount}
                          </p>
                        )}
                        {notification.data.price && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Price: {notification.data.price}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                      </p>
                      {notification.priority !== NotificationPriority.MEDIUM && 
                        getPriorityBadge(notification.priority)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="w-full text-center text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
};