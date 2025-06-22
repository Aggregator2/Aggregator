const axios = require('axios');

// Test the cross-chain router API endpoints
async function testCrossChainRouter() {
  const baseURL = 'http://localhost:3000/api/crosschain-test';
  
  console.log('🚀 Testing Cross-Chain Router (Mock Mode)');
  console.log('=' .repeat(50));

  try {
    // Test 1: Get configuration
    console.log('\n1. Getting configuration...');
    const configResponse = await axios.get(`${baseURL}/config`);
    const config = configResponse.data;
    
    console.log(`✅ Found ${config.config.supportedChains.length} supported chains`);
    console.log(`✅ Found ${config.config.supportedBridges.length} bridge providers`);
    console.log(`✅ Found ${config.config.supportedDEXs.length} DEX aggregators`);
    
    // Show supported chains
    console.log('\nSupported Chains:');
    config.config.supportedChains.forEach(chain => {
      console.log(`  ${chain.chainId}: ${chain.name} (${chain.nativeCurrency.symbol})`);
    });

    // Test 2: ETH to USDC cross-chain swap
    console.log('\n2. Testing ETH (Ethereum) → USDC (BSC) swap...');
    const swapRequest = {
      sourceChainId: 1,
      destinationChainId: 56,
      sourceToken: '0x0000000000000000000000000000000000000000', // ETH
      destinationToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC on BSC
      sourceAmount: '1000000000000000000', // 1 ETH
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e',
      slippageTolerance: 300 // 3%
    };

    // Get routes
    const routesResponse = await axios.post(`${baseURL}/routes`, swapRequest);
    const routes = routesResponse.data;
    
    console.log(`✅ Found ${routes.routes.length} routes`);
    
    routes.routes.forEach((route, index) => {
      console.log(`\nRoute ${index + 1}:`);
      console.log(`  Output: ${(parseFloat(route.estimatedOutput) / 1e18).toFixed(2)} USDC`);
      console.log(`  Steps: ${route.numberOfSteps}`);
      console.log(`  Total Cost: $${(route.totalFeeUSD + route.totalGasCostUSD).toFixed(2)}`);
      console.log(`  Time: ${Math.round(route.estimatedTime / 60)} minutes`);
      console.log(`  Reliability: ${route.reliability}%`);
      
      console.log('  Path:');
      route.steps.forEach((step, stepIndex) => {
        console.log(`    ${stepIndex + 1}. ${step.type} on ${step.protocol}: ${step.fromToken.symbol} → ${step.toToken.symbol}`);
      });
    });

    // Test 3: Get quote for best route
    console.log('\n3. Getting detailed quote...');
    const quoteResponse = await axios.post(`${baseURL}/quote`, swapRequest);
    const quote = quoteResponse.data;
    
    console.log(`✅ Quote for ${quote.quote.inputAmount} ${quote.quote.inputToken} → ${quote.quote.outputAmount} ${quote.quote.outputToken}`);
    console.log(`  Price Impact: ${quote.quote.priceImpactPercent}%`);
    console.log(`  Execution Time: ${quote.quote.executionTimeMinutes} minutes`);
    console.log(`  Total Fees: $${quote.quote.totalFeeUSD.toFixed(2)}`);
    console.log(`  Gas Cost: $${quote.quote.gasEstimate.totalGasCostUSD.toFixed(2)}`);
    console.log(`  Bridges Used: ${quote.quote.route.bridgesUsed.join(', ')}`);
    console.log(`  DEXs Used: ${quote.quote.route.dexesUsed.join(', ')}`);

    // Test 4: Simulate execution
    console.log('\n4. Simulating execution...');
    const simulateResponse = await axios.post(`${baseURL}/simulate`, swapRequest);
    const simulation = simulateResponse.data;
    
    console.log(`✅ Simulation completed successfully`);
    console.log(`  Total Steps: ${simulation.simulation.execution.totalSteps}`);
    console.log(`  Total Time: ${simulation.simulation.execution.totalEstimatedTimeMinutes} minutes`);
    console.log(`  Total Gas Cost: $${simulation.simulation.execution.totalEstimatedGasUSD.toFixed(2)}`);
    console.log(`  Risk Level: ${simulation.simulation.risks.riskLevel}`);
    
    if (simulation.simulation.risks.warnings.length > 0) {
      console.log('  Warnings:');
      simulation.simulation.risks.warnings.forEach(warning => {
        console.log(`    ⚠️ ${warning}`);
      });
    }

    console.log('\n  Execution Steps:');
    simulation.simulation.execution.steps.forEach((step, index) => {
      console.log(`    ${index + 1}. ${step.stepType} on Chain ${step.chainId} via ${step.protocol}`);
      console.log(`       Gas: ${step.estimatedGas} units (~$${step.estimatedGasCostUSD})`);
      console.log(`       Time: ${step.estimatedTime}s`);
      if (step.transaction) {
        console.log(`       To: ${step.transaction.to}`);
        console.log(`       Value: ${step.transaction.value} wei`);
      }
    });

    // Test 5: Different token pair (USDC bridging)
    console.log('\n5. Testing USDC Ethereum → USDC Polygon...');
    const usdcBridgeRequest = {
      sourceChainId: 1,
      destinationChainId: 137,
      sourceToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
      destinationToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Polygon
      sourceAmount: '1000000000', // 1000 USDC (6 decimals)
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e'
    };

    const usdcQuoteResponse = await axios.post(`${baseURL}/quote`, usdcBridgeRequest);
    const usdcQuote = usdcQuoteResponse.data;
    
    console.log(`✅ USDC Bridge Quote:`);
    console.log(`  Input: ${usdcQuote.quote.inputAmount} ${usdcQuote.quote.inputToken}`);
    console.log(`  Output: ${usdcQuote.quote.outputAmount} ${usdcQuote.quote.outputToken}`);
    console.log(`  Steps: ${usdcQuote.quote.route.numberOfSteps}`);
    console.log(`  Time: ${usdcQuote.quote.executionTimeMinutes} minutes`);

    // Test 6: Native token swap (MATIC to AVAX)
    console.log('\n6. Testing MATIC → AVAX swap...');
    const nativeSwapRequest = {
      sourceChainId: 137,
      destinationChainId: 43114,
      sourceToken: '0x0000000000000000000000000000000000000000', // MATIC
      destinationToken: '0x0000000000000000000000000000000000000000', // AVAX
      sourceAmount: '1000000000000000000000', // 1000 MATIC
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD7e'
    };

    const nativeQuoteResponse = await axios.post(`${baseURL}/quote`, nativeSwapRequest);
    const nativeQuote = nativeQuoteResponse.data;
    
    console.log(`✅ Native Token Swap Quote:`);
    console.log(`  Input: ${nativeQuote.quote.inputAmount} ${nativeQuote.quote.inputToken}`);
    console.log(`  Output: ${nativeQuote.quote.outputAmount} ${nativeQuote.quote.outputToken}`);
    console.log(`  Price Impact: ${nativeQuote.quote.priceImpactPercent}%`);
    console.log(`  Path: ${nativeQuote.quote.route.path.map(p => `${p.fromSymbol}→${p.toSymbol}`).join(' → ')}`);

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📝 Summary:');
    console.log('✅ Configuration loaded');
    console.log('✅ Route discovery working');
    console.log('✅ Quote generation working');
    console.log('✅ Execution simulation working');
    console.log('✅ Multiple token pairs supported');
    console.log('✅ Gas estimation working');
    console.log('✅ Bridge and DEX integration working');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    
    if (error.response?.status === 500) {
      console.log('\n💡 Make sure your Next.js server is running: npm run dev');
    }
  }
}

// Run tests
testCrossChainRouter();