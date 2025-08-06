/**
 * @title Blockchain Event Recovery System
 * @author DEX State Management Team
 * @notice Reconstructs application state from blockchain events with fault tolerance
 * @dev Provides state recovery from blockchain events with consistency guarantees
 */

const { ethers } = require('ethers');
const { EventStore } = require('./EventStore');

class BlockchainEventRecovery {
    constructor(config) {
        this.config = {
            provider: new ethers.providers.JsonRpcProvider(config.rpcUrl),
            contractAddress: config.contractAddress,
            contractABI: config.contractABI,
            batchSize: config.batchSize || 2000,
            maxRetries: config.maxRetries || 5,
            retryDelay: config.retryDelay || 2000,
            checkpointInterval: config.checkpointInterval || 10000, // Every 10k blocks
            consistencyCheckInterval: config.consistencyCheckInterval || 100000, // Every 100k blocks
            parallelProcessing: config.parallelProcessing || 4,
            eventCacheSize: config.eventCacheSize || 50000,
            ...config
        };

        this.eventStore = this.config.eventStore || new EventStore(config);
        this.contract = new ethers.Contract(
            this.config.contractAddress,
            this.config.contractABI,
            this.config.provider
        );

        // Recovery state management
        this.recoveryState = {
            lastProcessedBlock: 0,
            lastCheckpoint: 0,
            isRecovering: false,
            recoveryProgress: 0,
            totalBlocksToProcess: 0,
            startTime: null,
            errors: []
        };

        // Event processing pipeline
        this.eventCache = new Map(); // Block number -> events cache
        this.processingQueue = new Map(); // Parallel processing queue
        this.checkpoints = new Map(); // Recovery checkpoints
        this.consistencyTracker = new ConsistencyTracker(config);
        
        // Performance metrics
        this.metrics = {
            blocksProcessed: 0,
            eventsRecovered: 0,
            recoveryTime: 0,
            averageBlockTime: 0,
            errorCount: 0,
            inconsistenciesFound: 0,
            lastRecoveryTimestamp: 0
        };

        this._initializeEventFilters();
        this._startHealthMonitoring();
    }

    /**
     * Recover application state from blockchain events
     * @param {number} fromBlock Starting block number
     * @param {number} toBlock Ending block number (optional)
     * @param {Object} options Recovery options
     * @returns {Promise<Object>} Recovery result
     */
    async recoverFromBlockchain(fromBlock, toBlock = 'latest', options = {}) {
        try {
            const {
                enableCheckpoints = true,
                verifyConsistency = true,
                parallelProcessing = this.config.parallelProcessing,
                resumeFromCheckpoint = true
            } = options;

            console.log(`Starting blockchain event recovery from block ${fromBlock} to ${toBlock}`);
            
            // Initialize recovery state
            await this._initializeRecovery(fromBlock, toBlock, options);
            
            // Check for existing checkpoints
            if (resumeFromCheckpoint && enableCheckpoints) {
                const checkpoint = await this._getLatestCheckpoint(fromBlock);
                if (checkpoint) {
                    fromBlock = checkpoint.blockNumber + 1;
                    console.log(`Resuming recovery from checkpoint at block ${checkpoint.blockNumber}`);
                }
            }

            // Get current block if toBlock is 'latest'
            if (toBlock === 'latest') {
                toBlock = await this.config.provider.getBlockNumber();
            }

            this.recoveryState.totalBlocksToProcess = toBlock - fromBlock + 1;
            this.recoveryState.startTime = Date.now();
            this.recoveryState.isRecovering = true;

            // Process blocks in batches with parallel processing
            const result = await this._processBlocksBatched(
                fromBlock, 
                toBlock, 
                parallelProcessing,
                enableCheckpoints
            );

            // Verify consistency if requested
            if (verifyConsistency) {
                await this._verifyStateConsistency(fromBlock, toBlock);
            }

            // Create final checkpoint
            if (enableCheckpoints) {
                await this._createCheckpoint(toBlock, result.finalState);
            }

            this.recoveryState.isRecovering = false;
            this.metrics.lastRecoveryTimestamp = Date.now();
            this.metrics.recoveryTime = Date.now() - this.recoveryState.startTime;

            console.log(`Recovery completed: ${result.eventsProcessed} events from ${this.recoveryState.totalBlocksToProcess} blocks`);

            return {
                success: true,
                blocksProcessed: this.recoveryState.totalBlocksToProcess,
                eventsProcessed: result.eventsProcessed,
                finalState: result.finalState,
                recoveryTime: this.metrics.recoveryTime,
                checkpointsCreated: result.checkpointsCreated,
                inconsistenciesFound: this.metrics.inconsistenciesFound
            };

        } catch (error) {
            this.recoveryState.isRecovering = false;
            this.recoveryState.errors.push({
                timestamp: Date.now(),
                error: error.message,
                stack: error.stack
            });
            
            console.error('Blockchain recovery failed:', error);
            throw new Error(`Recovery failed: ${error.message}`);
        }
    }

