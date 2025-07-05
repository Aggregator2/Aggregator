# WebSocket API Documentation

This document describes the real-time WebSocket API for streaming market data, order updates, and settlement notifications.

## Overview

The WebSocket API provides real-time bi-directional communication for:
- **Market Data**: Order books, trades, tickers
- **Private Data**: User orders, positions, balances
- **System Updates**: Settlements, notifications

### Key Features
- Authentication via API key or JWT token
- Automatic reconnection with exponential backoff
- Heartbeat mechanism for connection health
- Rate limiting and subscription limits
- Message sequencing for order integrity

## Connection

### Endpoint
```
wss://api.yourdomain.com/ws
```

### Authentication

Include authentication in connection parameters:

```javascript
// API Key Authentication
const socket = io('wss://api.yourdomain.com', {
  path: '/ws',
  auth: {
    apiKey: 'your-api-key'
  }
});

// JWT Token Authentication
const socket = io('wss://api.yourdomain.com', {
  path: '/ws',
  auth: {
    token: 'your-jwt-token'
  }
});
```

### Connection Events

| Event | Description | Data |
|-------|-------------|------|
| `connected` | Successfully connected | `{ socketId, timestamp, server }` |
| `disconnected` | Disconnected from server | `reason: string` |
| `error` | Connection or message error | `{ code, message }` |
| `serverShutdown` | Server shutting down | `{ message }` |

## Subscription Management

### Subscribe to Channel

Send a subscription message:

```json
{
  "op": "subscribe",
  "channel": "orderbook",
  "pair": "ETH/USDC"
}
```

### Unsubscribe from Channel

```json
{
  "op": "unsubscribe",
  "channel": "orderbook",
  "pair": "ETH/USDC"
}
```

### Subscription Response

```json
{
  "channel": "orderbook",
  "pair": "ETH/USDC",
  "timestamp": 1234567890
}
```

## Channels

### 1. Order Book (`orderbook`)

Real-time order book updates for trading pairs.

#### Subscribe
```json
{
  "op": "subscribe",
  "channel": "orderbook",
  "pair": "ETH/USDC"
}
```

#### Snapshot Message
```json
{
  "channel": "orderbook",
  "pair": "ETH/USDC",
  "type": "snapshot",
  "data": {
    "bids": [[2490.00, 2.5], [2485.00, 1.0], [2480.00, 0.5]],
    "asks": [[2510.00, 1.5], [2515.00, 2.0], [2520.00, 1.0]],
    "lastUpdateId": 12345
  },
  "sequence": 1,
  "timestamp": 1234567890
}
```

#### Update Message
```json
{
  "channel": "orderbook",
  "pair": "ETH/USDC",
  "type": "update",
  "data": {
    "bids": [[2491.00, 1.0]],
    "asks": [[2509.00, 0.5]],
    "lastUpdateId": 12346
  },
  "sequence": 2,
  "timestamp": 1234567891
}
```

### 2. Trades (`trades`)

Real-time trade feed for executed trades.

#### Subscribe
```json
{
  "op": "subscribe",
  "channel": "trades",
  "pair": "ETH/USDC"
}
```

#### Trade Message
```json
{
  "channel": "trades",
  "pair": "ETH/USDC",
  "type": "trade",
  "data": {
    "id": "trade-123",
    "price": 2500.00,
    "quantity": 0.5,
    "timestamp": 1234567890,
    "isBuyerMaker": false
  },
  "sequence": 3,
  "timestamp": 1234567890
}
```

### 3. User Orders (`orders`)

Private channel for user order updates.

#### Subscribe
```json
{
  "op": "subscribe",
  "channel": "orders",
  "userId": "user123"
}
```

#### Order Update Message
```json
{
  "channel": "orders",
  "type": "update",
  "data": {
    "orderId": "order-456",
    "clientOrderId": "client-789",
    "pair": "ETH/USDC",
    "side": "BUY",
    "type": "LIMIT",
    "price": 2490.00,
    "quantity": 1.0,
    "filledQuantity": 0.3,
    "remainingQuantity": 0.7,
    "status": "PARTIALLY_FILLED",
    "event": "PARTIALLY_FILLED",
    "timestamp": 1234567890
  },
  "sequence": 4,
  "timestamp": 1234567890
}
```

