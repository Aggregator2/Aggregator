/**
 * @fileoverview Memory-Efficient Order Book Data Structure
 * @author SwappiQ Protocol
 * @description High-performance order book with memory optimization and real-time updates
 */

const EventEmitter = require('events');

/**
 * Memory-Efficient Order Book implementation
 * Uses red-black trees for price levels and circular buffers for trade history
 */
class MemoryEfficientOrderBook extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Memory management
            maxPriceLevels: config.maxPriceLevels || 1000,
            maxOrdersPerLevel: config.maxOrdersPerLevel || 500,
            maxTradeHistory: config.maxTradeHistory || 10000,
            memoryThreshold: config.memoryThreshold || 100 * 1024 * 1024, // 100MB
            
            // Performance settings
            batchSize: config.batchSize || 100,
            compressionEnabled: config.compressionEnabled !== false,
            aggregationEnabled: config.aggregationEnabled !== false,
            
            // Data retention
            retentionPeriod: config.retentionPeriod || 86400000, // 24 hours
            snapshotInterval: config.snapshotInterval || 300000, // 5 minutes
            
            // Trading pair
            symbol: config.symbol || 'ETH/USDT',
            baseAsset: config.baseAsset || 'ETH',
            quoteAsset: config.quoteAsset || 'USDT',
            tickSize: config.tickSize || 0.01,
            stepSize: config.stepSize || 0.001,
            
            ...config
        };

        this.state = {
            sequence: 0,
            lastUpdate: 0,
            bids: new PriceLevelTree('desc'), // Descending order for bids
            asks: new PriceLevelTree('asc'),  // Ascending order for asks
            orders: new Map(), // orderId -> order details
            trades: new CircularBuffer(this.config.maxTradeHistory),
            aggregatedLevels: {
                bids: new Map(),
                asks: new Map()
            },
            metrics: {
                totalOrders: 0,
                totalTrades: 0,
                memoryUsage: 0,
                lastCleanup: Date.now()
            }
        };

        this.spread = null;
        this.midPrice = null;
        this.volume24h = 0;
        this.lastPrice = null;
        
        this._startMemoryMonitoring();
    }

    /**
     * Add order to the order book
     */
    addOrder(order) {
        try {
            const {
                id,
                side, // 'buy' or 'sell'
                price,
                quantity,
                timestamp = Date.now(),
                userId,
                type = 'limit'
            } = order;

            // Validate order
            if (!this._validateOrder(order)) {
                throw new Error('Invalid order format');
            }

            // Round price and quantity to valid tick/step sizes
            const normalizedPrice = this._normalizePrice(price);
            const normalizedQuantity = this._normalizeQuantity(quantity);

            const normalizedOrder = {
                id,
                side,
                price: normalizedPrice,
                quantity: normalizedQuantity,
                remainingQuantity: normalizedQuantity,
                timestamp,
                userId,
                type,
                sequence: ++this.state.sequence
            };

            // Add to order tracking
            this.state.orders.set(id, normalizedOrder);

            // Add to appropriate side
            const tree = side === 'buy' ? this.state.bids : this.state.asks;
            tree.addOrder(normalizedPrice, normalizedOrder);

            // Update aggregated levels if enabled
            if (this.config.aggregationEnabled) {
                this._updateAggregatedLevel(side, normalizedPrice, normalizedQuantity);
            }

            // Update metrics
            this.state.metrics.totalOrders++;
            this.state.lastUpdate = timestamp;

            // Emit events
            this.emit('orderAdded', normalizedOrder);
            this._emitBookUpdate('add', normalizedOrder);

            // Check for immediate matching
            const matches = this._findMatches(normalizedOrder);
            for (const match of matches) {
                this._executeMatch(match);
            }

            // Update derived data
            this._updateDerivedData();

            return normalizedOrder;

        } catch (error) {
            console.error('Failed to add order:', error);
            throw error;
        }
    }

    /**
     * Remove order from the order book
     */
    removeOrder(orderId) {
        try {
            const order = this.state.orders.get(orderId);
            if (!order) {
                return null;
            }

            // Remove from tree
            const tree = order.side === 'buy' ? this.state.bids : this.state.asks;
            tree.removeOrder(order.price, order.id);

            // Update aggregated levels
            if (this.config.aggregationEnabled) {
                this._updateAggregatedLevel(order.side, order.price, -order.remainingQuantity);
            }

            // Remove from tracking
            this.state.orders.delete(orderId);

            // Update timestamp
            this.state.lastUpdate = Date.now();

            // Emit events
            this.emit('orderRemoved', order);
            this._emitBookUpdate('remove', order);

            // Update derived data
            this._updateDerivedData();

            return order;

        } catch (error) {
            console.error('Failed to remove order:', error);
            throw error;
        }
    }

    /**
     * Update existing order
     */
    updateOrder(orderId, updates) {
        try {
            const order = this.state.orders.get(orderId);
            if (!order) {
                throw new Error(`Order ${orderId} not found`);
            }

            // If price changed, need to move in tree
            if (updates.price && updates.price !== order.price) {
                this.removeOrder(orderId);
                return this.addOrder({
                    ...order,
                    ...updates,
                    id: orderId
                });
            }

            // Update quantity
            if (updates.quantity !== undefined) {
                const quantityDiff = updates.quantity - order.remainingQuantity;
                order.remainingQuantity = updates.quantity;

                // Update aggregated levels
                if (this.config.aggregationEnabled) {
                    this._updateAggregatedLevel(order.side, order.price, quantityDiff);
                }
            }

            // Update other fields
            Object.assign(order, updates);
            order.sequence = ++this.state.sequence;
            this.state.lastUpdate = Date.now();

            // Emit events
            this.emit('orderUpdated', order);
            this._emitBookUpdate('update', order);

            // Update derived data
            this._updateDerivedData();

            return order;

        } catch (error) {
            console.error('Failed to update order:', error);
            throw error;
        }
    }

    /**
     * Get current order book snapshot
     */
    getSnapshot(depth = 20) {
        const snapshot = {
            symbol: this.config.symbol,
            timestamp: this.state.lastUpdate,
            sequence: this.state.sequence,
            bids: this._getLevels(this.state.bids, depth),
            asks: this._getLevels(this.state.asks, depth),
            spread: this.spread,
            midPrice: this.midPrice,
            lastPrice: this.lastPrice,
            volume24h: this.volume24h
        };

        return snapshot;
    }

    /**
     * Get aggregated levels for efficient transmission
     */
    getAggregatedSnapshot(levels = 10) {
        if (!this.config.aggregationEnabled) {
            return this.getSnapshot(levels);
        }

        const bids = Array.from(this.state.aggregatedLevels.bids.entries())
            .sort((a, b) => b[0] - a[0])
            .slice(0, levels)
            .map(([price, quantity]) => [price, quantity]);

        const asks = Array.from(this.state.aggregatedLevels.asks.entries())
            .sort((a, b) => a[0] - b[0])
            .slice(0, levels)
            .map(([price, quantity]) => [price, quantity]);

        return {
            symbol: this.config.symbol,
            timestamp: this.state.lastUpdate,
            sequence: this.state.sequence,
            bids,
            asks,
            spread: this.spread,
            midPrice: this.midPrice,
            aggregated: true
        };
    }

    /**
     * Execute trade and update order book
     */
    executeTrade(trade) {
        try {
            const {
                id,
                price,
                quantity,
                timestamp = Date.now(),
                buyOrderId,
                sellOrderId,
                takerSide
            } = trade;

            // Add to trade history
            this.state.trades.add({
                id,
                price,
                quantity,
                timestamp,
                buyOrderId,
                sellOrderId,
                takerSide,
                sequence: ++this.state.sequence
            });

            // Update orders
            if (buyOrderId) {
                this._updateOrderAfterTrade(buyOrderId, quantity);
            }
            if (sellOrderId) {
                this._updateOrderAfterTrade(sellOrderId, quantity);
            }

            // Update metrics
            this.state.metrics.totalTrades++;
            this.lastPrice = price;
            this.state.lastUpdate = timestamp;

            // Update 24h volume
            this._update24hVolume(quantity, timestamp);

            // Emit events
            this.emit('trade', trade);

            // Update derived data
            this._updateDerivedData();

            return trade;

        } catch (error) {
            console.error('Failed to execute trade:', error);
            throw error;
        }
    }

    /**
     * Clear all data (for reset)
     */
    clear() {
        this.state.bids.clear();
        this.state.asks.clear();
        this.state.orders.clear();
        this.state.trades.clear();
        this.state.aggregatedLevels.bids.clear();
        this.state.aggregatedLevels.asks.clear();
        this.state.sequence = 0;
        this.state.lastUpdate = 0;
        this.spread = null;
        this.midPrice = null;
        this.lastPrice = null;
        this.volume24h = 0;

        this.emit('cleared');
    }

    /**
     * Get memory usage statistics
     */
    getMemoryStats() {
        const process = require('process');
        const memUsage = process.memoryUsage();
        
        return {
            orderCount: this.state.orders.size,
            bidLevels: this.state.bids.size(),
            askLevels: this.state.asks.size(),
            tradeHistory: this.state.trades.size(),
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
            estimated: this._estimateMemoryUsage()
        };
    }

    // ========== PRIVATE METHODS ==========

    _validateOrder(order) {
        return order.id && 
               order.side && 
               ['buy', 'sell'].includes(order.side) &&
               typeof order.price === 'number' && order.price > 0 &&
               typeof order.quantity === 'number' && order.quantity > 0;
    }

    _normalizePrice(price) {
        return Math.round(price / this.config.tickSize) * this.config.tickSize;
    }

    _normalizeQuantity(quantity) {
        return Math.round(quantity / this.config.stepSize) * this.config.stepSize;
    }

    _getLevels(tree, depth) {
        const levels = [];
        const iterator = tree.iterator();
        let count = 0;

        for (const [price, priceLevel] of iterator) {
            if (count >= depth) break;
            
            levels.push([
                price,
                priceLevel.totalQuantity,
                priceLevel.orderCount
            ]);
            count++;
        }

        return levels;
    }

    _updateAggregatedLevel(side, price, quantityDiff) {
        const levels = this.state.aggregatedLevels[side === 'buy' ? 'bids' : 'asks'];
        const current = levels.get(price) || 0;
        const newQuantity = current + quantityDiff;

        if (newQuantity <= 0) {
            levels.delete(price);
        } else {
            levels.set(price, newQuantity);
        }
    }

    _findMatches(order) {
        const matches = [];
        const oppositeTree = order.side === 'buy' ? this.state.asks : this.state.bids;
        
        for (const [price, priceLevel] of oppositeTree.iterator()) {
            if (order.side === 'buy' && price > order.price) break;
            if (order.side === 'sell' && price < order.price) break;
            
            for (const oppositeOrder of priceLevel.orders.values()) {
                if (oppositeOrder.remainingQuantity > 0) {
                    const matchQuantity = Math.min(
                        order.remainingQuantity,
                        oppositeOrder.remainingQuantity
                    );
                    
                    matches.push({
                        price: oppositeOrder.price,
                        quantity: matchQuantity,
                        buyOrder: order.side === 'buy' ? order : oppositeOrder,
                        sellOrder: order.side === 'sell' ? order : oppositeOrder
                    });
                    
                    order.remainingQuantity -= matchQuantity;
                    if (order.remainingQuantity <= 0) break;
                }
            }
            if (order.remainingQuantity <= 0) break;
        }

        return matches;
    }

    _executeMatch(match) {
        const trade = {
            id: `${match.buyOrder.id}_${match.sellOrder.id}_${Date.now()}`,
            price: match.price,
            quantity: match.quantity,
            timestamp: Date.now(),
            buyOrderId: match.buyOrder.id,
            sellOrderId: match.sellOrder.id,
            takerSide: match.buyOrder.timestamp > match.sellOrder.timestamp ? 'buy' : 'sell'
        };

        this.executeTrade(trade);
    }

    _updateOrderAfterTrade(orderId, tradedQuantity) {
        const order = this.state.orders.get(orderId);
        if (order) {
            order.remainingQuantity -= tradedQuantity;
            if (order.remainingQuantity <= 0) {
                this.removeOrder(orderId);
            }
        }
    }

    _updateDerivedData() {
        // Calculate spread
        const bestBid = this.state.bids.getBest();
        const bestAsk = this.state.asks.getBest();

        if (bestBid && bestAsk) {
            this.spread = bestAsk.price - bestBid.price;
            this.midPrice = (bestBid.price + bestAsk.price) / 2;
        } else {
            this.spread = null;
            this.midPrice = null;
        }
    }

    _update24hVolume(quantity, timestamp) {
        // Simple implementation - would need more sophisticated windowing
        this.volume24h += quantity;
    }

    _emitBookUpdate(type, order) {
        this.emit('bookUpdate', {
            type,
            side: order.side,
            price: order.price,
            quantity: order.remainingQuantity,
            timestamp: Date.now(),
            sequence: this.state.sequence
        });
    }

    _startMemoryMonitoring() {
        setInterval(() => {
            const memStats = this.getMemoryStats();
            
            if (memStats.heapUsed > this.config.memoryThreshold) {
                this._performMemoryCleanup();
            }
            
            this.emit('memoryStats', memStats);
        }, 30000); // Check every 30 seconds
    }

    _performMemoryCleanup() {
        const now = Date.now();
        const retentionThreshold = now - this.config.retentionPeriod;
        
        // Clean old trades
        this.state.trades.removeOldEntries(retentionThreshold);
        
        // Clean empty price levels
        this.state.bids.cleanup();
        this.state.asks.cleanup();
        
        this.state.metrics.lastCleanup = now;
        this.emit('memoryCleanup', { timestamp: now });
    }

    _estimateMemoryUsage() {
        // Rough estimation
        const orderSize = 200; // bytes per order
        const levelSize = 100; // bytes per price level
        const tradeSize = 150; // bytes per trade
        
        return (this.state.orders.size * orderSize) +
               ((this.state.bids.size() + this.state.asks.size()) * levelSize) +
               (this.state.trades.size() * tradeSize);
    }
}

