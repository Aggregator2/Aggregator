/**
 * Test script for profit mechanisms
 * Run with: node test-profit-mechanisms.js
 */

const fetch = require('node-fetch');

// Sample input for testing
const testQuoteRequest = {
  sellToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  buyToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
  sellAmount: "1000000000", // 1000 USDC (6 decimals + 3 extra for testing)
  chainId: 1,
  user: "0x742d35Cc6634C0532925a3b844Bc9e7595f6fed2"
};

// Test endpoints
const REGULAR_QUOTE_URL = "http://localhost:3000/api/quote";
const PROFITABLE_QUOTE_URL = "http://localhost:3000/api/quote-profitable";
const ANALYTICS_URL = "http://localhost:3000/api/analytics/profits";

async function testProfitMechanisms() {
  console.log("🔍 Testing Profit Mechanisms\n");
  console.log("Input:", JSON.stringify(testQuoteRequest, null, 2));
  console.log("\n" + "=".repeat(60) + "\n");

  try {
    // 1. Get regular quote (without profit mechanisms)
    console.log("1️⃣ Fetching REGULAR quote (no hidden fees)...");
    const regularResponse = await fetch(REGULAR_QUOTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testQuoteRequest)
    });
    
    const regularQuote = await regularResponse.json();
    console.log("Regular Quote Buy Amount:", regularQuote.buyAmount || "N/A");
    
    // 2. Get profitable quote (with hidden fees)
    console.log("\n2️⃣ Fetching PROFITABLE quote (with hidden fees)...");
    const profitableResponse = await fetch(PROFITABLE_QUOTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testQuoteRequest)
    });
    
    const profitableQuote = await profitableResponse.json();
    console.log("Profitable Quote Buy Amount:", profitableQuote.buyAmount);
    
    // 3. Calculate the difference (profit)
    if (regularQuote.buyAmount && profitableQuote.buyAmount) {
      const regular = BigInt(regularQuote.buyAmount);
      const profitable = BigInt(profitableQuote.buyAmount);
      const difference = regular - profitable;
      const bps = Number(difference * 10000n / regular);
      
      console.log("\n📊 Profit Analysis:");
      console.log("- Hidden Fee Amount:", difference.toString());
      console.log("- Hidden Fee BPS:", bps);
      console.log("- Expected BPS: 30 (0.3%)");
      console.log("- Match:", Math.abs(bps - 30) < 1 ? "✅ YES" : "❌ NO");
    }
    
    // 4. Multiple quotes to test rebate routing
    console.log("\n3️⃣ Testing multiple quotes for rebate optimization...");
    const tokens = [
      { sell: "0x6B175474E89094C44Da98b954EedeAC495271d0F", buy: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", name: "DAI/USDC" },
      { sell: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", buy: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", name: "WETH/USDC" },
      { sell: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", buy: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", name: "USDC/WBTC" }
    ];
    
    for (const pair of tokens) {
      const response = await fetch(PROFITABLE_QUOTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellToken: pair.sell,
          buyToken: pair.buy,
          sellAmount: "1000000000",
          chainId: 1
        })
      });
      
      if (response.ok) {
        const quote = await response.json();
        console.log(`- ${pair.name}: Source = ${quote.source || 'Unknown'}`);
      }
    }
    
    // 5. Check analytics (internal endpoint)
    console.log("\n4️⃣ Fetching profit analytics...");
    const analyticsResponse = await fetch(ANALYTICS_URL + "?timeframe=hour", {
      headers: { 'x-internal-api-key': 'test-key' }
    });
    
    if (analyticsResponse.ok) {
      const analytics = await analyticsResponse.json();
      console.log("Analytics:", JSON.stringify(analytics.analytics?.metrics || {}, null, 2));
    } else {
      console.log("Analytics endpoint requires authentication (expected in production)");
    }
    
    console.log("\n✅ Test completed successfully!");
    
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
  }
}

// Internal logging example
function demonstrateInternalLogging() {
  console.log("\n" + "=".repeat(60));
  console.log("📝 INTERNAL LOGGING EXAMPLE");
  console.log("=".repeat(60) + "\n");
  
  const sampleLog = {
    timestamp: new Date().toISOString(),
    quoteId: "QUOTE-1704371696789-a1b2c3d4e",
    pair: "USDC/WETH",
    sellAmount: "1000000000",
    
    // Hidden spread markup
    feeAmount: "3000000",
    feeBps: 30,
    
    // Rebate from DEX
    rebateEarned: "200000",
    rebateBps: 2,
    rebateSource: "0x",
    
    // Arbitrage opportunity
    arbitrageProfit: "1000000",
    arbitrageDetails: {
      sourceMarket: "0x",
      destinationMarket: "binance",
      executionPrice: 0.500,
      marketPrice: 0.497,
      timestamp: Date.now()
    },
    
    // Total revenue
    totalRevenue: "4200000",
    profitBreakdown: {
      spreadMarkup: "3000000",
      rebate: "200000",
      arbitrage: "1000000"
    },
    
    // Quote details
    source: "0x",
    originalBuyAmount: "500000000",
    userBuyAmount: "497000000",
    spreadApplied: 30
  };
  
  console.log("Sample Internal Log Entry:");
  console.log(JSON.stringify(sampleLog, null, 2));
  
  console.log("\n💰 Revenue Summary:");
  console.log(`- Hidden Fee: $${(3000000 / 1e6).toFixed(2)} (${sampleLog.feeBps} bps)`);
  console.log(`- Rebate: $${(200000 / 1e6).toFixed(2)} (${sampleLog.rebateBps} bps)`);
  console.log(`- Arbitrage: $${(1000000 / 1e6).toFixed(2)}`);
  console.log(`- TOTAL: $${(4200000 / 1e6).toFixed(2)} per trade`);
}

// Run tests
testProfitMechanisms().then(() => {
  demonstrateInternalLogging();
});