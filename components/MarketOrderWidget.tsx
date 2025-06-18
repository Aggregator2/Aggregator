import React, { useState } from "react";
import styles from "./SwapWidget.module.css";

const EXPIRY_OPTIONS = [
  { label: "1 day", value: 60 * 60 * 24 },
  { label: "1 week", value: 60 * 60 * 24 * 7 },
  { label: "1 month", value: 60 * 60 * 24 * 30 },
  { label: "1 year", value: 60 * 60 * 24 * 365 },
];

interface Token {
  symbol: string;
  address: string;
  logoURI?: string;
}

export interface MarketOrderWidgetProps {
  tokens: Token[];
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  onSellTokenChange: (v: string) => void;
  onBuyTokenChange: (v: string) => void;
  onSellAmountChange: (v: string) => void;
  onSubmit: (order: any) => void;
  rate: number;
  showSlippage: boolean;
  slippageTolerance: string;
  onSlippageClick: () => void;
  onSlippageChange: (value: string) => void;
  walletAddress?: string;
  onConnect?: () => void;
  connectingWallet?: boolean;
}

const MarketOrderWidget: React.FC<MarketOrderWidgetProps> = ({
  tokens,
  sellToken,
  buyToken,
  sellAmount,
  onSellTokenChange,
  onBuyTokenChange,
  onSellAmountChange,
  onSubmit,
  rate,
  walletAddress,
  onConnect,
  connectingWallet = false,
}) => {
  const [limitPrice, setLimitPrice] = useState("");
  const [expiry, setExpiry] = useState(EXPIRY_OPTIONS[0].value);
  const [buyAmount, setBuyAmount] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      sellToken,
      buyToken,
      sellAmount,
      buyAmount,
      limitPrice,
      expiry,
      type: "limit"
    });
  };

  // Handle token switching
  const handleSwitch = () => {
    onSellTokenChange(buyToken);
    onBuyTokenChange(sellToken);
    // Clear amounts when switching
    onSellAmountChange("");
    setBuyAmount("");
    setLimitPrice("");
  };

  // Calculate buy amount based on sell amount and limit price
  const handleSellAmountChange = (value: string) => {
    onSellAmountChange(value);
    if (value && limitPrice) {
      const calculated = (parseFloat(value) * parseFloat(limitPrice)).toFixed(6);
      setBuyAmount(calculated);
    } else {
      setBuyAmount("");
    }
  };

  // Calculate sell amount based on buy amount and limit price  
  const handleBuyAmountChange = (value: string) => {
    setBuyAmount(value);
    if (value && limitPrice) {
      const calculated = (parseFloat(value) / parseFloat(limitPrice)).toFixed(6);
      onSellAmountChange(calculated);
    }
  };

  const handleLimitPriceChange = (value: string) => {
    setLimitPrice(value);
    if (sellAmount && value) {
      const calculated = (parseFloat(sellAmount) * parseFloat(value)).toFixed(6);
      setBuyAmount(calculated);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Sell Panel */}
      <div className={styles.panelGroup}>
        <div className={styles.panelLabel}>You pay</div>
        <div className={styles.tokenPanel}>
          <div className={styles.tokenSelector}>
            <img
              src={tokens.find(t => t.address === sellToken)?.logoURI || "/images/fallback.png"}
              onError={e => {
                const img = e.target as HTMLImageElement;
                if (!img.src.endsWith("/images/fallback.png")) {
                  img.src = "/images/fallback.png";
                }
              }}
              className={styles.tokenIcon}
              alt={tokens.find(t => t.address === sellToken)?.symbol || "Token"}
            />
            <select
              value={sellToken}
              onChange={e => onSellTokenChange(e.target.value)}
              className={styles.tokenSelect}
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
            value={sellAmount}
            onChange={e => handleSellAmountChange(e.target.value)}
            placeholder="0.0"
            className={styles.amountInput}
          />
        </div>
      </div>

      {/* Switch Button */}
      <div className={styles.switchContainer}>
        <button
          type="button"
          onClick={handleSwitch}
          className={styles.switchButton}
        >
          ⇅
        </button>
      </div>

      {/* Buy Panel */}
      <div className={styles.panelGroup}>
        <div className={styles.panelLabel}>You receive</div>
        <div className={styles.tokenPanel}>
          <div className={styles.tokenSelector}>
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
              onChange={e => onBuyTokenChange(e.target.value)}
              className={styles.tokenSelect}
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
            onChange={e => handleBuyAmountChange(e.target.value)}
            placeholder="0.0"
            className={styles.amountInput}
          />
        </div>
      </div>

      {/* Limit Price */}
      <div className={styles.panelGroup}>
        <div className={styles.panelLabel}>
          Limit Price ({tokens.find(t => t.address === buyToken)?.symbol} per {tokens.find(t => t.address === sellToken)?.symbol})
        </div>
        <div className={styles.limitPricePanel}>
          <input
            type="text"
            value={limitPrice}
            onChange={e => handleLimitPriceChange(e.target.value)}
            placeholder="0.0"
            className={styles.limitPriceInput}
          />
        </div>
      </div>

      {/* Expiry */}
      <div className={styles.panelGroup}>
        <div className={styles.panelLabel}>Expiry</div>
        <select
          value={expiry}
          onChange={e => setExpiry(Number(e.target.value))}
          className={styles.expirySelect}
        >
          {EXPIRY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {!walletAddress ? (
        <button
          type="button"
          onClick={onConnect}
          className={styles.connectButton}
          disabled={connectingWallet}
        >
          {connectingWallet ? "Connecting..." : "Connect Wallet"}
        </button>
      ) : (
        <button 
          className={styles.submitButton} 
          type="submit" 
          disabled={!sellAmount || !buyAmount || !limitPrice}
        >
          Place Limit Order
        </button>
      )}
    </form>
  );
};

export default MarketOrderWidget;