# SwappiQ Protocol Go SDK

Enterprise-grade Go SDK for the SwappiQ Protocol with comprehensive trading and market data APIs.

## Features

- 🔒 **Type-safe API client** with comprehensive error handling
- ⚡ **Automatic retry** with exponential backoff and jitter
- 🔐 **Request signing utilities** with HMAC-SHA256/SHA512 support
- 🔄 **WebSocket client** with automatic reconnection and heartbeat
- 🛡️ **Local order validation** with business logic and risk checks
- ⚖️ **Rate limiting** with priority queues and adaptive behavior
- 📊 **Real-time market data** with event-driven architecture
- 💰 **Trading operations** with comprehensive order management
- 📈 **Market data APIs** for order books, trades, and candlesticks
- 💳 **Account management** with balance and portfolio tracking
- 🎯 **Production-ready** with connection pooling and circuit breakers

## Installation

```bash
go mod init your-project
go get github.com/swappiq/sdk-go
```

## Quick Start

```go
package main

import (
    "context"
    "log"
    "time"

    swappiq "github.com/swappiq/sdk-go"
)

func main() {
    // Create SDK configuration
    config := swappiq.SDKConfig{
        APIURL:  "https://api.swappiq.com",
        WSURL:   stringPtr("wss://ws.swappiq.com"),
        Network: swappiq.NetworkEthereum,
        Auth: &swappiq.AuthCredentials{
            APIKey:      "your-api-key",
            APISecret:   "your-api-secret",
            Environment: "production",
        },
        Timeout: 30 * time.Second,
        RetryConfig: swappiq.RetryConfig{
            MaxAttempts:   3,
            BaseDelay:     1 * time.Second,
            MaxDelay:      10 * time.Second,
            BackoffFactor: 2.0,
            Jitter:        true,
        },
        RateLimitConfig: &swappiq.RateLimitConfig{
            RequestsPerSecond: 10,
            BurstSize:        20,
            QueueSize:        100,
        },
        Debug: false,
    }

    // Create client
    client, err := swappiq.NewClient(config)
    if err != nil {
        log.Fatalf("Failed to create client: %v", err)
    }

    // Connect
    ctx := context.Background()
    if err := client.Connect(ctx); err != nil {
        log.Fatalf("Failed to connect: %v", err)
    }
    defer client.Disconnect()

    // Get market data
    orderBook, err := client.GetOrderBook(ctx, "ETH-USDC")
    if err != nil {
        log.Fatalf("Failed to get order book: %v", err)
    }

    log.Printf("Best bid: %s, Best ask: %s",
        orderBook.GetBestBid().Price.Value,
        orderBook.GetBestAsk().Price.Value)
}

func stringPtr(s string) *string {
    return &s
}
```

## Configuration

### Basic Configuration

```go
config := swappiq.SDKConfig{
    APIURL:  "https://api.swappiq.com",
    WSURL:   stringPtr("wss://ws.swappiq.com"),
    Network: swappiq.NetworkEthereum,
    Timeout: 30 * time.Second,
    Debug:   false,
}
```

### Authentication

```go
config.Auth = &swappiq.AuthCredentials{
    APIKey:      "your-api-key",
    APISecret:   "your-api-secret",
    Passphrase:  stringPtr("your-passphrase"), // Optional
    Environment: "production", // or "sandbox"
}
```

### Retry Configuration

```go
config.RetryConfig = swappiq.RetryConfig{
    MaxAttempts:     5,
    BaseDelay:       500 * time.Millisecond,
    MaxDelay:        30 * time.Second,
    BackoffFactor:   2.0,
    Jitter:          true,
    RetryableErrors: []string{"ECONNRESET", "TIMEOUT", "RATE_LIMITED"},
}
```

### Rate Limiting

```go
config.RateLimitConfig = &swappiq.RateLimitConfig{
    RequestsPerSecond: 15,
    BurstSize:        30,
    QueueSize:        200,
}
```

## Market Data

### Get Trading Pairs

```go
pairs, err := client.GetTradingPairs(ctx)
if err != nil {
    log.Fatalf("Failed to get trading pairs: %v", err)
}

for _, pair := range pairs {
    log.Printf("Pair: %s (%s/%s)", 
        pair.Symbol, pair.BaseToken.Symbol, pair.QuoteToken.Symbol)
}
```

### Get Order Book

```go
orderBook, err := client.GetOrderBook(ctx, "ETH-USDC")
if err != nil {
    log.Fatalf("Failed to get order book: %v", err)
}

// Get best prices
bestBid := orderBook.GetBestBid()
bestAsk := orderBook.GetBestAsk()
spread := orderBook.GetSpread()

log.Printf("Bid: %s, Ask: %s, Spread: %s",
    bestBid.Price.Value, bestAsk.Price.Value, spread.Value)
```

### Get Market Statistics

