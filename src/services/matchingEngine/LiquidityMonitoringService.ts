import { EventEmitter } from 'events';
import { MatchingEngine } from './MatchingEngine';
import { LiquidityAggregator } from './ExternalLiquidityProvider';
import { OrderSide } from './types';

export interface LiquiditySnapshot {
  timestamp: number;
  pair: string;
  internal: {
    bidLiquidity: Array<{ price: number; quantity: number; depth: number }>;
    askLiquidity: Array<{ price: number; quantity: number; depth: number }>;
    totalBidVolume: number;
    totalAskVolume: number;
    bestBid: number;
    bestAsk: number;
    spread: number;
    spreadPercent: number;
  };
  external: {
    providers: Array<{
      name: string;
      bidPrice?: number;
      askPrice?: number;
      bidQuantity?: number;
      askQuantity?: number;
      available: boolean;
    }>;
    bestBid?: { provider: string; price: number; quantity: number };
    bestAsk?: { provider: string; price: number; quantity: number };
  };
  comparison: {
    internalBetter: boolean;
    priceDifference: number; // Percentage
    liquidityRatio: number; // Internal/External
    recommendation: 'internal' | 'external' | 'hybrid';
  };
}

export interface LiquidityAlert {
  id: string;
  timestamp: number;
  type: 'low_liquidity' | 'high_spread' | 'price_divergence' | 'provider_offline';
  severity: 'info' | 'warning' | 'critical';
  pair: string;
  message: string;
  data: any;
}

export class LiquidityMonitoringService extends EventEmitter {
  private matchingEngine: MatchingEngine;
  private liquidityAggregator: LiquidityAggregator;
  private monitoringInterval: NodeJS.Timer | null = null;
  private snapshots: Map<string, LiquiditySnapshot[]> = new Map();
  private alerts: LiquidityAlert[] = [];
  private config = {
    monitoringInterval: 10000, // 10 seconds
    snapshotRetention: 3600000, // 1 hour
    alertThresholds: {
      lowLiquidityVolume: 100, // Minimum volume in USD
      highSpreadPercent: 1, // 1%
      priceDivergencePercent: 0.5, // 0.5%
    }
  };

  constructor(
    matchingEngine: MatchingEngine,
    liquidityAggregator: LiquidityAggregator
  ) {
    super();
    this.matchingEngine = matchingEngine;
    this.liquidityAggregator = liquidityAggregator;
  }

  startMonitoring(pairs: string[]): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.monitoringInterval = setInterval(async () => {
      for (const pair of pairs) {
        try {
          const snapshot = await this.takeLiquiditySnapshot(pair);
          this.storeSnapshot(pair, snapshot);
          this.analyzeSnapshot(snapshot);
        } catch (error) {
          console.error(`Error monitoring liquidity for ${pair}:`, error);
        }
      }
    }, this.config.monitoringInterval);

