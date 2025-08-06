/**
 * @fileoverview Comprehensive Redis Caching Strategy for SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description High-performance caching with atomic operations, real-time updates, and intelligent warming
 */

const Redis = require('ioredis');
const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * Advanced Redis Cache Manager for SwappiQ Protocol
 * Provides atomic operations, pub/sub messaging, and intelligent caching strategies
 */
class SwappiQRedisCache extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Redis connection settings
            redis: {
                host: config.redis?.host || 'localhost',
                port: config.redis?.port || 6379,
                password: config.redis?.password,
                db: config.redis?.db || 0,
                keyPrefix: config.redis?.keyPrefix || 'swappiq:',
                maxRetriesPerRequest: config.redis?.maxRetriesPerRequest || 3,
                retryDelayOnFailover: config.redis?.retryDelayOnFailover || 100,
                lazyConnect: config.redis?.lazyConnect !== false,
                maxmemoryPolicy: config.redis?.maxmemoryPolicy || 'allkeys-lru'
            },
            
            // Cluster configuration
            cluster: {
                enabled: config.cluster?.enabled || false,
                nodes: config.cluster?.nodes || [],
                options: config.cluster?.options || {}
            },
            
            // Cache strategies
            strategies: {
                orderBook: {
                    ttl: config.strategies?.orderBook?.ttl || 300, // 5 minutes
                    maxSize: config.strategies?.orderBook?.maxSize || 10000,
                    compressionThreshold: config.strategies?.orderBook?.compressionThreshold || 1024,
                    atomicUpdates: config.strategies?.orderBook?.atomicUpdates !== false
                },
                userSessions: {
                    ttl: config.strategies?.userSessions?.ttl || 3600, // 1 hour
                    slidingExpiration: config.strategies?.userSessions?.slidingExpiration !== false,
                    maxConcurrentSessions: config.strategies?.userSessions?.maxConcurrentSessions || 5
                },
                rateLimiting: {
                    windowSize: config.strategies?.rateLimiting?.windowSize || 60, // 1 minute
                    maxRequests: config.strategies?.rateLimiting?.maxRequests || 100,
                    slidingWindow: config.strategies?.rateLimiting?.slidingWindow !== false
                },
                walletBalances: {
                    ttl: config.strategies?.walletBalances?.ttl || 30, // 30 seconds
                    refreshThreshold: config.strategies?.walletBalances?.refreshThreshold || 0.8,
                    batchSize: config.strategies?.walletBalances?.batchSize || 50
                },
                cacheWarming: {
                    enabled: config.strategies?.cacheWarming?.enabled !== false,
                    schedules: config.strategies?.cacheWarming?.schedules || [],
                    preloadKeys: config.strategies?.cacheWarming?.preloadKeys || []
                }
            },
            
            // Performance settings
            performance: {
                pipelining: config.performance?.pipelining !== false,
                batchSize: config.performance?.batchSize || 100,
                compression: config.performance?.compression !== false,
                serialization: config.performance?.serialization || 'json', // 'json', 'msgpack', 'protobuf'
                monitoring: config.performance?.monitoring !== false
            },
            
            // Security settings
            security: {
                encryption: config.security?.encryption || false,
                keyRotation: config.security?.keyRotation || false,
                accessControl: config.security?.accessControl || false
            },
            
            ...config
        };

        // State management
        this.state = {
            connected: false,
            clusterMode: false,
            stats: {
                hits: 0,
                misses: 0,
                sets: 0,
                deletes: 0,
                errors: 0,
                avgResponseTime: 0,
                totalOps: 0
            },
            monitors: new Map(),
            pubsubChannels: new Set(),
            warmingJobs: new Map()
        };

        // Redis clients
        this.redis = null;
        this.publisher = null;
        this.subscriber = null;

        // Component managers
        this.orderBookCache = null;
        this.sessionManager = null;
        this.rateLimiter = null;
        this.walletCache = null;
        this.pubSubManager = null;
        this.warmingManager = null;

        this.initialize();
    }

    /**
     * Initialize Redis cache system
     */
    async initialize() {
        try {
            await this._initializeRedisConnections();
            await this._initializeComponents();
            await this._setupMonitoring();
            await this._startCacheWarming();
            
            this.state.connected = true;
            console.log('SwappiQ Redis Cache initialized successfully');
            
            this.emit('initialized', {
                clusterMode: this.state.clusterMode,
                componentsLoaded: true
            });

        } catch (error) {
            console.error('Failed to initialize Redis Cache:', error);
            throw error;
        }
    }

    /**
     * Initialize Redis connections (single instance or cluster)
     */
    async _initializeRedisConnections() {
        if (this.config.cluster.enabled && this.config.cluster.nodes.length > 0) {
            // Cluster mode
            this.redis = new Redis.Cluster(this.config.cluster.nodes, {
                ...this.config.cluster.options,
                redisOptions: this.config.redis
            });
            this.state.clusterMode = true;
            
            // Separate connections for pub/sub in cluster mode
            this.publisher = new Redis.Cluster(this.config.cluster.nodes, {
                ...this.config.cluster.options,
                redisOptions: this.config.redis
            });
            this.subscriber = new Redis.Cluster(this.config.cluster.nodes, {
                ...this.config.cluster.options,
                redisOptions: this.config.redis
            });
        } else {
            // Single instance mode
            this.redis = new Redis(this.config.redis);
            this.publisher = new Redis(this.config.redis);
            this.subscriber = new Redis(this.config.redis);
        }

        // Setup connection event handlers
        this._setupConnectionHandlers();
        
        // Wait for connections
        await Promise.all([
            this._waitForConnection(this.redis, 'main'),
            this._waitForConnection(this.publisher, 'publisher'),
            this._waitForConnection(this.subscriber, 'subscriber')
        ]);
    }

    /**
     * Initialize cache components
     */
    async _initializeComponents() {
        // Order book cache with atomic updates
        this.orderBookCache = new OrderBookCache(this.redis, this.config.strategies.orderBook);
        
        // User session management
        this.sessionManager = new SessionManager(this.redis, this.config.strategies.userSessions);
        
        // Rate limiting counters
        this.rateLimiter = new RateLimitingCache(this.redis, this.config.strategies.rateLimiting);
        
        // Hot wallet balance caching
        this.walletCache = new WalletBalanceCache(this.redis, this.config.strategies.walletBalances);
        
        // Pub/sub manager for real-time updates
        this.pubSubManager = new PubSubManager(this.publisher, this.subscriber);
        
        // Cache warming strategies
        this.warmingManager = new CacheWarmingManager(this.redis, this.config.strategies.cacheWarming);

        // Initialize all components
        await Promise.all([
            this.orderBookCache.initialize(),
            this.sessionManager.initialize(),
            this.rateLimiter.initialize(),
            this.walletCache.initialize(),
            this.pubSubManager.initialize(),
            this.warmingManager.initialize()
        ]);
    }

    /**
     * Setup connection event handlers
     */
    _setupConnectionHandlers() {
        const connections = [
            { client: this.redis, name: 'main' },
            { client: this.publisher, name: 'publisher' },
            { client: this.subscriber, name: 'subscriber' }
        ];

        connections.forEach(({ client, name }) => {
            client.on('connect', () => {
                console.log(`Redis ${name} client connected`);
            });

            client.on('ready', () => {
                console.log(`Redis ${name} client ready`);
            });

            client.on('error', (error) => {
                console.error(`Redis ${name} client error:`, error);
                this.state.stats.errors++;
                this.emit('error', { client: name, error });
            });

            client.on('close', () => {
                console.log(`Redis ${name} client connection closed`);
            });

            client.on('reconnecting', () => {
                console.log(`Redis ${name} client reconnecting`);
            });
        });
    }

    /**
     * Wait for Redis connection
     */
    async _waitForConnection(client, name) {
        return new Promise((resolve, reject) => {
            if (client.status === 'ready') {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error(`Redis ${name} connection timeout`));
            }, 10000);

            client.once('ready', () => {
                clearTimeout(timeout);
                resolve();
            });

            client.once('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    /**
     * Setup performance monitoring
     */
    async _setupMonitoring() {
        if (!this.config.performance.monitoring) return;

        // Monitor Redis performance
        setInterval(async () => {
            try {
                const info = await this.redis.info('stats');
                const stats = this._parseRedisInfo(info);
                
                this.emit('stats', {
                    redis: stats,
                    cache: this.state.stats,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('Redis monitoring error:', error);
            }
        }, 30000); // Every 30 seconds
    }

    /**
     * Start cache warming processes
     */
    async _startCacheWarming() {
        if (this.config.strategies.cacheWarming.enabled) {
            await this.warmingManager.startScheduledWarming();
        }
    }

    // ========== PUBLIC API METHODS ==========

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            connection: {
                connected: this.state.connected,
                clusterMode: this.state.clusterMode
            },
            performance: { ...this.state.stats },
            components: {
                orderBook: this.orderBookCache?.getStats(),
                sessions: this.sessionManager?.getStats(),
                rateLimiting: this.rateLimiter?.getStats(),
                walletBalances: this.walletCache?.getStats(),
                pubSub: this.pubSubManager?.getStats(),
                warming: this.warmingManager?.getStats()
            }
        };
    }

    /**
     * Health check for cache system
     */
    async healthCheck() {
        try {
            const start = Date.now();
            await this.redis.ping();
            const latency = Date.now() - start;

            return {
                status: 'healthy',
                latency,
                connected: this.state.connected,
                clusterMode: this.state.clusterMode,
                components: await this._checkComponentHealth()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                connected: false
            };
        }
    }

    /**
     * Flush specific cache patterns
     */
    async flushPattern(pattern) {
        try {
            const keys = await this.redis.keys(`${this.config.redis.keyPrefix}${pattern}`);
            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
            return { flushed: keys.length };
        } catch (error) {
            console.error('Cache flush error:', error);
            throw error;
        }
    }

    /**
     * Get component managers for direct access
     */
    getOrderBookCache() {
        return this.orderBookCache;
    }

    getSessionManager() {
        return this.sessionManager;
    }

    getRateLimiter() {
        return this.rateLimiter;
    }

    getWalletCache() {
        return this.walletCache;
    }

    getPubSubManager() {
        return this.pubSubManager;
    }

    getWarmingManager() {
        return this.warmingManager;
    }

    // ========== UTILITY METHODS ==========

    /**
     * Parse Redis INFO command output
     */
    _parseRedisInfo(info) {
        const stats = {};
        const lines = info.split('\r\n');
        
        lines.forEach(line => {
            if (line && !line.startsWith('#')) {
                const [key, value] = line.split(':');
                if (key && value) {
                    stats[key] = isNaN(value) ? value : Number(value);
                }
            }
        });
        
        return stats;
    }

    /**
     * Check health of all components
     */
    async _checkComponentHealth() {
        const checks = {};
        
        try {
            checks.orderBook = await this.orderBookCache?.healthCheck() || { status: 'unknown' };
            checks.sessions = await this.sessionManager?.healthCheck() || { status: 'unknown' };
            checks.rateLimiting = await this.rateLimiter?.healthCheck() || { status: 'unknown' };
            checks.walletBalances = await this.walletCache?.healthCheck() || { status: 'unknown' };
            checks.pubSub = await this.pubSubManager?.healthCheck() || { status: 'unknown' };
            checks.warming = await this.warmingManager?.healthCheck() || { status: 'unknown' };
        } catch (error) {
            console.error('Component health check error:', error);
        }
        
        return checks;
    }

    /**
     * Update performance statistics
     */
    _updateStats(operation, responseTime = 0) {
        this.state.stats[operation]++;
        this.state.stats.totalOps++;
        
        // Update average response time
        if (responseTime > 0) {
            this.state.stats.avgResponseTime = 
                (this.state.stats.avgResponseTime * (this.state.stats.totalOps - 1) + responseTime) / 
                this.state.stats.totalOps;
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        try {
            console.log('Shutting down Redis Cache...');
            
            // Stop warming processes
            if (this.warmingManager) {
                await this.warmingManager.stop();
            }
            
            // Close pub/sub connections
            if (this.pubSubManager) {
                await this.pubSubManager.shutdown();
            }
            
            // Disconnect Redis clients
            const disconnectPromises = [];
            if (this.redis) disconnectPromises.push(this.redis.disconnect());
            if (this.publisher) disconnectPromises.push(this.publisher.disconnect());
            if (this.subscriber) disconnectPromises.push(this.subscriber.disconnect());
            
            await Promise.all(disconnectPromises);
            
            this.state.connected = false;
            console.log('Redis Cache shutdown completed');
            
        } catch (error) {
            console.error('Error during Redis Cache shutdown:', error);
            throw error;
        }
    }
}

module.exports = { SwappiQRedisCache };

/**
 * Usage Example:
 * 
 * const cache = new SwappiQRedisCache({
 *     redis: {
 *         host: 'localhost',
 *         port: 6379,
 *         keyPrefix: 'swappiq:prod:'
 *     },
 *     strategies: {
 *         orderBook: {
 *             ttl: 300,
 *             atomicUpdates: true
 *         },
 *         userSessions: {
 *             ttl: 3600,
 *             maxConcurrentSessions: 5
 *         },
 *         walletBalances: {
 *             ttl: 30,
 *             refreshThreshold: 0.8
 *         }
 *     }
 * });
 * 
 * await cache.initialize();
 * 
 * // Use component managers
 * const orderBookCache = cache.getOrderBookCache();
 * const sessionManager = cache.getSessionManager();
 * const walletCache = cache.getWalletCache();
 */