import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import './SettlementProofViewer.css';

interface SettlementProofViewerProps {
  tradeId: string;
  apiEndpoint?: string;
  provider?: ethers.Provider;
  onVerified?: (verified: boolean) => void;
}

interface ProofData {
  tradeId: string;
  settlementBatchId: string;
  transactionHash?: string;
  blockNumber?: number;
  timestamp: number;
  trade: {
    buyer: string;
    seller: string;
    buyerAmount: string;
    sellerAmount: string;
    buyerToken: string;
    sellerToken: string;
    timestamp: number;
  };
  merkleProof: {
    root: string;
    leaf: string;
    proof: string[];
    position: number;
  };
  onChainVerification?: {
    onChainRoot: string;
    proofRoot: string;
    rootsMatch: boolean;
    proofValid: boolean;
    verifiedAt: string;
    error?: string;
  };
  etherscan?: {
    verificationUrl: string;
    calldata: string;
    verifyFunction: string;
  };
}

export const SettlementProofViewer: React.FC<SettlementProofViewerProps> = ({
  tradeId,
  apiEndpoint = '/api/settlement/proof',
  provider,
  onVerified
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proofData, setProofData] = useState<ProofData | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Fetch proof data
  useEffect(() => {
    fetchProofData();
  }, [tradeId]);

  const fetchProofData = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiEndpoint}/${tradeId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch proof');
      }

      setProofData(data.proof);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load proof');
    } finally {
      setLoading(false);
    }
  };

  // Verify proof on-chain
  const verifyOnChain = async () => {
    if (!proofData || !provider) return;

    setVerifying(true);
    setVerificationResult(null);

    try {
      // Fetch with verification
      const response = await fetch(`${apiEndpoint}/${tradeId}?verify=true`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      const verification = data.proof.onChainVerification;
      setVerificationResult(verification);
      
      if (verification && !verification.error) {
        setProofData(data.proof);
        if (onVerified) {
          onVerified(verification.proofValid);
        }
      }
    } catch (err) {
      setVerificationResult({
        error: err instanceof Error ? err.message : 'Verification failed',
        proofValid: false
      });
    } finally {
      setVerifying(false);
    }
  };

  // Copy to clipboard
  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  // Format address
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Format amount
  const formatAmount = (amount: string, decimals: number = 18) => {
    try {
      return ethers.formatUnits(amount, decimals);
    } catch {
      return amount;
    }
  };

  if (loading) {
    return (
      <div className="proof-viewer loading">
        <div className="spinner"></div>
        <p>Loading settlement proof...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="proof-viewer error">
        <div className="error-icon">⚠️</div>
        <p>{error}</p>
        <button onClick={fetchProofData} className="retry-button">
          Retry
        </button>
      </div>
    );
  }

  if (!proofData) {
    return (
      <div className="proof-viewer empty">
        <p>No proof data available</p>
      </div>
    );
  }

  return (
    <div className="proof-viewer">
      <div className="proof-header">
        <h3>Settlement Proof</h3>
        <div className="proof-status">
          {proofData.onChainVerification?.proofValid ? (
            <span className="verified">✓ Verified</span>
          ) : verificationResult?.error ? (
            <span className="unverified">✗ Verification Failed</span>
          ) : (
            <span className="pending">Unverified</span>
          )}
        </div>
      </div>

      {/* Trade Summary */}
      <div className="proof-section">
        <h4>Trade Details</h4>
        <div className="trade-summary">
          <div className="trade-row">
            <span className="label">Trade ID:</span>
            <span className="value monospace">{proofData.tradeId}</span>
          </div>
          <div className="trade-row">
            <span className="label">Buyer:</span>
            <span className="value address" title={proofData.trade.buyer}>
              {formatAddress(proofData.trade.buyer)}
              <button 
                className="copy-btn"
                onClick={() => copyToClipboard(proofData.trade.buyer, 'buyer')}
              >
                {copied === 'buyer' ? '✓' : '📋'}
              </button>
            </span>
          </div>
          <div className="trade-row">
            <span className="label">Seller:</span>
            <span className="value address" title={proofData.trade.seller}>
              {formatAddress(proofData.trade.seller)}
              <button 
                className="copy-btn"
                onClick={() => copyToClipboard(proofData.trade.seller, 'seller')}
              >
                {copied === 'seller' ? '✓' : '📋'}
              </button>
            </span>
          </div>
          <div className="trade-row">
            <span className="label">Amount:</span>
            <span className="value">
              {formatAmount(proofData.trade.buyerAmount)} / {formatAmount(proofData.trade.sellerAmount)}
            </span>
          </div>
        </div>
      </div>

      {/* Settlement Info */}
      <div className="proof-section">
        <h4>Settlement Information</h4>
        <div className="settlement-info">
          <div className="info-row">
            <span className="label">Batch ID:</span>
            <span className="value monospace small">
              {proofData.settlementBatchId}
            </span>
          </div>
          {proofData.transactionHash && (
            <div className="info-row">
              <span className="label">Transaction:</span>
              <a 
                href={`https://etherscan.io/tx/${proofData.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="value link"
              >
                {formatAddress(proofData.transactionHash)}
                <span className="external-link">↗</span>
              </a>
            </div>
          )}
          {proofData.blockNumber && (
            <div className="info-row">
              <span className="label">Block:</span>
              <span className="value">{proofData.blockNumber.toLocaleString()}</span>
            </div>
          )}
          <div className="info-row">
            <span className="label">Timestamp:</span>
            <span className="value">
              {new Date(proofData.timestamp).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Merkle Proof */}
      <div className="proof-section">
        <h4>Merkle Proof</h4>
        <div className="merkle-info">
          <div className="merkle-row">
            <span className="label">Root:</span>
            <span className="value monospace small" title={proofData.merkleProof.root}>
              {formatAddress(proofData.merkleProof.root)}
              <button 
                className="copy-btn"
                onClick={() => copyToClipboard(proofData.merkleProof.root, 'root')}
              >
                {copied === 'root' ? '✓' : '📋'}
              </button>
            </span>
          </div>
          <div className="merkle-row">
            <span className="label">Leaf Hash:</span>
            <span className="value monospace small" title={proofData.merkleProof.leaf}>
              {formatAddress(proofData.merkleProof.leaf)}
            </span>
          </div>
          <div className="merkle-row">
            <span className="label">Position:</span>
            <span className="value">{proofData.merkleProof.position}</span>
          </div>
          <div className="merkle-row">
            <span className="label">Proof Length:</span>
            <span className="value">{proofData.merkleProof.proof.length} hashes</span>
          </div>
        </div>

        {/* Show/Hide Details */}
        <button 
          className="toggle-details"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? 'Hide' : 'Show'} Proof Details
        </button>

        {showDetails && (
          <div className="proof-details">
            <h5>Proof Path:</h5>
            <div className="proof-path">
              {proofData.merkleProof.proof.map((hash, index) => (
                <div key={index} className="proof-hash">
                  <span className="hash-index">[{index}]</span>
                  <span className="hash-value monospace">{hash}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Verification */}
      <div className="proof-section">
        <h4>Verification</h4>
        
        {verificationResult ? (
          <div className={`verification-result ${verificationResult.proofValid ? 'valid' : 'invalid'}`}>
            {verificationResult.error ? (
              <>
                <div className="result-icon">✗</div>
                <div className="result-message">
                  <strong>Verification Failed</strong>
                  <p>{verificationResult.error}</p>
                </div>
              </>
            ) : (
              <>
                <div className="result-icon">✓</div>
                <div className="result-message">
                  <strong>Proof Verified</strong>
                  <p>This trade was included in the on-chain settlement.</p>
                  {verificationResult.onChainRoot && (
                    <div className="verification-details">
                      <div className="detail-row">
                        <span>On-chain Root:</span>
                        <span className="monospace small">
                          {formatAddress(verificationResult.onChainRoot)}
                        </span>
                      </div>
                      <div className="detail-row">
                        <span>Roots Match:</span>
                        <span className={verificationResult.rootsMatch ? 'yes' : 'no'}>
                          {verificationResult.rootsMatch ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div className="detail-row">
                        <span>Verified At:</span>
                        <span>
                          {new Date(verificationResult.verifiedAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="verification-pending">
            <p>Click the button below to verify this proof on-chain.</p>
            <button 
              className="verify-button"
              onClick={verifyOnChain}
              disabled={verifying || !provider}
            >
              {verifying ? (
                <>
                  <span className="spinner small"></span>
                  Verifying...
                </>
              ) : (
                'Verify On-Chain'
              )}
            </button>
            {!provider && (
              <p className="warning">
                Connect a wallet to enable on-chain verification
              </p>
            )}
          </div>
        )}

        {/* Etherscan Link */}
        {proofData.etherscan?.verificationUrl && (
          <div className="etherscan-link">
            <a 
              href={proofData.etherscan.verificationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="button secondary"
            >
              View on Etherscan
              <span className="external-link">↗</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
};