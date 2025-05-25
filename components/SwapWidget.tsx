import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import styles from "./SwapWidget.module.css";
import { useTokenPrice } from "../hooks/useTokenPrice";
import MarketOrderWidget from "./MarketOrderWidget";
import QuoteSummary from "./QuoteSummary";
import { hashOrder } from '../utils/hashOrder';

// Token list with symbol, name, and address
const DEFAULT_TOKENS = [
  {
    symbol: "WETH",
    name: "Wrapped Ethereum",
    address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    logoURI: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaa39b223FE8D0A0E5C4F27eAD9083C756Cc2/logo.png", // WETH image
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
    logoURI: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png", // DAI image
  },
];

export interface SwapWidgetProps {
  userWalletAddress: string;
} 

const SwapWidget = ({ userWalletAddress }: SwapWidgetProps) => {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [tokens] = useState(DEFAULT_TOKENS);
  const [sellToken, setSellToken] = useState(DEFAULT_TOKENS[0].address);
  const [buyToken, setBuyToken] = useState(DEFAULT_TOKENS[1].address);
  const [sellAmount, setSellAmount] = useState("");
  const [activeTab, setActiveTab] = useState("swap");
  const [slippageTolerance, setSlippageTolerance] = useState("0.5");
  const [showSlippage, setShowSlippage] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // --- NEW: Quote state ---
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Debounced connectWallet
  const connectWallet = async () => {
    if (connectingWallet) return;
    setConnectingWallet(true);
    setConnectError(null);
    try {
      if (window.ethereum) {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);
      } else {
        setConnectError("MetaMask is not installed!");
      }
    } catch (error: any) {
      if (error.code === -32002) {
        setConnectError("MetaMask is already processing a connection request. Please check your wallet popup.");
      } else {
        setConnectError("Failed to connect wallet.");
      }
      console.error("Failed to connect wallet:", error);
    } finally {
      setConnectingWallet(false);
    }
  };

  // Only set walletAddress if userWalletAddress is provided, don't auto-connect
  useEffect(() => {
    if (userWalletAddress) {
      setWalletAddress(userWalletAddress);
    }
  }, [userWalletAddress]);

  // Swap tokens and amount
  const handleSwitch = () => {
    setSellToken(buyToken);
    setBuyToken(sellToken);
    // setSellAmount(""); // Remove this line to keep the value after switching
  };

  // Submit order
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) {
      return;
    }
    if (!sellAmount || !quote?.buyAmount || !quote?.minReceived) {
      return;
    }

    const order = {
      sellToken: sellToken || "0x0000000000000000000000000000000000000000",
      buyToken: buyToken || "0x0000000000000000000000000000000000000000",
      sellAmount: ethers.utils.parseUnits(sellAmount || "0", 18).toString(),
      buyAmount: ethers.utils.parseUnits(buyAmount || "0", 18).toString(),
      validTo: Math.floor(Date.now() / 1000) + 600,
      user: walletAddress || "0x0000000000000000000000000000000000000000",
      receiver: walletAddress || "0x0000000000000000000000000000000000000000",
      appData: "0x", // Default value
      feeAmount: "0", // Default value
      partiallyFillable: false,
      kind: "sell", // Default value
      signingScheme: "eip712", // Default value
    };

    // Generate the order hash
    const orderHash = hashOrder(order);
    console.log("Order Hash:", orderHash);

    console.log("Order for hashing:", order);
    console.log("ORDER OBJECT:", order);
    Object.entries(order).forEach(([key, value]) => {
      if (value === undefined) {
        console.error(`Order field ${key} is undefined`);
      }
    });

    if (
      !order.sellToken ||
      !order.buyToken ||
      !order.sellAmount ||
      !order.buyAmount ||
      !order.minReceived ||
      !order.wallet ||
      !order.validTo
    ) {
      alert("Missing order field! Check your inputs and quote.");
      return;
    }

    try {
      // Get the signer from MetaMask
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();

      // Sign the order hash
      const signature = await signer.signMessage(ethers.utils.arrayify(orderHash));
      console.log("Signature:", signature);

      // Combine the order and signature
      const signedOrder = { ...order, signature };
      console.log("Signed Order:", signedOrder);

      // Submit the signed order
      await submitOrder(signedOrder);
    } catch (err) {
      console.error("Error signing order:", err);
      alert("❌ Error signing order. Please try again.");
    }
  };

  const submitOrder = async (signedOrder: any) => {
    try {
      const response = await fetch("/api/submitOrder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedOrder),
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Order submitted successfully:", data);
        alert("✅ Order submitted successfully!");
      } else {
        const error = await response.json();
        console.error("Error submitting order:", error);
        alert(`❌ Error submitting order: ${error.message || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Network error submitting order:", err);
      alert("❌ Network error submitting order. Please try again.");
    }
  };

  const { price: sellTokenPrice, loading: sellLoading } = useTokenPrice(sellToken);
  const { price: buyTokenPrice, loading: buyLoading } = useTokenPrice(buyToken);

  // Fetch quote from backend (with debug logging)
  const fetchQuote = async () => {
    if (!sellAmount || isNaN(Number(sellAmount))) {
      console.error("❌ Invalid sellAmount:", sellAmount);
      setQuote(null);
      return;
    }

    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellToken,
          buyToken,
          sellAmount: ethers.utils.parseUnits(sellAmount, 18).toString(),
          user: walletAddress || "0x000000000000000000000000000000000000dead",
        }),
      });

      const data = await res.json();
      console.log("✅ Quote response:", data);

      if (data.error) {
        setQuoteError(data.error);
        setQuote(null);
      } else {
        setQuote(data);
      }
    } catch (err) {
      console.error("❌ fetchQuote error:", err);
      setQuoteError(err.message);
      setQuote(null);
    }
  };

  useEffect(() => {
    fetchQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellAmount, sellToken, buyToken, walletAddress]);

  // Use backend quote for buyAmount and minReceived (format with ethers)
  const buyAmount = quote?.buyAmount
    ? ethers.utils.formatUnits(quote.buyAmount, 18)
    : "0";
  const minReceived = quote?.minReceived
    ? parseFloat(ethers.utils.formatUnits(quote.minReceived, 18)).toFixed(4)
    : "0";

  const sellUsd = sellAmount && quote?.sellTokenUsd
    ? (parseFloat(sellAmount) * quote.sellTokenUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;

  const buyUsd = buyAmount && quote?.buyTokenUsd
    ? (parseFloat(buyAmount) * quote.buyTokenUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;

  // Add this function inside the SwapWidget component, before the return statement
  const sellAmountNum = parseFloat(sellAmount) || 0;
  const lpFeeRate = 0.003; // 0.3%
  const slippageRate = 0.005; // 0.5%
  const priceImpactRate = 0.0012; // 0.12%

  const lpFeeAmount = sellAmountNum * lpFeeRate;
  const slippageAmount = sellAmountNum * slippageRate;
  const priceImpactAmount = sellAmountNum * priceImpactRate;

  const calculatedMinReceived = sellAmountNum - lpFeeAmount - slippageAmount - priceImpactAmount;

  return (
    <div className={styles.tradeWrapper}>
      <div className={styles.tradeCard}>
        <div className={styles.tradeTitle}>Swap</div>
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
        {activeTab === "swap" ? (
          <form onSubmit={handleSubmit}>
            <div className={styles.panelGroup}>
              <div className={styles.panelLabel}>Sell</div>
              <div className={styles.tokenPanel}>
                <div className={styles.tokenSelector}>
                  {/* Sell token logo */}
                  <img
                    src={tokens.find(t => t.address === sellToken)?.logoURI || "/images/fallback.png"}
                    onError={e => {
                      const img = e.target as HTMLImageElement;
                      if (!img.src.endsWith("/images/fallback.png")) {
                        img.src = "/images/fallback.png"; // Use a local fallback image
                      }
                    }}
                    className={styles.tokenIcon}
                    alt={tokens.find(t => t.address === sellToken)?.symbol || "Token"}
                  />
                  <select
                    value={sellToken}
                    onChange={e => {
                      const newSellToken = e.target.value || ""; // Always a string
                      setSellToken(newSellToken);
                      if (newSellToken === buyToken) {
                        const otherToken = tokens.find(t => t.address !== newSellToken);
                        if (otherToken) {
                          setBuyToken(otherToken.address);
                        }
                      }
                    }}
                    className={styles.tokenSelect}
                    disabled={connectingWallet}
                  >
                    {tokens.map(token => (
                      <option key={token.address} value={token.address}>
                        {token.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="number"
                  value={sellAmount}
                  onChange={e => setSellAmount(e.target.value)}
                  placeholder="0.0"
                  className={styles.amountInput}
                  disabled={connectingWallet}
                />
              </div>
            </div>
            <div className={styles.panelGroup}>
              <div className={styles.panelLabel}>Buy</div>
              <div className={styles.tokenPanel}>
                <div className={styles.tokenSelector}>
                  {/* Buy token logo */}
                  <img
                    src={tokens.find(t => t.address === buyToken)?.logoURI || "/images/fallback.png"}
                    onError={e => {
                      const img = e.target as HTMLImageElement;
                      if (!img.src.endsWith("/images/fallback.png")) {
                        img.src = "/images/fallback.png"; // Use a local fallback image
                      }
                    }}
                    className={styles.tokenIcon}
                    alt={tokens.find(t => t.address === buyToken)?.symbol || "Token"}
                  />
                  <select
                    value={buyToken}
                    onChange={e => setBuyToken(e.target.value)}
                    className={styles.tokenSelect}
                    disabled={connectingWallet}
                  >
                    {tokens.map(token => (
                      <option key={token.address} value={token.address}>
                        {token.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={buyAmount}
                  readOnly
                  className={styles.amountInput}
                />
              </div>
            </div>
            <div className={styles.panelGroup}>
              <div className={styles.panelLabel}>Slippage Tolerance</div>
              <div className={styles.slippagePanel}>
                <input
                  type="number"
                  value={slippageTolerance}
                  onChange={e => setSlippageTolerance(e.target.value)}
                  placeholder="0.5"
                  className={styles.slippageInput}
                  disabled={connectingWallet}
                />
                <button
                  type="button"
                  onClick={() => setShowSlippage(!showSlippage)}
                  className={styles.slippageToggle}
                >
                  {showSlippage ? "Hide" : "Show"} Details
                </button>
              </div>
              {showSlippage && (
                <div className={styles.slippageDetails}>
                  <div>LP Fee: {lpFeeAmount.toFixed(4)} {tokens.find(t => t.address === sellToken)?.symbol}</div>
                  <div>Slippage: {slippageAmount.toFixed(4)} {tokens.find(t => t.address === sellToken)?.symbol}</div>
                  <div>Price Impact: {priceImpactAmount.toFixed(4)} {tokens.find(t => t.address === sellToken)?.symbol}</div>
                </div>
              )}
            </div>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={connectingWallet || !sellAmount || !quote?.buyAmount || !quote?.minReceived}
            >
              {connectingWallet ? "Connecting..." : "Swap"}
            </button>
          </form>
        ) : (
          <MarketOrderWidget
            tokens={tokens}
            walletAddress={walletAddress}
            onSubmitOrder={submitOrder}
            connectingWallet={connectingWallet}
          />
        )}
        {quoteError && <div className={styles.error}>{quoteError}</div>}
        <div className={styles.quoteSummary}>
          <QuoteSummary
            sellToken={tokens.find(t => t.address === sellToken)?.symbol || sellToken}
            buyToken={tokens.find(t => t.address === buyToken)?.symbol || buyToken}
            sellAmount={sellAmount}
            buyAmount={buyAmount}
            minReceived={minReceived}
            slippageTolerance={slippageTolerance}
            priceImpactAmount={priceImpactAmount}
            lpFeeAmount={lpFeeAmount}
            slippageAmount={slippageAmount}
            quote={quote}
          />
        </div>
      </div>
    </div>
  );
};

export default SwapWidget;

