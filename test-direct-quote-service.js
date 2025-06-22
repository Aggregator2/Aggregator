require('dotenv').config({ path: '.env.local' });
const { ProfitableQuoteService } = require('./src/services/profitableQuoteService');
const { multiChainQuoteService } = require('./src/services/multiChainQuoteService');
const fs = require('fs');

const profitableQuoteService = new ProfitableQuoteService();

// Test results storage
const TEST_RESULTS = [];

// Test token configurations
const TEST_TOKENS = {
  ethereum: {
    chainId: 1,
    tokens: {
      ETH: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18 },
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
      USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
      DAI: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
      WBTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
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
      USDC: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6 }
    }
  }
};

// Test token pairs
const TEST_PAIRS = [
  { from: 'ethereum.ETH', to: 'ethereum.USDC', name: 'ETH → USDC' },
  { from: 'ethereum.USDC', to: 'ethereum.USDT', name: 'USDC → USDT (Stables)' },
  { from: 'ethereum.ETH', to: 'ethereum.WBTC', name: 'ETH → WBTC' },
  { from: 'ethereum.SHIB', to: 'ethereum.USDC', name: 'SHIB → USDC (Meme)' },
  { from: 'ethereum.DAI', to: 'ethereum.USDC', name: 'DAI → USDC (Stables)' },
  { from: 'ethereum.UNI', to: 'ethereum.AAVE', name: 'UNI → AAVE (DeFi)' },
  { from: 'ethereum.LINK', to: 'ethereum.ETH', name: 'LINK → ETH' },
  { from: 'polygon.MATIC', to: 'polygon.USDC', name: 'MATIC → USDC (Polygon)' }
];

// Helper function
function getTokenInfo(tokenPath) {
  const [chain, symbol] = tokenPath.split('.');
  return { 
    chain, 
    chainId: TEST_TOKENS[chain].chainId,
    ...TEST_TOKENS[chain].tokens[symbol] 
  };
}

