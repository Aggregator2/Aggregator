import React from 'react';
import { TokenWarning as TokenWarningType } from '../src/config/tokenRegistry';
import styles from './TokenWarning.module.css';

interface TokenWarningProps {
  warnings: TokenWarningType[];
  tokenSymbol: string;
  onDismiss?: () => void;
  showHelp?: boolean;
}

export const TokenWarning: React.FC<TokenWarningProps> = ({
  warnings,
  tokenSymbol,
  onDismiss,
  showHelp = true
}) => {
  if (warnings.length === 0) return null;

  // Sort warnings by severity (critical > warning > info)
  const sortedWarnings = [...warnings].sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  // Get the highest severity warning for styling
  const highestSeverity = sortedWarnings[0].severity;

  return (
    <div className={`${styles.warningContainer} ${styles[highestSeverity]}`}>
      <div className={styles.warningHeader}>
        <div className={styles.warningIcon}>
          {highestSeverity === 'critical' ? '⚠️' : 
           highestSeverity === 'warning' ? '⚡' : 'ℹ️'}
        </div>
        <div className={styles.warningTitle}>
          {highestSeverity === 'critical' ? 'Critical Warning' :
           highestSeverity === 'warning' ? 'Warning' : 'Notice'} - {tokenSymbol}
        </div>
        {onDismiss && (
          <button className={styles.dismissButton} onClick={onDismiss}>
            ×
          </button>
        )}
      </div>
      
      <div className={styles.warningContent}>
        {sortedWarnings.map((warning, index) => (
          <div key={index} className={styles.warningItem}>
            <div className={styles.warningMessage}>
              {warning.message}
            </div>
            {showHelp && warning.helpText && (
              <div className={styles.helpText}>
                💡 {warning.helpText}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TokenWarning;