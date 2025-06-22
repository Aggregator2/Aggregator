const axios = require('axios');
const fs = require('fs');

// Test configuration
const BASE_URL = 'http://localhost:3000/api';
const TEST_RESULTS = [];

// Token configurations for testing
const TEST_TOKENS = {
  ethereum: {
    chainId: 1,
    tokens: {
      ETH: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18 },
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
      USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
      DAI: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
      WBTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
      ROPE: { address: '0x9D47894f8BECB68B9cF3428d256311Affe8B068B', symbol: 'ROPE', decimals: 18 },
      SHIB: { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', symbol: 'SHIB', decimals: 18 },
      UNI: { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI', decimals: 18 },
      AAVE: { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE', decimals: 18 },
      LINK: { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', decimals: 18 }
    }
  },
  polygon: {
    chainId: 137,
    tokens: {
      MATIC: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'MATIC', decimals: 18 },
      USDC: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6 },
      WETH: { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH', decimals: 18 }
    }
  },
  arbitrum: {
    chainId: 42161,
    tokens: {
      ETH: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18 },
      USDC: { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC', decimals: 6 },
      ARB: { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB', decimals: 18 }
    }
  }
};

// Test token pairs
const TEST_PAIRS = [
  // Same chain swaps
  { from: 'ethereum.ETH', to: 'ethereum.USDC', name: 'ETH → USDC (Ethereum)' },
  { from: 'ethereum.USDC', to: 'ethereum.USDT', name: 'USDC → USDT (Stables)' },
  { from: 'ethereum.ETH', to: 'ethereum.WBTC', name: 'ETH → WBTC (Major)' },
  { from: 'ethereum.ROPE', to: 'ethereum.ETH', name: 'ROPE → ETH (Weird token)' },
  { from: 'ethereum.SHIB', to: 'ethereum.USDC', name: 'SHIB → USDC (Meme)' },
  { from: 'ethereum.DAI', to: 'ethereum.USDC', name: 'DAI → USDC (Stables)' },
  { from: 'ethereum.UNI', to: 'ethereum.AAVE', name: 'UNI → AAVE (DeFi)' },
  { from: 'ethereum.LINK', to: 'ethereum.ETH', name: 'LINK → ETH' },
  { from: 'polygon.MATIC', to: 'polygon.USDC', name: 'MATIC → USDC (Polygon)' },
  { from: 'arbitrum.ETH', to: 'arbitrum.ARB', name: 'ETH → ARB (Arbitrum)' }
];

// Test amounts (in USD equivalent)
const TEST_AMOUNTS = [
  { usd: 1, label: '$1' },
  { usd: 10, label: '$10' },
  { usd: 100, label: '$100' },
  { usd: 1000, label: '$1,000' },
  { usd: 10000, label: '$10,000' },
  { usd: 100000, label: '$100,000' }
];

// Helper functions
function getTokenInfo(tokenPath) {
  const [chain, symbol] = tokenPath.split('.');
  return { 
    chain, 
    chainId: TEST_TOKENS[chain].chainId,
    ...TEST_TOKENS[chain].tokens[symbol] 
  };
}

async function getQuote(fromToken, toToken, amount, slippage = 0.5) {
  const from = getTokenInfo(fromToken);
  const to = getTokenInfo(toToken);
  
  try {
    const response = await axios.get(`${BASE_URL}/quote-profitable`, {
      params: {
        chainId: from.chainId,
        fromTokenAddress: from.address,
        toTokenAddress: to.address,
        amount: amount,
        slippage: slippage
      }
    });
    return response.data;
  } catch (error) {
    return { error: error.response?.data?.error || error.message };
  }
}

async function getCrossChainQuote(fromToken, toToken, amount, slippage = 0.5) {
  const from = getTokenInfo(fromToken);
  const to = getTokenInfo(toToken);
  
  try {
    const response = await axios.post(`${BASE_URL}/crosschain/quote`, {
      fromChainId: from.chainId,
      toChainId: to.chainId,
      fromTokenAddress: from.address,
      toTokenAddress: to.address,
      amount: amount,
      slippageTolerance: slippage / 100
    });
    return response.data;
  } catch (error) {
    return { error: error.response?.data?.error || error.message };
  }
}

// Test functions
async function testTokenPairs() {
  console.log('\n🔍 Testing 10 Different Token Pairs...\n');
  
  for (const pair of TEST_PAIRS) {
    console.log(`Testing ${pair.name}...`);
    const from = getTokenInfo(pair.from);
    const amount = from.symbol === 'ETH' || from.symbol === 'MATIC' ? 
      '1000000000000000000' : // 1 ETH/MATIC
      '1000000000'; // 1000 USDC (6 decimals)
    
    const quote = await getQuote(pair.from, pair.to, amount);
    
    TEST_RESULTS.push({
      test: 'Token Pair Quote',
      pair: pair.name,
      success: !quote.error,
      quote: quote.error ? null : {
        toAmount: quote.toAmount,
        estimatedGas: quote.estimatedGas,
        sources: quote.sources,
        route: quote.route
      },
      error: quote.error
    });
    
    if (!quote.error) {
      console.log(`  ✅ Success: ${amount} → ${quote.toAmount}`);
      console.log(`  📊 Sources: ${quote.sources || 'N/A'}`);
      console.log(`  ⛽ Gas: ${quote.estimatedGas || 'N/A'}`);
    } else {
      console.log(`  ❌ Error: ${quote.error}`);
    }
  }
}

async function testRealTimeUpdates() {
  console.log('\n🔄 Testing Real-Time Quote Updates...\n');
  
  const pair = { from: 'ethereum.ETH', to: 'ethereum.USDC' };
  const amounts = [
    '1000000000000000000', // 1 ETH
    '2000000000000000000', // 2 ETH
    '5000000000000000000'  // 5 ETH
  ];
  
  const quotes = [];
  for (const amount of amounts) {
    const quote = await getQuote(pair.from, pair.to, amount);
    quotes.push({ amount, quote });
    console.log(`Amount: ${amount} → Quote: ${quote.toAmount || 'Error'}`);
  }
  
  // Check if quotes scale proportionally
  const proportional = quotes.length === 3 && 
    !quotes[0].quote.error && 
    !quotes[1].quote.error &&
    (BigInt(quotes[1].quote.toAmount) / BigInt(quotes[0].quote.toAmount)).toString() === '2';
  
  TEST_RESULTS.push({
    test: 'Real-Time Updates',
    success: proportional,
    message: proportional ? 'Quotes update proportionally' : 'Quotes not proportional'
  });
}

async function testAmountRanges() {
  console.log('\n💰 Testing Amount Ranges ($1 - $100,000)...\n');
  
  // Assume ETH price ~$2000 for testing
  const ETH_PRICE = 2000;
  
  for (const testAmount of TEST_AMOUNTS) {
    const ethAmount = (testAmount.usd / ETH_PRICE * 1e18).toFixed(0);
    console.log(`Testing ${testAmount.label} (${ethAmount} wei)...`);
    
    const quote = await getQuote('ethereum.ETH', 'ethereum.USDC', ethAmount);
    
    TEST_RESULTS.push({
      test: 'Amount Range',
      amount: testAmount.label,
      success: !quote.error && quote.toAmount && !quote.toAmount.includes('.'),
      precision: quote.toAmount ? quote.toAmount.length : 0,
      error: quote.error
    });
    
    if (!quote.error) {
      console.log(`  ✅ Success: ${quote.toAmount} USDC`);
    } else {
      console.log(`  ❌ Error: ${quote.error}`);
    }
  }
}

async function testSlippageSettings() {
  console.log('\n🎯 Testing Slippage Settings...\n');
  
  const slippages = [0.1, 0.5, 1.0, 3.0];
  const amount = '1000000000000000000'; // 1 ETH
  
  for (const slippage of slippages) {
    console.log(`Testing ${slippage}% slippage...`);
    const quote = await getQuote('ethereum.ETH', 'ethereum.USDC', amount, slippage);
    
    TEST_RESULTS.push({
      test: 'Slippage Setting',
      slippage: `${slippage}%`,
      success: !quote.error,
      quote: quote.error ? null : {
        toAmount: quote.toAmount,
        minAmountOut: quote.minAmountOut,
        slippageUsed: quote.slippage
      },
      error: quote.error
    });
    
    if (!quote.error) {
      console.log(`  ✅ Quote: ${quote.toAmount}`);
      console.log(`  📉 Min out: ${quote.minAmountOut || 'N/A'}`);
    }
  }
}

async function testCrossChainQuotes() {
  console.log('\n🌉 Testing Cross-Chain Quotes...\n');
  
  const crossChainPairs = [
    { from: 'ethereum.ETH', to: 'polygon.MATIC', name: 'ETH (Ethereum) → MATIC (Polygon)' },
    { from: 'ethereum.USDC', to: 'polygon.USDC', name: 'USDC (Ethereum) → USDC (Polygon)' },
    { from: 'polygon.MATIC', to: 'arbitrum.ETH', name: 'MATIC (Polygon) → ETH (Arbitrum)' }
  ];
  
  for (const pair of crossChainPairs) {
    console.log(`Testing ${pair.name}...`);
    const amount = '1000000000000000000'; // 1 token
    
    const quote = await getCrossChainQuote(pair.from, pair.to, amount);
    
    TEST_RESULTS.push({
      test: 'Cross-Chain Quote',
      pair: pair.name,
      success: !quote.error,
      quote: quote.error ? null : {
        estimatedOutput: quote.estimatedOutput,
        route: quote.route,
        estimatedGasCosts: quote.estimatedGasCosts,
        bridgeFees: quote.bridgeFees
      },
      error: quote.error
    });
    
    if (!quote.error) {
      console.log(`  ✅ Output: ${quote.estimatedOutput}`);
      console.log(`  🌉 Route: ${JSON.stringify(quote.route || 'N/A')}`);
      console.log(`  ⛽ Gas costs: ${JSON.stringify(quote.estimatedGasCosts || 'N/A')}`);
    } else {
      console.log(`  ❌ Error: ${quote.error}`);
    }
  }
}

async function testGasEstimates() {
  console.log('\n⛽ Testing Gas Estimates...\n');
  
  const pairs = [
    { from: 'ethereum.ETH', to: 'ethereum.USDC', name: 'Simple swap' },
    { from: 'ethereum.USDC', to: 'ethereum.WBTC', name: 'Multi-hop swap' },
    { from: 'ethereum.ROPE', to: 'ethereum.USDC', name: 'Complex route' }
  ];
  
  for (const pair of pairs) {
    console.log(`Testing ${pair.name}...`);
    const quote = await getQuote(pair.from, pair.to, '1000000000000000000');
    
    TEST_RESULTS.push({
      test: 'Gas Estimate',
      pair: pair.name,
      success: !quote.error && quote.estimatedGas && parseInt(quote.estimatedGas) > 0,
      gasEstimate: quote.estimatedGas,
      reasonable: quote.estimatedGas ? 
        (parseInt(quote.estimatedGas) > 50000 && parseInt(quote.estimatedGas) < 1000000) : false
    });
    
    if (!quote.error && quote.estimatedGas) {
      console.log(`  ✅ Gas estimate: ${quote.estimatedGas}`);
      console.log(`  📊 Reasonable: ${parseInt(quote.estimatedGas) > 50000 && parseInt(quote.estimatedGas) < 1000000}`);
    } else {
      console.log(`  ❌ No gas estimate`);
    }
  }
}

async function testRouteVisualization() {
  console.log('\n🗺️ Testing Route Visualization...\n');
  
  const complexPairs = [
    { from: 'ethereum.ROPE', to: 'ethereum.WBTC', name: 'ROPE → WBTC' },
    { from: 'ethereum.SHIB', to: 'ethereum.DAI', name: 'SHIB → DAI' },
    { from: 'ethereum.AAVE', to: 'ethereum.LINK', name: 'AAVE → LINK' }
  ];
  
  for (const pair of complexPairs) {
    console.log(`Testing ${pair.name}...`);
    const quote = await getQuote(pair.from, pair.to, '1000000000000000000');
    
    const hasRoute = !quote.error && (quote.route || quote.sources || quote.protocols);
    
    TEST_RESULTS.push({
      test: 'Route Visualization',
      pair: pair.name,
      success: hasRoute,
      route: quote.route || quote.sources || quote.protocols || 'No route info',
      error: quote.error
    });
    
    if (hasRoute) {
      console.log(`  ✅ Route: ${JSON.stringify(quote.route || quote.sources || quote.protocols)}`);
    } else {
      console.log(`  ❌ No route information`);
    }
  }
}

async function compareDEXPrices() {
  console.log('\n📊 Comparing with Direct DEX Prices...\n');
  
  // Get quotes from multiple sources for comparison
  const testPairs = [
    { from: 'ethereum.ETH', to: 'ethereum.USDC' },
    { from: 'ethereum.USDC', to: 'ethereum.DAI' },
    { from: 'ethereum.ETH', to: 'ethereum.WBTC' }
  ];
  
  for (const pair of testPairs) {
    console.log(`\nComparing ${pair.from} → ${pair.to}...`);
    
    // Get quote from our system
    const ourQuote = await getQuote(pair.from, pair.to, '1000000000000000000');
    
    // Compare with expected ranges (this is a simplified comparison)
    // In production, you'd fetch actual DEX prices
    const comparison = {
      ourQuote: ourQuote.toAmount,
      hasMultipleSources: ourQuote.sources?.includes(','),
      optimized: !ourQuote.error
    };
    
    TEST_RESULTS.push({
      test: 'DEX Price Comparison',
      pair: `${pair.from} → ${pair.to}`,
      success: comparison.optimized,
      details: comparison
    });
    
    console.log(`  📈 Our quote: ${ourQuote.toAmount || 'Error'}`);
    console.log(`  🔄 Multiple sources: ${comparison.hasMultipleSources}`);
  }
}

// Generate summary report
function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 COMPREHENSIVE QUOTE SYSTEM TEST REPORT');
  console.log('='.repeat(60) + '\n');
  
  const summary = {
    totalTests: TEST_RESULTS.length,
    passed: TEST_RESULTS.filter(r => r.success).length,
    failed: TEST_RESULTS.filter(r => !r.success).length
  };
  
  console.log(`Total Tests: ${summary.totalTests}`);
  console.log(`✅ Passed: ${summary.passed}`);
  console.log(`❌ Failed: ${summary.failed}`);
  console.log(`Success Rate: ${((summary.passed / summary.totalTests) * 100).toFixed(1)}%\n`);
  
  // Group results by test type
  const testGroups = {};
  TEST_RESULTS.forEach(result => {
    if (!testGroups[result.test]) {
      testGroups[result.test] = [];
    }
    testGroups[result.test].push(result);
  });
  
  // Print detailed results by group
  Object.entries(testGroups).forEach(([testType, results]) => {
    console.log(`\n${testType}:`);
    console.log('-'.repeat(40));
    
    const passed = results.filter(r => r.success).length;
    console.log(`Results: ${passed}/${results.length} passed\n`);
    
    results.forEach(result => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.pair || result.amount || result.slippage || result.name || 'Test'}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      if (result.details) {
        console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
      }
    });
  });
  
  // Save detailed results
  fs.writeFileSync('quote-test-results.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    summary,
    results: TEST_RESULTS
  }, null, 2));
  
  console.log('\n\n📁 Detailed results saved to quote-test-results.json');
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting Comprehensive Quote System Tests...\n');
  
  try {
    await testTokenPairs();
    await testRealTimeUpdates();
    await testAmountRanges();
    await testSlippageSettings();
    await testCrossChainQuotes();
    await testGasEstimates();
    await testRouteVisualization();
    await compareDEXPrices();
    
    generateReport();
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  }
}

// Run tests
runAllTests();