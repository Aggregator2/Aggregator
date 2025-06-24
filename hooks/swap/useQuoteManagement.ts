import { useState, useCallback, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { SpecialTokenService } from '../../src/services/specialTokenService';
import type { Quote, Token } from '../../types/wallet';

interface UseQuoteManagementProps {
  sellToken: Token;
  buyToken: Token;
  sellAmount: string;
  walletAddress: string | null;
  showWarning: (message: string) => void;
  networkIsOnline: boolean;
}

interface UseQuoteManagementReturn {
  currentQuote: Quote | null;
  quoteLoading: boolean;
  quoteError: string | null;
  quoteUpdatedAt: Date | null;
  isQuoteStale: boolean;
  fetchQuoteData: () => Promise<void>;
  clearQuote: () => void;
}

export function useQuoteManagement({
  sellToken,
  buyToken,
  sellAmount,
  walletAddress,
  showWarning,
  networkIsOnline
}: UseQuoteManagementProps): UseQuoteManagementReturn {
  const [currentQuote, setCurrentQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteUpdatedAt, setQuoteUpdatedAt] = useState<Date | null>(null);
  const [isQuoteStale, setIsQuoteStale] = useState(false);
  
  const isActiveRef = useRef(true);
  const consecutiveFailuresRef = useRef(0);
  const MAX_FAILURES = 3;

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
      
      let parsedAmount: string;
      try {
        // Use special token service to handle different decimals properly
        parsedAmount = SpecialTokenService.parseTokenAmount(
          sellToken.address,
          sellToken.chainId ?? 1,
          sellAmount,
          sellToken.decimals ?? 18
        );
      } catch (e) {
        console.error("Failed to parse sell amount:", e);
        throw new Error("Invalid sell amount format");
      }

      const requestBody = {
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: parsedAmount,
        chainId: sellToken.chainId || 1,
      };

      // eslint-disable-next-line no-console
      console.log("Quote request:", requestBody);
      const response = await fetch("/api/unified-quote-simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Quote API error:", response.status, errorData);
        throw new Error(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`
        );
      }
      const data = await response.json();

      if (data.warning) {
        showWarning(data.warning);
      }

      // Add developer logs for quote source and fallbacks
      if (data.source && process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.log(`💰 Quote source: ${data.source}`);
        if (data.source !== "0x") {
          // eslint-disable-next-line no-console
          console.log(`🔄 Fallback used: ${data.source}`);
        }
      }

      setCurrentQuote(data);
      setQuoteUpdatedAt(new Date());
      setIsQuoteStale(false);
      consecutiveFailuresRef.current = 0; // Reset on success
    } catch (error: any) {
      let errorMessage = "Failed to get quote";

      if (error.name === "AbortError") {
        errorMessage = "Quote request timed out. Please try again.";
      } else if (error.message?.includes("network")) {
        errorMessage = "Network error. Please check your connection.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      setQuoteError(errorMessage);
      setCurrentQuote(null);
      consecutiveFailuresRef.current++;

      if (!networkIsOnline) {
        showWarning("You appear to be offline. Please check your connection.");
      }
    } finally {
      setQuoteLoading(false);
    }
  }, [
    sellAmount,
    sellToken,
    buyToken,
    walletAddress,
    networkIsOnline,
    showWarning,
  ]);

  // Clear quote when component unmounts
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
    };
  }, []);

  // Effect to fetch quotes when inputs change with debounce and polling
  useEffect(() => {
    let debounceTimeout: NodeJS.Timeout;
    let pollingInterval: NodeJS.Timeout;

    // Clear any existing quote when inputs change
    const inputsChanged = () => {
      if (
        !sellAmount ||
        sellAmount.trim() === "" ||
        parseFloat(sellAmount) <= 0 ||
        isNaN(parseFloat(sellAmount))
      ) {
        setCurrentQuote(null);
        setQuoteError(null);
        return false;
      }
      return true;
    };

    // Wrapper to track failures
    const fetchWithFailureTracking = async () => {
      if (!isActiveRef.current) return;
      
      try {
        await fetchQuoteData();
      } catch (error) {
        console.warn(
          `Quote fetch failed (${consecutiveFailuresRef.current}/${MAX_FAILURES})`
        );

        // Stop polling after max failures
        if (consecutiveFailuresRef.current >= MAX_FAILURES) {
          clearInterval(pollingInterval);
          console.warn("Stopping quote polling due to repeated failures");
        }
      }
    };

    // Set up debounced initial fetch
    if (inputsChanged()) {
      debounceTimeout = setTimeout(() => {
        if (isActiveRef.current) {
          fetchWithFailureTracking();

          // Set up polling interval for continuous updates
          pollingInterval = setInterval(() => {
            if (isActiveRef.current && inputsChanged() && !quoteError) {
              fetchWithFailureTracking();
            }
          }, 30000); // Poll every 30 seconds to reduce API load and avoid rate limits
        }
      }, 400); // 400ms debounce for responsive feel
    }

    // Cleanup function
    return () => {
      clearTimeout(debounceTimeout);
      clearInterval(pollingInterval);
    };
  }, [
    fetchQuoteData,
    sellAmount,
    sellToken.address,
    buyToken.address,
    quoteError,
  ]);

  // Effect to mark quotes as stale after 10 seconds
  useEffect(() => {
    if (!quoteUpdatedAt) return;

    const checkStale = setInterval(() => {
      const now = new Date();
      const timeSinceUpdate = now.getTime() - quoteUpdatedAt.getTime();

      // Mark as stale after 45 seconds (increased to account for longer refresh intervals)
      if (timeSinceUpdate > 45000) {
        setIsQuoteStale(true);
      }
    }, 1000);

    return () => clearInterval(checkStale);
  }, [quoteUpdatedAt]);

  const clearQuote = useCallback(() => {
    setCurrentQuote(null);
    setQuoteError(null);
    setQuoteUpdatedAt(null);
    setIsQuoteStale(false);
  }, []);

  return {
    currentQuote,
    quoteLoading,
    quoteError,
    quoteUpdatedAt,
    isQuoteStale,
    fetchQuoteData,
    clearQuote,
  };
}