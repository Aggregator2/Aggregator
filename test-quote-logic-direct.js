// Test the unified-quote-simple API endpoint directly
const { BigNumber } = require("bignumber.js");

// Mock the simplified quote logic from unified-quote-simple.ts
const PRICE_ESTIMATES = {
  // Ethereum mainnet - using proper token addresses and realistic rates
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": {
    // ETH
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 2800, // ETH -> USDC (6 decimals)
    "0xdac17f958d2ee523a2206206994597c13d831ec7": 2800, // ETH -> USDT (6 decimals)
    "0x6b175474e89094c44da98b954eedeac495271d0f": 2800, // ETH -> DAI (18 decimals)
  },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
    // WETH
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 2800, // WETH -> USDC (6 decimals)
    "0xdac17f958d2ee523a2206206994597c13d831ec7": 2800, // WETH -> USDT (6 decimals)
  },
  // Stablecoin pairs (1:1)
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
    // USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7": 1, // USDC -> USDT
    "0x6b175474e89094c44da98b954eedeac495271d0f": 1, // USDC -> DAI
  },
};

// Token decimal configurations
const TOKEN_DECIMALS = {
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": 18, // ETH
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 18, // WETH
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7": 6, // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f": 18, // DAI
};

// Get basic quote using price estimates with proper decimal handling
function getBasicQuote(sellToken, buyToken, sellAmount) {
  try {
    const sellTokenLower = sellToken.toLowerCase();
    const buyTokenLower = buyToken.toLowerCase();

    // Get decimal info
    const sellDecimals = TOKEN_DECIMALS[sellTokenLower] || 18;
    const buyDecimals = TOKEN_DECIMALS[buyTokenLower] || 18;

    // Find price estimate
    let rate = 1;

    if (
      PRICE_ESTIMATES[sellTokenLower] &&
      PRICE_ESTIMATES[sellTokenLower][buyTokenLower]
    ) {
      rate = PRICE_ESTIMATES[sellTokenLower][buyTokenLower];
    } else if (
      PRICE_ESTIMATES[buyTokenLower] &&
      PRICE_ESTIMATES[buyTokenLower][sellTokenLower]
    ) {
      rate = 1 / PRICE_ESTIMATES[buyTokenLower][sellTokenLower];
    } else {
      // Default to 1:1 for same-type tokens (e.g., stablecoin swaps)
      rate = 1;
    }

    // Convert amounts accounting for different decimals
    const sellAmountNum = parseFloat(sellAmount);

    // Adjust for decimal differences (e.g., ETH 18 decimals -> USDC 6 decimals)
    const decimalAdjustment = Math.pow(10, buyDecimals - sellDecimals);
    const buyAmountNum = sellAmountNum * rate * decimalAdjustment;
    const buyAmount = Math.floor(buyAmountNum).toString();

    // Apply 0.5% slippage
    const slippageAmount = buyAmountNum * 0.005;
    const minReceived = Math.floor(buyAmountNum - slippageAmount).toString();

    return {
      source: "Basic Estimate",
      buyAmount,
      sellAmount,
      price: rate,
      minReceived,
      lpFee: "0.003", // 0.3%
      slippage: "0.005", // 0.5%
      priceImpact: "0.001", // 0.1%
      networkFeeUsd: "$1.50",
    };
  } catch (error) {
    console.error("Basic quote error:", error);
    return null;
  }
}

// Test cases
console.log("=== Testing Quote Logic ===\n");

// Test 1: ETH to USDC (1 ETH = 2800 USDC)
console.log("Test 1: 1 ETH -> USDC");
const quote1 = getBasicQuote(
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", // ETH
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "1000000000000000000" // 1 ETH in wei
);
console.log("Result:", quote1);
console.log("Expected USDC (6 decimals):", (2800 * 1000000).toString()); // 2800 USDC = 2800000000 (6 decimals)
console.log("Decimal adjustment:", Math.pow(10, 6 - 18)); // Should be 1e-12
console.log("");

// Test 2: USDC to USDT (1:1)
console.log("Test 2: 1000 USDC -> USDT");
const quote2 = getBasicQuote(
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
  "1000000000" // 1000 USDC (6 decimals)
);
console.log("Result:", quote2);
console.log("");

// Test 3: ETH to DAI
console.log("Test 3: 1 ETH -> DAI");
const quote3 = getBasicQuote(
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", // ETH
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "1000000000000000000" // 1 ETH in wei
);
console.log("Result:", quote3);
console.log(
  "Expected DAI (18 decimals):",
  (2800 * Math.pow(10, 18)).toString()
); // 2800 DAI = 2800 * 10^18
console.log("");

console.log("=== Testing Complete ===");
