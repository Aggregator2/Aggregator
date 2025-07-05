import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { BadRequestError } from './errorHandler';

// Validation locations
export enum ValidationSource {
  BODY = 'body',
  QUERY = 'query',
  PARAMS = 'params',
  HEADERS = 'headers'
}

// Validation middleware factory
export const validate = (
  schema: Joi.ObjectSchema,
  source: ValidationSource = ValidationSource.BODY
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const data = req[source];
    
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      convert: true
    });

    if (error) {
      const errorMessage = error.details
        .map(detail => detail.message)
        .join(', ');
      
      next(new BadRequestError(errorMessage, 'VALIDATION_ERROR'));
      return;
    }

    // Replace request data with validated and sanitized value
    req[source] = value;
    next();
  };
};

// Common validation schemas
export const commonSchemas = {
  // Pagination query params
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string(),
    order: Joi.string().valid('asc', 'desc').default('asc')
  }),

  // UUID validation
  uuid: Joi.string().uuid({ version: 'uuidv4' }),

  // Date range validation
  dateRange: Joi.object({
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().greater(Joi.ref('startDate'))
  }),

  // Address validation (blockchain)
  address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/),

  // Transaction hash validation
  txHash: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/),

  // Amount validation (positive number with decimals)
  amount: Joi.string().pattern(/^\d+(\.\d+)?$/),

  // Trading pair validation
  tradingPair: Joi.string().pattern(/^[A-Z]+\/[A-Z]+$/),

  // Order side validation
  orderSide: Joi.string().valid('buy', 'sell'),

  // Order type validation
  orderType: Joi.string().valid('market', 'limit', 'stop_loss', 'take_profit'),

  // Order status validation
  orderStatus: Joi.string().valid(
    'pending',
    'open',
    'partially_filled',
    'filled',
    'cancelled',
    'expired'
  )
};

// Order-specific validation schemas
export const orderSchemas = {
  // Create order schema
  createOrder: Joi.object({
    pair: commonSchemas.tradingPair.required(),
    side: commonSchemas.orderSide.required(),
    type: commonSchemas.orderType.required(),
    amount: commonSchemas.amount.required(),
    price: Joi.when('type', {
      is: 'limit',
      then: commonSchemas.amount.required(),
      otherwise: Joi.optional()
    }),
    stopPrice: Joi.when('type', {
      is: Joi.valid('stop_loss', 'take_profit'),
      then: commonSchemas.amount.required(),
      otherwise: Joi.optional()
    }),
    timeInForce: Joi.string().valid('GTC', 'IOC', 'FOK').default('GTC'),
    postOnly: Joi.boolean().default(false)
  }),

  // Update order schema
  updateOrder: Joi.object({
    price: commonSchemas.amount,
    amount: commonSchemas.amount,
    stopPrice: commonSchemas.amount
  }).min(1), // At least one field must be provided

  // Order query filters
  orderFilters: Joi.object({
    pair: commonSchemas.tradingPair,
    side: commonSchemas.orderSide,
    type: commonSchemas.orderType,
    status: commonSchemas.orderStatus,
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso(),
    minAmount: commonSchemas.amount,
    maxAmount: commonSchemas.amount
  })
};

// Trade validation schemas
export const tradeSchemas = {
  // Trade filters
  tradeFilters: Joi.object({
    pair: commonSchemas.tradingPair,
    side: commonSchemas.orderSide,
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso(),
    minAmount: commonSchemas.amount,
    maxAmount: commonSchemas.amount,
    orderId: commonSchemas.uuid
  })
};

// Settlement validation schemas
export const settlementSchemas = {
  // Create settlement request
  createSettlement: Joi.object({
    tradeIds: Joi.array().items(commonSchemas.uuid).min(1).required(),
    settlementAddress: commonSchemas.address.required(),
    notes: Joi.string().max(500)
  }),

  // Settlement filters
  settlementFilters: Joi.object({
    status: Joi.string().valid('pending', 'processing', 'completed', 'failed'),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso(),
    tradeId: commonSchemas.uuid
  })
};

// Account validation schemas
export const accountSchemas = {
  // Update account settings
  updateAccount: Joi.object({
    defaultSettlementAddress: commonSchemas.address,
    tradingPreferences: Joi.object({
      defaultSlippage: Joi.number().min(0).max(100),
      autoSettlement: Joi.boolean(),
      notifications: Joi.object({
        orderFilled: Joi.boolean(),
        orderCancelled: Joi.boolean(),
        settlementCompleted: Joi.boolean()
      })
    })
  }),

  // Withdrawal request
  withdrawalRequest: Joi.object({
    asset: Joi.string().required(),
    amount: commonSchemas.amount.required(),
    address: commonSchemas.address.required(),
    network: Joi.string().required(),
    memo: Joi.string()
  })
};

// Helper function to create custom validation error
export const createValidationError = (
  field: string,
  message: string
): BadRequestError => {
  return new BadRequestError(
    `Validation error: ${field} - ${message}`,
    'VALIDATION_ERROR'
  );
};