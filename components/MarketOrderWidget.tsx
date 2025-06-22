import React, { useState } from "react";
import styles from "./SwapWidget.module.css";
import TokenSelector from "./TokenSelector";
import TokenPicker from "./TokenPicker";
import { Token } from "../types/wallet";

const EXPIRY_OPTIONS = [
  { label: "1 day", value: 60 * 60 * 24 },
  { label: "1 week", value: 60 * 60 * 24 * 7 },
  { label: "1 month", value: 60 * 60 * 24 * 30 },
  { label: "1 year", value: 60 * 60 * 24 * 365 },
];

export interface MarketOrderWidgetProps {
  tokens: Token[];
  sellToken: Token;
  buyToken: Token;
  sellAmount: string;
  onSellTokenChange: (token: Token) => void;
  onBuyTokenChange: (token: Token) => void;
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
  
  // Token picker state
  const [showSellTokenPicker, setShowSellTokenPicker] = useState(false);
  const [showBuyTokenPicker, setShowBuyTokenPicker] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      sellToken: sellToken.address,
      buyToken: buyToken.address,
      sellAmount,
      buyAmount,
      limitPrice,
      expiry,
      type: "limit"
    });
  };

  // Handle token switching  
  const handleSwitch = () => {
    const tempToken = sellToken;
    onSellTokenChange(buyToken);
    onBuyTokenChange(tempToken);
    // Clear amounts when switching
    onSellAmountChange("");
    setBuyAmount("");
    setLimitPrice("");
  };

  // Token selection handlers
  const handleSellTokenSelect = (token: Token) => {
    onSellTokenChange(token);
    setShowSellTokenPicker(false);
    // If selecting the same token as buy token, swap them
    if (token.address.toLowerCase() === buyToken.address.toLowerCase()) {
      onBuyTokenChange(sellToken);
    }
  };

  const handleBuyTokenSelect = (token: Token) => {
    onBuyTokenChange(token);
    setShowBuyTokenPicker(false);
    // If selecting the same token as sell token, swap them
    if (token.address.toLowerCase() === sellToken.address.toLowerCase()) {
      onSellTokenChange(buyToken);
    }
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
          <TokenSelector
            selectedToken={sellToken}
            onClick={() => setShowSellTokenPicker(true)}
            disabled={connectingWallet}
            className={styles.tokenSelectorButton}
          />
          <input
            type="text"
            value={sellAmount}
            onChange={e => handleSellAmountChange(e.target.value)}
            placeholder="0.0"
            className={styles.amountInput}
            disabled={connectingWallet}
          />
        </div>
      </div>

      {/* Switch Button */}
      <div className={styles.switchContainer}>
        <button
          type="button"
          onClick={handleSwitch}
          className={styles.switchButton}
          disabled={connectingWallet}
        >
          ⇅
        </button>
      </div>

      {/* Buy Panel */}
      <div className={styles.panelGroup}>
        <div className={styles.panelLabel}>You receive</div>
        <div className={styles.tokenPanel}>
          <TokenSelector
            selectedToken={buyToken}
            onClick={() => setShowBuyTokenPicker(true)}
            disabled={connectingWallet}
            className={styles.tokenSelectorButton}
          />
          <input
            type="text"
            value={buyAmount}
            onChange={e => handleBuyAmountChange(e.target.value)}
            placeholder="0.0"
            className={styles.amountInput}
            disabled={connectingWallet}
          />
        </div>
      </div>

      {/* Limit Price */}
      <div className={styles.panelGroup}>
        <div className={styles.panelLabel}>
          Limit Price ({buyToken.symbol} per {sellToken.symbol})
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
    </form>
  );
};

export default MarketOrderWidget;