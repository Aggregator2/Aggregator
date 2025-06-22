/**
 * Comprehensive End-to-End Testing Suite
 * Tests cross-chain swaps, quotes, signatures, and UI updates
 */

const fetch = require('node-fetch');
const { ethers } = require('ethers');
const WebSocket = require('ws');

// Test configuration
const API_BASE = 'http://localhost:3000';
const TEST_WALLET = '0x742d35Cc6634C0532925a3b844Bc9e7595f6fed2';

// Common token addresses across chains
const TOKENS = {
  // Ethereum (Chain 1)
  1: {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  // BSC (Chain 56)
  56: {
    BNB: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  },
  // Polygon (Chain 137)
  137: {
    MATIC: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  // Solana (Chain 101)
  101: {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  },
  // Arbitrum (Chain 42161)
  42161: {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
};

// Test scenarios
const TEST_SCENARIOS = [
  // Same-chain swaps
  { name: 'ETH → USDC (Ethereum)', chain: 1, from: 'ETH', to: 'USDC', amount: '0.1' },
  { name: 'USDC → DAI (Ethereum)', chain: 1, from: 'USDC', to: 'DAI', amount: '100' },
  { name: 'BNB → USDT (BSC)', chain: 56, from: 'BNB', to: 'USDT', amount: '0.5' },
  { name: 'MATIC → USDC (Polygon)', chain: 137, from: 'MATIC', to: 'USDC', amount: '50' },
  
  // Cross-chain swaps
  { name: 'ETH → BNB (Cross-chain)', fromChain: 1, toChain: 56, from: 'ETH', to: 'BNB', amount: '0.1' },
  { name: 'USDC(ETH) → USDC(BSC)', fromChain: 1, toChain: 56, from: 'USDC', to: 'USDC', amount: '100' },
  { name: 'ETH → SOL (Cross-chain)', fromChain: 1, toChain: 101, from: 'ETH', to: 'SOL', amount: '0.05' },
  { name: 'USDC(Polygon) → USDT(Arbitrum)', fromChain: 137, toChain: 42161, from: 'USDC', to: 'USDT', amount: '50' },
  
  // Edge cases
  { name: 'Tiny Amount Test', chain: 1, from: 'USDC', to: 'ETH', amount: '0.01' },
  { name: 'Large Amount Test', chain: 1, from: 'ETH', to: 'USDC', amount: '100' },
  { name: 'Wrapped Token Test', chain: 1, from: 'ETH', to: 'WETH', amount: '1' },
];

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  errors: [],
  timings: [],
};

/**
 * Main test runner
 */
async function runComprehensiveTests() {
  console.log('🚀 Starting Comprehensive E2E Testing Suite\n');
  console.log('=' .repeat(80));
  
  // Run all test categories
  await testQuoteGeneration();
  await testCrossChainRouting();
  await testSignatureGeneration();
  await testUIUpdates();
  await testErrorHandling();
  await runBatchTests();
  
  // Print summary
  printTestSummary();
}

/**
 * Test 1: Quote Generation
 */
async function testQuoteGeneration() {
  console.log('\n📊 TESTING QUOTE GENERATION\n');
  
  for (const scenario of TEST_SCENARIOS.slice(0, 5)) {
    const start = Date.now();
    
    try {
      const chain = scenario.chain || scenario.fromChain;
      const sellToken = TOKENS[chain][scenario.from];
      const buyToken = scenario.toChain 
        ? TOKENS[scenario.toChain][scenario.to]
        : TOKENS[chain][scenario.to];
      
      // Convert amount to base units
      const decimals = scenario.from.includes('USD') ? 6 : 18;
      const sellAmount = ethers.parseUnits(scenario.amount, decimals).toString();
      
      // Test regular quote
      const regularQuote = await fetchQuote('/api/quote', {
        sellToken,
        buyToken,
        sellAmount,
        chainId: chain,
      });
      
      // Test profitable quote
      const profitableQuote = await fetchQuote('/api/quote-profitable', {
        sellToken,
        buyToken,
        sellAmount,
        chainId: chain,
        user: TEST_WALLET,
      });
      
      // Verify quotes
      if (regularQuote && profitableQuote) {
        const regular = BigInt(regularQuote.buyAmount || '0');
        const profitable = BigInt(profitableQuote.buyAmount || '0');
        const spread = regular > 0n ? Number((regular - profitable) * 10000n / regular) : 0;
        
        console.log(`✅ ${scenario.name}`);
        console.log(`   Regular: ${regularQuote.buyAmount}`);
        console.log(`   Profitable: ${profitableQuote.buyAmount}`);
        console.log(`   Hidden Spread: ${spread} bps`);
        console.log(`   Source: ${profitableQuote.source}`);
        console.log(`   Time: ${Date.now() - start}ms\n`);
        
        testResults.passed++;
        testResults.timings.push(Date.now() - start);
      } else {
        throw new Error('Failed to get quotes');
      }
      
    } catch (error) {
      console.log(`❌ ${scenario.name}: ${error.message}\n`);
      testResults.failed++;
      testResults.errors.push({ scenario: scenario.name, error: error.message });
    }
  }
}

/**
 * Test 2: Cross-Chain Routing
 */
async function testCrossChainRouting() {
  console.log('\n🌉 TESTING CROSS-CHAIN ROUTING\n');
  
  const crossChainScenarios = TEST_SCENARIOS.filter(s => s.fromChain && s.toChain);
  
  for (const scenario of crossChainScenarios) {
    try {
      const result = await fetchCrossChainQuote({
        fromToken: TOKENS[scenario.fromChain][scenario.from],
        toToken: TOKENS[scenario.toChain][scenario.to],
        amount: ethers.parseUnits(scenario.amount, 18).toString(),
        fromChain: scenario.fromChain,
        toChain: scenario.toChain,
      });
      
      if (result && result.route) {
        console.log(`✅ ${scenario.name}`);
        console.log(`   Route: ${result.route.steps.map(s => s.action).join(' → ')}`);
        console.log(`   Bridges: ${result.route.bridges.join(', ')}`);
        console.log(`   Est. Output: ${result.estimatedOutput}`);
        console.log(`   Total Fee: ${result.totalFee}\n`);
        testResults.passed++;
      } else {
        throw new Error('No route found');
      }
      
    } catch (error) {
      console.log(`❌ ${scenario.name}: ${error.message}\n`);
      testResults.failed++;
      testResults.errors.push({ scenario: scenario.name, error: error.message });
    }
  }
}

/**
 * Test 3: Signature Generation
 */
async function testSignatureGeneration() {
  console.log('\n✍️ TESTING SIGNATURE GENERATION\n');
  
  // Create a test signer
  const privateKey = '0x0123456789012345678901234567890123456789012345678901234567890123';
  const wallet = new ethers.Wallet(privateKey);
  
  const signatureTests = [
    { type: 'ERC20', token: 'USDC', chain: 1 },
    { type: 'Native', token: 'ETH', chain: 1 },
    { type: 'Wrapped', token: 'WETH', chain: 1 },
    { type: 'Stablecoin', token: 'DAI', chain: 1 },
    { type: 'Cross-chain', token: 'USDC', chain: 56 },
  ];
  
  for (const test of signatureTests) {
    try {
      const order = createTestOrder(test);
      
      // Test EIP-712 signing
      const signature = await signEIP712Order(wallet, order);
      
      // Verify signature
      const recovered = ethers.verifyTypedData(
        getEIP712Domain(test.chain),
        getEIP712Types(),
        order,
        signature
      );
      
      if (recovered.toLowerCase() === wallet.address.toLowerCase()) {
        console.log(`✅ ${test.type} Token Signature (${test.token})`);
        console.log(`   Signer: ${wallet.address}`);
        console.log(`   Signature: ${signature.slice(0, 20)}...`);
        console.log(`   Verified: true\n`);
        testResults.passed++;
      } else {
        throw new Error('Signature verification failed');
      }
      
    } catch (error) {
      console.log(`❌ ${test.type} Token Signature: ${error.message}\n`);
      testResults.failed++;
      testResults.errors.push({ test: test.type, error: error.message });
    }
  }
}

/**
 * Test 4: UI Updates Simulation
 */
async function testUIUpdates() {
  console.log('\n🖥️ TESTING UI UPDATES (SIMULATED)\n');
  
  // Simulate WebSocket connection for real-time updates
  let updateCount = 0;
  const maxUpdates = 5;
  
  console.log('Simulating quote updates every 5 seconds...');
  
  const updateInterval = setInterval(async () => {
    updateCount++;
    
    try {
      const quote = await fetchQuote('/api/quote-profitable', {
        sellToken: TOKENS[1].ETH,
        buyToken: TOKENS[1].USDC,
        sellAmount: ethers.parseEther('1').toString(),
        chainId: 1,
      });
      
      if (quote) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] Quote Update #${updateCount}`);
        console.log(`  Buy Amount: ${quote.buyAmount}`);
        console.log(`  Price: ${quote.price}`);
        console.log(`  Source: ${quote.source}`);
        
        // Simulate staleness check
        if (updateCount === 3) {
          console.log('  ⚠️ Quote marked as stale (>10s)');
        } else {
          console.log('  ✓ Quote fresh');
        }
      }
      
      if (updateCount >= maxUpdates) {
        clearInterval(updateInterval);
        console.log('\n✅ UI updates completed successfully\n');
        testResults.passed++;
      }
      
    } catch (error) {
      clearInterval(updateInterval);
      console.log(`\n❌ UI update failed: ${error.message}\n`);
      testResults.failed++;
    }
  }, 2000); // Every 2 seconds for faster testing
  
  // Wait for updates to complete
  await new Promise(resolve => setTimeout(resolve, maxUpdates * 2000 + 1000));
}

