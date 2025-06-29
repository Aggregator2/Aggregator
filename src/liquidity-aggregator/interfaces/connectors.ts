import { Token, TokenPair, PriceQuote, LiquidityPool, OrderRequest, LiquiditySource } from './types';

export interface ILiquidityConnector {
  source: LiquiditySource;
  
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  getQuote(request: OrderRequest): Promise<PriceQuote | null>;
  
  getLiquidityPools(pair: TokenPair): Promise<LiquidityPool[]>;
  
  subscribeToUpdates(
    pair: TokenPair,
    callback: (pool: LiquidityPool) => void
  ): () => void;
}

export interface IDEXConnector extends ILiquidityConnector {
  getRouterAddress(): string;
  getFactoryAddress(): string;
}

export interface IMarketMakerConnector extends ILiquidityConnector {
  subscribeToQuotes(
    pairs: string[],
    callback: (quote: any) => void
  ): () => void;
  
  requestQuote(request: OrderRequest): Promise<PriceQuote>;
}