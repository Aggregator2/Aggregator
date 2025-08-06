/**
 * @title Event Store - Event Sourcing Implementation
 * @author DEX State Management Team
 * @notice Immutable event store for order lifecycle management with ACID guarantees
 * @dev Provides event sourcing foundation for distributed order book state management
 */

const { ethers } = require('ethers');
const crypto = require('crypto');

class EventStore {
    constructor(config) {
        this.config = {
            provider: new ethers.providers.JsonRpcProvider(config.rpcUrl),
            contractAddress: config.contractAddress,
            batchSize: config.batchSize || 1000,
            snapshotInterval: config.snapshotInterval || 10000, // Every 10k events
            retentionPeriod: config.retentionPeriod || 90 * 24 * 60 * 60 * 1000, // 90 days
            compressionEnabled: config.compressionEnabled || true,
            replicationNodes: config.replicationNodes || [],
            ...config
        };

        this.eventStream = new Map(); // In-memory event stream
        this.eventIndex = new Map(); // Fast lookup index
        this.snapshots = new Map(); // Periodic snapshots
        this.subscriptions = new Map(); // Event subscriptions
        this.sequenceNumber = 0;
        this.lastProcessedBlock = 0;
        
        // Conflict resolution and consensus
        this.conflictResolver = new ConflictResolver(config);
        this.consensusManager = new ConsensusManager(config);
        
        // Persistence layer
        this.persistenceManager = new PersistenceManager(config);
        
        // Initialize monitoring
        this.metrics = {
            eventsStored: 0,
            eventsReplayed: 0,
            snapshotsCreated: 0,
            conflictsResolved: 0,
            lastHealthCheck: Date.now()
        };

        this._startEventProcessing();
    }

    /**
     * Store event in event stream with ACID guarantees
     * @param {Object} event Event to store
     * @returns {Promise<string>} Event ID
     */
    async storeEvent(event) {
        try {
            // Validate event structure
            this._validateEvent(event);

            // Generate unique event ID with collision resistance
            const eventId = this._generateEventId(event);
            
            // Create immutable event record
            const eventRecord = this._createEventRecord(event, eventId);
            
            // Atomic write with conflict detection
            await this._atomicWrite(eventRecord);
            
            // Update indexes
            await this._updateIndexes(eventRecord);
            
            // Replicate to cluster nodes
            await this._replicateEvent(eventRecord);
            
            // Notify subscribers
            await this._notifySubscribers(eventRecord);
            
            this.metrics.eventsStored++;
            
            return eventId;

        } catch (error) {
            console.error('Failed to store event:', error);
            throw new Error(`Event storage failed: ${error.message}`);
        }
    }

    /**
     * Retrieve events by aggregate ID with pagination
     * @param {string} aggregateId Aggregate identifier
     * @param {Object} options Query options
     * @returns {Promise<Object[]>} Array of events
     */
    async getEvents(aggregateId, options = {}) {
        const {
            fromSequence = 0,
            toSequence = Number.MAX_SAFE_INTEGER,
            limit = 1000,
            includeSnapshots = false
        } = options;

        try {
            // Check for cached results
            const cacheKey = this._getCacheKey(aggregateId, options);
            const cached = await this._getCachedEvents(cacheKey);
            if (cached) return cached;

            // Retrieve events from store
            const events = await this._retrieveEvents(aggregateId, fromSequence, toSequence, limit);
            
            // Apply snapshots if requested
            if (includeSnapshots) {
                const snapshot = await this._getLatestSnapshot(aggregateId, fromSequence);
                if (snapshot) {
                    events.unshift(snapshot);
                }
            }
            
            // Cache results
            await this._cacheEvents(cacheKey, events);
            
            return events;

        } catch (error) {
            console.error('Failed to retrieve events:', error);
            throw new Error(`Event retrieval failed: ${error.message}`);
        }
    }

