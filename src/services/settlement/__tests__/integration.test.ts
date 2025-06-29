import { SettlementEngine } from '../SettlementEngine';
import { MockOnChainProvider } from '../ReconciliationEngine';
import { Trade, OrderSide } from '../../matchingEngine/types';
import { SettlementCycle } from '../types';

describe('Settlement System Integration', () => {
  let settlementEngine: SettlementEngine;
  let onChainProvider: MockOnChainProvider;
  
  beforeEach(() => {
    settlementEngine = new SettlementEngine(SettlementCycle.HOURLY, 1000);
    onChainProvider = new MockOnChainProvider();
    
    // Connect on-chain provider to reconciliation engine
    const reconciliationEngine = (settlementEngine as any).reconciliationEngine;
    reconciliationEngine.setOnChainProvider(onChainProvider);
  });
  
  afterEach(() => {
    settlementEngine.removeAllListeners();
  });
  
  const createTrade = (
    id: string,
    buyerId: string,
    sellerId: string,
    pair: string = 'ETH/USDT',
    price: number = 2000,
    quantity: number = 1
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
  
  describe('End-to-End Settlement Flow', () => {
    it('should complete full settlement cycle with netting', async () => {
      // 1. Register clearing members
      const clearingHouse = (settlementEngine as any).clearingHouse;
      await clearingHouse.registerMember('user1', new Map([['USDT', BigInt(100000e8)]]));
      await clearingHouse.registerMember('user2', new Map([['USDT', BigInt(100000e8)]]));
      await clearingHouse.registerMember('user3', new Map([['USDT', BigInt(100000e8)]]));
      
      // 2. Create circular trades that should net out
      const trades = [
        createTrade('T1', 'user1', 'user2', 'ETH/USDT', 2000, 5),
        createTrade('T2', 'user2', 'user3', 'ETH/USDT', 2000, 5),
        createTrade('T3', 'user3', 'user1', 'ETH/USDT', 2000, 5),
        // Add some non-nettable trades
        createTrade('T4', 'user1', 'user2', 'BTC/USDT', 50000, 0.1),
        createTrade('T5', 'user2', 'user3', 'BTC/USDT', 50000, 0.05)
      ];
      
      // 3. Process trades
      for (const trade of trades) {
        await settlementEngine.processTrade(trade);
      }
      
      // 4. Wait for batch settlement
      const settlementPromise = new Promise((resolve) => {
        settlementEngine.on('settlementEvent', (event) => {
          if (event.type === 'BATCH_CREATED') {
            resolve(event.data);
          }
        });
      });
      
      await settlementEngine.processBatchSettlement();
      const batch = await settlementPromise;
      
      // 5. Verify netting occurred
      expect(batch).toBeDefined();
      expect(batch.totalTrades).toBe(5);
      
      // ETH should be fully netted out in the cycle
      const metrics = settlementEngine.getMetrics();
      expect(metrics.nettingEfficiency).toBeGreaterThan(0);
      
      // 6. Check final balances
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for settlement
      
      const user1Balance = await settlementEngine.getUserBalance('user1');
      const user2Balance = await settlementEngine.getUserBalance('user2');
      const user3Balance = await settlementEngine.getUserBalance('user3');
      
      expect(user1Balance).toBeDefined();
      expect(user2Balance).toBeDefined();
      expect(user3Balance).toBeDefined();
      
      // 7. Simulate on-chain settlement
      if (user1Balance) {
        for (const [token, balance] of user1Balance.balances) {
          onChainProvider.setBalance('user1', token, balance);
        }
      }
      if (user2Balance) {
        for (const [token, balance] of user2Balance.balances) {
          onChainProvider.setBalance('user2', token, balance);
        }
      }
      if (user3Balance) {
        for (const [token, balance] of user3Balance.balances) {
          onChainProvider.setBalance('user3', token, balance);
        }
      }
      
      // 8. Run reconciliation
      await settlementEngine.startReconciliation();
      
      // Should have no discrepancies
      const reconciliationEngine = (settlementEngine as any).reconciliationEngine;
      const pending = reconciliationEngine.getPendingDiscrepancies();
      expect(pending.length).toBe(0);
    });
    
    it('should handle settlement failures and recovery', async () => {
      const clearingHouse = (settlementEngine as any).clearingHouse;
      
      // Register user with insufficient collateral
      await clearingHouse.registerMember('user1', new Map([['USDT', BigInt(100e8)]]));
      await clearingHouse.registerMember('user2', new Map([['USDT', BigInt(100000e8)]]));
      
      // Create large trade that exceeds collateral
      const trade = createTrade('T1', 'user1', 'user2', 'ETH/USDT', 2000, 100);
      
      const failurePromise = new Promise((resolve) => {
        settlementEngine.on('settlementEvent', (event) => {
          if (event.type === 'SETTLEMENT_FAILED') {
            resolve(event);
          }
        });
      });
      
      try {
        await settlementEngine.processTrade(trade);
        await settlementEngine.processBatchSettlement();
      } catch (error) {
        // Expected to fail
      }
      
      // Should emit failure event
      const failureEvent = await Promise.race([
        failurePromise,
        new Promise(resolve => setTimeout(() => resolve(null), 3000))
      ]);
      
      expect(failureEvent).toBeDefined();
    });
    
    it('should handle continuous settlement mode', async () => {
      // Switch to continuous mode
      settlementEngine.setCycle(SettlementCycle.CONTINUOUS);
      
      const clearingHouse = (settlementEngine as any).clearingHouse;
      await clearingHouse.registerMember('user1', new Map([['USDT', BigInt(100000e8)]]));
      await clearingHouse.registerMember('user2', new Map([['USDT', BigInt(100000e8)]]));
      
      const trade = createTrade('T1', 'user1', 'user2', 'ETH/USDT', 2000, 1);
      
      const executedPromise = new Promise((resolve) => {
        settlementEngine.on('settlementEvent', (event) => {
          if (event.type === 'SETTLEMENT_EXECUTED') {
            resolve(event);
          }
        });
      });
      
      await settlementEngine.processTrade(trade);
      
      // Should settle immediately
      const executed = await executedPromise;
      expect(executed).toBeDefined();
    });
  });
  
  describe('Margin Call and Risk Management', () => {
    it('should handle margin calls during settlement', async () => {
      const clearingHouse = (settlementEngine as any).clearingHouse;
      
      // Register with minimal collateral
      await clearingHouse.registerMember('user1', new Map([['USDT', BigInt(1000e8)]]));
      await clearingHouse.registerMember('user2', new Map([['USDT', BigInt(100000e8)]]));
      
      // Create trade that triggers margin call
      const trade = createTrade('T1', 'user1', 'user2', 'ETH/USDT', 2000, 10);
      
      const marginCallPromise = new Promise((resolve) => {
        clearingHouse.on('marginCall', resolve);
      });
      
      await settlementEngine.processTrade(trade);
      await settlementEngine.processBatchSettlement();
      
      const marginCall = await marginCallPromise;
      expect(marginCall).toBeDefined();
      expect(marginCall.member.userId).toBe('user1');
      
      // Deposit more collateral to resolve
      await clearingHouse.depositCollateral('user1', 'USDT', BigInt(50000e8));
      
      const member = clearingHouse.getMember('user1');
      expect(member.status).toBe('ACTIVE');
    });
  });
  
  describe('Reconciliation and Discrepancy Resolution', () => {
    it('should detect and resolve settlement discrepancies', async () => {
      const clearingHouse = (settlementEngine as any).clearingHouse;
      await clearingHouse.registerMember('user1', new Map([['USDT', BigInt(100000e8)]]));
      await clearingHouse.registerMember('user2', new Map([['USDT', BigInt(100000e8)]]));
      
      // Process trade
      const trade = createTrade('T1', 'user1', 'user2', 'ETH/USDT', 2000, 1);
      await settlementEngine.processTrade(trade);
      
      // Switch to continuous for immediate settlement
      settlementEngine.setCycle(SettlementCycle.CONTINUOUS);
      
      // Wait for settlement
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Simulate on-chain discrepancy
      const user1Balance = await settlementEngine.getUserBalance('user1');
      if (user1Balance) {
        for (const [token, balance] of user1Balance.balances) {
          // Set slightly different on-chain balance
          onChainProvider.setBalance('user1', token, balance + BigInt(1000));
        }
      }
      
      // Run reconciliation
      const reconciliationEngine = (settlementEngine as any).reconciliationEngine;
      
      const discrepancyPromise = new Promise((resolve) => {
        reconciliationEngine.on('discrepancyFound', resolve);
      });
      
      await settlementEngine.startReconciliation();
      
      const discrepancy = await discrepancyPromise;
      expect(discrepancy).toBeDefined();
      
      // Get report and manually resolve
      const reports = reconciliationEngine.getAllReports();
      const report = reports[reports.length - 1];
      
      if (report && report.discrepancies.length > 0) {
        await reconciliationEngine.resolveDiscrepancy(
          report.id,
          0,
          'Test resolution',
          true
        );
        
        const updated = reconciliationEngine.getReport(report.id);
        expect(updated.discrepancies[0].resolved).toBe(true);
      }
    });
  });
  
  describe('Performance and Metrics', () => {
    it('should track settlement performance metrics', async () => {
      const clearingHouse = (settlementEngine as any).clearingHouse;
      
      // Register multiple users
      for (let i = 1; i <= 5; i++) {
        await clearingHouse.registerMember(`user${i}`, new Map([['USDT', BigInt(100000e8)]]));
      }
      
      // Create many trades
      const trades: Trade[] = [];
      for (let i = 0; i < 20; i++) {
        const buyer = `user${(i % 5) + 1}`;
        const seller = `user${((i + 1) % 5) + 1}`;
        trades.push(createTrade(`T${i}`, buyer, seller, 'ETH/USDT', 2000 + i, 0.1 * (i + 1)));
      }
      
      // Process all trades
      for (const trade of trades) {
        await settlementEngine.processTrade(trade);
      }
      
      // Trigger batch settlement
      await settlementEngine.processBatchSettlement();
      
      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check metrics
      const metrics = settlementEngine.getMetrics();
      
      expect(metrics.totalTrades).toBe(20);
      expect(metrics.totalSettlements).toBeGreaterThan(0);
      expect(metrics.nettingEfficiency).toBeGreaterThan(0);
      expect(metrics.averageSettlementTime).toBeGreaterThan(0);
      expect(metrics.failureRate).toBe(0);
      
      // Check clearing house stats
      const chStats = clearingHouse.getStatistics();
      expect(chStats.totalMembers).toBe(5);
      expect(chStats.activeMembers).toBe(5);
    });
  });
});