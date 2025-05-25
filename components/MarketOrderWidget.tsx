import React, { useState } from "react";
import styles from "./SwapWidget.module.css";
import QuoteSummary from "./QuoteSummary";

const LP_FEE_RATE = 0.003; // 0.3%
const SLIPPAGE_RATE = 0.005; // 0.5%
const PRICE_IMPACT_RATE = 0.0012; // 0.12%
const NETWORK_FEE_USD = 1.23; // Example, replace with real estimate

const EXPIRY_OPTIONS = [
  { label: "1 day", value: 60 * 60 * 24 },
  { label: "1 week", value: 60 * 60 * 24 * 7 },
  { label: "1 month", value: 60 * 60 * 24 * 30 },
  { label: "1 year", value: 60 * 60 * 24 * 365 },
];

const PERCENT_OPTIONS = [
  { label: "Market", value: 0 },
  { label: "+1%", value: 1 },
  { label: "+5%", value: 5 },
  { label: "+10%", value: 10 },
];

export interface MarketOrderWidgetProps {
  tokens: { symbol: string; address: string }[];
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
  showSlippage,
  slippageTolerance,
  onSlippageClick,
  onSlippageChange,
}) => {
  const [selectedPercent, setSelectedPercent] = useState(0);
  const [expiry, setExpiry] = useState(EXPIRY_OPTIONS[0].value);

  const handlePercentClick = (percent: number) => setSelectedPercent(percent);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      sellToken,
      buyToken,
      sellAmount,
      percent: selectedPercent,
      expiry,
    });
  };

  // Find token symbols
  const sellSymbol = tokens.find(t => t.address === sellToken)?.symbol || "";
  const buySymbol = tokens.find(t => t.address === buyToken)?.symbol || "";

  // Calculate values
  const sellAmountNum = parseFloat(sellAmount) || 0;
  const slippageRate = parseFloat(slippageTolerance) / 100 || 0.005;
  const lpFee = sellAmountNum * LP_FEE_RATE;
  const slippage = sellAmountNum * slippageRate;
  const priceImpact = sellAmountNum * PRICE_IMPACT_RATE;
  const minReceived =
    sellAmountNum && rate
      ? ((sellAmountNum * rate) - slippage).toFixed(6)
      : "0";

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.tradeTitle}>
        When 1 {tokens.find(t => t.address === sellToken)?.symbol} is worth{" "}
        {rate} {tokens.find(t => t.address === buyToken)?.symbol}
      </div>
      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        {PERCENT_OPTIONS.map(opt => (
          <button
            key={opt.label}
            type="button"
            className={selectedPercent === opt.value ? styles.active : ""}
            onClick={() => handlePercentClick(opt.value)}
            style={{ flex: 1 }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className={styles.panelGroup}>
        <div className={styles.panelLabel}>Sell Amount</div>
        <input
          type="number"
          className={styles.amountInput}
          placeholder="Amount"
          value={sellAmount}
          onChange={e => onSellAmountChange(e.target.value)}
          min="0"
          step="any"
          required
        />
      </div>
      <div className={styles.panelGroup}>
        <div className={styles.panelLabel}>Buy Token</div>
        <select
          value={buyToken}
          onChange={e => onBuyTokenChange(e.target.value)}
          className={styles.select}
        >
          {tokens.map(t => (
            <option key={t.address} value={t.address}>
              {t.symbol}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.panelGroup}>
        <div className={styles.panelLabel}>Expiry</div>
        <select
          value={expiry}
          onChange={e => setExpiry(Number(e.target.value))}
          className={styles.select}
        >
          {EXPIRY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <QuoteSummary
        lpFee={`${LP_FEE_RATE * 100}% (${lpFee.toFixed(4)} ${sellSymbol})`}
        networkFee={`$${NETWORK_FEE_USD}`}
        slippage={`${(slippageRate * 100).toFixed(2)}% (${slippage.toFixed(4)} ${buySymbol})`}
        priceImpact={`${PRICE_IMPACT_RATE * 100}% (${priceImpact.toFixed(4)} ${buySymbol})`}
        minReceived={`${minReceived} ${buySymbol}`}
        showSlippage={showSlippage}
        onSlippageClick={onSlippageClick}
        slippageTolerance={slippageTolerance}
        onSlippageChange={onSlippageChange}
        buyAmount={minReceived}
        tokens={tokens}
        buyToken={buyToken}
      />
      <button className={styles.connectButton} type="submit" style={{ marginTop: 16 }}>
        Submit
      </button>
    </form>
  );
};

export default MarketOrderWidget;