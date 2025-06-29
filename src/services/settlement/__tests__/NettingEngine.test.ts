import { NettingEngine } from '../NettingEngine';
import { Trade, OrderSide } from '../../matchingEngine/types';

describe('NettingEngine', () => {
  let nettingEngine: NettingEngine;
  
  beforeEach(() => {
    nettingEngine = new NettingEngine();
  });
  
  const createMockTrade = (
    id: string,
    buyerId: string,
    sellerId: string,
    pair: string,
    price: number,
    quantity: number
  ): Trade => ({
    id,
    buyOrderId: `BUY_${id}`,
    sellOrderId: `SELL_${id}`,
    pair,
    price,
    quantity,
    filledQuantity: quantity,
    side: OrderSide.BUY,
    buyerId,
    sellerId,
    buyerFee: price * quantity * 0.001,
    sellerFee: price * quantity * 0.001,
    timestamp: Date.now(),
    settlementStatus: 'pending'
  });
  
  describe('Bilateral Netting', () => {
    it('should net offsetting positions between two parties', async () => {
      const trades = [
        createMockTrade('T1', 'user1', 'user2', 'ETH/USDT', 2000, 1),
        createMockTrade('T2', 'user2', 'user1', 'ETH/USDT', 2000, 0.5)
      ];
      
      const netPositions = await nettingEngine.calculateNetPositions(trades);
      
      // user1 should have net position of 0.5 ETH (bought 1, sold 0.5)
      const user1ETH = netPositions.get('user1')?.get('ETH') || BigInt(0);
      expect(Number(user1ETH) / 1e8).toBeCloseTo(0.5, 2);
      
      // user2 should have net position of -0.5 ETH (sold 1, bought 0.5)
      const user2ETH = netPositions.get('user2')?.get('ETH') || BigInt(0);
      expect(Number(user2ETH) / 1e8).toBeCloseTo(-0.5, 2);
    });
    
    it('should handle multiple token pairs', async () => {
      const trades = [
        createMockTrade('T3', 'user1', 'user2', 'ETH/USDT', 2000, 1),
        createMockTrade('T4', 'user1', 'user2', 'BTC/USDT', 50000, 0.1),
        createMockTrade('T5', 'user2', 'user1', 'ETH/USDT', 2000, 0.5)
      ];
      
      const netPositions = await nettingEngine.calculateNetPositions(trades);
      
      // Check ETH positions
      const user1ETH = netPositions.get('user1')?.get('ETH') || BigInt(0);
      expect(Number(user1ETH) / 1e8).toBeCloseTo(0.5, 2);
      
      // Check BTC positions
      const user1BTC = netPositions.get('user1')?.get('BTC') || BigInt(0);
      expect(Number(user1BTC) / 1e8).toBeCloseTo(0.1, 2);
      
      // Check USDT positions (should be negative for buyer)
      const user1USDT = netPositions.get('user1')?.get('USDT') || BigInt(0);
      expect(Number(user1USDT) / 1e8).toBeLessThan(0);
    });
  });
  
  describe('Multilateral Netting', () => {
    it('should net positions across multiple parties', async () => {
      const trades = [
        createMockTrade('T6', 'user1', 'user2', 'ETH/USDT', 2000, 1),
        createMockTrade('T7', 'user2', 'user3', 'ETH/USDT', 2000, 1),
        createMockTrade('T8', 'user3', 'user1', 'ETH/USDT', 2000, 1)
      ];
      
      const netPositions = await nettingEngine.calculateNetPositions(trades);
      
      // In a perfect cycle, all ETH positions should net to zero
      const user1ETH = netPositions.get('user1')?.get('ETH') || BigInt(0);
      const user2ETH = netPositions.get('user2')?.get('ETH') || BigInt(0);
      const user3ETH = netPositions.get('user3')?.get('ETH') || BigInt(0);
      
      // Due to cyclic netting, positions should be reduced
      expect(Number(user1ETH + user2ETH + user3ETH)).toBe(0);
    });
  });
  
  describe('Netting Efficiency', () => {
    it('should calculate netting efficiency correctly', async () => {
      const trades = [
        createMockTrade('T9', 'user1', 'user2', 'ETH/USDT', 2000, 10),
        createMockTrade('T10', 'user2', 'user1', 'ETH/USDT', 2000, 8)
      ];
      
      const netPositions = await nettingEngine.calculateNetPositions(trades);
      
      // Create mock batch for efficiency calculation
      const mockBatch = {
        id: 'BATCH_1',
        settlements: [{
          id: 'SET_1',
          trades,
          status: 'SETTLED' as any,
          cycle: 'HOURLY' as any,
          netAmounts: [
            {
              userId: 'user1',
              token: 'ETH',
              netAmount: netPositions.get('user1')?.get('ETH') || BigInt(0),
              originalAmount: BigInt(10 * 1e8),
              nettingReduction: BigInt(8 * 1e8)
            }
          ],
          createdAt: Date.now(),
          updatedAt: Date.now()
        }],
        totalTrades: trades.length,
        netPositions,
        status: 'SETTLED' as any,
        createdAt: Date.now()
      };
      
      const efficiency = nettingEngine.calculateNettingEfficiency(mockBatch);
      expect(efficiency).toBeGreaterThan(0);
      expect(efficiency).toBeLessThanOrEqual(100);
    });
  });
  
  describe('Fee Handling', () => {
    it('should correctly account for trading fees', async () => {
      const trades = [
        createMockTrade('T11', 'user1', 'user2', 'ETH/USDT', 2000, 1)
      ];
      
      const netPositions = await nettingEngine.calculateNetPositions(trades);
      
      // user1 (buyer) should pay extra USDT for fees
      const user1USDT = netPositions.get('user1')?.get('USDT') || BigInt(0);
      const expectedUSDT = -(2000 + 2) * 1e8; // price + fee
      expect(Number(user1USDT)).toBeCloseTo(expectedUSDT, 0);
      
      // user2 (seller) should receive less USDT due to fees
      const user2USDT = netPositions.get('user2')?.get('USDT') || BigInt(0);
      const expectedSellerUSDT = (2000 - 2) * 1e8; // price - fee
      expect(Number(user2USDT)).toBeCloseTo(expectedSellerUSDT, 0);
    });
  });
  
  describe('Configuration', () => {
    it('should respect netting threshold', () => {
      nettingEngine.setNettingThreshold(0.2); // 20% minimum reduction
      
      const stats = nettingEngine.getNettingStats();
      expect(stats.threshold).toBe(0.2);
      expect(stats.algorithmsEnabled).toContain('bilateral');
      expect(stats.algorithmsEnabled).toContain('cyclic');
      expect(stats.algorithmsEnabled).toContain('compression');
    });
  });
});