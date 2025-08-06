/**
 * @fileoverview Advanced Order Book Manager with Redis Integration
 * @author SwappiQ Protocol
 * @description Manages multiple order books with matching engine and analytics
 */

const EventEmitter = require('events');
const { RedisOrderBook } = require('./RedisOrderBook');

/**
 * Order Book Manager
 * Coordinates multiple order books and matching engine
 */
class OrderBookManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Trading pairs
            tradingPairs: config.tradingPairs || [
                { symbol: 'ETH/USDT', tickSize: 0.01, stepSize: 0.001 },
                { symbol: 'BTC/USDT', tickSize: 0.01, stepSize: 0.00001 },
                { symbol: 'USDC/USDT', tickSize: 0.0001, stepSize: 0.01 }
            ],
            
            // Matching engine configuration
            matching: {
                enabled: config.matching?.enabled !== false,
                algorithm: config.matching?.algorithm || 'price-time', // price-time, pro-rata
                maxMatchesPerCycle: config.matching?.maxMatchesPerCycle || 100,
                matchingInterval: config.matching?.matchingInterval || 10, // ms
                partialFillEnabled: config.matching?.partialFillEnabled !== false,
                minOrderSize: config.matching?.minOrderSize || 0.001
            },
            
            // Fee configuration
            fees: {
                maker: config.fees?.maker || 0.001, // 0.1%
                taker: config.fees?.taker || 0.002, // 0.2%
                discounts: config.fees?.discounts || {},
                feeToken: config.fees?.feeToken || 'USDT'
            },
            
            // Market data configuration
            marketData: {
                enabled: config.marketData?.enabled !== false,
                updateInterval: config.marketData?.updateInterval || 1000, // 1 second
                depthLevels: config.marketData?.depthLevels || 20,
                tickerInterval: config.marketData?.tickerInterval || 5000, // 5 seconds
                ohlcPeriods: config.marketData?.ohlcPeriods || ['1m', '5m', '15m', '1h', '4h', '1d']
            },
            
            // Order validation
            validation: {
                minOrderValue: config.validation?.minOrderValue || 10, // 10 USDT
                maxOrderValue: config.validation?.maxOrderValue || 1000000, // 1M USDT
                maxOpenOrders: config.validation?.maxOpenOrders || 100,
                requireKYC: config.validation?.requireKYC || false,
                ipWhitelist: config.validation?.ipWhitelist || [],
                bannedCountries: config.validation?.bannedCountries || []
            },
            
            // Performance settings
            performance: {
                orderCaching: config.performance?.orderCaching !== false,
                cacheSize: config.performance?.cacheSize || 10000,
                parallelMatching: config.performance?.parallelMatching || false,
                workerThreads: config.performance?.workerThreads || 4
            },
            
            // Redis configuration (passed to order books)
            redis: config.redis || {},
            
            auditLogging: config.auditLogging !== false,
            ...config
        };

        this.state = {
            orderBooks: new Map(), // symbol -> RedisOrderBook
            matchingEngines: new Map(), // symbol -> MatchingEngine
            marketDataFeeds: new Map(), // symbol -> MarketDataFeed
            
            // Global metrics
            metrics: {
                totalOrders: 0,
                totalTrades: 0,
                totalVolume: 0,
                activeOrders: 0,
                uniqueTraders: new Set(),
                feeCollected: 0
            },
            
            // Order cache
            orderCache: new Map(),
            
            // Status
            initialized: false,
            matching: false
        };

        this.matchingTimer = null;
        this.marketDataTimer = null;
        
        this.initialize();
    }

    /**
     * Initialize order book manager
     */
    async initialize() {
        try {
            await this._initializeOrderBooks();
            await this._initializeMatchingEngines();
            await this._initializeMarketData();
            await this._startServices();
            
            this.state.initialized = true;
            console.log('Order Book Manager initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Order Book Manager:', error);
            throw error;
        }
    }

    /**
     * Submit order to order book
     */
    async submitOrder(order) {
        try {
            // Validate order
            await this._validateOrder(order);
            
            // Get order book
            const orderBook = this.state.orderBooks.get(order.symbol);
            if (!orderBook) {
                throw new Error(`Order book not found for symbol: ${order.symbol}`);
            }
            
            // Calculate order value
            const orderValue = order.price * order.quantity;
            
            // Check order limits
            if (orderValue < this.config.validation.minOrderValue) {
                throw new Error(`Order value below minimum: ${this.config.validation.minOrderValue}`);
            }
            
            if (orderValue > this.config.validation.maxOrderValue) {
                throw new Error(`Order value exceeds maximum: ${this.config.validation.maxOrderValue}`);
            }
            
            // Add order to book
            const result = await orderBook.addOrder(order);
            
            // Update global metrics
            this.state.metrics.totalOrders++;
            this.state.metrics.activeOrders++;
            this.state.metrics.uniqueTraders.add(order.userId);
            
            // Cache order if enabled
            if (this.config.performance.orderCaching) {
                this._cacheOrder(result.orderId, order);
            }
            
            await this._auditLog('ORDER_SUBMITTED', {
                orderId: result.orderId,
                symbol: order.symbol,
                side: order.side,
                type: order.type,
                price: order.price,
                quantity: order.quantity,
                userId: order.userId
            });
            
            this.emit('orderSubmitted', {
                orderId: result.orderId,
                symbol: order.symbol,
                timestamp: result.timestamp
            });
            
            return result;
            
        } catch (error) {
            console.error('Failed to submit order:', error);
            throw error;
        }
    }

    /**
     * Cancel order
     */
    async cancelOrder(orderId, userId, symbol) {
        try {
            // Get order book
            const orderBook = this.state.orderBooks.get(symbol);
            if (!orderBook) {
                throw new Error(`Order book not found for symbol: ${symbol}`);
            }
            
            // Cancel order
            const result = await orderBook.cancelOrder(orderId, userId);
            
            // Update metrics
            this.state.metrics.activeOrders--;
            
            // Remove from cache
            if (this.config.performance.orderCaching) {
                this.state.orderCache.delete(orderId);
            }
            
            await this._auditLog('ORDER_CANCELLED', {
                orderId,
                userId,
                symbol
            });
            
            this.emit('orderCancelled', {
                orderId,
                symbol,
                timestamp: result.timestamp
            });
            
            return result;
            
        } catch (error) {
            console.error('Failed to cancel order:', error);
            throw error;
        }
    }

    /**
     * Get order book snapshot
     */
    async getOrderBook(symbol, depth = 20) {
        try {
            const orderBook = this.state.orderBooks.get(symbol);
            if (!orderBook) {
                throw new Error(`Order book not found for symbol: ${symbol}`);
            }
            
            return await orderBook.getSnapshot(depth);
            
        } catch (error) {
            console.error('Failed to get order book:', error);
            throw error;
        }
    }

    /**
     * Get user orders across all symbols
     */
    async getUserOrders(userId, options = {}) {
        try {
            const allOrders = [];
            
            for (const [symbol, orderBook] of this.state.orderBooks) {
                if (!options.symbol || options.symbol === symbol) {
                    const orders = await orderBook.getUserOrders(userId, options);
                    allOrders.push(...orders);
                }
            }
            
            // Sort by timestamp
            allOrders.sort((a, b) => b.timestamp - a.timestamp);
            
            // Apply global pagination
            if (options.limit) {
                const offset = options.offset || 0;
                return allOrders.slice(offset, offset + options.limit);
            }
            
            return allOrders;
            
        } catch (error) {
            console.error('Failed to get user orders:', error);
            throw error;
        }
    }

    /**
     * Get market ticker data
     */
    async getTicker(symbol) {
        try {
            const orderBook = this.state.orderBooks.get(symbol);
            if (!orderBook) {
                throw new Error(`Order book not found for symbol: ${symbol}`);
            }
            
            const snapshot = await orderBook.getSnapshot(1);
            const analytics = await orderBook.getAnalytics();
            
            const ticker = {
                symbol,
                timestamp: Date.now(),
                bid: snapshot.bids[0]?.price || null,
                bidQuantity: snapshot.bids[0]?.quantity || null,
                ask: snapshot.asks[0]?.price || null,
                askQuantity: snapshot.asks[0]?.quantity || null,
                spread: snapshot.spread,
                midPrice: snapshot.midPrice,
                lastPrice: null, // Would come from trade history
                volume24h: analytics.metrics.volume24h,
                high24h: null, // Would need to track
                low24h: null, // Would need to track
                change24h: null, // Would need to track
                changePercent24h: null // Would need to track
            };
            
            return ticker;
            
        } catch (error) {
            console.error('Failed to get ticker:', error);
            throw error;
        }
    }

    /**
     * Get all tickers
     */
    async getAllTickers() {
        try {
            const tickers = [];
            
            for (const symbol of this.state.orderBooks.keys()) {
                const ticker = await this.getTicker(symbol);
                tickers.push(ticker);
            }
            
            return tickers;
            
        } catch (error) {
            console.error('Failed to get all tickers:', error);
            throw error;
        }
    }

    /**
     * Execute trade between orders
     */
    async executeTrade(symbol, buyOrderId, sellOrderId, quantity, price) {
        try {
            const orderBook = this.state.orderBooks.get(symbol);
            if (!orderBook) {
                throw new Error(`Order book not found for symbol: ${symbol}`);
            }
            
            // Execute trade in order book
            const trade = await orderBook.executeTrade(buyOrderId, sellOrderId, quantity, price);
            
            // Calculate fees
            const fees = await this._calculateFees(trade);
            trade.fees = fees;
            
            // Update metrics
            this.state.metrics.totalTrades++;
            this.state.metrics.totalVolume += trade.quantity * trade.price;
            this.state.metrics.feeCollected += fees.total;
            
            await this._auditLog('TRADE_EXECUTED', {
                tradeId: trade.id,
                symbol,
                buyOrderId,
                sellOrderId,
                price,
                quantity,
                fees: fees.total
            });
            
            this.emit('tradeExecuted', {
                symbol,
                trade
            });
            
            return trade;
            
        } catch (error) {
            console.error('Failed to execute trade:', error);
            throw error;
        }
    }

    // ========== PRIVATE METHODS ==========

    async _initializeOrderBooks() {
        for (const pair of this.config.tradingPairs) {
            const orderBook = new RedisOrderBook({
                redis: this.config.redis,
                orderbook: {
                    symbol: pair.symbol,
                    tickSize: pair.tickSize,
                    stepSize: pair.stepSize
                },
                auditLogging: this.config.auditLogging
            });
            
            // Forward events
            orderBook.on('orderAdded', (data) => {
                this.emit('orderAdded', { symbol: pair.symbol, ...data });
            });
            
            orderBook.on('orderCancelled', (data) => {
                this.emit('orderCancelled', { symbol: pair.symbol, ...data });
            });
            
            orderBook.on('tradeExecuted', (data) => {
                this.emit('tradeExecuted', { symbol: pair.symbol, ...data });
            });
            
            this.state.orderBooks.set(pair.symbol, orderBook);
        }
    }

    async _initializeMatchingEngines() {
        if (!this.config.matching.enabled) return;
        
        for (const pair of this.config.tradingPairs) {
            const engine = new MatchingEngine({
                symbol: pair.symbol,
                algorithm: this.config.matching.algorithm,
                maxMatchesPerCycle: this.config.matching.maxMatchesPerCycle,
                partialFillEnabled: this.config.matching.partialFillEnabled,
                minOrderSize: this.config.matching.minOrderSize
            });
            
            this.state.matchingEngines.set(pair.symbol, engine);
        }
    }

    async _initializeMarketData() {
        if (!this.config.marketData.enabled) return;
        
        for (const pair of this.config.tradingPairs) {
            const feed = new MarketDataFeed({
                symbol: pair.symbol,
                depthLevels: this.config.marketData.depthLevels,
                ohlcPeriods: this.config.marketData.ohlcPeriods
            });
            
            this.state.marketDataFeeds.set(pair.symbol, feed);
        }
    }

    async _startServices() {
        // Start matching engine
        if (this.config.matching.enabled) {
            this.matchingTimer = setInterval(async () => {
                await this._runMatchingCycle();
            }, this.config.matching.matchingInterval);
        }
        
        // Start market data updates
        if (this.config.marketData.enabled) {
            this.marketDataTimer = setInterval(async () => {
                await this._updateMarketData();
            }, this.config.marketData.updateInterval);
        }
    }

    async _runMatchingCycle() {
        if (this.state.matching) return; // Prevent concurrent matching
        
        this.state.matching = true;
        
        try {
            for (const [symbol, engine] of this.state.matchingEngines) {
                const orderBook = this.state.orderBooks.get(symbol);
                const snapshot = await orderBook.getSnapshot(100);
                
                // Find matches
                const matches = engine.findMatches(snapshot.bids, snapshot.asks);
                
                // Execute matches
                for (const match of matches) {
                    await this.executeTrade(
                        symbol,
                        match.buyOrderId,
                        match.sellOrderId,
                        match.quantity,
                        match.price
                    );
                }
            }
        } catch (error) {
            console.error('Matching cycle error:', error);
        } finally {
            this.state.matching = false;
        }
    }

    async _updateMarketData() {
        try {
            for (const [symbol, feed] of this.state.marketDataFeeds) {
                const orderBook = this.state.orderBooks.get(symbol);
                const snapshot = await orderBook.getSnapshot(this.config.marketData.depthLevels);
                
                feed.updateOrderBook(snapshot);
                
                // Emit market data update
                this.emit('marketDataUpdate', {
                    symbol,
                    type: 'orderbook',
                    data: snapshot
                });
            }
        } catch (error) {
            console.error('Market data update error:', error);
        }
    }

    async _validateOrder(order) {
        // Basic validation
        if (!order.symbol) throw new Error('Symbol required');
        if (!order.side) throw new Error('Side required');
        if (!order.type) throw new Error('Type required');
        if (!order.quantity) throw new Error('Quantity required');
        if (!order.userId) throw new Error('User ID required');
        
        // Type-specific validation
        if (order.type === 'limit' && !order.price) {
            throw new Error('Price required for limit orders');
        }
        
        // Check if symbol exists
        if (!this.state.orderBooks.has(order.symbol)) {
            throw new Error(`Invalid symbol: ${order.symbol}`);
        }
        
        // KYC check if required
        if (this.config.validation.requireKYC) {
            // Would check KYC status
        }
        
        // Check user's open orders
        const userOrders = await this.getUserOrders(order.userId, {
            status: 'active'
        });
        
        if (userOrders.length >= this.config.validation.maxOpenOrders) {
            throw new Error(`Maximum open orders (${this.config.validation.maxOpenOrders}) exceeded`);
        }
    }

    _cacheOrder(orderId, order) {
        this.state.orderCache.set(orderId, {
            order,
            cachedAt: Date.now()
        });
        
        // Limit cache size
        if (this.state.orderCache.size > this.config.performance.cacheSize) {
            const firstKey = this.state.orderCache.keys().next().value;
            this.state.orderCache.delete(firstKey);
        }
    }

    async _calculateFees(trade) {
        const buyerFee = trade.quantity * trade.price * this.config.fees.taker;
        const sellerFee = trade.quantity * trade.price * this.config.fees.maker;
        
        // Apply discounts if any
        const buyerDiscount = this._getDiscount(trade.buyerId);
        const sellerDiscount = this._getDiscount(trade.sellerId);
        
        return {
            buyer: buyerFee * (1 - buyerDiscount),
            seller: sellerFee * (1 - sellerDiscount),
            total: (buyerFee * (1 - buyerDiscount)) + (sellerFee * (1 - sellerDiscount)),
            currency: this.config.fees.feeToken
        };
    }

    _getDiscount(userId) {
        // Would implement tiered discount logic
        return this.config.fees.discounts[userId] || 0;
    }

    async _auditLog(action, details) {
        if (!this.config.auditLogging) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            action,
            details,
            source: 'OrderBookManager'
        };

        this.emit('auditLog', logEntry);
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            uniqueTraders: this.state.metrics.uniqueTraders.size,
            orderBooks: this.state.orderBooks.size,
            cacheSize: this.state.orderCache.size,
            initialized: this.state.initialized,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Stop timers
        if (this.matchingTimer) clearInterval(this.matchingTimer);
        if (this.marketDataTimer) clearInterval(this.marketDataTimer);
        
        // Cleanup order books
        for (const orderBook of this.state.orderBooks.values()) {
            await orderBook.cleanup();
        }
        
        // Clear state
        this.state.orderBooks.clear();
        this.state.matchingEngines.clear();
        this.state.marketDataFeeds.clear();
        this.state.orderCache.clear();
        
        console.log('Order Book Manager cleaned up');
    }
}