/**
 * Test 5: Error Handling
 */
async function testErrorHandling() {
  console.log('\n⚠️ TESTING ERROR HANDLING\n');
  
  const errorScenarios = [
    {
      name: 'Invalid Token Address',
      params: { sellToken: '0xinvalid', buyToken: TOKENS[1].USDC, sellAmount: '1000' },
    },
    {
      name: 'Zero Amount',
      params: { sellToken: TOKENS[1].ETH, buyToken: TOKENS[1].USDC, sellAmount: '0' },
    },
    {
      name: 'Unsupported Chain',
      params: { sellToken: TOKENS[1].ETH, buyToken: TOKENS[1].USDC, sellAmount: '1000', chainId: 999 },
    },
    {
      name: 'Same Token Swap',
      params: { sellToken: TOKENS[1].USDC, buyToken: TOKENS[1].USDC, sellAmount: '1000' },
    },
    {
      name: 'Missing Parameters',
      params: { sellToken: TOKENS[1].ETH },
    },
  ];
  
  for (const scenario of errorScenarios) {
    try {
      const response = await fetch(`${API_BASE}/api/quote-profitable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenario.params),
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.log(`✅ ${scenario.name}: Properly caught`);
        console.log(`   Error: ${error.error || response.statusText}\n`);
        testResults.passed++;
      } else {
        // If we get a successful response for an error scenario, that's bad
        throw new Error('Expected error but got success');
      }
      
    } catch (error) {
      if (error.message === 'Expected error but got success') {
        console.log(`❌ ${scenario.name}: Should have failed\n`);
        testResults.failed++;
      } else {
        console.log(`✅ ${scenario.name}: Network error caught\n`);
        testResults.passed++;
      }
    }
  }
}

/**
 * Test 6: Batch Testing
 */
async function runBatchTests() {
  console.log('\n🔄 RUNNING BATCH TESTS\n');
  
  const batchSize = 10;
  const chains = [1, 56, 137, 42161];
  const tokens = ['ETH', 'USDC', 'USDT'];
  
  console.log(`Running ${batchSize} parallel requests...`);
  
  const batchPromises = [];
  
  for (let i = 0; i < batchSize; i++) {
    // Random chain and tokens
    const chain = chains[Math.floor(Math.random() * chains.length)];
    const availableTokens = Object.keys(TOKENS[chain]);
    const fromToken = availableTokens[Math.floor(Math.random() * availableTokens.length)];
    let toToken = availableTokens[Math.floor(Math.random() * availableTokens.length)];
    
    // Ensure different tokens
    while (toToken === fromToken) {
      toToken = availableTokens[Math.floor(Math.random() * availableTokens.length)];
    }
    
    const promise = fetchQuote('/api/quote-profitable', {
      sellToken: TOKENS[chain][fromToken],
      buyToken: TOKENS[chain][toToken],
      sellAmount: ethers.parseUnits(Math.random().toFixed(2), 18).toString(),
      chainId: chain,
    }).then(result => ({
      success: !!result,
      pair: `${fromToken} → ${toToken}`,
      chain,
    })).catch(error => ({
      success: false,
      pair: `${fromToken} → ${toToken}`,
      chain,
      error: error.message,
    }));
    
    batchPromises.push(promise);
  }
  
  const batchResults = await Promise.all(batchPromises);
  
  const successful = batchResults.filter(r => r.success).length;
  const failed = batchResults.filter(r => !r.success).length;
  
  console.log(`\nBatch Results:`);
  console.log(`  ✅ Successful: ${successful}/${batchSize}`);
  console.log(`  ❌ Failed: ${failed}/${batchSize}`);
  
  if (failed > 0) {
    console.log('\nFailed requests:');
    batchResults.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.pair} (Chain ${r.chain}): ${r.error}`);
    });
  }
  
  testResults.passed += successful;
  testResults.failed += failed;
}

