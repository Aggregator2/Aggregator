// Package swappiq provides local order validation functionality
// Author: SwappiQ Protocol
// Description: Comprehensive order validation with business logic and risk checks

package swappiq

import (
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
)

// OrderValidator provides comprehensive order validation
type OrderValidator struct {
	tradingPairs    map[string]*TradingPair
	balanceService  BalanceService
	priceService    PriceService
	riskLimits      RiskLimits
	validationRules ValidationRules
}

// BalanceService interface for balance validation
type BalanceService interface {
	GetBalance(userID string, token Address) (*Balance, error)
	GetPortfolio(userID string) (*Portfolio, error)
}

// PriceService interface for price validation
type PriceService interface {
	GetLastPrice(tradingPair string) (*DecimalAmount, error)
	GetOrderBook(tradingPair string) (*OrderBook, error)
	GetMarketStats(tradingPair string) (*MarketStats, error)
}

// RiskLimits represents risk management limits
type RiskLimits struct {
	MaxOrderValue        *DecimalAmount `json:"max_order_value"`
	MaxPositionSize      *DecimalAmount `json:"max_position_size"`
	MaxDailyVolume       *DecimalAmount `json:"max_daily_volume"`
	MaxPriceDeviation    float64        `json:"max_price_deviation"` // Percentage
	MinOrderValue        *DecimalAmount `json:"min_order_value"`
	AllowedOrderTypes    []OrderType    `json:"allowed_order_types"`
	TradingHoursOnly     bool           `json:"trading_hours_only"`
	RequireConfirmation  bool           `json:"require_confirmation"`
}

// ValidationRules represents order validation rules
type ValidationRules struct {
	ValidateBalance       bool `json:"validate_balance"`
	ValidatePrice         bool `json:"validate_price"`
	ValidateQuantity      bool `json:"validate_quantity"`
	ValidateTradingPair   bool `json:"validate_trading_pair"`
	ValidateRiskLimits    bool `json:"validate_risk_limits"`
	ValidateMarketHours   bool `json:"validate_market_hours"`
	ValidateOrderSize     bool `json:"validate_order_size"`
	ValidatePriceRange    bool `json:"validate_price_range"`
}

// DefaultValidationRules returns default validation rules
func DefaultValidationRules() ValidationRules {
	return ValidationRules{
		ValidateBalance:     true,
		ValidatePrice:       true,
		ValidateQuantity:    true,
		ValidateTradingPair: true,
		ValidateRiskLimits:  true,
		ValidateMarketHours: false,
		ValidateOrderSize:   true,
		ValidatePriceRange:  true,
	}
}

// NewOrderValidator creates a new order validator instance
func NewOrderValidator(balanceService BalanceService, priceService PriceService) *OrderValidator {
	return &OrderValidator{
		tradingPairs:    make(map[string]*TradingPair),
		balanceService:  balanceService,
		priceService:    priceService,
		riskLimits:      RiskLimits{},
		validationRules: DefaultValidationRules(),
	}
}

// SetTradingPairs sets the available trading pairs
func (ov *OrderValidator) SetTradingPairs(pairs []*TradingPair) {
	ov.tradingPairs = make(map[string]*TradingPair)
	for _, pair := range pairs {
		ov.tradingPairs[pair.Symbol] = pair
	}
}

// SetRiskLimits sets risk management limits
func (ov *OrderValidator) SetRiskLimits(limits RiskLimits) {
	ov.riskLimits = limits
}

// SetValidationRules sets validation rules
func (ov *OrderValidator) SetValidationRules(rules ValidationRules) {
	ov.validationRules = rules
}

