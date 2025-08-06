/**
 * @title Materialized View Manager
 * @author DEX State Management Team
 * @notice Manages materialized views for high-performance order book snapshots and queries
 * @dev Provides real-time updated views with consistent read performance and automatic rebuilding
 */

const { EventStore } = require('./EventStore');

class MaterializedViewManager {
    constructor(config) {
        this.config = {
            eventStore: null,
            refreshInterval: config.refreshInterval || 1000, // 1 second
            snapshotInterval: config.snapshotInterval || 60000, // 1 minute
            maxViewAge: config.maxViewAge || 300000, // 5 minutes
            compressionEnabled: config.compressionEnabled || true,
            persistenceEnabled: config.persistenceEnabled || true,
            distributedCache: config.distributedCache || false,
            ...config
        };

        this.eventStore = this.config.eventStore || new EventStore(config);
        this.views = new Map(); // View name -> View instance
        this.viewMetadata = new Map(); // View name -> metadata
        this.subscriptions = new Map(); // View name -> subscription ID
        this.refreshTimers = new Map(); // View name -> timer ID
        
        // Performance tracking
        this.metrics = {
            viewsCreated: 0,
            viewsRefreshed: 0,
            queriesServed: 0,
            cacheHits: 0,
            rebuildCount: 0,
            averageRefreshTime: 0
        };

        // Distributed cache for cluster deployments
        this.distributedCache = this.config.distributedCache ? 
            new DistributedCache(config) : null;

        this._initializeBuiltInViews();
        this._startMaintenanceScheduler();
    }

    /**
     * Create a new materialized view
     * @param {Object} viewConfig View configuration
     * @returns {Promise<string>} View ID
     */
    async createView(viewConfig) {
        try {
            const {
                name,
                query,
                refreshStrategy = 'incremental',
                indexFields = [],
                compressionEnabled = this.config.compressionEnabled,
                ttl = this.config.maxViewAge
            } = viewConfig;

            if (this.views.has(name)) {
                throw new Error(`View '${name}' already exists`);
            }

            // Create view instance
            const view = new MaterializedView({
                name,
                query,
                refreshStrategy,
                indexFields,
                compressionEnabled,
                ttl,
                eventStore: this.eventStore
            });

            // Initialize view data
            await view.initialize();

            // Store view
            this.views.set(name, view);
            this.viewMetadata.set(name, {
                createdAt: Date.now(),
                lastRefresh: Date.now(),
                queryCount: 0,
                refreshCount: 0,
                config: viewConfig
            });

            // Subscribe to relevant events for real-time updates
            if (refreshStrategy === 'realtime' || refreshStrategy === 'incremental') {
                await this._subscribeToEvents(name, view);
            }

            // Schedule periodic refresh if needed
            if (refreshStrategy === 'periodic') {
                this._schedulePeriodicRefresh(name, view);
            }

            this.metrics.viewsCreated++;
            console.log(`Materialized view '${name}' created successfully`);

            return name;

        } catch (error) {
            console.error('Failed to create materialized view:', error);
            throw error;
        }
    }

    /**
     * Query a materialized view with caching and optimization
     * @param {string} viewName View name
     * @param {Object} query Query parameters
     * @returns {Promise<Object>} Query result
     */
    async queryView(viewName, query = {}) {
        try {
            const view = this.views.get(viewName);
            if (!view) {
                throw new Error(`View '${viewName}' not found`);
            }

            const metadata = this.viewMetadata.get(viewName);
            
            // Check if view needs refresh
            if (this._needsRefresh(view, metadata)) {
                await this._refreshView(viewName);
            }

            // Execute query on view
            const startTime = Date.now();
            const result = await view.query(query);
            const queryTime = Date.now() - startTime;

            // Update metrics
            metadata.queryCount++;
            this.metrics.queriesServed++;
            
            if (view.isFromCache(result)) {
                this.metrics.cacheHits++;
            }

            console.log(`Query on view '${viewName}' completed in ${queryTime}ms`);

            return {
                data: result,
                metadata: {
                    viewName,
                    lastRefresh: metadata.lastRefresh,
                    queryTime,
                    fromCache: view.isFromCache(result),
                    resultCount: Array.isArray(result.data) ? result.data.length : 1
                }
            };

        } catch (error) {
            console.error(`Failed to query view '${viewName}':`, error);
            throw error;
        }
    }

