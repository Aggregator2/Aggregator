# SwappiQ Protocol - Client SDKs Documentation

## 🚀 Overview

The SwappiQ Protocol provides comprehensive, production-ready client SDKs in **TypeScript**, **Python**, and **Go** for seamless integration with the decentralized exchange platform. Each SDK is designed with enterprise-grade features including automatic retry logic, request signing, WebSocket reconnection, local order validation, and comprehensive error handling.

## 📋 Table of Contents

1. [Quick Start](#-quick-start)
2. [TypeScript SDK](#-typescript-sdk)
3. [Python SDK](#-python-sdk)
4. [Go SDK](#-go-sdk)
5. [Common Features](#-common-features)
6. [Examples](#-examples)
7. [Advanced Configuration](#-advanced-configuration)
8. [Security Best Practices](#-security-best-practices)
9. [Troubleshooting](#-troubleshooting)

---

## 🔥 Quick Start

### Installation

**TypeScript/JavaScript:**
```bash
npm install @swappiq/sdk
# or
yarn add @swappiq/sdk
```

**Python:**
```bash
pip install swappiq-sdk
```

**Go:**
```bash
go get github.com/swappiq/go-sdk
```

### Basic Usage

**TypeScript:**
```typescript
import SwappiQClient from '@swappiq/sdk';

const client = new SwappiQClient({
  apiUrl: 'https://api.swappiq.com',
  auth: {
    apiKey: 'your-api-key',
    apiSecret: 'your-api-secret'
  }
});

await client.initialize();
const orderBook = await client.getOrderBook('ETH-USDT');
```

**Python:**
```python
from swappiq_sdk import SwappiQClient

client = SwappiQClient({
    'api_url': 'https://api.swappiq.com',
    'auth': {
        'api_key': 'your-api-key',
        'api_secret': 'your-api-secret'
    }
})

await client.initialize()
order_book = await client.get_order_book('ETH-USDT')
```

**Go:**
```go
import "github.com/swappiq/go-sdk"

client, err := swappiq.NewClient(swappiq.Config{
    APIURL: "https://api.swappiq.com",
    Auth: &swappiq.AuthCredentials{
        APIKey:    "your-api-key",
        APISecret: "your-api-secret",
    },
})

orderBook, err := client.GetOrderBook(ctx, "ETH-USDT", 20)
```

---

## 🟦 TypeScript SDK

### Features
- ✅ **Full TypeScript types** - Complete type safety with comprehensive interfaces
- ✅ **Automatic retry with backoff** - Exponential backoff with jitter
- ✅ **Request signing** - HMAC-SHA256 authentication
- ✅ **WebSocket reconnection** - Automatic reconnection with exponential backoff
- ✅ **Local order validation** - Client-side validation before submission
- ✅ **Rate limiting** - Token bucket with priority queues
- ✅ **Comprehensive error handling** - Typed errors with detailed information

### Installation & Setup

```bash
npm install @swappiq/sdk ws
```

### Configuration

```typescript
import SwappiQClient, { SDKConfig, Network } from '@swappiq/sdk';

const config: SDKConfig = {
  apiUrl: 'https://api.swappiq.com',
  wsUrl: 'wss://ws.swappiq.com',
  auth: {
    apiKey: process.env.SWAPPIQ_API_KEY!,
    apiSecret: process.env.SWAPPIQ_API_SECRET!,
    environment: 'production'
  },
  network: Network.ETHEREUM,
  timeout: 30000,
  retryConfig: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
    jitter: true,
    retryableErrors: ['ECONNRESET', 'TIMEOUT', 'RATE_LIMITED']
  },
  rateLimitConfig: {
    requestsPerSecond: 10,
    burstSize: 20,
    queueSize: 100
  },
  debug: false
};

const client = new SwappiQClient(config);
```

### Trading Operations

```typescript
// Create a limit order
const orderRequest: CreateOrderRequest = {
  tradingPair: 'ETH-USDT',
  side: OrderSide.BUY,
  type: OrderType.LIMIT,
  quantity: '1.0',
  price: '3000.00',
  timeInForce: TimeInForce.GTC
};

// Validate order locally first
const validation = await client.validateOrder(orderRequest);
if (!validation.balanceSufficient) {
  throw new Error('Insufficient balance');
}

// Submit order
const response = await client.createOrder(orderRequest);
console.log('Order created:', response.order?.id);

// Cancel order
await client.cancelOrder(response.order!.id);

// Get order history
const orderHistory = await client.getOrderHistory({
  tradingPair: 'ETH-USDT',
  status: [OrderStatus.FILLED, OrderStatus.CANCELLED],
  limit: 50
});
```

### Market Data

```typescript
// Get order book
const orderBook = await client.getOrderBook('ETH-USDT', 20);
console.log('Best bid:', orderBook.bids[0]);
console.log('Best ask:', orderBook.asks[0]);

// Get market statistics
const marketStats = await client.getMarketStats('ETH-USDT');
console.log('24h volume:', marketStats[0].volume24h.value);

// Get candlestick data
const candles = await client.getCandles({
  tradingPair: 'ETH-USDT',
  interval: '1h',
  limit: 100
});
```

### WebSocket Streaming

```typescript
// Subscribe to real-time order book updates
await client.subscribeToOrderBook('ETH-USDT');
client.onOrderBookUpdate((orderBook: OrderBook) => {
  console.log('Order book updated:', orderBook.sequence);
});

// Subscribe to trades
await client.subscribeToTrades('ETH-USDT');
client.onTradeUpdate((trade: Trade) => {
  console.log('New trade:', trade.price.value, 'at', trade.quantity.value);
});

// Subscribe to user events (requires authentication)
await client.subscribeToUserEvents();
client.onUserEvent((event: UserEvent) => {
  if (isOrderEvent(event)) {
    console.log('Order event:', event.type, event.order.id);
  } else if (isTradeEvent(event)) {
    console.log('Trade executed:', event.trade.id);
  }
});
```

### Error Handling

```typescript
try {
  const order = await client.createOrder(orderRequest);
} catch (error) {
  if (error instanceof ApiError) {
    console.error('API Error:', error.code, error.message);
    if (error.retryable) {
      // Retry the operation
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

---

## 🐍 Python SDK

### Features
- ✅ **Type hints** - Full type annotations with dataclasses
- ✅ **Async/await support** - Built on asyncio and aiohttp
- ✅ **Automatic retry with backoff** - Configurable retry strategies
- ✅ **Request signing** - HMAC-SHA256 with timestamp validation
- ✅ **WebSocket reconnection** - Resilient WebSocket connections
- ✅ **Local order validation** - Comprehensive validation logic
- ✅ **Rate limiting** - Token bucket with priority queues

### Installation & Setup

```bash
pip install swappiq-sdk aiohttp websockets
```

### Configuration

```python
from swappiq_sdk import SwappiQClient, SDKConfig, AuthCredentials, Network
import asyncio
import os

config = SDKConfig(
    api_url='https://api.swappiq.com',
    ws_url='wss://ws.swappiq.com',
    auth=AuthCredentials(
        api_key=os.getenv('SWAPPIQ_API_KEY'),
        api_secret=os.getenv('SWAPPIQ_API_SECRET'),
        environment='production'
    ),
    network=Network.ETHEREUM,
    timeout=30.0,
    retry_config=RetryConfig(
        max_attempts=3,
        base_delay=1.0,
        max_delay=10.0,
        backoff_factor=2.0,
        jitter=True,
        retryable_errors=['ECONNRESET', 'TIMEOUT', 'RATE_LIMITED']
    ),
    rate_limit_config=RateLimitConfig(
        requests_per_second=10,
        burst_size=20,
        queue_size=100
    ),
    debug=False
)

client = SwappiQClient(config)
```

### Trading Operations

```python
async def trading_example():
    async with client:
        await client.initialize()
        
        # Create order request
        order_request = CreateOrderRequest(
            trading_pair='ETH-USDT',
            side=OrderSide.BUY,
            type=OrderType.LIMIT,
            quantity='1.0',
            price='3000.00',
            time_in_force=TimeInForce.GTC
        )
        
        # Validate order
        validation = await client.validate_order(order_request)
        if not validation.balance_sufficient:
            raise ValueError('Insufficient balance')
        
        # Submit order
        response = await client.create_order(order_request)
        print(f'Order created: {response.order.id}')
        
        # Get balances
        balances = await client.get_balances()
        for balance in balances:
            print(f'{balance.token.value}: {balance.available.value}')

# Run the example
asyncio.run(trading_example())
```

### Market Data

```python
async def market_data_example():
    async with client:
        # Get order book
        order_book = await client.get_order_book('ETH-USDT', depth=20)
        print(f'Best bid: {order_book.bids[0].price.value}')
        print(f'Best ask: {order_book.asks[0].price.value}')
        
        # Get market statistics
        market_stats = await client.get_market_stats('ETH-USDT')
        print(f'24h volume: {market_stats[0].volume_24h.value}')
        
        # Get trading pairs
        trading_pairs = await client.get_trading_pairs()
        for pair in trading_pairs:
            print(f'{pair.symbol}: {pair.status}')

asyncio.run(market_data_example())
```

### WebSocket Streaming

```python
async def websocket_example():
    async with client:
        await client.initialize()
        
        # Subscribe to order book updates
        await client.subscribe_to_order_book('ETH-USDT')
        
        # Subscribe to trades
        await client.subscribe_to_trades('ETH-USDT')
        
        # Subscribe to user events
        await client.subscribe_to_user_events()
        
        # Handle events
        async for event in client.stream_events():
            if event.type == 'order_book_update':
                print(f'Order book updated: {event.data.sequence}')
            elif event.type == 'trade':
                print(f'New trade: {event.data.price.value}')
            elif event.type == 'user_order':
                print(f'Order event: {event.data.order.id}')

asyncio.run(websocket_example())
```

### Error Handling

```python
from swappiq_sdk.exceptions import APIError, ValidationError, TimeoutError

async def error_handling_example():
    try:
        async with client:
            order = await client.create_order(order_request)
    except APIError as e:
        print(f'API Error [{e.code}]: {e.message}')
        if e.retryable:
            # Implement retry logic
            pass
    except ValidationError as e:
        print(f'Validation Error: {e.message}')
    except TimeoutError as e:
        print(f'Timeout Error: {e.message}')

asyncio.run(error_handling_example())
```

---

## 🐹 Go SDK

### Features
- ✅ **Strong typing** - Comprehensive struct definitions
- ✅ **Context support** - Full context.Context integration
- ✅ **Automatic retry with backoff** - Configurable retry mechanisms
- ✅ **Request signing** - HMAC-SHA256 authentication
- ✅ **WebSocket reconnection** - Gorilla WebSocket with reconnection
- ✅ **Local order validation** - Client-side validation
- ✅ **Concurrent safety** - Thread-safe operations

### Installation & Setup

```bash
go mod init your-project
go get github.com/swappiq/go-sdk
```

### Configuration

```go
package main

import (
    "context"
    "os"
    "time"
    
    "github.com/swappiq/go-sdk"
)

func main() {
    config := swappiq.SDKConfig{
        APIURL: "https://api.swappiq.com",
        WSURL:  stringPtr("wss://ws.swappiq.com"),
        Auth: &swappiq.AuthCredentials{
            APIKey:      os.Getenv("SWAPPIQ_API_KEY"),
            APISecret:   os.Getenv("SWAPPIQ_API_SECRET"),
            Environment: "production",
        },
        Network: swappiq.NetworkEthereum,
        Timeout: 30 * time.Second,
        RetryConfig: swappiq.RetryConfig{
            MaxAttempts:     3,
            BaseDelay:       1 * time.Second,
            MaxDelay:        10 * time.Second,
            BackoffFactor:   2.0,
            Jitter:          true,
            RetryableErrors: []string{"ECONNRESET", "TIMEOUT", "RATE_LIMITED"},
        },
        RateLimitConfig: &swappiq.RateLimitConfig{
            RequestsPerSecond: 10,
            BurstSize:         20,
            QueueSize:         100,
        },
        Debug: false,
    }
    
    client, err := swappiq.NewClient(config)
    if err != nil {
        panic(err)
    }
    defer client.Close()
}

func stringPtr(s string) *string {
    return &s
}
```

### Trading Operations

```go
func tradingExample(client *swappiq.Client) error {
    ctx := context.Background()
    
    // Initialize client
    if err := client.Initialize(ctx); err != nil {
        return err
    }
    
    // Create order request
    orderRequest := swappiq.CreateOrderRequest{
        TradingPair: "ETH-USDT",
        Side:        swappiq.OrderSideBuy,
        Type:        swappiq.OrderTypeLimit,
        Quantity:    "1.0",
        Price:       stringPtr("3000.00"),
        TimeInForce: &swappiq.TimeInForceGTC,
    }
    
    // Validate order
    validation, err := client.ValidateOrder(ctx, orderRequest)
    if err != nil {
        return err
    }
    if !validation.BalanceSufficient {
        return errors.New("insufficient balance")
    }
    
    // Submit order
    response, err := client.CreateOrder(ctx, orderRequest)
    if err != nil {
        return err
    }
    
    fmt.Printf("Order created: %s\n", response.Order.ID)
    
    // Cancel order
    _, err = client.CancelOrder(ctx, response.Order.ID)
    if err != nil {
        return err
    }
    
    // Get order history
    orderHistory, err := client.GetOrderHistory(ctx, swappiq.OrderHistoryParams{
        TradingPair: stringPtr("ETH-USDT"),
        Status:      []swappiq.OrderStatus{swappiq.OrderStatusFilled, swappiq.OrderStatusCancelled},
        PaginationParams: swappiq.PaginationParams{
            Limit: intPtr(50),
        },
    })
    if err != nil {
        return err
    }
    
    fmt.Printf("Found %d orders\n", len(orderHistory.Items))
    return nil
}
```

### Market Data

```go
func marketDataExample(client *swappiq.Client) error {
    ctx := context.Background()
    
    // Get order book
    orderBook, err := client.GetOrderBook(ctx, "ETH-USDT", 20)
    if err != nil {
        return err
    }
    
    if len(orderBook.Bids) > 0 && len(orderBook.Asks) > 0 {
        fmt.Printf("Best bid: %s\n", orderBook.Bids[0].Price.Value)
        fmt.Printf("Best ask: %s\n", orderBook.Asks[0].Price.Value)
    }
    
    // Get market statistics
    marketStats, err := client.GetMarketStats(ctx, "ETH-USDT")
    if err != nil {
        return err
    }
    
    if len(marketStats) > 0 {
        fmt.Printf("24h volume: %s\n", marketStats[0].Volume24h.Value)
    }
    
    // Get candlestick data
    candles, err := client.GetCandles(ctx, swappiq.CandleParams{
        TradingPair: "ETH-USDT",
        Interval:    "1h",
        Limit:       intPtr(100),
    })
    if err != nil {
        return err
    }
    
    fmt.Printf("Retrieved %d candles\n", len(candles))
    return nil
}
```

### WebSocket Streaming

```go
func websocketExample(client *swappiq.Client) error {
    ctx := context.Background()
    
    // Initialize WebSocket connection
    if err := client.ConnectWebSocket(ctx); err != nil {
        return err
    }
    defer client.DisconnectWebSocket()
    
    // Subscribe to order book updates
    if err := client.SubscribeToOrderBook(ctx, []string{"ETH-USDT"}); err != nil {
        return err
    }
    
    // Subscribe to trades
    if err := client.SubscribeToTrades(ctx, []string{"ETH-USDT"}); err != nil {
        return err
    }
    
    // Subscribe to user events
    if err := client.SubscribeToUserEvents(ctx); err != nil {
        return err
    }
    
    // Handle events
    eventChan := client.GetEventChannel()
    for {
        select {
        case event := <-eventChan:
            switch event.Type {
            case "order_book_update":
                var orderBook swappiq.OrderBook
                if err := json.Unmarshal(event.Data, &orderBook); err == nil {
                    fmt.Printf("Order book updated: %d\n", orderBook.Sequence)
                }
            case "trade":
                var trade swappiq.Trade
                if err := json.Unmarshal(event.Data, &trade); err == nil {
                    fmt.Printf("New trade: %s at %s\n", trade.Price.Value, trade.Quantity.Value)
                }
            case "user_order":
                var orderEvent swappiq.OrderEvent
                if err := json.Unmarshal(event.Data, &orderEvent); err == nil {
                    fmt.Printf("Order event: %s - %s\n", orderEvent.Type, orderEvent.Order.ID)
                }
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

### Error Handling

```go
func errorHandlingExample(client *swappiq.Client) {
    ctx := context.Background()
    
    orderRequest := swappiq.CreateOrderRequest{
        TradingPair: "ETH-USDT",
        Side:        swappiq.OrderSideBuy,
        Type:        swappiq.OrderTypeLimit,
        Quantity:    "1.0",
        Price:       stringPtr("3000.00"),
    }
    
    response, err := client.CreateOrder(ctx, orderRequest)
    if err != nil {
        switch e := err.(type) {
        case *swappiq.APIError:
            fmt.Printf("API Error [%s]: %s\n", e.Code, e.Message)
            if e.Retryable {
                // Implement retry logic
            }
        case *swappiq.ValidationError:
            fmt.Printf("Validation Error: %s\n", e.Message)
        case *swappiq.TimeoutError:
            fmt.Printf("Timeout Error: %s\n", e.Message)
        default:
            fmt.Printf("Unexpected error: %v\n", err)
        }
        return
    }
    
    fmt.Printf("Order created successfully: %s\n", response.Order.ID)
}
```

---

## 🛠️ Common Features

### 1. Automatic Retry with Exponential Backoff

All SDKs implement intelligent retry mechanisms:

- **Exponential backoff** with jitter to prevent thundering herd
- **Configurable retry attempts** and delays
- **Smart error detection** - only retries retryable errors
- **Circuit breaker patterns** to prevent cascading failures

### 2. Request Signing & Authentication

Secure HMAC-SHA256 request signing:

- **Timestamp-based signatures** prevent replay attacks
- **Nonce support** for additional security
- **Automatic header injection** with signed requests
- **Configurable signing algorithms**

### 3. WebSocket Reconnection Logic

Robust WebSocket connections:

- **Automatic reconnection** with exponential backoff
- **Connection health monitoring** with ping/pong
- **Subscription persistence** across reconnections
- **Message queuing** during disconnections

### 4. Local Order Validation

Client-side validation before submission:

- **Balance verification** against cached balances
- **Trading pair validation** against active pairs
- **Price and quantity validation** against pair rules
- **Risk limit checks** for order size and value

### 5. Rate Limiting

Advanced rate limiting mechanisms:

- **Token bucket algorithm** with burst support
- **Priority queues** for different request types
- **Adaptive rate limiting** based on server responses
- **Fair queuing** to prevent starvation

### 6. Comprehensive Error Handling

Structured error handling:

- **Typed errors** with error codes and messages
- **Retry indicators** for transient failures
- **Detailed error context** for debugging
- **Graceful degradation** strategies

---

## 📚 Examples

### Complete Trading Bot Example

See the comprehensive trading bot examples in each SDK:

- **TypeScript**: `/sdk/typescript/examples/trading-bot-example.ts`
- **Python**: `/sdk/python/examples/trading_bot_example.py`
- **Go**: `/sdk/go/examples/trading_example.go`

### Market Making Bot

```typescript
// TypeScript Market Making Example
class MarketMakingBot {
  constructor(private client: SwappiQClient) {}
  
  async run() {
    await this.client.subscribeToOrderBook('ETH-USDT');
    
    this.client.onOrderBookUpdate(async (orderBook) => {
      const bestBid = orderBook.bids[0];
      const bestAsk = orderBook.asks[0];
      const spread = parseFloat(bestAsk.price.value) - parseFloat(bestBid.price.value);
      
      if (spread > 0.01) { // Only place orders if spread > 1%
        await this.placeMakerOrders(bestBid, bestAsk);
      }
    });
  }
  
  private async placeMakerOrders(bestBid: OrderBookLevel, bestAsk: OrderBookLevel) {
    const bidPrice = (parseFloat(bestBid.price.value) + 0.01).toString();
    const askPrice = (parseFloat(bestAsk.price.value) - 0.01).toString();
    
    // Place buy order
    await this.client.createOrder({
      tradingPair: 'ETH-USDT',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: '0.1',
      price: bidPrice
    });
    
    // Place sell order
    await this.client.createOrder({
      tradingPair: 'ETH-USDT',
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity: '0.1',
      price: askPrice
    });
  }
}
```

### Portfolio Tracker

```python
# Python Portfolio Tracking Example
class PortfolioTracker:
    def __init__(self, client: SwappiQClient):
        self.client = client
        self.portfolio_value = Decimal('0')
    
    async def track_portfolio(self):
        await self.client.subscribe_to_user_events()
        
        async for event in self.client.stream_events():
            if event.type == 'balance_updated':
                await self.update_portfolio_value()
            elif event.type == 'trade_executed':
                await self.log_trade(event.data)
    
    async def update_portfolio_value(self):
        balances = await self.client.get_balances()
        total_value = Decimal('0')
        
        for balance in balances:
            if balance.usd_value:
                total_value += Decimal(balance.usd_value.value)
        
        self.portfolio_value = total_value
        print(f'Portfolio value: ${total_value}')
    
    async def log_trade(self, trade: UserTrade):
        print(f'Trade executed: {trade.side.value} {trade.quantity.value} '
              f'{trade.trading_pair} at ${trade.price.value}')
```

---

## ⚙️ Advanced Configuration

### Environment-Specific Configurations

**Production:**
```typescript
const productionConfig: SDKConfig = {
  apiUrl: 'https://api.swappiq.com',
  wsUrl: 'wss://ws.swappiq.com',
  timeout: 30000,
  retryConfig: {
    maxAttempts: 5,
    baseDelay: 2000,
    maxDelay: 30000,
    backoffFactor: 2,
    jitter: true
  },
  rateLimitConfig: {
    requestsPerSecond: 20,
    burstSize: 50,
    queueSize: 200
  }
};
```

**Development:**
```typescript
const developmentConfig: SDKConfig = {
  apiUrl: 'https://api-sandbox.swappiq.com',
  wsUrl: 'wss://ws-sandbox.swappiq.com',
  timeout: 10000,
  debug: true,
  retryConfig: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 5000
  }
};
```

### Custom Retry Strategies

```python
# Python custom retry configuration
custom_retry_config = RetryConfig(
    max_attempts=5,
    base_delay=1.0,
    max_delay=30.0,
    backoff_factor=1.5,
    jitter=True,
    retryable_errors=[
        'ECONNRESET',
        'TIMEOUT',
        'RATE_LIMITED',
        'INTERNAL_SERVER_ERROR'
    ]
)
```

### Advanced Rate Limiting

```go
// Go adaptive rate limiting
adaptiveConfig := swappiq.RateLimitConfig{
    RequestsPerSecond:    10,
    BurstSize:           20,
    QueueSize:           100,
    AdaptiveEnabled:     true,
    MaxRequestsPerSecond: 50,
    MinRequestsPerSecond: 5,
    AdaptationFactor:    0.1,
}
```

---

## 🔐 Security Best Practices

### 1. API Key Management

**Environment Variables:**
```bash
# .env file
SWAPPIQ_API_KEY=sk_1234567890abcdef...
SWAPPIQ_API_SECRET=abcdef1234567890...
SWAPPIQ_ENVIRONMENT=production
```

**Key Rotation:**
```typescript
// Implement key rotation
class SecureClient {
  private client: SwappiQClient;
  
  async rotateKeys(newApiKey: string, newApiSecret: string) {
    // Create new client with new credentials
    const newClient = new SwappiQClient({
      ...this.config,
      auth: {
        apiKey: newApiKey,
        apiSecret: newApiSecret
      }
    });
    
    // Test new client
    await newClient.initialize();
    
    // Replace old client
    await this.client.shutdown();
    this.client = newClient;
  }
}
```

### 2. Request Signing Security

**Timestamp Validation:**
```python
# Prevent replay attacks with timestamp validation
signing_options = SigningOptions(
    timestamp_tolerance=30000,  # 30 seconds
    nonce=True,  # Use nonce for additional security
    include_headers=['content-type', 'x-timestamp']
)
```

**Signature Verification:**
```go
// Verify webhook signatures
func verifyWebhook(payload []byte, signature string, secret string) bool {
    return swappiq.VerifyWebhookSignature(
        string(payload),
        signature,
        secret,
        "sha256",
    )
}
```

### 3. WebSocket Security

**TLS Configuration:**
```typescript
const secureWSConfig: WebSocketConfig = {
  url: 'wss://ws.swappiq.com',
  auth: credentials,
  enableTLSVerification: true,
  certificatePinning: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10
};
```

### 4. Data Validation

**Input Sanitization:**
```python
def sanitize_trading_pair(pair: str) -> str:
    # Only allow alphanumeric characters and dashes
    import re
    if not re.match(r'^[A-Z0-9\-]+$', pair):
        raise ValueError('Invalid trading pair format')
    return pair

def validate_order_quantity(quantity: str) -> Decimal:
    try:
        value = Decimal(quantity)
        if value <= 0:
            raise ValueError('Quantity must be positive')
        if value > Decimal('1000000'):
            raise ValueError('Quantity too large')
        return value
    except InvalidOperation:
        raise ValueError('Invalid quantity format')
```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. Authentication Errors

**Problem:** `401 Unauthorized` responses
**Solution:**
```typescript
// Check API key format
if (!RequestSigner.validateApiKey(apiKey)) {
  throw new Error('Invalid API key format');
}

// Check timestamp skew
const serverTime = await client.getServerTime();
const localTime = Date.now();
const skew = Math.abs(serverTime - localTime);
if (skew > 30000) {
  console.warn(`Clock skew detected: ${skew}ms`);
}
```

#### 2. Rate Limiting

**Problem:** `429 Too Many Requests` errors
**Solution:**
```python
# Implement exponential backoff
async def handle_rate_limit(client, request_func, *args, **kwargs):
    max_retries = 5
    base_delay = 1.0
    
    for attempt in range(max_retries):
        try:
            return await request_func(*args, **kwargs)
        except APIError as e:
            if e.code == 'RATE_LIMITED' and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                await asyncio.sleep(delay)
                continue
            raise
```

#### 3. WebSocket Disconnections

**Problem:** Frequent WebSocket disconnections
**Solution:**
```go
// Implement robust reconnection logic
func (c *Client) handleWebSocketReconnection() {
    for {
        select {
        case <-c.wsReconnectChan:
            for attempt := 1; attempt <= c.config.MaxReconnectAttempts; attempt++ {
                if err := c.connectWebSocket(); err != nil {
                    delay := time.Duration(attempt*attempt) * time.Second
                    time.Sleep(delay)
                    continue
                }
                
                // Resubscribe to channels
                c.resubscribeChannels()
                break
            }
        case <-c.shutdownChan:
            return
        }
    }
}
```

#### 4. Order Validation Failures

**Problem:** Orders rejected due to validation errors
**Solution:**
```typescript
// Comprehensive pre-submission validation
async function validateOrderWithDetails(
  client: SwappiQClient,
  request: CreateOrderRequest
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Check trading pair
  const tradingPairs = await client.getTradingPairs();
  const pair = tradingPairs.find(p => p.symbol === request.tradingPair);
  if (!pair) {
    errors.push(`Trading pair ${request.tradingPair} not found`);
  } else if (pair.status !== 'active') {
    errors.push(`Trading pair ${request.tradingPair} is not active`);
  }
  
  // Check balance
  const balances = await client.getBalances();
  const requiredToken = request.side === OrderSide.BUY ? pair?.quoteToken : pair?.baseToken;
  const balance = balances.find(b => b.token.value === requiredToken?.address.value);
  
  if (!balance || parseFloat(balance.available.value) < calculateRequiredBalance(request, pair)) {
    errors.push('Insufficient balance');
  }
  
  // Check order size limits
  if (pair && parseFloat(request.quantity) < parseFloat(pair.minOrderSize.value)) {
    errors.push(`Order size below minimum: ${pair.minOrderSize.value}`);
  }
  
  return { valid: errors.length === 0, errors };
}
```

### Performance Optimization

#### 1. Connection Pooling

```python
# Optimize HTTP client performance
client_config = {
    'connector': aiohttp.TCPConnector(
        limit=100,
        limit_per_host=30,
        keepalive_timeout=30,
        enable_cleanup_closed=True
    ),
    'timeout': aiohttp.ClientTimeout(total=30)
}
```

#### 2. Batch Operations

```go
// Batch multiple requests for better performance
func (c *Client) BatchGetOrderBooks(ctx context.Context, pairs []string) (map[string]*OrderBook, error) {
    results := make(map[string]*OrderBook)
    errChan := make(chan error, len(pairs))
    resultChan := make(chan struct{pair string; orderBook *OrderBook}, len(pairs))
    
    // Execute requests concurrently
    for _, pair := range pairs {
        go func(tradingPair string) {
            orderBook, err := c.GetOrderBook(ctx, tradingPair, 20)
            if err != nil {
                errChan <- err
                return
            }
            resultChan <- struct{pair string; orderBook *OrderBook}{tradingPair, orderBook}
        }(pair)
    }
    
    // Collect results
    for i := 0; i < len(pairs); i++ {
        select {
        case result := <-resultChan:
            results[result.pair] = result.orderBook
        case err := <-errChan:
            return nil, err
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
    
    return results, nil
}
```

### Debugging

#### Enable Debug Mode

**TypeScript:**
```typescript
const client = new SwappiQClient({
  // ... other config
  debug: true
});

// Enable additional logging
client.on('httpRetry', (event) => {
  console.log('HTTP Retry:', event.attempt, event.delay);
});

client.on('wsReconnecting', (event) => {
  console.log('WebSocket Reconnecting:', event.attempt);
});
```

**Python:**
```python
import logging

# Enable debug logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger('swappiq_sdk')

# Monitor events
client.on('request_retry', lambda event: logger.debug(f'Retry: {event}'))
client.on('websocket_error', lambda event: logger.error(f'WS Error: {event}'))
```

**Go:**
```go
// Enable debug mode
config.Debug = true

// Add custom logging
client.SetLogger(func(level string, message string, fields map[string]interface{}) {
    log.Printf("[%s] %s: %+v", level, message, fields)
})
```

---

## 📞 Support

### Getting Help

1. **Documentation**: Check this comprehensive guide first
2. **Examples**: Review the example implementations in each SDK
3. **GitHub Issues**: Report bugs or request features
4. **Discord Community**: Join our developer community
5. **Email Support**: support@swappiq.com

### Contributing

We welcome contributions to improve the SDKs:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

### License

The SwappiQ Protocol SDKs are released under the MIT License.

---

**🎯 Ready to build the future of decentralized trading? Start with the SDK that fits your stack and join thousands of developers building on SwappiQ Protocol.**