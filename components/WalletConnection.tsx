import React, { useState, useEffect } from 'react';
import styles from './WalletConnection.module.css';
import { 
  connectWallet, 
  disconnectWallet, 
  getConnectedAccounts, 
  watchAccountChanges,
  watchChainChanges,
  isMetaMaskInstalled 
} from '../utils/walletConnection';

interface WalletConnectionProps {
  onConnect?: (address: string) => void;
  onDisconnect?: () => void;
  requiredChainId?: number;
  className?: string;
}

const WalletConnection: React.FC<WalletConnectionProps> = ({
  onConnect,
  onDisconnect,
  requiredChainId,
  className = ''
}) => {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isMetaMaskAvailable, setIsMetaMaskAvailable] = useState(false);

  // Check for existing connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      setIsMetaMaskAvailable(isMetaMaskInstalled());
      const accounts = await getConnectedAccounts();
      if (accounts.length > 0) {
        setAddress(accounts[0]);
        onConnect?.(accounts[0]);
      }
    };
    checkConnection();
  }, [onConnect]);

  // Watch for account changes
  useEffect(() => {
    const unsubscribe = watchAccountChanges((accounts) => {
      if (accounts.length > 0) {
        setAddress(accounts[0]);
        onConnect?.(accounts[0]);
      } else {
        setAddress(null);
        onDisconnect?.();
      }
    });
    return unsubscribe;
  }, [onConnect, onDisconnect]);

  // Watch for chain changes
  useEffect(() => {
    const unsubscribe = watchChainChanges((newChainId) => {
      setChainId(newChainId);
      if (requiredChainId && parseInt(newChainId, 16) !== requiredChainId) {
        setError(`Please switch to chain ${requiredChainId}`);
      } else {
        setError(null);
      }
    });
    return unsubscribe;
  }, [requiredChainId]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);
    
    const result = await connectWallet({
      timeout: 30000,
      requiredChainId,
      onPendingRequest: () => {
        setError("Connection pending. Please check MetaMask.");
      }
    });
    
    if (result.success && result.address) {
      setAddress(result.address);
      onConnect?.(result.address);
    } else {
      setError(result.error || "Failed to connect");
    }
    
    setIsConnecting(false);
  };

  const handleDisconnect = async () => {
    await disconnectWallet();
    setAddress(null);
    setShowDropdown(false);
    onDisconnect?.();
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getChainName = (id: string | null) => {
    if (!id) return 'Unknown';
    const chainId = parseInt(id, 16);
    switch (chainId) {
      case 1: return 'Ethereum';
      case 42161: return 'Arbitrum';
      case 31337: return 'Localhost';
      default: return `Chain ${chainId}`;
    }
  };

  if (!isMetaMaskAvailable) {
    return (
      <div className={`${styles.walletConnection} ${className}`}>
        <button 
          className={styles.installButton}
          onClick={() => window.open('https://metamask.io/download/', '_blank')}
        >
          Install MetaMask
        </button>
      </div>
    );
  }

  if (address) {
    return (
      <div className={`${styles.walletConnection} ${className}`}>
        <div className={styles.connectedContainer}>
          <button 
            className={styles.addressButton}
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <span className={styles.statusDot} />
            <span className={styles.address}>{formatAddress(address)}</span>
            <svg 
              className={`${styles.chevron} ${showDropdown ? styles.chevronUp : ''}`}
              width="12" 
              height="12" 
              viewBox="0 0 12 12"
            >
              <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="2" fill="none"/>
            </svg>
          </button>
          
          {showDropdown && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownItem}>
                <span className={styles.label}>Network:</span>
                <span className={styles.value}>{getChainName(chainId)}</span>
              </div>
              <div className={styles.dropdownItem}>
                <span className={styles.label}>Address:</span>
                <span className={styles.value}>{formatAddress(address)}</span>
              </div>
              <button 
                className={styles.copyButton}
                onClick={() => {
                  navigator.clipboard.writeText(address);
                  // You could show a toast here
                }}
              >
                Copy Address
              </button>
              <button 
                className={styles.disconnectButton}
                onClick={handleDisconnect}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.walletConnection} ${className}`}>
      <button 
        className={styles.connectButton}
        onClick={handleConnect}
        disabled={isConnecting}
      >
        {isConnecting ? (
          <>
            <span className={styles.spinner} />
            Connecting...
          </>
        ) : (
          'Connect Wallet'
        )}
      </button>
      
      {error && (
        <div className={styles.errorTooltip}>
          {error}
        </div>
      )}
    </div>
  );
};

export default WalletConnection;