    /**
     * Refresh a materialized view
     * @param {string} viewName View name
     * @param {boolean} force Force refresh even if not needed
     * @returns {Promise<void>}
     */
    async refreshView(viewName, force = false) {
        try {
            const view = this.views.get(viewName);
            const metadata = this.viewMetadata.get(viewName);
            
            if (!view || !metadata) {
                throw new Error(`View '${viewName}' not found`);
            }

            if (!force && !this._needsRefresh(view, metadata)) {
                return; // No refresh needed
            }

            await this._refreshView(viewName);

        } catch (error) {
            console.error(`Failed to refresh view '${viewName}':`, error);
            throw error;
        }
    }

    /**
     * Get view statistics and metadata
     * @param {string} viewName View name
     * @returns {Object} View statistics
     */
    getViewStatistics(viewName) {
        const view = this.views.get(viewName);
        const metadata = this.viewMetadata.get(viewName);
        
        if (!view || !metadata) {
            throw new Error(`View '${viewName}' not found`);
        }

        return {
            name: viewName,
            ...metadata,
            size: view.getSize(),
            indices: view.getIndices(),
            performance: view.getPerformanceMetrics(),
            health: view.getHealthStatus()
        };
    }

    /**
     * List all materialized views
     * @returns {Array} Array of view names and basic info
     */
    listViews() {
        return Array.from(this.views.keys()).map(name => ({
            name,
            metadata: this.viewMetadata.get(name),
            health: this.views.get(name).getHealthStatus()
        }));
    }

    /**
     * Drop a materialized view
     * @param {string} viewName View name
     * @returns {Promise<void>}
     */
    async dropView(viewName) {
        try {
            const view = this.views.get(viewName);
            if (!view) {
                throw new Error(`View '${viewName}' not found`);
            }

            // Clean up subscriptions
            const subscriptionId = this.subscriptions.get(viewName);
            if (subscriptionId) {
                await this.eventStore.unsubscribe(subscriptionId);
                this.subscriptions.delete(viewName);
            }

            // Clear refresh timer
            const timerId = this.refreshTimers.get(viewName);
            if (timerId) {
                clearInterval(timerId);
                this.refreshTimers.delete(viewName);
            }

            // Cleanup view
            await view.cleanup();

            // Remove from maps
            this.views.delete(viewName);
            this.viewMetadata.delete(viewName);

            console.log(`Materialized view '${viewName}' dropped successfully`);

        } catch (error) {
            console.error(`Failed to drop view '${viewName}':`, error);
            throw error;
        }
    }

    // =============================================================================
    // BUILT-IN VIEWS
    // =============================================================================

