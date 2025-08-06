/**
 * @fileoverview Cache Invalidation Manager for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Intelligent cache invalidation patterns with event-driven updates, TTL management, and dependency tracking
 */

const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * Cache Invalidation Manager
 * Handles intelligent cache invalidation based on events, dependencies, and patterns
 */
class CacheInvalidationManager extends EventEmitter {
    constructor(redis, config) {
        super();
        
        this.redis = redis;
        this.config = {
            enabled: config.enabled !== false,
            patterns: {
                eventDriven: config.patterns?.eventDriven !== false,
                timeBased: config.patterns?.timeBased !== false,
                dependencyBased: config.patterns?.dependencyBased !== false,
                patternMatching: config.patterns?.patternMatching !== false,
                batchInvalidation: config.patterns?.batchInvalidation !== false
            },
            invalidation: {
                batchSize: config.invalidation?.batchSize || 100,
                maxConcurrency: config.invalidation?.maxConcurrency || 10,
                retryAttempts: config.invalidation?.retryAttempts || 3,
                retryDelay: config.invalidation?.retryDelay || 1000,
                gracePeriod: config.invalidation?.gracePeriod || 5000 // 5 seconds
            },
            dependencies: {
                trackingEnabled: config.dependencies?.trackingEnabled !== false,
                maxDepth: config.dependencies?.maxDepth || 5,
                cascadeInvalidation: config.dependencies?.cascadeInvalidation !== false
            },
            events: {
                blockchain: config.events?.blockchain !== false,
                orderBook: config.events?.orderBook !== false,
                userActions: config.events?.userActions !== false,
                systemEvents: config.events?.systemEvents !== false
            },
            monitoring: {
                trackMetrics: config.monitoring?.trackMetrics !== false,
                alertThresholds: config.monitoring?.alertThresholds || {
                    invalidationRate: 1000, // per minute
                    failureRate: 0.05 // 5%
                }
            },
            ...config
        };

        this.state = {
            initialized: false,
            stats: {
                totalInvalidations: 0,
                successfulInvalidations: 0,
                failedInvalidations: 0,
                batchInvalidations: 0,
                dependencyInvalidations: 0,
                eventTriggeredInvalidations: 0,
                avgInvalidationTime: 0,
                lastInvalidation: null
            },
            dependencies: new Map(), // key -> Set of dependent keys
            reverseDependencies: new Map(), // key -> Set of keys it depends on
            pendingInvalidations: new Map(),
            activeInvalidations: new Set(),
            eventListeners: new Map(),
            patternRules: new Map()
        };

        // Event patterns for automatic invalidation
        this.eventPatterns = {
            'order:created': ['orderbook:*', 'wallet:balance:*'],
            'order:cancelled': ['orderbook:*', 'wallet:balance:*'],
            'order:filled': ['orderbook:*', 'wallet:balance:*', 'trade:history:*'],
            'block:new': ['wallet:balance:*', 'price:*'],
            'price:updated': ['price:*', 'portfolio:*', 'analytics:*'],
            'user:login': ['session:*', 'user:profile:*'],
            'user:logout': ['session:*'],
            'wallet:connected': ['wallet:*', 'session:*'],
            'wallet:disconnected': ['wallet:*', 'session:*']
        };

        // Lua scripts for atomic operations
        this.luaScripts = {};
    }

    /**
     * Initialize cache invalidation manager
     */
    async initialize() {
        try {
            if (!this.config.enabled) {
                console.log('Cache invalidation is disabled');
                return;
            }

            await this._loadLuaScripts();
            await this._loadDependencyMap();
            await this._setupEventListeners();
            await this._initializePatternRules();
            await this._startMonitoring();
            
            this.state.initialized = true;
            console.log('Cache Invalidation Manager initialized');
            
            this.emit('initialized', {
                patterns: Object.keys(this.config.patterns).filter(p => this.config.patterns[p]),
                eventListeners: this.state.eventListeners.size,
                dependencies: this.state.dependencies.size
            });
            
        } catch (error) {
            console.error('Failed to initialize Cache Invalidation Manager:', error);
            throw error;
        }
    }

