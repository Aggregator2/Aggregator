import { LiquidityAggregator } from './core/LiquidityAggregator';
import { BaseConnector } from './connectors/BaseConnector';
import { IMarketMakerConnector } from './interfaces/connectors';
import { 
  Token, 
  TokenPair, 
  PriceQuote, 
  LiquidityPool, 
  OrderRequest,
  MarketMakerQuote 
} from './interfaces/types';

// Mock DEX Connector
class MockDEXConnector extends BaseConnector {
  private basePrices: Map<string, number> = new Map([
    ['WETH/USDC', 2000],
    ['WETH/DAI', 2000],
    ['USDC/DAI', 1]
  ]);
  
  constructor(name: string, priceMultiplier: number = 1) {
    super({
      name,
      type: 'DEX',
      chainId: 1
    });
    
    // Apply price multiplier to simulate different prices across DEXs
    this.basePrices.forEach((price, pair) => {
      this.basePrices.set(pair, price * priceMultiplier);
    });
  }
  
  protected async doConnect(): Promise<void> {
    console.log(`${this.source.name} connected`);
  }
  
  protected async doDisconnect(): Promise<void> {
    console.log(`${this.source.name} disconnected`);
  }
  
  async getQuote(request: OrderRequest): Promise<PriceQuote | null> {
    const pairKey = `${request.tokenIn.symbol}/${request.tokenOut.symbol}`;
    const price = this.basePrices.get(pairKey) || 0;
    
    if (price === 0) return null;
    
    const amountOut = (Number(request.amountIn) / (10 ** request.tokenIn.decimals)) * 
                      price * (10 ** request.tokenOut.decimals);
    
    return {
      source: this.source,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: BigInt(Math.floor(amountOut)),
      price,
      priceImpact: Math.random() * 0.5, // 0-0.5% random impact
      gasEstimate: BigInt(150000 + Math.floor(Math.random() * 50000)),
      timestamp: Date.now()
    };
  }
  
  async getLiquidityPools(pair: TokenPair): Promise<LiquidityPool[]> {
    const pairKey = `${pair.tokenA.symbol}/${pair.tokenB.symbol}`;
    const price = this.basePrices.get(pairKey);
    
    if (!price) return [];
    
    const baseReserveA = BigInt('1000000000000000000000'); // 1000 tokens
    const baseReserveB = BigInt(Math.floor(1000 * price * (10 ** pair.tokenB.decimals)));
    
    return [{
      source: this.source,
      pair,
      reserves: {
        tokenA: baseReserveA + BigInt(Math.floor(Math.random() * 1000000000000000000)),
        tokenB: baseReserveB + BigInt(Math.floor(Math.random() * 1000000))
      },
      fee: 30, // 0.3%
      lastUpdate: Date.now()
    }];
  }
}

// Mock Market Maker Connector
class MockMarketMakerConnector extends BaseConnector implements IMarketMakerConnector {
  private priceBase = 2000;
  private spread = 10;
  private quoteCallbacks: Map<string, Set<(quote: MarketMakerQuote) => void>> = new Map();
  private intervalId?: NodeJS.Timeout;
  
  constructor(name: string) {
    super({
      name,
      type: 'MM',
      chainId: 1
    });
  }
  
  protected async doConnect(): Promise<void> {
    console.log(`${this.source.name} market maker connected`);
    this.startPriceUpdates();
  }
  
  protected async doDisconnect(): Promise<void> {
    console.log(`${this.source.name} market maker disconnected`);
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
  
  private startPriceUpdates(): void {
    this.intervalId = setInterval(() => {
      this.quoteCallbacks.forEach((callbacks, pair) => {
        const quote: MarketMakerQuote = {
          pair,
          bid: this.priceBase - this.spread + Math.random() * 10,
          ask: this.priceBase + this.spread + Math.random() * 10,
          bidSize: 100 + Math.random() * 50,
          askSize: 100 + Math.random() * 50,
          timestamp: Date.now()
        };
        
        callbacks.forEach(cb => cb(quote));
      });
    }, 2000);
  }
  
  subscribeToQuotes(pairs: string[], callback: (quote: MarketMakerQuote) => void): () => void {
    pairs.forEach(pair => {
      if (!this.quoteCallbacks.has(pair)) {
        this.quoteCallbacks.set(pair, new Set());
      }
      this.quoteCallbacks.get(pair)!.add(callback);
    });
    
    return () => {
      pairs.forEach(pair => {
        const callbacks = this.quoteCallbacks.get(pair);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            this.quoteCallbacks.delete(pair);
          }
        }
      });
    };
  }
  
  async requestQuote(request: OrderRequest): Promise<PriceQuote> {
    const price = this.priceBase + (Math.random() - 0.5) * 20;
    const amountOut = (Number(request.amountIn) / (10 ** request.tokenIn.decimals)) * 
                      price * (10 ** request.tokenOut.decimals);
    
    return {
      source: this.source,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: BigInt(Math.floor(amountOut)),
      price,
      priceImpact: 0.05,
      timestamp: Date.now()
    };
  }
  
  async getQuote(request: OrderRequest): Promise<PriceQuote | null> {
    return this.requestQuote(request);
  }
  
  async getLiquidityPools(pair: TokenPair): Promise<LiquidityPool[]> {
    return [{
      source: this.source,
      pair,
      reserves: {
        tokenA: BigInt('100000000000000000000'), // 100 ETH
        tokenB: BigInt('200000000000') // 200k USDC
      },
      fee: 10, // 0.1%
      lastUpdate: Date.now()
    }];
  }
}

