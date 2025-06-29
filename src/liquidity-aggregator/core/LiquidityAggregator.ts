import { ILiquidityAggregator } from '../interfaces/aggregator';
import { ILiquidityConnector } from '../interfaces/connectors';
import { Token, PriceQuote, Route, OrderRequest, LiquidityPool, TokenPair } from '../interfaces/types';
import { SmartOrderRouter } from './SmartOrderRouter';

export class LiquidityAggregator implements ILiquidityAggregator {
  private connectors: Map<string, ILiquidityConnector> = new Map();
  private router: SmartOrderRouter;
  private liquidityCallbacks: Map<string, Set<(pools: LiquidityPool[]) => void>> = new Map();
  private priceCallbacks: Map<string, Set<(price: number) => void>> = new Map();
  private updateInterval?: NodeJS.Timeout;
  
  constructor() {
    this.router = new SmartOrderRouter();
  }
  
  addConnector(connector: ILiquidityConnector): void {
    const name = connector.source.name;
    
    if (this.connectors.has(name)) {
      throw new Error(`Connector ${name} already exists`);
    }
    
    this.connectors.set(name, connector);
    this.router.addConnector(connector);
    
    // Connect if not already connected
    connector.connect().catch(err => {
      console.error(`Failed to connect ${name}:`, err);
    });
  }
  
  removeConnector(name: string): void {
    const connector = this.connectors.get(name);
    
    if (connector) {
      connector.disconnect().catch(console.error);
      this.connectors.delete(name);
      this.router.removeConnector(name);
    }
  }
  
  async findBestRoute(request: OrderRequest): Promise<Route | null> {
    return this.router.findBestRoute(request);
  }
  
  async getQuotes(request: OrderRequest): Promise<PriceQuote[]> {
    const quotePromises = Array.from(this.connectors.values()).map(connector =>
      connector.getQuote(request).catch(err => {
        console.error(`Error getting quote from ${connector.source.name}:`, err);
        return null;
      })
    );
    
    const quotes = await Promise.all(quotePromises);
    return quotes.filter((q): q is PriceQuote => q !== null);
  }
  
  async getAllLiquidity(pair: TokenPair): Promise<LiquidityPool[]> {
    const poolPromises = Array.from(this.connectors.values()).map(connector =>
      connector.getLiquidityPools(pair).catch(err => {
        console.error(`Error getting pools from ${connector.source.name}:`, err);
        return [];
      })
    );
    
    const poolArrays = await Promise.all(poolPromises);
    return poolArrays.flat();
  }
  
  subscribeToLiquidityUpdates(
    pair: TokenPair,
    callback: (pools: LiquidityPool[]) => void
  ): () => void {
    const key = this.getPairKey(pair);
    
    if (!this.liquidityCallbacks.has(key)) {
      this.liquidityCallbacks.set(key, new Set());
      this.startLiquidityUpdates(pair);
    }
    
    this.liquidityCallbacks.get(key)!.add(callback);
    
    // Immediately send current liquidity
    this.getAllLiquidity(pair).then(pools => callback(pools));
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.liquidityCallbacks.get(key);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.liquidityCallbacks.delete(key);
        }
      }
    };
  }
  
  subscribeToPriceUpdates(
    pair: TokenPair,
    callback: (bestPrice: number) => void
  ): () => void {
    const key = this.getPairKey(pair);
    
    if (!this.priceCallbacks.has(key)) {
      this.priceCallbacks.set(key, new Set());
      this.startPriceUpdates(pair);
    }
    
    this.priceCallbacks.get(key)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.priceCallbacks.get(key);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.priceCallbacks.delete(key);
        }
      }
    };
  }
  
  private startLiquidityUpdates(pair: TokenPair): void {
    // Subscribe to updates from each connector
    this.connectors.forEach(connector => {
      connector.subscribeToUpdates(pair, (pool) => {
        this.handleLiquidityUpdate(pair);
      });
    });
  }
  
  private startPriceUpdates(pair: TokenPair): void {
    // Poll for best prices
    const updatePrice = async () => {
      const request: OrderRequest = {
        tokenIn: pair.tokenA,
        tokenOut: pair.tokenB,
        amountIn: BigInt(10 ** pair.tokenA.decimals), // 1 token
        slippageTolerance: 50 // 0.5%
      };
      
      const quotes = await this.getQuotes(request);
      
      if (quotes.length > 0) {
        const bestPrice = Math.max(...quotes.map(q => q.price));
        this.notifyPriceUpdate(pair, bestPrice);
      }
    };
    
    // Initial update
    updatePrice();
    
    // Set up periodic updates (every 5 seconds)
    if (!this.updateInterval) {
      this.updateInterval = setInterval(() => {
        this.priceCallbacks.forEach((callbacks, key) => {
          if (callbacks.size > 0) {
            const [tokenA, tokenB] = this.parsePairKey(key);
            updatePrice();
          }
        });
      }, 5000);
    }
  }
  
  private handleLiquidityUpdate(pair: TokenPair): void {
    const key = this.getPairKey(pair);
    const callbacks = this.liquidityCallbacks.get(key);
    
    if (callbacks && callbacks.size > 0) {
      this.getAllLiquidity(pair).then(pools => {
        callbacks.forEach(cb => cb(pools));
      });
    }
  }
  
  private notifyPriceUpdate(pair: TokenPair, price: number): void {
    const key = this.getPairKey(pair);
    const callbacks = this.priceCallbacks.get(key);
    
    if (callbacks) {
      callbacks.forEach(cb => cb(price));
    }
  }
  
  private getPairKey(pair: TokenPair): string {
    const [token0, token1] = this.sortTokens(pair.tokenA, pair.tokenB);
    return `${token0.address}-${token1.address}`;
  }
  
  private parsePairKey(key: string): [string, string] {
    const [tokenA, tokenB] = key.split('-');
    return [tokenA, tokenB];
  }
  
  private sortTokens(tokenA: Token, tokenB: Token): [Token, Token] {
    return tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];
  }
  
  async stop(): Promise<void> {
    // Clear update interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    
    // Disconnect all connectors
    const disconnectPromises = Array.from(this.connectors.values()).map(connector =>
      connector.disconnect().catch(console.error)
    );
    
    await Promise.all(disconnectPromises);
    
    // Clear all callbacks
    this.liquidityCallbacks.clear();
    this.priceCallbacks.clear();
    this.connectors.clear();
  }
}