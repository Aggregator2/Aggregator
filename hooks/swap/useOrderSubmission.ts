import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { getSigner } from '../../utils/getSigner';
import { hashOrder } from '../../utils/hashOrder';
import type { Order, Quote, Token } from '../../types/wallet';

interface UseOrderSubmissionProps {
  walletAddress: string | null;
  showInfo: (message: string) => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  showOrderSubmitted: (
    orderId: string,
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    buyAmount: string
  ) => void;
  showOrderFilled: (
    orderId: string,
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    buyAmount: string,
    txHash: string
  ) => void;
  onSubmitOrder?: (order: any) => void;
  connectWallet: () => Promise<void>;
}

interface UseOrderSubmissionReturn {
  submitOrder: (
    sellToken: Token,
    buyToken: Token,
    sellAmount: string,
    currentQuote: Quote | null
  ) => Promise<void>;
  submitEscrowDeposit: (
    currentQuote: Quote,
    escrowContractFactory: (() => Promise<any>) | null
  ) => Promise<void>;
  escrowLoading: boolean;
  escrowError: string | null;
  submitError: string | null;
}

// EIP-712 definitions
const EIP712_DOMAIN = {
  name: "MetaAggregator",
  version: "1",
  chainId: 31337,
  verifyingContract: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
};

const EIP712_TYPES = {
  Order: [
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "appData", type: "bytes32" },
    { name: "feeAmount", type: "uint256" },
    { name: "kind", type: "string" },
    { name: "partiallyFillable", type: "bool" },
    { name: "receiver", type: "address" },
    { name: "user", type: "address" },
    { name: "signingScheme", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "wallet", type: "address" },
  ],
};

