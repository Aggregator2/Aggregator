# Order History API Documentation

## Overview

The Order History API provides comprehensive access to trading order history with advanced filtering, pagination, P&L calculations, and summary statistics. It uses cursor-based pagination for optimal performance with large datasets.

## Endpoint

```
GET /api/orders/history
```

## Authentication

The API requires authentication via one of the following methods:
- JWT Bearer token in Authorization header
- Session cookie
- X-User-Id header (development only)

## Request Parameters

All parameters are optional and passed as query parameters.

### Pagination Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | null | Cursor for pagination. Use `cursor.next` from previous response |
| `limit` | number | 50 | Number of results per page (max: 100) |

### Filter Parameters

| Parameter | Type | Format | Description |
|-----------|------|--------|-------------|
| `dateFrom` | string | ISO 8601 | Start date for order filtering (inclusive) |
| `dateTo` | string | ISO 8601 | End date for order filtering (inclusive) |
| `pair` | string | "BASE/QUOTE" | Trading pair (e.g., "ETH/USDT") |
| `status` | string or array | See below | Order status filter, can be single value or array |
| `side` | string | "BUY" or "SELL" | Order side filter |

### Sorting Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sortBy` | string | "timestamp" | Field to sort by: "timestamp", "pnl", "volume", "price", "filledQuantity" |
| `sortOrder` | string | "desc" | Sort direction: "asc" or "desc" |

### Valid Status Values

- `PENDING` - Order submitted but not yet in order book
- `OPEN` - Order in order book, not filled
- `PARTIALLY_FILLED` - Order partially executed
- `FILLED` - Order completely executed
- `CANCELLED` - Order cancelled by user or system
- `EXPIRED` - Order expired (time-based orders)
- `FAILED` - Order failed validation or execution

## Request Examples

