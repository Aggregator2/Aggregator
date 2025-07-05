# REST API v1 Documentation

Comprehensive REST API for the off-chain settlement system with order management, order books, trading, settlements, and account endpoints.

## Base URL
```
https://api.example.com/api/v1
```

## Authentication
All authenticated endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

## Rate Limiting
- Rate limit: 100 requests per minute
- Headers included in all responses:
  - `X-RateLimit-Limit`: Maximum requests per window
  - `X-RateLimit-Remaining`: Remaining requests in current window
  - `X-RateLimit-Reset`: Window reset time (ISO 8601)

## Common Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Error Codes
- `BAD_REQUEST`: Invalid request parameters
- `UNAUTHORIZED`: Missing or invalid authentication
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `INTERNAL_ERROR`: Server error

## Endpoints

### 1. Order Management

#### Create Order
**POST** `/api/v1/orders`

Create a new order.

**Request Body:**
```json
{
  "pair": "ETH/USDC",
  "side": "BUY",
  "type": "LIMIT",
  "quantity": 1.5,
  "price": 2000.50,
  "timeInForce": "GTC",
  "clientOrderId": "my-order-123"
}
```

**Parameters:**
- `pair` (required): Trading pair (e.g., "ETH/USDC")
- `side` (required): "BUY" or "SELL"
- `type` (required): "LIMIT" or "MARKET"
- `quantity` (required): Order quantity
- `price` (required for LIMIT): Order price
- `timeInForce`: "GTC", "IOC", or "FOK" (default: "GTC")
- `clientOrderId`: Custom order ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ORD-1234567890-000001",
    "clientOrderId": "my-order-123",
    "status": "OPEN",
    "pair": "ETH/USDC",
    "side": "BUY",
    "type": "LIMIT",
    "price": 2000.50,
    "quantity": 1.5,
    "filledQuantity": 0,
    "remainingQuantity": 1.5,
    "averagePrice": 0,
    "timeInForce": "GTC",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "trades": []
  }
}
```

#### List Orders
**GET** `/api/v1/orders`

Get a list of user orders with pagination.

**Query Parameters:**
- `status`: Filter by status (OPEN, FILLED, PARTIALLY_FILLED, CANCELLED)
- `pair`: Filter by trading pair
- `side`: Filter by side (BUY, SELL)
- `from`: Start date (ISO 8601)
- `to`: End date (ISO 8601)
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "ORD-1234567890-000001",
      "clientOrderId": "my-order-123",
      "pair": "ETH/USDC",
      "side": "BUY",
      "type": "LIMIT",
      "status": "FILLED",
      "price": 2000.50,
      "quantity": 1.5,
      "filledQuantity": 1.5,
      "remainingQuantity": 0,
      "averagePrice": 2001.25,
      "timeInForce": "GTC",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:01:00.000Z",
      "trades": [...]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

#### Get Order Details
**GET** `/api/v1/orders/:id`

Get detailed information about a specific order.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ORD-1234567890-000001",
    "clientOrderId": "my-order-123",
    "pair": "ETH/USDC",
    "side": "BUY",
    "type": "LIMIT",
    "status": "PARTIALLY_FILLED",
    "price": 2000.50,
    "quantity": 1.5,
    "filledQuantity": 0.75,
    "remainingQuantity": 0.75,
    "averagePrice": 2000.50,
    "timeInForce": "GTC",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:01:00.000Z",
    "trades": [
      {
        "id": "trade-123",
        "price": 2000.50,
        "quantity": 0.75,
        "fee": 0.0015,
        "timestamp": "2024-01-01T00:01:00.000Z",
        "side": "BUY",
        "liquidity": "TAKER"
      }
    ],
    "metadata": {}
  }
}
```

#### Update Order
**PATCH** `/api/v1/orders/:id`

Update limited fields of an order (currently only clientOrderId).

**Request Body:**
```json
{
  "clientOrderId": "new-order-id"
}
```

