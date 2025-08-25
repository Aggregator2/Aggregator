import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import styles from "./SwapWidget.module.css";
import type { Quote } from "../types/wallet";

interface QuoteSummaryProps {
  buyToken: string;
  sellToken: string;
  sellAmount: string;
  buyAmount: string;
  minReceived: string;
  slippageTolerance: string;
  priceImpactAmount: string;
  lpFeeAmount: string;
  slippageAmount: string;
  quote: Quote | null;
  validTo: number;
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

  useEffect(() => {
    // Use the props passed from parent instead of making API call
    setQuoteData({
      lpFee: lpFeeAmount || "0",
      slippage: slippageAmount || "0",
      priceImpact: priceImpactAmount || "0",
      minReceived: minReceived || "0",
    });
  }, [lpFeeAmount, slippageAmount, priceImpactAmount, minReceived]);
  // Values are already formatted as decimal strings, no need to convert from wei
  const formattedLpFee = parseFloat(quoteData.lpFee).toFixed(6);
  const formattedSlippage = parseFloat(quoteData.slippage).toFixed(6);
  const formattedPriceImpact = parseFloat(quoteData.priceImpact).toFixed(6);
  const formattedMinReceived = parseFloat(quoteData.minReceived).toFixed(6);

  return (
    <div
      style={{
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        background: "rgba(255, 255, 255, 0.02)",
        borderRadius: 12,
        padding: "16px",
        margin: "0",
        boxShadow: "none",
        fontSize: "14px",
        color: "#ffffff",
      }}
    >
      {quote?.platformFee && (
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "1px solid rgba(255,255,255,0.08)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ 
              width: 4, 
              height: 4, 
              borderRadius: "50%", 
              background: "#f59e0b" 
            }} />
            <span style={{ 
              color: "#ffffff", 
              fontSize: "13px",
              fontWeight: 500,
              letterSpacing: "0.02em"
            }}>
              Platform Fee ({quote.platformFee.percentage}%)
            </span>
          </div>
          <span style={{ 
            fontSize: "13px",
            fontWeight: 500,
            color: "#ffffff"
          }}>
            {(() => {
              // Determine decimals based on token
              const decimals = buyToken.toUpperCase() === 'ETH' || buyToken.toUpperCase() === 'WETH' ? 18 : 
                              buyToken.toUpperCase() === 'USDC' || buyToken.toUpperCase() === 'USDT' ? 6 : 
                              buyToken.toUpperCase() === 'WBTC' ? 8 : 18;
              return parseFloat(ethers.formatUnits(quote.platformFee.amount, decimals)).toFixed(6);
            })()} {buyToken}
          </span>
        </div>
      )}
      
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        marginBottom: 12,
        paddingBottom: quote?.platformFee ? 0 : 12,
        borderBottom: quote?.platformFee ? "none" : "1px solid rgba(255,255,255,0.08)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ 
            width: 4, 
            height: 4, 
            borderRadius: "50%", 
            background: "#10b981" 
          }} />
          <span style={{ 
            color: "#ffffff", 
            fontSize: "13px",
            fontWeight: 500,
            letterSpacing: "0.02em"
          }}>
            LP Fee (0.3%)
          </span>
        </div>
        <span style={{ 
          fontSize: "13px",
          fontWeight: 500,
          color: "#ffffff"
        }}>
          {formattedLpFee} {sellToken}
        </span>
      </div>
      
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between",
        alignItems: "center", 
        marginBottom: 12 
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ 
            width: 4, 
            height: 4, 
            borderRadius: "50%", 
            background: "#3b82f6" 
          }} />
          <span style={{ 
            color: "#ffffff", 
            fontSize: "13px",
            fontWeight: 500,
            letterSpacing: "0.02em"
          }}>
            Max Slippage ({slippageTolerance}%)
          </span>
        </div>
        <span style={{ 
          fontSize: "13px",
          fontWeight: 500,
          color: "#ffffff"
        }}>
          {formattedSlippage} {sellToken}
        </span>
      </div>
      
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between",
        alignItems: "center", 
        marginBottom: 12 
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ 
            width: 4, 
            height: 4, 
            borderRadius: "50%", 
            background: parseFloat(formattedPriceImpact) > 0.05 ? "#ef4444" : "#10b981" 
          }} />
          <span style={{ 
            color: "#ffffff", 
            fontSize: "13px",
            fontWeight: 500,
            letterSpacing: "0.02em"
          }}>
            Price Impact
          </span>
        </div>
        <span style={{ 
          fontSize: "13px",
          fontWeight: 500,
          color: parseFloat(formattedPriceImpact) > 0.05 ? "#ef4444" : "#10b981"
        }}>
          {(parseFloat(formattedPriceImpact) * 100).toFixed(2)}%
        </span>
      </div>
      
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: 12,
        borderTop: "1px solid rgba(255,255,255,0.08)",
      }}>
        <span style={{
          fontSize: "14px",
          fontWeight: 600,
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          gap: 6
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path 
              d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" 
              stroke="#ffffff" 
              strokeWidth="1.5"
            />
            <path 
              d="M5.5 8L7 9.5L10.5 6" 
              stroke="#ffffff" 
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Minimum Received
        </span>
        <span style={{
          fontSize: "14px",
          fontWeight: 600,
          color: "#ffffff",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}>
          {formattedMinReceived} {buyToken}
        </span>
      </div>
      
      {quote?.source && (
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 12,
          padding: "8px 12px",
          background: "rgba(59, 130, 246, 0.05)",
          borderRadius: 8
        }}>
          <span style={{ 
            color: "#ffffff", 
            fontSize: "12px",
            fontWeight: 500
          }}>
            Route
          </span>
          <span style={{ 
            fontSize: "12px",
            fontWeight: 500,
            color: "#3b82f6"
          }}>
            {quote.source}
          </span>
        </div>
      )}
    </div>
  );
};

export default QuoteSummary;