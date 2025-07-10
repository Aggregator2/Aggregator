import { useState, useCallback } from 'react';

export interface SimpleNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  timestamp: Date;
}

export const useSimpleNotifications = () => {
  const [notifications, setNotifications] = useState<SimpleNotification[]>([]);

  const addNotification = useCallback((
    type: SimpleNotification['type'],
    title: string,
    message?: string,
    duration?: number
  ) => {
    const notification: SimpleNotification = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      title,
      message,
      duration: duration || 10000, // Default 10 seconds
      timestamp: new Date()
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
    success: (title: string, message?: string, duration?: number) => 
      addNotification('success', title, message, duration),
    error: (title: string, message?: string, duration?: number) => 
      addNotification('error', title, message, duration),
    warning: (title: string, message?: string, duration?: number) => 
      addNotification('warning', title, message, duration),
    info: (title: string, message?: string, duration?: number) => 
      addNotification('info', title, message, duration),
  };

  return {
    notifications,
    notify,
    removeNotification,
    clearNotifications
  };
};