#### Order Events
- `NEW`: New order created
- `FILLED`: Order completely filled
- `PARTIALLY_FILLED`: Order partially filled
- `CANCELLED`: Order cancelled
- `EXPIRED`: Order expired

### 4. Settlements (`settlements`)

Settlement status updates.

#### Subscribe
```json
{
  "op": "subscribe",
  "channel": "settlements"
}
```

#### Settlement Update
```json
{
  "channel": "settlements",
  "type": "update",
  "data": {
    "settlementId": "settlement-123",
    "status": "QUEUED",
    "tradeId": "trade-456",
    "expectedTime": 1234567890,
    "timestamp": 1234567890
  },
  "sequence": 5,
  "timestamp": 1234567890
}
```

#### Settlement Executed
```json
{
  "channel": "settlements",
  "type": "executed",
  "data": {
    "batchId": "batch-789",
    "status": "EXECUTED",
    "transactionHash": "0x...",
    "merkleRoot": "0x...",
    "leafCount": 25,
    "timestamp": 1234567890
  },
  "sequence": 6,
  "timestamp": 1234567890
}
```

### 5. Tickers (`tickers`)

24-hour rolling ticker statistics.

#### Subscribe (All Pairs)
```json
{
  "op": "subscribe",
  "channel": "tickers"
}
```

#### Subscribe (Single Pair)
```json
{
  "op": "subscribe",
  "channel": "tickers",
  "pair": "ETH/USDC"
}
```

#### Ticker Update
```json
{
  "channel": "tickers",
  "pair": "ETH/USDC",
  "type": "update",
  "data": {
    "pair": "ETH/USDC",
    "lastPrice": 2500.00,
    "bidPrice": 2499.50,
    "askPrice": 2500.50,
    "volume24h": 1234.56,
    "high24h": 2550.00,
    "low24h": 2450.00,
    "change24h": 2.5,
    "timestamp": 1234567890
  },
  "sequence": 7,
  "timestamp": 1234567890
}
```

### 6. Positions (`positions`)

User position updates (requires authentication).

#### Subscribe
```json
{
  "op": "subscribe",
  "channel": "positions",
  "userId": "user123"
}
```

## Heartbeat Mechanism

The client should send ping messages to keep the connection alive:

```json
// Client sends
{ "ping": true }

// Server responds
{ "pong": { "timestamp": 1234567890 } }
```

Recommended ping interval: 25 seconds

## Error Handling

### Error Message Format
```json
{
  "channel": "error",
  "type": "error",
  "data": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many messages",
    "timestamp": 1234567890
  }
}
```

### Error Codes
| Code | Description |
|------|-------------|
| `INVALID_CHANNEL` | Unknown or invalid channel |
| `PAIR_REQUIRED` | Pair parameter missing |
| `AUTH_REQUIRED` | Authentication required |
| `UNAUTHORIZED` | Not authorized for resource |
| `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |
| `SUBSCRIPTION_LIMIT_EXCEEDED` | Too many subscriptions |
| `INVALID_OPERATION` | Unknown operation |
| `MESSAGE_ERROR` | Message processing error |

## Rate Limits

### Connection Limits
- **Max connections per API key**: 5
- **Max connections per IP**: 10
- **Global max connections**: 10,000
- **Burst allowance**: 2 additional connections

### Message Limits
- **Message rate**: 1000 messages per minute per connection
- **Window duration**: 60 seconds (rolling)
- **High-frequency channels throttled**: orderbook, trades, tickers
- **Throttle delay**: 100ms minimum between updates

### Subscription Limits
- **Max subscriptions per connection**: 10
- **No limit on subscription types**

### Rate Limit Headers
When connecting, you'll receive rate limit information:
```json
{
  "connected": {
    "socketId": "abc123",
    "timestamp": 1234567890,
    "server": "WebSocket API v1.0",
    "rateLimits": {
      "subscriptions": {
        "current": 0,
        "limit": 10,
        "remaining": 10
      },
      "messages": {
        "current": 0,
        "limit": 1000,
        "remaining": 1000,
        "windowResetIn": 60000
      }
    }
  }
}
```

### Rate Limit Errors
When rate limits are exceeded:
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Connection limit reached for API key",
    "timestamp": 1234567890
  }
}
```

### Monitoring Rate Limits

