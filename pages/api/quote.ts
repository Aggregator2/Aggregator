import { NextApiRequest, NextApiResponse } from "next";
import { JsonRpcProvider, Contract, parseUnits, Wallet, TypedDataDomain } from "ethers";
import { BigNumber } from "bignumber.js";
import { signQuote } from "../../utils/signOrder";
import { Quote } from "../../types/Quote";

// Uniswap V3 Quoter on Arbitrum
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)"
];
const POOL_FEE = 3000;

// Fallback RPC URLs for redundancy
const RPC_URLS = [
  process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
  "https://arbitrum-one.publicnode.com",
  "https://endpoints.omniatech.io/v1/arbitrum/one/public",
];

// EIP-712 domain for Quote signing
const QUOTE_DOMAIN: TypedDataDomain = {
  name: "MetaAggregator",
  version: "1",
  chainId: 31337, // Local development network
  verifyingContract: "0x0000000000000000000000000000000000000000", // Replace with your contract if needed
};

// Fallback exchange rates for common token pairs
const FALLBACK_RATES: Record<string, Record<string, number>> = {
  // WETH to DAI approximate rate
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": {
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": 2400, // 1 WETH = ~2400 DAI
  },
  // DAI to WETH
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": {
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": 0.000416, // 1 DAI = ~0.000416 WETH
  },
};

async function createProviderWithFallback(): Promise<JsonRpcProvider> {
  for (const rpcUrl of RPC_URLS) {
    try {
      const provider = new JsonRpcProvider(rpcUrl);
      // Test the provider with a simple call
      await provider.getBlockNumber();
      return provider;
    } catch (error) {
      console.warn(`RPC URL ${rpcUrl} failed:`, error);
      continue;
    }
  }
  throw new Error("All RPC providers failed");
}

