import React, { useState, useRef, useEffect } from 'react';
import { ethers } from 'ethers';
import styles from './WalletHeader.module.css';
import type { Order } from '../types/wallet';

interface OrderWithStatus extends Omit<Order, 'status'> {
  status: 'pending' | 'filled' | 'failed';
  timestamp: Date;
  txHash?: string;
}

interface Notification {
  id: string;
  type: 'success' | 'error' | 'pending' | 'info';
  message: string;
  timestamp: Date;
  details?: any;
}

interface WalletHeaderProps {
  walletAddress: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  orders?: OrderWithStatus[];
  notifications?: Notification[];
  onClearNotifications?: () => void;
}

const WalletHeader: React.FC<WalletHeaderProps> = ({
  walletAddress,
  onConnect,
  onDisconnect,
  orders = [],
  notifications = [],
  onClearNotifications
}) => {
  const [showWalletDropdown, setShowWalletDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [balance, setBalance] = useState<string>('');
  const [showBalance, setShowBalance] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const walletRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const notifDropdownRef = useRef<HTMLDivElement>(null);

  // Format wallet address
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Copy address to clipboard
  const copyAddress = async () => {
    if (walletAddress) {
      await navigator.clipboard.writeText(walletAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  // Get current network
  const [network, setNetwork] = useState<string>('');
  
  useEffect(() => {
    if (walletAddress && window.ethereum) {
      const getNetwork = async () => {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const network = await provider.getNetwork();
          setNetwork(network.name || `Chain ${network.chainId}`);
        } catch (error) {
          console.error('Failed to get network:', error);
        }
      };
      getNetwork();
    }
  }, [walletAddress]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Check if the click is outside both wallet and notification sections
      const target = event.target as Node;
      
      // Don't close if clicking on the buttons themselves
      const isWalletButton = walletRef.current?.querySelector(`.${styles.walletButton}`)?.contains(target);
      const isNotifButton = notifRef.current?.querySelector(`.${styles.notificationButton}`)?.contains(target);
      
      if (!isWalletButton && walletRef.current && !walletRef.current.contains(target)) {
        setShowWalletDropdown(false);
        setShowBalance(false);
      }
      
      if (!isNotifButton && notifRef.current && !notifRef.current.contains(target)) {
        setShowNotifications(false);
      }
    };

    // Add a small delay to ensure React has finished updating
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  // Update unread count when new notifications come in
  useEffect(() => {
    if (!showNotifications) {
      const recentNotifications = notifications.filter(notif => {
        const notifTime = new Date(notif.timestamp).getTime();
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        return notifTime > fiveMinutesAgo;
      });
      setUnreadCount(recentNotifications.length);
    }
  }, [notifications, showNotifications]);

  // Adjust notification dropdown position to stay within viewport
  useEffect(() => {
    if (showNotifications && notifDropdownRef.current) {
      const dropdown = notifDropdownRef.current;
      const rect = dropdown.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const padding = 40; // Increased padding from viewport edge
      
      // Check if dropdown extends beyond right edge
      if (rect.right > viewportWidth - padding) {
        const overflow = rect.right - (viewportWidth - padding);
        dropdown.style.transform = `translateX(-${overflow}px)`;
      } else if (rect.left < padding) {
        // Also check if it goes too far left
        const overflow = padding - rect.left;
        dropdown.style.transform = `translateX(${overflow}px)`;
      } else {
        dropdown.style.transform = 'none';
      }
      
      // Check if dropdown extends beyond bottom edge
      const viewportHeight = window.innerHeight;
      if (rect.bottom > viewportHeight - padding) {
        const maxHeight = viewportHeight - rect.top - padding;
        dropdown.style.maxHeight = `${maxHeight}px`;
      }
    }
  }, [showNotifications]);

  const getStatusIcon = (type: string) => {
    switch (type) {
      case 'success':
      case 'filled':
        return '✅';
      case 'error':
      case 'failed':
        return '❌';
      case 'pending':
        return '⏳';
      case 'info':
        return 'ℹ️';
      default:
        return '📝';
    }
  };

  const getStatusColor = (type: string) => {
    switch (type) {
      case 'success':
      case 'filled':
        return '#4caf50';
      case 'error':
      case 'failed':
        return '#f44336';
      case 'pending':
        return '#ff9800';
      case 'info':
        return '#2196f3';
      default:
        return '#666666';
    }
  };
  
  const getNotificationClass = (type: string) => {
    switch (type) {
      case 'success':
        return styles.notifSuccess;
      case 'error':
        return styles.notifError;
      case 'pending':
        return styles.notifPending;
      default:
        return '';
    }
  };

  return (
    <div className={styles.walletHeader}>
      {/* Wallet Section */}
      <div className={styles.walletSection} ref={walletRef}>
        {walletAddress ? (
          <>
            <button
              className={`${styles.walletButton} ${showWalletDropdown ? styles.active : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowWalletDropdown(!showWalletDropdown);
              }}
            >
              <div className={styles.walletInfo}>
                <div className={styles.walletIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <span className={styles.walletAddress}>{formatAddress(walletAddress)}</span>
                <svg className={styles.chevron} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {showWalletDropdown && (
              <div className={styles.dropdown}>
                <div className={styles.dropdownHeader}>
                  <div className={styles.networkBadge}>
                    <div className={styles.networkDot} />
                    {network}
                  </div>
                </div>
                <div className={styles.dropdownItem}>
                  <span className={styles.fullAddress}>{walletAddress}</span>
                </div>
                <button className={styles.dropdownButton} onClick={(e) => {
                  e.stopPropagation();
                  copyAddress();
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {copiedAddress ? 'Copied!' : 'Copy Address'}
                </button>
                <button className={styles.dropdownButton} onClick={async (e) => {
                  e.stopPropagation();
                  if (window.ethereum && !showBalance) {
                    setShowBalance(true);
                    setBalance('Loading...');
                    try {
                      const provider = new ethers.BrowserProvider(window.ethereum);
                      const balanceWei = await provider.getBalance(walletAddress);
                      setBalance(ethers.formatEther(balanceWei));
                    } catch (error) {
                      console.error('Failed to get balance:', error);
                      // Retry once after a delay
                      setTimeout(async () => {
                        try {
                          const provider = new ethers.BrowserProvider(window.ethereum);
                          const balanceWei = await provider.getBalance(walletAddress);
                          setBalance(ethers.formatEther(balanceWei));
                        } catch (retryError) {
                          console.error('Retry failed:', retryError);
                          setBalance('Unable to load');
                        }
                      }, 1000);
                    }
                  }
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  View Wallet
                </button>
                {showBalance && (
                  <div className={styles.balanceInfo}>
                    <div className={styles.balanceLabel}>Balance</div>
                    <div className={styles.balanceAmount}>{balance} ETH</div>
                  </div>
                )}
                <div className={styles.dropdownDivider} />
                <button 
                  className={styles.dropdownButton} 
                  onClick={async (e) => {
                    e.stopPropagation();
                    setShowWalletDropdown(false);
                    setIsDisconnecting(true);
                    try {
                      await onDisconnect();
                    } catch (error) {
                      console.error('Error disconnecting wallet:', error);
                    } finally {
                      setIsDisconnecting(false);
                    }
                  }}
                  disabled={isDisconnecting || isSwitching}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                </button>
                <button 
                  className={styles.dropdownButton} 
                  onClick={async (e) => {
                    e.stopPropagation();
                    setShowWalletDropdown(false);
                    setIsSwitching(true);
                    try {
                      // First disconnect the current wallet
                      await onDisconnect();
                      
                      // Wait for disconnect to complete and UI to update
                      await new Promise(resolve => setTimeout(resolve, 600));
                      
                      // Then prompt for new wallet connection
                      await onConnect();
                    } catch (error) {
                      console.error('Error switching wallet:', error);
                      // Fallback: still try to connect
                      try {
                        await new Promise(resolve => setTimeout(resolve, 200));
                        await onConnect();
                      } catch (fallbackError) {
                        console.error('Fallback connect also failed:', fallbackError);
                      }
                    } finally {
                      setIsSwitching(false);
                    }
                  }}
                  disabled={isDisconnecting || isSwitching}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  {isSwitching ? 'Switching...' : 'Switch Wallet'}
                </button>
              </div>
            )}
          </>
        ) : (
          <button className={styles.connectButton} onClick={onConnect}>
            Connect Wallet
          </button>
        )}
      </div>

      {/* Notifications Section */}
      {walletAddress && (
        <div className={styles.notificationSection} ref={notifRef}>
          <button
            className={`${styles.notificationButton} ${showNotifications ? styles.active : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              setShowNotifications(prev => !prev);
              if (!showNotifications) {
                setUnreadCount(0);
              }
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unreadCount > 0 && (
              <span className={styles.notificationBadge}>{unreadCount}</span>
            )}
          </button>

          {showNotifications && (
            <div 
              ref={notifDropdownRef}
              className={styles.notificationDropdown}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <div className={styles.notificationHeader}>
                <h3>Notifications</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {notifications.length > 0 && (
                    <span className={styles.orderCount}>{notifications.length} items</span>
                  )}
                  {notifications.length > 0 && onClearNotifications && (
                    <button 
                      className={styles.clearAllButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearNotifications();
                      }}
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>
              <div className={styles.notificationList}>
                {notifications.length === 0 ? (
                  <div className={styles.emptyState}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" opacity="0.3">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    <p>No notifications yet</p>
                  </div>
                ) : (
                  notifications.slice(0, 20).map(notif => (
                    <div 
                      key={notif.id} 
                      className={`${styles.notificationItem} ${getNotificationClass(notif.type)}`}
                    >
                      <div className={styles.orderStatus} style={{ color: getStatusColor(notif.type) }}>
                        {getStatusIcon(notif.type)}
                      </div>
                      <div className={styles.orderDetails}>
                        <div className={styles.orderTokens}>
                          {notif.message}
                        </div>
                        <div className={styles.orderMeta}>
                          <span className={styles.orderTime}>
                            {new Date(notif.timestamp).toLocaleTimeString()}
                          </span>
                          {notif.details?.txHash && (
                            <a 
                              href={`https://etherscan.io/tx/${notif.details.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.txLink}
                            >
                              View tx →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WalletHeader;