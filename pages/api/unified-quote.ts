import { NextApiRequest, NextApiResponse } from "next";
import { JsonRpcProvider, Contract, parseUnits } from "ethers";
import { BigNumber } from "bignumber.js";

// Uniswap V3 Quoter on Arbitrum
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)",
];
const POOL_FEE = 3000;

// Chain ID mappings for APIs
const CHAIN_MAPPINGS = {
  1: "ethereum",
  56: "bsc",
  137: "polygon",
  42161: "arbitrum",
  10: "optimism",
  43114: "avalanche",
  250: "fantom",
  solana: "solana",
};

// API endpoint configurations with correct URLs
const API_ENDPOINTS = {
  "0x": {
    ethereum: "https://api.0x.org/swap/v1",
    bsc: "https://bsc.api.0x.org/swap/v1",
    polygon: "https://polygon.api.0x.org/swap/v1",
    arbitrum: "https://arbitrum.api.0x.org/swap/v1",
    optimism: "https://optimism.api.0x.org/swap/v1",
    avalanche: "https://avalanche.api.0x.org/swap/v1",
    fantom: "https://fantom.api.0x.org/swap/v1",
  },
  openocean: {
    ethereum: "https://open-api.openocean.finance/v3/eth",
    bsc: "https://open-api.openocean.finance/v3/bsc",
    polygon: "https://open-api.openocean.finance/v3/polygon",
    arbitrum: "https://open-api.openocean.finance/v3/arbitrum",
    optimism: "https://open-api.openocean.finance/v3/optimism",
    avalanche: "https://open-api.openocean.finance/v3/avax",
    fantom: "https://open-api.openocean.finance/v3/fantom",
  },
  paraswap: {
    ethereum: "https://apiv5.paraswap.io/prices/1",
    polygon: "https://apiv5.paraswap.io/prices/137",
    bsc: "https://apiv5.paraswap.io/prices/56",
    avalanche: "https://apiv5.paraswap.io/prices/43114",
  },
  jupiter: "https://quote-api.jup.ag/v6/quote",
};

// Get 0x quote - Fix authentication and handle free tier properly
async function get0xQuote(
  chainId: number | string,
  sellToken: string,
  buyToken: string,
  sellAmount: string
) {
  try {
    const chain = CHAIN_MAPPINGS[chainId as keyof typeof CHAIN_MAPPINGS];
    if (!chain || chain === "solana") return null;

    const baseUrl =
      API_ENDPOINTS["0x"][chain as keyof (typeof API_ENDPOINTS)["0x"]];
    if (!baseUrl) return null;

    const params = new URLSearchParams({
      sellToken,
      buyToken,
      sellAmount,
      slippagePercentage: "0.005", // 0.5%
    });

    // Try without API key first (0x supports this for basic usage)
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const response = await fetch(`${baseUrl}/quote?${params.toString()}`, {
      headers,
    });

    if (!response.ok) {
      console.error(`0x API error: ${response.status} ${response.statusText}`);
      // If free tier fails, try with API key
      if (process.env.ZEROX_API_KEY && response.status === 401) {
        headers["0x-api-key"] = process.env.ZEROX_API_KEY;
        const retryResponse = await fetch(
          `${baseUrl}/quote?${params.toString()}`,
          {
            headers,
          }
        );
        if (!retryResponse.ok) {
          return null;
        }
        const retryData = await retryResponse.json();
        return parse0xResponse(retryData);
      }
      return null;
    }

    const data = await response.json();
    return parse0xResponse(data);
  } catch (error) {
    console.error("0x quote error:", error);
    return null;
  }
}

function parse0xResponse(data: any) {
  return {
    source: "0x",
    buyAmount: data.buyAmount,
    sellAmount: data.sellAmount,
    price: parseFloat(data.buyAmount) / parseFloat(data.sellAmount),
    minReceived: data.minReceived || data.buyAmount,
    lpFee: data.sources?.[0]?.proportion || "0",
    slippage: "0.005",
    priceImpact: data.estimatedPriceImpact || "0",
    networkFeeUsd: data.gasPrice
      ? `$${(((parseFloat(data.gasPrice) * 21000) / 1e18) * 2000).toFixed(2)}`
      : "$1.50",
  };
}

