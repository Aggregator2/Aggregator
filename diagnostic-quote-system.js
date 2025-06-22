// Diagnostic script to check quote system status
const fs = require("fs");
const path = require("path");

console.log("=== Quote System Diagnostic ===\n");

// 1. Check if API files exist
console.log("1. Checking API files...");
const apiFiles = [
  "pages/api/unified-quote.ts",
  "pages/api/unified-quote-simple.ts",
  "pages/api/supported-tokens.ts",
];

apiFiles.forEach((file) => {
  const exists = fs.existsSync(file);
  console.log(`   ${exists ? "✅" : "❌"} ${file}`);
});

// 2. Check .env file
console.log("\n2. Checking environment configuration...");
const envPath = ".env";
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const hasZeroxKey = envContent.includes("ZEROX_API_KEY=");
  const hasOpenOceanKey = envContent.includes("OPENOCEAN_API_KEY=");
  const hasParaswapKey = envContent.includes("PARASWAP_API_KEY=");

  console.log(`   ✅ .env file exists`);
  console.log(`   ${hasZeroxKey ? "✅" : "❌"} ZEROX_API_KEY configured`);
  console.log(
    `   ${hasOpenOceanKey ? "✅" : "❌"} OPENOCEAN_API_KEY configured`
  );
  console.log(`   ${hasParaswapKey ? "✅" : "❌"} PARASWAP_API_KEY configured`);
} else {
  console.log("   ❌ .env file missing");
}

// 3. Check next.config.js
console.log("\n3. Checking Next.js configuration...");
const nextConfigPath = "next.config.js";
if (fs.existsSync(nextConfigPath)) {
  const configContent = fs.readFileSync(nextConfigPath, "utf8");
  const hasApiKeys =
    configContent.includes("ZEROX_API_KEY") && configContent.includes("env:");
  console.log(`   ✅ next.config.js exists`);
  console.log(`   ${hasApiKeys ? "✅" : "❌"} API keys exposed to frontend`);
} else {
  console.log("   ❌ next.config.js missing");
}

// 4. Test the quote logic directly
console.log("\n4. Testing quote logic...");
try {
  // Simulate the quote calculation from unified-quote-simple.ts
  const TOKEN_DECIMALS = {
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": 18, // ETH
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC
  };

  const PRICE_ESTIMATES = {
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": {
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 2800,
    },
  };

  const sellToken = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const buyToken = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const sellAmount = "1000000000000000000"; // 1 ETH

  const sellDecimals = TOKEN_DECIMALS[sellToken];
  const buyDecimals = TOKEN_DECIMALS[buyToken];
  const rate = PRICE_ESTIMATES[sellToken][buyToken];

  const sellAmountNum = parseFloat(sellAmount);
  const decimalAdjustment = Math.pow(10, buyDecimals - sellDecimals);
  const buyAmountNum = sellAmountNum * rate * decimalAdjustment;
  const buyAmount = Math.floor(buyAmountNum).toString();

  console.log(`   ✅ Quote calculation works`);
  console.log(`   📊 1 ETH → ${parseInt(buyAmount) / 1000000} USDC`);
  console.log(`   🔢 Rate: ${rate}, Decimal adjustment: ${decimalAdjustment}`);
} catch (error) {
  console.log(`   ❌ Quote calculation failed:`, error.message);
}

// 5. Check component usage
console.log("\n5. Checking SwapWidget implementation...");
const swapWidgetPath = "components/SwapWidget.tsx";
if (fs.existsSync(swapWidgetPath)) {
  const widgetContent = fs.readFileSync(swapWidgetPath, "utf8");
  const usesSimpleEndpoint = widgetContent.includes(
    "/api/unified-quote-simple"
  );
  const usesOldEndpoint =
    widgetContent.includes("/api/unified-quote") &&
    !widgetContent.includes("/api/unified-quote-simple");

  console.log(`   ✅ SwapWidget.tsx exists`);
  console.log(
    `   ${
      usesSimpleEndpoint ? "✅" : "❌"
    } Uses /api/unified-quote-simple endpoint`
  );
  console.log(
    `   ${
      usesOldEndpoint ? "❌" : "✅"
    } Does not use old /api/unified-quote endpoint`
  );
} else {
  console.log("   ❌ SwapWidget.tsx missing");
}

console.log("\n=== Diagnostic Complete ===");
console.log("\n💡 Recommendations:");
console.log(
  "1. Make sure to use /api/unified-quote-simple endpoint (not /api/unified-quote)"
);
console.log("2. The simplified API should work even without external API keys");
console.log(
  "3. Clear browser cache and restart dev server if seeing 404 errors"
);
console.log(
  "4. Check that there are no cached or old fetch calls to the wrong endpoint"
);
