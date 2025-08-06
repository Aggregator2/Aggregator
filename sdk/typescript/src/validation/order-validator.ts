/**
 * @fileoverview Local order validation for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Comprehensive client-side validation to prevent invalid orders and improve user experience
 */

import {
  CreateOrderRequest,
  Order,
  TradingPair,
  Balance,
  Decimal,
  ValidationResult,
  ValidationError,
  OrderValidation,
  TradeFee,
  OrderSide,
  OrderType
} from '../types/api.js';

export interface ValidationContext {
  tradingPairs: Map<string, TradingPair>;
  balances: Map<string, Balance>;
  networkFees: {
    gasPrice: string;
    gasLimit: string;
  };
  riskLimits: {
    maxOrderValue: string;
    maxDailyVolume: string;
    maxOpenOrders: number;
  };
}

export interface OrderValidationOptions {
  skipBalanceCheck?: boolean;
  skipNetworkFeeEstimation?: boolean;
  allowPartialFills?: boolean;
  strictPriceValidation?: boolean;
}

/**
 * Comprehensive order validator with business logic validation
 */
export class OrderValidator {
  private readonly context: ValidationContext;

  constructor(context: ValidationContext) {
    this.context = context;
  }

  /**
   * Validate order creation request
   */
  async validateCreateOrder(
    request: CreateOrderRequest,
    options: OrderValidationOptions = {}
  ): Promise<OrderValidation> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Basic field validation
    const basicValidation = this.validateBasicFields(request);
    errors.push(...basicValidation.errors);

    // Trading pair validation
    const tradingPair = this.context.tradingPairs.get(request.tradingPair);
    if (!tradingPair) {
      errors.push({
        field: 'tradingPair',
        code: 'INVALID_TRADING_PAIR',
        message: `Trading pair ${request.tradingPair} not found`,
        value: request.tradingPair
      });
    } else {
      // Detailed trading pair validation
      const pairValidation = this.validateTradingPairRules(request, tradingPair);
      errors.push(...pairValidation.errors);
      warnings.push(...pairValidation.warnings);
    }

    // Balance validation
    let balanceSufficient = true;
    if (!options.skipBalanceCheck && tradingPair) {
      const balanceValidation = await this.validateBalance(request, tradingPair);
      balanceSufficient = balanceValidation.sufficient;
      errors.push(...balanceValidation.errors);
      warnings.push(...balanceValidation.warnings);
    }

    // Price validation
    const priceValidation = this.validatePriceRules(request, tradingPair);
    errors.push(...priceValidation.errors);
    warnings.push(...priceValidation.warnings);

    // Quantity validation
    const quantityValidation = this.validateQuantityRules(request, tradingPair);
    errors.push(...quantityValidation.errors);

    // Risk validation
    const riskValidation = await this.validateRiskLimits(request, tradingPair);
    errors.push(...riskValidation.errors);
    warnings.push(...riskValidation.warnings);

    // Estimate fees
    const estimatedFees = await this.estimateFees(request, tradingPair);

    // Estimate gas (if applicable)
    let estimatedGas: string | undefined;
    if (!options.skipNetworkFeeEstimation) {
      estimatedGas = await this.estimateGas(request, tradingPair);
    }

