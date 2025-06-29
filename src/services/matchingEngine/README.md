# Order Matching Engine

A high-performance order matching engine implementation with support for limit and market orders, various time-in-force options, and real-time order book management.

## Features

- **Order Types**: Limit and Market orders
- **Time in Force**: GTC (Good Till Cancelled), IOC (Immediate or Cancel), FOK (Fill or Kill), DAY
- **Price-Time Priority**: FIFO matching at each price level
- **Partial Fills**: Support for partial order execution
- **Real-time Updates**: Event-driven architecture with order book updates
- **Fee Calculation**: Configurable maker/taker fee rates
- **Trade Reporting**: Detailed execution reports for all trades

## Usage

```typescript
import { MatchingEngine, MatchingEngineConfig } from './matchingEngine';

// Configure the matching engine
const config: MatchingEngineConfig = {
  maxOrderBookDepth: 100,
  minOrderSize: { 'ETH/USDC': 0.01 },
  maxOrderSize: { 'ETH/USDC': 1000 },
  tickSize: { 'ETH/USDC': 0.01 },
  makerFeeRate: 0.001, // 0.1%
  takerFeeRate: 0.002, // 0.2%
  enableStopOrders: false,
  enableIcebergOrders: false,
};

// Create matching engine instance
const matchingEngine = new MatchingEngine(config);

// Initialize trading pair
matchingEngine.initializePair('ETH/USDC');

// Submit a limit order
const order = await matchingEngine.submitOrder({
  userId: 'user123',
  pair: 'ETH/USDC',
  side: OrderSide.BUY,
  type: OrderType.LIMIT,
  price: 2000,
  quantity: 1,
  timeInForce: TimeInForce.GTC,
});

// Cancel an order
await matchingEngine.cancelOrder(order.orderId, 'user123');

// Get order book snapshot
const orderBook = matchingEngine.getOrderBook('ETH/USDC', 50);

// Get user orders
const userOrders = matchingEngine.getUserOrders('user123');

// Get recent trades
const trades = matchingEngine.getRecentTrades('ETH/USDC', 100);
```

## Events

The matching engine emits the following events:

- `orderSubmitted`: When a new order is submitted
- `orderAdded`: When an order is added to the order book
- `orderFilled`: When an order is completely filled
- `orderCancelled`: When an order is cancelled
- `executionReport`: For every order execution
- `marketDataUpdate`: When market data is updated

```typescript
matchingEngine.on('executionReport', (report: ExecutionReport) => {
  console.log('Order executed:', report);
});

matchingEngine.on('marketDataUpdate', (data: MarketData) => {
  console.log('Market update:', data);
});
```

## Architecture

### OrderBook
- Maintains bid and ask levels with price-time priority
- Efficient order matching with O(log n) complexity for price levels
- Supports order book snapshots and depth queries

### MatchingEngine
- Core order processing and matching logic
- Event-driven architecture for real-time updates
- Trade execution and fee calculation
- Order lifecycle management

## Testing

Run the test suite:

```bash
npm test src/services/matchingEngine/__tests__/MatchingEngine.test.ts
```

## Performance Considerations

- Price levels are stored in sorted maps for efficient access
- Orders at each level maintain FIFO ordering
- Order index allows O(1) order lookups
- Minimal object creation during matching to reduce GC pressure