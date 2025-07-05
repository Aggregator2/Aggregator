# Balance Management System

This document describes the on-chain balance validation system that ensures users have sufficient token balances and allowances before their orders are accepted into the matching engine.

## Overview

The Balance Management System provides real-time validation of user token balances and allowances, preventing order failures due to insufficient funds. It integrates seamlessly with the matching engine to:

- **Query Token Balances**: Check ERC-20 token balances and native ETH balances
- **Verify Allowances**: Ensure tokens are approved for the settlement contract
- **Cache Results**: Reduce RPC calls with configurable TTL caching
- **Block Invalid Orders**: Prevent order submission when balances are insufficient
- **Monitor Changes**: Track balance changes and auto-cancel orders if needed
- **UI Integration**: Show real-time balances with visual feedback

## Architecture

```
Order Submission Flow:
User → Order Form → Balance Check → Risk Check → Matching Engine
           ↓              ↓
      UI Validation   Blockchain Query
           ↓              ↓
     Submit Button    Cache (30s TTL)
      Enable/Disable      ↓
                    Balance Service
```

## Components

### 1. BalanceCheckService
Core service for querying and caching token balances.

```typescript
const balanceService = new BalanceCheckService({
  provider: ethers.Provider,
  settlementContract: '0x...',
  cacheTTL: 30000, // 30 seconds
  batchSize: 10
});
```

### 2. BalanceAwareMatchingEngine
Extended matching engine with integrated balance validation.

```typescript
const matchingEngine = new BalanceAwareMatchingEngine({
  // Standard config...
  balanceCheckEnabled: true,
  rejectInsufficientBalance: true,
  rejectInsufficientAllowance: true,
  balanceCheckTimeout: 5000,
  settlementContract: '0x...',
  tokenMapping: {
    'ETH/USDC': {
      baseToken: 'NATIVE',
      quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      baseIsNative: true,
      quoteIsNative: false
    }
  }
}, riskService, provider);
```

### 3. React Hooks
Custom hooks for UI integration.

```typescript
// useBalances - Multiple token balances
const { balances, loading, refresh, checkSufficientBalance } = useBalances({
  provider,
  settlementContract,
  userAddress,
  tokens: [
    { address: '0x...', isNative: false, symbol: 'USDC' },
    { address: 'NATIVE', isNative: true, symbol: 'ETH' }
  ],
  autoRefresh: true,
  refreshInterval: 30000
});

// useOrderValidation - Order-specific validation
const { validateOrder, validating, validation } = useOrderValidation(
  provider,
  settlementContract,
  userAddress
);
```

### 4. BalanceAwareOrderForm
React component with integrated balance checking.

## Features

### Balance Validation

1. **Pre-submission Validation**
   ```typescript
   // Validates balance and allowance before order submission
   const validation = await balanceService.validateOrderBalance(
     userAddress,
     tokenAddress,
     requiredAmount,
     isNativeToken
   );
   ```

2. **Order-specific Checks**
   - Buy orders: Check quote token balance (e.g., USDC)
   - Sell orders: Check base token balance (e.g., ETH, BTC)
   - Native token orders: No allowance check needed
   - ERC-20 orders: Both balance and allowance checked

3. **Validation Results**
   ```typescript
   interface BalanceValidation {
     hasBalance: boolean;
     hasAllowance: boolean;
     balance: bigint;
     allowance: bigint;
     required: bigint;
     token: string;
     symbol: string;
     errors: string[];
   }
   ```

### Caching System

1. **TTL-based Cache**
   - Default: 30-second TTL
   - Configurable per deployment
   - Automatic expiration
   - Manual refresh available

2. **Cache Key Structure**
   ```
   {userAddress}:{tokenAddress} → TokenBalance
   {userAddress}:NATIVE → Native balance
   ```

3. **Cache Management**
   ```typescript
   // Clear specific user cache
   balanceService.clearUserCache(userAddress);
   
   // Clear all cache
   balanceService.clearAllCache();
   
   // Get cache statistics
   const stats = balanceService.getCacheStats();
   ```

### Balance Monitoring

1. **Real-time Updates**
   ```typescript
   // Monitor specific tokens
   const interval = await balanceService.startBalanceMonitoring(
     userAddress,
     [
       { address: '0x...', isNative: false },
       { address: 'NATIVE', isNative: true }
     ],
     60000 // Check every minute
   );
   ```

2. **Balance Change Events**
   ```typescript
   balanceService.on('balanceChanged', (data) => {
     console.log('Balance changed:', {
       user: data.userAddress,
       token: data.symbol,
       oldBalance: data.oldBalance,
       newBalance: data.newBalance
     });
   });
   ```

### UI Integration

1. **Visual Feedback**
   - Real-time balance display
   - Refresh button for manual updates
   - Color-coded status indicators
   - Disabled submit button when insufficient

2. **Status Messages**
   - ✅ "Sufficient balance"
   - ❌ "Insufficient USDC balance. Need: 250.00"
   - ⚠️ "USDC approval needed for settlement contract"
   - ⏳ "Checking balance..."

## Configuration

### Token Mappings
Define token addresses for each trading pair:

```typescript
const tokenMapping = {
  'ETH/USDC': {
    baseToken: 'NATIVE', // Special identifier for ETH
    quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    baseIsNative: true,
    quoteIsNative: false
  },
  'WBTC/USDC': {
    baseToken: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    baseIsNative: false,
    quoteIsNative: false
  }
};
```

