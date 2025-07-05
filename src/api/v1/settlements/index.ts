import { Router } from 'express';
import {
  authenticate,
  authorize,
  Permission,
  validate,
  ValidationSource,
  settlementSchemas,
  commonSchemas,
  paginationMiddleware,
  asyncHandler,
  rateLimiters
} from '../middleware';
import { SettlementController } from './controller';
import Joi from 'joi';

const router = Router();
const controller = new SettlementController();

// Apply rate limiting
router.use(rateLimiters.standard);

/**
 * @route   GET /api/v1/settlements
 * @desc    Get user's settlements with pagination and filters
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  paginationMiddleware(),
  validate(settlementSchemas.settlementFilters.append(commonSchemas.pagination), ValidationSource.QUERY),
  asyncHandler(controller.getUserSettlements)
);

/**
 * @route   GET /api/v1/settlements/all
 * @desc    Get all settlements (admin only)
 * @access  Private - Admin
 */
router.get(
  '/all',
  authenticate,
  authorize(Permission.MANAGE_SETTLEMENTS),
  paginationMiddleware(),
  validate(settlementSchemas.settlementFilters.append(commonSchemas.pagination), ValidationSource.QUERY),
  asyncHandler(controller.getAllSettlements)
);

/**
 * @route   GET /api/v1/settlements/:settlementId
 * @desc    Get specific settlement details
 * @access  Private
 */
router.get(
  '/:settlementId',
  authenticate,
  validate(Joi.object({ settlementId: commonSchemas.uuid }), ValidationSource.PARAMS),
  asyncHandler(controller.getSettlementById)
);

/**
 * @route   POST /api/v1/settlements
 * @desc    Create a new settlement request
 * @access  Private
 */
router.post(
  '/',
  authenticate,
  rateLimiters.strict,
  validate(settlementSchemas.createSettlement),
  asyncHandler(controller.createSettlement)
);

/**
 * @route   POST /api/v1/settlements/:settlementId/confirm
 * @desc    Confirm settlement completion (admin only)
 * @access  Private - Admin
 */
router.post(
  '/:settlementId/confirm',
  authenticate,
  authorize(Permission.MANAGE_SETTLEMENTS),
  validate(Joi.object({ settlementId: commonSchemas.uuid }), ValidationSource.PARAMS),
  validate(
    Joi.object({
      txHash: commonSchemas.txHash.required(),
      fee: commonSchemas.amount
    })
  ),
  asyncHandler(controller.confirmSettlement)
);

/**
 * @route   POST /api/v1/settlements/:settlementId/fail
 * @desc    Mark settlement as failed (admin only)
 * @access  Private - Admin
 */
router.post(
  '/:settlementId/fail',
  authenticate,
  authorize(Permission.MANAGE_SETTLEMENTS),
  validate(Joi.object({ settlementId: commonSchemas.uuid }), ValidationSource.PARAMS),
  validate(
    Joi.object({
      reason: Joi.string().required().max(500)
    })
  ),
  asyncHandler(controller.failSettlement)
);

/**
 * @route   GET /api/v1/settlements/pending
 * @desc    Get pending settlements count and value
 * @access  Private
 */
router.get(
  '/pending',
  authenticate,
  asyncHandler(controller.getPendingSettlements)
);

/**
 * @route   GET /api/v1/settlements/stats
 * @desc    Get settlement statistics
 * @access  Private
 */
router.get(
  '/stats',
  authenticate,
  asyncHandler(controller.getSettlementStats)
);

/**
 * @route   POST /api/v1/settlements/batch
 * @desc    Create batch settlement for multiple trades
 * @access  Private
 */
router.post(
  '/batch',
  authenticate,
  rateLimiters.strict,
  validate(
    Joi.object({
      settlements: Joi.array().items(settlementSchemas.createSettlement).min(1).max(10)
    })
  ),
  asyncHandler(controller.createBatchSettlement)
);

/**
 * @route   GET /api/v1/settlements/estimate-fee
 * @desc    Estimate settlement fee
 * @access  Private
 */
router.get(
  '/estimate-fee',
  authenticate,
  validate(
    Joi.object({
      network: Joi.string().required(),
      asset: Joi.string().required(),
      amount: commonSchemas.amount.required()
    }),
    ValidationSource.QUERY
  ),
  asyncHandler(controller.estimateSettlementFee)
);

export default router;