# External Liquidity Execution with LiFi SDK

## Overview

The enhanced liquidity aggregator now provides complete external DEX trade execution using the LiFi SDK. This implementation includes:

- Real-time quote fetching from multiple DEXs
- Transaction building with proper gas estimation
- User signature collection via ethers.js
- Transaction submission and monitoring
- Automatic retry logic for transient failures
- Fallback to alternative DEXs on failures
- Complete order status tracking

## Key Features

### 1. LiFi SDK Integration

The system uses LiFi's `executeRoute` method to:
- Build optimal swap transactions
- Handle token approvals automatically
- Manage cross-DEX routing
- Provide real-time execution updates

### 2. Transaction Lifecycle

```typescript
PENDING -> QUOTE_RECEIVED -> SIGNING -> SUBMITTED -> CONFIRMED
                                          |
                                          v
                                       FAILED/REVERTED
```

### 3. Error Handling

The implementation handles various error scenarios:
- **Insufficient funds**: Clear user messaging
- **Slippage exceeded**: Automatic adjustment or user notification
- **Network issues**: Automatic retry with exponential backoff
- **Transaction reverts**: Detailed error analysis
- **Rate limits**: Proper backoff and retry

## Usage Example

```typescript
import { ethers } from 'ethers';
import { liquidityAggregator } from './services/liquidityAggregator';
import { OrderSide } from './services/matchingEngine/types';

// Setup signer (user's wallet)
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(privateKey, provider);

// Execute external trade
const result = await liquidityAggregator.executeExternalTrade(
  userId: 'user123',
  pair: 'ETH/USDC',
  side: OrderSide.BUY,
  quantity: 1.5, // Buy 1.5 ETH
  signer,
  {
    maxSlippage: 0.02, // 2% slippage
    maxRetries: 3,
    fallbackDEXs: ['Uniswap', '1inch']
  }
);

console.log('Trade executed:', {
  orderId: result.orderId,
  txHash: result.txHash,
  filledQuantity: result.filledQuantity,
  averagePrice: result.averagePrice
});
```

## Event Monitoring

The system emits various events for real-time updates:

```typescript
// Quote received
liquidityAggregator.on('quote:received', (data) => {
  console.log('Quote:', data.estimatedOutput, data.estimatedGas);
});

// Signature required
liquidityAggregator.on('signature:required', (data) => {
  console.log('Please sign transaction for order:', data.orderId);
});

// Transaction submitted
liquidityAggregator.on('transaction:submitted', (data) => {
  console.log('TX Hash:', data.txHash);
});

// Transaction confirmed
liquidityAggregator.on('transaction:confirmed', (data) => {
  console.log('Confirmed with', data.confirmations, 'blocks');
});
```

## API Reference

### executeExternalTrade

Main method for executing external trades:

```typescript
async executeExternalTrade(
  userId: string,
  pair: string,
  side: OrderSide,
  quantity: number,
  signer: ethers.Signer,
  options?: {
    dexName?: string;
    maxSlippage?: number;
    maxRetries?: number;
    fallbackDEXs?: string[];
  }
): Promise<ExecutionResult>
```

**Parameters:**
- `userId`: Unique user identifier
- `pair`: Trading pair (e.g., "ETH/USDC")
- `side`: BUY or SELL
- `quantity`: Amount to trade
- `signer`: User's wallet signer
- `options`: Optional configuration

**Returns:**
```typescript
{
  orderId: string;
  txHash: string;
  status: 'confirmed' | 'failed';
  filledQuantity: number;
  averagePrice: number;
  gasUsed: string;
  route: any; // LiFi route details
}
```

### getExternalTradeStatus

Get current status of an external trade:

```typescript
getExternalTradeStatus(orderId: string): ExternalTradeStatus | undefined
```

### getPendingExternalTrades

Get all pending external trades:

```typescript
getPendingExternalTrades(): ExternalTradeStatus[]
```

### getOrdersByUser

Get trade history for a specific user:

```typescript
getOrdersByUser(userId: string): ExternalTradeStatus[]
```

## Configuration

### Supported Tokens

Currently supported tokens and their mappings:

```typescript
{
  'ETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
}
```

### Gas Configuration

The system automatically:
- Estimates gas for transactions
- Adds a 20% buffer for safety
- Allows custom gas overrides
- Handles EIP-1559 transactions

### Retry Logic

Failed transactions are retried based on error type:
- **Nonce errors**: Immediate retry
- **Network timeouts**: Exponential backoff
- **Gas price issues**: Retry with updated gas
- **Reverts/Slippage**: No retry (user action needed)

## Error Handling

### Common Errors and Solutions

1. **Insufficient Funds**
   - Check user has enough tokens
   - Ensure ETH available for gas

2. **Slippage Exceeded**
   - Increase `maxSlippage` parameter
   - Try smaller trade amounts
   - Check market volatility

3. **No Routes Available**
   - Verify token pair is supported
   - Check liquidity availability
   - Try alternative DEXs

4. **Rate Limit Exceeded**
   - Wait for cooldown period
   - Use fallback DEXs
   - Implement request queuing

## Security Considerations

1. **Private Key Handling**
   - Never expose private keys
   - Use secure wallet connections
   - Implement proper key management

2. **Transaction Validation**
   - Always verify transaction details
   - Check recipient addresses
   - Validate amounts and prices

3. **Slippage Protection**
   - Set reasonable slippage limits
   - Monitor price impact
   - Use MEV protection when available

## Production Considerations

1. **RPC Endpoints**
   - Use reliable RPC providers
   - Implement fallback endpoints
   - Monitor endpoint health

2. **Database Integration**
   - Store trade history
   - Track user balances
   - Maintain audit logs

3. **Monitoring**
   - Track success rates
   - Monitor gas costs
   - Alert on failures

4. **User Experience**
   - Show real-time updates
   - Provide clear error messages
   - Enable transaction tracking

## Testing

Run the test suite:

```bash
npm test src/tests/externalLiquidityExecution.test.ts
```

The tests cover:
- Quote generation
- Transaction execution
- Error handling
- Retry logic
- Event emissions
- Status tracking

## Future Enhancements

1. **Multi-chain Support**
   - Cross-chain swaps
   - Bridge integrations
   - Chain-specific optimizations

2. **Advanced Features**
   - MEV protection
   - Limit orders
   - DCA strategies
   - Flash loan integration

3. **Additional DEX Support**
   - Direct Uniswap V3 integration
   - 1inch API integration
   - 0x Protocol support
   - Curve Finance integration