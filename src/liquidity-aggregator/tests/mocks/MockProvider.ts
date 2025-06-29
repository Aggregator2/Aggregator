export class MockProvider {
  private mockData: Map<string, any> = new Map();
  
  constructor() {
    this.setupMockData();
  }
  
  private setupMockData(): void {
    // Mock contract addresses
    this.mockData.set('getPair_WETH_USDC', '0x1234567890123456789012345678901234567890');
    this.mockData.set('getPair_WETH_DAI', '0x2345678901234567890123456789012345678901');
    this.mockData.set('getPair_USDC_DAI', '0x3456789012345678901234567890123456789012');
    
    // Mock reserves
    this.mockData.set('reserves_WETH_USDC', {
      reserve0: BigInt('1000000000000000000000'), // 1000 WETH
      reserve1: BigInt('2000000000000'), // 2M USDC
      blockTimestampLast: 12345678
    });
    
    // Mock token addresses
    this.mockData.set('token0_0x1234567890123456789012345678901234567890', 
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'); // WETH
    this.mockData.set('token1_0x1234567890123456789012345678901234567890', 
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'); // USDC
  }
  
  // Mock ethers provider interface
  async call(transaction: any): Promise<string> {
    // Simple mock - return predefined data based on method signature
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }
  
  async getBlockNumber(): Promise<number> {
    return 12345678;
  }
  
  async getNetwork(): Promise<any> {
    return { chainId: 1, name: 'homestead' };
  }
}

export class MockContract {
  constructor(
    private address: string,
    private abi: any[],
    private provider: MockProvider
  ) {}
  
  async getPair(tokenA: string, tokenB: string): Promise<string> {
    if (tokenA.includes('C02aaA') && tokenB.includes('A0b869')) {
      return '0x1234567890123456789012345678901234567890';
    }
    return '0x0000000000000000000000000000000000000000';
  }
  
  async getReserves(): Promise<any> {
    return {
      _reserve0: BigInt('1000000000000000000000'),
      _reserve1: BigInt('2000000000000'),
      _blockTimestampLast: 12345678,
      0: BigInt('1000000000000000000000'),
      1: BigInt('2000000000000'),
      2: 12345678
    };
  }
  
  async token0(): Promise<string> {
    return '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  }
  
  async token1(): Promise<string> {
    return '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  }
  
  async getAmountsOut(amountIn: bigint, path: string[]): Promise<bigint[]> {
    // Simple mock calculation - 2000 USDC per WETH
    if (path[0].includes('C02aaA') && path[1].includes('A0b869')) {
      const amountOut = (amountIn * BigInt(2000) * BigInt(1000000)) / BigInt('1000000000000000000');
      return [amountIn, amountOut];
    }
    return [amountIn, BigInt(0)];
  }
  
  async find_pool_for_coins(from: string, to: string): Promise<string> {
    return '0x0000000000000000000000000000000000000000';
  }
  
  async get_coin_indices(pool: string, from: string, to: string): Promise<any[]> {
    return [0, 1, true];
  }
}