# Reconciliation Engine Manual Resolution Fix Verification

## Bug Description
The manual resolution in ReconciliationEngine was incorrectly adjusting balances. When a discrepancy was found and manual resolution with balance adjustment was requested, the balance was being incorrectly updated.

### Test Scenario
- Initial off-chain balance: 1000000000n (10e8)
- On-chain balance: 800000000n (8e8)
- Discrepancy: 200000000n (2e8) excess in off-chain
- Expected after resolution: 800000000n (8e8)
- Actual result before fix: 1200000000n (12e8) ❌

## Root Cause
The code was using `processDeposit` for both positive and negative adjustments:

```typescript
// BEFORE (incorrect):
await this.balanceTracker.processDeposit(
  discrepancy.userId,
  discrepancy.token,
  adjustment > 0 ? adjustment : -adjustment,  // Always positive!
  `RECONCILIATION_${report.id}`
);
```

This meant that when we needed to subtract 200000000n from the balance, it was actually adding 200000000n, resulting in 1200000000n instead of 800000000n.

## Fix Applied
The fix properly handles both positive and negative adjustments:

```typescript
// AFTER (correct):
if (adjustment > 0) {
  // Need to add to balance
  await this.balanceTracker.processDeposit(
    discrepancy.userId,
    discrepancy.token,
    adjustment,
    `RECONCILIATION_${report.id}`
  );
} else {
  // Need to subtract from balance - use withdrawal
  await this.balanceTracker.processWithdrawal(
    discrepancy.userId,
    discrepancy.token,
    -adjustment,  // Make positive for withdrawal
    `RECONCILIATION_${report.id}`
  );
}
```

## Verification

### Scenario 1: Off-chain > On-chain (need to subtract)
- Initial: 1000000000n
- On-chain: 800000000n
- Adjustment: -200000000n (subtract)
- Result: 800000000n ✅

### Scenario 2: On-chain > Off-chain (need to add)
- Initial: 500000000n
- On-chain: 700000000n
- Adjustment: +200000000n (add)
- Result: 700000000n ✅

### Scenario 3: No adjustment requested
- Initial: 1000000000n
- On-chain: 800000000n
- adjustBalance: false
- Result: 1000000000n (unchanged) ✅

## Impact
This fix ensures that manual reconciliation correctly adjusts off-chain balances to match on-chain balances when requested, preventing incorrect balance states that could lead to:
- Users having incorrect balance displays
- Failed withdrawals due to inflated balances
- Incorrect settlement calculations

## File Modified
`/workspace/src/services/settlement/ReconciliationEngine.ts` - Lines 334-352