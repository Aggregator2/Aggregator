/**
 * @title Advanced Matching Engine
 * @author DEX Trading Team
 * @notice Comprehensive order matching with anti-gaming and fair ordering
 * @dev Supports multiple order types, MEV protection, and high-frequency batch processing
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Worker, isMainThread, parentPort } = require('worker_threads');

class AdvancedMatchingEngine extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Order book configuration
            maxOrdersPerUser: config.maxOrdersPerUser || 100,
            maxOrderSize: config.maxOrderSize || '1000000000000000000000', // 1000 tokens
            minOrderSize: config.minOrderSize || '1000000000000000', // 0.001 tokens
            tickSize: config.tickSize || '1000000000000000', // 0.001 price increment
            
            // Batch processing configuration
            batchSize: config.batchSize || 1000,
            batchProcessingInterval: config.batchProcessingInterval || 100, // 100ms
            highFrequencyMode: config.highFrequencyMode || true,
            
            // Anti-gaming configuration
            washTradingThreshold: config.washTradingThreshold || 0.8,
            maxSelfTradeRatio: config.maxSelfTradeRatio || 0.1,
            antiGameingEnabled: config.antiGameingEnabled || true,
            
            // Fair ordering configuration
            fairOrderingEnabled: config.fairOrderingEnabled || true,
            timeBasedPriority: config.timeBasedPriority || true,
            randomizationEnabled: config.randomizationEnabled || true,
            mevProtectionEnabled: config.mevProtectionEnabled || true,
            
            // Cross-asset configuration
            crossAssetEnabled: config.crossAssetEnabled || true,
            maxHops: config.maxHops || 3,
            
            ...config
        };

        // Order book structures
        this.orderBooks = new Map(); // Market pair -> OrderBook
        this.userOrders = new Map(); // User -> Set of order IDs
        this.icebergOrders = new Map(); // Order ID -> Iceberg state
        this.stopOrders = new Map(); // Order ID -> Stop order state
        
        // Batch processing
        this.batchQueue = [];
        this.processingBatch = false;
        this.batchProcessor = new BatchProcessor(this.config);
        
        // Anti-gaming systems
        this.antiGamingEngine = new AntiGamingEngine(this.config);
        this.washTradingDetector = new WashTradingDetector(this.config);
        this.mevProtector = new MEVProtector(this.config);
        
        // Fair ordering system
        this.fairOrderingEngine = new FairOrderingEngine(this.config);
        this.sequencer = new OrderSequencer(this.config);
        
        // Cross-asset matching
        this.crossAssetMatcher = new CrossAssetMatcher(this.config);
        this.pathFinder = new PathFinder(this.config);
        
        // Performance monitoring
        this.metrics = new MatchingEngineMetrics();
        
        this._initializeEngine();
    }

    /**
     * Initialize the matching engine
     * @private
     */
    async _initializeEngine() {
        // Start batch processing timer
        if (this.config.highFrequencyMode) {
            this.batchTimer = setInterval(
                () => this._processBatchQueue(),
                this.config.batchProcessingInterval
            );
        }

        // Initialize fair ordering
        await this.fairOrderingEngine.initialize();
        
        // Initialize anti-gaming systems
        await this.antiGamingEngine.initialize();
        
        console.log('Advanced Matching Engine initialized');
    }

    /**
     * Submit an order to the matching engine
     * @param {Object} order Order object
     * @returns {Promise<Object>} Order submission result
     */
    async submitOrder(order) {
        try {
            // Validate order
            await this._validateOrder(order);
            
            // Check anti-gaming rules
            if (this.config.antiGameingEnabled) {
                await this.antiGamingEngine.validateOrder(order);
            }
            
            // Apply fair ordering
            if (this.config.fairOrderingEnabled) {
                order = await this.fairOrderingEngine.processOrder(order);
            }
            
            // Add to batch queue for high-frequency processing
            if (this.config.highFrequencyMode) {
                return this._addToBatchQueue(order);
            } else {
                return this._processOrderImmediate(order);
            }
            
        } catch (error) {
            this.metrics.recordError('order_submission', error);
            throw error;
        }
    }

    /**
     * Cancel an order
     * @param {string} orderId Order ID to cancel
     * @param {string} userId User requesting cancellation
     * @returns {Promise<Object>} Cancellation result
     */
    async cancelOrder(orderId, userId) {
        try {
            const order = await this._getOrder(orderId);
            
            if (!order) {
                throw new Error('Order not found');
            }
            
            if (order.userId !== userId) {
                throw new Error('Unauthorized order cancellation');
            }
            
            // Remove from order book
            const orderBook = this.orderBooks.get(order.marketPair);
            if (orderBook) {
                orderBook.removeOrder(orderId);
            }
            
            // Remove from user orders
            const userOrderSet = this.userOrders.get(userId);
            if (userOrderSet) {
                userOrderSet.delete(orderId);
            }
            
            // Clean up special order types
            this.icebergOrders.delete(orderId);
            this.stopOrders.delete(orderId);
            
            this.emit('orderCancelled', { orderId, userId, timestamp: Date.now() });
            
            return {
                success: true,
                orderId,
                cancelledAt: Date.now()
            };
            
        } catch (error) {
            this.metrics.recordError('order_cancellation', error);
            throw error;
        }
    }

    /**
     * Get order book for a market pair
     * @param {string} marketPair Market pair (e.g., "ETH/USDC")
     * @returns {Object} Order book snapshot
     */
    getOrderBook(marketPair) {
        const orderBook = this.orderBooks.get(marketPair);
        if (!orderBook) {
            return { bids: [], asks: [], marketPair };
        }
        
        return orderBook.getSnapshot();
    }

    /**
     * Get user orders
     * @param {string} userId User ID
     * @returns {Array} User's active orders
     */
    async getUserOrders(userId) {
        const userOrderIds = this.userOrders.get(userId) || new Set();
        const orders = [];
        
        for (const orderId of userOrderIds) {
            const order = await this._getOrder(orderId);
            if (order) {
                orders.push(order);
            }
        }
        
        return orders;
    }

    /**
     * Validate order before processing
     * @param {Object} order Order to validate
     * @private
     */
    async _validateOrder(order) {
        // Basic validation
        if (!order.userId || !order.marketPair || !order.side || !order.type) {
            throw new Error('Missing required order fields');
        }
        
        if (!['buy', 'sell'].includes(order.side)) {
            throw new Error('Invalid order side');
        }
        
        if (!['limit', 'market', 'stop_loss', 'iceberg'].includes(order.type)) {
            throw new Error('Unsupported order type');
        }
        
        // Size validation
        const orderSize = BigInt(order.quantity || 0);
        const minSize = BigInt(this.config.minOrderSize);
        const maxSize = BigInt(this.config.maxOrderSize);
        
        if (orderSize < minSize) {
            throw new Error(`Order size below minimum: ${this.config.minOrderSize}`);
        }
        
        if (orderSize > maxSize) {
            throw new Error(`Order size exceeds maximum: ${this.config.maxOrderSize}`);
        }
        
        // Price validation for limit orders
        if (order.type === 'limit' && !order.price) {
            throw new Error('Limit orders require price');
        }
        
        // Stop loss validation
        if (order.type === 'stop_loss' && !order.stopPrice) {
            throw new Error('Stop loss orders require stop price');
        }
        
        // Iceberg validation
        if (order.type === 'iceberg') {
            if (!order.visibleQuantity || !order.totalQuantity) {
                throw new Error('Iceberg orders require visible and total quantities');
            }
            
            if (BigInt(order.visibleQuantity) > BigInt(order.totalQuantity)) {
                throw new Error('Visible quantity cannot exceed total quantity');
            }
        }
        
        // User order count validation
        const userOrderCount = this.userOrders.get(order.userId)?.size || 0;
        if (userOrderCount >= this.config.maxOrdersPerUser) {
            throw new Error('Maximum orders per user exceeded');
        }
    }

    /**
     * Add order to batch processing queue
     * @param {Object} order Order to add
     * @returns {Promise<Object>} Queue result
     * @private
     */
    async _addToBatchQueue(order) {
        order.batchTimestamp = Date.now();
        order.batchId = crypto.randomUUID();
        
        this.batchQueue.push(order);
        
        // Process immediately if batch is full
        if (this.batchQueue.length >= this.config.batchSize) {
            await this._processBatchQueue();
        }
        
        return {
            success: true,
            orderId: order.id,
            batchId: order.batchId,
            queuePosition: this.batchQueue.length
        };
    }

    /**
     * Process order immediately (non-batch mode)
     * @param {Object} order Order to process
     * @returns {Promise<Object>} Processing result
     * @private
     */
    async _processOrderImmediate(order) {
        const startTime = performance.now();
        
        try {
            const result = await this._executeOrder(order);
            
            const processingTime = performance.now() - startTime;
            this.metrics.recordOrderProcessing(order.type, processingTime);
            
            return result;
            
        } catch (error) {
            this.metrics.recordError('order_processing', error);
            throw error;
        }
    }

    /**
     * Process batch queue
     * @private
     */
    async _processBatchQueue() {
        if (this.processingBatch || this.batchQueue.length === 0) {
            return;
        }
        
        this.processingBatch = true;
        
        try {
            const batch = this.batchQueue.splice(0, this.config.batchSize);
            await this.batchProcessor.processBatch(batch);
            
            this.metrics.recordBatchProcessing(batch.length);
            
        } catch (error) {
            console.error('Batch processing error:', error);
            this.metrics.recordError('batch_processing', error);
        } finally {
            this.processingBatch = false;
        }
    }

    /**
     * Execute individual order
     * @param {Object} order Order to execute
     * @returns {Promise<Object>} Execution result
     * @private
     */
    async _executeOrder(order) {
        // Get or create order book
        let orderBook = this.orderBooks.get(order.marketPair);
        if (!orderBook) {
            orderBook = new OrderBook(order.marketPair, this.config);
            this.orderBooks.set(order.marketPair, orderBook);
        }
        
        let result;
        
        switch (order.type) {
            case 'limit':
                result = await this._executeLimitOrder(order, orderBook);
                break;
            case 'market':
                result = await this._executeMarketOrder(order, orderBook);
                break;
            case 'stop_loss':
                result = await this._executeStopLossOrder(order, orderBook);
                break;
            case 'iceberg':
                result = await this._executeIcebergOrder(order, orderBook);
                break;
            default:
                throw new Error(`Unsupported order type: ${order.type}`);
        }
        
        // Track user orders
        if (!this.userOrders.has(order.userId)) {
            this.userOrders.set(order.userId, new Set());
        }
        this.userOrders.get(order.userId).add(order.id);
        
        // Emit order event
        this.emit('orderExecuted', {
            orderId: order.id,
            marketPair: order.marketPair,
            result,
            timestamp: Date.now()
        });
        
        return result;
    }

    /**
     * Execute limit order
     * @param {Object} order Limit order
     * @param {OrderBook} orderBook Order book
     * @returns {Promise<Object>} Execution result
     * @private
     */
    async _executeLimitOrder(order, orderBook) {
        // Check for immediate matches
        const matches = orderBook.findMatches(order);
        const trades = [];
        
        let remainingQuantity = BigInt(order.quantity);
        
        for (const match of matches) {
            const tradeQuantity = remainingQuantity < BigInt(match.quantity) 
                ? remainingQuantity 
                : BigInt(match.quantity);
            
            // Check wash trading before executing
            if (this.config.antiGameingEnabled) {
                const isWashTrade = await this.washTradingDetector.checkWashTrade(
                    order, match
                );
                
                if (isWashTrade) {
                    continue; // Skip this match
                }
            }
            
            const trade = await this._executeTrade(order, match, tradeQuantity);
            trades.push(trade);
            
            remainingQuantity -= tradeQuantity;
            
            if (remainingQuantity === 0n) {
                break;
            }
        }
        
        // Add remaining quantity to order book
        if (remainingQuantity > 0n) {
            const partialOrder = {
                ...order,
                quantity: remainingQuantity.toString()
            };
            
            orderBook.addOrder(partialOrder);
        }
        
        return {
            orderId: order.id,
            status: remainingQuantity === 0n ? 'filled' : 'partial',
            trades,
            remainingQuantity: remainingQuantity.toString()
        };
    }

    /**
     * Execute market order
     * @param {Object} order Market order
     * @param {OrderBook} orderBook Order book
     * @returns {Promise<Object>} Execution result
     * @private
     */
    async _executeMarketOrder(order, orderBook) {
        const matches = orderBook.getMarketMatches(order);
        const trades = [];
        
        let remainingQuantity = BigInt(order.quantity);
        let totalCost = 0n;
        
        for (const match of matches) {
            const tradeQuantity = remainingQuantity < BigInt(match.quantity) 
                ? remainingQuantity 
                : BigInt(match.quantity);
            
            const trade = await this._executeTrade(order, match, tradeQuantity);
            trades.push(trade);
            
            remainingQuantity -= tradeQuantity;
            totalCost += BigInt(trade.price) * tradeQuantity;
            
            if (remainingQuantity === 0n) {
                break;
            }
        }
        
        return {
            orderId: order.id,
            status: remainingQuantity === 0n ? 'filled' : 'partial',
            trades,
            remainingQuantity: remainingQuantity.toString(),
            totalCost: totalCost.toString()
        };
    }

    /**
     * Execute stop loss order
     * @param {Object} order Stop loss order
     * @param {OrderBook} orderBook Order book
     * @returns {Promise<Object>} Execution result
     * @private
     */
    async _executeStopLossOrder(order, orderBook) {
        // Store stop order for monitoring
        this.stopOrders.set(order.id, {
            ...order,
            triggered: false,
            createdAt: Date.now()
        });
        
        // Check if stop price is already triggered
        const currentPrice = orderBook.getLastTradePrice();
        const shouldTrigger = order.side === 'sell' 
            ? currentPrice <= BigInt(order.stopPrice)
            : currentPrice >= BigInt(order.stopPrice);
        
        if (shouldTrigger) {
            // Convert to market order and execute
            const marketOrder = {
                ...order,
                type: 'market'
            };
            
            return this._executeMarketOrder(marketOrder, orderBook);
        }
        
        return {
            orderId: order.id,
            status: 'pending',
            stopPrice: order.stopPrice,
            currentPrice: currentPrice.toString()
        };
    }

    /**
     * Execute iceberg order
     * @param {Object} order Iceberg order
     * @param {OrderBook} orderBook Order book
     * @returns {Promise<Object>} Execution result
     * @private
     */
    async _executeIcebergOrder(order, orderBook) {
        // Store iceberg state
        this.icebergOrders.set(order.id, {
            totalQuantity: BigInt(order.totalQuantity),
            visibleQuantity: BigInt(order.visibleQuantity),
            executedQuantity: 0n,
            currentVisible: BigInt(order.visibleQuantity)
        });
        
        // Create visible portion as limit order
        const visibleOrder = {
            ...order,
            type: 'limit',
            quantity: order.visibleQuantity,
            isIcebergPortion: true,
            parentOrderId: order.id
        };
        
        return this._executeLimitOrder(visibleOrder, orderBook);
    }

    /**
     * Execute trade between two orders
     * @param {Object} takerOrder Taker order
     * @param {Object} makerOrder Maker order
     * @param {BigInt} quantity Trade quantity
     * @returns {Promise<Object>} Trade result
     * @private
     */
    async _executeTrade(takerOrder, makerOrder, quantity) {
        const trade = {
            id: crypto.randomUUID(),
            takerId: takerOrder.userId,
            makerId: makerOrder.userId,
            marketPair: takerOrder.marketPair,
            side: takerOrder.side,
            quantity: quantity.toString(),
            price: makerOrder.price,
            timestamp: Date.now(),
            takerOrderId: takerOrder.id,
            makerOrderId: makerOrder.id
        };
        
        // MEV protection
        if (this.config.mevProtectionEnabled) {
            trade.mevProtected = await this.mevProtector.protectTrade(trade);
        }
        
        // Update order quantities
        makerOrder.quantity = (BigInt(makerOrder.quantity) - quantity).toString();
        
        // Remove maker order if fully filled
        if (BigInt(makerOrder.quantity) === 0n) {
            const orderBook = this.orderBooks.get(makerOrder.marketPair);
            orderBook?.removeOrder(makerOrder.id);
        }
        
        // Update iceberg orders
        await this._updateIcebergOrder(takerOrder, quantity);
        await this._updateIcebergOrder(makerOrder, quantity);
        
        // Emit trade event
        this.emit('tradeExecuted', trade);
        
        this.metrics.recordTrade(trade);
        
        return trade;
    }

    /**
     * Update iceberg order after execution
     * @param {Object} order Order that was executed
     * @param {BigInt} executedQuantity Quantity that was executed
     * @private
     */
    async _updateIcebergOrder(order, executedQuantity) {
        const icebergState = this.icebergOrders.get(order.parentOrderId || order.id);
        if (!icebergState) return;
        
        icebergState.executedQuantity += executedQuantity;
        icebergState.currentVisible -= executedQuantity;
        
        // If visible portion is exhausted, add next portion
        if (icebergState.currentVisible === 0n) {
            const remaining = icebergState.totalQuantity - icebergState.executedQuantity;
            
            if (remaining > 0n) {
                const nextVisible = remaining < icebergState.visibleQuantity 
                    ? remaining 
                    : icebergState.visibleQuantity;
                
                icebergState.currentVisible = nextVisible;
                
                // Add next visible portion to order book
                const nextOrder = {
                    ...order,
                    id: crypto.randomUUID(),
                    quantity: nextVisible.toString(),
                    type: 'limit',
                    isIcebergPortion: true,
                    parentOrderId: order.parentOrderId || order.id
                };
                
                const orderBook = this.orderBooks.get(order.marketPair);
                orderBook?.addOrder(nextOrder);
            }
        }
    }

    /**
     * Monitor stop orders for trigger conditions
     * @private
     */
    async _monitorStopOrders() {
        for (const [orderId, stopOrder] of this.stopOrders) {
            if (stopOrder.triggered) continue;
            
            const orderBook = this.orderBooks.get(stopOrder.marketPair);
            if (!orderBook) continue;
            
            const currentPrice = orderBook.getLastTradePrice();
            const shouldTrigger = stopOrder.side === 'sell' 
                ? currentPrice <= BigInt(stopOrder.stopPrice)
                : currentPrice >= BigInt(stopOrder.stopPrice);
            
            if (shouldTrigger) {
                stopOrder.triggered = true;
                
                // Convert to market order
                const marketOrder = {
                    ...stopOrder,
                    type: 'market'
                };
                
                try {
                    await this._executeMarketOrder(marketOrder, orderBook);
                    this.stopOrders.delete(orderId);
                } catch (error) {
                    console.error(`Stop order execution failed: ${orderId}`, error);
                }
            }
        }
    }

    /**
     * Get order by ID
     * @param {string} orderId Order ID
     * @returns {Promise<Object|null>} Order or null
     * @private
     */
    async _getOrder(orderId) {
        // Search in all order books
        for (const orderBook of this.orderBooks.values()) {
            const order = orderBook.getOrder(orderId);
            if (order) return order;
        }
        
        // Check stop orders
        const stopOrder = this.stopOrders.get(orderId);
        if (stopOrder) return stopOrder;
        
        return null;
    }

    /**
     * Get matching engine statistics
     * @returns {Object} Engine statistics
     */
    getStatistics() {
        return {
            orderBooks: this.orderBooks.size,
            activeOrders: Array.from(this.orderBooks.values())
                .reduce((total, book) => total + book.getOrderCount(), 0),
            stopOrders: this.stopOrders.size,
            icebergOrders: this.icebergOrders.size,
            batchQueueSize: this.batchQueue.length,
            metrics: this.metrics.getMetrics(),
            antiGaming: this.antiGamingEngine.getStatistics(),
            fairOrdering: this.fairOrderingEngine.getStatistics()
        };
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.batchTimer) {
            clearInterval(this.batchTimer);
        }
        
        this.orderBooks.clear();
        this.userOrders.clear();
        this.icebergOrders.clear();
        this.stopOrders.clear();
        this.batchQueue.length = 0;
        
        this.emit('engineDestroyed');
    }
}