    /**
     * Load Lua scripts for atomic invalidation operations
     */
    async _loadLuaScripts() {
        // Batch invalidation script
        this.luaScripts.batchInvalidate = await this.redis.defineCommand('batchInvalidate', {
            numberOfKeys: 0,
            lua: `
                local keys = {}
                local invalidated = 0
                local failed = 0
                
                for i = 1, #ARGV do
                    local key = ARGV[i]
                    local exists = redis.call('EXISTS', key)
                    
                    if exists == 1 then
                        local result = redis.call('DEL', key)
                        if result == 1 then
                            invalidated = invalidated + 1
                            table.insert(keys, key)
                        else
                            failed = failed + 1
                        end
                    end
                end
                
                return {invalidated, failed, keys}
            `
        });

        // Pattern-based invalidation script
        this.luaScripts.invalidatePattern = await this.redis.defineCommand('invalidatePattern', {
            numberOfKeys: 0,
            lua: `
                local pattern = ARGV[1]
                local limit = tonumber(ARGV[2]) or 1000
                
                local keys = redis.call('KEYS', pattern)
                local invalidated = 0
                local failed = 0
                
                for i = 1, math.min(#keys, limit) do
                    local key = keys[i]
                    local result = redis.call('DEL', key)
                    if result == 1 then
                        invalidated = invalidated + 1
                    else
                        failed = failed + 1
                    end
                end
                
                return {invalidated, failed, keys}
            `
        });

        // Dependency cascade invalidation script
        this.luaScripts.cascadeInvalidate = await this.redis.defineCommand('cascadeInvalidate', {
            numberOfKeys: 1,
            lua: `
                local dependencyKey = KEYS[1]
                local rootKey = ARGV[1]
                local maxDepth = tonumber(ARGV[2]) or 5
                
                -- Get dependencies
                local dependencies = redis.call('SMEMBERS', dependencyKey .. ':deps:' .. rootKey)
                local invalidated = {}
                local processed = {}
                
                local function invalidateRecursive(key, depth)
                    if depth > maxDepth or processed[key] then
                        return
                    end
                    
                    processed[key] = true
                    
                    -- Invalidate the key
                    local exists = redis.call('EXISTS', key)
                    if exists == 1 then
                        redis.call('DEL', key)
                        table.insert(invalidated, key)
                    end
                    
                    -- Get dependencies of this key
                    local subDeps = redis.call('SMEMBERS', dependencyKey .. ':deps:' .. key)
                    for i = 1, #subDeps do
                        invalidateRecursive(subDeps[i], depth + 1)
                    end
                end
                
                -- Start invalidation
                invalidateRecursive(rootKey, 1)
                
                return invalidated
            `
        });
    }

    /**
     * Invalidate single cache key
     */
    async invalidateKey(key, options = {}) {
        const startTime = Date.now();
        
        try {
            const {
                cascadeDependencies = this.config.dependencies.cascadeInvalidation,
                eventSource = 'manual',
                metadata = {}
            } = options;

            // Check if invalidation is already in progress
            if (this.state.activeInvalidations.has(key)) {
                return { 
                    success: false, 
                    reason: 'invalidation_in_progress',
                    key 
                };
            }

            this.state.activeInvalidations.add(key);

            try {
                // Perform the invalidation
                const exists = await this.redis.exists(key);
                if (!exists) {
                    return { 
                        success: true, 
                        reason: 'key_not_found',
                        key,
                        invalidated: false
                    };
                }

                const result = await this.redis.del(key);
                const invalidated = result === 1;

                // Handle dependency cascade
                let dependenciesInvalidated = [];
                if (cascadeDependencies && invalidated) {
                    dependenciesInvalidated = await this._invalidateDependencies(key);
                }

                // Update statistics
                this._updateStats('single', Date.now() - startTime, invalidated);

                // Emit invalidation event
                this.emit('keyInvalidated', {
                    key,
                    invalidated,
                    dependenciesInvalidated,
                    eventSource,
                    metadata,
                    timestamp: Date.now()
                });

                return {
                    success: true,
                    key,
                    invalidated,
                    dependenciesInvalidated: dependenciesInvalidated.length,
                    dependencies: dependenciesInvalidated
                };

            } finally {
                this.state.activeInvalidations.delete(key);
            }

        } catch (error) {
            this.state.stats.failedInvalidations++;
            console.error('Invalidate key error:', error);
            throw error;
        }
    }

