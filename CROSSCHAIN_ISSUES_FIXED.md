# Cross-Chain Issues Fixed

## Summary of Fixes Applied

### 1. Enhanced Token Resolution for Cross-Chain Swaps
- **Issue**: System was trying to swap native token on Linea to a specific token (iTrust Governance) on Ethereum, but the resolution was only mapping to native ETH on Ethereum
- **Fix**: Updated token resolution logic to handle:
  - Same-token cross-chain swaps (e.g., USDC on chain A → USDC on chain B)
  - Different-token cross-chain swaps (e.g., ETH on chain A → USDC on chain B)
  - Better token existence validation on destination chains

### 2. Improved Error Messages
- **Issue**: Generic "No routes available" error wasn't helpful
- **Fix**: Added detailed error messages that explain:
  - Which chains are involved
  - Possible reasons (liquidity, token availability, bridge limitations)
  - Suggestions for users

### 3. Better Logging
- **Issue**: Hard to debug what tokens were being used in cross-chain swaps
- **Fix**: Added comprehensive logging showing:
  - Original token addresses
  - Resolved token addresses
  - Token symbols on both chains
  - Final mapping being used for the swap

## Current Behavior

### Working Scenarios:
1. **Native Token → Native Token** (e.g., ETH on Ethereum → ETH on Polygon) ✅
   - System correctly maps native token format (0x0000... → 0xEeee...)
   - Routes are found via bridges like Across

2. **Same Token Cross-Chain** (e.g., USDC on Ethereum → USDC on Polygon) ✅
   - System finds equivalent token addresses on destination chain
   - Properly maps different USDC addresses across chains

### Limited Scenarios:
1. **Different Token Cross-Chain** (e.g., WBTC on Moonriver → iTrust on Ethereum) ⚠️
   - System correctly identifies this as a different-token swap
   - LiFi returns "no routes" because:
     - iTrust Governance token may not have bridge liquidity
     - The specific route may not be supported by available bridges
   - User gets helpful error message explaining the issue

2. **Unknown/Low-Liquidity Tokens** ⚠️
   - System attempts resolution but may fail for obscure tokens
   - Falls back to original addresses
   - Provides clear error messages

## Remaining Limitations

1. **Bridge Liquidity**: Some token pairs simply don't have bridge support
2. **Token Availability**: Not all tokens exist on all chains
3. **Route Complexity**: Some cross-chain swaps would require multiple hops that aren't supported

## User Experience Improvements

1. **Clear Error Messages**: Users now see why a swap failed instead of generic errors
2. **Token Resolution**: System automatically finds equivalent tokens when possible
3. **Fallback Handling**: System gracefully handles unsupported routes

## Testing Recommendations

1. Test with well-supported token pairs first (ETH, USDC, USDT)
2. Check token availability on destination chain before attempting swaps
3. Use the `/api/crosschain/check-token` endpoint to verify token support