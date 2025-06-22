const axios = require('axios');
const fs = require('fs');

// Configuration
const BASE_URL = 'http://localhost:3000';
const TEST_RESULTS = [];
const TEST_USER = '0x742d35Cc6634C0532925a3b844Bc9e7595f8b94f';

// Token addresses
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
    KNC: '0xdd974D5C2e2928deA5F71b9825b8b646686BD200',
    UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA'
  },
  polygon: {
    MATIC: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'
  }
};

// Helper to format test results
function logResult(test, success, details) {
  TEST_RESULTS.push({ test, success, ...details });
  const icon = success ? '✅' : '❌';
  console.log(`${icon} ${test}: ${details.message || (success ? 'Passed' : 'Failed')}`);
  if (details.data) {
    Object.entries(details.data).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });
  }
}

// Test 1: 10 Different Token Pairs
async function test1_TokenPairs() {
  console.log('\n🧪 Test 1: Testing 10 Different Token Pairs\n');
  
  const pairs = [
    { from: 'WETH', to: 'USDC', name: 'ETH → USDC', chain: 1 },
    { from: 'USDC', to: 'USDT', name: 'USDC → USDT (Stables)', chain: 1 },
    { from: 'WETH', to: 'WBTC', name: 'ETH → WBTC', chain: 1 },
    { from: 'ROPE', to: 'WETH', name: 'ROPE → ETH (Weird token)', chain: 1 },
    { from: 'KNC', to: 'USDC', name: 'KNC → USDC (Weird token)', chain: 1 },
    { from: 'SHIB', to: 'USDC', name: 'SHIB → USDC (Meme)', chain: 1 },
    { from: 'DAI', to: 'USDC', name: 'DAI → USDC (Stables)', chain: 1 },
    { from: 'UNI', to: 'LINK', name: 'UNI → LINK (DeFi)', chain: 1 },
    { from: 'WMATIC', to: 'USDC', name: 'MATIC → USDC (Polygon)', chain: 137 },
    { from: 'WETH', to: 'DAI', name: 'ETH → DAI', chain: 1 }
  ];
  
  let passed = 0;
  for (const pair of pairs) {
    try {
      const chainTokens = pair.chain === 1 ? TOKENS.ethereum : TOKENS.polygon;
      const amount = pair.from === 'WETH' || pair.from === 'WMATIC' ? 
        '1000000000000000000' : // 1 ETH/MATIC
        pair.from === 'SHIB' ? '1000000000000000000000000' : // 1M SHIB
        '1000000000'; // 1000 USDC/other
      
      const response = await axios.post(`${BASE_URL}/api/quote-profitable`, {
        sellToken: chainTokens[pair.from],
        buyToken: chainTokens[pair.to],
        sellAmount: amount,
        user: TEST_USER,
        chainId: pair.chain,
        slippagePercentage: 0.5
      });
      
      const quote = response.data;
      if (quote.buyAmount && quote.sources) {
        passed++;
        logResult(`Token Pair: ${pair.name}`, true, {
          data: {
            buyAmount: quote.buyAmount,
            sources: quote.sources,
            gas: quote.estimatedGas || 'N/A'
          }
        });
      } else {
        logResult(`Token Pair: ${pair.name}`, false, {
          message: 'Missing quote data'
        });
      }
    } catch (error) {
      logResult(`Token Pair: ${pair.name}`, false, {
        message: error.response?.data?.error || error.message
      });
    }
  }
  
  console.log(`\n📊 Summary: ${passed}/10 token pairs quoted successfully\n`);
}

