import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { ethers } from "ethers";
import DOMPurify from "dompurify";
import styles from "./SwapWidget.module.css";
import { useTokenPrice } from "../hooks/useTokenPrice";
// Removed old toast imports - using ModernNotificationSystem
import { useNetworkStatus } from "../hooks/useFallback";
import { useSimpleNotifications } from "../hooks/useSimpleNotifications";
import ModernNotificationSystem from "./ModernNotificationSystem";
import MarketOrderWidget from "./MarketOrderWidget";
import QuoteSummary from "./QuoteSummary";
import SkeletonLoader from "./SkeletonLoader";
import ErrorBoundary from "./ErrorBoundary";
import TokenPicker from "./TokenPicker";
import TokenSelector from "./TokenSelector";
import WalletHeader from "./WalletHeader";
import TokenWarning from "./TokenWarning";
import DisputeModal from "./DisputeModal";
import AnimatedBackground from "../src/components/AnimatedBackground";
import { hashOrder } from "../utils/hashOrder";
import { getSigner } from "../utils/getSigner";
import FixedEscrowABI from "../artifacts/contracts/FixedEscrow.sol/FixedEscrow.json";
import { ESCROW_CONTRACT_ADDRESS } from "../frontend/src/config/escrowAddress";
import { 
  connectWallet as connectWalletUtil,
  attemptReconnection,
  clearWalletConnection,
  disconnectWallet as disconnectWalletUtil,
  getSavedWalletConnection
} from "../utils/walletConnection";
import {
  getTokenWarnings,
  isTokenBlacklisted,
  isWrappedNativeToken,
} from "../src/config/tokenRegistry";
import { SpecialTokenService } from "../src/services/specialTokenService";
import type { Order, Quote, Token } from "../types/wallet";
import { generateTestJWT, storeAuthToken, getAuthToken, clearAuthToken } from "../utils/auth";

// Token list with symbol, name, and address
const DEFAULT_TOKENS: Token[] = [
  {
    symbol: "WETH",
    name: "Wrapped Ethereum",
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    logoURI:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    chainId: 1,
    type: "ERC-20",
    decimals: 18,
    tags: ["wrapped"],
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    logoURI:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png",
    chainId: 1,
    type: "ERC-20",
    decimals: 6,
    tags: ["stablecoin"],
  },
];

export interface SwapWidgetProps {
  userAddress?: string;
  onConnect?: () => void;
  onSubmitOrder?: (order: { order: Order; signature: string }) => void;
  orders?: Order[];
}

// EIP-712 definitions for orders
const EIP712_DOMAIN = {
  name: "SwappiQ",
  version: "1",
  chainId: 31337,
  verifyingContract: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
} as const;

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
} as const;

// Window.ethereum types are now declared in types/swapWidget.ts

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
        throw error;
      }
    };
  }, [walletAddress]);
}

