import { LiquidityAggregator } from './core/LiquidityAggregator';
import { SmartOrderRouter } from './core/SmartOrderRouter';
import { BaseConnector } from './connectors/BaseConnector';
import { Token, OrderRequest, PriceQuote, LiquidityPool, TokenPair } from './interfaces/types';

// Simple test connector
class TestConnector extends BaseConnector {
  constructor(name: string, private mockPrice: number) {
    super({ name, type: 'DEX', chainId: 1 });
  }
  
  protected async doConnect(): Promise<void> {
    console.log(`✓ ${this.source.name} connected`);
  }
  
  protected async doDisconnect(): Promise<void> {
    console.log(`✓ ${this.source.name} disconnected`);
  }
  
  async getQuote(request: OrderRequest): Promise<PriceQuote | null> {
    const amountOut = (Number(request.amountIn) / (10 ** request.tokenIn.decimals)) * 
                      this.mockPrice * (10 ** request.tokenOut.decimals);
    
    return {
      source: this.source,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: BigInt(Math.floor(amountOut)),
      price: this.mockPrice,
      priceImpact: 0.1,
      gasEstimate: BigInt(150000),
      timestamp: Date.now()
    };
  }
  
  async getLiquidityPools(pair: TokenPair): Promise<LiquidityPool[]> {
    return [{
      source: this.source,
      pair,
      reserves: {
        tokenA: BigInt('1000000000000000000000'),
        tokenB: BigInt(Math.floor(1000 * this.mockPrice * (10 ** pair.tokenB.decimals)))
      },
      fee: 30,
      lastUpdate: Date.now()
    }];
  }
}

async function runTests() {
  console.log('=== Liquidity Aggregator Tests ===\n');
  
  const WETH: Token = {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18,
    chainId: 1
  };
  
  const USDC: Token = {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6,
    chainId: 1
  };
  
  console.log('Test 1: Create aggregator and add connectors');
  const aggregator = new LiquidityAggregator();
  aggregator.addConnector(new TestConnector('DEX1', 2000));
  aggregator.addConnector(new TestConnector('DEX2', 2100)); // Better price
  aggregator.addConnector(new TestConnector('DEX3', 1950)); // Worse price
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\nTest 2: Get quotes from all sources');
  const request: OrderRequest = {
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: BigInt('1000000000000000000'), // 1 WETH
    slippageTolerance: 50
  };
  
  const quotes = await aggregator.getQuotes(request);
  console.log(`✓ Got ${quotes.length} quotes`);
  quotes.forEach(q => {
    const amount = Number(q.amountOut) / (10 ** USDC.decimals);
    console.log(`  ${q.source.name}: ${amount.toFixed(2)} USDC`);
  });
  
  console.log('\nTest 3: Find best route');
  const route = await aggregator.findBestRoute(request);
  if (route) {
    const amount = Number(route.totalAmountOut) / (10 ** USDC.decimals);
    console.log(`✓ Best route: ${route.quotes[0].source.name} with ${amount.toFixed(2)} USDC`);
  }
  
  console.log('\nTest 4: Get liquidity pools');
  const pools = await aggregator.getAllLiquidity({ tokenA: WETH, tokenB: USDC });
  console.log(`✓ Found ${pools.length} liquidity pools`);
  
  console.log('\nTest 5: Price updates subscription');
  let priceUpdateReceived = false;
  const unsubscribe = aggregator.subscribeToPriceUpdates(
    { tokenA: WETH, tokenB: USDC },
    (price) => {
      priceUpdateReceived = true;
      console.log(`✓ Price update received: $${price.toFixed(2)}`);
    }
  );
  
  await new Promise(resolve => setTimeout(resolve, 6000)); // Wait for price update
  
  console.log('\nTest 6: Cleanup');
  unsubscribe();
  await aggregator.stop();
  console.log('✓ Aggregator stopped');
  
  console.log('\n=== All tests completed! ===');
}

runTests().catch(console.error);