import { SmartOrderRouter } from '../core/SmartOrderRouter';
import { ILiquidityConnector } from '../interfaces/connectors';
import { Token, OrderRequest, PriceQuote, LiquidityPool, TokenPair } from '../interfaces/types';

// Mock connector
class MockConnector implements ILiquidityConnector {
  constructor(
    public source: any,
    private mockQuote: PriceQuote | null
  ) {}
  
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  
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
    return [];
  }
  
  subscribeToUpdates(pair: TokenPair, callback: (pool: LiquidityPool) => void): () => void {
    return () => {};
  }
}

describe('SmartOrderRouter', () => {
  let router: SmartOrderRouter;
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
    router = new SmartOrderRouter();
  });
  
  test('should find best direct route', async () => {
    // Add mock connectors with different quotes
    const connector1 = new MockConnector(
      { name: 'DEX1', type: 'DEX', chainId: 1 },
      {
        source: { name: 'DEX1', type: 'DEX', chainId: 1 },
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: BigInt('1000000000000000000'),
        amountOut: BigInt('2000000000'), // 2000 USDC
        price: 2000,
        priceImpact: 0.1,
        gasEstimate: BigInt(150000),
        timestamp: Date.now()
      }
    );
    
    const connector2 = new MockConnector(
      { name: 'DEX2', type: 'DEX', chainId: 1 },
      {
        source: { name: 'DEX2', type: 'DEX', chainId: 1 },
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: BigInt('1000000000000000000'),
        amountOut: BigInt('2100000000'), // 2100 USDC - better price
        price: 2100,
        priceImpact: 0.05,
        gasEstimate: BigInt(160000),
        timestamp: Date.now()
      }
    );
    
    router.addConnector(connector1);
    router.addConnector(connector2);
    
    const request: OrderRequest = {
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: BigInt('1000000000000000000'), // 1 WETH
      slippageTolerance: 50
    };
    
    const route = await router.findBestRoute(request);
    
    expect(route).not.toBeNull();
    expect(route!.totalAmountOut).toBe(BigInt('2100000000'));
    expect(route!.quotes[0].source.name).toBe('DEX2');
  });
  
  test('should handle no available routes', async () => {
    const connector = new MockConnector(
      { name: 'DEX1', type: 'DEX', chainId: 1 },
      null // No quote available
    );
    
    router.addConnector(connector);
    
    const request: OrderRequest = {
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: BigInt('1000000000000000000'),
      slippageTolerance: 50
    };
    
    const route = await router.findBestRoute(request);
    expect(route).toBeNull();
  });
  
  test('should calculate optimal split', () => {
    const quotes: PriceQuote[] = [
      {
        source: { name: 'DEX1', type: 'DEX', chainId: 1 },
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: BigInt('1000000000000000000'),
        amountOut: BigInt('2000000000'),
        price: 2000,
        priceImpact: 0.1,
        timestamp: Date.now()
      },
      {
        source: { name: 'DEX2', type: 'DEX', chainId: 1 },
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: BigInt('1000000000000000000'),
        amountOut: BigInt('1950000000'),
        price: 1950,
        priceImpact: 0.15,
        timestamp: Date.now()
      }
    ];
    
    const totalAmount = BigInt('2000000000000000000'); // 2 WETH
    const splits = router['calculateOptimalSplit'](quotes, totalAmount);
    
    expect(splits.size).toBe(2);
    expect(splits.get('DEX1')).toBe(BigInt('1500000000000000000')); // More allocated to better price
    expect(splits.get('DEX2')).toBe(BigInt('500000000000000000'));
  });
});