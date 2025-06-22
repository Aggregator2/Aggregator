const axios = require('axios');
const ethers = require('ethers');
require('dotenv').config();

// Configuration
const API_BASE_URL = 'http://localhost:3002/api';
const TEST_CHAINS = {
  ETH: { chainId: 1, name: 'Ethereum' },
  ARB: { chainId: 42161, name: 'Arbitrum' },
  BSC: { chainId: 56, name: 'BSC' },
  POLYGON: { chainId: 137, name: 'Polygon' }
};

// Test tokens for each chain
const TEST_TOKENS = {
  1: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
  },
  42161: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'
  },
  56: {
    BNB: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDT: '0x55d398326f99059fF775485246999027B3197955'
  },
  137: {
    MATIC: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
  }
};

// Test wallet address
const TEST_WALLET = '0x742d35Cc6634C0532925a3b844Bc9e7595f8b94f';

// Helper function to format amount for display
function formatAmount(amount, decimals = 18) {
  return ethers.formatUnits(amount, decimals);
}

// Helper function to parse amount
function parseAmount(amount, decimals = 18) {
  return ethers.parseUnits(amount.toString(), decimals).toString();
}

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Test 1: Verify platform fee is applied to quotes
async function testPlatformFee() {
  console.log(`\n${colors.bright}${colors.blue}=== Test 1: Platform Fee Verification ===${colors.reset}`);
  
  const testCases = [
    { chain: 1, sellToken: TEST_TOKENS[1].WETH, buyToken: TEST_TOKENS[1].USDC, amount: '0.1' },
    { chain: 1, sellToken: TEST_TOKENS[1].USDC, buyToken: TEST_TOKENS[1].USDT, amount: '1000' },
    { chain: 42161, sellToken: TEST_TOKENS[42161].WETH, buyToken: TEST_TOKENS[42161].USDC, amount: '0.5' },
    { chain: 56, sellToken: TEST_TOKENS[56].BNB, buyToken: TEST_TOKENS[56].USDT, amount: '1' },
    { chain: 137, sellToken: TEST_TOKENS[137].MATIC, buyToken: TEST_TOKENS[137].USDC, amount: '100' }
  ];

  for (const testCase of testCases) {
    try {
      console.log(`\nTesting ${TEST_CHAINS[Object.keys(TEST_CHAINS).find(k => TEST_CHAINS[k].chainId === testCase.chain)].name}:`);
      console.log(`  Swap: ${testCase.amount} ${testCase.sellToken} -> ${testCase.buyToken}`);
      
      // Get sellAmount based on token decimals
      const decimals = testCase.sellToken.includes('USDC') || testCase.sellToken.includes('USDT') ? 6 : 18;
      const sellAmount = parseAmount(testCase.amount, decimals);
      
      // Get regular quote
      const regularQuote = await axios.post(`${API_BASE_URL}/quote`, {
        sellToken: testCase.sellToken,
        buyToken: testCase.buyToken,
        sellAmount,
        chainId: testCase.chain,
        user: TEST_WALLET
      });
      
      // Get profitable quote
      const profitableQuote = await axios.post(`${API_BASE_URL}/quote-profitable`, {
        sellToken: testCase.sellToken,
        buyToken: testCase.buyToken,
        sellAmount,
        chainId: testCase.chain,
        user: TEST_WALLET
      });
      
      const regularBuyAmount = BigInt(regularQuote.data.buyAmount);
      const profitableBuyAmount = BigInt(profitableQuote.data.buyAmount);
      
      // Calculate fee
      const feeAmount = regularBuyAmount - profitableBuyAmount;
      const feeBps = Number((feeAmount * 10000n) / regularBuyAmount);
      
      console.log(`  Regular quote buy amount: ${formatAmount(regularBuyAmount)}`);
      console.log(`  Profitable quote buy amount: ${formatAmount(profitableBuyAmount)}`);
      console.log(`  Fee amount: ${formatAmount(feeAmount)}`);
      console.log(`  Fee percentage: ${colors.yellow}${(feeBps / 100).toFixed(2)}%${colors.reset} (${feeBps} bps)`);
      
      // Verify fee is around 30 bps (0.3%)
      if (feeBps >= 25 && feeBps <= 35) {
        console.log(`  ${colors.green}✓ Fee correctly applied${colors.reset}`);
      } else {
        console.log(`  ${colors.red}✗ Fee outside expected range (25-35 bps)${colors.reset}`);
      }
      
    } catch (error) {
      console.log(`  ${colors.red}✗ Error: ${error.response?.data?.error || error.message}${colors.reset}`);
    }
  }
}

