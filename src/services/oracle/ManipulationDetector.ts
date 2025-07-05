import { EventEmitter } from 'events';
import { PriceData, ManipulationAlert, PriceSource } from './types';

interface PriceHistory {
  prices: number[];
  volumes: number[];
  timestamps: number[];
}

export class ManipulationDetector extends EventEmitter {
  private priceHistory: Map<string, PriceHistory> = new Map();
  private readonly historySize: number = 100;
  private readonly pumpThreshold: number = 0.15;
  private readonly dumpThreshold: number = 0.15;
  private readonly volumeSpikeThreshold: number = 5;
  private readonly washTradingThreshold: number = 0.8;

  detectManipulation(
    symbol: string,
    currentData: PriceData,
    sources: PriceSource[]
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

      const spoofingAlert = this.detectSpoofing(symbol, sources);
      if (spoofingAlert) alerts.push(spoofingAlert);
    }

    this.updateHistory(symbol, currentData);
    
    alerts.forEach(alert => this.emit('manipulation-detected', alert));
    
    return alerts;
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
    // Check for minimal price variance across sources
    const priceVariance = this.calculateVariance(sources.map(s => s.price));
    const avgPrice = sources.reduce((sum, s) => sum + s.price, 0) / sources.length;
    const normalizedVariance = Math.sqrt(priceVariance) / avgPrice;

    // Check for repetitive volume patterns
    const volumePattern = this.detectVolumePattern(history.volumes);
    
    // Check for consistent price with alternating volume (typical wash trading pattern)
    const priceStability = this.calculatePriceStability(history.prices);
    const volumeAlternation = this.detectVolumeAlternation(history.volumes);
    
    // Wash trading typically shows:
    // 1. Very low price variance (prices stay almost the same)
    // 2. High volume pattern score (repetitive volumes)
    // 3. Stable prices over time
    // 4. Alternating volume patterns
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
        .filter(s => Math.abs(s.price - avgPrice) / avgPrice > 0.05)
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

    // Check for repetitive patterns
    const uniqueVolumes = new Set(volumes);
    const repetitionScore = 1 - (uniqueVolumes.size / volumes.length);
    
    // Check for alternating pattern
    let alternatingCount = 0;
    for (let i = 2; i < volumes.length; i++) {
      if (Math.abs(volumes[i] - volumes[i - 2]) < volumes[i] * 0.01) {
        alternatingCount++;
      }
    }
    const alternatingScore = alternatingCount / (volumes.length - 2);
    
    // Combined score - high when volumes are repetitive or alternating
    return Math.max(repetitionScore, alternatingScore);
  }

  private calculatePriceStability(prices: number[]): number {
    if (prices.length < 10) return 0;
    
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const maxDeviation = Math.max(...prices.map(p => Math.abs(p - avgPrice) / avgPrice));
    
    // Return stability score (1 = perfectly stable, 0 = highly volatile)
    return 1 - maxDeviation;
  }

  private detectVolumeAlternation(volumes: number[]): number {
    if (volumes.length < 10) return 0;
    
    let alternations = 0;
    const diffs = [];
    
    // Calculate volume differences
    for (let i = 1; i < volumes.length; i++) {
      diffs.push(volumes[i] - volumes[i - 1]);
    }
    
    // Count sign alternations
    for (let i = 1; i < diffs.length; i++) {
      if (Math.sign(diffs[i]) !== Math.sign(diffs[i - 1])) {
        alternations++;
      }
    }
    
    // Return alternation ratio
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
    } else {
      this.priceHistory.clear();
    }
  }
}