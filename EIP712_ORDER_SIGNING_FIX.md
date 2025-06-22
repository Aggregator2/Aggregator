# EIP-712 Order Signing Fix

## Problem
When attempting to sign orders, the system was throwing:
```
TypeError: invalid string value (argument="str", value=null, code=INVALID_ARGUMENT, version=6.14.4)
```

## Root Causes Identified

1. **Field Mismatch**: The `pages/index.js` was looking for `order.side` but SwapWidget creates orders with `order.kind`
2. **Redundant Signing**: The `handleSubmitOrder` in `pages/index.js` was trying to sign the order again, even though SwapWidget already provides a signed order
3. **Potential Null Values**: Some string fields might be null/undefined

## Fixes Applied

### 1. Fixed Field Mismatch
- Changed `order.side` to `order.kind || 'sell'` in pages/index.js
- Updated PropTypes from `side` to `kind`

### 2. Simplified Order Handling
- Updated `handleSubmitOrder` to accept the already-signed order from SwapWidget
- Removed redundant signing logic since SwapWidget handles EIP-712 signing

### 3. Added Null Protection
- Added default empty strings for all string fields in the order
- Used proper decimals for token amounts (from `sellToken.decimals`)
- Added validation and logging for debugging

## How Orders Flow Now

1. **User initiates swap** in SwapWidget
2. **SwapWidget creates order** with all required fields:
   ```javascript
   {
     sellToken: address,
     buyToken: address,
     sellAmount: baseUnits,
     buyAmount: quoteAmount,
     validTo: timestamp,
     user: walletAddress,
     receiver: walletAddress,
     wallet: walletAddress,
     appData: bytes32,
     feeAmount: string,
     partiallyFillable: false,
     kind: "sell",
     signingScheme: "eip712",
     nonce: 0
   }
   ```

3. **EIP-712 signing** happens in SwapWidget using the proper domain and types
4. **Signed order** is passed to parent component or `/api/submitOrder`
5. **Backend validates** the signature and processes the order

## EIP-712 Structure

Domain:
```javascript
{
  name: "MetaAggregator",
  version: "1",
  chainId: 31337,
  verifyingContract: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
}
```

Types match between frontend and backend for proper signature verification.

## Testing

The order signing should now work correctly. Test by:
1. Selecting tokens and entering an amount
2. Clicking swap button
3. Signing the EIP-712 typed data in wallet
4. Order should be submitted successfully