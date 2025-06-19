import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ethers } from "ethers";
import styles from "./SwapWidget.module.css";
import { useTokenPrice } from "../hooks/useTokenPrice";
import { useToast } from "../hooks/useToast";
import { useApi } from "../hooks/useApi";
import { useNetworkStatus } from "../hooks/useFallback";
import MarketOrderWidget from "./MarketOrderWidget";
import QuoteSummary from "./QuoteSummary";
import SkeletonLoader from "./SkeletonLoader";
import ErrorBoundary from "./ErrorBoundary";
import TokenPicker from "./TokenPicker";
import TokenSelector from "./TokenSelector";
import { hashOrder } from '../utils/hashOrder';
import { getSigner } from '../utils/getSigner';
import FixedEscrowABI from "../artifacts/contracts/FixedEscrow.sol/FixedEscrow.json";
import { ESCROW_CONTRACT_ADDRESS } from "../frontend/src/config/escrowAddress";
import { connectWallet as connectWalletUtil } from '../utils/walletConnection';
import type { Order, Quote, Token } from '../types/wallet';

// Token list with symbol, name, and address
const DEFAULT_TOKENS: Token[] = [
  {
    symbol: "WETH",
    name: "Wrapped Ethereum",
    address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    logoURI: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['wrapped']
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
    logoURI: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png",
    chainId: 1,
    type: 'ERC-20',
    decimals: 18,
    tags: ['stablecoin']
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
  name: 'MetaAggregator',
  version: '1',
  chainId: 31337,
  verifyingContract: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
};

const EIP712_TYPES = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'receiver', type: 'address' },
    { name: 'user', type: 'address' },
    { name: 'signingScheme', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'wallet', type: 'address' },
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
          throw new Error(signerResult.error || 'Failed to get signer');
        }
        
        return new ethers.Contract(
          ESCROW_CONTRACT_ADDRESS,
          FixedEscrowABI.abi,
          signerResult.signer
        );
      } catch (error) {
        console.error('Error creating escrow contract:', error);
        throw error;
      }
    };
  }, [walletAddress]);
}