#### Cancel Order
**DELETE** `/api/v1/orders/:id/cancel`

Cancel an open order.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ORD-1234567890-000001",
    "status": "CANCELLED",
    "cancelledAt": "2024-01-01T00:02:00.000Z",
    "filledQuantity": 0.75,
    "remainingQuantity": 0.75
  }
}
```

### 2. Order Book

#### Get Order Book
**GET** `/api/v1/orderbook/:pair`

Get order book snapshot for a trading pair.

**Query Parameters:**
- `depth`: Number of price levels (default: 20, max: 100)

**Response:**
```json
{
  "success": true,
  "data": {
    "pair": "ETH/USDC",
    "bids": [
      { "price": 2000.00, "quantity": 5.5, "orderCount": 3 },
      { "price": 1999.50, "quantity": 10.2, "orderCount": 5 }
    ],
    "asks": [
      { "price": 2001.00, "quantity": 4.8, "orderCount": 2 },
      { "price": 2001.50, "quantity": 8.0, "orderCount": 4 }
    ],
    "spread": 1.00,
    "midPrice": 2000.50,
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Get Market Depth
**GET** `/api/v1/orderbook/:pair/depth`

Get aggregated market depth with cumulative quantities.

**Query Parameters:**
- `levels`: Number of depth levels (default: 10, max: 50)
- `aggregate`: Aggregate by price levels (default: false)

**Response:**
```json
{
  "success": true,
  "data": {
    "pair": "ETH/USDC",
    "bids": {
      "levels": [
        {
          "price": 2000.00,
          "quantity": 5.5,
          "cumulativeQuantity": 5.5,
          "orderCount": 3,
          "cumulativeOrderCount": 3
        }
      ],
      "totalVolume": 55.7,
      "totalOrders": 15
    },
    "asks": {
      "levels": [...],
      "totalVolume": 48.2,
      "totalOrders": 12
    },
    "metrics": {
      "bestBid": 2000.00,
      "bestAsk": 2001.00,
      "spread": 1.00,
      "spreadPercent": 0.05,
      "midPrice": 2000.50,
      "imbalance": 0.0728
    },
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### WebSocket Order Book Stream
**WS** `/api/ws/v1/orderbook/:pair`

Real-time order book updates via WebSocket.

**Subscription Message:**
```json
{
  "action": "subscribe",
  "pair": "ETH/USDC"
}
```

**Snapshot Message:**
```json
{
  "type": "snapshot",
  "pair": "ETH/USDC",
  "sequence": 1234567890,
  "data": {
    "bids": [[2000.00, 5.5], [1999.50, 10.2]],
    "asks": [[2001.00, 4.8], [2001.50, 8.0]],
    "timestamp": 1234567890000
  }
}
```

**Update Message:**
```json
{
  "type": "update",
  "pair": "ETH/USDC",
  "sequence": 1234567891,
  "data": {
    "bids": [[2000.50, 3.2]],
    "asks": [[2001.00, 0]],
    "timestamp": 1234567891000
  }
}
```

### 3. Trading

#### Get Recent Trades
**GET** `/api/v1/trades`

Get recent trades across all pairs or for a specific pair.

**Query Parameters:**
- `pair`: Filter by trading pair
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "trade-123",
      "pair": "ETH/USDC",
      "price": 2000.50,
      "quantity": 0.75,
      "value": 1500.375,
      "timestamp": "2024-01-01T00:01:00.000Z",
      "takerSide": "BUY",
      "maker": {
        "orderId": "ORD-1234567890-000001",
        "fee": 0.00075
      },
      "taker": {
        "orderId": "ORD-1234567890-000002",
        "fee": 0.0015
      }
    }
  ],
  "pagination": {...}
}
```

#### Get Trade History
**GET** `/api/v1/trades/history`

Get historical trades with advanced filtering.

**Query Parameters:**
- `pair`: Filter by trading pair
- `side`: Filter by taker side (BUY, SELL)
- `from`: Start date (ISO 8601)
- `to`: End date (ISO 8601)
- `minPrice`: Minimum price
- `maxPrice`: Maximum price
- `minQuantity`: Minimum quantity
- `userOnly`: Only user's trades (requires auth)
- `page`: Page number
- `limit`: Items per page

**Response includes statistics:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {...},
  "statistics": {
    "volumeTotal": 150000.50,
    "tradesCount": 75,
    "avgPrice": 2000.67,
    "minPrice": 1995.00,
    "maxPrice": 2005.00
  }
}
```

#### Estimate Trade Execution
**POST** `/api/v1/trades/estimate`

Estimate the execution of a trade without placing an order.

**Request Body:**
```json
{
  "pair": "ETH/USDC",
  "side": "BUY",
  "quantity": 10,
  "type": "MARKET",
  "price": 2005.00
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "pair": "ETH/USDC",
    "side": "BUY",
    "quantity": 10,
    "type": "MARKET",
    "canExecute": true,
    "reason": "Full execution possible",
    "estimate": {
      "filledQuantity": 10,
      "remainingQuantity": 0,
      "averagePrice": 2001.25,
      "totalCost": 20012.50,
      "estimatedFee": 40.025,
      "netCost": 20052.525,
      "fills": [
        { "price": 2001.00, "quantity": 4.8, "value": 9604.80 },
        { "price": 2001.50, "quantity": 5.2, "value": 10407.80 }
      ],
      "slippage": {
        "absolute": 0.50,
        "percentage": 0.025
      },
      "priceImpact": {
        "firstPrice": 2001.00,
        "lastPrice": 2001.50,
        "percentage": 0.025
      }
    }
  }
}
```

### 4. Settlement

#### List Settlement Epochs
**GET** `/api/v1/settlements/epochs`

Get list of settlement epochs.

**Query Parameters:**
- `status`: Filter by status (PENDING, ACTIVE, FINALIZED, SETTLED)
- `from`: Start date (ISO 8601)
- `to`: End date (ISO 8601)
- `page`: Page number
- `limit`: Items per page

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "EPOCH-1234",
      "epochNumber": 1234,
      "status": "SETTLED",
      "startTime": "2024-01-01T00:00:00.000Z",
      "endTime": "2024-01-01T01:00:00.000Z",
      "duration": 3600000,
      "statistics": {
        "totalTrades": 523,
        "totalVolume": 1250000.50
      },
      "merkleRoot": "0x1234...",
      "timestamps": {
        "finalizedAt": "2024-01-01T01:05:00.000Z",
        "settledAt": "2024-01-01T01:10:00.000Z"
      },
      "settlementTxHash": "0xabcd..."
    }
  ],
  "pagination": {...},
  "currentEpoch": {
    "epochNumber": 1235,
    "startTime": "2024-01-01T01:00:00.000Z",
    "endTime": "2024-01-01T02:00:00.000Z",
    "timeRemaining": 1800000
  }
}
```