// =============================================================================
// ORDER BOOK IMPLEMENTATION
// =============================================================================

class OrderBook {
    constructor(marketPair, config) {
        this.marketPair = marketPair;
        this.config = config;
        this.bids = new Map(); // price -> orders
        this.asks = new Map(); // price -> orders
        this.orders = new Map(); // orderId -> order
        this.lastTradePrice = 0n;
        this.priceIndex = new PriceIndex();
    }

    addOrder(order) {
        this.orders.set(order.id, order);
        
        const orderMap = order.side === 'buy' ? this.bids : this.asks;
        const price = BigInt(order.price);
        
        if (!orderMap.has(price)) {
            orderMap.set(price, []);
        }
        
        orderMap.get(price).push(order);
        this.priceIndex.addPrice(price, order.side);
    }

    removeOrder(orderId) {
        const order = this.orders.get(orderId);
        if (!order) return false;
        
        const orderMap = order.side === 'buy' ? this.bids : this.asks;
        const price = BigInt(order.price);
        const orders = orderMap.get(price);
        
        if (orders) {
            const index = orders.findIndex(o => o.id === orderId);
            if (index !== -1) {
                orders.splice(index, 1);
                
                if (orders.length === 0) {
                    orderMap.delete(price);
                    this.priceIndex.removePrice(price, order.side);
                }
            }
        }
        
        this.orders.delete(orderId);
        return true;
    }

