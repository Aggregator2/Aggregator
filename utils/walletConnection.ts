import { ethers } from 'ethers';

export interface WalletConnectionResult {
  success: boolean;
  address?: string;
  error?: string;
  errorCode?: string | number;
}

export interface WalletConnectionOptions {
  timeout?: number;
  requiredChainId?: number;
  onPendingRequest?: () => void;
}

// LocalStorage keys
const STORAGE_KEYS = {
  WALLET_CONNECTED: 'walletConnected',
  WALLET_ADDRESS: 'walletAddress',
  WALLET_CHAIN_ID: 'walletChainId',
  CONNECTION_TIMESTAMP: 'walletConnectionTimestamp',
} as const;

// Connection expiry time (7 days)
const CONNECTION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Connection mutex to prevent concurrent connection attempts
let connectionInProgress = false;

// Error codes and their user-friendly messages
const ERROR_MESSAGES: Record<string | number, string> = {
  4001: 'Connection rejected by user',
  '-32002': 'Connection request already pending. Please check MetaMask.',
  '-32603': 'Internal JSON-RPC error. Please try again.',
  'NO_ETHEREUM': 'MetaMask is not installed. Please install MetaMask to continue.',
  'NO_ACCOUNTS': 'No accounts found. Please unlock MetaMask.',
  'TIMEOUT': 'Connection timed out. Please try again.',
  'CHAIN_MISMATCH': 'Please switch to the correct network.',
  'UNKNOWN': 'An unknown error occurred. Please try again.',
};

// Check if MetaMask is installed
export function isMetaMaskInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum?.isMetaMask;
}

// Wait for MetaMask to be available
export async function waitForMetaMask(timeout: number = 5000): Promise<boolean> {
  if (isMetaMaskInstalled()) return true;
  
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (isMetaMaskInstalled()) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return false;
}

// Check if there's already a pending connection request
export async function hasPendingRequest(): Promise<boolean> {
  if (!window.ethereum) return false;
  
  try {
    // Try to get accounts without requesting - if it throws with -32002, there's a pending request
    await window.ethereum.request({ method: 'eth_accounts' });
    return false;
  } catch (error: any) {
    // Check specifically for pending request error code
    if (error.code === -32002) {
      return true;
    }
    // For any other error, assume no pending request
    console.warn('Error checking pending request:', error);
    return false;
  }
}

// Save wallet connection to localStorage
function saveWalletConnection(address: string, chainId?: number): void {
  try {
    localStorage.setItem(STORAGE_KEYS.WALLET_CONNECTED, 'true');
    localStorage.setItem(STORAGE_KEYS.WALLET_ADDRESS, address);
    if (chainId !== undefined) {
      localStorage.setItem(STORAGE_KEYS.WALLET_CHAIN_ID, chainId.toString());
    }
    localStorage.setItem(STORAGE_KEYS.CONNECTION_TIMESTAMP, Date.now().toString());
  } catch (error) {
    console.error('Failed to save wallet connection to localStorage:', error);
  }
}

// Clear wallet connection from localStorage
export function clearWalletConnection(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.WALLET_CONNECTED);
    localStorage.removeItem(STORAGE_KEYS.WALLET_ADDRESS);
    localStorage.removeItem(STORAGE_KEYS.WALLET_CHAIN_ID);
    localStorage.removeItem(STORAGE_KEYS.CONNECTION_TIMESTAMP);
  } catch (error) {
    console.error('Failed to clear wallet connection from localStorage:', error);
  }
}

// Check if wallet connection is saved and not expired
export function getSavedWalletConnection(): { connected: boolean; address?: string; chainId?: number } {
  try {
    const connected = localStorage.getItem(STORAGE_KEYS.WALLET_CONNECTED) === 'true';
    const address = localStorage.getItem(STORAGE_KEYS.WALLET_ADDRESS);
    const chainId = localStorage.getItem(STORAGE_KEYS.WALLET_CHAIN_ID);
    const timestamp = localStorage.getItem(STORAGE_KEYS.CONNECTION_TIMESTAMP);

    if (!connected || !address) {
      return { connected: false };
    }

    // Check if connection is expired
    if (timestamp) {
      const connectionTime = parseInt(timestamp, 10);
      if (Date.now() - connectionTime > CONNECTION_EXPIRY_MS) {
        clearWalletConnection();
        return { connected: false };
      }
    }

    return {
      connected: true,
      address,
      chainId: chainId ? parseInt(chainId, 10) : undefined,
    };
  } catch (error) {
    console.error('Failed to get saved wallet connection:', error);
    return { connected: false };
  }
}

