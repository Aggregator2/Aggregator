# Matching Engine Integration

The simulated settlement in `/workspace/pages/api/submitOrder.js` has been replaced with actual order matching using the existing MatchingEngine. Here's what has been implemented:

## Overview

1. **Real Order Matching**: Orders are now matched against an actual order book instead of simulated settlement
2. **Trading Pairs**: Initialized with ETH/USDC, ETH/USDT, WBTC/USDC, and WBTC/USDT pairs
3. **Execution Reports**: Returns actual execution details including trades, filled quantities, and average prices

## API Endpoints

### Submit Order
- **POST** `/api/submitOrder`
- Converts DeFi order format to matching engine format
- Validates EIP-712 signatures
- Submits orders for real matching
- Returns execution reports with trade details

### Order Book
- **GET** `/api/orderbook/[pair]`
- Query params: `depth` (optional, default 50)
- Returns current order book snapshot and market data

### Recent Trades
- **GET** `/api/trades/[pair]`
- Query params: `limit` (optional, default 100)
- Returns recent trades for a trading pair

### User Orders
- **GET** `/api/orders/[userId]`
- Query params: `pair` (optional), `status` (optional)
- Returns orders for a specific user

### Cancel Order
- **POST** `/api/cancelOrder`
- Body: `{ orderId, userId }`
- Cancels an open order

### Seed Orders (Testing)
- **POST** `/api/seedOrders`
- Populates order books with test data
- Creates initial liquidity for testing

## Order Conversion

DeFi orders are converted to matching engine format:
- Sell ETH/WBTC for USDC/USDT → SELL order on ETH/USDC pair
- Sell USDC/USDT for ETH/WBTC → BUY order on ETH/USDC pair
- Price calculated from sell/buy amounts
- All orders are LIMIT orders with IOC (Immediate or Cancel) time-in-force

## Response Format

```json
{
  "status": "settled_offchain|partially_settled|open|cancelled",
  "message": "Order status description",
  "orderId": "ORD-1234567890-000001",
  "executionReport": {
    "status": "FILLED|PARTIALLY_FILLED|OPEN|CANCELLED",
    "filledQuantity": 0.5,
    "remainingQuantity": 0.5,
    "averagePrice": 2000.50,
    "trades": [{
      "id": "trade-id",
      "price": 2000.50,
      "quantity": 0.5,
      "timestamp": 1234567890,
      "fee": 0.001
    }]
  }
}
```

## Configuration

The matching engine is configured with:
- Maker fee: 0.1%
- Taker fee: 0.2%
- Min order sizes: 0.001 ETH, 0.00001 WBTC
- Max order sizes: 1000 ETH, 100 WBTC
- Tick size: $0.01 for all pairs

## Testing

1. Start the development server
2. Call POST `/api/seedOrders` to populate initial liquidity
3. Submit orders through `/api/submitOrder`
4. Check order books at `/api/orderbook/ETH/USDC`
5. View trades at `/api/trades/ETH/USDC`

The matching engine maintains persistent state during the server lifetime, enabling real order matching and price discovery.