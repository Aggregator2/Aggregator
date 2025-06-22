import { NextApiRequest, NextApiResponse } from "next";

// Unified quote API that only uses real external APIs
// No fallback estimation - returns proper errors when no quotes available

interface QuoteResult {
  source: string;
  buyAmount: string;
  sellAmount: string;
  price: number;
  minReceived: string;
  lpFee: string;
  slippage: string;
  priceImpact: string;
  networkFeeUsd: string;
}

// Try Jupiter for Solana (no API key required)
async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: string
): Promise<QuoteResult | null> {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: "50", // 0.5%
      swapMode: "ExactIn",
    });

    const response = await fetch(
      `https://quote-api.jup.ag/v6/quote?${params.toString()}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(
        `Jupiter API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();

    return {
      source: "Jupiter",
      buyAmount: data.outAmount,
      sellAmount: data.inAmount,
      price: parseFloat(data.outAmount) / parseFloat(data.inAmount),
      minReceived: data.otherAmountThreshold || data.outAmount,
      lpFee: data.platformFee?.amount || "0",
      slippage: data.slippageBps
        ? (data.slippageBps / 10000).toString()
        : "0.005",
      priceImpact: data.priceImpactPct || "0",
      networkFeeUsd: "$0.01",
    };
  } catch (error) {
    console.error("Jupiter quote error:", error);
    return null;
  }
}

// Try 0x API (free tier, may require API key for higher limits)
async function get0xQuote(
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  chainId: number
): Promise<QuoteResult | null> {
  try {
    const baseUrls: Record<number, string> = {
      1: "https://api.0x.org",
      56: "https://bsc.api.0x.org",
      137: "https://polygon.api.0x.org",
      42161: "https://arbitrum.api.0x.org",
      10: "https://optimism.api.0x.org",
      43114: "https://avalanche.api.0x.org",
    };

    const baseUrl = baseUrls[chainId];
    if (!baseUrl) {
      console.error(`0x API: Chain ${chainId} not supported`);
      return null;
    }

    const params = new URLSearchParams({
      sellToken,
      buyToken,
      sellAmount,
      slippagePercentage: "0.5",
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add API key if available
    if (process.env.ZEROX_API_KEY) {
      headers["0x-api-key"] = process.env.ZEROX_API_KEY;
    }

    const response = await fetch(
      `${baseUrl}/swap/v1/quote?${params.toString()}`,
      {
        headers,
      }
    );

    if (!response.ok) {
      console.error(`0x API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    return {
      source: "0x Protocol",
      buyAmount: data.buyAmount,
      sellAmount: data.sellAmount,
      price: parseFloat(data.price),
      minReceived: data.buyAmount, // 0x already includes slippage
      lpFee: data.protocolFee || "0",
      slippage: "0.005",
      priceImpact: data.estimatedPriceImpact || "0",
      networkFeeUsd: data.gasPrice
        ? `$${((parseFloat(data.gasPrice) * 21000 * 2500) / 1e18).toFixed(2)}`
        : "$2.00",
    };
  } catch (error) {
    console.error("0x quote error:", error);
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { sellToken, buyToken, sellAmount, chainId = 1 } = req.body;

  if (!sellToken || !buyToken || !sellAmount) {
    return res.status(400).json({
      error: "Missing required parameters: sellToken, buyToken, sellAmount",
    });
  }

  try {
    let quote: QuoteResult | null = null;

    // For Solana, try Jupiter
    if (chainId === "solana" || chainId === 101) {
      console.log("Trying Jupiter for Solana...");
      quote = await getJupiterQuote(sellToken, buyToken, sellAmount);
    } else {
      // For EVM chains, try 0x Protocol
      console.log(`Trying 0x Protocol for chain ${chainId}...`);
      quote = await get0xQuote(sellToken, buyToken, sellAmount, chainId);
    }

    if (!quote) {
      return res.status(503).json({
        error: "No quote providers available. Please try again later.",
        details:
          "All quote providers are currently unavailable or rate limited.",
      });
    }

    // Add developer logs
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.log(`💰 Quote source: ${quote.source}`);
      // eslint-disable-next-line no-console
      console.log(
        `� ${quote.sellAmount} → ${quote.buyAmount} (price: ${quote.price})`
      );
    }

    return res.status(200).json(quote);
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Unified quote error:", error);

    return res.status(500).json({
      error: "Failed to fetch quote",
      details: error.message,
    });
  }
}
