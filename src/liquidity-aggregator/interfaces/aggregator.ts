import { Token, PriceQuote, Route, OrderRequest, LiquidityPool, TokenPair } from './types';
import { ILiquidityConnector } from './connectors';

export interface ILiquidityAggregator {
  addConnector(connector: ILiquidityConnector): void;
  removeConnector(name: string): void;
  
  findBestRoute(request: OrderRequest): Promise<Route | null>;
  
  getQuotes(request: OrderRequest): Promise<PriceQuote[]>;
  
  getAllLiquidity(pair: TokenPair): Promise<LiquidityPool[]>;
  
  subscribeToLiquidityUpdates(
    pair: TokenPair,
    callback: (pools: LiquidityPool[]) => void
  ): () => void;
  
  subscribeToPriceUpdates(
    pair: TokenPair,
    callback: (bestPrice: number) => void
  ): () => void;
}