    return {
      balanceSufficient,
      priceValid: !errors.some(e => e.field === 'price'),
      quantityValid: !errors.some(e => e.field === 'quantity'),
      tradingPairActive: tradingPair?.status === 'active',
      withinLimits: !errors.some(e => e.code.startsWith('RISK_')),
      estimatedFees,
      estimatedGas,
      errors,
      warnings
    };
  }

  /**
   * Validate existing order for modifications
   */
  async validateOrderModification(
    order: Order,
    modifications: Partial<CreateOrderRequest>,
    options: OrderValidationOptions = {}
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    // Check if order can be modified
    if (!this.isOrderModifiable(order)) {
      errors.push({
        field: 'orderId',
        code: 'ORDER_NOT_MODIFIABLE',
        message: `Order with status ${order.status} cannot be modified`,
        value: order.id
      });
    }

    // Validate only the fields being modified
    const modificationRequest: CreateOrderRequest = {
      tradingPair: order.tradingPair.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity.value,
      price: 'price' in order ? (order as any).price?.value : undefined,
      ...modifications
    };

    const validation = await this.validateCreateOrder(modificationRequest, options);
    errors.push(...validation.errors);

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate basic required fields
   */
  private validateBasicFields(request: CreateOrderRequest): ValidationResult {
    const errors: ValidationError[] = [];

    // Required fields
    if (!request.tradingPair) {
      errors.push({
        field: 'tradingPair',
        code: 'REQUIRED_FIELD',
        message: 'Trading pair is required'
      });
    }

    if (!request.side) {
      errors.push({
        field: 'side',
        code: 'REQUIRED_FIELD',
        message: 'Order side is required'
      });
    } else if (!['buy', 'sell'].includes(request.side)) {
      errors.push({
        field: 'side',
        code: 'INVALID_VALUE',
        message: 'Order side must be "buy" or "sell"',
        value: request.side
      });
    }

    if (!request.type) {
      errors.push({
        field: 'type',
        code: 'REQUIRED_FIELD',
        message: 'Order type is required'
      });
    } else if (!['market', 'limit', 'stop', 'stop_limit'].includes(request.type)) {
      errors.push({
        field: 'type',
        code: 'INVALID_VALUE',
        message: 'Invalid order type',
        value: request.type
      });
    }

    if (!request.quantity) {
      errors.push({
        field: 'quantity',
        code: 'REQUIRED_FIELD',
        message: 'Quantity is required'
      });
    } else if (!this.isValidDecimal(request.quantity)) {
      errors.push({
        field: 'quantity',
        code: 'INVALID_DECIMAL',
        message: 'Quantity must be a valid decimal number',
        value: request.quantity
      });
    } else if (parseFloat(request.quantity) <= 0) {
      errors.push({
        field: 'quantity',
        code: 'INVALID_VALUE',
        message: 'Quantity must be greater than zero',
        value: request.quantity
      });
    }

    // Price validation for limit orders
    if (request.type === 'limit' || request.type === 'stop_limit') {
      if (!request.price) {
        errors.push({
          field: 'price',
          code: 'REQUIRED_FIELD',
          message: 'Price is required for limit orders'
        });
      } else if (!this.isValidDecimal(request.price)) {
        errors.push({
          field: 'price',
          code: 'INVALID_DECIMAL',
          message: 'Price must be a valid decimal number',
          value: request.price
        });
      } else if (parseFloat(request.price) <= 0) {
        errors.push({
          field: 'price',
          code: 'INVALID_VALUE',
          message: 'Price must be greater than zero',
          value: request.price
        });
      }
    }

    // Stop price validation for stop orders
    if (request.type === 'stop' || request.type === 'stop_limit') {
      if (!request.stopPrice) {
        errors.push({
          field: 'stopPrice',
          code: 'REQUIRED_FIELD',
          message: 'Stop price is required for stop orders'
        });
      } else if (!this.isValidDecimal(request.stopPrice)) {
        errors.push({
          field: 'stopPrice',
          code: 'INVALID_DECIMAL',
          message: 'Stop price must be a valid decimal number',
          value: request.stopPrice
        });
      } else if (parseFloat(request.stopPrice) <= 0) {
        errors.push({
          field: 'stopPrice',
          code: 'INVALID_VALUE',
          message: 'Stop price must be greater than zero',
          value: request.stopPrice
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate trading pair specific rules
   */
  private validateTradingPairRules(
    request: CreateOrderRequest,
    tradingPair: TradingPair
  ): { errors: ValidationError[]; warnings: ValidationError[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Check if trading pair is active
    if (tradingPair.status !== 'active') {
      errors.push({
        field: 'tradingPair',
        code: 'TRADING_PAIR_INACTIVE',
        message: `Trading pair ${tradingPair.symbol} is ${tradingPair.status}`,
        value: tradingPair.status
      });
    }

    // Validate quantity increments
    const quantity = parseFloat(request.quantity);
    const quantityIncrement = parseFloat(tradingPair.quantityIncrement.value);
    
    if (quantity % quantityIncrement !== 0) {
      errors.push({
        field: 'quantity',
        code: 'INVALID_INCREMENT',
        message: `Quantity must be a multiple of ${tradingPair.quantityIncrement.value}`,
        value: request.quantity
      });
    }

    // Validate min/max order size
    const minOrderSize = parseFloat(tradingPair.minOrderSize.value);
    const maxOrderSize = parseFloat(tradingPair.maxOrderSize.value);

    if (quantity < minOrderSize) {
      errors.push({
        field: 'quantity',
        code: 'BELOW_MIN_SIZE',
        message: `Quantity must be at least ${tradingPair.minOrderSize.value}`,
        value: request.quantity
      });
    }

    if (quantity > maxOrderSize) {
      errors.push({
        field: 'quantity',
        code: 'ABOVE_MAX_SIZE',
        message: `Quantity cannot exceed ${tradingPair.maxOrderSize.value}`,
        value: request.quantity
      });
    }

    // Validate price increments for limit orders
    if (request.price) {
      const price = parseFloat(request.price);
      const priceIncrement = parseFloat(tradingPair.priceIncrement.value);
      
      if (price % priceIncrement !== 0) {
        errors.push({
          field: 'price',
          code: 'INVALID_INCREMENT',
          message: `Price must be a multiple of ${tradingPair.priceIncrement.value}`,
          value: request.price
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate balance sufficiency
   */
  private async validateBalance(
    request: CreateOrderRequest,
    tradingPair: TradingPair
  ): Promise<{ sufficient: boolean; errors: ValidationError[]; warnings: ValidationError[] }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Determine required token and amount
    const { tokenAddress, requiredAmount } = this.calculateRequiredBalance(request, tradingPair);

    // Get user balance
    const balance = this.context.balances.get(tokenAddress);
    if (!balance) {
      errors.push({
        field: 'balance',
        code: 'BALANCE_NOT_FOUND',
        message: `Balance not found for token ${tokenAddress}`,
        value: tokenAddress
      });
      return { sufficient: false, errors, warnings };
    }

    const availableBalance = parseFloat(balance.available.value);
    const required = parseFloat(requiredAmount);

    if (availableBalance < required) {
      errors.push({
        field: 'balance',
        code: 'INSUFFICIENT_BALANCE',
        message: `Insufficient balance. Required: ${requiredAmount}, Available: ${balance.available.value}`,
        value: {
          required: requiredAmount,
          available: balance.available.value
        }
      });
      return { sufficient: false, errors, warnings };
    }

    // Warning if using a large percentage of balance
    const utilizationRatio = required / availableBalance;
    if (utilizationRatio > 0.9) {
      warnings.push({
        field: 'balance',
        code: 'HIGH_BALANCE_UTILIZATION',
        message: `Using ${(utilizationRatio * 100).toFixed(1)}% of available balance`,
        value: utilizationRatio
      });
    }

    return { sufficient: true, errors, warnings };
  }

  /**
   * Validate price rules and market conditions
   */
  private validatePriceRules(
    request: CreateOrderRequest,
    tradingPair?: TradingPair
  ): { errors: ValidationError[]; warnings: ValidationError[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    if (!request.price || !tradingPair) {
      return { errors, warnings };
    }

    const price = parseFloat(request.price);

    // Stop price validation for stop orders
    if (request.stopPrice) {
      const stopPrice = parseFloat(request.stopPrice);
      
      if (request.type === 'stop_limit') {
        // For buy stop-limit: stop price should be above current market
        // For sell stop-limit: stop price should be below current market
        if (request.side === 'buy' && price > stopPrice) {
          warnings.push({
            field: 'price',
            code: 'UNUSUAL_PRICE_RELATIONSHIP',
            message: 'Limit price is above stop price for buy order',
            value: { price: request.price, stopPrice: request.stopPrice }
          });
        } else if (request.side === 'sell' && price < stopPrice) {
          warnings.push({
            field: 'price',
            code: 'UNUSUAL_PRICE_RELATIONSHIP',
            message: 'Limit price is below stop price for sell order',
            value: { price: request.price, stopPrice: request.stopPrice }
          });
        }
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate quantity rules
   */
  private validateQuantityRules(
    request: CreateOrderRequest,
    tradingPair?: TradingPair
  ): { errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    if (!tradingPair) {
      return { errors };
    }

    const quantity = parseFloat(request.quantity);

    // Check against trading pair limits (already done in validateTradingPairRules)
    // Additional business logic can be added here

    return { errors };
  }

  /**
   * Validate risk limits
   */
  private async validateRiskLimits(
    request: CreateOrderRequest,
    tradingPair?: TradingPair
  ): Promise<{ errors: ValidationError[]; warnings: ValidationError[] }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    if (!tradingPair || !request.price) {
      return { errors, warnings };
    }

    const orderValue = parseFloat(request.quantity) * parseFloat(request.price);
    const maxOrderValue = parseFloat(this.context.riskLimits.maxOrderValue);

    // Check maximum order value
    if (orderValue > maxOrderValue) {
      errors.push({
        field: 'quantity',
        code: 'RISK_ORDER_VALUE_EXCEEDED',
        message: `Order value ${orderValue.toFixed(2)} exceeds maximum allowed ${maxOrderValue}`,
        value: orderValue
      });
    }

    // Warning for large orders
    if (orderValue > maxOrderValue * 0.5) {
      warnings.push({
        field: 'quantity',
        code: 'RISK_LARGE_ORDER',
        message: `Large order detected: ${orderValue.toFixed(2)} ${tradingPair.quoteToken.symbol}`,
        value: orderValue
      });
    }

    return { errors, warnings };
  }

  /**
   * Estimate trading fees
   */
  private async estimateFees(
    request: CreateOrderRequest,
    tradingPair?: TradingPair
  ): Promise<TradeFee[]> {
    if (!tradingPair || !request.price) {
      return [];
    }

    const quantity = parseFloat(request.quantity);
    const price = parseFloat(request.price);
    const orderValue = quantity * price;

    // Assume taker fee for market orders, maker fee for limit orders
    const feeRate = request.type === 'market' 
      ? parseFloat(tradingPair.takerFee.value)
      : parseFloat(tradingPair.makerFee.value);

    const feeAmount = orderValue * feeRate;

    return [{
      token: tradingPair.quoteToken.address,
      amount: {
        value: feeAmount.toString(),
        decimals: tradingPair.quoteToken.decimals
      },
      type: request.type === 'market' ? 'taker' : 'maker'
    }];
  }

  /**
   * Estimate gas cost for transaction
   */
  private async estimateGas(
    request: CreateOrderRequest,
    tradingPair?: TradingPair
  ): Promise<string> {
    // Simplified gas estimation
    // In production, this would call the blockchain for accurate estimates
    
    const baseGas = 21000; // Base transaction cost
    const orderGas = 50000; // Additional gas for order creation
    const totalGas = baseGas + orderGas;

    const gasPrice = parseFloat(this.context.networkFees.gasPrice);
    const gasCost = totalGas * gasPrice;

    return gasCost.toString();
  }

  /**
   * Calculate required balance for order
   */
  private calculateRequiredBalance(
    request: CreateOrderRequest,
    tradingPair: TradingPair
  ): { tokenAddress: string; requiredAmount: string } {
    const quantity = parseFloat(request.quantity);

    if (request.side === 'buy') {
      // For buy orders, need quote token (e.g., USDT to buy ETH)
      if (!request.price) {
        throw new Error('Price required for buy order balance calculation');
      }
      const price = parseFloat(request.price);
      const requiredAmount = quantity * price;
      
      return {
        tokenAddress: tradingPair.quoteToken.address.value,
        requiredAmount: requiredAmount.toString()
      };
    } else {
      // For sell orders, need base token (e.g., ETH to sell for USDT)
      return {
        tokenAddress: tradingPair.baseToken.address.value,
        requiredAmount: quantity.toString()
      };
    }
  }

  /**
   * Check if order can be modified
   */
  private isOrderModifiable(order: Order): boolean {
    return ['pending', 'open', 'partially_filled'].includes(order.status);
  }

  /**
   * Validate decimal string format
   */
  private isValidDecimal(value: string): boolean {
    // Check basic type and null/undefined
    if (typeof value !== 'string' || !value || value.trim() === '') {
      return false;
    }
    
    // Trim whitespace
    value = value.trim();
    
    // Check for basic decimal format (positive numbers only for trading)
    const decimalRegex = /^\d+(\.\d+)?$/;
    if (!decimalRegex.test(value)) {
      return false;
    }
    
    // Check for leading zeros (except for values < 1)
    if (/^0\d+/.test(value) && !value.startsWith('0.')) {
      return false;
    }
    
    // Check for scientific notation (not allowed)
    if (value.toLowerCase().includes('e')) {
      return false;
    }
    
    // Parse and validate numeric value
    const num = parseFloat(value);
    if (!Number.isFinite(num) || num < 0) {
      return false;
    }
    
    // Check for reasonable bounds
    if (num > Number.MAX_SAFE_INTEGER) {
      return false;
    }
    
    // Check decimal places (max 18 for financial precision)
    const decimalPart = value.split('.')[1];
    if (decimalPart && decimalPart.length > 18) {
      return false;
    }
    
    return true;
  }

  /**
   * Update validation context
   */
  updateContext(updates: Partial<ValidationContext>): void {
    if (updates.tradingPairs) {
      this.context.tradingPairs = updates.tradingPairs;
    }
    if (updates.balances) {
      this.context.balances = updates.balances;
    }
    if (updates.networkFees) {
      this.context.networkFees = { ...this.context.networkFees, ...updates.networkFees };
    }
    if (updates.riskLimits) {
      this.context.riskLimits = { ...this.context.riskLimits, ...updates.riskLimits };
    }
  }
}

/**
 * Utility functions for order validation
 */
export const OrderValidationUtils = {
  /**
   * Check if order is valid for the current market conditions
   */
  isOrderPriceReasonable(order: CreateOrderRequest, marketPrice: number, tolerance = 0.1): boolean {
    if (!order.price) return true; // Market orders are always reasonable
    
    const orderPrice = parseFloat(order.price);
    const priceDiff = Math.abs(orderPrice - marketPrice) / marketPrice;
    
    return priceDiff <= tolerance;
  },

  /**
   * Calculate order impact on portfolio
   */
  calculatePortfolioImpact(
    order: CreateOrderRequest,
    tradingPair: TradingPair,
    currentPortfolio: Balance[]
  ): { newAllocation: number; riskIncrease: number } {
    // Simplified portfolio impact calculation
    const totalPortfolioValue = currentPortfolio.reduce(
      (sum, balance) => sum + parseFloat(balance.total.value),
      0
    );

    const orderValue = order.price 
      ? parseFloat(order.quantity) * parseFloat(order.price)
      : 0;

    const newAllocation = orderValue / totalPortfolioValue;
    const riskIncrease = newAllocation > 0.1 ? newAllocation - 0.1 : 0;

    return { newAllocation, riskIncrease };
  },

  /**
   * Suggest optimal order parameters
   */
  suggestOrderOptimization(
    order: CreateOrderRequest,
    tradingPair: TradingPair,
    marketData: { price: number; volume: number; spread: number }
  ): {
    suggestedPrice?: string;
    suggestedQuantity?: string;
    reasoning: string;
  } {
    const suggestions: string[] = [];
    let suggestedPrice = order.price;
    let suggestedQuantity = order.quantity;

    // Price optimization for limit orders
    if (order.type === 'limit' && order.price) {
      const orderPrice = parseFloat(order.price);
      const marketPrice = marketData.price;
      const spread = marketData.spread;

      if (order.side === 'buy' && orderPrice > marketPrice - spread / 2) {
        suggestedPrice = (marketPrice - spread / 2).toString();
        suggestions.push('Adjusted buy price to improve execution probability');
      } else if (order.side === 'sell' && orderPrice < marketPrice + spread / 2) {
        suggestedPrice = (marketPrice + spread / 2).toString();
        suggestions.push('Adjusted sell price to improve execution probability');
      }
    }

    // Quantity optimization based on market volume
    const orderValue = order.price ? parseFloat(order.quantity) * parseFloat(order.price) : 0;
    const marketVolume = marketData.volume;
    
    if (orderValue > marketVolume * 0.1) {
      const optimizedQuantity = (marketVolume * 0.05) / parseFloat(order.price || '1');
      suggestedQuantity = optimizedQuantity.toString();
      suggestions.push('Reduced quantity to minimize market impact');
    }

    return {
      suggestedPrice: suggestedPrice !== order.price ? suggestedPrice : undefined,
      suggestedQuantity: suggestedQuantity !== order.quantity ? suggestedQuantity : undefined,
      reasoning: suggestions.join('; ')
    };
  }
};