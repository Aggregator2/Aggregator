/**
 * @fileoverview Specialized Load Tests for Specific Scenarios
 * @author SwappiQ Protocol
 * @description Individual load test scenarios for targeted performance testing
 */

const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

/**
 * Order Placement Load Test - 10k orders per second
 */
class OrderPlacementLoadTest {
    constructor(config) {
        this.config = config;
        this.pool = new Pool(config.database);
        this.prisma = new PrismaClient();
        
        this.metrics = {
            totalOrders: 0,
            successfulOrders: 0,
            failedOrders: 0,
            latencies: [],
            startTime: null,
            endTime: null
        };
    }

    async initialize() {
        await this.pool.query('SELECT 1');
        await this.prisma.$connect();
        
        // Pre-generate test data
        this.users = await this._generateUsers(1000);
        this.pairs = await this._generatePairs();
    }

    async run(duration = 60000) {
        console.log('Starting Order Placement Load Test (10k/sec target)...');
        
        this.metrics.startTime = Date.now();
        const endTime = Date.now() + duration;
        
        // Batch size for efficient insertion
        const batchSize = 100;
        const batchInterval = 10; // ms between batches
        const ordersPerBatch = Math.ceil(10000 * batchInterval / 1000);
        
        while (Date.now() < endTime) {
            const batchStart = performance.now();
            
            try {
                await this._insertOrderBatch(ordersPerBatch);
                
                const batchDuration = performance.now() - batchStart;
                this.metrics.latencies.push(batchDuration / ordersPerBatch);
                
                // Adjust timing to maintain rate
                const sleepTime = Math.max(0, batchInterval - batchDuration);
                if (sleepTime > 0) {
                    await new Promise(resolve => setTimeout(resolve, sleepTime));
                }
                
            } catch (error) {
                console.error('Batch insertion error:', error);
                this.metrics.failedOrders += ordersPerBatch;
            }
        }
        
        this.metrics.endTime = Date.now();
        return this._analyzeResults();
    }