// ValidateCreateOrder validates a create order request
func (ov *OrderValidator) ValidateCreateOrder(userID string, request CreateOrderRequest) (*OrderValidation, error) {
	validation := &OrderValidation{
		BalanceSufficient: true,
		PriceValid:        true,
		QuantityValid:     true,
		TradingPairActive: true,
		WithinLimits:      true,
		EstimatedFees:     make([]TradeFee, 0),
		Errors:            make([]ValidationError, 0),
		Warnings:          make([]ValidationError, 0),
	}

	// Get trading pair
	pair, exists := ov.tradingPairs[request.TradingPair]
	if !exists {
		validation.TradingPairActive = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "trading_pair",
			Code:    "TRADING_PAIR_NOT_FOUND",
			Message: fmt.Sprintf("Trading pair %s not found", request.TradingPair),
			Value:   request.TradingPair,
		})
		return validation, nil
	}

	// Validate trading pair status
	if ov.validationRules.ValidateTradingPair {
		if err := ov.validateTradingPairStatus(pair, validation); err != nil {
			return nil, err
		}
	}

	// Validate order type
	if err := ov.validateOrderType(request.Type, validation); err != nil {
		return nil, err
	}

	// Validate quantity
	if ov.validationRules.ValidateQuantity {
		if err := ov.validateQuantity(request.Quantity, pair, validation); err != nil {
			return nil, err
		}
	}

	// Validate price for limit orders
	if ov.validationRules.ValidatePrice && (request.Type == OrderTypeLimit || request.Type == OrderTypeStopLimit) {
		if request.Price == nil {
			validation.PriceValid = false
			validation.Errors = append(validation.Errors, ValidationError{
				Field:   "price",
				Code:    "PRICE_REQUIRED",
				Message: "Price is required for limit orders",
			})
		} else {
			if err := ov.validatePrice(*request.Price, pair, validation); err != nil {
				return nil, err
			}
		}
	}

	// Validate stop price for stop orders
	if request.Type == OrderTypeStop || request.Type == OrderTypeStopLimit {
		if request.StopPrice == nil {
			validation.PriceValid = false
			validation.Errors = append(validation.Errors, ValidationError{
				Field:   "stop_price",
				Code:    "STOP_PRICE_REQUIRED",
				Message: "Stop price is required for stop orders",
			})
		} else {
			if err := ov.validateStopPrice(*request.StopPrice, pair, validation); err != nil {
				return nil, err
			}
		}
	}

	// Validate price range
	if ov.validationRules.ValidatePriceRange {
		if err := ov.validatePriceRange(request, pair, validation); err != nil {
			return nil, err
		}
	}

	// Validate balance
	if ov.validationRules.ValidateBalance {
		if err := ov.validateBalance(userID, request, pair, validation); err != nil {
			return nil, err
		}
	}

	// Validate order size
	if ov.validationRules.ValidateOrderSize {
		if err := ov.validateOrderSize(request, pair, validation); err != nil {
			return nil, err
		}
	}

	// Validate risk limits
	if ov.validationRules.ValidateRiskLimits {
		if err := ov.validateRiskLimits(userID, request, pair, validation); err != nil {
			return nil, err
		}
	}

	// Validate market hours
	if ov.validationRules.ValidateMarketHours {
		if err := ov.validateMarketHours(validation); err != nil {
			return nil, err
		}
	}

	// Calculate estimated fees
	if err := ov.calculateEstimatedFees(request, pair, validation); err != nil {
		return nil, err
	}

	// Set overall validation result
	validation.BalanceSufficient = validation.BalanceSufficient && len(validation.Errors) == 0
	validation.PriceValid = validation.PriceValid && len(validation.Errors) == 0
	validation.QuantityValid = validation.QuantityValid && len(validation.Errors) == 0
	validation.TradingPairActive = validation.TradingPairActive && len(validation.Errors) == 0
	validation.WithinLimits = validation.WithinLimits && len(validation.Errors) == 0

	return validation, nil
}

// validateTradingPairStatus validates trading pair status
func (ov *OrderValidator) validateTradingPairStatus(pair *TradingPair, validation *OrderValidation) error {
	if pair.Status != "active" {
		validation.TradingPairActive = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "trading_pair",
			Code:    "TRADING_PAIR_INACTIVE",
			Message: fmt.Sprintf("Trading pair %s is %s", pair.Symbol, pair.Status),
			Value:   pair.Status,
		})
	}
	return nil
}

// validateOrderType validates order type
func (ov *OrderValidator) validateOrderType(orderType OrderType, validation *OrderValidation) error {
	if len(ov.riskLimits.AllowedOrderTypes) > 0 {
		allowed := false
		for _, allowedType := range ov.riskLimits.AllowedOrderTypes {
			if orderType == allowedType {
				allowed = true
				break
			}
		}
		if !allowed {
			validation.Errors = append(validation.Errors, ValidationError{
				Field:   "type",
				Code:    "ORDER_TYPE_NOT_ALLOWED",
				Message: fmt.Sprintf("Order type %s is not allowed", orderType),
				Value:   orderType,
			})
		}
	}
	return nil
}