const SwapWidget: React.FC<SwapWidgetProps> = ({
  userAddress,
  onConnect,
  onSubmitOrder,
  orders = [],
}) => {
  // Basic state
  const [walletAddress, setWalletAddress] = useState<string | null>(
    userAddress || null
  );
  const [localOrders, setLocalOrders] = useState<any[]>([]);
  const { notifications, notify, removeNotification } = useSimpleNotifications();
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
  const [lastQuoteUpdate, setLastQuoteUpdate] = useState<number>(0);
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  // Token warning state
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(
    new Set()
  );
  const [showUnwrapOption, setShowUnwrapOption] = useState(false);

  // Dispute state
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeOrder, setDisputeOrder] = useState<any>(null);

  // Balance state
  const [userBalance, setUserBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [insufficientBalance, setInsufficientBalance] = useState(false);

  // ==================== PERFORMANCE OPTIMIZATIONS ====================

  // Memoize token addresses to prevent unnecessary re-renders
  const sellTokenAddress = useMemo(
    () => sellToken.address.toLowerCase(),
    [sellToken.address]
  );
  const buyTokenAddress = useMemo(
    () => buyToken.address.toLowerCase(),
    [buyToken.address]
  );
  const sellTokenChainId = useMemo(
    () => sellToken.chainId || 1,
    [sellToken.chainId]
  );
  const buyTokenChainId = useMemo(
    () => buyToken.chainId || 1,
    [buyToken.chainId]
  );

  // Memoize token identifiers for stable references
  const tokenPair = useMemo(
    () => ({
      sell: { address: sellTokenAddress, chainId: sellTokenChainId },
      buy: { address: buyTokenAddress, chainId: buyTokenChainId },
    }),
    [sellTokenAddress, sellTokenChainId, buyTokenAddress, buyTokenChainId]
  );

  // Memoize boolean checks
  const hasValidAmount = useMemo(() => {
    if (!sellAmount || sellAmount.trim() === "") return false;
    const parsed = parseFloat(sellAmount);
    return !isNaN(parsed) && parsed > 0;
  }, [sellAmount]);

  // Check if user has sufficient balance
  const hasSufficientBalance = useMemo(() => {
    if (!userBalance || !sellAmount || balanceLoading) return true; // Assume true while loading
    try {
      const sellAmountWei = ethers.parseUnits(sellAmount, sellToken.decimals || 18);
      const balanceWei = BigInt(userBalance);
      const isSufficient = balanceWei >= sellAmountWei;
      return isSufficient;
    } catch (error) {
      return true; // Assume true on error to avoid blocking
    }
  }, [userBalance, sellAmount, sellToken.decimals, sellToken.symbol, balanceLoading]);

  // Cross-chain is now supported
  const isValidChainPair = useMemo(
    () => true, // Always true - cross-chain is supported
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
        toChainId: buyTokenChainId, // Add destination chain for cross-chain swaps
        slippageTolerance: slippageTolerance, // Add user's slippage preference
      };
    } catch (e) {
      return null;
    }
  }, [
    sellTokenAddress,
    buyTokenAddress,
    sellAmount,
    sellTokenChainId,
    sellToken.decimals,
    hasValidAmount,
    slippageTolerance,
  ]);

  // Hooks
  const { notify } = useSimpleNotifications();
  
  // Use new notification system for errors
  const showErrorNotification = useCallback((message: string) => {
    notify({
      type: 'error',
      title: 'Error',
      message: message,
      duration: 5000
    });
  }, [notify]);
  
  // Success notification helper
  const showSuccessNotification = useCallback((title: string, message?: string) => {
    notify({
      type: 'success',
      title: title,
      message: message,
      duration: 5000
    });
  }, [notify]);
  // Removed useOrderToast - using ModernNotificationSystem
  const networkStatus = useNetworkStatus();
  const sellTokenPriceData = useTokenPrice(sellToken.address);
  const buyTokenPriceData = useTokenPrice(buyToken.address);
  const escrowContractFactory = useEscrowContract(walletAddress);

  // Auto-reconnect wallet on component mount - only if user previously connected
  useEffect(() => {
    // Only attempt reconnection if no address is already set and user had a saved connection
    if (!walletAddress && !userAddress && isInitialRender.current) {
      const savedConnection = getSavedWalletConnection();
      if (savedConnection.connected) {
        attemptReconnection().then((result) => {
          if (result.success && result.address) {
            setWalletAddress(result.address);
            
            // Generate and store JWT token for authentication
            const token = generateTestJWT(result.address);
            storeAuthToken(token);
            
            // Show success notification for reconnection
            showSuccessNotification('Wallet Reconnected', `Reconnected to ${result.address.slice(0, 6)}...${result.address.slice(-4)}`);
            
            onConnect?.();
          }
        }).catch((error) => {
          // Silent fail - user can manually connect if needed
        });
      }
    }
  }, [onConnect]); // Include onConnect in dependencies

  /**
   * Fetch user balance for selected token
   */
  const fetchUserBalance = useCallback(async () => {
    if (!walletAddress || !window.ethereum) {
      setUserBalance(null);
      setBalanceError(null);
      return;
    }

    setBalanceLoading(true);
    setBalanceError(null);

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      
      // Check if it's ETH (native token)
      const isNativeToken = sellToken.address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
                           sellToken.symbol.toUpperCase() === 'ETH';
      
      if (isNativeToken) {
        // Fetch ETH balance
        const balance = await provider.getBalance(walletAddress);
        setUserBalance(balance.toString());
      } else {
        // Fetch ERC20 token balance - wrapped in try-catch to handle any errors
        try {
          const minimalERC20ABI = [
            "function balanceOf(address account) view returns (uint256)"
          ];
          const tokenContract = new ethers.Contract(
            sellToken.address,
            minimalERC20ABI,
            provider
          );
          const balance = await tokenContract.balanceOf(walletAddress);
          setUserBalance(balance.toString());
        } catch (error: any) {
          // Handle MetaMask circuit breaker errors gracefully
          if (error?.code === -32603 && error?.message?.includes('circuit breaker')) {
            console.log('[SwapWidget] MetaMask circuit breaker is open, retrying later...');
            // Don't set balance to 0, keep existing balance
            // Retry after 5 seconds
            setTimeout(() => {
              if (walletAddress) {
                fetchUserBalance();
              }
            }, 5000);
          } else {
            // For other errors, assume no balance
            setUserBalance('0');
          }
        }
      }
    } catch (error: any) {
      // Handle connection errors gracefully
      if (error?.code === -32603 && error?.message?.includes('circuit breaker')) {
        console.log('[SwapWidget] MetaMask circuit breaker is open, will retry later');
        // Don't update balance, keep existing value
      } else {
        // For other errors, assume no balance
        setUserBalance('0');
      }
    } finally {
      setBalanceLoading(false);
    }
  }, [walletAddress, sellToken.address, sellToken.symbol, sellToken.decimals]);

  // Debounced balance fetch
  const debouncedFetchBalance = useMemo(() => {
    let timeoutId: NodeJS.Timeout;
    return () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        fetchUserBalance();
      }, 300); // 300ms debounce
    };
  }, [fetchUserBalance]);

  // Fetch balance when wallet connects or token changes
  useEffect(() => {
    if (walletAddress && sellToken) {
      debouncedFetchBalance();
    }
  }, [walletAddress, sellToken, debouncedFetchBalance]);

  // Update insufficient balance state only (no automatic notification)
  useEffect(() => {
    const isNowInsufficientBalance = !hasSufficientBalance && hasValidAmount;
    
    // Only update state if it actually changes
    if (insufficientBalance !== isNowInsufficientBalance) {
      setInsufficientBalance(isNowInsufficientBalance);
    }
  }, [hasSufficientBalance, hasValidAmount, insufficientBalance]);


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
    setConnectingWallet(true);

    try {
      const result = await connectWalletUtil({
        timeout: 15000, // Reduced from 30s to 15s
        requiredChainId: 31337, // Local development network
        onPendingRequest: () => {
          // Connection request already pending
        },
      });

      if (result.success && result.address) {
        setWalletAddress(result.address);
        
        // Generate and store JWT token for authentication
        const token = generateTestJWT(result.address);
        storeAuthToken(token);
        
        // Show success notification
        showSuccessNotification('Wallet Connected', `Connected to ${result.address.slice(0, 6)}...${result.address.slice(-4)}`);
        
        onConnect?.();
      } else {
        const errorMsg = result.error || "Failed to connect wallet";
        showErrorNotification(errorMsg);
      }
    } catch (error: unknown) {
      const errorMsg =
        (error as Error).message || "Unexpected error connecting wallet";
      showErrorNotification(errorMsg);
    } finally {
      setConnectingWallet(false);
    }
  }, [showErrorNotification, onConnect]);

  /**
   * Disconnect wallet and clear localStorage
   */
  const disconnectWallet = useCallback(async () => {
    try {
      await disconnectWalletUtil();
      setWalletAddress(null);
      clearAuthToken(); // Clear JWT token on disconnect
    } catch (error) {
      // Fallback: clear local state anyway
      setWalletAddress(null);
      clearWalletConnection();
      clearAuthToken(); // Clear JWT token on disconnect
    }
  }, []);

  /**
   * Enhanced quote fetching with retry and fallback
   */
  const fetchQuoteData = useCallback(async () => {
    if (!quoteRequestParams) {
      setCurrentQuote(null);
      setQuoteError(null);
      return;
    }

    // Prevent updates if user is interacting or too soon after last update
    const now = Date.now();
    const timeSinceLastUpdate = now - lastQuoteUpdate;
    const MIN_UPDATE_INTERVAL = 5000; // 5 seconds minimum between updates
    
    if (isUserInteracting || (timeSinceLastUpdate < MIN_UPDATE_INTERVAL && currentQuote)) {
      return; // Skip this update
    }

    // Only show loading if we don't have a current quote
    if (!currentQuote) {
      setQuoteLoading(true);
    }
    setQuoteError(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch("/api/quote-profitable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quoteRequestParams),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          DOMPurify.sanitize(errorData.error || '') || `HTTP ${response.status}: ${response.statusText}`
        );
      }
      const data = await response.json();

      if (data.warning) {
        // Warning present but not logged
      }

      setCurrentQuote(data);
      setQuoteUpdatedAt(new Date());
      setIsQuoteStale(false);
      setLastQuoteUpdate(Date.now());
    } catch (error: any) {
      let errorMessage = "Failed to get quote";

      if (error.name === "AbortError") {
        errorMessage = "Quote request timed out. Please try again.";
      } else if (error.message?.includes("network")) {
        errorMessage = "Network error. Please check your connection.";
      } else if (error.message) {
        errorMessage = DOMPurify.sanitize(error.message);
      }

      setQuoteError(errorMessage);
      setCurrentQuote(null);

      if (!networkStatus.isOnline) {
        // User appears to be offline
      }
    } finally {
      setQuoteLoading(false);
    }
  }, [quoteRequestParams, networkStatus.isOnline, lastQuoteUpdate, isUserInteracting, currentQuote]);

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

        // Stop polling after max failures
        if (consecutiveFailures >= MAX_FAILURES) {
          clearInterval(pollingInterval);
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
        }, 30000); // Poll every 30 seconds to reduce API load and avoid rate limits
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

      // Mark as stale after 45 seconds (increased from 15 to account for longer refresh intervals)
      if (timeSinceUpdate > 45000) {
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
  const handleSellTokenSelect = useCallback(
    (token: Token) => {
      // Check if token is blacklisted
      if (isTokenBlacklisted(token.address, token.chainId ?? 1)) {
        showErrorNotification(`${DOMPurify.sanitize(token.symbol)} has been flagged and cannot be traded`);
        return;
      }

      setSellToken(token);
      setShowSellTokenPicker(false);
      // If selecting the same token as buy token, swap them
      if (token.address.toLowerCase() === buyTokenAddress) {
        setBuyToken(sellToken);
      }

      // Check if token is wrapped native
      setShowUnwrapOption(
        isWrappedNativeToken(token.address, token.chainId ?? 1)
      );
    },
    [buyTokenAddress, sellToken, showErrorNotification]
  );

  const handleBuyTokenSelect = useCallback(
    (token: Token) => {
      // Check if token is blacklisted
      if (isTokenBlacklisted(token.address, token.chainId ?? 1)) {
        showErrorNotification(`${DOMPurify.sanitize(token.symbol)} has been flagged and cannot be traded`);
        return;
      }

      setBuyToken(token);
      setShowBuyTokenPicker(false);
      // If selecting the same token as sell token, swap them
      if (token.address.toLowerCase() === sellTokenAddress) {
        setSellToken(buyToken);
      }
    },
    [sellTokenAddress, buyToken, showErrorNotification]
  );

  /**
   * Handle limit order submission from MarketOrderWidget
   */
  /**
   * Fetch unique nonce from API
   */
  const fetchNonce = async (address: string): Promise<string> => {
    try {
      const response = await fetch(`/api/nonce?address=${address}`);
      if (!response.ok) {
        throw new Error('Failed to fetch nonce');
      }
      const data = await response.json();
      return data.nonce;
    } catch (error) {
      // Fallback to timestamp-based nonce if API fails
      return `${Date.now()}${Math.random().toString(36).substring(2, 9)}`;
    }
  };

  const handleLimitOrderSubmit = async (limitOrder: any) => {
    if (!walletAddress) {
      showErrorNotification("Please connect your wallet first");
      await connectWallet();
      return;
    }

    // Check for insufficient balance
    if (insufficientBalance && limitOrder.sellAmount === sellAmount) {
      const availableAmount = userBalance ? ethers.formatUnits(userBalance, sellToken.decimals || 18) : '0';
      const shortage = parseFloat(limitOrder.sellAmount) - parseFloat(availableAmount);
      
      // Only show external notification
      notify.error(
        'Cannot Place Order',
        `You need ${shortage.toFixed(6)} more ${sellToken.symbol}`,
        20000
      );
      return;
    }

    try {
      // Get signer safely
      const signerResult = await getSigner();
      if (!signerResult.success || !signerResult.signer) {
        showErrorNotification(signerResult.error || "Failed to get wallet signer");
        return;
      }

      const { signer, address } = signerResult;

      if (address && address.toLowerCase() !== walletAddress.toLowerCase()) {
        showErrorNotification("Connected wallet address doesn't match. Please reconnect.");
        return;
      }

      // Fetch unique nonce
      const nonce = await fetchNonce(address || walletAddress);

      // Create order object for limit order
      const order: Order = {
        sellToken: limitOrder.sellToken,
        buyToken: limitOrder.buyToken,
        sellAmount: ethers.parseUnits(limitOrder.sellAmount, sellToken.decimals || 18).toString(),
        buyAmount: ethers.parseUnits(limitOrder.buyAmount, buyToken.decimals || 18).toString(),
        validTo: Math.floor(Date.now() / 1000) + limitOrder.expiry,
        user: address || "",
        receiver: address || "",
        wallet: address || "",
        appData: "0x" + "00".repeat(32),
        feeAmount: "0",
        partiallyFillable: true, // Limit orders are typically partially fillable
        kind: "sell",
        signingScheme: "eip712",
        nonce: parseInt(nonce) || Date.now(),
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

      // Sign the order
      const signature = await signer.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        order
      );

      // Add pending notification
      notify.info(
        'Submitting Limit Order',
        `${limitOrder.sellAmount} ${sellToken.symbol} → ${limitOrder.buyAmount} ${buyToken.symbol}`
      );

      // Submit to backend
      if (onSubmitOrder) {
        await onSubmitOrder({ order, signature });
      } else {
        await submitOrder({ order, signature });
      }
    } catch (error: any) {
      let errorMessage = "Failed to submit limit order";

      if (error.code === 4001) {
        errorMessage = "Transaction rejected by user";
      } else if (error.message) {
        errorMessage = DOMPurify.sanitize(error.message);
      }

      showErrorNotification(errorMessage);
      
      // Add error notification
      notify.error(
        'Limit Order Failed',
        errorMessage
      );
    }
  };

  /**
   * Order submission with comprehensive error handling
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!walletAddress) {
      showErrorNotification("Please connect your wallet first");
      await connectWallet();
      return;
    }

    if (!currentQuote) {
      showErrorNotification("No quote available. Please wait for quote to load.");
      return;
    }

    const amount = parseFloat(sellAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      showErrorNotification("Please enter a valid amount to sell");
      return;
    }

    // Check for insufficient balance
    if (insufficientBalance) {
      const availableAmount = userBalance ? ethers.formatUnits(userBalance, sellToken.decimals || 18) : '0';
      const shortage = parseFloat(sellAmount) - parseFloat(availableAmount);
      
      // Only show external notification
      notify.error(
        'Cannot Execute Swap',
        `You need ${shortage.toFixed(6)} more ${sellToken.symbol}`,
        20000
      );
      return;
    }

    try {
      // Get signer safely
      const signerResult = await getSigner();
      if (!signerResult.success || !signerResult.signer) {
        showErrorNotification(signerResult.error || "Failed to get wallet signer");
        return;
      }

      const { signer, address } = signerResult;

      if (address && address.toLowerCase() !== walletAddress.toLowerCase()) {
        showErrorNotification("Connected wallet address doesn't match. Please reconnect.");
        return;
      }

      // Fetch unique nonce
      const nonce = await fetchNonce(address || walletAddress);

      const baseUnits = ethers.parseUnits(sellAmount, sellToken.decimals || 18).toString();
      const validTo = Math.floor(Date.now() / 1000) + 1800; // 30 minutes

      const order: Order = {
        sellToken: sellToken.address || "",
        buyToken: buyToken.address || "",
        sellAmount: baseUnits || "0",
        buyAmount: currentQuote.buyAmount || "0",
        validTo,
        user: address || "",
        receiver: address || "",
        wallet: address || "",
        appData: "0x" + "00".repeat(32),
        feeAmount: String(currentQuote.lpFee || "0"),
        partiallyFillable: false,
        kind: "sell",
        signingScheme: "eip712",
        nonce: parseInt(nonce) || Date.now(),
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

      // Skip pre-validation to speed up MetaMask prompt
      // Validation will happen server-side after signing

      // Sign the order
      const signature = await signer.signTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        order
      );

      // Add pending notification
      notify.info(
        'Submitting Order',
        `${sellAmount} ${sellToken.symbol} → ${buyToken.symbol}`
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
        errorMessage = DOMPurify.sanitize(error.message);
      }

      showErrorNotification(errorMessage);
      
      // Add error notification
      notify.error(
        'Order Failed',
        errorMessage
      );
    }
  };

  /**
   * Submit order to backend
   */
  const submitOrder = async (signedOrder: any) => {
    try {
      // Use validated endpoint for production, fallback to regular for testing
      const endpoint = process.env.NODE_ENV === 'production' 
        ? "/api/submitOrder-validated" 
        : "/api/submitOrder";
        
      const token = getAuthToken();
      if (!token) {
        throw new Error("Authentication required. Please reconnect your wallet.");
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(signedOrder),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(DOMPurify.sanitize(errorData.error || '') || "Submission failed");
      }

      const data = await response.json();

      // Show order toast notification
      const orderId = data.orderId || Date.now().toString();
      const buyAmountFormatted = ethers.formatUnits(
        currentQuote?.buyAmount || "0",
        buyToken.decimals || 18
      );
      
      // Show success notification
      notify({
        type: 'success',
        title: 'Order Submitted',
        message: `${sellAmount} ${sellToken.symbol} → ${buyAmountFormatted} ${buyToken.symbol}`,
        duration: 20000 // 20 seconds for success
      });

      // Add to local orders for notifications
      const newOrder = {
        id: orderId,
        status: 'pending' as const,
        timestamp: new Date(),
        sellToken: sellToken.symbol,
        buyToken: buyToken.symbol,
        sellAmount: sellAmount,
        buyAmount: ethers.formatUnits(
          currentQuote?.buyAmount || "0",
          buyToken.decimals || 18
        ),
        txHash: data.txHash,
        sellTokenAddress: signedOrder.order.sellToken,
        buyTokenAddress: signedOrder.order.buyToken
      };
      setLocalOrders(prev => [newOrder, ...prev]);

      // Monitor order status (in real app, this would come from websocket/polling)
      monitorOrderStatus(
        orderId,
        signedOrder.order,
        sellToken.symbol,
        buyToken.symbol,
        sellAmount,
        ethers.formatUnits(
          currentQuote?.buyAmount || "0",
          buyToken.decimals || 18
        )
      );

      // Reset form
      setSellAmount("");
      setCurrentQuote(null);
    } catch (error: any) {
      throw new Error(error.message || "Network error during submission");
    }
  };

  /**
   * Escrow deposit handling
   */
  const handleEscrowDeposit = async () => {
    if (!currentQuote) {
      showErrorNotification("No quote available for escrow deposit");
      return;
    }

    if (!escrowContractFactory) {
      showErrorNotification("Escrow not available. Please connect wallet first.");
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
        user: walletAddress || "",
        receiver: walletAddress || "",
        wallet: walletAddress || "",
        appData: "0x" + "00".repeat(32),
        feeAmount: String(currentQuote.lpFee || "0"),
        partiallyFillable: false,
        kind: "sell",
        signingScheme: "eip712",
        nonce: 0,
      };
      const orderId = hashOrder(orderForHash);
      const tx = await contract.deposit(
        currentQuote.sellToken,
        currentQuote.sellAmount
      );

      await tx.wait();

      await submitEscrowTx(orderId, tx.hash);
    } catch (error: any) {
      const errorMessage = error.message || "Escrow deposit failed";
      setEscrowError(errorMessage);
      showErrorNotification(errorMessage);
    } finally {
      setEscrowLoading(false);
    }
  };

  // Memoized calculations
  const { buyAmount, actualBuyAmount, minReceived, feeCalculation } =
    useMemo(() => {
      if (!currentQuote?.buyAmount) {
        return {
          buyAmount: "0",
          actualBuyAmount: "0",
          minReceived: "0",
          feeCalculation: null,
        };
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

      return {
        buyAmount: buyAmt,
        actualBuyAmount: actualBuyAmt,
        minReceived: minRec,
        feeCalculation: feeCalc,
      };
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

  /**
   * Monitor order status and handle disputes
   */
  const monitorOrderStatus = async (
    orderId: string,
    order: Order,
    sellSymbol: string,
    buySymbol: string,
    sellAmountFormatted: string,
    buyAmountFormatted: string
  ) => {
    const checkInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/orders/${orderId}`);
        if (!response.ok) return;

        const orderStatus = await response.json();

        if (orderStatus.status === "filled") {
          clearInterval(checkInterval);
          // Show order filled notification
          notify({
            type: 'success',
            title: 'Order Filled!',
            message: `Swapped ${sellAmountFormatted} ${sellSymbol} for ${buyAmountFormatted} ${buySymbol}`,
            duration: 10000,
            action: orderStatus.txHash ? {
              label: 'View Transaction',
              onClick: () => window.open(`https://etherscan.io/tx/${orderStatus.txHash}`, '_blank')
            } : undefined
          });
          // Update local order status
          setLocalOrders(prev => prev.map(o => 
            o.id === orderId ? { ...o, status: 'filled' as const } : o
          ));
        } else if (
          orderStatus.status === "failed" ||
          orderStatus.status === "timeout"
        ) {
          clearInterval(checkInterval);

          // Update local order status
          setLocalOrders(prev => prev.map(o => 
            o.id === orderId ? { ...o, status: 'failed' as const } : o
          ));

          // Show dispute modal
          setDisputeOrder({
            orderId,
            order,
            status: orderStatus.status,
            reason: orderStatus.reason,
            sellSymbol,
            buySymbol,
            sellAmountFormatted,
            buyAmountFormatted,
          });
          setShowDisputeModal(true);

          // Log dispute to backend
          await logDispute(orderId, orderStatus.status, orderStatus.reason);

          // Show order failed notification
          notify({
            type: 'error',
            title: 'Order Failed',
            message: `Failed to swap ${sellAmountFormatted} ${sellSymbol} for ${buySymbol}. Order ${DOMPurify.sanitize(orderStatus.status)}. Dispute resolution available.`,
            duration: 15000,
            action: {
              label: 'Open Dispute',
              onClick: () => setShowDisputeModal(true)
            }
          });
        }
      } catch (error) {
        // Failed to check order status
      }
    }, 3000); // Check every 3 seconds

    // Stop monitoring after 5 minutes
    setTimeout(() => clearInterval(checkInterval), 300000);
  };

  /**
   * Log dispute to backend
   */
  const logDispute = async (
    orderId: string,
    status: string,
    reason?: string
  ) => {
    try {
      await fetch("/api/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          type: status,
          reason,
          userId: walletAddress,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (error) {
      // Failed to log dispute
    }
  };

  /**
   * Handle on-chain settlement
   */
  const handleSettleOnChain = async () => {
    if (!disputeOrder) return;

    try {
      // Call settlement API
      const response = await fetch("/api/disputes/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: disputeOrder.orderId,
          order: disputeOrder.order,
          method: "onchain",
        }),
      });

      if (response.ok) {
        // Settlement initiated. Transaction will be processed on-chain.
      } else {
        throw new Error("Settlement failed");
      }
    } catch (error) {
      showErrorNotification("Failed to initiate settlement. Please try again.");
      throw error;
    }
  };

  /**
   * Handle fund return
   */
  const handleReturnFunds = async () => {
    if (!disputeOrder) return;

    try {
      // Call return API
      const response = await fetch("/api/disputes/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: disputeOrder.orderId,
          order: disputeOrder.order,
        }),
      });

      if (response.ok) {
        // Funds will be returned to your wallet shortly.
      } else {
        throw new Error("Return failed");
      }
    } catch (error) {
      showErrorNotification("Failed to process return. Please try again.");
      throw error;
    }
  };

  
  // Ensure orders is always an array and map to expected format
  const safeOrders = useMemo(() => {
    const orderArray = Array.isArray(orders) ? orders : [];
    const mappedOrders = orderArray.map((order) => ({
      id: order.id || `${order.sellToken}-${order.buyToken}-${Date.now()}`,
      status:
        order.status === "filled" ||
        order.status === "failed" ||
        order.status === "pending"
          ? (order.status as "filled" | "failed" | "pending")
          : ("pending" as const),
      timestamp: new Date(),
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      txHash: undefined,
    }));
    
    // Combine with local orders, prioritizing local orders for duplicates
    const combinedOrders = [...localOrders];
    mappedOrders.forEach(order => {
      if (!combinedOrders.find(o => o.id === order.id)) {
        combinedOrders.push(order);
      }
    });
    
    return combinedOrders;
  }, [orders, localOrders]);

  // Memoize token warnings
  const tokenWarnings = useMemo(() => {
    const sellWarnings = getTokenWarnings(sellToken.address, sellToken.chainId);
    const buyWarnings = getTokenWarnings(buyToken.address, buyToken.chainId);
    return { sellWarnings, buyWarnings };
  }, [
    sellToken.address,
    sellToken.chainId,
    buyToken.address,
    buyToken.chainId,
  ]);

  return (
    <ErrorBoundary>
      <>
        {/* Global animated background - temporarily disabled to fix THREE.js errors */}
        {/* <AnimatedBackground theme="dark" /> */}
        
        {/* Modern Notification System */}
        <ModernNotificationSystem 
          notifications={notifications}
          onDismiss={removeNotification}
          position="top-right"
        />
        
        {/* Old toast containers removed - using ModernNotificationSystem */}
        
        {/* Floating Logo */}
        <div className={styles.floatingLogo}>
          <div className={styles.logoContainer}>
            <img 
              src="/images/swappiq-logo.png" 
              alt="SwappiQ Logo"
              className={styles.logoImage}
            />
            <div className={styles.logoText}>SWAPPIQ</div>
          </div>
        </div>
        
        {/* About/Docs Link */}
        <div className={styles.floatingAbout}>
          <a
            href="/docs.html"
            className={styles.aboutLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            About
          </a>
        </div>
        
        {/* Floating Controls */}
        <div className={styles.floatingControls}>
          <WalletHeader
            walletAddress={walletAddress}
            onConnect={connectWallet}
            onDisconnect={disconnectWallet}
            orders={safeOrders}
          />
        </div>

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
              className={`${styles.settingsButton} ${showSettings ? styles.active : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowSettings(!showSettings);
              }}
              onMouseDown={(e) => e.preventDefault()}
              title="Settings"
            >
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
                {/* Balance Display */}
                {walletAddress && (
                  <div style={{
                    marginTop: '8px',
                    fontSize: '13px',
                    color: insufficientBalance ? '#dc2626' : '#6b7280',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span>Balance: {balanceLoading ? (
                      <SkeletonLoader variant="text" width="80px" height="14px" />
                    ) : userBalance ? (
                      parseFloat(ethers.formatUnits(userBalance, sellToken.decimals || 18)).toFixed(6)
                    ) : (
                      '0.0'
                    )} {sellToken.symbol}</span>
                    {userBalance && !balanceLoading && sellAmount && (
                      <button
                        type="button"
                        onClick={() => {
                          const formatted = ethers.formatUnits(userBalance, sellToken.decimals || 18);
                          setSellAmount(formatted);
                        }}
                        style={{
                          fontSize: '12px',
                          padding: '2px 8px',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          borderRadius: '4px',
                          color: '#2563eb',
                          cursor: 'pointer'
                        }}
                      >
                        MAX
                      </button>
                    )}
                  </div>
                )}
                
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
                    {quoteLoading && !currentQuote ? (
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
                // Show sell token warnings
                if (
                  tokenWarnings.sellWarnings.length > 0 &&
                  !dismissedWarnings.has(`sell-${sellToken.address}`)
                ) {
                  return (
                    <TokenWarning
                      warnings={tokenWarnings.sellWarnings}
                      tokenSymbol={sellToken.symbol}
                      onDismiss={() => {
                        setDismissedWarnings(
                          (prev) =>
                            new Set([...prev, `sell-${sellToken.address}`])
                        );
                      }}
                    />
                  );
                }

                // Show buy token warnings
                if (
                  tokenWarnings.buyWarnings.length > 0 &&
                  !dismissedWarnings.has(`buy-${buyToken.address}`)
                ) {
                  return (
                    <TokenWarning
                      warnings={tokenWarnings.buyWarnings}
                      tokenSymbol={buyToken.symbol}
                      onDismiss={() => {
                        setDismissedWarnings(
                          (prev) =>
                            new Set([...prev, `buy-${buyToken.address}`])
                        );
                      }}
                    />
                  );
                }

                return null;
              })()}

              {/* Fee-on-transfer token notice */}
              {feeCalculation && feeCalculation.feePercentage > 0 && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "12px 16px",
                    backgroundColor: "rgba(251, 146, 60, 0.1)",
                    border: "1px solid rgba(251, 146, 60, 0.2)",
                    borderRadius: "8px",
                    fontSize: "14px",
                    color: "#ea580c",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                    ⚡ Transfer Fee Token
                  </div>
                  <div>
                    {buyToken.symbol} charges a {feeCalculation.feePercentage}%
                    fee on transfers. You will receive approximately{" "}
                    {actualBuyAmount} {buyToken.symbol} instead of {buyAmount}.
                  </div>
                </div>
              )}

              {/* Unwrap option for wrapped native tokens */}
              {showUnwrapOption && sellToken.symbol.startsWith("W") && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "8px 12px",
                    backgroundColor: "rgba(59, 130, 246, 0.1)",
                    border: "1px solid rgba(59, 130, 246, 0.2)",
                    borderRadius: "8px",
                    fontSize: "13px",
                    color: "#2563eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>
                    💡 You can unwrap {sellToken.symbol} to native{" "}
                    {sellToken.symbol.substring(1)}
                  </span>
                  <button
                    type="button"
                    style={{
                      padding: "4px 12px",
                      backgroundColor: "#2563eb",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                    onClick={() => {}}
                  >
                    Unwrap
                  </button>
                </div>
              )}

              {quoteError && (
                <div className={styles.error}>
                  {DOMPurify.sanitize(quoteError)}
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

              {/* Insufficient Balance Warning */}
              {insufficientBalance && !balanceLoading && (
                <div className={styles.error} style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#dc2626'
                }}>
                  <span style={{ fontWeight: 600 }}>⚠️ Insufficient balance</span>
                  <span style={{ fontSize: '13px', opacity: 0.9, display: 'block', marginTop: '4px' }}>
                    You need at least {sellAmount} {sellToken.symbol} to complete this swap
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
                  onMouseEnter={() => setIsUserInteracting(true)}
                  onMouseLeave={() => setIsUserInteracting(false)}
                  onFocus={() => setIsUserInteracting(true)}
                  onBlur={() => setIsUserInteracting(false)}
                  disabled={
                    connectingWallet ||
                    !sellAmount ||
                    !currentQuote?.buyAmount ||
                    quoteLoading ||
                    !!quoteError ||
                    !isValidChainPair ||
                    insufficientBalance ||
                    balanceLoading
                  }
                >
                  {quoteLoading && !currentQuote ? (
                    <span style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      fontSize: '14px',
                      fontWeight: '700',
                      letterSpacing: '0.8px',
                      textTransform: 'uppercase'
                    }}>
                      <span style={{
                        width: '14px',
                        height: '14px',
                        border: '2px solid rgba(255, 255, 255, 0.3)',
                        borderTopColor: 'white',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite'
                      }} />
                      Loading
                    </span>
                  ) : insufficientBalance && !balanceLoading ? (
                    <span style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      fontSize: '14px',
                      fontWeight: '700',
                      letterSpacing: '0.8px',
                      textTransform: 'uppercase'
                    }}>
                      Insufficient Funds
                    </span>
                  ) : (
                    <span style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      fontSize: '14px',
                      fontWeight: '700',
                      letterSpacing: '0.8px',
                      textTransform: 'uppercase'
                    }}>
                      Execute Swap
                    </span>
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
              onSubmit={handleLimitOrderSubmit}
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

          {/* Dispute Resolution Modal */}
          {disputeOrder && (
            <DisputeModal
              isOpen={showDisputeModal}
              onClose={() => setShowDisputeModal(false)}
              orderId={disputeOrder.orderId}
              orderDetails={{
                sellToken: disputeOrder.sellSymbol,
                buyToken: disputeOrder.buySymbol,
                sellAmount: disputeOrder.sellAmountFormatted,
                buyAmount: disputeOrder.buyAmountFormatted,
                status: disputeOrder.status,
                reason: disputeOrder.reason,
              }}
              onSettleOnChain={handleSettleOnChain}
              onReturnFunds={handleReturnFunds}
            />
          )}
        </div>
      </>
    </ErrorBoundary>
  );
};

export default SwapWidget;

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