    /**
     * Perform incremental recovery for new blocks
     * @param {Object} options Recovery options
     * @returns {Promise<Object>} Recovery result
     */
    async performIncrementalRecovery(options = {}) {
        try {
            const currentBlock = await this.config.provider.getBlockNumber();
            const lastProcessed = this.recoveryState.lastProcessedBlock || 0;
            
            if (currentBlock <= lastProcessed) {
                return { success: true, message: 'No new blocks to process' };
            }

            console.log(`Performing incremental recovery from block ${lastProcessed + 1} to ${currentBlock}`);
            
            return await this.recoverFromBlockchain(
                lastProcessed + 1, 
                currentBlock,
                { ...options, resumeFromCheckpoint: false }
            );

        } catch (error) {
            console.error('Incremental recovery failed:', error);
            throw error;
        }
    }

    /**
     * Verify state consistency between blockchain and event store
     * @param {number} fromBlock Starting block for verification
     * @param {number} toBlock Ending block for verification
     * @returns {Promise<Object>} Consistency report
     */
    async verifyStateConsistency(fromBlock, toBlock) {
        try {
            console.log(`Verifying state consistency from block ${fromBlock} to ${toBlock}`);
            
            return await this.consistencyTracker.verifyConsistency(
                fromBlock, 
                toBlock, 
                this.eventStore
            );

        } catch (error) {
            console.error('Consistency verification failed:', error);
            throw error;
        }
    }

    // =============================================================================
    // PRIVATE METHODS - RECOVERY PROCESSING
    // =============================================================================

    /**
     * Initialize recovery state and prepare for processing
     * @param {number} fromBlock Starting block
     * @param {number} toBlock Ending block
     * @param {Object} options Recovery options
     * @private
     */
    async _initializeRecovery(fromBlock, toBlock, options) {
        this.recoveryState = {
            lastProcessedBlock: fromBlock - 1,
            lastCheckpoint: 0,
            isRecovering: false,
            recoveryProgress: 0,
            totalBlocksToProcess: 0,
            startTime: null,
            errors: []
        };

        // Clear caches
        this.eventCache.clear();
        this.processingQueue.clear();

        // Initialize consistency tracker
        await this.consistencyTracker.initialize(fromBlock, toBlock);

        console.log('Recovery state initialized');
    }

