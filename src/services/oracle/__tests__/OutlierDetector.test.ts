import { OutlierDetector } from '../OutlierDetector';
import { PriceSource } from '../types';

describe('OutlierDetector', () => {
  let detector: OutlierDetector;

  beforeEach(() => {
    detector = new OutlierDetector(0.05, 3);
  });

  describe('detectOutliers', () => {
    it('should detect price outliers based on deviation threshold', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 101, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Kraken', price: 99, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'FakeExchange', price: 150, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      const result = detector.detectOutliers(sources);

      expect(result.outliers).toHaveLength(1);
      expect(result.outliers[0].exchange).toBe('FakeExchange');
      expect(result.cleanSources).toHaveLength(3);
    });

    it('should handle all prices being similar', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 100.5, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Kraken', price: 99.5, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      const result = detector.detectOutliers(sources);

      expect(result.outliers).toHaveLength(0);
      expect(result.cleanSources).toHaveLength(3);
    });

    it('should not filter when sources are below minimum', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 200, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      const result = detector.detectOutliers(sources);

      expect(result.outliers).toHaveLength(0);
      expect(result.cleanSources).toHaveLength(2);
    });
  });

  describe('detectPriceSpike', () => {
    it('should detect significant price spikes', () => {
      const historicalPrices = [100, 101, 99, 100, 102];
      const currentPrice = 115;

      const isSpike = detector.detectPriceSpike(currentPrice, historicalPrices);
      expect(isSpike).toBe(true);
    });

    it('should not flag normal price movements', () => {
      const historicalPrices = [100, 101, 99, 100, 102];
      const currentPrice = 103;

      const isSpike = detector.detectPriceSpike(currentPrice, historicalPrices);
      expect(isSpike).toBe(false);
    });
  });

  describe('detectVolumeAnomaly', () => {
    it('should detect volume anomalies', () => {
      const historicalVolumes = [1000, 1100, 900, 1050, 950, 1000, 1100, 900, 1000, 1050];
      const currentVolume = 5000;

      const isAnomaly = detector.detectVolumeAnomaly(currentVolume, historicalVolumes);
      expect(isAnomaly).toBe(true);
    });

    it('should not flag normal volume variations', () => {
      const historicalVolumes = [1000, 1100, 900, 1050, 950, 1000, 1100, 900, 1000, 1050];
      const currentVolume = 1200;

      const isAnomaly = detector.detectVolumeAnomaly(currentVolume, historicalVolumes);
      expect(isAnomaly).toBe(false);
    });
  });
});