#### Get Settlement Details
**GET** `/api/v1/settlements/:id`

Get detailed information about a specific settlement.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "SETTLEMENT-123",
    "epochId": "EPOCH-1234",
    "epochNumber": 1234,
    "status": "SETTLED",
    "userId": "0x1234...",
    "totalTrades": 15,
    "totalVolume": 25000.50,
    "netAmount": 24950.00,
    "merkleRoot": "0xabcd...",
    "merkleProof": ["0x1234...", "0x5678...", "0x9abc..."],
    "epoch": {
      "number": 1234,
      "startTime": "2024-01-01T00:00:00.000Z",
      "endTime": "2024-01-01T01:00:00.000Z",
      "status": "SETTLED",
      "merkleRoot": "0xroot..."
    },
    "trades": [
      {
        "id": "trade-123",
        "pair": "ETH/USDC",
        "side": "BUY",
        "price": 2000.50,
        "quantity": 1.5,
        "value": 3000.75,
        "timestamp": "2024-01-01T00:30:00.000Z",
        "includedInMerkle": true
      }
    ],
    "createdAt": "2024-01-01T01:00:00.000Z",
    "settledAt": "2024-01-01T01:10:00.000Z",
    "claimedAt": null,
    "settlementTxHash": "0xtx...",
    "claimTxHash": null
  }
}
```

#### Get Merkle Proof
**GET** `/api/v1/settlements/:id/proof`

Get Merkle proof for settlement verification.

**Query Parameters:**
- `tradeId`: Get proof for specific trade

**Response (Full Tree):**
```json
{
  "success": true,
  "data": {
    "settlementId": "SETTLEMENT-123",
    "merkleRoot": "0xroot...",
    "totalTrades": 15,
    "tree": {
      "leaves": [
        {
          "index": 0,
          "hash": "0xleaf1...",
          "tradeId": "trade-123"
        }
      ],
      "depth": 4
    },
    "settlementData": {...},
    "verificationInstructions": {
      "description": "To verify a specific trade, add ?tradeId=<id> to the URL",
      "example": "/api/v1/settlements/SETTLEMENT-123/proof?tradeId=trade-123"
    }
  }
}
```

**Response (Trade Proof):**
```json
{
  "success": true,
  "data": {
    "settlementId": "SETTLEMENT-123",
    "tradeId": "trade-123",
    "trade": {...},
    "proof": {
      "valid": true,
      "merkleRoot": "0xroot...",
      "computedRoot": "0xroot...",
      "leafHash": "0xleaf...",
      "pathElements": [
        { "position": "right", "hash": "0x..." },
        { "position": "left", "hash": "0x..." }
      ],
      "leafIndex": 3,
      "totalLeaves": 15
    }
  }
}
```

#### Claim Settlement
**POST** `/api/v1/settlements/:id/claim`

Claim settlement funds (future implementation).

### 5. Account

#### Get Account Balances
**GET** `/api/v1/account/balances`

Get account token balances including locked amounts.

**Query Parameters:**
- `includeZero`: Include zero balances (default: false)
- `includeNative`: Include native ETH (default: true)

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "0x1234...",
    "balances": [
      {
        "token": {
          "address": "0xA0b8...",
          "symbol": "USDC",
          "decimals": 6,
          "isNative": false
        },
        "balance": {
          "total": "10000.50",
          "totalWei": "10000500000",
          "available": "9500.50",
          "locked": "500.00"
        },
        "allowance": {
          "amount": "Unlimited",
          "amountWei": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
          "isUnlimited": true
        },
        "lastUpdated": "2024-01-01T00:00:00.000Z"
      }
    ],
    "summary": {
      "totalAssets": 5,
      "totalValueUSD": "25000.50",
      "openOrders": 3,
      "lastUpdated": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

#### Get Open Positions
**GET** `/api/v1/account/positions`

Get open positions and exposure across trading pairs.

**Query Parameters:**
- `pair`: Filter by trading pair
- `includeHistory`: Include pairs with no position (default: false)

**Response:**
```json
{
  "success": true,
  "data": {
    "positions": [
      {
        "pair": "ETH/USDC",
        "side": "LONG",
        "quantity": 5.5,
        "averageEntryPrice": 1998.50,
        "currentPrice": 2005.00,
        "marketValue": 11027.50,
        "unrealizedPnL": 35.75,
        "realizedPnL": 125.50,
        "totalPnL": 161.25,
        "profitPercent": 1.47,
        "openOrders": {
          "buy": 2,
          "sell": 1,
          "totalVolume": 15000.00
        },
        "volume": {
          "buy": 50000.00,
          "sell": 25000.00,
          "total": 75000.00
        },
        "trades": {
          "total": 25,
          "buy": 15,
          "sell": 10
        }
      }
    ],
    "summary": {
      "totalPositions": 3,
      "totalMarketValue": 25000.00,
      "totalUnrealizedPnL": 150.25,
      "totalRealizedPnL": 325.50,
      "totalPnL": 475.75,
      "totalOpenOrders": 8,
      "totalVolume24h": 150000.00
    },
    "lastUpdated": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Get P&L Data
**GET** `/api/v1/account/pnl`

Get profit and loss data with time series.

**Query Parameters:**
- `period`: Time period (1h, 24h, 7d, 30d, all) (default: 24h)
- `pair`: Filter by trading pair
- `groupBy`: Time grouping (hour, day, week, month) (default: hour)

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "period": "24h",
      "startTime": "2024-01-01T00:00:00.000Z",
      "endTime": "2024-01-02T00:00:00.000Z",
      "totalRealizedPnL": 325.50,
      "totalUnrealizedPnL": 150.25,
      "totalPnL": 475.75,
      "totalFees": 45.50,
      "totalVolume": 150000.00,
      "totalTrades": 75,
      "profitablePairs": 2,
      "unprofitablePairs": 1,
      "bestPair": {
        "pair": "ETH/USDC",
        "totalPnL": 350.00
      },
      "worstPair": {
        "pair": "WBTC/USDT",
        "totalPnL": -25.50
      }
    },
    "timeSeries": [
      {
        "time": "2024-01-01T00:00:00.000Z",
        "timestamp": "2024-01-01T00:00:00.000Z",
        "realizedPnL": 25.50,
        "fees": 2.50,
        "volume": 5000.00,
        "netPnL": 23.00,
        "cumulativePnL": 23.00
      }
    ],
    "pairBreakdown": [
      {
        "pair": "ETH/USDC",
        "realizedPnL": 275.50,
        "unrealizedPnL": 74.50,
        "totalPnL": 350.00,
        "fees": 35.00,
        "volume": 100000.00,
        "tradesCount": 50,
        "avgTradeSize": 2000.00
      }
    ],
    "recentTrades": [...]
  }
}
```

## WebSocket Connections

### Order Book Stream
```javascript
const socket = io('wss://api.example.com', {
  path: '/api/ws/v1/orderbook'
});

