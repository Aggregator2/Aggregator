import { EventEmitter } from 'events';
import { PriceData, ManipulationAlert, PriceSource } from './types';

interface PriceHistory {
  prices: number[];
  volumes: number[];
  timestamps: number[];
}

interface OrderActivity {
  orderId: string;
  symbol: string;
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  placedAt: number;
  cancelledAt?: number;
  exchange: string;
}

interface SpoofingPattern {
  exchange: string;
  symbol: string;
  cancelledOrders: OrderActivity[];
  lastDetected: number;
}

export class EnhancedManipulationDetector extends EventEmitter {
  private priceHistory: Map<string, PriceHistory> = new Map();
  private orderHistory: Map<string, OrderActivity[]> = new Map();
  private spoofingPatterns: Map<string, SpoofingPattern[]> = new Map();
  
  private readonly historySize: number = 100;
  private readonly pumpThreshold: number = 0.15;
  private readonly dumpThreshold: number = 0.15;
  private readonly volumeSpikeThreshold: number = 5;
  private readonly washTradingThreshold: number = 0.8;
  
  // Spoofing detection parameters
  private readonly spoofingTimeWindow: number = 30000; // 30 seconds
  private readonly spoofingVolumeThreshold: number = 0.01; // 1% of daily volume
  private readonly spoofingCountThreshold: number = 3; // 3 cancelled orders
  private readonly spoofingPriceDeviation: number = 0.05; // 5% from market price

  detectManipulation(
    symbol: string,
    currentData: PriceData,
    sources: PriceSource[],
    orderData?: { orders?: OrderActivity[]; avgMarketPrice?: number; volume24h?: number }
  ): ManipulationAlert[] {
    const alerts: ManipulationAlert[] = [];
    const history = this.getOrCreateHistory(symbol);

    if (history.prices.length >= 5) {
      const pumpAlert = this.detectPumpScheme(symbol, currentData, history);
      if (pumpAlert) alerts.push(pumpAlert);

      const dumpAlert = this.detectDumpScheme(symbol, currentData, history);
      if (dumpAlert) alerts.push(dumpAlert);

      const washAlert = this.detectWashTrading(symbol, sources, history);
      if (washAlert) alerts.push(washAlert);

      // Enhanced spoofing detection with order data
      if (orderData?.orders) {
        const spoofingAlert = this.detectEnhancedSpoofing(
          symbol, 
          sources, 
          orderData.orders,
          orderData.avgMarketPrice || currentData.price,
          orderData.volume24h || currentData.volume24h
        );
        if (spoofingAlert) alerts.push(spoofingAlert);
      } else {
        // Fallback to simple price spread detection
        const spoofingAlert = this.detectSpoofing(symbol, sources);
        if (spoofingAlert) alerts.push(spoofingAlert);
      }
    }

    this.updateHistory(symbol, currentData);
    
    alerts.forEach(alert => this.emit('manipulation-detected', alert));
    
    return alerts;
  }

  // Track order placement
  trackOrderPlacement(order: OrderActivity): void {
    const key = `${order.symbol}-${order.exchange}`;
    const orders = this.orderHistory.get(key) || [];
    orders.push(order);
    
    // Keep only recent orders (last 1000)
    if (orders.length > 1000) {
      orders.splice(0, orders.length - 1000);
    }
    
    this.orderHistory.set(key, orders);
  }

  // Track order cancellation
  trackOrderCancellation(orderId: string, symbol: string, exchange: string, cancelledAt: number): void {
    const key = `${symbol}-${exchange}`;
    const orders = this.orderHistory.get(key) || [];
    
    const order = orders.find(o => o.orderId === orderId);
    if (order) {
      order.cancelledAt = cancelledAt;
    }
  }

