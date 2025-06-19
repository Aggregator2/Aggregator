import React from 'react';
import styles from './TokenSelector.module.css';
import { Token } from '../types/wallet';

interface TokenSelectorProps {
  selectedToken?: Token;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export const TokenSelector: React.FC<TokenSelectorProps> = ({
  selectedToken,
  onClick,
  disabled = false,
  className = ''
}) => {
  return (
    <button
      type="button"
      className={`${styles.tokenSelector} ${className} ${disabled ? styles.disabled : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <div className={styles.tokenInfo}>
        <img
          src={selectedToken?.logoURI || '/images/fallback-token.png'}
          alt={selectedToken?.symbol || 'Select token'}
          className={styles.tokenIcon}
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            if (!img.src.endsWith('/images/fallback-token.png')) {
              img.src = '/images/fallback-token.png';
            }
          }}
        />
        <div className={styles.tokenDetails}>
          <span className={styles.tokenSymbol}>
            {selectedToken?.symbol || 'Select'}
          </span>
          {selectedToken?.name && (
            <span className={styles.tokenName}>
              {selectedToken.name}
            </span>
          )}
        </div>
      </div>
      
      <div className={styles.chevron}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </div>
    </button>
  );
};

export default TokenSelector;