    findMatches(order) {
        const oppositeMap = order.side === 'buy' ? this.asks : this.bids;
        const matches = [];
        
        // Get best prices in order
        const prices = order.side === 'buy' 
            ? this.priceIndex.getBestAsks()
            : this.priceIndex.getBestBids();
        
        for (const price of prices) {
            const orderPrice = BigInt(order.price);
            
            // Check price condition
            const canMatch = order.side === 'buy' 
                ? price <= orderPrice
                : price >= orderPrice;
                
            if (!canMatch) break;
            
            const ordersAtPrice = oppositeMap.get(price) || [];
            matches.push(...ordersAtPrice);
        }
        
        return matches;
    }

    getMarketMatches(order) {
        const oppositeMap = order.side === 'buy' ? this.asks : this.bids;
        const matches = [];
        
        // Get all orders from best price
        const prices = order.side === 'buy' 
            ? this.priceIndex.getBestAsks()
            : this.priceIndex.getBestBids();
        
        for (const price of prices) {
            const ordersAtPrice = oppositeMap.get(price) || [];
            matches.push(...ordersAtPrice);
        }
        
        return matches;
    }

    getOrder(orderId) {
        return this.orders.get(orderId);
    }

    getOrderCount() {
        return this.orders.size;
    }

    getLastTradePrice() {
        return this.lastTradePrice;
    }

