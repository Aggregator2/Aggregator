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
import FixedEscrowABI from "../artifacts/contracts/FixedEscrow.sol/FixedEscrow.json";
import { ESCROW_CONTRACT_ADDRESS } from "../frontend/src/config/escrowAddress";
import { SpecialTokenService } from "../src/services/specialTokenService";
import type { Order, Quote, Token } from "../types/wallet";

// Import custom hooks
import {
  useQuoteManagement,
  useWalletConnection,
  useTokenSelection,
  useOrderSubmission,
} from "../hooks/swap";

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
        const { getSigner } = await import("../utils/getSigner");
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

const SwapWidget: React.FC<SwapWidgetProps> = ({
  userAddress,
  onConnect,
  onSubmitOrder,
  orders = [],
}) => {
  // Basic state
  const [tokens] = useState(DEFAULT_TOKENS);
  const [sellAmount, setSellAmount] = useState("");
  const [activeTab, setActiveTab] = useState("swap");
  const [slippageTolerance, setSlippageTolerance] = useState("0.5");
  const [showSettings, setShowSettings] = useState(false);
  const [settlementMode, setSettlementMode] = useState<"offchain" | "escrow">(
    "offchain"
  );

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

  // Custom hooks for separated concerns
  const {
    walletAddress,
    connectingWallet,
    connectError,
    connectWallet,
    disconnectWallet,
  } = useWalletConnection({
    userAddress,
    onConnect,
    showWarning,
    showError,
    showSuccess,
  });

  const {
    sellToken,
    buyToken,
    showSellTokenPicker,
    showBuyTokenPicker,
    showUnwrapOption,
    dismissedWarnings,
    handleSellTokenSelect,
    handleBuyTokenSelect,
    handleSwitch,
    setShowSellTokenPicker,
    setShowBuyTokenPicker,
    dismissWarning,
    getSellTokenWarnings,
    getBuyTokenWarnings,
  } = useTokenSelection({
    defaultSellToken: DEFAULT_TOKENS[0],
    defaultBuyToken: DEFAULT_TOKENS[1],
    showError,
  });

  const {
    currentQuote,
    quoteLoading,
    quoteError,
    quoteUpdatedAt,
    isQuoteStale,
    fetchQuoteData,
    clearQuote,
  } = useQuoteManagement({
    sellToken,
    buyToken,
    sellAmount,
    walletAddress,
    showWarning,
    networkIsOnline: networkStatus.isOnline,
  });

  const {
    submitOrder,
    submitEscrowDeposit,
    escrowLoading,
    escrowError,
    submitError,
  } = useOrderSubmission({
    walletAddress,
    showInfo,
    showError,
    showSuccess,
    showOrderSubmitted,
    showOrderFilled,
    onSubmitOrder,
    connectWallet,
  });

  // Additional hooks
  const sellTokenPriceData = useTokenPrice(sellToken.address);
  const buyTokenPriceData = useTokenPrice(buyToken.address);
  const escrowContractFactory = useEscrowContract(walletAddress);

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await submitOrder(sellToken, buyToken, sellAmount, currentQuote);
    },
    [submitOrder, sellToken, buyToken, sellAmount, currentQuote]
  );

  /**
   * Handle escrow deposit
   */
  const handleEscrowDeposit = useCallback(async () => {
    if (!currentQuote) {
      showError("No quote available for escrow deposit");
      return;
    }
    await submitEscrowDeposit(currentQuote, escrowContractFactory);
  }, [currentQuote, submitEscrowDeposit, escrowContractFactory, showError]);

  // Calculate amounts and fees with proper decimal handling
  const buyAmount = currentQuote?.buyAmount
    ? SpecialTokenService.formatTokenAmount(
        buyToken.address,
        buyToken.chainId ?? 1,
        currentQuote.buyAmount,
        buyToken.decimals || 18
      )
    : "0";
    
  // Calculate fee-on-transfer adjusted amount if applicable
  const feeCalculation = currentQuote?.buyAmount
    ? SpecialTokenService.calculateFeeOnTransferAmount(
        buyToken.address,
        buyToken.chainId ?? 1,
        currentQuote.buyAmount,
        buyToken.decimals || 18
      )
    : null;
    
  const actualBuyAmount = feeCalculation?.netAmount
    ? SpecialTokenService.formatTokenAmount(
        buyToken.address,
        buyToken.chainId ?? 1,
        feeCalculation.netAmount,
        buyToken.decimals || 18
      )
    : buyAmount;
    
  const minReceived = currentQuote?.minReceived
    ? parseFloat(
        SpecialTokenService.formatTokenAmount(
          buyToken.address,
          buyToken.chainId ?? 1,
          currentQuote.minReceived,
          buyToken.decimals || 18
        )
      ).toFixed(6)
    : "0";

  const sellAmountNum = parseFloat(sellAmount) || 0;
  const lpFeeRate = 0.003;
  const slippageRate = parseFloat(slippageTolerance) / 100;
  const priceImpactRate = 0.0012;

  const lpFeeAmount = sellAmountNum * lpFeeRate;
  const slippageAmount = sellAmountNum * slippageRate;
  const priceImpactAmount = sellAmountNum * priceImpactRate;

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

  // Get token warnings
  const sellTokenWarnings = getSellTokenWarnings();
  const buyTokenWarnings = getBuyTokenWarnings();

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
              {sellTokenWarnings.length > 0 && (
                <TokenWarning
                  warnings={sellTokenWarnings}
                  tokenSymbol={sellToken.symbol}
                  onDismiss={() => dismissWarning(`sell-${sellToken.address}`)}
                />
              )}
              
              {buyTokenWarnings.length > 0 && (
                <TokenWarning
                  warnings={buyTokenWarnings}
                  tokenSymbol={buyToken.symbol}
                  onDismiss={() => dismissWarning(`buy-${buyToken.address}`)}
                />
              )}
              
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
                      clearQuote();
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
              {sellToken.chainId !== buyToken.chainId && (
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
                    sellToken.chainId !== buyToken.chainId
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
                  ) : sellToken.chainId !== buyToken.chainId ? (
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
              onSellTokenChange={handleSellTokenSelect}
              onBuyTokenChange={handleBuyTokenSelect}
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
                    SELL {order.sellAmount || "0"}{" "}
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

export default SwapWidget;