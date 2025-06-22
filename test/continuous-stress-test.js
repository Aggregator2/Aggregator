/**
 * Continuous Stress Testing
 * Runs non-stop tests with random combinations until stopped
 */

const fetch = require('node-fetch');
const { ethers } = require('ethers');

// Configuration
const API_BASE = 'http://localhost:3000';
const TEST_DURATION = 60000; // Run for 60 seconds
const CONCURRENT_REQUESTS = 5;

// All supported chains and tokens
const CHAIN_TOKENS = {
  1: { // Ethereum
    tokens: ['ETH', 'WETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'LINK', 'UNI', 'AAVE'],
    addresses: {
      ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
      UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
      AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
    }
  },
  56: { // BSC
    tokens: ['BNB', 'WBNB', 'USDC', 'USDT', 'BUSD', 'CAKE', 'XRP'],
    addresses: {
      BNB: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      USDT: '0x55d398326f99059fF775485246999027B3197955',
      BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
      CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      XRP: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE',
    }
  },
  137: { // Polygon
    tokens: ['MATIC', 'WMATIC', 'USDC', 'USDT', 'DAI', 'WETH'],
    addresses: {
      MATIC: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    }
  },
  42161: { // Arbitrum
    tokens: ['ETH', 'WETH', 'USDC', 'USDT', 'DAI', 'ARB'],
    addresses: {
      ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      USDC: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    }
  },
  10: { // Optimism
    tokens: ['ETH', 'WETH', 'USDC', 'USDT', 'DAI', 'OP'],
    addresses: {
      ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      WETH: '0x4200000000000000000000000000000000000006',
      USDC: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      OP: '0x4200000000000000000000000000000000000042',
    }
  },
  101: { // Solana
    tokens: ['SOL', 'USDC', 'USDT', 'RAY', 'SRM'],
    addresses: {
      SOL: 'So11111111111111111111111111111111111111112',
      USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      SRM: 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt',
    }
  },
};

// Statistics tracking
const stats = {
  totalRequests: 0,
  successfulQuotes: 0,
  failedQuotes: 0,
  crossChainAttempts: 0,
  crossChainSuccess: 0,
  avgResponseTime: 0,
  responseTimes: [],
  errorTypes: {},
  routeSources: {},
  tokenPairFrequency: {},
};

/**
 * Generate random test parameters
 */
function generateRandomTest() {
  const chains = Object.keys(CHAIN_TOKENS).map(Number);
  const isCrossChain = Math.random() > 0.7; // 30% cross-chain
  
  if (isCrossChain) {
    const fromChain = chains[Math.floor(Math.random() * chains.length)];
    let toChain = chains[Math.floor(Math.random() * chains.length)];
    while (toChain === fromChain) {
      toChain = chains[Math.floor(Math.random() * chains.length)];
    }
    
    const fromTokens = CHAIN_TOKENS[fromChain].tokens;
    const toTokens = CHAIN_TOKENS[toChain].tokens;
    
    return {
      type: 'cross-chain',
      fromChain,
      toChain,
      fromToken: fromTokens[Math.floor(Math.random() * fromTokens.length)],
      toToken: toTokens[Math.floor(Math.random() * toTokens.length)],
      amount: (Math.random() * 10 + 0.1).toFixed(4),
    };
  } else {
    const chain = chains[Math.floor(Math.random() * chains.length)];
    const tokens = CHAIN_TOKENS[chain].tokens;
    const fromToken = tokens[Math.floor(Math.random() * tokens.length)];
    let toToken = tokens[Math.floor(Math.random() * tokens.length)];
    while (toToken === fromToken) {
      toToken = tokens[Math.floor(Math.random() * tokens.length)];
    }
    
    return {
      type: 'same-chain',
      chain,
      fromToken,
      toToken,
      amount: (Math.random() * 100 + 0.01).toFixed(4),
    };
  }
}

/**
 * Execute a single test
 */
async function executeTest(testParams) {
  const startTime = Date.now();
  stats.totalRequests++;
  
  try {
    let result;
    
    if (testParams.type === 'cross-chain') {
      stats.crossChainAttempts++;
      result = await testCrossChainSwap(testParams);
    } else {
      result = await testSameChainSwap(testParams);
    }
    
    const responseTime = Date.now() - startTime;
    stats.responseTimes.push(responseTime);
    
    if (result.success) {
      stats.successfulQuotes++;
      
      // Track route source
      if (result.source) {
        stats.routeSources[result.source] = (stats.routeSources[result.source] || 0) + 1;
      }
      
      // Track token pair
      const pair = `${testParams.fromToken || testParams.fromChain}→${testParams.toToken || testParams.toChain}`;
      stats.tokenPairFrequency[pair] = (stats.tokenPairFrequency[pair] || 0) + 1;
      
      if (testParams.type === 'cross-chain' && result.success) {
        stats.crossChainSuccess++;
      }
      
      // Log successful quote details
      if (Math.random() < 0.1) { // Log 10% of successful quotes
        console.log(`✅ ${pair} | ${testParams.amount} | ${responseTime}ms | Source: ${result.source}`);
      }
    } else {
      stats.failedQuotes++;
      stats.errorTypes[result.error] = (stats.errorTypes[result.error] || 0) + 1;
      
      // Log errors
      console.log(`❌ ${testParams.fromToken}→${testParams.toToken} | Error: ${result.error}`);
    }
    
  } catch (error) {
    stats.failedQuotes++;
    stats.errorTypes['Network Error'] = (stats.errorTypes['Network Error'] || 0) + 1;
    console.error(`💥 Critical error: ${error.message}`);
  }
}

/**
 * Test same-chain swap
 */
async function testSameChainSwap(params) {
  try {
    const sellToken = CHAIN_TOKENS[params.chain].addresses[params.fromToken];
    const buyToken = CHAIN_TOKENS[params.chain].addresses[params.toToken];
    const decimals = params.fromToken.includes('USD') ? 6 : 18;
    const sellAmount = ethers.parseUnits(params.amount, decimals).toString();
    
    const response = await fetch(`${API_BASE}/api/quote-profitable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellToken,
        buyToken,
        sellAmount,
        chainId: params.chain,
      }),
      timeout: 10000,
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      return { success: false, error: error.error || response.statusText };
    }
    
    const quote = await response.json();
    return {
      success: true,
      source: quote.source,
      buyAmount: quote.buyAmount,
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Test cross-chain swap
 */
async function testCrossChainSwap(params) {
  try {
    const fromToken = CHAIN_TOKENS[params.fromChain].addresses[params.fromToken];
    const toToken = CHAIN_TOKENS[params.toChain].addresses[params.toToken];
    const decimals = params.fromToken.includes('USD') ? 6 : 18;
    const amount = ethers.parseUnits(params.amount, decimals).toString();
    
    const response = await fetch(`${API_BASE}/api/crosschain/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromToken,
        toToken,
        amount,
        fromChain: params.fromChain,
        toChain: params.toChain,
      }),
      timeout: 15000,
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      return { success: false, error: error.error || response.statusText };
    }
    
    const result = await response.json();
    return {
      success: true,
      source: result.route?.bridges?.[0] || 'Unknown',
      estimatedOutput: result.estimatedOutput,
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Run continuous stress test
 */
async function runContinuousStressTest() {
  console.log('🚀 Starting Continuous Stress Test');
  console.log(`Duration: ${TEST_DURATION / 1000} seconds`);
  console.log(`Concurrent Requests: ${CONCURRENT_REQUESTS}`);
  console.log('Press Ctrl+C to stop\n');
  
  const startTime = Date.now();
  let running = true;
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nStopping test...');
    running = false;
  });
  
  // Run tests in parallel
  const workers = Array(CONCURRENT_REQUESTS).fill(null).map(async () => {
    while (running && Date.now() - startTime < TEST_DURATION) {
      const testParams = generateRandomTest();
      await executeTest(testParams);
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });
  
  // Wait for all workers to complete
  await Promise.all(workers);
  
  // Calculate final statistics
  stats.avgResponseTime = stats.responseTimes.length > 0
    ? stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length
    : 0;
  
  // Print results
  printStressTestResults();
}

/**
 * Print stress test results
 */
function printStressTestResults() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 STRESS TEST RESULTS\n');
  
  console.log('Overall Statistics:');
  console.log(`  Total Requests: ${stats.totalRequests}`);
  console.log(`  Successful: ${stats.successfulQuotes} (${(stats.successfulQuotes / stats.totalRequests * 100).toFixed(1)}%)`);
  console.log(`  Failed: ${stats.failedQuotes} (${(stats.failedQuotes / stats.totalRequests * 100).toFixed(1)}%)`);
  console.log(`  Avg Response Time: ${stats.avgResponseTime.toFixed(0)}ms`);
  
  console.log('\nCross-Chain Performance:');
  console.log(`  Attempts: ${stats.crossChainAttempts}`);
  console.log(`  Success: ${stats.crossChainSuccess} (${stats.crossChainAttempts > 0 ? (stats.crossChainSuccess / stats.crossChainAttempts * 100).toFixed(1) : 0}%)`);
  
  console.log('\nTop Route Sources:');
  Object.entries(stats.routeSources)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([source, count]) => {
      console.log(`  ${source}: ${count} (${(count / stats.successfulQuotes * 100).toFixed(1)}%)`);
    });
  
  console.log('\nTop Token Pairs:');
  Object.entries(stats.tokenPairFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([pair, count]) => {
      console.log(`  ${pair}: ${count} swaps`);
    });
  
  if (Object.keys(stats.errorTypes).length > 0) {
    console.log('\nError Types:');
    Object.entries(stats.errorTypes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([error, count]) => {
        console.log(`  ${error}: ${count}`);
      });
  }
  
  console.log('\nPerformance Percentiles:');
  if (stats.responseTimes.length > 0) {
    const sorted = [...stats.responseTimes].sort((a, b) => a - b);
    console.log(`  P50: ${sorted[Math.floor(sorted.length * 0.5)]}ms`);
    console.log(`  P90: ${sorted[Math.floor(sorted.length * 0.9)]}ms`);
    console.log(`  P95: ${sorted[Math.floor(sorted.length * 0.95)]}ms`);
    console.log(`  P99: ${sorted[Math.floor(sorted.length * 0.99)]}ms`);
  }
  
  console.log('\n' + '='.repeat(80));
  
  if (stats.failedQuotes / stats.totalRequests > 0.1) {
    console.log('⚠️ High failure rate detected! Review error logs.');
  } else {
    console.log('✅ System performed well under stress!');
  }
}

// Run the stress test
if (require.main === module) {
  runContinuousStressTest().catch(console.error);
}

module.exports = { runContinuousStressTest };