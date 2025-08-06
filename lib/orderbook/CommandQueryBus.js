/**
 * @title Command Query Responsibility Segregation (CQRS) Bus
 * @author DEX State Management Team
 * @notice Separates command and query responsibilities for optimal performance and scalability
 * @dev Implements CQRS pattern with event sourcing integration and distributed processing
 */

const { EventStore } = require('./EventStore');

class CommandQueryBus {
    constructor(config) {
        this.config = {
            eventStore: null,
            commandHandlers: new Map(),
            queryHandlers: new Map(),
            commandValidators: new Map(),
            queryOptimizers: new Map(),
            cacheManager: null,
            metricsCollector: null,
            rateLimiter: null,
            circuitBreaker: null,
            ...config
        };

        this.eventStore = this.config.eventStore || new EventStore(config);
        this.cacheManager = new CacheManager(config);
        this.metricsCollector = new MetricsCollector(config);
        this.rateLimiter = new RateLimiter(config);
        this.circuitBreaker = new CircuitBreaker(config);
        
        // Command/Query separation
        this.commandBus = new CommandBus(this);
        this.queryBus = new QueryBus(this);
        
        // Performance monitoring
        this.metrics = {
            commandsProcessed: 0,
            queriesProcessed: 0,
            averageCommandLatency: 0,
            averageQueryLatency: 0,
            cacheHitRate: 0,
            errorRate: 0
        };

        this._initializeHandlers();
        this._startPerformanceMonitoring();
    }

    /**
     * Execute command with validation and event generation
     * @param {Object} command Command to execute
     * @returns {Promise<Object>} Command result
     */
    async executeCommand(command) {
        const startTime = Date.now();
        
        try {
            // Rate limiting
            await this.rateLimiter.checkLimit(command.type, command.userId);
            
            // Circuit breaker check
            if (this.circuitBreaker.isOpen(command.type)) {
                throw new Error(`Circuit breaker open for command type: ${command.type}`);
            }
            
            // Validate command
            await this._validateCommand(command);
            
            // Execute command
            const result = await this.commandBus.execute(command);
            
            // Update metrics
            this._updateCommandMetrics(command.type, Date.now() - startTime, true);
            
            return result;

        } catch (error) {
            this._updateCommandMetrics(command.type, Date.now() - startTime, false);
            this.circuitBreaker.recordFailure(command.type);
            throw error;
        }
    }

    /**
     * Execute query with caching and optimization
     * @param {Object} query Query to execute
     * @returns {Promise<Object>} Query result
     */
    async executeQuery(query) {
        const startTime = Date.now();
        
        try {
            // Check cache first
            const cacheKey = this._generateCacheKey(query);
            const cached = await this.cacheManager.get(cacheKey);
            
            if (cached) {
                this._updateQueryMetrics(query.type, Date.now() - startTime, true, true);
                return cached;
            }
            
            // Rate limiting for expensive queries
            if (this._isExpensiveQuery(query)) {
                await this.rateLimiter.checkLimit(`query:${query.type}`, query.userId);
            }
            
            // Optimize query
            const optimizedQuery = await this._optimizeQuery(query);
            
            // Execute query
            const result = await this.queryBus.execute(optimizedQuery);
            
            // Cache result
            await this.cacheManager.set(cacheKey, result, this._getCacheTTL(query));
            
            // Update metrics
            this._updateQueryMetrics(query.type, Date.now() - startTime, true, false);
            
            return result;

        } catch (error) {
            this._updateQueryMetrics(query.type, Date.now() - startTime, false, false);
            throw error;
        }
    }

    // =============================================================================
    // COMMAND VALIDATION
    // =============================================================================

    /**
     * Validate command structure and business rules
     * @param {Object} command Command to validate
     * @private
     */
    async _validateCommand(command) {
        // Structural validation
        if (!command.type || !command.aggregateId || !command.data) {
            throw new Error('Invalid command structure');
        }
        
        // Get validator for command type
        const validator = this.config.commandValidators.get(command.type);
        if (validator) {
            await validator(command);
        }
        
        // Business rule validation
        await this._validateBusinessRules(command);
    }