### Basic Request
```bash
curl -X GET "https://api.example.com/api/orders/history" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### With Filters
```bash
curl -X GET "https://api.example.com/api/orders/history?pair=ETH/USDT&status=FILLED&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### With Date Range
```bash
curl -X GET "https://api.example.com/api/orders/history?dateFrom=2024-01-01T00:00:00Z&dateTo=2024-01-31T23:59:59Z" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### With Multiple Status Filters
```bash
curl -X GET "https://api.example.com/api/orders/history?status[]=FILLED&status[]=PARTIALLY_FILLED&sortBy=volume" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### With Pagination
```bash
curl -X GET "https://api.example.com/api/orders/history?cursor=eyJ0IjoiMjAyNC0wMS0xNVQxMDozMDowMFoiLCJpZCI6Im9yZGVyXzEyMyIsInYiOiIxMDAwMCJ9" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Response Format

### Success Response (200 OK)

```json
{
  "cursor": {
    "next": "eyJ0IjoiMjAyNC0wMS0xNVQxMDozMDowMFoiLCJpZCI6Im9yZGVyXzEyMyIsInYiOiIxMDAwMCJ9",
    "previous": "eyJ0IjoiMjAyNC0wMS0xNlQwOTowMDowMFoiLCJpZCI6Im9yZGVyXzQ1NiIsInYiOiIyMDAwMCJ9",
    "hasMore": true
  },
  "orders": [
    {
      "id": "order_789",
      "userId": "user_123",
      "pair": "ETH/USDT",
      "side": "BUY",
      "type": "LIMIT",
      "status": "FILLED",
      "price": "2000.00",
      "quantity": "1.5",
      "filledQuantity": "1.5",
      "remainingQuantity": "0",
      "averagePrice": "1998.50",
      
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:35:00Z",
      "lastFilledAt": "2024-01-15T10:35:00Z",
      "cancelledAt": null,
      
      "trades": [
        {
          "id": "trade_001",
          "orderId": "order_789",
          "tradeId": "12345",
          "price": "1998.00",
          "quantity": "1.0",
          "fee": "1.998",
          "feeToken": "USDT",
          "timestamp": "2024-01-15T10:32:00Z",
          "counterpartyOrderId": "order_xyz",
          "liquidityType": "TAKER"
        },
        {
          "id": "trade_002",
          "orderId": "order_789",
          "tradeId": "12346",
          "price": "1999.50",
          "quantity": "0.5",
          "fee": "0.999",
          "feeToken": "USDT",
          "timestamp": "2024-01-15T10:35:00Z",
          "counterpartyOrderId": "order_abc",
          "liquidityType": "TAKER"
        }
      ],
      "tradesCount": 2,
      
      "totalVolume": "2997.75",
      "totalFees": "2.997",
      "realizedPnL": "45.23",
      "unrealizedPnL": "0",
      "pnlPercentage": "1.51",
      
      "clientOrderId": "client_order_123",
      "metadata": {
        "strategy": "DCA",
        "source": "web"
      }
    }
  ],
  "summary": {
    "totalVolume": "150000.00",
    "totalVolumeUSD": "150000.00",
    "volumeByPair": {
      "ETH/USDT": "100000.00",
      "BTC/USDT": "50000.00"
    },
    
    "totalTrades": 234,
    "totalOrders": 89,
    "completedOrders": 67,
    "cancelledOrders": 12,
    
    "winRate": "65.67",
    "totalRealizedPnL": "3456.78",
    "totalUnrealizedPnL": "234.56",
    "totalFees": "456.78",
    "netPnL": "3234.56",
    
    "averageTradeSize": "641.03",
    "averageOrderSize": "1685.39",
    "averageWinAmount": "78.45",
    "averageLossAmount": "34.23",
    "profitFactor": "2.29",
    
    "ordersToday": 5,
    "ordersThisWeek": 23,
    "ordersThisMonth": 89,
    
    "mostTradedPair": "ETH/USDT",
    "pairDistribution": [
      {
        "pair": "ETH/USDT",
        "orderCount": 56,
        "volume": "100000.00",
        "percentage": "66.67"
      },
      {
        "pair": "BTC/USDT",
        "orderCount": 33,
        "volume": "50000.00",
        "percentage": "33.33"
      }
    ]
  },
  "prices": {
    "ETH/USDT": {
      "pair": "ETH/USDT",
      "currentPrice": "2050.00",
      "price24hAgo": "2000.00",
      "priceChange24h": "50.00",
      "priceChangePercent24h": "2.50"
    },
    "BTC/USDT": {
      "pair": "BTC/USDT",
      "currentPrice": "42000.00",
      "price24hAgo": "41000.00",
      "priceChange24h": "1000.00",
      "priceChangePercent24h": "2.44"
    }
  },
  "requestId": "req_1705315800000_abc123xyz",
  "timestamp": "2024-01-15T11:30:00Z",
  "executionTime": 145
}
```

### Error Responses

#### 400 Bad Request
```json
{
  "error": "Invalid cursor",
  "code": "INVALID_CURSOR",
  "details": {
    "cursor": "invalid_cursor_string"
  }
}
```

#### 401 Unauthorized
```json
{
  "error": "Authentication required",
  "code": "UNAUTHORIZED"
}
```

#### 429 Too Many Requests
```json
{
  "error": "Too many requests",
  "code": "RATE_LIMITED",
  "retryAfter": 60
}
```

#### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "code": "INTERNAL_ERROR"
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `INVALID_CURSOR` | Cursor format is invalid or corrupted |
| `INVALID_DATE` | Date format is invalid |
| `INVALID_PAIR` | Trading pair format is invalid |
| `INVALID_STATUS` | Order status value is invalid |
| `UNAUTHORIZED` | Authentication is required |
| `RATE_LIMITED` | Rate limit exceeded |
| `INTERNAL_ERROR` | Server error occurred |

## Rate Limiting

- Rate limit: 100 requests per minute per user
- Rate limit window: 60 seconds
- Headers returned:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Requests remaining
  - `X-RateLimit-Reset`: Unix timestamp when limit resets

## Performance Considerations

### Cursor-Based Pagination
- Cursors encode the last item's sort value and ID
- More efficient than offset-based pagination for large datasets
- Stable pagination even with concurrent data modifications

### Query Optimization
- Indexes on: userId, pair, status, createdAt, and compound indexes
- P&L calculations are done in-memory for performance
- Summary statistics use database aggregations where possible

### Best Practices
1. Use specific date ranges to limit result sets
2. Request only the fields you need (future: field selection)
3. Cache results on client side with provided cache headers
4. Use cursor pagination for large result sets

## P&L Calculation Method

### For Buy Orders
```
Cost Basis = (FilledQuantity × AveragePrice) + TotalFees
Current Value = FilledQuantity × CurrentPrice
P&L = Current Value - Cost Basis
P&L % = (P&L / Cost Basis) × 100
```

### For Sell Orders
```
Sale Proceeds = FilledQuantity × AveragePrice
Current Cost = FilledQuantity × CurrentPrice
P&L = Sale Proceeds - Current Cost - TotalFees
P&L % = (P&L / Current Cost) × 100
```

### Notes
- Realized P&L: For completely filled orders
- Unrealized P&L: For open or partially filled positions
- FIFO method used for cross-order P&L calculations
- All fees are subtracted from P&L

## WebSocket Real-Time Updates

For real-time order updates, connect to the WebSocket endpoint:

```javascript
const ws = new WebSocket('wss://api.example.com/ws');

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'orders',
    userId: 'user_123'
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  if (message.type === 'order_update') {
    // Handle order update
    console.log('Order updated:', message.order);
  }
});
```

## SDK Examples

### JavaScript/TypeScript
```typescript
import { OrderHistoryClient } from '@example/trading-sdk';

const client = new OrderHistoryClient({
  apiKey: 'YOUR_API_KEY',
  baseUrl: 'https://api.example.com'
});

// Basic usage
const history = await client.getOrderHistory({
  pair: 'ETH/USDT',
  status: ['FILLED', 'PARTIALLY_FILLED'],
  limit: 50
});

// With pagination
let cursor = null;
do {
  const page = await client.getOrderHistory({ cursor });
  processOrders(page.orders);
  cursor = page.cursor.next;
} while (cursor && hasMore);
```

### Python
```python
from trading_sdk import OrderHistoryClient

client = OrderHistoryClient(
    api_key="YOUR_API_KEY",
    base_url="https://api.example.com"
)

# Basic usage
history = client.get_order_history(
    pair="ETH/USDT",
    status=["FILLED", "PARTIALLY_FILLED"],
    limit=50
)

# With date range
from datetime import datetime, timedelta

history = client.get_order_history(
    date_from=datetime.now() - timedelta(days=30),
    date_to=datetime.now(),
    sort_by="volume",
    sort_order="desc"
)
```

## Change Log

### Version 1.0.0 (2024-01-15)
- Initial release with cursor-based pagination
- P&L calculation with FIFO method
- Comprehensive filtering and sorting
- Summary statistics
- Real-time price integration