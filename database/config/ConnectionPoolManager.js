/**
 * @fileoverview Database Connection Pool Manager with PgBouncer Integration
 * @author SwappiQ Protocol
 * @description Manages database connections with pooling, monitoring, and failover
 */

const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const EventEmitter = require('events');
const fs = require('fs').promises;
const net = require('net');

/**
 * Connection Pool Manager for optimal database performance
 */
class ConnectionPoolManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // PgBouncer configuration
            pgbouncer: {
                enabled: config.pgbouncer?.enabled !== false,
                host: config.pgbouncer?.host || 'localhost',
                port: config.pgbouncer?.port || 6432,
                adminPort: config.pgbouncer?.adminPort || 6433,
                configPath: config.pgbouncer?.configPath || '/etc/pgbouncer/pgbouncer.ini',
                usersPath: config.pgbouncer?.usersPath || '/etc/pgbouncer/userlist.txt'
            },
            
            // Database pools configuration
            pools: {
                main: {
                    host: config.pools?.main?.host || 'localhost',
                    port: config.pools?.main?.port || 5432,
                    database: config.pools?.main?.database || 'swappiq',
                    user: config.pools?.main?.user || 'swappiq_app',
                    password: config.pools?.main?.password || process.env.DB_PASSWORD,
                    
                    // Pool settings
                    max: config.pools?.main?.max || 20,
                    min: config.pools?.main?.min || 5,
                    idleTimeoutMillis: config.pools?.main?.idleTimeoutMillis || 30000,
                    connectionTimeoutMillis: config.pools?.main?.connectionTimeoutMillis || 10000,
                    
                    // Statement timeout
                    statement_timeout: config.pools?.main?.statement_timeout || 30000,
                    query_timeout: config.pools?.main?.query_timeout || 30000
                },
                
                read: {
                    host: config.pools?.read?.host || 'localhost',
                    port: config.pools?.read?.port || 5432,
                    database: config.pools?.read?.database || 'swappiq',
                    user: config.pools?.read?.user || 'swappiq_readonly',
                    password: config.pools?.read?.password || process.env.DB_READ_PASSWORD,
                    
                    max: config.pools?.read?.max || 30,
                    min: config.pools?.read?.min || 10,
                    idleTimeoutMillis: config.pools?.read?.idleTimeoutMillis || 60000,
                    connectionTimeoutMillis: config.pools?.read?.connectionTimeoutMillis || 10000
                },
                
                analytics: {
                    host: config.pools?.analytics?.host || 'localhost',
                    port: config.pools?.analytics?.port || 5432,
                    database: config.pools?.analytics?.database || 'swappiq',
                    user: config.pools?.analytics?.user || 'swappiq_analytics',
                    password: config.pools?.analytics?.password || process.env.DB_ANALYTICS_PASSWORD,
                    
                    max: config.pools?.analytics?.max || 10,
                    min: config.pools?.analytics?.min || 2,
                    idleTimeoutMillis: config.pools?.analytics?.idleTimeoutMillis || 120000,
                    connectionTimeoutMillis: config.pools?.analytics?.connectionTimeoutMillis || 30000
                }
            },
            
            // Connection strategies
            strategies: {
                loadBalancing: config.strategies?.loadBalancing || 'round-robin', // round-robin, least-connections, random
                failover: config.strategies?.failover !== false,
                retryAttempts: config.strategies?.retryAttempts || 3,
                retryDelay: config.strategies?.retryDelay || 1000,
                healthCheckInterval: config.strategies?.healthCheckInterval || 30000
            },
            
            // Monitoring configuration
            monitoring: {
                enabled: config.monitoring?.enabled !== false,
                metricsInterval: config.monitoring?.metricsInterval || 10000,
                slowQueryThreshold: config.monitoring?.slowQueryThreshold || 1000,
                connectionThreshold: config.monitoring?.connectionThreshold || 0.8,
                enablePrometheus: config.monitoring?.enablePrometheus || false
            },
            
            // Circuit breaker
            circuitBreaker: {
                enabled: config.circuitBreaker?.enabled !== false,
                threshold: config.circuitBreaker?.threshold || 0.5,
                timeout: config.circuitBreaker?.timeout || 30000,
                resetTimeout: config.circuitBreaker?.resetTimeout || 60000
            },
            
            // Query optimization
            queryOptimization: {
                preparedStatements: config.queryOptimization?.preparedStatements !== false,
                statementCache: config.queryOptimization?.statementCache !== false,
                cacheSize: config.queryOptimization?.cacheSize || 100,
                enableQueryLogging: config.queryOptimization?.enableQueryLogging || false
            },
            
            ...config
        };

        this.state = {
            pools: new Map(),
            prismaClients: new Map(),
            connections: new Map(),
            health: new Map(),
            metrics: {
                totalConnections: 0,
                activeConnections: 0,
                idleConnections: 0,
                totalQueries: 0,
                slowQueries: 0,
                errors: 0,
                averageQueryTime: 0
            },
            circuitBreakers: new Map(),
            currentReadIndex: 0
        };

        this.healthCheckTimer = null;
        this.metricsTimer = null;
    }

    /**
     * Initialize connection pool manager
     */
    async initialize() {
        try {
            // Check PgBouncer if enabled
            if (this.config.pgbouncer.enabled) {
                await this._checkPgBouncer();
            }

            // Initialize connection pools
            await this._initializePools();
            
            // Initialize Prisma clients
            await this._initializePrismaClients();
            
            // Start health checks
            await this._startHealthChecks();
            
            // Start monitoring
            if (this.config.monitoring.enabled) {
                await this._startMonitoring();
            }

            console.log('Connection Pool Manager initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Connection Pool Manager:', error);
            throw error;
        }
    }

    /**
     * Get connection pool for specific purpose
     */
    getPool(type = 'main') {
        const pool = this.state.pools.get(type);
        
        if (!pool) {
            throw new Error(`Pool type '${type}' not found`);
        }

        // Check circuit breaker
        if (this.config.circuitBreaker.enabled) {
            const breaker = this.state.circuitBreakers.get(type);
            if (breaker && breaker.state === 'open') {
                throw new Error(`Circuit breaker open for pool '${type}'`);
            }
        }

        return pool;
    }

    /**
     * Get Prisma client for specific purpose
     */
    getPrismaClient(type = 'main') {
        const client = this.state.prismaClients.get(type);
        
        if (!client) {
            throw new Error(`Prisma client type '${type}' not found`);
        }

        return client;
    }

    /**
     * Execute query with automatic pool selection
     */
    async query(sql, params = [], options = {}) {
        const startTime = Date.now();
        const poolType = options.write ? 'main' : this._selectReadPool();
        
        try {
            const pool = this.getPool(poolType);
            const client = await pool.connect();
            
            try {
                // Set query timeout
                if (options.timeout) {
                    await client.query(`SET statement_timeout = ${options.timeout}`);
                }

                // Execute query
                const result = await client.query(sql, params);
                
                // Update metrics
                this._updateQueryMetrics(Date.now() - startTime);
                
                return result;
                
            } finally {
                client.release();
            }
            
        } catch (error) {
            this.state.metrics.errors++;
            this._handlePoolError(poolType, error);
            
            // Retry logic
            if (options.retry !== false && this._shouldRetry(error)) {
                return await this._retryQuery(sql, params, options);
            }
            
            throw error;
        }
    }

    /**
     * Execute transaction
     */
    async transaction(callback, options = {}) {
        const pool = this.getPool('main');
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Set transaction isolation level if specified
            if (options.isolationLevel) {
                await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
            }
            
            const result = await callback(client);
            
            await client.query('COMMIT');
            return result;
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get pool statistics
     */
    async getPoolStats(poolType = null) {
        const stats = {};
        
        if (poolType) {
            const pool = this.state.pools.get(poolType);
            if (pool) {
                stats[poolType] = this._getPoolMetrics(pool);
            }
        } else {
            for (const [type, pool] of this.state.pools) {
                stats[type] = this._getPoolMetrics(pool);
            }
        }
        
        // Add PgBouncer stats if enabled
        if (this.config.pgbouncer.enabled) {
            stats.pgbouncer = await this._getPgBouncerStats();
        }
        
        return stats;
    }

    /**
     * Health check for all pools
     */
    async healthCheck() {
        const health = {
            overall: 'healthy',
            pools: {},
            pgbouncer: null,
            timestamp: new Date().toISOString()
        };
        
        // Check each pool
        for (const [type, pool] of this.state.pools) {
            try {
                const start = Date.now();
                await pool.query('SELECT 1');
                
                health.pools[type] = {
                    status: 'healthy',
                    responseTime: Date.now() - start,
                    connections: this._getPoolMetrics(pool)
                };
            } catch (error) {
                health.pools[type] = {
                    status: 'unhealthy',
                    error: error.message
                };
                health.overall = 'degraded';
            }
        }
        
        // Check PgBouncer
        if (this.config.pgbouncer.enabled) {
            health.pgbouncer = await this._checkPgBouncerHealth();
            if (health.pgbouncer.status !== 'healthy') {
                health.overall = 'degraded';
            }
        }
        
        this.emit('healthCheck', health);
        return health;
    }

    // ========== PRIVATE METHODS ==========

    async _initializePools() {
        for (const [type, config] of Object.entries(this.config.pools)) {
            // Use PgBouncer if enabled
            const connectionConfig = this.config.pgbouncer.enabled ? {
                ...config,
                host: this.config.pgbouncer.host,
                port: this.config.pgbouncer.port,
                database: `swappiq_${type}`
            } : config;

            const pool = new Pool({
                ...connectionConfig,
                
                // Connection lifecycle callbacks
                connect: (client) => {
                    this.state.metrics.totalConnections++;
                    this.state.metrics.activeConnections++;
                    this.emit('connectionCreated', { type, client });
                },
                
                remove: (client) => {
                    this.state.metrics.activeConnections--;
                    this.emit('connectionRemoved', { type, client });
                },
                
                // Error handling
                error: (error, client) => {
                    this._handlePoolError(type, error);
                }
            });

            // Test connection
            try {
                await pool.query('SELECT 1');
                this.state.pools.set(type, pool);
                this.state.health.set(type, { status: 'healthy', lastCheck: Date.now() });
                
                // Initialize circuit breaker
                if (this.config.circuitBreaker.enabled) {
                    this.state.circuitBreakers.set(type, {
                        state: 'closed',
                        failures: 0,
                        lastFailure: null,
                        nextCheck: null
                    });
                }
            } catch (error) {
                console.error(`Failed to initialize pool '${type}':`, error);
                throw error;
            }
        }
    }

    async _initializePrismaClients() {
        // Main write client
        const mainClient = new PrismaClient({
            datasources: {
                db: {
                    url: this._buildConnectionUrl('main')
                }
            },
            log: ['error', 'warn'],
            errorFormat: 'minimal'
        });
        
        await mainClient.$connect();
        this.state.prismaClients.set('main', mainClient);

        // Read replica client
        if (this.config.pools.read) {
            const readClient = new PrismaClient({
                datasources: {
                    db: {
                        url: this._buildConnectionUrl('read')
                    }
                },
                log: ['error'],
                errorFormat: 'minimal'
            });
            
            await readClient.$connect();
            this.state.prismaClients.set('read', readClient);
        }
    }

    _buildConnectionUrl(type) {
        const config = this.config.pgbouncer.enabled ? {
            host: this.config.pgbouncer.host,
            port: this.config.pgbouncer.port,
            database: `swappiq_${type}`,
            user: this.config.pools[type].user,
            password: this.config.pools[type].password
        } : this.config.pools[type];

        return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}?schema=public`;
    }

    async _checkPgBouncer() {
        return new Promise((resolve, reject) => {
            const socket = new net.Socket();
            
            socket.setTimeout(5000);
            
            socket.on('connect', () => {
                socket.end();
                resolve(true);
            });
            
            socket.on('timeout', () => {
                socket.destroy();
                reject(new Error('PgBouncer connection timeout'));
            });
            
            socket.on('error', (error) => {
                reject(error);
            });
            
            socket.connect(this.config.pgbouncer.port, this.config.pgbouncer.host);
        });
    }

    async _checkPgBouncerHealth() {
        try {
            // Connect to PgBouncer admin
            const adminPool = new Pool({
                host: this.config.pgbouncer.host,
                port: this.config.pgbouncer.port,
                database: 'pgbouncer',
                user: 'pgbouncer_admin',
                password: process.env.PGBOUNCER_ADMIN_PASSWORD
            });

            const result = await adminPool.query('SHOW STATS');
            await adminPool.end();

            return {
                status: 'healthy',
                stats: result.rows
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async _getPgBouncerStats() {
        try {
            const adminPool = new Pool({
                host: this.config.pgbouncer.host,
                port: this.config.pgbouncer.port,
                database: 'pgbouncer',
                user: 'pgbouncer_monitor',
                password: process.env.PGBOUNCER_MONITOR_PASSWORD
            });

            const [databases, pools, clients, servers] = await Promise.all([
                adminPool.query('SHOW DATABASES'),
                adminPool.query('SHOW POOLS'),
                adminPool.query('SHOW CLIENTS'),
                adminPool.query('SHOW SERVERS')
            ]);

            await adminPool.end();

            return {
                databases: databases.rows,
                pools: pools.rows,
                clients: clients.rows.length,
                servers: servers.rows.length
            };
        } catch (error) {
            return null;
        }
    }

    async _startHealthChecks() {
        this.healthCheckTimer = setInterval(async () => {
            for (const [type, pool] of this.state.pools) {
                try {
                    const start = Date.now();
                    await pool.query('SELECT 1');
                    
                    this.state.health.set(type, {
                        status: 'healthy',
                        lastCheck: Date.now(),
                        responseTime: Date.now() - start
                    });
                    
                    // Reset circuit breaker if healthy
                    if (this.config.circuitBreaker.enabled) {
                        const breaker = this.state.circuitBreakers.get(type);
                        if (breaker && breaker.state === 'open' && Date.now() > breaker.nextCheck) {
                            breaker.state = 'half-open';
                        }
                    }
                } catch (error) {
                    this.state.health.set(type, {
                        status: 'unhealthy',
                        lastCheck: Date.now(),
                        error: error.message
                    });
                }
            }
        }, this.config.strategies.healthCheckInterval);
    }

    async _startMonitoring() {
        this.metricsTimer = setInterval(async () => {
            const metrics = {
                timestamp: new Date().toISOString(),
                pools: {},
                global: this.state.metrics
            };
            
            for (const [type, pool] of this.state.pools) {
                metrics.pools[type] = this._getPoolMetrics(pool);
            }
            
            this.emit('metrics', metrics);
            
            // Check thresholds
            for (const [type, poolMetrics] of Object.entries(metrics.pools)) {
                const utilizationRate = poolMetrics.active / poolMetrics.size;
                
                if (utilizationRate > this.config.monitoring.connectionThreshold) {
                    this.emit('poolWarning', {
                        type,
                        utilization: utilizationRate,
                        message: 'Connection pool utilization high'
                    });
                }
            }
        }, this.config.monitoring.metricsInterval);
    }

    _getPoolMetrics(pool) {
        return {
            size: pool.totalCount,
            active: pool.totalCount - pool.idleCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount
        };
    }

    _selectReadPool() {
        // Load balancing strategy
        switch (this.config.strategies.loadBalancing) {
            case 'round-robin':
                // Simple round-robin between main and read pools
                const pools = ['main'];
                if (this.state.pools.has('read')) {
                    pools.push('read');
                }
                const selected = pools[this.state.currentReadIndex % pools.length];
                this.state.currentReadIndex++;
                return selected;
                
            case 'least-connections':
                // Select pool with least active connections
                let leastPool = 'main';
                let leastConnections = Infinity;
                
                for (const [type, pool] of this.state.pools) {
                    if (type === 'analytics') continue;
                    const metrics = this._getPoolMetrics(pool);
                    if (metrics.active < leastConnections) {
                        leastConnections = metrics.active;
                        leastPool = type;
                    }
                }
                return leastPool;
                
            case 'random':
            default:
                const availablePools = ['main'];
                if (this.state.pools.has('read')) {
                    availablePools.push('read');
                }
                return availablePools[Math.floor(Math.random() * availablePools.length)];
        }
    }

    _handlePoolError(poolType, error) {
        console.error(`Pool '${poolType}' error:`, error);
        
        // Update circuit breaker
        if (this.config.circuitBreaker.enabled) {
            const breaker = this.state.circuitBreakers.get(poolType);
            if (breaker) {
                breaker.failures++;
                breaker.lastFailure = Date.now();
                
                const failureRate = breaker.failures / this.config.circuitBreaker.threshold;
                
                if (failureRate >= 1 && breaker.state !== 'open') {
                    breaker.state = 'open';
                    breaker.nextCheck = Date.now() + this.config.circuitBreaker.resetTimeout;
                    
                    this.emit('circuitBreakerOpen', {
                        pool: poolType,
                        failures: breaker.failures
                    });
                }
            }
        }
    }

    _shouldRetry(error) {
        // Retry on connection errors
        const retryableErrors = [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'Connection terminated'
        ];
        
        return retryableErrors.some(msg => error.message.includes(msg));
    }

    async _retryQuery(sql, params, options, attempt = 1) {
        if (attempt > this.config.strategies.retryAttempts) {
            throw new Error('Max retry attempts exceeded');
        }
        
        await new Promise(resolve => setTimeout(resolve, this.config.strategies.retryDelay * attempt));
        
        return await this.query(sql, params, { ...options, retry: false });
    }

    _updateQueryMetrics(duration) {
        this.state.metrics.totalQueries++;
        this.state.metrics.averageQueryTime = 
            (this.state.metrics.averageQueryTime * (this.state.metrics.totalQueries - 1) + duration) / 
            this.state.metrics.totalQueries;
        
        if (duration > this.config.monitoring.slowQueryThreshold) {
            this.state.metrics.slowQueries++;
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Clear timers
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
        }

        // Close all pools
        for (const [type, pool] of this.state.pools) {
            await pool.end();
        }

        // Disconnect Prisma clients
        for (const [type, client] of this.state.prismaClients) {
            await client.$disconnect();
        }

        console.log('Connection Pool Manager cleaned up');
    }
}

module.exports = { ConnectionPoolManager };