    /**
     * Process blocks in batches with parallel processing
     * @param {number} fromBlock Starting block
     * @param {number} toBlock Ending block
     * @param {number} parallelism Number of parallel workers
     * @param {boolean} enableCheckpoints Whether to create checkpoints
     * @returns {Promise<Object>} Processing result
     * @private
     */
    async _processBlocksBatched(fromBlock, toBlock, parallelism, enableCheckpoints) {
        let eventsProcessed = 0;
        let checkpointsCreated = 0;
        let currentBlock = fromBlock;
        let aggregatedState = await this._getInitialState();

        const batchSize = Math.floor(this.config.batchSize / parallelism);
        
        while (currentBlock <= toBlock) {
            const batchEndBlock = Math.min(currentBlock + (batchSize * parallelism) - 1, toBlock);
            
            // Create parallel processing batches
            const batches = this._createProcessingBatches(currentBlock, batchEndBlock, parallelism);
            
            // Process batches in parallel
            const batchResults = await Promise.all(
                batches.map(batch => this._processBatch(batch))
            );

            // Merge results in order
            for (const result of batchResults) {
                eventsProcessed += result.eventsProcessed;
                aggregatedState = await this._mergeState(aggregatedState, result.state);
                
                // Update progress
                this.recoveryState.recoveryProgress = 
                    ((result.endBlock - fromBlock + 1) / this.recoveryState.totalBlocksToProcess) * 100;
            }

            // Create checkpoint if needed
            if (enableCheckpoints && 
                (batchEndBlock - this.recoveryState.lastCheckpoint) >= this.config.checkpointInterval) {
                
                await this._createCheckpoint(batchEndBlock, aggregatedState);
                this.recoveryState.lastCheckpoint = batchEndBlock;
                checkpointsCreated++;
            }

            currentBlock = batchEndBlock + 1;
            this.recoveryState.lastProcessedBlock = batchEndBlock;

            // Yield control and clean up caches
            await this._performBatchCleanup();
        }

        return {
            eventsProcessed,
            finalState: aggregatedState,
            checkpointsCreated
        };
    }

    /**
     * Create processing batches for parallel execution
     * @param {number} startBlock Starting block
     * @param {number} endBlock Ending block
     * @param {number} parallelism Number of parallel workers
     * @returns {Array} Array of batch configurations
     * @private
     */
    _createProcessingBatches(startBlock, endBlock, parallelism) {
        const totalBlocks = endBlock - startBlock + 1;
        const blocksPerBatch = Math.ceil(totalBlocks / parallelism);
        const batches = [];

        for (let i = 0; i < parallelism; i++) {
            const batchStart = startBlock + (i * blocksPerBatch);
            const batchEnd = Math.min(batchStart + blocksPerBatch - 1, endBlock);
            
            if (batchStart <= endBlock) {
                batches.push({
                    id: i,
                    startBlock: batchStart,
                    endBlock: batchEnd,
                    blockCount: batchEnd - batchStart + 1
                });
            }
        }

        return batches;
    }

    /**
     * Process a single batch of blocks
     * @param {Object} batch Batch configuration
     * @returns {Promise<Object>} Batch processing result
     * @private
     */
    async _processBatch(batch) {
        try {
            console.log(`Processing batch ${batch.id}: blocks ${batch.startBlock}-${batch.endBlock}`);
            
            let eventsProcessed = 0;
            let batchState = await this._getInitialState();
            let currentBlock = batch.startBlock;

            while (currentBlock <= batch.endBlock) {
                const chunkEnd = Math.min(currentBlock + this.config.batchSize - 1, batch.endBlock);
                
                // Get events for chunk with retry logic
                const events = await this._getBlockchainEventsWithRetry(currentBlock, chunkEnd);
                
                // Process events and update state
                const chunkResult = await this._processEventsChunk(events, batchState);
                eventsProcessed += chunkResult.eventsProcessed;
                batchState = chunkResult.state;

                currentBlock = chunkEnd + 1;
                this.metrics.blocksProcessed += (chunkEnd - currentBlock + 1);
            }

            return {
                batchId: batch.id,
                eventsProcessed,
                state: batchState,
                startBlock: batch.startBlock,
                endBlock: batch.endBlock
            };

        } catch (error) {
            console.error(`Batch ${batch.id} processing failed:`, error);
            throw error;
        }
    }

