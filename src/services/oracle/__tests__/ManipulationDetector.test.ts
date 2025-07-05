import { ManipulationDetector } from '../ManipulationDetector';
import { PriceData, PriceSource } from '../types';

describe('ManipulationDetector', () => {
  let detector: ManipulationDetector;

  beforeEach(() => {
    detector = new ManipulationDetector();
  });

  afterEach(() => {
    detector.clearHistory();
  });

  describe('detectManipulation', () => {
    it('should detect pump schemes', () => {
      const symbol = 'BTC/USDT';
      
      // Build price history
      for (let i = 0; i < 10; i++) {
        const priceData: PriceData = {
          symbol,
          price: 100 + (Math.random() * 2 - 1),
          volume24h: 1000,
          timestamp: Date.now() - (10 - i) * 60000,
          source: 'Test'
        };
        detector.detectManipulation(symbol, priceData, []);
      }

      // Sudden pump
      const pumpData: PriceData = {
        symbol,
        price: 120,
        volume24h: 10000,
        timestamp: Date.now(),
        source: 'Test'
      };

      const alerts = detector.detectManipulation(symbol, pumpData, []);
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('pump');
      expect(alerts[0].severity).toBe('high');
    });

    it('should detect dump schemes', () => {
      const symbol = 'BTC/USDT';
      
      // Build price history with high prices
      for (let i = 0; i < 10; i++) {
        const priceData: PriceData = {
          symbol,
          price: 120 + (Math.random() * 2 - 1),
          volume24h: 1000,
          timestamp: Date.now() - (10 - i) * 60000,
          source: 'Test'
        };
        detector.detectManipulation(symbol, priceData, []);
      }

      // Sudden dump
      const dumpData: PriceData = {
        symbol,
        price: 95,
        volume24h: 5000,
        timestamp: Date.now(),
        source: 'Test'
      };

      const alerts = detector.detectManipulation(symbol, dumpData, []);
      
      expect(alerts.length).toBeGreaterThan(0);
      const dumpAlert = alerts.find(a => a.type === 'dump');
      expect(dumpAlert).toBeDefined();
    });

    it('should detect wash trading patterns', () => {
      const symbol = 'BTC/USDT';
      
      // Build history with consistent patterns
      for (let i = 0; i < 20; i++) {
        const priceData: PriceData = {
          symbol,
          price: 100,
          volume24h: 1000 + (i % 2) * 100,
          timestamp: Date.now() - (20 - i) * 60000,
          source: 'Test'
        };
        detector.detectManipulation(symbol, priceData, []);
      }

      const sources: PriceSource[] = [
        { exchange: 'Exchange1', price: 100.01, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Exchange2', price: 99.99, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Exchange3', price: 100.00, volume: 1000, weight: 1, timestamp: Date.now() }
      ];

      const currentData: PriceData = {
        symbol,
        price: 100,
        volume24h: 1100,
        timestamp: Date.now(),
        source: 'Test'
      };

      const alerts = detector.detectManipulation(symbol, currentData, sources);
      
      const washAlert = alerts.find(a => a.type === 'wash_trading');
      expect(washAlert).toBeDefined();
    });

    it('should detect spoofing', () => {
      const symbol = 'BTC/USDT';
      
      // Build price history first (needed for detection to run)
      for (let i = 0; i < 6; i++) {
        const priceData: PriceData = {
          symbol,
          price: 100 + (Math.random() * 2 - 1),
          volume24h: 1000,
          timestamp: Date.now() - (6 - i) * 60000,
          source: 'Test'
        };
        detector.detectManipulation(symbol, priceData, []);
      }
      
      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 100, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 101, volume: 1000, weight: 1, timestamp: Date.now() },
        { exchange: 'FakeExchange', price: 110, volume: 100, weight: 1, timestamp: Date.now() }
      ];

      const currentData: PriceData = {
        symbol,
        price: 100,
        volume24h: 1000,
        timestamp: Date.now(),
        source: 'Test'
      };

      const alerts = detector.detectManipulation(symbol, currentData, sources);
      
      const spoofingAlert = alerts.find(a => a.type === 'spoofing');
      expect(spoofingAlert).toBeDefined();
      expect(spoofingAlert?.exchange).toBe('FakeExchange');
    });
  });

  describe('event emission', () => {
    it('should emit manipulation-detected events', (done) => {
      const symbol = 'BTC/USDT';
      
      detector.on('manipulation-detected', (alert) => {
        expect(alert.symbol).toBe(symbol);
        expect(alert.type).toBe('pump');
        done();
      });

      // Build history
      for (let i = 0; i < 10; i++) {
        const priceData: PriceData = {
          symbol,
          price: 100,
          volume24h: 1000,
          timestamp: Date.now() - (10 - i) * 60000,
          source: 'Test'
        };
        detector.detectManipulation(symbol, priceData, []);
      }

      // Trigger pump detection
      const pumpData: PriceData = {
        symbol,
        price: 120,
        volume24h: 10000,
        timestamp: Date.now(),
        source: 'Test'
      };

      detector.detectManipulation(symbol, pumpData, []);
    });
  });
});