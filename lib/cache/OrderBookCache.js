/**
 * @fileoverview Order Book Cache with Atomic Updates for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description High-performance order book caching with atomic operations and real-time synchronization
 */

const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

/**
 * Order Book Cache Manager
 * Provides atomic updates, compression, and real-time order book management
 */
class OrderBookCache {
    constructor(redis, config) {
        this.redis = redis;
        this.config = {
            ttl: config.ttl || 300, // 5 minutes
            maxSize: config.maxSize || 10000,
            compressionThreshold: config.compressionThreshold || 1024,
            atomicUpdates: config.atomicUpdates !== false,
            snapshotInterval: config.snapshotInterval || 60000, // 1 minute
            maxDepth: config.maxDepth || 100, // Order book depth
            priceDecimalPlaces: config.priceDecimalPlaces || 8,
            quantityDecimalPlaces: config.quantityDecimalPlaces || 8,
            ...config
        };

        this.state = {
            stats: {
                updates: 0,
                snapshots: 0,
                errors: 0,
                compressionSaved: 0,
                avgUpdateTime: 0
            },
            activeOrderBooks: new Set(),
            snapshotTimer: null,
            updateQueue: new Map()
        };

        // Lua scripts for atomic operations
        this.luaScripts = {
            updateOrderBook: null,
            addOrder: null,
            removeOrder: null,
            updateOrder: null,
            getOrderBook: null
        };

        this.gzip = promisify(zlib.gzip);
        this.gunzip = promisify(zlib.gunzip);
    }

    /**
     * Initialize order book cache
     */
    async initialize() {
        try {
            await this._loadLuaScripts();
            await this._startSnapshotScheduler();
            console.log('Order Book Cache initialized');
        } catch (error) {
            console.error('Failed to initialize Order Book Cache:', error);
            throw error;
        }
    }

    /**
     * Load Lua scripts for atomic operations
     */
    async _loadLuaScripts() {
        // Atomic order book update script
        this.luaScripts.updateOrderBook = await this.redis.defineCommand('updateOrderBook', {
            numberOfKeys: 3,
            lua: `
                local orderBookKey = KEYS[1]
                local priceKey = KEYS[2]
                local metadataKey = KEYS[3]
                local orderData = ARGV[1]
                local ttl = tonumber(ARGV[2])
                local timestamp = ARGV[3]
                local sequenceNumber = tonumber(ARGV[4])
                
                -- Get current sequence number
                local currentSeq = redis.call('HGET', metadataKey, 'sequence')
                if currentSeq and tonumber(currentSeq) >= sequenceNumber then
                    return {false, 'stale_update'}
                end
                
                -- Update order book atomically
                redis.call('HSET', orderBookKey, priceKey, orderData)
                redis.call('HSET', metadataKey, 'sequence', sequenceNumber)
                redis.call('HSET', metadataKey, 'lastUpdate', timestamp)
                redis.call('EXPIRE', orderBookKey, ttl)
                redis.call('EXPIRE', metadataKey, ttl)
                
                return {true, 'updated'}
            `
        });

        // Add new order script
        this.luaScripts.addOrder = await this.redis.defineCommand('addOrder', {
            numberOfKeys: 2,
            lua: `
                local orderBookKey = KEYS[1]
                local metadataKey = KEYS[2]
                local side = ARGV[1]  -- 'bid' or 'ask'
                local price = ARGV[2]
                local quantity = ARGV[3]
                local orderId = ARGV[4]
                local timestamp = ARGV[5]
                local ttl = tonumber(ARGV[6])
                
                -- Get current order book
                local orderBook = redis.call('HGET', orderBookKey, side)
                local orders = {}
                
                if orderBook then
                    orders = cjson.decode(orderBook)
                end
                
                -- Find insertion point (price-time priority)
                local priceNum = tonumber(price)
                local inserted = false
                
                for i = 1, #orders do
                    local orderPrice = tonumber(orders[i].price)
                    
                    -- For bids: higher price first, for asks: lower price first
                    local shouldInsert = false
                    if side == 'bid' then
                        shouldInsert = priceNum > orderPrice
                    else
                        shouldInsert = priceNum < orderPrice
                    end
                    
                    if shouldInsert then
                        table.insert(orders, i, {
                            id = orderId,
                            price = price,
                            quantity = quantity,
                            timestamp = timestamp
                        })
                        inserted = true
                        break
                    end
                end
                
                -- If not inserted, add to end
                if not inserted then
                    table.insert(orders, {
                        id = orderId,
                        price = price,
                        quantity = quantity,
                        timestamp = timestamp
                    })
                end
                
                -- Update order book
                redis.call('HSET', orderBookKey, side, cjson.encode(orders))
                redis.call('HSET', metadataKey, 'lastUpdate', timestamp)
                redis.call('EXPIRE', orderBookKey, ttl)
                redis.call('EXPIRE', metadataKey, ttl)
                
                return {true, #orders}
            `
        });

        // Remove order script
        this.luaScripts.removeOrder = await this.redis.defineCommand('removeOrder', {
            numberOfKeys: 2,
            lua: `
                local orderBookKey = KEYS[1]
                local metadataKey = KEYS[2]
                local side = ARGV[1]
                local orderId = ARGV[2]
                local timestamp = ARGV[3]
                local ttl = tonumber(ARGV[4])
                
                -- Get current order book
                local orderBook = redis.call('HGET', orderBookKey, side)
                if not orderBook then
                    return {false, 'order_book_not_found'}
                end
                
                local orders = cjson.decode(orderBook)
                local removed = false
                
                -- Find and remove order
                for i = #orders, 1, -1 do
                    if orders[i].id == orderId then
                        table.remove(orders, i)
                        removed = true
                        break
                    end
                end
                
                if not removed then
                    return {false, 'order_not_found'}
                end
                
                -- Update order book
                redis.call('HSET', orderBookKey, side, cjson.encode(orders))
                redis.call('HSET', metadataKey, 'lastUpdate', timestamp)
                redis.call('EXPIRE', orderBookKey, ttl)
                redis.call('EXPIRE', metadataKey, ttl)
                
                return {true, #orders}
            `
        });
    }

