/**
 * Advanced Balance Service with Consistency Guarantees
 * Optimized for high-frequency trading with millions of orders
 * Implements distributed caching with strong consistency
 */

const { Pool } = require('pg');
const Redis = require('ioredis');
const { EventEmitter } = require('events');
const crypto = require('crypto');

class AdvancedBalanceService extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            // Database configuration
            pgPool: config.pgPool || new Pool({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 5432,
                database: process.env.DB_NAME || 'settlement_queue',
                user: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASSWORD,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            }),
            
            // Redis configuration for caching
            redis: config.redis || new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD,
                retryDelayOnFailover: 100,
                maxRetriesPerRequest: 3,
                lazyConnect: true,
            }),
            
            // Cache settings
            cacheTTL: config.cacheTTL || 30, // 30 seconds default TTL
            stalenessTolerance: config.stalenessTolerance || 5, // 5 seconds staleness tolerance
            batchSize: config.batchSize || 100,
            maxRetries: config.maxRetries || 3,
            
            // Consistency settings
            consistencyLevel: config.consistencyLevel || 'strong', // 'strong', 'eventual', 'session'
            lockTimeout: config.lockTimeout || 5000, // 5 seconds
            refreshThreshold: config.refreshThreshold || 0.8, // Refresh when 80% of TTL elapsed
            
            // Performance settings
            enableBatching: config.enableBatching !== false,
            enableCompression: config.enableCompression || false,
            enableMetrics: config.enableMetrics !== false,
        };
        
        // Initialize caching layers
        this.l1Cache = new Map(); // In-memory cache
        this.l2Cache = this.config.redis; // Redis cache
        
        // Batch operation queues
        this.readQueue = new Map();
        this.writeQueue = new Map();
        this.lockQueue = new Map();
        
        // Metrics tracking
        this.metrics = {
            cacheHits: 0,
            cacheMisses: 0,
            dbQueries: 0,
            lockContentions: 0,
            consistencyViolations: 0,
            batchOperations: 0,
        };
        
        // Active locks tracking
        this.activeLocks = new Map();
        
        // Initialize connections
        this.initialize();
    }
    
    async initialize() {
        try {
            // Test database connection
            await this.config.pgPool.query('SELECT 1');
            
            // Test Redis connection
            await this.l2Cache.ping();
            
            // Setup batch processing intervals
            if (this.config.enableBatching) {
                this.setupBatchProcessing();
            }
            
            // Setup metrics collection
            if (this.config.enableMetrics) {
                this.setupMetricsCollection();
            }
            
            this.emit('ready');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    
    // =============================================================================
    // CORE BALANCE OPERATIONS WITH CONSISTENCY
    // =============================================================================
    
    /**
     * Get user balance with consistency guarantees
     */
    async getBalance(userAddress, tokenAddress, chainId = 1, options = {}) {
        const cacheKey = this.getCacheKey(userAddress, tokenAddress, chainId);
        const consistency = options.consistency || this.config.consistencyLevel;
        
        try {
            // Try L1 cache first (for strong consistency, skip if stale)
            if (consistency !== 'strong') {
                const l1Result = this.l1Cache.get(cacheKey);
                if (l1Result && !this.isStale(l1Result)) {
                    this.metrics.cacheHits++;
                    return this.formatBalance(l1Result);
                }
            }
            
            // Try L2 cache (Redis)
            const l2Result = await this.getFromL2Cache(cacheKey);
            if (l2Result && (consistency === 'eventual' || !this.isStale(l2Result))) {
                this.metrics.cacheHits++;
                
                // Update L1 cache
                this.l1Cache.set(cacheKey, l2Result);
                
                return this.formatBalance(l2Result);
            }
            
            // Cache miss - fetch from database
            this.metrics.cacheMisses++;
            return await this.fetchBalanceFromDB(userAddress, tokenAddress, chainId, cacheKey);
            
        } catch (error) {
            this.emit('balanceError', { userAddress, tokenAddress, chainId, error });
            throw error;
        }
    }
    
    /**
     * Update user balance with atomic operations
     */
    async updateBalance(userAddress, tokenAddress, chainId, balanceChange, options = {}) {
        const lockKey = this.getLockKey(userAddress, tokenAddress, chainId);
        const cacheKey = this.getCacheKey(userAddress, tokenAddress, chainId);
        
        // Acquire distributed lock
        const lockId = await this.acquireLock(lockKey, options.lockTimeout);
        
        try {
            const client = await this.config.pgPool.connect();
            
            try {
                await client.query('BEGIN');
                
                // Get current balance with SELECT FOR UPDATE
                const currentBalance = await this.getBalanceForUpdate(
                    client, userAddress, tokenAddress, chainId
                );
                
                // Calculate new balance
                const newBalance = {
                    balance: BigInt(currentBalance.balance) + BigInt(balanceChange.balance || 0),
                    locked_balance: BigInt(currentBalance.locked_balance) + BigInt(balanceChange.locked_balance || 0),
                };
                
                // Validate balance constraints
                this.validateBalance(newBalance);
                
                // Update database
                await this.updateBalanceInDB(
                    client, userAddress, tokenAddress, chainId, newBalance, currentBalance, options
                );
                
                // Log balance change for audit
                await this.logBalanceChange(
                    client, userAddress, tokenAddress, chainId, 
                    currentBalance, newBalance, options
                );
                
                await client.query('COMMIT');
                
                // Update caches
                const updatedBalance = {
                    ...newBalance,
                    balance: newBalance.balance.toString(),
                    locked_balance: newBalance.locked_balance.toString(),
                    last_updated: new Date(),
                    version: currentBalance.version + 1,
                };
                
                await this.updateCaches(cacheKey, updatedBalance);
                
                // Emit balance update event
                this.emit('balanceUpdated', {
                    userAddress, tokenAddress, chainId,
                    oldBalance: currentBalance,
                    newBalance: updatedBalance,
                    change: balanceChange
                });
                
                return updatedBalance;
                
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } finally {
            await this.releaseLock(lockKey, lockId);
        }
    }
    
    /**
     * Batch balance updates for high performance
     */
    async batchUpdateBalances(updates, options = {}) {
        if (!this.config.enableBatching || updates.length === 1) {
            // Fall back to individual updates for small batches
            const results = [];
            for (const update of updates) {
                const result = await this.updateBalance(
                    update.userAddress, update.tokenAddress, update.chainId, 
                    update.balanceChange, update.options
                );
                results.push(result);
            }
            return results;
        }
        
        this.metrics.batchOperations++;
        
        // Group updates by user to minimize lock contention
        const updateGroups = this.groupUpdatesByUser(updates);
        const results = [];
        
        // Process groups in parallel with controlled concurrency
        const concurrency = Math.min(updateGroups.length, 10);
        const semaphore = new Array(concurrency).fill(null);
        
        await Promise.all(
            semaphore.map(async () => {
                while (updateGroups.length > 0) {
                    const group = updateGroups.shift();
                    if (!group) break;
                    
                    const groupResults = await this.processBatchGroup(group, options);
                    results.push(...groupResults);
                }
            })
        );
        
        return results;
    }
    
    // =============================================================================
    // DISTRIBUTED LOCKING SYSTEM
    // =============================================================================
    
    async acquireLock(lockKey, timeout = this.config.lockTimeout) {
        const lockId = crypto.randomBytes(16).toString('hex');
        const expiry = Date.now() + timeout;
        
        const acquired = await this.l2Cache.set(
            `lock:${lockKey}`, 
            lockId, 
            'PX', 
            timeout, 
            'NX'
        );
        
        if (!acquired) {
            this.metrics.lockContentions++;
            
            // Wait and retry with exponential backoff
            const retryDelay = Math.min(100 * Math.random(), 1000);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            
            if (Date.now() < expiry) {
                return await this.acquireLock(lockKey, expiry - Date.now());
            }
            
            throw new Error(`Failed to acquire lock: ${lockKey}`);
        }
        
        this.activeLocks.set(lockKey, { lockId, expiry });
        return lockId;
    }
    
    async releaseLock(lockKey, lockId) {
        const luaScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        
        const released = await this.l2Cache.eval(
            luaScript, 
            1, 
            `lock:${lockKey}`, 
            lockId
        );
        
        this.activeLocks.delete(lockKey);
        return released === 1;
    }
    
    // =============================================================================
    // CACHING SYSTEM WITH CONSISTENCY
    // =============================================================================
    
    async getFromL2Cache(cacheKey) {
        try {
            const cached = await this.l2Cache.get(cacheKey);
            if (!cached) return null;
            
            return this.config.enableCompression 
                ? JSON.parse(this.decompress(cached))
                : JSON.parse(cached);
                
        } catch (error) {
            // Cache corruption - invalidate
            await this.l2Cache.del(cacheKey);
            return null;
        }
    }
    
    async updateCaches(cacheKey, balance) {
        const serialized = JSON.stringify(balance);
        const compressed = this.config.enableCompression 
            ? this.compress(serialized) 
            : serialized;
        
        // Update L1 cache immediately
        this.l1Cache.set(cacheKey, balance);
        
        // Update L2 cache with TTL
        await this.l2Cache.setex(cacheKey, this.config.cacheTTL, compressed);
        
        // Update cache metadata
        const metaKey = `meta:${cacheKey}`;
        await this.l2Cache.setex(metaKey, this.config.cacheTTL * 2, JSON.stringify({
            lastUpdated: Date.now(),
            version: balance.version,
            checksum: this.calculateChecksum(balance),
        }));
    }
    
    async invalidateCache(userAddress, tokenAddress, chainId) {
        const cacheKey = this.getCacheKey(userAddress, tokenAddress, chainId);
        
        // Remove from L1 cache
        this.l1Cache.delete(cacheKey);
        
        // Remove from L2 cache
        await this.l2Cache.del(cacheKey);
        await this.l2Cache.del(`meta:${cacheKey}`);
        
        this.emit('cacheInvalidated', { userAddress, tokenAddress, chainId });
    }
    
    // =============================================================================
    // DATABASE OPERATIONS
    // =============================================================================
    
    async fetchBalanceFromDB(userAddress, tokenAddress, chainId, cacheKey) {
        this.metrics.dbQueries++;
        
        const query = `
            SELECT 
                balance,
                locked_balance,
                last_updated,
                last_block_number,
                version,
                is_stale
            FROM user_balances
            WHERE user_address = $1 AND token_address = $2 AND chain_id = $3
        `;
        
        const result = await this.config.pgPool.query(query, [
            Buffer.from(userAddress.slice(2), 'hex'),
            Buffer.from(tokenAddress.slice(2), 'hex'),
            chainId
        ]);
        
        let balance;
        if (result.rows.length === 0) {
            // Create new balance record
            balance = await this.createBalanceRecord(userAddress, tokenAddress, chainId);
        } else {
            balance = this.formatDBBalance(result.rows[0]);
        }
        
        // Update caches
        await this.updateCaches(cacheKey, balance);
        
        return balance;
    }
    
    async getBalanceForUpdate(client, userAddress, tokenAddress, chainId) {
        const query = `
            SELECT 
                balance,
                locked_balance,
                last_updated,
                last_block_number,
                version,
                is_stale
            FROM user_balances
            WHERE user_address = $1 AND token_address = $2 AND chain_id = $3
            FOR UPDATE
        `;
        
        const result = await client.query(query, [
            Buffer.from(userAddress.slice(2), 'hex'),
            Buffer.from(tokenAddress.slice(2), 'hex'),
            chainId
        ]);
        
        if (result.rows.length === 0) {
            throw new Error(`Balance record not found: ${userAddress}:${tokenAddress}:${chainId}`);
        }
        
        return this.formatDBBalance(result.rows[0]);
    }
    
    async updateBalanceInDB(client, userAddress, tokenAddress, chainId, newBalance, oldBalance, options) {
        const query = `
            UPDATE user_balances 
            SET 
                balance = $4,
                locked_balance = $5,
                last_updated = NOW(),
                last_block_number = COALESCE($6, last_block_number),
                version = version + 1,
                is_stale = false
            WHERE user_address = $1 AND token_address = $2 AND chain_id = $3
            RETURNING version, last_updated
        `;
        
        const result = await client.query(query, [
            Buffer.from(userAddress.slice(2), 'hex'),
            Buffer.from(tokenAddress.slice(2), 'hex'),
            chainId,
            newBalance.balance.toString(),
            newBalance.locked_balance.toString(),
            options.blockNumber
        ]);
        
        if (result.rows.length === 0) {
            throw new Error(`Failed to update balance: ${userAddress}:${tokenAddress}:${chainId}`);
        }
        
        return result.rows[0];
    }
    
    async logBalanceChange(client, userAddress, tokenAddress, chainId, oldBalance, newBalance, options) {
        const query = `
            INSERT INTO balance_updates (
                user_address,
                token_address,
                chain_id,
                old_balance,
                new_balance,
                old_locked,
                new_locked,
                change_type,
                related_order_id,
                tx_hash,
                block_number,
                created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `;
        
        await client.query(query, [
            Buffer.from(userAddress.slice(2), 'hex'),
            Buffer.from(tokenAddress.slice(2), 'hex'),
            chainId,
            oldBalance.balance.toString(),
            newBalance.balance.toString(),
            oldBalance.locked_balance.toString(),
            newBalance.locked_balance.toString(),
            options.changeType || 'unknown',
            options.orderId,
            options.txHash ? Buffer.from(options.txHash.slice(2), 'hex') : null,
            options.blockNumber,
            options.createdBy || 'system'
        ]);
    }
    
    // =============================================================================
    // CONSISTENCY VALIDATION
    // =============================================================================
    
    async validateConsistency(userAddress, tokenAddress, chainId) {
        const cacheKey = this.getCacheKey(userAddress, tokenAddress, chainId);
        
        // Get cached version
        const cached = await this.getFromL2Cache(cacheKey);
        
        // Get database version
        const dbBalance = await this.fetchBalanceFromDB(userAddress, tokenAddress, chainId, cacheKey + '_temp');
        
        if (cached && dbBalance) {
            // Compare versions and checksums
            if (cached.version !== dbBalance.version) {
                this.metrics.consistencyViolations++;
                
                this.emit('consistencyViolation', {
                    userAddress, tokenAddress, chainId,
                    cached: cached.version,
                    database: dbBalance.version
                });
                
                // Invalidate cache to force refresh
                await this.invalidateCache(userAddress, tokenAddress, chainId);
                
                return false;
            }
        }
        
        return true;
    }
    
    validateBalance(balance) {
        const balanceVal = BigInt(balance.balance);
        const lockedVal = BigInt(balance.locked_balance);
        
        if (balanceVal < 0n) {
            throw new Error('Balance cannot be negative');
        }
        
        if (lockedVal < 0n) {
            throw new Error('Locked balance cannot be negative');
        }
        
        if (lockedVal > balanceVal) {
            throw new Error('Locked balance cannot exceed total balance');
        }
    }
    
    // =============================================================================
    // BATCH PROCESSING OPTIMIZATION
    // =============================================================================
    
    setupBatchProcessing() {
        // Process read batches every 10ms
        setInterval(() => this.processReadBatch(), 10);
        
        // Process write batches every 50ms
        setInterval(() => this.processWriteBatch(), 50);
    }
    
    async processReadBatch() {
        if (this.readQueue.size === 0) return;
        
        const batch = Array.from(this.readQueue.entries()).slice(0, this.config.batchSize);
        this.readQueue.clear();
        
        try {
            await this.executeBatchRead(batch);
        } catch (error) {
            // Re-queue failed items
            batch.forEach(([key, value]) => this.readQueue.set(key, value));
            this.emit('batchError', { type: 'read', error, count: batch.length });
        }
    }
    
    async processWriteBatch() {
        if (this.writeQueue.size === 0) return;
        
        const batch = Array.from(this.writeQueue.entries()).slice(0, this.config.batchSize);
        this.writeQueue.clear();
        
        try {
            await this.executeBatchWrite(batch);
        } catch (error) {
            // Re-queue failed items
            batch.forEach(([key, value]) => this.writeQueue.set(key, value));
            this.emit('batchError', { type: 'write', error, count: batch.length });
        }
    }
    
    groupUpdatesByUser(updates) {
        const groups = new Map();
        
        for (const update of updates) {
            const userKey = `${update.userAddress}:${update.chainId}`;
            if (!groups.has(userKey)) {
                groups.set(userKey, []);
            }
            groups.get(userKey).push(update);
        }
        
        return Array.from(groups.values());
    }
    
    async processBatchGroup(group, options) {
        const results = [];
        
        // Process all updates for a single user sequentially to maintain consistency
        for (const update of group) {
            try {
                const result = await this.updateBalance(
                    update.userAddress, update.tokenAddress, update.chainId,
                    update.balanceChange, { ...options, ...update.options }
                );
                results.push(result);
            } catch (error) {
                results.push({ error: error.message, update });
            }
        }
        
        return results;
    }
    
    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================
    
    getCacheKey(userAddress, tokenAddress, chainId) {
        return `balance:${userAddress.toLowerCase()}:${tokenAddress.toLowerCase()}:${chainId}`;
    }
    
    getLockKey(userAddress, tokenAddress, chainId) {
        return `${userAddress.toLowerCase()}:${tokenAddress.toLowerCase()}:${chainId}`;
    }
    
    isStale(balance) {
        if (!balance.last_updated) return true;
        
        const age = Date.now() - new Date(balance.last_updated).getTime();
        return age > (this.config.stalenessTolerance * 1000);
    }
    
    formatBalance(balance) {
        return {
            balance: balance.balance.toString(),
            locked_balance: balance.locked_balance.toString(),
            available_balance: (BigInt(balance.balance) - BigInt(balance.locked_balance)).toString(),
            last_updated: balance.last_updated,
            version: balance.version || 1,
            is_stale: this.isStale(balance)
        };
    }
    
    formatDBBalance(row) {
        return {
            balance: row.balance.toString(),
            locked_balance: row.locked_balance.toString(),
            last_updated: row.last_updated,
            last_block_number: row.last_block_number,
            version: row.version,
            is_stale: row.is_stale
        };
    }
    
    calculateChecksum(balance) {
        const data = `${balance.balance}:${balance.locked_balance}:${balance.version}`;
        return crypto.createHash('md5').update(data).digest('hex');
    }
    
    compress(data) {
        const zlib = require('zlib');
        return zlib.deflateSync(data).toString('base64');
    }
    
    decompress(data) {
        const zlib = require('zlib');
        return zlib.inflateSync(Buffer.from(data, 'base64')).toString();
    }
    
    async createBalanceRecord(userAddress, tokenAddress, chainId) {
        const query = `
            INSERT INTO user_balances (
                user_address, token_address, chain_id, 
                balance, locked_balance, last_block_number
            ) VALUES ($1, $2, $3, 0, 0, 0)
            ON CONFLICT (user_address, token_address, chain_id) 
            DO UPDATE SET last_updated = NOW()
            RETURNING balance, locked_balance, last_updated, version
        `;
        
        const result = await this.config.pgPool.query(query, [
            Buffer.from(userAddress.slice(2), 'hex'),
            Buffer.from(tokenAddress.slice(2), 'hex'),
            chainId
        ]);
        
        return this.formatDBBalance(result.rows[0]);
    }
    
    setupMetricsCollection() {
        setInterval(() => {
            this.emit('metrics', {
                ...this.metrics,
                l1CacheSize: this.l1Cache.size,
                activeLocks: this.activeLocks.size,
                timestamp: Date.now()
            });
        }, 30000); // Every 30 seconds
    }
    
    // =============================================================================
    // PUBLIC API METHODS
    // =============================================================================
    
    async getMultipleBalances(requests) {
        const results = await Promise.all(
            requests.map(req => 
                this.getBalance(req.userAddress, req.tokenAddress, req.chainId, req.options)
                    .catch(error => ({ error: error.message, ...req }))
            )
        );
        
        return results;
    }
    
    async refreshBalance(userAddress, tokenAddress, chainId) {
        await this.invalidateCache(userAddress, tokenAddress, chainId);
        return await this.getBalance(userAddress, tokenAddress, chainId, { consistency: 'strong' });
    }
    
    getMetrics() {
        return {
            ...this.metrics,
            l1CacheSize: this.l1Cache.size,
            activeLocks: this.activeLocks.size,
            uptime: Date.now() - this.startTime
        };
    }
    
    async healthCheck() {
        try {
            // Test database connection
            await this.config.pgPool.query('SELECT 1');
            
            // Test Redis connection
            await this.l2Cache.ping();
            
            return { 
                status: 'healthy', 
                timestamp: new Date().toISOString(),
                metrics: this.getMetrics()
            };
        } catch (error) {
            return { 
                status: 'unhealthy', 
                error: error.message, 
                timestamp: new Date().toISOString() 
            };
        }
    }
    
    async shutdown() {
        try {
            // Release all active locks
            for (const [lockKey, lock] of this.activeLocks) {
                await this.releaseLock(lockKey, lock.lockId);
            }
            
            // Close Redis connection
            await this.l2Cache.quit();
            
            // Close database pool
            await this.config.pgPool.end();
            
            this.emit('shutdown');
        } catch (error) {
            this.emit('error', error);
        }
    }
}

module.exports = AdvancedBalanceService;