// Trading example demonstrating SwappiQ Go SDK usage
// Author: SwappiQ Protocol
// Description: Comprehensive example showing trading operations and real-time data

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
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
			APIKey:      os.Getenv("SWAPPIQ_API_KEY"),
			APISecret:   os.Getenv("SWAPPIQ_API_SECRET"),
			Environment: "production",
		},
		Timeout: 30 * time.Second,
		RetryConfig: swappiq.RetryConfig{
			MaxAttempts:   3,
			BaseDelay:     1 * time.Second,
			MaxDelay:      10 * time.Second,
			BackoffFactor: 2.0,
			Jitter:        true,
			RetryableErrors: []string{
				"ECONNRESET", "TIMEOUT", "RATE_LIMITED",
			},
		},
		RateLimitConfig: &swappiq.RateLimitConfig{
			RequestsPerSecond: 10,
			BurstSize:        20,
			QueueSize:        100,
		},
		Debug: true,
	}

	// Create client
	client, err := swappiq.NewClient(config)
	if err != nil {
		log.Fatalf("Failed to create client: %v", err)
	}

	// Set up graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		fmt.Println("\nShutting down...")
		cancel()
	}()

	// Connect to SwappiQ
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer client.Disconnect()

	fmt.Println("✅ Connected to SwappiQ Protocol")

	// Set up event handlers
	setupEventHandlers(client)

	// Set up risk management
	setupRiskManagement(client)

	// Get trading pairs
	tradingPairs, err := client.GetTradingPairs(ctx)
	if err != nil {
		log.Fatalf("Failed to get trading pairs: %v", err)
	}

	fmt.Printf("📊 Available trading pairs: %d\n", len(tradingPairs))
	for i, pair := range tradingPairs {
		if i < 5 { // Show first 5
			fmt.Printf("  - %s (%s/%s)\n", pair.Symbol, pair.BaseToken.Symbol, pair.QuoteToken.Symbol)
		}
	}

	// Example 1: Get market data
	if err := demonstrateMarketData(ctx, client); err != nil {
		log.Printf("Market data example failed: %v", err)
	}

	// Example 2: Subscribe to real-time data
	if err := demonstrateRealtimeData(client); err != nil {
		log.Printf("Real-time data example failed: %v", err)
	}

	// Example 3: Account information
	if err := demonstrateAccountInfo(ctx, client); err != nil {
		log.Printf("Account info example failed: %v", err)
	}

	// Example 4: Order validation
	if err := demonstrateOrderValidation(client); err != nil {
		log.Printf("Order validation example failed: %v", err)
	}

	// Example 5: Trading operations (commented out for safety)
	// if err := demonstrateTrading(ctx, client); err != nil {
	//     log.Printf("Trading example failed: %v", err)
	// }

	// Example 6: Statistics and monitoring
	demonstrateMonitoring(client)

	// Keep running until shutdown signal
	fmt.Println("🚀 Examples completed. Press Ctrl+C to exit...")
	<-ctx.Done()
}

func setupEventHandlers(client *swappiq.Client) {
	// Order updates
	client.On(swappiq.EventOrderUpdate, func(event swappiq.WebSocketEvent) {
		fmt.Printf("📋 Order Update: %+v\n", event.Data)
	})

	// Trade updates
	client.On(swappiq.EventTradeUpdate, func(event swappiq.WebSocketEvent) {
		fmt.Printf("💰 Trade Update: %+v\n", event.Data)
	})

	// Balance updates
	client.On(swappiq.EventBalanceUpdate, func(event swappiq.WebSocketEvent) {
		fmt.Printf("💳 Balance Update: %+v\n", event.Data)
	})

	// Order book updates
	client.On(swappiq.EventOrderBookUpdate, func(event swappiq.WebSocketEvent) {
		fmt.Printf("📈 Order Book Update received\n")
	})

	// Ticker updates
	client.On(swappiq.EventTickerUpdate, func(event swappiq.WebSocketEvent) {
		fmt.Printf("🎯 Ticker Update: %+v\n", event.Data)
	})
}

func setupRiskManagement(client *swappiq.Client) {
	// Set risk limits
	riskLimits := swappiq.RiskLimits{
		MaxOrderValue: &swappiq.DecimalAmount{Value: "10000", Decimals: 6}, // $10,000 max
		MinOrderValue: &swappiq.DecimalAmount{Value: "10", Decimals: 6},    // $10 min
		MaxPriceDeviation: 0.05, // 5% max deviation from market price
		AllowedOrderTypes: []swappiq.OrderType{
			swappiq.OrderTypeLimit,
			swappiq.OrderTypeMarket,
		},
		RequireConfirmation: false,
		TradingHoursOnly:   false,
	}
	client.SetRiskLimits(riskLimits)

	// Set validation rules
	validationRules := swappiq.ValidationRules{
		ValidateBalance:     true,
		ValidatePrice:       true,
		ValidateQuantity:    true,
		ValidateTradingPair: true,
		ValidateRiskLimits:  true,
		ValidateMarketHours: false,
		ValidateOrderSize:   true,
		ValidatePriceRange:  true,
	}
	client.SetValidationRules(validationRules)

	fmt.Println("🛡️ Risk management configured")
}

