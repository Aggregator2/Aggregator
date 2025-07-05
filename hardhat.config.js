require('dotenv').config();
require("@nomicfoundation/hardhat-toolbox");

// Hardhat test accounts for local development
// These are publicly known test accounts - DO NOT use for production!
const TEST_ACCOUNTS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // Account #0
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // Account #1
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // Account #2
];

// Function to get accounts based on environment
function getAccounts() {
  // For local development, use Hardhat test accounts
  if (!process.env.PRIVATE_KEY) {
    console.log("⚠️  No PRIVATE_KEY found in .env - using Hardhat test accounts for development");
    return TEST_ACCOUNTS;
  }
  
  // For production/testnet, use environment variable
  return [process.env.PRIVATE_KEY];
}

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.8",     // for Escrow.sol
      },
      {
        version: "0.8.28",    // for Lock.sol
      }
    ]
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts",
    cache: "./cache",
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545/",
      chainId: 31337
    },
    goerli: {
      url: process.env.API_URL || "",
      accounts: getAccounts(),
      chainId: 5
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: getAccounts(),
      chainId: 11155111
    }
  },
 
} 