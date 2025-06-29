import { PriceAggregator } from '../PriceAggregator';
import { PriceSource } from '../types';

describe('PriceAggregator', () => {
  let aggregator: PriceAggregator;

  beforeEach(() => {
    aggregator = new PriceAggregator(true, true);
  });

  describe('aggregate', () => {
    it('should calculate weighted average price', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 2000, weight: 1.2, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 101, volume: 1000, weight: 1.0, timestamp: Date.now() },
        { exchange: 'Kraken', price: 99, volume: 500, weight: 0.8, timestamp: Date.now() }
      ];

      const result = aggregator.aggregate('BTC/USDT', sources, true, false);

      expect(result.symbol).toBe('BTC/USDT');
      expect(result.price).toBeGreaterThan(99);
      expect(result.price).toBeLessThan(101);
      expect(result.sources).toHaveLength(3);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should handle outlier removal', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 101, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Kraken', price: 99, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'BadExchange', price: 150, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      const result = aggregator.aggregate('BTC/USDT', sources);

      expect(result.outliers).toHaveLength(1);
      expect(result.outliers[0].exchange).toBe('BadExchange');
      expect(result.sources).toHaveLength(3);
    });

    it('should update reputation scores', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 100.5, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Kraken', price: 99.5, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      aggregator.aggregate('BTC/USDT', sources);
      const reputations = aggregator.getReputations();

      expect(reputations.size).toBe(3);
      reputations.forEach(rep => {
        expect(rep.totalSubmissions).toBe(1);
        expect(rep.score).toBeGreaterThan(0);
        expect(rep.score).toBeLessThanOrEqual(1);
      });
    });

    it('should throw error when no valid sources after filtering', () => {
      const sources: PriceSource[] = [];

      expect(() => {
        aggregator.aggregate('BTC/USDT', sources);
      }).toThrow('No valid price sources');
    });

    it('should handle volume-based weighting', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 10000, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 105, volume: 100, weight: 1, timestamp: Date.now() }
      ];

      const result = aggregator.aggregate('BTC/USDT', sources, true, false);
      
      // Price should be much closer to Binance due to volume weighting
      expect(result.price).toBeCloseTo(100, 1);
    });
  });

  describe('reputation management', () => {
    it('should reset reputation for specific exchange', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      aggregator.aggregate('BTC/USDT', sources);
      expect(aggregator.getReputations().has('Binance')).toBe(true);

      aggregator.resetReputation('Binance');
      expect(aggregator.getReputations().has('Binance')).toBe(false);
    });
  });
});