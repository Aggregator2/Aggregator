// Package swappiq provides a comprehensive Go SDK for the SwappiQ Protocol
// Author: SwappiQ Protocol
// Description: Type-safe Go SDK with comprehensive trading and market data APIs

package swappiq

import (
	"math/big"
	"time"
)

// ========== CORE TYPES ==========

// Network represents supported blockchain networks
type Network string

const (
	NetworkEthereum Network = "ethereum"
	NetworkPolygon  Network = "polygon"
	NetworkBSC      Network = "bsc"
	NetworkArbitrum Network = "arbitrum"
	NetworkOptimism Network = "optimism"
)

// Address represents a blockchain address with network context
type Address struct {
	Value   string  `json:"value"`
	Network Network `json:"network"`
}

// DecimalAmount represents a precise decimal value with decimals
type DecimalAmount struct {
	Value    string `json:"value"`
	Decimals int    `json:"decimals"`
}

// GetBigInt returns the decimal amount as a big.Int
func (d *DecimalAmount) GetBigInt() *big.Int {
	value := new(big.Int)
	value.SetString(d.Value, 10)
	return value
}

// GetFloat64 returns the decimal amount as a float64 (may lose precision)
func (d *DecimalAmount) GetFloat64() float64 {
	value := new(big.Float)
	value.SetString(d.Value)
	decimals := new(big.Float)
	decimals.SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(d.Decimals)), nil))
	result := new(big.Float).Quo(value, decimals)
	f, _ := result.Float64()
	return f
}

// TokenAmount represents an amount of a specific token
type TokenAmount struct {
	Token    Address        `json:"token"`
	Amount   DecimalAmount  `json:"amount"`
	USDValue *DecimalAmount `json:"usd_value,omitempty"`
}

// ========== ENUMS ==========

// OrderSide represents the side of an order
type OrderSide string

const (
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"
)

// OrderType represents the type of an order
type OrderType string

const (
	OrderTypeMarket    OrderType = "market"
	OrderTypeLimit     OrderType = "limit"
	OrderTypeStop      OrderType = "stop"
	OrderTypeStopLimit OrderType = "stop_limit"
)

// OrderStatus represents the status of an order
type OrderStatus string

const (
	OrderStatusPending          OrderStatus = "pending"
	OrderStatusOpen             OrderStatus = "open"
	OrderStatusPartiallyFilled  OrderStatus = "partially_filled"
	OrderStatusFilled           OrderStatus = "filled"
	OrderStatusCancelled        OrderStatus = "cancelled"
	OrderStatusExpired          OrderStatus = "expired"
	OrderStatusRejected         OrderStatus = "rejected"
)

// TimeInForce represents how long an order should remain active
type TimeInForce string

const (
	TimeInForceGTC TimeInForce = "GTC" // Good Till Cancelled
	TimeInForceIOC TimeInForce = "IOC" // Immediate Or Cancel
	TimeInForceFOK TimeInForce = "FOK" // Fill Or Kill
	TimeInForceGTD TimeInForce = "GTD" // Good Till Date
)

// ========== API RESPONSE TYPES ==========

// APIError represents an error returned by the API
type APIError struct {
	Code      string                 `json:"code"`
	Message   string                 `json:"message"`
	Details   map[string]interface{} `json:"details,omitempty"`
	Retryable bool                   `json:"retryable"`
}

func (e *APIError) Error() string {
	return e.Message
}

