import { NextApiRequest, NextApiResponse } from "next";
import { JsonRpcProvider, Contract, parseUnits, Wallet, TypedDataDomain } from "ethers";
import { BigNumber } from "bignumber.js";
import { signQuote } from "../../utils/signOrder";
import { Quote } from "../../types/Quote";
import { multiChainQuoteService, CHAIN_CONFIG } from "../../src/services/multiChainQuoteService";

// Multi-chain quote support for all blockchains
const QUOTER_ADDRESSES: Record<number, string> = {
  1: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", // Ethereum
  42161: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", // Arbitrum
  137: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", // Polygon
  10: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", // Optimism
  56: "multi-chain-api", // BSC (using aggregators)
  43114: "multi-chain-api", // Avalanche (using aggregators)
  250: "multi-chain-api", // Fantom (using aggregators)
  195: "multi-chain-api", // Tron (using aggregators)
  101: "multi-chain-api", // Solana (using Jupiter)
};

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)"
];
const POOL_FEE = 3000;

// RPC URLs for different chains
const RPC_URLS: Record<number, string[]> = {
  1: [ // Ethereum
    process.env.ETHEREUM_RPC || "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://ethereum.publicnode.com"
  ],
  42161: [ // Arbitrum
    process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
    "https://arbitrum-one.publicnode.com",
    "https://endpoints.omniatech.io/v1/arbitrum/one/public"
  ],
  137: [ // Polygon
    "https://polygon-rpc.com",
    "https://rpc.ankr.com/polygon"
  ],
  10: [ // Optimism
    "https://mainnet.optimism.io",
    "https://rpc.ankr.com/optimism"
  ]
};

// EIP-712 domain for Quote signing
const QUOTE_DOMAIN: TypedDataDomain = {
  name: "MetaAggregator",
  version: "1",
  chainId: 31337, // Local development network
  verifyingContract: "0x0000000000000000000000000000000000000000", // Replace with your contract if needed
};

// Fallback exchange rates for common token pairs (normalized to lowercase)
const FALLBACK_RATES: Record<string, Record<string, number>> = {
  // Ethereum mainnet rates
  // WETH
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
    "0x6b175474e89094c44da98b954eedeac495271d0f": 2400, // WETH to DAI
    "0xa0b86a33e6417a2f0a87c1a8abe4e74b8d6fcb3b6": 2400, // WETH to USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7": 2400, // WETH to USDT
    "0x514910771af9ca656af840dff83e8264ecf986ca": 160,  // WETH to LINK
    "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": 340,  // WETH to UNI
  },
  // DAI
  "0x6b175474e89094c44da98b954eedeac495271d0f": {
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 0.000416, // DAI to WETH
    "0xa0b86a33e6417a2f0a87c1a8abe4e74b8d6fcb3b6": 1, // DAI to USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7": 1, // DAI to USDT
  },
  // USDC
  "0xa0b86a33e6417a2f0a87c1a8abe4e74b8d6fcb3b6": {
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 0.000416, // USDC to WETH
    "0x6b175474e89094c44da98b954eedeac495271d0f": 1, // USDC to DAI
    "0xdac17f958d2ee523a2206206994597c13d831ec7": 1, // USDC to USDT
  },
  // USDT
  "0xdac17f958d2ee523a2206206994597c13d831ec7": {
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 0.000416, // USDT to WETH
    "0x6b175474e89094c44da98b954eedeac495271d0f": 1, // USDT to DAI
    "0xa0b86a33e6417a2f0a87c1a8abe4e74b8d6fcb3b6": 1, // USDT to USDC
  },
  // UNI
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 0.00294, // UNI to WETH  
    "0x6b175474e89094c44da98b954eedeac495271d0f": 7, // UNI to DAI
    "0xa0b86a33e6417a2f0a87c1a8abe4e74b8d6fcb3b6": 7, // UNI to USDC
  },
  // LINK  
  "0x514910771af9ca656af840dff83e8264ecf986ca": {
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 0.00625, // LINK to WETH
    "0x6b175474e89094c44da98b954eedeac495271d0f": 15, // LINK to DAI
    "0xa0b86a33e6417a2f0a87c1a8abe4e74b8d6fcb3b6": 15, // LINK to USDC
  },

  // Arbitrum WETH (same rates as mainnet for now)
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": {
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": 2400, // WETH to DAI on Arbitrum
  },
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": {
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": 0.000416, // DAI to WETH on Arbitrum
  },
};

