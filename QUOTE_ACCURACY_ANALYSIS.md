# SwappiQ Quote Accuracy Analysis

## Issue Identified

SwappiQ quotes are showing worse rates than other DEX aggregators because the system is applying a **hidden 0.3% spread markup** on all quotes.

## Where the Issue Occurs

### 1. Main API (`/workspace/lib/swappiq-api.js`)
- **Line 189-190**: Applies 0.3% profit margin
```javascript
const profitMargin = 0.003; // 0.3% profit margin
const rate = baseRate * (1 - profitMargin);
```

### 2. Profitable Quote Service (`/workspace/src/services/profitableQuoteService.ts`)
- **Line 8**: Configuration sets `spreadMarkupBps: 30` (0.3%)
- **Line 137**: Applies hidden spread markup via `applyHiddenSpreadMarkup()`
- **Lines 380-398**: The markup function reduces the `buyAmount` by the configured basis points

## How It Works

1. The system fetches real market quotes from sources like LiFi, 0x, etc.
2. It then reduces the `buyAmount` by 0.3% before showing it to users
3. Users receive 0.3% fewer tokens than the actual market rate
4. This hidden fee is not disclosed in the UI

## Example Impact

For a 1 ETH → USDC swap at $3,500:
- Actual market quote: 3,500 USDC
- SwappiQ shows: 3,489.5 USDC (10.5 USDC hidden fee)
- User loses 0.3% on every trade

## Solutions

### Option 1: Remove Hidden Markup (Recommended)
```javascript
// In /workspace/lib/swappiq-api.js, line 189-190
const profitMargin = 0; // Remove hidden fee
const rate = baseRate; // Use actual market rate
```

### Option 2: Make Fee Transparent
- Show the fee explicitly in the UI
- Add a "Platform Fee: 0.3%" line item
- Update the quote response to include fee breakdown

### Option 3: Reduce Fee to Competitive Level
- Most DEX aggregators charge 0-0.15%
- Consider reducing to 0.1% or less to be competitive

## Testing Quote Accuracy

Use the test script to compare quotes:
```bash
node test-quote-direct.js
```

This will show you the exact difference between SwappiQ quotes and market rates.