    /**
     * Initialize commonly used built-in views
     * @private
     */
    async _initializeBuiltInViews() {
        try {
            // Order Book View - Real-time order book snapshots
            await this.createView({
                name: 'OrderBookView',
                query: {
                    type: 'GetOrderBook',
                    aggregatePattern: 'order:*',
                    projection: {
                        id: true,
                        trader: true,
                        tokenIn: true,
                        tokenOut: true,
                        amountIn: true,
                        minAmountOut: true,
                        status: true,
                        priority: true,
                        createdAt: true
                    },
                    filter: {
                        status: { $in: ['revealed', 'queued'] }
                    },
                    sort: { priority: -1, createdAt: 1 }
                },
                refreshStrategy: 'realtime',
                indexFields: ['tokenIn', 'tokenOut', 'trader', 'priority'],
                ttl: 30000 // 30 seconds
            });

            // Trade History View - Recent trades
            await this.createView({
                name: 'TradeHistoryView',
                query: {
                    type: 'GetTradeHistory',
                    aggregatePattern: 'order:*',
                    projection: {
                        id: true,
                        trader: true,
                        tokenIn: true,
                        tokenOut: true,
                        amountIn: true,
                        executedAmount: true,
                        completedAt: true,
                        matchedWith: true
                    },
                    filter: {
                        status: 'completed',
                        completedAt: { $gte: Date.now() - 24 * 60 * 60 * 1000 } // Last 24 hours
                    },
                    sort: { completedAt: -1 }
                },
                refreshStrategy: 'incremental',
                indexFields: ['trader', 'tokenIn', 'tokenOut', 'completedAt']
            });

            // User Portfolio View - User-specific order and trade data
            await this.createView({
                name: 'UserPortfolioView',
                query: {
                    type: 'GetUserPortfolio',
                    aggregatePattern: 'order:*',
                    projection: {
                        id: true,
                        trader: true,
                        tokenIn: true,
                        tokenOut: true,
                        amountIn: true,
                        minAmountOut: true,
                        executedAmount: true,
                        status: true,
                        createdAt: true,
                        completedAt: true
                    },
                    groupBy: 'trader'
                },
                refreshStrategy: 'periodic',
                indexFields: ['trader', 'status', 'createdAt'],
                ttl: 60000 // 1 minute
            });

            // Market Statistics View - Aggregated market data
            await this.createView({
                name: 'MarketStatsView',
                query: {
                    type: 'GetMarketStats',
                    aggregatePattern: 'order:*',
                    aggregation: [
                        {
                            $group: {
                                _id: { tokenIn: '$tokenIn', tokenOut: '$tokenOut' },
                                totalVolume: { $sum: '$executedAmount' },
                                tradeCount: { $sum: 1 },
                                avgTradeSize: { $avg: '$executedAmount' },
                                lastTradeTime: { $max: '$completedAt' }
                            }
                        }
                    ]
                },
                refreshStrategy: 'periodic',
                indexFields: ['tokenIn', 'tokenOut']
            });

            console.log('Built-in materialized views initialized');

        } catch (error) {
            console.error('Failed to initialize built-in views:', error);
        }
    }

    // =============================================================================
    // REFRESH MANAGEMENT
    // =============================================================================

    /**
     * Check if view needs refresh based on strategy and age
     * @param {MaterializedView} view View instance
     * @param {Object} metadata View metadata
     * @returns {boolean} True if refresh is needed
     * @private
     */
    _needsRefresh(view, metadata) {
        const age = Date.now() - metadata.lastRefresh;
        
        // Check TTL
        if (view.config.ttl && age > view.config.ttl) {
            return true;
        }
        
        // Check maximum age
        if (age > this.config.maxViewAge) {
            return true;
        }
        
        // Check if view is stale
        if (view.isStale()) {
            return true;
        }
        
        return false;
    }

    /**
     * Refresh a view using its configured strategy
     * @param {string} viewName View name
     * @private
     */
    async _refreshView(viewName) {
        const startTime = Date.now();
        const view = this.views.get(viewName);
        const metadata = this.viewMetadata.get(viewName);
        
        try {
            switch (view.config.refreshStrategy) {
                case 'realtime':
                    // Real-time views are updated via event subscriptions
                    break;
                    
                case 'incremental':
                    await this._performIncrementalRefresh(view, metadata);
                    break;
                    
                case 'periodic':
                case 'full':
                    await this._performFullRefresh(view, metadata);
                    break;
                    
                default:
                    throw new Error(`Unknown refresh strategy: ${view.config.refreshStrategy}`);
            }
            
            const refreshTime = Date.now() - startTime;
            
            // Update metadata
            metadata.lastRefresh = Date.now();
            metadata.refreshCount++;
            
            // Update metrics
            this.metrics.viewsRefreshed++;
            this.metrics.averageRefreshTime = 
                (this.metrics.averageRefreshTime + refreshTime) / 2;
            
            console.log(`View '${viewName}' refreshed in ${refreshTime}ms`);
            
        } catch (error) {
            console.error(`Failed to refresh view '${viewName}':`, error);
            throw error;
        }
    }