    /**
     * Replay events to reconstruct aggregate state
     * @param {string} aggregateId Aggregate identifier
     * @param {number} toSequence Target sequence number
     * @returns {Promise<Object>} Reconstructed state
     */
    async replayEvents(aggregateId, toSequence = Number.MAX_SAFE_INTEGER) {
        try {
            const startTime = Date.now();
            
            // Get initial state from snapshot
            const snapshot = await this._getLatestSnapshot(aggregateId, toSequence);
            let state = snapshot ? snapshot.state : this._getInitialState(aggregateId);
            let fromSequence = snapshot ? snapshot.sequence + 1 : 0;
            
            // Stream events in batches
            let batchStart = fromSequence;
            while (batchStart <= toSequence) {
                const batchEnd = Math.min(batchStart + this.config.batchSize - 1, toSequence);
                
                const events = await this._retrieveEvents(
                    aggregateId, 
                    batchStart, 
                    batchEnd, 
                    this.config.batchSize
                );
                
                if (events.length === 0) break;
                
                // Apply events to state
                for (const event of events) {
                    state = await this._applyEvent(state, event);
                }
                
                batchStart = batchEnd + 1;
            }
            
            const duration = Date.now() - startTime;
            this.metrics.eventsReplayed += (toSequence - fromSequence + 1);
            
            console.log(`Replayed ${toSequence - fromSequence + 1} events in ${duration}ms`);
            
            return {
                state,
                sequence: toSequence,
                timestamp: Date.now(),
                replayDuration: duration
            };

        } catch (error) {
            console.error('Failed to replay events:', error);
            throw new Error(`Event replay failed: ${error.message}`);
        }
    }

    /**
     * Create snapshot of aggregate state
     * @param {string} aggregateId Aggregate identifier
     * @param {Object} state Current state
     * @param {number} sequence Current sequence number
     * @returns {Promise<string>} Snapshot ID
     */
    async createSnapshot(aggregateId, state, sequence) {
        try {
            const snapshotId = this._generateSnapshotId(aggregateId, sequence);
            
            const snapshot = {
                id: snapshotId,
                aggregateId,
                sequence,
                state: this._deepClone(state),
                timestamp: Date.now(),
                version: this._getSnapshotVersion(),
                checksum: this._calculateChecksum(state)
            };
            
            // Compress snapshot if enabled
            if (this.config.compressionEnabled) {
                snapshot.compressed = await this._compressData(snapshot.state);
                delete snapshot.state; // Remove uncompressed data
            }
            
            // Store snapshot
            await this._storeSnapshot(snapshot);
            
            // Update snapshot index
            await this._updateSnapshotIndex(aggregateId, snapshotId, sequence);
            
            // Cleanup old snapshots
            await this._cleanupOldSnapshots(aggregateId);
            
            this.metrics.snapshotsCreated++;
            
            return snapshotId;

        } catch (error) {
            console.error('Failed to create snapshot:', error);
            throw new Error(`Snapshot creation failed: ${error.message}`);
        }
    }

    /**
     * Subscribe to events with filtering and real-time updates
     * @param {Object} subscription Subscription configuration
     * @returns {Promise<string>} Subscription ID
     */
    async subscribe(subscription) {
        try {
            const {
                aggregateId,
                eventTypes = [],
                fromSequence = 0,
                callback,
                filter = null,
                bufferSize = 100
            } = subscription;
            
            const subscriptionId = this._generateSubscriptionId();
            
            const subscriptionRecord = {
                id: subscriptionId,
                aggregateId,
                eventTypes: new Set(eventTypes),
                fromSequence,
                callback,
                filter,
                buffer: [],
                bufferSize,
                isActive: true,
                createdAt: Date.now(),
                lastDelivered: fromSequence - 1
            };
            
            this.subscriptions.set(subscriptionId, subscriptionRecord);
            
            // Send historical events
            await this._sendHistoricalEvents(subscriptionRecord);
            
            return subscriptionId;

        } catch (error) {
            console.error('Failed to create subscription:', error);
            throw new Error(`Subscription failed: ${error.message}`);
        }
    }

    /**
     * Process blockchain events for state recovery
     * @param {number} fromBlock Starting block number
     * @param {number} toBlock Ending block number
     * @returns {Promise<number>} Number of events processed
     */
    async processBlockchainEvents(fromBlock, toBlock = 'latest') {
        try {
            if (toBlock === 'latest') {
                toBlock = await this.config.provider.getBlockNumber();
            }
            
            let eventsProcessed = 0;
            let currentBlock = fromBlock;
            
            while (currentBlock <= toBlock) {
                const batchEnd = Math.min(currentBlock + 1000, toBlock); // Process 1000 blocks at a time
                
                // Get events from blockchain
                const blockchainEvents = await this._getBlockchainEvents(currentBlock, batchEnd);
                
                for (const blockchainEvent of blockchainEvents) {
                    try {
                        // Convert blockchain event to domain event
                        const domainEvent = await this._convertBlockchainEvent(blockchainEvent);
                        
                        if (domainEvent) {
                            // Store event with conflict resolution
                            await this._storeEventWithConflictResolution(domainEvent);
                            eventsProcessed++;
                        }
                    } catch (eventError) {
                        console.error(`Failed to process blockchain event:`, eventError);
                        // Continue processing other events
                    }
                }
                
                currentBlock = batchEnd + 1;
                this.lastProcessedBlock = batchEnd;
                
                // Yield control to prevent blocking
                await new Promise(resolve => setImmediate(resolve));
            }
            
            console.log(`Processed ${eventsProcessed} blockchain events from blocks ${fromBlock} to ${toBlock}`);
            return eventsProcessed;

        } catch (error) {
            console.error('Failed to process blockchain events:', error);
            throw new Error(`Blockchain event processing failed: ${error.message}`);
        }
    }

