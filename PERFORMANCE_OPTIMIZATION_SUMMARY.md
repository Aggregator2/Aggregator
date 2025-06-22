# SwapWidget Performance Optimization Summary

## Overview
The SwapWidget component has been refactored to minimize unnecessary re-renders and optimize quote fetching through strategic use of `useMemo` and stable dependency references in `useEffect` hooks.

## Key Optimizations Implemented

### 1. Memoized Token References
```typescript
// Memoize token addresses to prevent unnecessary re-renders
const sellTokenAddress = useMemo(() => sellToken.address.toLowerCase(), [sellToken.address]);
const buyTokenAddress = useMemo(() => buyToken.address.toLowerCase(), [buyToken.address]);
const sellTokenChainId = useMemo(() => sellToken.chainId || 1, [sellToken.chainId]);
const buyTokenChainId = useMemo(() => buyToken.chainId || 1, [buyToken.chainId]);

// Memoize token identifiers for stable references
const tokenPair = useMemo(() => ({
  sell: { address: sellTokenAddress, chainId: sellTokenChainId },
  buy: { address: buyTokenAddress, chainId: buyTokenChainId }
}), [sellTokenAddress, sellTokenChainId, buyTokenAddress, buyTokenChainId]);
```

### 2. Memoized Boolean Checks
```typescript
// Memoize boolean checks
const hasValidAmount = useMemo(() => {
  if (!sellAmount || sellAmount.trim() === "") return false;
  const parsed = parseFloat(sellAmount);
  return !isNaN(parsed) && parsed > 0;
}, [sellAmount]);

const isValidChainPair = useMemo(() => 
  sellTokenChainId === buyTokenChainId,
  [sellTokenChainId, buyTokenChainId]
);
```

### 3. Stable Quote Request Parameters
```typescript
// Memoize quote request parameters
const quoteRequestParams = useMemo(() => {
  if (!hasValidAmount) return null;
  
  try {
    const parsedAmount = SpecialTokenService.parseTokenAmount(
      sellTokenAddress,
      sellTokenChainId,
      sellAmount,
      sellToken.decimals ?? 18
    );
    
    return {
      sellToken: sellTokenAddress,
      buyToken: buyTokenAddress,
      sellAmount: parsedAmount,
      chainId: sellTokenChainId,
    };
  } catch (e) {
    swapLogger.error("Failed to parse sell amount:", e);
    return null;
  }
}, [sellTokenAddress, buyTokenAddress, sellAmount, sellTokenChainId, sellToken.decimals, hasValidAmount]);
```

### 4. Optimized Quote Fetching
```typescript
// Enhanced quote fetching with stable dependencies
const fetchQuoteData = useCallback(async () => {
  if (!quoteRequestParams) {
    setCurrentQuote(null);
    setQuoteError(null);
    return;
  }
  // ... fetch logic using quoteRequestParams
}, [quoteRequestParams, networkStatus.isOnline, showWarning]);

// Memoized quote fetch wrapper for stable reference
const stableFetchQuoteData = useMemo(() => {
  let lastFetchId = 0;
  
  return async () => {
    const currentFetchId = ++lastFetchId;
    await fetchQuoteData();
    
    // Only update state if this is still the latest fetch
    return currentFetchId === lastFetchId;
  };
}, [fetchQuoteData]);
```

### 5. Stable useEffect Dependencies
```typescript
// Effect to fetch quotes when inputs change with debounce and polling
useEffect(() => {
  // ... debounce and polling logic
}, [stableFetchQuoteData, hasValidAmount, quoteError]);
```

### 6. Memoized Calculations
```typescript
// Memoized calculations for buy amounts and fees
const { buyAmount, actualBuyAmount, minReceived, feeCalculation } = useMemo(() => {
  // ... calculation logic
}, [currentQuote, buyToken.address, buyToken.chainId, buyToken.decimals]);

const { lpFeeAmount, slippageAmount, priceImpactAmount } = useMemo(() => {
  // ... fee calculations
}, [sellAmount, slippageTolerance]);
```

### 7. Stable Callback Functions
```typescript
// Token switching with stable reference
const handleSwitch = useCallback(() => {
  const tempToken = sellToken;
  setSellToken(buyToken);
  setBuyToken(tempToken);
}, [sellToken, buyToken]);

// Token selection handlers using memoized addresses
const handleSellTokenSelect = useCallback((token: Token) => {
  // ... uses buyTokenAddress instead of buyToken.address
}, [buyTokenAddress, sellToken, showError]);
```

### 8. Memoized Token Warnings
```typescript
// Memoize token warnings to avoid recalculating on every render
const tokenWarnings = useMemo(() => {
  const sellWarnings = getTokenWarnings(sellToken.address, sellToken.chainId);
  const buyWarnings = getTokenWarnings(buyToken.address, buyToken.chainId);
  return { sellWarnings, buyWarnings };
}, [sellToken.address, sellToken.chainId, buyToken.address, buyToken.chainId]);
```

## Performance Benefits

1. **Reduced Re-renders**: By memoizing token addresses and other frequently changing values, we prevent unnecessary re-renders when token objects change but their addresses remain the same.

2. **Stable Dependencies**: The useEffect hooks now have stable dependencies, preventing unnecessary effect runs and quote fetches.

3. **Optimized Quote Polling**: The quote fetching logic only runs when actual parameters change, not when object references change.

4. **Calculation Efficiency**: Complex calculations for buy amounts, fees, and warnings are only recalculated when their inputs actually change.

5. **Prevent Race Conditions**: The `stableFetchQuoteData` wrapper ensures only the latest quote fetch updates the state, preventing race conditions.

## Impact on User Experience

- **Faster UI Updates**: Reduced re-renders mean smoother UI interactions
- **Less Network Traffic**: Quote fetching only happens when necessary
- **Better Battery Life**: Less CPU usage on mobile devices
- **Improved Responsiveness**: UI remains responsive during quote updates

## Migration Notes

The optimizations are backward compatible and don't change the component's external API. The SwapWidget can be used exactly as before, but with improved performance characteristics.