// Get OpenOcean quote - free API
async function getOpenOceanQuote(
  chainId: number | string,
  sellToken: string,
  buyToken: string,
  sellAmount: string
) {
  try {
    const chain = CHAIN_MAPPINGS[chainId as keyof typeof CHAIN_MAPPINGS];
    if (!chain || chain === "solana") return null;

    const baseUrl =
      API_ENDPOINTS["openocean"][
        chain as keyof (typeof API_ENDPOINTS)["openocean"]
      ];
    if (!baseUrl) return null;

    const params = new URLSearchParams({
      inTokenAddress: sellToken,
      outTokenAddress: buyToken,
      amount: sellAmount,
      gasPrice: "5",
      slippage: "0.5",
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const response = await fetch(`${baseUrl}/quote?${params.toString()}`, {
      headers,
    });

    if (!response.ok) {
      console.error(
        `OpenOcean API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();

    return {
      source: "OpenOcean",
      buyAmount: data.outAmount,
      sellAmount: data.inAmount,
      price: parseFloat(data.outAmount) / parseFloat(data.inAmount),
      minReceived: data.minOutAmount || data.outAmount,
      lpFee: data.referenceFee || "0",
      slippage: data.slippage || "0",
      priceImpact: data.priceImpact || "0",
      networkFeeUsd: "$1.25",
    };
  } catch (error) {
    console.error("OpenOcean quote error:", error);
    return null;
  }
}

// Get Jupiter quote for Solana - free API
async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: string
) {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: "50", // 0.5%
      swapMode: "ExactIn",
    });

    const response = await fetch(
      `${API_ENDPOINTS.jupiter}?${params.toString()}`,
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
      minReceived: data.otherAmountThreshold,
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

// Get ParaSwap quote - fix URL format for correct API usage
async function getParaSwapQuote(
  chainId: number | string,
  sellToken: string,
  buyToken: string,
  sellAmount: string
) {
  try {
    const chain = CHAIN_MAPPINGS[chainId as keyof typeof CHAIN_MAPPINGS];
    if (!chain || chain === "solana") return null;

    // ParaSwap requires network ID in URL path, not query params
    const networkIdMap: Record<string, string> = {
      ethereum: "1",
      polygon: "137",
      bsc: "56",
      avalanche: "43114",
    };

    const networkId = networkIdMap[chain];
    if (!networkId) return null;

    // Correct ParaSwap API format: /prices/{network}/{srcToken}/{destToken}/{srcAmount}
    const url = `https://apiv5.paraswap.io/prices/${networkId}/${sellToken}/${buyToken}/${sellAmount}?side=SELL&network=${networkId}`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        `ParaSwap API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();

    if (!data.priceRoute) {
      return null;
    }

    return {
      source: "ParaSwap",
      buyAmount: data.priceRoute.destAmount,
      sellAmount: data.priceRoute.srcAmount,
      price:
        parseFloat(data.priceRoute.destAmount) /
        parseFloat(data.priceRoute.srcAmount),
      minReceived: data.priceRoute.destAmount, // ParaSwap handles slippage in route
      lpFee: "0",
      slippage: "0.005",
      priceImpact: "0",
      networkFeeUsd: "$1.00",
    };
  } catch (error) {
    console.error("ParaSwap quote error:", error);
    return null;
  }
}

// Get Uniswap V3 quote using SDK
async function getUniswapQuote(
  sellToken: string,
  buyToken: string,
  sellAmount: string
) {
  try {
    const provider = new JsonRpcProvider(
      process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc"
    );

    const quoter = new Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
    const amountIn = parseUnits(sellAmount, 18);

    const amountOut = await quoter.quoteExactInputSingle.staticCall(
      sellToken,
      buyToken,
      POOL_FEE,
      amountIn,
      0
    );

    const buyAmount = amountOut?.toString() || "0";
    const buyAmountBN = new BigNumber(buyAmount);
    const price = buyAmountBN.dividedBy(amountIn.toString()).toNumber();

    const slippageRate = 0.005;
    const lpFeeRate = 0.003;
    const priceImpactRate = 0.001;

    const lpFee = buyAmountBN.multipliedBy(lpFeeRate).toFixed(0);
    const priceImpact = buyAmountBN.multipliedBy(priceImpactRate).toFixed(0);
    const slippage = buyAmountBN.multipliedBy(slippageRate).toFixed(0);

    const minReceived = buyAmountBN
      .minus(lpFee)
      .minus(priceImpact)
      .minus(slippage)
      .toFixed(0);

    return {
      source: "Uniswap V3",
      buyAmount: buyAmountBN.toFixed(0),
      sellAmount: amountIn.toString(),
      price,
      minReceived,
      lpFee,
      priceImpact,
      slippage,
      networkFeeUsd: "$0.75",
    };
  } catch (error) {
    console.error("Uniswap quote error:", error);
    return null;
  }
}

// Main unified quote router
async function getUnifiedQuote(
  chainId: number | string,
  sellToken: string,
  buyToken: string,
  sellAmount: string
) {
  // Route to Jupiter for Solana
  if (chainId === "solana") {
    return await getJupiterQuote(sellToken, buyToken, sellAmount);
  }

  // For EVM chains, try multiple sources: 0x, OpenOcean, ParaSwap, then Uniswap
  const quotes = await Promise.allSettled([
    get0xQuote(chainId, sellToken, buyToken, sellAmount),
    getOpenOceanQuote(chainId, sellToken, buyToken, sellAmount),
    getParaSwapQuote(chainId, sellToken, buyToken, sellAmount),
    getUniswapQuote(sellToken, buyToken, sellAmount),
  ]);

  // Get successful quotes
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

  const validQuotes = quotes
    .filter((result) => result.status === "fulfilled" && result.value !== null)
    .map((result) => (result as PromiseFulfilledResult<QuoteResult>).value);

  if (validQuotes.length === 0) {
    return null;
  }

  // Return the best quote (highest buyAmount)
  const bestQuote = validQuotes.reduce((best, current) => {
    const bestAmount = new BigNumber(best.buyAmount);
    const currentAmount = new BigNumber(current.buyAmount);
    return currentAmount.gt(bestAmount) ? current : best;
  });

  return bestQuote;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { sellToken, buyToken, sellAmount, chainId = 42161 } = req.body;

  if (!sellToken || !buyToken || !sellAmount) {
    return res.status(400).json({
      error: "Missing required parameters: sellToken, buyToken, sellAmount",
    });
  }

  try {
    const quote = await getUnifiedQuote(
      chainId,
      sellToken,
      buyToken,
      sellAmount
    );

    if (!quote) {
      return res.status(404).json({
        error: "No quotes available for this trading pair",
      });
    }

    // Add developer logs
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.log(`Quote source: ${quote.source}`);
      if (quote.source !== "0x") {
        // eslint-disable-next-line no-console
        console.log(`Fallback: ${quote.source}`);
      }
    }

    return res.status(200).json(quote);
  } catch (err: unknown) {
    const error = err as Error;
    return res.status(500).json({
      error: error.message || "Failed to fetch quote",
    });
  }
}