func demonstrateMarketData(ctx context.Context, client *swappiq.Client) error {
	fmt.Println("\n📊 === Market Data Example ===")

	tradingPair := "ETH-USDC"

	// Get order book
	orderBook, err := client.GetOrderBook(ctx, tradingPair)
	if err != nil {
		return fmt.Errorf("get order book: %w", err)
	}

	fmt.Printf("Order Book for %s:\n", tradingPair)
	fmt.Printf("  Best Bid: %s (qty: %s)\n", 
		orderBook.GetBestBid().Price.Value,
		orderBook.GetBestBid().Quantity.Value)
	fmt.Printf("  Best Ask: %s (qty: %s)\n", 
		orderBook.GetBestAsk().Price.Value,
		orderBook.GetBestAsk().Quantity.Value)

	// Get market stats
	stats, err := client.GetMarketStats(ctx, tradingPair)
	if err != nil {
		return fmt.Errorf("get market stats: %w", err)
	}

	fmt.Printf("Market Stats for %s:\n", tradingPair)
	fmt.Printf("  Last Price: %s\n", stats.LastPrice.Value)
	fmt.Printf("  24h Change: %s (%.2f%%)\n", 
		stats.PriceChange24h.Value,
		stats.PriceChangePercent24h.GetFloat64())
	fmt.Printf("  24h Volume: %s\n", stats.Volume24h.Value)

	// Get candlestick data
	candles, err := client.GetCandles(ctx, swappiq.CandleParams{
		TradingPair: tradingPair,
		Interval:    "1h",
		Limit:       intPtr(24), // Last 24 hours
	})
	if err != nil {
		return fmt.Errorf("get candles: %w", err)
	}

	fmt.Printf("Last 24h Candles: %d candles\n", len(candles))
	if len(candles) > 0 {
		latest := candles[len(candles)-1]
		fmt.Printf("  Latest: O:%s H:%s L:%s C:%s V:%s\n",
			latest.Open.Value, latest.High.Value, latest.Low.Value,
			latest.Close.Value, latest.Volume.Value)
	}

	return nil
}

func demonstrateRealtimeData(client *swappiq.Client) error {
	fmt.Println("\n🔄 === Real-time Data Example ===")

	// Subscribe to public channels
	publicChannels := []string{"orderbook", "trades", "ticker"}
	tradingPairs := []string{"ETH-USDC", "BTC-USDC"}

	if err := client.Subscribe(publicChannels, tradingPairs, false); err != nil {
		return fmt.Errorf("subscribe to public channels: %w", err)
	}

	fmt.Printf("✅ Subscribed to channels: %v for pairs: %v\n", publicChannels, tradingPairs)

	// Subscribe to private channels (requires authentication)
	privateChannels := []string{"orders", "trades", "balances"}
	if err := client.Subscribe(privateChannels, nil, true); err != nil {
		return fmt.Errorf("subscribe to private channels: %w", err)
	}

	fmt.Printf("✅ Subscribed to private channels: %v\n", privateChannels)

	return nil
}

func demonstrateAccountInfo(ctx context.Context, client *swappiq.Client) error {
	fmt.Println("\n💳 === Account Information Example ===")

	// Get portfolio
	portfolio, err := client.GetPortfolio(ctx)
	if err != nil {
		return fmt.Errorf("get portfolio: %w", err)
	}

	fmt.Printf("Portfolio Summary:\n")
	fmt.Printf("  Total USD Value: %s\n", portfolio.TotalUSDValue.Value)
	fmt.Printf("  Network: %s\n", portfolio.Network)
	fmt.Printf("  Balances: %d tokens\n", len(portfolio.Balances))

	// Show top balances
	for i, balance := range portfolio.Balances {
		if i < 5 && balance.Total.GetFloat64() > 0 { // Show first 5 non-zero balances
			fmt.Printf("    %s: %s (available: %s, locked: %s)\n",
				balance.Token.Value,
				balance.Total.Value,
				balance.Available.Value,
				balance.Locked.Value)
		}
	}

	return nil
}

