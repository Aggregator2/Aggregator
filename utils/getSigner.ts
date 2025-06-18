import { ethers } from 'ethers';

export interface GetSignerResult {
  success: boolean;
  signer?: ethers.JsonRpcSigner;
  address?: string;
  error?: string;
  errorCode?: string | number;
}

/**
 * Safely gets an ethers signer with comprehensive error handling
 * Prevents the -32002 "request already pending" error
 */
export async function getSigner(): Promise<GetSignerResult> {
  try {
    if (!window.ethereum) {
      return {
        success: false,
        error: 'MetaMask is not installed',
        errorCode: 'NO_ETHEREUM'
      };
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    
    // First, check if we already have accounts without triggering a request
    let accounts: string[];
    try {
      accounts = await provider.send('eth_accounts', []);
    } catch (error: any) {
      console.error('Error checking existing accounts:', error);
      return {
        success: false,
        error: 'Failed to check wallet connection',
        errorCode: error.code || 'UNKNOWN'
      };
    }

    // If no accounts, we need to request access
    if (!accounts || accounts.length === 0) {
      try {
        // Request accounts with proper error handling
        accounts = await provider.send('eth_requestAccounts', []);
      } catch (error: any) {
        // Handle specific error codes
        if (error.code === -32002) {
          return {
            success: false,
            error: 'Connection request already pending. Please check MetaMask.',
            errorCode: -32002
          };
        } else if (error.code === 4001) {
          return {
            success: false,
            error: 'Connection request rejected by user',
            errorCode: 4001
          };
        } else {
          return {
            success: false,
            error: error.message || 'Failed to connect wallet',
            errorCode: error.code || 'UNKNOWN'
          };
        }
      }
    }

    if (!accounts || accounts.length === 0) {
      return {
        success: false,
        error: 'No accounts available',
        errorCode: 'NO_ACCOUNTS'
      };
    }

    // Now safely get the signer
    try {
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      
      return {
        success: true,
        signer,
        address
      };
    } catch (error: any) {
      console.error('Error getting signer:', error);
      return {
        success: false,
        error: 'Failed to get wallet signer',
        errorCode: error.code || 'SIGNER_ERROR'
      };
    }
  } catch (error: any) {
    console.error('Unexpected error in getSigner:', error);
    return {
      success: false,
      error: error.message || 'Unexpected error',
      errorCode: error.code || 'UNKNOWN'
    };
  }
}