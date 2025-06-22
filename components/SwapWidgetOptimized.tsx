import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { ethers } from "ethers";
import styles from "./SwapWidget.module.css";
import { useTokenPrice } from "../hooks/useTokenPrice";
import { useToast } from "../hooks/useToast";
import { useOrderToast } from "../hooks/useOrderToast";
import { useNetworkStatus } from "../hooks/useFallback";
import MarketOrderWidget from "./MarketOrderWidget";
import QuoteSummary from "./QuoteSummary";
import SkeletonLoader from "./SkeletonLoader";
import ErrorBoundary from "./ErrorBoundary";
import TokenPicker from "./TokenPicker";
import TokenSelector from "./TokenSelector";
import WalletHeader from "./WalletHeader";
import TokenWarning from "./TokenWarning";
import { hashOrder } from "../utils/hashOrder";
import { getSigner } from "../utils/getSigner";
import FixedEscrowABI from "../artifacts/contracts/FixedEscrow.sol/FixedEscrow.json";
import { ESCROW_CONTRACT_ADDRESS } from "../frontend/src/config/escrowAddress";
import { connectWallet as connectWalletUtil } from "../utils/walletConnection";
import { 
  getTokenWarnings, 
  isTokenBlacklisted,
  getTokenFeePercentage,
  isWrappedNativeToken 
} from "../src/config/tokenRegistry";
import { SpecialTokenService } from "../src/services/specialTokenService";
import type { Order, Quote, Token, WalletState, SwapFormState, ApiResponse } from "../types/wallet";

// Token list with symbol, name, and address
const DEFAULT_TOKENS: Token[] = [
  {
    symbol: "WETH",
    name: "Wrapped Ethereum",
    address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    logoURI:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    chainId: 1,
    type: "ERC-20",
    decimals: 18,
    tags: ["wrapped"],
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
    logoURI:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png",
    chainId: 1,
    type: "ERC-20",
    decimals: 18,
    tags: ["stablecoin"],
  },
];

export interface SwapWidgetProps {
  userAddress?: string;
  onConnect?: () => void;
  onSubmitOrder?: (order: any) => void;
  orders?: Order[];
}

// EIP-712 definitions for orders
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

// Type declarations for window.ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

/**
 * Lazy escrow contract factory - only creates contract when needed
 */
export function useEscrowContract(walletAddress: string | null) {
  return useMemo(() => {
    if (!walletAddress) return null;

    return async () => {
      try {
        const signerResult = await getSigner();
        if (!signerResult.success || !signerResult.signer) {
          throw new Error(signerResult.error || "Failed to get signer");
        }

        return new ethers.Contract(
          ESCROW_CONTRACT_ADDRESS,
          FixedEscrowABI.abi,
          signerResult.signer
        );
      } catch (error) {
        console.error("Error creating escrow contract:", error);
        throw error;
      }
    };
  }, [walletAddress]);
}