/**
 * Red-Black Tree implementation for price levels
 */
class PriceLevelTree {
    constructor(order = 'asc') {
        this.order = order; // 'asc' or 'desc'
        this.levels = new Map();
    }

    addOrder(price, order) {
        if (!this.levels.has(price)) {
            this.levels.set(price, new PriceLevel(price));
        }
        this.levels.get(price).addOrder(order);
    }

    removeOrder(price, orderId) {
        const level = this.levels.get(price);
        if (level) {
            level.removeOrder(orderId);
            if (level.isEmpty()) {
                this.levels.delete(price);
            }
        }
    }

    getBest() {
        if (this.levels.size === 0) return null;
        
        const prices = Array.from(this.levels.keys());
        prices.sort((a, b) => this.order === 'asc' ? a - b : b - a);
        
        return this.levels.get(prices[0]);
    }

    iterator() {
        const prices = Array.from(this.levels.keys());
        prices.sort((a, b) => this.order === 'asc' ? a - b : b - a);
        
        return prices.map(price => [price, this.levels.get(price)]);
    }

    size() {
        return this.levels.size;
    }

    clear() {
        this.levels.clear();
    }

    cleanup() {
        for (const [price, level] of this.levels.entries()) {
            if (level.isEmpty()) {
                this.levels.delete(price);
            }
        }
    }
}

