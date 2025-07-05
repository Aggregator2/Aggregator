import React, { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import styles from './DisputeModal.module.css';

interface SettlementProof {
  orderId: string;
  orderHash: string;
  originalOrder: any;
  signature: string;
  execution: {
    status: string;
    executedAt: number;
    filledQuantity: number;
    averagePrice: number;
    totalValue: number;
  };
  trades: Array<{
    id: string;
    price: number;
    quantity: number;
    timestamp: number;
    fee: number;
  }>;
  matchingEngineProof: {
    engineVersion: string;
    executionId: string;
    pair: string;
    side: string;
  };
  hybridProof?: any;
  verification: {
    merkleRoot: string;
    blockNumber?: number;
    transactionHash?: string;
  };
}

interface DisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderDetails: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    buyAmount: string;
    status: 'failed' | 'timeout' | 'disputed';
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
  const [settlementProof, setSettlementProof] = useState<SettlementProof | null>(null);
  const [isLoadingProof, setIsLoadingProof] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [showProofDetails, setShowProofDetails] = useState(false);

  useEffect(() => {
    if (isOpen && orderId) {
      fetchSettlementProof();
    }
  }, [isOpen, orderId]);

  const fetchSettlementProof = async () => {
    setIsLoadingProof(true);
    setProofError(null);
    
    try {
      const response = await fetch(`/api/orders/settlement-proof/${encodeURIComponent(orderId)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch settlement proof');
      }
      const proof = await response.json();
      setSettlementProof(proof);
    } catch (error) {
      console.error('Error fetching settlement proof:', error);
      setProofError('Unable to load settlement proof');
    } finally {
      setIsLoadingProof(false);
    }
  };

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

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const truncateHash = (hash: string) => {
    if (!hash) return 'N/A';
    return `${hash.substring(0, 10)}...${hash.substring(hash.length - 8)}`;
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
              <h3>Trade {orderDetails.status === 'failed' ? 'Failed' : orderDetails.status === 'timeout' ? 'Timed Out' : 'Under Dispute'}</h3>
              <p>
                {orderDetails.status === 'failed' 
                  ? 'Your trade could not be executed due to an error.'
                  : orderDetails.status === 'timeout'
                  ? 'Your trade timed out and was not executed.'
                  : 'This trade is being disputed.'}
              </p>
              {orderDetails.reason && (
                <p className={styles.reason}>Reason: {DOMPurify.sanitize(orderDetails.reason || '')}</p>
              )}
            </div>
          </div>

          <div className={styles.orderInfo}>
            <h4>Order Details</h4>
            <div className={styles.detail}>
              <span>Order ID:</span>
              <span className={styles.mono}>{DOMPurify.sanitize(truncateHash(orderId))}</span>
            </div>
            <div className={styles.detail}>
              <span>Sell Amount:</span>
              <span>{DOMPurify.sanitize(orderDetails.sellAmount)} {DOMPurify.sanitize(orderDetails.sellToken)}</span>
            </div>
            <div className={styles.detail}>
              <span>Expected Buy:</span>
              <span>{DOMPurify.sanitize(orderDetails.buyAmount)} {DOMPurify.sanitize(orderDetails.buyToken)}</span>
            </div>
          </div>

          {/* Settlement Proof Section */}
          <div className={styles.proofSection}>
            <div className={styles.proofHeader}>
              <h4>Settlement Proof</h4>
              <button 
                className={styles.toggleButton}
                onClick={() => setShowProofDetails(!showProofDetails)}
              >
                {showProofDetails ? 'Hide' : 'Show'} Details
              </button>
            </div>

            {isLoadingProof && <p>Loading settlement proof...</p>}
            {proofError && <p className={styles.error}>{DOMPurify.sanitize(proofError)}</p>}
            
            {settlementProof && !isLoadingProof && (
              <div className={styles.proofSummary}>
                <div className={styles.detail}>
                  <span>Status:</span>
                  <span className={styles[settlementProof.execution.status.toLowerCase()]}>
                    {DOMPurify.sanitize(settlementProof.execution.status)}
                  </span>
                </div>
                <div className={styles.detail}>
                  <span>Executed:</span>
                  <span>{formatTimestamp(settlementProof.execution.executedAt)}</span>
                </div>
                <div className={styles.detail}>
                  <span>Filled:</span>
                  <span>{settlementProof.execution.filledQuantity} @ {settlementProof.execution.averagePrice}</span>
                </div>
                {settlementProof.verification.merkleRoot && (
                  <div className={styles.detail}>
                    <span>Proof Hash:</span>
                    <span className={styles.mono}>{DOMPurify.sanitize(truncateHash(settlementProof.verification.merkleRoot))}</span>
                  </div>
                )}
              </div>
            )}

            {showProofDetails && settlementProof && (
              <div className={styles.proofDetails}>
                <h5>Execution Details</h5>
                <pre className={styles.jsonDisplay}>
                  {JSON.stringify({
                    executionId: settlementProof.matchingEngineProof.executionId,
                    pair: settlementProof.matchingEngineProof.pair,
                    side: settlementProof.matchingEngineProof.side,
                    trades: settlementProof.trades.length,
                    totalValue: settlementProof.execution.totalValue
                  }, null, 2)}
                </pre>

                {settlementProof.trades.length > 0 && (
                  <>
                    <h5>Trade Details</h5>
                    <div className={styles.tradesTable}>
                      {settlementProof.trades.map((trade, index) => (
                        <div key={trade.id} className={styles.tradeRow}>
                          <span>Trade {index + 1}:</span>
                          <span>{trade.quantity} @ {trade.price}</span>
                          <span>Fee: {trade.fee}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {settlementProof.hybridProof && (
                  <>
                    <h5>Hybrid Execution</h5>
                    <pre className={styles.jsonDisplay}>
                      {JSON.stringify(settlementProof.hybridProof, null, 2)}
                    </pre>
                  </>
                )}

                <h5>Cryptographic Proof</h5>
                <div className={styles.cryptoProof}>
                  <div className={styles.detail}>
                    <span>Order Hash:</span>
                    <span className={styles.mono}>{DOMPurify.sanitize(truncateHash(settlementProof.orderHash))}</span>
                  </div>
                  <div className={styles.detail}>
                    <span>Signature:</span>
                    <span className={styles.mono}>{DOMPurify.sanitize(truncateHash(settlementProof.signature))}</span>
                  </div>
                  <div className={styles.detail}>
                    <span>Merkle Root:</span>
                    <span className={styles.mono}>{DOMPurify.sanitize(truncateHash(settlementProof.verification.merkleRoot))}</span>
                  </div>
                </div>
              </div>
            )}
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
                <h5>⚡ Force On-Chain Settlement</h5>
                <p>Execute the trade on-chain at current market prices. Gas fees apply.</p>
                {settlementProof && settlementProof.execution.status === 'FILLED' && (
                  <p className={styles.warning}>
                    ⚠️ Trade was already executed. On-chain settlement may result in different prices.
                  </p>
                )}
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
                <p>Cancel the trade and return your deposited tokens. Small gas fee required.</p>
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
              className={styles.proceedButton} 
              onClick={handleAction}
              disabled={!selectedOption || isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Proceed with Resolution'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default DisputeModal;