  private detectEnhancedSpoofing(
    symbol: string,
    sources: PriceSource[],
    recentOrders: OrderActivity[],
    avgMarketPrice: number,
    volume24h: number
  ): ManipulationAlert | null {
    const now = Date.now();
    
    // Group orders by exchange
    const ordersByExchange = new Map<string, OrderActivity[]>();
    recentOrders.forEach(order => {
      if (order.symbol === symbol) {
        const orders = ordersByExchange.get(order.exchange) || [];
        orders.push(order);
        ordersByExchange.set(order.exchange, orders);
      }
    });

    // Check each exchange for spoofing patterns
    for (const [exchange, orders] of ordersByExchange) {
      // Find quickly cancelled large orders
      const suspiciousOrders = orders.filter(order => {
        if (!order.cancelledAt) return false;
        
        const duration = order.cancelledAt - order.placedAt;
        const isQuicklyCancelled = duration < this.spoofingTimeWindow;
        const isLargeOrder = order.amount > volume24h * this.spoofingVolumeThreshold;
        const isFarFromMarket = Math.abs(order.price - avgMarketPrice) / avgMarketPrice > this.spoofingPriceDeviation;
        
        return isQuicklyCancelled && (isLargeOrder || isFarFromMarket);
      });

      // Check if we have enough suspicious orders to constitute spoofing
      if (suspiciousOrders.length >= this.spoofingCountThreshold) {
        // Update spoofing patterns tracking
        const patterns = this.spoofingPatterns.get(exchange) || [];
        patterns.push({
          exchange,
          symbol,
          cancelledOrders: suspiciousOrders,
          lastDetected: now
        });
        this.spoofingPatterns.set(exchange, patterns);

        // Calculate severity based on order characteristics
        const avgOrderSize = suspiciousOrders.reduce((sum, o) => sum + o.amount, 0) / suspiciousOrders.length;
        const avgCancelTime = suspiciousOrders.reduce((sum, o) => 
          sum + (o.cancelledAt! - o.placedAt), 0) / suspiciousOrders.length;
        
        const severity = this.calculateSpoofingSeverity(
          avgOrderSize / volume24h,
          avgCancelTime,
          suspiciousOrders.length
        );

        return {
          symbol,
          type: 'spoofing',
          severity,
          exchange,
          details: `Detected ${suspiciousOrders.length} large orders placed and cancelled within ${Math.round(avgCancelTime / 1000)}s. ` +
                   `Average order size: ${(avgOrderSize / volume24h * 100).toFixed(2)}% of daily volume`,
          timestamp: now
        };
      }
    }

    // Fallback to price spread detection if no order data indicates spoofing
    return this.detectSpoofing(symbol, sources);
  }

  private calculateSpoofingSeverity(
    avgOrderSizeRatio: number,
    avgCancelTime: number,
    orderCount: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    let score = 0;
    
    // Order size contribution
    if (avgOrderSizeRatio > 0.1) score += 3;
    else if (avgOrderSizeRatio > 0.05) score += 2;
    else if (avgOrderSizeRatio > 0.01) score += 1;
    
    // Cancel time contribution
    if (avgCancelTime < 5000) score += 3;
    else if (avgCancelTime < 15000) score += 2;
    else if (avgCancelTime < 30000) score += 1;
    
    // Order count contribution
    if (orderCount >= 10) score += 3;
    else if (orderCount >= 5) score += 2;
    else if (orderCount >= 3) score += 1;
    
    if (score >= 7) return 'critical';
    if (score >= 5) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
  }

  private detectPumpScheme(
    symbol: string,
    current: PriceData,
    history: PriceHistory
  ): ManipulationAlert | null {
    const recentPrices = history.prices.slice(-10);
    const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const priceIncrease = (current.price - avgPrice) / avgPrice;

    const recentVolumes = history.volumes.slice(-10);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const volumeIncrease = current.volume24h / avgVolume;

    if (priceIncrease > this.pumpThreshold && volumeIncrease > this.volumeSpikeThreshold) {
      return {
        symbol,
        type: 'pump',
        severity: priceIncrease > 0.3 ? 'critical' : 'high',
        exchange: current.source,
        details: `Price increased ${(priceIncrease * 100).toFixed(2)}% with ${volumeIncrease.toFixed(2)}x volume spike`,
        timestamp: Date.now()
      };
    }

    return null;
  }

  private detectDumpScheme(
    symbol: string,
    current: PriceData,
    history: PriceHistory
  ): ManipulationAlert | null {
    const recentPrices = history.prices.slice(-10);
    const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const priceDecrease = (avgPrice - current.price) / avgPrice;

    if (priceDecrease > this.dumpThreshold) {
      const timeSinceHigh = this.getTimeSinceHigh(history);
      const severity = priceDecrease > 0.3 || timeSinceHigh < 3600000 ? 'critical' : 'high';

      return {
        symbol,
        type: 'dump',
        severity,
        exchange: current.source,
        details: `Price dropped ${(priceDecrease * 100).toFixed(2)}% in short period`,
        timestamp: Date.now()
      };
    }

    return null;
  }

  private detectWashTrading(
    symbol: string,
    sources: PriceSource[],
    history: PriceHistory
  ): ManipulationAlert | null {
    const priceVariance = this.calculateVariance(sources.map(s => s.price));
    const avgPrice = sources.reduce((sum, s) => sum + s.price, 0) / sources.length;
    const normalizedVariance = Math.sqrt(priceVariance) / avgPrice;

    const volumePattern = this.detectVolumePattern(history.volumes);
    const priceStability = this.calculatePriceStability(history.prices);
    const volumeAlternation = this.detectVolumeAlternation(history.volumes);
    
    if ((normalizedVariance < 0.001 && volumePattern > this.washTradingThreshold) ||
        (priceStability > 0.95 && volumeAlternation > 0.7)) {
      return {
        symbol,
        type: 'wash_trading',
        severity: 'medium',
        exchange: 'Multiple',
        details: `Suspicious volume patterns detected with minimal price movement`,
        timestamp: Date.now()
      };
    }

    return null;
  }

