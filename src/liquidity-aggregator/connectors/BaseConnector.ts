import { ILiquidityConnector } from '../interfaces/connectors';
import { Token, TokenPair, PriceQuote, LiquidityPool, OrderRequest, LiquiditySource } from '../interfaces/types';

export abstract class BaseConnector implements ILiquidityConnector {
  protected connected: boolean = false;
  protected updateCallbacks: Map<string, Set<(pool: LiquidityPool) => void>> = new Map();
  
  constructor(public readonly source: LiquiditySource) {}
  
  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error(`${this.source.name} connector already connected`);
    }
    await this.doConnect();
    this.connected = true;
  }
  
  async disconnect(): Promise<void> {
    if (!this.connected) {
      throw new Error(`${this.source.name} connector not connected`);
    }
    await this.doDisconnect();
    this.connected = false;
    this.updateCallbacks.clear();
  }
  
  subscribeToUpdates(
    pair: TokenPair,
    callback: (pool: LiquidityPool) => void
  ): () => void {
    const key = this.getPairKey(pair);
    if (!this.updateCallbacks.has(key)) {
      this.updateCallbacks.set(key, new Set());
    }
    this.updateCallbacks.get(key)!.add(callback);
    
    return () => {
      const callbacks = this.updateCallbacks.get(key);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.updateCallbacks.delete(key);
        }
      }
    };
  }
  
  protected notifyUpdate(pair: TokenPair, pool: LiquidityPool): void {
    const key = this.getPairKey(pair);
    const callbacks = this.updateCallbacks.get(key);
    if (callbacks) {
      callbacks.forEach(cb => cb(pool));
    }
  }
  
  protected getPairKey(pair: TokenPair): string {
    const [token0, token1] = this.sortTokens(pair.tokenA, pair.tokenB);
    return `${token0.address}-${token1.address}`;
  }
  
  protected sortTokens(tokenA: Token, tokenB: Token): [Token, Token] {
    return tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];
  }
  
  protected abstract doConnect(): Promise<void>;
  protected abstract doDisconnect(): Promise<void>;
  
  abstract getQuote(request: OrderRequest): Promise<PriceQuote | null>;
  abstract getLiquidityPools(pair: TokenPair): Promise<LiquidityPool[]>;
}