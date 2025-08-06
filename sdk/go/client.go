// Package swappiq provides the main SDK client for the SwappiQ Protocol
// Author: SwappiQ Protocol
// Description: Main SDK client combining all functionality with type-safe APIs

package swappiq

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Client represents the main SwappiQ SDK client
type Client struct {
	config    SDKConfig
	httpClient *HTTPClient
	wsClient   *WebSocketClient
	validator  *OrderValidator
	
	// Service implementations
	balanceService BalanceService
	priceService   PriceService
	
	// State management
	isConnected bool
	mutex       sync.RWMutex
	
	// Event handlers
	eventHandlers map[EventType][]EventHandler
	handlerMutex  sync.RWMutex
}

// NewClient creates a new SwappiQ SDK client
func NewClient(config SDKConfig) (*Client, error) {
	// Create HTTP client
	httpClient, err := NewHTTPClient(config)
	if err != nil {
		return nil, fmt.Errorf("create HTTP client: %w", err)
	}
	
	// Create WebSocket client if URL is provided
	var wsClient *WebSocketClient
	if config.WSURL != nil {
		wsConfig := WebSocketConfig{
			URL:                  *config.WSURL,
			ReconnectInterval:    5000,
			MaxReconnectAttempts: 10,
			PingInterval:         30000,
			Auth:                 config.Auth,
		}
		wsClient = NewWebSocketClient(wsConfig)
	}
	
	client := &Client{
		config:        config,
		httpClient:    httpClient,
		wsClient:      wsClient,
		eventHandlers: make(map[EventType][]EventHandler),
	}
	
	// Initialize services
	client.balanceService = &clientBalanceService{client: client}
	client.priceService = &clientPriceService{client: client}
	
	// Create order validator
	client.validator = NewOrderValidator(client.balanceService, client.priceService)
	
	return client, nil
}

// Connect establishes connections to the SwappiQ Protocol
func (c *Client) Connect(ctx context.Context) error {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	// Connect WebSocket if available
	if c.wsClient != nil {
		if err := c.wsClient.Connect(); err != nil {
			return fmt.Errorf("WebSocket connect: %w", err)
		}
		
		// Set up event forwarding
		c.setupWebSocketEventForwarding()
	}
	
	c.isConnected = true
	return nil
}

// setupWebSocketEventForwarding forwards WebSocket events to client event handlers
func (c *Client) setupWebSocketEventForwarding() {
	c.wsClient.On(EventOrderUpdate, func(event WebSocketEvent) {
		c.emitEvent(EventOrderUpdate, event.Data, event.Error)
	})
	
	c.wsClient.On(EventTradeUpdate, func(event WebSocketEvent) {
		c.emitEvent(EventTradeUpdate, event.Data, event.Error)
	})
	
	c.wsClient.On(EventBalanceUpdate, func(event WebSocketEvent) {
		c.emitEvent(EventBalanceUpdate, event.Data, event.Error)
	})
	
	c.wsClient.On(EventOrderBookUpdate, func(event WebSocketEvent) {
		c.emitEvent(EventOrderBookUpdate, event.Data, event.Error)
	})
	
	c.wsClient.On(EventTickerUpdate, func(event WebSocketEvent) {
		c.emitEvent(EventTickerUpdate, event.Data, event.Error)
	})
}

// Disconnect closes all connections
func (c *Client) Disconnect() error {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	var err error
	
	if c.wsClient != nil {
		if wsErr := c.wsClient.Close(); wsErr != nil {
			err = fmt.Errorf("WebSocket close: %w", wsErr)
		}
	}
	
	if httpErr := c.httpClient.Close(); httpErr != nil {
		if err != nil {
			err = fmt.Errorf("%w; HTTP close: %v", err, httpErr)
		} else {
			err = fmt.Errorf("HTTP close: %w", httpErr)
		}
	}
	
	c.isConnected = false
	return err
}

// IsConnected returns true if client is connected
func (c *Client) IsConnected() bool {
	c.mutex.RLock()
	defer c.mutex.RUnlock()
	return c.isConnected
}

// Trading Operations

// CreateOrder creates a new trading order
func (c *Client) CreateOrder(ctx context.Context, userID string, request CreateOrderRequest) (*CreateOrderResponse, error) {
	// Validate order locally first
	validation, err := c.validator.ValidateCreateOrder(userID, request)
	if err != nil {
		return nil, fmt.Errorf("order validation: %w", err)
	}
	
	if !validation.IsValid() {
		return &CreateOrderResponse{
			Success: false,
			Error: &APIError{
				Code:    "VALIDATION_FAILED",
				Message: "Order validation failed",
				Details: map[string]interface{}{
					"errors":   validation.GetErrorMessages(),
					"warnings": validation.GetWarningMessages(),
				},
			},
		}, nil
	}
	
	// Submit order to API
	response, err := c.httpClient.Request(ctx, RequestOptions{
		Method: "POST",
		Path:   "/api/v1/orders",
		Body:   request,
		Auth:   true,
	})
	if err != nil {
		return nil, fmt.Errorf("create order request: %w", err)
	}
	
	if !response.Success {
		return &CreateOrderResponse{
			Success: false,
			Error:   response.Error,
		}, nil
	}
	
	// Parse response data
	var orderResponse CreateOrderResponse
	if response.Data != nil {
		// Convert response data to CreateOrderResponse
		// This would typically involve JSON marshaling/unmarshaling
		orderResponse.Success = true
		// Set other fields from response.Data
	}
	
	return &orderResponse, nil
}

