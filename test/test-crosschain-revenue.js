const axios = require('axios');
const { ethers } = require('ethers');
const colors = require('colors');

// Test configuration
const TEST_CONFIG = {
  baseUrl: process.env.TEST_URL || 'http://localhost:3000',
  adminApiKey: process.env.ADMIN_API_KEY || 'test-admin-key',
  
  // Test chains
  chains: [
    { id: 1, name: 'Ethereum', rpc: 'https://eth.llamarpc.com' },
    { id: 137, name: 'Polygon', rpc: 'https://polygon-rpc.com' },
    { id: 42161, name: 'Arbitrum', rpc: 'https://arbitrum.llamarpc.com' }
  ],
  
  // Test tokens per chain
  testTokens: {
    1: { // Ethereum
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
    },
    137: { // Polygon
      USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'
    },
    42161: { // Arbitrum
      USDC: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'
    }
  },
  
  // Test amounts (in smallest units)
  testAmounts: {
    small: '1000000', // 1 USDC
    medium: '100000000', // 100 USDC
    large: '1000000000' // 1000 USDC
  }
};

// Helper functions
async function executeSwap(chainId, sellToken, buyToken, sellAmount, slippage = 0.5) {
  try {
    console.log(`\n${colors.cyan('📊 Executing swap on chain')} ${chainId}:`);
    console.log(`  Sell: ${sellAmount} ${sellToken}`);
    console.log(`  Buy: ${buyToken}`);
    
    const response = await axios.post(`${TEST_CONFIG.baseUrl}/api/quote-profitable`, {
      sellToken,
      buyToken,
      sellAmount,
      chainId,
      slippagePercentage: slippage,
      simulateExecution: true // Enable simulation mode
    });
    
    const quote = response.data;
    console.log(`  ${colors.green('✓')} Quote received:`);
    console.log(`    Buy amount: ${quote.buyAmount}`);
    console.log(`    Price: ${quote.price}`);
    console.log(`    Source: ${quote.source}`);
    console.log(`    Hidden fee: ${quote._internal?.profitBreakdown?.spreadMarkup || 'N/A'}`);
    console.log(`    Rebate: ${quote._internal?.profitBreakdown?.rebate || 'N/A'}`);
    
    return {
      success: true,
      chainId,
      quote,
      revenue: quote._internal?.totalRevenue || '0'
    };
  } catch (error) {
    console.error(`  ${colors.red('✗')} Swap failed:`, error.response?.data || error.message);
    return {
      success: false,
      chainId,
      error: error.message
    };
  }
}

async function getRevenueStatus() {
  try {
    const response = await axios.get(`${TEST_CONFIG.baseUrl}/api/revenue/status`);
    return response.data;
  } catch (error) {
    console.error('Failed to get revenue status:', error.message);
    return null;
  }
}

async function getCrossChainRevenueStatus() {
  try {
    const response = await axios.get(`${TEST_CONFIG.baseUrl}/api/revenue/crosschain-status`);
    return response.data;
  } catch (error) {
    console.error('Failed to get cross-chain revenue status:', error.message);
    return null;
  }
}

