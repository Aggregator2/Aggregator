// Test the quote API with curl
const { exec } = require("child_process");

// Test data
const testQuote = {
  sellToken: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", // ETH
  buyToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  sellAmount: "1000000000000000000", // 1 ETH
  chainId: 1,
};

console.log("=== Testing Quote API ===");
console.log("Request data:", JSON.stringify(testQuote, null, 2));

// Start test server and test it
const server = require("./test-quote-server.js");

// Wait a moment then test
setTimeout(() => {
  const curlCommand = `curl -X POST http://localhost:3001/api/unified-quote-simple -H "Content-Type: application/json" -d '${JSON.stringify(
    testQuote
  )}'`;

  console.log("\nExecuting test...");
  exec(curlCommand, (error, stdout, stderr) => {
    if (error) {
      console.error("Error:", error);
      return;
    }
    if (stderr) {
      console.error("Stderr:", stderr);
      return;
    }

    console.log("\n=== API Response ===");
    try {
      const response = JSON.parse(stdout);
      console.log(JSON.stringify(response, null, 2));

      // Validate response
      if (response.buyAmount && response.source) {
        console.log("\n✅ API test successful!");
        console.log(
          `Converted 1 ETH to ${parseInt(response.buyAmount) / 1000000} USDC`
        );
      } else {
        console.log("\n❌ API test failed - invalid response");
      }
    } catch (e) {
      console.log("Raw response:", stdout);
    }

    process.exit(0);
  });
}, 2000);