// Attempt to reconnect using saved connection
export async function attemptReconnection(): Promise<WalletConnectionResult> {
  const savedConnection = getSavedWalletConnection();
  
  if (!savedConnection.connected || !savedConnection.address) {
    return {
      success: false,
      error: 'No saved connection found',
      errorCode: 'NO_SAVED_CONNECTION',
    };
  }

  try {
    // Check if MetaMask is installed
    if (!isMetaMaskInstalled()) {
      clearWalletConnection();
      return {
        success: false,
        error: ERROR_MESSAGES.NO_ETHEREUM,
        errorCode: 'NO_ETHEREUM',
      };
    }

    // Get current accounts
    const accounts = await getConnectedAccounts();
    
    // Check if the saved address is still connected
    if (accounts.includes(savedConnection.address)) {
      // Verify chain if needed
      if (savedConnection.chainId) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const network = await provider.getNetwork();
        
        if (network.chainId !== BigInt(savedConnection.chainId)) {
          // Try to switch to saved chain
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${savedConnection.chainId.toString(16)}` }],
            });
          } catch (error) {
            console.warn('Failed to switch to saved chain:', error);
          }
        }
      }

      // Update timestamp
      saveWalletConnection(savedConnection.address, savedConnection.chainId);
      
      return {
        success: true,
        address: savedConnection.address,
      };
    } else {
      // Saved address not found in current accounts
      clearWalletConnection();
      return {
        success: false,
        error: 'Saved wallet no longer connected',
        errorCode: 'WALLET_DISCONNECTED',
      };
    }
  } catch (error: any) {
    console.error('Reconnection error:', error);
    clearWalletConnection();
    return {
      success: false,
      error: error.message || 'Failed to reconnect',
      errorCode: error.code || 'RECONNECTION_FAILED',
    };
  }
}

// Main wallet connection function with comprehensive error handling
export async function connectWallet(options: WalletConnectionOptions = {}): Promise<WalletConnectionResult> {
  const { 
    timeout = 15000, // Reduced from 30s to 15s for better UX
    requiredChainId, 
    onPendingRequest 
  } = options;
  
  // Check if connection is already in progress
  if (connectionInProgress) {
    return {
      success: false,
      error: 'Connection already in progress',
      errorCode: 'CONNECTION_IN_PROGRESS',
    };
  }
  
  connectionInProgress = true;
  
  try {
    // Check if MetaMask is installed
    if (!isMetaMaskInstalled()) {
      // Wait briefly for MetaMask to be available (useful for browser extensions loading)
      const available = await waitForMetaMask(3000);
      if (!available) {
        return {
          success: false,
          error: ERROR_MESSAGES.NO_ETHEREUM,
          errorCode: 'NO_ETHEREUM',
        };
      }
    }
    
    // Check for pending requests
    const isPending = await hasPendingRequest();
    if (isPending) {
      onPendingRequest?.();
      return {
        success: false,
        error: ERROR_MESSAGES['-32002'],
        errorCode: '-32002',
      };
    }
    
    const provider = new ethers.BrowserProvider(window.ethereum);
    
    // Request account access with timeout
    const accounts = await Promise.race([
      provider.send('eth_requestAccounts', []),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), timeout)
      ),
    ]) as string[];
    
    if (!accounts || accounts.length === 0) {
      return {
        success: false,
        error: ERROR_MESSAGES.NO_ACCOUNTS,
        errorCode: 'NO_ACCOUNTS',
      };
    }
    
    // Get the address directly from the first account
    const address = accounts[0];
    
    // Check network if required
    let chainId = requiredChainId;
    if (requiredChainId) {
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(requiredChainId)) {
        // Try to switch to the required network
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${requiredChainId.toString(16)}` }],
          });
        } catch (switchError: any) {
          // If chain doesn't exist, you might want to add it
          // For now, just return an error
          return {
            success: false,
            error: ERROR_MESSAGES.CHAIN_MISMATCH,
            errorCode: 'CHAIN_MISMATCH',
          };
        }
      }
    } else {
      // Get current chain ID if not specified
      const network = await provider.getNetwork();
      chainId = Number(network.chainId);
    }
    
    // Save connection to localStorage
    saveWalletConnection(address, chainId);
    
    return {
      success: true,
      address,
    };
    
  } catch (error: any) {
    console.error('Wallet connection error:', error);
    
    // Determine error type and message
    let errorCode: string | number = 'UNKNOWN';
    let errorMessage = ERROR_MESSAGES.UNKNOWN;
    
    if (error.code) {
      errorCode = error.code;
      errorMessage = ERROR_MESSAGES[error.code] || error.message || ERROR_MESSAGES.UNKNOWN;
    } else if (error.message?.includes('TIMEOUT')) {
      errorCode = 'TIMEOUT';
      errorMessage = ERROR_MESSAGES.TIMEOUT;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return {
      success: false,
      error: errorMessage,
      errorCode,
    };
  } finally {
    // Always reset the mutex
    connectionInProgress = false;
  }
}

// Disconnect wallet (clear permissions)
export async function disconnectWallet(): Promise<void> {
  // Simply clear the saved connection
  // Most wallets handle disconnection on their end
  clearWalletConnection();
}

// Get currently connected accounts
export async function getConnectedAccounts(): Promise<string[]> {
  if (!window.ethereum) return [];
  
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    return accounts || [];
  } catch (error) {
    console.error('Error getting accounts:', error);
    return [];
  }
}

// Watch for account changes
export function watchAccountChanges(callback: (accounts: string[]) => void): () => void {
  if (!window.ethereum) return () => {};
  
  const handler = (accounts: string[]) => {
    callback(accounts);
  };
  
  window.ethereum.on('accountsChanged', handler);
  
  // Return cleanup function
  return () => {
    window.ethereum.removeListener('accountsChanged', handler);
  };
}

// Watch for chain changes
export function watchChainChanges(callback: (chainId: string) => void): () => void {
  if (!window.ethereum) return () => {};
  
  const handler = (chainId: string) => {
    callback(chainId);
  };
  
  window.ethereum.on('chainChanged', handler);
  
  // Return cleanup function
  return () => {
    window.ethereum.removeListener('chainChanged', handler);
  };
}