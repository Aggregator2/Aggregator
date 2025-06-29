const { LiquidityAggregator, SmartOrderRouter, BaseConnector } = require('./dist/index');

// Mock connector implementation
class MockDEX extends BaseConnector {
  constructor(name, priceMultiplier = 1) {
    super({ name, type: 'DEX', chainId: 1 });
    this.priceMultiplier = priceMultiplier;
  }
  
  async doConnect() {
    console.log(`✓ ${this.source.name} connected`);
  }
  
  async doDisconnect() {
    console.log(`✓ ${this.source.name} disconnected`);
  }
  
  async getQuote(request) {
    const price = 2000 * this.priceMultiplier;
    const amountOut = (Number(request.amountIn) / (10 ** request.tokenIn.decimals)) * 
                      price * (10 ** request.tokenOut.decimals);
    
    return {
      source: this.source,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: BigInt(Math.floor(amountOut)),
      price,
      priceImpact: 0.1,
      gasEstimate: BigInt(150000),
      timestamp: Date.now()
    };
  }
  
  async getLiquidityPools(pair) {
    return [{
      source: this.source,
      pair,
      reserves: {
        tokenA: BigInt('1000000000000000000000'),
        tokenB: BigInt('2000000000000')
      },
      fee: 30,
      lastUpdate: Date.now()
    }];
  }
}

async function demo() {
  console.log('=== Liquidity Aggregator Working Demo ===\n');
  
  // Define tokens
  const WETH = {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18,
    chainId: 1
  };
  
  const USDC = {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6,
    chainId: 1
  };
  
  // Create aggregator
  const aggregator = new LiquidityAggregator();
  
  // Add mock DEXs
  console.log('1. Adding liquidity sources...');
  aggregator.addConnector(new MockDEX('Uniswap', 1.0));
  aggregator.addConnector(new MockDEX('SushiSwap', 0.995));
  aggregator.addConnector(new MockDEX('Curve', 1.005));
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Get quotes
  console.log('\n2. Getting quotes for 1 WETH -> USDC...');
  const request = {
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: BigInt('1000000000000000000'), // 1 WETH
    slippageTolerance: 50
  };
  
  const quotes = await aggregator.getQuotes(request);
  quotes.forEach(quote => {
    const amount = Number(quote.amountOut) / (10 ** USDC.decimals);
    console.log(`   ${quote.source.name}: ${amount.toFixed(2)} USDC (price: $${quote.price.toFixed(2)})`);
  });
  
  // Find best route
  console.log('\n3. Finding best route...');
  const route = await aggregator.findBestRoute(request);
  if (route) {
    const amount = Number(route.totalAmountOut) / (10 ** USDC.decimals);
    console.log(`   Best route: ${route.quotes[0].source.name}`);
    console.log(`   Output: ${amount.toFixed(2)} USDC`);
    console.log(`   Gas estimate: ${route.totalGasEstimate} wei`);
  }
  
  // Get liquidity pools
  console.log('\n4. Checking liquidity pools...');
  const pools = await aggregator.getAllLiquidity({ tokenA: WETH, tokenB: USDC });
  console.log(`   Found ${pools.length} pools across all DEXs`);
  
  // Monitor prices
  console.log('\n5. Monitoring prices (5 seconds)...');
  let updates = 0;
  const unsubscribe = aggregator.subscribeToPriceUpdates(
    { tokenA: WETH, tokenB: USDC },
    (price) => {
      updates++;
      console.log(`   [Update ${updates}] Best price: $${price.toFixed(2)}`);
    }
  );
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Cleanup
  console.log('\n6. Shutting down...');
  unsubscribe();
  await aggregator.stop();
  
  console.log('\n✓ Demo completed successfully!');
}

demo().catch(console.error);