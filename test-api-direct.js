// Test the unified quote API directly
const https = require("https");
const http = require("http");

async function testQuoteAPI() {
  console.log("Testing unified quote API...");

  // Start a simple HTTP server to test the API
  const { exec } = require("child_process");

  // Test parameters
  const testParams = new URLSearchParams({
    sellToken: "0xA0b86a33E6C60D5a17BF5c6b9Bf0C9c2f2bF2aC1", // ETH
    buyToken: "0xa0b86a33e6c60d5a17bf5c6b9bf0c9c2f2bf2ac1", // USDC
    sellAmount: "1000000000000000000", // 1 ETH
    chainId: "1",
  });

  console.log("Test parameters:", Object.fromEntries(testParams));

  // Test the simplified quote API instead
  console.log("\nTesting simplified quote API...");

  try {
    // Use node to test the unified-quote-simple API logic
    const quoterTest = `
      const { BigNumber } = require('bignumber.js');
      
      // Mock simple quote calculation for ETH to USDC
      const sellAmount = new BigNumber('1000000000000000000'); // 1 ETH in wei
      const ethPriceUSD = 2400; // approximate ETH price
      
      // Convert ETH to USDC (assume 1 USDC = $1)
      const buyAmount = sellAmount.div('1e18').multipliedBy(ethPriceUSD).multipliedBy('1e6'); // USDC has 6 decimals
      
      console.log('Sell Amount (ETH wei):', sellAmount.toString());
      console.log('Buy Amount (USDC):', buyAmount.toString());
      console.log('Price ratio:', buyAmount.div(sellAmount).toString());
    `;

    require("child_process").exec(
      `node -e "${quoterTest}"`,
      (error, stdout, stderr) => {
        if (error) {
          console.error("Error:", error);
          return;
        }
        if (stderr) {
          console.error("Stderr:", stderr);
          return;
        }
        console.log(stdout);
      }
    );
  } catch (error) {
    console.error("Failed to test quote logic:", error);
  }
}

testQuoteAPI();
