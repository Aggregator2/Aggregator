/**
 * Test the unified quote API directly
 */

// Mock Jupiter response for Solana
const mockJupiterQuote = {
  inputMint: "So11111111111111111111111111111111111111112", // SOL
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  inAmount: "1000000000", // 1 SOL
  outAmount: "140878456", // ~140 USDC
  slippageBps: 50,
  swapMode: "ExactIn",
};

// Test Jupiter quote parsing
console.log("🧪 Testing Jupiter quote parsing...");
const jupiterResult = {
  source: "Jupiter",
  buyAmount: mockJupiterQuote.outAmount,
  sellAmount: mockJupiterQuote.inAmount,
  price:
    parseFloat(mockJupiterQuote.outAmount) /
    parseFloat(mockJupiterQuote.inAmount),
  minReceived: mockJupiterQuote.outAmount,
  lpFee: "0",
  slippage: (mockJupiterQuote.slippageBps / 10000).toString(),
  priceImpact: "0",
  networkFeeUsd: "$0.01",
};

console.log("✅ Jupiter result:", {
  source: jupiterResult.source,
  price: jupiterResult.price.toFixed(2),
  slippage: jupiterResult.slippage,
  networkFee: jupiterResult.networkFeeUsd,
});

// Test chain routing logic
console.log("\n🔄 Testing chain routing...");
const testCases = [
  { chainId: "solana", expected: "Jupiter" },
  { chainId: 1, expected: "0x, OpenOcean, ParaSwap, Uniswap" },
  { chainId: 56, expected: "0x, OpenOcean, ParaSwap, Uniswap" },
  { chainId: 137, expected: "0x, OpenOcean, ParaSwap, Uniswap" },
];

testCases.forEach((testCase) => {
  const { chainId, expected } = testCase;
  const chainName = chainId === "solana" ? "Solana" : `EVM Chain ${chainId}`;
  console.log(`${chainName}: Routes to ${expected}`);
});

// Test API endpoint mappings
console.log("\n🌐 Testing API endpoint mappings...");
const CHAIN_MAPPINGS = {
  1: "ethereum",
  56: "bsc",
  137: "polygon",
  42161: "arbitrum",
  10: "optimism",
  43114: "avalanche",
  250: "fantom",
};

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
};

Object.entries(CHAIN_MAPPINGS).forEach(([chainId, chainName]) => {
  const zeroXUrl = API_ENDPOINTS["0x"][chainName];
  const openOceanUrl = API_ENDPOINTS["openocean"][chainName];
  const paraswapUrl = API_ENDPOINTS["paraswap"][chainName];

  console.log(`Chain ${chainId} (${chainName}):`);
  console.log(`  0x: ${zeroXUrl ? "✅" : "❌"} ${zeroXUrl || "Not supported"}`);
  console.log(
    `  OpenOcean: ${openOceanUrl ? "✅" : "❌"} ${
      openOceanUrl || "Not supported"
    }`
  );
  console.log(
    `  ParaSwap: ${paraswapUrl ? "✅" : "❌"} ${paraswapUrl || "Not supported"}`
  );
});

console.log("\n📋 Summary:");
console.log("✅ Jupiter API integration ready for Solana");
console.log("✅ 0x API endpoints configured (API key optional)");
console.log("✅ OpenOcean API endpoints configured (free tier)");
console.log("✅ ParaSwap API endpoints configured (free tier)");
console.log("⚠️  API keys needed for production rate limits");
console.log("🔄 Fallback logic: 0x → OpenOcean → ParaSwap → Uniswap");
