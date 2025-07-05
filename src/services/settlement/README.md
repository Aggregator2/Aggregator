# Settlement Service Integration

This document describes how to use the integrated settlement service that connects the MatchingEngine with the FinalSettlementEngine.

## Overview

The settlement service provides:
- Automatic trade capture from the matching engine
- Epoch-based settlement cycles
- Net position calculation and optimization
- On-chain settlement execution
- Webhook notifications for users
- Comprehensive API endpoints

## Architecture

```
MatchingEngine → SettlementOrchestrator → FinalSettlementEngine
                          ↓
                    Webhook Service
                          ↓
                    User Notifications
```

## Quick Start

### 1. Initialize the Service

```typescript
import { createSettlementService, SettlementServiceConfig } from './src/services/settlement/SettlementService';

const config: SettlementServiceConfig = {
  providerUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
  privateKey: 'YOUR_SETTLEMENT_WALLET_PRIVATE_KEY',
  settlementContractAddress: '0x...', // Your deployed settlement contract
  epochDuration: 3600000, // 1 hour epochs
  matchingEngineConfig: {
    // ... matching engine configuration
  },
  enableWebhooks: true,
  enableAutoSettlement: true,
  enableEmergencyPause: true
};

const settlementService = createSettlementService(config);

// Initialize the service
await settlementService.initialize();
```

### 2. Submit Orders

```typescript
// Submit a limit order
const order = await settlementService.submitOrder({
  userId: 'user123',
  pair: 'ETH/USDC',
  side: 'BUY',
  type: 'LIMIT',
  price: 2500.00,
  quantity: 1.5,
  timeInForce: 'GTC'
});
```

### 3. Register Webhooks

```typescript
// Register a webhook for settlement notifications
settlementService.registerWebhook(
  'user123',
  'https://your-app.com/webhooks/settlements',
  'your-webhook-secret'
);
```

## API Endpoints

### Webhook Management

**Register Webhook**
```
POST /api/settlement/webhooks
{
  "userId": "user123",
  "webhookUrl": "https://your-app.com/webhooks",
  "secret": "optional-secret"
}
```

**Unregister Webhook**
```
DELETE /api/settlement/webhooks?userId=user123
```

### Settlement Status

**Get Service Status**
```
GET /api/settlement/status
```

**Get Epoch Information**
```
GET /api/settlement/epochs
GET /api/settlement/epochs?epochId=EPOCH_123
```

**Get User Settlements**
```
GET /api/settlement/user/{userId}/settlements
```

## Webhook Notifications

When trades are settled, the service sends webhook notifications with the following payload:

```json
{
  "type": "SETTLEMENT_NOTIFICATION",
  "data": {
    "epochId": "EPOCH_1_1234567890",
    "userId": "user123",
    "settlements": [
      {
        "token": "USDC",
        "netAmount": "-2500000000",
        "status": "COMPLETED"
      },
      {
        "token": "ETH",
        "netAmount": "1500000000000000000",
        "status": "COMPLETED"
      }
    ],
    "timestamp": 1234567890,
    "transactionHash": "0x..."
  },
  "timestamp": 1234567890
}
```

## Settlement Flow

1. **Trade Execution**: Orders are matched in the MatchingEngine
2. **Trade Capture**: Executed trades are automatically captured by the SettlementOrchestrator
3. **Epoch Collection**: Trades are collected during the epoch period
4. **Net Position Calculation**: At epoch end, net positions are calculated for each user
5. **On-chain Settlement**: Settlement transactions are bundled and executed
6. **Verification**: Settlement results are verified on-chain
7. **Notifications**: Users receive webhook notifications about their settlements

## Configuration Options

### Epoch Duration
- Default: 1 hour (3600000 ms)
- Can be configured from 5 minutes to 24 hours
- Shorter epochs = faster settlement, higher gas costs
- Longer epochs = more netting efficiency, delayed settlement

### Bundle Size
- Default: 100 instructions per bundle
- Affects gas optimization and transaction size
- Larger bundles = better gas efficiency
- Smaller bundles = lower risk per transaction

### Webhook Configuration
- Retry attempts: 3 (default)
- Retry delay: 1000ms (default)
- Only HTTPS URLs allowed in production

## Error Handling

The service handles various error scenarios:
- Failed trades are excluded from settlement
- Failed settlement bundles are retried
- Failed webhooks are retried with exponential backoff
- Emergency pause available for critical issues

## Monitoring

Monitor the service using:
- Event listeners for real-time updates
- Status API endpoint for health checks
- Epoch history for settlement tracking
- Webhook delivery status

## Example Integration

```typescript
// Complete example
import { createSettlementService } from './src/services/settlement/SettlementService';

async function main() {
  // Create and initialize service
  const service = createSettlementService(config);
  await service.initialize();

  // Listen to events
  service.on('epochStarted', (data) => {
    console.log('New epoch started:', data.epochId);
  });

  service.on('settlementConfirmed', (data) => {
    console.log('Settlement confirmed:', data);
  });

  service.on('webhookDelivered', (data) => {
    console.log('Webhook delivered to user:', data.userId);
  });

  // Submit orders
  const order = await service.submitOrder({
    userId: 'alice',
    pair: 'ETH/USDC',
    side: 'BUY',
    type: 'LIMIT',
    price: 2500,
    quantity: 1
  });

  // Register webhook
  service.registerWebhook('alice', 'https://alice-app.com/webhook');

  // Check status
  const status = service.getStatus();
  console.log('Service status:', status);
}

main().catch(console.error);
```

## Security Considerations

1. **Private Key Security**: Store settlement wallet private key securely
2. **Webhook Validation**: Always validate webhook signatures
3. **Access Control**: Implement proper authentication for admin endpoints
4. **Contract Security**: Ensure settlement contract is audited
5. **Emergency Controls**: Use emergency pause when needed

## Gas Optimization

The service implements several gas optimizations:
- Trades are netted to minimize transfers
- Transactions are bundled for efficiency
- Multi-token transfers for users with multiple positions
- Priority-based execution for large trades

## Troubleshooting

Common issues and solutions:

1. **"Settlement service not available"**
   - Ensure service is initialized
   - Check provider connection
   - Verify contract address

2. **"No active epoch accepting trades"**
   - Service may be paused
   - Epoch transition in progress

3. **Webhook delivery failures**
   - Verify webhook URL is accessible
   - Check webhook secret
   - Ensure HTTPS in production

4. **Settlement failures**
   - Check gas price settings
   - Verify contract permissions
   - Monitor bundle size limits