// Test 1: Basic token pair quotes
async function testTokenPairs() {
  console.log('\n📊 Test 1: Testing Different Token Pairs\n');
  
  for (const pair of TEST_PAIRS) {
    const from = getTokenInfo(pair.from);
    const to = getTokenInfo(pair.to);
    const amount = from.symbol === 'ETH' || from.symbol === 'MATIC' ? 
      '1000000000000000000' : // 1 ETH/MATIC
      '1000000000'; // 1000 USDC
    
    try {
      console.log(`Testing ${pair.name}...`);
      const quote = await profitableQuoteService.getQuote({
        chainId: from.chainId,
        fromTokenAddress: from.address,
        toTokenAddress: to.address,
        amount: amount,
        slippage: 0.5
      });
      
      TEST_RESULTS.push({
        test: 'Token Pair Quote',
        pair: pair.name,
        success: true,
        output: quote.toAmount,
        profit: quote.expectedProfit,
        sources: quote.sources
      });
      
      console.log(`  ✅ Success: ${amount} → ${quote.toAmount}`);
      console.log(`  💰 Expected profit: ${quote.expectedProfit}`);
      console.log(`  📊 Sources: ${quote.sources || 'N/A'}`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Token Pair Quote',
        pair: pair.name,
        success: false,
        error: error.message
      });
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
}

// Test 2: Real-time quote updates
async function testRealTimeUpdates() {
  console.log('\n🔄 Test 2: Real-Time Quote Updates\n');
  
  const amounts = ['1000000000000000000', '2000000000000000000', '5000000000000000000'];
  const quotes = [];
  
  for (const amount of amounts) {
    try {
      const quote = await profitableQuoteService.getQuote({
        chainId: 1,
        fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: amount,
        slippage: 0.5
      });
      quotes.push({ amount, toAmount: quote.toAmount });
      console.log(`ETH Amount: ${amount} → USDC: ${quote.toAmount}`);
    } catch (error) {
      console.log(`Error for ${amount}: ${error.message}`);
    }
  }
  
  // Check proportionality
  if (quotes.length >= 2) {
    const ratio1 = BigInt(quotes[1].toAmount) / BigInt(quotes[0].toAmount);
    const ratio2 = BigInt(quotes[1].amount) / BigInt(quotes[0].amount);
    const proportional = Math.abs(Number(ratio1) - Number(ratio2)) < 0.1;
    
    TEST_RESULTS.push({
      test: 'Real-Time Updates',
      success: proportional,
      message: proportional ? 'Quotes scale proportionally' : 'Quotes not proportional',
      ratios: { output: Number(ratio1), input: Number(ratio2) }
    });
    console.log(`\n📊 Proportionality: ${proportional ? '✅' : '❌'}`);
  }
}

// Test 3: Amount ranges
async function testAmountRanges() {
  console.log('\n💰 Test 3: Amount Ranges ($1 - $100,000)\n');
  
  const ETH_PRICE = 2000; // Approximate
  const testAmounts = [
    { usd: 1, wei: (1 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 100, wei: (100 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 10000, wei: (10000 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 100000, wei: (100000 / ETH_PRICE * 1e18).toFixed(0) }
  ];
  
  for (const test of testAmounts) {
    try {
      console.log(`Testing $${test.usd} (${test.wei} wei)...`);
      const quote = await profitableQuoteService.getQuote({
        chainId: 1,
        fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: test.wei,
        slippage: 0.5
      });
      
      TEST_RESULTS.push({
        test: 'Amount Range',
        amount: `$${test.usd}`,
        success: true,
        output: quote.toAmount,
        precision: quote.toAmount.length
      });
      console.log(`  ✅ Output: ${quote.toAmount} USDC`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Amount Range',
        amount: `$${test.usd}`,
        success: false,
        error: error.message
      });
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
}

// Test 4: Slippage settings
async function testSlippageSettings() {
  console.log('\n🎯 Test 4: Slippage Settings\n');
  
  const slippages = [0.1, 0.5, 1.0, 3.0];
  const amount = '1000000000000000000'; // 1 ETH
  
  for (const slippage of slippages) {
    try {
      console.log(`Testing ${slippage}% slippage...`);
      const quote = await profitableQuoteService.getQuote({
        chainId: 1,
        fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: amount,
        slippage: slippage
      });
      
      TEST_RESULTS.push({
        test: 'Slippage Setting',
        slippage: `${slippage}%`,
        success: true,
        output: quote.toAmount,
        profit: quote.expectedProfit
      });
      console.log(`  ✅ Output: ${quote.toAmount}`);
      console.log(`  💰 Profit: ${quote.expectedProfit}`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Slippage Setting',
        slippage: `${slippage}%`,
        success: false,
        error: error.message
      });
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
}

// Test 5: Gas estimates
async function testGasEstimates() {
  console.log('\n⛽ Test 5: Gas Estimates\n');
  
  const testPairs = [
    { from: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'ETH → USDC' },
    { from: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', to: '0xdAC17F958D2ee523a2206206994597C13D831ec7', name: 'USDC → USDT' }
  ];
  
  for (const pair of testPairs) {
    try {
      console.log(`Testing ${pair.name}...`);
      const quote = await multiChainQuoteService.getQuote({
        chainId: 1,
        fromTokenAddress: pair.from,
        toTokenAddress: pair.to,
        amount: '1000000000000000000',
        slippage: 0.5
      });
      
      const hasGas = quote.estimatedGas && parseInt(quote.estimatedGas) > 0;
      const reasonable = hasGas && parseInt(quote.estimatedGas) > 50000 && parseInt(quote.estimatedGas) < 1000000;
      
      TEST_RESULTS.push({
        test: 'Gas Estimate',
        pair: pair.name,
        success: hasGas,
        gasEstimate: quote.estimatedGas,
        reasonable: reasonable
      });
      
      console.log(`  ${hasGas ? '✅' : '❌'} Gas: ${quote.estimatedGas || 'N/A'}`);
      console.log(`  📊 Reasonable: ${reasonable}`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Gas Estimate',
        pair: pair.name,
        success: false,
        error: error.message
      });
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
}

// Test 6: Route information
async function testRouteVisualization() {
  console.log('\n🗺️ Test 6: Route Visualization\n');
  
  const complexPairs = [
    { from: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', to: '0x6B175474E89094C44Da98b954EedeAC495271d0F', name: 'SHIB → DAI' },
    { from: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', to: '0x514910771AF9Ca656af840dff83E8264EcF986CA', name: 'AAVE → LINK' }
  ];
  
  for (const pair of complexPairs) {
    try {
      console.log(`Testing ${pair.name}...`);
      const quote = await multiChainQuoteService.getQuote({
        chainId: 1,
        fromTokenAddress: pair.from,
        toTokenAddress: pair.to,
        amount: '1000000000000000000',
        slippage: 0.5
      });
      
      const hasRoute = quote.sources || quote.route || quote.protocols;
      
      TEST_RESULTS.push({
        test: 'Route Visualization',
        pair: pair.name,
        success: !!hasRoute,
        route: hasRoute || 'No route info'
      });
      
      console.log(`  ${hasRoute ? '✅' : '❌'} Route: ${JSON.stringify(hasRoute || 'N/A')}`);
    } catch (error) {
      TEST_RESULTS.push({
        test: 'Route Visualization',
        pair: pair.name,
        success: false,
        error: error.message
      });
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
}

// Generate report
function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 QUOTE SERVICE TEST REPORT');
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
  
  // Save results
  fs.writeFileSync('quote-service-test-results.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    summary,
    results: TEST_RESULTS
  }, null, 2));
  
  console.log('📁 Detailed results saved to quote-service-test-results.json');
}

// Main runner
async function runTests() {
  console.log('🚀 Starting Direct Quote Service Tests...\n');
  
  try {
    await testTokenPairs();
    await testRealTimeUpdates();
    await testAmountRanges();
    await testSlippageSettings();
    await testGasEstimates();
    await testRouteVisualization();
    
    generateReport();
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  }
}

runTests();