// validateQuantity validates order quantity
func (ov *OrderValidator) validateQuantity(quantityStr string, pair *TradingPair, validation *OrderValidation) error {
	quantity, err := strconv.ParseFloat(quantityStr, 64)
	if err != nil {
		validation.QuantityValid = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "quantity",
			Code:    "INVALID_QUANTITY_FORMAT",
			Message: "Invalid quantity format",
			Value:   quantityStr,
		})
		return nil
	}

	if quantity <= 0 {
		validation.QuantityValid = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "quantity",
			Code:    "QUANTITY_TOO_SMALL",
			Message: "Quantity must be greater than 0",
			Value:   quantity,
		})
		return nil
	}

	// Check minimum order size
	minOrderSize := pair.MinOrderSize.GetFloat64()
	if quantity < minOrderSize {
		validation.QuantityValid = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "quantity",
			Code:    "QUANTITY_BELOW_MINIMUM",
			Message: fmt.Sprintf("Quantity below minimum order size of %f", minOrderSize),
			Value:   quantity,
		})
	}

	// Check maximum order size
	maxOrderSize := pair.MaxOrderSize.GetFloat64()
	if quantity > maxOrderSize {
		validation.QuantityValid = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "quantity",
			Code:    "QUANTITY_ABOVE_MAXIMUM",
			Message: fmt.Sprintf("Quantity above maximum order size of %f", maxOrderSize),
			Value:   quantity,
		})
	}

	// Check quantity increment
	increment := pair.QuantityIncrement.GetFloat64()
	if increment > 0 {
		remainder := math.Mod(quantity, increment)
		if remainder > 1e-8 { // Small tolerance for floating point
			validation.QuantityValid = false
			validation.Errors = append(validation.Errors, ValidationError{
				Field:   "quantity",
				Code:    "INVALID_QUANTITY_INCREMENT",
				Message: fmt.Sprintf("Quantity must be in increments of %f", increment),
				Value:   quantity,
			})
		}
	}

	return nil
}

// validatePrice validates order price
func (ov *OrderValidator) validatePrice(priceStr string, pair *TradingPair, validation *OrderValidation) error {
	price, err := strconv.ParseFloat(priceStr, 64)
	if err != nil {
		validation.PriceValid = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "price",
			Code:    "INVALID_PRICE_FORMAT",
			Message: "Invalid price format",
			Value:   priceStr,
		})
		return nil
	}

	if price <= 0 {
		validation.PriceValid = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "price",
			Code:    "PRICE_TOO_SMALL",
			Message: "Price must be greater than 0",
			Value:   price,
		})
		return nil
	}

	// Check price increment
	increment := pair.PriceIncrement.GetFloat64()
	if increment > 0 {
		remainder := math.Mod(price, increment)
		if remainder > 1e-8 { // Small tolerance for floating point
			validation.PriceValid = false
			validation.Errors = append(validation.Errors, ValidationError{
				Field:   "price",
				Code:    "INVALID_PRICE_INCREMENT",
				Message: fmt.Sprintf("Price must be in increments of %f", increment),
				Value:   price,
			})
		}
	}

	return nil
}

// validateStopPrice validates stop price
func (ov *OrderValidator) validateStopPrice(stopPriceStr string, pair *TradingPair, validation *OrderValidation) error {
	stopPrice, err := strconv.ParseFloat(stopPriceStr, 64)
	if err != nil {
		validation.PriceValid = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "stop_price",
			Code:    "INVALID_STOP_PRICE_FORMAT",
			Message: "Invalid stop price format",
			Value:   stopPriceStr,
		})
		return nil
	}

	if stopPrice <= 0 {
		validation.PriceValid = false
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "stop_price",
			Code:    "STOP_PRICE_TOO_SMALL",
			Message: "Stop price must be greater than 0",
			Value:   stopPrice,
		})
	}

	return nil
}

// validatePriceRange validates price against current market price
func (ov *OrderValidator) validatePriceRange(request CreateOrderRequest, pair *TradingPair, validation *OrderValidation) error {
	if ov.priceService == nil || ov.riskLimits.MaxPriceDeviation == 0 {
		return nil
	}

	lastPrice, err := ov.priceService.GetLastPrice(request.TradingPair)
	if err != nil {
		// If we can't get last price, add a warning but don't fail validation
		validation.Warnings = append(validation.Warnings, ValidationError{
			Field:   "price",
			Code:    "PRICE_SERVICE_UNAVAILABLE",
			Message: "Unable to validate price range - price service unavailable",
		})
		return nil
	}

	if request.Price != nil {
		price, _ := strconv.ParseFloat(*request.Price, 64)
		marketPrice := lastPrice.GetFloat64()
		deviation := math.Abs(price-marketPrice) / marketPrice

		if deviation > ov.riskLimits.MaxPriceDeviation {
			validation.PriceValid = false
			validation.Errors = append(validation.Errors, ValidationError{
				Field:   "price",
				Code:    "PRICE_DEVIATION_TOO_HIGH",
				Message: fmt.Sprintf("Price deviation of %.2f%% exceeds maximum allowed deviation of %.2f%%", 
					deviation*100, ov.riskLimits.MaxPriceDeviation*100),
				Value:   deviation,
			})
		}
	}

	return nil
}