    async _insertOrderBatch(count) {
        const orders = [];
        
        for (let i = 0; i < count; i++) {
            const user = this.users[Math.floor(Math.random() * this.users.length)];
            const pair = this.pairs[Math.floor(Math.random() * this.pairs.length)];
            
            orders.push({
                id: crypto.randomUUID(),
                userId: user.id,
                pairId: pair.id,
                clientOrderId: crypto.randomUUID(),
                side: Math.random() > 0.5 ? 'BUY' : 'SELL',
                type: 'LIMIT',
                status: 'NEW',
                price: 1500 + (Math.random() - 0.5) * 100,
                quantity: Math.random() * 10,
                filledQuantity: 0,
                remainingQuantity: Math.random() * 10,
                timeInForce: 'GTC',
                source: 'API',
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }

        // Use raw SQL for maximum performance
        const values = orders.map(o => 
            `('${o.id}', '${o.userId}', '${o.pairId}', '${o.clientOrderId}', 
              '${o.side}', '${o.type}', '${o.status}', ${o.price}, ${o.quantity}, 
              ${o.filledQuantity}, ${o.remainingQuantity}, '${o.timeInForce}', 
              '${o.source}', NOW(), NOW())`
        ).join(',');

        await this.pool.query(`
            INSERT INTO "Order" (
                id, "userId", "pairId", "clientOrderId", side, type, status,
                price, quantity, "filledQuantity", "remainingQuantity",
                "timeInForce", source, "createdAt", "updatedAt"
            ) VALUES ${values}
        `);
        
        this.metrics.totalOrders += count;
        this.metrics.successfulOrders += count;
    }

    async _generateUsers(count) {
        const users = [];
        for (let i = 0; i < count; i++) {
            users.push({
                id: crypto.randomUUID(),
                walletAddress: '0x' + crypto.randomBytes(20).toString('hex')
            });
        }
        
        await this.prisma.user.createMany({ 
            data: users,
            skipDuplicates: true 
        });
        
        return users;
    }

    async _generatePairs() {
        const pairs = [
            { symbol: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT' },
            { symbol: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
            { symbol: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT' }
        ].map(p => ({
            id: crypto.randomUUID(),
            ...p,
            status: 'ACTIVE',
            tickSize: 0.01,
            stepSize: 0.0001,
            minOrderValue: 10,
            maxOrderValue: 100000,
            makerFee: 0.001,
            takerFee: 0.002
        }));
        
        await this.prisma.tradingPair.createMany({ 
            data: pairs,
            skipDuplicates: true 
        });
        
        return pairs;
    }

    _analyzeResults() {
        const duration = (this.metrics.endTime - this.metrics.startTime) / 1000;
        const throughput = this.metrics.totalOrders / duration;
        
        const sortedLatencies = this.metrics.latencies.sort((a, b) => a - b);
        const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
        const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
        const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];
        
        return {
            totalOrders: this.metrics.totalOrders,
            successfulOrders: this.metrics.successfulOrders,
            failedOrders: this.metrics.failedOrders,
            duration: duration,
            throughput: throughput,
            targetAchieved: throughput >= 10000,
            latencies: {
                p50: p50,
                p95: p95,
                p99: p99,
                max: Math.max(...this.metrics.latencies)
            }
        };
    }

    async cleanup() {
        await this.pool.end();
        await this.prisma.$disconnect();
    }
}

/**
 * Order Matching Engine Load Test
 */
class OrderMatchingLoadTest {
    constructor(config) {
        this.config = config;
        this.pool = new Pool(config.database);
        this.prisma = new PrismaClient();
        
        this.metrics = {
            totalMatches: 0,
            successfulMatches: 0,
            failedMatches: 0,
            matchLatencies: [],
            lockWaitTimes: [],
            deadlocks: 0
        };
    }

    async initialize() {
        await this.pool.query('SELECT 1');
        await this.prisma.$connect();
        
        // Pre-populate order book
        await this._populateOrderBook();
    }

    async run(duration = 60000) {
        console.log('Starting Order Matching Load Test...');
        
        const startTime = Date.now();
        const endTime = startTime + duration;
        const concurrency = 50; // Concurrent matching threads
        
        const workers = [];
        for (let i = 0; i < concurrency; i++) {
            workers.push(this._matchingWorker(i, endTime));
        }
        
        await Promise.all(workers);
        
        return this._analyzeResults(Date.now() - startTime);
    }

    async _matchingWorker(workerId, endTime) {
        while (Date.now() < endTime) {
            const matchStart = performance.now();
            
            try {
                const matched = await this._executeMatch();
                
                if (matched) {
                    this.metrics.totalMatches++;
                    this.metrics.successfulMatches++;
                    this.metrics.matchLatencies.push(performance.now() - matchStart);
                }
                
            } catch (error) {
                this.metrics.failedMatches++;
                
                if (error.code === '40P01') { // Deadlock
                    this.metrics.deadlocks++;
                }
            }
            
            // Small delay to prevent overwhelming
            await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        }
    }

    async _executeMatch() {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            
            // Find best bid and ask with row locking
            const matchQuery = `
                WITH best_bid AS (
                    SELECT * FROM "Order"
                    WHERE status = 'NEW' AND side = 'BUY' AND "pairId" = $1
                    ORDER BY price DESC, "createdAt" ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                ),
                best_ask AS (
                    SELECT * FROM "Order"
                    WHERE status = 'NEW' AND side = 'SELL' AND "pairId" = $1
                    ORDER BY price ASC, "createdAt" ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                SELECT 
                    bb.id as buy_id, bb.price as buy_price, bb.quantity as buy_qty,
                    ba.id as sell_id, ba.price as sell_price, ba.quantity as sell_qty
                FROM best_bid bb, best_ask ba
                WHERE bb.price >= ba.price
            `;
            
            const pairId = this.pairs[0].id; // Use first pair for simplicity
            const result = await client.query(matchQuery, [pairId]);
            
            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return false;
            }
            
            const match = result.rows[0];
            const matchQty = Math.min(match.buy_qty, match.sell_qty);
            
            // Update orders
            await client.query(`
                UPDATE "Order" 
                SET "filledQuantity" = "filledQuantity" + $1,
                    "remainingQuantity" = "remainingQuantity" - $1,
                    status = CASE 
                        WHEN "remainingQuantity" - $1 <= 0 THEN 'FILLED'
                        ELSE 'PARTIALLY_FILLED'
                    END,
                    "updatedAt" = NOW()
                WHERE id IN ($2, $3)
            `, [matchQty, match.buy_id, match.sell_id]);
            
            // Create trade
            await client.query(`
                INSERT INTO "Trade" (
                    id, "pairId", "buyOrderId", "sellOrderId",
                    price, quantity, "quoteQuantity",
                    "buyerId", "sellerId",
                    "buyerCommission", "sellerCommission",
                    "isMaker", "executedAt"
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
            `, [
                crypto.randomUUID(), pairId, match.buy_id, match.sell_id,
                match.sell_price, matchQty, matchQty * match.sell_price,
                'buyer-id', 'seller-id', 0.001, 0.001, false
            ]);
            
            await client.query('COMMIT');
            return true;
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async _populateOrderBook() {
        console.log('Populating order book with test orders...');
        
        // Create test pair
        this.pairs = [{
            id: crypto.randomUUID(),
            symbol: 'ETH/USDT',
            baseAsset: 'ETH',
            quoteAsset: 'USDT',
            status: 'ACTIVE',
            tickSize: 0.01,
            stepSize: 0.0001,
            minOrderValue: 10,
            maxOrderValue: 100000,
            makerFee: 0.001,
            takerFee: 0.002
        }];
        
        await this.prisma.tradingPair.createMany({ 
            data: this.pairs,
            skipDuplicates: true 
        });
        
        // Create orders
        const orders = [];
        const basePrice = 1500;
        
        // Create buy orders (bids)
        for (let i = 0; i < 1000; i++) {
            orders.push({
                id: crypto.randomUUID(),
                userId: crypto.randomUUID(),
                pairId: this.pairs[0].id,
                side: 'BUY',
                type: 'LIMIT',
                status: 'NEW',
                price: basePrice - (i * 0.1),
                quantity: Math.random() * 10 + 1,
                filledQuantity: 0,
                remainingQuantity: Math.random() * 10 + 1,
                timeInForce: 'GTC',
                source: 'API'
            });
        }
        
        // Create sell orders (asks)
        for (let i = 0; i < 1000; i++) {
            orders.push({
                id: crypto.randomUUID(),
                userId: crypto.randomUUID(),
                pairId: this.pairs[0].id,
                side: 'SELL',
                type: 'LIMIT',
                status: 'NEW',
                price: basePrice + (i * 0.1),
                quantity: Math.random() * 10 + 1,
                filledQuantity: 0,
                remainingQuantity: Math.random() * 10 + 1,
                timeInForce: 'GTC',
                source: 'API'
            });
        }
        
        await this.prisma.order.createMany({ data: orders });
    }

    _analyzeResults(duration) {
        const durationSec = duration / 1000;
        const throughput = this.metrics.totalMatches / durationSec;
        
        const sortedLatencies = this.metrics.matchLatencies.sort((a, b) => a - b);
        
        return {
            totalMatches: this.metrics.totalMatches,
            successfulMatches: this.metrics.successfulMatches,
            failedMatches: this.metrics.failedMatches,
            deadlocks: this.metrics.deadlocks,
            duration: durationSec,
            throughput: throughput,
            latencies: {
                p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0,
                p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0,
                p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0,
                max: Math.max(...sortedLatencies) || 0
            }
        };
    }

    async cleanup() {
        await this.pool.end();
        await this.prisma.$disconnect();
    }
}

/**
 * Settlement Processing Load Test
 */
class SettlementLoadTest {
    constructor(config) {
        this.config = config;
        this.pool = new Pool(config.database);
        this.prisma = new PrismaClient();
        
        this.metrics = {
            totalSettlements: 0,
            successfulSettlements: 0,
            failedSettlements: 0,
            batchSizes: [],
            processingTimes: [],
            balanceUpdateErrors: 0
        };
    }

    async initialize() {
        await this.pool.query('SELECT 1');
        await this.prisma.$connect();
        
        // Initialize test data
        await this._initializeBalances();
    }

    async run(duration = 60000) {
        console.log('Starting Settlement Processing Load Test...');
        
        const startTime = Date.now();
        const endTime = startTime + duration;
        
        while (Date.now() < endTime) {
            const batchStart = performance.now();
            
            try {
                const processed = await this._processSettlementBatch();
                
                this.metrics.totalSettlements += processed;
                this.metrics.successfulSettlements += processed;
                this.metrics.batchSizes.push(processed);
                this.metrics.processingTimes.push(performance.now() - batchStart);
                
            } catch (error) {
                this.metrics.failedSettlements++;
                console.error('Settlement batch error:', error);
            }
            
            // Process batches every 100ms
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        return this._analyzeResults(Date.now() - startTime);
    }

    async _processSettlementBatch() {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
            
            // Get recent trades for settlement
            const trades = await client.query(`
                SELECT t.*, bo."userId" as buyer_id, so."userId" as seller_id,
                       tp."baseAsset", tp."quoteAsset"
                FROM "Trade" t
                JOIN "Order" bo ON t."buyOrderId" = bo.id
                JOIN "Order" so ON t."sellOrderId" = so.id
                JOIN "TradingPair" tp ON t."pairId" = tp.id
                WHERE t."executedAt" >= NOW() - INTERVAL '1 minute'
                AND NOT EXISTS (
                    SELECT 1 FROM settlement_log 
                    WHERE trade_id = t.id
                )
                LIMIT 100
                FOR UPDATE SKIP LOCKED
            `);
            
            if (trades.rows.length === 0) {
                await client.query('ROLLBACK');
                return 0;
            }
            
            // Process settlements
            for (const trade of trades.rows) {
                // Update buyer balance (receives base asset)
                await client.query(`
                    UPDATE "Balance"
                    SET available = available + $1,
                        total = total + $1,
                        "updatedAt" = NOW()
                    WHERE "userId" = $2 AND asset = $3
                `, [
                    trade.quantity - trade.buyerCommission,
                    trade.buyer_id,
                    trade.baseAsset
                ]);
                
                // Update seller balance (receives quote asset)
                await client.query(`
                    UPDATE "Balance"
                    SET available = available + $1,
                        total = total + $1,
                        "updatedAt" = NOW()
                    WHERE "userId" = $2 AND asset = $3
                `, [
                    trade.quoteQuantity - trade.sellerCommission,
                    trade.seller_id,
                    trade.quoteAsset
                ]);
                
                // Log settlement
                await client.query(`
                    INSERT INTO settlement_log (trade_id, processed_at)
                    VALUES ($1, NOW())
                `, [trade.id]);
            }
            
            await client.query('COMMIT');
            return trades.rows.length;
            
        } catch (error) {
            await client.query('ROLLBACK');
            
            if (error.constraint === 'chk_balance_amounts') {
                this.metrics.balanceUpdateErrors++;
            }
            
            throw error;
        } finally {
            client.release();
        }
    }

    async _initializeBalances() {
        // Create settlement log table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS settlement_log (
                trade_id UUID PRIMARY KEY,
                processed_at TIMESTAMP NOT NULL
            )
        `);
        
        // Ensure balances exist for test users
        const users = await this.prisma.user.findMany({ take: 100 });
        const assets = ['ETH', 'BTC', 'USDT', 'USDC'];
        
        const balances = [];
        for (const user of users) {
            for (const asset of assets) {
                balances.push({
                    id: crypto.randomUUID(),
                    userId: user.id,
                    asset,
                    available: 1000,
                    locked: 0,
                    total: 1000
                });
            }
        }
        
        await this.prisma.balance.createMany({ 
            data: balances,
            skipDuplicates: true 
        });
    }

    _analyzeResults(duration) {
        const durationSec = duration / 1000;
        const throughput = this.metrics.totalSettlements / durationSec;
        
        const avgBatchSize = this.metrics.batchSizes.reduce((a, b) => a + b, 0) / 
                           this.metrics.batchSizes.length || 0;
        
        const sortedTimes = this.metrics.processingTimes.sort((a, b) => a - b);
        
        return {
            totalSettlements: this.metrics.totalSettlements,
            successfulSettlements: this.metrics.successfulSettlements,
            failedSettlements: this.metrics.failedSettlements,
            balanceUpdateErrors: this.metrics.balanceUpdateErrors,
            duration: durationSec,
            throughput: throughput,
            avgBatchSize: avgBatchSize,
            processingTimes: {
                p50: sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0,
                p95: sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0,
                p99: sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0,
                max: Math.max(...sortedTimes) || 0
            }
        };
    }

    async cleanup() {
        // Clean up test table
        await this.pool.query('DROP TABLE IF EXISTS settlement_log');
        
        await this.pool.end();
        await this.prisma.$disconnect();
    }
}

/**
 * Query Performance Degradation Test
 */
class QueryPerformanceTest {
    constructor(config) {
        this.config = config;
        this.pool = new Pool(config.database);
        
        this.queries = {
            orderBookDepth: {
                sql: `
                    WITH depth AS (
                        SELECT side, price, SUM("remainingQuantity") as total
                        FROM "Order"
                        WHERE "pairId" = $1 AND status IN ('NEW', 'PARTIALLY_FILLED')
                        GROUP BY side, price
                        ORDER BY 
                            CASE WHEN side = 'BUY' THEN price END DESC,
                            CASE WHEN side = 'SELL' THEN price END ASC
                        LIMIT $2
                    )
                    SELECT * FROM depth
                `,
                params: () => [crypto.randomUUID(), 20]
            },
            userOrderHistory: {
                sql: `
                    SELECT o.*, tp.symbol
                    FROM "Order" o
                    JOIN "TradingPair" tp ON o."pairId" = tp.id
                    WHERE o."userId" = $1
                    ORDER BY o."createdAt" DESC
                    LIMIT $2
                `,
                params: () => [crypto.randomUUID(), 50]
            },
            tradeAggregation: {
                sql: `
                    SELECT 
                        DATE_TRUNC('minute', "executedAt") as minute,
                        COUNT(*) as trades,
                        SUM(quantity) as volume,
                        AVG(price) as avg_price,
                        MIN(price) as low,
                        MAX(price) as high
                    FROM "Trade"
                    WHERE "pairId" = $1 
                    AND "executedAt" >= NOW() - INTERVAL '1 hour'
                    GROUP BY minute
                    ORDER BY minute DESC
                `,
                params: () => [crypto.randomUUID()]
            },
            complexJoinQuery: {
                sql: `
                    WITH user_stats AS (
                        SELECT 
                            u.id,
                            COUNT(DISTINCT o.id) as total_orders,
                            COUNT(DISTINCT t.id) as total_trades,
                            SUM(t."quoteQuantity") as total_volume
                        FROM "User" u
                        LEFT JOIN "Order" o ON u.id = o."userId"
                        LEFT JOIN "Trade" t ON o.id IN (t."buyOrderId", t."sellOrderId")
                        WHERE u."createdAt" >= NOW() - INTERVAL '7 days'
                        GROUP BY u.id
                    )
                    SELECT * FROM user_stats
                    ORDER BY total_volume DESC
                    LIMIT $1
                `,
                params: () => [100]
            }
        };
        
        this.metrics = new Map();
    }

    async initialize() {
        await this.pool.query('SELECT 1');
        
        // Initialize metrics for each query
        for (const queryName of Object.keys(this.queries)) {
            this.metrics.set(queryName, {
                executions: 0,
                latencies: [],
                errors: 0,
                timeouts: 0
            });
        }
    }

    async run(duration = 60000, concurrency = 100) {
        console.log('Starting Query Performance Test...');
        
        const startTime = Date.now();
        const endTime = startTime + duration;
        
        // Run queries with increasing load
        const phases = [
            { duration: duration * 0.25, concurrency: concurrency * 0.5 },
            { duration: duration * 0.25, concurrency: concurrency * 1.0 },
            { duration: duration * 0.25, concurrency: concurrency * 1.5 },
            { duration: duration * 0.25, concurrency: concurrency * 2.0 }
        ];
        
        for (const phase of phases) {
            console.log(`Running phase with ${phase.concurrency} concurrent queries...`);
            
            const phaseEnd = Date.now() + phase.duration;
            const workers = [];
            
            for (let i = 0; i < phase.concurrency; i++) {
                workers.push(this._queryWorker(phaseEnd));
            }
            
            await Promise.all(workers);
        }
        
        return this._analyzeResults();
    }

    async _queryWorker(endTime) {
        const queryNames = Object.keys(this.queries);
        
        while (Date.now() < endTime) {
            const queryName = queryNames[Math.floor(Math.random() * queryNames.length)];
            const query = this.queries[queryName];
            const metrics = this.metrics.get(queryName);
            
            const startTime = performance.now();
            
            try {
                const client = await this.pool.connect();
                
                try {
                    // Set statement timeout
                    await client.query('SET statement_timeout = 5000');
                    
                    // Execute query
                    await client.query(query.sql, query.params());
                    
                    const duration = performance.now() - startTime;
                    metrics.latencies.push(duration);
                    metrics.executions++;
                    
                } finally {
                    client.release();
                }
                
            } catch (error) {
                metrics.errors++;
                
                if (error.code === '57014') { // Statement timeout
                    metrics.timeouts++;
                }
            }
        }
    }

    _analyzeResults() {
        const results = {};
        
        for (const [queryName, metrics] of this.metrics) {
            const sortedLatencies = metrics.latencies.sort((a, b) => a - b);
            
            results[queryName] = {
                executions: metrics.executions,
                errors: metrics.errors,
                timeouts: metrics.timeouts,
                errorRate: metrics.errors / (metrics.executions + metrics.errors),
                latencies: {
                    min: Math.min(...sortedLatencies) || 0,
                    p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0,
                    p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0,
                    p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0,
                    max: Math.max(...sortedLatencies) || 0
                },
                degradation: this._calculateDegradation(metrics.latencies)
            };
        }
        
        return results;
    }

    _calculateDegradation(latencies) {
        if (latencies.length < 100) return null;
        
        // Compare first 10% with last 10%
        const firstSegment = latencies.slice(0, Math.floor(latencies.length * 0.1));
        const lastSegment = latencies.slice(Math.floor(latencies.length * 0.9));
        
        const firstAvg = firstSegment.reduce((a, b) => a + b, 0) / firstSegment.length;
        const lastAvg = lastSegment.reduce((a, b) => a + b, 0) / lastSegment.length;
        
        return {
            initialLatency: firstAvg,
            finalLatency: lastAvg,
            degradationPercent: ((lastAvg - firstAvg) / firstAvg) * 100
        };
    }

    async cleanup() {
        await this.pool.end();
    }
}

/**
 * Connection Pool Exhaustion Test
 */
class ConnectionExhaustionTest {
    constructor(config) {
        this.config = config;
        this.pool = new Pool(config.database);
        
        this.metrics = {
            connectionAttempts: 0,
            successfulConnections: 0,
            failedConnections: 0,
            timeouts: 0,
            waitTimes: [],
            concurrentConnections: []
        };
    }

    async run() {
        console.log('Starting Connection Pool Exhaustion Test...');
        
        const testPhases = [
            { connections: 50, holdTime: 1000, name: 'Normal Load' },
            { connections: 100, holdTime: 2000, name: 'High Load' },
            { connections: 200, holdTime: 3000, name: 'Extreme Load' },
            { connections: 500, holdTime: 5000, name: 'Exhaustion' }
        ];
        
        const results = {};
        
        for (const phase of testPhases) {
            console.log(`Running phase: ${phase.name} (${phase.connections} connections)`);
            
            this.metrics = {
                connectionAttempts: 0,
                successfulConnections: 0,
                failedConnections: 0,
                timeouts: 0,
                waitTimes: [],
                concurrentConnections: []
            };
            
            await this._runPhase(phase);
            results[phase.name] = this._getPhaseResults();
        }
        
        return results;
    }

    async _runPhase(phase) {
        const connections = [];
        let activeConnections = 0;
        
        // Monitor concurrent connections
        const monitor = setInterval(() => {
            this.metrics.concurrentConnections.push(activeConnections);
        }, 100);
        
        try {
            // Attempt to create many connections
            for (let i = 0; i < phase.connections; i++) {
                connections.push(
                    this._attemptConnection(phase.holdTime)
                        .then(() => activeConnections++)
                        .finally(() => activeConnections--)
                );
                
                // Small delay between attempts
                if (i % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
            // Wait for all connections to complete
            await Promise.allSettled(connections);
            
        } finally {
            clearInterval(monitor);
        }
    }

    async _attemptConnection(holdTime) {
        this.metrics.connectionAttempts++;
        const startTime = performance.now();
        
        try {
            const client = await this.pool.connect();
            const waitTime = performance.now() - startTime;
            
            this.metrics.waitTimes.push(waitTime);
            this.metrics.successfulConnections++;
            
            // Hold connection
            await client.query('SELECT pg_sleep($1)', [holdTime / 1000]);
            
            // Perform some operations
            await client.query('SELECT COUNT(*) FROM "Order"');
            await client.query('SELECT COUNT(*) FROM "Trade"');
            
            client.release();
            
        } catch (error) {
            this.metrics.failedConnections++;
            
            if (error.message.includes('timeout')) {
                this.metrics.timeouts++;
            }
            
            throw error;
        }
    }

    _getPhaseResults() {
        const sortedWaitTimes = this.metrics.waitTimes.sort((a, b) => a - b);
        
        return {
            connectionAttempts: this.metrics.connectionAttempts,
            successfulConnections: this.metrics.successfulConnections,
            failedConnections: this.metrics.failedConnections,
            timeouts: this.metrics.timeouts,
            successRate: this.metrics.successfulConnections / this.metrics.connectionAttempts,
            maxConcurrent: Math.max(...this.metrics.concurrentConnections),
            avgConcurrent: this.metrics.concurrentConnections.reduce((a, b) => a + b, 0) / 
                          this.metrics.concurrentConnections.length || 0,
            waitTimes: {
                min: Math.min(...sortedWaitTimes) || 0,
                avg: sortedWaitTimes.reduce((a, b) => a + b, 0) / sortedWaitTimes.length || 0,
                p95: sortedWaitTimes[Math.floor(sortedWaitTimes.length * 0.95)] || 0,
                max: Math.max(...sortedWaitTimes) || 0
            }
        };
    }

    async cleanup() {
        await this.pool.end();
    }
}

module.exports = {
    OrderPlacementLoadTest,
    OrderMatchingLoadTest,
    SettlementLoadTest,
    QueryPerformanceTest,
    ConnectionExhaustionTest
};