    this.emit('monitoring:started', { pairs });
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.emit('monitoring:stopped');
    }
  }

  private async takeLiquiditySnapshot(pair: string): Promise<LiquiditySnapshot> {
    // Get internal order book
    const orderBook = this.matchingEngine.getOrderBookSnapshot(pair);
    
    // Calculate internal liquidity metrics
    const bidLiquidity = this.calculateLiquidityDepth(orderBook.bids);
    const askLiquidity = this.calculateLiquidityDepth(orderBook.asks);
    const bestBid = orderBook.bids[0]?.[0] || 0;
    const bestAsk = orderBook.asks[0]?.[0] || 0;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    // Get external liquidity
    const externalProviders: any[] = [];
    let externalBestBid: any = null;
    let externalBestAsk: any = null;

    try {
      // Get quotes from all providers
      const [buyQuotes, sellQuotes] = await Promise.all([
        this.liquidityAggregator.getAllQuotes(pair, 'buy', 1), // 1 unit for price discovery
        this.liquidityAggregator.getAllQuotes(pair, 'sell', 1)
      ]);

      // Process buy quotes (these give us ask prices)
      for (const { quote, provider } of buyQuotes) {
        const providerData = {
          name: provider.getName(),
          askPrice: quote.price,
          askQuantity: quote.quantity,
          available: true
        };
        externalProviders.push(providerData);

        if (!externalBestAsk || quote.price < externalBestAsk.price) {
          externalBestAsk = {
            provider: provider.getName(),
            price: quote.price,
            quantity: quote.quantity
          };
        }
      }

      // Process sell quotes (these give us bid prices)
      for (const { quote, provider } of sellQuotes) {
        const existing = externalProviders.find(p => p.name === provider.getName());
        if (existing) {
          existing.bidPrice = quote.price;
          existing.bidQuantity = quote.quantity;
        } else {
          externalProviders.push({
            name: provider.getName(),
            bidPrice: quote.price,
            bidQuantity: quote.quantity,
            available: true
          });
        }

        if (!externalBestBid || quote.price > externalBestBid.price) {
          externalBestBid = {
            provider: provider.getName(),
            price: quote.price,
            quantity: quote.quantity
          };
        }
      }
    } catch (error) {
      console.error('Error fetching external quotes:', error);
    }

    // Compare internal vs external
    const comparison = this.compareInternalExternal(
      { bestBid, bestAsk, totalVolume: bidLiquidity.totalVolume + askLiquidity.totalVolume },
      { bestBid: externalBestBid, bestAsk: externalBestAsk }
    );

    return {
      timestamp: Date.now(),
      pair,
      internal: {
        bidLiquidity: bidLiquidity.levels,
        askLiquidity: askLiquidity.levels,
        totalBidVolume: bidLiquidity.totalVolume,
        totalAskVolume: askLiquidity.totalVolume,
        bestBid,
        bestAsk,
        spread,
        spreadPercent
      },
      external: {
        providers: externalProviders,
        bestBid: externalBestBid,
        bestAsk: externalBestAsk
      },
      comparison
    };
  }

  private calculateLiquidityDepth(
    levels: Array<[number, number]>
  ): {
    levels: Array<{ price: number; quantity: number; depth: number }>;
    totalVolume: number;
  } {
    let cumulativeVolume = 0;
    const depthLevels = levels.slice(0, 20).map(([price, quantity]) => {
      cumulativeVolume += quantity * price;
      return {
        price,
        quantity,
        depth: cumulativeVolume
      };
    });

    return {
      levels: depthLevels,
      totalVolume: cumulativeVolume
    };
  }

  private compareInternalExternal(
    internal: any,
    external: any
  ): {
    internalBetter: boolean;
    priceDifference: number;
    liquidityRatio: number;
    recommendation: 'internal' | 'external' | 'hybrid';
  } {
    // Calculate price difference
    let priceDifference = 0;
    if (external.bestBid && internal.bestBid) {
      priceDifference = ((external.bestBid.price - internal.bestBid) / internal.bestBid) * 100;
    }

    // For now, simple comparison
    const internalBetter = Math.abs(priceDifference) < 0.5; // Within 0.5%
    const liquidityRatio = internal.totalVolume / (external.bestBid?.quantity || 1);

    let recommendation: 'internal' | 'external' | 'hybrid' = 'internal';
    if (!internalBetter && external.bestBid) {
      recommendation = 'external';
    } else if (liquidityRatio < 0.5) {
      recommendation = 'hybrid'; // Internal liquidity is low
    }

    return {
      internalBetter,
      priceDifference,
      liquidityRatio,
      recommendation
    };
  }

  private storeSnapshot(pair: string, snapshot: LiquiditySnapshot): void {
    if (!this.snapshots.has(pair)) {
      this.snapshots.set(pair, []);
    }

    const pairSnapshots = this.snapshots.get(pair)!;
    pairSnapshots.push(snapshot);

    // Clean old snapshots
    const cutoff = Date.now() - this.config.snapshotRetention;
    const filtered = pairSnapshots.filter(s => s.timestamp > cutoff);
    this.snapshots.set(pair, filtered);
  }

  private analyzeSnapshot(snapshot: LiquiditySnapshot): void {
    const alerts: LiquidityAlert[] = [];

    // Check for low liquidity
    const totalInternalVolume = snapshot.internal.totalBidVolume + snapshot.internal.totalAskVolume;
    if (totalInternalVolume < this.config.alertThresholds.lowLiquidityVolume) {
      alerts.push({
        id: `ALERT-${Date.now()}-LOW-LIQ`,
        timestamp: Date.now(),
        type: 'low_liquidity',
        severity: 'warning',
        pair: snapshot.pair,
        message: `Low internal liquidity detected: $${totalInternalVolume.toFixed(2)}`,
        data: { volume: totalInternalVolume }
      });
    }

    // Check for high spread
    if (snapshot.internal.spreadPercent > this.config.alertThresholds.highSpreadPercent) {
      alerts.push({
        id: `ALERT-${Date.now()}-HIGH-SPREAD`,
        timestamp: Date.now(),
        type: 'high_spread',
        severity: 'warning',
        pair: snapshot.pair,
        message: `High spread detected: ${snapshot.internal.spreadPercent.toFixed(2)}%`,
        data: { spread: snapshot.internal.spread, spreadPercent: snapshot.internal.spreadPercent }
      });
    }

    // Check for price divergence
    if (Math.abs(snapshot.comparison.priceDifference) > this.config.alertThresholds.priceDivergencePercent) {
      alerts.push({
        id: `ALERT-${Date.now()}-PRICE-DIV`,
        timestamp: Date.now(),
        type: 'price_divergence',
        severity: 'info',
        pair: snapshot.pair,
        message: `Price divergence between internal and external: ${snapshot.comparison.priceDifference.toFixed(2)}%`,
        data: { divergence: snapshot.comparison.priceDifference }
      });
    }

    // Store and emit alerts
    for (const alert of alerts) {
      this.alerts.push(alert);
      this.emit('liquidity:alert', alert);
    }
  }

  // Public methods for querying
  getLatestSnapshot(pair: string): LiquiditySnapshot | null {
    const snapshots = this.snapshots.get(pair);
    return snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  }

  getSnapshots(pair: string, duration: number = 3600000): LiquiditySnapshot[] {
    const snapshots = this.snapshots.get(pair) || [];
    const cutoff = Date.now() - duration;
    return snapshots.filter(s => s.timestamp > cutoff);
  }

  getLiquidityTrend(pair: string): {
    trend: 'increasing' | 'decreasing' | 'stable';
    changePercent: number;
    avgSpread: number;
    avgVolume: number;
  } {
    const snapshots = this.getSnapshots(pair, 600000); // Last 10 minutes
    
    if (snapshots.length < 2) {
      return {
        trend: 'stable',
        changePercent: 0,
        avgSpread: 0,
        avgVolume: 0
      };
    }

    const recent = snapshots.slice(-5);
    const older = snapshots.slice(0, 5);

    const recentVolume = recent.reduce((sum, s) => 
      sum + s.internal.totalBidVolume + s.internal.totalAskVolume, 0
    ) / recent.length;

    const olderVolume = older.reduce((sum, s) => 
      sum + s.internal.totalBidVolume + s.internal.totalAskVolume, 0
    ) / older.length;

    const changePercent = ((recentVolume - olderVolume) / olderVolume) * 100;
    
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (changePercent > 10) trend = 'increasing';
    else if (changePercent < -10) trend = 'decreasing';

    const avgSpread = snapshots.reduce((sum, s) => sum + s.internal.spreadPercent, 0) / snapshots.length;
    const avgVolume = snapshots.reduce((sum, s) => 
      sum + s.internal.totalBidVolume + s.internal.totalAskVolume, 0
    ) / snapshots.length;

    return {
      trend,
      changePercent,
      avgSpread,
      avgVolume
    };
  }

  getRecentAlerts(limit: number = 10): LiquidityAlert[] {
    return this.alerts.slice(-limit);
  }

  clearAlerts(): void {
    this.alerts = [];
  }

  updateConfig(config: Partial<typeof this.config>): void {
    Object.assign(this.config, config);
    this.emit('config:updated', this.config);
  }
}