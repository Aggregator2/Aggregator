import React, { useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/solid';
import { NotificationType, NotificationPriority } from '../../src/types/notifications';

interface NotificationToastProps {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  onClose: (id: string) => void;
  duration?: number;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  id,
  type,
  priority,
  title,
  message,
  onClose,
  duration = 5000
}) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose(id);
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [id, duration, onClose]);

  const getIcon = () => {
    if (type === NotificationType.ORDER_FAILED || 
        type === NotificationType.SETTLEMENT_FAILED) {
      return <XCircleIcon className="h-6 w-6 text-red-400" />;
    }
    
    if (type === NotificationType.ORDER_FILLED || 
        type === NotificationType.SETTLEMENT_COMPLETED) {
      return <CheckCircleIcon className="h-6 w-6 text-green-400" />;
    }
    
    if (priority === NotificationPriority.URGENT) {
      return <ExclamationTriangleIcon className="h-6 w-6 text-yellow-400" />;
    }
    
    return <InformationCircleIcon className="h-6 w-6 text-blue-400" />;
  };

  const getBackgroundColor = () => {
    if (type === NotificationType.ORDER_FAILED || 
        type === NotificationType.SETTLEMENT_FAILED) {
      return 'bg-red-50 dark:bg-red-900/20';
    }
    
    if (type === NotificationType.ORDER_FILLED || 
        type === NotificationType.SETTLEMENT_COMPLETED) {
      return 'bg-green-50 dark:bg-green-900/20';
    }
    
    if (priority === NotificationPriority.URGENT) {
      return 'bg-yellow-50 dark:bg-yellow-900/20';
    }
    
    return 'bg-blue-50 dark:bg-blue-900/20';
  };

  return (
    <div
      className={`${getBackgroundColor()} p-4 rounded-lg shadow-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5 dark:ring-white dark:ring-opacity-10`}
    >
      <div className="flex-shrink-0">
        {getIcon()}
      </div>
      <div className="ml-3 w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white">
          {title}
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">
          {message}
        </p>
      </div>
      <div className="ml-4 flex-shrink-0 flex">
        <button
          className="bg-transparent rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          onClick={() => onClose(id)}
        >
          <span className="sr-only">Close</span>
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};