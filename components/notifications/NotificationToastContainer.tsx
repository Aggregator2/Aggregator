import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NotificationToast } from './NotificationToast';
import { NotificationType, NotificationPriority } from '../../src/types/notifications';

interface Toast {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
}

interface NotificationToastContainerProps {
  userId: string;
}

export const NotificationToastContainer: React.FC<NotificationToastContainerProps> = ({ userId }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // WebSocket connection for real-time notifications
  useEffect(() => {
    if (!mounted) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      // Subscribe to notifications
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'notifications',
        userId
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'notification') {
          const notification = message.data.notification;
          
          // Only show toast for high priority or important notifications
          if (notification.priority === NotificationPriority.HIGH ||
              notification.priority === NotificationPriority.URGENT ||
              notification.type === NotificationType.ORDER_FILLED ||
              notification.type === NotificationType.ORDER_FAILED ||
              notification.type === NotificationType.SETTLEMENT_COMPLETED ||
              notification.type === NotificationType.SETTLEMENT_FAILED) {
            
            addToast({
              id: notification.id,
              type: notification.type,
              priority: notification.priority,
              title: notification.title,
              message: notification.message
            });
          }
        }
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      ws.close();
    };
  }, [userId, mounted]);

  const addToast = useCallback((toast: Toast) => {
    setToasts(prev => {
      // Limit to 5 toasts
      const newToasts = [toast, ...prev].slice(0, 5);
      return newToasts;
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      aria-live="assertive"
      className="fixed inset-0 flex items-end px-4 py-6 pointer-events-none sm:p-6 sm:items-start z-50"
    >
      <div className="w-full flex flex-col items-center space-y-4 sm:items-end">
        {toasts.map(toast => (
          <NotificationToast
            key={toast.id}
            id={toast.id}
            type={toast.type}
            priority={toast.priority}
            title={toast.title}
            message={toast.message}
            onClose={removeToast}
          />
        ))}
      </div>
    </div>,
    document.body
  );
};