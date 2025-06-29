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
  private readonly washTradingThreshold: number = 0.9;

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
    const priceVariance = this.calculateVariance(sources.map(s => s.price));
    const avgPrice = sources.reduce((sum, s) => sum + s.price, 0) / sources.length;
    const normalizedVariance = Math.sqrt(priceVariance) / avgPrice;

    const volumePattern = this.detectVolumePattern(history.volumes);
    
    if (normalizedVariance < 0.001 && volumePattern > this.washTradingThreshold) {
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

    const diffs = [];
    for (let i = 1; i < volumes.length; i++) {
      diffs.push(Math.abs(volumes[i] - volumes[i - 1]));
    }

    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    return avgDiff / avgVolume;
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