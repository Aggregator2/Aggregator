# Real-Time Order Status Integration

The simulated order status updates have been replaced with real data from the MatchingEngine. The system now provides comprehensive order tracking, WebSocket streaming, and settlement proof generation.

## Overview

### Key Components:
1. **Order Status API**: Real-time order status from matching engine
2. **WebSocket Streaming**: Live updates for orders and market data
3. **Order History**: Comprehensive order history with pagination
4. **Settlement Proofs**: Cryptographic proofs for dispute resolution

## API Endpoints

### 1. Get Order Status
**GET** `/api/orders/status/[orderId]`

Returns comprehensive order status including:
- Current status from matching engine
- Execution details and trades
- Settlement proof data
- Hybrid execution breakdown (if applicable)

Example response:
```json
{
  "id": "ORD-1234567890-000001",
  "status": "FILLED",
  "pair": "ETH/USDC",
  "side": "BUY",
  "price": 2000.50,
  "quantity": 1.5,
  "filledQuantity": 1.5,
  "averagePrice": 2001.25,
  "execution": {
    "trades": [{
      "id": "trade-123",
      "price": 2001.25,
      "quantity": 1.5,
      "timestamp": 1234567890,
      "fee": 0.003
    }],
    "totalFees": 0.003
  },
  "settlementProof": {
    "signature": "0x...",
    "originalOrder": {...},
    "executionReportId": "EXEC-..."
  }
}
```

### 2. Order History
**GET** `/api/orders/history`

Query parameters:
- `userId`: Filter by user
- `pair`: Filter by trading pair
- `status`: Filter by status
- `limit`: Number of results (default 50)
- `offset`: Pagination offset

Returns paginated order history with execution details.

### 3. WebSocket Streaming
**WebSocket** `/api/orders/stream`

Real-time updates for:
- Order status changes
- Execution reports
- Market data
- Hybrid execution updates

### 4. Settlement Proof
**GET** `/api/orders/settlement-proof/[orderId]`

Returns cryptographic proof for dispute resolution:
- Order hash and signature
- Execution details
- Trade merkle root
- Matching engine proof
- Hybrid execution proof (if applicable)

## WebSocket Integration

### Client Usage with React Hook

```typescript
import { useOrderStream } from '../hooks/useOrderStream';

function OrderTracking({ userId }) {
  const {
    connected,
    orderUpdates,
    executionReports,
    marketData,
    subscribeToOrder,
    unsubscribeFromOrder
  } = useOrderStream(userId);

  // Subscribe to specific order
  useEffect(() => {
    if (orderId) {
      subscribeToOrder(orderId);
      return () => unsubscribeFromOrder(orderId);
    }
  }, [orderId]);

  // Display real-time updates
  return (
    <div>
      {connected ? '🟢 Connected' : '🔴 Disconnected'}
      {orderUpdates.map(update => (
        <OrderUpdate key={update.timestamp} {...update} />
      ))}
    </div>
  );
}
```

### WebSocket Events

#### Client → Server:
- `subscribe-order`: Subscribe to specific order updates
- `subscribe-user`: Subscribe to all user's orders
- `subscribe-market`: Subscribe to market data for a pair
- `unsubscribe-*`: Unsubscribe from updates

#### Server → Client:
- `order-update`: Order status changes
- `execution-report`: Trade execution details
- `market-data`: Real-time price updates
- `hybrid-execution`: External DEX execution updates

## DisputeModal Integration

The DisputeModal now shows actual settlement proofs:

### Features:
1. **Settlement Proof Display**:
   - Execution status and timestamp
   - Trade details with prices and fees
   - Cryptographic verification data

2. **Proof Details View**:
   - Full execution report
   - Individual trade breakdown
   - Hybrid execution details
   - Merkle root verification

3. **Enhanced Validation**:
   - Shows if trade was already executed
   - Warns about potential price differences
   - Provides complete audit trail

## Order Status Flow

```
Order Submitted
     ↓
PENDING → Added to Matching Engine
     ↓
OPEN → Added to Order Book (if limit order)
     ↓
PARTIALLY_FILLED → Some quantity matched
     ↓
FILLED → Fully executed
   or
CANCELLED → User cancelled or expired
```

## Data Sources

Orders are fetched from multiple sources:
1. **Active Orders**: From matching engine order books
2. **Executed Trades**: From matching engine trade history
3. **Settled Orders**: From order store with metadata
4. **Hybrid Orders**: Including external DEX executions

## Testing

### 1. Create Test Orders
```bash
# Seed order books
curl -X POST http://localhost:3000/api/seedOrders

# Submit a real order
curl -X POST http://localhost:3000/api/submitOrder \
  -H "Content-Type: application/json" \
  -d '{"order": {...}, "signature": "0x..."}'
```

### 2. Check Order Status
```bash
# Get specific order status
curl http://localhost:3000/api/orders/status/ORD-123456

# Get order history
curl http://localhost:3000/api/orders/history?userId=0x123
```

### 3. Test WebSocket Updates
Open browser console and run:
```javascript
const socket = io({ path: '/api/orders/stream' });
socket.on('order-update', console.log);
socket.emit('subscribe-market', 'ETH/USDC');
```

## Migration Notes

### Frontend Changes Required:
1. Update order polling to use `/api/orders/history`
2. Implement WebSocket connection for real-time updates
3. Update DisputeModal to fetch settlement proofs
4. Handle new order status values

### Backend Improvements:
1. Orders now persist in matching engine
2. Real execution data instead of simulations
3. Cryptographic proofs for all trades
4. Support for hybrid internal/external execution

## Security Considerations

1. **Authentication**: Add user authentication to order endpoints
2. **Rate Limiting**: Implement rate limits for WebSocket connections
3. **Data Privacy**: Filter orders by user permissions
4. **Proof Validation**: Verify signatures in settlement proofs