/**
 * Simple Matching Engine
 */
class MatchingEngine {
    constructor(config) {
        this.config = config;
    }
    
    findMatches(bids, asks) {
        const matches = [];
        
        if (!bids.length || !asks.length) return matches;
        
        for (const bid of bids) {
            for (const ask of asks) {
                if (bid.price >= ask.price) {
                    const matchQuantity = Math.min(bid.quantity, ask.quantity);
                    
                    if (matchQuantity >= this.config.minOrderSize) {
                        matches.push({
                            buyOrderId: bid.orders[0].id,
                            sellOrderId: ask.orders[0].id,
                            price: ask.price,
                            quantity: matchQuantity
                        });
                        
                        // Update quantities
                        bid.quantity -= matchQuantity;
                        ask.quantity -= matchQuantity;
                        
                        if (matches.length >= this.config.maxMatchesPerCycle) {
                            return matches;
                        }
                    }
                }
            }
        }
        
        return matches;
    }
}

/**
 * Simple Market Data Feed
 */
class MarketDataFeed {
    constructor(config) {
        this.config = config;
        this.orderBook = null;
        this.trades = [];
        this.ohlc = new Map();
    }
    
    updateOrderBook(snapshot) {
        this.orderBook = snapshot;
    }
    
    addTrade(trade) {
        this.trades.push(trade);
        // Update OHLC data
    }
}

module.exports = { OrderBookManager };