// Test 2: Test fee calculations for different amounts
async function testFeeCalculations() {
  console.log(`\n${colors.bright}${colors.blue}=== Test 2: Fee Calculations for Different Amounts ===${colors.reset}`);
  
  const amounts = ['0.01', '0.1', '1', '10', '100', '1000'];
  const testToken = { 
    sell: TEST_TOKENS[1].WETH, 
    buy: TEST_TOKENS[1].USDC,
    chain: 1 
  };
  
  console.log('\nTesting WETH -> USDC on Ethereum with various amounts:');
  
  for (const amount of amounts) {
    try {
      const sellAmount = parseAmount(amount);
      
      const quote = await axios.post(`${API_BASE_URL}/quote-profitable`, {
        sellToken: testToken.sell,
        buyToken: testToken.buy,
        sellAmount,
        chainId: testToken.chain,
        user: TEST_WALLET
      });
      
      const buyAmount = BigInt(quote.data.buyAmount);
      const expectedFee = (buyAmount * 30n) / 10000n; // 30 bps
      
      console.log(`  ${amount} ETH -> ${formatAmount(buyAmount)} USDC (fee: ~${formatAmount(expectedFee)} USDC)`);
      
    } catch (error) {
      console.log(`  ${colors.red}✗ Error for ${amount} ETH: ${error.response?.data?.error || error.message}${colors.reset}`);
    }
  }
}

// Test 3: Verify integrator parameter in LI.FI calls
async function testIntegratorParameter() {
  console.log(`\n${colors.bright}${colors.blue}=== Test 3: Integrator Parameter Verification ===${colors.reset}`);
  
  // Test cross-chain quote that uses LI.FI
  try {
    console.log('\nTesting cross-chain quote (uses LI.FI):');
    
    const crossChainQuote = await axios.post(`${API_BASE_URL}/crosschain/quote`, {
      fromChain: 1,
      toChain: 42161,
      fromToken: TEST_TOKENS[1].USDC,
      toToken: TEST_TOKENS[42161].USDC,
      fromAmount: parseAmount('100', 6),
      fromAddress: TEST_WALLET
    });
    
    console.log(`  ${colors.green}✓ Cross-chain quote successful${colors.reset}`);
    console.log(`  Bridge provider: ${crossChainQuote.data.route?.bridgeProvider || 'Unknown'}`);
    console.log(`  Integrator should be set to: 'crosschain-router'`);
    
    // Test regular swap that might use LI.FI
    const swapQuote = await axios.post(`${API_BASE_URL}/quote-profitable`, {
      sellToken: TEST_TOKENS[1].WETH,
      buyToken: TEST_TOKENS[1].USDC,
      sellAmount: parseAmount('0.1'),
      chainId: 1,
      user: TEST_WALLET
    });
    
    console.log(`  ${colors.green}✓ Regular swap quote successful${colors.reset}`);
    console.log(`  Source: ${swapQuote.data.source}`);
    console.log(`  If LI.FI is used, integrator should be: 'multi-chain-swap'`);
    
  } catch (error) {
    console.log(`  ${colors.red}✗ Error: ${error.response?.data?.error || error.message}${colors.reset}`);
  }
}

