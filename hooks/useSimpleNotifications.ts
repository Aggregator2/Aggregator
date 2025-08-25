import { useState, useCallback } from 'react';

export interface SimpleNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  timestamp: Date;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const useSimpleNotifications = () => {
  const [notifications, setNotifications] = useState<SimpleNotification[]>([]);

  const addNotification = useCallback((
    type: SimpleNotification['type'],
    title: string,
    message?: string,
    duration?: number,
    action?: SimpleNotification['action']
  ) => {
    const notification: SimpleNotification = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      title,
      message,
      duration: duration || 10000, // Default 10 seconds
      timestamp: new Date(),
      action
    };

    setNotifications(prev => [notification, ...prev]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const notify = {
    success: (title: string, message?: string, duration?: number, action?: SimpleNotification['action']) => 
      addNotification('success', title, message, duration, action),
    error: (title: string, message?: string, duration?: number, action?: SimpleNotification['action']) => 
      addNotification('error', title, message, duration, action),
    warning: (title: string, message?: string, duration?: number, action?: SimpleNotification['action']) => 
      addNotification('warning', title, message, duration, action),
    info: (title: string, message?: string, duration?: number, action?: SimpleNotification['action']) => 
      addNotification('info', title, message, duration, action),
  };

  return {
    notifications,
    notify,
    removeNotification,
    clearNotifications
  };
};