    setLastTradePrice(price) {
        this.lastTradePrice = BigInt(price);
    }

    getSnapshot() {
        const bids = [];
        const asks = [];
        
        // Sort bids by price (highest first)
        const sortedBidPrices = Array.from(this.bids.keys()).sort((a, b) => 
            a > b ? -1 : a < b ? 1 : 0
        );
        
        for (const price of sortedBidPrices) {
            const orders = this.bids.get(price);
            const totalQuantity = orders.reduce(
                (sum, order) => sum + BigInt(order.quantity), 0n
            );
            
            bids.push({
                price: price.toString(),
                quantity: totalQuantity.toString(),
                orderCount: orders.length
            });
        }
        
        // Sort asks by price (lowest first)
        const sortedAskPrices = Array.from(this.asks.keys()).sort((a, b) => 
            a < b ? -1 : a > b ? 1 : 0
        );
        
        for (const price of sortedAskPrices) {
            const orders = this.asks.get(price);
            const totalQuantity = orders.reduce(
                (sum, order) => sum + BigInt(order.quantity), 0n
            );
            
            asks.push({
                price: price.toString(),
                quantity: totalQuantity.toString(),
                orderCount: orders.length
            });
        }
        
        return {
            marketPair: this.marketPair,
            bids: bids.slice(0, 20), // Top 20 levels
            asks: asks.slice(0, 20),
            lastTradePrice: this.lastTradePrice.toString()
        };
    }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

class PriceIndex {
    constructor() {
        this.bidPrices = new Set();
        this.askPrices = new Set();
    }

