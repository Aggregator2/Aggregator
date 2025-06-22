import React, { useEffect, useState } from 'react';
import styles from './OrderToast.module.css';

export interface OrderToastProps {
  orderId: string;
  status: 'submitted' | 'filled' | 'failed' | 'pending';
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  txHash?: string;
  onClose: () => void;
  duration?: number;
}

const OrderToast: React.FC<OrderToastProps> = ({
  orderId,
  status,
  sellToken,
  buyToken,
  sellAmount,
  buyAmount,
  txHash,
  onClose,
  duration = 6000,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    setTimeout(() => setIsVisible(true), 10);

    // Auto-close after duration
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const getStatusConfig = () => {
    switch (status) {
      case 'submitted':
        return {
          icon: '📝',
          title: 'Order Submitted',
          color: '#2196f3',
          message: 'Your order has been submitted and is being processed',
        };
      case 'filled':
        return {
          icon: '✅',
          title: 'Order Filled!',
          color: '#4caf50',
          message: 'Your swap has been successfully completed',
        };
      case 'failed':
        return {
          icon: '❌',
          title: 'Order Failed',
          color: '#f44336',
          message: 'Your order could not be completed',
        };
      case 'pending':
        return {
          icon: '⏳',
          title: 'Order Pending',
          color: '#ff9800',
          message: 'Your order is being matched',
        };
      default:
        return {
          icon: 'ℹ️',
          title: 'Order Update',
          color: '#2196f3',
          message: 'Order status updated',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div 
      className={`${styles.orderToast} ${isVisible ? styles.visible : ''} ${isExiting ? styles.exiting : ''}`}
      style={{ borderLeftColor: config.color }}
    >
      <div className={styles.toastHeader}>
        <div className={styles.statusIcon} style={{ color: config.color }}>
          {config.icon}
        </div>
        <div className={styles.toastContent}>
          <h4 className={styles.toastTitle}>{config.title}</h4>
          <p className={styles.toastMessage}>{config.message}</p>
          <div className={styles.orderDetails}>
            <span className={styles.tokenSwap}>
              {sellAmount} {sellToken} → {buyAmount} {buyToken}
            </span>
          </div>
        </div>
        <button 
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Close notification"
        >
          ×
        </button>
      </div>
      
      {txHash && status === 'filled' && (
        <div className={styles.toastFooter}>
          <a 
            href={`https://etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.txLink}
          >
            View transaction →
          </a>
        </div>
      )}

      {status === 'filled' && (
        <div className={styles.celebrationAnimation}>
          <div className={styles.floatingToken} style={{ animationDelay: '0s' }}>🪙</div>
          <div className={styles.floatingToken} style={{ animationDelay: '0.2s' }}>💰</div>
          <div className={styles.floatingToken} style={{ animationDelay: '0.4s' }}>✨</div>
        </div>
      )}
    </div>
  );
};

export default OrderToast;