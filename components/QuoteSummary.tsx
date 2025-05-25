import React, { useEffect, useState } from "react";
import { BigNumber } from "@ethersproject/bignumber";
import { formatUnits } from "@ethersproject/units";
import styles from "./SwapWidget.module.css";

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
}) => {
  const [quoteData, setQuoteData] = useState({
    lpFee: "0",
    slippage: "0",
    priceImpact: "0",
    minReceived: "0",
  });

  useEffect(() => {
    // Fetch data from the API
    async function fetchQuote() {
      const response = await fetch("/api/quote");
      const data = await response.json();
      setQuoteData(data);
    }

    fetchQuote();
  }, []);

  // Safely format values from wei to human-readable format
  const safeBigNumber = (val: any) => {
    try {
      return val ? BigNumber.from(val) : BigNumber.from("0");
    } catch {
      return BigNumber.from("0");
    }
  };

  const formattedLpFee = formatUnits(safeBigNumber(quoteData.lpFee), 18);
  const formattedSlippage = formatUnits(safeBigNumber(quoteData.slippage), 18);
  const formattedPriceImpact = formatUnits(safeBigNumber(quoteData.priceImpact), 18);
  const formattedMinReceived = formatUnits(safeBigNumber(quoteData.minReceived), 18);

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
        <span>{formattedMinReceived} {typeof buyToken === "object" ? buyToken.symbol : buyToken}</span>
      </div>
    </div>
  );
};

export default QuoteSummary;