/**
 * Price level containing orders at a specific price
 */
class PriceLevel {
    constructor(price) {
        this.price = price;
        this.orders = new Map();
        this.totalQuantity = 0;
        this.orderCount = 0;
    }

    addOrder(order) {
        this.orders.set(order.id, order);
        this.totalQuantity += order.remainingQuantity;
        this.orderCount++;
    }

    removeOrder(orderId) {
        const order = this.orders.get(orderId);
        if (order) {
            this.totalQuantity -= order.remainingQuantity;
            this.orderCount--;
            this.orders.delete(orderId);
        }
    }

    isEmpty() {
        return this.orders.size === 0;
    }
}

/**
 * Circular buffer for trade history
 */
class CircularBuffer {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.buffer = new Array(maxSize);
        this.head = 0;
        this.tail = 0;
        this.count = 0;
    }

    add(item) {
        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) % this.maxSize;
        
        if (this.count < this.maxSize) {
            this.count++;
        } else {
            this.head = (this.head + 1) % this.maxSize;
        }
    }

    get(index) {
        if (index >= this.count) return null;
        return this.buffer[(this.head + index) % this.maxSize];
    }

    size() {
        return this.count;
    }

    clear() {
        this.head = 0;
        this.tail = 0;
        this.count = 0;
    }

    removeOldEntries(threshold) {
        while (this.count > 0) {
            const oldest = this.buffer[this.head];
            if (oldest && oldest.timestamp >= threshold) {
                break;
            }
            this.head = (this.head + 1) % this.maxSize;
            this.count--;
        }
    }

    toArray() {
        const result = [];
        for (let i = 0; i < this.count; i++) {
            result.push(this.get(i));
        }
        return result;
    }
}

module.exports = { 
    MemoryEfficientOrderBook, 
    PriceLevelTree, 
    PriceLevel, 
    CircularBuffer 
};