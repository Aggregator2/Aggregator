import { LRUCache } from 'lru-cache';
import { Order, OrderSide } from '../matchingEngine/types';

interface PriceLevel {
  price: number;
  volume: number;
  orderCount: number;
  orders: string[]; // Order IDs
}

interface IndexStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

export class PriceLevelIndex {
  private bidIndex: Map<number, PriceLevel>;
  private askIndex: Map<number, PriceLevel>;
  private priceCache: LRUCache<string, PriceLevel>;
  private stats: IndexStats;
  private tickSize: number;

  constructor(tickSize: number = 0.01, cacheSize: number = 10000) {
    this.bidIndex = new Map();
    this.askIndex = new Map();
    this.tickSize = tickSize;
    
    // LRU cache for frequently accessed price levels
    this.priceCache = new LRUCache<string, PriceLevel>({
      max: cacheSize,
      ttl: 1000 * 60 * 5, // 5 minutes TTL
      updateAgeOnGet: true,
      dispose: (value, key) => {
        this.stats.evictions++;
      }
    });
    
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };
  }

  // Add order to index
  addOrder(order: Order): void {
    const normalizedPrice = this.normalizePrice(order.price);
    const index = order.side === OrderSide.BUY ? this.bidIndex : this.askIndex;
    const cacheKey = `${order.side}:${normalizedPrice}`;
    
    let level = index.get(normalizedPrice);
    if (!level) {
      level = {
        price: normalizedPrice,
        volume: 0,
        orderCount: 0,
        orders: []
      };
      index.set(normalizedPrice, level);
    }
    
    // Update level
    const remainingQuantity = order.quantity - order.filledQuantity;
    level.volume += remainingQuantity;
    level.orderCount++;
    level.orders.push(order.id);
    
    // Update cache
    this.priceCache.set(cacheKey, level);
    this.stats.size++;
  }

  // Remove order from index
  removeOrder(order: Order, remainingQuantity: number): void {
    const normalizedPrice = this.normalizePrice(order.price);
    const index = order.side === OrderSide.BUY ? this.bidIndex : this.askIndex;
    const cacheKey = `${order.side}:${normalizedPrice}`;
    
    const level = index.get(normalizedPrice);
    if (!level) return;
    
    // Update level
    level.volume -= remainingQuantity;
    level.orderCount--;
    const orderIndex = level.orders.indexOf(order.id);
    if (orderIndex !== -1) {
      level.orders.splice(orderIndex, 1);
    }
    
    // Remove empty levels
    if (level.orderCount === 0) {
      index.delete(normalizedPrice);
      this.priceCache.delete(cacheKey);
    } else {
      // Update cache
      this.priceCache.set(cacheKey, level);
    }
    
    this.stats.size--;
  }

  // Update order in index
  updateOrder(order: Order, oldRemainingQuantity: number, newRemainingQuantity: number): void {
    const normalizedPrice = this.normalizePrice(order.price);
    const index = order.side === OrderSide.BUY ? this.bidIndex : this.askIndex;
    const cacheKey = `${order.side}:${normalizedPrice}`;
    
    const level = index.get(normalizedPrice);
    if (!level) return;
    
    // Update volume
    level.volume = level.volume - oldRemainingQuantity + newRemainingQuantity;
    
    // Update cache
    this.priceCache.set(cacheKey, level);
  }

  // Get price level
  getPriceLevel(side: OrderSide, price: number): PriceLevel | null {
    const normalizedPrice = this.normalizePrice(price);
    const cacheKey = `${side}:${normalizedPrice}`;
    
    // Check cache first
    let level = this.priceCache.get(cacheKey);
    if (level) {
      this.stats.hits++;
      return level;
    }
    
    // Check index
    const index = side === OrderSide.BUY ? this.bidIndex : this.askIndex;
    level = index.get(normalizedPrice) || null;
    
    if (level) {
      this.priceCache.set(cacheKey, level);
      this.stats.misses++;
    }
    
    return level;
  }

  // Get best bid
  getBestBid(): PriceLevel | null {
    if (this.bidIndex.size === 0) return null;
    
    const maxPrice = Math.max(...this.bidIndex.keys());
    return this.bidIndex.get(maxPrice) || null;
  }

  // Get best ask
  getBestAsk(): PriceLevel | null {
    if (this.askIndex.size === 0) return null;
    
    const minPrice = Math.min(...this.askIndex.keys());
    return this.askIndex.get(minPrice) || null;
  }

  // Get top N levels
  getTopLevels(side: OrderSide, depth: number): PriceLevel[] {
    const index = side === OrderSide.BUY ? this.bidIndex : this.askIndex;
    const prices = Array.from(index.keys());
    
    // Sort prices
    if (side === OrderSide.BUY) {
      prices.sort((a, b) => b - a); // Descending for bids
    } else {
      prices.sort((a, b) => a - b); // Ascending for asks
    }
    
    // Get top levels
    const levels: PriceLevel[] = [];
    for (let i = 0; i < Math.min(depth, prices.length); i++) {
      const level = index.get(prices[i]);
      if (level) {
        levels.push(level);
      }
    }
    
    return levels;
  }

  // Get levels in price range
  getLevelsInRange(side: OrderSide, minPrice: number, maxPrice: number): PriceLevel[] {
    const index = side === OrderSide.BUY ? this.bidIndex : this.askIndex;
    const levels: PriceLevel[] = [];
    
    const minNormalized = this.normalizePrice(minPrice);
    const maxNormalized = this.normalizePrice(maxPrice);
    
    for (const [price, level] of index.entries()) {
      if (price >= minNormalized && price <= maxNormalized) {
        levels.push(level);
      }
    }
    
    // Sort by price
    if (side === OrderSide.BUY) {
      levels.sort((a, b) => b.price - a.price);
    } else {
      levels.sort((a, b) => a.price - b.price);
    }
    
    return levels;
  }

  // Get cumulative volume up to price
  getCumulativeVolume(side: OrderSide, targetPrice: number): number {
    const index = side === OrderSide.BUY ? this.bidIndex : this.askIndex;
    const normalizedTarget = this.normalizePrice(targetPrice);
    let cumulativeVolume = 0;
    
    for (const [price, level] of index.entries()) {
      if (side === OrderSide.BUY) {
        // For bids, include all prices >= target
        if (price >= normalizedTarget) {
          cumulativeVolume += level.volume;
        }
      } else {
        // For asks, include all prices <= target
        if (price <= normalizedTarget) {
          cumulativeVolume += level.volume;
        }
      }
    }
    
    return cumulativeVolume;
  }

  // Find price for given volume
  findPriceForVolume(side: OrderSide, targetVolume: number): number | null {
    const levels = this.getTopLevels(side, Number.MAX_SAFE_INTEGER);
    let cumulativeVolume = 0;
    
    for (const level of levels) {
      cumulativeVolume += level.volume;
      if (cumulativeVolume >= targetVolume) {
        return level.price;
      }
    }
    
    return null;
  }

  // Get market impact
  getMarketImpact(side: OrderSide, orderSize: number): {
    averagePrice: number;
    worstPrice: number;
    priceImpact: number;
  } | null {
    const levels = this.getTopLevels(side, Number.MAX_SAFE_INTEGER);
    if (levels.length === 0) return null;
    
    let remainingSize = orderSize;
    let totalCost = 0;
    let worstPrice = levels[0].price;
    
    for (const level of levels) {
      const fillSize = Math.min(remainingSize, level.volume);
      totalCost += fillSize * level.price;
      remainingSize -= fillSize;
      worstPrice = level.price;
      
      if (remainingSize <= 0) break;
    }
    
    if (remainingSize > 0) {
      // Not enough liquidity
      return null;
    }
    
    const averagePrice = totalCost / orderSize;
    const bestPrice = levels[0].price;
    const priceImpact = Math.abs(worstPrice - bestPrice) / bestPrice;
    
    return {
      averagePrice,
      worstPrice,
      priceImpact
    };
  }

  // Normalize price to tick size
  private normalizePrice(price: number): number {
    return Math.round(price / this.tickSize) * this.tickSize;
  }

  // Get index statistics
  getStatistics(): IndexStats & {
    bidLevels: number;
    askLevels: number;
    totalVolume: { bids: number; asks: number };
    cacheHitRate: number;
  } {
    let bidVolume = 0;
    let askVolume = 0;
    
    for (const level of this.bidIndex.values()) {
      bidVolume += level.volume;
    }
    
    for (const level of this.askIndex.values()) {
      askVolume += level.volume;
    }
    
    const totalRequests = this.stats.hits + this.stats.misses;
    const cacheHitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;
    
    return {
      ...this.stats,
      bidLevels: this.bidIndex.size,
      askLevels: this.askIndex.size,
      totalVolume: {
        bids: bidVolume,
        asks: askVolume
      },
      cacheHitRate
    };
  }

  // Clear index
  clear(): void {
    this.bidIndex.clear();
    this.askIndex.clear();
    this.priceCache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };
  }

  // Export index data for backup
  export(): {
    bids: Array<[number, PriceLevel]>;
    asks: Array<[number, PriceLevel]>;
  } {
    return {
      bids: Array.from(this.bidIndex.entries()),
      asks: Array.from(this.askIndex.entries())
    };
  }

  // Import index data from backup
  import(data: {
    bids: Array<[number, PriceLevel]>;
    asks: Array<[number, PriceLevel]>;
  }): void {
    this.clear();
    
    for (const [price, level] of data.bids) {
      this.bidIndex.set(price, level);
    }
    
    for (const [price, level] of data.asks) {
      this.askIndex.set(price, level);
    }
    
    this.stats.size = this.bidIndex.size + this.askIndex.size;
  }
}