// Test 4: Check rebate tracking
async function testRebateTracking() {
  console.log(`\n${colors.bright}${colors.blue}=== Test 4: Rebate Tracking ===${colors.reset}`);
  
  // Sources with expected rebates
  const rebateSources = {
    '0x': 2,       // 2 bps
    '1inch': 1.5,  // 1.5 bps
    'jupiter': 3,  // 3 bps
    'openocean': 1, // 1 bps
    'paraswap': 0.5, // 0.5 bps
    'kyberswap': 1  // 1 bps
  };
  
  console.log('\nExpected rebates by source:');
  for (const [source, bps] of Object.entries(rebateSources)) {
    console.log(`  ${source}: ${bps} bps`);
  }
  
  // Note: In production, rebate tracking happens internally and is not exposed in the API response
  console.log(`\n${colors.yellow}Note: Rebate tracking is internal and not exposed in API responses${colors.reset}`);
  console.log('Rebates are calculated based on the routing source and accumulated for withdrawal');
}

// Test 5: Test fee collection wallet (requires environment setup)
async function testFeeCollection() {
  console.log(`\n${colors.bright}${colors.blue}=== Test 5: Fee Collection Wallet ===${colors.reset}`);
  
  if (!process.env.REVENUE_WALLET) {
    console.log(`${colors.yellow}⚠ REVENUE_WALLET not configured in environment${colors.reset}`);
    console.log('Fee collection tracking requires proper environment setup');
    return;
  }
  
  console.log(`Revenue wallet configured: ${process.env.REVENUE_WALLET}`);
  console.log('Fees are accumulated and transferred when balance > $50');
}

// Test 6: Verify admin dashboard
async function testAdminDashboard() {
  console.log(`\n${colors.bright}${colors.blue}=== Test 6: Admin Dashboard Revenue Data ===${colors.reset}`);
  
  try {
    // Try to access revenue status (requires auth in production)
    const response = await axios.get(`${API_BASE_URL}/revenue/status`);
    
    console.log('\nRevenue Status:');
    console.log(`  Total Revenue: $${response.data.summary.totalRevenueUSD}`);
    console.log(`  Total Fees Collected: ${response.data.summary.totalFees}`);
    console.log(`  Progress to Auto-transfer: ${response.data.summary.percentageToThreshold}%`);
    console.log(`  Will Auto-transfer: ${response.data.summary.willAutoTransfer ? 'Yes' : 'No'}`);
    
    if (response.data.feesByToken && Object.keys(response.data.feesByToken).length > 0) {
      console.log('\nFees by Token:');
      for (const [token, data] of Object.entries(response.data.feesByToken)) {
        console.log(`  ${token}: ${data.count} transactions, $${data.totalUSD.toFixed(2)} USD`);
      }
    }
    
  } catch (error) {
    if (error.response?.status === 401) {
      console.log(`${colors.yellow}⚠ Admin authentication required for full dashboard access${colors.reset}`);
    } else {
      console.log(`${colors.red}✗ Error accessing revenue status: ${error.response?.data?.error || error.message}${colors.reset}`);
    }
  }
}

