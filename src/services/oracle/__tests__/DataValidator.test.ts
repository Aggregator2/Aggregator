import { DataValidator } from '../DataValidator';
import { PriceData, PriceSource, OracleConfig } from '../types';

describe('DataValidator', () => {
  let validator: DataValidator;
  const config: OracleConfig = {
    exchanges: [],
    outlierThreshold: 0.05,
    minSources: 2,
    maxPriceAge: 60000,
    volumeWeightEnabled: true,
    reputationEnabled: true
  };

  beforeEach(() => {
    validator = new DataValidator(config);
  });

  describe('validatePriceData', () => {
    it('should validate correct price data', () => {
      const data: PriceData = {
        symbol: 'BTC/USDT',
        price: 50000,
        volume24h: 1000000,
        timestamp: Date.now(),
        source: 'Binance'
      };

      const result = validator.validatePriceData(data);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid symbol format', () => {
      const data: PriceData = {
        symbol: 'btc-usdt',
        price: 50000,
        volume24h: 1000000,
        timestamp: Date.now(),
        source: 'Binance'
      };

      const result = validator.validatePriceData(data);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid symbol format: btc-usdt');
    });

    it('should reject invalid prices', () => {
      const data: PriceData = {
        symbol: 'BTC/USDT',
        price: -100,
        volume24h: 1000000,
        timestamp: Date.now(),
        source: 'Binance'
      };

      const result = validator.validatePriceData(data);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid price: -100');
    });

    it('should reject stale data', () => {
      const data: PriceData = {
        symbol: 'BTC/USDT',
        price: 50000,
        volume24h: 1000000,
        timestamp: Date.now() - 120000, // 2 minutes old
        source: 'Binance'
      };

      const result = validator.validatePriceData(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Stale price data'))).toBe(true);
    });

    it('should warn about suspicious volume', () => {
      const data: PriceData = {
        symbol: 'BTC/USDT',
        price: 50000,
        volume24h: -100,
        timestamp: Date.now(),
        source: 'Binance'
      };

      const result = validator.validatePriceData(data);
      expect(result.warnings).toContain('Suspicious volume: -100');
    });
  });

  describe('validatePriceSources', () => {
    it('should validate multiple price sources', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 101, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      const result = validator.validatePriceSources(sources);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect duplicate exchanges', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Binance', price: 101, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      const result = validator.validatePriceSources(sources);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Duplicate exchange: Binance');
    });

    it('should warn about high price variance', () => {
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 120, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      const result = validator.validatePriceSources(sources);
      expect(result.warnings.some(w => w.includes('High price variance'))).toBe(true);
    });
  });

  describe('sanitizePriceData', () => {
    it('should sanitize price data', () => {
      const data: PriceData = {
        symbol: 'btc/usdt',
        price: 1000000001,
        volume24h: -100,
        timestamp: Date.now() + 10000,
        source: '  Binance  '
      };

      const sanitized = validator.sanitizePriceData(data);
      
      expect(sanitized.symbol).toBe('BTC/USDT');
      expect(sanitized.price).toBe(1000000000);
      expect(sanitized.volume24h).toBe(0);
      expect(sanitized.timestamp).toBeLessThanOrEqual(Date.now());
      expect(sanitized.source).toBe('Binance');
    });
  });

  describe('isHealthyDataFeed', () => {
    it('should identify healthy data feeds', () => {
      expect(validator.isHealthyDataFeed(5, 100)).toBe(true);
      expect(validator.isHealthyDataFeed(0, 100)).toBe(true);
    });

    it('should identify unhealthy data feeds', () => {
      expect(validator.isHealthyDataFeed(15, 100)).toBe(false);
      expect(validator.isHealthyDataFeed(20, 100)).toBe(false);
    });

    it('should handle zero requests', () => {
      expect(validator.isHealthyDataFeed(0, 0)).toBe(true);
    });
  });
});