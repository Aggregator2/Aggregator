import React, { useEffect, useState } from 'react';
import { useBalance } from '../hooks/useBalance';
import { ethers } from 'ethers';

interface BalanceCheckerProps {
  userAddress: string;
  tokens: Array<{
    address: string;
    symbol: string;
    decimals: number;
  }>;
  onValidationComplete?: (isValid: boolean) => void;
}

export const BalanceChecker: React.FC<BalanceCheckerProps> = ({
  userAddress,
  tokens,
  onValidationComplete
}) => {
  const {
    balances,
    loading,
    error,
    refreshAll,
    validateBalance,
    approveToken,
    isRefreshing
  } = useBalance({
    userAddress,
    tokens,
    autoRefresh: true,
    refreshInterval: 30000 // 30 seconds
  });

  const [validationResults, setValidationResults] = useState<Map<string, any>>(new Map());
  const [isApproving, setIsApproving] = useState<string | null>(null);

  // Example: Validate a specific amount for each token
  const handleValidateAmount = async (tokenAddress: string, amount: string) => {
    const result = await validateBalance(tokenAddress, amount);
    setValidationResults(prev => {
      const updated = new Map(prev);
      updated.set(tokenAddress, result);
      return updated;
    });
    
    if (onValidationComplete) {
      onValidationComplete(result.isValid);
    }
    
    return result;
  };

  // Handle token approval
  const handleApprove = async (tokenAddress: string, amount: string) => {
    setIsApproving(tokenAddress);
    try {
      const result = await approveToken(tokenAddress, amount);
      if (result.success) {
        console.log(`Approval successful! TX: ${result.txHash}`);
        // Refresh balance after approval
        await refreshAll();
      } else {
        console.error(`Approval failed: ${result.error}`);
      }
    } finally {
      setIsApproving(null);
    }
  };

  if (loading && balances.size === 0) {
    return <div className="loading">Loading balances...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="balance-checker">
      <div className="header">
        <h3>Token Balances</h3>
        <button 
          onClick={refreshAll} 
          disabled={isRefreshing}
          className="refresh-button"
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="balances">
        {tokens.map(token => {
          const balance = balances.get(token.address.toLowerCase());
          const validation = validationResults.get(token.address);
          
          return (
            <div key={token.address} className="token-balance">
              <div className="token-info">
                <span className="symbol">{token.symbol}</span>
                <span className="address">{token.address.slice(0, 6)}...{token.address.slice(-4)}</span>
              </div>
              
              {balance ? (
                <div className="balance-details">
                  <div className="amount">
                    <span className="label">Balance:</span>
                    <span className="value">{balance.balanceFormatted} {token.symbol}</span>
                  </div>
                  
                  <div className="allowance">
                    <span className="label">Allowance:</span>
                    <span className="value">{balance.allowanceFormatted}</span>
                  </div>
                  
                  {validation && (
                    <div className={`validation ${validation.isValid ? 'valid' : 'invalid'}`}>
                      {validation.isValid ? (
                        <span>✓ Sufficient balance and allowance</span>
                      ) : (
                        <div>
                          {validation.errors.map((error, idx) => (
                            <div key={idx} className="error-message">{error}</div>
                          ))}
                          {!validation.hasAllowance && validation.hasBalance && (
                            <button
                              onClick={() => handleApprove(token.address, validation.required)}
                              disabled={isApproving === token.address}
                              className="approve-button"
                            >
                              {isApproving === token.address ? 'Approving...' : 'Approve Token'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="updated">
                    Last updated: {new Date(balance.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ) : (
                <div className="loading">Loading...</div>
              )}
            </div>
          );
        })}
      </div>

      <style jsx>{`
        .balance-checker {
          padding: 20px;
          background: #f5f5f5;
          border-radius: 8px;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .refresh-button {
          padding: 8px 16px;
          background: #0066ff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        .refresh-button:hover {
          background: #0052cc;
        }

        .refresh-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .token-balance {
          background: white;
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 12px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .token-info {
          display: flex;
          justify-content: space-between;
          margin-bottom: 12px;
          font-weight: bold;
        }

        .symbol {
          font-size: 18px;
        }

        .address {
          color: #666;
          font-size: 14px;
        }

        .balance-details {
          font-size: 14px;
        }

        .amount, .allowance {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .label {
          color: #666;
        }

        .value {
          font-weight: 500;
        }

        .validation {
          padding: 8px;
          border-radius: 4px;
          margin: 12px 0;
        }

        .validation.valid {
          background: #d4edda;
          color: #155724;
        }

        .validation.invalid {
          background: #f8d7da;
          color: #721c24;
        }

        .error-message {
          margin-bottom: 4px;
        }

        .approve-button {
          margin-top: 8px;
          padding: 6px 12px;
          background: #28a745;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
        }

        .approve-button:hover {
          background: #218838;
        }

        .approve-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .updated {
          color: #999;
          font-size: 12px;
          margin-top: 8px;
        }

        .loading {
          color: #666;
          font-style: italic;
        }

        .error {
          color: #dc3545;
          padding: 12px;
          background: #f8d7da;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};