    /**
     * Process a chunk of blockchain events
     * @param {Array} events Array of blockchain events
     * @param {Object} currentState Current application state
     * @returns {Promise<Object>} Processing result
     * @private
     */
    async _processEventsChunk(events, currentState) {
        let eventsProcessed = 0;
        let state = { ...currentState };

        for (const blockchainEvent of events) {
            try {
                // Convert blockchain event to domain event
                const domainEvent = await this._convertBlockchainEvent(blockchainEvent);
                
                if (domainEvent) {
                    // Store event in event store
                    await this.eventStore.storeEvent(domainEvent);
                    
                    // Apply event to state
                    state = await this._applyEventToState(state, domainEvent);
                    
                    eventsProcessed++;
                    this.metrics.eventsRecovered++;
                }

            } catch (error) {
                this.metrics.errorCount++;
                console.error('Failed to process blockchain event:', error);
                
                // Continue processing other events
                continue;
            }
        }

        return { eventsProcessed, state };
    }

    /**
     * Get blockchain events with retry logic and caching
     * @param {number} fromBlock Starting block
     * @param {number} toBlock Ending block
     * @returns {Promise<Array>} Array of blockchain events
     * @private
     */
    async _getBlockchainEventsWithRetry(fromBlock, toBlock) {
        const cacheKey = `${fromBlock}-${toBlock}`;
        
        // Check cache first
        if (this.eventCache.has(cacheKey)) {
            return this.eventCache.get(cacheKey);
        }

        let lastError;
        for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
            try {
                const filter = {
                    address: this.config.contractAddress,
                    fromBlock,
                    toBlock,
                    topics: this._getEventTopics()
                };

                const events = await this.config.provider.getLogs(filter);
                
                // Parse events using contract interface
                const parsedEvents = events.map(log => {
                    try {
                        return this.contract.interface.parseLog(log);
                    } catch (parseError) {
                        console.warn(`Failed to parse log:`, parseError);
                        return null;
                    }
                }).filter(Boolean);

                // Cache result
                this._cacheEvents(cacheKey, parsedEvents);
                
                return parsedEvents;

            } catch (error) {
                lastError = error;
                console.warn(`Attempt ${attempt + 1} failed, retrying in ${this.config.retryDelay}ms:`, error.message);
                
                if (attempt < this.config.maxRetries - 1) {
                    await this._delay(this.config.retryDelay * Math.pow(2, attempt)); // Exponential backoff
                }
            }
        }