    addPrice(price, side) {
        if (side === 'buy') {
            this.bidPrices.add(price);
        } else {
            this.askPrices.add(price);
        }
    }

    removePrice(price, side) {
        if (side === 'buy') {
            this.bidPrices.delete(price);
        } else {
            this.askPrices.delete(price);
        }
    }

    getBestBids() {
        return Array.from(this.bidPrices).sort((a, b) => a > b ? -1 : 1);
    }

    getBestAsks() {
        return Array.from(this.askPrices).sort((a, b) => a < b ? -1 : 1);
    }
}

class BatchProcessor {
    constructor(config) {
        this.config = config;
    }

    async processBatch(orders) {
        // Group orders by market pair for efficient processing
        const ordersByMarket = new Map();
        
        for (const order of orders) {
            if (!ordersByMarket.has(order.marketPair)) {
                ordersByMarket.set(order.marketPair, []);
            }
            ordersByMarket.get(order.marketPair).push(order);
        }
        
        // Process each market in parallel
        const processingPromises = Array.from(ordersByMarket.entries()).map(
            ([marketPair, marketOrders]) => this._processMarketBatch(marketPair, marketOrders)
        );
        
        return Promise.all(processingPromises);
    }

    async _processMarketBatch(marketPair, orders) {
        // Sort orders for fair processing
        orders.sort((a, b) => {
            // Time priority first
            if (a.batchTimestamp !== b.batchTimestamp) {
                return a.batchTimestamp - b.batchTimestamp;
            }
            // Then by order ID for deterministic ordering
            return a.id.localeCompare(b.id);
        });
        
        const results = [];
        
        for (const order of orders) {
            try {
                const result = await this._processOrder(order);
                results.push(result);
            } catch (error) {
                results.push({
                    orderId: order.id,
                    error: error.message,
                    success: false
                });
            }
        }
        
        return results;
    }

