const axios = require('axios');
const fs = require('fs');

// Wait for server to be ready
const waitForServer = async (url, maxAttempts = 30) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await axios.get(url);
      return true;
    } catch (error) {
      console.log(`Waiting for server... (${i + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
};

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_RESULTS = [];

// Token configurations
const TOKENS = {
  ethereum: {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    SHIB: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
    ROPE: '0x9D47894f8BECB68B9cF3428d256311Affe8B068B',
    UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA'
  },
  polygon: {
    MATIC: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
  }
};

// Test 1: Token Pair Quotes
async function testTokenPairQuotes() {
  console.log('\n📊 Test 1: Testing 10 Different Token Pairs\n');
  
  const pairs = [
    { from: 'WETH', to: 'USDC', chain: 1, name: 'ETH → USDC' },
    { from: 'USDC', to: 'USDT', chain: 1, name: 'USDC → USDT (Stables)' },
    { from: 'WETH', to: 'WBTC', chain: 1, name: 'ETH → WBTC' },
    { from: 'ROPE', to: 'WETH', chain: 1, name: 'ROPE → ETH (Weird)' },
    { from: 'SHIB', to: 'USDC', chain: 1, name: 'SHIB → USDC (Meme)' },
    { from: 'DAI', to: 'USDC', chain: 1, name: 'DAI → USDC' },
    { from: 'UNI', to: 'LINK', chain: 1, name: 'UNI → LINK (DeFi)' },
    { from: 'WMATIC', to: 'USDC', chain: 137, name: 'MATIC → USDC (Polygon)' },
    { from: 'WBTC', to: 'WETH', chain: 1, name: 'WBTC → ETH' },
    { from: 'LINK', to: 'DAI', chain: 1, name: 'LINK → DAI' }
  ];
  
  for (const pair of pairs) {
    try {
      const chainTokens = pair.chain === 1 ? TOKENS.ethereum : TOKENS.polygon;
      const amount = pair.from === 'WETH' || pair.from === 'WMATIC' ? 
        '1000000000000000000' : '1000000000'; // 1 ETH or 1000 USDC
      
      console.log(`Testing ${pair.name}...`);
      const response = await axios.get(`${BASE_URL}/api/quote-profitable`, {
        params: {
          chainId: pair.chain,
          fromTokenAddress: chainTokens[pair.from],
          toTokenAddress: chainTokens[pair.to],
          amount: amount,
          slippage: 0.5
        }
      });
      
      const quote = response.data;
      TEST_RESULTS.push({
        test: 'Token Pair',
        pair: pair.name,
        success: true,
        output: quote.toAmount,
        gas: quote.estimatedGas,
        sources: quote.sources
      });
      
      console.log(`  ✅ Amount: ${quote.toAmount}`);
      console.log(`  ⛽ Gas: ${quote.estimatedGas || 'N/A'}`);
      console.log(`  📊 Sources: ${quote.sources || 'N/A'}\n`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Token Pair',
        pair: pair.name,
        success: false,
        error: error.response?.data?.error || error.message
      });
      console.log(`  ❌ Error: ${error.response?.data?.error || error.message}\n`);
    }
  }
}

// Test 2: Real-time Updates
async function testRealTimeUpdates() {
  console.log('\n🔄 Test 2: Real-Time Quote Updates\n');
  
  const amounts = ['1000000000000000000', '2000000000000000000', '5000000000000000000'];
  const quotes = [];
  
  for (const amount of amounts) {
    try {
      const response = await axios.get(`${BASE_URL}/api/quote-profitable`, {
        params: {
          chainId: 1,
          fromTokenAddress: TOKENS.ethereum.WETH,
          toTokenAddress: TOKENS.ethereum.USDC,
          amount: amount,
          slippage: 0.5
        }
      });
      quotes.push({ amount, output: response.data.toAmount });
      console.log(`Amount: ${amount} → ${response.data.toAmount}`);
    } catch (error) {
      console.log(`Error: ${error.response?.data?.error || error.message}`);
    }
  }
  
  if (quotes.length >= 2) {
    const ratio = BigInt(quotes[1].output) / BigInt(quotes[0].output);
    const proportional = ratio === 2n;
    TEST_RESULTS.push({
      test: 'Real-Time Updates',
      success: proportional,
      message: proportional ? 'Quotes scale proportionally' : 'Quotes not proportional'
    });
    console.log(`\n📊 Proportionality check: ${proportional ? '✅' : '❌'}`);
  }
}

// Test 3: Amount Ranges
async function testAmountRanges() {
  console.log('\n💰 Test 3: Amount Ranges ($1 - $100,000)\n');
  
  const ETH_PRICE = 2000;
  const amounts = [
    { usd: 1, wei: (1 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 10, wei: (10 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 100, wei: (100 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 1000, wei: (1000 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 10000, wei: (10000 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 100000, wei: (100000 / ETH_PRICE * 1e18).toFixed(0) }
  ];
  
  for (const test of amounts) {
    try {
      console.log(`Testing $${test.usd}...`);
      const response = await axios.get(`${BASE_URL}/api/quote-profitable`, {
        params: {
          chainId: 1,
          fromTokenAddress: TOKENS.ethereum.WETH,
          toTokenAddress: TOKENS.ethereum.USDC,
          amount: test.wei,
          slippage: 0.5
        }
      });
      
      TEST_RESULTS.push({
        test: 'Amount Range',
        amount: `$${test.usd}`,
        success: true,
        output: response.data.toAmount,
        precision: response.data.toAmount.length
      });
      console.log(`  ✅ Output: ${response.data.toAmount} USDC`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Amount Range',
        amount: `$${test.usd}`,
        success: false,
        error: error.response?.data?.error || error.message
      });
      console.log(`  ❌ Error: ${error.response?.data?.error || error.message}`);
    }
  }
}

// Test 4: Slippage Settings
async function testSlippageSettings() {
  console.log('\n🎯 Test 4: Slippage Settings\n');
  
  const slippages = [0.1, 0.5, 1.0, 3.0];
  const amount = '1000000000000000000';
  const results = [];
  
  for (const slippage of slippages) {
    try {
      console.log(`Testing ${slippage}% slippage...`);
      const response = await axios.get(`${BASE_URL}/api/quote-profitable`, {
        params: {
          chainId: 1,
          fromTokenAddress: TOKENS.ethereum.WETH,
          toTokenAddress: TOKENS.ethereum.USDC,
          amount: amount,
          slippage: slippage
        }
      });
      
      results.push({
        slippage,
        output: response.data.toAmount,
        minOutput: response.data.minAmountOut
      });
      
      TEST_RESULTS.push({
        test: 'Slippage',
        slippage: `${slippage}%`,
        success: true,
        output: response.data.toAmount
      });
      console.log(`  ✅ Output: ${response.data.toAmount}`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Slippage',
        slippage: `${slippage}%`,
        success: false,
        error: error.response?.data?.error || error.message
      });
      console.log(`  ❌ Error: ${error.response?.data?.error || error.message}`);
    }
  }
  
  // Check if different slippages maintain same quote but different min outputs
  if (results.length > 1) {
    const sameQuotes = results.every(r => r.output === results[0].output);
    console.log(`\n📊 Same quotes for different slippages: ${sameQuotes ? '✅' : '❌'}`);
  }
}

// Test 5: Cross-Chain Quotes
async function testCrossChainQuotes() {
  console.log('\n🌉 Test 5: Cross-Chain Quotes\n');
  
  const crossChainPairs = [
    { fromChain: 1, toChain: 137, from: 'WETH', to: 'WMATIC', name: 'ETH (Ethereum) → MATIC (Polygon)' },
    { fromChain: 1, toChain: 137, from: 'USDC', to: 'USDC', name: 'USDC (Ethereum) → USDC (Polygon)' },
    { fromChain: 137, toChain: 1, from: 'WMATIC', to: 'WETH', name: 'MATIC (Polygon) → ETH (Ethereum)' }
  ];
  
  for (const pair of crossChainPairs) {
    try {
      console.log(`Testing ${pair.name}...`);
      const fromTokens = pair.fromChain === 1 ? TOKENS.ethereum : TOKENS.polygon;
      const toTokens = pair.toChain === 1 ? TOKENS.ethereum : TOKENS.polygon;
      
      const response = await axios.post(`${BASE_URL}/api/crosschain/quote`, {
        fromChainId: pair.fromChain,
        toChainId: pair.toChain,
        fromTokenAddress: fromTokens[pair.from],
        toTokenAddress: toTokens[pair.to],
        amount: '1000000000000000000',
        slippageTolerance: 0.005
      });
      
      TEST_RESULTS.push({
        test: 'Cross-Chain',
        pair: pair.name,
        success: true,
        output: response.data.estimatedOutput,
        route: response.data.route
      });
      
      console.log(`  ✅ Output: ${response.data.estimatedOutput}`);
      console.log(`  🌉 Route: ${JSON.stringify(response.data.route)}`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Cross-Chain',
        pair: pair.name,
        success: false,
        error: error.response?.data?.error || error.message
      });
      console.log(`  ❌ Error: ${error.response?.data?.error || error.message}`);
    }
  }
}

// Test 6: Gas Estimates
async function testGasEstimates() {
  console.log('\n⛽ Test 6: Gas Estimates\n');
  
  const pairs = [
    { from: 'WETH', to: 'USDC', name: 'Simple swap' },
    { from: 'USDC', to: 'WBTC', name: 'Multi-hop' },
    { from: 'SHIB', to: 'DAI', name: 'Complex route' }
  ];
  
  for (const pair of pairs) {
    try {
      console.log(`Testing ${pair.name}...`);
      const response = await axios.get(`${BASE_URL}/api/quote-profitable`, {
        params: {
          chainId: 1,
          fromTokenAddress: TOKENS.ethereum[pair.from],
          toTokenAddress: TOKENS.ethereum[pair.to],
          amount: '1000000000000000000',
          slippage: 0.5
        }
      });
      
      const gas = parseInt(response.data.estimatedGas || '0');
      const reasonable = gas > 50000 && gas < 1000000;
      
      TEST_RESULTS.push({
        test: 'Gas Estimate',
        pair: pair.name,
        success: gas > 0,
        gas: gas,
        reasonable: reasonable
      });
      
      console.log(`  ${gas > 0 ? '✅' : '❌'} Gas: ${gas}`);
      console.log(`  📊 Reasonable: ${reasonable}`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Gas Estimate',
        pair: pair.name,
        success: false,
        error: error.response?.data?.error || error.message
      });
      console.log(`  ❌ Error: ${error.response?.data?.error || error.message}`);
    }
  }
}

// Test 7: Route Visualization
async function testRouteVisualization() {
  console.log('\n🗺️ Test 7: Route Visualization\n');
  
  const complexPairs = [
    { from: 'ROPE', to: 'WBTC', name: 'ROPE → WBTC' },
    { from: 'SHIB', to: 'DAI', name: 'SHIB → DAI' },
    { from: 'UNI', to: 'LINK', name: 'UNI → LINK' }
  ];
  
  for (const pair of complexPairs) {
    try {
      console.log(`Testing ${pair.name}...`);
      const response = await axios.get(`${BASE_URL}/api/quote-profitable`, {
        params: {
          chainId: 1,
          fromTokenAddress: TOKENS.ethereum[pair.from],
          toTokenAddress: TOKENS.ethereum[pair.to],
          amount: '1000000000000000000',
          slippage: 0.5
        }
      });
      
      const hasRoute = response.data.route || response.data.sources || response.data.protocols;
      
      TEST_RESULTS.push({
        test: 'Route Info',
        pair: pair.name,
        success: !!hasRoute,
        route: hasRoute
      });
      
      console.log(`  ${hasRoute ? '✅' : '❌'} Route: ${JSON.stringify(hasRoute || 'None')}`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Route Info',
        pair: pair.name,
        success: false,
        error: error.response?.data?.error || error.message
      });
      console.log(`  ❌ Error: ${error.response?.data?.error || error.message}`);
    }
  }
}

// Test 8: DEX Price Comparison
async function testDEXComparison() {
  console.log('\n📊 Test 8: DEX Price Comparison\n');
  
  const pairs = [
    { from: 'WETH', to: 'USDC', expected: 2000 },
    { from: 'USDC', to: 'DAI', expected: 1 },
    { from: 'WBTC', to: 'WETH', expected: 20 }
  ];
  
  for (const pair of pairs) {
    try {
      console.log(`Comparing ${pair.from} → ${pair.to}...`);
      const response = await axios.get(`${BASE_URL}/api/quote-profitable`, {
        params: {
          chainId: 1,
          fromTokenAddress: TOKENS.ethereum[pair.from],
          toTokenAddress: TOKENS.ethereum[pair.to],
          amount: '1000000000000000000',
          slippage: 0.5
        }
      });
      
      const quote = response.data;
      const rate = parseFloat(quote.toAmount) / 1e6; // Assuming USDC decimals
      const deviation = Math.abs((rate - pair.expected) / pair.expected * 100);
      
      TEST_RESULTS.push({
        test: 'Price Comparison',
        pair: `${pair.from} → ${pair.to}`,
        success: deviation < 10,
        rate: rate,
        expected: pair.expected,
        deviation: `${deviation.toFixed(2)}%`
      });
      
      console.log(`  📈 Rate: ${rate.toFixed(2)}`);
      console.log(`  📊 Expected: ~${pair.expected}`);
      console.log(`  ${deviation < 10 ? '✅' : '❌'} Deviation: ${deviation.toFixed(2)}%`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Price Comparison',
        pair: `${pair.from} → ${pair.to}`,
        success: false,
        error: error.response?.data?.error || error.message
      });
      console.log(`  ❌ Error: ${error.response?.data?.error || error.message}`);
    }
  }
}

// Generate Report
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
  
  // Group by test type
  const byType = {};
  TEST_RESULTS.forEach(r => {
    if (!byType[r.test]) byType[r.test] = { passed: 0, failed: 0 };
    if (r.success) byType[r.test].passed++;
    else byType[r.test].failed++;
  });
  
  console.log('Results by Test Type:');
  console.log('-'.repeat(40));
  Object.entries(byType).forEach(([type, stats]) => {
    const total = stats.passed + stats.failed;
    console.log(`${type}: ${stats.passed}/${total} passed`);
  });
  
  // Save results
  fs.writeFileSync('quote-api-test-results.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    summary,
    byType,
    results: TEST_RESULTS
  }, null, 2));
  
  console.log('\n📁 Detailed results saved to quote-api-test-results.json');
}

// Main runner
async function runAllTests() {
  console.log('🚀 Starting Comprehensive Quote API Tests...\n');
  
  // Wait for server
  console.log('Waiting for server to be ready...');
  const serverReady = await waitForServer(`${BASE_URL}/`, 30);
  
  if (!serverReady) {
    console.error('❌ Server did not start in time');
    return;
  }
  
  console.log('✅ Server is ready!\n');
  
  try {
    await testTokenPairQuotes();
    await testRealTimeUpdates();
    await testAmountRanges();
    await testSlippageSettings();
    await testCrossChainQuotes();
    await testGasEstimates();
    await testRouteVisualization();
    await testDEXComparison();
    
    generateReport();
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  }
}

// Run tests
runAllTests();