### Network Configuration
Adjust for different networks:

```typescript
// Mainnet
const MAINNET_TOKENS = {
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
};

// Goerli
const GOERLI_TOKENS = {
  USDC: '0x07865c6E87B9F70255377e024ace6630C1Eaa37F',
  // ... other testnet addresses
};
```

## Events

### BalanceCheckService Events
| Event | Description | Data |
|-------|-------------|------|
| `balanceValidated` | Balance check completed | `{ userAddress, tokenAddress, validation, timestamp }` |
| `balanceChanged` | Balance change detected | `{ userAddress, tokenAddress, oldBalance, newBalance, symbol }` |
| `balanceRefreshed` | Manual refresh completed | `{ userAddress, tokenAddress, balance, timestamp }` |
| `cacheCleared` | Cache cleared | `{ userAddress?, entriesCleared }` |

### MatchingEngine Events
| Event | Description | Data |
|-------|-------------|------|
| `balanceChecked` | Order balance validated | `{ user, token, hasBalance, hasAllowance }` |
| `userBalanceChanged` | User balance updated | `{ user, token, oldBalance, newBalance }` |
| `orderAutoCancelled` | Order cancelled due to balance | `{ orderId, userId, reason, errors }` |
| `orderRejected` | Order rejected | `{ order, reason, balanceErrors }` |

## Error Handling

### Common Errors

1. **Insufficient Balance**
   ```
   Error: Insufficient USDC balance. Required: 1000.00, Available: 500.00
   ```

2. **Insufficient Allowance**
   ```
   Error: Insufficient USDC allowance. Required: 1000.00, Approved: 0.00
   ```

3. **Balance Check Timeout**
   ```
   Error: Balance check timeout
   ```

4. **RPC Errors**
   ```
   Error: Failed to query token 0x...: execution reverted
   ```

### Error Recovery
- Automatic retry with exponential backoff
- Fallback to cached values if available
- Non-blocking mode option for degraded service

## Best Practices

### 1. Cache Configuration
- Production: 30-60 second TTL
- High-frequency trading: 10-15 second TTL
- Development: 5-10 second TTL

### 2. Performance Optimization
```typescript
// Batch balance queries
const balances = await balanceService.getMultipleBalances(
  userAddress,
  tokens // Array of tokens
);

// Use pending query deduplication
// Multiple simultaneous calls for same balance return same promise
```

### 3. User Experience
- Show loading states during balance checks
- Provide clear error messages
- Allow manual refresh
- Pre-fetch balances for common tokens

### 4. Security Considerations
- Never trust client-side balance checks alone
- Always validate on-chain before execution
- Monitor for rapid balance changes (potential attacks)
- Implement rate limiting for balance queries

## Integration Examples

### Basic Order Form Integration
```typescript
function OrderForm() {
  const { balances, checkSufficientBalance } = useBalances({
    provider,
    settlementContract,
    userAddress,
    tokens: tradingPairs
  });

  const canSubmit = checkSufficientBalance(
    tokenAddress,
    requiredAmount,
    isNative
  );

  return (
    <button disabled={!canSubmit}>
      {canSubmit ? 'Place Order' : 'Insufficient Balance'}
    </button>
  );
}
```

### Advanced Integration with Auto-refresh
```typescript
function TradingInterface() {
  const { balances, refresh } = useBalances({
    provider,
    settlementContract,
    userAddress,
    tokens,
    autoRefresh: true,
    refreshInterval: 30000
  });

  // Refresh after successful trade
  const handleTradeComplete = useCallback(async () => {
    await refresh();
  }, [refresh]);

  return <TradingPanel onTradeComplete={handleTradeComplete} />;
}
```

## Troubleshooting

### Balance Not Updating
1. Check cache TTL settings
2. Verify RPC endpoint connectivity
3. Ensure correct token addresses
4. Check for pending transactions

### Allowance Issues
1. Verify settlement contract address
2. Check if approval transaction confirmed
3. Ensure sufficient gas for approval
4. Verify token implements standard ERC-20

### Performance Issues
1. Increase cache TTL
2. Batch balance queries
3. Implement pagination for many tokens
4. Use dedicated RPC endpoint

## Testing

### Unit Tests
```typescript
describe('BalanceCheckService', () => {
  it('should cache balance queries', async () => {
    const balance1 = await service.getTokenBalance(user, token);
    const balance2 = await service.getTokenBalance(user, token);
    expect(balance1).toEqual(balance2); // Same cached instance
  });

  it('should validate order balance', async () => {
    const validation = await service.validateOrderBalance(
      user,
      token,
      amount
    );
    expect(validation.hasBalance).toBe(true);
  });
});
```

### Integration Tests
- Test with mainnet fork
- Simulate balance changes
- Test cache expiration
- Verify error handling

## Appendix: Token Standards

### ERC-20 Methods Used
```solidity
function balanceOf(address account) view returns (uint256)
function allowance(address owner, address spender) view returns (uint256)
function symbol() view returns (string)
function decimals() view returns (uint8)
```

### Native ETH Handling
- Uses `provider.getBalance()` for ETH
- No allowance check needed
- Special identifier: `'NATIVE'`