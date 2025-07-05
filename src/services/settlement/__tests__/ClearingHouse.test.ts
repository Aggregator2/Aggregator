import { ClearingHouse } from '../ClearingHouse';
import { Settlement, SettlementStatus, SettlementCycle } from '../types';

describe('ClearingHouse', () => {
  let clearingHouse: ClearingHouse;
  
  beforeEach(() => {
    clearingHouse = new ClearingHouse({
      collateralRequirement: 0.1,
      marginCallThreshold: 0.15,
      liquidationThreshold: 0.05,
      settlementDelay: 100, // 100ms for testing
      maxBatchSize: 1000
    });
  });
  
  afterEach(() => {
    clearingHouse.removeAllListeners();
  });
  
  const createMockSettlement = (): Settlement => ({
    id: 'SET_1',
    trades: [{
      id: 'TRADE_1',
      buyOrderId: 'BUY_1',
      sellOrderId: 'SELL_1',
      pair: 'ETH/USDT',
      price: 2000,
      quantity: 1,
      filledQuantity: 1,
      side: 'BUY' as any,
      buyerId: 'user1',
      sellerId: 'user2',
      buyerFee: 2,
      sellerFee: 2,
      timestamp: Date.now(),
      settlementStatus: 'pending'
    }],
    status: SettlementStatus.PENDING,
    cycle: SettlementCycle.CONTINUOUS,
    netAmounts: [
      {
        userId: 'user1',
        token: 'ETH',
        netAmount: BigInt(1e8), // user1 receives 1 ETH
        originalAmount: BigInt(1e8),
        nettingReduction: BigInt(0)
      },
      {
        userId: 'user1',
        token: 'USDT',
        netAmount: BigInt(-2000e8), // user1 pays 2000 USDT
        originalAmount: BigInt(-2000e8),
        nettingReduction: BigInt(0)
      },
      {
        userId: 'user2',
        token: 'ETH',
        netAmount: BigInt(-1e8), // user2 pays 1 ETH
        originalAmount: BigInt(-1e8),
        nettingReduction: BigInt(0)
      },
      {
        userId: 'user2',
        token: 'USDT',
        netAmount: BigInt(2000e8), // user2 receives 2000 USDT
        originalAmount: BigInt(2000e8),
        nettingReduction: BigInt(0)
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  
  describe('Member Registration', () => {
    it('should register new clearing members', async () => {
      const collateral = new Map([['USDT', BigInt(10000e8)]]);
      
      const member = await clearingHouse.registerMember('user1', collateral);
      
      expect(member.userId).toBe('user1');
      expect(member.status).toBe('ACTIVE');
      expect(member.collateral.get('USDT')).toBe(BigInt(10000e8));
    });
    
    it('should auto-register members during settlement', async () => {
      const settlement = createMockSettlement();
      
      await clearingHouse.processSettlement(settlement);
      
      const member = clearingHouse.getMember('user1');
      expect(member).toBeDefined();
    });
  });
  
  describe('Collateral Management', () => {
    it('should deposit collateral', async () => {
      await clearingHouse.registerMember('user1');
      
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(5000e8));
      
      const member = clearingHouse.getMember('user1');
      expect(member?.collateral.get('USDT')).toBe(BigInt(5000e8));
    });
    
    it('should withdraw collateral', async () => {
      await clearingHouse.registerMember('user1');
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(5000e8));
      
      await clearingHouse.withdrawCollateral('user1', 'USDT', BigInt(2000e8));
      
      const member = clearingHouse.getMember('user1');
      expect(member?.collateral.get('USDT')).toBe(BigInt(3000e8));
    });
    
    it('should reject withdrawal if it violates requirements', async () => {
      await clearingHouse.registerMember('user1');
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(1000e8));
      
      // Create exposure
      const member = clearingHouse.getMember('user1')!;
      member.positions.set('ETH', BigInt(10e8)); // 10 ETH exposure
      
      await expect(
        clearingHouse.withdrawCollateral('user1', 'USDT', BigInt(900e8))
      ).rejects.toThrow('violate collateral requirements');
    });
  });
  
  describe('Settlement Processing', () => {
    it('should process settlements with sufficient collateral', async () => {
      const settlement = createMockSettlement();
      
      // Register and fund member
      await clearingHouse.registerMember('user1');
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(10000e8));
      
      const clearedPromise = new Promise((resolve) => {
        clearingHouse.once('settlementCleared', resolve);
      });
      
      await clearingHouse.processSettlement(settlement);
      
      // Wait for settlement delay
      await clearedPromise;
      
      expect(settlement.status).toBe('CLEARING' as any);
    });
    
    it('should reject settlement for suspended members', async () => {
      const settlement = createMockSettlement();
      
      const member = await clearingHouse.registerMember('user1');
      member.status = 'SUSPENDED';
      
      await expect(
        clearingHouse.processSettlement(settlement)
      ).rejects.toThrow('suspended');
    });
    
    it('should reject settlement with no net amounts', async () => {
      const invalidSettlement: Settlement = {
        id: 'SET_INVALID',
        trades: [{
          id: 'TRADE_1',
          buyOrderId: 'BUY_1',
          sellOrderId: 'SELL_1',
          pair: 'ETH/USDT',
          price: 2000,
          quantity: 1,
          filledQuantity: 1,
          side: 'BUY' as any,
          buyerId: 'user1',
          sellerId: 'user2',
          buyerFee: 2,
          sellerFee: 2,
          timestamp: Date.now(),
          settlementStatus: 'pending'
        }],
        status: SettlementStatus.PENDING,
        cycle: SettlementCycle.CONTINUOUS,
        netAmounts: [], // Empty net amounts
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      await expect(
        clearingHouse.processSettlement(invalidSettlement)
      ).rejects.toThrow('Settlement has no net amounts calculated');
    });
    
    it('should reject settlement with unbalanced net amounts', async () => {
      const unbalancedSettlement: Settlement = {
        id: 'SET_UNBALANCED',
        trades: [{
          id: 'TRADE_1',
          buyOrderId: 'BUY_1',
          sellOrderId: 'SELL_1',
          pair: 'ETH/USDT',
          price: 2000,
          quantity: 1,
          filledQuantity: 1,
          side: 'BUY' as any,
          buyerId: 'user1',
          sellerId: 'user2',
          buyerFee: 2,
          sellerFee: 2,
          timestamp: Date.now(),
          settlementStatus: 'pending'
        }],
        status: SettlementStatus.PENDING,
        cycle: SettlementCycle.CONTINUOUS,
        netAmounts: [
          {
            userId: 'user1',
            token: 'ETH',
            netAmount: BigInt(1e8), // user1 receives 1 ETH
            originalAmount: BigInt(1e8),
            nettingReduction: BigInt(0)
          },
          {
            userId: 'user1',
            token: 'USDT',
            netAmount: BigInt(-2000e8), // user1 pays 2000 USDT
            originalAmount: BigInt(-2000e8),
            nettingReduction: BigInt(0)
          },
          // Missing user2's net amounts - this creates imbalance
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      await expect(
        clearingHouse.processSettlement(unbalancedSettlement)
      ).rejects.toThrow('Settlement does not balance for token');
    });
  });
  
  describe('Margin Calls', () => {
    it('should issue margin calls when below threshold', async () => {
      // Register both members well in advance
      await clearingHouse.registerMember('user1');
      await clearingHouse.registerMember('user2');
      
      // Deposit collateral
      // User1: 100 USDT (will trigger margin call)
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(100e8));
      // User2: 100 ETH (sufficient)  
      await clearingHouse.depositCollateral('user2', 'ETH', BigInt(100e8));
      
      // Process a zero-value settlement first to clear "newly registered" status
      const clearNewlyRegistered = createMockSettlement();
      clearNewlyRegistered.id = 'CLEAR_NEW';
      clearNewlyRegistered.netAmounts = [];
      for (const userId of ['user1', 'user2']) {
        for (const token of ['ETH', 'USDT']) {
          clearNewlyRegistered.netAmounts.push({
            userId,
            token,
            netAmount: BigInt(0),
            originalAmount: BigInt(0),
            nettingReduction: BigInt(0)
          });
        }
      }
      
      try {
        await clearingHouse.processSettlement(clearNewlyRegistered);
        // Wait for settlement to complete
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.log('Clear newly registered error:', error.message);
      }
      
      // Set up margin call listener
      let marginCallEvent: any = null;
      clearingHouse.once('marginCall', (event) => {
        marginCallEvent = event;
      });
      
      // Create a settlement with large exposure for user1
      const settlement = createMockSettlement();
      
      // Modify net amounts to create exposure:
      // User1 receives 10 ETH (worth 20,000 USDT at 2000 USDT/ETH)
      // With 10% collateral requirement, needs 2,000 USDT collateral
      // User1 only has 100 USDT, so collateral ratio = 100/2000 = 0.05 (5%)
      // This is exactly at the liquidation threshold (5%)
      // Let's use 9 ETH to get collateral ratio = 100/1800 ≈ 0.056 (5.6%)
      // This is below margin call threshold (15%) but above liquidation (5%)
      settlement.netAmounts = [
        {
          userId: 'user1',
          token: 'ETH',
          netAmount: BigInt(9e8), // user1 receives 9 ETH
          originalAmount: BigInt(9e8),
          nettingReduction: BigInt(0)
        },
        {
          userId: 'user2',
          token: 'ETH',
          netAmount: BigInt(-9e8), // user2 pays 9 ETH
          originalAmount: BigInt(-9e8),
          nettingReduction: BigInt(0)
        }
      ];
      
      await clearingHouse.processSettlement(settlement);
      
      // Check results
      const member = clearingHouse.getMember('user1');
      
      expect(marginCallEvent).toBeDefined();
      expect(marginCallEvent?.member?.userId).toBe('user1');
      expect(marginCallEvent?.deficit).toBe(BigInt(1700e8)); // 1800 - 100 = 1700 USDT deficit
      expect(member?.status).toBe('MARGIN_CALL');
    }, 15000);
    
    it('should resolve margin call after deposit', async () => {
      // Setup member with margin call
      await clearingHouse.registerMember('user1');
      const member = clearingHouse.getMember('user1')!;
      member.status = 'MARGIN_CALL';
      member.positions.set('ETH', BigInt(100e8));
      
      // Deposit enough to resolve
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(20000e8));
      
      expect(member.status).toBe('ACTIVE');
    });
  });
  
  describe('Risk Metrics', () => {
    it('should calculate risk metrics correctly', async () => {
      await clearingHouse.registerMember('user1');
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(5000e8));
      
      const member = clearingHouse.getMember('user1')!;
      member.positions.set('ETH', BigInt(10e8));
      member.margin = BigInt(10000e8);
      
      const metrics = clearingHouse.calculateRiskMetrics(member);
      
      expect(metrics.userId).toBe('user1');
      expect(metrics.exposure).toBe(BigInt(10e8 * 2000)); // ETH converted to USDT equivalent
      expect(metrics.collateralRatio).toBeGreaterThan(0);
      expect(metrics.marginUtilization).toBeGreaterThan(0);
      expect(metrics.riskScore).toBeGreaterThanOrEqual(0);
      expect(metrics.riskScore).toBeLessThanOrEqual(100);
    });
  });
  
  describe('Default Management', () => {
    it('should handle defaults using default fund', async () => {
      // Register members and build default fund
      await clearingHouse.registerMember('user1', new Map([['USDT', BigInt(10000e8)]]));
      await clearingHouse.registerMember('user2', new Map([['USDT', BigInt(10000e8)]]));
      
      const defaultAmount = BigInt(500e8);
      
      const coveredPromise = new Promise((resolve) => {
        clearingHouse.once('defaultCovered', resolve);
      });
      
      await clearingHouse.handleDefault('user3', defaultAmount);
      
      const event = await coveredPromise;
      expect(event).toBeDefined();
    });
    
    it('should mutualize large defaults among members', async () => {
      // Register active members
      await clearingHouse.registerMember('user1');
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(10000e8));
      await clearingHouse.registerMember('user2');
      await clearingHouse.depositCollateral('user2', 'USDT', BigInt(10000e8));
      
      const largeDefault = BigInt(50000e8);
      
      const mutualizedPromise = new Promise((resolve) => {
        clearingHouse.once('defaultMutualized', resolve);
      });
      
      await clearingHouse.handleDefault('user3', largeDefault);
      
      const event = await mutualizedPromise;
      expect(event).toBeDefined();
    });
  });
  
  describe('Statistics', () => {
    it('should provide clearing house statistics', async () => {
      await clearingHouse.registerMember('user1');
      await clearingHouse.registerMember('user2');
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(5000e8));
      
      const stats = clearingHouse.getStatistics();
      
      expect(stats.totalMembers).toBe(2);
      expect(stats.activeMembers).toBe(2);
      expect(stats.collateralPool.USDT).toBe('500000000000');
      expect(stats.config).toBeDefined();
    });
  });
  
  describe('Configuration', () => {
    it('should update configuration', () => {
      const configUpdatePromise = new Promise((resolve) => {
        clearingHouse.once('configUpdated', resolve);
      });
      
      clearingHouse.updateConfig({
        collateralRequirement: 0.2,
        marginCallThreshold: 0.25
      });
      
      const stats = clearingHouse.getStatistics();
      expect(stats.config.collateralRequirement).toBe(0.2);
      expect(stats.config.marginCallThreshold).toBe(0.25);
    });
  });
});