// validateBalance validates user has sufficient balance
func (ov *OrderValidator) validateBalance(userID string, request CreateOrderRequest, pair *TradingPair, validation *OrderValidation) error {
	if ov.balanceService == nil {
		validation.Warnings = append(validation.Warnings, ValidationError{
			Field:   "balance",
			Code:    "BALANCE_SERVICE_UNAVAILABLE",
			Message: "Unable to validate balance - balance service unavailable",
		})
		return nil
	}

	var requiredToken Address
	var requiredAmount *big.Float

	if request.Side == OrderSideBuy {
		// For buy orders, check quote token balance
		requiredToken = pair.QuoteToken.Address
		quantity, _ := strconv.ParseFloat(request.Quantity, 64)
		
		if request.Type == OrderTypeMarket {
			// For market orders, estimate required amount based on order book
			orderBook, err := ov.priceService.GetOrderBook(request.TradingPair)
			if err == nil && len(orderBook.Asks) > 0 {
				estimatedPrice := orderBook.Asks[0].Price.GetFloat64()
				requiredAmount = big.NewFloat(quantity * estimatedPrice)
			} else {
				// Fallback to last price with buffer
				lastPrice, err := ov.priceService.GetLastPrice(request.TradingPair)
				if err == nil {
					requiredAmount = big.NewFloat(quantity * lastPrice.GetFloat64() * 1.05) // 5% buffer
				}
			}
		} else if request.Price != nil {
			price, _ := strconv.ParseFloat(*request.Price, 64)
			requiredAmount = big.NewFloat(quantity * price)
		}
	} else {
		// For sell orders, check base token balance
		requiredToken = pair.BaseToken.Address
		quantity, _ := strconv.ParseFloat(request.Quantity, 64)
		requiredAmount = big.NewFloat(quantity)
	}

	if requiredAmount != nil {
		balance, err := ov.balanceService.GetBalance(userID, requiredToken)
		if err != nil {
			validation.Warnings = append(validation.Warnings, ValidationError{
				Field:   "balance",
				Code:    "BALANCE_CHECK_FAILED",
				Message: "Unable to check balance",
			})
			return nil
		}

		availableBalance := big.NewFloat(balance.Available.GetFloat64())
		if availableBalance.Cmp(requiredAmount) < 0 {
			validation.BalanceSufficient = false
			validation.Errors = append(validation.Errors, ValidationError{
				Field:   "balance",
				Code:    "INSUFFICIENT_BALANCE",
				Message: fmt.Sprintf("Insufficient %s balance. Required: %s, Available: %s", 
					requiredToken.Value, requiredAmount.String(), availableBalance.String()),
			})
		}
	}

	return nil
}

// validateOrderSize validates order size against risk limits
func (ov *OrderValidator) validateOrderSize(request CreateOrderRequest, pair *TradingPair, validation *OrderValidation) error {
	if ov.riskLimits.MinOrderValue == nil && ov.riskLimits.MaxOrderValue == nil {
		return nil
	}

	var orderValue *big.Float

	if request.Type == OrderTypeMarket {
		// For market orders, estimate value based on last price
		if ov.priceService != nil {
			lastPrice, err := ov.priceService.GetLastPrice(request.TradingPair)
			if err == nil {
				quantity, _ := strconv.ParseFloat(request.Quantity, 64)
				orderValue = big.NewFloat(quantity * lastPrice.GetFloat64())
			}
		}
	} else if request.Price != nil {
		quantity, _ := strconv.ParseFloat(request.Quantity, 64)
		price, _ := strconv.ParseFloat(*request.Price, 64)
		orderValue = big.NewFloat(quantity * price)
	}

	if orderValue != nil {
		// Check minimum order value
		if ov.riskLimits.MinOrderValue != nil {
			minValue := big.NewFloat(ov.riskLimits.MinOrderValue.GetFloat64())
			if orderValue.Cmp(minValue) < 0 {
				validation.WithinLimits = false
				validation.Errors = append(validation.Errors, ValidationError{
					Field:   "order_value",
					Code:    "ORDER_VALUE_TOO_SMALL",
					Message: fmt.Sprintf("Order value %s below minimum of %s", 
						orderValue.String(), minValue.String()),
					Value:   orderValue.String(),
				})
			}
		}

		// Check maximum order value
		if ov.riskLimits.MaxOrderValue != nil {
			maxValue := big.NewFloat(ov.riskLimits.MaxOrderValue.GetFloat64())
			if orderValue.Cmp(maxValue) > 0 {
				validation.WithinLimits = false
				validation.Errors = append(validation.Errors, ValidationError{
					Field:   "order_value",
					Code:    "ORDER_VALUE_TOO_LARGE",
					Message: fmt.Sprintf("Order value %s exceeds maximum of %s", 
						orderValue.String(), maxValue.String()),
					Value:   orderValue.String(),
				})
			}
		}
	}

	return nil
}