    /**
     * Invalidate multiple keys
     */
    async invalidateKeys(keys, options = {}) {
        const startTime = Date.now();
        
        try {
            const {
                batchSize = this.config.invalidation.batchSize,
                cascadeDependencies = this.config.dependencies.cascadeInvalidation,
                eventSource = 'manual',
                metadata = {}
            } = options;

            if (!Array.isArray(keys) || keys.length === 0) {
                return { success: false, reason: 'invalid_keys_array' };
            }

            const results = {
                totalKeys: keys.length,
                invalidated: 0,
                failed: 0,
                dependenciesInvalidated: 0,
                details: []
            };

            // Process keys in batches
            for (let i = 0; i < keys.length; i += batchSize) {
                const batch = keys.slice(i, i + batchSize);
                
                // Use Lua script for atomic batch operation
                const batchResult = await this.redis.batchInvalidate(...batch);
                
                results.invalidated += batchResult[0];
                results.failed += batchResult[1];
                
                // Handle dependencies for each invalidated key
                if (cascadeDependencies) {
                    for (const key of batchResult[2]) {
                        const deps = await this._invalidateDependencies(key);
                        results.dependenciesInvalidated += deps.length;
                    }
                }

                results.details.push({
                    batch: i / batchSize + 1,
                    keys: batch,
                    invalidated: batchResult[0],
                    failed: batchResult[1]
                });
            }

            // Update statistics
            this._updateStats('batch', Date.now() - startTime, results.invalidated);
            this.state.stats.batchInvalidations++;

            // Emit batch invalidation event
            this.emit('keysInvalidated', {
                keys,
                results,
                eventSource,
                metadata,
                timestamp: Date.now()
            });

            return { success: true, ...results };

        } catch (error) {
            this.state.stats.failedInvalidations++;
            console.error('Invalidate keys error:', error);
            throw error;
        }
    }

    /**
     * Invalidate keys by pattern
     */
    async invalidatePattern(pattern, options = {}) {
        const startTime = Date.now();
        
        try {
            const {
                limit = 1000,
                eventSource = 'pattern',
                metadata = {}
            } = options;

            const result = await this.redis.invalidatePattern(pattern, limit);
            
            const invalidationResult = {
                pattern,
                invalidated: result[0],
                failed: result[1],
                keys: result[2],
                limited: result[2].length >= limit
            };

            // Update statistics
            this._updateStats('pattern', Date.now() - startTime, result[0]);

            // Emit pattern invalidation event
            this.emit('patternInvalidated', {
                ...invalidationResult,
                eventSource,
                metadata,
                timestamp: Date.now()
            });

            return { success: true, ...invalidationResult };

        } catch (error) {
            this.state.stats.failedInvalidations++;
            console.error('Invalidate pattern error:', error);
            throw error;
        }
    }

    /**
     * Register dependency between cache keys
     */
    async registerDependency(key, dependentKey) {
        try {
            // Add to forward dependencies (key -> dependents)
            if (!this.state.dependencies.has(key)) {
                this.state.dependencies.set(key, new Set());
            }
            this.state.dependencies.get(key).add(dependentKey);

            // Add to reverse dependencies (dependent -> dependencies)
            if (!this.state.reverseDependencies.has(dependentKey)) {
                this.state.reverseDependencies.set(dependentKey, new Set());
            }
            this.state.reverseDependencies.get(dependentKey).add(key);

            // Store in Redis for persistence
            await this.redis.sadd(`deps:${key}`, dependentKey);
            await this.redis.sadd(`rdeps:${dependentKey}`, key);

            return { success: true };

        } catch (error) {
            console.error('Register dependency error:', error);
            throw error;
        }
    }

    /**
     * Remove dependency between cache keys
     */
    async removeDependency(key, dependentKey) {
        try {
            // Remove from forward dependencies
            if (this.state.dependencies.has(key)) {
                this.state.dependencies.get(key).delete(dependentKey);
                if (this.state.dependencies.get(key).size === 0) {
                    this.state.dependencies.delete(key);
                }
            }

            // Remove from reverse dependencies
            if (this.state.reverseDependencies.has(dependentKey)) {
                this.state.reverseDependencies.get(dependentKey).delete(key);
                if (this.state.reverseDependencies.get(dependentKey).size === 0) {
                    this.state.reverseDependencies.delete(dependentKey);
                }
            }

            // Remove from Redis
            await this.redis.srem(`deps:${key}`, dependentKey);
            await this.redis.srem(`rdeps:${dependentKey}`, key);

            return { success: true };

        } catch (error) {
            console.error('Remove dependency error:', error);
            throw error;
        }
    }