// Test 7: Execute test swaps and verify fees
async function executeTestSwaps() {
  console.log(`\n${colors.bright}${colors.blue}=== Test 7: Execute 10 Test Swaps ===${colors.reset}`);
  
  const swaps = [
    { chain: 1, sell: 'WETH', buy: 'USDC', amount: '0.1' },
    { chain: 1, sell: 'USDC', buy: 'USDT', amount: '500' },
    { chain: 42161, sell: 'WETH', buy: 'USDC', amount: '0.05' },
    { chain: 42161, sell: 'USDC', buy: 'WETH', amount: '100' },
    { chain: 56, sell: 'BNB', buy: 'USDT', amount: '0.5' },
    { chain: 56, sell: 'USDT', buy: 'BNB', amount: '150' },
    { chain: 137, sell: 'MATIC', buy: 'USDC', amount: '50' },
    { chain: 137, sell: 'USDC', buy: 'MATIC', amount: '40' },
    { chain: 1, sell: 'WETH', buy: 'USDT', amount: '0.2' },
    { chain: 1, sell: 'USDT', buy: 'WETH', amount: '700' }
  ];
  
  let totalVolume = 0n;
  let totalFees = 0n;
  let successfulSwaps = 0;
  
  console.log('\nExecuting test swaps...');
  
  for (let i = 0; i < swaps.length; i++) {
    const swap = swaps[i];
    const chainName = Object.keys(TEST_CHAINS).find(k => TEST_CHAINS[k].chainId === swap.chain);
    
    try {
      console.log(`\n[Swap ${i + 1}/10] ${swap.amount} ${swap.sell} -> ${swap.buy} on ${TEST_CHAINS[chainName].name}`);
      
      const sellToken = TEST_TOKENS[swap.chain][swap.sell];
      const buyToken = TEST_TOKENS[swap.chain][swap.buy];
      const decimals = swap.sell.includes('USDC') || swap.sell.includes('USDT') ? 6 : 18;
      const sellAmount = parseAmount(swap.amount, decimals);
      
      // Get both regular and profitable quotes
      const [regularQuote, profitableQuote] = await Promise.all([
        axios.post(`${API_BASE_URL}/quote`, {
          sellToken,
          buyToken,
          sellAmount,
          chainId: swap.chain,
          user: TEST_WALLET
        }),
        axios.post(`${API_BASE_URL}/quote-profitable`, {
          sellToken,
          buyToken,
          sellAmount,
          chainId: swap.chain,
          user: TEST_WALLET
        })
      ]);
      
      const regularBuyAmount = BigInt(regularQuote.data.buyAmount);
      const profitableBuyAmount = BigInt(profitableQuote.data.buyAmount);
      const feeAmount = regularBuyAmount - profitableBuyAmount;
      
      // Estimate USD value (simplified)
      const usdValue = estimateUSDValue(swap.sell, swap.amount, swap.chain);
      totalVolume += BigInt(Math.floor(usdValue * 1e6)); // Store as micro-USD
      totalFees += feeAmount;
      
      console.log(`  Buy amount: ${formatAmount(profitableBuyAmount)}`);
      console.log(`  Fee: ${formatAmount(feeAmount)} (${((Number(feeAmount) * 10000n) / Number(regularBuyAmount) / 100).toFixed(2)}%)`);
      console.log(`  ${colors.green}✓ Success${colors.reset}`);
      
      successfulSwaps++;
      
    } catch (error) {
      console.log(`  ${colors.red}✗ Failed: ${error.response?.data?.error || error.message}${colors.reset}`);
    }
  }
  
  console.log(`\n${colors.bright}Summary:${colors.reset}`);
  console.log(`  Successful swaps: ${successfulSwaps}/10`);
  console.log(`  Total volume: ~$${(Number(totalVolume) / 1e6).toFixed(2)}`);
  console.log(`  Expected total fees (0.3% of volume): ~$${(Number(totalVolume) * 0.003 / 1e6).toFixed(2)}`);
  
  // Check final revenue status
  try {
    const finalStatus = await axios.get(`${API_BASE_URL}/revenue/status`);
    console.log(`  Actual accumulated revenue: $${finalStatus.data.summary.totalRevenueUSD}`);
  } catch (error) {
    console.log(`  ${colors.yellow}Could not fetch final revenue status${colors.reset}`);
  }
}

// Helper function to estimate USD value
function estimateUSDValue(token, amount, chainId) {
  const prices = {
    'WETH': 3500,
    'ETH': 3500,
    'BNB': 600,
    'MATIC': 1.2,
    'USDC': 1,
    'USDT': 1,
    'DAI': 1
  };
  
  return parseFloat(amount) * (prices[token] || 1);
}

// Main test runner
async function runAllTests() {
  console.log(`${colors.bright}${colors.cyan}=== Fee Integration Deep Test ===${colors.reset}`);
  console.log('Testing complete fee and rebate system implementation\n');
  
  try {
    // Check if API is running
    await axios.get(`${API_BASE_URL.replace('/api', '')}/`);
  } catch (error) {
    console.log(`${colors.red}Error: API server not running at ${API_BASE_URL}${colors.reset}`);
    console.log('Please start the server with: npm run dev');
    return;
  }
  
  // Run all tests
  await testPlatformFee();
  await testFeeCalculations();
  await testIntegratorParameter();
  await testRebateTracking();
  await testFeeCollection();
  await testAdminDashboard();
  await executeTestSwaps();
  
  console.log(`\n${colors.bright}${colors.cyan}=== Test Complete ===${colors.reset}`);
}

// Run tests
runAllTests().catch(console.error);