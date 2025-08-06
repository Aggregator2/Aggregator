/**
 * @fileoverview Database Load Testing Framework
 * @author SwappiQ Protocol
 * @description Comprehensive load testing for database operations
 */

const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const EventEmitter = require('events');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const pLimit = require('p-limit');
const Redis = require('ioredis');

/**
 * Database Load Testing Framework
 */
class DatabaseLoadTestFramework extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Database configuration
            database: {
                host: config.database?.host || 'localhost',
                port: config.database?.port || 5432,
                database: config.database?.database || 'swappiq_test',
                user: config.database?.user || 'swappiq_test',
                password: config.database?.password || process.env.TEST_DB_PASSWORD,
                
                // Pool settings for load testing
                max: config.database?.max || 100,
                min: config.database?.min || 20,
                idleTimeoutMillis: config.database?.idleTimeoutMillis || 30000,
                connectionTimeoutMillis: config.database?.connectionTimeoutMillis || 10000
            },
            
            // Load test configuration
            loadTest: {
                warmupDuration: config.loadTest?.warmupDuration || 10000, // 10 seconds
                testDuration: config.loadTest?.testDuration || 60000, // 60 seconds
                cooldownDuration: config.loadTest?.cooldownDuration || 10000, // 10 seconds
                
                // Target rates
                orderPlacementRate: config.loadTest?.orderPlacementRate || 10000, // per second
                orderMatchingRate: config.loadTest?.orderMatchingRate || 5000, // per second
                settlementRate: config.loadTest?.settlementRate || 1000, // per second
                queryRate: config.loadTest?.queryRate || 20000, // per second
                
                // Concurrency limits
                maxConcurrentOrders: config.loadTest?.maxConcurrentOrders || 1000,
                maxConcurrentQueries: config.loadTest?.maxConcurrentQueries || 2000,
                maxConcurrentSettlements: config.loadTest?.maxConcurrentSettlements || 100
            },
            
            // Test scenarios
            scenarios: {
                orderPlacement: config.scenarios?.orderPlacement !== false,
                orderMatching: config.scenarios?.orderMatching !== false,
                settlementProcessing: config.scenarios?.settlementProcessing !== false,
                queryPerformance: config.scenarios?.queryPerformance !== false,
                connectionExhaustion: config.scenarios?.connectionExhaustion !== false,
                mixedWorkload: config.scenarios?.mixedWorkload !== false
            },
            
            // Monitoring configuration
            monitoring: {
                metricsInterval: config.monitoring?.metricsInterval || 1000, // 1 second
                detailedMetrics: config.monitoring?.detailedMetrics !== false,
                realTimeUpdates: config.monitoring?.realTimeUpdates !== false,
                saveResults: config.monitoring?.saveResults !== false,
                resultsPath: config.monitoring?.resultsPath || './test-results'
            },
            
            // Performance thresholds
            thresholds: {
                maxLatency: config.thresholds?.maxLatency || 100, // ms
                p95Latency: config.thresholds?.p95Latency || 50, // ms
                p99Latency: config.thresholds?.p99Latency || 80, // ms
                errorRate: config.thresholds?.errorRate || 0.01, // 1%
                minThroughput: config.thresholds?.minThroughput || 8000 // ops/sec
            },
            
            // Test data generation
            testData: {
                userCount: config.testData?.userCount || 10000,
                assetCount: config.testData?.assetCount || 50,
                pairCount: config.testData?.pairCount || 100,
                priceVariation: config.testData?.priceVariation || 0.1, // 10%
                orderSizeVariation: config.testData?.orderSizeVariation || 0.5 // 50%
            },
            
            verbose: config.verbose || false,
            ...config
        };

        // Initialize components
        this.pool = null;
        this.prisma = null;
        this.redis = null;
        
        // Test state
        this.state = {
            testRunning: false,
            currentPhase: 'IDLE',
            startTime: null,
            endTime: null,
            
            // Test data
            users: [],
            tradingPairs: [],
            activeOrders: new Map(),
            
            // Metrics
            metrics: {
                operations: new Map(),
                latencies: new Map(),
                errors: new Map(),
                throughput: new Map(),
                connectionPool: {
                    active: 0,
                    idle: 0,
                    waiting: 0,
                    total: 0
                }
            },
            
            // Results
            results: {
                summary: {},
                details: [],
                bottlenecks: [],
                recommendations: []
            }
        };

        // Timers
        this.metricsTimer = null;
        this.loadGenerators = new Map();
    }

    /**
     * Initialize the load testing framework
     */
    async initialize() {
        try {
            // Initialize database pool
            this.pool = new Pool(this.config.database);
            
            // Test connection
            await this.pool.query('SELECT 1');
            
            // Initialize Prisma
            this.prisma = new PrismaClient({
                datasources: {
                    db: {
                        url: this._buildConnectionUrl()
                    }
                },
                log: this.config.verbose ? ['query', 'info', 'warn', 'error'] : ['error']
            });
            
            await this.prisma.$connect();
            
            // Initialize Redis for distributed coordination
            this.redis = new Redis({
                host: this.config.redis?.host || 'localhost',
                port: this.config.redis?.port || 6379,
                keyPrefix: 'loadtest:'
            });

            // Generate test data
            await this._generateTestData();
            
            console.log('Database Load Test Framework initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Load Test Framework:', error);
            throw error;
        }
    }

    /**
     * Run complete load test suite
     */
    async runLoadTest(scenarios = null) {
        if (this.state.testRunning) {
            throw new Error('Test already running');
        }

        this.state.testRunning = true;
        this.state.startTime = Date.now();
        
        const testScenarios = scenarios || Object.keys(this.config.scenarios)
            .filter(s => this.config.scenarios[s]);

        console.log(`Starting load test with scenarios: ${testScenarios.join(', ')}`);
        
        try {
            // Start metrics collection
            this._startMetricsCollection();
            
            // Warmup phase
            await this._runPhase('WARMUP', this.config.loadTest.warmupDuration, async () => {
                await this._runWarmup();
            });
            
            // Main test phase
            await this._runPhase('TEST', this.config.loadTest.testDuration, async () => {
                const scenarioPromises = [];
                
                for (const scenario of testScenarios) {
                    switch (scenario) {
                        case 'orderPlacement':
                            scenarioPromises.push(this._runOrderPlacementTest());
                            break;
                        
                        case 'orderMatching':
                            scenarioPromises.push(this._runOrderMatchingTest());
                            break;
                        
                        case 'settlementProcessing':
                            scenarioPromises.push(this._runSettlementTest());
                            break;
                        
                        case 'queryPerformance':
                            scenarioPromises.push(this._runQueryPerformanceTest());
                            break;
                        
                        case 'connectionExhaustion':
                            scenarioPromises.push(this._runConnectionExhaustionTest());
                            break;
                        
                        case 'mixedWorkload':
                            scenarioPromises.push(this._runMixedWorkloadTest());
                            break;
                    }
                }
                
                await Promise.all(scenarioPromises);
            });
            
            // Cooldown phase
            await this._runPhase('COOLDOWN', this.config.loadTest.cooldownDuration, async () => {
                await this._runCooldown();
            });
            
            // Analyze results
            this.state.results = await this._analyzeResults();
            
            // Save results if configured
            if (this.config.monitoring.saveResults) {
                await this._saveResults();
            }
            
            return this.state.results;
            
        } finally {
            this.state.testRunning = false;
            this.state.endTime = Date.now();
            this._stopMetricsCollection();
            
            // Stop all load generators
            for (const [name, generator] of this.loadGenerators) {
                if (generator.stop) generator.stop();
            }
            this.loadGenerators.clear();
        }
    }

    // ========== TEST SCENARIOS ==========

    async _runOrderPlacementTest() {
        console.log('Running order placement test...');
        
        const targetRate = this.config.loadTest.orderPlacementRate;
        const limit = pLimit(this.config.loadTest.maxConcurrentOrders);
        
        const generator = this._createLoadGenerator('orderPlacement', targetRate, async () => {
            const user = this._getRandomUser();
            const pair = this._getRandomPair();
            const orderData = this._generateOrderData(user, pair);
            
            return limit(() => this._measureOperation('orderPlacement', async () => {
                const order = await this.prisma.order.create({
                    data: orderData
                });
                
                this.state.activeOrders.set(order.id, order);
                return order;
            }));
        });
        
        this.loadGenerators.set('orderPlacement', generator);
        await generator.start();
    }

    async _runOrderMatchingTest() {
        console.log('Running order matching test...');
        
        const targetRate = this.config.loadTest.orderMatchingRate;
        const limit = pLimit(Math.floor(this.config.loadTest.maxConcurrentOrders / 2));
        
        // Ensure we have orders to match
        await this._ensureOrdersExist();
        
        const generator = this._createLoadGenerator('orderMatching', targetRate, async () => {
            return limit(() => this._measureOperation('orderMatching', async () => {
                // Get matchable orders
                const result = await this.pool.query(`
                    WITH best_bid AS (
                        SELECT * FROM "Order"
                        WHERE status = 'NEW' AND side = 'BUY'
                        ORDER BY price DESC, "createdAt" ASC
                        LIMIT 1
                    ),
                    best_ask AS (
                        SELECT * FROM "Order"
                        WHERE status = 'NEW' AND side = 'SELL'
                        ORDER BY price ASC, "createdAt" ASC
                        LIMIT 1
                    )
                    SELECT 
                        bb.id as buy_id, bb.price as buy_price,
                        ba.id as sell_id, ba.price as sell_price
                    FROM best_bid bb, best_ask ba
                    WHERE bb.price >= ba.price
                    LIMIT 1
                `);
                
                if (result.rows.length === 0) {
                    return null; // No match possible
                }
                
                const match = result.rows[0];
                
                // Execute match in transaction
                await this.prisma.$transaction(async (tx) => {
                    // Update orders
                    await tx.order.update({
                        where: { id: match.buy_id },
                        data: { status: 'FILLED' }
                    });
                    
                    await tx.order.update({
                        where: { id: match.sell_id },
                        data: { status: 'FILLED' }
                    });
                    
                    // Create trade
                    await tx.trade.create({
                        data: {
                            id: crypto.randomUUID(),
                            buyOrderId: match.buy_id,
                            sellOrderId: match.sell_id,
                            price: match.sell_price,
                            quantity: 1, // Simplified
                            quoteQuantity: match.sell_price,
                            buyerId: 'test-buyer',
                            sellerId: 'test-seller',
                            buyerCommission: 0.001,
                            sellerCommission: 0.001,
                            isMaker: false,
                            pairId: this.state.tradingPairs[0].id
                        }
                    });
                });
                
                return match;
            }));
        });
        
        this.loadGenerators.set('orderMatching', generator);
        await generator.start();
    }

    async _runSettlementTest() {
        console.log('Running settlement processing test...');
        
        const targetRate = this.config.loadTest.settlementRate;
        const limit = pLimit(this.config.loadTest.maxConcurrentSettlements);
        
        const generator = this._createLoadGenerator('settlement', targetRate, async () => {
            return limit(() => this._measureOperation('settlement', async () => {
                // Simulate settlement processing
                const trades = await this.prisma.trade.findMany({
                    where: {
                        executedAt: {
                            gte: new Date(Date.now() - 60000) // Last minute
                        }
                    },
                    take: 10
                });
                
                if (trades.length === 0) {
                    return null;
                }
                
                // Process settlements in transaction
                await this.prisma.$transaction(async (tx) => {
                    for (const trade of trades) {
                        // Update balances
                        await tx.$executeRaw`
                            UPDATE "Balance" 
                            SET available = available + ${trade.quantity}
                            WHERE "userId" = ${trade.buyerId} 
                            AND asset = 'ETH'
                        `;
                        
                        await tx.$executeRaw`
                            UPDATE "Balance" 
                            SET available = available + ${trade.quoteQuantity}
                            WHERE "userId" = ${trade.sellerId} 
                            AND asset = 'USDT'
                        `;
                    }
                }, {
                    isolationLevel: 'ReadCommitted',
                    timeout: 30000
                });
                
                return trades.length;
            }));
        });
        
        this.loadGenerators.set('settlement', generator);
        await generator.start();
    }

    async _runQueryPerformanceTest() {
        console.log('Running query performance test...');
        
        const targetRate = this.config.loadTest.queryRate;
        const limit = pLimit(this.config.loadTest.maxConcurrentQueries);
        
        const queries = [
            // Order book depth query
            {
                name: 'orderBookDepth',
                execute: async () => {
                    const pairId = this._getRandomPair().id;
                    return await this.pool.query(`
                        WITH depth AS (
                            SELECT side, price, SUM("remainingQuantity") as total
                            FROM "Order"
                            WHERE "pairId" = $1 AND status IN ('NEW', 'PARTIALLY_FILLED')
                            GROUP BY side, price
                            ORDER BY 
                                CASE WHEN side = 'BUY' THEN price END DESC,
                                CASE WHEN side = 'SELL' THEN price END ASC
                            LIMIT 20
                        )
                        SELECT * FROM depth
                    `, [pairId]);
                }
            },
            // User order history
            {
                name: 'userOrderHistory',
                execute: async () => {
                    const userId = this._getRandomUser().id;
                    return await this.pool.query(`
                        SELECT o.*, tp.symbol
                        FROM "Order" o
                        JOIN "TradingPair" tp ON o."pairId" = tp.id
                        WHERE o."userId" = $1
                        ORDER BY o."createdAt" DESC
                        LIMIT 50
                    `, [userId]);
                }
            },
            // 24h trading statistics
            {
                name: 'tradingStats24h',
                execute: async () => {
                    const pairId = this._getRandomPair().id;
                    return await this.pool.query(`
                        SELECT 
                            COUNT(*) as trade_count,
                            SUM(quantity) as volume,
                            MAX(price) as high,
                            MIN(price) as low,
                            AVG(price) as avg_price
                        FROM "Trade"
                        WHERE "pairId" = $1 
                        AND "executedAt" >= NOW() - INTERVAL '24 hours'
                    `, [pairId]);
                }
            },
            // Balance aggregation
            {
                name: 'balanceAggregation',
                execute: async () => {
                    return await this.pool.query(`
                        SELECT 
                            asset,
                            COUNT(DISTINCT "userId") as holders,
                            SUM(total) as total_supply,
                            AVG(total) as avg_balance
                        FROM "Balance"
                        WHERE total > 0
                        GROUP BY asset
                        ORDER BY total_supply DESC
                    `);
                }
            }
        ];
        
        const generator = this._createLoadGenerator('queries', targetRate, async () => {
            const query = queries[Math.floor(Math.random() * queries.length)];
            
            return limit(() => this._measureOperation(`query_${query.name}`, async () => {
                return await query.execute();
            }));
        });
        
        this.loadGenerators.set('queries', generator);
        await generator.start();
    }

    async _runConnectionExhaustionTest() {
        console.log('Running connection exhaustion test...');
        
        const connections = [];
        const targetConnections = this.config.database.max * 2; // Try to exceed pool
        
        try {
            // Create many connections rapidly
            for (let i = 0; i < targetConnections; i++) {
                connections.push(
                    this._measureOperation('connectionAcquisition', async () => {
                        const client = await this.pool.connect();
                        
                        // Hold connection for random time
                        setTimeout(() => {
                            client.release();
                        }, Math.random() * 5000 + 1000);
                        
                        return client;
                    })
                );
                
                // Small delay between connection attempts
                if (i % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
            // Wait for all connection attempts
            const results = await Promise.allSettled(connections);
            
            // Analyze connection failures
            const failures = results.filter(r => r.status === 'rejected').length;
            const successRate = (targetConnections - failures) / targetConnections;
            
            this._recordMetric('connectionExhaustion', {
                attempted: targetConnections,
                successful: targetConnections - failures,
                failed: failures,
                successRate
            });
            
        } catch (error) {
            console.error('Connection exhaustion test error:', error);
        }
    }

    async _runMixedWorkloadTest() {
        console.log('Running mixed workload test...');
        
        // Run all tests concurrently at reduced rates
        const scenarios = [
            { name: 'orderPlacement', rate: this.config.loadTest.orderPlacementRate * 0.3 },
            { name: 'orderMatching', rate: this.config.loadTest.orderMatchingRate * 0.3 },
            { name: 'settlement', rate: this.config.loadTest.settlementRate * 0.3 },
            { name: 'queries', rate: this.config.loadTest.queryRate * 0.3 }
        ];
        
        const promises = scenarios.map(scenario => {
            switch (scenario.name) {
                case 'orderPlacement':
                    return this._runOrderPlacementTest();
                case 'orderMatching':
                    return this._runOrderMatchingTest();
                case 'settlement':
                    return this._runSettlementTest();
                case 'queries':
                    return this._runQueryPerformanceTest();
            }
        });
        
        await Promise.all(promises);
    }

    // ========== LOAD GENERATION ==========

    _createLoadGenerator(name, targetRate, operation) {
        let running = false;
        let operationCount = 0;
        let intervalId = null;
        
        const generator = {
            start: async () => {
                running = true;
                const interval = 1000 / targetRate; // ms between operations
                const batchSize = Math.max(1, Math.floor(targetRate / 100)); // Operations per batch
                
                const executeBatch = async () => {
                    if (!running) return;
                    
                    const promises = [];
                    for (let i = 0; i < batchSize && running; i++) {
                        promises.push(operation().catch(error => {
                            this._recordError(name, error);
                        }));
                    }
                    
                    await Promise.all(promises);
                    operationCount += promises.length;
                };
                
                // Start continuous execution
                intervalId = setInterval(executeBatch, interval * batchSize);
                
                // Initial execution
                await executeBatch();
            },
            
            stop: () => {
                running = false;
                if (intervalId) {
                    clearInterval(intervalId);
                    intervalId = null;
                }
            },
            
            getCount: () => operationCount
        };
        
        return generator;
    }

    async _measureOperation(name, operation) {
        const startTime = performance.now();
        let success = false;
        
        try {
            const result = await operation();
            success = true;
            return result;
        } catch (error) {
            this._recordError(name, error);
            throw error;
        } finally {
            const duration = performance.now() - startTime;
            this._recordLatency(name, duration, success);
        }
    }

    // ========== TEST DATA GENERATION ==========

    async _generateTestData() {
        console.log('Generating test data...');
        
        try {
            // Clear existing test data
            await this._clearTestData();
            
            // Generate users
            const users = [];
            for (let i = 0; i < this.config.testData.userCount; i++) {
                users.push({
                    id: crypto.randomUUID(),
                    walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
                    status: 'ACTIVE',
                    tradingTier: Math.floor(Math.random() * 5) + 1,
                    dailyVolumeLimit: 1000000
                });
            }
            
            await this.prisma.user.createMany({ data: users });
            this.state.users = users;
            
            // Generate trading pairs
            const pairs = [];
            const baseAssets = ['ETH', 'BTC', 'SOL', 'AVAX', 'MATIC'];
            const quoteAssets = ['USDT', 'USDC', 'DAI'];
            
            for (const base of baseAssets) {
                for (const quote of quoteAssets) {
                    pairs.push({
                        id: crypto.randomUUID(),
                        symbol: `${base}/${quote}`,
                        baseAsset: base,
                        quoteAsset: quote,
                        status: 'ACTIVE',
                        tickSize: 0.01,
                        stepSize: 0.0001,
                        minOrderValue: 10,
                        maxOrderValue: 100000,
                        makerFee: 0.001,
                        takerFee: 0.002
                    });
                }
            }
            
            await this.prisma.tradingPair.createMany({ data: pairs });
            this.state.tradingPairs = pairs;
            
            // Generate initial balances
            const balances = [];
            for (const user of users.slice(0, 1000)) { // First 1000 users
                for (const asset of ['ETH', 'USDT', 'USDC']) {
                    balances.push({
                        id: crypto.randomUUID(),
                        userId: user.id,
                        asset,
                        available: Math.random() * 1000,
                        locked: 0,
                        total: Math.random() * 1000
                    });
                }
            }
            
            await this.prisma.balance.createMany({ data: balances });
            
            console.log(`Generated ${users.length} users, ${pairs.length} pairs, ${balances.length} balances`);
            
        } catch (error) {
            console.error('Failed to generate test data:', error);
            throw error;
        }
    }

    async _clearTestData() {
        await this.prisma.$transaction([
            this.prisma.trade.deleteMany(),
            this.prisma.order.deleteMany(),
            this.prisma.balance.deleteMany(),
            this.prisma.tradingPair.deleteMany(),
            this.prisma.user.deleteMany()
        ]);
    }

    _generateOrderData(user, pair) {
        const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
        const basePrice = 1500; // Base price for ETH/USDT
        const priceVariation = this.config.testData.priceVariation;
        const price = basePrice * (1 + (Math.random() - 0.5) * priceVariation);
        const quantity = Math.random() * 10 * (1 + (Math.random() - 0.5) * this.config.testData.orderSizeVariation);
        
        return {
            id: crypto.randomUUID(),
            userId: user.id,
            pairId: pair.id,
            clientOrderId: crypto.randomUUID(),
            side,
            type: 'LIMIT',
            status: 'NEW',
            price: Math.round(price * 100) / 100,
            quantity: Math.round(quantity * 10000) / 10000,
            filledQuantity: 0,
            remainingQuantity: Math.round(quantity * 10000) / 10000,
            timeInForce: 'GTC',
            source: 'API'
        };
    }

    async _ensureOrdersExist() {
        const orderCount = await this.prisma.order.count({
            where: { status: 'NEW' }
        });
        
        if (orderCount < 1000) {
            // Generate more orders
            const orders = [];
            for (let i = 0; i < 1000; i++) {
                const user = this._getRandomUser();
                const pair = this._getRandomPair();
                orders.push(this._generateOrderData(user, pair));
            }
            
            await this.prisma.order.createMany({ data: orders });
        }
    }

    _getRandomUser() {
        return this.state.users[Math.floor(Math.random() * this.state.users.length)];
    }

    _getRandomPair() {
        return this.state.tradingPairs[Math.floor(Math.random() * this.state.tradingPairs.length)];
    }

    // ========== METRICS COLLECTION ==========

    _startMetricsCollection() {
        this.metricsTimer = setInterval(async () => {
            await this._collectMetrics();
        }, this.config.monitoring.metricsInterval);
    }

    _stopMetricsCollection() {
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = null;
        }
    }

    async _collectMetrics() {
        try {
            // Connection pool metrics
            const poolStats = this.pool;
            this.state.metrics.connectionPool = {
                total: poolStats.totalCount,
                idle: poolStats.idleCount,
                waiting: poolStats.waitingCount,
                active: poolStats.totalCount - poolStats.idleCount
            };
            
            // Database metrics
            const dbMetrics = await this.pool.query(`
                SELECT 
                    state,
                    COUNT(*) as count
                FROM pg_stat_activity
                WHERE datname = $1
                GROUP BY state
            `, [this.config.database.database]);
            
            // Query performance
            const slowQueries = await this.pool.query(`
                SELECT 
                    query,
                    calls,
                    mean_exec_time,
                    max_exec_time
                FROM pg_stat_statements
                WHERE mean_exec_time > $1
                ORDER BY mean_exec_time DESC
                LIMIT 10
            `, [this.config.thresholds.maxLatency]);
            
            // Emit real-time updates
            if (this.config.monitoring.realTimeUpdates) {
                this.emit('metrics', {
                    timestamp: Date.now(),
                    phase: this.state.currentPhase,
                    connectionPool: this.state.metrics.connectionPool,
                    databaseConnections: dbMetrics.rows,
                    slowQueries: slowQueries.rows
                });
            }
            
        } catch (error) {
            console.error('Failed to collect metrics:', error);
        }
    }

    _recordLatency(operation, duration, success) {
        if (!this.state.metrics.latencies.has(operation)) {
            this.state.metrics.latencies.set(operation, []);
        }
        
        this.state.metrics.latencies.get(operation).push({
            duration,
            success,
            timestamp: Date.now()
        });
        
        // Update operation count
        const ops = this.state.metrics.operations.get(operation) || { success: 0, failure: 0 };
        if (success) {
            ops.success++;
        } else {
            ops.failure++;
        }
        this.state.metrics.operations.set(operation, ops);
        
        // Update throughput
        this._updateThroughput(operation);
    }

    _recordError(operation, error) {
        if (!this.state.metrics.errors.has(operation)) {
            this.state.metrics.errors.set(operation, []);
        }
        
        this.state.metrics.errors.get(operation).push({
            error: error.message,
            code: error.code,
            timestamp: Date.now()
        });
    }

    _recordMetric(name, value) {
        if (!this.state.metrics.operations.has(name)) {
            this.state.metrics.operations.set(name, {});
        }
        
        Object.assign(this.state.metrics.operations.get(name), value);
    }

    _updateThroughput(operation) {
        const window = 10000; // 10 second window
        const now = Date.now();
        const latencies = this.state.metrics.latencies.get(operation) || [];
        
        const recentOps = latencies.filter(l => now - l.timestamp <= window);
        const throughput = (recentOps.length / window) * 1000; // ops per second
        
        this.state.metrics.throughput.set(operation, throughput);
    }

    // ========== PHASES ==========

    async _runPhase(phaseName, duration, phaseFunction) {
        console.log(`Starting ${phaseName} phase (${duration / 1000}s)...`);
        this.state.currentPhase = phaseName;
        
        const phaseStart = Date.now();
        const phasePromise = phaseFunction();
        
        // Wait for phase duration
        await new Promise(resolve => setTimeout(resolve, duration));
        
        // Stop phase activities
        this.state.currentPhase = 'IDLE';
        
        // Wait for any remaining operations
        await phasePromise;
        
        console.log(`${phaseName} phase completed`);
    }

    async _runWarmup() {
        // Generate initial load to warm up connections and caches
        const warmupOps = [];
        
        for (let i = 0; i < 100; i++) {
            warmupOps.push(
                this.pool.query('SELECT 1'),
                this.prisma.user.count(),
                this.prisma.order.findFirst()
            );
        }
        
        await Promise.all(warmupOps);
    }

    async _runCooldown() {
        // Allow system to stabilize
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Collect final metrics
        await this._collectMetrics();
    }

    // ========== ANALYSIS ==========

    async _analyzeResults() {
        const results = {
            summary: {},
            details: {},
            bottlenecks: [],
            recommendations: []
        };
        
        // Calculate summary statistics
        for (const [operation, latencies] of this.state.metrics.latencies) {
            const durations = latencies.map(l => l.duration);
            const successful = latencies.filter(l => l.success);
            
            results.details[operation] = {
                count: latencies.length,
                successCount: successful.length,
                errorCount: latencies.length - successful.length,
                errorRate: (latencies.length - successful.length) / latencies.length,
                minLatency: Math.min(...durations),
                maxLatency: Math.max(...durations),
                avgLatency: durations.reduce((a, b) => a + b, 0) / durations.length,
                p50Latency: this._percentile(durations, 0.5),
                p95Latency: this._percentile(durations, 0.95),
                p99Latency: this._percentile(durations, 0.99),
                throughput: this.state.metrics.throughput.get(operation) || 0
            };
        }
        
        // Overall summary
        const allLatencies = Array.from(this.state.metrics.latencies.values()).flat();
        const allDurations = allLatencies.map(l => l.duration);
        const totalOps = allLatencies.length;
        const successfulOps = allLatencies.filter(l => l.success).length;
        
        results.summary = {
            totalDuration: this.state.endTime - this.state.startTime,
            totalOperations: totalOps,
            successfulOperations: successfulOps,
            failedOperations: totalOps - successfulOps,
            overallErrorRate: (totalOps - successfulOps) / totalOps,
            avgThroughput: totalOps / ((this.state.endTime - this.state.startTime) / 1000),
            avgLatency: allDurations.reduce((a, b) => a + b, 0) / allDurations.length,
            p95Latency: this._percentile(allDurations, 0.95),
            p99Latency: this._percentile(allDurations, 0.99),
            maxConnectionsUsed: Math.max(...Array.from(this.state.metrics.connectionPool.active || []))
        };
        
        // Identify bottlenecks
        results.bottlenecks = await this._identifyBottlenecks(results.details);
        
        // Generate recommendations
        results.recommendations = this._generateRecommendations(results);
        
        return results;
    }

    async _identifyBottlenecks(details) {
        const bottlenecks = [];
        
        // Check for high latency operations
        for (const [operation, stats] of Object.entries(details)) {
            if (stats.p95Latency > this.config.thresholds.p95Latency) {
                bottlenecks.push({
                    type: 'HIGH_LATENCY',
                    operation,
                    severity: 'HIGH',
                    details: {
                        p95Latency: stats.p95Latency,
                        threshold: this.config.thresholds.p95Latency
                    }
                });
            }
            
            if (stats.errorRate > this.config.thresholds.errorRate) {
                bottlenecks.push({
                    type: 'HIGH_ERROR_RATE',
                    operation,
                    severity: 'CRITICAL',
                    details: {
                        errorRate: stats.errorRate,
                        threshold: this.config.thresholds.errorRate
                    }
                });
            }
            
            if (stats.throughput < this.config.thresholds.minThroughput) {
                bottlenecks.push({
                    type: 'LOW_THROUGHPUT',
                    operation,
                    severity: 'MEDIUM',
                    details: {
                        throughput: stats.throughput,
                        threshold: this.config.thresholds.minThroughput
                    }
                });
            }
        }
        
        // Check for connection pool exhaustion
        if (this.state.metrics.connectionPool.waiting > 0) {
            bottlenecks.push({
                type: 'CONNECTION_POOL_EXHAUSTION',
                severity: 'HIGH',
                details: {
                    maxActive: this.state.metrics.connectionPool.active,
                    waiting: this.state.metrics.connectionPool.waiting
                }
            });
        }
        
        // Check for slow queries
        const slowQueries = await this.pool.query(`
            SELECT query, calls, mean_exec_time
            FROM pg_stat_statements
            WHERE mean_exec_time > $1
            ORDER BY mean_exec_time DESC
            LIMIT 5
        `, [this.config.thresholds.maxLatency]);
        
        if (slowQueries.rows.length > 0) {
            bottlenecks.push({
                type: 'SLOW_QUERIES',
                severity: 'HIGH',
                details: {
                    queries: slowQueries.rows
                }
            });
        }
        
        return bottlenecks;
    }

    _generateRecommendations(results) {
        const recommendations = [];
        
        // Based on bottlenecks
        for (const bottleneck of results.bottlenecks) {
            switch (bottleneck.type) {
                case 'HIGH_LATENCY':
                    recommendations.push({
                        category: 'PERFORMANCE',
                        priority: 'HIGH',
                        recommendation: `Optimize ${bottleneck.operation} operation`,
                        details: [
                            'Add appropriate indexes',
                            'Review query execution plans',
                            'Consider caching frequently accessed data',
                            'Batch operations where possible'
                        ]
                    });
                    break;
                
                case 'CONNECTION_POOL_EXHAUSTION':
                    recommendations.push({
                        category: 'CONFIGURATION',
                        priority: 'CRITICAL',
                        recommendation: 'Increase connection pool size',
                        details: [
                            `Current pool size: ${this.config.database.max}`,
                            `Recommended: ${Math.ceil(this.config.database.max * 1.5)}`,
                            'Consider using connection pooling middleware (PgBouncer)',
                            'Optimize query execution time to reduce connection hold time'
                        ]
                    });
                    break;
                
                case 'HIGH_ERROR_RATE':
                    recommendations.push({
                        category: 'RELIABILITY',
                        priority: 'CRITICAL',
                        recommendation: `Fix errors in ${bottleneck.operation}`,
                        details: [
                            'Review error logs for root causes',
                            'Add retry logic for transient failures',
                            'Implement circuit breakers',
                            'Add better error handling'
                        ]
                    });
                    break;
                
                case 'SLOW_QUERIES':
                    recommendations.push({
                        category: 'DATABASE',
                        priority: 'HIGH',
                        recommendation: 'Optimize slow queries',
                        details: bottleneck.details.queries.map(q => ({
                            query: q.query.substring(0, 100) + '...',
                            avgTime: `${q.mean_exec_time}ms`,
                            calls: q.calls
                        }))
                    });
                    break;
            }
        }
        
        // General recommendations based on results
        if (results.summary.avgThroughput < this.config.thresholds.minThroughput) {
            recommendations.push({
                category: 'SCALING',
                priority: 'HIGH',
                recommendation: 'Consider horizontal scaling',
                details: [
                    'Add read replicas for query operations',
                    'Implement database sharding',
                    'Use caching layer (Redis)',
                    'Consider microservices architecture'
                ]
            });
        }
        
        return recommendations;
    }

    _percentile(values, p) {
        const sorted = values.sort((a, b) => a - b);
        const index = Math.ceil(sorted.length * p) - 1;
        return sorted[index] || 0;
    }

    // ========== RESULTS SAVING ==========

    async _saveResults() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${this.config.monitoring.resultsPath}/load-test-${timestamp}.json`;
        
        const fs = require('fs').promises;
        const path = require('path');
        
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, JSON.stringify(this.state.results, null, 2));
        
        console.log(`Results saved to ${filename}`);
    }

    // ========== UTILITY METHODS ==========

    _buildConnectionUrl() {
        const { host, port, database, user, password } = this.config.database;
        return `postgresql://${user}:${password}@${host}:${port}/${database}`;
    }

    /**
     * Get current test status
     */
    getStatus() {
        return {
            running: this.state.testRunning,
            phase: this.state.currentPhase,
            duration: this.state.startTime ? Date.now() - this.state.startTime : 0,
            metrics: {
                operations: Object.fromEntries(this.state.metrics.operations),
                throughput: Object.fromEntries(this.state.metrics.throughput),
                connectionPool: this.state.metrics.connectionPool
            }
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Stop all generators
        for (const [name, generator] of this.loadGenerators) {
            if (generator.stop) generator.stop();
        }
        
        // Clear timers
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
        }
        
        // Close connections
        if (this.pool) await this.pool.end();
        if (this.prisma) await this.prisma.$disconnect();
        if (this.redis) await this.redis.quit();
        
        console.log('Load test framework cleaned up');
    }
}

module.exports = { DatabaseLoadTestFramework };