// validateRiskLimits validates order against risk management limits
func (ov *OrderValidator) validateRiskLimits(userID string, request CreateOrderRequest, pair *TradingPair, validation *OrderValidation) error {
	// This would implement additional risk checks like:
	// - Maximum position size
	// - Daily volume limits
	// - Concentration limits
	// - VaR limits
	// etc.
	
	// For now, just check if confirmation is required
	if ov.riskLimits.RequireConfirmation {
		validation.Warnings = append(validation.Warnings, ValidationError{
			Field:   "confirmation",
			Code:    "CONFIRMATION_REQUIRED",
			Message: "This order requires manual confirmation due to risk limits",
		})
	}

	return nil
}

// validateMarketHours validates order is placed during market hours
func (ov *OrderValidator) validateMarketHours(validation *OrderValidation) error {
	if !ov.riskLimits.TradingHoursOnly {
		return nil
	}

	now := time.Now().UTC()
	hour := now.Hour()
	weekday := now.Weekday()

	// Example: Market hours Monday-Friday 9:00-17:00 UTC
	if weekday == time.Saturday || weekday == time.Sunday {
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "time",
			Code:    "MARKET_CLOSED_WEEKEND",
			Message: "Trading is not allowed on weekends",
		})
	} else if hour < 9 || hour >= 17 {
		validation.Errors = append(validation.Errors, ValidationError{
			Field:   "time",
			Code:    "MARKET_CLOSED_HOURS",
			Message: "Trading is only allowed during market hours (9:00-17:00 UTC)",
		})
	}

	return nil
}

// calculateEstimatedFees calculates estimated trading fees
func (ov *OrderValidator) calculateEstimatedFees(request CreateOrderRequest, pair *TradingPair, validation *OrderValidation) error {
	quantity, _ := strconv.ParseFloat(request.Quantity, 64)
	
	// Determine if this is a maker or taker order
	// For simplicity, assume limit orders are maker and market orders are taker
	var feeRate *DecimalAmount
	var feeType string
	
	if request.Type == OrderTypeMarket {
		feeRate = &pair.TakerFee
		feeType = "taker"
	} else {
		feeRate = &pair.MakerFee
		feeType = "maker"
	}

	// Calculate fee amount
	var feeAmount float64
	if request.Side == OrderSideBuy {
		// Buy orders: fee calculated on base token quantity
		feeAmount = quantity * feeRate.GetFloat64()
		validation.EstimatedFees = append(validation.EstimatedFees, TradeFee{
			Token:  pair.BaseToken.Address,
			Amount: DecimalAmount{Value: fmt.Sprintf("%.8f", feeAmount), Decimals: pair.BaseToken.Decimals},
			Type:   feeType,
		})
	} else {
		// Sell orders: fee calculated on quote token value
		if request.Price != nil {
			price, _ := strconv.ParseFloat(*request.Price, 64)
			feeAmount = quantity * price * feeRate.GetFloat64()
			validation.EstimatedFees = append(validation.EstimatedFees, TradeFee{
				Token:  pair.QuoteToken.Address,
				Amount: DecimalAmount{Value: fmt.Sprintf("%.8f", feeAmount), Decimals: pair.QuoteToken.Decimals},
				Type:   feeType,
			})
		}
	}

	return nil
}

// IsValid returns true if validation passed without errors
func (validation *OrderValidation) IsValid() bool {
	return len(validation.Errors) == 0
}

// HasWarnings returns true if validation has warnings
func (validation *OrderValidation) HasWarnings() bool {
	return len(validation.Warnings) > 0
}

// GetErrorMessages returns all error messages
func (validation *OrderValidation) GetErrorMessages() []string {
	messages := make([]string, len(validation.Errors))
	for i, err := range validation.Errors {
		messages[i] = err.Message
	}
	return messages
}

// GetWarningMessages returns all warning messages
func (validation *OrderValidation) GetWarningMessages() []string {
	messages := make([]string, len(validation.Warnings))
	for i, warning := range validation.Warnings {
		messages[i] = warning.Message
	}
	return messages
}