# Offchain Protocol TypeScript SDK

Official TypeScript SDK for the Offchain Protocol API.

## Installation

```bash
npm install @offchain-protocol/sdk
# or
yarn add @offchain-protocol/sdk
```

## Quick Start

```typescript
import { OffchainClient, OrderSide, OrderType } from '@offchain-protocol/sdk';

// Initialize client
const client = new OffchainClient('your-api-key', {
  testnet: true, // Use testnet environment
  websocketUrl: 'wss://ws.testnet.offchain.finance'
});

// Connect to WebSocket (optional, for real-time updates)
await client.connect();

// Create a limit order
const order = await client.orders.create({
  pair: 'BTC/USDT',
  side: OrderSide.BUY,
  type: OrderType.LIMIT,
  quantity: '0.1',
  price: '45000'
});

console.log('Order created:', order.id);

// Subscribe to order updates
client.websocket.on('order:update', (updatedOrder) => {
  console.log('Order updated:', updatedOrder);
});
```

## Features

- **Complete API Coverage**: Orders, Order Book, Trades, Settlements
- **WebSocket Support**: Real-time streaming of market data and order updates
- **Type Safety**: Full TypeScript support with comprehensive type definitions
- **Automatic Request Signing**: Secure HMAC-SHA256 request signing
- **Rate Limit Handling**: Built-in rate limit tracking and retry logic
- **Error Handling**: Detailed error types for different failure scenarios

## API Reference

### Client Initialization

```typescript
const client = new OffchainClient(apiKey: string, options?: ClientOptions);
```

Options:
- `baseUrl`: API base URL (default: production URL)
- `testnet`: Use testnet environment (default: false)
- `timeout`: Request timeout in milliseconds (default: 30000)
- `retryAttempts`: Number of retry attempts (default: 3)
- `rateLimitRetry`: Auto-retry on rate limit (default: true)
- `websocketUrl`: WebSocket URL (default: production URL)

### Orders API

#### Create Order
```typescript
const order = await client.orders.create({
  pair: 'BTC/USDT',
  side: OrderSide.BUY,
  type: OrderType.LIMIT,
  quantity: '0.1',
  price: '45000',
  timeInForce: TimeInForce.GTC
});
```

#### Get Order
```typescript
const order = await client.orders.get('order-id');
```

#### List Orders
```typescript
const { data: orders, pagination } = await client.orders.list({
  pair: 'BTC/USDT',
  status: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
  limit: 50
});
```

#### Update Order
```typescript
const updatedOrder = await client.orders.update('order-id', {
  price: '46000',
  quantity: '0.2'
});
```

#### Cancel Order
```typescript
const cancelledOrder = await client.orders.cancel('order-id');
```

#### Cancel All Orders
```typescript
const result = await client.orders.cancelAll('BTC/USDT'); // optional pair filter
console.log(`Cancelled ${result.cancelled} orders`);
```

### Order Book API

#### Get Order Book
```typescript
const orderBook = await client.orderBook.get('BTC/USDT', 20); // depth

console.log('Best bid:', orderBook.bids[0]);
console.log('Best ask:', orderBook.asks[0]);
```

#### Get Best Prices
```typescript
const { bid, ask, spread, spreadPercent } = await client.orderBook.getBestPrices('BTC/USDT');
```

#### Calculate Slippage
```typescript
const slippage = await client.orderBook.calculateSlippage(
  'BTC/USDT',
  'buy',
  '1.5' // quantity
);

console.log('Average price:', slippage.averagePrice);
console.log('Slippage %:', slippage.slippagePercent);
```

### Trades API

#### Get Recent Trades
```typescript
const trades = await client.trades.getRecent('BTC/USDT', 100);
```

#### Get User Trades
```typescript
const { data: myTrades } = await client.trades.getUserTrades({
  pair: 'BTC/USDT',
  limit: 50
});
```

#### Calculate Fees
```typescript
const fees = await client.trades.calculateFees(
  'BTC/USDT',
  'buy',
  '0.1', // quantity
  '45000', // price
  'limit'
);
```

### Settlements API

#### List Settlements
```typescript
const { data: settlements } = await client.settlements.list({
  status: SettlementStatus.COMPLETED,
  currency: 'USDT'
});
```

#### Get Settlement Proof
```typescript
const proof = await client.settlements.getProof('settlement-id');

// Verify proof
const verification = await client.settlements.verifyProof(proof);
console.log('Proof valid:', verification.valid);
```

