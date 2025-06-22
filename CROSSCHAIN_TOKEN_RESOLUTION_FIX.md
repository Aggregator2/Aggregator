# Cross-Chain Token Resolution Fix

## Problem
When attempting cross-chain swaps, the system was using the same token address on both chains, which doesn't work because tokens have different addresses on different chains. For example:
- USDC on Ethereum: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- USDC on Polygon: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`

## Solution Implemented

### 1. Created Enhanced Token Resolver (`crossChainTokenResolver.ts`)
- Caches all tokens from LiFi across all chains
- Resolves token addresses using multiple strategies:
  1. Predefined mappings (fastest)
  2. LiFi token data lookup
  3. Symbol matching across chains
  4. Similar token pattern matching (e.g., USDC, USDC.e, axlUSDC)

### 2. Updated MultiChainQuoteService
- Now properly resolves both sell and buy tokens for their respective chains
- For cross-chain swaps:
  - Validates sell token exists on source chain
  - Finds equivalent buy token on destination chain
  - Falls back gracefully if tokens can't be resolved

### 3. Added Token Check API Endpoint
- `/api/crosschain/check-token` - Check if a token is available on specific chains
- Useful for frontend validation before attempting swaps

## How It Works

1. **Same-Chain Swaps**: Validates both tokens exist on the chain
2. **Cross-Chain Swaps**: 
   - Maps sell token to its address on source chain
   - Maps buy token to its equivalent on destination chain
   - Example: Swapping ETH on Ethereum to USDC on Polygon will:
     - Use native ETH address on Ethereum
     - Find USDC's Polygon address (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`)

## Testing

Run the test script to verify token resolution:
```bash
node test-crosschain-token-resolution.js
```

This will test:
- Token resolution across multiple chains
- Native token handling
- Unknown token behavior
- Actual cross-chain quote generation

## Example Usage

```javascript
// Cross-chain swap: ETH on Ethereum → USDC on Polygon
const quote = await fetch('/api/quote-profitable', {
  method: 'POST',
  body: JSON.stringify({
    sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native ETH
    buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC (Ethereum address)
    sellAmount: '1000000000000000000', // 1 ETH
    chainId: 1, // Ethereum
    toChainId: 137, // Polygon
  })
});
```

The system will automatically:
1. Recognize native ETH on Ethereum
2. Find USDC's address on Polygon
3. Generate proper cross-chain routes via LiFi

## Benefits

✅ Automatic token address resolution across chains
✅ Support for native tokens (ETH, BNB, MATIC, etc.)
✅ Graceful fallback for unknown tokens
✅ Better error messages for unsupported tokens
✅ Cached token data for fast lookups