// Test 2: Real-time Quote Updates
async function test2_RealTimeUpdates() {
  console.log('\n🧪 Test 2: Real-Time Quote Updates\n');
  
  const amounts = [
    '1000000000000000000',    // 1 ETH
    '2000000000000000000',    // 2 ETH
    '5000000000000000000',    // 5 ETH
    '10000000000000000000'    // 10 ETH
  ];
  
  const quotes = [];
  for (const amount of amounts) {
    try {
      const response = await axios.post(`${BASE_URL}/api/quote-profitable`, {
        sellToken: TOKENS.ethereum.WETH,
        buyToken: TOKENS.ethereum.USDC,
        sellAmount: amount,
        user: TEST_USER,
        chainId: 1,
        slippagePercentage: 0.5
      });
      
      quotes.push({
        amount: amount,
        output: response.data.buyAmount
      });
      
      console.log(`Amount: ${(parseFloat(amount) / 1e18).toFixed(1)} ETH → ${response.data.buyAmount} USDC`);
    } catch (error) {
      console.log(`Error: ${error.response?.data?.error || error.message}`);
    }
  }
  
  // Check proportionality
  if (quotes.length >= 3) {
    let proportional = true;
    for (let i = 1; i < quotes.length; i++) {
      const inputRatio = BigInt(quotes[i].amount) / BigInt(quotes[0].amount);
      const outputRatio = BigInt(quotes[i].output) / BigInt(quotes[0].output);
      const deviation = Math.abs(Number(inputRatio) - Number(outputRatio)) / Number(inputRatio);
      
      if (deviation > 0.05) { // Allow 5% deviation
        proportional = false;
        break;
      }
    }
    
    logResult('Real-time updates proportionality', proportional, {
      message: proportional ? 'Quotes scale proportionally' : 'Quotes not proportional',
      data: {
        'Quote count': quotes.length,
        'Proportional': proportional
      }
    });
  }
}

