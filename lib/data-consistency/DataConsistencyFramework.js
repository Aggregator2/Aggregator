/**
 * @fileoverview Data Consistency Framework
 * @author SwappiQ Protocol
 * @description Comprehensive framework for maintaining data consistency across the platform
 */

const { TwoPhaseCommitManager } = require('./TwoPhaseCommitManager');
const { PrismaClient } = require('@prisma/client');
const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * Data Consistency Framework for SwappiQ Protocol
 */
class DataConsistencyFramework extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Consistency levels
            consistency: {
                level: config.consistency?.level || 'STRONG', // STRONG, EVENTUAL, CAUSAL
                readPreference: config.consistency?.readPreference || 'PRIMARY',
                writePreference: config.consistency?.writePreference || 'PRIMARY',
                replicationFactor: config.consistency?.replicationFactor || 3
            },
            
            // Validation settings
            validation: {
                enabled: config.validation?.enabled !== false,
                preValidation: config.validation?.preValidation !== false,
                postValidation: config.validation?.postValidation !== false,
                periodicChecks: config.validation?.periodicChecks !== false,
                checkInterval: config.validation?.checkInterval || 300000 // 5 minutes
            },
            
            // Conflict resolution
            conflictResolution: {
                strategy: config.conflictResolution?.strategy || 'LAST_WRITE_WINS',
                customResolver: config.conflictResolution?.customResolver,
                retryAttempts: config.conflictResolution?.retryAttempts || 3,
                retryDelay: config.conflictResolution?.retryDelay || 1000
            },
            
            // Data integrity
            integrity: {
                checksums: config.integrity?.checksums !== false,
                encryption: config.integrity?.encryption !== false,
                auditTrail: config.integrity?.auditTrail !== false,
                tamperDetection: config.integrity?.tamperDetection !== false
            },
            
            // Recovery settings
            recovery: {
                enabled: config.recovery?.enabled !== false,
                snapshotInterval: config.recovery?.snapshotInterval || 3600000, // 1 hour
                retentionPeriod: config.recovery?.retentionPeriod || 7 * 24 * 3600000 // 7 days
            },
            
            // Monitoring
            monitoring: {
                enabled: config.monitoring?.enabled !== false,
                alertThresholds: config.monitoring?.alertThresholds || {
                    inconsistencyRate: 0.01, // 1%
                    validationFailureRate: 0.05, // 5%
                    replicationLag: 5000 // 5 seconds
                }
            },
            
            ...config
        };

        // Initialize components
        this.twoPhaseCommit = null;
        this.prisma = null;
        
        // State management
        this.state = {
            validators: new Map(),
            consistencyChecks: new Map(),
            pendingOperations: new Map(),
            metrics: {
                totalOperations: 0,
                consistentOperations: 0,
                inconsistentOperations: 0,
                validationFailures: 0,
                conflictsResolved: 0,
                averageValidationTime: 0
            }
        };

        // Timers
        this.validationTimer = null;
        this.snapshotTimer = null;
    }

    /**
     * Initialize the framework
     */
    async initialize() {
        try {
            // Initialize Prisma
            this.prisma = new PrismaClient({
                log: ['error', 'warn']
            });

            // Initialize 2PC manager
            this.twoPhaseCommit = new TwoPhaseCommitManager({
                databases: this.config.databases,
                redis: this.config.redis,
                coordinator: {
                    nodeId: `consistency-${crypto.randomUUID()}`
                }
            });
            
            await this.twoPhaseCommit.initialize();

            // Register validators
            this._registerValidators();

            // Start periodic validation
            if (this.config.validation.periodicChecks) {
                this._startPeriodicValidation();
            }

            // Start snapshot process
            if (this.config.recovery.enabled) {
                this._startSnapshotProcess();
            }

            console.log('Data Consistency Framework initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Data Consistency Framework:', error);
            throw error;
        }
    }

    /**
     * Execute operation with consistency guarantees
     */
    async executeWithConsistency(operation, options = {}) {
        const operationId = crypto.randomUUID();
        const startTime = Date.now();
        
        try {
            // Pre-validation
            if (this.config.validation.preValidation) {
                await this._preValidate(operation);
            }

            // Execute based on consistency level
            let result;
            
            switch (this.config.consistency.level) {
                case 'STRONG':
                    result = await this._executeStrongConsistency(operation, options);
                    break;
                
                case 'EVENTUAL':
                    result = await this._executeEventualConsistency(operation, options);
                    break;
                
                case 'CAUSAL':
                    result = await this._executeCausalConsistency(operation, options);
                    break;
                
                default:
                    throw new Error(`Unknown consistency level: ${this.config.consistency.level}`);
            }

            // Post-validation
            if (this.config.validation.postValidation) {
                await this._postValidate(operation, result);
            }

            // Update metrics
            this._updateMetrics('success', Date.now() - startTime);

            return {
                success: true,
                operationId,
                result,
                duration: Date.now() - startTime
            };

        } catch (error) {
            console.error(`Operation ${operationId} failed:`, error);
            
            // Update metrics
            this._updateMetrics('failure', Date.now() - startTime);

            // Attempt recovery
            if (options.recover !== false) {
                return await this._attemptRecovery(operation, error, options);
            }

            throw error;
        }
    }

    /**
     * Validate data consistency across entities
     */
    async validateConsistency(entities, options = {}) {
        const results = {
            valid: true,
            issues: [],
            suggestions: []
        };

        for (const entity of entities) {
            try {
                const validation = await this._validateEntity(entity, options);
                
                if (!validation.valid) {
                    results.valid = false;
                    results.issues.push(...validation.issues);
                }
                
                results.suggestions.push(...validation.suggestions);
                
            } catch (error) {
                results.valid = false;
                results.issues.push({
                    entity: entity.type,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Repair inconsistent data
     */
    async repairInconsistencies(issues, options = {}) {
        const results = {
            repaired: [],
            failed: [],
            skipped: []
        };

        for (const issue of issues) {
            try {
                if (options.dryRun) {
                    results.skipped.push({
                        issue,
                        action: this._getRepairAction(issue)
                    });
                    continue;
                }

                const repaired = await this._repairIssue(issue, options);
                
                if (repaired) {
                    results.repaired.push(issue);
                } else {
                    results.failed.push(issue);
                }
                
            } catch (error) {
                results.failed.push({
                    issue,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Create consistency snapshot
     */
    async createSnapshot(options = {}) {
        const snapshotId = crypto.randomUUID();
        const timestamp = Date.now();
        
        try {
            const snapshot = {
                id: snapshotId,
                timestamp,
                entities: {}
            };

            // Snapshot user balances
            snapshot.entities.balances = await this._snapshotBalances();
            
            // Snapshot open orders
            snapshot.entities.orders = await this._snapshotOrders();
            
            // Snapshot system state
            snapshot.entities.system = await this._snapshotSystemState();
            
            // Calculate checksums
            if (this.config.integrity.checksums) {
                snapshot.checksums = this._calculateChecksums(snapshot.entities);
            }

            // Store snapshot
            await this._storeSnapshot(snapshot);

            this.emit('snapshotCreated', {
                snapshotId,
                timestamp,
                size: JSON.stringify(snapshot).length
            });

            return {
                success: true,
                snapshotId,
                timestamp
            };

        } catch (error) {
            console.error('Failed to create snapshot:', error);
            throw error;
        }
    }

    /**
     * Restore from snapshot
     */
    async restoreFromSnapshot(snapshotId, options = {}) {
        try {
            // Load snapshot
            const snapshot = await this._loadSnapshot(snapshotId);
            
            if (!snapshot) {
                throw new Error(`Snapshot ${snapshotId} not found`);
            }

            // Verify integrity
            if (this.config.integrity.checksums) {
                const valid = await this._verifyChecksums(snapshot);
                if (!valid) {
                    throw new Error('Snapshot integrity check failed');
                }
            }

            // Restore entities
            const operations = [];
            
            for (const [entityType, data] of Object.entries(snapshot.entities)) {
                operations.push({
                    type: 'RESTORE_ENTITY',
                    participant: entityType,
                    data
                });
            }

            // Execute restoration with 2PC
            const result = await this.twoPhaseCommit.executeTransaction(operations, {
                metadata: {
                    type: 'SNAPSHOT_RESTORE',
                    snapshotId,
                    timestamp: snapshot.timestamp
                }
            });

            this.emit('snapshotRestored', {
                snapshotId,
                success: result.success
            });

            return result;

        } catch (error) {
            console.error('Failed to restore from snapshot:', error);
            throw error;
        }
    }

    // ========== CONSISTENCY IMPLEMENTATIONS ==========

    async _executeStrongConsistency(operation, options) {
        // Use 2PC for strong consistency
        return await this.twoPhaseCommit.executeTransaction([operation], {
            ...options,
            isolationLevel: 'SERIALIZABLE'
        });
    }

    async _executeEventualConsistency(operation, options) {
        // Queue operation for eventual consistency
        const operationId = crypto.randomUUID();
        
        this.state.pendingOperations.set(operationId, {
            operation,
            timestamp: Date.now(),
            retries: 0
        });

        // Execute asynchronously
        setImmediate(async () => {
            try {
                await this._processPendingOperation(operationId);
            } catch (error) {
                console.error(`Failed to process operation ${operationId}:`, error);
            }
        });

        return { operationId, status: 'PENDING' };
    }

    async _executeCausalConsistency(operation, options) {
        // Ensure causal ordering
        const dependencies = options.dependencies || [];
        
        // Wait for dependencies
        for (const depId of dependencies) {
            await this._waitForOperation(depId);
        }

        // Execute operation
        return await this._executeStrongConsistency(operation, options);
    }

    // ========== VALIDATION METHODS ==========

    _registerValidators() {
        // Balance validator
        this.state.validators.set('balance', {
            validate: async (entity) => {
                const issues = [];
                
                // Check balance consistency
                if (entity.total !== entity.available + entity.locked) {
                    issues.push({
                        type: 'BALANCE_MISMATCH',
                        entity: 'balance',
                        id: entity.id,
                        expected: entity.available + entity.locked,
                        actual: entity.total
                    });
                }

                // Check for negative values
                if (entity.available < 0 || entity.locked < 0 || entity.total < 0) {
                    issues.push({
                        type: 'NEGATIVE_BALANCE',
                        entity: 'balance',
                        id: entity.id,
                        values: {
                            available: entity.available,
                            locked: entity.locked,
                            total: entity.total
                        }
                    });
                }

                return { valid: issues.length === 0, issues };
            }
        });

        // Order validator
        this.state.validators.set('order', {
            validate: async (entity) => {
                const issues = [];
                
                // Check quantity consistency
                const expectedRemaining = entity.quantity - entity.filledQuantity;
                if (Math.abs(entity.remainingQuantity - expectedRemaining) > 0.00000001) {
                    issues.push({
                        type: 'ORDER_QUANTITY_MISMATCH',
                        entity: 'order',
                        id: entity.id,
                        expected: expectedRemaining,
                        actual: entity.remainingQuantity
                    });
                }

                // Check status consistency
                if (entity.filledQuantity === entity.quantity && entity.status !== 'FILLED') {
                    issues.push({
                        type: 'ORDER_STATUS_MISMATCH',
                        entity: 'order',
                        id: entity.id,
                        expectedStatus: 'FILLED',
                        actualStatus: entity.status
                    });
                }

                return { valid: issues.length === 0, issues };
            }
        });

        // Cross-entity validator
        this.state.validators.set('cross-entity', {
            validate: async (entities) => {
                const issues = [];
                
                // Validate order-balance consistency
                const openOrders = await this.prisma.order.findMany({
                    where: {
                        status: { in: ['NEW', 'PARTIALLY_FILLED'] }
                    },
                    include: {
                        pair: true
                    }
                });

                // Group orders by user and asset
                const lockedAmounts = new Map();
                
                for (const order of openOrders) {
                    const key = order.side === 'BUY' 
                        ? `${order.userId}:${order.pair.quoteAsset}`
                        : `${order.userId}:${order.pair.baseAsset}`;
                    
                    const amount = order.side === 'BUY'
                        ? order.remainingQuantity * order.price
                        : order.remainingQuantity;
                    
                    lockedAmounts.set(key, (lockedAmounts.get(key) || 0) + amount);
                }

                // Check against actual locked balances
                for (const [key, expectedLocked] of lockedAmounts) {
                    const [userId, asset] = key.split(':');
                    
                    const balance = await this.prisma.balance.findUnique({
                        where: {
                            userId_asset: { userId, asset }
                        }
                    });

                    if (balance && Math.abs(balance.locked - expectedLocked) > 0.00000001) {
                        issues.push({
                            type: 'LOCKED_BALANCE_MISMATCH',
                            entity: 'cross-entity',
                            userId,
                            asset,
                            expectedLocked,
                            actualLocked: balance.locked
                        });
                    }
                }

                return { valid: issues.length === 0, issues };
            }
        });
    }

    async _validateEntity(entity, options) {
        const validator = this.state.validators.get(entity.type);
        
        if (!validator) {
            throw new Error(`No validator found for entity type: ${entity.type}`);
        }

        return await validator.validate(entity.data || entity);
    }

    async _preValidate(operation) {
        // Validate operation structure
        if (!operation.type || !operation.participant || !operation.data) {
            throw new Error('Invalid operation structure');
        }

        // Type-specific validation
        switch (operation.type) {
            case 'UPDATE_BALANCE':
                if (!operation.data.userId || !operation.data.asset || !operation.data.amount) {
                    throw new Error('Missing required fields for balance update');
                }
                break;
            
            case 'CREATE_ORDER':
                if (!operation.data.userId || !operation.data.pairId || !operation.data.price) {
                    throw new Error('Missing required fields for order creation');
                }
                break;
        }
    }

    async _postValidate(operation, result) {
        // Verify operation success
        if (!result.success) {
            throw new Error('Operation failed validation');
        }

        // Type-specific post-validation
        switch (operation.type) {
            case 'UPDATE_BALANCE':
                // Verify balance was actually updated
                const balance = await this.prisma.balance.findUnique({
                    where: {
                        userId_asset: {
                            userId: operation.data.userId,
                            asset: operation.data.asset
                        }
                    }
                });

                if (!balance) {
                    throw new Error('Balance not found after update');
                }
                break;
        }
    }

    // ========== REPAIR METHODS ==========

    async _repairIssue(issue, options) {
        switch (issue.type) {
            case 'BALANCE_MISMATCH':
                return await this._repairBalanceMismatch(issue);
            
            case 'ORDER_QUANTITY_MISMATCH':
                return await this._repairOrderQuantity(issue);
            
            case 'LOCKED_BALANCE_MISMATCH':
                return await this._repairLockedBalance(issue);
            
            default:
                console.warn(`No repair strategy for issue type: ${issue.type}`);
                return false;
        }
    }

    async _repairBalanceMismatch(issue) {
        const operations = [{
            type: 'UPDATE_BALANCE_TOTAL',
            participant: 'balances',
            data: {
                balanceId: issue.id,
                total: issue.expected
            }
        }];

        const result = await this.twoPhaseCommit.executeTransaction(operations, {
            metadata: {
                type: 'BALANCE_REPAIR',
                issue: issue.type
            }
        });

        return result.success;
    }

    async _repairOrderQuantity(issue) {
        const operations = [{
            type: 'UPDATE_ORDER_QUANTITY',
            participant: 'orders',
            data: {
                orderId: issue.id,
                remainingQuantity: issue.expected
            }
        }];

        const result = await this.twoPhaseCommit.executeTransaction(operations, {
            metadata: {
                type: 'ORDER_REPAIR',
                issue: issue.type
            }
        });

        return result.success;
    }

    async _repairLockedBalance(issue) {
        const operations = [{
            type: 'UPDATE_LOCKED_BALANCE',
            participant: 'balances',
            data: {
                userId: issue.userId,
                asset: issue.asset,
                locked: issue.expectedLocked
            }
        }];

        const result = await this.twoPhaseCommit.executeTransaction(operations, {
            metadata: {
                type: 'LOCKED_BALANCE_REPAIR',
                issue: issue.type
            }
        });

        return result.success;
    }

    _getRepairAction(issue) {
        const actions = {
            'BALANCE_MISMATCH': 'Update total to match available + locked',
            'ORDER_QUANTITY_MISMATCH': 'Update remaining quantity to match quantity - filled',
            'LOCKED_BALANCE_MISMATCH': 'Recalculate locked balance from open orders',
            'NEGATIVE_BALANCE': 'Set negative values to zero and investigate',
            'ORDER_STATUS_MISMATCH': 'Update order status based on filled quantity'
        };

        return actions[issue.type] || 'Manual intervention required';
    }

    // ========== SNAPSHOT METHODS ==========

    async _snapshotBalances() {
        const balances = await this.prisma.balance.findMany({
            where: {
                total: { gt: 0 }
            }
        });

        return balances.map(b => ({
            id: b.id,
            userId: b.userId,
            asset: b.asset,
            available: b.available.toString(),
            locked: b.locked.toString(),
            total: b.total.toString()
        }));
    }

    async _snapshotOrders() {
        const orders = await this.prisma.order.findMany({
            where: {
                status: { in: ['NEW', 'PARTIALLY_FILLED'] }
            }
        });

        return orders.map(o => ({
            id: o.id,
            userId: o.userId,
            pairId: o.pairId,
            side: o.side,
            type: o.type,
            status: o.status,
            price: o.price.toString(),
            quantity: o.quantity.toString(),
            filledQuantity: o.filledQuantity.toString(),
            remainingQuantity: o.remainingQuantity.toString()
        }));
    }

    async _snapshotSystemState() {
        return {
            timestamp: Date.now(),
            metrics: this.state.metrics,
            activeValidators: Array.from(this.state.validators.keys()),
            pendingOperations: this.state.pendingOperations.size
        };
    }

    _calculateChecksums(entities) {
        const checksums = {};
        
        for (const [type, data] of Object.entries(entities)) {
            const hash = crypto.createHash('sha256');
            hash.update(JSON.stringify(data));
            checksums[type] = hash.digest('hex');
        }

        return checksums;
    }

    async _storeSnapshot(snapshot) {
        // Store in database
        await this.prisma.$executeRaw`
            INSERT INTO data_snapshots (id, data, created_at)
            VALUES (${snapshot.id}, ${JSON.stringify(snapshot)}, NOW())
        `;
    }

    async _loadSnapshot(snapshotId) {
        const result = await this.prisma.$queryRaw`
            SELECT data FROM data_snapshots WHERE id = ${snapshotId}
        `;

        return result[0]?.data;
    }

    async _verifyChecksums(snapshot) {
        if (!snapshot.checksums) return true;
        
        const calculated = this._calculateChecksums(snapshot.entities);
        
        for (const [type, checksum] of Object.entries(snapshot.checksums)) {
            if (calculated[type] !== checksum) {
                console.error(`Checksum mismatch for ${type}`);
                return false;
            }
        }

        return true;
    }

    // ========== PERIODIC TASKS ==========

    _startPeriodicValidation() {
        this.validationTimer = setInterval(async () => {
            try {
                const validation = await this.validateConsistency([
                    { type: 'cross-entity' }
                ]);

                if (!validation.valid) {
                    console.warn('Periodic validation found issues:', validation.issues);
                    
                    // Auto-repair if configured
                    if (this.config.validation.autoRepair) {
                        await this.repairInconsistencies(validation.issues);
                    }
                    
                    // Alert if threshold exceeded
                    const failureRate = validation.issues.length / this.state.metrics.totalOperations;
                    if (failureRate > this.config.monitoring.alertThresholds.inconsistencyRate) {
                        this.emit('consistencyAlert', {
                            type: 'HIGH_INCONSISTENCY_RATE',
                            rate: failureRate,
                            issues: validation.issues
                        });
                    }
                }
            } catch (error) {
                console.error('Periodic validation error:', error);
            }
        }, this.config.validation.checkInterval);
    }

    _startSnapshotProcess() {
        this.snapshotTimer = setInterval(async () => {
            try {
                await this.createSnapshot({
                    scheduled: true
                });
            } catch (error) {
                console.error('Snapshot creation error:', error);
            }
        }, this.config.recovery.snapshotInterval);
    }

    // ========== UTILITY METHODS ==========

    async _processPendingOperation(operationId) {
        const pending = this.state.pendingOperations.get(operationId);
        if (!pending) return;

        try {
            await this._executeStrongConsistency(pending.operation, {});
            this.state.pendingOperations.delete(operationId);
        } catch (error) {
            pending.retries++;
            
            if (pending.retries >= this.config.conflictResolution.retryAttempts) {
                console.error(`Operation ${operationId} failed after ${pending.retries} attempts`);
                this.state.pendingOperations.delete(operationId);
                throw error;
            }

            // Retry with exponential backoff
            setTimeout(() => {
                this._processPendingOperation(operationId);
            }, this.config.conflictResolution.retryDelay * Math.pow(2, pending.retries));
        }
    }

    async _waitForOperation(operationId) {
        const maxWait = 30000; // 30 seconds
        const checkInterval = 100;
        let waited = 0;

        while (this.state.pendingOperations.has(operationId) && waited < maxWait) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waited += checkInterval;
        }

        if (waited >= maxWait) {
            throw new Error(`Timeout waiting for operation ${operationId}`);
        }
    }

    async _attemptRecovery(operation, error, options) {
        console.log(`Attempting recovery for operation:`, operation);
        
        // Simple retry with backoff
        for (let i = 0; i < this.config.conflictResolution.retryAttempts; i++) {
            await new Promise(resolve => 
                setTimeout(resolve, this.config.conflictResolution.retryDelay * (i + 1))
            );

            try {
                return await this.executeWithConsistency(operation, {
                    ...options,
                    recover: false
                });
            } catch (retryError) {
                console.error(`Recovery attempt ${i + 1} failed:`, retryError);
            }
        }

        throw new Error(`Recovery failed after ${this.config.conflictResolution.retryAttempts} attempts`);
    }

    _updateMetrics(result, duration) {
        this.state.metrics.totalOperations++;
        
        if (result === 'success') {
            this.state.metrics.consistentOperations++;
        } else {
            this.state.metrics.inconsistentOperations++;
        }

        // Update average validation time
        const totalTime = this.state.metrics.averageValidationTime * 
            (this.state.metrics.totalOperations - 1) + duration;
        this.state.metrics.averageValidationTime = totalTime / this.state.metrics.totalOperations;
    }

    /**
     * Get consistency metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            consistencyRate: this.state.metrics.totalOperations > 0
                ? this.state.metrics.consistentOperations / this.state.metrics.totalOperations
                : 1,
            pendingOperations: this.state.pendingOperations.size,
            activeValidators: this.state.validators.size
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Clear timers
        if (this.validationTimer) clearInterval(this.validationTimer);
        if (this.snapshotTimer) clearInterval(this.snapshotTimer);
        
        // Cleanup components
        if (this.twoPhaseCommit) await this.twoPhaseCommit.cleanup();
        if (this.prisma) await this.prisma.$disconnect();
        
        console.log('Data Consistency Framework cleaned up');
    }
}

module.exports = { DataConsistencyFramework };