    /**
     * Perform incremental refresh by applying new events
     * @param {MaterializedView} view View instance
     * @param {Object} metadata View metadata
     * @private
     */
    async _performIncrementalRefresh(view, metadata) {
        const lastEventSequence = view.getLastEventSequence();
        
        // Get new events since last refresh
        const newEvents = await this.eventStore.getEvents('*', {
            fromSequence: lastEventSequence + 1,
            limit: 10000 // Process in batches
        });
        
        if (newEvents.length === 0) {
            return; // No new events
        }
        
        // Apply events to view
        for (const event of newEvents) {
            await view.applyEvent(event);
        }
        
        // Update last processed sequence
        view.setLastEventSequence(newEvents[newEvents.length - 1].metadata.sequence);
        
        console.log(`Applied ${newEvents.length} events to view '${view.config.name}'`);
    }

    /**
     * Perform full refresh by rebuilding from scratch
     * @param {MaterializedView} view View instance
     * @param {Object} metadata View metadata
     * @private
     */
    async _performFullRefresh(view, metadata) {
        console.log(`Performing full refresh for view '${view.config.name}'`);
        
        // Clear existing data
        await view.clear();
        
        // Rebuild from events
        await view.rebuild();
        
        this.metrics.rebuildCount++;
        
        console.log(`Full refresh completed for view '${view.config.name}'`);
    }

    /**
     * Subscribe to events for real-time view updates
     * @param {string} viewName View name
     * @param {MaterializedView} view View instance
     * @private
     */
    async _subscribeToEvents(viewName, view) {
        const subscription = {
            aggregateId: view.config.query.aggregatePattern,
            eventTypes: this._getRelevantEventTypes(view.config.query),
            callback: async (event) => {
                try {
                    await view.applyEvent(event);
                    console.log(`Real-time update applied to view '${viewName}'`);
                } catch (error) {
                    console.error(`Failed to apply real-time update to view '${viewName}':`, error);
                }
            }
        };
        
        const subscriptionId = await this.eventStore.subscribe(subscription);
        this.subscriptions.set(viewName, subscriptionId);
        
        console.log(`Subscribed view '${viewName}' to real-time events`);
    }

    /**
     * Schedule periodic refresh for a view
     * @param {string} viewName View name
     * @param {MaterializedView} view View instance
     * @private
     */
    _schedulePeriodicRefresh(viewName, view) {
        const interval = view.config.refreshInterval || this.config.refreshInterval;
        
        const timerId = setInterval(async () => {
            try {
                await this._refreshView(viewName);
            } catch (error) {
                console.error(`Periodic refresh failed for view '${viewName}':`, error);
            }
        }, interval);
        
        this.refreshTimers.set(viewName, timerId);
        
        console.log(`Scheduled periodic refresh for view '${viewName}' every ${interval}ms`);
    }

    /**
     * Get relevant event types for a query
     * @param {Object} query Query configuration
     * @returns {Array} Array of event types
     * @private
     */
    _getRelevantEventTypes(query) {
        const allEventTypes = [
            'OrderCreated', 'OrderCommitted', 'OrderRevealed',
            'OrderMatched', 'OrderCompleted', 'OrderCancelled', 'OrderExpired'
        ];
        
        // For now, return all types - could be optimized based on query
        return allEventTypes;
    }

    // =============================================================================
    // MAINTENANCE AND MONITORING
    // =============================================================================

