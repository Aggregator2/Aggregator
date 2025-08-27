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

  const notify = useCallback((notification: Partial<SimpleNotification> & { type: SimpleNotification['type']; title: string }) => {
    const newNotification: SimpleNotification = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      duration: 5000, // Default 5 seconds
      ...notification
    };
    setNotifications(prev => [newNotification, ...prev]);
  }, []);

  return {
    notifications,
    notify,
    removeNotification,
    clearNotifications
  };
};