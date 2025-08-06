"""
Local order validation for SwappiQ Protocol
Author: SwappiQ Protocol
Description: Comprehensive client-side validation to prevent invalid orders and improve user experience
"""

import re
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

from .types import (
    CreateOrderRequest, Order, TradingPair, Balance, DecimalAmount,
    ValidationResult, ValidationError, OrderValidation, TradeFee,
    OrderSide, OrderType, OrderStatus, Network
)

@dataclass
class ValidationContext:
    trading_pairs: Dict[str, TradingPair]
    balances: Dict[str, Balance]
    network_fees: Dict[str, str]  # gasPrice, gasLimit
    risk_limits: Dict[str, any]  # maxOrderValue, maxDailyVolume, maxOpenOrders

@dataclass
class OrderValidationOptions:
    skip_balance_check: bool = False
    skip_network_fee_estimation: bool = False
    allow_partial_fills: bool = True
    strict_price_validation: bool = False

class OrderValidator:
    """Comprehensive order validator with business logic validation"""
    
    def __init__(self, context: ValidationContext):
        self.context = context
    
    async def validate_create_order(self, 
                                  request: CreateOrderRequest,
                                  options: Optional[OrderValidationOptions] = None) -> OrderValidation:
        """Validate order creation request"""
        if options is None:
            options = OrderValidationOptions()
            
        errors: List[ValidationError] = []
        warnings: List[ValidationError] = []
        
        # Basic field validation
        basic_validation = self._validate_basic_fields(request)
        errors.extend(basic_validation.errors)
        
        # Trading pair validation
        trading_pair = self.context.trading_pairs.get(request.trading_pair)
        if not trading_pair:
            errors.append(ValidationError(
                field='trading_pair',
                code='INVALID_TRADING_PAIR',
                message=f'Trading pair {request.trading_pair} not found',
                value=request.trading_pair
            ))
        else:
            # Detailed trading pair validation
            pair_validation = self._validate_trading_pair_rules(request, trading_pair)
            errors.extend(pair_validation[0])
            warnings.extend(pair_validation[1])
        
        # Balance validation
        balance_sufficient = True
        if not options.skip_balance_check and trading_pair:
            balance_validation = await self._validate_balance(request, trading_pair)
            balance_sufficient = balance_validation[0]
            errors.extend(balance_validation[1])
            warnings.extend(balance_validation[2])
        
        # Price validation
        price_validation = self._validate_price_rules(request, trading_pair)
        errors.extend(price_validation[0])
        warnings.extend(price_validation[1])
        
        # Quantity validation
        quantity_validation = self._validate_quantity_rules(request, trading_pair)
        errors.extend(quantity_validation)
        
        # Risk validation
        risk_validation = await self._validate_risk_limits(request, trading_pair)
        errors.extend(risk_validation[0])
        warnings.extend(risk_validation[1])
        
        # Estimate fees
        estimated_fees = await self._estimate_fees(request, trading_pair)
        
        # Estimate gas (if applicable)
        estimated_gas = None
        if not options.skip_network_fee_estimation:
            estimated_gas = await self._estimate_gas(request, trading_pair)
        
        return OrderValidation(
            balance_sufficient=balance_sufficient,
            price_valid=not any(e.field == 'price' for e in errors),
            quantity_valid=not any(e.field == 'quantity' for e in errors),
            trading_pair_active=trading_pair.status == 'active' if trading_pair else False,
            within_limits=not any(e.code.startswith('RISK_') for e in errors),
            estimated_fees=estimated_fees,
            estimated_gas=estimated_gas,
            errors=errors,
            warnings=warnings
        )
    
    async def validate_order_modification(self,
                                        order: Order,
                                        modifications: Dict[str, any],
                                        options: Optional[OrderValidationOptions] = None) -> ValidationResult:
        """Validate existing order for modifications"""
        errors: List[ValidationError] = []
        
        # Check if order can be modified
        if not self._is_order_modifiable(order):
            errors.append(ValidationError(
                field='order_id',
                code='ORDER_NOT_MODIFIABLE',
                message=f'Order with status {order.status.value} cannot be modified',
                value=order.id
            ))
        
        # Validate only the fields being modified
        if errors:
            return ValidationResult(valid=False, errors=errors)
        
        # Create a modified order request for validation
        modification_request = CreateOrderRequest(
            trading_pair=order.trading_pair,
            side=order.side,
            type=order.type,
            quantity=str(order.quantity.value),
            price=str(order.price.value) if hasattr(order, 'price') and order.price else None,
            **modifications
        )
        
        validation = await self.validate_create_order(modification_request, options)
        
        return ValidationResult(
            valid=len(validation.errors) == 0,
            errors=validation.errors
        )
    
    def _validate_basic_fields(self, request: CreateOrderRequest) -> ValidationResult:
        """Validate basic required fields"""
        errors: List[ValidationError] = []
        
        # Required fields
        if not request.trading_pair:
            errors.append(ValidationError(
                field='trading_pair',
                code='REQUIRED_FIELD',
                message='Trading pair is required'
            ))
        
        if not request.side:
            errors.append(ValidationError(
                field='side',
                code='REQUIRED_FIELD',
                message='Order side is required'
            ))
        elif request.side not in [OrderSide.BUY, OrderSide.SELL]:
            errors.append(ValidationError(
                field='side',
                code='INVALID_VALUE',
                message='Order side must be "buy" or "sell"',
                value=request.side
            ))
        
        if not request.type:
            errors.append(ValidationError(
                field='type',
                code='REQUIRED_FIELD',
                message='Order type is required'
            ))
        elif request.type not in [OrderType.MARKET, OrderType.LIMIT, OrderType.STOP, OrderType.STOP_LIMIT]:
            errors.append(ValidationError(
                field='type',
                code='INVALID_VALUE',
                message='Invalid order type',
                value=request.type
            ))
        
        if not request.quantity:
            errors.append(ValidationError(
                field='quantity',
                code='REQUIRED_FIELD',
                message='Quantity is required'
            ))
        elif not self._is_valid_decimal(request.quantity):
            errors.append(ValidationError(
                field='quantity',
                code='INVALID_DECIMAL',
                message='Quantity must be a valid decimal number',
                value=request.quantity
            ))
        elif Decimal(request.quantity) <= 0:
            errors.append(ValidationError(
                field='quantity',
                code='INVALID_VALUE',
                message='Quantity must be greater than zero',
                value=request.quantity
            ))
        
        # Price validation for limit orders
        if request.type in [OrderType.LIMIT, OrderType.STOP_LIMIT]:
            if not request.price:
                errors.append(ValidationError(
                    field='price',
                    code='REQUIRED_FIELD',
                    message='Price is required for limit orders'
                ))
            elif not self._is_valid_decimal(request.price):
                errors.append(ValidationError(
                    field='price',
                    code='INVALID_DECIMAL',
                    message='Price must be a valid decimal number',
                    value=request.price
                ))
            elif Decimal(request.price) <= 0:
                errors.append(ValidationError(
                    field='price',
                    code='INVALID_VALUE',
                    message='Price must be greater than zero',
                    value=request.price
                ))
        
        # Stop price validation for stop orders
        if request.type in [OrderType.STOP, OrderType.STOP_LIMIT]:
            if not request.stop_price:
                errors.append(ValidationError(
                    field='stop_price',
                    code='REQUIRED_FIELD',
                    message='Stop price is required for stop orders'
                ))
            elif not self._is_valid_decimal(request.stop_price):
                errors.append(ValidationError(
                    field='stop_price',
                    code='INVALID_DECIMAL',
                    message='Stop price must be a valid decimal number',
                    value=request.stop_price
                ))
            elif Decimal(request.stop_price) <= 0:
                errors.append(ValidationError(
                    field='stop_price',
                    code='INVALID_VALUE',
                    message='Stop price must be greater than zero',
                    value=request.stop_price
                ))
        
        return ValidationResult(valid=len(errors) == 0, errors=errors)
    
    def _validate_trading_pair_rules(self, 
                                   request: CreateOrderRequest,
                                   trading_pair: TradingPair) -> Tuple[List[ValidationError], List[ValidationError]]:
        """Validate trading pair specific rules"""
        errors: List[ValidationError] = []
        warnings: List[ValidationError] = []
        
        # Check if trading pair is active
        if trading_pair.status != 'active':
            errors.append(ValidationError(
                field='trading_pair',
                code='TRADING_PAIR_INACTIVE',
                message=f'Trading pair {trading_pair.symbol} is {trading_pair.status}',
                value=trading_pair.status
            ))
        
        # Validate quantity increments
        quantity = Decimal(request.quantity)
        quantity_increment = Decimal(trading_pair.quantity_increment.value)
        
        if quantity % quantity_increment != 0:
            errors.append(ValidationError(
                field='quantity',
                code='INVALID_INCREMENT',
                message=f'Quantity must be a multiple of {trading_pair.quantity_increment.value}',
                value=request.quantity
            ))
        
        # Validate min/max order size
        min_order_size = Decimal(trading_pair.min_order_size.value)
        max_order_size = Decimal(trading_pair.max_order_size.value)
        
        if quantity < min_order_size:
            errors.append(ValidationError(
                field='quantity',
                code='BELOW_MIN_SIZE',
                message=f'Quantity must be at least {trading_pair.min_order_size.value}',
                value=request.quantity
            ))
        
        if quantity > max_order_size:
            errors.append(ValidationError(
                field='quantity',
                code='ABOVE_MAX_SIZE',
                message=f'Quantity cannot exceed {trading_pair.max_order_size.value}',
                value=request.quantity
            ))
        
        # Validate price increments for limit orders
        if request.price:
            price = Decimal(request.price)
            price_increment = Decimal(trading_pair.price_increment.value)
            
            if price % price_increment != 0:
                errors.append(ValidationError(
                    field='price',
                    code='INVALID_INCREMENT',
                    message=f'Price must be a multiple of {trading_pair.price_increment.value}',
                    value=request.price
                ))
        
        return errors, warnings
    
    async def _validate_balance(self,
                              request: CreateOrderRequest,
                              trading_pair: TradingPair) -> Tuple[bool, List[ValidationError], List[ValidationError]]:
        """Validate balance sufficiency"""
        errors: List[ValidationError] = []
        warnings: List[ValidationError] = []
        
        # Determine required token and amount
        token_address, required_amount = self._calculate_required_balance(request, trading_pair)
        
        # Get user balance
        balance = self.context.balances.get(token_address)
        if not balance:
            errors.append(ValidationError(
                field='balance',
                code='BALANCE_NOT_FOUND',
                message=f'Balance not found for token {token_address}',
                value=token_address
            ))
            return False, errors, warnings
        
        available_balance = Decimal(balance.available.value)
        required = Decimal(required_amount)
        
        if available_balance < required:
            errors.append(ValidationError(
                field='balance',
                code='INSUFFICIENT_BALANCE',
                message=f'Insufficient balance. Required: {required_amount}, Available: {balance.available.value}',
                value={
                    'required': required_amount,
                    'available': balance.available.value
                }
            ))
            return False, errors, warnings
        
        # Warning if using a large percentage of balance
        utilization_ratio = float(required / available_balance)
        if utilization_ratio > 0.9:
            warnings.append(ValidationError(
                field='balance',
                code='HIGH_BALANCE_UTILIZATION',
                message=f'Using {utilization_ratio * 100:.1f}% of available balance',
                value=utilization_ratio
            ))
        
        return True, errors, warnings
    
    def _validate_price_rules(self,
                            request: CreateOrderRequest,
                            trading_pair: Optional[TradingPair]) -> Tuple[List[ValidationError], List[ValidationError]]:
        """Validate price rules and market conditions"""
        errors: List[ValidationError] = []
        warnings: List[ValidationError] = []
        
        if not request.price or not trading_pair:
            return errors, warnings
        
        price = Decimal(request.price)
        
        # Stop price validation for stop orders
        if request.stop_price:
            stop_price = Decimal(request.stop_price)
            
            if request.type == OrderType.STOP_LIMIT:
                # For buy stop-limit: stop price should be above current market
                # For sell stop-limit: stop price should be below current market
                if request.side == OrderSide.BUY and price > stop_price:
                    warnings.append(ValidationError(
                        field='price',
                        code='UNUSUAL_PRICE_RELATIONSHIP',
                        message='Limit price is above stop price for buy order',
                        value={'price': request.price, 'stop_price': request.stop_price}
                    ))
                elif request.side == OrderSide.SELL and price < stop_price:
                    warnings.append(ValidationError(
                        field='price',
                        code='UNUSUAL_PRICE_RELATIONSHIP',
                        message='Limit price is below stop price for sell order',
                        value={'price': request.price, 'stop_price': request.stop_price}
                    ))
        
        return errors, warnings
    
    def _validate_quantity_rules(self,
                               request: CreateOrderRequest,
                               trading_pair: Optional[TradingPair]) -> List[ValidationError]:
        """Validate quantity rules"""
        errors: List[ValidationError] = []
        
        if not trading_pair:
            return errors
        
        # Additional business logic can be added here
        
        return errors
    
    async def _validate_risk_limits(self,
                                  request: CreateOrderRequest,
                                  trading_pair: Optional[TradingPair]) -> Tuple[List[ValidationError], List[ValidationError]]:
        """Validate risk limits"""
        errors: List[ValidationError] = []
        warnings: List[ValidationError] = []
        
        if not trading_pair or not request.price:
            return errors, warnings
        
        order_value = Decimal(request.quantity) * Decimal(request.price)
        max_order_value = Decimal(self.context.risk_limits.get('maxOrderValue', '100000'))
        
        # Check maximum order value
        if order_value > max_order_value:
            errors.append(ValidationError(
                field='quantity',
                code='RISK_ORDER_VALUE_EXCEEDED',
                message=f'Order value {order_value} exceeds maximum allowed {max_order_value}',
                value=float(order_value)
            ))
        
        # Warning for large orders
        if order_value > max_order_value * Decimal('0.5'):
            warnings.append(ValidationError(
                field='quantity',
                code='RISK_LARGE_ORDER',
                message=f'Large order detected: {order_value} {trading_pair.quote_token.symbol}',
                value=float(order_value)
            ))
        
        return errors, warnings
    
    async def _estimate_fees(self,
                           request: CreateOrderRequest,
                           trading_pair: Optional[TradingPair]) -> List[TradeFee]:
        """Estimate trading fees"""
        if not trading_pair or not request.price:
            return []
        
        quantity = Decimal(request.quantity)
        price = Decimal(request.price)
        order_value = quantity * price
        
        # Assume taker fee for market orders, maker fee for limit orders
        fee_rate = trading_pair.taker_fee if request.type == OrderType.MARKET else trading_pair.maker_fee
        fee_amount = order_value * Decimal(fee_rate.value)
        
        return [TradeFee(
            token=trading_pair.quote_token.address,
            amount=DecimalAmount(value=str(fee_amount), decimals=trading_pair.quote_token.decimals),
            type='taker' if request.type == OrderType.MARKET else 'maker'
        )]
    
    async def _estimate_gas(self,
                          request: CreateOrderRequest,
                          trading_pair: Optional[TradingPair]) -> Optional[str]:
        """Estimate gas cost for transaction"""
        # Simplified gas estimation
        # In production, this would call the blockchain for accurate estimates
        
        base_gas = 21000  # Base transaction cost
        order_gas = 50000  # Additional gas for order creation
        total_gas = base_gas + order_gas
        
        gas_price = Decimal(self.context.network_fees.get('gasPrice', '20000000000'))
        gas_cost = total_gas * gas_price
        
        return str(gas_cost)
    
    def _calculate_required_balance(self,
                                  request: CreateOrderRequest,
                                  trading_pair: TradingPair) -> Tuple[str, str]:
        """Calculate required balance for order"""
        quantity = Decimal(request.quantity)
        
        if request.side == OrderSide.BUY:
            # For buy orders, need quote token (e.g., USDT to buy ETH)
            if not request.price:
                raise ValueError('Price required for buy order balance calculation')
            price = Decimal(request.price)
            required_amount = quantity * price
            
            return trading_pair.quote_token.address.value, str(required_amount)
        else:
            # For sell orders, need base token (e.g., ETH to sell for USDT)
            return trading_pair.base_token.address.value, str(quantity)
    
    def _is_order_modifiable(self, order: Order) -> bool:
        """Check if order can be modified"""
        return order.status in [OrderStatus.PENDING, OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED]
    
    def _is_valid_decimal(self, value: str) -> bool:
        """Validate decimal string format"""
        try:
            Decimal(value)
            return True
        except (InvalidOperation, ValueError, TypeError):
            return False
    
    def update_context(self, updates: Dict[str, any]) -> None:
        """Update validation context"""
        if 'trading_pairs' in updates:
            self.context.trading_pairs = updates['trading_pairs']
        if 'balances' in updates:
            self.context.balances = updates['balances']
        if 'network_fees' in updates:
            self.context.network_fees = {**self.context.network_fees, **updates['network_fees']}
        if 'risk_limits' in updates:
            self.context.risk_limits = {**self.context.risk_limits, **updates['risk_limits']}

