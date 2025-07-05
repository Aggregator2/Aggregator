import { Router } from 'express';
import {
  authenticate,
  authorize,
  Permission,
  validate,
  ValidationSource,
  orderSchemas,
  commonSchemas,
  paginationMiddleware,
  asyncHandler,
  rateLimiters
} from '../middleware';
import { OrderController } from './controller';

const router = Router();
const controller = new OrderController();

// Apply rate limiting to all order endpoints
router.use(rateLimiters.standard);

/**
 * @route   GET /api/v1/orders
 * @desc    Get user's orders with pagination and filters
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  paginationMiddleware(),
  validate(orderSchemas.orderFilters.append(commonSchemas.pagination), ValidationSource.QUERY),
  asyncHandler(controller.getUserOrders)
);

/**
 * @route   GET /api/v1/orders/all
 * @desc    Get all orders (admin only)
 * @access  Private - Admin
 */
router.get(
  '/all',
  authenticate,
  authorize(Permission.VIEW_ALL_ORDERS),
  paginationMiddleware(),
  validate(orderSchemas.orderFilters.append(commonSchemas.pagination), ValidationSource.QUERY),
  asyncHandler(controller.getAllOrders)
);

/**
 * @route   GET /api/v1/orders/:orderId
 * @desc    Get specific order details
 * @access  Private
 */
router.get(
  '/:orderId',
  authenticate,
  validate(commonSchemas.uuid, ValidationSource.PARAMS),
  asyncHandler(controller.getOrderById)
);

/**
 * @route   POST /api/v1/orders
 * @desc    Create a new order
 * @access  Private
 */
router.post(
  '/',
  authenticate,
  authorize(Permission.CREATE_ORDER),
  rateLimiters.strict,
  validate(orderSchemas.createOrder),
  asyncHandler(controller.createOrder)
);

/**
 * @route   PUT /api/v1/orders/:orderId
 * @desc    Update an existing order (price/amount)
 * @access  Private
 */
router.put(
  '/:orderId',
  authenticate,
  validate(commonSchemas.uuid, ValidationSource.PARAMS),
  validate(orderSchemas.updateOrder),
  asyncHandler(controller.updateOrder)
);

/**
 * @route   DELETE /api/v1/orders/:orderId
 * @desc    Cancel an order
 * @access  Private
 */
router.delete(
  '/:orderId',
  authenticate,
  authorize(Permission.CANCEL_ORDER),
  validate(commonSchemas.uuid, ValidationSource.PARAMS),
  asyncHandler(controller.cancelOrder)
);

/**
 * @route   POST /api/v1/orders/batch
 * @desc    Create multiple orders in batch
 * @access  Private
 */
router.post(
  '/batch',
  authenticate,
  authorize(Permission.CREATE_ORDER),
  rateLimiters.strict,
  asyncHandler(controller.createBatchOrders)
);

/**
 * @route   DELETE /api/v1/orders/batch
 * @desc    Cancel multiple orders in batch
 * @access  Private
 */
router.delete(
  '/batch',
  authenticate,
  authorize(Permission.CANCEL_ORDER),
  asyncHandler(controller.cancelBatchOrders)
);

/**
 * @route   GET /api/v1/orders/:orderId/fills
 * @desc    Get order fills/trades
 * @access  Private
 */
router.get(
  '/:orderId/fills',
  authenticate,
  validate(commonSchemas.uuid, ValidationSource.PARAMS),
  paginationMiddleware(),
  asyncHandler(controller.getOrderFills)
);

export default router;