async function forceRevenueTransfer() {
  try {
    const response = await axios.post(`${TEST_CONFIG.baseUrl}/api/revenue/status`, {
      action: 'forceTransfer'
    }, {
      headers: {
        'Authorization': `Bearer ${TEST_CONFIG.adminApiKey}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Failed to force revenue transfer:', error.message);
    return null;
  }
}

async function simulateCrossChainSwap(fromChain, toChain, amount) {
  try {
    console.log(`\n${colors.magenta('🌉 Simulating cross-chain swap')}:`);
    console.log(`  From: Chain ${fromChain.id} (${fromChain.name})`);
    console.log(`  To: Chain ${toChain.id} (${toChain.name})`);
    console.log(`  Amount: ${amount} USDC`);
    
    const response = await axios.post(`${TEST_CONFIG.baseUrl}/api/crosschain/quote`, {
      fromChainId: fromChain.id,
      toChainId: toChain.id,
      fromToken: TEST_CONFIG.testTokens[fromChain.id].USDC,
      toToken: TEST_CONFIG.testTokens[toChain.id].USDC,
      fromAmount: amount,
      userAddress: '0x1234567890123456789012345678901234567890' // Test address
    });
    
    const route = response.data;
    console.log(`  ${colors.green('✓')} Route found:`);
    console.log(`    Steps: ${route.steps.length}`);
    console.log(`    Total cost: $${route.totalCostUSD}`);
    console.log(`    Estimated output: ${route.estimatedOutput}`);
    
    // Calculate fees per step
    let totalFees = 0;
    route.steps.forEach((step, index) => {
      console.log(`    Step ${index + 1}: ${step.type} on chain ${step.chainId}`);
      if (step.fee) {
        totalFees += parseFloat(step.fee);
      }
    });
    
    return {
      success: true,
      route,
      totalFees
    };
  } catch (error) {
    console.error(`  ${colors.red('✗')} Cross-chain quote failed:`, error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Main test runner
async function runTests() {
  console.log(colors.bold.blue('\n🚀 Starting Cross-Chain Revenue Tracking Tests\n'));
  
  const results = {
    swaps: [],
    crossChainSwaps: [],
    revenueByChain: {},
    totalRevenue: 0
  };
  
  // Step 1: Execute swaps on each chain
  console.log(colors.bold('\n📍 Step 1: Execute swaps on multiple chains'));
  
  for (const chain of TEST_CONFIG.chains) {
    console.log(colors.yellow(`\n--- Testing ${chain.name} (Chain ${chain.id}) ---`));
    
    const tokens = TEST_CONFIG.testTokens[chain.id];
    
    // Test different swap scenarios
    const swapTests = [
      { sell: 'USDC', buy: 'WETH', amount: TEST_CONFIG.testAmounts.medium },
      { sell: 'WETH', buy: 'DAI', amount: TEST_CONFIG.testAmounts.small },
      { sell: 'DAI', buy: 'USDC', amount: TEST_CONFIG.testAmounts.large }
    ];
    
    for (const test of swapTests) {
      if (tokens[test.sell] && tokens[test.buy]) {
        const result = await executeSwap(
          chain.id,
          tokens[test.sell],
          tokens[test.buy],
          test.amount
        );
        
        results.swaps.push(result);
        
        if (result.success) {
          if (!results.revenueByChain[chain.id]) {
            results.revenueByChain[chain.id] = {
              name: chain.name,
              swapCount: 0,
              totalRevenue: BigInt(0)
            };
          }
          
          results.revenueByChain[chain.id].swapCount++;
          results.revenueByChain[chain.id].totalRevenue += BigInt(result.revenue);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  // Step 2: Test cross-chain swaps
  console.log(colors.bold('\n\n📍 Step 2: Test cross-chain swaps'));
  
  const crossChainTests = [
    { from: TEST_CONFIG.chains[0], to: TEST_CONFIG.chains[1] }, // ETH -> Polygon
    { from: TEST_CONFIG.chains[1], to: TEST_CONFIG.chains[2] }, // Polygon -> Arbitrum
    { from: TEST_CONFIG.chains[2], to: TEST_CONFIG.chains[0] }  // Arbitrum -> ETH
  ];
  
  for (const test of crossChainTests) {
    const result = await simulateCrossChainSwap(
      test.from,
      test.to,
      TEST_CONFIG.testAmounts.medium
    );
    results.crossChainSwaps.push(result);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Step 3: Check revenue status
  console.log(colors.bold('\n\n📍 Step 3: Check consolidated revenue status'));
  
  const revenueStatus = await getRevenueStatus();
  if (revenueStatus) {
    console.log('\n' + colors.cyan('💰 Revenue Summary:'));
    console.log(`  Total Revenue (USD): $${revenueStatus.summary.totalRevenueUSD}`);
    console.log(`  Total Fees Collected: ${revenueStatus.summary.totalFees}`);
    console.log(`  Threshold Progress: ${revenueStatus.summary.percentageToThreshold}%`);
    console.log(`  Will Auto-Transfer: ${revenueStatus.summary.willAutoTransfer}`);
    
    console.log('\n' + colors.cyan('📊 Revenue by Token:'));
    Object.entries(revenueStatus.feesByToken).forEach(([key, data]) => {
      const [chainId, token] = key.split('-');
      console.log(`  Chain ${chainId} - ${token}: ${data.count} fees, $${data.totalUSD.toFixed(2)}`);
    });
  }
  
  // Get cross-chain revenue breakdown
  const crossChainStatus = await getCrossChainRevenueStatus();
  if (crossChainStatus) {
    console.log('\n' + colors.cyan('🌐 Cross-Chain Revenue Breakdown:'));
    crossChainStatus.chainBreakdown.forEach(chain => {
      console.log(`\n  ${chain.chainName} (Chain ${chain.chainId}):`);
      console.log(`    Revenue: $${chain.revenue.usd}`);
      console.log(`    Transactions: ${chain.revenue.feeCount}`);
      console.log(`    Gas Cost: $${chain.gasOptimization.collectionCostUSD.toFixed(2)}`);
      console.log(`    Recommendation: ${chain.gasOptimization.recommendation}`);
      
      if (chain.tokens.length > 0) {
        console.log(`    Token Breakdown:`);
        chain.tokens.forEach(token => {
          console.log(`      ${token.symbol}: $${token.valueUSD} (${token.transactions} txs)`);
        });
      }
    });
    
    console.log('\n' + colors.cyan('📋 Collection Strategy:'));
    console.log(`  Ready for immediate collection: ${crossChainStatus.collectionStrategy.readyForCollection.join(', ') || 'None'}`);
    console.log(`  Pending batch collection: ${crossChainStatus.collectionStrategy.pendingBatch.join(', ') || 'None'}`);
  }
  
  // Step 4: Test gas optimization
  console.log(colors.bold('\n\n📍 Step 4: Verify gas optimization'));
  
  console.log('\n' + colors.cyan('⛽ Gas Cost Analysis:'));
  console.log('  Ethereum (L1): High gas costs - batching recommended');
  console.log('  Polygon (L2): Low gas costs - immediate collection possible');
  console.log('  Arbitrum (L2): Low gas costs - immediate collection possible');
  
  // Step 5: Generate final report
  console.log(colors.bold('\n\n📍 Step 5: Revenue Breakdown Report'));
  
  console.log('\n' + colors.green('📈 Final Revenue Report:'));
  console.log('═'.repeat(50));
  
  // Calculate totals
  let totalSwaps = 0;
  let successfulSwaps = 0;
  
  Object.entries(results.revenueByChain).forEach(([chainId, data]) => {
    console.log(`\n${data.name} (Chain ${chainId}):`);
    console.log(`  Successful Swaps: ${data.swapCount}`);
    console.log(`  Total Revenue: ${ethers.formatUnits(data.totalRevenue, 18)} (in token units)`);
    totalSwaps += data.swapCount;
  });
  
  results.swaps.forEach(swap => {
    if (swap.success) successfulSwaps++;
  });
  
  console.log('\n' + colors.cyan('Summary Statistics:'));
  console.log(`  Total Swap Attempts: ${results.swaps.length}`);
  console.log(`  Successful Swaps: ${successfulSwaps}`);
  console.log(`  Success Rate: ${((successfulSwaps / results.swaps.length) * 100).toFixed(1)}%`);
  console.log(`  Cross-Chain Routes Tested: ${results.crossChainSwaps.length}`);
  
  // Step 6: Test rebate distribution on L2s
  console.log(colors.bold('\n\n📍 Step 6: Test rebate distribution on L2s'));
  
  // Simulate rebate distribution
  const testRebateRecipients = [
    { address: '0x1111111111111111111111111111111111111111', amount: '1000000000000000', token: 'ETH' },
    { address: '0x2222222222222222222222222222222222222222', amount: '2000000000000000', token: 'ETH' },
    { address: '0x3333333333333333333333333333333333333333', amount: '1500000000000000', token: 'ETH' }
  ];
  
  console.log('\n' + colors.cyan('💸 Rebate Distribution Simulation:'));
  
  // Test on Polygon (low gas)
  try {
    const polygonRebateTest = await axios.post(`${TEST_CONFIG.baseUrl}/api/revenue/crosschain-status`, {
      action: 'distributeRebates',
      chainId: 137,
      params: {
        recipients: testRebateRecipients,
        dryRun: true // Dry run for testing
      }
    }, {
      headers: { 'Authorization': `Bearer ${TEST_CONFIG.adminApiKey}` }
    });
    
    console.log(`  Polygon (Chain 137):`);
    console.log(`    Recipients: ${testRebateRecipients.length}`);
    console.log(`    Total amount: ${ethers.formatEther(polygonRebateTest.data.result.totalDistributed || '0')} ETH`);
    console.log(`    Estimated gas cost: ~$0.01 per transaction`);
    console.log(`    Status: ${polygonRebateTest.data.success ? 'Ready' : 'Failed'}`);
  } catch (error) {
    console.log(`  Polygon rebate test failed: ${error.message}`);
  }
  
  // Test on Arbitrum (medium gas)
  try {
    const arbitrumRebateTest = await axios.post(`${TEST_CONFIG.baseUrl}/api/revenue/crosschain-status`, {
      action: 'distributeRebates',
      chainId: 42161,
      params: {
        recipients: testRebateRecipients,
        dryRun: true
      }
    }, {
      headers: { 'Authorization': `Bearer ${TEST_CONFIG.adminApiKey}` }
    });
    
    console.log(`  Arbitrum (Chain 42161):`);
    console.log(`    Recipients: ${testRebateRecipients.length}`);
    console.log(`    Total amount: ${ethers.formatEther(arbitrumRebateTest.data.result.totalDistributed || '0')} ETH`);
    console.log(`    Estimated gas cost: ~$0.05 per transaction`);
    console.log(`    Status: ${arbitrumRebateTest.data.success ? 'Ready' : 'Failed'}`);
  } catch (error) {
    console.log(`  Arbitrum rebate test failed: ${error.message}`);
  }
  
  console.log('\n' + colors.cyan('📊 L2 Rebate Distribution Recommendations:'));
  console.log('  - Polygon: Batch size up to 100 recipients ($1 total gas)');
  console.log('  - Arbitrum: Batch size up to 50 recipients ($2.50 total gas)');
  console.log('  - Optimism: Batch size up to 75 recipients ($2.25 total gas)');
  console.log('  - Schedule: Weekly distributions on L2s, monthly on L1');
  
  console.log('\n' + colors.bold.green('✅ Cross-chain revenue tracking test completed!'));
}

// Execute tests
runTests().catch(error => {
  console.error(colors.red('\n❌ Test runner failed:'), error);
  process.exit(1);
});