// CancelOrder cancels an existing order
func (c *Client) CancelOrder(ctx context.Context, orderID string) (*APIResponse, error) {
	return c.httpClient.Request(ctx, RequestOptions{
		Method: "DELETE",
		Path:   fmt.Sprintf("/api/v1/orders/%s", orderID),
		Auth:   true,
	})
}

// GetOrder retrieves order details
func (c *Client) GetOrder(ctx context.Context, orderID string) (*Order, error) {
	response, err := c.httpClient.Request(ctx, RequestOptions{
		Method: "GET",
		Path:   fmt.Sprintf("/api/v1/orders/%s", orderID),
		Auth:   true,
	})
	if err != nil {
		return nil, err
	}
	
	if !response.Success {
		return nil, fmt.Errorf("API error: %s", response.Error.Message)
	}
	
	// Parse order data
	var order Order
	// Convert response.Data to Order struct
	
	return &order, nil
}

// GetOrderHistory retrieves order history
func (c *Client) GetOrderHistory(ctx context.Context, params OrderHistoryParams) (*PaginatedResponse, error) {
	response, err := c.httpClient.Request(ctx, RequestOptions{
		Method: "GET",
		Path:   "/api/v1/orders",
		Body:   params,
		Auth:   true,
	})
	if err != nil {
		return nil, err
	}
	
	if !response.Success {
		return nil, fmt.Errorf("API error: %s", response.Error.Message)
	}
	
	// Parse paginated response
	var paginatedResponse PaginatedResponse
	// Convert response.Data to PaginatedResponse
	
	return &paginatedResponse, nil
}

// Market Data Operations

// GetTradingPairs retrieves available trading pairs
func (c *Client) GetTradingPairs(ctx context.Context) ([]*TradingPair, error) {
	response, err := c.httpClient.Request(ctx, RequestOptions{
		Method: "GET",
		Path:   "/api/v1/trading-pairs",
	})
	if err != nil {
		return nil, err
	}
	
	if !response.Success {
		return nil, fmt.Errorf("API error: %s", response.Error.Message)
	}
	
	// Parse trading pairs
	var tradingPairs []*TradingPair
	// Convert response.Data to []*TradingPair
	
	// Update validator with new trading pairs
	c.validator.SetTradingPairs(tradingPairs)
	
	return tradingPairs, nil
}

// GetOrderBook retrieves order book for a trading pair
func (c *Client) GetOrderBook(ctx context.Context, tradingPair string) (*OrderBook, error) {
	response, err := c.httpClient.Request(ctx, RequestOptions{
		Method: "GET",
		Path:   fmt.Sprintf("/api/v1/orderbook/%s", tradingPair),
	})
	if err != nil {
		return nil, err
	}
	
	if !response.Success {
		return nil, fmt.Errorf("API error: %s", response.Error.Message)
	}
	
	// Parse order book
	var orderBook OrderBook
	// Convert response.Data to OrderBook
	
	return &orderBook, nil
}

// GetMarketStats retrieves market statistics
func (c *Client) GetMarketStats(ctx context.Context, tradingPair string) (*MarketStats, error) {
	response, err := c.httpClient.Request(ctx, RequestOptions{
		Method: "GET",
		Path:   fmt.Sprintf("/api/v1/stats/%s", tradingPair),
	})
	if err != nil {
		return nil, err
	}
	
	if !response.Success {
		return nil, fmt.Errorf("API error: %s", response.Error.Message)
	}
	
	// Parse market stats
	var stats MarketStats
	// Convert response.Data to MarketStats
	
	return &stats, nil
}

// GetCandles retrieves candlestick data
func (c *Client) GetCandles(ctx context.Context, params CandleParams) ([]*Candle, error) {
	response, err := c.httpClient.Request(ctx, RequestOptions{
		Method: "GET",
		Path:   "/api/v1/candles",
		Body:   params,
	})
	if err != nil {
		return nil, err
	}
	
	if !response.Success {
		return nil, fmt.Errorf("API error: %s", response.Error.Message)
	}
	
	// Parse candles
	var candles []*Candle
	// Convert response.Data to []*Candle
	
	return candles, nil
}

// Account Operations

// GetBalances retrieves account balances
func (c *Client) GetBalances(ctx context.Context) ([]*Balance, error) {
	response, err := c.httpClient.Request(ctx, RequestOptions{
		Method: "GET",
		Path:   "/api/v1/balances",
		Auth:   true,
	})
	if err != nil {
		return nil, err
	}
	
	if !response.Success {
		return nil, fmt.Errorf("API error: %s", response.Error.Message)
	}
	
	// Parse balances
	var balances []*Balance
	// Convert response.Data to []*Balance
	
	return balances, nil
}

