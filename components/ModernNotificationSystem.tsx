import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './ModernNotificationSystem.module.css';

export interface Notification {
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

interface NotificationSystemProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
  position?: 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center';
}

const NotificationItem: React.FC<{
  notification: Notification;
  onDismiss: (id: string) => void;
  index: number;
}> = ({ notification, onDismiss, index }) => {
  const [progress, setProgress] = useState(100);
  const progressInterval = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const duration = notification.duration || 6000;
    const updateInterval = 50;
    const decrementValue = (100 / duration) * updateInterval;

    progressInterval.current = setInterval(() => {
      setProgress(prev => {
        const newValue = prev - decrementValue;
        if (newValue <= 0) {
          onDismiss(notification.id);
          return 0;
        }
        return newValue;
      });
    }, updateInterval);

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    };
  }, [notification, onDismiss]);

  const handleMouseEnter = () => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
    }
  };

  const handleMouseLeave = () => {
    const duration = notification.duration || 6000;
    const remainingTime = (duration * progress) / 100;
    const updateInterval = 50;
    const decrementValue = (100 / remainingTime) * updateInterval;

    progressInterval.current = setInterval(() => {
      setProgress(prev => {
        const newValue = prev - decrementValue;
        if (newValue <= 0) {
          onDismiss(notification.id);
          return 0;
        }
        return newValue;
      });
    }, updateInterval);
  };

  const getIcon = () => {
    const icons = {
      success: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm-2 15l-5-5 1.41-1.41L8 12.17l7.59-7.59L17 6l-9 9z"
            fill="currentColor"
          />
        </svg>
      ),
      error: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm1 15H9v-2h2v2zm0-4H9V5h2v6z"
            fill="currentColor"
          />
        </svg>
      ),
      warning: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M1 17h18L10 2 1 17zm9-3a1 1 0 100-2 1 1 0 000 2zm0-3a1 1 0 00-1-1v-3a1 1 0 012 0v3a1 1 0 00-1 1z"
            fill="currentColor"
          />
        </svg>
      ),
      info: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm1 15H9v-6h2v6zm0-8H9V5h2v2z"
            fill="currentColor"
          />
        </svg>
      ),
    };

    return icons[notification.type];
  };

  // Detect if mobile device
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  const variants = {
    initial: isMobile ? { 
      opacity: 0, 
      y: -20, 
      scale: 0.95
    } : { 
      opacity: 0, 
      y: -50, 
      scale: 0.3,
      x: 100,
      rotateX: -15
    },
    animate: isMobile ? { 
      opacity: 1, 
      y: 0, 
      scale: 1,
      transition: {
        duration: 0.3,
        ease: "easeOut",
        delay: index * 0.03
      }
    } : { 
      opacity: 1, 
      y: 0, 
      scale: 1,
      x: 0,
      rotateX: 0,
      transition: {
        duration: 0.4,
        ease: [0.68, -0.55, 0.265, 1.55],
        delay: index * 0.05
      }
    },
    exit: isMobile ? { 
      opacity: 0,
      scale: 0.95,
      y: -10,
      transition: {
        duration: 0.2,
        ease: "easeIn"
      }
    } : { 
      opacity: 0,
      scale: 0.9,
      x: 300,
      transition: {
        duration: 0.3,
        ease: [0.4, 0, 1, 1]
      }
    },
    hover: isMobile ? {} : {
      scale: 1.02,
      transition: {
        duration: 0.2,
        ease: "easeInOut"
      }
    }
  };

  return (
    <motion.div
      layout
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      whileHover="hover"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`${styles.notification} ${styles[notification.type]}`}
      style={{
        '--progress': `${progress}%`,
      } as React.CSSProperties}
    >
      <div className={styles.progressBar} />
      
      <div className={styles.glowEffect} />
      
      <motion.div 
        className={styles.iconContainer}
        whileHover={isMobile ? {} : { rotate: 360 }}
        transition={{ duration: 0.5 }}
      >
        {getIcon()}
      </motion.div>
      
      <div className={styles.content}>
        <h4 className={styles.title}>{notification.title}</h4>
        {notification.message && (
          <p className={styles.message}>{notification.message}</p>
        )}
        {notification.action && (
          <motion.button
            className={styles.actionButton}
            onClick={notification.action.onClick}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {notification.action.label}
          </motion.button>
        )}
      </div>
      
      <motion.button
        className={styles.closeButton}
        onClick={() => onDismiss(notification.id)}
        whileHover={{ scale: 1.1, rotate: 90 }}
        whileTap={{ scale: 0.9 }}
        aria-label="Dismiss notification"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M14 1.41L12.59 0L7 5.59L1.41 0L0 1.41L5.59 7L0 12.59L1.41 14L7 8.41L12.59 14L14 12.59L8.41 7L14 1.41Z"
            fill="currentColor"
          />
        </svg>
      </motion.button>
    </motion.div>
  );
};

const ModernNotificationSystem: React.FC<NotificationSystemProps> = ({ 
  notifications, 
  onDismiss,
  position = 'top-right'
}) => {
  const maxNotifications = 5;
  const visibleNotifications = notifications.slice(0, maxNotifications);

  return (
    <div className={`${styles.notificationContainer} ${styles[position]}`}>
      <AnimatePresence mode="popLayout">
        {visibleNotifications.map((notification, index) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onDismiss={onDismiss}
            index={index}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ModernNotificationSystem;