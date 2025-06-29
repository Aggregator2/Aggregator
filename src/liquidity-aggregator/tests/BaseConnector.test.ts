import { BaseConnector } from '../connectors/BaseConnector';
import { Token, TokenPair, PriceQuote, LiquidityPool, OrderRequest } from '../interfaces/types';

// Test implementation of BaseConnector
class TestConnector extends BaseConnector {
  protected async doConnect(): Promise<void> {
    // Mock connection
  }
  
  protected async doDisconnect(): Promise<void> {
    // Mock disconnection
  }
  
  async getQuote(request: OrderRequest): Promise<PriceQuote | null> {
    return {
      source: this.source,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: BigInt('2000000000'), // 2000 USDC
      price: 2000,
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
        tokenB: BigInt('2000000000000')
      },
      fee: 30,
      lastUpdate: Date.now()
    }];
  }
}

describe('BaseConnector', () => {
  let connector: TestConnector;
  
  beforeEach(() => {
    connector = new TestConnector({
      name: 'Test',
      type: 'DEX',
      chainId: 1
    });
  });
  
  test('should connect and disconnect properly', async () => {
    await connector.connect();
    expect(connector['connected']).toBe(true);
    
    await connector.disconnect();
    expect(connector['connected']).toBe(false);
  });
  
  test('should handle subscription callbacks', async () => {
    await connector.connect();
    
    const pair: TokenPair = {
      tokenA: { address: '0xA', symbol: 'A', decimals: 18, chainId: 1 },
      tokenB: { address: '0xB', symbol: 'B', decimals: 6, chainId: 1 }
    };
    
    let updateReceived = false;
    const unsubscribe = connector.subscribeToUpdates(pair, (pool) => {
      updateReceived = true;
    });
    
    // Trigger update
    connector['notifyUpdate'](pair, {} as LiquidityPool);
    expect(updateReceived).toBe(true);
    
    // Unsubscribe
    unsubscribe();
  });
  
  test('should sort tokens correctly', () => {
    const tokenA = { address: '0xB', symbol: 'B', decimals: 18, chainId: 1 };
    const tokenB = { address: '0xA', symbol: 'A', decimals: 6, chainId: 1 };
    
    const [sorted1, sorted2] = connector['sortTokens'](tokenA, tokenB);
    expect(sorted1.address).toBe('0xA');
    expect(sorted2.address).toBe('0xB');
  });
});