    // =============================================================================
    // PRIVATE METHODS - EVENT MANAGEMENT
    // =============================================================================

    /**
     * Validate event structure and content
     * @param {Object} event Event to validate
     * @private
     */
    _validateEvent(event) {
        const required = ['aggregateId', 'eventType', 'data', 'timestamp'];
        for (const field of required) {
            if (!event[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        if (typeof event.timestamp !== 'number' || event.timestamp <= 0) {
            throw new Error('Invalid timestamp');
        }
        
        if (typeof event.data !== 'object') {
            throw new Error('Event data must be an object');
        }
    }

    /**
     * Generate cryptographically secure event ID
     * @param {Object} event Event object
     * @returns {string} Unique event ID
     * @private
     */
    _generateEventId(event) {
        const data = JSON.stringify({
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            timestamp: event.timestamp,
            sequence: this.sequenceNumber,
            nonce: crypto.randomBytes(16).toString('hex')
        });
        
        return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(data));
    }

    /**
     * Create immutable event record
     * @param {Object} event Original event
     * @param {string} eventId Generated event ID
     * @returns {Object} Event record
     * @private
     */
    _createEventRecord(event, eventId) {
        return {
            id: eventId,
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            data: this._deepClone(event.data),
            metadata: {
                timestamp: event.timestamp,
                sequence: ++this.sequenceNumber,
                version: event.version || 1,
                causationId: event.causationId || null,
                correlationId: event.correlationId || null,
                userId: event.userId || null,
                source: event.source || 'system'
            },
            checksum: this._calculateEventChecksum(event),
            createdAt: Date.now()
        };
    }

    /**
     * Atomic write operation with ACID guarantees
     * @param {Object} eventRecord Event record to store
     * @private
     */
    async _atomicWrite(eventRecord) {
        const transaction = await this.persistenceManager.beginTransaction();
        
        try {
            // Check for conflicts
            await this._checkForConflicts(eventRecord, transaction);
            
            // Write event
            await this.persistenceManager.writeEvent(eventRecord, transaction);
            
            // Update sequence tracking
            await this.persistenceManager.updateSequence(
                eventRecord.aggregateId, 
                eventRecord.metadata.sequence, 
                transaction
            );
            
            // Commit transaction
            await this.persistenceManager.commitTransaction(transaction);
            
            // Store in memory cache
            this.eventStream.set(eventRecord.id, eventRecord);
            
        } catch (error) {
            await this.persistenceManager.rollbackTransaction(transaction);
            throw error;
        }
    }

    /**
     * Update event indexes for fast retrieval
     * @param {Object} eventRecord Event record
     * @private
     */
    async _updateIndexes(eventRecord) {
        const aggregateId = eventRecord.aggregateId;
        
        // Update aggregate index
        if (!this.eventIndex.has(aggregateId)) {
            this.eventIndex.set(aggregateId, []);
        }
        this.eventIndex.get(aggregateId).push({
            eventId: eventRecord.id,
            sequence: eventRecord.metadata.sequence,
            eventType: eventRecord.eventType,
            timestamp: eventRecord.metadata.timestamp
        });
        
        // Sort by sequence number
        this.eventIndex.get(aggregateId).sort((a, b) => a.sequence - b.sequence);
        
        // Update type index
        const typeKey = `${aggregateId}:${eventRecord.eventType}`;
        if (!this.eventIndex.has(typeKey)) {
            this.eventIndex.set(typeKey, []);
        }
        this.eventIndex.get(typeKey).push(eventRecord.id);
    }

    /**
     * Replicate event to cluster nodes
     * @param {Object} eventRecord Event record
     * @private
     */
    async _replicateEvent(eventRecord) {
        if (this.config.replicationNodes.length === 0) return;
        
        const replicationPromises = this.config.replicationNodes.map(async (node) => {
            try {
                await this._sendToReplicationNode(node, eventRecord);
            } catch (error) {
                console.error(`Failed to replicate to node ${node}:`, error);
                // Continue with other nodes
            }
        });
        
        // Wait for majority of nodes to confirm
        const results = await Promise.allSettled(replicationPromises);
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        
        if (successCount < Math.ceil(this.config.replicationNodes.length / 2)) {
            throw new Error('Failed to achieve replication consensus');
        }
    }

    /**
     * Notify event subscribers
     * @param {Object} eventRecord Event record
     * @private
     */
    async _notifySubscribers(eventRecord) {
        for (const [subscriptionId, subscription] of this.subscriptions.entries()) {
            try {
                if (!subscription.isActive) continue;
                
                // Check if subscription matches
                if (this._matchesSubscription(eventRecord, subscription)) {
                    await this._deliverEvent(subscription, eventRecord);
                }
            } catch (error) {
                console.error(`Failed to notify subscriber ${subscriptionId}:`, error);
                // Mark subscription as failed
                subscription.isActive = false;
            }
        }
    }

    /**
     * Check if event matches subscription criteria
     * @param {Object} eventRecord Event record
     * @param {Object} subscription Subscription
     * @returns {boolean} True if matches
     * @private
     */
    _matchesSubscription(eventRecord, subscription) {
        // Check aggregate ID
        if (subscription.aggregateId && subscription.aggregateId !== eventRecord.aggregateId) {
            return false;
        }
        
        // Check event types
        if (subscription.eventTypes.size > 0 && !subscription.eventTypes.has(eventRecord.eventType)) {
            return false;
        }
        
        // Check sequence
        if (eventRecord.metadata.sequence <= subscription.lastDelivered) {
            return false;
        }
        
        // Apply custom filter
        if (subscription.filter && !subscription.filter(eventRecord)) {
            return false;
        }
        
        return true;
    }

    /**
     * Deliver event to subscriber with exactly-once guarantees
     * @param {Object} subscription Subscription
     * @param {Object} eventRecord Event record
     * @private
     */
    async _deliverEvent(subscription, eventRecord) {
        // Add to buffer for reliability
        subscription.buffer.push(eventRecord);
        
        // Trim buffer if too large
        if (subscription.buffer.length > subscription.bufferSize) {
            subscription.buffer.shift();
        }
        
        try {
            // Deliver event with retry logic
            await this._deliverWithRetry(subscription, eventRecord);
            
            // Update last delivered sequence
            subscription.lastDelivered = eventRecord.metadata.sequence;
            
            // Remove from buffer on successful delivery
            const index = subscription.buffer.findIndex(e => e.id === eventRecord.id);
            if (index >= 0) {
                subscription.buffer.splice(index, 1);
            }
            
        } catch (error) {
            console.error(`Failed to deliver event to subscription ${subscription.id}:`, error);
            throw error;
        }
    }

    /**
     * Apply event to state using event handlers
     * @param {Object} state Current state
     * @param {Object} event Event to apply
     * @returns {Object} New state
     * @private
     */
    async _applyEvent(state, event) {
        const handler = this._getEventHandler(event.eventType);
        if (!handler) {
            console.warn(`No handler found for event type: ${event.eventType}`);
            return state;
        }
        
        try {
            const newState = await handler(state, event);
            return newState || state;
        } catch (error) {
            console.error(`Failed to apply event ${event.id}:`, error);
            throw error;
        }
    }

    /**
     * Start background event processing
     * @private
     */
    _startEventProcessing() {
        // Start snapshot creation scheduler
        setInterval(async () => {
            await this._createPeriodicSnapshots();
        }, 60000); // Every minute
        
        // Start cleanup scheduler
        setInterval(async () => {
            await this._cleanupExpiredData();
        }, 3600000); // Every hour
        
        // Start health monitoring
        setInterval(async () => {
            await this._performHealthCheck();
        }, 30000); // Every 30 seconds
        
        console.log('Event store background processing started');
    }

    /**
     * Create periodic snapshots for performance
     * @private
     */
    async _createPeriodicSnapshots() {
        try {
            for (const [aggregateId, events] of this.eventIndex.entries()) {
                if (events.length === 0) continue;
                
                const latestEvent = events[events.length - 1];
                const lastSnapshot = await this._getLatestSnapshot(aggregateId);
                
                // Create snapshot if enough events since last snapshot
                if (!lastSnapshot || 
                    latestEvent.sequence - lastSnapshot.sequence >= this.config.snapshotInterval) {
                    
                    const state = await this.replayEvents(aggregateId, latestEvent.sequence);
                    await this.createSnapshot(aggregateId, state.state, latestEvent.sequence);
                }
            }
        } catch (error) {
            console.error('Failed to create periodic snapshots:', error);
        }
    }

    /**
     * Get event handler for event type
     * @param {string} eventType Event type
     * @returns {Function} Event handler
     * @private
     */
    _getEventHandler(eventType) {
        const handlers = {
            'OrderCreated': this._handleOrderCreated,
            'OrderCommitted': this._handleOrderCommitted,
            'OrderRevealed': this._handleOrderRevealed,
            'OrderMatched': this._handleOrderMatched,
            'OrderCompleted': this._handleOrderCompleted,
            'OrderCancelled': this._handleOrderCancelled,
            'OrderExpired': this._handleOrderExpired
        };
        
        return handlers[eventType];
    }

    // =============================================================================
    // EVENT HANDLERS
    // =============================================================================

    _handleOrderCreated(state, event) {
        return {
            ...state,
            orders: {
                ...state.orders,
                [event.data.orderId]: {
                    id: event.data.orderId,
                    status: 'created',
                    trader: event.data.trader,
                    tokenIn: event.data.tokenIn,
                    tokenOut: event.data.tokenOut,
                    amountIn: event.data.amountIn,
                    minAmountOut: event.data.minAmountOut,
                    createdAt: event.metadata.timestamp
                }
            }
        };
    }

    _handleOrderCommitted(state, event) {
        const orderId = event.data.orderId;
        if (!state.orders[orderId]) return state;
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...state.orders[orderId],
                    status: 'committed',
                    commitmentHash: event.data.commitmentHash,
                    committedAt: event.metadata.timestamp
                }
            }
        };
    }

    _handleOrderRevealed(state, event) {
        const orderId = event.data.orderId;
        if (!state.orders[orderId]) return state;
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...state.orders[orderId],
                    status: 'revealed',
                    revealedAt: event.metadata.timestamp
                }
            }
        };
    }

    _handleOrderMatched(state, event) {
        const orderId = event.data.orderId;
        if (!state.orders[orderId]) return state;
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...state.orders[orderId],
                    status: 'matched',
                    matchedWith: event.data.matchedWith,
                    matchedAt: event.metadata.timestamp
                }
            }
        };
    }

    _handleOrderCompleted(state, event) {
        const orderId = event.data.orderId;
        if (!state.orders[orderId]) return state;
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...state.orders[orderId],
                    status: 'completed',
                    executedAmount: event.data.executedAmount,
                    completedAt: event.metadata.timestamp
                }
            }
        };
    }

    _handleOrderCancelled(state, event) {
        const orderId = event.data.orderId;
        if (!state.orders[orderId]) return state;
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...state.orders[orderId],
                    status: 'cancelled',
                    cancelledAt: event.metadata.timestamp,
                    cancelReason: event.data.reason
                }
            }
        };
    }

    _handleOrderExpired(state, event) {
        const orderId = event.data.orderId;
        if (!state.orders[orderId]) return state;
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...state.orders[orderId],
                    status: 'expired',
                    expiredAt: event.metadata.timestamp
                }
            }
        };
    }

    // =============================================================================
    // UTILITY METHODS
    // =============================================================================

    _deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    _calculateEventChecksum(event) {
        const data = JSON.stringify({
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            data: event.data,
            timestamp: event.timestamp
        });
        return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(data));
    }

    _getInitialState(aggregateId) {
        return {
            aggregateId,
            orders: {},
            metadata: {
                createdAt: Date.now(),
                version: 1
            }
        };
    }

    // =============================================================================
    // PUBLIC API METHODS
    // =============================================================================

    /**
     * Get event store statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            ...this.metrics,
            totalEvents: this.eventStream.size,
            totalAggregates: this.eventIndex.size,
            totalSnapshots: this.snapshots.size,
            activeSubscriptions: Array.from(this.subscriptions.values()).filter(s => s.isActive).length,
            lastProcessedBlock: this.lastProcessedBlock,
            currentSequence: this.sequenceNumber
        };
    }

    /**
     * Perform health check
     * @returns {Promise<Object>} Health status
     */
    async getHealthStatus() {
        return await this._performHealthCheck();
    }

    async _performHealthCheck() {
        const health = {
            status: 'healthy',
            timestamp: Date.now(),
            checks: {}
        };

        try {
            // Check persistence layer
            health.checks.persistence = await this.persistenceManager.healthCheck();
            
            // Check replication nodes
            health.checks.replication = await this._checkReplicationHealth();
            
            // Check memory usage
            health.checks.memory = this._checkMemoryUsage();
            
            // Check event processing
            health.checks.processing = this._checkProcessingHealth();
            
            // Determine overall status
            const failedChecks = Object.values(health.checks).filter(check => !check.healthy);
            if (failedChecks.length > 0) {
                health.status = failedChecks.length > 1 ? 'critical' : 'degraded';
            }
            
        } catch (error) {
            health.status = 'critical';
            health.error = error.message;
        }

        this.metrics.lastHealthCheck = Date.now();
        return health;
    }

    async _checkReplicationHealth() {
        if (this.config.replicationNodes.length === 0) {
            return { healthy: true, message: 'No replication configured' };
        }

        const healthyNodes = [];
        for (const node of this.config.replicationNodes) {
            try {
                await this._pingReplicationNode(node);
                healthyNodes.push(node);
            } catch (error) {
                console.warn(`Replication node ${node} is unhealthy:`, error.message);
            }
        }

        const healthyRatio = healthyNodes.length / this.config.replicationNodes.length;
        return {
            healthy: healthyRatio >= 0.5, // At least 50% healthy
            healthyNodes: healthyNodes.length,
            totalNodes: this.config.replicationNodes.length,
            ratio: healthyRatio
        };
    }

    _checkMemoryUsage() {
        const used = process.memoryUsage();
        const maxHeap = 1024 * 1024 * 1024; // 1GB threshold
        
        return {
            healthy: used.heapUsed < maxHeap,
            heapUsed: used.heapUsed,
            heapTotal: used.heapTotal,
            external: used.external
        };
    }

    _checkProcessingHealth() {
        const now = Date.now();
        const timeSinceLastEvent = now - this.metrics.lastHealthCheck;
        
        return {
            healthy: timeSinceLastEvent < 300000, // 5 minutes
            lastEventTime: this.metrics.lastHealthCheck,
            timeSinceLastEvent,
            eventsPerSecond: this.metrics.eventsStored / ((now - this.metrics.lastHealthCheck) / 1000)
        };
    }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

