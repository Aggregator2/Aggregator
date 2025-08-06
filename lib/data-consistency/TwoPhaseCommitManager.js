/**
 * @fileoverview Two-Phase Commit Manager for Distributed Transactions
 * @author SwappiQ Protocol
 * @description Implements 2PC protocol for critical operations across multiple databases/services
 */

const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const EventEmitter = require('events');
const crypto = require('crypto');
const Redis = require('ioredis');

/**
 * Two-Phase Commit Manager for distributed transaction coordination
 */
class TwoPhaseCommitManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Transaction settings
            transaction: {
                timeout: config.transaction?.timeout || 30000, // 30 seconds
                maxRetries: config.transaction?.maxRetries || 3,
                retryDelay: config.transaction?.retryDelay || 1000,
                isolationLevel: config.transaction?.isolationLevel || 'SERIALIZABLE'
            },
            
            // Coordinator settings
            coordinator: {
                nodeId: config.coordinator?.nodeId || crypto.randomUUID(),
                heartbeatInterval: config.coordinator?.heartbeatInterval || 5000,
                deadNodeTimeout: config.coordinator?.deadNodeTimeout || 15000,
                persistState: config.coordinator?.persistState !== false
            },
            
            // Participant settings
            participants: {
                prepareTimeout: config.participants?.prepareTimeout || 10000,
                commitTimeout: config.participants?.commitTimeout || 10000,
                rollbackTimeout: config.participants?.rollbackTimeout || 10000
            },
            
            // Recovery settings
            recovery: {
                enabled: config.recovery?.enabled !== false,
                checkInterval: config.recovery?.checkInterval || 60000,
                maxAge: config.recovery?.maxAge || 3600000, // 1 hour
                logRetention: config.recovery?.logRetention || 7 * 24 * 3600000 // 7 days
            },
            
            // Redis for distributed state
            redis: {
                host: config.redis?.host || 'localhost',
                port: config.redis?.port || 6379,
                keyPrefix: config.redis?.keyPrefix || 'swappiq:2pc:',
                ttl: config.redis?.ttl || 3600 // 1 hour
            },
            
            // Database connections
            databases: config.databases || {},
            
            // Monitoring
            monitoring: {
                enabled: config.monitoring?.enabled !== false,
                metricsInterval: config.monitoring?.metricsInterval || 10000
            },
            
            verbose: config.verbose || false,
            ...config
        };

        // State management
        this.state = {
            activeTransactions: new Map(),
            preparedTransactions: new Map(),
            completedTransactions: new Map(),
            participants: new Map(),
            metrics: {
                totalTransactions: 0,
                committedTransactions: 0,
                abortedTransactions: 0,
                timedOutTransactions: 0,
                averageDuration: 0,
                errors: 0
            }
        };

        // Initialize connections
        this.redis = null;
        this.prisma = null;
        this.pools = new Map();
        
        // Timers
        this.heartbeatTimer = null;
        this.recoveryTimer = null;
        this.metricsTimer = null;
    }

    /**
     * Initialize the 2PC manager
     */
    async initialize() {
        try {
            // Initialize Redis
            this.redis = new Redis({
                host: this.config.redis.host,
                port: this.config.redis.port,
                keyPrefix: this.config.redis.keyPrefix
            });

            // Initialize Prisma
            this.prisma = new PrismaClient({
                log: this.config.verbose ? ['query', 'info', 'warn', 'error'] : ['error']
            });

            // Initialize database pools
            for (const [name, config] of Object.entries(this.config.databases)) {
                const pool = new Pool(config);
                await pool.query('SELECT 1'); // Test connection
                this.pools.set(name, pool);
            }

            // Start coordinator heartbeat
            this._startHeartbeat();

            // Start recovery process
            if (this.config.recovery.enabled) {
                this._startRecovery();
            }

            // Start monitoring
            if (this.config.monitoring.enabled) {
                this._startMonitoring();
            }

            // Recover pending transactions
            await this._recoverPendingTransactions();

            console.log('Two-Phase Commit Manager initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize 2PC Manager:', error);
            throw error;
        }
    }

    /**
     * Execute a distributed transaction using 2PC
     */
    async executeTransaction(operations, options = {}) {
        const transactionId = crypto.randomUUID();
        const startTime = Date.now();
        
        const transaction = {
            id: transactionId,
            status: 'INITIATED',
            operations,
            participants: [],
            preparedParticipants: new Set(),
            startTime,
            options: {
                timeout: options.timeout || this.config.transaction.timeout,
                isolationLevel: options.isolationLevel || this.config.transaction.isolationLevel,
                metadata: options.metadata || {}
            }
        };

        this.state.activeTransactions.set(transactionId, transaction);

        try {
            // Phase 1: Prepare
            const prepareSuccess = await this._preparePhase(transaction);
            
            if (!prepareSuccess) {
                await this._abortTransaction(transaction);
                throw new Error('Prepare phase failed');
            }

            // Phase 2: Commit
            const commitSuccess = await this._commitPhase(transaction);
            
            if (!commitSuccess) {
                await this._abortTransaction(transaction);
                throw new Error('Commit phase failed');
            }

            // Update metrics
            const duration = Date.now() - startTime;
            this._updateMetrics('committed', duration);

            // Log success
            await this._logTransactionResult(transaction, 'COMMITTED', duration);

            this.emit('transactionCommitted', {
                transactionId,
                duration,
                operations: operations.length
            });

            return {
                success: true,
                transactionId,
                duration
            };

        } catch (error) {
            console.error(`Transaction ${transactionId} failed:`, error);
            
            // Update metrics
            this._updateMetrics('aborted', Date.now() - startTime);

            // Log failure
            await this._logTransactionResult(transaction, 'ABORTED', Date.now() - startTime, error);

            throw error;
            
        } finally {
            // Clean up
            this.state.activeTransactions.delete(transactionId);
            
            // Move to completed transactions for history
            this.state.completedTransactions.set(transactionId, {
                ...transaction,
                endTime: Date.now()
            });
        }
    }

    /**
     * Execute critical order matching with 2PC
     */
    async executeOrderMatch(buyOrder, sellOrder, matchDetails) {
        const operations = [
            // Update buy order
            {
                type: 'UPDATE_ORDER',
                participant: 'orders',
                data: {
                    orderId: buyOrder.id,
                    filledQuantity: buyOrder.filledQuantity + matchDetails.quantity,
                    remainingQuantity: buyOrder.remainingQuantity - matchDetails.quantity,
                    status: matchDetails.quantity >= buyOrder.remainingQuantity ? 'FILLED' : 'PARTIALLY_FILLED'
                }
            },
            // Update sell order
            {
                type: 'UPDATE_ORDER',
                participant: 'orders',
                data: {
                    orderId: sellOrder.id,
                    filledQuantity: sellOrder.filledQuantity + matchDetails.quantity,
                    remainingQuantity: sellOrder.remainingQuantity - matchDetails.quantity,
                    status: matchDetails.quantity >= sellOrder.remainingQuantity ? 'FILLED' : 'PARTIALLY_FILLED'
                }
            },
            // Create trade record
            {
                type: 'CREATE_TRADE',
                participant: 'trades',
                data: {
                    buyOrderId: buyOrder.id,
                    sellOrderId: sellOrder.id,
                    price: matchDetails.price,
                    quantity: matchDetails.quantity,
                    buyerId: buyOrder.userId,
                    sellerId: sellOrder.userId
                }
            },
            // Update buyer balance
            {
                type: 'UPDATE_BALANCE',
                participant: 'balances',
                data: {
                    userId: buyOrder.userId,
                    asset: matchDetails.baseAsset,
                    operation: 'ADD',
                    amount: matchDetails.quantity
                }
            },
            // Update seller balance
            {
                type: 'UPDATE_BALANCE',
                participant: 'balances',
                data: {
                    userId: sellOrder.userId,
                    asset: matchDetails.quoteAsset,
                    operation: 'ADD',
                    amount: matchDetails.quantity * matchDetails.price
                }
            }
        ];

        return await this.executeTransaction(operations, {
            metadata: {
                type: 'ORDER_MATCH',
                buyOrderId: buyOrder.id,
                sellOrderId: sellOrder.id,
                pair: matchDetails.pair
            }
        });
    }

    /**
     * Execute withdrawal with 2PC
     */
    async executeWithdrawal(userId, asset, amount, address) {
        const operations = [
            // Check and lock balance
            {
                type: 'LOCK_BALANCE',
                participant: 'balances',
                data: {
                    userId,
                    asset,
                    amount
                }
            },
            // Create withdrawal transaction
            {
                type: 'CREATE_TRANSACTION',
                participant: 'transactions',
                data: {
                    userId,
                    type: 'WITHDRAWAL',
                    asset,
                    amount,
                    toAddress: address,
                    status: 'PENDING'
                }
            },
            // Update balance
            {
                type: 'UPDATE_BALANCE',
                participant: 'balances',
                data: {
                    userId,
                    asset,
                    operation: 'SUBTRACT',
                    amount
                }
            },
            // Queue blockchain transaction
            {
                type: 'QUEUE_BLOCKCHAIN_TX',
                participant: 'blockchain',
                data: {
                    userId,
                    asset,
                    amount,
                    toAddress: address
                }
            }
        ];

        return await this.executeTransaction(operations, {
            metadata: {
                type: 'WITHDRAWAL',
                userId,
                asset,
                amount
            }
        });
    }

    // ========== PRIVATE METHODS ==========

    async _preparePhase(transaction) {
        console.log(`Starting prepare phase for transaction ${transaction.id}`);
        
        const preparePromises = [];
        const timeout = setTimeout(() => {
            throw new Error('Prepare phase timeout');
        }, transaction.options.timeout);

        try {
            // Group operations by participant
            const operationsByParticipant = this._groupOperationsByParticipant(transaction.operations);
            
            // Send prepare requests to all participants
            for (const [participant, operations] of operationsByParticipant) {
                preparePromises.push(
                    this._prepareParticipant(transaction.id, participant, operations)
                );
            }

            // Wait for all prepare responses
            const results = await Promise.allSettled(preparePromises);
            
            // Check if all participants are prepared
            const allPrepared = results.every(result => 
                result.status === 'fulfilled' && result.value === true
            );

            if (allPrepared) {
                transaction.status = 'PREPARED';
                await this._persistTransactionState(transaction);
            }

            clearTimeout(timeout);
            return allPrepared;

        } catch (error) {
            clearTimeout(timeout);
            console.error('Prepare phase error:', error);
            return false;
        }
    }

    async _prepareParticipant(transactionId, participant, operations) {
        try {
            // Get participant connection
            const connection = await this._getParticipantConnection(participant);
            
            // Begin transaction with proper isolation
            await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            
            // Execute operations
            for (const operation of operations) {
                await this._executeOperation(connection, operation);
            }

            // Prepare transaction (PostgreSQL specific)
            await connection.query(`PREPARE TRANSACTION '${transactionId}'`);
            
            // Record prepared state
            this.state.preparedTransactions.set(`${transactionId}:${participant}`, {
                transactionId,
                participant,
                operations,
                preparedAt: Date.now()
            });

            return true;

        } catch (error) {
            console.error(`Failed to prepare participant ${participant}:`, error);
            return false;
        }
    }

    async _commitPhase(transaction) {
        console.log(`Starting commit phase for transaction ${transaction.id}`);
        
        const commitPromises = [];
        const timeout = setTimeout(() => {
            throw new Error('Commit phase timeout');
        }, this.config.participants.commitTimeout);

        try {
            // Send commit requests to all prepared participants
            const operationsByParticipant = this._groupOperationsByParticipant(transaction.operations);
            
            for (const [participant] of operationsByParticipant) {
                commitPromises.push(
                    this._commitParticipant(transaction.id, participant)
                );
            }

            // Wait for all commit responses
            const results = await Promise.allSettled(commitPromises);
            
            // Check if all participants committed
            const allCommitted = results.every(result => 
                result.status === 'fulfilled' && result.value === true
            );

            if (allCommitted) {
                transaction.status = 'COMMITTED';
                await this._persistTransactionState(transaction);
            }

            clearTimeout(timeout);
            return allCommitted;

        } catch (error) {
            clearTimeout(timeout);
            console.error('Commit phase error:', error);
            return false;
        }
    }

    async _commitParticipant(transactionId, participant) {
        try {
            const connection = await this._getParticipantConnection(participant);
            
            // Commit prepared transaction
            await connection.query(`COMMIT PREPARED '${transactionId}'`);
            
            // Clean up prepared state
            this.state.preparedTransactions.delete(`${transactionId}:${participant}`);
            
            return true;

        } catch (error) {
            console.error(`Failed to commit participant ${participant}:`, error);
            return false;
        }
    }

    async _abortTransaction(transaction) {
        console.log(`Aborting transaction ${transaction.id}`);
        
        const operationsByParticipant = this._groupOperationsByParticipant(transaction.operations);
        
        // Rollback all prepared participants
        const rollbackPromises = [];
        
        for (const [participant] of operationsByParticipant) {
            if (this.state.preparedTransactions.has(`${transaction.id}:${participant}`)) {
                rollbackPromises.push(
                    this._rollbackParticipant(transaction.id, participant)
                );
            }
        }

        await Promise.allSettled(rollbackPromises);
        
        transaction.status = 'ABORTED';
        await this._persistTransactionState(transaction);
    }

    async _rollbackParticipant(transactionId, participant) {
        try {
            const connection = await this._getParticipantConnection(participant);
            
            // Rollback prepared transaction
            await connection.query(`ROLLBACK PREPARED '${transactionId}'`);
            
            // Clean up prepared state
            this.state.preparedTransactions.delete(`${transactionId}:${participant}`);
            
            return true;

        } catch (error) {
            console.error(`Failed to rollback participant ${participant}:`, error);
            return false;
        }
    }

    async _executeOperation(connection, operation) {
        switch (operation.type) {
            case 'UPDATE_ORDER':
                return await this._updateOrder(connection, operation.data);
            
            case 'CREATE_TRADE':
                return await this._createTrade(connection, operation.data);
            
            case 'UPDATE_BALANCE':
                return await this._updateBalance(connection, operation.data);
            
            case 'LOCK_BALANCE':
                return await this._lockBalance(connection, operation.data);
            
            case 'CREATE_TRANSACTION':
                return await this._createTransaction(connection, operation.data);
            
            case 'QUEUE_BLOCKCHAIN_TX':
                return await this._queueBlockchainTx(connection, operation.data);
            
            default:
                throw new Error(`Unknown operation type: ${operation.type}`);
        }
    }

    async _updateOrder(connection, data) {
        const query = `
            UPDATE "Order" 
            SET 
                "filledQuantity" = $1,
                "remainingQuantity" = $2,
                status = $3,
                "updatedAt" = NOW()
            WHERE id = $4
        `;
        
        await connection.query(query, [
            data.filledQuantity,
            data.remainingQuantity,
            data.status,
            data.orderId
        ]);
    }

    async _createTrade(connection, data) {
        const query = `
            INSERT INTO "Trade" (
                id, "pairId", "buyOrderId", "sellOrderId",
                price, quantity, "quoteQuantity",
                "buyerId", "sellerId",
                "buyerCommission", "sellerCommission",
                "isMaker", "executedAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        `;
        
        await connection.query(query, [
            crypto.randomUUID(),
            data.pairId,
            data.buyOrderId,
            data.sellOrderId,
            data.price,
            data.quantity,
            data.quantity * data.price,
            data.buyerId,
            data.sellerId,
            data.buyerCommission || 0,
            data.sellerCommission || 0,
            data.isMaker || false
        ]);
    }

    async _updateBalance(connection, data) {
        const field = data.operation === 'ADD' ? 'available' : 'available';
        const operator = data.operation === 'ADD' ? '+' : '-';
        
        const query = `
            UPDATE "Balance" 
            SET 
                ${field} = ${field} ${operator} $1,
                total = available + locked,
                "updatedAt" = NOW()
            WHERE "userId" = $2 AND asset = $3
        `;
        
        await connection.query(query, [data.amount, data.userId, data.asset]);
    }

    async _lockBalance(connection, data) {
        const query = `
            UPDATE "Balance" 
            SET 
                available = available - $1,
                locked = locked + $1,
                "updatedAt" = NOW()
            WHERE "userId" = $2 AND asset = $3 AND available >= $1
        `;
        
        const result = await connection.query(query, [data.amount, data.userId, data.asset]);
        
        if (result.rowCount === 0) {
            throw new Error('Insufficient balance');
        }
    }

    async _createTransaction(connection, data) {
        const query = `
            INSERT INTO "Transaction" (
                id, "userId", type, status, asset, amount,
                "toAddress", "createdAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `;
        
        await connection.query(query, [
            crypto.randomUUID(),
            data.userId,
            data.type,
            data.status,
            data.asset,
            data.amount,
            data.toAddress
        ]);
    }

    async _queueBlockchainTx(connection, data) {
        // Queue transaction for blockchain processing
        // This would integrate with your blockchain service
        await this.redis.lpush('blockchain:withdrawal:queue', JSON.stringify({
            ...data,
            queuedAt: Date.now()
        }));
    }

    _groupOperationsByParticipant(operations) {
        const grouped = new Map();
        
        for (const operation of operations) {
            const participant = operation.participant;
            if (!grouped.has(participant)) {
                grouped.set(participant, []);
            }
            grouped.get(participant).push(operation);
        }
        
        return grouped;
    }

    async _getParticipantConnection(participant) {
        // Map participant to database pool
        const poolMapping = {
            'orders': 'main',
            'trades': 'main',
            'balances': 'main',
            'transactions': 'main',
            'blockchain': 'blockchain'
        };
        
        const poolName = poolMapping[participant] || 'main';
        const pool = this.pools.get(poolName);
        
        if (!pool) {
            throw new Error(`No pool found for participant: ${participant}`);
        }
        
        return await pool.connect();
    }

    async _persistTransactionState(transaction) {
        if (!this.config.coordinator.persistState) return;
        
        const key = `transaction:${transaction.id}`;
        await this.redis.setex(
            key,
            this.config.redis.ttl,
            JSON.stringify(transaction)
        );
    }

    async _logTransactionResult(transaction, status, duration, error = null) {
        const logEntry = {
            transactionId: transaction.id,
            status,
            duration,
            operations: transaction.operations.length,
            startTime: new Date(transaction.startTime).toISOString(),
            endTime: new Date().toISOString(),
            metadata: transaction.options.metadata,
            error: error ? error.message : null
        };
        
        // Log to database
        if (this.prisma) {
            await this.prisma.auditLog.create({
                data: {
                    action: 'TWO_PHASE_COMMIT',
                    category: 'SYSTEM',
                    severity: status === 'COMMITTED' ? 'LOW' : 'HIGH',
                    metadata: logEntry
                }
            });
        }
        
        // Log to Redis for quick access
        await this.redis.lpush(
            'transaction:logs',
            JSON.stringify(logEntry)
        );
        
        // Trim old logs
        await this.redis.ltrim('transaction:logs', 0, 9999);
    }

    async _recoverPendingTransactions() {
        console.log('Recovering pending transactions...');
        
        // Get all prepared transactions from Redis
        const keys = await this.redis.keys('transaction:*');
        
        for (const key of keys) {
            try {
                const data = await this.redis.get(key);
                const transaction = JSON.parse(data);
                
                if (transaction.status === 'PREPARED') {
                    // Transaction was prepared but not committed
                    // Need to check with participants and decide
                    await this._recoverTransaction(transaction);
                }
            } catch (error) {
                console.error(`Failed to recover transaction from ${key}:`, error);
            }
        }
    }

    async _recoverTransaction(transaction) {
        console.log(`Recovering transaction ${transaction.id}`);
        
        // Check age
        const age = Date.now() - transaction.startTime;
        if (age > this.config.recovery.maxAge) {
            // Too old, abort
            await this._abortTransaction(transaction);
            return;
        }
        
        // Check participant states
        const participantStates = await this._checkParticipantStates(transaction);
        
        if (participantStates.allPrepared) {
            // All participants are prepared, commit
            await this._commitPhase(transaction);
        } else {
            // Some participants not prepared, abort
            await this._abortTransaction(transaction);
        }
    }

    async _checkParticipantStates(transaction) {
        const operationsByParticipant = this._groupOperationsByParticipant(transaction.operations);
        const states = {
            allPrepared: true,
            anyCommitted: false
        };
        
        for (const [participant] of operationsByParticipant) {
            try {
                const connection = await this._getParticipantConnection(participant);
                
                // Check if transaction is prepared
                const result = await connection.query(`
                    SELECT gid, prepared, owner, database 
                    FROM pg_prepared_xacts 
                    WHERE gid = $1
                `, [transaction.id]);
                
                if (result.rows.length === 0) {
                    states.allPrepared = false;
                }
            } catch (error) {
                console.error(`Failed to check participant ${participant}:`, error);
                states.allPrepared = false;
            }
        }
        
        return states;
    }

    _startHeartbeat() {
        this.heartbeatTimer = setInterval(async () => {
            const heartbeat = {
                nodeId: this.config.coordinator.nodeId,
                timestamp: Date.now(),
                activeTransactions: this.state.activeTransactions.size,
                preparedTransactions: this.state.preparedTransactions.size
            };
            
            await this.redis.setex(
                `coordinator:${this.config.coordinator.nodeId}`,
                Math.ceil(this.config.coordinator.deadNodeTimeout / 1000),
                JSON.stringify(heartbeat)
            );
        }, this.config.coordinator.heartbeatInterval);
    }

    _startRecovery() {
        this.recoveryTimer = setInterval(async () => {
            try {
                // Check for dead coordinators
                const coordinatorKeys = await this.redis.keys('coordinator:*');
                
                for (const key of coordinatorKeys) {
                    const data = await this.redis.get(key);
                    if (!data) continue;
                    
                    const coordinator = JSON.parse(data);
                    const age = Date.now() - coordinator.timestamp;
                    
                    if (age > this.config.coordinator.deadNodeTimeout) {
                        console.log(`Coordinator ${coordinator.nodeId} is dead, taking over`);
                        // Take over transactions from dead coordinator
                        await this._takeOverTransactions(coordinator.nodeId);
                    }
                }
                
                // Clean up old completed transactions
                await this._cleanupOldTransactions();
                
            } catch (error) {
                console.error('Recovery process error:', error);
            }
        }, this.config.recovery.checkInterval);
    }

    async _takeOverTransactions(deadNodeId) {
        // Implementation depends on your specific requirements
        // This would involve finding transactions owned by the dead node
        // and attempting to recover them
    }

    async _cleanupOldTransactions() {
        const cutoffTime = Date.now() - this.config.recovery.logRetention;
        
        // Clean up completed transactions
        for (const [id, transaction] of this.state.completedTransactions) {
            if (transaction.endTime < cutoffTime) {
                this.state.completedTransactions.delete(id);
            }
        }
        
        // Clean up Redis entries
        const keys = await this.redis.keys('transaction:*');
        for (const key of keys) {
            const ttl = await this.redis.ttl(key);
            if (ttl === -1) {
                // No TTL set, check age manually
                const data = await this.redis.get(key);
                if (data) {
                    const transaction = JSON.parse(data);
                    if (transaction.startTime < cutoffTime) {
                        await this.redis.del(key);
                    }
                }
            }
        }
    }

    _startMonitoring() {
        this.metricsTimer = setInterval(() => {
            this.emit('metrics', {
                ...this.state.metrics,
                activeTransactions: this.state.activeTransactions.size,
                preparedTransactions: this.state.preparedTransactions.size,
                completedTransactions: this.state.completedTransactions.size
            });
        }, this.config.monitoring.metricsInterval);
    }

    _updateMetrics(result, duration) {
        this.state.metrics.totalTransactions++;
        
        if (result === 'committed') {
            this.state.metrics.committedTransactions++;
        } else if (result === 'aborted') {
            this.state.metrics.abortedTransactions++;
        } else if (result === 'timeout') {
            this.state.metrics.timedOutTransactions++;
        }
        
        // Update average duration
        const totalDuration = this.state.metrics.averageDuration * 
            (this.state.metrics.totalTransactions - 1) + duration;
        this.state.metrics.averageDuration = totalDuration / this.state.metrics.totalTransactions;
    }

    /**
     * Get transaction status
     */
    async getTransactionStatus(transactionId) {
        // Check active transactions
        if (this.state.activeTransactions.has(transactionId)) {
            return this.state.activeTransactions.get(transactionId);
        }
        
        // Check completed transactions
        if (this.state.completedTransactions.has(transactionId)) {
            return this.state.completedTransactions.get(transactionId);
        }
        
        // Check Redis
        const data = await this.redis.get(`transaction:${transactionId}`);
        if (data) {
            return JSON.parse(data);
        }
        
        return null;
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            activeTransactions: this.state.activeTransactions.size,
            preparedTransactions: this.state.preparedTransactions.size,
            completedTransactions: this.state.completedTransactions.size,
            uptime: Date.now() - this.startTime
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Clear timers
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.recoveryTimer) clearInterval(this.recoveryTimer);
        if (this.metricsTimer) clearInterval(this.metricsTimer);
        
        // Abort active transactions
        for (const [id, transaction] of this.state.activeTransactions) {
            await this._abortTransaction(transaction);
        }
        
        // Close connections
        if (this.redis) await this.redis.quit();
        if (this.prisma) await this.prisma.$disconnect();
        
        for (const [name, pool] of this.pools) {
            await pool.end();
        }
        
        console.log('Two-Phase Commit Manager cleaned up');
    }
}

module.exports = { TwoPhaseCommitManager };