    /**
     * Validate business rules for command
     * @param {Object} command Command to validate
     * @private
     */
    async _validateBusinessRules(command) {
        switch (command.type) {
            case 'CreateOrder':
                await this._validateCreateOrder(command);
                break;
            case 'CancelOrder':
                await this._validateCancelOrder(command);
                break;
            case 'MatchOrders':
                await this._validateMatchOrders(command);
                break;
            default:
                // No specific validation needed
                break;
        }
    }

    async _validateCreateOrder(command) {
        const { trader, tokenIn, tokenOut, amountIn, minAmountOut, deadline } = command.data;
        
        if (!trader || !tokenIn || !tokenOut) {
            throw new Error('Missing required order fields');
        }
        
        if (amountIn <= 0 || minAmountOut <= 0) {
            throw new Error('Invalid order amounts');
        }
        
        if (deadline <= Date.now()) {
            throw new Error('Order deadline has passed');
        }
        
        if (tokenIn === tokenOut) {
            throw new Error('Cannot trade same token');
        }
    }

    async _validateCancelOrder(command) {
        const { orderId, userId } = command.data;
        
        // Check if order exists and user has permission
        const orderState = await this._getOrderState(orderId);
        if (!orderState) {
            throw new Error('Order not found');
        }
        
        if (orderState.trader !== userId) {
            throw new Error('Unauthorized to cancel order');
        }
        
        if (['completed', 'cancelled', 'expired'].includes(orderState.status)) {
            throw new Error('Cannot cancel order in current status');
        }
    }

    async _validateMatchOrders(command) {
        const { buyOrderId, sellOrderId } = command.data;
        
        const buyOrder = await this._getOrderState(buyOrderId);
        const sellOrder = await this._getOrderState(sellOrderId);
        
        if (!buyOrder || !sellOrder) {
            throw new Error('One or more orders not found');
        }
        
        if (buyOrder.tokenOut !== sellOrder.tokenIn || buyOrder.tokenIn !== sellOrder.tokenOut) {
            throw new Error('Orders are not compatible');
        }
        
        if (buyOrder.status !== 'revealed' || sellOrder.status !== 'revealed') {
            throw new Error('Orders must be revealed to match');
        }
    }

    // =============================================================================
    // QUERY OPTIMIZATION
    // =============================================================================

    /**
     * Optimize query for better performance
     * @param {Object} query Query to optimize
     * @returns {Object} Optimized query
     * @private
     */
    async _optimizeQuery(query) {
        const optimizer = this.config.queryOptimizers.get(query.type);
        if (optimizer) {
            return await optimizer(query);
        }
        
        // Default optimizations
        return this._applyDefaultOptimizations(query);
    }

    _applyDefaultOptimizations(query) {
        const optimized = { ...query };
        
        // Add pagination if not specified
        if (!optimized.limit && this._isLargeResultQuery(query)) {
            optimized.limit = 100;
            optimized.offset = optimized.offset || 0;
        }
        
        // Add field selection for large objects
        if (!optimized.fields && this._hasLargeObjects(query)) {
            optimized.fields = this._getDefaultFields(query.type);
        }
        
        // Add sorting for consistent results
        if (!optimized.sort && this._needsSorting(query)) {
            optimized.sort = this._getDefaultSort(query.type);
        }
        
        return optimized;
    }

    _isLargeResultQuery(query) {
        const largeResultTypes = ['GetOrderBook', 'GetOrderHistory', 'GetTradeHistory'];
        return largeResultTypes.includes(query.type);
    }

    _hasLargeObjects(query) {
        const largeObjectTypes = ['GetOrderDetails', 'GetOrderBook'];
        return largeObjectTypes.includes(query.type);
    }

    _getDefaultFields(queryType) {
        const fieldMaps = {
            'GetOrderBook': ['id', 'price', 'amount', 'side', 'timestamp'],
            'GetOrderDetails': ['id', 'status', 'trader', 'amounts', 'timestamps'],
            'GetOrderHistory': ['id', 'status', 'amounts', 'createdAt', 'completedAt']
        };
        
        return fieldMaps[queryType] || [];
    }

    _getDefaultSort(queryType) {
        const sortMaps = {
            'GetOrderBook': { field: 'price', direction: 'asc' },
            'GetOrderHistory': { field: 'createdAt', direction: 'desc' },
            'GetTradeHistory': { field: 'timestamp', direction: 'desc' }
        };
        
        return sortMaps[queryType] || { field: 'id', direction: 'asc' };
    }

