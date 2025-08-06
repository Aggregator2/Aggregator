/**
 * REST API Routes - Orders v1
 * Comprehensive order management endpoints with validation and security
 */

import { 
    submitOrderSchema,
    cancelOrderSchema,
    getOrderSchema,
    getOrdersSchema,
    updateOrderSchema 
} from '../../../schemas/validation/orders.js';

/**
 * Register order routes
 */
export async function registerOrderRoutes(fastify, services) {
    const { database, auth, analytics, blockchain } = services;

    // Apply authentication to all order routes
    fastify.addHook('preHandler', async (request, reply) => {
        await fastify.authenticate(request, reply);
    });

    /**
     * GET /api/v1/orders
     * Get user's orders with filtering and pagination
     */
    fastify.get('/', {
        schema: getOrdersSchema,
        preHandler: [
            fastify.rateLimit({
                max: 100,
                timeWindow: 60000 // 1 minute
            })
        ]
    }, async (request, reply) => {
        try {
            const { 
                status, 
                tokenIn, 
                tokenOut, 
                minAmount, 
                maxAmount,
                createdAfter,
                createdBefore,
                page = 1, 
                limit = 20,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = request.query;

            // Validate pagination
            if (limit > 100) {
                return reply.code(400).send({
                    error: 'INVALID_LIMIT',
                    message: 'Limit cannot exceed 100'
                });
            }

            // Build filter
            const filter = {
                userAddress: request.user.address
            };

            if (status) filter.status = status;
            if (tokenIn) filter.tokenIn = tokenIn.toLowerCase();
            if (tokenOut) filter.tokenOut = tokenOut.toLowerCase();
            if (minAmount) filter.minAmount = minAmount;
            if (maxAmount) filter.maxAmount = maxAmount;
            if (createdAfter) filter.createdAfter = new Date(createdAfter);
            if (createdBefore) filter.createdBefore = new Date(createdBefore);

            // Get orders
            const result = await database.getOrders(filter, {
                page: parseInt(page),
                limit: parseInt(limit),
                sortBy,
                sortOrder
            });

            // Track analytics
            await analytics.trackEvent('orders_list', {
                userId: request.user.address,
                filterCount: Object.keys(filter).length - 1, // -1 for userAddress
                resultCount: result.orders.length
            });

            return reply.send({
                success: true,
                data: {
                    orders: result.orders,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: result.total,
                        totalPages: Math.ceil(result.total / limit),
                        hasNext: page * limit < result.total,
                        hasPrev: page > 1
                    }
                }
            });

        } catch (error) {
            fastify.log.error('Error fetching orders:', error);
            return reply.code(500).send({
                error: 'INTERNAL_ERROR',
                message: 'Failed to fetch orders'
            });
        }
    });

    /**
     * GET /api/v1/orders/:id
     * Get specific order by ID
     */
    fastify.get('/:id', {
        schema: getOrderSchema,
        preHandler: [
            fastify.rateLimit({
                max: 200,
                timeWindow: 60000 // 1 minute
            })
        ]
    }, async (request, reply) => {
        try {
            const { id } = request.params;

            const order = await database.getOrder(id);
            
            if (!order) {
                return reply.code(404).send({
                    error: 'ORDER_NOT_FOUND',
                    message: 'Order not found'
                });
            }

            // Check if user owns this order or is admin
            if (order.userAddress.toLowerCase() !== request.user.address.toLowerCase() && 
                !request.user.isAdmin) {
                return reply.code(403).send({
                    error: 'ACCESS_DENIED',
                    message: 'You can only access your own orders'
                });
            }

            // Enrich order with real-time data
            if (order.status === 'PROCESSING') {
                const blockchainStatus = await blockchain.getOrderStatus(order.transactionHash);
                if (blockchainStatus) {
                    order.blockchainStatus = blockchainStatus;
                }
            }

            // Track analytics
            await analytics.trackEvent('order_view', {
                userId: request.user.address,
                orderId: id,
                orderStatus: order.status
            });

            return reply.send({
                success: true,
                data: { order }
            });

        } catch (error) {
            fastify.log.error('Error fetching order:', error);
            return reply.code(500).send({
                error: 'INTERNAL_ERROR',
                message: 'Failed to fetch order'
            });
        }
    });

    /**
     * POST /api/v1/orders
     * Submit new order
     */
    fastify.post('/', {
        schema: submitOrderSchema,
        preHandler: [
            fastify.rateLimit({
                max: 10,
                timeWindow: 60000, // 1 minute
                keyGenerator: (request) => request.user.address
            })
        ]
    }, async (request, reply) => {
        try {
            const orderInput = request.body;

            // Validate signature
            const isValidSignature = await auth.validateOrderSignature(
                orderInput, 
                request.user.address
            );
            
            if (!isValidSignature) {
                return reply.code(400).send({
                    error: 'INVALID_SIGNATURE',
                    message: 'Order signature is invalid'
                });
            }

            // Check balance
            const balance = await database.getBalance(
                request.user.address,
                orderInput.tokenIn,
                orderInput.chainId || 1
            );

            if (!balance || BigInt(balance.available) < BigInt(orderInput.amountIn)) {
                return reply.code(400).send({
                    error: 'INSUFFICIENT_BALANCE',
                    message: 'Insufficient token balance'
                });
            }

            // Validate token pair
            const isValidPair = await blockchain.validateTokenPair(
                orderInput.tokenIn,
                orderInput.tokenOut,
                orderInput.chainId || 1
            );

            if (!isValidPair) {
                return reply.code(400).send({
                    error: 'INVALID_TOKEN_PAIR',
                    message: 'Token pair is not supported'
                });
            }

            // Check order deadline
            const deadline = new Date(orderInput.deadline);
            if (deadline <= new Date()) {
                return reply.code(400).send({
                    error: 'INVALID_DEADLINE',
                    message: 'Order deadline must be in the future'
                });
            }

            // Submit order
            const result = await database.submitOrder({
                ...orderInput,
                userAddress: request.user.address,
                chainId: orderInput.chainId || 1
            });

            // Track analytics
            await analytics.trackEvent('order_submit', {
                userId: request.user.address,
                orderId: result.order.id,
                tokenIn: orderInput.tokenIn,
                tokenOut: orderInput.tokenOut,
                amountIn: orderInput.amountIn,
                priority: orderInput.priority || 100
            });

            // Update user stats
            await analytics.updateUserStats(request.user.address, {
                totalOrders: 1,
                totalVolume: BigInt(orderInput.amountIn)
            });

            return reply.code(201).send({
                success: true,
                data: {
                    order: result.order,
                    estimatedGas: result.estimatedGas,
                    estimatedSettlementTime: result.estimatedSettlementTime
                }
            });

        } catch (error) {
            fastify.log.error('Error submitting order:', error);
            
            // Handle specific errors
            if (error.code === 'NONCE_ALREADY_USED') {
                return reply.code(400).send({
                    error: 'NONCE_ALREADY_USED',
                    message: 'This nonce has already been used'
                });
            }

            if (error.code === 'ORDER_EXPIRED') {
                return reply.code(400).send({
                    error: 'ORDER_EXPIRED',
                    message: 'Order has expired'
                });
            }

            return reply.code(500).send({
                error: 'INTERNAL_ERROR',
                message: 'Failed to submit order'
            });
        }
    });

    /**
     * PUT /api/v1/orders/:id
     * Update order (limited operations)
     */
    fastify.put('/:id', {
        schema: updateOrderSchema,
        preHandler: [
            fastify.rateLimit({
                max: 20,
                timeWindow: 60000 // 1 minute
            })
        ]
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const updates = request.body;

            const order = await database.getOrder(id);
            
            if (!order) {
                return reply.code(404).send({
                    error: 'ORDER_NOT_FOUND',
                    message: 'Order not found'
                });
            }

            // Check ownership
            if (order.userAddress.toLowerCase() !== request.user.address.toLowerCase()) {
                return reply.code(403).send({
                    error: 'ACCESS_DENIED',
                    message: 'You can only update your own orders'
                });
            }

            // Check if order can be updated
            if (!['PENDING', 'COMMITTED'].includes(order.status)) {
                return reply.code(400).send({
                    error: 'ORDER_NOT_UPDATABLE',
                    message: 'Order cannot be updated in current status'
                });
            }

            // Only allow specific fields to be updated
            const allowedUpdates = ['priority', 'deadline', 'metadata'];
            const updateData = {};
            
            for (const field of allowedUpdates) {
                if (updates[field] !== undefined) {
                    updateData[field] = updates[field];
                }
            }

            if (Object.keys(updateData).length === 0) {
                return reply.code(400).send({
                    error: 'NO_UPDATES',
                    message: 'No valid updates provided'
                });
            }

            // Validate deadline if being updated
            if (updateData.deadline) {
                const deadline = new Date(updateData.deadline);
                if (deadline <= new Date()) {
                    return reply.code(400).send({
                        error: 'INVALID_DEADLINE',
                        message: 'Order deadline must be in the future'
                    });
                }
            }

            // Update order
            const updatedOrder = await database.updateOrder(id, updateData);

            // Track analytics
            await analytics.trackEvent('order_update', {
                userId: request.user.address,
                orderId: id,
                updatedFields: Object.keys(updateData)
            });

            return reply.send({
                success: true,
                data: { order: updatedOrder }
            });

        } catch (error) {
            fastify.log.error('Error updating order:', error);
            return reply.code(500).send({
                error: 'INTERNAL_ERROR',
                message: 'Failed to update order'
            });
        }
    });

    /**
     * DELETE /api/v1/orders/:id
     * Cancel order
     */
    fastify.delete('/:id', {
        schema: cancelOrderSchema,
        preHandler: [
            fastify.rateLimit({
                max: 30,
                timeWindow: 60000 // 1 minute
            })
        ]
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const { reason } = request.body || {};

            const order = await database.getOrder(id);
            
            if (!order) {
                return reply.code(404).send({
                    error: 'ORDER_NOT_FOUND',
                    message: 'Order not found'
                });
            }

            // Check ownership
            if (order.userAddress.toLowerCase() !== request.user.address.toLowerCase()) {
                return reply.code(403).send({
                    error: 'ACCESS_DENIED',
                    message: 'You can only cancel your own orders'
                });
            }

            // Check if order can be cancelled
            if (!['PENDING', 'COMMITTED', 'REVEALED'].includes(order.status)) {
                return reply.code(400).send({
                    error: 'ORDER_NOT_CANCELLABLE',
                    message: 'Order cannot be cancelled in current status'
                });
            }

            // Cancel order
            const result = await database.cancelOrder(id, {
                reason: reason || 'User requested cancellation',
                cancelledBy: request.user.address
            });

            // Track analytics
            await analytics.trackEvent('order_cancel', {
                userId: request.user.address,
                orderId: id,
                orderStatus: order.status,
                reason: reason || 'user_requested'
            });

            return reply.send({
                success: true,
                data: {
                    order: result.order,
                    refund: result.refund
                },
                message: 'Order cancelled successfully'
            });

        } catch (error) {
            fastify.log.error('Error cancelling order:', error);
            
            if (error.code === 'ORDER_ALREADY_CANCELLED') {
                return reply.code(400).send({
                    error: 'ORDER_ALREADY_CANCELLED',
                    message: 'Order is already cancelled'
                });
            }

            return reply.code(500).send({
                error: 'INTERNAL_ERROR',
                message: 'Failed to cancel order'
            });
        }
    });

    /**
     * GET /api/v1/orders/:id/history
     * Get order status history
     */
    fastify.get('/:id/history', {
        preHandler: [
            fastify.rateLimit({
                max: 50,
                timeWindow: 60000 // 1 minute
            })
        ]
    }, async (request, reply) => {
        try {
            const { id } = request.params;

            const order = await database.getOrder(id);
            
            if (!order) {
                return reply.code(404).send({
                    error: 'ORDER_NOT_FOUND',
                    message: 'Order not found'
                });
            }

            // Check ownership
            if (order.userAddress.toLowerCase() !== request.user.address.toLowerCase() && 
                !request.user.isAdmin) {
                return reply.code(403).send({
                    error: 'ACCESS_DENIED',
                    message: 'You can only access your own order history'
                });
            }

            const history = await database.getOrderHistory(id);

            return reply.send({
                success: true,
                data: { history }
            });

        } catch (error) {
            fastify.log.error('Error fetching order history:', error);
            return reply.code(500).send({
                error: 'INTERNAL_ERROR',
                message: 'Failed to fetch order history'
            });
        }
    });

    /**
     * POST /api/v1/orders/batch
     * Submit multiple orders in batch
     */
    fastify.post('/batch', {
        preHandler: [
            fastify.rateLimit({
                max: 5,
                timeWindow: 300000, // 5 minutes
                keyGenerator: (request) => request.user.address
            })
        ]
    }, async (request, reply) => {
        try {
            const { orders } = request.body;

            // Validate batch size
            if (!Array.isArray(orders) || orders.length === 0) {
                return reply.code(400).send({
                    error: 'INVALID_BATCH',
                    message: 'Orders must be a non-empty array'
                });
            }

            if (orders.length > 10) {
                return reply.code(400).send({
                    error: 'BATCH_TOO_LARGE',
                    message: 'Maximum 10 orders per batch'
                });
            }

            // Process batch
            const results = await database.submitOrderBatch(
                orders.map(order => ({
                    ...order,
                    userAddress: request.user.address
                }))
            );

            // Track analytics
            await analytics.trackEvent('order_batch_submit', {
                userId: request.user.address,
                batchSize: orders.length,
                successCount: results.successful.length,
                failureCount: results.failed.length
            });

            return reply.code(201).send({
                success: true,
                data: {
                    successful: results.successful,
                    failed: results.failed,
                    summary: {
                        total: orders.length,
                        successful: results.successful.length,
                        failed: results.failed.length
                    }
                }
            });

        } catch (error) {
            fastify.log.error('Error submitting batch orders:', error);
            return reply.code(500).send({
                error: 'INTERNAL_ERROR',
                message: 'Failed to submit batch orders'
            });
        }
    });

    fastify.log.info('✅ Order routes registered successfully');
}