```go
stats, err := client.GetMarketStats(ctx, "ETH-USDC")
if err != nil {
    log.Fatalf("Failed to get market stats: %v", err)
}

log.Printf("Last: %s, 24h Change: %s (%.2f%%)",
    stats.LastPrice.Value,
    stats.PriceChange24h.Value,
    stats.PriceChangePercent24h.GetFloat64())
```

### Get Candlestick Data

```go
candles, err := client.GetCandles(ctx, swappiq.CandleParams{
    TradingPair: "ETH-USDC",
    Interval:    "1h",
    Limit:       intPtr(24),
})
if err != nil {
    log.Fatalf("Failed to get candles: %v", err)
}

for _, candle := range candles {
    log.Printf("Time: %s, OHLCV: %s/%s/%s/%s/%s",
        candle.OpenTime.Format(time.RFC3339),
        candle.Open.Value, candle.High.Value, candle.Low.Value,
        candle.Close.Value, candle.Volume.Value)
}
```

## Trading

### Order Validation

```go
orderRequest := swappiq.CreateOrderRequest{
    TradingPair:   "ETH-USDC",
    Side:          swappiq.OrderSideBuy,
    Type:          swappiq.OrderTypeLimit,
    Quantity:      "0.1",
    Price:         stringPtr("2000.50"),
    TimeInForce:   swappiq.TimeInForceGTC,
    ClientOrderID: stringPtr("my-order-123"),
}

// Validate order locally
validation, err := client.ValidateOrder("user123", orderRequest)
if err != nil {
    log.Fatalf("Validation failed: %v", err)
}

if !validation.IsValid() {
    log.Printf("Order invalid: %v", validation.GetErrorMessages())
    return
}

log.Printf("Estimated fees: %v", validation.EstimatedFees)
```

### Create Order

```go
response, err := client.CreateOrder(ctx, "user123", orderRequest)
if err != nil {
    log.Fatalf("Failed to create order: %v", err)
}

if response.Success {
    log.Printf("Order created: %s", response.Order.ID)
} else {
    log.Printf("Order failed: %s", response.Error.Message)
}
```

### Cancel Order

```go
response, err := client.CancelOrder(ctx, "order-id")
if err != nil {
    log.Fatalf("Failed to cancel order: %v", err)
}

if response.Success {
    log.Println("Order cancelled successfully")
}
```

### Get Order History

```go
history, err := client.GetOrderHistory(ctx, swappiq.OrderHistoryParams{
    PaginationParams: swappiq.PaginationParams{
        Page:  intPtr(1),
        Limit: intPtr(50),
    },
    TradingPair: stringPtr("ETH-USDC"),
    Status: []swappiq.OrderStatus{
        swappiq.OrderStatusFilled,
        swappiq.OrderStatusCancelled,
    },
})
if err != nil {
    log.Fatalf("Failed to get order history: %v", err)
}

log.Printf("Total orders: %d", history.Total)
```

## Account Management

### Get Balances

```go
balances, err := client.GetBalances(ctx)
if err != nil {
    log.Fatalf("Failed to get balances: %v", err)
}

for _, balance := range balances {
    if balance.Total.GetFloat64() > 0 {
        log.Printf("Token: %s, Total: %s, Available: %s",
            balance.Token.Value,
            balance.Total.Value,
            balance.Available.Value)
    }
}
```

### Get Portfolio

```go
portfolio, err := client.GetPortfolio(ctx)
if err != nil {
    log.Fatalf("Failed to get portfolio: %v", err)
}

log.Printf("Total USD Value: %s", portfolio.TotalUSDValue.Value)
log.Printf("Network: %s", portfolio.Network)
```

## Real-time Data

### Event Handlers

```go
// Set up event handlers
client.On(swappiq.EventOrderUpdate, func(event swappiq.WebSocketEvent) {
    log.Printf("Order update: %+v", event.Data)
})

client.On(swappiq.EventTradeUpdate, func(event swappiq.WebSocketEvent) {
    log.Printf("Trade update: %+v", event.Data)
})

client.On(swappiq.EventOrderBookUpdate, func(event swappiq.WebSocketEvent) {
    log.Printf("Order book update received")
})
```

### Subscribe to Channels

```go
// Public market data
err := client.Subscribe(
    []string{"orderbook", "trades", "ticker"},
    []string{"ETH-USDC", "BTC-USDC"},
    false, // public channels
)
if err != nil {
    log.Fatalf("Failed to subscribe: %v", err)
}

// Private user data (requires authentication)
err = client.Subscribe(
    []string{"orders", "trades", "balances"},
    nil, // all trading pairs
    true, // private channels
)
if err != nil {
    log.Fatalf("Failed to subscribe to private channels: %v", err)
}
```

## Risk Management

### Set Risk Limits

