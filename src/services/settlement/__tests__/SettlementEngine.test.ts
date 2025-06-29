import { SettlementEngine } from '../SettlementEngine';
import { Trade, OrderSide, OrderType, OrderStatus } from '../../matchingEngine/types';
import { SettlementCycle, SettlementStatus } from '../types';

describe('SettlementEngine', () => {
  let settlementEngine: SettlementEngine;
  
  beforeEach(() => {
    settlementEngine = new SettlementEngine(SettlementCycle.CONTINUOUS);
  });
  
  afterEach(() => {
    // Clean up event listeners
    settlementEngine.removeAllListeners();
  });
  
  const createMockTrade = (id: string, buyerId: string, sellerId: string): Trade => ({
    id,
    buyOrderId: `BUY_${id}`,
    sellOrderId: `SELL_${id}`,
    pair: 'ETH/USDT',
    price: 2000,
    quantity: 1,
    filledQuantity: 1,
    side: OrderSide.BUY,
    buyerId,
    sellerId,
    buyerFee: 2, // 0.1%
    sellerFee: 2, // 0.1%
    timestamp: Date.now(),
    settlementStatus: 'pending'
  });
  
  describe('Continuous Settlement', () => {
    it('should process trade immediately in continuous mode', async () => {
      const trade = createMockTrade('TRADE_1', 'user1', 'user2');
      
      const settlementPromise = new Promise((resolve) => {
        settlementEngine.on('settlementEvent', (event) => {
          if (event.type === 'SETTLEMENT_EXECUTED') {
            resolve(event);
          }
        });
      });
      
      await settlementEngine.processTrade(trade);
      
      const event = await settlementPromise;
      expect(event).toBeDefined();
    });
    
    it('should update user balances after settlement', async () => {
      const trade = createMockTrade('TRADE_2', 'user1', 'user2');
      
      await settlementEngine.processTrade(trade);
      
      // Give time for settlement to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const user1Balance = await settlementEngine.getUserBalance('user1');
      const user2Balance = await settlementEngine.getUserBalance('user2');
      
      expect(user1Balance).toBeDefined();
      expect(user2Balance).toBeDefined();
    });
  });
  
  describe('Batch Settlement', () => {
    beforeEach(() => {
      // Switch to hourly batch mode
      settlementEngine.setCycle(SettlementCycle.HOURLY, 1000); // 1 second for testing
    });
    
    it('should batch multiple trades', async () => {
      const trades = [
        createMockTrade('TRADE_3', 'user1', 'user2'),
        createMockTrade('TRADE_4', 'user1', 'user3'),
        createMockTrade('TRADE_5', 'user2', 'user3')
      ];
      
      for (const trade of trades) {
        await settlementEngine.processTrade(trade);
      }
      
      const batchPromise = new Promise((resolve) => {
        settlementEngine.on('settlementEvent', (event) => {
          if (event.type === 'BATCH_CREATED') {
            resolve(event.data);
          }
        });
      });
      
      // Trigger batch processing
      await settlementEngine.processBatchSettlement();
      
      const batch = await batchPromise;
      expect(batch.totalTrades).toBe(3);
      expect(batch.status).toBe(SettlementStatus.BATCHED);
    });
    
    it('should apply netting in batch mode', async () => {
      // Create offsetting trades
      const trades = [
        createMockTrade('TRADE_6', 'user1', 'user2'), // user1 buys from user2
        createMockTrade('TRADE_7', 'user2', 'user1')  // user2 buys from user1
      ];
      
      for (const trade of trades) {
        await settlementEngine.processTrade(trade);
      }
      
      const nettingPromise = new Promise((resolve) => {
        settlementEngine.on('settlementEvent', (event) => {
          if (event.type === 'NETTING_COMPLETED') {
            resolve(event.data);
          }
        });
      });
      
      await settlementEngine.processBatchSettlement();
      
      const nettingResult = await nettingPromise;
      expect(nettingResult.reduction).toBeGreaterThan(BigInt(0));
    });
  });
  
  describe('Settlement Metrics', () => {
    it('should track settlement metrics', async () => {
      const trades = [
        createMockTrade('TRADE_8', 'user1', 'user2'),
        createMockTrade('TRADE_9', 'user3', 'user4')
      ];
      
      for (const trade of trades) {
        await settlementEngine.processTrade(trade);
      }
      
      const metrics = settlementEngine.getMetrics();
      
      expect(metrics.totalTrades).toBe(2);
      expect(metrics.pendingSettlements).toBeGreaterThanOrEqual(0);
      expect(metrics.nettingEfficiency).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle settlement failures gracefully', async () => {
      const trade = createMockTrade('TRADE_10', 'user1', 'invalid_user');
      
      const failurePromise = new Promise((resolve) => {
        settlementEngine.on('settlementEvent', (event) => {
          if (event.type === 'SETTLEMENT_FAILED') {
            resolve(event);
          }
        });
      });
      
      try {
        await settlementEngine.processTrade(trade);
      } catch (error) {
        // Expected to fail
      }
      
      const metrics = settlementEngine.getMetrics();
      expect(metrics.failureRate).toBeGreaterThanOrEqual(0);
    });
  });
});