    /**
     * Handle event-driven invalidation
     */
    async handleEvent(eventType, eventData) {
        try {
            if (!this.config.patterns.eventDriven) return;

            const patterns = this.eventPatterns[eventType];
            if (!patterns) {
                return { success: true, reason: 'no_patterns_defined' };
            }

            const keysToInvalidate = [];

            for (const pattern of patterns) {
                // Replace placeholders with actual values from event data
                const resolvedPattern = this._resolveEventPattern(pattern, eventData);
                
                if (resolvedPattern.includes('*')) {
                    // Pattern matching - find keys to invalidate
                    const matchingKeys = await this.redis.keys(resolvedPattern);
                    keysToInvalidate.push(...matchingKeys);
                } else {
                    // Exact key match
                    keysToInvalidate.push(resolvedPattern);
                }
            }

            if (keysToInvalidate.length === 0) {
                return { success: true, reason: 'no_keys_to_invalidate' };
            }

            // Remove duplicates
            const uniqueKeys = [...new Set(keysToInvalidate)];

            // Perform invalidation
            const result = await this.invalidateKeys(uniqueKeys, {
                eventSource: eventType,
                metadata: eventData
            });

            this.state.stats.eventTriggeredInvalidations++;

            return result;

        } catch (error) {
            console.error('Handle event error:', error);
            throw error;
        }
    }

    /**
     * Schedule time-based invalidation
     */
    async scheduleInvalidation(key, delay, options = {}) {
        try {
            const {
                cascadeDependencies = false,
                metadata = {}
            } = options;

            const invalidationId = crypto.randomBytes(8).toString('hex');
            
            const timeout = setTimeout(async () => {
                try {
                    await this.invalidateKey(key, {
                        cascadeDependencies,
                        eventSource: 'scheduled',
                        metadata: { ...metadata, scheduledId: invalidationId }
                    });
                    
                    this.state.pendingInvalidations.delete(invalidationId);
                } catch (error) {
                    console.error('Scheduled invalidation error:', error);
                }
            }, delay);

            this.state.pendingInvalidations.set(invalidationId, {
                key,
                timeout,
                scheduledAt: Date.now(),
                executeAt: Date.now() + delay,
                options
            });

            return { success: true, invalidationId };

        } catch (error) {
            console.error('Schedule invalidation error:', error);
            throw error;
        }
    }

    /**
     * Cancel scheduled invalidation
     */
    async cancelScheduledInvalidation(invalidationId) {
        try {
            const pending = this.state.pendingInvalidations.get(invalidationId);
            if (!pending) {
                return { success: false, reason: 'invalidation_not_found' };
            }

            clearTimeout(pending.timeout);
            this.state.pendingInvalidations.delete(invalidationId);

            return { success: true };

        } catch (error) {
            console.error('Cancel scheduled invalidation error:', error);
            throw error;
        }
    }

