# Quote Generation Test Guide

## Test Scenarios

### 1. Basic WETH to USDC Swap
**Test Steps:**
1. Select WETH as sell token
2. Select USDC as buy token
3. Enter "1" in sell amount
4. **Expected Results:**
   - Buy amount should show ~1,994 USDC (based on $2000 ETH price with 0.3% fee)
   - Minimum received should show ~1,984 USDC (with 0.5% default slippage)
   - LP Fee should show 0.003 WETH

### 2. Stablecoin to Stablecoin (USDC to DAI)
**Test Steps:**
1. Select USDC as sell token
2. Select DAI as buy token
3. Enter "100" in sell amount
4. **Expected Results:**
   - Buy amount should show ~99.7 DAI (0.3% fee on 1:1 rate)
   - Minimum received should show ~99.2 DAI (with 0.5% slippage)

### 3. Small Amount Test (WETH to USDC)
**Test Steps:**
1. Select WETH as sell token
2. Select USDC as buy token
3. Enter "0.001" in sell amount
4. **Expected Results:**
   - Buy amount should show ~1.994 USDC
   - Minimum received should show ~1.984 USDC

### 4. Large Amount Test
**Test Steps:**
1. Select WETH as sell token
2. Select USDC as buy token
3. Enter "100" in sell amount
4. **Expected Results:**
   - Buy amount should show ~199,400 USDC
   - LP Fee should show 0.3 WETH

### 5. Custom Slippage Test
**Test Steps:**
1. Click settings icon
2. Change slippage to "2%"
3. Select WETH → USDC, enter "1"
4. **Expected Results:**
   - Minimum received should show ~1,954 USDC (2% less than 1,994)

### 6. Zero/Invalid Amount Test
**Test Steps:**
1. Enter "0" or leave empty
2. **Expected Results:**
   - No quote should be generated
   - Buy amount should show "0.0"

### 7. Reverse Pair Test (USDC to WETH)
**Test Steps:**
1. Select USDC as sell token
2. Select WETH as buy token
3. Enter "2000" in sell amount
4. **Expected Results:**
   - Buy amount should show ~0.997 WETH

### 8. Unknown Token Test
**Test Steps:**
1. Select any token that's not WETH/USDC/USDT/DAI/WBTC
2. Enter an amount
3. **Expected Results:**
   - Should still generate a quote with consistent pricing
   - Price should be deterministic based on token address

### 9. Cross-chain Quote Test
**Test Steps:**
1. Select tokens from different chains
2. Enter an amount
3. **Expected Results:**
   - Quote should still be generated
   - Both chainId and toChainId should be populated

### 10. High Slippage Warning Test
**Test Steps:**
1. Set slippage to "5%" or higher
2. Generate a quote
3. **Expected Results:**
   - Minimum received should reflect the high slippage
   - Consider showing a warning for high slippage

## Console Debugging

Open browser console (F12) and look for:
1. `Quote Request:` logs showing the request parameters
2. `Quote Calculation:` logs showing all intermediate calculations
3. Any error messages

## Common Issues to Check

1. **Minimum Received is 0:**
   - Check if buyAmount is being calculated correctly
   - Verify decimal conversion is working
   - Check if slippage calculation is correct

2. **Quote not updating:**
   - Check if request parameters are changing
   - Look for any console errors
   - Verify debouncing isn't too aggressive

3. **Wrong amounts:**
   - Check decimal places for both tokens
   - Verify rate calculation
   - Check if amount parsing is correct

## API Response Validation

A correct quote response should have:
```json
{
  "sellToken": "0x...",
  "buyToken": "0x...",
  "sellAmount": "1000000000000000000",  // in base units
  "buyAmount": "1994000000",            // in base units
  "minReceived": "1984030000",          // in base units
  "lpFee": "3000000000000000",          // 0.3% of sell amount
  "price": "1994.000000",
  "slippageTolerance": "0.5",
  // ... other fields
}
```

## Testing Different Decimal Combinations

- **18 decimals → 6 decimals** (WETH → USDC): Most common
- **6 decimals → 18 decimals** (USDC → DAI): Reverse conversion
- **6 decimals → 6 decimals** (USDC → USDT): Same decimals
- **18 decimals → 8 decimals** (WETH → WBTC): Different decimal