  private detectSpoofing(
    symbol: string,
    sources: PriceSource[]
  ): ManipulationAlert | null {
    const priceSpread = Math.max(...sources.map(s => s.price)) - Math.min(...sources.map(s => s.price));
    const avgPrice = sources.reduce((sum, s) => sum + s.price, 0) / sources.length;
    const spreadPercentage = priceSpread / avgPrice;

    if (spreadPercentage > 0.05 && sources.length >= 3) {
      const outlierExchanges = sources
        .filter(s => Math.abs(s.price - avgPrice) / avgPrice > 0.03)
        .map(s => s.exchange);

      if (outlierExchanges.length === 1) {
        return {
          symbol,
          type: 'spoofing',
          severity: 'medium',
          exchange: outlierExchanges[0],
          details: `Potential spoofing detected with ${(spreadPercentage * 100).toFixed(2)}% price spread`,
          timestamp: Date.now()
        };
      }
    }

    return null;
  }

  private getOrCreateHistory(symbol: string): PriceHistory {
    let history = this.priceHistory.get(symbol);
    if (!history) {
      history = { prices: [], volumes: [], timestamps: [] };
      this.priceHistory.set(symbol, history);
    }
    return history;
  }

  private updateHistory(symbol: string, data: PriceData): void {
    const history = this.getOrCreateHistory(symbol);
    
    history.prices.push(data.price);
    history.volumes.push(data.volume24h);
    history.timestamps.push(data.timestamp);

    if (history.prices.length > this.historySize) {
      history.prices.shift();
      history.volumes.shift();
      history.timestamps.shift();
    }
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  private detectVolumePattern(volumes: number[]): number {
    if (volumes.length < 10) return 0;

    const uniqueVolumes = new Set(volumes);
    const repetitionScore = 1 - (uniqueVolumes.size / volumes.length);
    
    let alternatingCount = 0;
    for (let i = 2; i < volumes.length; i++) {
      if (Math.abs(volumes[i] - volumes[i - 2]) < volumes[i] * 0.01) {
        alternatingCount++;
      }
    }
    const alternatingScore = alternatingCount / (volumes.length - 2);
    
    return Math.max(repetitionScore, alternatingScore);
  }

  private calculatePriceStability(prices: number[]): number {
    if (prices.length < 10) return 0;
    
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const maxDeviation = Math.max(...prices.map(p => Math.abs(p - avgPrice) / avgPrice));
    
    return 1 - maxDeviation;
  }

  private detectVolumeAlternation(volumes: number[]): number {
    if (volumes.length < 10) return 0;
    
    let alternations = 0;
    const diffs = [];
    
    for (let i = 1; i < volumes.length; i++) {
      diffs.push(volumes[i] - volumes[i - 1]);
    }
    
    for (let i = 1; i < diffs.length; i++) {
      if (Math.sign(diffs[i]) !== Math.sign(diffs[i - 1])) {
        alternations++;
      }
    }
    
    return alternations / (diffs.length - 1);
  }

  private getTimeSinceHigh(history: PriceHistory): number {
    const maxPrice = Math.max(...history.prices);
    const maxIndex = history.prices.lastIndexOf(maxPrice);
    return Date.now() - history.timestamps[maxIndex];
  }

  clearHistory(symbol?: string): void {
    if (symbol) {
      this.priceHistory.delete(symbol);
      const keysToDelete: string[] = [];
      this.orderHistory.forEach((_, key) => {
        if (key.startsWith(symbol + '-')) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => this.orderHistory.delete(key));
    } else {
      this.priceHistory.clear();
      this.orderHistory.clear();
      this.spoofingPatterns.clear();
    }
  }

  // Get spoofing statistics for monitoring
  getSpoofingStats(exchange?: string): { 
    totalPatterns: number; 
    recentPatterns: number; 
    exchanges: string[] 
  } {
    const oneHourAgo = Date.now() - 3600000;
    let totalPatterns = 0;
    let recentPatterns = 0;
    const exchanges = new Set<string>();

    this.spoofingPatterns.forEach((patterns, ex) => {
      if (!exchange || ex === exchange) {
        totalPatterns += patterns.length;
        patterns.forEach(p => {
          if (p.lastDetected > oneHourAgo) {
            recentPatterns++;
          }
          exchanges.add(p.exchange);
        });
      }
    });

    return {
      totalPatterns,
      recentPatterns,
      exchanges: Array.from(exchanges)
    };
  }
}

// Export the OrderActivity interface for external use
export type { OrderActivity };