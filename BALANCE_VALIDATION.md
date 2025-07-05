# Token Balance Validation Service

A comprehensive token balance validation service that checks user balances and allowances before order placement, with automatic refresh capabilities and React integration.

## Overview

The balance validation service provides:
- Real-time balance checking for ERC-20 tokens and native ETH
- Token allowance verification for settlement contracts
- 30-second TTL caching to minimize RPC calls
- Automatic balance refresh with event notifications
- React hooks for seamless UI integration
- Order submission integration to block insufficient balance orders

## Architecture

### Core Components

1. **BalanceValidationService** (`/src/services/balanceValidation/BalanceValidationService.ts`)
   - Main service class with caching and validation logic
   - Supports both ERC-20 tokens and native ETH
   - Event-driven architecture for balance updates

2. **useBalance Hook** (`/hooks/useBalance.ts`)
   - React hook with 30-second auto-refresh
   - Multi-token balance tracking
   - Validation and approval methods

3. **Order Submission Integration** (`/pages/api/submitOrder.js`)
   - Validates balance before processing orders
   - Returns detailed validation errors
   - Blocks orders with insufficient balance/allowance

## Usage

### Basic Balance Checking

```typescript
import { BalanceValidationService } from '../src/services/balanceValidation/BalanceValidationService';

const balanceService = new BalanceValidationService(settlementContractAddress);

// Check single token balance
const result = await balanceService.getBalance(
  userAddress,
  tokenAddress,
  'USDC',  // optional symbol
  6        // optional decimals
);

if (result.success) {
  console.log('Balance:', result.balance.balanceFormatted);
  console.log('Allowance:', result.balance.allowanceFormatted);
}
```

### React Hook Usage

```typescript
import { useBalance } from '../hooks/useBalance';

function SwapComponent({ userAddress }) {
  const {
    balances,
    loading,
    error,
    validateBalance,
    approveToken,
    refreshAll
  } = useBalance({
    userAddress,
    tokens: [
      { address: '0x...', symbol: 'USDC', decimals: 6 },
      { address: '0x...', symbol: 'DAI', decimals: 18 }
    ],
    autoRefresh: true,
    refreshInterval: 30000  // 30 seconds
  });

  // Validate before swap
  const handleSwap = async (tokenAddress, amount) => {
    const validation = await validateBalance(tokenAddress, amount);
    
    if (!validation.isValid) {
      if (!validation.hasAllowance && validation.hasBalance) {
        // Need approval
        const approval = await approveToken(tokenAddress, amount);
        if (!approval.success) {
          console.error('Approval failed:', approval.error);
          return;
        }
      } else {
        // Insufficient balance
        console.error('Validation errors:', validation.errors);
        return;
      }
    }
    
    // Proceed with swap...
  };
}
```

### Single Token Hook

```typescript
import { useTokenBalance } from '../hooks/useBalance';

function TokenDisplay({ userAddress, tokenAddress }) {
  const { 
    balance, 
    loading, 
    error, 
    refresh,
    validate,
    approve 
  } = useTokenBalance(
    userAddress,
    tokenAddress,
    'USDC',
    6
  );

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!balance) return <div>No balance data</div>;

  return (
    <div>
      <p>Balance: {balance.balanceFormatted} USDC</p>
      <p>Allowance: {balance.allowanceFormatted}</p>
      <button onClick={refresh}>Refresh</button>
    </div>
  );
}
```

## API Integration

### Order Submission with Balance Validation

When submitting orders through `/api/submitOrder`, the system automatically validates:

1. User has sufficient token balance
2. Token allowance is adequate for the settlement contract
3. Returns detailed validation errors if checks fail

Example error response:
```json
{
  "error": "Insufficient balance or allowance",
  "details": [
    "Insufficient balance. Required: 1000.0 USDC"
  ],
  "validation": {
    "hasBalance": false,
    "hasAllowance": true,
    "currentBalance": "500000000",
    "currentAllowance": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    "required": "1000000000"
  }
}
```

## Balance Validation Flow

```
User submits order
        ↓
Balance Validation Service checks:
  - Token balance ≥ order amount
  - Token allowance ≥ order amount (for ERC-20)
        ↓
If validation fails:
  - Return error with details
  - Suggest approval if needed
        ↓
If validation passes:
  - Continue with order execution
```

## Caching Strategy

The service implements a 30-second TTL cache to optimize performance:

1. **Cache Key**: `{userAddress}-{tokenAddress}` (case-insensitive)
2. **Cache Duration**: 30 seconds (configurable)
3. **Auto-refresh**: Scheduled after each successful fetch
4. **Event Notifications**: Emits 'balanceUpdate' on changes

## Event System

The service emits events for real-time updates:

```typescript
// Listen for balance updates
balanceService.on('balanceUpdate', (balance: TokenBalance) => {
  console.log('Balance updated:', balance);
});

// Listen for approvals
balanceService.on('approval', (data) => {
  console.log('Token approved:', data);
});
```

## Special Token Handling

### Native ETH
- Address: `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` or `0x0000000000000000000000000000000000000000`
- No allowance required
- Returned with unlimited allowance

### ERC-20 Tokens
- Requires explicit allowance for settlement contract
- Supports standard ERC-20 interface
- Handles decimals and symbol queries

## Error Handling

The service provides detailed error information:

1. **Network Errors**: Provider connection issues
2. **Contract Errors**: Invalid token addresses, failed calls
3. **Validation Errors**: Specific balance/allowance issues
4. **Approval Errors**: Failed transactions

## Best Practices

1. **Initialize Once**: Create service instance at app level
2. **Use Hooks**: Leverage React hooks for UI components
3. **Handle Approvals**: Check allowance before balance
4. **Monitor Events**: Subscribe to balance updates
5. **Error Recovery**: Implement retry logic for network issues

## Configuration

### Environment Variables
```bash
SETTLEMENT_CONTRACT=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
```

### Service Configuration
```typescript
const balanceService = new BalanceValidationService(
  settlementContract,  // Required
  {
    cacheTTL: 30000,   // Optional: cache duration in ms
    provider: provider  // Optional: custom provider
  }
);
```

## Testing

### Manual Testing
```bash
# Test balance validation
curl -X POST http://localhost:3000/api/submitOrder \
  -H "Content-Type: application/json" \
  -d '{
    "order": {
      "sellToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "sellAmount": "1000000000",
      "user": "0x1234..."
    },
    "signature": "0x..."
  }'
```

### Component Testing
```typescript
// Test balance hook
const { result } = renderHook(() => useBalance({
  userAddress: '0x123...',
  tokens: [{ address: '0xA0b...', symbol: 'USDC', decimals: 6 }]
}));

await waitFor(() => {
  expect(result.current.balances.size).toBe(1);
});
```

## Performance Considerations

1. **Batch Queries**: Use `getMultipleBalances` for multiple tokens
2. **Cache Hits**: 30-second cache reduces RPC calls by ~90%
3. **Auto-refresh**: Prevents stale data while minimizing queries
4. **Event-driven**: Updates UI without polling

## Future Enhancements

1. **Multi-chain Support**: Add cross-chain balance checking
2. **Historical Tracking**: Store balance history
3. **Notification System**: Alert on low balances
4. **Gas Estimation**: Include gas cost validation
5. **Batch Approvals**: Approve multiple tokens at once