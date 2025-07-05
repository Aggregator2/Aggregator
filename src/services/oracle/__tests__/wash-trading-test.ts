import { ManipulationDetector } from '../ManipulationDetector';
import { PriceData, PriceSource } from '../types';

describe('Wash Trading Detection', () => {
  let detector: ManipulationDetector;

  beforeEach(() => {
    detector = new ManipulationDetector();
  });

  afterEach(() => {
    detector.clearHistory();
  });

  it('should detect wash trading with constant price and alternating volume', () => {
    const symbol = 'BTC/USDT';
    
    // Build history with wash trading pattern
    // - Constant price (100)
    // - Alternating volume (1000, 1100, 1000, 1100...)
    for (let i = 0; i < 20; i++) {
      const priceData: PriceData = {
        symbol,
        price: 100, // Constant price
        volume24h: 1000 + (i % 2) * 100, // Alternating: 1000, 1100, 1000, 1100
        timestamp: Date.now() - (20 - i) * 60000,
        source: 'Test'
      };
      detector.detectManipulation(symbol, priceData, []);
    }

    // Sources with minimal price variance
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
    expect(washAlert?.type).toBe('wash_trading');
    expect(washAlert?.severity).toBe('medium');
    expect(washAlert?.details).toContain('Suspicious volume patterns');
  });

  it('should detect wash trading with perfectly stable prices', () => {
    const symbol = 'ETH/USDT';
    
    // Build history with exact same price and volume pattern
    for (let i = 0; i < 15; i++) {
      const priceData: PriceData = {
        symbol,
        price: 200, // Exactly the same price
        volume24h: 5000 + (i % 3) * 500, // Pattern: 5000, 5500, 6000, 5000...
        timestamp: Date.now() - (15 - i) * 60000,
        source: 'Test'
      };
      detector.detectManipulation(symbol, priceData, []);
    }

    const sources: PriceSource[] = [
      { exchange: 'Exchange1', price: 200.00, volume: 5000, weight: 1, timestamp: Date.now() },
      { exchange: 'Exchange2', price: 200.00, volume: 5000, weight: 1, timestamp: Date.now() },
      { exchange: 'Exchange3', price: 200.01, volume: 5000, weight: 1, timestamp: Date.now() }
    ];

    const currentData: PriceData = {
      symbol,
      price: 200,
      volume24h: 5500,
      timestamp: Date.now(),
      source: 'Test'
    };

    const alerts = detector.detectManipulation(symbol, currentData, sources);
    const washAlert = alerts.find(a => a.type === 'wash_trading');
    
    expect(washAlert).toBeDefined();
    expect(washAlert?.type).toBe('wash_trading');
  });

  it('should NOT detect wash trading with normal trading patterns', () => {
    const symbol = 'BTC/USDT';
    
    // Build history with normal price movements and varying volumes
    for (let i = 0; i < 20; i++) {
      const priceData: PriceData = {
        symbol,
        price: 100 + Math.random() * 10 - 5, // Price varies between 95-105
        volume24h: 1000 + Math.random() * 2000, // Random volume between 1000-3000
        timestamp: Date.now() - (20 - i) * 60000,
        source: 'Test'
      };
      detector.detectManipulation(symbol, priceData, []);
    }

    const sources: PriceSource[] = [
      { exchange: 'Exchange1', price: 102.5, volume: 1500, weight: 1, timestamp: Date.now() },
      { exchange: 'Exchange2', price: 101.8, volume: 1800, weight: 1, timestamp: Date.now() },
      { exchange: 'Exchange3', price: 103.2, volume: 1200, weight: 1, timestamp: Date.now() }
    ];

    const currentData: PriceData = {
      symbol,
      price: 102.5,
      volume24h: 1600,
      timestamp: Date.now(),
      source: 'Test'
    };

    const alerts = detector.detectManipulation(symbol, currentData, sources);
    const washAlert = alerts.find(a => a.type === 'wash_trading');
    
    expect(washAlert).toBeUndefined();
  });

  it('should detect wash trading with two-value alternating pattern', () => {
    const symbol = 'XRP/USDT';
    
    // Build history with strict alternating pattern
    const volumes = [1000, 2000]; // Two values to alternate
    for (let i = 0; i < 20; i++) {
      const priceData: PriceData = {
        symbol,
        price: 0.5, // Constant price
        volume24h: volumes[i % 2], // Strict alternation
        timestamp: Date.now() - (20 - i) * 60000,
        source: 'Test'
      };
      detector.detectManipulation(symbol, priceData, []);
    }

    const sources: PriceSource[] = [
      { exchange: 'Exchange1', price: 0.5, volume: 1000, weight: 1, timestamp: Date.now() },
      { exchange: 'Exchange2', price: 0.5, volume: 1000, weight: 1, timestamp: Date.now() },
      { exchange: 'Exchange3', price: 0.5, volume: 1000, weight: 1, timestamp: Date.now() }
    ];

    const currentData: PriceData = {
      symbol,
      price: 0.5,
      volume24h: 1000,
      timestamp: Date.now(),
      source: 'Test'
    };

    const alerts = detector.detectManipulation(symbol, currentData, sources);
    const washAlert = alerts.find(a => a.type === 'wash_trading');
    
    expect(washAlert).toBeDefined();
    expect(washAlert?.type).toBe('wash_trading');
  });
});