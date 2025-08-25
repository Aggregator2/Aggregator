#!/usr/bin/env node
import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise(resolve => rl.question(query, resolve));

console.log("\n=== Safe Revenue Testing Setup ===\n");

async function setupSafeTest() {
  // Load current configuration
  dotenv.config();
  
  const currentRevenueWallet = process.env.REVENUE_WALLET || "";
  
  console.log("Current Configuration:");
  console.log(`Revenue Wallet: ${currentRevenueWallet || "Not set"}`);
  console.log(`Private Key: ${process.env.REVENUE_PRIVATE_KEY ? "✓ Set" : "✗ Not set"}`);
  console.log("\n");

  // Option 1: Use existing wallet
  if (currentRevenueWallet) {
    console.log("Your revenue wallet is already configured:");
    console.log(`Address: ${currentRevenueWallet}`);
    console.log("\nFor testing, you need a private key for the fee collection wallet.");
    console.log("This wallet will collect fees and send them to your revenue wallet.\n");
    
    const useTestWallet = await question("Generate a test fee collection wallet? (y/n): ");
    
    if (useTestWallet.toLowerCase() === 'y') {
      // Generate test collection wallet
      const testWallet = ethers.Wallet.createRandom();
      
      console.log("\n✅ Generated test fee collection wallet:");
      console.log(`Address: ${testWallet.address}`);
      console.log(`Private Key: ${testWallet.privateKey}`);
      
      // Update only the private key
      updateEnvFile('REVENUE_PRIVATE_KEY', testWallet.privateKey);
      
      console.log("\n⚠️  IMPORTANT STEPS FOR TESTING:");
      console.log("1. Fund the test wallet with a small amount of ETH for gas");
      console.log(`   Send ETH to: ${testWallet.address}`);
      console.log("2. The system will collect fees in this wallet");
      console.log(`3. When threshold is reached, fees transfer to: ${currentRevenueWallet}`);
    }
  } else {
    // No wallet configured - full setup
    console.log("No revenue wallet configured. Let's set it up:\n");
    
    const choice = await question(
      "Choose an option:\n" +
      "1. Enter your existing wallet address (recommended)\n" +
      "2. Generate new test wallets\n" +
      "Choice (1 or 2): "
    );
    
    if (choice === '1') {
      const userWallet = await question("\nEnter your wallet address (0x...): ");
      
      if (!ethers.isAddress(userWallet)) {
        console.log("❌ Invalid wallet address");
        rl.close();
        return;
      }
      
      // Generate test collection wallet
      const testWallet = ethers.Wallet.createRandom();
      
      console.log("\n✅ Configuration created:");
      console.log(`Your revenue wallet: ${userWallet}`);
      console.log(`Test collection wallet: ${testWallet.address}`);
      
      updateEnvFile('REVENUE_WALLET', userWallet);
      updateEnvFile('REVENUE_PRIVATE_KEY', testWallet.privateKey);
      
      console.log("\n⚠️  IMPORTANT: Fund the test collection wallet with ETH for gas");
      console.log(`Send a small amount to: ${testWallet.address}`);
    } else {
      // Generate both wallets
      const collectionWallet = ethers.Wallet.createRandom();
      const revenueWallet = ethers.Wallet.createRandom();
      
      console.log("\n✅ Generated test wallets:");
      console.log("\nFee Collection Wallet:");
      console.log(`Address: ${collectionWallet.address}`);
      console.log(`Private Key: ${collectionWallet.privateKey}`);
      
      console.log("\nRevenue Destination Wallet:");
      console.log(`Address: ${revenueWallet.address}`);
      console.log(`Private Key: ${revenueWallet.privateKey}`);
      
      updateEnvFile('REVENUE_WALLET', revenueWallet.address);
      updateEnvFile('REVENUE_PRIVATE_KEY', collectionWallet.privateKey);
    }
  }
  
  // Add admin key if not set
  if (!process.env.ADMIN_API_KEY) {
    const adminKey = `admin-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    updateEnvFile('ADMIN_API_KEY', adminKey);
    console.log(`\n✅ Generated admin API key: ${adminKey}`);
  }
  
  console.log("\n=== Next Steps ===\n");
  console.log("1. Lower the transfer threshold for testing:");
  console.log("   Edit /workspace/src/services/revenueAccumulator.ts");
  console.log("   Change: private transferThresholdUSD: number = 0.5;");
  console.log("");
  console.log("2. Run the simulation:");
  console.log("   node scripts/test-revenue-system.js");
  console.log("");
  console.log("3. Monitor your wallet:");
  console.log("   node scripts/monitor-revenue-wallet.js");
  console.log("");
  console.log("4. View the dashboard:");
  console.log("   http://localhost:3000/revenue-dashboard.html");
  console.log("");
  
  if (currentRevenueWallet) {
    console.log(`Your revenue will be sent to: ${currentRevenueWallet}`);
  }
  
  rl.close();
}

function updateEnvFile(key, value) {
  const envPath = '.env';
  let envContent = '';
  
  try {
    envContent = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    // File doesn't exist, create it
  }
  
  // Check if key exists
  const regex = new RegExp(`^${key}=.*$`, 'm');
  
  if (regex.test(envContent)) {
    // Update existing key
    envContent = envContent.replace(regex, `${key}=${value}`);
  } else {
    // Add new key
    envContent += `\n${key}=${value}`;
  }
  
  fs.writeFileSync(envPath, envContent);
}

// Run the setup
setupSafeTest().catch(error => {
  console.error("Setup failed:", error);
  rl.close();
  process.exit(1);
});