// Demo function
async function runDemo() {
  console.log('=== Liquidity Aggregator Demo ===\n');
  
  // Define tokens
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
  
  const DAI: Token = {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    symbol: 'DAI',
    decimals: 18,
    chainId: 1
  };
  
  // Create aggregator
  const aggregator = new LiquidityAggregator();
  
  // Add DEX connectors with different price levels
  console.log('Adding liquidity sources...');
  aggregator.addConnector(new MockDEXConnector('Uniswap', 1.0));
  aggregator.addConnector(new MockDEXConnector('SushiSwap', 0.995)); // Slightly worse price
  aggregator.addConnector(new MockDEXConnector('Curve', 1.002)); // Slightly better price
  
  // Add market maker connectors
  aggregator.addConnector(new MockMarketMakerConnector('MM1'));
  aggregator.addConnector(new MockMarketMakerConnector('MM2'));
  
  // Wait for connections
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Example 1: Get quotes from all sources
  console.log('\n--- Getting Quotes for 1 WETH -> USDC ---');
  const swapRequest: OrderRequest = {
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: BigInt('1000000000000000000'), // 1 WETH
    slippageTolerance: 50
  };
  
  const quotes = await aggregator.getQuotes(swapRequest);
  
  quotes.forEach(quote => {
    const outputAmount = Number(quote.amountOut) / (10 ** USDC.decimals);
    console.log(`${quote.source.name}: ${outputAmount.toFixed(2)} USDC (price: ${quote.price.toFixed(2)}, impact: ${quote.priceImpact.toFixed(2)}%)`);
  });
  
  // Example 2: Find best route
  console.log('\n--- Finding Best Route ---');
  const route = await aggregator.findBestRoute(swapRequest);
  
  if (route) {
    const outputAmount = Number(route.totalAmountOut) / (10 ** USDC.decimals);
    console.log(`Best route: ${route.path.map(t => t.symbol).join(' -> ')}`);
    console.log(`Output: ${outputAmount.toFixed(2)} USDC`);
    console.log(`Using: ${route.quotes.map(q => q.source.name).join(', ')}`);
    console.log(`Total gas: ${route.totalGasEstimate.toString()}`);
  }
  
  // Example 3: Monitor liquidity
  console.log('\n--- Monitoring Liquidity Pools ---');
  const pair: TokenPair = { tokenA: WETH, tokenB: USDC };
  
  const pools = await aggregator.getAllLiquidity(pair);
  pools.forEach(pool => {
    const reserveA = Number(pool.reserves.tokenA) / (10 ** 18);
    const reserveB = Number(pool.reserves.tokenB) / (10 ** 6);
    console.log(`${pool.source.name}: ${reserveA.toFixed(2)} WETH / ${reserveB.toFixed(2)} USDC (fee: ${pool.fee/100}%)`);
  });
  
  // Example 4: Subscribe to price updates
  console.log('\n--- Real-time Price Updates (10 seconds) ---');
  let updateCount = 0;
  
  const unsubscribePrice = aggregator.subscribeToPriceUpdates(
    pair,
    (price) => {
      updateCount++;
      console.log(`[Update ${updateCount}] Best WETH/USDC price: $${price.toFixed(2)}`);
    }
  );
  
  // Example 5: Multi-hop routing
  console.log('\n--- Testing Multi-hop Route (WETH -> DAI) ---');
  const multiHopRequest: OrderRequest = {
    tokenIn: WETH,
    tokenOut: DAI,
    amountIn: BigInt('1000000000000000000'), // 1 WETH
    slippageTolerance: 100
  };
  
  const multiHopRoute = await aggregator.findBestRoute(multiHopRequest);
  
  if (multiHopRoute) {
    const outputAmount = Number(multiHopRoute.totalAmountOut) / (10 ** DAI.decimals);
    console.log(`Route: ${multiHopRoute.path.map(t => t.symbol).join(' -> ')}`);
    console.log(`Output: ${outputAmount.toFixed(2)} DAI`);
    
    if (multiHopRoute.path.length > 2) {
      console.log('Multi-hop route found!');
      multiHopRoute.quotes.forEach((quote, i) => {
        console.log(`  Step ${i + 1}: ${quote.tokenIn.symbol} -> ${quote.tokenOut.symbol} via ${quote.source.name}`);
      });
    }
  }
  
  // Run for 10 seconds to see updates
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Cleanup
  console.log('\n--- Cleaning up ---');
  unsubscribePrice();
  await aggregator.stop();
  
  console.log('\nDemo completed!');
}

// Run the demo
if (require.main === module) {
  runDemo().catch(console.error);
}