class ConflictResolver {
    constructor(config) {
        this.config = config;
        this.resolutionStrategies = {
            'last-write-wins': this._lastWriteWins,
            'first-write-wins': this._firstWriteWins,
            'custom': this._customResolution
        };
    }

    async resolveConflict(events) {
        const strategy = this.config.conflictResolution || 'last-write-wins';
        const resolver = this.resolutionStrategies[strategy];
        
        if (!resolver) {
            throw new Error(`Unknown conflict resolution strategy: ${strategy}`);
        }
        
        return await resolver.call(this, events);
    }

    _lastWriteWins(events) {
        return events.sort((a, b) => b.metadata.timestamp - a.metadata.timestamp)[0];
    }

    _firstWriteWins(events) {
        return events.sort((a, b) => a.metadata.timestamp - b.metadata.timestamp)[0];
    }

    _customResolution(events) {
        // Implement custom business logic
        return events[0];
    }
}

class ConsensusManager {
    constructor(config) {
        this.config = config;
        this.consensusAlgorithm = config.consensusAlgorithm || 'raft';
    }

    async achieveConsensus(event) {
        // Implement consensus algorithm (Raft, PBFT, etc.)
        return true;
    }
}

class PersistenceManager {
    constructor(config) {
        this.config = config;
        this.storage = new Map(); // In-memory for demo
    }

    async beginTransaction() {
        return { id: Date.now(), operations: [] };
    }

    async writeEvent(event, transaction) {
        transaction.operations.push({ type: 'write', event });
    }

    async updateSequence(aggregateId, sequence, transaction) {
        transaction.operations.push({ type: 'updateSequence', aggregateId, sequence });
    }

    async commitTransaction(transaction) {
        for (const op of transaction.operations) {
            if (op.type === 'write') {
                this.storage.set(op.event.id, op.event);
            }
        }
    }

    async rollbackTransaction(transaction) {
        // Rollback operations
    }

    async healthCheck() {
        return { healthy: true, latency: Math.random() * 10 };
    }
}

module.exports = { EventStore };