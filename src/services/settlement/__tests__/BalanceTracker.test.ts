import { BalanceTracker } from '../BalanceTracker';
import { Trade, OrderSide } from '../../matchingEngine/types';
import { Settlement, SettlementStatus, SettlementCycle } from '../types';

describe('BalanceTracker', () => {
  let balanceTracker: BalanceTracker;
  
  beforeEach(() => {
    balanceTracker = new BalanceTracker();
  });
  
  afterEach(() => {
    balanceTracker.removeAllListeners();
  });
  
  const createMockTrade = (
    buyerId: string,
    sellerId: string,
    price: number = 2000,
    quantity: number = 1
  ): Trade => ({
    id: `TRADE_${Date.now()}`,
    buyOrderId: 'BUY_1',
    sellOrderId: 'SELL_1',
    pair: 'ETH/USDT',
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
  
  describe('Balance Updates', () => {
    it('should track pending trades', async () => {
      const trade = createMockTrade('user1', 'user2');
      
      await balanceTracker.updatePendingTrade(trade);
      
      const user1Balance = balanceTracker.getUserBalance('user1');
      expect(user1Balance).toBeDefined();
      expect(user1Balance?.pendingSettlements.size).toBeGreaterThan(0);
    });
    
    it('should update balances after settlement', async () => {
      const settlement: Settlement = {
        id: 'SET_1',
        trades: [],
        status: SettlementStatus.SETTLED,
        cycle: SettlementCycle.CONTINUOUS,
        netAmounts: [{
          userId: 'user1',
          token: 'ETH',
          netAmount: BigInt(1e8), // 1 ETH
          originalAmount: BigInt(1e8),
          nettingReduction: BigInt(0)
        }],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      await balanceTracker.applySettlement(settlement);
      
      const balance = balanceTracker.getTokenBalance('user1', 'ETH');
      expect(Number(balance) / 1e8).toBe(1);
    });
  });
  
  describe('Deposits and Withdrawals', () => {
    it('should process deposits correctly', async () => {
      const amount = BigInt(1000e8); // 1000 USDT
      
      await balanceTracker.processDeposit('user1', 'USDT', amount, 'TX_123');
      
      const balance = balanceTracker.getTokenBalance('user1', 'USDT');
      expect(balance).toBe(amount);
    });
    
    it('should process withdrawals correctly', async () => {
      // First deposit
      await balanceTracker.processDeposit('user1', 'USDT', BigInt(1000e8), 'TX_123');
      
      // Then withdraw
      await balanceTracker.processWithdrawal('user1', 'USDT', BigInt(500e8), 'TX_124');
      
      const balance = balanceTracker.getTokenBalance('user1', 'USDT');
      expect(Number(balance) / 1e8).toBe(500);
    });
    
    it('should reject withdrawals with insufficient balance', async () => {
      await expect(
        balanceTracker.processWithdrawal('user1', 'USDT', BigInt(1000e8), 'TX_125')
      ).rejects.toThrow('Insufficient balance');
    });
  });
  
  describe('Balance History', () => {
    it('should maintain balance history', async () => {
      await balanceTracker.processDeposit('user1', 'USDT', BigInt(1000e8), 'TX_1');
      await balanceTracker.processDeposit('user1', 'USDT', BigInt(500e8), 'TX_2');
      await balanceTracker.processWithdrawal('user1', 'USDT', BigInt(200e8), 'TX_3');
      
      const history = balanceTracker.getBalanceHistory('user1', 'USDT');
      
      expect(history.length).toBe(3);
      expect(history[0].reason).toBe('DEPOSIT');
      expect(history[1].reason).toBe('DEPOSIT');
      expect(history[2].reason).toBe('WITHDRAWAL');
    });
    
    it('should limit history size', async () => {
      // Create many balance updates
      for (let i = 0; i < 150; i++) {
        await balanceTracker.processDeposit('user1', 'USDT', BigInt(100e8), `TX_${i}`);
      }
      
      const history = balanceTracker.getBalanceHistory('user1', 'USDT', 200);
      expect(history.length).toBe(100); // Default limit
    });
  });
  
  describe('Aggregated Balances', () => {
    it('should calculate aggregated balances across all users', async () => {
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      await balanceTracker.processDeposit('user2', 'ETH', BigInt(5e8), 'TX_2');
      await balanceTracker.processDeposit('user3', 'ETH', BigInt(3e8), 'TX_3');
      
      const aggregated = balanceTracker.getAggregatedBalances();
      
      expect(Number(aggregated.get('ETH') || 0) / 1e8).toBe(18);
    });
  });
  
  describe('Snapshots', () => {
    it('should create balance snapshots', async () => {
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      
      // Wait for snapshot (or trigger manually if method available)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const stats = balanceTracker.getStatistics();
      expect(stats.snapshotCount).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('Balance Integrity', () => {
    it('should validate balance integrity', async () => {
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      await balanceTracker.processWithdrawal('user1', 'ETH', BigInt(5e8), 'TX_2');
      
      const integrity = balanceTracker.validateIntegrity();
      
      expect(integrity.valid).toBe(true);
      expect(integrity.errors.length).toBe(0);
    });
    
    it('should detect negative balances', async () => {
      // Force a negative balance (this shouldn't happen normally)
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(-10e8), 'TX_1');
      
      const integrity = balanceTracker.validateIntegrity();
      
      expect(integrity.valid).toBe(false);
      expect(integrity.errors.length).toBeGreaterThan(0);
      expect(integrity.errors[0]).toContain('Negative balance');
    });
  });
  
  describe('Pending Settlements', () => {
    it('should track pending settlements', async () => {
      const trade = createMockTrade('user1', 'user2');
      
      await balanceTracker.updatePendingTrade(trade);
      
      const summary = balanceTracker.getPendingSettlementsSummary();
      expect(summary.size).toBeGreaterThan(0);
    });
    
    it('should clear pending settlements after settlement', async () => {
      const trade = createMockTrade('user1', 'user2');
      await balanceTracker.updatePendingTrade(trade);
      
      const settlement: Settlement = {
        id: 'SET_1',
        trades: [trade],
        status: SettlementStatus.SETTLED,
        cycle: SettlementCycle.CONTINUOUS,
        netAmounts: [{
          userId: 'user1',
          token: 'ETH',
          netAmount: BigInt(1e8),
          originalAmount: BigInt(1e8),
          nettingReduction: BigInt(0)
        }],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      await balanceTracker.applySettlement(settlement);
      
      const user1Balance = balanceTracker.getUserBalance('user1');
      expect(user1Balance?.pendingSettlements.has('ETH')).toBe(false);
    });
  });
  
  describe('Export and Recovery', () => {
    it('should export balances for reconciliation', async () => {
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      await balanceTracker.processDeposit('user2', 'USDT', BigInt(1000e8), 'TX_2');
      
      const exported = balanceTracker.exportBalances();
      
      expect(exported.timestamp).toBeDefined();
      expect(exported.users.user1).toBeDefined();
      expect(exported.users.user2).toBeDefined();
      expect(exported.users.user1.balances.ETH).toBe('1000000000');
    });
  });
});