    // =============================================================================
    // CACHE MANAGEMENT
    // =============================================================================

    _generateCacheKey(query) {
        const keyData = {
            type: query.type,
            aggregateId: query.aggregateId,
            params: query.params || {},
            fields: query.fields || [],
            limit: query.limit,
            offset: query.offset
        };
        
        return `query:${query.type}:${Buffer.from(JSON.stringify(keyData)).toString('base64')}`;
    }

    _getCacheTTL(query) {
        const ttlMap = {
            'GetOrderBook': 5000,      // 5 seconds (high frequency)
            'GetOrderDetails': 30000,  // 30 seconds
            'GetOrderHistory': 300000, // 5 minutes
            'GetTradeHistory': 600000, // 10 minutes
            'GetUserStats': 60000      // 1 minute
        };
        
        return ttlMap[query.type] || 30000; // Default 30 seconds
    }

    _isExpensiveQuery(query) {
        const expensiveTypes = ['GetOrderHistory', 'GetTradeHistory', 'GetAnalytics'];
        return expensiveTypes.includes(query.type) || 
               (query.limit && query.limit > 1000) ||
               (query.timeRange && query.timeRange > 7 * 24 * 60 * 60 * 1000); // 7 days
    }

    // =============================================================================
    // PERFORMANCE MONITORING
    // =============================================================================

    _startPerformanceMonitoring() {
        setInterval(() => {
            this._collectMetrics();
        }, 60000); // Every minute
        
        setInterval(() => {
            this._cleanupMetrics();
        }, 3600000); // Every hour
    }

    _updateCommandMetrics(commandType, latency, success) {
        this.metrics.commandsProcessed++;
        this.metrics.averageCommandLatency = 
            (this.metrics.averageCommandLatency + latency) / 2;
        
        if (!success) {
            this.metrics.errorRate = 
                (this.metrics.errorRate + 1) / this.metrics.commandsProcessed;
        }
        
        this.metricsCollector.recordCommand(commandType, latency, success);
    }

    _updateQueryMetrics(queryType, latency, success, cacheHit) {
        this.metrics.queriesProcessed++;
        this.metrics.averageQueryLatency = 
            (this.metrics.averageQueryLatency + latency) / 2;
        
        if (cacheHit) {
            this.metrics.cacheHitRate = 
                (this.metrics.cacheHitRate + 1) / this.metrics.queriesProcessed;
        }
        
        if (!success) {
            this.metrics.errorRate = 
                (this.metrics.errorRate + 1) / 
                (this.metrics.commandsProcessed + this.metrics.queriesProcessed);
        }
        
        this.metricsCollector.recordQuery(queryType, latency, success, cacheHit);
    }

    // =============================================================================
    // HANDLER INITIALIZATION
    // =============================================================================

    _initializeHandlers() {
        // Initialize command handlers
        this._registerCommandHandlers();
        
        // Initialize query handlers
        this._registerQueryHandlers();
        
        // Initialize validators
        this._registerValidators();
        
        // Initialize optimizers
        this._registerOptimizers();
    }

    _registerCommandHandlers() {
        this.config.commandHandlers.set('CreateOrder', new CreateOrderHandler(this.eventStore));
        this.config.commandHandlers.set('CommitOrder', new CommitOrderHandler(this.eventStore));
        this.config.commandHandlers.set('RevealOrder', new RevealOrderHandler(this.eventStore));
        this.config.commandHandlers.set('CancelOrder', new CancelOrderHandler(this.eventStore));
        this.config.commandHandlers.set('MatchOrders', new MatchOrdersHandler(this.eventStore));
        this.config.commandHandlers.set('CompleteOrder', new CompleteOrderHandler(this.eventStore));
    }

    _registerQueryHandlers() {
        this.config.queryHandlers.set('GetOrderBook', new GetOrderBookHandler(this.eventStore));
        this.config.queryHandlers.set('GetOrderDetails', new GetOrderDetailsHandler(this.eventStore));
        this.config.queryHandlers.set('GetOrderHistory', new GetOrderHistoryHandler(this.eventStore));
        this.config.queryHandlers.set('GetTradeHistory', new GetTradeHistoryHandler(this.eventStore));
        this.config.queryHandlers.set('GetUserStats', new GetUserStatsHandler(this.eventStore));
    }

