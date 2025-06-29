import { SubscriptionManager } from '../SubscriptionManager';
import { AggregatedPrice } from '../types';

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager();
  });

  afterEach(() => {
    manager.clearAll();
  });

  describe('subscribe', () => {
    it('should create new subscription', () => {
      const callback = jest.fn();
      const id = manager.subscribe(['BTC/USDT', 'ETH/USDT'], callback, 1000);

      expect(id).toBeDefined();
      expect(manager.getSubscriptionCount()).toBe(1);
      expect(manager.getActiveSymbols()).toContain('BTC/USDT');
      expect(manager.getActiveSymbols()).toContain('ETH/USDT');
    });

    it('should emit subscription-created event', (done) => {
      manager.on('subscription-created', ({ id, symbols }) => {
        expect(id).toBeDefined();
        expect(symbols).toEqual(['BTC/USDT']);
        done();
      });

      manager.subscribe(['BTC/USDT'], jest.fn());
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscription', () => {
      const id = manager.subscribe(['BTC/USDT'], jest.fn());
      
      const result = manager.unsubscribe(id);
      
      expect(result).toBe(true);
      expect(manager.getSubscriptionCount()).toBe(0);
      expect(manager.getActiveSymbols()).toHaveLength(0);
    });

    it('should return false for non-existent subscription', () => {
      const result = manager.unsubscribe('non-existent-id');
      expect(result).toBe(false);
    });

    it('should clean up symbol mappings', () => {
      const id1 = manager.subscribe(['BTC/USDT'], jest.fn());
      const id2 = manager.subscribe(['BTC/USDT', 'ETH/USDT'], jest.fn());
      
      manager.unsubscribe(id1);
      
      expect(manager.getActiveSymbols()).toContain('BTC/USDT');
      expect(manager.getActiveSymbols()).toContain('ETH/USDT');
      
      manager.unsubscribe(id2);
      
      expect(manager.getActiveSymbols()).toHaveLength(0);
    });
  });

  describe('publishPrice', () => {
    it('should deliver price to all subscribers', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      
      manager.subscribe(['BTC/USDT'], callback1);
      manager.subscribe(['BTC/USDT', 'ETH/USDT'], callback2);
      
      const price: AggregatedPrice = {
        symbol: 'BTC/USDT',
        price: 50000,
        sources: [],
        timestamp: Date.now(),
        confidence: 0.95,
        outliers: []
      };
      
      manager.publishPrice(price);
      
      expect(callback1).toHaveBeenCalledWith(price);
      expect(callback2).toHaveBeenCalledWith(price);
    });

    it('should not deliver to unrelated subscriptions', () => {
      const btcCallback = jest.fn();
      const ethCallback = jest.fn();
      
      manager.subscribe(['BTC/USDT'], btcCallback);
      manager.subscribe(['ETH/USDT'], ethCallback);
      
      const price: AggregatedPrice = {
        symbol: 'BTC/USDT',
        price: 50000,
        sources: [],
        timestamp: Date.now(),
        confidence: 0.95,
        outliers: []
      };
      
      manager.publishPrice(price);
      
      expect(btcCallback).toHaveBeenCalled();
      expect(ethCallback).not.toHaveBeenCalled();
    });

    it('should emit price-published event', (done) => {
      const price: AggregatedPrice = {
        symbol: 'BTC/USDT',
        price: 50000,
        sources: [],
        timestamp: Date.now(),
        confidence: 0.95,
        outliers: []
      };
      
      manager.on('price-published', (publishedPrice) => {
        expect(publishedPrice).toEqual(price);
        done();
      });
      
      manager.publishPrice(price);
    });

    it('should handle callback errors gracefully', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Callback error');
      });
      
      manager.subscribe(['BTC/USDT'], errorCallback);
      
      const price: AggregatedPrice = {
        symbol: 'BTC/USDT',
        price: 50000,
        sources: [],
        timestamp: Date.now(),
        confidence: 0.95,
        outliers: []
      };
      
      expect(() => manager.publishPrice(price)).not.toThrow();
    });
  });

  describe('updateSubscription', () => {
    it('should update subscription symbols', () => {
      const callback = jest.fn();
      const id = manager.subscribe(['BTC/USDT'], callback);
      
      const result = manager.updateSubscription(id, { symbols: ['ETH/USDT'] });
      
      expect(result).toBe(true);
      expect(manager.getActiveSymbols()).not.toContain('BTC/USDT');
      expect(manager.getActiveSymbols()).toContain('ETH/USDT');
    });

    it('should update subscription interval', () => {
      const callback = jest.fn();
      const id = manager.subscribe(['BTC/USDT'], callback, 1000);
      
      const result = manager.updateSubscription(id, { interval: 5000 });
      
      expect(result).toBe(true);
    });

    it('should return false for non-existent subscription', () => {
      const result = manager.updateSubscription('non-existent', { interval: 5000 });
      expect(result).toBe(false);
    });
  });

  describe('getSubscriptionsBySymbol', () => {
    it('should return subscriptions for a symbol', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      
      manager.subscribe(['BTC/USDT'], callback1);
      manager.subscribe(['BTC/USDT', 'ETH/USDT'], callback2);
      
      const subs = manager.getSubscriptionsBySymbol('BTC/USDT');
      
      expect(subs).toHaveLength(2);
      expect(subs[0].symbols).toContain('BTC/USDT');
      expect(subs[1].symbols).toContain('BTC/USDT');
    });

    it('should return empty array for unknown symbol', () => {
      const subs = manager.getSubscriptionsBySymbol('XRP/USDT');
      expect(subs).toHaveLength(0);
    });
  });
});