    /**
     * Update complete order book atomically
     */
    async updateOrderBook(tradingPair, orderBookData, sequenceNumber) {
        const startTime = Date.now();
        
        try {
            const key = this._getOrderBookKey(tradingPair);
            const metadataKey = this._getMetadataKey(tradingPair);
            
            // Validate order book data
            this._validateOrderBookData(orderBookData);
            
            // Compress if data is large
            let serializedData = JSON.stringify(orderBookData);
            if (serializedData.length > this.config.compressionThreshold) {
                const compressed = await this.gzip(Buffer.from(serializedData));
                serializedData = compressed.toString('base64');
                this.state.stats.compressionSaved += serializedData.length - compressed.length;
            }
            
            // Execute atomic update
            const result = await this.redis.updateOrderBook(
                key,
                'data',
                metadataKey,
                serializedData,
                this.config.ttl,
                Date.now().toString(),
                sequenceNumber
            );
            
            if (result[0]) {
                this.state.activeOrderBooks.add(tradingPair);
                this.state.stats.updates++;
                
                // Emit update event
                await this._publishOrderBookUpdate(tradingPair, orderBookData, sequenceNumber);
            }
            
            this._updateStats('update', Date.now() - startTime);
            return { success: result[0], reason: result[1] };
            
        } catch (error) {
            this.state.stats.errors++;
            console.error('Order book update error:', error);
            throw error;
        }
    }

    /**
     * Add new order to order book
     */
    async addOrder(tradingPair, side, price, quantity, orderId) {
        const startTime = Date.now();
        
        try {
            // Validate inputs
            this._validateOrderData(side, price, quantity, orderId);
            
            const key = this._getOrderBookKey(tradingPair);
            const metadataKey = this._getMetadataKey(tradingPair);
            
            const result = await this.redis.addOrder(
                key,
                metadataKey,
                side,
                this._formatPrice(price),
                this._formatQuantity(quantity),
                orderId,
                Date.now().toString(),
                this.config.ttl
            );
            
            if (result[0]) {
                this.state.activeOrderBooks.add(tradingPair);
                
                // Publish real-time update
                await this._publishOrderUpdate(tradingPair, 'add', {
                    side,
                    price: this._formatPrice(price),
                    quantity: this._formatQuantity(quantity),
                    orderId
                });
            }
            
            this._updateStats('add', Date.now() - startTime);
            return { success: result[0], orderCount: result[1] };
            
        } catch (error) {
            this.state.stats.errors++;
            console.error('Add order error:', error);
            throw error;
        }
    }