#### REST API Endpoints
1. **Get rate limit configuration and stats**
   ```
   GET /api/websocket/rate-limits
   ```

2. **Get specific connection rate limit status**
   ```
   GET /api/websocket/rate-limits?socketId=abc123
   ```

3. **Get connection statistics**
   ```
   GET /api/websocket/connections
   GET /api/websocket/connections?details=true&apiKey=your-key
   ```

### High-Frequency Channel Throttling
Channels with high update frequency are automatically throttled:
- **orderbook**: Updates batched every 100ms
- **trades**: Updates batched every 100ms  
- **tickers**: Updates batched every 100ms

Only the latest update is sent when throttled, ensuring clients always receive the most current data.

## Client Implementation

### JavaScript/TypeScript Example

```typescript
import { WebSocketClient } from './WebSocketClient';

// Create client
const client = new WebSocketClient({
  url: 'wss://api.yourdomain.com',
  apiKey: 'your-api-key',
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000
});

// Connect
client.connect();

// Subscribe to order book
const orderBookSub = client.subscribe(
  'orderbook',
  (message) => {
    console.log('Order book update:', message);
  },
  { pair: 'ETH/USDC' }
);

// Unsubscribe later
client.unsubscribe(orderBookSub);

// Disconnect
client.disconnect();
```

### React Hook Example

```typescript
import { useOrderBook } from './hooks/useWebSocketData';

function OrderBookComponent() {
  const { orderBook, loading, error } = useOrderBook('ETH/USDC', {
    url: 'wss://api.yourdomain.com',
    apiKey: 'your-api-key'
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h3>Order Book</h3>
      <div>
        <h4>Bids</h4>
        {orderBook?.bids.map(([price, quantity]) => (
          <div key={price}>{price} - {quantity}</div>
        ))}
      </div>
      <div>
        <h4>Asks</h4>
        {orderBook?.asks.map(([price, quantity]) => (
          <div key={price}>{price} - {quantity}</div>
        ))}
      </div>
    </div>
  );
}
```

## Best Practices

### 1. Connection Management
- Implement automatic reconnection with exponential backoff
- Handle connection state changes gracefully
- Clean up subscriptions on disconnect

### 2. Message Handling
- Process messages asynchronously to avoid blocking
- Implement proper error handling for message handlers
- Use message sequences to detect gaps

### 3. Performance
- Subscribe only to needed channels
- Implement client-side throttling for UI updates
- Use efficient data structures for order book management

### 4. Security
- Never expose API keys in client-side code
- Use secure WebSocket connections (wss://)
- Implement proper authentication token refresh

## Troubleshooting

### Connection Issues
1. **Cannot connect**
   - Verify WebSocket endpoint URL
   - Check authentication credentials
   - Ensure firewall allows WebSocket connections

2. **Frequent disconnections**
   - Check network stability
   - Verify heartbeat implementation
   - Review server logs for errors

3. **Missing messages**
   - Check subscription status
   - Verify channel and parameters
   - Monitor sequence numbers for gaps

### Performance Issues
1. **High latency**
   - Check network latency to server
   - Review message processing efficiency
   - Consider geographical server location

2. **Message overflow**
   - Implement client-side buffering
   - Throttle UI updates
   - Reduce subscription count

## Migration Guide

### From REST API Polling
```javascript
// Before: Polling
setInterval(async () => {
  const orderBook = await fetch('/api/orderbook/ETH-USDC');
  updateUI(orderBook);
}, 1000);

// After: WebSocket
client.subscribe('orderbook', (message) => {
  updateUI(message.data);
}, { pair: 'ETH/USDC' });
```

### From Other WebSocket APIs
- Map channel names to new format
- Update message parsing logic
- Implement new authentication method

## Server Configuration

### Environment Variables
```bash
WS_PORT=3002
WS_PATH=/ws
API_KEY_SECRET=your-secret-key
JWT_SECRET=your-jwt-secret
PING_INTERVAL=25000
PING_TIMEOUT=60000
MAX_SUBSCRIPTIONS_PER_CLIENT=100
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_MESSAGES=1000
```

### CORS Configuration
```javascript
cors: {
  origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
  credentials: true
}
```

## Support

For issues or questions:
- Check the troubleshooting section
- Review error messages and codes
- Contact support with connection logs