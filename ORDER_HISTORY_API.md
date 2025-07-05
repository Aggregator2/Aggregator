# Order History API Documentation

## Overview

The `/api/orders/history` endpoint provides paginated order history with P&L calculations, filtering options, and aggregate statistics.

## Endpoint

```
GET /api/orders/history
```

## Authentication

The endpoint requires authentication via JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

Alternatively, for testing, you can pass `userId` as a query parameter.

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number for pagination |
| `limit` | integer | 50 | Number of orders per page (max 100) |
| `dateFrom` | ISO date | null | Start date for filtering orders |
| `dateTo` | ISO date | null | End date for filtering orders |
| `pair` | string | null | Trading pair filter (e.g., "BTC/USD") |
| `status` | string | null | Order status filter (e.g., "filled", "cancelled", "open") |
| `includeSettlement` | boolean | true | Include settlement information |

## Response Structure

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": "order_123",
        "status": "filled",
        "pair": "BTC/USD",
        "side": "buy",
        "type": "limit",
        "price": "50000.00",
        "quantity": "0.5",
        "filledQuantity": "0.5",
        "remainingQuantity": "0",
        "avgExecutionPrice": "49950.00",
        "totalFees": "24.975",
        "realizedPnL": "250.00",
        "currentMarketPrice": "50500.00",
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:35:00.000Z",
        "userId": "user_456",
        "clientOrderId": "client_order_789",
        "timeInForce": "GTC",
        "trades": [
          {
            "tradeId": "trade_001",
            "price": "49950.00",
            "amount": "0.5",
            "fee": "24.975",
            "timestamp": "2024-01-15T10:35:00.000Z",
            "counterparty": "user_789"
          }
        ],
        "settlement": {
          "settlementId": "settlement_001",
          "status": "completed",
          "proof": "0x...",
          "settledAt": "2024-01-15T10:40:00.000Z"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 150,
      "totalPages": 3,
      "hasNext": true,
      "hasPrev": false
    },
    "statistics": {
      "totalOrders": 150,
      "filledOrders": 120,
      "cancelledOrders": 20,
      "totalTrades": 180,
      "totalVolume": "1250000.50",
      "totalFees": "625.25",
      "successRate": "80.00%",
      "periodPnL": "5250.75"
    },
    "filters": {
      "dateFrom": "2024-01-01T00:00:00.000Z",
      "dateTo": "2024-01-31T23:59:59.999Z",
      "pair": "BTC/USD",
      "status": null
    }
  }
}
```

## Field Descriptions

### Order Object

- **id**: Unique order identifier
- **status**: Current order status (open, filled, partially_filled, cancelled, etc.)
- **pair**: Trading pair
- **side**: Order side (buy/sell)
- **type**: Order type (limit, market, etc.)
- **price**: Order price (formatted to 8 decimal places)
- **quantity**: Original order quantity
- **filledQuantity**: Amount filled
- **remainingQuantity**: Amount remaining
- **avgExecutionPrice**: Average price of executed trades
- **totalFees**: Total fees paid
- **realizedPnL**: Calculated profit/loss based on current market price
- **currentMarketPrice**: Current market price used for P&L calculation
- **createdAt**: Order creation timestamp (ISO format)
- **updatedAt**: Last update timestamp (ISO format)
- **trades**: Array of executed trades for this order
- **settlement**: Settlement information (if includeSettlement=true)

### Trade Object

- **tradeId**: Unique trade identifier
- **price**: Execution price
- **amount**: Trade amount
- **fee**: Fee charged for this trade
- **timestamp**: Trade execution time
- **counterparty**: Trading counterparty ID

### Settlement Object

- **settlementId**: Unique settlement identifier
- **status**: Settlement status (pending, completed, failed)
- **proof**: Settlement proof hash
- **settledAt**: Settlement completion timestamp

### Statistics Object

- **totalOrders**: Total number of orders in the filtered period
- **filledOrders**: Number of completely filled orders
- **cancelledOrders**: Number of cancelled orders
- **totalTrades**: Total number of trades executed
- **totalVolume**: Total trading volume in base currency
- **totalFees**: Total fees paid
- **successRate**: Percentage of filled orders
- **periodPnL**: Total realized P&L for the period

## P&L Calculation

The realized P&L is calculated as follows:

- **For Buy Orders**: P&L = (Current Price - Execution Price) × Amount
- **For Sell Orders**: P&L = (Execution Price - Current Price) × Amount

## Example Requests

### Basic Request
```bash
curl -H "Authorization: Bearer <token>" \
  "https://api.example.com/api/orders/history"
```

### With Date Range Filter
```bash
curl -H "Authorization: Bearer <token>" \
  "https://api.example.com/api/orders/history?dateFrom=2024-01-01&dateTo=2024-01-31"
```

### Paginated Request with Filters
```bash
curl -H "Authorization: Bearer <token>" \
  "https://api.example.com/api/orders/history?page=2&limit=20&pair=BTC/USD&status=filled"
```

### Without Settlement Information
```bash
curl -H "Authorization: Bearer <token>" \
  "https://api.example.com/api/orders/history?includeSettlement=false"
```

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Authentication required"
}
```

### 405 Method Not Allowed
```json
{
  "error": "Method not allowed"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to fetch order history",
  "details": "Error message"
}
```

## Performance Considerations

1. **Pagination**: Always use pagination for large datasets. The default limit is 50, with a maximum of 100 per page.

2. **Date Filtering**: Use date ranges to limit the amount of data processed and improve response times.

3. **Settlement Data**: If you don't need settlement information, set `includeSettlement=false` to reduce database queries.

4. **Market Prices**: Current market prices are fetched from the order book mid-price or last trade price for P&L calculations.

## Notes

- All decimal values are formatted to 8 decimal places with trailing zeros removed
- Timestamps are in ISO 8601 format
- P&L calculations use the current market price at the time of the request
- The endpoint combines orders from both the matching engine (active orders) and settled orders storage