    /**
     * Remove order from order book
     */
    async removeOrder(tradingPair, side, orderId) {
        const startTime = Date.now();
        
        try {
            this._validateSide(side);
            
            const key = this._getOrderBookKey(tradingPair);
            const metadataKey = this._getMetadataKey(tradingPair);
            
            const result = await this.redis.removeOrder(
                key,
                metadataKey,
                side,
                orderId,
                Date.now().toString(),
                this.config.ttl
            );
            
            if (result[0]) {
                // Publish real-time update
                await this._publishOrderUpdate(tradingPair, 'remove', {
                    side,
                    orderId
                });
            }
            
            this._updateStats('remove', Date.now() - startTime);
            return { success: result[0], orderCount: result[1] };
            
        } catch (error) {
            this.state.stats.errors++;
            console.error('Remove order error:', error);
            throw error;
        }
    }

    /**
     * Get order book snapshot
     */
    async getOrderBook(tradingPair, depth = null) {
        const startTime = Date.now();
        
        try {
            const key = this._getOrderBookKey(tradingPair);
            const metadataKey = this._getMetadataKey(tradingPair);
            
            // Get order book data and metadata
            const [orderBookData, metadata] = await Promise.all([
                this.redis.hgetall(key),
                this.redis.hgetall(metadataKey)
            ]);
            
            if (!orderBookData || Object.keys(orderBookData).length === 0) {
                return null;
            }
            
            // Parse and decompress if needed
            let parsedData = {};
            for (const [side, data] of Object.entries(orderBookData)) {
                if (side === 'data') {
                    // Full order book data
                    parsedData = await this._deserializeOrderBook(data);
                } else {
                    // Individual side data
                    parsedData[side] = JSON.parse(data);
                }
            }
            
            // Apply depth limit if specified
            if (depth) {
                parsedData = this._applyDepthLimit(parsedData, depth);
            }
            
            this._updateStats('get', Date.now() - startTime);
            
            return {
                tradingPair,
                orderBook: parsedData,
                metadata: {
                    sequence: parseInt(metadata.sequence || '0'),
                    lastUpdate: parseInt(metadata.lastUpdate || '0'),
                    timestamp: Date.now()
                }
            };
            
        } catch (error) {
            this.state.stats.errors++;
            console.error('Get order book error:', error);
            throw error;
        }
    }