// GetPortfolio retrieves portfolio information
func (c *Client) GetPortfolio(ctx context.Context) (*Portfolio, error) {
	response, err := c.httpClient.Request(ctx, RequestOptions{
		Method: "GET",
		Path:   "/api/v1/portfolio",
		Auth:   true,
	})
	if err != nil {
		return nil, err
	}
	
	if !response.Success {
		return nil, fmt.Errorf("API error: %s", response.Error.Message)
	}
	
	// Parse portfolio
	var portfolio Portfolio
	// Convert response.Data to Portfolio
	
	return &portfolio, nil
}

// WebSocket Operations

// Subscribe subscribes to WebSocket channels
func (c *Client) Subscribe(channels []string, tradingPairs []string, auth bool) error {
	if c.wsClient == nil {
		return fmt.Errorf("WebSocket client not available")
	}
	
	request := SubscriptionRequest{
		Type:         "subscribe",
		Channels:     channels,
		TradingPairs: tradingPairs,
		Auth:         auth,
	}
	
	return c.wsClient.Subscribe(request)
}

// Unsubscribe unsubscribes from WebSocket channels
func (c *Client) Unsubscribe(channels []string, tradingPairs []string) error {
	if c.wsClient == nil {
		return fmt.Errorf("WebSocket client not available")
	}
	
	return c.wsClient.Unsubscribe(channels, tradingPairs)
}

// Event Handling

// On registers an event handler
func (c *Client) On(eventType EventType, handler EventHandler) {
	c.handlerMutex.Lock()
	defer c.handlerMutex.Unlock()
	
	c.eventHandlers[eventType] = append(c.eventHandlers[eventType], handler)
}

// Off removes event handlers
func (c *Client) Off(eventType EventType) {
	c.handlerMutex.Lock()
	defer c.handlerMutex.Unlock()
	
	delete(c.eventHandlers, eventType)
}

// emitEvent emits an event to all registered handlers
func (c *Client) emitEvent(eventType EventType, data interface{}, err error) {
	event := WebSocketEvent{
		Type:      eventType,
		Data:      data,
		Error:     err,
		Timestamp: time.Now(),
	}
	
	c.handlerMutex.RLock()
	handlers := c.eventHandlers[eventType]
	c.handlerMutex.RUnlock()
	
	for _, handler := range handlers {
		go handler(event) // Handle events concurrently
	}
}

// Validation Operations

// ValidateOrder validates an order without submitting it
func (c *Client) ValidateOrder(userID string, request CreateOrderRequest) (*OrderValidation, error) {
	return c.validator.ValidateCreateOrder(userID, request)
}

// SetRiskLimits sets risk management limits
func (c *Client) SetRiskLimits(limits RiskLimits) {
	c.validator.SetRiskLimits(limits)
}

// SetValidationRules sets validation rules
func (c *Client) SetValidationRules(rules ValidationRules) {
	c.validator.SetValidationRules(rules)
}

// Statistics and Health

// GetStats returns comprehensive client statistics
func (c *Client) GetStats() map[string]interface{} {
	stats := map[string]interface{}{
		"http_client": c.httpClient.GetStats(),
		"connected":   c.IsConnected(),
	}
	
	if c.wsClient != nil {
		stats["websocket_client"] = c.wsClient.GetStats()
	}
	
	return stats
}

// IsHealthy returns true if all components are healthy
func (c *Client) IsHealthy() bool {
	httpHealthy := c.httpClient.IsHealthy()
	wsHealthy := true
	
	if c.wsClient != nil {
		wsHealthy = c.wsClient.IsConnected()
	}
	
	return httpHealthy && wsHealthy && c.IsConnected()
}

// Service implementations

// clientBalanceService implements BalanceService using the client
type clientBalanceService struct {
	client *Client
}

func (bs *clientBalanceService) GetBalance(userID string, token Address) (*Balance, error) {
	// Implementation would call the appropriate API endpoint
	balances, err := bs.client.GetBalances(context.Background())
	if err != nil {
		return nil, err
	}
	
	for _, balance := range balances {
		if balance.Token.Value == token.Value && balance.Token.Network == token.Network {
			return balance, nil
		}
	}
	
	return nil, fmt.Errorf("balance not found for token %s", token.Value)
}

func (bs *clientBalanceService) GetPortfolio(userID string) (*Portfolio, error) {
	return bs.client.GetPortfolio(context.Background())
}

// clientPriceService implements PriceService using the client
type clientPriceService struct {
	client *Client
}

func (ps *clientPriceService) GetLastPrice(tradingPair string) (*DecimalAmount, error) {
	stats, err := ps.client.GetMarketStats(context.Background(), tradingPair)
	if err != nil {
		return nil, err
	}
	
	return &stats.LastPrice, nil
}

func (ps *clientPriceService) GetOrderBook(tradingPair string) (*OrderBook, error) {
	return ps.client.GetOrderBook(context.Background(), tradingPair)
}

func (ps *clientPriceService) GetMarketStats(tradingPair string) (*MarketStats, error) {
	return ps.client.GetMarketStats(context.Background(), tradingPair)
}