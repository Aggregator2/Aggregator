import { useMemo } from "react";
import { ethers } from "ethers";

// Replace with your Escrow contract's ABI and address
const ESCROW_CONTRACT_ADDRESS = "0xYourEscrowContractAddress";
const ESCROW_CONTRACT_ABI = [
  // ...Your Escrow contract ABI here...
];

export function useEscrowContract(walletAddress: string | null) {
  return useMemo(() => {
    if (!window.ethereum || !walletAddress) return null;
    
    // Return a function that creates the contract when needed
    return async () => {
      try {
        // Check if accounts are available first
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (!accounts || accounts.length === 0) {
          throw new Error("No accounts connected");
        }
        
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const signerAddress = await signer.getAddress();
        
        // Verify the signer address matches the expected wallet
        if (signerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          throw new Error("Signer address doesn't match connected wallet");
        }
        
        return new ethers.Contract(
          ESCROW_CONTRACT_ADDRESS,
          ESCROW_CONTRACT_ABI,
          signer
        );
      } catch (error: any) {
        if (error.code === -32002) {
          throw new Error("MetaMask request already pending. Please check MetaMask.");
        }
        console.error("Failed to create escrow contract:", error);
        throw error;
      }
    };
  }, [walletAddress]);
}