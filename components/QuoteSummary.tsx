import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import styles from "./SwapWidget.module.css";
import CountdownTimer from "./CountdownTimer"; // adjust path as needed

interface QuoteSummaryProps {
  buyToken: string;
  sellToken: string; // Added sellToken prop
  sellAmount: string; // Added sellAmount prop
  buyAmount: string; // Added buyAmount prop
  minReceived: string; // Added minReceived prop
  slippageTolerance: string; // Added slippageTolerance prop
  priceImpactAmount: string; // Added priceImpactAmount prop
  lpFeeAmount: string; // Added lpFeeAmount prop
  slippageAmount: string; // Added slippageAmount prop
  quote: any; // Added quote prop
  validTo: number; // Added validTo prop for countdown timer
}

const QuoteSummary: React.FC<QuoteSummaryProps> = ({
  buyToken,
  sellToken, // Destructure sellToken
  sellAmount, // Destructure sellAmount
  buyAmount, // Destructure buyAmount
  minReceived, // Destructure minReceived
  slippageTolerance, // Destructure slippageTolerance
  priceImpactAmount, // Destructure priceImpactAmount
  lpFeeAmount, // Destructure lpFeeAmount
  slippageAmount, // Destructure slippageAmount
  quote, // Destructure quote
  validTo, // Destructure validTo
}) => {
  const [quoteData, setQuoteData] = useState({
    lpFee: "0",
    slippage: "0",
    priceImpact: "0",
    minReceived: "0",
  });

  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, validTo - Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    // Use the props passed from parent instead of making API call
    setQuoteData({
      lpFee: lpFeeAmount || "0",
      slippage: slippageAmount || "0",
      priceImpact: priceImpactAmount || "0",
      minReceived: minReceived || "0",
    });
  }, [lpFeeAmount, slippageAmount, priceImpactAmount, minReceived]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft(Math.max(0, validTo - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [validTo]);
  // Safely format values from wei to human-readable format
  const safeBigNumber = (val: any) => {
    try {
      return val ? ethers.getBigInt(val) : ethers.getBigInt("0");
    } catch {
      return ethers.getBigInt("0");
    }
  };

  const formattedLpFee = ethers.formatUnits(safeBigNumber(quoteData.lpFee), 18);
  const formattedSlippage = ethers.formatUnits(safeBigNumber(quoteData.slippage), 18);
  const formattedPriceImpact = ethers.formatUnits(safeBigNumber(quoteData.priceImpact), 18);
  const formattedMinReceived = ethers.formatUnits(safeBigNumber(quoteData.minReceived), 18);

  // Format secondsLeft as mm:ss
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div
      style={{
        fontFamily: "'Inter', sans-serif",
        background: "#f6f8fa",
        borderRadius: 16,
        padding: "18px 20px",
        margin: "24px 0 12px 0",
        boxShadow: "0 2px 12px 0 rgba(31,35,40,0.06)",
        fontSize: "1.05rem",
        color: "#181a20",
        maxWidth: 380,
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span>LP Fee</span>
        <span>{formattedLpFee} {buyToken}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span>Slippage</span>
        <span>{formattedSlippage}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span>Price Impact</span>
        <span>{formattedPriceImpact}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "#2563eb" }}>
        <span>Min Received</span>
        <span>{formattedMinReceived} {buyToken}</span>
      </div>
      <div style={{ marginTop: 12, fontSize: "0.9rem", color: "#666" }}>
        <span>
          {minutes}:{seconds.toString().padStart(2, "0")} left
        </span>
      </div>
      {quote?.validTo && <CountdownTimer seconds={Math.max(0, Math.floor((quote.validTo - Date.now()) / 1000))} />}
    </div>
  );
};

export default QuoteSummary;