    /**
     * Start maintenance scheduler for cleanup and optimization
     * @private
     */
    _startMaintenanceScheduler() {
        // Cleanup expired views
        setInterval(async () => {
            await this._cleanupExpiredViews();
        }, 300000); // Every 5 minutes
        
        // Optimize view indices
        setInterval(async () => {
            await this._optimizeViewIndices();
        }, 3600000); // Every hour
        
        // Health check
        setInterval(async () => {
            await this._performHealthCheck();
        }, 60000); // Every minute
        
        console.log('Materialized view maintenance scheduler started');
    }

    /**
     * Cleanup expired views and data
     * @private
     */
    async _cleanupExpiredViews() {
        for (const [viewName, view] of this.views.entries()) {
            try {
                await view.cleanup();
            } catch (error) {
                console.error(`Failed to cleanup view '${viewName}':`, error);
            }
        }
    }

    /**
     * Optimize view indices for better performance
     * @private
     */
    async _optimizeViewIndices() {
        for (const [viewName, view] of this.views.entries()) {
            try {
                await view.optimizeIndices();
            } catch (error) {
                console.error(`Failed to optimize indices for view '${viewName}':`, error);
            }
        }
    }

    /**
     * Perform health check on all views
     * @private
     */
    async _performHealthCheck() {
        const unhealthyViews = [];
        
        for (const [viewName, view] of this.views.entries()) {
            const health = view.getHealthStatus();
            if (health.status !== 'healthy') {
                unhealthyViews.push({ viewName, health });
            }
        }
        
        if (unhealthyViews.length > 0) {
            console.warn(`Found ${unhealthyViews.length} unhealthy views:`, unhealthyViews);
        }
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get manager statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            ...this.metrics,
            totalViews: this.views.size,
            activeSubscriptions: this.subscriptions.size,
            periodicRefreshers: this.refreshTimers.size,
            viewDetails: this.listViews()
        };
    }

    /**
     * Get health status
     * @returns {Promise<Object>} Health status
     */
    async getHealthStatus() {
        const viewHealths = Array.from(this.views.entries()).map(([name, view]) => ({
            name,
            health: view.getHealthStatus()
        }));
        
        const unhealthyViews = viewHealths.filter(v => v.health.status !== 'healthy');
        
        return {
            status: unhealthyViews.length === 0 ? 'healthy' : 'degraded',
            totalViews: this.views.size,
            unhealthyViews: unhealthyViews.length,
            details: viewHealths,
            metrics: this.metrics,
            timestamp: Date.now()
        };
    }
}

// =============================================================================
// MATERIALIZED VIEW CLASS
// =============================================================================

class MaterializedView {
    constructor(config) {
        this.config = config;
        this.data = new Map(); // Primary data storage
        this.indices = new Map(); // Secondary indices
        this.cache = new Map(); // Query result cache
        this.lastEventSequence = 0;
        this.lastUpdated = Date.now();
        this.queryCount = 0;
        this.isInitialized = false;
    }

    async initialize() {
        console.log(`Initializing materialized view '${this.config.name}'`);
        
        // Build initial data
        await this.rebuild();
        
        // Create indices
        await this._createIndices();
        
        this.isInitialized = true;
        console.log(`Materialized view '${this.config.name}' initialized`);
    }

    async rebuild() {
        // Clear existing data
        this.data.clear();
        this.cache.clear();
        
        // Replay all relevant events
        const allEvents = await this.config.eventStore.getEvents(
            this.config.query.aggregatePattern || '*'
        );
        
        for (const event of allEvents) {
            await this.applyEvent(event);
        }
        
        if (allEvents.length > 0) {
            this.lastEventSequence = allEvents[allEvents.length - 1].metadata.sequence;
        }
        
        this.lastUpdated = Date.now();
    }

