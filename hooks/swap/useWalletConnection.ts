import { useState, useCallback, useEffect, useRef } from 'react';
import { connectWallet as connectWalletUtil } from '../../utils/walletConnection';

interface UseWalletConnectionProps {
  userAddress?: string;
  onConnect?: () => void;
  showWarning: (message: string) => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

interface UseWalletConnectionReturn {
  walletAddress: string | null;
  connectingWallet: boolean;
  connectError: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
}

export function useWalletConnection({
  userAddress,
  onConnect,
  showWarning,
  showError,
  showSuccess,
}: UseWalletConnectionProps): UseWalletConnectionReturn {
  const [walletAddress, setWalletAddress] = useState<string | null>(
    userAddress || null
  );
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  
  // Ref to prevent unnecessary re-renders
  const isInitialRender = useRef(true);

  // Update wallet address from props with stability check
  useEffect(() => {
    if (
      userAddress &&
      userAddress !== walletAddress &&
      userAddress.length === 42
    ) {
      setWalletAddress(userAddress);
      if (isInitialRender.current) {
        isInitialRender.current = false;
      }
    }
  }, [userAddress, walletAddress]);

  /**
   * Connect wallet with robust error handling
   */
  const connectWallet = useCallback(async () => {
    if (connectingWallet) {
      showWarning("Connection already in progress...");
      return;
    }

    setConnectingWallet(true);
    setConnectError(null);

    try {
      const result = await connectWalletUtil({
        timeout: 30000,
        requiredChainId: 1, // Ethereum mainnet
        onPendingRequest: () => {
          showWarning(
            "Connection request already pending. Please check MetaMask."
          );
          setConnectError("Connection request pending - check MetaMask");
        },
      });

      if (result.success && result.address) {
        setWalletAddress(result.address);
        // Remove intrusive popup, just log connection
        console.log(`Wallet connected: ${result.address}`);
        onConnect?.();
      } else {
        const errorMsg = result.error || "Failed to connect wallet";
        setConnectError(errorMsg);
        showError(errorMsg);
      }
    } catch (error: any) {
      console.error("Wallet connection error:", error);
      const errorMsg = error.message || "Unexpected error connecting wallet";
      setConnectError(errorMsg);
      showError(errorMsg);
    } finally {
      setConnectingWallet(false);
    }
  }, [connectingWallet, showWarning, showError, onConnect]);

  /**
   * Disconnect wallet
   */
  const disconnectWallet = useCallback(async () => {
    try {
      if (window.ethereum?.request) {
        await window.ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      }
      setWalletAddress(null);
      setConnectError(null);
      console.log("Wallet disconnected");
    } catch (error) {
      console.error("Error disconnecting wallet:", error);
    }
  }, []);

  return {
    walletAddress,
    connectingWallet,
    connectError,
    connectWallet,
    disconnectWallet,
  };
}