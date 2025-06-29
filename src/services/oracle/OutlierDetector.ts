import { PriceSource, OutlierData } from './types';

export class OutlierDetector {
  private readonly threshold: number;
  private readonly minSources: number;

  constructor(threshold: number = 0.05, minSources: number = 3) {
    this.threshold = threshold;
    this.minSources = minSources;
  }

  detectOutliers(sources: PriceSource[]): {
    cleanSources: PriceSource[];
    outliers: OutlierData[];
  } {
    if (sources.length < this.minSources) {
      return { cleanSources: sources, outliers: [] };
    }

    const prices = sources.map(s => s.price);
    const median = this.calculateMedian(prices);
    const mad = this.calculateMAD(prices, median);
    const outliers: OutlierData[] = [];
    const cleanSources: PriceSource[] = [];

    sources.forEach(source => {
      const deviation = Math.abs(source.price - median) / median;
      const madScore = Math.abs(source.price - median) / (mad || 1);

      if (deviation > this.threshold || madScore > 3.5) {
        source.isOutlier = true;
        outliers.push({
          exchange: source.exchange,
          price: source.price,
          deviation,
          reason: this.getOutlierReason(deviation, madScore)
        });
      } else {
        cleanSources.push(source);
      }
    });

    return { cleanSources, outliers };
  }

  private calculateMedian(prices: number[]): number {
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    
    return sorted[mid];
  }

  private calculateMAD(prices: number[], median: number): number {
    const deviations = prices.map(p => Math.abs(p - median));
    return this.calculateMedian(deviations);
  }

  private getOutlierReason(deviation: number, madScore: number): string {
    const reasons = [];
    
    if (deviation > this.threshold) {
      reasons.push(`Price deviation ${(deviation * 100).toFixed(2)}% exceeds threshold`);
    }
    
    if (madScore > 3.5) {
      reasons.push(`MAD score ${madScore.toFixed(2)} indicates statistical outlier`);
    }
    
    return reasons.join('; ');
  }

  detectPriceSpike(currentPrice: number, historicalPrices: number[]): boolean {
    if (historicalPrices.length < 5) return false;
    
    const recentAvg = historicalPrices.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const spikeThreshold = 0.1;
    
    return Math.abs(currentPrice - recentAvg) / recentAvg > spikeThreshold;
  }

  detectVolumeAnomaly(currentVolume: number, historicalVolumes: number[]): boolean {
    if (historicalVolumes.length < 10) return false;
    
    const avgVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
    const volumeThreshold = 3;
    
    return currentVolume > avgVolume * volumeThreshold;
  }
}