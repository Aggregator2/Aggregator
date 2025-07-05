import React, { useState, useMemo } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  TrashIcon,
  CheckIcon,
  FunnelIcon
} from '@heroicons/react/24/outline';
import { NotificationType, NotificationPriority } from '../../src/types/notifications';
import { useNotifications } from '../../hooks/useNotifications';

interface NotificationCenterProps {
  userId: string;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ userId }) => {
  const {
    notifications,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refreshNotifications
  } = useNotifications(userId);

  const [selectedType, setSelectedType] = useState<NotificationType | 'all'>('all');
  const [selectedPriority, setSelectedPriority] = useState<NotificationPriority | 'all'>('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set());

  // Filter notifications
  const filteredNotifications = useMemo(() => {
    return notifications.filter(notification => {
      if (selectedType !== 'all' && notification.type !== selectedType) return false;
      if (selectedPriority !== 'all' && notification.priority !== selectedPriority) return false;
      if (showUnreadOnly && notification.read) return false;
      return true;
    });
  }, [notifications, selectedType, selectedPriority, showUnreadOnly]);

  // Group notifications by date
  const groupedNotifications = useMemo(() => {
    const groups: { [key: string]: typeof notifications } = {};
    
    filteredNotifications.forEach(notification => {
      const date = format(new Date(notification.createdAt), 'yyyy-MM-dd');
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(notification);
    });

    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredNotifications]);

  const getNotificationIcon = (type: NotificationType, priority: NotificationPriority) => {
    if (type === NotificationType.ORDER_FAILED || 
        type === NotificationType.SETTLEMENT_FAILED) {
      return <XCircleIcon className="h-6 w-6 text-red-500" />;
    }
    
    if (type === NotificationType.ORDER_FILLED || 
        type === NotificationType.SETTLEMENT_COMPLETED) {
      return <CheckCircleIcon className="h-6 w-6 text-green-500" />;
    }
    
    if (priority === NotificationPriority.URGENT) {
      return <ExclamationTriangleIcon className="h-6 w-6 text-yellow-500" />;
    }
    
    return <InformationCircleIcon className="h-6 w-6 text-blue-500" />;
  };

  const handleSelectNotification = (id: string) => {
    const newSelected = new Set(selectedNotifications);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedNotifications(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedNotifications.size === filteredNotifications.length) {
      setSelectedNotifications(new Set());
    } else {
      setSelectedNotifications(new Set(filteredNotifications.map(n => n.id)));
    }
  };

  const handleMarkSelectedAsRead = async () => {
    await markAsRead(Array.from(selectedNotifications));
    setSelectedNotifications(new Set());
  };

  const handleDeleteSelected = async () => {
    for (const id of selectedNotifications) {
      await deleteNotification(id);
    }
    setSelectedNotifications(new Set());
  };

  const notificationTypes = Object.values(NotificationType);
  const priorities = Object.values(NotificationPriority);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Notification Center
            </h1>
            <button
              onClick={refreshNotifications}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 space-y-4">
          <div className="flex items-center space-x-4">
            <FunnelIcon className="h-5 w-5 text-gray-400" />
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as NotificationType | 'all')}
              className="rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700"
            >
              <option value="all">All Types</option>
              {notificationTypes.map(type => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>
            
            <select
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value as NotificationPriority | 'all')}
              className="rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700"
            >
              <option value="all">All Priorities</option>
              {priorities.map(priority => (
                <option key={priority} value={priority}>
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                </option>
              ))}
            </select>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={showUnreadOnly}
                onChange={(e) => setShowUnreadOnly(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
                Unread only
              </span>
            </label>
          </div>

          {/* Actions */}
          {selectedNotifications.size > 0 && (
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">
                {selectedNotifications.size} selected
              </span>
              <button
                onClick={handleMarkSelectedAsRead}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Mark as read
              </button>
              <button
                onClick={handleDeleteSelected}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : error ? (
            <div className="p-8 text-center text-red-500">{error}</div>
          ) : filteredNotifications.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No notifications found</div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {/* Select all */}
              <div className="px-6 py-3 bg-gray-50 dark:bg-gray-700/50">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedNotifications.size === filteredNotifications.length}
                    onChange={handleSelectAll}
                    className="rounded border-gray-300"
                  />
                  <span className="ml-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    Select all
                  </span>
                </label>
              </div>

              {/* Notifications by date */}
              {groupedNotifications.map(([date, dateNotifications]) => (
                <div key={date}>
                  <div className="px-6 py-2 bg-gray-50 dark:bg-gray-700/30">
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      {format(new Date(date), 'EEEE, MMMM d, yyyy')}
                    </h3>
                  </div>
                  {dateNotifications.map(notification => (
                    <div
                      key={notification.id}
                      className={`px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                        !notification.read ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <div className="flex items-start">
                        <input
                          type="checkbox"
                          checked={selectedNotifications.has(notification.id)}
                          onChange={() => handleSelectNotification(notification.id)}
                          className="mt-1 rounded border-gray-300"
                        />
                        <div className="ml-3 flex-shrink-0">
                          {getNotificationIcon(notification.type, notification.priority)}
                        </div>
                        <div className="ml-3 flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {notification.title}
                            </p>
                            <p className="text-sm text-gray-500">
                              {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                            {notification.message}
                          </p>
                          {notification.data && Object.keys(notification.data).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {notification.data.orderId && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                                  Order: {notification.data.orderId.slice(0, 8)}...
                                </span>
                              )}
                              {notification.data.pair && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                                  {notification.data.pair}
                                </span>
                              )}
                              {notification.data.amount && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                                  {notification.data.amount}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="mt-2 flex items-center space-x-4">
                            {!notification.read && (
                              <button
                                onClick={() => markAsRead([notification.id])}
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                Mark as read
                              </button>
                            )}
                            <button
                              onClick={() => deleteNotification(notification.id)}
                              className="text-xs text-red-600 hover:text-red-800"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};