// APIResponse represents a standard API response
type APIResponse struct {
	Success   bool        `json:"success"`
	Data      interface{} `json:"data,omitempty"`
	Error     *APIError   `json:"error,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
	RequestID string      `json:"request_id"`
}

// PaginatedResponse represents a paginated API response
type PaginatedResponse struct {
	Items       interface{} `json:"items"`
	Total       int         `json:"total"`
	Page        int         `json:"page"`
	Limit       int         `json:"limit"`
	HasNext     bool        `json:"has_next"`
	HasPrevious bool        `json:"has_previous"`
}

// ========== TOKEN AND TRADING PAIR TYPES ==========

// TokenInfo represents information about a token
type TokenInfo struct {
	Address   Address                `json:"address"`
	Symbol    string                 `json:"symbol"`
	Name      string                 `json:"name"`
	Decimals  int                    `json:"decimals"`
	LogoURL   *string                `json:"logo_url,omitempty"`
	Verified  bool                   `json:"verified"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// TradingPair represents a trading pair configuration
type TradingPair struct {
	Symbol            string                 `json:"symbol"`
	BaseToken         TokenInfo              `json:"base_token"`
	QuoteToken        TokenInfo              `json:"quote_token"`
	MinOrderSize      DecimalAmount          `json:"min_order_size"`
	MaxOrderSize      DecimalAmount          `json:"max_order_size"`
	PriceIncrement    DecimalAmount          `json:"price_increment"`
	QuantityIncrement DecimalAmount          `json:"quantity_increment"`
	MakerFee          DecimalAmount          `json:"maker_fee"`
	TakerFee          DecimalAmount          `json:"taker_fee"`
	Status            string                 `json:"status"` // active, inactive, delisted
	Metadata          map[string]interface{} `json:"metadata,omitempty"`
}

// ========== ORDER TYPES ==========

// Order represents a trading order
type Order struct {
	ID            string                 `json:"id"`
	UserID        string                 `json:"user_id"`
	TradingPair   string                 `json:"trading_pair"`
	Side          OrderSide              `json:"side"`
	Type          OrderType              `json:"type"`
	Quantity      DecimalAmount          `json:"quantity"`
	Price         *DecimalAmount         `json:"price,omitempty"`
	StopPrice     *DecimalAmount         `json:"stop_price,omitempty"`
	Status        OrderStatus            `json:"status"`
	TimeInForce   TimeInForce            `json:"time_in_force"`
	CreatedAt     time.Time              `json:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at"`
	ExpiresAt     *time.Time             `json:"expires_at,omitempty"`
	ClientOrderID *string                `json:"client_order_id,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
}

// CreateOrderRequest represents a request to create an order
type CreateOrderRequest struct {
	TradingPair   string                 `json:"trading_pair"`
	Side          OrderSide              `json:"side"`
	Type          OrderType              `json:"type"`
	Quantity      string                 `json:"quantity"`
	Price         *string                `json:"price,omitempty"`
	StopPrice     *string                `json:"stop_price,omitempty"`
	TimeInForce   *TimeInForce           `json:"time_in_force,omitempty"`
	ClientOrderID *string                `json:"client_order_id,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
	Signature     *string                `json:"signature,omitempty"`
}

// TradeFee represents a trading fee
type TradeFee struct {
	Token  Address       `json:"token"`
	Amount DecimalAmount `json:"amount"`
	Type   string        `json:"type"` // maker, taker, gas
}

// ExecutionReport represents an order execution report
type ExecutionReport struct {
	OrderID              string        `json:"order_id"`
	ExecutionID          string        `json:"execution_id"`
	TradingPair          string        `json:"trading_pair"`
	Side                 OrderSide     `json:"side"`
	ExecutedQuantity     DecimalAmount `json:"executed_quantity"`
	ExecutedPrice        DecimalAmount `json:"executed_price"`
	RemainingQuantity    DecimalAmount `json:"remaining_quantity"`
	Status               OrderStatus   `json:"status"`
	Fees                 []TradeFee    `json:"fees"`
	Timestamp            time.Time     `json:"timestamp"`
	CounterpartyOrderID  *string       `json:"counterparty_order_id,omitempty"`
}

// CreateOrderResponse represents the response to a create order request
type CreateOrderResponse struct {
	Success         bool             `json:"success"`
	Order           *Order           `json:"order,omitempty"`
	Error           *APIError        `json:"error,omitempty"`
	EstimatedGas    *string          `json:"estimated_gas,omitempty"`
	ExecutionReport *ExecutionReport `json:"execution_report,omitempty"`
}

// ========== ORDER BOOK TYPES ==========

// OrderBookLevel represents a single level in an order book
type OrderBookLevel struct {
	Price      DecimalAmount `json:"price"`
	Quantity   DecimalAmount `json:"quantity"`
	OrderCount int           `json:"order_count"`
}

// OrderBook represents a full order book
type OrderBook struct {
	TradingPair string           `json:"trading_pair"`
	Bids        []OrderBookLevel `json:"bids"`
	Asks        []OrderBookLevel `json:"asks"`
	Sequence    int64            `json:"sequence"`
	Timestamp   time.Time        `json:"timestamp"`
	Spread      *DecimalAmount   `json:"spread,omitempty"`
	MidPrice    *DecimalAmount   `json:"mid_price,omitempty"`
}

// OrderBookUpdate represents an order book update
type OrderBookUpdate struct {
	TradingPair string        `json:"trading_pair"`
	Side        OrderSide     `json:"side"`
	Price       DecimalAmount `json:"price"`
	Quantity    DecimalAmount `json:"quantity"`
	Sequence    int64         `json:"sequence"`
	Timestamp   time.Time     `json:"timestamp"`
	Type        string        `json:"type"` // add, update, remove
}

// ========== TRADE TYPES ==========

// Trade represents a completed trade
type Trade struct {
	ID              string        `json:"id"`
	TradingPair     string        `json:"trading_pair"`
	Price           DecimalAmount `json:"price"`
	Quantity        DecimalAmount `json:"quantity"`
	Side            OrderSide     `json:"side"`
	Timestamp       time.Time     `json:"timestamp"`
	BuyOrderID      string        `json:"buy_order_id"`
	SellOrderID     string        `json:"sell_order_id"`
	Fees            []TradeFee    `json:"fees"`
	BlockNumber     *int64        `json:"block_number,omitempty"`
	TransactionHash *string       `json:"transaction_hash,omitempty"`
}

// UserTrade represents a trade from a user's perspective
type UserTrade struct {
	Trade
	UserSide     OrderSide      `json:"user_side"`
	OrderID      string         `json:"order_id"`
	FeesPaid     []TradeFee     `json:"fees_paid"`
	RealizedPnL  *DecimalAmount `json:"realized_pnl,omitempty"`
}

// ========== BALANCE TYPES ==========

// Balance represents a token balance
type Balance struct {
	Token       Address        `json:"token"`
	Available   DecimalAmount  `json:"available"`
	Locked      DecimalAmount  `json:"locked"`
	Total       DecimalAmount  `json:"total"`
	USDValue    *DecimalAmount `json:"usd_value,omitempty"`
	LastUpdated time.Time      `json:"last_updated"`
}

// Portfolio represents a user's portfolio
type Portfolio struct {
	UserID        string        `json:"user_id"`
	Balances      []Balance     `json:"balances"`
	TotalUSDValue DecimalAmount `json:"total_usd_value"`
	Network       Network       `json:"network"`
	LastUpdated   time.Time     `json:"last_updated"`
}

// ========== MARKET DATA TYPES ==========

// MarketStats represents market statistics for a trading pair
type MarketStats struct {
	TradingPair           string        `json:"trading_pair"`
	LastPrice             DecimalAmount `json:"last_price"`
	PriceChange24h        DecimalAmount `json:"price_change_24h"`
	PriceChangePercent24h DecimalAmount `json:"price_change_percent_24h"`
	High24h               DecimalAmount `json:"high_24h"`
	Low24h                DecimalAmount `json:"low_24h"`
	Volume24h             DecimalAmount `json:"volume_24h"`
	QuoteVolume24h        DecimalAmount `json:"quote_volume_24h"`
	Timestamp             time.Time     `json:"timestamp"`
}

// Ticker represents a price ticker
type Ticker struct {
	TradingPair string        `json:"trading_pair"`
	Price       DecimalAmount `json:"price"`
	Timestamp   time.Time     `json:"timestamp"`
	Source      string        `json:"source"`
}

// Candle represents OHLCV candlestick data
type Candle struct {
	TradingPair  string        `json:"trading_pair"`
	Interval     string        `json:"interval"`
	OpenTime     time.Time     `json:"open_time"`
	CloseTime    time.Time     `json:"close_time"`
	Open         DecimalAmount `json:"open"`
	High         DecimalAmount `json:"high"`
	Low          DecimalAmount `json:"low"`
	Close        DecimalAmount `json:"close"`
	Volume       DecimalAmount `json:"volume"`
	QuoteVolume  DecimalAmount `json:"quote_volume"`
	Trades       int           `json:"trades"`
}

// ========== AUTHENTICATION TYPES ==========

// AuthCredentials represents API authentication credentials
type AuthCredentials struct {
	APIKey      string  `json:"api_key"`
	APISecret   string  `json:"api_secret"`
	Passphrase  *string `json:"passphrase,omitempty"`
	Environment string  `json:"environment"` // sandbox, production
}

// SignedRequest represents a signed API request
type SignedRequest struct {
	Method    string            `json:"method"`
	Path      string            `json:"path"`
	Body      string            `json:"body"`
	Timestamp string            `json:"timestamp"`
	Signature string            `json:"signature"`
	Headers   map[string]string `json:"headers"`
}

// ========== WEBSOCKET TYPES ==========

// WebSocketMessage represents a WebSocket message
type WebSocketMessage struct {
	Type      string      `json:"type"`
	Channel   string      `json:"channel"`
	Data      interface{} `json:"data"`
	Timestamp time.Time   `json:"timestamp"`
	Sequence  *int64      `json:"sequence,omitempty"`
}

// SubscriptionRequest represents a subscription request
type SubscriptionRequest struct {
	Type         string   `json:"type"` // subscribe, unsubscribe
	Channels     []string `json:"channels"`
	TradingPairs []string `json:"trading_pairs,omitempty"`
	Auth         bool     `json:"auth,omitempty"`
}

// WebSocketConfig represents WebSocket configuration
type WebSocketConfig struct {
	URL                   string            `json:"url"`
	ReconnectInterval     time.Duration     `json:"reconnect_interval"`
	MaxReconnectAttempts  int               `json:"max_reconnect_attempts"`
	PingInterval          time.Duration     `json:"ping_interval"`
	Auth                  *AuthCredentials  `json:"auth,omitempty"`
}

// ========== VALIDATION TYPES ==========

// ValidationError represents a validation error
type ValidationError struct {
	Field   string      `json:"field"`
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Value   interface{} `json:"value,omitempty"`
}

func (e *ValidationError) Error() string {
	return e.Message
}

// ValidationResult represents the result of validation
type ValidationResult struct {
	Valid  bool               `json:"valid"`
	Errors []ValidationError  `json:"errors"`
}

// OrderValidation represents comprehensive order validation results
type OrderValidation struct {
	BalanceSufficient   bool               `json:"balance_sufficient"`
	PriceValid          bool               `json:"price_valid"`
	QuantityValid       bool               `json:"quantity_valid"`
	TradingPairActive   bool               `json:"trading_pair_active"`
	WithinLimits        bool               `json:"within_limits"`
	EstimatedFees       []TradeFee         `json:"estimated_fees"`
	EstimatedGas        *string            `json:"estimated_gas,omitempty"`
	Errors              []ValidationError  `json:"errors"`
	Warnings            []ValidationError  `json:"warnings"`
}

// ========== EVENT TYPES ==========

// OrderEvent represents an order-related event
type OrderEvent struct {
	Type      string    `json:"type"` // order_created, order_updated, order_filled, order_cancelled
	Order     Order     `json:"order"`
	Timestamp time.Time `json:"timestamp"`
}

// TradeEvent represents a trade execution event
type TradeEvent struct {
	Type      string    `json:"type"` // trade_executed
	Trade     UserTrade `json:"trade"`
	Timestamp time.Time `json:"timestamp"`
}

// BalanceEvent represents a balance update event
type BalanceEvent struct {
	Type      string    `json:"type"` // balance_updated
	Balance   Balance   `json:"balance"`
	Timestamp time.Time `json:"timestamp"`
}

// UserEvent represents any user-related event
type UserEvent struct {
	OrderEvent   *OrderEvent   `json:"order_event,omitempty"`
	TradeEvent   *TradeEvent   `json:"trade_event,omitempty"`
	BalanceEvent *BalanceEvent `json:"balance_event,omitempty"`
}

// ========== CONFIGURATION TYPES ==========

// RetryConfig represents retry configuration
type RetryConfig struct {
	MaxAttempts     int           `json:"max_attempts"`
	BaseDelay       time.Duration `json:"base_delay"`
	MaxDelay        time.Duration `json:"max_delay"`
	BackoffFactor   float64       `json:"backoff_factor"`
	Jitter          bool          `json:"jitter"`
	RetryableErrors []string      `json:"retryable_errors"`
}

// RateLimitConfig represents rate limiting configuration
type RateLimitConfig struct {
	RequestsPerSecond int `json:"requests_per_second"`
	BurstSize         int `json:"burst_size"`
	QueueSize         int `json:"queue_size"`
}

// SDKConfig represents SDK configuration
type SDKConfig struct {
	APIURL          string           `json:"api_url"`
	WSURL           *string          `json:"ws_url,omitempty"`
	Auth            *AuthCredentials `json:"auth,omitempty"`
	Network         Network          `json:"network"`
	Timeout         time.Duration    `json:"timeout"`
	RetryConfig     RetryConfig      `json:"retry_config"`
	RateLimitConfig *RateLimitConfig `json:"rate_limit_config,omitempty"`
	Debug           bool             `json:"debug"`
}

// ========== REQUEST PARAMETER TYPES ==========

// PaginationParams represents pagination parameters
type PaginationParams struct {
	Page      *int    `json:"page,omitempty"`
	Limit     *int    `json:"limit,omitempty"`
	SortBy    *string `json:"sort_by,omitempty"`
	SortOrder *string `json:"sort_order,omitempty"` // asc, desc
}

// OrderHistoryParams represents parameters for order history requests
type OrderHistoryParams struct {
	PaginationParams
	TradingPair *string       `json:"trading_pair,omitempty"`
	Status      []OrderStatus `json:"status,omitempty"`
	Side        *OrderSide    `json:"side,omitempty"`
	StartTime   *time.Time    `json:"start_time,omitempty"`
	EndTime     *time.Time    `json:"end_time,omitempty"`
}

// TradeHistoryParams represents parameters for trade history requests
type TradeHistoryParams struct {
	PaginationParams
	TradingPair *string    `json:"trading_pair,omitempty"`
	StartTime   *time.Time `json:"start_time,omitempty"`
	EndTime     *time.Time `json:"end_time,omitempty"`
}

// CandleParams represents parameters for candle data requests
type CandleParams struct {
	TradingPair string     `json:"trading_pair"`
	Interval    string     `json:"interval"` // 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w
	StartTime   *time.Time `json:"start_time,omitempty"`
	EndTime     *time.Time `json:"end_time,omitempty"`
	Limit       *int       `json:"limit,omitempty"`
}

// ========== UTILITY FUNCTIONS ==========

// IsLimitOrder checks if an order is a limit order
func (o *Order) IsLimitOrder() bool {
	return o.Type == OrderTypeLimit || o.Type == OrderTypeStopLimit
}

// IsMarketOrder checks if an order is a market order
func (o *Order) IsMarketOrder() bool {
	return o.Type == OrderTypeMarket
}

// IsStopOrder checks if an order is a stop order
func (o *Order) IsStopOrder() bool {
	return o.Type == OrderTypeStop || o.Type == OrderTypeStopLimit
}

// IsActive checks if an order is in an active state
func (o *Order) IsActive() bool {
	return o.Status == OrderStatusPending || o.Status == OrderStatusOpen || o.Status == OrderStatusPartiallyFilled
}

// IsFinal checks if an order is in a final state
func (o *Order) IsFinal() bool {
	return o.Status == OrderStatusFilled || o.Status == OrderStatusCancelled || o.Status == OrderStatusExpired || o.Status == OrderStatusRejected
}

// GetBestBid returns the best bid from the order book
func (ob *OrderBook) GetBestBid() *OrderBookLevel {
	if len(ob.Bids) > 0 {
		return &ob.Bids[0]
	}
	return nil
}

// GetBestAsk returns the best ask from the order book
func (ob *OrderBook) GetBestAsk() *OrderBookLevel {
	if len(ob.Asks) > 0 {
		return &ob.Asks[0]
	}
	return nil
}

// GetSpread returns the spread between best bid and ask
func (ob *OrderBook) GetSpread() *DecimalAmount {
	bestBid := ob.GetBestBid()
	bestAsk := ob.GetBestAsk()
	
	if bestBid == nil || bestAsk == nil {
		return nil
	}
	
	// Calculate spread (ask - bid)
	bidFloat := bestBid.Price.GetFloat64()
	askFloat := bestAsk.Price.GetFloat64()
	spread := askFloat - bidFloat
	
	return &DecimalAmount{
		Value:    big.NewFloat(spread).Text('f', -1),
		Decimals: bestBid.Price.Decimals,
	}
}