func demonstrateOrderValidation(client *swappiq.Client) error {
	fmt.Println("\n✅ === Order Validation Example ===")

	userID := "user123"

	// Example order request
	orderRequest := swappiq.CreateOrderRequest{
		TradingPair:   "ETH-USDC",
		Side:          swappiq.OrderSideBuy,
		Type:          swappiq.OrderTypeLimit,
		Quantity:      "0.1",
		Price:         stringPtr("2000.50"),
		TimeInForce:   swappiq.TimeInForceGTC,
		ClientOrderID: stringPtr("client-order-123"),
	}

	// Validate order
	validation, err := client.ValidateOrder(userID, orderRequest)
	if err != nil {
		return fmt.Errorf("validate order: %w", err)
	}

	fmt.Printf("Order Validation Results:\n")
	fmt.Printf("  Valid: %t\n", validation.IsValid())
	fmt.Printf("  Balance Sufficient: %t\n", validation.BalanceSufficient)
	fmt.Printf("  Price Valid: %t\n", validation.PriceValid)
	fmt.Printf("  Quantity Valid: %t\n", validation.QuantityValid)
	fmt.Printf("  Trading Pair Active: %t\n", validation.TradingPairActive)
	fmt.Printf("  Within Limits: %t\n", validation.WithinLimits)

	if len(validation.EstimatedFees) > 0 {
		fmt.Printf("  Estimated Fees:\n")
		for _, fee := range validation.EstimatedFees {
			fmt.Printf("    %s: %s %s\n", fee.Type, fee.Amount.Value, fee.Token.Value)
		}
	}

	if len(validation.Errors) > 0 {
		fmt.Printf("  Errors:\n")
		for _, err := range validation.GetErrorMessages() {
			fmt.Printf("    - %s\n", err)
		}
	}

	if len(validation.Warnings) > 0 {
		fmt.Printf("  Warnings:\n")
		for _, warning := range validation.GetWarningMessages() {
			fmt.Printf("    - %s\n", warning)
		}
	}

	return nil
}

func demonstrateTrading(ctx context.Context, client *swappiq.Client) error {
	fmt.Println("\n💰 === Trading Example ===")
	fmt.Println("⚠️  This is a demo - orders will not be submitted")

	userID := "user123"

	// Create a limit buy order
	orderRequest := swappiq.CreateOrderRequest{
		TradingPair:   "ETH-USDC",
		Side:          swappiq.OrderSideBuy,
		Type:          swappiq.OrderTypeLimit,
		Quantity:      "0.01", // Small amount for demo
		Price:         stringPtr("1800.00"), // Below market for safety
		TimeInForce:   swappiq.TimeInForceGTC,
		ClientOrderID: stringPtr(fmt.Sprintf("demo-order-%d", time.Now().Unix())),
	}

	// Validate first
	validation, err := client.ValidateOrder(userID, orderRequest)
	if err != nil {
		return fmt.Errorf("validate order: %w", err)
	}

	if !validation.IsValid() {
		fmt.Printf("❌ Order validation failed: %v\n", validation.GetErrorMessages())
		return nil
	}

	fmt.Printf("✅ Order validation passed\n")

	// Note: Actual order creation is commented out for safety
	// response, err := client.CreateOrder(ctx, userID, orderRequest)
	// if err != nil {
	//     return fmt.Errorf("create order: %w", err)
	// }
	//
	// if response.Success {
	//     fmt.Printf("✅ Order created successfully: %s\n", response.Order.ID)
	// } else {
	//     fmt.Printf("❌ Order creation failed: %s\n", response.Error.Message)
	// }

	return nil
}

func demonstrateMonitoring(client *swappiq.Client) {
	fmt.Println("\n📈 === Monitoring and Statistics ===")

	// Get client statistics
	stats := client.GetStats()
	fmt.Printf("Client Statistics:\n")
	fmt.Printf("  Connected: %t\n", stats["connected"])
	fmt.Printf("  Healthy: %t\n", client.IsHealthy())

	if httpStats, ok := stats["http_client"].(map[string]interface{}); ok {
		fmt.Printf("  HTTP Client:\n")
		fmt.Printf("    Total Requests: %v\n", httpStats["total_requests"])
		fmt.Printf("    Success Rate: %.2f%%\n", httpStats["success_rate"].(float64)*100)
		fmt.Printf("    Avg Response Time: %.2f ms\n", httpStats["average_response_time"])
		fmt.Printf("    Cache Hit Rate: %.2f%%\n", httpStats["cache_hit_rate"].(float64)*100)
	}

	if wsStats, ok := stats["websocket_client"].(map[string]interface{}); ok {
		fmt.Printf("  WebSocket Client:\n")
		fmt.Printf("    State: %v\n", wsStats["state"])
		fmt.Printf("    Messages Sent: %v\n", wsStats["messages_sent"])
		fmt.Printf("    Messages Received: %v\n", wsStats["messages_received"])
		fmt.Printf("    Uptime: %.2f seconds\n", wsStats["uptime"])
	}
}

// Helper functions

func stringPtr(s string) *string {
	return &s
}

func intPtr(i int) *int {
	return &i
}