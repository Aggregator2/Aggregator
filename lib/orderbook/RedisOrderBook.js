/**
 * @fileoverview Redis-based Order Book Implementation
 * @author SwappiQ Protocol
 * @description High-performance order book using Redis data structures
 */

const EventEmitter = require('events');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

/**
 * Redis Order Book
 * Implements efficient order book using Redis data structures
 */
class RedisOrderBook extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Redis configuration
            redis: {
                host: config.redis?.host || 'localhost',
                port: config.redis?.port || 6379,
                password: config.redis?.password,
                db: config.redis?.db || 0,
                keyPrefix: config.redis?.keyPrefix || 'orderbook:',
                maxRetriesPerRequest: config.redis?.maxRetriesPerRequest || 3,
                enableOfflineQueue: config.redis?.enableOfflineQueue !== false,
                
                // Cluster configuration
                cluster: config.redis?.cluster || null,
                sentinels: config.redis?.sentinels || null
            },
            
            // Order book configuration
            orderbook: {
                symbol: config.orderbook?.symbol || 'ETH/USDT',
                tickSize: config.orderbook?.tickSize || 0.01,
                stepSize: config.orderbook?.stepSize || 0.001,
                maxOrdersPerLevel: config.orderbook?.maxOrdersPerLevel || 1000,
                maxPriceLevels: config.orderbook?.maxPriceLevels || 1000,
                
                // Price bounds
                minPrice: config.orderbook?.minPrice || 0.000001,
                maxPrice: config.orderbook?.maxPrice || 1000000,
                
                // Order types
                supportedTypes: config.orderbook?.supportedTypes || ['limit', 'market', 'stop'],
                defaultExpiry: config.orderbook?.defaultExpiry || 86400 // 24 hours
            },
            
            // History configuration
            history: {
                enabled: config.history?.enabled !== false,
                maxEntries: config.history?.maxEntries || 10000,
                ttl: config.history?.ttl || 604800, // 7 days
                compressionThreshold: config.history?.compressionThreshold || 1000
            },
            
            // Analytics configuration
            analytics: {
                enabled: config.analytics?.enabled !== false,
                updateInterval: config.analytics?.updateInterval || 60000, // 1 minute
                metricsRetention: config.analytics?.metricsRetention || 86400 // 24 hours
            },
            
            // Performance configuration
            performance: {
                pipelining: config.performance?.pipelining !== false,
                batchSize: config.performance?.batchSize || 100,
                lua: {
                    enabled: config.performance?.lua?.enabled !== false,
                    scripts: config.performance?.lua?.scripts || {}
                }
            },
            
            // Monitoring configuration
            monitoring: {
                enabled: config.monitoring?.enabled !== false,
                healthCheckInterval: config.monitoring?.healthCheckInterval || 30000,
                snapshotInterval: config.monitoring?.snapshotInterval || 300000 // 5 minutes
            },
            
            auditLogging: config.auditLogging !== false,
            ...config
        };

        this.state = {
            connected: false,
            redis: null,
            redisPub: null,
            redisSub: null,
            
            // Lua scripts
            scripts: {
                addOrder: null,
                cancelOrder: null,
                matchOrders: null,
                updateOrderStatus: null
            },
            
            // Metrics
            metrics: {
                totalOrders: 0,
                activeOrders: 0,
                executedOrders: 0,
                cancelledOrders: 0,
                bidLevels: 0,
                askLevels: 0,
                uniqueTraders: 0,
                volume24h: 0,
                averageLatency: 0
            },
            
            // Status flags bitmap positions
            statusFlags: {
                ACTIVE: 0,
                FILLED: 1,
                PARTIALLY_FILLED: 2,
                CANCELLED: 3,
                EXPIRED: 4,
                PENDING: 5,
                REJECTED: 6,
                STOP_TRIGGERED: 7
            }
        };

        this.healthCheckTimer = null;
        this.snapshotTimer = null;
        this.analyticsTimer = null;
        
        this.initialize();
    }

    /**
     * Initialize Redis order book
     */
    async initialize() {
        try {
            await this._initializeRedis();
            await this._loadLuaScripts();
            await this._setupSubscriptions();
            await this._startMonitoring();
            
            console.log('Redis Order Book initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Redis Order Book:', error);
            throw error;
        }
    }

    /**
     * Add order to order book
     */
    async addOrder(order) {
        try {
            const startTime = Date.now();
            
            // Validate order
            this._validateOrder(order);
            
            // Generate order ID if not provided
            if (!order.id) {
                order.id = uuidv4();
            }
            
            // Normalize price and quantity
            order.price = this._normalizePrice(order.price);
            order.quantity = this._normalizeQuantity(order.quantity);
            order.timestamp = order.timestamp || Date.now();
            order.status = 'active';
            
            const pipeline = this.state.redis.pipeline();
            
            // 1. Add to appropriate ZSET (bid or ask)
            const priceKey = this._getPriceKey(order.side);
            const score = order.side === 'buy' ? -order.price : order.price;
            pipeline.zadd(priceKey, score, order.id);
            
            // 2. Store order details in HASH
            const orderKey = this._getOrderKey(order.id);
            pipeline.hset(orderKey, this._serializeOrder(order));
            
            // Set expiry if configured
            if (order.ttl || this.config.orderbook.defaultExpiry) {
                pipeline.expire(orderKey, order.ttl || this.config.orderbook.defaultExpiry);
            }
            
            // 3. Add to user's order index
            const userOrdersKey = this._getUserOrdersKey(order.userId);
            pipeline.sadd(userOrdersKey, order.id);
            
            // 4. Update order status bitmap
            await this._setOrderStatus(order.id, 'ACTIVE');
            
            // 5. Add to HyperLogLog for unique traders
            const tradersKey = this._getTradersKey();
            pipeline.pfadd(tradersKey, order.userId);
            
            // 6. Add to order history
            if (this.config.history.enabled) {
                await this._addToHistory('order_added', order);
            }
            
            // Execute pipeline
            await pipeline.exec();
            
            // Update metrics
            this.state.metrics.totalOrders++;
            this.state.metrics.activeOrders++;
            
            // Calculate latency
            const latency = Date.now() - startTime;
            this._updateLatencyMetric(latency);
            
            // Emit event
            this.emit('orderAdded', {
                orderId: order.id,
                side: order.side,
                price: order.price,
                quantity: order.quantity,
                timestamp: order.timestamp
            });
            
            // Trigger matching
            await this._triggerMatching(order);
            
            await this._auditLog('ORDER_ADDED', {
                orderId: order.id,
                side: order.side,
                price: order.price,
                quantity: order.quantity,
                latency
            });
            
            return {
                success: true,
                orderId: order.id,
                timestamp: order.timestamp
            };
            
        } catch (error) {
            console.error('Failed to add order:', error);
            throw error;
        }
    }

    /**
     * Cancel order
     */
    async cancelOrder(orderId, userId) {
        try {
            const startTime = Date.now();
            
            // Get order details
            const order = await this.getOrder(orderId);
            
            if (!order) {
                throw new Error('Order not found');
            }
            
            // Verify ownership
            if (order.userId !== userId) {
                throw new Error('Unauthorized to cancel this order');
            }
            
            // Check if order can be cancelled
            const status = await this._getOrderStatus(orderId);
            if (status.FILLED || status.CANCELLED) {
                throw new Error('Order already filled or cancelled');
            }
            
            const pipeline = this.state.redis.pipeline();
            
            // 1. Remove from price level ZSET
            const priceKey = this._getPriceKey(order.side);
            pipeline.zrem(priceKey, orderId);
            
            // 2. Update order status
            await this._setOrderStatus(orderId, 'CANCELLED');
            
            // 3. Update order details
            order.status = 'cancelled';
            order.cancelledAt = Date.now();
            const orderKey = this._getOrderKey(orderId);
            pipeline.hset(orderKey, this._serializeOrder(order));
            
            // 4. Remove from user's active orders
            const userOrdersKey = this._getUserOrdersKey(userId);
            pipeline.srem(userOrdersKey, orderId);
            
            // 5. Add to history
            if (this.config.history.enabled) {
                await this._addToHistory('order_cancelled', order);
            }
            
            // Execute pipeline
            await pipeline.exec();
            
            // Update metrics
            this.state.metrics.activeOrders--;
            this.state.metrics.cancelledOrders++;
            
            const latency = Date.now() - startTime;
            this._updateLatencyMetric(latency);
            
            // Emit event
            this.emit('orderCancelled', {
                orderId,
                timestamp: Date.now()
            });
            
            await this._auditLog('ORDER_CANCELLED', {
                orderId,
                userId,
                latency
            });
            
            return {
                success: true,
                orderId,
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error('Failed to cancel order:', error);
            throw error;
        }
    }

    /**
     * Get order by ID
     */
    async getOrder(orderId) {
        try {
            const orderKey = this._getOrderKey(orderId);
            const orderData = await this.state.redis.hgetall(orderKey);
            
            if (!orderData || Object.keys(orderData).length === 0) {
                return null;
            }
            
            return this._deserializeOrder(orderData);
            
        } catch (error) {
            console.error('Failed to get order:', error);
            throw error;
        }
    }

    /**
     * Get order book snapshot
     */
    async getSnapshot(depth = 20) {
        try {
            const pipeline = this.state.redis.pipeline();
            
            // Get bids (highest prices first)
            const bidKey = this._getPriceKey('buy');
            pipeline.zrange(bidKey, 0, depth - 1, 'WITHSCORES');
            
            // Get asks (lowest prices first)
            const askKey = this._getPriceKey('sell');
            pipeline.zrange(askKey, 0, depth - 1, 'WITHSCORES');
            
            const results = await pipeline.exec();
            
            // Process bids
            const bids = await this._processLevels(results[0][1], 'buy');
            
            // Process asks
            const asks = await this._processLevels(results[1][1], 'sell');
            
            // Get analytics
            const analytics = await this.getAnalytics();
            
            return {
                symbol: this.config.orderbook.symbol,
                timestamp: Date.now(),
                bids: bids.slice(0, depth),
                asks: asks.slice(0, depth),
                spread: asks.length > 0 && bids.length > 0 ? asks[0].price - bids[0].price : null,
                midPrice: asks.length > 0 && bids.length > 0 ? (asks[0].price + bids[0].price) / 2 : null,
                analytics
            };
            
        } catch (error) {
            console.error('Failed to get snapshot:', error);
            throw error;
        }
    }

    /**
     * Get user orders
     */
    async getUserOrders(userId, options = {}) {
        try {
            const userOrdersKey = this._getUserOrdersKey(userId);
            const orderIds = await this.state.redis.smembers(userOrdersKey);
            
            if (orderIds.length === 0) {
                return [];
            }
            
            const orders = [];
            
            for (const orderId of orderIds) {
                const order = await this.getOrder(orderId);
                if (order) {
                    // Filter by status if requested
                    if (!options.status || order.status === options.status) {
                        orders.push(order);
                    }
                }
            }
            
            // Sort by timestamp
            orders.sort((a, b) => b.timestamp - a.timestamp);
            
            // Apply pagination
            if (options.limit) {
                const offset = options.offset || 0;
                return orders.slice(offset, offset + options.limit);
            }
            
            return orders;
            
        } catch (error) {
            console.error('Failed to get user orders:', error);
            throw error;
        }
    }

    /**
     * Get order history
     */
    async getHistory(options = {}) {
        try {
            const historyKey = this._getHistoryKey();
            const start = options.offset || 0;
            const stop = start + (options.limit || 100) - 1;
            
            const entries = await this.state.redis.lrange(historyKey, start, stop);
            
            return entries.map(entry => JSON.parse(entry));
            
        } catch (error) {
            console.error('Failed to get history:', error);
            throw error;
        }
    }

    /**
     * Get analytics data
     */
    async getAnalytics() {
        try {
            const pipeline = this.state.redis.pipeline();
            
            // Get unique trader count
            const tradersKey = this._getTradersKey();
            pipeline.pfcount(tradersKey);
            
            // Get order counts
            const bidKey = this._getPriceKey('buy');
            const askKey = this._getPriceKey('sell');
            pipeline.zcard(bidKey);
            pipeline.zcard(askKey);
            
            // Get price levels count
            pipeline.zcount(bidKey, '-inf', '+inf');
            pipeline.zcount(askKey, '-inf', '+inf');
            
            const results = await pipeline.exec();
            
            return {
                uniqueTraders: results[0][1],
                activeBids: results[1][1],
                activeAsks: results[2][1],
                bidLevels: results[3][1],
                askLevels: results[4][1],
                totalActive: results[1][1] + results[2][1],
                metrics: this.state.metrics
            };
            
        } catch (error) {
            console.error('Failed to get analytics:', error);
            throw error;
        }
    }

    /**
     * Execute trade (update orders after matching)
     */
    async executeTrade(buyOrderId, sellOrderId, quantity, price) {
        try {
            const pipeline = this.state.redis.pipeline();
            
            // Get both orders
            const [buyOrder, sellOrder] = await Promise.all([
                this.getOrder(buyOrderId),
                this.getOrder(sellOrderId)
            ]);
            
            if (!buyOrder || !sellOrder) {
                throw new Error('Orders not found');
            }
            
            // Update buy order
            buyOrder.filledQuantity = (buyOrder.filledQuantity || 0) + quantity;
            buyOrder.remainingQuantity = buyOrder.quantity - buyOrder.filledQuantity;
            
            if (buyOrder.remainingQuantity <= 0) {
                // Fully filled
                await this._setOrderStatus(buyOrderId, 'FILLED');
                buyOrder.status = 'filled';
                
                // Remove from price level
                const buyPriceKey = this._getPriceKey('buy');
                pipeline.zrem(buyPriceKey, buyOrderId);
            } else {
                // Partially filled
                await this._setOrderStatus(buyOrderId, 'PARTIALLY_FILLED');
                buyOrder.status = 'partially_filled';
            }
            
            // Update sell order
            sellOrder.filledQuantity = (sellOrder.filledQuantity || 0) + quantity;
            sellOrder.remainingQuantity = sellOrder.quantity - sellOrder.filledQuantity;
            
            if (sellOrder.remainingQuantity <= 0) {
                // Fully filled
                await this._setOrderStatus(sellOrderId, 'FILLED');
                sellOrder.status = 'filled';
                
                // Remove from price level
                const sellPriceKey = this._getPriceKey('sell');
                pipeline.zrem(sellPriceKey, sellOrderId);
            } else {
                // Partially filled
                await this._setOrderStatus(sellOrderId, 'PARTIALLY_FILLED');
                sellOrder.status = 'partially_filled';
            }
            
            // Update order details
            const buyOrderKey = this._getOrderKey(buyOrderId);
            const sellOrderKey = this._getOrderKey(sellOrderId);
            pipeline.hset(buyOrderKey, this._serializeOrder(buyOrder));
            pipeline.hset(sellOrderKey, this._serializeOrder(sellOrder));
            
            // Create trade record
            const trade = {
                id: uuidv4(),
                buyOrderId,
                sellOrderId,
                buyerId: buyOrder.userId,
                sellerId: sellOrder.userId,
                price,
                quantity,
                timestamp: Date.now()
            };
            
            // Add to history
            if (this.config.history.enabled) {
                await this._addToHistory('trade_executed', trade);
            }
            
            // Execute pipeline
            await pipeline.exec();
            
            // Update metrics
            this.state.metrics.executedOrders += 2;
            this.state.metrics.volume24h += quantity * price;
            
            // Update active orders count
            if (buyOrder.status === 'filled') this.state.metrics.activeOrders--;
            if (sellOrder.status === 'filled') this.state.metrics.activeOrders--;
            
            // Emit event
            this.emit('tradeExecuted', trade);
            
            await this._auditLog('TRADE_EXECUTED', trade);
            
            return trade;
            
        } catch (error) {
            console.error('Failed to execute trade:', error);
            throw error;
        }
    }

    // ========== PRIVATE METHODS ==========

    async _initializeRedis() {
        // Initialize Redis client
        if (this.config.redis.cluster) {
            this.state.redis = new Redis.Cluster(this.config.redis.cluster, {
                redisOptions: {
                    password: this.config.redis.password
                }
            });
        } else if (this.config.redis.sentinels) {
            this.state.redis = new Redis({
                sentinels: this.config.redis.sentinels,
                name: 'mymaster',
                password: this.config.redis.password
            });
        } else {
            this.state.redis = new Redis({
                host: this.config.redis.host,
                port: this.config.redis.port,
                password: this.config.redis.password,
                db: this.config.redis.db,
                keyPrefix: this.config.redis.keyPrefix,
                enableOfflineQueue: this.config.redis.enableOfflineQueue,
                maxRetriesPerRequest: this.config.redis.maxRetriesPerRequest
            });
        }

        // Initialize pub/sub clients
        this.state.redisPub = this.state.redis.duplicate();
        this.state.redisSub = this.state.redis.duplicate();

        // Set up event handlers
        this.state.redis.on('connect', () => {
            this.state.connected = true;
            console.log('Redis connected');
            this.emit('connected');
        });

        this.state.redis.on('error', (error) => {
            console.error('Redis error:', error);
            this.emit('error', error);
        });

        // Wait for connection
        await this.state.redis.ping();
    }

    async _loadLuaScripts() {
        if (!this.config.performance.lua.enabled) return;

        // Load custom Lua scripts for atomic operations
        // Example: Atomic order matching script
        const matchOrderScript = `
            local buyKey = KEYS[1]
            local sellKey = KEYS[2]
            local maxMatches = tonumber(ARGV[1])
            
            -- Get best bid and ask
            local bestBid = redis.call('zrange', buyKey, 0, 0, 'WITHSCORES')
            local bestAsk = redis.call('zrange', sellKey, 0, 0, 'WITHSCORES')
            
            if #bestBid == 0 or #bestAsk == 0 then
                return nil
            end
            
            local bidPrice = math.abs(tonumber(bestBid[2]))
            local askPrice = tonumber(bestAsk[2])
            
            if bidPrice >= askPrice then
                return {bestBid[1], bestAsk[1], askPrice}
            end
            
            return nil
        `;

        this.state.scripts.matchOrders = matchOrderScript;
    }

    async _setupSubscriptions() {
        // Subscribe to order book events
        await this.state.redisSub.subscribe('orderbook:matches');
        
        this.state.redisSub.on('message', (channel, message) => {
            if (channel === 'orderbook:matches') {
                const match = JSON.parse(message);
                this.emit('match', match);
            }
        });
    }

    async _startMonitoring() {
        // Health check timer
        if (this.config.monitoring.enabled) {
            this.healthCheckTimer = setInterval(async () => {
                await this._performHealthCheck();
            }, this.config.monitoring.healthCheckInterval);

            // Snapshot timer
            this.snapshotTimer = setInterval(async () => {
                const snapshot = await this.getSnapshot(100);
                this.emit('snapshot', snapshot);
            }, this.config.monitoring.snapshotInterval);
        }

        // Analytics timer
        if (this.config.analytics.enabled) {
            this.analyticsTimer = setInterval(async () => {
                const analytics = await this.getAnalytics();
                this.emit('analytics', analytics);
            }, this.config.analytics.updateInterval);
        }
    }

    _validateOrder(order) {
        if (!order.side || !['buy', 'sell'].includes(order.side)) {
            throw new Error('Invalid order side');
        }

        if (!order.type || !this.config.orderbook.supportedTypes.includes(order.type)) {
            throw new Error('Invalid order type');
        }

        if (order.type === 'limit' && (!order.price || order.price <= 0)) {
            throw new Error('Invalid price for limit order');
        }

        if (!order.quantity || order.quantity <= 0) {
            throw new Error('Invalid quantity');
        }

        if (!order.userId) {
            throw new Error('User ID required');
        }

        if (order.price < this.config.orderbook.minPrice || 
            order.price > this.config.orderbook.maxPrice) {
            throw new Error('Price out of bounds');
        }
    }

    _normalizePrice(price) {
        const tickSize = this.config.orderbook.tickSize;
        return Math.round(price / tickSize) * tickSize;
    }

    _normalizeQuantity(quantity) {
        const stepSize = this.config.orderbook.stepSize;
        return Math.round(quantity / stepSize) * stepSize;
    }

    _getPriceKey(side) {
        return `prices:${this.config.orderbook.symbol}:${side}`;
    }

    _getOrderKey(orderId) {
        return `order:${orderId}`;
    }

    _getUserOrdersKey(userId) {
        return `user:${userId}:orders:${this.config.orderbook.symbol}`;
    }

    _getHistoryKey() {
        return `history:${this.config.orderbook.symbol}`;
    }

    _getTradersKey() {
        return `traders:${this.config.orderbook.symbol}:${new Date().toISOString().split('T')[0]}`;
    }

    _getStatusBitmapKey(orderId) {
        return `status:${orderId}`;
    }

    _serializeOrder(order) {
        const serialized = {};
        for (const [key, value] of Object.entries(order)) {
            if (value !== null && value !== undefined) {
                serialized[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
            }
        }
        return serialized;
    }

    _deserializeOrder(orderData) {
        const order = {};
        for (const [key, value] of Object.entries(orderData)) {
            // Try to parse numbers
            if (/^\d+(\.\d+)?$/.test(value)) {
                order[key] = parseFloat(value);
            } else if (value === 'true' || value === 'false') {
                order[key] = value === 'true';
            } else {
                try {
                    order[key] = JSON.parse(value);
                } catch {
                    order[key] = value;
                }
            }
        }
        return order;
    }

    async _setOrderStatus(orderId, status) {
        const bitmapKey = this._getStatusBitmapKey(orderId);
        const position = this.state.statusFlags[status];
        
        if (position === undefined) {
            throw new Error(`Unknown status: ${status}`);
        }
        
        await this.state.redis.setbit(bitmapKey, position, 1);
    }

    async _getOrderStatus(orderId) {
        const bitmapKey = this._getStatusBitmapKey(orderId);
        const status = {};
        
        for (const [flag, position] of Object.entries(this.state.statusFlags)) {
            const bit = await this.state.redis.getbit(bitmapKey, position);
            status[flag] = bit === 1;
        }
        
        return status;
    }

    async _addToHistory(eventType, data) {
        const historyKey = this._getHistoryKey();
        const entry = {
            type: eventType,
            data,
            timestamp: Date.now()
        };
        
        const pipeline = this.state.redis.pipeline();
        
        // Add to list
        pipeline.lpush(historyKey, JSON.stringify(entry));
        
        // Trim to max entries
        pipeline.ltrim(historyKey, 0, this.config.history.maxEntries - 1);
        
        // Set TTL
        pipeline.expire(historyKey, this.config.history.ttl);
        
        await pipeline.exec();
    }

    async _processLevels(data, side) {
        const levels = [];
        
        for (let i = 0; i < data.length; i += 2) {
            const orderId = data[i];
            const score = parseFloat(data[i + 1]);
            const price = side === 'buy' ? -score : score;
            
            const order = await this.getOrder(orderId);
            if (order) {
                // Find or create level
                let level = levels.find(l => l.price === price);
                if (!level) {
                    level = {
                        price,
                        quantity: 0,
                        orders: []
                    };
                    levels.push(level);
                }
                
                level.quantity += order.remainingQuantity || order.quantity;
                level.orders.push({
                    id: order.id,
                    quantity: order.remainingQuantity || order.quantity,
                    timestamp: order.timestamp
                });
            }
        }
        
        // Sort levels
        levels.sort((a, b) => side === 'buy' ? b.price - a.price : a.price - b.price);
        
        return levels;
    }

    async _triggerMatching(order) {
        // Simple matching trigger - in production would be more sophisticated
        if (order.type === 'market' || order.type === 'limit') {
            await this.state.redisPub.publish('orderbook:matches', JSON.stringify({
                orderId: order.id,
                side: order.side,
                price: order.price,
                quantity: order.quantity
            }));
        }
    }

    _updateLatencyMetric(latency) {
        this.state.metrics.averageLatency = 
            (this.state.metrics.averageLatency + latency) / 2;
    }

    async _performHealthCheck() {
        try {
            await this.state.redis.ping();
            this.emit('healthCheck', { status: 'healthy' });
        } catch (error) {
            this.emit('healthCheck', { status: 'unhealthy', error: error.message });
        }
    }

    async _auditLog(action, details) {
        if (!this.config.auditLogging) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'RedisOrderBook'
        };

        this.emit('auditLog', logEntry);
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            redis: {
                connected: this.state.connected,
                keyPrefix: this.config.redis.keyPrefix
            },
            orderbook: {
                symbol: this.config.orderbook.symbol,
                tickSize: this.config.orderbook.tickSize,
                stepSize: this.config.orderbook.stepSize
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Clear timers
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
        if (this.snapshotTimer) clearInterval(this.snapshotTimer);
        if (this.analyticsTimer) clearInterval(this.analyticsTimer);

        // Close Redis connections
        if (this.state.redis) await this.state.redis.quit();
        if (this.state.redisPub) await this.state.redisPub.quit();
        if (this.state.redisSub) await this.state.redisSub.quit();

        console.log('Redis Order Book cleaned up');
    }
}

module.exports = { RedisOrderBook };