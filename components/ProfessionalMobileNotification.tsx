import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useAnimation, PanInfo } from 'framer-motion';
import styles from './ProfessionalMobileNotification.module.css';

interface Notification {
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
  persistent?: boolean;
}

interface NotificationSystemProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
  position?: 'top' | 'bottom';
  enableHaptics?: boolean;
}

// Haptic feedback utility
const triggerHaptic = (type: 'light' | 'medium' | 'heavy' = 'light') => {
  if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
    const patterns = {
      light: [10],
      medium: [20],
      heavy: [30, 10, 20]
    };
    navigator.vibrate(patterns[type]);
  }
};

const NotificationItem: React.FC<{
  notification: Notification;
  onDismiss: (id: string) => void;
  index: number;
  enableHaptics?: boolean;
}> = ({ notification, onDismiss, index, enableHaptics = true }) => {
  const [isDismissing, setIsDismissing] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const controls = useAnimation();
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-200, 0, 200], [0, 1, 0]);
  
  // Swipe threshold
  const SWIPE_THRESHOLD = 100;
  const VELOCITY_THRESHOLD = 500;

  useEffect(() => {
    if (notification.persistent) return;

    const duration = notification.duration || 6000;
    let startTime = Date.now();
    let rafId: number;

    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.max(0, 1 - elapsed / duration);
      
      if (progressRef.current) {
        progressRef.current.style.transform = `scaleX(${progress})`;
      }

      if (progress > 0) {
        rafId = requestAnimationFrame(updateProgress);
      } else {
        handleDismiss();
      }
    };

    rafId = requestAnimationFrame(updateProgress);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [notification.persistent, notification.duration]);

  const handleDismiss = useCallback(() => {
    if (isDismissing) return;
    setIsDismissing(true);
    if (enableHaptics) triggerHaptic('light');
    
    controls.start({
      x: window.innerWidth,
      opacity: 0,
      transition: { duration: 0.2 }
    }).then(() => {
      onDismiss(notification.id);
    });
  }, [isDismissing, controls, onDismiss, notification.id, enableHaptics]);

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const shouldDismiss = 
      Math.abs(info.offset.x) > SWIPE_THRESHOLD || 
      Math.abs(info.velocity.x) > VELOCITY_THRESHOLD;

    if (shouldDismiss) {
      const direction = info.offset.x > 0 ? window.innerWidth : -window.innerWidth;
      controls.start({
        x: direction,
        transition: { duration: 0.15 }
      }).then(() => {
        handleDismiss();
      });
    } else {
      controls.start({ x: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } });
    }
  };

  const getIcon = () => {
    const icons = {
      success: (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#ffffff" strokeWidth="2"/>
          <path d="M8 12l2 2 4-4" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      error: (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#ffffff" strokeWidth="2"/>
          <path d="M8 8l8 8M16 8l-8 8" stroke="#ffffff" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ),
      warning: (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 20h20L12 2z" stroke="#ffffff" strokeWidth="2" strokeLinejoin="round"/>
          <path d="M12 9v4M12 17h.01" stroke="#ffffff" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ),
      info: (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#ffffff" strokeWidth="2"/>
          <path d="M12 8h.01M12 12v4" stroke="#ffffff" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ),
    };
    return icons[notification.type];
  };

  const variants = {
    initial: { 
      y: -100,
      opacity: 0,
      scale: 0.9,
    },
    animate: { 
      y: 0,
      opacity: 1,
      scale: 1,
      transition: {
        type: 'spring',
        stiffness: 500,
        damping: 40,
        delay: index * 0.05
      }
    },
    exit: { 
      opacity: 0,
      scale: 0.9,
      transition: {
        duration: 0.15,
        ease: 'easeIn'
      }
    }
  };

  return (
    <motion.div
      layout
      drag="x"
      dragElastic={0.2}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={handleDragEnd}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ x, opacity }}
      className={`${styles.notification} ${styles[notification.type]}`}
      onTap={() => {
        if (enableHaptics) triggerHaptic('light');
      }}
    >
      {/* Progress bar */}
      {!notification.persistent && (
        <div className={styles.progressTrack}>
          <div ref={progressRef} className={styles.progressBar} />
        </div>
      )}
      
      {/* Drag indicator */}
      <div className={styles.dragIndicator} />
      
      <div className={styles.contentWrapper}>
        <div className={styles.iconContainer}>
          {getIcon()}
        </div>
        
        <div className={styles.content}>
          <h4 className={styles.title} style={{ color: '#ffffff' }}>{notification.title}</h4>
          {notification.message && (
            <p className={styles.message} style={{ color: '#ffffff', opacity: 0.9 }}>{notification.message}</p>
          )}
          {notification.action && (
            <motion.button
              className={styles.actionButton}
              style={{ color: '#ffffff' }}
              onClick={(e) => {
                e.stopPropagation();
                if (enableHaptics) triggerHaptic('medium');
                notification.action!.onClick();
              }}
              whileTap={{ scale: 0.95 }}
            >
              {notification.action.label}
            </motion.button>
          )}
        </div>
        
        <motion.button
          className={styles.closeButton}
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          whileTap={{ scale: 0.9 }}
          aria-label="Dismiss notification"
        >
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="#ffffff" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </motion.button>
      </div>
    </motion.div>
  );
};

const ProfessionalMobileNotification: React.FC<NotificationSystemProps> = ({ 
  notifications, 
  onDismiss,
  position = 'top',
  enableHaptics = true
}) => {
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );

  useEffect(() => {
    const handleResize = () => {
      setViewportHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    // Initial trigger
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const maxNotifications = 3;
  const visibleNotifications = notifications.slice(0, maxNotifications);

  return (
    <div 
      className={`${styles.notificationContainer} ${styles[position]}`}
      style={{
        '--viewport-height': `${viewportHeight}px`
      } as React.CSSProperties}
    >
      <AnimatePresence mode="popLayout">
        {visibleNotifications.map((notification, index) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onDismiss={onDismiss}
            index={index}
            enableHaptics={enableHaptics}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ProfessionalMobileNotification;