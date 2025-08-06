/**
 * @fileoverview Real-time Data Manager for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Centralized manager for all real-time data streams with memory optimization
 */

const EventEmitter = require('events');
const { MemoryEfficientOrderBook } = require('./MemoryEfficientOrderBook');

/**
 * Real-time Data Manager
 * Coordinates multiple data streams and provides unified interface
 */
class RealtimeDataManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Data streams
            streams: {
                orderBooks: config.streams?.orderBooks !== false,
                trades: config.streams?.trades !== false,
                prices: config.streams?.prices !== false,
                liquidityPools: config.streams?.liquidityPools !== false,
                userOrders: config.streams?.userOrders !== false
            },
            
            // Memory management
            memoryOptimization: {
                enabled: config.memoryOptimization?.enabled !== false,
                compressionThreshold: config.memoryOptimization?.compressionThreshold || 1000,
                maxDataAge: config.memoryOptimization?.maxDataAge || 86400000, // 24 hours
                cleanupInterval: config.memoryOptimization?.cleanupInterval || 300000, // 5 minutes
                memoryLimit: config.memoryOptimization?.memoryLimit || 500 * 1024 * 1024 // 500MB
            },
            
            // Update batching
            batching: {
                enabled: config.batching?.enabled !== false,
                batchSize: config.batching?.batchSize || 100,
                batchInterval: config.batching?.batchInterval || 50, // 50ms
                priorityThreshold: config.batching?.priorityThreshold || 10
            },
            
            // Supported trading pairs
            tradingPairs: config.tradingPairs || [
                'ETH/USDT', 'BTC/USDT', 'USDC/USDT'
            ],
            
            // Performance settings
            performance: {
                updateBufferSize: config.performance?.updateBufferSize || 10000,
                snapshotCacheSize: config.performance?.snapshotCacheSize || 100,
                metricsInterval: config.performance?.metricsInterval || 10000
            },
            
            ...config
        };

        this.state = {
            initialized: false,
            orderBooks: new Map(),
            priceFeeds: new Map(),
            tradeStreams: new Map(),
            liquidityPools: new Map(),
            userSessions: new Map(),
            
            // Update batching
            updateBatches: new Map(),
            batchTimers: new Map(),
            
            // Memory tracking
            memoryUsage: 0,
            lastCleanup: Date.now(),
            
            // Performance metrics
            metrics: {
                totalUpdates: 0,
                batchedUpdates: 0,
                memoryCleanups: 0,
                activeStreams: 0,
                subscriberCount: 0
            }
        };

        this.dataCompressor = null;
        this.snapshotCache = new Map();
        this.updateBuffer = new CircularUpdateBuffer(this.config.performance.updateBufferSize);
    }

    /**
     * Initialize the real-time data manager
     */
    async initialize() {
        try {
            await this._initializeOrderBooks();
            await this._initializePriceFeeds();
            await this._initializeDataCompression();
            await this._startMemoryMonitoring();
            await this._startMetricsCollection();
            
            this.state.initialized = true;
            console.log('Real-time Data Manager initialized');
            
            this.emit('initialized', {
                tradingPairs: this.config.tradingPairs.length,
                streams: Object.keys(this.config.streams).filter(s => this.config.streams[s]).length
            });
            
        } catch (error) {
            console.error('Failed to initialize Real-time Data Manager:', error);
            throw error;
        }
    }

    /**
     * Subscribe to real-time data updates
     */
    subscribe(clientId, subscriptions) {
        try {
            if (!this.state.userSessions.has(clientId)) {
                this.state.userSessions.set(clientId, {
                    id: clientId,
                    subscriptions: new Set(),
                    lastActivity: Date.now(),
                    updateCount: 0,
                    dataTransferred: 0
                });
            }

            const session = this.state.userSessions.get(clientId);
            
            for (const subscription of subscriptions) {
                const { type, symbol, params = {} } = subscription;
                const subscriptionKey = this._createSubscriptionKey(type, symbol, params);
                
                session.subscriptions.add(subscriptionKey);
                
                // Send initial snapshot
                this._sendInitialSnapshot(clientId, subscription);
            }

            session.lastActivity = Date.now();
            this.state.metrics.subscriberCount = this.state.userSessions.size;
            
            return { success: true, subscriptions: subscriptions.length };

        } catch (error) {
            console.error('Subscription failed:', error);
            throw error;
        }
    }

    /**
     * Unsubscribe from data updates
     */
    unsubscribe(clientId, subscriptions = null) {
        const session = this.state.userSessions.get(clientId);
        if (!session) return;

        if (subscriptions) {
            for (const subscription of subscriptions) {
                const { type, symbol, params = {} } = subscription;
                const subscriptionKey = this._createSubscriptionKey(type, symbol, params);
                session.subscriptions.delete(subscriptionKey);
            }
        } else {
            // Unsubscribe from all
            session.subscriptions.clear();
        }

        if (session.subscriptions.size === 0) {
            this.state.userSessions.delete(clientId);
        }

        this.state.metrics.subscriberCount = this.state.userSessions.size;
    }

    /**
     * Update order book with new order
     */
    async updateOrderBook(symbol, update) {
        try {
            const orderBook = this.state.orderBooks.get(symbol);
            if (!orderBook) {
                console.warn(`Order book not found for symbol: ${symbol}`);
                return;
            }

            const { type, data } = update;
            let result;

            switch (type) {
                case 'add':
                    result = orderBook.addOrder(data);
                    break;
                case 'update':
                    result = orderBook.updateOrder(data.id, data);
                    break;
                case 'remove':
                    result = orderBook.removeOrder(data.id);
                    break;
                case 'trade':
                    result = orderBook.executeTrade(data);
                    break;
                default:
                    throw new Error(`Unknown update type: ${type}`);
            }

            // Batch and broadcast update
            await this._batchUpdate('orderbook', symbol, {
                type,
                data: result || data,
                timestamp: Date.now(),
                sequence: orderBook.state.sequence
            });

            this.state.metrics.totalUpdates++;

        } catch (error) {
            console.error('Order book update failed:', error);
            throw error;
        }
    }

    /**
     * Update price feed
     */
    async updatePrice(symbol, priceData) {
        try {
            const { price, volume, change, timestamp = Date.now() } = priceData;
            
            const priceUpdate = {
                symbol,
                price,
                volume,
                change,
                timestamp,
                sequence: Date.now() // Simple sequence for price updates
            };

            // Store price data
            if (!this.state.priceFeeds.has(symbol)) {
                this.state.priceFeeds.set(symbol, new CircularPriceBuffer(1000));
            }
            
            this.state.priceFeeds.get(symbol).add(priceUpdate);

            // Batch and broadcast update
            await this._batchUpdate('price', symbol, priceUpdate);

            this.state.metrics.totalUpdates++;

        } catch (error) {
            console.error('Price update failed:', error);
            throw error;
        }
    }

    /**
     * Get current snapshot for symbol
     */
    getSnapshot(symbol, type = 'orderbook') {
        try {
            const cacheKey = `${type}:${symbol}`;
            
            // Check cache first
            if (this.snapshotCache.has(cacheKey)) {
                const cached = this.snapshotCache.get(cacheKey);
                if (Date.now() - cached.timestamp < 1000) { // 1 second cache
                    return cached.data;
                }
            }

            let snapshot;
            
            switch (type) {
                case 'orderbook':
                    const orderBook = this.state.orderBooks.get(symbol);
                    snapshot = orderBook ? orderBook.getSnapshot() : null;
                    break;
                    
                case 'price':
                    const priceBuffer = this.state.priceFeeds.get(symbol);
                    snapshot = priceBuffer ? priceBuffer.getLatest() : null;
                    break;
                    
                default:
                    throw new Error(`Unknown snapshot type: ${type}`);
            }

            // Cache snapshot
            if (snapshot) {
                this.snapshotCache.set(cacheKey, {
                    data: snapshot,
                    timestamp: Date.now()
                });
                
                // Limit cache size
                if (this.snapshotCache.size > this.config.performance.snapshotCacheSize) {
                    const oldestKey = this.snapshotCache.keys().next().value;
                    this.snapshotCache.delete(oldestKey);
                }
            }

            return snapshot;

        } catch (error) {
            console.error('Failed to get snapshot:', error);
            return null;
        }
    }

    /**
     * Get aggregated market data
     */
    getMarketData() {
        const marketData = {};
        
        for (const symbol of this.config.tradingPairs) {
            const orderBook = this.state.orderBooks.get(symbol);
            const priceBuffer = this.state.priceFeeds.get(symbol);
            
            marketData[symbol] = {
                orderBook: orderBook ? {
                    spread: orderBook.spread,
                    midPrice: orderBook.midPrice,
                    lastPrice: orderBook.lastPrice,
                    volume24h: orderBook.volume24h
                } : null,
                price: priceBuffer ? priceBuffer.getLatest() : null,
                lastUpdate: orderBook ? orderBook.state.lastUpdate : 0
            };
        }
        
        return marketData;
    }

    // ========== PRIVATE METHODS ==========

    async _initializeOrderBooks() {
        for (const symbol of this.config.tradingPairs) {
            const [baseAsset, quoteAsset] = symbol.split('/');
            
            const orderBook = new MemoryEfficientOrderBook({
                symbol,
                baseAsset,
                quoteAsset,
                maxPriceLevels: 500,
                maxTradeHistory: 5000,
                aggregationEnabled: true
            });

            this.state.orderBooks.set(symbol, orderBook);
            
            // Forward order book events
            orderBook.on('bookUpdate', (update) => {
                this.emit('orderBookUpdate', { symbol, ...update });
            });
            
            orderBook.on('trade', (trade) => {
                this.emit('trade', { symbol, ...trade });
            });
        }
    }

    async _initializePriceFeeds() {
        for (const symbol of this.config.tradingPairs) {
            this.state.priceFeeds.set(symbol, new CircularPriceBuffer(1000));
        }
    }

    async _initializeDataCompression() {
        if (this.config.memoryOptimization.enabled) {
            this.dataCompressor = new DataCompressor({
                threshold: this.config.memoryOptimization.compressionThreshold
            });
        }
    }

    async _batchUpdate(type, symbol, data) {
        if (!this.config.batching.enabled) {
            return this._broadcastUpdate(type, symbol, data);
        }

        const batchKey = `${type}:${symbol}`;
        
        if (!this.state.updateBatches.has(batchKey)) {
            this.state.updateBatches.set(batchKey, []);
        }

        const batch = this.state.updateBatches.get(batchKey);
        batch.push(data);

        // Check if immediate broadcast is needed
        if (batch.length >= this.config.batching.priorityThreshold) {
            this._flushBatch(batchKey);
            return;
        }

        // Set timer for batch flush
        if (!this.state.batchTimers.has(batchKey)) {
            const timer = setTimeout(() => {
                this._flushBatch(batchKey);
            }, this.config.batching.batchInterval);
            
            this.state.batchTimers.set(batchKey, timer);
        }
    }

    _flushBatch(batchKey) {
        const batch = this.state.updateBatches.get(batchKey);
        if (!batch || batch.length === 0) return;

        const [type, symbol] = batchKey.split(':');
        
        // Clear timer
        const timer = this.state.batchTimers.get(batchKey);
        if (timer) {
            clearTimeout(timer);
            this.state.batchTimers.delete(batchKey);
        }

        // Broadcast batch
        this._broadcastUpdate(type, symbol, batch.length === 1 ? batch[0] : batch);
        
        // Clear batch
        this.state.updateBatches.set(batchKey, []);
        this.state.metrics.batchedUpdates++;
    }

    _broadcastUpdate(type, symbol, data) {
        const subscriptionKey = this._createSubscriptionKey(type, symbol);
        
        for (const [clientId, session] of this.state.userSessions.entries()) {
            if (session.subscriptions.has(subscriptionKey)) {
                this.emit('dataUpdate', {
                    clientId,
                    type,
                    symbol,
                    data,
                    timestamp: Date.now()
                });
                
                session.updateCount++;
                session.lastActivity = Date.now();
            }
        }
    }

    _sendInitialSnapshot(clientId, subscription) {
        const { type, symbol } = subscription;
        const snapshot = this.getSnapshot(symbol, type);
        
        if (snapshot) {
            this.emit('dataUpdate', {
                clientId,
                type: `${type}_snapshot`,
                symbol,
                data: snapshot,
                timestamp: Date.now()
            });
        }
    }

    _createSubscriptionKey(type, symbol, params = {}) {
        const paramString = Object.keys(params)
            .sort()
            .map(key => `${key}=${params[key]}`)
            .join('&');
        
        return `${type}:${symbol}${paramString ? `:${paramString}` : ''}`;
    }

    async _startMemoryMonitoring() {
        setInterval(() => {
            this._performMemoryCleanup();
        }, this.config.memoryOptimization.cleanupInterval);
    }

    _performMemoryCleanup() {
        const now = Date.now();
        const memoryThreshold = now - this.config.memoryOptimization.maxDataAge;
        
        // Clean up stale user sessions
        for (const [clientId, session] of this.state.userSessions.entries()) {
            if (now - session.lastActivity > 3600000) { // 1 hour inactive
                this.state.userSessions.delete(clientId);
            }
        }

        // Clean up snapshot cache
        for (const [key, cached] of this.snapshotCache.entries()) {
            if (now - cached.timestamp > 60000) { // 1 minute old
                this.snapshotCache.delete(key);
            }
        }

        // Clean up order books
        for (const orderBook of this.state.orderBooks.values()) {
            orderBook._performMemoryCleanup();
        }

        this.state.lastCleanup = now;
        this.state.metrics.memoryCleanups++;
        
        this.emit('memoryCleanup', { timestamp: now });
    }

    async _startMetricsCollection() {
        setInterval(() => {
            const metrics = this.getMetrics();
            this.emit('metrics', metrics);
        }, this.config.performance.metricsInterval);
    }

    /**
     * Get comprehensive metrics
     */
    getMetrics() {
        const process = require('process');
        const memUsage = process.memoryUsage();
        
        return {
            ...this.state.metrics,
            memory: {
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external
            },
            data: {
                tradingPairs: this.config.tradingPairs.length,
                activeOrderBooks: this.state.orderBooks.size,
                activePriceFeeds: this.state.priceFeeds.size,
                cachedSnapshots: this.snapshotCache.size,
                updateBufferSize: this.updateBuffer.size()
            },
            sessions: {
                active: this.state.userSessions.size,
                totalSubscriptions: Array.from(this.state.userSessions.values())
                    .reduce((sum, session) => sum + session.subscriptions.size, 0)
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Clear all timers
        for (const timer of this.state.batchTimers.values()) {
            clearTimeout(timer);
        }

        // Clear all data
        this.state.orderBooks.clear();
        this.state.priceFeeds.clear();
        this.state.userSessions.clear();
        this.snapshotCache.clear();

        console.log('Real-time Data Manager cleaned up');
    }
}

/**
 * Circular buffer for price data
 */
class CircularPriceBuffer {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.buffer = new Array(maxSize);
        this.head = 0;
        this.tail = 0;
        this.count = 0;
    }

    add(priceData) {
        this.buffer[this.tail] = priceData;
        this.tail = (this.tail + 1) % this.maxSize;
        
        if (this.count < this.maxSize) {
            this.count++;
        } else {
            this.head = (this.head + 1) % this.maxSize;
        }
    }

    getLatest() {
        if (this.count === 0) return null;
        const latestIndex = this.tail === 0 ? this.maxSize - 1 : this.tail - 1;
        return this.buffer[latestIndex];
    }

    size() {
        return this.count;
    }
}

/**
 * Circular buffer for updates
 */
class CircularUpdateBuffer {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.buffer = new Array(maxSize);
        this.head = 0;
        this.count = 0;
    }

    add(update) {
        this.buffer[this.head] = {
            ...update,
            timestamp: Date.now()
        };
        this.head = (this.head + 1) % this.maxSize;
        
        if (this.count < this.maxSize) {
            this.count++;
        }
    }

    size() {
        return this.count;
    }
}

/**
 * Data compressor for reducing memory usage
 */
class DataCompressor {
    constructor(config) {
        this.threshold = config.threshold;
    }

    compress(data) {
        // Simple JSON compression - in practice would use more sophisticated algorithms
        return JSON.stringify(data);
    }

    decompress(compressedData) {
        return JSON.parse(compressedData);
    }
}

module.exports = { 
    RealtimeDataManager, 
    CircularPriceBuffer, 
    CircularUpdateBuffer, 
    DataCompressor 
};