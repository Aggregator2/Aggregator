import React, { useState } from 'react';
import styles from './DisputeModal.module.css';

interface DisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderDetails: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    buyAmount: string;
    status: 'failed' | 'timeout';
    reason?: string;
  };
  onSettleOnChain: () => Promise<void>;
  onReturnFunds: () => Promise<void>;
}

export const DisputeModal: React.FC<DisputeModalProps> = ({
  isOpen,
  onClose,
  orderId,
  orderDetails,
  onSettleOnChain,
  onReturnFunds
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedOption, setSelectedOption] = useState<'settle' | 'return' | null>(null);

  if (!isOpen) return null;

  const handleAction = async () => {
    if (!selectedOption) return;
    
    setIsProcessing(true);
    try {
      if (selectedOption === 'settle') {
        await onSettleOnChain();
      } else {
        await onReturnFunds();
      }
      onClose();
    } catch (error) {
      console.error('Dispute resolution failed:', error);
      alert('Failed to process dispute. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>⚖️ Trade Dispute Resolution</h2>
          <button className={styles.closeButton} onClick={onClose}>×</button>
        </div>
        
        <div className={styles.content}>
          <div className={styles.alertBox}>
            <span className={styles.alertIcon}>⚠️</span>
            <div>
              <h3>Trade {orderDetails.status === 'failed' ? 'Failed' : 'Timed Out'}</h3>
              <p>
                {orderDetails.status === 'failed' 
                  ? 'Your trade could not be executed due to an error.'
                  : 'Your trade timed out and was not executed.'}
              </p>
              {orderDetails.reason && (
                <p className={styles.reason}>Reason: {orderDetails.reason}</p>
              )}
            </div>
          </div>

          <div className={styles.orderInfo}>
            <h4>Order Details</h4>
            <div className={styles.detail}>
              <span>Order ID:</span>
              <span className={styles.mono}>{orderId.substring(0, 16)}...</span>
            </div>
            <div className={styles.detail}>
              <span>Sell Amount:</span>
              <span>{orderDetails.sellAmount}</span>
            </div>
            <div className={styles.detail}>
              <span>Expected Buy:</span>
              <span>{orderDetails.buyAmount}</span>
            </div>
          </div>

          <div className={styles.resolutionOptions}>
            <h4>Choose Resolution Method</h4>
            
            <label className={`${styles.option} ${selectedOption === 'settle' ? styles.selected : ''}`}>
              <input
                type="radio"
                name="resolution"
                value="settle"
                checked={selectedOption === 'settle'}
                onChange={() => setSelectedOption('settle')}
                disabled={isProcessing}
              />
              <div className={styles.optionContent}>
                <h5>🔗 Settle On-Chain</h5>
                <p>Execute the trade through on-chain settlement. This may take longer and incur higher gas fees, but ensures execution at current market rates.</p>
                <span className={styles.tag}>Recommended for large trades</span>
              </div>
            </label>

            <label className={`${styles.option} ${selectedOption === 'return' ? styles.selected : ''}`}>
              <input
                type="radio"
                name="resolution"
                value="return"
                checked={selectedOption === 'return'}
                onChange={() => setSelectedOption('return')}
                disabled={isProcessing}
              />
              <div className={styles.optionContent}>
                <h5>💸 Return Funds</h5>
                <p>Cancel the trade and return your funds. No trade will be executed, and your tokens will be returned to your wallet.</p>
                <span className={styles.tag}>Quick & Gas Efficient</span>
              </div>
            </label>
          </div>

          <div className={styles.actions}>
            <button 
              className={styles.cancelButton} 
              onClick={onClose}
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button 
              className={styles.confirmButton}
              onClick={handleAction}
              disabled={!selectedOption || isProcessing}
            >
              {isProcessing ? (
                <>Processing...</>
              ) : (
                <>Confirm {selectedOption === 'settle' ? 'Settlement' : 'Return'}</>
              )}
            </button>
          </div>

          <div className={styles.notice}>
            <p>
              <strong>Note:</strong> This dispute will be logged for audit purposes. 
              Our support team will be notified to help prevent similar issues in the future.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default DisputeModal;