const SwapWidgetOptimized: React.FC<SwapWidgetProps> = ({
  userAddress,
  onConnect,
  onSubmitOrder,
  orders = [],
}) => {
  // Basic state
  const [walletAddress, setWalletAddress] = useState<string | null>(
    userAddress || null
  );
  const [tokens] = useState(DEFAULT_TOKENS);
  const [sellToken, setSellToken] = useState<Token>(DEFAULT_TOKENS[0]);
  const [buyToken, setBuyToken] = useState<Token>(DEFAULT_TOKENS[1]);
  const [sellAmount, setSellAmount] = useState("");
  const [activeTab, setActiveTab] = useState("swap");
  const [slippageTolerance, setSlippageTolerance] = useState("0.5");
  const [showSettings, setShowSettings] = useState(false);

  // Token picker state
  const [showSellTokenPicker, setShowSellTokenPicker] = useState(false);
  const [showBuyTokenPicker, setShowBuyTokenPicker] = useState(false);

  // Connection state
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Settlement mode
  const [settlementMode, setSettlementMode] = useState<"offchain" | "escrow">(
    "offchain"
  );

  // Escrow state
  const [escrowLoading, setEscrowLoading] = useState(false);
  const [escrowError, setEscrowError] = useState<string | null>(null);

  // Ref to prevent unnecessary re-renders
  const isInitialRender = useRef(true);

  // Quote state
  const [currentQuote, setCurrentQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteUpdatedAt, setQuoteUpdatedAt] = useState<Date | null>(null);
  const [isQuoteStale, setIsQuoteStale] = useState(false);

  // Token warning state
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
  const [showUnwrapOption, setShowUnwrapOption] = useState(false);
  
  // Submit order error
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Hooks
  const { showError, showSuccess, showWarning, showInfo, ToastContainer } =
    useToast();
  const {
    showOrderSubmitted,
    showOrderFilled,
    showOrderFailed,
    OrderToastContainer,
  } = useOrderToast();
  const networkStatus = useNetworkStatus();
  const sellTokenPriceData = useTokenPrice(sellToken.address);
  const buyTokenPriceData = useTokenPrice(buyToken.address);
  const escrowContractFactory = useEscrowContract(walletAddress);

  // ==================== PERFORMANCE OPTIMIZATIONS ====================
  
  // Memoize token addresses to prevent unnecessary re-renders
  const sellTokenAddress = useMemo(() => sellToken.address.toLowerCase(), [sellToken.address]);
  const buyTokenAddress = useMemo(() => buyToken.address.toLowerCase(), [buyToken.address]);
  const sellTokenChainId = useMemo(() => sellToken.chainId || 1, [sellToken.chainId]);
  const buyTokenChainId = useMemo(() => buyToken.chainId || 1, [buyToken.chainId]);
  
  // Memoize token identifiers for stable references
  const tokenPair = useMemo(() => ({
    sell: { address: sellTokenAddress, chainId: sellTokenChainId },
    buy: { address: buyTokenAddress, chainId: buyTokenChainId }
  }), [sellTokenAddress, sellTokenChainId, buyTokenAddress, buyTokenChainId]);

  // Memoize boolean checks
  const hasValidAmount = useMemo(() => {
    if (!sellAmount || sellAmount.trim() === "") return false;
    const parsed = parseFloat(sellAmount);
    return !isNaN(parsed) && parsed > 0;
  }, [sellAmount]);

  const isValidChainPair = useMemo(() => 
    sellTokenChainId === buyTokenChainId,
    [sellTokenChainId, buyTokenChainId]
  );

  // Memoize quote request parameters
  const quoteRequestParams = useMemo(() => {
    if (!hasValidAmount) return null;
    
    try {
      const parsedAmount = SpecialTokenService.parseTokenAmount(
        sellTokenAddress,
        sellTokenChainId,
        sellAmount,
        sellToken.decimals ?? 18
      );
      
      return {
        sellToken: sellTokenAddress,
        buyToken: buyTokenAddress,
        sellAmount: parsedAmount,
        chainId: sellTokenChainId,
      };
    } catch (e) {
      console.error("Failed to parse sell amount:", e);
      return null;
    }
  }, [sellTokenAddress, buyTokenAddress, sellAmount, sellTokenChainId, sellToken.decimals, hasValidAmount]);

  // ==================== STABLE CALLBACKS ====================

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
        requiredChainId: 31337, // Local development network
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
   * Enhanced quote fetching with retry and fallback
   */
  const fetchQuoteData = useCallback(async () => {
    if (!quoteRequestParams) {
      setCurrentQuote(null);
      setQuoteError(null);
      return;
    }

    setQuoteLoading(true);
    setQuoteError(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      // eslint-disable-next-line no-console
      console.log("Quote request:", quoteRequestParams);
      const response = await fetch("/api/unified-quote-simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quoteRequestParams),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Quote API error:", response.status, errorData);
        throw new Error(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`
        );
      }
      const data = await response.json();

      if (data.warning) {
        showWarning(data.warning);
      }

      // Add developer logs for quote source and fallbacks
      if (data.source && process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.log(`💰 Quote source: ${data.source}`);
        if (data.source !== "0x") {
          // eslint-disable-next-line no-console
          console.log(`🔄 Fallback used: ${data.source}`);
        }
      }

      setCurrentQuote(data);
      setQuoteUpdatedAt(new Date());
      setIsQuoteStale(false);
    } catch (error: any) {
      let errorMessage = "Failed to get quote";

      if (error.name === "AbortError") {
        errorMessage = "Quote request timed out. Please try again.";
      } else if (error.message?.includes("network")) {
        errorMessage = "Network error. Please check your connection.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      setQuoteError(errorMessage);
      setCurrentQuote(null);

      if (!networkStatus.isOnline) {
        showWarning("You appear to be offline. Please check your connection.");
      }
    } finally {
      setQuoteLoading(false);
    }
  }, [quoteRequestParams, networkStatus.isOnline, showWarning]);

  // Memoized quote fetch wrapper for stable reference
  const stableFetchQuoteData = useMemo(() => {
    let lastFetchId = 0;
    
    return async () => {
      const currentFetchId = ++lastFetchId;
      await fetchQuoteData();
      
      // Only update state if this is still the latest fetch
      return currentFetchId === lastFetchId;
    };
  }, [fetchQuoteData]);

  // Effect to fetch quotes when inputs change with debounce and polling
  useEffect(() => {
    let debounceTimeout: NodeJS.Timeout;
    let pollingInterval: NodeJS.Timeout;
    let isActive = true;
    let consecutiveFailures = 0;
    const MAX_FAILURES = 3;

    // Clear any existing quote when inputs change
    if (!hasValidAmount) {
      setCurrentQuote(null);
      setQuoteError(null);
      return;
    }

    // Wrapper to track failures
    const fetchWithFailureTracking = async () => {
      try {
        const stillValid = await stableFetchQuoteData();
        if (stillValid) {
          consecutiveFailures = 0; // Reset on success
        }
      } catch (error) {
        consecutiveFailures++;
        console.warn(
          `Quote fetch failed (${consecutiveFailures}/${MAX_FAILURES})`
        );

        // Stop polling after max failures
        if (consecutiveFailures >= MAX_FAILURES) {
          clearInterval(pollingInterval);
          console.warn("Stopping quote polling due to repeated failures");
        }
      }
    };

    // Set up debounced initial fetch
    debounceTimeout = setTimeout(() => {
      if (isActive && hasValidAmount) {
        fetchWithFailureTracking();

        // Set up polling interval for continuous updates
        pollingInterval = setInterval(() => {
          if (isActive && hasValidAmount && !quoteError) {
            fetchWithFailureTracking();
          }
        }, 10000); // Poll every 10 seconds to reduce load
      }
    }, 400); // 400ms debounce for responsive feel

    // Cleanup function
    return () => {
      isActive = false;
      clearTimeout(debounceTimeout);
      clearInterval(pollingInterval);
    };
  }, [stableFetchQuoteData, hasValidAmount, quoteError]);

  // Effect to mark quotes as stale after 10 seconds
  useEffect(() => {
    if (!quoteUpdatedAt) return;

    const checkStale = setInterval(() => {
      const now = new Date();
      const timeSinceUpdate = now.getTime() - quoteUpdatedAt.getTime();

      // Mark as stale after 10 seconds
      if (timeSinceUpdate > 10000) {
        setIsQuoteStale(true);
      }
    }, 1000);

    return () => clearInterval(checkStale);
  }, [quoteUpdatedAt]);

  // Token switching
  const handleSwitch = useCallback(() => {
    const tempToken = sellToken;
    setSellToken(buyToken);
    setBuyToken(tempToken);
  }, [sellToken, buyToken]);

  // Token selection handlers with memoization
  const handleSellTokenSelect = useCallback((token: Token) => {
    // Check if token is blacklisted
    if (isTokenBlacklisted(token.address, token.chainId ?? 1)) {
      showError(`${token.symbol} has been flagged and cannot be traded`);
      return;
    }
    
    setSellToken(token);
    setShowSellTokenPicker(false);
    // If selecting the same token as buy token, swap them
    if (token.address.toLowerCase() === buyTokenAddress) {
      setBuyToken(sellToken);
    }
    
    // Check if token is wrapped native
    setShowUnwrapOption(isWrappedNativeToken(token.address, token.chainId ?? 1));
  }, [buyTokenAddress, sellToken, showError]);

  const handleBuyTokenSelect = useCallback((token: Token) => {
    // Check if token is blacklisted
    if (isTokenBlacklisted(token.address, token.chainId ?? 1)) {
      showError(`${token.symbol} has been flagged and cannot be traded`);
      return;
    }
    
    setBuyToken(token);
    setShowBuyTokenPicker(false);
    // If selecting the same token as sell token, swap them
    if (token.address.toLowerCase() === sellTokenAddress) {
      setSellToken(buyToken);
    }
  }, [sellTokenAddress, buyToken, showError]);

  /**
   * Order submission with comprehensive error handling
   */
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

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
        await submitOrder({ order, signature });
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

      showError(errorMessage);
      console.error("Order submission error:", error);
    }
  }, [
    walletAddress,
    currentQuote,
    sellAmount,
    sellToken,
    buyToken,
    showError,
    showInfo,
    connectWallet,
    onSubmitOrder
  ]);

  /**
   * Submit order to backend
   */
  const submitOrder = useCallback(async (signedOrder: any) => {
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
          currentQuote?.buyAmount || "0",
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
            currentQuote?.buyAmount || "0",
            buyToken.decimals || 18
          ),
          data.txHash || "0x" + "0".repeat(64)
        );
      }, 3000);

      // Reset form
      setSellAmount("");
      setCurrentQuote(null);
    } catch (error: any) {
      throw new Error(error.message || "Network error during submission");
    }
  }, [
    sellToken.symbol,
    buyToken.symbol,
    buyToken.decimals,
    sellAmount,
    currentQuote,
    showOrderSubmitted,
    showOrderFilled
  ]);

  /**
   * Escrow deposit handling
   */
  const handleEscrowDeposit = useCallback(async () => {
    if (!currentQuote) {
      showError("No quote available for escrow deposit");
      return;
    }

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
        feeAmount: currentQuote.lpFee || 0,
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
  }, [currentQuote, escrowContractFactory, walletAddress, showError, showInfo, showSuccess]);

  // Memoized calculations
  const { buyAmount, actualBuyAmount, minReceived, feeCalculation } = useMemo(() => {
    if (!currentQuote?.buyAmount) {
      return { buyAmount: "0", actualBuyAmount: "0", minReceived: "0", feeCalculation: null };
    }

    const buyAmt = SpecialTokenService.formatTokenAmount(
      buyToken.address,
      buyToken.chainId,
      currentQuote.buyAmount,
      buyToken.decimals || 18
    );
    
    const feeCalc = SpecialTokenService.calculateFeeOnTransferAmount(
      buyToken.address,
      buyToken.chainId,
      currentQuote.buyAmount,
      buyToken.decimals || 18
    );
    
    const actualBuyAmt = feeCalc?.netAmount
      ? SpecialTokenService.formatTokenAmount(
          buyToken.address,
          buyToken.chainId,
          feeCalc.netAmount,
          buyToken.decimals || 18
        )
      : buyAmt;
    
    const minRec = currentQuote.minReceived
      ? parseFloat(
          SpecialTokenService.formatTokenAmount(
            buyToken.address,
            buyToken.chainId,
            currentQuote.minReceived,
            buyToken.decimals || 18
          )
        ).toFixed(6)
      : "0";

    return { buyAmount: buyAmt, actualBuyAmount: actualBuyAmt, minReceived: minRec, feeCalculation: feeCalc };
  }, [currentQuote, buyToken.address, buyToken.chainId, buyToken.decimals]);

  const { lpFeeAmount, slippageAmount, priceImpactAmount } = useMemo(() => {
    const sellAmountNum = parseFloat(sellAmount) || 0;
    const lpFeeRate = 0.003;
    const slippageRate = parseFloat(slippageTolerance) / 100;
    const priceImpactRate = 0.0012;

    return {
      lpFeeAmount: sellAmountNum * lpFeeRate,
      slippageAmount: sellAmountNum * slippageRate,
      priceImpactAmount: sellAmountNum * priceImpactRate,
    };
  }, [sellAmount, slippageTolerance]);

  // Disconnect wallet
  const disconnectWallet = useCallback(async () => {
    try {
      if (window.ethereum?.request) {
        await window.ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      }
      setWalletAddress(null);
      console.log("Wallet disconnected");
    } catch (error) {
      console.error("Error disconnecting wallet:", error);
    }
  }, []);

  // Ensure orders is always an array and map to expected format
  const safeOrders = useMemo(() => {
    const orderArray = Array.isArray(orders) ? orders : [];
    return orderArray.map(order => ({
      id: order.id || `${order.sellToken}-${order.buyToken}-${Date.now()}`,
      status: (order.status === 'filled' || order.status === 'failed' || order.status === 'pending') 
        ? order.status as 'filled' | 'failed' | 'pending'
        : 'pending' as const,
      timestamp: new Date(),
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      txHash: undefined
    }));
  }, [orders]);

  // Memoize token warnings
  const tokenWarnings = useMemo(() => {
    const sellWarnings = getTokenWarnings(sellToken.address, sellToken.chainId);
    const buyWarnings = getTokenWarnings(buyToken.address, buyToken.chainId);
    return { sellWarnings, buyWarnings };
  }, [sellToken.address, sellToken.chainId, buyToken.address, buyToken.chainId]);

  return (
    <ErrorBoundary>
      <div className={styles.tradeWrapper}>
        <ToastContainer />
        <OrderToastContainer />
        <WalletHeader
          walletAddress={walletAddress}
          onConnect={connectWallet}
          onDisconnect={disconnectWallet}
          orders={safeOrders}
        />
        <div className={styles.tradeCard}>
          <div className={styles.tradeHeader}>
            <div className={styles.tradeTitle}>
              Swap
              {!networkStatus.isOnline && (
                <span className={styles.offlineIndicator}>⚠️ Offline</span>
              )}
            </div>
            <button
              type="button"
              className={styles.settingsButton}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowSettings(!showSettings);
              }}
              onMouseDown={(e) => e.preventDefault()}
              title="Settings"
            >
              ⚙️
            </button>
          </div>

          <div className={styles.tabRow}>
            <button
              className={`${styles.tab} ${
                activeTab === "swap" ? styles.active : ""
              }`}
              onClick={() => setActiveTab("swap")}
              type="button"
            >
              Swap
            </button>
            <button
              className={`${styles.tab} ${
                activeTab === "limit" ? styles.active : ""
              }`}
              onClick={() => setActiveTab("limit")}
              type="button"
            >
              Limit
            </button>
          </div>

          {showSettings && (
            <div className={styles.settingsPanel}>
              <div className={styles.settingGroup}>
                <div className={styles.settingLabel}>
                  Slippage Tolerance
                  <span
                    className={styles.infoIcon}
                    title="Usually none but important for on-chain settlement if solver can't match"
                  >
                    !
                  </span>
                </div>
                <div className={styles.slippageInputContainer}>
                  <input
                    type="text"
                    value={slippageTolerance}
                    onChange={(e) => setSlippageTolerance(e.target.value)}
                    className={styles.slippageInput}
                    placeholder="0.5"
                  />
                  <span className={styles.slippagePercent}>%</span>
                </div>
              </div>

              <div className={styles.settingGroup}>
                <div className={styles.settingLabel}>
                  If No Match Found
                  <span
                    className={styles.infoIcon}
                    title="What happens if solver can't match your trade"
                  >
                    !
                  </span>
                </div>
                <div className={styles.settlementButtons}>
                  <button
                    type="button"
                    className={`${styles.settlementButton} ${
                      settlementMode === "offchain" ? styles.active : ""
                    }`}
                    onClick={() => setSettlementMode("offchain")}
                  >
                    Return Funds
                  </button>
                  <button
                    type="button"
                    className={`${styles.settlementButton} ${
                      settlementMode === "escrow" ? styles.active : ""
                    }`}
                    onClick={() => setSettlementMode("escrow")}
                  >
                    On-chain Settlement
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "swap" ? (
            <form onSubmit={handleSubmit}>
              <div className={styles.panelGroup}>
                <div className={styles.panelLabel}>Sell</div>
                <div className={styles.tokenPanel}>
                  <TokenSelector
                    selectedToken={sellToken}
                    onClick={() => setShowSellTokenPicker(true)}
                    disabled={connectingWallet || quoteLoading}
                    className={styles.tokenSelectorButton}
                  />
                  <input
                    type="number"
                    value={sellAmount}
                    onChange={(e) => setSellAmount(e.target.value)}
                    placeholder="0.0"
                    className={styles.amountInput}
                    disabled={connectingWallet || quoteLoading}
                  />
                </div>
                {sellTokenPriceData.error && (
                  <div className={styles.priceError}>
                    Price unavailable: {sellTokenPriceData.error}
                    <button type="button" onClick={sellTokenPriceData.retry}>
                      Retry
                    </button>
                  </div>
                )}
              </div>

              <div className={styles.switchContainer}>
                <button
                  type="button"
                  onClick={handleSwitch}
                  className={styles.switchButton}
                  disabled={connectingWallet || quoteLoading}
                >
                  ⇅
                </button>
              </div>

              <div className={styles.panelGroup}>
                <div className={styles.panelLabel}>Buy</div>
                <div className={styles.tokenPanel}>
                  <TokenSelector
                    selectedToken={buyToken}
                    onClick={() => setShowBuyTokenPicker(true)}
                    disabled={connectingWallet || quoteLoading}
                    className={styles.tokenSelectorButton}
                  />
                  <div className={styles.buyAmountContainer}>
                    {quoteLoading ? (
                      <SkeletonLoader
                        variant="text"
                        width="120px"
                        height="24px"
                      />
                    ) : (
                      <div style={{ position: "relative" }}>
                        <input
                          type="text"
                          value={buyAmount}
                          readOnly
                          className={styles.amountInput}
                          placeholder="0.0"
                          style={{
                            opacity: isQuoteStale ? 0.7 : 1,
                            transition: "opacity 0.3s ease",
                          }}
                        />
                        {quoteUpdatedAt && !quoteLoading && (
                          <div
                            style={{
                              position: "absolute",
                              right: "8px",
                              top: "50%",
                              transform: "translateY(-50%)",
                              fontSize: "10px",
                              color: isQuoteStale ? "#ff6b6b" : "#4caf50",
                              fontWeight: "bold",
                              animation: isQuoteStale
                                ? "pulse 1.5s infinite"
                                : "none",
                            }}
                            title={`Quote updated ${Math.floor(
                              (new Date().getTime() -
                                quoteUpdatedAt.getTime()) /
                                1000
                            )}s ago`}
                          >
                            {isQuoteStale ? "⚠" : "✓"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Token Warnings */}
              {(() => {
                const warningKey = `${sellToken.address}-${buyToken.address}`;
                
                // Show sell token warnings
                if (tokenWarnings.sellWarnings.length > 0 && !dismissedWarnings.has(`sell-${sellToken.address}`)) {
                  return (
                    <TokenWarning
                      warnings={tokenWarnings.sellWarnings}
                      tokenSymbol={sellToken.symbol}
                      onDismiss={() => {
                        setDismissedWarnings(prev => new Set([...prev, `sell-${sellToken.address}`]));
                      }}
                    />
                  );
                }
                
                // Show buy token warnings
                if (tokenWarnings.buyWarnings.length > 0 && !dismissedWarnings.has(`buy-${buyToken.address}`)) {
                  return (
                    <TokenWarning
                      warnings={tokenWarnings.buyWarnings}
                      tokenSymbol={buyToken.symbol}
                      onDismiss={() => {
                        setDismissedWarnings(prev => new Set([...prev, `buy-${buyToken.address}`]));
                      }}
                    />
                  );
                }
                
                return null;
              })()}
              
              {/* Fee-on-transfer token notice */}
              {feeCalculation && feeCalculation.feePercentage > 0 && (
                <div style={{
                  marginTop: "12px",
                  padding: "12px 16px",
                  backgroundColor: "rgba(251, 146, 60, 0.1)",
                  border: "1px solid rgba(251, 146, 60, 0.2)",
                  borderRadius: "8px",
                  fontSize: "14px",
                  color: "#ea580c",
                }}>
                  <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                    ⚡ Transfer Fee Token
                  </div>
                  <div>
                    {buyToken.symbol} charges a {feeCalculation.feePercentage}% fee on transfers.
                    You will receive approximately {actualBuyAmount} {buyToken.symbol} instead of {buyAmount}.
                  </div>
                </div>
              )}
              
              {/* Unwrap option for wrapped native tokens */}
              {showUnwrapOption && sellToken.symbol.startsWith('W') && (
                <div style={{
                  marginTop: "12px",
                  padding: "8px 12px",
                  backgroundColor: "rgba(59, 130, 246, 0.1)",
                  border: "1px solid rgba(59, 130, 246, 0.2)",
                  borderRadius: "8px",
                  fontSize: "13px",
                  color: "#2563eb",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}>
                  <span>💡 You can unwrap {sellToken.symbol} to native {sellToken.symbol.substring(1)}</span>
                  <button
                    type="button"
                    style={{
                      padding: "4px 12px",
                      backgroundColor: "#2563eb",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      fontSize: "12px",
                      cursor: "pointer"
                    }}
                    onClick={() => showInfo("Unwrap feature coming soon!")}
                  >
                    Unwrap
                  </button>
                </div>
              )}

              {quoteError && (
                <div className={styles.error}>
                  {quoteError}
                  <button
                    type="button"
                    onClick={() => {
                      setQuoteError(null);
                      fetchQuoteData();
                    }}
                    className={styles.retryButton}
                  >
                    Retry
                  </button>
                  <span
                    style={{
                      fontSize: "11px",
                      opacity: 0.7,
                      display: "block",
                      marginTop: "4px",
                    }}
                  >
                    Auto-refresh disabled due to errors
                  </span>
                </div>
              )}

              {/* Cross-chain swap warning */}
              {!isValidChainPair && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "12px 16px",
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                    borderRadius: "8px",
                    fontSize: "14px",
                    color: "#dc2626",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span style={{ fontSize: "16px" }}>⚠️</span>
                  <span>
                    Cross-chain swaps are not supported yet. Please select
                    tokens on the same network.
                  </span>
                </div>
              )}

              {!walletAddress ? (
                <button
                  type="button"
                  onClick={connectWallet}
                  className={styles.connectButton}
                  disabled={connectingWallet}
                >
                  {connectingWallet ? (
                    <>
                      <SkeletonLoader
                        variant="text"
                        width="80px"
                        height="16px"
                      />
                      Connecting...
                    </>
                  ) : (
                    "Connect Wallet"
                  )}
                </button>
              ) : (
                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={
                    connectingWallet ||
                    !sellAmount ||
                    !currentQuote?.buyAmount ||
                    quoteLoading ||
                    !!quoteError ||
                    !isValidChainPair
                  }
                >
                  {quoteLoading ? (
                    <>
                      <SkeletonLoader
                        variant="text"
                        width="60px"
                        height="16px"
                      />
                      Getting Quote...
                    </>
                  ) : !isValidChainPair ? (
                    "Cross-chain not supported"
                  ) : (
                    "Swap"
                  )}
                </button>
              )}
            </form>
          ) : (
            <MarketOrderWidget
              tokens={tokens}
              sellToken={sellToken}
              buyToken={buyToken}
              sellAmount={sellAmount}
              onSellTokenChange={setSellToken}
              onBuyTokenChange={setBuyToken}
              onSellAmountChange={setSellAmount}
              onSubmit={handleSubmit}
              rate={parseFloat(buyAmount) / parseFloat(sellAmount) || 0}
              showSlippage={showSettings}
              slippageTolerance={slippageTolerance}
              onSlippageClick={() => setShowSettings(!showSettings)}
              onSlippageChange={setSlippageTolerance}
              walletAddress={walletAddress}
              onConnect={connectWallet}
              connectingWallet={connectingWallet}
            />
          )}

          {currentQuote && !quoteLoading && activeTab === "swap" ? (
            <div className={styles.quoteSummary}>
              <QuoteSummary
                sellToken={sellToken.symbol}
                buyToken={buyToken.symbol}
                sellAmount={sellAmount}
                buyAmount={buyAmount}
                minReceived={minReceived}
                slippageTolerance={slippageTolerance}
                priceImpactAmount={priceImpactAmount.toFixed(4)}
                lpFeeAmount={lpFeeAmount.toFixed(4)}
                slippageAmount={slippageAmount.toFixed(4)}
                quote={currentQuote}
                validTo={
                  currentQuote?.validTo || Math.floor(Date.now() / 1000) + 3600
                }
              />
              {currentQuote?.source === "fallback" && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "8px 12px",
                    backgroundColor: "rgba(255, 193, 7, 0.1)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "#ffc107",
                  }}
                >
                  ⚠️ Using estimated pricing. Live quotes temporarily
                  unavailable.
                </div>
              )}
            </div>
          ) : quoteLoading ? (
            <div className={styles.quoteSummary}>
              <SkeletonLoader variant="quote" />
            </div>
          ) : null}

          {settlementMode === "escrow" && currentQuote && (
            <button
              type="button"
              className={styles.escrowButton}
              onClick={handleEscrowDeposit}
              disabled={escrowLoading || !currentQuote}
            >
              {escrowLoading ? (
                <>
                  <SkeletonLoader variant="text" width="120px" height="16px" />
                  Depositing...
                </>
              ) : (
                "Use Escrow"
              )}
            </button>
          )}

          {escrowError && (
            <div className={styles.error}>
              {escrowError}
              <button
                type="button"
                onClick={handleEscrowDeposit}
                className={styles.retryButton}
              >
                Try Again
              </button>
            </div>
          )}

          {/* Order Book Display - with defensive checks */}
          {safeOrders.length > 0 && (
            <div className={styles.orderBook}>
              <h3>Recent Orders</h3>
              <div className={styles.orderList}>
                {safeOrders.slice(0, 5).map((order, index) => (
                  <div key={order.id || index} className={styles.orderItem}>
                    {order.side || "SELL"} {order.sellAmount || "0"}{" "}
                    {tokens.find((t) => t.address === order.sellToken)
                      ?.symbol || "Unknown"}{" "}
                    → {order.buyAmount || "0"}{" "}
                    {tokens.find((t) => t.address === order.buyToken)?.symbol ||
                      "Unknown"}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Token Picker Modals */}
          <TokenPicker
            isOpen={showSellTokenPicker}
            onClose={() => setShowSellTokenPicker(false)}
            onTokenSelect={handleSellTokenSelect}
            selectedToken={sellToken}
            otherToken={buyToken}
            title="Select token to sell"
          />

          <TokenPicker
            isOpen={showBuyTokenPicker}
            onClose={() => setShowBuyTokenPicker(false)}
            onTokenSelect={handleBuyTokenSelect}
            selectedToken={buyToken}
            otherToken={sellToken}
            title="Select token to buy"
          />
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default SwapWidgetOptimized;

/**
 * Helper function to submit escrow transaction
 */
export async function submitEscrowTx(orderId: string, txHash: string) {
  await fetch("/api/markEscrowDeposit", {
    method: "POST",
    body: JSON.stringify({ orderId, txHash }),
    headers: { "Content-Type": "application/json" },
  });
}