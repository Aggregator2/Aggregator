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
    },
    mainnet: {
      url: process.env.MAINNET_RPC_URL || "",
      accounts: getAccounts(),
      chainId: 1
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts: getAccounts(),
      chainId: 42161
    },
    arbitrumGoerli: {
      url: process.env.ARBITRUM_GOERLI_RPC_URL || "https://goerli-rollup.arbitrum.io/rpc",
      accounts: getAccounts(),
      chainId: 421613
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      accounts: getAccounts(),
      chainId: 137
    },
    polygonMumbai: {
      url: process.env.POLYGON_MUMBAI_RPC_URL || "https://rpc-mumbai.maticvigil.com",
      accounts: getAccounts(),
      chainId: 80001
    },
    optimism: {
      url: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
      accounts: getAccounts(),
      chainId: 10
    },
    optimismGoerli: {
      url: process.env.OPTIMISM_GOERLI_RPC_URL || "https://goerli.optimism.io",
      accounts: getAccounts(),
      chainId: 420
    }
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      goerli: process.env.ETHERSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
      arbitrumGoerli: process.env.ARBISCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISM_API_KEY || "",
      optimisticGoerli: process.env.OPTIMISM_API_KEY || ""
    }
  },
 
} 