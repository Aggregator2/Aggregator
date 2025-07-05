# 🐛 SwappiQ Bug Fix Prompts

## 1. Settlement Reconciliation Engine Bugs

### Bug 1: Incorrect Discrepancy Type Detection
**File:** `/workspace/src/services/settlement/ReconciliationEngine.ts`
**Error:** Expected "BALANCE_MISMATCH" but received "DOUBLE_SETTLEMENT"

**Fix Prompt:**
```
I have a ReconciliationEngine that's incorrectly categorizing discrepancies. The test expects:
- When actual balance differs from expected: type should be "BALANCE_MISMATCH"
- Currently returning: "DOUBLE_SETTLEMENT"

Test case:
expect(report.discrepancies[0].type).toBe('BALANCE_MISMATCH');

Please fix the discrepancy detection logic in ReconciliationEngine.ts to properly identify:
1. BALANCE_MISMATCH - when balances don't match expected
2. DOUBLE_SETTLEMENT - when same settlement processed twice
3. MISSING_SETTLEMENT - when expected settlement not found
```

### Bug 2: Missing Settlement Detection Failure
**File:** `/workspace/src/services/settlement/ReconciliationEngine.ts`
**Error:** `discrepancy?.type` is undefined when looking for 'MISSING_SETTLEMENT'

**Fix Prompt:**
```
The ReconciliationEngine is not detecting missing settlements. Test case:

const discrepancy = report.discrepancies.find(d => d.userId === 'user1' && d.token === 'ETH');
expect(discrepancy?.type).toBe('MISSING_SETTLEMENT');

The find() returns undefined, meaning no discrepancy was created for missing settlements.
Please implement the logic to detect when an expected settlement is missing.
```

### Bug 3: Auto-Resolution Not Working
**File:** `/workspace/src/services/settlement/ReconciliationEngine.ts`
**Error:** Small rounding differences not being auto-resolved

**Fix Prompt:**
```
The ReconciliationEngine should auto-resolve small rounding differences but isn't.

Test expects:
- Small differences (< threshold) should be auto-resolved
- discrepancy.resolved should be true
- discrepancy.resolution should contain 'rounding'

Currently: No discrepancies are being marked as resolved.

Please implement auto-resolution logic for rounding differences under a configurable threshold.
```

### Bug 4: Manual Resolution Balance Adjustment
**File:** `/workspace/src/services/settlement/ReconciliationEngine.ts`
**Error:** Balance after manual resolution is 1200000000n instead of expected 800000000n

**Fix Prompt:**
```
Manual resolution is incorrectly adjusting balances.

Test scenario:
- Initial balance: 1000000000n (10e8)
- Discrepancy: 200000000n (2e8) excess
- After resolution expected: 800000000n (8e8)
- Actual result: 1200000000n (12e8)

The manual resolution is adding instead of subtracting. Fix the balance adjustment logic.
```

---

## 2. Atomic Swap Engine Bugs

### Bug 5: Swap Execution Error Handling
**File:** `/workspace/src/services/settlement/AtomicSwapEngine.ts`
**Error:** executeSwaps() resolves successfully instead of throwing error for invalid swaps

**Fix Prompt:**
```
The AtomicSwapEngine.executeSwaps() should throw an error when given invalid swap IDs, but it's resolving successfully.

Test case:
const invalidSwapIds = [...swapIds, 'INVALID_SWAP_ID'];
await expect(atomicSwapEngine.executeSwaps(invalidSwapIds)).rejects.toThrow();

Currently: Promise resolves to undefined
Expected: Should throw an error

Please add validation to check all swap IDs exist before execution and throw appropriate error.
```

---

## 3. Oracle Manipulation Detection Bugs

### Bug 6: Wash Trading Detection Failure
**File:** `/workspace/src/services/oracle/ManipulationDetector.ts`
**Error:** Wash trading patterns not being detected

