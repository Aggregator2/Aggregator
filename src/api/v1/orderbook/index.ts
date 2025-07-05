import { Router } from 'express';
import {
  validate,
  ValidationSource,
  commonSchemas,
  asyncHandler,
  rateLimiters,
  optionalAuthenticate
} from '../middleware';
import { OrderBookController } from './controller';
import Joi from 'joi';

const router = Router();
const controller = new OrderBookController();

// Apply relaxed rate limiting for orderbook endpoints
router.use(rateLimiters.relaxed);

// Orderbook query schema
const orderbookQuerySchema = Joi.object({
  depth: Joi.number().integer().min(1).max(1000).default(20),
  aggregation: Joi.number().positive()
});

/**
 * @route   GET /api/v1/orderbook/:pair
 * @desc    Get orderbook for a trading pair
 * @access  Public
 */
router.get(
  '/:pair',
  validate(Joi.object({ pair: commonSchemas.tradingPair }), ValidationSource.PARAMS),
  validate(orderbookQuerySchema, ValidationSource.QUERY),
  asyncHandler(controller.getOrderBook)
);

/**
 * @route   GET /api/v1/orderbook/:pair/depth
 * @desc    Get orderbook depth (aggregated)
 * @access  Public
 */
router.get(
  '/:pair/depth',
  validate(Joi.object({ pair: commonSchemas.tradingPair }), ValidationSource.PARAMS),
  validate(orderbookQuerySchema, ValidationSource.QUERY),
  asyncHandler(controller.getOrderBookDepth)
);

/**
 * @route   GET /api/v1/orderbook/:pair/spread
 * @desc    Get current bid-ask spread
 * @access  Public
 */
router.get(
  '/:pair/spread',
  validate(Joi.object({ pair: commonSchemas.tradingPair }), ValidationSource.PARAMS),
  asyncHandler(controller.getSpread)
);

/**
 * @route   GET /api/v1/orderbook/:pair/liquidity
 * @desc    Get liquidity information for a pair
 * @access  Public (optional auth for personalized data)
 */
router.get(
  '/:pair/liquidity',
  optionalAuthenticate,
  validate(Joi.object({ pair: commonSchemas.tradingPair }), ValidationSource.PARAMS),
  asyncHandler(controller.getLiquidity)
);

/**
 * @route   GET /api/v1/orderbook/tickers
 * @desc    Get 24h ticker data for all pairs
 * @access  Public
 */
router.get(
  '/tickers',
  asyncHandler(controller.getAllTickers)
);

/**
 * @route   GET /api/v1/orderbook/ticker/:pair
 * @desc    Get 24h ticker data for a specific pair
 * @access  Public
 */
router.get(
  '/ticker/:pair',
  validate(Joi.object({ pair: commonSchemas.tradingPair }), ValidationSource.PARAMS),
  asyncHandler(controller.getTicker)
);

export default router;