        throw new Error(`Failed to fetch events after ${this.config.maxRetries} attempts: ${lastError.message}`);
    }

    /**
     * Convert blockchain event to domain event format
     * @param {Object} blockchainEvent Parsed blockchain event
     * @returns {Promise<Object>} Domain event
     * @private
     */
    async _convertBlockchainEvent(blockchainEvent) {
        try {
            const eventName = blockchainEvent.name;
            const args = blockchainEvent.args;
            const txHash = blockchainEvent.transactionHash;
            const blockNumber = blockchainEvent.blockNumber;
            const logIndex = blockchainEvent.logIndex;

            // Get transaction receipt for additional context
            const receipt = await this._getTransactionReceipt(txHash);
            
            const domainEvent = {
                aggregateId: this._extractAggregateId(eventName, args),
                eventType: this._mapBlockchainEventToDomainEvent(eventName),
                data: this._extractEventData(eventName, args),
                timestamp: (await this._getBlockTimestamp(blockNumber)) * 1000, // Convert to milliseconds
                version: 1,
                source: 'blockchain',
                metadata: {
                    blockNumber,
                    transactionHash: txHash,
                    logIndex,
                    gasUsed: receipt.gasUsed.toString(),
                    gasPrice: receipt.effectiveGasPrice?.toString() || '0'
                }
            };

            return domainEvent;

        } catch (error) {
            console.error('Failed to convert blockchain event:', error);
            return null;
        }
    }

    /**
     * Extract aggregate ID from blockchain event
     * @param {string} eventName Event name
     * @param {Array} args Event arguments
     * @returns {string} Aggregate ID
     * @private
     */
    _extractAggregateId(eventName, args) {
        switch (eventName) {
            case 'OrderCommitted':
            case 'OrderRevealed':
            case 'OrderMatched':
            case 'OrderCompleted':
            case 'OrderCancelled':
                return args.orderId || args.orderHash || args[0];
            default:
                return 'system';
        }
    }

    /**
     * Map blockchain event name to domain event type
     * @param {string} eventName Blockchain event name
     * @returns {string} Domain event type
     * @private
     */
    _mapBlockchainEventToDomainEvent(eventName) {
        const mapping = {
            'OrderCommitted': 'OrderCommitted',
            'OrderRevealed': 'OrderRevealed',
            'OrderMatched': 'OrderMatched',
            'OrderCompleted': 'OrderCompleted',
            'OrderCancelled': 'OrderCancelled',
            'OrderExpired': 'OrderExpired',
            'DepositMade': 'DepositMade',
            'WithdrawalProcessed': 'WithdrawalProcessed'
        };

        return mapping[eventName] || 'UnknownEvent';
    }

    /**
     * Extract relevant data from blockchain event arguments
     * @param {string} eventName Event name
     * @param {Array} args Event arguments
     * @returns {Object} Extracted data
     * @private
     */
    _extractEventData(eventName, args) {
        switch (eventName) {
            case 'OrderCommitted':
                return {
                    orderId: args.orderId || args.orderHash,
                    trader: args.trader || args.user,
                    commitmentHash: args.commitmentHash || args.commitment,
                    tokenIn: args.tokenIn,
                    tokenOut: args.tokenOut
                };

            case 'OrderRevealed':
                return {
                    orderId: args.orderId || args.orderHash,
                    trader: args.trader || args.user,
                    amountIn: args.amountIn?.toString(),
                    minAmountOut: args.minAmountOut?.toString(),
                    deadline: args.deadline?.toString(),
                    salt: args.salt?.toString()
                };

            case 'OrderMatched':
                return {
                    orderId: args.orderId || args.orderHash,
                    matchedWith: args.matchedWith || args.counterpartyOrder,
                    executedAmount: args.executedAmount?.toString(),
                    price: args.price?.toString()
                };

            case 'OrderCompleted':
                return {
                    orderId: args.orderId || args.orderHash,
                    executedAmount: args.executedAmount?.toString(),
                    finalPrice: args.finalPrice?.toString()
                };

            case 'OrderCancelled':
                return {
                    orderId: args.orderId || args.orderHash,
                    reason: args.reason || 'UserCancellation'
                };

            default:
                // Generic extraction for unknown events
                const data = {};
                Object.keys(args).forEach(key => {
                    if (isNaN(key)) { // Skip numeric indices
                        data[key] = typeof args[key] === 'object' && args[key].toString ? 
                            args[key].toString() : args[key];
                    }
                });
                return data;
        }
    }

    // =============================================================================
    // CHECKPOINT MANAGEMENT
    // =============================================================================

    /**
     * Create recovery checkpoint
     * @param {number} blockNumber Block number for checkpoint
     * @param {Object} state Application state at checkpoint
     * @returns {Promise<string>} Checkpoint ID
     * @private
     */
    async _createCheckpoint(blockNumber, state) {
        try {
            const checkpointId = `checkpoint_${blockNumber}_${Date.now()}`;
            
            const checkpoint = {
                id: checkpointId,
                blockNumber,
                state: this._serializeState(state),
                timestamp: Date.now(),
                eventsProcessed: this.metrics.eventsRecovered,
                checksum: this._calculateStateChecksum(state)
            };

            this.checkpoints.set(checkpointId, checkpoint);
            
            // Persist checkpoint to storage
            await this._persistCheckpoint(checkpoint);
            
            console.log(`Created checkpoint ${checkpointId} at block ${blockNumber}`);
            return checkpointId;

        } catch (error) {
            console.error('Failed to create checkpoint:', error);
            throw error;
        }
    }

    /**
     * Get latest checkpoint for recovery
     * @param {number} beforeBlock Block number limit
     * @returns {Promise<Object>} Latest checkpoint
     * @private
     */
    async _getLatestCheckpoint(beforeBlock) {
        try {
            let latestCheckpoint = null;
            
            for (const [id, checkpoint] of this.checkpoints.entries()) {
                if (checkpoint.blockNumber < beforeBlock) {
                    if (!latestCheckpoint || checkpoint.blockNumber > latestCheckpoint.blockNumber) {
                        latestCheckpoint = checkpoint;
                    }
                }
            }

            if (latestCheckpoint) {
                // Verify checkpoint integrity
                const isValid = await this._verifyCheckpoint(latestCheckpoint);
                if (!isValid) {
                    console.warn(`Checkpoint ${latestCheckpoint.id} failed verification, ignoring`);
                    return null;
                }
            }

            return latestCheckpoint;

        } catch (error) {
            console.error('Failed to get latest checkpoint:', error);
            return null;
        }
    }

    /**
     * Verify checkpoint integrity
     * @param {Object} checkpoint Checkpoint to verify
     * @returns {Promise<boolean>} True if valid
     * @private
     */
    async _verifyCheckpoint(checkpoint) {
        try {
            const state = this._deserializeState(checkpoint.state);
            const calculatedChecksum = this._calculateStateChecksum(state);
            
            return calculatedChecksum === checkpoint.checksum;

        } catch (error) {
            console.error('Checkpoint verification failed:', error);
            return false;
        }
    }

    // =============================================================================
    // STATE MANAGEMENT
    // =============================================================================

    /**
     * Get initial state for recovery
     * @returns {Promise<Object>} Initial state
     * @private
     */
    async _getInitialState() {
        return {
            orders: {},
            balances: {},
            metadata: {
                lastUpdated: Date.now(),
                version: 1
            }
        };
    }

    /**
     * Apply domain event to application state
     * @param {Object} currentState Current state
     * @param {Object} domainEvent Domain event to apply
     * @returns {Promise<Object>} Updated state
     * @private
     */
    async _applyEventToState(currentState, domainEvent) {
        try {
            switch (domainEvent.eventType) {
                case 'OrderCommitted':
                    return this._applyOrderCommitted(currentState, domainEvent);
                case 'OrderRevealed':
                    return this._applyOrderRevealed(currentState, domainEvent);
                case 'OrderMatched':
                    return this._applyOrderMatched(currentState, domainEvent);
                case 'OrderCompleted':
                    return this._applyOrderCompleted(currentState, domainEvent);
                case 'OrderCancelled':
                    return this._applyOrderCancelled(currentState, domainEvent);
                default:
                    console.warn(`Unknown event type: ${domainEvent.eventType}`);
                    return currentState;
            }
        } catch (error) {
            console.error(`Failed to apply event ${domainEvent.eventType}:`, error);
            return currentState;
        }
    }

    _applyOrderCommitted(state, event) {
        const orderId = event.data.orderId;
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    id: orderId,
                    status: 'committed',
                    trader: event.data.trader,
                    commitmentHash: event.data.commitmentHash,
                    tokenIn: event.data.tokenIn,
                    tokenOut: event.data.tokenOut,
                    committedAt: event.timestamp
                }
            }
        };
    }

    _applyOrderRevealed(state, event) {
        const orderId = event.data.orderId;
        const existingOrder = state.orders[orderId] || {};
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...existingOrder,
                    status: 'revealed',
                    amountIn: event.data.amountIn,
                    minAmountOut: event.data.minAmountOut,
                    deadline: event.data.deadline,
                    salt: event.data.salt,
                    revealedAt: event.timestamp
                }
            }
        };
    }

    _applyOrderMatched(state, event) {
        const orderId = event.data.orderId;
        const existingOrder = state.orders[orderId] || {};
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...existingOrder,
                    status: 'matched',
                    matchedWith: event.data.matchedWith,
                    executedAmount: event.data.executedAmount,
                    price: event.data.price,
                    matchedAt: event.timestamp
                }
            }
        };
    }

    _applyOrderCompleted(state, event) {
        const orderId = event.data.orderId;
        const existingOrder = state.orders[orderId] || {};
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...existingOrder,
                    status: 'completed',
                    executedAmount: event.data.executedAmount,
                    finalPrice: event.data.finalPrice,
                    completedAt: event.timestamp
                }
            }
        };
    }

    _applyOrderCancelled(state, event) {
        const orderId = event.data.orderId;
        const existingOrder = state.orders[orderId] || {};
        
        return {
            ...state,
            orders: {
                ...state.orders,
                [orderId]: {
                    ...existingOrder,
                    status: 'cancelled',
                    cancelReason: event.data.reason,
                    cancelledAt: event.timestamp
                }
            }
        };
    }

    /**
     * Merge two state objects
     * @param {Object} baseState Base state
     * @param {Object} deltaState Delta state to merge
     * @returns {Promise<Object>} Merged state
     * @private
     */
    async _mergeState(baseState, deltaState) {
        return {
            orders: { ...baseState.orders, ...deltaState.orders },
            balances: { ...baseState.balances, ...deltaState.balances },
            metadata: {
                ...baseState.metadata,
                ...deltaState.metadata,
                lastUpdated: Date.now()
            }
        };
    }

    // =============================================================================
    // UTILITY METHODS
    // =============================================================================

    _initializeEventFilters() {
        // Define contract event topics for filtering
        this.eventTopics = [
            this.contract.interface.getEventTopic('OrderCommitted'),
            this.contract.interface.getEventTopic('OrderRevealed'),
            this.contract.interface.getEventTopic('OrderMatched'),
            this.contract.interface.getEventTopic('OrderCompleted'),
            this.contract.interface.getEventTopic('OrderCancelled')
        ];
    }

    _getEventTopics() {
        return [this.eventTopics]; // OR condition for any of these topics
    }

    async _getTransactionReceipt(txHash) {
        try {
            return await this.config.provider.getTransactionReceipt(txHash);
        } catch (error) {
            console.warn(`Failed to get transaction receipt for ${txHash}:`, error);
            return { gasUsed: '0', effectiveGasPrice: '0' };
        }
    }

    async _getBlockTimestamp(blockNumber) {
        try {
            const block = await this.config.provider.getBlock(blockNumber);
            return block.timestamp;
        } catch (error) {
            console.warn(`Failed to get block timestamp for ${blockNumber}:`, error);
            return Math.floor(Date.now() / 1000);
        }
    }

    _cacheEvents(key, events) {
        // Implement LRU cache eviction
        if (this.eventCache.size >= this.config.eventCacheSize) {
            const firstKey = this.eventCache.keys().next().value;
            this.eventCache.delete(firstKey);
        }
        
        this.eventCache.set(key, events);
    }

    async _performBatchCleanup() {
        // Yield control to event loop
        await new Promise(resolve => setImmediate(resolve));
        
        // Clean up old cache entries
        if (this.eventCache.size > this.config.eventCacheSize * 1.5) {
            const keysToDelete = Array.from(this.eventCache.keys()).slice(0, this.config.eventCacheSize / 2);
            keysToDelete.forEach(key => this.eventCache.delete(key));
        }
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _serializeState(state) {
        return JSON.stringify(state);
    }

    _deserializeState(serializedState) {
        return JSON.parse(serializedState);
    }

    _calculateStateChecksum(state) {
        const { ethers } = require('ethers');
        const stateString = JSON.stringify(state, Object.keys(state).sort());
        return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(stateString));
    }

    async _persistCheckpoint(checkpoint) {
        // In production, this would persist to durable storage
        console.log(`Persisting checkpoint ${checkpoint.id}`);
    }

    async _verifyStateConsistency(fromBlock, toBlock) {
        return await this.consistencyTracker.verifyConsistency(fromBlock, toBlock, this.eventStore);
    }

    _startHealthMonitoring() {
        setInterval(async () => {
            await this._performHealthCheck();
        }, 60000); // Every minute
    }

    async _performHealthCheck() {
        try {
            const currentBlock = await this.config.provider.getBlockNumber();
            const blocksBehind = currentBlock - this.recoveryState.lastProcessedBlock;
            
            const health = {
                status: blocksBehind < 100 ? 'healthy' : 'lagging',
                currentBlock,
                lastProcessedBlock: this.recoveryState.lastProcessedBlock,
                blocksBehind,
                isRecovering: this.recoveryState.isRecovering,
                metrics: this.metrics
            };

            if (blocksBehind > 1000) {
                console.warn(`Recovery health check: ${blocksBehind} blocks behind`);
            }

            return health;

        } catch (error) {
            console.error('Health check failed:', error);
            return { status: 'unhealthy', error: error.message };
        }
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get recovery status and metrics
     * @returns {Object} Recovery status
     */
    getRecoveryStatus() {
        return {
            ...this.recoveryState,
            metrics: this.metrics,
            cacheSize: this.eventCache.size,
            checkpointCount: this.checkpoints.size
        };
    }

    /**
     * Get health status
     * @returns {Promise<Object>} Health status
     */
    async getHealthStatus() {
        return await this._performHealthCheck();
    }

    /**
     * Clear recovery state and caches
     * @returns {Promise<void>}
     */
    async clearRecoveryState() {
        this.eventCache.clear();
        this.processingQueue.clear();
        this.checkpoints.clear();
        this.recoveryState.errors = [];
        
        console.log('Recovery state cleared');
    }
}

