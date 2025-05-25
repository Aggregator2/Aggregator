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
                      const newSellToken = e.target.value;
                      setSellToken(newSellToken);
                      // If the new sell token is the same as the current buy token, switch buy token
                      if (newSellToken === buyToken) {
                        const otherToken = tokens.find(t => t.address !== newSellToken);
                        if (otherToken) setBuyToken(otherToken.address);
                      }
                    }}
                    className={styles.select}
                  >
                    {tokens.map(t => (
                      <option key={t.symbol + t.address} value={t.address}>
                        {t.symbol} {t.address ? `(${t.address.slice(0, 6)}...)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="number"
                  className={styles.amountInput}
                  placeholder="Enter amount"
                  value={sellAmount}
                  onChange={e => setSellAmount(e.target.value)}
                  min="0"
                  step="any"
                  required
                />
              </div>
              <div className={styles.usdEquivalent}>
                {sellUsd !== null ? `$${sellUsd}` : '$0.00'}
              </div>
            </div>
            <div className={styles.swapDivider}>
              <button
                className={styles.swapIconCircle}
                onClick={handleSwitch}
                type="button"
                title="Swap tokens"
                aria-label="Swap tokens"
              >
                <span style={{ fontSize: 22, color: "#2563eb", lineHeight: 1 }}>⇅</span>
              </button>
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
                        img.src = "/images/fallback.png";
                      }
                    }}
                    className={styles.tokenIcon}
                    alt={tokens.find(t => t.address === buyToken)?.symbol || "Token"}
                  />
                  <select
                    value={buyToken}
                    onChange={e => {
                      const newBuyToken = e.target.value;
                      setBuyToken(newBuyToken);
                      // If the new buy token is the same as the current sell token, switch sell token
                      if (newBuyToken === sellToken) {
                        const otherToken = tokens.find(t => t.address !== newBuyToken);
                        if (otherToken) setSellToken(otherToken.address);
                      }
                    }}
                    className={styles.select}
                  >
                    {tokens.map(t => (
                      <option key={t.symbol + t.address} value={t.address}>
                        {t.symbol} {t.address ? `(${t.address.slice(0, 6)}...)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  className={styles.amountInput}
                  value={buyAmount}
                  disabled
                />
              </div>
              <div className={styles.usdEquivalent}>
                {buyUsd !== null ? `$${buyUsd}` : '$0.00'}
              </div>
            </div>
            {/* --- QUOTE SUMMARY --- */}
            <QuoteSummary
              lpFee={quote?.lpFee || "0.30%"}
              networkFee={quote?.networkFeeUsd || "$1.23"}
              slippage={quote?.slippage || `${slippageTolerance}%`}
              priceImpact={quote?.priceImpact || "0.12%"}
              minReceived={minReceived}
              showSlippage={showSlippage}
              onSlippageClick={() => setShowSlippage(v => !v)}
              slippageTolerance={slippageTolerance}
              onSlippageChange={setSlippageTolerance}
              buyAmount={buyAmount}
              tokens={tokens} // Ensure tokens is passed here
              buyToken={buyToken}
            />
            {!walletAddress ? (
              <>
                <button
                  className={styles.connectButton}
                  type="button"
                  style={{ marginTop: 16, width: "100%" }}
                  disabled={quoteLoading || connectingWallet}
                  onClick={connectWallet}
                >
                  {connectingWallet ? "Connecting..." : "Connect Wallet"}
                </button>
                {connectError && (
                  <div style={{ color: "red", marginTop: 8 }}>{connectError}</div>
                )}
              </>
            ) : (
              <button
                className={styles.connectButton}
                type="submit"
                style={{ marginTop: 16, width: "100%" }}
                disabled={quoteLoading || !sellAmount || isNaN(Number(sellAmount))}
              >
                {quoteLoading ? "Fetching Quote..." : "Swap"}
              </button>
            )}
            {quoteError && <div style={{ color: "red", marginTop: 8 }}>{quoteError}</div>}
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
            onSubmit={order => console.log(order)}
            rate={
              quote?.buyAmount
                ? (Number(quote.buyAmount) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 6 })
                : 1
            }
            showSlippage={showSlippage}
            slippageTolerance={slippageTolerance}
            onSlippageClick={() => setShowSlippage(v => !v)}
            onSlippageChange={setSlippageTolerance}
          />
        )}
      </div>
    </div>
  );
};

export default SwapWidget;

