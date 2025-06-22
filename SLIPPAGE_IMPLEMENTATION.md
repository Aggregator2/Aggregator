# Slippage Tolerance Implementation

## Summary

The slippage tolerance is now properly implemented throughout the system:

### Default Value
- **0.5%** is the default slippage tolerance
- Users can change this in the settings panel

### How It Works

1. **User Input**: 
   - Default: `slippageTolerance = "0.5"` (0.5%)
   - Stored as a string percentage value
   - User can modify via settings panel

2. **API Request**:
   - SwapWidget passes `slippageTolerance` to the quote API
   - Example: `{ slippageTolerance: "0.5" }`

3. **Quote Calculation**:
   - LI.FI receives: `slippage: 0.005` (converted to decimal)
   - Uniswap receives: `slippageTolerance: 0.5`
   - Fallback estimate uses user's slippage

4. **Min Received Calculation**:
   - For 0.5% slippage: `minReceived = amount * 0.995`
   - For 1% slippage: `minReceived = amount * 0.99`
   - Etc.

### Code Flow

```
User sets slippage (default 0.5%)
    ↓
SwapWidget stores in state
    ↓
Quote API receives slippage value
    ↓
LI.FI/Uniswap apply slippage
    ↓
minReceived calculated with user's tolerance
```

### Examples

- User sets 0.5% → Receives at least 99.5% of expected amount
- User sets 1% → Receives at least 99% of expected amount
- User sets 2% → Receives at least 98% of expected amount

The slippage is consistently applied across all quote providers!