const SwapWidget: React.FC<SwapWidgetProps> = ({ 
  userAddress, 
  onConnect, 
  onSubmitOrder,
  orders = []
}) => {
  // Basic state
  const [walletAddress, setWalletAddress] = useState<string | null>(userAddress || null);
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
  const [settlementMode, setSettlementMode] = useState<"offchain" | "escrow">("offchain");
  
  // Escrow state
  const [escrowLoading, setEscrowLoading] = useState(false);
  const [escrowError, setEscrowError] = useState<string | null>(null);
  
  // Ref to prevent unnecessary re-renders
  const isInitialRender = useRef(true);
  
  // Quote state
  const [currentQuote, setCurrentQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  
  // Hooks
  const { showError, showSuccess, showWarning, showInfo, ToastContainer } = useToast();
  const networkStatus = useNetworkStatus();
  const sellTokenPriceData = useTokenPrice(sellToken.address);
  const buyTokenPriceData = useTokenPrice(buyToken.address);
  const escrowContractFactory = useEscrowContract(walletAddress);

  // Update wallet address from props with stability check
  useEffect(() => {
    if (userAddress && userAddress !== walletAddress && userAddress.length === 42) {
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
          showWarning("Connection request already pending. Please check MetaMask.");
          setConnectError("Connection request pending - check MetaMask");
        }
      });
      
      if (result.success && result.address) {
        setWalletAddress(result.address);
        showSuccess(`Wallet connected: ${result.address.slice(0, 6)}...${result.address.slice(-4)}`);
        onConnect?.();
      } else {
        const errorMsg = result.error || "Failed to connect wallet";
        setConnectError(errorMsg);
        showError(errorMsg);
      }
    } catch (error: any) {
      console.error('Wallet connection error:', error);
      const errorMsg = error.message || "Unexpected error connecting wallet";
      setConnectError(errorMsg);
      showError(errorMsg);
    } finally {
      setConnectingWallet(false);
    }
  }, [connectingWallet, showWarning, showSuccess, showError, onConnect]);

  /**
   * Enhanced quote fetching with retry and fallback
   */
  const fetchQuoteData = useCallback(async () => {
    if (!sellAmount || isNaN(Number(sellAmount)) || Number(sellAmount) <= 0) {
      setCurrentQuote(null);
      setQuoteError(null);
      return;
    }

    setQuoteLoading(true);
    setQuoteError(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellToken: sellToken.address,
          buyToken: buyToken.address,
          sellAmount: ethers.parseUnits(sellAmount, 18).toString(),
          user: walletAddress || "0x000000000000000000000000000000000000dead",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.warning) {
        showWarning(data.warning);
      }
      
      setCurrentQuote(data);
      
    } catch (error: any) {
      let errorMessage = "Failed to get quote";
      
      if (error.name === 'AbortError') {
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
  }, [sellAmount, sellToken, buyToken, walletAddress, networkStatus.isOnline, showWarning]);

  // Effect to fetch quotes when inputs change with longer debounce
  useEffect(() => {
    const debounceTimeout = setTimeout(() => {
      if (sellAmount && parseFloat(sellAmount) > 0) {
        fetchQuoteData();
      }
    }, 1000); // Increased to 1 second to reduce API calls

    return () => clearTimeout(debounceTimeout);
  }, [fetchQuoteData, sellAmount]);

  // Token switching
  const handleSwitch = () => {
    const tempToken = sellToken;
    setSellToken(buyToken);
    setBuyToken(tempToken);
  };

  // Token selection handlers
  const handleSellTokenSelect = (token: Token) => {
    setSellToken(token);
    setShowSellTokenPicker(false);
    // If selecting the same token as buy token, swap them
    if (token.address.toLowerCase() === buyToken.address.toLowerCase()) {
      setBuyToken(sellToken);
    }
  };

  const handleBuyTokenSelect = (token: Token) => {
    setBuyToken(token);
    setShowBuyTokenPicker(false);
    // If selecting the same token as sell token, swap them
    if (token.address.toLowerCase() === sellToken.address.toLowerCase()) {
      setSellToken(buyToken);
    }
  };

  /**
   * Order submission with comprehensive error handling
   */
  const handleSubmit = async (e: React.FormEvent) => {
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

      if (address.toLowerCase() !== walletAddress.toLowerCase()) {
        showError("Connected wallet address doesn't match. Please reconnect.");
        return;
      }

      const baseUnits = ethers.parseUnits(sellAmount, 18).toString();
      const validTo = Math.floor(Date.now() / 1000) + 1800; // 30 minutes

      const order = {
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: baseUnits,
        buyAmount: currentQuote.buyAmount || "0",
        validTo,
        user: address,
        receiver: address,
        wallet: address,
        appData: '0x' + '00'.repeat(32),
        feeAmount: currentQuote.lpFee || 0,
        partiallyFillable: false,
        kind: "sell",
        signingScheme: "eip712",
        nonce: 0,
      };

      // Validate order
      const missingFields = Object.entries(order)
        .filter(([_, value]) => value === undefined || value === null || value === "")
        .map(([key]) => key);

      if (missingFields.length > 0) {
        throw new Error(`Missing order fields: ${missingFields.join(", ")}`);
      }

      showInfo("Please sign the transaction in your wallet...");

      // Sign the order
      const signature = await signer.signTypedData(EIP712_DOMAIN, EIP712_TYPES, order);

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
  };

  /**
   * Submit order to backend
   */
  const submitOrder = async (signedOrder: any) => {
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
      showSuccess("Order submitted successfully!");
      
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
      const orderId = hashOrder(currentQuote);
      const tx = await contract.deposit(currentQuote.sellToken, currentQuote.sellAmount);
      
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
  };

  // Calculate amounts and fees
  const buyAmount = currentQuote?.buyAmount
    ? ethers.formatUnits(currentQuote.buyAmount, 18)
    : "0";
  const minReceived = currentQuote?.minReceived
    ? parseFloat(ethers.formatUnits(currentQuote.minReceived, 18)).toFixed(4)
    : "0";

  const sellAmountNum = parseFloat(sellAmount) || 0;
  const lpFeeRate = 0.003;
  const slippageRate = 0.005;
  const priceImpactRate = 0.0012;

  const lpFeeAmount = sellAmountNum * lpFeeRate;
  const slippageAmount = sellAmountNum * slippageRate;
  const priceImpactAmount = sellAmountNum * priceImpactRate;

  // Ensure orders is always an array
  const safeOrders = Array.isArray(orders) ? orders : [];

  return (
    <ErrorBoundary>
      <div className={styles.tradeWrapper}>
        <ToastContainer />
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
              className={`${styles.tab} ${activeTab === "swap" ? styles.active : ""}`}
              onClick={() => setActiveTab("swap")}
              type="button"
            >
              Swap
            </button>
            <button
              className={`${styles.tab} ${activeTab === "limit" ? styles.active : ""}`}
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
                    onChange={e => setSlippageTolerance(e.target.value)}
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
                    className={`${styles.settlementButton} ${settlementMode === 'offchain' ? styles.active : ''}`}
                    onClick={() => setSettlementMode('offchain')}
                  >
                    Return Funds
                  </button>
                  <button
                    type="button"
                    className={`${styles.settlementButton} ${settlementMode === 'escrow' ? styles.active : ''}`}
                    onClick={() => setSettlementMode('escrow')}
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
                    onChange={e => setSellAmount(e.target.value)}
                    placeholder="0.0"
                    className={styles.amountInput}
                    disabled={connectingWallet || quoteLoading}
                  />
                </div>
                {sellTokenPriceData.error && (
                  <div className={styles.priceError}>
                    Price unavailable: {sellTokenPriceData.error}
                    <button type="button" onClick={sellTokenPriceData.retry}>Retry</button>
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
                      <SkeletonLoader variant="text" width="120px" height="24px" />
                    ) : (
                      <input
                        type="text"
                        value={buyAmount}
                        readOnly
                        className={styles.amountInput}
                        placeholder="0.0"
                      />
                    )}
                  </div>
                </div>
              </div>

              {quoteError && (
                <div className={styles.error}>
                  {quoteError}
                  <button type="button" onClick={fetchQuoteData} className={styles.retryButton}>
                    Retry
                  </button>
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
                      <SkeletonLoader variant="text" width="80px" height="16px" />
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
                    !!quoteError
                  }
                >
                  {quoteLoading ? (
                    <>
                      <SkeletonLoader variant="text" width="60px" height="16px" />
                      Getting Quote...
                    </>
                  ) : (
                    "Swap"
                  )}
                </button>
              )}

              {connectError && (
                <div className={styles.error}>
                  {connectError}
                  <button type="button" onClick={connectWallet} className={styles.retryButton}>
                    Try Again
                  </button>
                </div>
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

          {currentQuote && !quoteLoading ? (
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
                validTo={currentQuote?.validTo || Math.floor(Date.now() / 1000) + 3600}
              />
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
              <button type="button" onClick={handleEscrowDeposit} className={styles.retryButton}>
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
                    {order.side || 'SELL'} {order.sellAmount || '0'} {
                      tokens.find(t => t.address === order.sellToken)?.symbol || 'Unknown'
                    } → {order.buyAmount || '0'} {
                      tokens.find(t => t.address === order.buyToken)?.symbol || 'Unknown'
                    }
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