class OrderValidationUtils:
    """Utility functions for order validation"""
    
    @staticmethod
    def is_order_price_reasonable(order: CreateOrderRequest, market_price: float, tolerance: float = 0.1) -> bool:
        """Check if order is valid for the current market conditions"""
        if not order.price:
            return True  # Market orders are always reasonable
        
        order_price = float(order.price)
        price_diff = abs(order_price - market_price) / market_price
        
        return price_diff <= tolerance
    
    @staticmethod
    def calculate_portfolio_impact(order: CreateOrderRequest,
                                 trading_pair: TradingPair,
                                 current_portfolio: List[Balance]) -> Dict[str, float]:
        """Calculate order impact on portfolio"""
        total_portfolio_value = sum(float(balance.total.value) for balance in current_portfolio)
        
        order_value = 0.0
        if order.price:
            order_value = float(order.quantity) * float(order.price)
        
        new_allocation = order_value / total_portfolio_value if total_portfolio_value > 0 else 0
        risk_increase = max(0, new_allocation - 0.1)
        
        return {'new_allocation': new_allocation, 'risk_increase': risk_increase}
    
    @staticmethod
    def suggest_order_optimization(order: CreateOrderRequest,
                                 trading_pair: TradingPair,
                                 market_data: Dict[str, float]) -> Dict[str, any]:
        """Suggest optimal order parameters"""
        suggestions = []
        suggested_price = order.price
        suggested_quantity = order.quantity
        
        # Price optimization for limit orders
        if order.type == OrderType.LIMIT and order.price:
            order_price = float(order.price)
            market_price = market_data.get('price', 0)
            spread = market_data.get('spread', 0)
            
            if order.side == OrderSide.BUY and order_price > market_price - spread / 2:
                suggested_price = str(market_price - spread / 2)
                suggestions.append('Adjusted buy price to improve execution probability')
            elif order.side == OrderSide.SELL and order_price < market_price + spread / 2:
                suggested_price = str(market_price + spread / 2)
                suggestions.append('Adjusted sell price to improve execution probability')
        
        # Quantity optimization based on market volume
        if order.price:
            order_value = float(order.quantity) * float(order.price)
            market_volume = market_data.get('volume', 0)
            
            if order_value > market_volume * 0.1:
                optimized_quantity = (market_volume * 0.05) / float(order.price)
                suggested_quantity = str(optimized_quantity)
                suggestions.append('Reduced quantity to minimize market impact')
        
        return {
            'suggested_price': suggested_price if suggested_price != order.price else None,
            'suggested_quantity': suggested_quantity if suggested_quantity != order.quantity else None,
            'reasoning': '; '.join(suggestions)
        }