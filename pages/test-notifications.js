import React, { useState } from 'react';
import { useSimpleNotifications } from '../hooks/useSimpleNotifications';
import ProfessionalMobileNotification from '../components/ProfessionalMobileNotification';
import styles from '../styles/NotificationsDemo.module.css';

export default function TestNotifications() {
  const { notifications, notify, removeNotification } = useSimpleNotifications();
  const [testCount, setTestCount] = useState(0);

  const showTestNotification = (type) => {
    setTestCount(prev => prev + 1);
    const messages = {
      success: {
        title: 'Success!',
        message: 'Your swap has been completed successfully.',
      },
      error: {
        title: 'Error',
        message: 'Failed to connect wallet. Please try again.',
      },
      warning: {
        title: 'Warning',
        message: 'High slippage detected for this trade.',
      },
      info: {
        title: 'Info',
        message: 'Quote will refresh in 30 seconds.',
      },
    };

    const { title, message } = messages[type];
    notify({
      type,
      title,
      message,
      duration: type === 'error' ? 8000 : 5000,
      action: type === 'success' ? {
        label: 'View Tx',
        onClick: () => alert('Opening transaction...')
      } : undefined
    });
  };

  return (
    <div className={styles.container}>
      <ProfessionalMobileNotification
        notifications={notifications}
        onDismiss={removeNotification}
        position="top"
        enableHaptics={true}
      />

      <div className={styles.content}>
        <h1 className={styles.title}>Notification Test</h1>
        <p className={styles.subtitle}>Test the professional mobile notification system</p>

        <div className={styles.buttonGrid}>
          <button
            className={`${styles.button} ${styles.success}`}
            onClick={() => showTestNotification('success')}
          >
            Success Notification
          </button>
          <button
            className={`${styles.button} ${styles.error}`}
            onClick={() => showTestNotification('error')}
          >
            Error Notification
          </button>
          <button
            className={`${styles.button} ${styles.warning}`}
            onClick={() => showTestNotification('warning')}
          >
            Warning Notification
          </button>
          <button
            className={`${styles.button} ${styles.info}`}
            onClick={() => showTestNotification('info')}
          >
            Info Notification
          </button>
        </div>

        <div className={styles.features}>
          <h2>Active Notifications: {notifications.length}</h2>
          <p>Total shown: {testCount}</p>
        </div>
      </div>
    </div>
  );
}