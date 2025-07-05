import { ManipulationDetector } from '../ManipulationDetector';
import { EnhancedManipulationDetector } from '../EnhancedManipulationDetector';
import { PriceData, PriceSource } from '../types';

describe('Spoofing Detection', () => {
  describe('ManipulationDetector', () => {
    let detector: ManipulationDetector;

    beforeEach(() => {
      detector = new ManipulationDetector();
    });

    test('should detect spoofing from FakeExchange', () => {
      const symbol = 'BTC/USD';
      const currentData: PriceData = {
        symbol,
        price: 50000,
        volume24h: 1000000,
        timestamp: Date.now(),
        source: 'Binance'
      };

      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 50000, volume: 100, weight: 1, timestamp: Date.now() },
        { exchange: 'Coinbase', price: 50100, volume: 90, weight: 1, timestamp: Date.now() },
        { exchange: 'FakeExchange', price: 51500, volume: 80, weight: 1, timestamp: Date.now() }
      ];

      // Build up history first
      for (let i = 0; i < 5; i++) {
        detector.detectManipulation(symbol, currentData, sources);
      }

      const alerts = detector.detectManipulation(symbol, currentData, sources);
      const spoofingAlert = alerts.find(a => a.type === 'spoofing');

      expect(spoofingAlert).toBeDefined();
      expect(spoofingAlert?.exchange).toBe('FakeExchange');
      expect(spoofingAlert?.severity).toBe('medium');
    });

    test('should detect spoofing with minimal price spread from FakeExchange', () => {
      const symbol = 'ETH/USD';
      const currentData: PriceData = {
        symbol,
        price: 3000,
        volume24h: 500000,
        timestamp: Date.now(),
        source: 'Binance'
      };

      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 3000, volume: 100, weight: 1, timestamp: Date.now() },
        { exchange: 'FakeExchange', price: 3090, volume: 80, weight: 1, timestamp: Date.now() }
      ];

      // Build up history
      for (let i = 0; i < 5; i++) {
        detector.detectManipulation(symbol, currentData, sources);
      }

      const alerts = detector.detectManipulation(symbol, currentData, sources);
      const spoofingAlert = alerts.find(a => a.type === 'spoofing');

      expect(spoofingAlert).toBeDefined();
      expect(spoofingAlert?.exchange).toBe('FakeExchange');
    });
  });

  describe('EnhancedManipulationDetector', () => {
    let detector: EnhancedManipulationDetector;

    beforeEach(() => {
      detector = new EnhancedManipulationDetector();
    });

    test('should detect spoofing from order placement and cancellation patterns', () => {
      const symbol = 'BTC/USD';
      const currentData: PriceData = {
        symbol,
        price: 50000,
        volume24h: 1000000,
        timestamp: Date.now(),
        source: 'Binance'
      };

      const sources: PriceSource[] = [
        { exchange: 'Binance', price: 50000, volume: 100, weight: 1, timestamp: Date.now() },
        { exchange: 'FakeExchange', price: 50100, volume: 80, weight: 1, timestamp: Date.now() }
      ];

      // Create spoofing pattern: large orders quickly cancelled
      const now = Date.now();
      const orders = [
        {
          orderId: '1',
          symbol,
          price: 52000, // Far from market
          amount: 15000, // 1.5% of daily volume
          side: 'sell' as const,
          placedAt: now - 25000,
          cancelledAt: now - 20000, // Cancelled after 5 seconds
          exchange: 'FakeExchange'
        },
        {
          orderId: '2',
          symbol,
          price: 48000, // Far from market
          amount: 12000, // 1.2% of daily volume
          side: 'buy' as const,
          placedAt: now - 15000,
          cancelledAt: now - 10000, // Cancelled after 5 seconds
          exchange: 'FakeExchange'
        },
        {
          orderId: '3',
          symbol,
          price: 52500, // Far from market
          amount: 20000, // 2% of daily volume
          side: 'sell' as const,
          placedAt: now - 8000,
          cancelledAt: now - 3000, // Cancelled after 5 seconds
          exchange: 'FakeExchange'
        }
      ];

      // Build up history
      for (let i = 0; i < 5; i++) {
        detector.detectManipulation(symbol, currentData, sources);
      }

      const alerts = detector.detectManipulation(
        symbol, 
        currentData, 
        sources,
        { orders, avgMarketPrice: 50000, volume24h: 1000000 }
      );

      const spoofingAlert = alerts.find(a => a.type === 'spoofing');

      expect(spoofingAlert).toBeDefined();
      expect(spoofingAlert?.exchange).toBe('FakeExchange');
      expect(spoofingAlert?.severity).toBe('high'); // Should be high due to large orders
      expect(spoofingAlert?.details).toContain('3 large orders placed and cancelled');
    });

    test('should track order activity and detect patterns', () => {
      const detector = new EnhancedManipulationDetector();
      
      // Track order placement
      const order = {
        orderId: 'test-1',
        symbol: 'BTC/USD',
        price: 55000,
        amount: 10000,
        side: 'sell' as const,
        placedAt: Date.now(),
        exchange: 'FakeExchange'
      };

      detector.trackOrderPlacement(order);
      
      // Track cancellation
      detector.trackOrderCancellation(
        'test-1', 
        'BTC/USD', 
        'FakeExchange', 
        Date.now() + 5000
      );

      // Check spoofing stats
      const stats = detector.getSpoofingStats('FakeExchange');
      expect(stats).toBeDefined();
      expect(stats.exchanges).toContain('FakeExchange');
    });
  });
});