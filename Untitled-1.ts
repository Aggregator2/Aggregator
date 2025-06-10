import { useMemo } from "react";
import { ethers } from "ethers";

// Replace with your Escrow contract's ABI and address
const ESCROW_CONTRACT_ADDRESS = "0xYourEscrowContractAddress";
const ESCROW_CONTRACT_ABI = [
  // ...Your Escrow contract ABI here...
];

export function useEscrowContract() {
  return useMemo(() => {
    if (!window.ethereum) return null;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const contractPromise = provider.getSigner().then((signer) => {
      return new ethers.Contract(
        ESCROW_CONTRACT_ADDRESS,
        ESCROW_CONTRACT_ABI,
        signer
      );
    });
    return contractPromise;
  }, []);
}