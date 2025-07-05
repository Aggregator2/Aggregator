import { BalanceTracker } from '../BalanceTracker';
import { ReconciliationEngine, MockOnChainProvider } from '../ReconciliationEngine';

describe('ReconciliationEngine - Manual Resolution Fix', () => {
  let balanceTracker: BalanceTracker;
  let reconciliationEngine: ReconciliationEngine;
  let onChainProvider: MockOnChainProvider;
  
  beforeEach(() => {
    balanceTracker = new BalanceTracker();
    reconciliationEngine = new ReconciliationEngine(balanceTracker, {
      schedule: 'MANUAL',
      tolerance: BigInt(0),
      autoResolve: false
    });
    
    onChainProvider = new MockOnChainProvider();
    reconciliationEngine.setOnChainProvider(onChainProvider);
  });
  
  test('Manual resolution correctly adjusts balance when off-chain > on-chain', async () => {
    const userId = 'user1';
    const token = 'USDC';
    const initialBalance = BigInt(1000000000); // 10e8
    const onChainBalance = BigInt(800000000);  // 8e8
    
    // Set up initial balances
    await balanceTracker.processDeposit(userId, token, initialBalance, 'INITIAL');
    onChainProvider.setBalance(userId, token, onChainBalance);
    
    // Verify initial balance
    const balanceBefore = balanceTracker.getTokenBalance(userId, token);
    expect(balanceBefore).toBe(initialBalance);
    
    // Perform reconciliation
    const report = await reconciliationEngine.performReconciliation();
    expect(report.discrepancies.length).toBe(1);
    
    const discrepancy = report.discrepancies[0];
    expect(discrepancy.offChainBalance).toBe(initialBalance);
    expect(discrepancy.onChainBalance).toBe(onChainBalance);
    expect(discrepancy.difference).toBe(BigInt(200000000)); // 2e8
    
    // Manually resolve with balance adjustment
    await reconciliationEngine.resolveDiscrepancy(
      report.id,
      0,
      'Manual resolution - adjusting to match on-chain balance',
      true // adjustBalance = true
    );
    
    // Check balance after resolution
    const balanceAfter = balanceTracker.getTokenBalance(userId, token);
    
    // The balance should now match the on-chain balance
    expect(balanceAfter).toBe(onChainBalance);
    expect(balanceAfter).toBe(BigInt(800000000)); // Should be 8e8, not 12e8
  });
  
  test('Manual resolution correctly adjusts balance when on-chain > off-chain', async () => {
    const userId = 'user2';
    const token = 'USDC';
    const initialBalance = BigInt(500000000); // 5e8
    const onChainBalance = BigInt(700000000); // 7e8
    
    // Set up initial balances
    await balanceTracker.processDeposit(userId, token, initialBalance, 'INITIAL');
    onChainProvider.setBalance(userId, token, onChainBalance);
    
    // Perform reconciliation
    const report = await reconciliationEngine.performReconciliation();
    
    const discrepancy = report.discrepancies.find(d => d.userId === userId);
    expect(discrepancy).toBeDefined();
    expect(discrepancy!.offChainBalance).toBe(initialBalance);
    expect(discrepancy!.onChainBalance).toBe(onChainBalance);
    expect(discrepancy!.difference).toBe(BigInt(-200000000)); // -2e8
    
    // Manually resolve with balance adjustment
    await reconciliationEngine.resolveDiscrepancy(
      report.id,
      report.discrepancies.indexOf(discrepancy!),
      'Manual resolution - adjusting to match on-chain balance',
      true
    );
    
    // Check balance after resolution
    const balanceAfter = balanceTracker.getTokenBalance(userId, token);
    
    // The balance should now match the on-chain balance
    expect(balanceAfter).toBe(onChainBalance);
    expect(balanceAfter).toBe(BigInt(700000000)); // Should be 7e8
  });
  
  test('Manual resolution without balance adjustment does not change balance', async () => {
    const userId = 'user3';
    const token = 'USDC';
    const initialBalance = BigInt(1000000000); // 10e8
    const onChainBalance = BigInt(800000000);  // 8e8
    
    // Set up initial balances
    await balanceTracker.processDeposit(userId, token, initialBalance, 'INITIAL');
    onChainProvider.setBalance(userId, token, onChainBalance);
    
    // Perform reconciliation
    const report = await reconciliationEngine.performReconciliation();
    
    // Manually resolve WITHOUT balance adjustment
    await reconciliationEngine.resolveDiscrepancy(
      report.id,
      0,
      'Manual resolution - no adjustment',
      false // adjustBalance = false
    );
    
    // Check balance after resolution
    const balanceAfter = balanceTracker.getTokenBalance(userId, token);
    
    // The balance should remain unchanged
    expect(balanceAfter).toBe(initialBalance);
    expect(balanceAfter).toBe(BigInt(1000000000)); // Still 10e8
  });
});