    async applyEvent(event) {
        // Apply event based on view configuration
        const projection = this._projectEvent(event);
        
        if (projection && this._passesFilter(projection)) {
            const key = this._generateKey(projection);
            
            if (event.eventType === 'OrderCreated') {
                this.data.set(key, projection);
            } else if (event.eventType === 'OrderCompleted' || 
                      event.eventType === 'OrderCancelled' ||
                      event.eventType === 'OrderExpired') {
                // Remove from active order views
                if (this.config.name === 'OrderBookView') {
                    this.data.delete(key);
                }
            } else {
                // Update existing entry
                const existing = this.data.get(key);
                if (existing) {
                    this.data.set(key, { ...existing, ...projection });
                }
            }
            
            // Update indices
            await this._updateIndices(key, projection);
            
            // Clear relevant cache entries
            this._invalidateCache(event);
        }
        
        this.lastEventSequence = Math.max(this.lastEventSequence, event.metadata.sequence);
        this.lastUpdated = Date.now();
    }

    async query(queryParams = {}) {
        this.queryCount++;
        
        // Check cache first
        const cacheKey = this._generateQueryCacheKey(queryParams);
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < 30000) { // 30 second cache
            cached.fromCache = true;
            return cached;
        }
        
        // Execute query
        let results = Array.from(this.data.values());
        
        // Apply filters
        if (queryParams.filter) {
            results = results.filter(item => this._matchesFilter(item, queryParams.filter));
        }
        
        // Apply sorting
        if (queryParams.sort) {
            results = this._sortResults(results, queryParams.sort);
        }
        
        // Apply pagination
        if (queryParams.limit || queryParams.offset) {
            const offset = queryParams.offset || 0;
            const limit = queryParams.limit || results.length;
            results = results.slice(offset, offset + limit);
        }
        
        // Apply field projection
        if (queryParams.fields) {
            results = results.map(item => this._projectFields(item, queryParams.fields));
        }
        
        const result = {
            data: results,
            total: this.data.size,
            timestamp: Date.now(),
            fromCache: false
        };
        
        // Cache result
        this.cache.set(cacheKey, result);
        