    async _processOrder(order) {
        // Mock order processing - would integrate with main engine
        return {
            orderId: order.id,
            status: 'processed',
            timestamp: Date.now(),
            success: true
        };
    }
}

class MatchingEngineMetrics {
    constructor() {
        this.metrics = {
            ordersProcessed: 0,
            tradesExecuted: 0,
            batchesProcessed: 0,
            averageProcessingTime: 0,
            errorCount: 0,
            orderTypes: {
                limit: 0,
                market: 0,
                stop_loss: 0,
                iceberg: 0
            }
        };
    }

    recordOrderProcessing(type, processingTime) {
        this.metrics.ordersProcessed++;
        this.metrics.orderTypes[type]++;
        
        // Update average processing time
        const totalTime = this.metrics.averageProcessingTime * (this.metrics.ordersProcessed - 1) + processingTime;
        this.metrics.averageProcessingTime = totalTime / this.metrics.ordersProcessed;
    }

    recordTrade(trade) {
        this.metrics.tradesExecuted++;
    }

    recordBatchProcessing(batchSize) {
        this.metrics.batchesProcessed++;
    }

    recordError(operation, error) {
        this.metrics.errorCount++;
        console.error(`Matching engine error in ${operation}:`, error.message);
    }

    getMetrics() {
        return { ...this.metrics };
    }
}

module.exports = {
    AdvancedMatchingEngine,
    OrderBook,
    BatchProcessor,
    PriceIndex,
    MatchingEngineMetrics
};