    _registerValidators() {
        this.config.commandValidators.set('CreateOrder', async (command) => {
            // Additional validation logic
        });
        
        this.config.commandValidators.set('CancelOrder', async (command) => {
            // Additional validation logic
        });
    }

    _registerOptimizers() {
        this.config.queryOptimizers.set('GetOrderBook', async (query) => {
            // Optimize order book queries
            return {
                ...query,
                useSnapshot: true,
                maxDepth: query.maxDepth || 50
            };
        });
        
        this.config.queryOptimizers.set('GetOrderHistory', async (query) => {
            // Optimize order history queries
            return {
                ...query,
                useIndex: true,
                batchSize: Math.min(query.limit || 100, 1000)
            };
        });
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    async _getOrderState(orderId) {
        try {
            const replayResult = await this.eventStore.replayEvents(orderId);
            return replayResult.state.orders[orderId] || null;
        } catch (error) {
            console.error(`Failed to get order state for ${orderId}:`, error);
            return null;
        }
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get CQRS bus statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            ...this.metrics,
            eventStore: this.eventStore.getStatistics(),
            cache: this.cacheManager.getStatistics(),
            rateLimiter: this.rateLimiter.getStatistics(),
            circuitBreaker: this.circuitBreaker.getStatistics()
        };
    }

    /**
     * Register custom command handler
     * @param {string} commandType Command type
     * @param {Function} handler Command handler
     */
    registerCommandHandler(commandType, handler) {
        this.config.commandHandlers.set(commandType, handler);
    }

    /**
     * Register custom query handler
     * @param {string} queryType Query type
     * @param {Function} handler Query handler
     */
    registerQueryHandler(queryType, handler) {
        this.config.queryHandlers.set(queryType, handler);
    }

    /**
     * Get health status
     * @returns {Promise<Object>} Health status
     */
    async getHealthStatus() {
        const eventStoreHealth = await this.eventStore.getHealthStatus();
        const cacheHealth = await this.cacheManager.getHealthStatus();
        
        return {
            status: eventStoreHealth.status === 'healthy' && cacheHealth.status === 'healthy' 
                ? 'healthy' : 'degraded',
            components: {
                eventStore: eventStoreHealth,
                cache: cacheHealth,
                metrics: this.metrics
            },
            timestamp: Date.now()
        };
    }
}

// =============================================================================
// COMMAND BUS
// =============================================================================

class CommandBus {
    constructor(cqrsBus) {
        this.cqrsBus = cqrsBus;
        this.handlers = cqrsBus.config.commandHandlers;
    }

    async execute(command) {
        const handler = this.handlers.get(command.type);
        if (!handler) {
            throw new Error(`No handler registered for command type: ${command.type}`);
        }

        return await handler.handle(command);
    }
}

// =============================================================================
// QUERY BUS
// =============================================================================

class QueryBus {
    constructor(cqrsBus) {
        this.cqrsBus = cqrsBus;
        this.handlers = cqrsBus.config.queryHandlers;
    }

    async execute(query) {
        const handler = this.handlers.get(query.type);
        if (!handler) {
            throw new Error(`No handler registered for query type: ${query.type}`);
        }

        return await handler.handle(query);
    }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

class CacheManager {
    constructor(config) {
        this.cache = new Map();
        this.ttls = new Map();
        this.stats = { hits: 0, misses: 0, sets: 0 };
        
        // Cleanup expired entries
        setInterval(() => this._cleanup(), 60000);
    }

    async get(key) {
        const entry = this.cache.get(key);
        const ttl = this.ttls.get(key);
        
        if (!entry || (ttl && Date.now() > ttl)) {
            this.stats.misses++;
            this.cache.delete(key);
            this.ttls.delete(key);
            return null;
        }
        
        this.stats.hits++;
        return entry;
    }

    async set(key, value, ttl) {
        this.cache.set(key, value);
        if (ttl) {
            this.ttls.set(key, Date.now() + ttl);
        }
        this.stats.sets++;
    }