        return result;
    }

    _projectEvent(event) {
        const projection = this.config.query.projection;
        if (!projection) return event.data;
        
        const result = {};
        for (const [field, include] of Object.entries(projection)) {
            if (include && event.data[field] !== undefined) {
                result[field] = event.data[field];
            }
        }
        
        // Add metadata if needed
        result.eventType = event.eventType;
        result.timestamp = event.metadata.timestamp;
        result.sequence = event.metadata.sequence;
        
        return result;
    }

    _passesFilter(data) {
        const filter = this.config.query.filter;
        if (!filter) return true;
        
        return this._matchesFilter(data, filter);
    }

    _matchesFilter(data, filter) {
        for (const [field, condition] of Object.entries(filter)) {
            const value = data[field];
            
            if (typeof condition === 'object' && condition !== null) {
                // Handle operators like $in, $gte, etc.
                for (const [operator, operand] of Object.entries(condition)) {
                    switch (operator) {
                        case '$in':
                            if (!Array.isArray(operand) || !operand.includes(value)) {
                                return false;
                            }
                            break;
                        case '$gte':
                            if (value < operand) return false;
                            break;
                        case '$lte':
                            if (value > operand) return false;
                            break;
                        case '$ne':
                            if (value === operand) return false;
                            break;
                        default:
                            console.warn(`Unknown filter operator: ${operator}`);
                    }
                }
            } else {
                // Direct equality check
                if (value !== condition) return false;
            }
        }
        
        return true;
    }

    _sortResults(results, sortConfig) {
        return results.sort((a, b) => {
            for (const [field, direction] of Object.entries(sortConfig)) {
                const aVal = a[field];
                const bVal = b[field];
                
                let comparison = 0;
                if (aVal < bVal) comparison = -1;
                else if (aVal > bVal) comparison = 1;
                
                if (comparison !== 0) {
                    return direction === -1 ? -comparison : comparison;
                }
            }
            return 0;
        });
    }

    _projectFields(item, fields) {
        if (fields === true) return item;
        if (Array.isArray(fields)) {
            const result = {};
            for (const field of fields) {
                if (item[field] !== undefined) {
                    result[field] = item[field];
                }
            }
            return result;
        }
        return item;
    }

    _generateKey(data) {
        // Generate unique key for data item
        return data.id || `${data.trader}_${data.timestamp}`;
    }

    _generateQueryCacheKey(queryParams) {
        return `query_${JSON.stringify(queryParams)}`;
    }

    async _createIndices() {
        for (const field of this.config.indexFields) {
            this.indices.set(field, new Map());
        }
    }

    async _updateIndices(key, data) {
        for (const field of this.config.indexFields) {
            const index = this.indices.get(field);
            if (index && data[field] !== undefined) {
                if (!index.has(data[field])) {
                    index.set(data[field], new Set());
                }
                index.get(data[field]).add(key);
            }
        }
    }

    _invalidateCache(event) {
        // Clear cache entries that might be affected by this event
        this.cache.clear(); // Simple approach - clear all cache
    }

    // Utility methods
    getSize() {
        return this.data.size;
    }

    getIndices() {
        return Array.from(this.indices.keys());
    }

    getLastEventSequence() {
        return this.lastEventSequence;
    }

    setLastEventSequence(sequence) {
        this.lastEventSequence = sequence;
    }

    isFromCache(result) {
        return result.fromCache === true;
    }

    isStale() {
        const maxAge = this.config.ttl || 300000; // 5 minutes default
        return Date.now() - this.lastUpdated > maxAge;
    }

    getPerformanceMetrics() {
        return {
            queryCount: this.queryCount,
            dataSize: this.data.size,
            cacheSize: this.cache.size,
            lastUpdated: this.lastUpdated,
            lastEventSequence: this.lastEventSequence
        };
    }

    getHealthStatus() {
        const age = Date.now() - this.lastUpdated;
        const maxAge = this.config.ttl || 300000;
        
        return {
            status: age < maxAge ? 'healthy' : 'stale',
            age,
            maxAge,
            isInitialized: this.isInitialized,
            dataSize: this.data.size
        };
    }

    async clear() {
        this.data.clear();
        this.cache.clear();
        this.indices.clear();
        await this._createIndices();
    }

    async cleanup() {
        // Remove expired cache entries
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > 60000) { // 1 minute
                this.cache.delete(key);
            }
        }
    }

    async optimizeIndices() {
        // Rebuild indices if they become fragmented
        const totalKeys = this.data.size;
        for (const [field, index] of this.indices.entries()) {
            const indexSize = Array.from(index.values())
                .reduce((sum, set) => sum + set.size, 0);
                
            if (indexSize !== totalKeys) {
                console.log(`Rebuilding index for field '${field}'`);
                await this._rebuildIndex(field);
            }
        }
    }

    async _rebuildIndex(field) {
        const index = new Map();
        
        for (const [key, data] of this.data.entries()) {
            if (data[field] !== undefined) {
                if (!index.has(data[field])) {
                    index.set(data[field], new Set());
                }
                index.get(data[field]).add(key);
            }
        }
        
        this.indices.set(field, index);
    }
}

// =============================================================================
// DISTRIBUTED CACHE (FOR CLUSTER DEPLOYMENTS)
// =============================================================================

class DistributedCache {
    constructor(config) {
        this.config = config;
        // Implementation would integrate with Redis, Hazelcast, etc.
        this.cache = new Map(); // Fallback to local cache
    }

    async get(key) {
        return this.cache.get(key);
    }

    async set(key, value, ttl) {
        this.cache.set(key, value);
        if (ttl) {
            setTimeout(() => this.cache.delete(key), ttl);
        }
    }

    async invalidate(pattern) {
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
            }
        }
    }
}

module.exports = { MaterializedViewManager };