// =============================================================================
// CONSISTENCY TRACKER
// =============================================================================

class ConsistencyTracker {
    constructor(config) {
        this.config = config;
        this.inconsistencies = [];
    }

    async initialize(fromBlock, toBlock) {
        this.inconsistencies = [];
        console.log(`Consistency tracker initialized for blocks ${fromBlock}-${toBlock}`);
    }

    async verifyConsistency(fromBlock, toBlock, eventStore) {
        try {
            console.log(`Starting consistency verification for blocks ${fromBlock}-${toBlock}`);
            
            const inconsistencies = [];
            
            // Check for missing events
            const missingEvents = await this._checkForMissingEvents(fromBlock, toBlock, eventStore);
            inconsistencies.push(...missingEvents);
            
            // Check for duplicate events
            const duplicateEvents = await this._checkForDuplicateEvents(fromBlock, toBlock, eventStore);
            inconsistencies.push(...duplicateEvents);
            
            // Check for order violations
            const orderViolations = await this._checkForOrderViolations(fromBlock, toBlock, eventStore);
            inconsistencies.push(...orderViolations);

            const result = {
                consistent: inconsistencies.length === 0,
                blocksVerified: toBlock - fromBlock + 1,
                inconsistenciesFound: inconsistencies.length,
                inconsistencies: inconsistencies,
                verificationTime: Date.now()
            };

            if (inconsistencies.length > 0) {
                console.warn(`Found ${inconsistencies.length} consistency issues`);
            } else {
                console.log('State consistency verification passed');
            }

            return result;

        } catch (error) {
            console.error('Consistency verification failed:', error);
            throw error;
        }
    }

    async _checkForMissingEvents(fromBlock, toBlock, eventStore) {
        // Implementation for detecting missing events
        return [];
    }

    async _checkForDuplicateEvents(fromBlock, toBlock, eventStore) {
        // Implementation for detecting duplicate events
        return [];
    }

    async _checkForOrderViolations(fromBlock, toBlock, eventStore) {
        // Implementation for detecting event order violations
        return [];
    }
}

module.exports = { BlockchainEventRecovery };