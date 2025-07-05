// Secure configuration helper for managing sensitive keys
require('dotenv').config();

// Hardhat test accounts for local development
const HARDHAT_TEST_ACCOUNTS = {
  account0: {
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  },
  account1: {
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  },
  account2: {
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
  }
};

// Get private key based on environment
function getPrivateKey() {
  // Check if we have a private key in environment
  if (process.env.PRIVATE_KEY) {
    return process.env.PRIVATE_KEY;
  }
  
  // For local development, use Hardhat test account
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    console.warn('⚠️  Using Hardhat test account for development. Never use in production!');
    return HARDHAT_TEST_ACCOUNTS.account0.privateKey;
  }
  
  // For production, private key MUST be provided via environment variable
  throw new Error('PRIVATE_KEY environment variable is required in production');
}

// Get revenue private key
function getRevenuePrivateKey() {
  // Check if we have a revenue private key in environment
  if (process.env.REVENUE_PRIVATE_KEY) {
    return process.env.REVENUE_PRIVATE_KEY;
  }
  
  // For local development, use a different Hardhat test account
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    console.warn('⚠️  Using Hardhat test account for revenue wallet. Never use in production!');
    return HARDHAT_TEST_ACCOUNTS.account1.privateKey;
  }
  
  // For production, revenue private key MUST be provided via environment variable
  throw new Error('REVENUE_PRIVATE_KEY environment variable is required in production');
}

// Security check to prevent accidental use of test keys in production
function validateSecurityConfig() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    // Ensure we're not using test keys in production
    const privateKey = process.env.PRIVATE_KEY;
    const revenueKey = process.env.REVENUE_PRIVATE_KEY;
    
    const testKeys = Object.values(HARDHAT_TEST_ACCOUNTS).map(acc => acc.privateKey);
    
    if (!privateKey || !revenueKey) {
      throw new Error('Private keys must be set via environment variables in production');
    }
    
    if (testKeys.includes(privateKey) || testKeys.includes(revenueKey)) {
      throw new Error('SECURITY ERROR: Test accounts detected in production environment!');
    }
  }
}

module.exports = {
  getPrivateKey,
  getRevenuePrivateKey,
  validateSecurityConfig,
  HARDHAT_TEST_ACCOUNTS
};