export function useOrderSubmission({
  walletAddress,
  showInfo,
  showError,
  showSuccess,
  showOrderSubmitted,
  showOrderFilled,
  onSubmitOrder,
  connectWallet,
}: UseOrderSubmissionProps): UseOrderSubmissionReturn {
  const [escrowLoading, setEscrowLoading] = useState(false);
  const [escrowError, setEscrowError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * Submit order to backend
   */
  const submitOrderToBackend = useCallback(async (signedOrder: any, sellToken: Token, buyToken: Token, sellAmount: string, currentQuote: Quote) => {
    try {
      const response = await fetch("/api/submitOrder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedOrder),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Submission failed");
      }

      const data = await response.json();

      // Show order toast notification
      const orderId = data.orderId || Date.now().toString();
      showOrderSubmitted(
        orderId,
        sellToken.symbol,
        buyToken.symbol,
        sellAmount,
        ethers.formatUnits(
          currentQuote.buyAmount || "0",
          buyToken.decimals || 18
        )
      );

      // Simulate order fill after a delay (in real app, this would come from websocket/polling)
      setTimeout(() => {
        showOrderFilled(
          orderId,
          sellToken.symbol,
          buyToken.symbol,
          sellAmount,
          ethers.formatUnits(
            currentQuote.buyAmount || "0",
            buyToken.decimals || 18
          ),
          data.txHash || "0x" + "0".repeat(64)
        );
      }, 3000);
    } catch (error: any) {
      throw new Error(error.message || "Network error during submission");
    }
  }, [showOrderSubmitted, showOrderFilled]);

  /**
   * Main order submission handler
   */
  const submitOrder = useCallback(async (
    sellToken: Token,
    buyToken: Token,
    sellAmount: string,
    currentQuote: Quote | null
  ) => {
    setSubmitError(null);

    if (!walletAddress) {
      showError("Please connect your wallet first");
      await connectWallet();
      return;
    }

    if (!currentQuote) {
      showError("No quote available. Please wait for quote to load.");
      return;
    }

    const amount = parseFloat(sellAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      showError("Please enter a valid amount to sell");
      return;
    }

    try {
      // Get signer safely
      const signerResult = await getSigner();
      if (!signerResult.success || !signerResult.signer) {
        showError(signerResult.error || "Failed to get wallet signer");
        return;
      }

      const { signer, address } = signerResult;

      if (address && address.toLowerCase() !== walletAddress.toLowerCase()) {
        showError("Connected wallet address doesn't match. Please reconnect.");
        return;
      }

      const baseUnits = ethers.parseUnits(sellAmount, 18).toString();
      const validTo = Math.floor(Date.now() / 1000) + 1800; // 30 minutes

      const order: Order = {
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: baseUnits,
        buyAmount: currentQuote.buyAmount || "0",
        validTo,
        user: address,
        receiver: address,
        wallet: address,
        appData: "0x" + "00".repeat(32),
        feeAmount: String(currentQuote.lpFee || "0"),
        partiallyFillable: false,
        kind: "sell",
        signingScheme: "eip712",
        nonce: 0,
      };

      // Validate order
      const missingFields = Object.entries(order)
        .filter(
          ([_, value]) => value === undefined || value === null || value === ""
        )
        .map(([key]) => key);

      if (missingFields.length > 0) {
        throw new Error(`Missing order fields: ${missingFields.join(", ")}`);
      }

      showInfo("Please sign the transaction in your wallet...");

      // Sign the order
      const signature = await signer.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        order
      );

      // Submit to backend or parent component
      if (onSubmitOrder) {
        await onSubmitOrder({ order, signature });
      } else {
        await submitOrderToBackend({ order, signature }, sellToken, buyToken, sellAmount, currentQuote);
      }
    } catch (error: any) {
      let errorMessage = "Failed to submit order";

      if (error.code === 4001) {
        errorMessage = "Transaction rejected by user";
      } else if (error.code === -32002) {
        errorMessage = "Request already pending. Please check MetaMask.";
      } else if (error.message?.includes("insufficient funds")) {
        errorMessage = "Insufficient balance for this transaction";
      } else if (error.message?.includes("gas")) {
        errorMessage = "Transaction failed due to gas estimation error";
      } else if (error.message) {
        errorMessage = error.message;
      }

      setSubmitError(errorMessage);
      showError(errorMessage);
      console.error("Order submission error:", error);
    }
  }, [walletAddress, showInfo, showError, onSubmitOrder, submitOrderToBackend, connectWallet]);

  /**
   * Submit escrow deposit
   */
  const submitEscrowDeposit = useCallback(async (
    currentQuote: Quote,
    escrowContractFactory: (() => Promise<any>) | null
  ) => {
    if (!escrowContractFactory) {
      showError("Escrow not available. Please connect wallet first.");
      return;
    }

    setEscrowLoading(true);
    setEscrowError(null);

    try {
      const contract = await escrowContractFactory();
      
      // Create a proper order object for hashing
      const orderForHash: Order = {
        sellToken: currentQuote.sellToken,
        buyToken: currentQuote.buyToken,
        sellAmount: currentQuote.sellAmount,
        buyAmount: currentQuote.buyAmount,
        validTo: currentQuote.validTo || Math.floor(Date.now() / 1000) + 1800,
        user: walletAddress || '',
        receiver: walletAddress || '',
        wallet: walletAddress || '',
        appData: "0x" + "00".repeat(32),
        feeAmount: String(currentQuote.lpFee || "0"),
        partiallyFillable: false,
        kind: "sell",
        signingScheme: "eip712",
        nonce: 0
      };
      
      const orderId = hashOrder(orderForHash);
      const tx = await contract.deposit(
        currentQuote.sellToken,
        currentQuote.sellAmount
      );

      showInfo("Transaction submitted. Waiting for confirmation...");
      await tx.wait();

      await submitEscrowTx(orderId, tx.hash);
      showSuccess("Deposited to Escrow successfully!");
    } catch (error: any) {
      const errorMessage = error.message || "Escrow deposit failed";
      setEscrowError(errorMessage);
      showError(errorMessage);
    } finally {
      setEscrowLoading(false);
    }
  }, [walletAddress, showInfo, showError, showSuccess]);

  return {
    submitOrder,
    submitEscrowDeposit,
    escrowLoading,
    escrowError,
    submitError,
  };
}

/**
 * Helper function to submit escrow transaction
 */
async function submitEscrowTx(orderId: string, txHash: string) {
  await fetch("/api/markEscrowDeposit", {
    method: "POST",
    body: JSON.stringify({ orderId, txHash }),
    headers: { "Content-Type": "application/json" },
  });
}