async function getQuoteWithFallback(
  sellToken: string,
  buyToken: string,
  sellAmount: string
): Promise<{ buyAmount: string; source: string }> {
  // First try Uniswap V3 quoter
  try {
    const provider = await createProviderWithFallback();
    const quoter = new Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
    const amountIn = parseUnits(sellAmount, 18);
    
    const amountOut = await quoter.quoteExactInputSingle.staticCall(
      sellToken,
      buyToken,
      POOL_FEE,
      amountIn,
      0
    );
    
    return {
      buyAmount: amountOut.toString(),
      source: "Uniswap V3"
    };
  } catch (uniswapError) {
    console.warn("Uniswap V3 quoter failed:", uniswapError);
    
    // Fallback to hardcoded rates
    const sellTokenLower = sellToken.toLowerCase();
    const buyTokenLower = buyToken.toLowerCase();
    
    if (FALLBACK_RATES[sellTokenLower]?.[buyTokenLower]) {
      const rate = FALLBACK_RATES[sellTokenLower][buyTokenLower];
      const amountIn = parseFloat(sellAmount);
      const estimatedOut = amountIn * rate;
      const buyAmountWei = parseUnits(estimatedOut.toString(), 18);
      
      return {
        buyAmount: buyAmountWei.toString(),
        source: "Fallback Rate"
      };
    }
    
    throw new Error("No quote available for this token pair");
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sellToken, buyToken, sellAmount, user } = req.body;
  console.log("Incoming quote request:", { sellToken, buyToken, sellAmount, user });

  // Comprehensive input validation
  if (!sellToken || !buyToken || !sellAmount || !user) {
    return res.status(400).json({ 
      error: "Missing required fields: sellToken, buyToken, sellAmount, or user" 
    });
  }

  // Validate Ethereum addresses
  const addressRegex = /^0x[a-fA-F0-9]{40}$/;
  if (!addressRegex.test(sellToken)) {
    return res.status(400).json({ error: "Invalid sellToken address" });
  }
  if (!addressRegex.test(buyToken)) {
    return res.status(400).json({ error: "Invalid buyToken address" });
  }
  if (!addressRegex.test(user)) {
    return res.status(400).json({ error: "Invalid user address" });
  }

  // Validate sellAmount
  const sellAmountNum = parseFloat(sellAmount);
  if (isNaN(sellAmountNum) || sellAmountNum <= 0) {
    return res.status(400).json({ error: "Invalid sellAmount: must be a positive number" });
  }

  // Prevent same token swaps
  if (sellToken.toLowerCase() === buyToken.toLowerCase()) {
    return res.status(400).json({ error: "Cannot swap the same token" });
  }

  try {
    // Get quote with fallback mechanisms
    const { buyAmount, source } = await getQuoteWithFallback(sellToken, buyToken, sellAmount);
    const buyAmountBN = new BigNumber(buyAmount);

    // Calculate fees and slippage
    const slippageRate = 0.005; // 0.5%
    const lpFeeRate = 0.003; // 0.3%
    const priceImpactRate = 0.001; // 0.1%

    const lpFee = buyAmountBN.multipliedBy(lpFeeRate).toFixed(0);
    const priceImpact = buyAmountBN.multipliedBy(priceImpactRate).toFixed(0);
    const slippage = buyAmountBN.multipliedBy(slippageRate).toFixed(0);

    const minReceived = buyAmountBN
      .minus(lpFee)
      .minus(priceImpact)
      .minus(slippage)
      .toFixed(0);

    // Ensure minReceived is not negative
    if (new BigNumber(minReceived).isLessThan(0)) {
      return res.status(400).json({ 
        error: "Quote not viable: fees exceed expected output" 
      });
    }

    const networkFeeUsd = "0.52";

    // Prepare Quote object
    const validTo = Math.floor(Date.now() / 1000) + 60 * 5; // 5 minutes from now
    const nonce = Date.now();
    const maker = process.env.BACKEND_WALLET_ADDRESS as string;

    if (!maker) {
      return res.status(500).json({ error: "Backend wallet not configured" });
    }    const quote: Quote = {
      userAddress: user,
      quoteId: nonce,
      content: "Swap quote",
      sellToken,
      buyToken,
      sellAmount: parseUnits(sellAmount, 18).toString(),
      buyAmount: buyAmountBN.toFixed(0),
      validTo,
      maker,
    };

    // Validate quote object
    for (const [key, value] of Object.entries(quote)) {
      if (value === undefined || value === null) {
        throw new Error(`Missing field in quote: ${key}`);
      }
    }

    console.log("Quote prepared:", { ...quote, source });

    // Sign the quote with backend wallet - with fallback
    let makerSignature: string;
    try {
      if (!process.env.BACKEND_PRIVATE_KEY) {
        throw new Error("Backend private key not configured");
      }
      
      const provider = await createProviderWithFallback();
      const backendWallet = new Wallet(process.env.BACKEND_PRIVATE_KEY, provider);
      makerSignature = await signQuote(backendWallet, QUOTE_DOMAIN, quote);
    } catch (signingError) {
      console.error("Quote signing failed:", signingError);
      return res.status(500).json({ 
        error: "Unable to sign quote",
        details: signingError instanceof Error ? signingError.message : "Unknown signing error"
      });
    }

    return res.status(200).json({
      buyAmount: buyAmountBN.toFixed(0),
      minReceived,
      lpFee,
      priceImpact,
      slippage,
      networkFeeUsd,
      quote,
      makerSignature,
      source, // Include source information
      warning: source === "Fallback Rate" ? "Using approximate rates due to network issues" : undefined,
    });

  } catch (err: any) {
    console.error("Quote generation error:", err);
    
    // Categorize errors for better user feedback
    let errorMessage = "Quote generation failed";
    let statusCode = 500;
    
    if (err.message.includes("network") || err.message.includes("RPC")) {
      errorMessage = "Network connectivity issues. Please try again.";
      statusCode = 503;
    } else if (err.message.includes("No quote available")) {
      errorMessage = "Quote not available for this token pair";
      statusCode = 400;
    } else if (err.message.includes("insufficient")) {
      errorMessage = "Insufficient liquidity for this trade";
      statusCode = 400;
    } else if (err.message.includes("timeout")) {
      errorMessage = "Request timeout. Please try again.";
      statusCode = 408;
    } else if (err.message) {
      errorMessage = err.message;
    }
    
    return res.status(statusCode).json({ 
      error: errorMessage,
      code: err.code || "QUOTE_ERROR",
      retryable: statusCode >= 500 || statusCode === 408,
    });
  }
}

export const quoteTypes = {
  Quote: [
    { name: "userAddress", type: "address" },
    { name: "quoteId", type: "uint256" },
    { name: "content", type: "string" },
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "maker", type: "address" }
  ]
};