```go
riskLimits := swappiq.RiskLimits{
    MaxOrderValue: &swappiq.DecimalAmount{Value: "50000", Decimals: 6}, // $50k max
    MinOrderValue: &swappiq.DecimalAmount{Value: "10", Decimals: 6},    // $10 min
    MaxPriceDeviation: 0.05, // 5% max deviation from market
    AllowedOrderTypes: []swappiq.OrderType{
        swappiq.OrderTypeLimit,
        swappiq.OrderTypeMarket,
    },
    RequireConfirmation: true,
    TradingHoursOnly:   false,
}
client.SetRiskLimits(riskLimits)
```

### Validation Rules

```go
rules := swappiq.ValidationRules{
    ValidateBalance:     true,
    ValidatePrice:       true,
    ValidateQuantity:    true,
    ValidateTradingPair: true,
    ValidateRiskLimits:  true,
    ValidateMarketHours: false,
    ValidateOrderSize:   true,
    ValidatePriceRange:  true,
}
client.SetValidationRules(rules)
```

## Error Handling

### API Errors

```go
response, err := client.GetOrderBook(ctx, "INVALID-PAIR")
if err != nil {
    if apiErr, ok := err.(*swappiq.APIError); ok {
        log.Printf("API Error - Code: %s, Message: %s, Retryable: %t",
            apiErr.Code, apiErr.Message, apiErr.Retryable)
    } else {
        log.Printf("Network error: %v", err)
    }
}
```

### Validation Errors

```go
validation, err := client.ValidateOrder("user123", orderRequest)
if err != nil {
    log.Fatalf("Validation error: %v", err)
}

if !validation.IsValid() {
    for _, err := range validation.Errors {
        log.Printf("Field: %s, Code: %s, Message: %s",
            err.Field, err.Code, err.Message)
    }
}
```

## Monitoring and Statistics

### Client Health

```go
// Check if client is healthy
if client.IsHealthy() {
    log.Println("Client is healthy")
} else {
    log.Println("Client has issues")
}

// Get detailed statistics
stats := client.GetStats()
log.Printf("Connected: %v", stats["connected"])

if httpStats, ok := stats["http_client"].(map[string]interface{}); ok {
    log.Printf("HTTP Success Rate: %.2f%%", 
        httpStats["success_rate"].(float64)*100)
    log.Printf("Avg Response Time: %.2f ms", 
        httpStats["average_response_time"])
}
```

### WebSocket Status

```go
if wsStats, ok := stats["websocket_client"].(map[string]interface{}); ok {
    log.Printf("WebSocket State: %v", wsStats["state"])
    log.Printf("Messages Sent: %v", wsStats["messages_sent"])
    log.Printf("Messages Received: %v", wsStats["messages_received"])
}
```

## Type Safety

### Decimal Amounts

```go
// Working with precise decimal amounts
amount := swappiq.DecimalAmount{Value: "123.456789", Decimals: 6}

// Convert to big.Int for calculations
bigIntValue := amount.GetBigInt()

// Convert to float64 (may lose precision)
floatValue := amount.GetFloat64()

log.Printf("Value: %s, BigInt: %s, Float: %f",
    amount.Value, bigIntValue.String(), floatValue)
```

### Order Types

```go
// Type-safe order creation
order := swappiq.CreateOrderRequest{
    TradingPair: "ETH-USDC",
    Side:        swappiq.OrderSideBuy,
    Type:        swappiq.OrderTypeLimit,
    Quantity:    "1.0",
    Price:       stringPtr("2000.00"),
    TimeInForce: swappiq.TimeInForceGTC,
}

// Type checking
if order.Side == swappiq.OrderSideBuy {
    log.Println("This is a buy order")
}
```

## Best Practices

### Connection Management

```go
// Always use context for timeouts
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

// Graceful shutdown
defer func() {
    if err := client.Disconnect(); err != nil {
        log.Printf("Error during disconnect: %v", err)
    }
}()
```

### Error Handling

```go
// Handle retryable errors
response, err := client.CreateOrder(ctx, userID, orderRequest)
if err != nil {
    if apiErr, ok := err.(*swappiq.APIError); ok && apiErr.Retryable {
        // Implement custom retry logic if needed
        time.Sleep(time.Second)
        response, err = client.CreateOrder(ctx, userID, orderRequest)
    }
}
```

### Rate Limiting

```go
// Use priority for important requests
importantRequest := swappiq.RequestOptions{
    Method:   "POST",
    Path:     "/api/v1/orders",
    Body:     orderRequest,
    Auth:     true,
    Priority: "high",
}
```

## Examples

See the `examples/` directory for comprehensive examples:

- `trading_example.go` - Complete trading workflow with real-time data
- More examples coming soon...

## Requirements

- Go 1.21 or later
- Valid SwappiQ API credentials
- Network access to SwappiQ APIs

## Dependencies

- `github.com/gorilla/websocket` - WebSocket client

## Support

- Documentation: [docs.swappiq.com](https://docs.swappiq.com)
- API Reference: [api.swappiq.com/docs](https://api.swappiq.com/docs)
- Issues: [GitHub Issues](https://github.com/swappiq/sdk-go/issues)

## License

MIT License - see LICENSE file for details.