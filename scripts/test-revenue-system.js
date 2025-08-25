#!/usr/bin/env node
import { getRevenueAccumulator } from "../src/services/revenueAccumulator.ts";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

console.log("\n=== Revenue System Test ===\n");

// Verify configuration
if (!process.env.REVENUE_WALLET) {
  console.error("❌ REVENUE_WALLET not configured in .env");
  console.log("\nPlease add to your .env file:");
  console.log("REVENUE_WALLET=your_wallet_address_here");
  process.exit(1);
}

if (!process.env.REVENUE_PRIVATE_KEY) {
  console.error("❌ REVENUE_PRIVATE_KEY not configured in .env");
  console.log("\nPlease add to your .env file:");
  console.log("REVENUE_PRIVATE_KEY=your_private_key_here");
  console.log("\nFor testing, you can use a test wallet private key.");
  process.exit(1);
}

console.log("✅ Revenue wallet configured:", process.env.REVENUE_WALLET);
console.log("\n=== Simulating Fee Collections ===\n");

async function simulateFeeCollections() {
  try {
    const revenueAccumulator = getRevenueAccumulator();
    
    // Get initial state
    const initialState = revenueAccumulator.getState();
    console.log(`Initial revenue: $${initialState.totalRevenueUSD.toFixed(2)}`);
    console.log(`Initial fee count: ${initialState.collectedFees.length}`);
    console.log("\n--- Simulating fee collections ---\n");
    
    // Simulate various fee collections
    const feeScenarios = [
      {
        name: "ETH Swap Fee",
        feeAmount: "1000000000000000", // 0.001 ETH
        feeToken: "ETH",
        tokenUsdPrice: 2000,
        chainId: 1
      },
      {
        name: "USDC Swap Fee", 
        feeAmount: "5000000", // 5 USDC (6 decimals)
        feeToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        tokenUsdPrice: 1,
        chainId: 1
      },
      {
        name: "Large ETH Fee",
        feeAmount: "10000000000000000", // 0.01 ETH
        feeToken: "ETH",
        tokenUsdPrice: 2000,
        chainId: 1
      },
      {
        name: "Arbitrum ETH Fee",
        feeAmount: "500000000000000", // 0.0005 ETH
        feeToken: "ETH", 
        tokenUsdPrice: 2000,
        chainId: 42161
      }
    ];
    
    let totalUsdValue = 0;
    
    for (const scenario of feeScenarios) {
      console.log(`Collecting ${scenario.name}...`);
      
      await revenueAccumulator.addFeeCollection({
        feeAmount: scenario.feeAmount,
        feeToken: scenario.feeToken,
        tokenUsdPrice: scenario.tokenUsdPrice,
        timestamp: Date.now(),
        chainId: scenario.chainId
      });
      
      // Calculate USD value for display
      const decimals = scenario.feeToken === "ETH" ? 18 : 6;
      const amount = parseFloat(scenario.feeAmount) / Math.pow(10, decimals);
      const usdValue = amount * scenario.tokenUsdPrice;
      totalUsdValue += usdValue;
      
      console.log(`  ✓ Amount: ${amount} ${scenario.feeToken === "ETH" ? "ETH" : "USDC"}`);
      console.log(`  ✓ USD Value: $${usdValue.toFixed(2)}`);
      console.log(`  ✓ Running Total: $${totalUsdValue.toFixed(2)}\n`);
      
      // Small delay between collections
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Get final state
    const finalState = revenueAccumulator.getState();
    console.log("\n=== Final State ===");
    console.log(`Total revenue accumulated: $${finalState.totalRevenueUSD.toFixed(2)}`);
    console.log(`Total fees collected: ${finalState.collectedFees.length}`);
    console.log(`Transfer threshold: $50.00`);
    
    if (finalState.totalRevenueUSD >= 50) {
      console.log("\n🎉 Threshold reached! Transfer should trigger automatically.");
      console.log("Check your revenue wallet for incoming transactions.");
    } else {
      const remaining = 50 - finalState.totalRevenueUSD;
      console.log(`\n💡 Need $${remaining.toFixed(2)} more to trigger automatic transfer.`);
      console.log("\nYou can:");
      console.log("1. Run this test again to add more fees");
      console.log("2. Force a manual transfer via the dashboard");
      console.log("3. Wait for real fee collections from your platform");
    }
    
    // Show how to force transfer
    console.log("\n=== Manual Transfer Option ===");
    console.log("To force a transfer now (regardless of threshold):");
    console.log("1. Open http://localhost:3000/revenue-dashboard.html");
    console.log("2. Click 'Force Transfer' button");
    console.log("3. Enter your admin API key\n");
    
  } catch (error) {
    console.error("\n❌ Error during test:", error.message);
    
    if (error.message.includes("REVENUE_PRIVATE_KEY")) {
      console.log("\n💡 Tip: Make sure REVENUE_PRIVATE_KEY is set in your .env file");
    }
  }
}

// Run the simulation
simulateFeeCollections().then(() => {
  console.log("\n=== Test Complete ===");
  console.log("\nNext steps:");
  console.log("1. Monitor your wallet: node scripts/monitor-revenue-wallet.js");
  console.log("2. View dashboard: http://localhost:3000/revenue-dashboard.html");
  console.log("3. Check event logs: node scripts/revenue-event-listener.js\n");
}).catch(error => {
  console.error("Test failed:", error);
  process.exit(1);
});