**Fix Prompt:**
```
ManipulationDetector is not detecting wash trading patterns.

Test creates wash trading scenario but:
const washAlert = alerts.find(a => a.type === 'wash_trading');
expect(washAlert).toBeDefined(); // Returns undefined

Wash trading indicators:
- Same user/address on both sides of trade
- Rapid back-and-forth trades
- No net position change

Please implement wash trading detection logic that creates alerts with type: 'wash_trading'.
```

### Bug 7: Spoofing Detection Failure
**File:** `/workspace/src/services/oracle/ManipulationDetector.ts`
**Error:** Spoofing patterns not being detected

**Fix Prompt:**
```
ManipulationDetector is not detecting spoofing (fake orders to manipulate prices).

Test expects:
const spoofingAlert = alerts.find(a => a.type === 'spoofing');
expect(spoofingAlert).toBeDefined();
expect(spoofingAlert?.exchange).toBe('FakeExchange');

Spoofing indicators:
- Large orders placed and quickly cancelled
- Orders far from market price
- Pattern of placement/cancellation

Implement spoofing detection that creates appropriate alerts.
```

---

## 4. Oracle Data Validation Bugs

### Bug 8: High Price Variance Warning
**File:** `/workspace/src/services/oracle/DataValidator.ts`
**Error:** Not warning about high price variance between sources

**Fix Prompt:**
```
DataValidator should warn when price sources have high variance but doesn't.

Test case:
expect(result.warnings.some(w => w.includes('High price variance'))).toBe(true);

The validator should:
1. Calculate variance between price sources
2. If variance > threshold (e.g., 5%), add warning
3. Warning should include "High price variance"

Please implement variance calculation and warning generation.
```

---

## 5. Settlement Engine Core Bug

### Bug 9: Settlement Validation Error
**File:** `/workspace/src/services/settlement/ClearingHouse.ts`
**Error:** "Settlement has no net amounts" error

**Fix Prompt:**
```
ClearingHouse.validateSettlement() is throwing "Settlement has no net amounts" error.

This suggests settlements are being created without proper net amount calculations.

The validation should:
1. Check if settlement has netAmounts map
2. Verify netAmounts is not empty
3. Only throw error if genuinely missing amounts

Please fix the settlement creation to ensure netAmounts are properly calculated before validation.
```

---

## 🔧 Quick Fix Commands

To apply fixes one by one:

```bash
# Fix ReconciliationEngine
code src/services/settlement/ReconciliationEngine.ts

# Fix AtomicSwapEngine  
code src/services/settlement/AtomicSwapEngine.ts

# Fix ManipulationDetector
code src/services/oracle/ManipulationDetector.ts

# Fix DataValidator
code src/services/oracle/DataValidator.ts

# Fix ClearingHouse
code src/services/settlement/ClearingHouse.ts
```

## 🧪 Test Verification After Fixes

After applying each fix, verify with:

```bash
# Test individual components
npx jest src/services/settlement/__tests__/ReconciliationEngine.test.ts --forceExit
npx jest src/services/settlement/__tests__/AtomicSwapEngine.test.ts --forceExit
npx jest src/services/oracle/__tests__/ManipulationDetector.test.ts --forceExit
npx jest src/services/oracle/__tests__/DataValidator.test.ts --forceExit

# Run all settlement tests
npx jest src/services/settlement --forceExit

# Run all oracle tests
npx jest src/services/oracle --forceExit
```

## 📋 Priority Order

1. **High Priority** - Fix Settlement validation (Bug #9) - blocking other tests
2. **High Priority** - Fix Reconciliation types (Bugs #1-4) - core functionality
3. **Medium Priority** - Fix Oracle detection (Bugs #6-8) - security features
4. **Medium Priority** - Fix Atomic swaps (Bug #5) - error handling

Each prompt above can be given to Claude to fix the specific bug. The prompts include the exact error, expected behavior, and where to look for the fix.