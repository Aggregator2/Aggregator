// Register TypeScript support
require("./register");

// For now, use regular MatchingEngine until we fix all type issues
const { MatchingEngine } = require("./MatchingEngine");
// const { DatabaseMatchingEngine } = require("./DatabaseMatchingEngine");
// const { db } = require("../database/config");

// Configuration for the matching engine
const matchingEngineConfig = {
  maxOrderBookDepth: 100,
  minOrderSize: {
    'ETH/USDC': 0.001,
    'ETH/USDT': 0.001,
    'WBTC/USDC': 0.00001,
    'WBTC/USDT': 0.00001,
  },
  maxOrderSize: {
    'ETH/USDC': 1000,
    'ETH/USDT': 1000,
    'WBTC/USDC': 100,
    'WBTC/USDT': 100,
  },
  tickSize: {
    'ETH/USDC': 0.01,
    'ETH/USDT': 0.01,
    'WBTC/USDC': 0.01,
    'WBTC/USDT': 0.01,
  },
  makerFeeRate: 0.001, // 0.1%
  takerFeeRate: 0.002, // 0.2%
  enableStopOrders: false,
  enableIcebergOrders: false,
};

// Token address to symbol mapping
const tokenToSymbol = {
  '0x5fbdb2315678afecb367f032d93f642f64180aa3': 'ETH',
  '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512': 'USDC',
  '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0': 'USDT',
  '0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9': 'WBTC',
  // Add more token mappings as needed
};

// Create a singleton instance
let matchingEngine = null;

function getMatchingEngine() {
  if (!matchingEngine) {
    matchingEngine = new MatchingEngine(matchingEngineConfig);
    
    // Initialize common trading pairs
    matchingEngine.initializePair('ETH/USDC', 0.01);
    matchingEngine.initializePair('ETH/USDT', 0.01);
    matchingEngine.initializePair('WBTC/USDC', 0.01);
    matchingEngine.initializePair('WBTC/USDT', 0.01);
    
    console.log("🚀 Matching engine initialized with pairs:", matchingEngine.getTradingPairs());
  }
  return matchingEngine;
}

// Reset function for testing
function resetMatchingEngine() {
  if (matchingEngine) {
    // Clear the existing engine if it has a clear method
    if (typeof matchingEngine.clear === 'function') {
      matchingEngine.clear();
    }
    matchingEngine = null;
  }
}

// Export using CommonJS
module.exports = {
  getMatchingEngine,
  resetMatchingEngine,
  tokenToSymbol
};