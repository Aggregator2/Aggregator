import { Router } from 'express';
import {
  authenticate,
  authorize,
  Permission,
  validate,
  ValidationSource,
  tradeSchemas,
  commonSchemas,
  paginationMiddleware,
  asyncHandler,
  rateLimiters,
  optionalAuthenticate
} from '../middleware';
import { TradeController } from './controller';
import Joi from 'joi';

const router = Router();
const controller = new TradeController();

// Apply standard rate limiting
router.use(rateLimiters.standard);

/**
 * @route   GET /api/v1/trades
 * @desc    Get user's trades with pagination and filters
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  paginationMiddleware(),
  validate(tradeSchemas.tradeFilters.append(commonSchemas.pagination), ValidationSource.QUERY),
  asyncHandler(controller.getUserTrades)
);

/**
 * @route   GET /api/v1/trades/all
 * @desc    Get all trades (admin only)
 * @access  Private - Admin
 */
router.get(
  '/all',
  authenticate,
  authorize(Permission.VIEW_ALL_TRADES),
  paginationMiddleware(),
  validate(tradeSchemas.tradeFilters.append(commonSchemas.pagination), ValidationSource.QUERY),
  asyncHandler(controller.getAllTrades)
);

/**
 * @route   GET /api/v1/trades/public/:pair
 * @desc    Get recent public trades for a pair
 * @access  Public
 */
router.get(
  '/public/:pair',
  validate(Joi.object({ pair: commonSchemas.tradingPair }), ValidationSource.PARAMS),
  paginationMiddleware(50, 500), // Higher limits for public data
  asyncHandler(controller.getPublicTrades)
);

/**
 * @route   GET /api/v1/trades/:tradeId
 * @desc    Get specific trade details
 * @access  Private
 */
router.get(
  '/:tradeId',
  authenticate,
  validate(Joi.object({ tradeId: commonSchemas.uuid }), ValidationSource.PARAMS),
  asyncHandler(controller.getTradeById)
);

/**
 * @route   GET /api/v1/trades/stats/daily
 * @desc    Get daily trading statistics
 * @access  Private
 */
router.get(
  '/stats/daily',
  authenticate,
  validate(commonSchemas.dateRange, ValidationSource.QUERY),
  asyncHandler(controller.getDailyStats)
);

/**
 * @route   GET /api/v1/trades/stats/summary
 * @desc    Get trading summary for user
 * @access  Private
 */
router.get(
  '/stats/summary',
  authenticate,
  asyncHandler(controller.getTradingSummary)
);

/**
 * @route   GET /api/v1/trades/export
 * @desc    Export trades as CSV
 * @access  Private
 */
router.get(
  '/export',
  authenticate,
  validate(tradeSchemas.tradeFilters, ValidationSource.QUERY),
  asyncHandler(controller.exportTrades)
);

/**
 * @route   GET /api/v1/trades/candles/:pair
 * @desc    Get OHLCV candle data
 * @access  Public
 */
router.get(
  '/candles/:pair',
  validate(Joi.object({ pair: commonSchemas.tradingPair }), ValidationSource.PARAMS),
  validate(
    Joi.object({
      interval: Joi.string().valid('1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w').default('1h'),
      startTime: Joi.date().timestamp(),
      endTime: Joi.date().timestamp(),
      limit: Joi.number().integer().min(1).max(1000).default(100)
    }),
    ValidationSource.QUERY
  ),
  asyncHandler(controller.getCandles)
);

export default router;