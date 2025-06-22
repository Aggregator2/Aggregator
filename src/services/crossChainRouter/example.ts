import { ethers } from 'ethers';
import { CrossChainRouter } from './CrossChainRouter';
import { CrossChainSwapRequest } from './types';

/**
 * Example: Swap ETH on Ethereum to USDC on BNB Chain
 */
async function exampleCrossChainSwap() {
  // Initialize providers for each chain you'll use
  const providers = new Map<number, ethers.Provider>([
    [1, new ethers.JsonRpcProvider('https://eth.llamarpc.com')],
    [56, new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org')]
  ]);

  // Initialize signers (in production, these would come from user's wallet)
  const privateKey = process.env.PRIVATE_KEY || '';
  const signers = new Map<number, ethers.Signer>([
    [1, new ethers.Wallet(privateKey, providers.get(1))],
    [56, new ethers.Wallet(privateKey, providers.get(56))]
  ]);

  // Create router instance
  const router = new CrossChainRouter({ providers, signers });

  // Define swap parameters
  const swapRequest: CrossChainSwapRequest = {
    sourceChainId: 1,              // Ethereum
    destinationChainId: 56,         // BSC
    sourceToken: ethers.ZeroAddress, // ETH (native)
    destinationToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC on BSC
    sourceAmount: ethers.parseEther('1').toString(), // 1 ETH
    recipientAddress: '0xYourAddress',
    slippageTolerance: 300,         // 3%
    preferredBridges: ['lifi', 'synapse'] // Optional: prefer these bridges
  };

  try {
    // Step 1: Get available routes
    console.log('Finding optimal routes...');
    const routes = await router.getRoutes(swapRequest);
    
    console.log(`Found ${routes.length} routes:`);
    routes.forEach((route, index) => {
      console.log(`\nRoute ${index + 1}:`);
      console.log(`  Output: ${ethers.formatUnits(route.estimatedOutput, 6)} USDC`);
      console.log(`  Total Cost: $${(route.totalFeeUSD + route.totalGasCostUSD).toFixed(2)}`);
      console.log(`  Time: ${Math.round(route.estimatedTime / 60)} minutes`);
      console.log(`  Steps: ${route.steps.length}`);
      route.steps.forEach((step, stepIndex) => {
        console.log(`    ${stepIndex + 1}. ${step.type} on ${step.protocol}: ${step.fromToken.symbol} → ${step.toToken.symbol}`);
      });
    });

    // Step 2: Get a quote (uses best route)
    const quote = await router.getQuote(swapRequest);
    console.log('\nBest Route Quote:');
    console.log(`  You will receive: ${ethers.formatUnits(quote.outputAmount, 6)} USDC`);
    console.log(`  Price Impact: ${(quote.priceImpact / 100).toFixed(2)}%`);
    console.log(`  Total Fees: $${quote.totalFeeUSD.toFixed(2)}`);
    console.log(`  Estimated Time: ${Math.round(quote.executionTime / 60)} minutes`);

    // Step 3: Execute the swap (requires signer)
    const userConfirmed = false; // Set to true after user confirms
    if (userConfirmed) {
      console.log('\nExecuting swap...');
      const result = await router.executeSwap(swapRequest);
      
      if (result.success) {
        console.log('Swap completed successfully!');
        console.log(`Final amount received: ${ethers.formatUnits(result.finalAmount || '0', 6)} USDC`);
        console.log('Transactions:');
        result.transactions.forEach(tx => {
          console.log(`  Chain ${tx.chainId}: ${tx.txHash}`);
        });
      } else {
        console.error('Swap failed:', result.error);
      }
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example: Get supported chains and tokens
 */
async function exampleGetSupportedAssets() {
  const router = new CrossChainRouter();

  // Get supported chains
  const chains = router.getSupportedChains();
  console.log('Supported chains:', chains);

  // Get popular tokens for Ethereum
  const ethereumTokens = await router.getSupportedTokens(1);
  console.log('\nPopular Ethereum tokens:');
  ethereumTokens.forEach(token => {
    console.log(`  ${token.symbol}: ${token.address}`);
  });

  // Get popular tokens for BSC
  const bscTokens = await router.getSupportedTokens(56);
  console.log('\nPopular BSC tokens:');
  bscTokens.forEach(token => {
    console.log(`  ${token.symbol}: ${token.address}`);
  });
}

/**
 * Example: Complex multi-hop swap
 * MATIC on Polygon → ETH on Arbitrum
 */
async function exampleComplexSwap() {
  const router = new CrossChainRouter();

  const swapRequest: CrossChainSwapRequest = {
    sourceChainId: 137,            // Polygon
    destinationChainId: 42161,     // Arbitrum
    sourceToken: ethers.ZeroAddress, // MATIC (native)
    destinationToken: ethers.ZeroAddress, // ETH (native)
    sourceAmount: ethers.parseEther('1000').toString(), // 1000 MATIC
    recipientAddress: '0xYourAddress',
    slippageTolerance: 500,        // 5% for complex route
    maxPriceImpact: 1000          // Max 10% price impact
  };

  try {
    const routes = await router.getRoutes(swapRequest);
    
    // Analyze routes
    routes.forEach((route, index) => {
      console.log(`\nRoute ${index + 1} Analysis:`);
      
      // Check if it's a multi-hop route
      const uniqueChains = new Set(route.steps.map(s => s.chainId));
      if (uniqueChains.size > 2) {
        console.log('  Type: Multi-hop (via hub chain)');
      } else {
        console.log('  Type: Direct bridge');
      }
      
      // Show path
      console.log('  Path:');
      route.steps.forEach((step, i) => {
        const arrow = i < route.steps.length - 1 ? ' →' : '';
        console.log(`    ${step.fromToken.symbol} (Chain ${step.chainId})${arrow}`);
      });
      console.log(`    ${route.steps[route.steps.length - 1].toToken.symbol} (Chain ${route.steps[route.steps.length - 1].toToken.chainId})`);
      
      // Show protocols used
      const protocols = route.steps.map(s => s.protocol);
      console.log('  Protocols:', protocols.join(' → '));
      
      // Estimated output
      console.log(`  Output: ${ethers.formatEther(route.estimatedOutput)} ETH`);
      console.log(`  Reliability Score: ${route.reliability}/100`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example: Monitor ongoing swap
 */
async function exampleMonitorSwap() {
  const router = new CrossChainRouter();
  
  // These would come from a previous executeSwap call
  const routeId = 'route-123';
  const transactions: any[] = [
    { stepIndex: 0, chainId: 1, txHash: '0x...', status: 'success' },
    { stepIndex: 1, chainId: 1, txHash: '0x...', status: 'pending' }
  ];
  
  // Check status
  const status = await router.checkSwapStatus(routeId, transactions);
  
  console.log('Swap Status:');
  console.log(`  Status: ${status.status}`);
  console.log(`  Current Step: ${status.currentStep + 1}/${transactions.length}`);
  console.log(`  Completed Steps: ${status.completedSteps}`);
  
  if (status.error) {
    console.log(`  Error: ${status.error}`);
  }
}

/**
 * Example: Handle edge cases
 */
async function exampleEdgeCases() {
  const router = new CrossChainRouter();

  // Edge case 1: Insufficient liquidity
  try {
    const swapRequest: CrossChainSwapRequest = {
      sourceChainId: 1,
      destinationChainId: 56,
      sourceToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      destinationToken: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC on BSC
      sourceAmount: ethers.parseUnits('10000000', 6).toString(), // 10M USDC
      recipientAddress: '0xYourAddress'
    };
    
    const routes = await router.getRoutes(swapRequest);
    console.log('Large swap routes found:', routes.length);
  } catch (error) {
    console.error('Large swap error:', error);
  }

  // Edge case 2: Unsupported token pair
  try {
    const swapRequest: CrossChainSwapRequest = {
      sourceChainId: 1,
      destinationChainId: 56,
      sourceToken: '0xObscureToken',
      destinationToken: '0xAnotherObscureToken',
      sourceAmount: '1000000',
      recipientAddress: '0xYourAddress'
    };
    
    const routes = await router.getRoutes(swapRequest);
    console.log('Obscure token routes:', routes.length);
  } catch (error) {
    console.error('Unsupported token error:', error);
  }
}

// Run examples
if (require.main === module) {
  (async () => {
    console.log('=== Cross-Chain Router Examples ===\n');
    
    console.log('1. Getting supported assets...');
    await exampleGetSupportedAssets();
    
    console.log('\n2. Complex multi-hop swap example...');
    await exampleComplexSwap();
    
    console.log('\n3. Edge cases...');
    await exampleEdgeCases();
    
    // Uncomment to run actual swap (requires private key)
    // console.log('\n4. Executing cross-chain swap...');
    // await exampleCrossChainSwap();
  })();
}