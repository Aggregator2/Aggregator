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
    return error.code === -32002;
  }
}

// Main wallet connection function with comprehensive error handling
export async function connectWallet(options: WalletConnectionOptions = {}): Promise<WalletConnectionResult> {
  const { 
    timeout = 30000, 
    requiredChainId, 
    onPendingRequest 
  } = options;
  
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
    }
    
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
  }
}

// Disconnect wallet (clear permissions)
export async function disconnectWallet(): Promise<void> {
  if (window.ethereum?.request) {
    try {
      await window.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
    }
  }
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