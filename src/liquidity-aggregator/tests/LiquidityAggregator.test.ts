import { LiquidityAggregator } from '../core/LiquidityAggregator';
import { ILiquidityConnector } from '../interfaces/connectors';
import { Token, OrderRequest, PriceQuote, LiquidityPool, TokenPair } from '../interfaces/types';

// Mock connector
class MockConnector implements ILiquidityConnector {
  public connected = false;
  
  constructor(
    public source: any,
    private mockQuote: PriceQuote | null,
    private mockPools: LiquidityPool[] = []
  ) {}
  
  async connect(): Promise<void> {
    this.connected = true;
  }
  
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  
  async getQuote(request: OrderRequest): Promise<PriceQuote | null> {
    if (!this.mockQuote) return null;
    
    return {
      ...this.mockQuote,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn
    };
  }
  
  async getLiquidityPools(pair: TokenPair): Promise<LiquidityPool[]> {
    return this.mockPools;
  }
  
  subscribeToUpdates(pair: TokenPair, callback: (pool: LiquidityPool) => void): () => void {
    return () => {};
  }
}

describe('LiquidityAggregator', () => {
  let aggregator: LiquidityAggregator;
  
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
  
  beforeEach(() => {
    aggregator = new LiquidityAggregator();
  });
  
  afterEach(async () => {
    await aggregator.stop();
  });
  
  test('should add and remove connectors', async () => {
    const connector = new MockConnector(
      { name: 'Test', type: 'DEX', chainId: 1 },
      null
    );
    
    aggregator.addConnector(connector);
    
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(connector.connected).toBe(true);
    
    aggregator.removeConnector('Test');
    
    // Wait for disconnection
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(connector.connected).toBe(false);
  });
  
  test('should get quotes from all connectors', async () => {
    const quote1: PriceQuote = {
      source: { name: 'DEX1', type: 'DEX', chainId: 1 },
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: BigInt('1000000000000000000'),
      amountOut: BigInt('2000000000'),
      price: 2000,
      priceImpact: 0.1,
      timestamp: Date.now()
    };
    
    const quote2: PriceQuote = {
      source: { name: 'DEX2', type: 'DEX', chainId: 1 },
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: BigInt('1000000000000000000'),
      amountOut: BigInt('2100000000'),
      price: 2100,
      priceImpact: 0.05,
      timestamp: Date.now()
    };
    
    aggregator.addConnector(new MockConnector(
      { name: 'DEX1', type: 'DEX', chainId: 1 },
      quote1
    ));
    
    aggregator.addConnector(new MockConnector(
      { name: 'DEX2', type: 'DEX', chainId: 1 },
      quote2
    ));
    
    const request: OrderRequest = {
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: BigInt('1000000000000000000'),
      slippageTolerance: 50
    };
    
    const quotes = await aggregator.getQuotes(request);
    
    expect(quotes.length).toBe(2);
    expect(quotes.find(q => q.source.name === 'DEX1')).toBeTruthy();
    expect(quotes.find(q => q.source.name === 'DEX2')).toBeTruthy();
  });
  
  test('should find best route', async () => {
    const quote1: PriceQuote = {
      source: { name: 'DEX1', type: 'DEX', chainId: 1 },
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: BigInt('1000000000000000000'),
      amountOut: BigInt('2000000000'),
      price: 2000,
      priceImpact: 0.1,
      gasEstimate: BigInt(150000),
      timestamp: Date.now()
    };
    
    const quote2: PriceQuote = {
      source: { name: 'DEX2', type: 'DEX', chainId: 1 },
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: BigInt('1000000000000000000'),
      amountOut: BigInt('2100000000'),
      price: 2100,
      priceImpact: 0.05,
      gasEstimate: BigInt(160000),
      timestamp: Date.now()
    };
    
    aggregator.addConnector(new MockConnector(
      { name: 'DEX1', type: 'DEX', chainId: 1 },
      quote1
    ));
    
    aggregator.addConnector(new MockConnector(
      { name: 'DEX2', type: 'DEX', chainId: 1 },
      quote2
    ));
    
    const request: OrderRequest = {
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: BigInt('1000000000000000000'),
      slippageTolerance: 50
    };
    
    const route = await aggregator.findBestRoute(request);
    
    expect(route).not.toBeNull();
    expect(route!.totalAmountOut).toBe(BigInt('2100000000'));
    expect(route!.quotes[0].source.name).toBe('DEX2');
  });
  
  test('should get all liquidity pools', async () => {
    const pool1: LiquidityPool = {
      source: { name: 'DEX1', type: 'DEX', chainId: 1 },
      pair: { tokenA: WETH, tokenB: USDC },
      reserves: {
        tokenA: BigInt('1000000000000000000000'),
        tokenB: BigInt('2000000000000')
      },
      fee: 30,
      lastUpdate: Date.now()
    };
    
    const pool2: LiquidityPool = {
      source: { name: 'DEX2', type: 'DEX', chainId: 1 },
      pair: { tokenA: WETH, tokenB: USDC },
      reserves: {
        tokenA: BigInt('500000000000000000000'),
        tokenB: BigInt('1000000000000')
      },
      fee: 30,
      lastUpdate: Date.now()
    };
    
    aggregator.addConnector(new MockConnector(
      { name: 'DEX1', type: 'DEX', chainId: 1 },
      null,
      [pool1]
    ));
    
    aggregator.addConnector(new MockConnector(
      { name: 'DEX2', type: 'DEX', chainId: 1 },
      null,
      [pool2]
    ));
    
    const pools = await aggregator.getAllLiquidity({ tokenA: WETH, tokenB: USDC });
    
    expect(pools.length).toBe(2);
    expect(pools.find(p => p.source.name === 'DEX1')).toBeTruthy();
    expect(pools.find(p => p.source.name === 'DEX2')).toBeTruthy();
  });
  
  test('should subscribe to liquidity updates', async () => {
    const pool: LiquidityPool = {
      source: { name: 'DEX1', type: 'DEX', chainId: 1 },
      pair: { tokenA: WETH, tokenB: USDC },
      reserves: {
        tokenA: BigInt('1000000000000000000000'),
        tokenB: BigInt('2000000000000')
      },
      fee: 30,
      lastUpdate: Date.now()
    };
    
    aggregator.addConnector(new MockConnector(
      { name: 'DEX1', type: 'DEX', chainId: 1 },
      null,
      [pool]
    ));
    
    let updateCount = 0;
    const unsubscribe = aggregator.subscribeToLiquidityUpdates(
      { tokenA: WETH, tokenB: USDC },
      (pools) => {
        updateCount++;
        expect(pools.length).toBeGreaterThan(0);
      }
    );
    
    // Wait for initial update
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(updateCount).toBeGreaterThan(0);
    
    unsubscribe();
  });
});