    /**
     * Get top of book (best bid/ask)
     */
    async getTopOfBook(tradingPair) {
        try {
            const orderBook = await this.getOrderBook(tradingPair, 1);
            if (!orderBook) return null;
            
            const { bids, asks } = orderBook.orderBook;
            
            return {
                tradingPair,
                bestBid: bids && bids.length > 0 ? bids[0] : null,
                bestAsk: asks && asks.length > 0 ? asks[0] : null,
                spread: this._calculateSpread(bids, asks),
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error('Get top of book error:', error);
            throw error;
        }
    }

    /**
     * Get order book statistics
     */
    async getOrderBookStats(tradingPair) {
        try {
            const orderBook = await this.getOrderBook(tradingPair);
            if (!orderBook) return null;
            
            const { bids, asks } = orderBook.orderBook;
            
            return {
                tradingPair,
                bidCount: bids ? bids.length : 0,
                askCount: asks ? asks.length : 0,
                totalVolume: this._calculateTotalVolume(bids, asks),
                spread: this._calculateSpread(bids, asks),
                midPrice: this._calculateMidPrice(bids, asks),
                lastUpdate: orderBook.metadata.lastUpdate,
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error('Get order book stats error:', error);
            throw error;
        }
    }

    /**
     * Batch update multiple order books
     */
    async batchUpdateOrderBooks(updates) {
        const results = [];
        const pipeline = this.redis.pipeline();
        
        try {
            for (const update of updates) {
                const { tradingPair, orderBookData, sequenceNumber } = update;
                
                // Add update to pipeline
                const key = this._getOrderBookKey(tradingPair);
                const metadataKey = this._getMetadataKey(tradingPair);
                
                let serializedData = JSON.stringify(orderBookData);
                if (serializedData.length > this.config.compressionThreshold) {
                    const compressed = await this.gzip(Buffer.from(serializedData));
                    serializedData = compressed.toString('base64');
                }
                
                pipeline.updateOrderBook(
                    key,
                    'data',
                    metadataKey,
                    serializedData,
                    this.config.ttl,
                    Date.now().toString(),
                    sequenceNumber
                );
            }
            
            const pipelineResults = await pipeline.exec();
            
            // Process results
            for (let i = 0; i < updates.length; i++) {
                const result = pipelineResults[i];
                const update = updates[i];
                
                if (result[0] === null) { // No error
                    results.push({
                        tradingPair: update.tradingPair,
                        success: result[1][0],
                        reason: result[1][1]
                    });
                    
                    if (result[1][0]) {
                        this.state.activeOrderBooks.add(update.tradingPair);
                        await this._publishOrderBookUpdate(
                            update.tradingPair,
                            update.orderBookData,
                            update.sequenceNumber
                        );
                    }
                } else {
                    results.push({
                        tradingPair: update.tradingPair,
                        success: false,
                        error: result[0].message
                    });
                }
            }
            
            this.state.stats.updates += results.filter(r => r.success).length;
            return results;
            
        } catch (error) {
            this.state.stats.errors++;
            console.error('Batch update error:', error);
            throw error;
        }
    }

    /**
     * Create order book snapshot for persistence
     */
    async createSnapshot(tradingPair) {
        try {
            const orderBook = await this.getOrderBook(tradingPair);
            if (!orderBook) return null;
            
            const snapshot = {
                tradingPair,
                data: orderBook.orderBook,
                metadata: orderBook.metadata,
                snapshotTime: Date.now(),
                version: '1.0'
            };
            
            // Store snapshot
            const snapshotKey = this._getSnapshotKey(tradingPair);
            await this.redis.setex(
                snapshotKey,
                this.config.ttl * 2, // Longer TTL for snapshots
                JSON.stringify(snapshot)
            );
            
            this.state.stats.snapshots++;
            return snapshot;
            
        } catch (error) {
            console.error('Create snapshot error:', error);
            throw error;
        }
    }

    /**
     * Restore order book from snapshot
     */
    async restoreFromSnapshot(tradingPair) {
        try {
            const snapshotKey = this._getSnapshotKey(tradingPair);
            const snapshotData = await this.redis.get(snapshotKey);
            
            if (!snapshotData) return null;
            
            const snapshot = JSON.parse(snapshotData);
            
            // Restore order book
            await this.updateOrderBook(
                tradingPair,
                snapshot.data,
                snapshot.metadata.sequence
            );
            
            return snapshot;
            
        } catch (error) {
            console.error('Restore snapshot error:', error);
            throw error;
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            ...this.state.stats,
            activeOrderBooks: this.state.activeOrderBooks.size,
            config: {
                ttl: this.config.ttl,
                maxSize: this.config.maxSize,
                compressionThreshold: this.config.compressionThreshold,
                atomicUpdates: this.config.atomicUpdates
            }
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const testKey = `${this._getOrderBookKey('HEALTH_CHECK')}`;
            await this.redis.setex(testKey, 10, 'test');
            await this.redis.del(testKey);
            
            return {
                status: 'healthy',
                activeOrderBooks: this.state.activeOrderBooks.size,
                scriptsLoaded: Object.keys(this.luaScripts).length
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    // ========== PRIVATE METHODS ==========

    /**
     * Start snapshot scheduler
     */
    async _startSnapshotScheduler() {
        if (this.config.snapshotInterval > 0) {
            this.state.snapshotTimer = setInterval(async () => {
                try {
                    for (const tradingPair of this.state.activeOrderBooks) {
                        await this.createSnapshot(tradingPair);
                    }
                } catch (error) {
                    console.error('Snapshot scheduler error:', error);
                }
            }, this.config.snapshotInterval);
        }
    }

    /**
     * Validate order book data
     */
    _validateOrderBookData(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid order book data');
        }
        
        if (data.bids && !Array.isArray(data.bids)) {
            throw new Error('Bids must be an array');
        }
        
        if (data.asks && !Array.isArray(data.asks)) {
            throw new Error('Asks must be an array');
        }
    }

    /**
     * Validate individual order data
     */
    _validateOrderData(side, price, quantity, orderId) {
        this._validateSide(side);
        
        if (!price || isNaN(parseFloat(price))) {
            throw new Error('Invalid price');
        }
        
        if (!quantity || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) {
            throw new Error('Invalid quantity');
        }
        
        if (!orderId || typeof orderId !== 'string') {
            throw new Error('Invalid order ID');
        }
    }

    /**
     * Validate order side
     */
    _validateSide(side) {
        if (side !== 'bid' && side !== 'ask') {
            throw new Error('Side must be "bid" or "ask"');
        }
    }

    /**
     * Format price with correct decimal places
     */
    _formatPrice(price) {
        return parseFloat(price).toFixed(this.config.priceDecimalPlaces);
    }

    /**
     * Format quantity with correct decimal places
     */
    _formatQuantity(quantity) {
        return parseFloat(quantity).toFixed(this.config.quantityDecimalPlaces);
    }

    /**
     * Generate order book cache key
     */
    _getOrderBookKey(tradingPair) {
        return `orderbook:${tradingPair}`;
    }

    /**
     * Generate metadata cache key
     */
    _getMetadataKey(tradingPair) {
        return `orderbook:meta:${tradingPair}`;
    }

    /**
     * Generate snapshot cache key
     */
    _getSnapshotKey(tradingPair) {
        return `orderbook:snapshot:${tradingPair}`;
    }

    /**
     * Deserialize order book data (handle compression)
     */
    async _deserializeOrderBook(data) {
        try {
            // Try to parse as JSON first
            return JSON.parse(data);
        } catch {
            // If parsing fails, assume it's compressed
            try {
                const decompressed = await this.gunzip(Buffer.from(data, 'base64'));
                return JSON.parse(decompressed.toString());
            } catch (error) {
                throw new Error('Failed to deserialize order book data');
            }
        }
    }

    /**
     * Apply depth limit to order book
     */
    _applyDepthLimit(orderBook, depth) {
        const limited = {};
        
        if (orderBook.bids) {
            limited.bids = orderBook.bids.slice(0, depth);
        }
        
        if (orderBook.asks) {
            limited.asks = orderBook.asks.slice(0, depth);
        }
        
        return limited;
    }

    /**
     * Calculate spread between best bid and ask
     */
    _calculateSpread(bids, asks) {
        if (!bids || !asks || bids.length === 0 || asks.length === 0) {
            return null;
        }
        
        const bestBid = parseFloat(bids[0].price);
        const bestAsk = parseFloat(asks[0].price);
        
        return {
            absolute: bestAsk - bestBid,
            percentage: ((bestAsk - bestBid) / bestBid) * 100
        };
    }

    /**
     * Calculate mid price
     */
    _calculateMidPrice(bids, asks) {
        if (!bids || !asks || bids.length === 0 || asks.length === 0) {
            return null;
        }
        
        const bestBid = parseFloat(bids[0].price);
        const bestAsk = parseFloat(asks[0].price);
        
        return (bestBid + bestAsk) / 2;
    }

    /**
     * Calculate total volume
     */
    _calculateTotalVolume(bids, asks) {
        let totalVolume = 0;
        
        if (bids) {
            totalVolume += bids.reduce((sum, order) => 
                sum + (parseFloat(order.price) * parseFloat(order.quantity)), 0
            );
        }
        
        if (asks) {
            totalVolume += asks.reduce((sum, order) => 
                sum + (parseFloat(order.price) * parseFloat(order.quantity)), 0
            );
        }
        
        return totalVolume;
    }

    /**
     * Publish order book update via pub/sub
     */
    async _publishOrderBookUpdate(tradingPair, orderBookData, sequenceNumber) {
        // This will be handled by PubSubManager
        // Placeholder for pub/sub integration
        console.log(`Order book updated: ${tradingPair}, sequence: ${sequenceNumber}`);
    }

    /**
     * Publish individual order update
     */
    async _publishOrderUpdate(tradingPair, action, orderData) {
        // This will be handled by PubSubManager
        // Placeholder for pub/sub integration
        console.log(`Order ${action}: ${tradingPair}`, orderData);
    }

    /**
     * Update performance statistics
     */
    _updateStats(operation, responseTime) {
        this.state.stats.avgUpdateTime = 
            (this.state.stats.avgUpdateTime * this.state.stats.updates + responseTime) / 
            (this.state.stats.updates + 1);
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        if (this.state.snapshotTimer) {
            clearInterval(this.state.snapshotTimer);
        }
        
        console.log('Order Book Cache cleanup completed');
    }
}

module.exports = { OrderBookCache };