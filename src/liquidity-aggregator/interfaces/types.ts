export interface Token {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
}

export interface TokenPair {
  tokenA: Token;
  tokenB: Token;
}

export interface LiquiditySource {
  name: string;
  type: 'DEX' | 'MM'; // Market Maker
  chainId: number;
}

export interface PriceQuote {
  source: LiquiditySource;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  amountOut: bigint;
  price: number;
  priceImpact: number;
  gasEstimate?: bigint;
  timestamp: number;
}

export interface Route {
  path: Token[];
  quotes: PriceQuote[];
  totalAmountOut: bigint;
  totalGasEstimate: bigint;
  priceImpact: number;
}

export interface LiquidityPool {
  source: LiquiditySource;
  pair: TokenPair;
  reserves: {
    tokenA: bigint;
    tokenB: bigint;
  };
  fee: number; // basis points
  lastUpdate: number;
}

export interface OrderRequest {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  slippageTolerance: number; // basis points
  deadline?: number;
}

export interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'update' | 'quote';
  data: any;
}

export interface MarketMakerQuote {
  pair: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  timestamp: number;
}