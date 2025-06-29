import { PriceSource, AggregatedPrice, OracleReputation } from './types';
import { OutlierDetector } from './OutlierDetector';

export class PriceAggregator {
  private outlierDetector: OutlierDetector;
  private reputations: Map<string, OracleReputation> = new Map();

  constructor(
    private volumeWeightEnabled: boolean = true,
    private reputationEnabled: boolean = true
  ) {
    this.outlierDetector = new OutlierDetector();
  }

  aggregate(
    symbol: string,
    sources: PriceSource[],
    useVolume: boolean = this.volumeWeightEnabled,
    useReputation: boolean = this.reputationEnabled
  ): AggregatedPrice {
    const { cleanSources, outliers } = this.outlierDetector.detectOutliers(sources);
    
    if (cleanSources.length === 0) {
      throw new Error(`No valid price sources for ${symbol} after outlier removal`);
    }

    const weights = this.calculateWeights(cleanSources, useVolume, useReputation);
    const weightedPrice = this.calculateWeightedAverage(cleanSources, weights);
    const confidence = this.calculateConfidence(cleanSources, outliers);

    this.updateReputations(symbol, cleanSources, weightedPrice);

    return {
      symbol,
      price: weightedPrice,
      sources: cleanSources,
      timestamp: Date.now(),
      confidence,
      outliers
    };
  }

  private calculateWeights(
    sources: PriceSource[],
    useVolume: boolean,
    useReputation: boolean
  ): number[] {
    const weights = sources.map(source => {
      let weight = source.weight || 1;

      if (useVolume && source.volume > 0) {
        const totalVolume = sources.reduce((sum, s) => sum + s.volume, 0);
        const volumeWeight = source.volume / totalVolume;
        weight *= volumeWeight;
      }

      if (useReputation) {
        const reputation = this.reputations.get(source.exchange);
        if (reputation) {
          weight *= reputation.score;
        }
      }

      return weight;
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    return weights.map(w => w / totalWeight);
  }

  private calculateWeightedAverage(sources: PriceSource[], weights: number[]): number {
    return sources.reduce((sum, source, index) => {
      return sum + source.price * weights[index];
    }, 0);
  }

  private calculateConfidence(
    cleanSources: PriceSource[],
    outliers: OutlierData[]
  ): number {
    const sourceCount = cleanSources.length;
    const outlierCount = outliers.length;
    const totalCount = sourceCount + outlierCount;
    
    let confidence = sourceCount / totalCount;
    
    const prices = cleanSources.map(s => s.price);
    const stdDev = this.calculateStandardDeviation(prices);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const cv = stdDev / mean;
    
    if (cv < 0.01) confidence *= 1.2;
    else if (cv < 0.02) confidence *= 1.1;
    else if (cv > 0.05) confidence *= 0.8;
    else if (cv > 0.1) confidence *= 0.6;
    
    return Math.min(Math.max(confidence, 0), 1);
  }

  private calculateStandardDeviation(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }

  private updateReputations(
    symbol: string,
    sources: PriceSource[],
    aggregatedPrice: number
  ): void {
    sources.forEach(source => {
      const reputation = this.reputations.get(source.exchange) || {
        exchange: source.exchange,
        score: 1,
        totalSubmissions: 0,
        accurateSubmissions: 0,
        averageDeviation: 0,
        lastUpdated: Date.now()
      };

      const deviation = Math.abs(source.price - aggregatedPrice) / aggregatedPrice;
      const isAccurate = deviation < 0.02;

      reputation.totalSubmissions++;
      if (isAccurate) reputation.accurateSubmissions++;

      reputation.averageDeviation = 
        (reputation.averageDeviation * (reputation.totalSubmissions - 1) + deviation) / 
        reputation.totalSubmissions;

      reputation.score = Math.min(
        reputation.accurateSubmissions / reputation.totalSubmissions * (1 - reputation.averageDeviation),
        1
      );

      reputation.lastUpdated = Date.now();
      this.reputations.set(source.exchange, reputation);
    });
  }

  getReputations(): Map<string, OracleReputation> {
    return new Map(this.reputations);
  }

  resetReputation(exchange: string): void {
    this.reputations.delete(exchange);
  }
}