    getStatistics() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            hitRate: total > 0 ? (this.stats.hits / total) * 100 : 0,
            size: this.cache.size
        };
    }

    async getHealthStatus() {
        return {
            status: 'healthy',
            size: this.cache.size,
            hitRate: this.getStatistics().hitRate
        };
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, ttl] of this.ttls.entries()) {
            if (now > ttl) {
                this.cache.delete(key);
                this.ttls.delete(key);
            }
        }
    }
}

class RateLimiter {
    constructor(config) {
        this.limits = new Map();
        this.windows = new Map();
        this.config = config.rateLimiting || {};
    }

    async checkLimit(key, userId) {
        const limit = this._getLimit(key);
        if (!limit) return;

        const windowKey = `${key}:${userId}`;
        const now = Date.now();
        const window = Math.floor(now / limit.windowMs);
        
        const currentWindow = this.windows.get(`${windowKey}:${window}`) || 0;
        
        if (currentWindow >= limit.max) {
            throw new Error(`Rate limit exceeded for ${key}`);
        }
        
        this.windows.set(`${windowKey}:${window}`, currentWindow + 1);
        
        // Cleanup old windows
        this._cleanupWindows(windowKey, window);
    }

    _getLimit(key) {
        const defaultLimits = {
            'CreateOrder': { max: 100, windowMs: 60000 }, // 100 per minute
            'CancelOrder': { max: 200, windowMs: 60000 }, // 200 per minute
            'query:GetOrderBook': { max: 1000, windowMs: 60000 } // 1000 per minute
        };
        
        return this.config[key] || defaultLimits[key];
    }

    _cleanupWindows(windowKey, currentWindow) {
        const cutoff = currentWindow - 10; // Keep last 10 windows
        for (const key of this.windows.keys()) {
            if (key.startsWith(windowKey) && 
                parseInt(key.split(':').pop()) < cutoff) {
                this.windows.delete(key);
            }
        }
    }

    getStatistics() {
        return {
            activeWindows: this.windows.size,
            limits: Array.from(this.limits.keys())
        };
    }
}

class CircuitBreaker {
    constructor(config) {
        this.config = config.circuitBreaker || {};
        this.states = new Map(); // key -> { failures, lastFailure, state }
    }

    isOpen(key) {
        const state = this.states.get(key);
        if (!state) return false;
        
        const threshold = this.config.failureThreshold || 5;
        const timeout = this.config.timeout || 60000; // 1 minute
        
        if (state.failures >= threshold) {
            if (Date.now() - state.lastFailure > timeout) {
                // Reset to half-open
                state.state = 'half-open';
                state.failures = 0;
                return false;
            }
            return true;
        }
        
        return false;
    }

    recordFailure(key) {
        const state = this.states.get(key) || { failures: 0, lastFailure: 0, state: 'closed' };
        state.failures++;
        state.lastFailure = Date.now();
        this.states.set(key, state);
    }

    recordSuccess(key) {
        const state = this.states.get(key);
        if (state) {
            state.failures = 0;
            state.state = 'closed';
        }
    }

    getStatistics() {
        const openCircuits = Array.from(this.states.entries())
            .filter(([key, state]) => this.isOpen(key))
            .map(([key]) => key);
            
        return {
            totalCircuits: this.states.size,
            openCircuits: openCircuits.length,
            openCircuitsList: openCircuits
        };
    }
}

class MetricsCollector {
    constructor(config) {
        this.metrics = {
            commands: new Map(),
            queries: new Map()
        };
    }

    recordCommand(type, latency, success) {
        const stats = this.metrics.commands.get(type) || 
            { count: 0, totalLatency: 0, errors: 0 };
        
        stats.count++;
        stats.totalLatency += latency;
        if (!success) stats.errors++;
        
        this.metrics.commands.set(type, stats);
    }

    recordQuery(type, latency, success, cacheHit) {
        const stats = this.metrics.queries.get(type) || 
            { count: 0, totalLatency: 0, errors: 0, cacheHits: 0 };
        
        stats.count++;
        stats.totalLatency += latency;
        if (!success) stats.errors++;
        if (cacheHit) stats.cacheHits++;
        
        this.metrics.queries.set(type, stats);
    }
}

module.exports = { CommandQueryBus };