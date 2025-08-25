import React from 'react';
import ModernNotificationSystem from '../components/ModernNotificationSystem';
import { useSimpleNotifications } from '../hooks/useSimpleNotifications';
import styles from '../styles/NotificationsDemo.module.css';

export default function NotificationsDemo() {
  const { notifications, notify, removeNotification } = useSimpleNotifications();

  const showSuccessNotification = () => {
    notify.success(
      'Transaction Successful!',
      'Your swap of 1 ETH to 4,812 USDC has been completed.',
      8000
    );
  };

  const showErrorNotification = () => {
    notify.error(
      'Transaction Failed',
      'Insufficient balance. You need 0.5 more ETH to complete this transaction.',
      10000,
      {
        label: 'Buy ETH',
        onClick: () => {
          notify.info('Redirecting to buy ETH...', 'Opening Coinbase in a new tab.');
          setTimeout(() => {
            window.open('https://www.coinbase.com', '_blank');
          }, 1000);
        }
      }
    );
  };

  const showWarningNotification = () => {
    notify.warning(
      'High Slippage Warning',
      'This transaction may have up to 5% slippage due to low liquidity.',
      8000,
      {
        label: 'Adjust Settings',
        onClick: () => {
          notify.info('Opening settings...', 'You can adjust slippage tolerance here.');
        }
      }
    );
  };

  const showInfoNotification = () => {
    notify.info(
      'Price Updated',
      'The quote has been refreshed with the latest market prices.',
      5000
    );
  };

  const showMultipleNotifications = () => {
    notify.info('Processing Transaction 1/3', 'Approving token spend...');
    setTimeout(() => {
      notify.info('Processing Transaction 2/3', 'Swapping tokens...');
    }, 1000);
    setTimeout(() => {
      notify.success('All Transactions Complete!', 'Your tokens have been swapped successfully.');
    }, 2000);
  };

  const showLongNotification = () => {
    notify.error(
      'Multiple Issues Detected',
      'Your transaction cannot be processed due to: insufficient balance (need 0.5 more ETH), network congestion (gas price too high), and slippage tolerance exceeded.',
      15000,
      {
        label: 'View Details',
        onClick: () => {
          notify.info('Opening transaction details...', 'Check the console for more information.');
          console.log('Transaction details:', {
            requiredBalance: '0.5 ETH',
            currentGasPrice: '150 gwei',
            slippageTolerance: '0.5%',
            actualSlippage: '2.3%'
          });
        }
      }
    );
  };

  return (
    <div className={styles.container}>
      <ModernNotificationSystem
        notifications={notifications}
        onDismiss={removeNotification}
        position="top-right"
      />

      <div className={styles.content}>
        <h1 className={styles.title}>Modern Notification System Demo</h1>
        <p className={styles.subtitle}>
          Click the buttons below to see different notification types with smooth animations
        </p>

        <div className={styles.buttonGrid}>
          <button
            className={`${styles.button} ${styles.success}`}
            onClick={showSuccessNotification}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm-2 15l-5-5 1.41-1.41L8 12.17l7.59-7.59L17 6l-9 9z"
                fill="currentColor"
              />
            </svg>
            Success Notification
          </button>

          <button
            className={`${styles.button} ${styles.error}`}
            onClick={showErrorNotification}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm1 15H9v-2h2v2zm0-4H9V5h2v6z"
                fill="currentColor"
              />
            </svg>
            Error with Action
          </button>

          <button
            className={`${styles.button} ${styles.warning}`}
            onClick={showWarningNotification}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M1 17h18L10 2 1 17zm9-3a1 1 0 100-2 1 1 0 000 2zm0-3a1 1 0 00-1-1v-3a1 1 0 012 0v3a1 1 0 00-1 1z"
                fill="currentColor"
              />
            </svg>
            Warning with Action
          </button>

          <button
            className={`${styles.button} ${styles.info}`}
            onClick={showInfoNotification}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm1 15H9v-6h2v6zm0-8H9V5h2v2z"
                fill="currentColor"
              />
            </svg>
            Info Notification
          </button>

          <button
            className={`${styles.button} ${styles.multiple}`}
            onClick={showMultipleNotifications}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M3 3h14v2H3V3zm0 4h14v2H3V7zm0 4h14v2H3v-2zm0 4h14v2H3v-2z"
                fill="currentColor"
              />
            </svg>
            Multiple Notifications
          </button>

          <button
            className={`${styles.button} ${styles.long}`}
            onClick={showLongNotification}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M2 2h16v3H2V2zm0 5h16v2H2V7zm0 4h16v2H2v-2zm0 4h10v2H2v-2z"
                fill="currentColor"
              />
            </svg>
            Long Message with Action
          </button>
        </div>

        <div className={styles.features}>
          <h2>Features</h2>
          <ul>
            <li>✨ Smooth entrance and exit animations with Framer Motion</li>
            <li>🎯 Multiple positioning options (top-right, top-center, bottom-right, bottom-center)</li>
            <li>⏱️ Auto-dismiss with visual progress bar</li>
            <li>🖱️ Pause on hover functionality</li>
            <li>🎬 Staggered animations for multiple notifications</li>
            <li>💫 Beautiful glassmorphism design</li>
            <li>🌈 Type-specific styling and icons</li>
            <li>🔘 Optional action buttons</li>
            <li>📱 Fully responsive design</li>
            <li>🌗 Dark mode support</li>
            <li>♿ Accessibility features</li>
            <li>🚀 High performance with minimal re-renders</li>
          </ul>
        </div>
      </div>
    </div>
  );
}