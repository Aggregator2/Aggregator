import { ReconciliationEngine, MockOnChainProvider } from '../ReconciliationEngine';
import { BalanceTracker } from '../BalanceTracker';

describe('ReconciliationEngine', () => {
  let reconciliationEngine: ReconciliationEngine;
  let balanceTracker: BalanceTracker;
  let onChainProvider: MockOnChainProvider;
  
  beforeEach(() => {
    balanceTracker = new BalanceTracker();
    reconciliationEngine = new ReconciliationEngine(balanceTracker, {
      schedule: 'MANUAL',
      tolerance: BigInt(100), // 0.000001 tokens
      autoResolve: true
    });
    
    onChainProvider = new MockOnChainProvider();
    reconciliationEngine.setOnChainProvider(onChainProvider);
  });
  
  afterEach(() => {
    reconciliationEngine.removeAllListeners();
    balanceTracker.removeAllListeners();
  });
  
  describe('Reconciliation Process', () => {
    it('should perform reconciliation successfully', async () => {
      // Setup off-chain balances
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      await balanceTracker.processDeposit('user2', 'USDT', BigInt(5000e8), 'TX_2');
      
      // Setup on-chain balances (matching)
      onChainProvider.setBalance('user1', 'ETH', BigInt(10e8));
      onChainProvider.setBalance('user2', 'USDT', BigInt(5000e8));
      
      const report = await reconciliationEngine.performReconciliation();
      
      expect(report.status).toBe('COMPLETED');
      expect(report.discrepancies.length).toBe(0);
      expect(report.pendingCount).toBe(0);
    });
    
    it('should detect discrepancies', async () => {
      // Setup off-chain balances
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      
      // Setup on-chain balances (different)
      onChainProvider.setBalance('user1', 'ETH', BigInt(8e8));
      
      const discrepancyPromise = new Promise((resolve) => {
        reconciliationEngine.once('discrepancyFound', resolve);
      });
      
      const report = await reconciliationEngine.performReconciliation();
      
      const discrepancy = await discrepancyPromise;
      
      expect(report.discrepancies.length).toBe(1);
      expect(report.discrepancies[0].difference).toBe(BigInt(2e8));
      expect(report.discrepancies[0].type).toBe('BALANCE_MISMATCH');
    });
    
    it('should handle reconciliation failures', async () => {
      // Remove on-chain provider to cause failure
      reconciliationEngine.setOnChainProvider(null as any);
      
      await expect(reconciliationEngine.performReconciliation())
        .rejects.toThrow('On-chain balance provider not set');
    });
  });
  
  describe('Discrepancy Types', () => {
    it('should identify missing settlements', async () => {
      // Create pending trade
      const trade = {
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
        settlementStatus: 'pending' as any
      };
      
      await balanceTracker.updatePendingTrade(trade);
      
      // On-chain hasn't settled yet
      onChainProvider.setBalance('user1', 'ETH', BigInt(0));
      
      const report = await reconciliationEngine.performReconciliation();
      
      const discrepancy = report.discrepancies.find(d => d.userId === 'user1' && d.token === 'ETH');
      expect(discrepancy?.type).toBe('MISSING_SETTLEMENT');
    });
    
    it('should identify double settlements', async () => {
      // Off-chain shows more than on-chain
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(20e8), 'TX_1');
      onChainProvider.setBalance('user1', 'ETH', BigInt(10e8));
      
      const report = await reconciliationEngine.performReconciliation();
      
      expect(report.discrepancies[0].type).toBe('DOUBLE_SETTLEMENT');
    });
  });
  
  describe('Auto Resolution', () => {
    it('should auto-resolve small differences', async () => {
      // Small difference within tolerance
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8 + 50), 'TX_1');
      onChainProvider.setBalance('user1', 'ETH', BigInt(10e8));
      
      const report = await reconciliationEngine.performReconciliation();
      
      // Should auto-resolve as rounding difference
      expect(report.discrepancies.length).toBe(1);
      expect(report.discrepancies[0].resolved).toBe(true);
      expect(report.discrepancies[0].resolution).toContain('rounding');
    });
    
    it('should not auto-resolve large differences', async () => {
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(20e8), 'TX_1');
      onChainProvider.setBalance('user1', 'ETH', BigInt(10e8));
      
      const report = await reconciliationEngine.performReconciliation();
      
      expect(report.discrepancies[0].resolved).toBe(false);
    });
  });
  
  describe('Manual Resolution', () => {
    it('should allow manual resolution of discrepancies', async () => {
      // Create discrepancy
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      onChainProvider.setBalance('user1', 'ETH', BigInt(8e8));
      
      const report = await reconciliationEngine.performReconciliation();
      
      await reconciliationEngine.resolveDiscrepancy(
        report.id,
        0,
        'Manual adjustment approved',
        true // Adjust balance
      );
      
      const updatedReport = reconciliationEngine.getReport(report.id);
      expect(updatedReport?.discrepancies[0].resolved).toBe(true);
      expect(updatedReport?.resolvedCount).toBe(1);
      
      // Balance should be adjusted
      const balance = balanceTracker.getTokenBalance('user1', 'ETH');
      expect(balance).toBe(BigInt(8e8));
    });
  });
  
  describe('Report Management', () => {
    it('should store and retrieve reports', async () => {
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      onChainProvider.setBalance('user1', 'ETH', BigInt(10e8));
      
      const report = await reconciliationEngine.performReconciliation();
      
      const retrieved = reconciliationEngine.getReport(report.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(report.id);
    });
    
    it('should get all reports with limit', async () => {
      // Create multiple reports
      for (let i = 0; i < 5; i++) {
        await balanceTracker.processDeposit(`user${i}`, 'ETH', BigInt(10e8), `TX_${i}`);
        onChainProvider.setBalance(`user${i}`, 'ETH', BigInt(10e8));
        await reconciliationEngine.performReconciliation();
      }
      
      const reports = reconciliationEngine.getAllReports(3);
      expect(reports.length).toBe(3);
    });
    
    it('should get pending discrepancies', async () => {
      // Create discrepancies
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      await balanceTracker.processDeposit('user2', 'ETH', BigInt(20e8), 'TX_2');
      onChainProvider.setBalance('user1', 'ETH', BigInt(8e8));
      onChainProvider.setBalance('user2', 'ETH', BigInt(15e8));
      
      await reconciliationEngine.performReconciliation();
      
      const pending = reconciliationEngine.getPendingDiscrepancies();
      expect(pending.length).toBeGreaterThanOrEqual(2);
    });
  });
  
  describe('Statistics', () => {
    it('should provide reconciliation statistics', async () => {
      // Create some reconciliations
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      onChainProvider.setBalance('user1', 'ETH', BigInt(10e8));
      await reconciliationEngine.performReconciliation();
      
      const stats = reconciliationEngine.getStatistics();
      
      expect(stats.totalReports).toBe(1);
      expect(stats.totalDiscrepancies).toBe(0);
      expect(stats.accuracy).toBe(100);
      expect(stats.config).toBeDefined();
    });
  });
  
  describe('Configuration', () => {
    it('should update configuration', () => {
      reconciliationEngine.updateConfig({
        tolerance: BigInt(1000),
        autoResolve: false
      });
      
      const stats = reconciliationEngine.getStatistics();
      expect(stats.config.tolerance).toBe(BigInt(1000));
      expect(stats.config.autoResolve).toBe(false);
    });
  });
  
  describe('Cleanup', () => {
    it('should cleanup old discrepancies', async () => {
      // Create old report
      await balanceTracker.processDeposit('user1', 'ETH', BigInt(10e8), 'TX_1');
      onChainProvider.setBalance('user1', 'ETH', BigInt(10e8));
      
      const report = await reconciliationEngine.performReconciliation();
      
      // Manually set old timestamp
      report.endTime = Date.now() - 100000000; // Very old
      
      reconciliationEngine.cleanupOldDiscrepancies();
      
      // Old report should be cleaned up if no pending discrepancies
      const reports = reconciliationEngine.getAllReports();
      expect(reports.find(r => r.id === report.id)).toBeUndefined();
    });
  });
});