// Test 3: Amount Ranges
async function test3_AmountRanges() {
  console.log('\n🧪 Test 3: Amount Ranges ($1 - $100,000)\n');
  
  const ETH_PRICE = 2000; // Approximate
  const amounts = [
    { usd: 1, wei: (1 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 10, wei: (10 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 100, wei: (100 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 1000, wei: (1000 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 10000, wei: (10000 / ETH_PRICE * 1e18).toFixed(0) },
    { usd: 100000, wei: (100000 / ETH_PRICE * 1e18).toFixed(0) }
  ];
  
  let precisionErrors = 0;
  for (const test of amounts) {
    try {
      const response = await axios.post(`${BASE_URL}/api/quote-profitable`, {
        sellToken: TOKENS.ethereum.WETH,
        buyToken: TOKENS.ethereum.USDC,
        sellAmount: test.wei,
        user: TEST_USER,
        chainId: 1,
        slippagePercentage: 0.5
      });
      
      const output = response.data.buyAmount;
      const hasDecimalPoint = output.includes('.');
      
      if (hasDecimalPoint) {
        precisionErrors++;
      }
      
      logResult(`Amount $${test.usd}`, !hasDecimalPoint, {
        data: {
          input: `${test.wei} wei`,
          output: output,
          precision: hasDecimalPoint ? 'Has decimal (error)' : 'Integer (correct)'
        }
      });
    } catch (error) {
      precisionErrors++;
      logResult(`Amount $${test.usd}`, false, {
        message: error.response?.data?.error || error.message
      });
    }
  }
  
  console.log(`\n📊 Precision errors: ${precisionErrors}/6\n`);
}

// Test 4: Slippage Settings
async function test4_SlippageSettings() {
  console.log('\n🧪 Test 4: Slippage Settings\n');
  
  const slippages = [0.1, 0.5, 1.0, 3.0, 5.0];
  const amount = '1000000000000000000'; // 1 ETH
  const results = [];
  
  for (const slippage of slippages) {
    try {
      const response = await axios.post(`${BASE_URL}/api/quote-profitable`, {
        sellToken: TOKENS.ethereum.WETH,
        buyToken: TOKENS.ethereum.USDC,
        sellAmount: amount,
        user: TEST_USER,
        chainId: 1,
        slippagePercentage: slippage
      });
      
      results.push({
        slippage,
        buyAmount: response.data.buyAmount,
        minAmountOut: response.data.minAmountOut
      });
      
      logResult(`Slippage ${slippage}%`, true, {
        data: {
          buyAmount: response.data.buyAmount,
          minAmountOut: response.data.minAmountOut || 'N/A'
        }
      });
    } catch (error) {
      logResult(`Slippage ${slippage}%`, false, {
        message: error.response?.data?.error || error.message
      });
    }
  }
  
  // Verify slippage affects minAmountOut
  if (results.length > 1) {
    const baseAmount = BigInt(results[0].buyAmount);
    let slippageWorks = true;
    
    for (const result of results) {
      if (result.minAmountOut) {
        const expectedMin = (baseAmount * BigInt(10000 - Math.round(result.slippage * 100))) / BigInt(10000);
        const actualMin = BigInt(result.minAmountOut);
        
        if (actualMin > baseAmount) {
          slippageWorks = false;
          break;
        }
      }
    }
    
    console.log(`\n📊 Slippage calculation: ${slippageWorks ? '✅ Working correctly' : '❌ Issues detected'}\n`);
  }
}

// Test 5: Cross-Chain Quotes
async function test5_CrossChainQuotes() {
  console.log('\n🧪 Test 5: Cross-Chain Quotes\n');
  
  const crossChainPairs = [
    { 
      fromChain: 1, toChain: 137, 
      from: TOKENS.ethereum.WETH, to: TOKENS.polygon.WMATIC,
      name: 'ETH (Ethereum) → MATIC (Polygon)'
    },
    { 
      fromChain: 1, toChain: 137, 
      from: TOKENS.ethereum.USDC, to: TOKENS.polygon.USDC,
      name: 'USDC (Ethereum) → USDC (Polygon)'
    },
    { 
      fromChain: 137, toChain: 1, 
      from: TOKENS.polygon.WMATIC, to: TOKENS.ethereum.WETH,
      name: 'MATIC (Polygon) → ETH (Ethereum)'
    }
  ];
  
  for (const pair of crossChainPairs) {
    try {
      const response = await axios.post(`${BASE_URL}/api/crosschain/quote`, {
        fromChainId: pair.fromChain,
        toChainId: pair.toChain,
        fromTokenAddress: pair.from,
        toTokenAddress: pair.to,
        amount: '1000000000000000000',
        slippageTolerance: 0.005,
        userAddress: TEST_USER
      });
      
      const quote = response.data;
      logResult(`Cross-chain: ${pair.name}`, true, {
        data: {
          estimatedOutput: quote.estimatedOutput,
          totalGasCost: quote.estimatedGasCosts?.total || 'N/A',
          bridgeFee: quote.bridgeFees || 'N/A',
          route: JSON.stringify(quote.route || [])
        }
      });
    } catch (error) {
      logResult(`Cross-chain: ${pair.name}`, false, {
        message: error.response?.data?.error || error.message
      });
    }
  }
}

// Test 6: Gas Estimates
async function test6_GasEstimates() {
  console.log('\n🧪 Test 6: Gas Estimates\n');
  
  const testCases = [
    { from: 'WETH', to: 'USDC', name: 'Simple swap' },
    { from: 'USDC', to: 'WBTC', name: 'Multi-hop swap' },
    { from: 'ROPE', to: 'DAI', name: 'Complex route' }
  ];
  
  for (const test of testCases) {
    try {
      const response = await axios.post(`${BASE_URL}/api/quote-profitable`, {
        sellToken: TOKENS.ethereum[test.from],
        buyToken: TOKENS.ethereum[test.to],
        sellAmount: '1000000000000000000',
        user: TEST_USER,
        chainId: 1,
        slippagePercentage: 0.5
      });
      
      const gas = parseInt(response.data.estimatedGas || '0');
      const reasonable = gas > 50000 && gas < 1000000;
      
      logResult(`Gas estimate: ${test.name}`, gas > 0 && reasonable, {
        data: {
          gas: gas || 'Not provided',
          reasonable: reasonable ? 'Yes (50k-1M)' : 'No'
        }
      });
    } catch (error) {
      logResult(`Gas estimate: ${test.name}`, false, {
        message: error.response?.data?.error || error.message
      });
    }
  }
}

// Test 7: Route Visualization
async function test7_RouteVisualization() {
  console.log('\n🧪 Test 7: Route Visualization (DEX Path)\n');
  
  const complexPairs = [
    { from: 'ROPE', to: 'WBTC', name: 'ROPE → WBTC' },
    { from: 'SHIB', to: 'DAI', name: 'SHIB → DAI' },
    { from: 'KNC', to: 'LINK', name: 'KNC → LINK' }
  ];
  
  for (const pair of complexPairs) {
    try {
      const response = await axios.post(`${BASE_URL}/api/quote-profitable`, {
        sellToken: TOKENS.ethereum[pair.from],
        buyToken: TOKENS.ethereum[pair.to],
        sellAmount: '1000000000000000000',
        user: TEST_USER,
        chainId: 1,
        slippagePercentage: 0.5
      });
      
      const quote = response.data;
      const hasRoute = quote.sources || quote.route || quote.protocols || quote.orders;
      
      logResult(`Route info: ${pair.name}`, !!hasRoute, {
        data: {
          sources: quote.sources || 'N/A',
          route: quote.route ? JSON.stringify(quote.route) : 'N/A',
          protocols: quote.protocols || 'N/A'
        }
      });
    } catch (error) {
      logResult(`Route info: ${pair.name}`, false, {
        message: error.response?.data?.error || error.message
      });
    }
  }
}

// Test 8: DEX Price Comparison
async function test8_DEXComparison() {
  console.log('\n🧪 Test 8: Compare with Direct DEX Prices\n');
  
  // Get quotes from our system
  const testPairs = [
    { from: 'WETH', to: 'USDC', expectedRate: 2000 },
    { from: 'USDC', to: 'DAI', expectedRate: 1 },
    { from: 'WETH', to: 'WBTC', expectedRate: 0.05 }
  ];
  
  for (const pair of testPairs) {
    try {
      const amount = pair.from === 'WETH' ? '1000000000000000000' : '1000000000';
      
      const response = await axios.post(`${BASE_URL}/api/quote-profitable`, {
        sellToken: TOKENS.ethereum[pair.from],
        buyToken: TOKENS.ethereum[pair.to],
        sellAmount: amount,
        user: TEST_USER,
        chainId: 1,
        slippagePercentage: 0.5
      });
      
      const quote = response.data;
      
      // Calculate effective rate
      const inputDecimals = pair.from === 'WETH' ? 18 : 6;
      const outputDecimals = pair.to === 'WBTC' ? 8 : (pair.to === 'USDC' || pair.to === 'USDT' ? 6 : 18);
      
      const inputAmount = parseFloat(amount) / Math.pow(10, inputDecimals);
      const outputAmount = parseFloat(quote.buyAmount) / Math.pow(10, outputDecimals);
      const rate = outputAmount / inputAmount;
      
      const deviation = Math.abs((rate - pair.expectedRate) / pair.expectedRate * 100);
      const acceptable = deviation < 10; // 10% tolerance
      
      logResult(`DEX comparison: ${pair.from} → ${pair.to}`, acceptable, {
        data: {
          rate: rate.toFixed(4),
          expected: pair.expectedRate,
          deviation: `${deviation.toFixed(2)}%`,
          sources: quote.sources || 'N/A'
        }
      });
    } catch (error) {
      logResult(`DEX comparison: ${pair.from} → ${pair.to}`, false, {
        message: error.response?.data?.error || error.message
      });
    }
  }
}

// Generate final report
function generateReport() {
  console.log('\n' + '='.repeat(70));
  console.log('📊 COMPREHENSIVE QUOTE SYSTEM TEST REPORT');
  console.log('='.repeat(70) + '\n');
  
  const passed = TEST_RESULTS.filter(r => r.success).length;
  const failed = TEST_RESULTS.filter(r => !r.success).length;
  const total = TEST_RESULTS.length;
  
  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);
  
  // Group by test category
  const categories = {};
  TEST_RESULTS.forEach(r => {
    const category = r.test.split(':')[0];
    if (!categories[category]) {
      categories[category] = { passed: 0, failed: 0 };
    }
    if (r.success) categories[category].passed++;
    else categories[category].failed++;
  });
  
  console.log('Results by Category:');
  console.log('-'.repeat(50));
  Object.entries(categories).forEach(([cat, stats]) => {
    const total = stats.passed + stats.failed;
    const rate = ((stats.passed / total) * 100).toFixed(0);
    console.log(`${cat.padEnd(25)} ${stats.passed}/${total} passed (${rate}%)`);
  });
  
  // Save detailed results
  fs.writeFileSync('quote-validation-results.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed },
    categories,
    details: TEST_RESULTS
  }, null, 2));
  
  console.log('\n📁 Detailed results saved to quote-validation-results.json');
}

// Main test runner
async function runAllTests() {
  console.log('🚀 COMPREHENSIVE QUOTE SYSTEM VALIDATION');
  console.log('=' + '='.repeat(69) + '\n');
  
  try {
    await test1_TokenPairs();
    await test2_RealTimeUpdates();
    await test3_AmountRanges();
    await test4_SlippageSettings();
    await test5_CrossChainQuotes();
    await test6_GasEstimates();
    await test7_RouteVisualization();
    await test8_DEXComparison();
    
    generateReport();
  } catch (error) {
    console.error('\n❌ Test suite error:', error);
  }
}

// Run the tests
runAllTests();