    /**
     * Get invalidation statistics
     */
    getStats() {
        return {
            ...this.state.stats,
            pendingInvalidations: this.state.pendingInvalidations.size,
            activeInvalidations: this.state.activeInvalidations.size,
            trackedDependencies: this.state.dependencies.size,
            eventListeners: this.state.eventListeners.size,
            config: {
                enabled: this.config.enabled,
                patterns: Object.keys(this.config.patterns).filter(p => this.config.patterns[p]),
                events: Object.keys(this.config.events).filter(e => this.config.events[e])
            }
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            return {
                status: 'healthy',
                enabled: this.config.enabled,
                initialized: this.state.initialized,
                activeInvalidations: this.state.activeInvalidations.size,
                pendingInvalidations: this.state.pendingInvalidations.size
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
     * Load dependency map from Redis
     */
    async _loadDependencyMap() {
        try {
            if (!this.config.dependencies.trackingEnabled) return;

            // Load forward dependencies
            const depKeys = await this.redis.keys('deps:*');
            for (const depKey of depKeys) {
                const key = depKey.replace('deps:', '');
                const dependents = await this.redis.smembers(depKey);
                
                if (dependents.length > 0) {
                    this.state.dependencies.set(key, new Set(dependents));
                }
            }

            // Load reverse dependencies
            const rdepKeys = await this.redis.keys('rdeps:*');
            for (const rdepKey of rdepKeys) {
                const key = rdepKey.replace('rdeps:', '');
                const dependencies = await this.redis.smembers(rdepKey);
                
                if (dependencies.length > 0) {
                    this.state.reverseDependencies.set(key, new Set(dependencies));
                }
            }

            console.log(`Loaded ${this.state.dependencies.size} dependency relationships`);

        } catch (error) {
            console.error('Load dependency map error:', error);
        }
    }

    /**
     * Setup event listeners for automatic invalidation
     */
    async _setupEventListeners() {
        if (!this.config.patterns.eventDriven) return;

        for (const eventType of Object.keys(this.eventPatterns)) {
            this.state.eventListeners.set(eventType, true);
        }

        // Listen for internal events
        this.on('cacheUpdated', (data) => this.handleEvent('cache:updated', data));
        this.on('userAction', (data) => this.handleEvent('user:action', data));
        this.on('blockchainEvent', (data) => this.handleEvent('blockchain:event', data));
    }

    /**
     * Initialize pattern rules
     */
    async _initializePatternRules() {
        // Default pattern rules
        this.state.patternRules.set('orderbook:*', {
            events: ['order:created', 'order:cancelled', 'order:filled'],
            dependencies: ['wallet:balance:*'],
            ttl: 30
        });

        this.state.patternRules.set('wallet:balance:*', {
            events: ['block:new', 'order:filled'],
            dependencies: ['portfolio:*'],
            ttl: 60
        });

        this.state.patternRules.set('price:*', {
            events: ['price:updated', 'block:new'],
            dependencies: ['analytics:*', 'portfolio:*'],
            ttl: 15
        });
    }

    /**
     * Start monitoring for alerts and metrics
     */
    async _startMonitoring() {
        if (!this.config.monitoring.trackMetrics) return;

        setInterval(() => {
            this._checkInvalidationRate();
            this._checkFailureRate();
        }, 60000); // Every minute
    }

    /**
     * Invalidate dependencies of a key
     */
    async _invalidateDependencies(key, visited = new Set(), depth = 0) {
        if (depth >= this.config.dependencies.maxDepth || visited.has(key)) {
            return [];
        }

        visited.add(key);
        const invalidated = [];

        const dependencies = this.state.dependencies.get(key);
        if (!dependencies) return invalidated;

        for (const depKey of dependencies) {
            const exists = await this.redis.exists(depKey);
            if (exists) {
                const result = await this.redis.del(depKey);
                if (result === 1) {
                    invalidated.push(depKey);
                    
                    // Recursively invalidate dependencies
                    const subDeps = await this._invalidateDependencies(depKey, visited, depth + 1);
                    invalidated.push(...subDeps);
                }
            }
        }

        return invalidated;
    }

    /**
     * Resolve event pattern with actual data
     */
    _resolveEventPattern(pattern, eventData) {
        let resolved = pattern;

        // Replace common placeholders
        if (eventData.walletAddress) {
            resolved = resolved.replace('*wallet*', eventData.walletAddress);
        }
        if (eventData.tradingPair) {
            resolved = resolved.replace('*pair*', eventData.tradingPair);
        }
        if (eventData.tokenAddress) {
            resolved = resolved.replace('*token*', eventData.tokenAddress);
        }
        if (eventData.userId) {
            resolved = resolved.replace('*user*', eventData.userId);
        }

        return resolved;
    }

    /**
     * Update invalidation statistics
     */
    _updateStats(type, duration, count) {
        this.state.stats.totalInvalidations += count;
        this.state.stats.successfulInvalidations += count;
        this.state.stats.lastInvalidation = Date.now();

        // Update average invalidation time
        const totalOps = this.state.stats.successfulInvalidations;
        if (totalOps > 0) {
            this.state.stats.avgInvalidationTime = 
                (this.state.stats.avgInvalidationTime * (totalOps - count) + duration) / totalOps;
        }

        if (type === 'dependency') {
            this.state.stats.dependencyInvalidations += count;
        }
    }

    /**
     * Check invalidation rate for alerts
     */
    _checkInvalidationRate() {
        const threshold = this.config.monitoring.alertThresholds.invalidationRate;
        const recentInvalidations = this.state.stats.totalInvalidations; // Simplified
        
        if (recentInvalidations > threshold) {
            this.emit('alert', {
                type: 'high_invalidation_rate',
                rate: recentInvalidations,
                threshold
            });
        }
    }

    /**
     * Check failure rate for alerts
     */
    _checkFailureRate() {
        const total = this.state.stats.totalInvalidations;
        const failed = this.state.stats.failedInvalidations;
        
        if (total > 0) {
            const failureRate = failed / total;
            const threshold = this.config.monitoring.alertThresholds.failureRate;
            
            if (failureRate > threshold) {
                this.emit('alert', {
                    type: 'high_failure_rate',
                    rate: failureRate,
                    threshold
                });
            }
        }
    }

    /**
     * Stop invalidation manager
     */
    async stop() {
        try {
            console.log('Stopping Cache Invalidation Manager...');
            
            // Cancel all pending invalidations
            for (const [id, pending] of this.state.pendingInvalidations) {
                clearTimeout(pending.timeout);
            }
            this.state.pendingInvalidations.clear();
            
            // Clear event listeners
            this.removeAllListeners();
            
            console.log('Cache Invalidation Manager stopped');
            
        } catch (error) {
            console.error('Error stopping Cache Invalidation Manager:', error);
            throw error;
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        await this.stop();
        console.log('Cache Invalidation Manager cleanup completed');
    }
}

module.exports = { CacheInvalidationManager };