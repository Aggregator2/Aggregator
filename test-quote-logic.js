// Test the simplified quote API
console.log("🧪 Testing Simplified Quote API...");

const testData = {
  sellToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // ETH
  buyToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  sellAmount: "1000000000000000000", // 1 ETH
  chainId: 1,
};

console.log("Input:", testData);

// Simulate the simplified quote logic
const PRICE_ESTIMATES = {
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 2800,
  },
};

function testBasicQuote(sellToken, buyToken, sellAmount) {
  const sellTokenLower = sellToken.toLowerCase();
  const buyTokenLower = buyToken.toLowerCase();

  let rate = 1;
  if (
    PRICE_ESTIMATES[sellTokenLower] &&
    PRICE_ESTIMATES[sellTokenLower][buyTokenLower]
  ) {
    rate = PRICE_ESTIMATES[sellTokenLower][buyTokenLower];
  }

  const sellAmountNum = parseFloat(sellAmount);
  const buyAmountNum = sellAmountNum * rate;
  const buyAmount = Math.floor(buyAmountNum).toString();

  const slippageAmount = buyAmountNum * 0.005;
  const minReceived = Math.floor(buyAmountNum - slippageAmount).toString();

  return {
    source: "Basic Estimate",
    buyAmount,
    sellAmount,
    price: rate,
    minReceived,
    lpFee: "0.003",
    slippage: "0.005",
    priceImpact: "0.001",
    networkFeeUsd: "$1.50",
  };
}

const result = testBasicQuote(
  testData.sellToken,
  testData.buyToken,
  testData.sellAmount
);
console.log("✅ Expected Quote Response:", result);

console.log("\n📊 Quote Analysis:");
console.log(`- Rate: 1 ETH = ${result.price} USDC`);
console.log(`- Sell: ${parseFloat(result.sellAmount) / 1e18} ETH`);
console.log(
  `- Buy: ${result.buyAmount} USDC (${parseFloat(result.buyAmount) / 1e6} USDC)`
);
console.log(`- Min Received: ${result.minReceived} USDC`);
console.log(`- Slippage: ${(parseFloat(result.slippage) * 100).toFixed(1)}%`);