// Subscribe to order book
socket.emit('subscribe', { pair: 'ETH/USDC' });

// Listen for updates
socket.on('snapshot', (data) => {
  console.log('Order book snapshot:', data);
});

socket.on('update', (data) => {
  console.log('Order book update:', data);
});

// Subscribe to trades
socket.emit('subscribe-trades', { pair: 'ETH/USDC' });

socket.on('trade', (data) => {
  console.log('New trade:', data);
});
```

## Example Usage

### Python
```python
import requests

# Create order
response = requests.post(
    'https://api.example.com/api/v1/orders',
    headers={'Authorization': 'Bearer <token>'},
    json={
        'pair': 'ETH/USDC',
        'side': 'BUY',
        'type': 'LIMIT',
        'quantity': 1.5,
        'price': 2000.50
    }
)

order = response.json()['data']
print(f"Order created: {order['id']}")
```

### JavaScript
```javascript
// Get order book
const response = await fetch('https://api.example.com/api/v1/orderbook/ETH/USDC');
const { data } = await response.json();

console.log(`Best bid: ${data.bids[0].price}`);
console.log(`Best ask: ${data.asks[0].price}`);
console.log(`Spread: ${data.spread}`);
```

### cURL
```bash
# Get account balances
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/v1/account/balances

# Cancel order
curl -X DELETE -H "Authorization: Bearer <token>" \
  https://api.example.com/api/v1/orders/ORD-1234567890-000001/cancel
```

## Best Practices

1. **Rate Limiting**: Implement exponential backoff when receiving 429 errors
2. **WebSocket**: Use WebSocket for real-time data instead of polling
3. **Pagination**: Always use pagination for large data sets
4. **Error Handling**: Check error codes and implement proper retry logic
5. **Time Sync**: Ensure your system clock is synchronized (NTP)

## Changelog

### v1.0.0 (2024-01-01)
- Initial API release
- Order management endpoints
- Order book and trading endpoints
- Settlement system endpoints
- Account management endpoints
- WebSocket support for real-time data