async function createProviderWithFallback(chainId: number): Promise<JsonRpcProvider> {
  const rpcUrls = RPC_URLS[chainId];
  if (!rpcUrls) {
    throw new Error(`Chain ${chainId} not supported`);
  }
  
  for (const rpcUrl of rpcUrls) {
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
  throw new Error(`All RPC providers failed for chain ${chainId}`);
}

function detectChainFromToken(tokenAddress: string): number {
  // Known token addresses by chain for better detection
  const KNOWN_TOKENS: Record<string, number> = {
    // Ethereum mainnet
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 1, // WETH
    '0x6b175474e89094c44da98b954eedeac495271d0f': 1, // DAI
    '0xa0b86a33e6417a2f0a87c1a8abe4e74b8d6fcb3b6': 1, // USDC
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 1, // USDT
    
    // BSC
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 56, // WBNB
    '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82': 56, // CAKE
    '0xe9e7cea3dedca5984780bafc599bd69add087d56': 56, // BUSD
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 56, // USDC BSC
    '0x55d398326f99059ff775485246999027b3197955': 56, // USDT BSC
    
    // Polygon
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 137, // WMATIC
    '0x831753dd7087cac61ab5644b308642cc1c33dc13': 137, // QUICK
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 137, // USDC Polygon
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 137, // USDT Polygon
    
    // Avalanche
    '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7': 43114, // WAVAX
    '0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd': 43114, // JOE
    '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7': 43114, // USDT AVAX
    '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 43114, // USDC AVAX
    
    // Arbitrum
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 42161, // WETH Arbitrum
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 42161, // DAI Arbitrum
    
    // Optimism
    '0x4200000000000000000000000000000000000006': 10, // WETH Optimism
    '0x7f5c764cbc14f9669b88837ca1490cca17c31607': 10, // USDC Optimism
    
    // Fantom
    '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83': 250, // WFTM
    '0x841fad6eae12c286d1fd18d1d525dffa75c7effe': 250, // BOO
  };
  
  const lowerAddress = tokenAddress.toLowerCase();
  
  // Check known tokens first
  if (KNOWN_TOKENS[lowerAddress]) {
    return KNOWN_TOKENS[lowerAddress];
  }
  
  // Detect by address format
  if (tokenAddress.startsWith('0x')) {
    return 1; // Default to Ethereum for 0x addresses
  } else if (tokenAddress.startsWith('T')) {
    return 195; // Tron addresses start with T
  } else if (tokenAddress.length > 40) {
    return 101; // Solana addresses are longer base58 strings
  }
  
  return 1; // Default to Ethereum
}

async function getQuoteWithFallback(
  sellToken: string,
  buyToken: string,
  sellAmount: string
): Promise<{ buyAmount: string; source: string }> {
  // Detect chain from token addresses
  const sellTokenChain = detectChainFromToken(sellToken);
  const buyTokenChain = detectChainFromToken(buyToken);
  
  // Ensure both tokens are on the same chain
  if (sellTokenChain !== buyTokenChain) {
    throw new Error("Cross-chain swaps not supported");
  }
  
  const chainId = sellTokenChain;
  
  // Check if chain has a quoter address
  if (!QUOTER_ADDRESSES[chainId]) {
    throw new Error(`Quoter not available for chain ${chainId}`);
  }
  
  // First try Uniswap V3 quoter
  try {
    const provider = await createProviderWithFallback(chainId);
    const quoter = new Contract(QUOTER_ADDRESSES[chainId], QUOTER_ABI, provider);
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
      source: `Uniswap V3 (Chain ${chainId})`
    };
  } catch (uniswapError) {
    console.warn(`Uniswap V3 quoter failed for chain ${chainId}:`, uniswapError);
    
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
  console.log("Available chains:", Object.keys(QUOTER_ADDRESSES));

  // Comprehensive input validation
  if (!sellToken || !buyToken || !sellAmount || !user) {
    return res.status(400).json({ 
      error: "Missing required fields: sellToken, buyToken, sellAmount, or user" 
    });
  }

  // Validate addresses - only check Ethereum format for Ethereum addresses
  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  
  // For non-Ethereum chains, we need different validation
  if (sellToken.startsWith('0x') && !ethAddressRegex.test(sellToken)) {
    return res.status(400).json({ error: "Invalid sellToken address format" });
  }
  if (buyToken.startsWith('0x') && !ethAddressRegex.test(buyToken)) {
    return res.status(400).json({ error: "Invalid buyToken address format" });
  }
  
  // User address should always be Ethereum format
  if (!ethAddressRegex.test(user)) {
    return res.status(400).json({ error: "Invalid user address" });
  }
  
  // Detect chains and validate support
  const sellTokenChain = detectChainFromToken(sellToken);
  const buyTokenChain = detectChainFromToken(buyToken);
  
  // Check if chains are supported
  if (!QUOTER_ADDRESSES[sellTokenChain] || !QUOTER_ADDRESSES[buyTokenChain]) {
    return res.status(400).json({ 
      error: `Chain not supported for quotes. Supported chains: ${Object.keys(QUOTER_ADDRESSES).join(', ')}` 
    });
  }
  
  // Ensure both tokens are on the same chain
  if (sellTokenChain !== buyTokenChain) {
    return res.status(400).json({ 
      error: "Cross-chain swaps not supported. Both tokens must be on the same chain." 
    });
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
    // Detect chain from tokens
    const detectedChain = detectChainFromToken(sellToken);
    
    // Get quote using multi-chain service
    let quoteResult;
    try {
      console.log('Trying multi-chain service for chain:', detectedChain);
      quoteResult = await multiChainQuoteService.getQuote({
        sellToken,
        buyToken,
        sellAmount,
        chainId: detectedChain,
        slippage: 0.5
      });
      console.log('Multi-chain service returned:', quoteResult);
    } catch (multiChainError) {
      console.warn('Multi-chain service failed, trying legacy fallback:', multiChainError.message);
      // Fall back to legacy method
      quoteResult = await getQuoteWithFallback(sellToken, buyToken, sellAmount);
      console.log('Legacy fallback returned:', quoteResult);
    }
    
    const { buyAmount, source } = quoteResult;
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

    console.log("Quote prepared:", { 
      ...quote, 
      source, 
      chain: CHAIN_CONFIG[detectedChain]?.name || detectedChain 
    });

    // Sign the quote with backend wallet - with fallback
    let makerSignature: string;
    try {
      if (!process.env.BACKEND_PRIVATE_KEY) {
        throw new Error("Backend private key not configured");
      }
      
      const provider = await createProviderWithFallback(1); // Use Ethereum for signing
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