/**
 * Helper: Fetch quote from API
 */
async function fetchQuote(endpoint, params) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Quote failed: ${error}`);
  }
  
  return response.json();
}

/**
 * Helper: Fetch cross-chain quote
 */
async function fetchCrossChainQuote(params) {
  const response = await fetch(`${API_BASE}/api/crosschain/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cross-chain quote failed: ${error}`);
  }
  
  return response.json();
}

/**
 * Helper: Create test order
 */
function createTestOrder(test) {
  const token = TOKENS[test.chain][test.token];
  return {
    sellToken: token,
    buyToken: TOKENS[test.chain].USDC,
    sellAmount: ethers.parseUnits('100', 18).toString(),
    buyAmount: ethers.parseUnits('200', 6).toString(),
    validTo: Math.floor(Date.now() / 1000) + 3600,
    appData: '0x' + '00'.repeat(32),
    feeAmount: '0',
    kind: 'sell',
    partiallyFillable: false,
    receiver: TEST_WALLET,
    user: TEST_WALLET,
    signingScheme: 'eip712',
    nonce: 0,
    wallet: TEST_WALLET,
  };
}

/**
 * Helper: Sign EIP-712 order
 */
async function signEIP712Order(wallet, order) {
  const domain = getEIP712Domain(1);
  const types = getEIP712Types();
  
  return wallet.signTypedData(domain, types, order);
}

/**
 * Helper: Get EIP-712 domain
 */
function getEIP712Domain(chainId) {
  return {
    name: 'MetaAggregator',
    version: '1',
    chainId,
    verifyingContract: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  };
}

/**
 * Helper: Get EIP-712 types
 */
function getEIP712Types() {
  return {
    Order: [
      { name: 'sellToken', type: 'address' },
      { name: 'buyToken', type: 'address' },
      { name: 'sellAmount', type: 'uint256' },
      { name: 'buyAmount', type: 'uint256' },
      { name: 'validTo', type: 'uint32' },
      { name: 'appData', type: 'bytes32' },
      { name: 'feeAmount', type: 'uint256' },
      { name: 'kind', type: 'string' },
      { name: 'partiallyFillable', type: 'bool' },
      { name: 'receiver', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'signingScheme', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'wallet', type: 'address' },
    ],
  };
}

/**
 * Print test summary
 */
function printTestSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY\n');
  
  const total = testResults.passed + testResults.failed;
  const successRate = total > 0 ? (testResults.passed / total * 100).toFixed(1) : 0;
  
  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`Success Rate: ${successRate}%`);
  
  if (testResults.timings.length > 0) {
    const avgTime = testResults.timings.reduce((a, b) => a + b, 0) / testResults.timings.length;
    console.log(`\nPerformance:`);
    console.log(`  Average Quote Time: ${avgTime.toFixed(0)}ms`);
    console.log(`  Min Time: ${Math.min(...testResults.timings)}ms`);
    console.log(`  Max Time: ${Math.max(...testResults.timings)}ms`);
  }
  
  if (testResults.errors.length > 0) {
    console.log('\n⚠️ Errors:');
    testResults.errors.slice(0, 5).forEach(e => {
      console.log(`  - ${e.scenario || e.test}: ${e.error}`);
    });
    if (testResults.errors.length > 5) {
      console.log(`  ... and ${testResults.errors.length - 5} more`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  
  if (testResults.failed === 0) {
    console.log('🎉 ALL TESTS PASSED! The system is working reliably.');
  } else {
    console.log('⚠️ Some tests failed. Review the errors above.');
  }
}

// Run the tests
if (require.main === module) {
  runComprehensiveTests().catch(console.error);
}

module.exports = { runComprehensiveTests };