### WebSocket Streaming

#### Order Updates
```typescript
// Subscribe to order updates
client.websocket.subscribeOrders();

// Listen for events
client.websocket.on(WebSocketEvent.ORDER_UPDATE, (order) => {
  console.log('Order updated:', order);
});

client.websocket.on(WebSocketEvent.ORDER_FILLED, (order) => {
  console.log('Order filled:', order);
});
```

#### Market Data Streaming
```typescript
// Subscribe to multiple channels
client.websocket.subscribeOrderBook(['BTC/USDT', 'ETH/USDT']);
client.websocket.subscribeTrades(['BTC/USDT']);
client.websocket.subscribeTicker(['BTC/USDT']);

// Handle events
client.websocket.on(WebSocketEvent.ORDERBOOK_UPDATE, (update) => {
  console.log('Order book update:', update);
});

client.websocket.on(WebSocketEvent.TRADE, (trade) => {
  console.log('New trade:', trade);
});

client.websocket.on(WebSocketEvent.TICKER, (ticker) => {
  console.log('Ticker update:', ticker);
});
```

## Error Handling

The SDK provides specific error types for different scenarios:

```typescript
import { 
  AuthenticationError,
  RateLimitError,
  ValidationError,
  OrderNotFoundError 
} from '@offchain-protocol/sdk';

try {
  await client.orders.create(orderRequest);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log('Rate limited. Retry after:', error.retryAfter);
  } else if (error instanceof ValidationError) {
    console.log('Invalid order:', error.message);
  } else if (error instanceof AuthenticationError) {
    console.log('Authentication failed');
  }
}
```

## Rate Limiting

The SDK automatically tracks rate limit information:

```typescript
const rateLimitInfo = client.getRateLimitInfo();
if (rateLimitInfo) {
  console.log('Remaining requests:', rateLimitInfo.remaining);
  console.log('Reset time:', rateLimitInfo.reset);
}
```

## Examples

### Market Making Bot
```typescript
// Simple market making bot
async function marketMaker() {
  const pair = 'BTC/USDT';
  const spread = 0.001; // 0.1%
  
  // Subscribe to order book
  client.websocket.subscribeOrderBook([pair]);
  
  client.websocket.on(WebSocketEvent.ORDERBOOK_SNAPSHOT, async (orderBook) => {
    if (orderBook.pair !== pair) return;
    
    const bestBid = parseFloat(orderBook.bids[0]?.price || '0');
    const bestAsk = parseFloat(orderBook.asks[0]?.price || '0');
    
    if (bestBid && bestAsk) {
      const midPrice = (bestBid + bestAsk) / 2;
      const buyPrice = (midPrice * (1 - spread)).toFixed(2);
      const sellPrice = (midPrice * (1 + spread)).toFixed(2);
      
      // Cancel existing orders
      await client.orders.cancelAll(pair);
      
      // Place new orders
      await Promise.all([
        client.orders.create({
          pair,
          side: OrderSide.BUY,
          type: OrderType.LIMIT,
          quantity: '0.1',
          price: buyPrice
        }),
        client.orders.create({
          pair,
          side: OrderSide.SELL,
          type: OrderType.LIMIT,
          quantity: '0.1',
          price: sellPrice
        })
      ]);
    }
  });
}
```

### DCA (Dollar Cost Averaging) Bot
```typescript
async function dcaBot() {
  const pair = 'BTC/USDT';
  const amount = '100'; // $100 per order
  const interval = 60 * 60 * 1000; // 1 hour
  
  setInterval(async () => {
    try {
      // Get current market price
      const { ask } = await client.orderBook.getBestPrices(pair);
      
      if (ask) {
        const quantity = (parseFloat(amount) / parseFloat(ask.price)).toFixed(8);
        
        // Place market order
        await client.orders.create({
          pair,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          quantity
        });
        
        console.log(`DCA: Bought ${quantity} BTC at market price`);
      }
    } catch (error) {
      console.error('DCA error:', error);
    }
  }, interval);
}
```

## TypeScript Support

The SDK is written in TypeScript and provides comprehensive type definitions:

```typescript
import type { 
  Order, 
  Trade, 
  OrderBook,
  CreateOrderRequest,
  OrderFilter,
  WebSocketMessage
} from '@offchain-protocol/sdk';
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.