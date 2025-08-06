/**
 * @title Fair Ordering Engine
 * @author DEX Trading Team
 * @notice Implements fair ordering to prevent favoritism and MEV attacks
 * @dev Uses time-based priority, randomization, and commitment schemes
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

class FairOrderingEngine extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Fair ordering configuration
            fairOrderingEnabled: config.fairOrderingEnabled || true,
            timeBasedPriority: config.timeBasedPriority || true,
            randomizationEnabled: config.randomizationEnabled || true,
            commitRevealEnabled: config.commitRevealEnabled || true,
            
            // Time-based priority settings
            timePriorityWindow: config.timePriorityWindow || 1000, // 1 second window
            timeBucketSize: config.timeBucketSize || 100, // 100ms buckets
            maxTimeDelay: config.maxTimeDelay || 5000, // 5 second max delay
            
            // Randomization settings
            randomizationAlgorithm: config.randomizationAlgorithm || 'verifiable_random',
            randomSeed: config.randomSeed || crypto.randomBytes(32),
            randomnessSource: config.randomnessSource || 'beacon', // beacon, block_hash, vrf
            
            // Commit-reveal settings
            commitPhaseDuration: config.commitPhaseDuration || 10000, // 10 seconds
            revealPhaseDuration: config.revealPhaseDuration || 5000, // 5 seconds
            maxCommitmentsPerUser: config.maxCommitmentsPerUser || 10,
            
            // MEV protection
            mevProtectionEnabled: config.mevProtectionEnabled || true,
            frontRunningProtection: config.frontRunningProtection || true,
            sandwichProtection: config.sandwichProtection || true,
            
            // Batch auction settings
            batchAuctionEnabled: config.batchAuctionEnabled || true,
            batchInterval: config.batchInterval || 1000, // 1 second batches
            uniformPricing: config.uniformPricing || true,
            
            ...config
        };

        // Order sequencing
        this.sequencer = new OrderSequencer(this.config);
        this.timeBuckets = new Map();
        this.pendingOrders = new Map();
        
        // Commitment scheme
        this.commitRevealManager = new CommitRevealManager(this.config);
        this.commitments = new Map();
        this.reveals = new Map();
        
        // Randomness generation
        this.randomnessGenerator = new RandomnessGenerator(this.config);
        this.verifiableRandom = new VerifiableRandom(this.config);
        
        // MEV protection
        this.mevProtector = new MEVProtector(this.config);
        this.frontRunningDetector = new FrontRunningDetector(this.config);
        
        // Batch auction
        this.batchAuctioneer = new BatchAuctioneer(this.config);
        this.auctionBatches = new Map();
        
        // Fair ordering state
        this.currentSequenceNumber = 0;
        this.lastProcessedTimestamp = Date.now();
        
        // Metrics
        this.metrics = new FairOrderingMetrics();
        
        this._initializeEngine();
    }

    /**
     * Initialize fair ordering engine
     * @private
     */
    async _initializeEngine() {
        // Initialize components
        await this.sequencer.initialize();
        await this.commitRevealManager.initialize();
        await this.randomnessGenerator.initialize();
        await this.mevProtector.initialize();
        await this.batchAuctioneer.initialize();
        
        // Start periodic processing
        if (this.config.timeBasedPriority) {
            this.processingInterval = setInterval(() => {
                this._processTimeBuckets();
            }, this.config.timeBucketSize);
        }
        
        if (this.config.batchAuctionEnabled) {
            this.auctionInterval = setInterval(() => {
                this._processBatchAuction();
            }, this.config.batchInterval);
        }
        
        console.log('Fair Ordering Engine initialized');
    }

    /**
     * Process order through fair ordering system
     * @param {Object} order Order to process
     * @returns {Promise<Object>} Processed order
     */
    async processOrder(order) {
        const processingStart = Date.now();
        
        try {
            // Add timing information
            order.receivedAt = processingStart;
            order.sequenceNumber = this.currentSequenceNumber++;
            
            // Apply MEV protection
            if (this.config.mevProtectionEnabled) {
                order = await this.mevProtector.protectOrder(order);
            }
            
            // Choose processing method based on configuration
            let processedOrder;
            
            if (this.config.commitRevealEnabled) {
                processedOrder = await this._processCommitRevealOrder(order);
            } else if (this.config.batchAuctionEnabled) {
                processedOrder = await this._processBatchAuctionOrder(order);
            } else if (this.config.timeBasedPriority) {
                processedOrder = await this._processTimeBasedOrder(order);
            } else {
                processedOrder = await this._processRandomizedOrder(order);
            }
            
            // Record metrics
            this.metrics.recordOrderProcessing(
                Date.now() - processingStart,
                order.type,
                processedOrder.fairnessScore || 1.0
            );
            
            return processedOrder;
            
        } catch (error) {
            this.metrics.recordError('order_processing', error);
            throw error;
        }
    }

    /**
     * Submit commitment for commit-reveal scheme
     * @param {Object} commitment Order commitment
     * @returns {Promise<Object>} Commitment result
     */
    async submitCommitment(commitment) {
        try {
            await this._validateCommitment(commitment);
            
            const commitmentId = crypto.randomUUID();
            const commitmentData = {
                id: commitmentId,
                userId: commitment.userId,
                hash: commitment.hash,
                timestamp: Date.now(),
                revealed: false
            };
            
            this.commitments.set(commitmentId, commitmentData);
            
            this.emit('commitmentSubmitted', {
                commitmentId,
                userId: commitment.userId,
                timestamp: Date.now()
            });
            
            return {
                success: true,
                commitmentId,
                revealDeadline: Date.now() + this.config.commitPhaseDuration
            };
            
        } catch (error) {
            this.metrics.recordError('commitment_submission', error);
            throw error;
        }
    }

    /**
     * Reveal commitment
     * @param {Object} reveal Commitment reveal
     * @returns {Promise<Object>} Reveal result
     */
    async revealCommitment(reveal) {
        try {
            await this._validateReveal(reveal);
            
            const commitment = this.commitments.get(reveal.commitmentId);
            if (!commitment) {
                throw new Error('Commitment not found');
            }
            
            // Verify hash
            const expectedHash = crypto.createHash('sha256')
                .update(JSON.stringify(reveal.order) + reveal.nonce)
                .digest('hex');
            
            if (expectedHash !== commitment.hash) {
                throw new Error('Invalid reveal - hash mismatch');
            }
            
            // Mark as revealed
            commitment.revealed = true;
            this.reveals.set(reveal.commitmentId, {
                commitmentId: reveal.commitmentId,
                order: reveal.order,
                nonce: reveal.nonce,
                timestamp: Date.now()
            });
            
            // Process the revealed order
            const processedOrder = await this._processRevealedOrder(reveal.order, commitment);
            
            this.emit('commitmentRevealed', {
                commitmentId: reveal.commitmentId,
                orderId: reveal.order.id,
                timestamp: Date.now()
            });
            
            return {
                success: true,
                orderId: reveal.order.id,
                processedOrder
            };
            
        } catch (error) {
            this.metrics.recordError('commitment_reveal', error);
            throw error;
        }
    }

    /**
     * Process order using commit-reveal scheme
     * @param {Object} order Order to process
     * @returns {Promise<Object>} Processed order
     * @private
     */
    async _processCommitRevealOrder(order) {
        // In commit-reveal mode, orders must be committed first
        throw new Error('Orders must be submitted via commit-reveal scheme when enabled');
    }

    /**
     * Process order using batch auction
     * @param {Object} order Order to process
     * @returns {Promise<Object>} Processed order
     * @private
     */
    async _processBatchAuctionOrder(order) {
        // Add order to current batch
        const batchId = this._getCurrentBatchId();
        let batch = this.auctionBatches.get(batchId);
        
        if (!batch) {
            batch = {
                id: batchId,
                orders: [],
                startTime: Date.now(),
                processed: false
            };
            this.auctionBatches.set(batchId, batch);
        }
        
        // Add fair ordering properties
        order.batchId = batchId;
        order.fairnessScore = await this._calculateFairnessScore(order);
        order.priorityScore = await this._calculatePriorityScore(order);
        
        batch.orders.push(order);
        
        return {
            ...order,
            status: 'batched',
            batchId,
            expectedProcessingTime: this._getNextBatchProcessingTime()
        };
    }

    /**
     * Process order using time-based priority
     * @param {Object} order Order to process
     * @returns {Promise<Object>} Processed order
     * @private
     */
    async _processTimeBasedOrder(order) {
        // Assign to time bucket
        const timeBucket = this._getTimeBucket(order.receivedAt);
        
        if (!this.timeBuckets.has(timeBucket)) {
            this.timeBuckets.set(timeBucket, []);
        }
        
        // Add randomization within time bucket if enabled
        if (this.config.randomizationEnabled) {
            order.randomPriority = await this.randomnessGenerator.generatePriority(order);
        }
        
        // Calculate fairness score
        order.fairnessScore = await this._calculateFairnessScore(order);
        order.priorityScore = await this._calculatePriorityScore(order);
        
        this.timeBuckets.get(timeBucket).push(order);
        this.pendingOrders.set(order.id, order);
        
        return {
            ...order,
            status: 'pending',
            timeBucket,
            expectedProcessingTime: timeBucket + this.config.timeBucketSize
        };
    }

    /**
     * Process order using randomization
     * @param {Object} order Order to process
     * @returns {Promise<Object>} Processed order
     * @private
     */
    async _processRandomizedOrder(order) {
        // Generate verifiable random priority
        order.randomPriority = await this.verifiableRandom.generatePriority(order);
        order.fairnessScore = 1.0; // Full fairness for randomized orders
        order.priorityScore = order.randomPriority;
        
        // Add to sequencer
        await this.sequencer.addOrder(order);
        
        return {
            ...order,
            status: 'queued',
            randomPriority: order.randomPriority
        };
    }

    /**
     * Process revealed order from commit-reveal scheme
     * @param {Object} order Revealed order
     * @param {Object} commitment Original commitment
     * @returns {Promise<Object>} Processed order
     * @private
     */
    async _processRevealedOrder(order, commitment) {
        // Add commitment timing information
        order.commitmentTimestamp = commitment.timestamp;
        order.revealTimestamp = Date.now();
        order.fairnessScore = 1.0; // Full fairness for commit-reveal
        
        // Sort by commitment time for fairness
        order.priorityScore = -commitment.timestamp; // Earlier commitments have higher priority
        
        await this.sequencer.addOrder(order);
        
        return {
            ...order,
            status: 'revealed',
            commitmentId: commitment.id
        };
    }

    /**
     * Process time buckets for fair ordering
     * @private
     */
    async _processTimeBuckets() {
        const currentTime = Date.now();
        const processingThreshold = currentTime - this.config.timeBucketSize;
        
        // Process buckets that are ready
        for (const [bucketTime, orders] of this.timeBuckets) {
            if (bucketTime <= processingThreshold) {
                await this._processBucket(bucketTime, orders);
                this.timeBuckets.delete(bucketTime);
            }
        }
    }

    /**
     * Process a time bucket of orders
     * @param {number} bucketTime Bucket timestamp
     * @param {Array} orders Orders in bucket
     * @private
     */
    async _processBucket(bucketTime, orders) {
        if (orders.length === 0) return;
        
        // Sort orders within bucket fairly
        const sortedOrders = await this._sortOrdersFairly(orders);
        
        // Add to sequencer in fair order
        for (const order of sortedOrders) {
            order.status = 'sequenced';
            order.bucketProcessedAt = Date.now();
            
            await this.sequencer.addOrder(order);
            this.pendingOrders.delete(order.id);
            
            this.emit('orderSequenced', {
                orderId: order.id,
                bucketTime,
                fairnessScore: order.fairnessScore,
                priorityScore: order.priorityScore
            });
        }
        
        this.metrics.recordBucketProcessing(bucketTime, orders.length);
    }

    /**
     * Process batch auction
     * @private
     */
    async _processBatchAuction() {
        const currentTime = Date.now();
        const batchesToProcess = [];
        
        // Find batches ready for processing
        for (const [batchId, batch] of this.auctionBatches) {
            if (!batch.processed && 
                currentTime - batch.startTime >= this.config.batchInterval) {
                batchesToProcess.push(batch);
            }
        }
        
        // Process each batch
        for (const batch of batchesToProcess) {
            await this._processBatch(batch);
        }
    }

    /**
     * Process a batch auction
     * @param {Object} batch Batch to process
     * @private
     */
    async _processBatch(batch) {
        if (batch.orders.length === 0) return;
        
        // Mark as processed
        batch.processed = true;
        batch.processedAt = Date.now();
        
        // Run batch auction algorithm
        const auctionResult = await this.batchAuctioneer.runAuction(batch);
        
        // Sort orders by auction result
        const sortedOrders = auctionResult.orderedList;
        
        // Add to sequencer
        for (const order of sortedOrders) {
            order.status = 'auctioned';
            order.auctionPrice = auctionResult.clearingPrice;
            order.batchProcessedAt = Date.now();
            
            await this.sequencer.addOrder(order);
            
            this.emit('orderAuctioned', {
                orderId: order.id,
                batchId: batch.id,
                clearingPrice: auctionResult.clearingPrice,
                fairnessScore: order.fairnessScore
            });
        }
        
        this.metrics.recordBatchAuction(batch.id, batch.orders.length, auctionResult);
        
        // Clean up
        this.auctionBatches.delete(batch.id);
    }

    /**
     * Sort orders fairly within a bucket
     * @param {Array} orders Orders to sort
     * @returns {Promise<Array>} Sorted orders
     * @private
     */
    async _sortOrdersFairly(orders) {
        if (this.config.randomizationEnabled) {
            // Sort by random priority (already assigned)
            return orders.sort((a, b) => {
                // Higher random priority first
                if (a.randomPriority !== b.randomPriority) {
                    return b.randomPriority - a.randomPriority;
                }
                // Tie-break by sequence number (FIFO within same priority)
                return a.sequenceNumber - b.sequenceNumber;
            });
        } else {
            // Pure FIFO within bucket
            return orders.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
        }
    }

    /**
     * Calculate fairness score for an order
     * @param {Object} order Order to score
     * @returns {Promise<number>} Fairness score (0-1)
     * @private
     */
    async _calculateFairnessScore(order) {
        let score = 1.0;
        
        // Reduce score for potential MEV extraction
        if (this.config.mevProtectionEnabled) {
            const mevRisk = await this.mevProtector.calculateMEVRisk(order);
            score *= (1 - mevRisk);
        }
        
        // Reduce score for front-running potential
        if (this.config.frontRunningProtection) {
            const frontRunningRisk = await this.frontRunningDetector.calculateRisk(order);
            score *= (1 - frontRunningRisk);
        }
        
        return Math.max(0, Math.min(1, score));
    }

    /**
     * Calculate priority score for an order
     * @param {Object} order Order to score
     * @returns {Promise<number>} Priority score
     * @private
     */
    async _calculatePriorityScore(order) {
        let score = 0;
        
        // Time-based priority (earlier = higher priority)
        if (this.config.timeBasedPriority) {
            score += (this.lastProcessedTimestamp - order.receivedAt) / 1000;
        }
        
        // Random component if enabled
        if (this.config.randomizationEnabled && order.randomPriority) {
            score += order.randomPriority * 1000;
        }
        
        // Size-based component (smaller orders get slight priority)
        const orderSize = parseFloat(order.quantity || 0);
        if (orderSize > 0) {
            score += 1000 / Math.log(orderSize + 1);
        }
        
        return score;
    }

    /**
     * Get time bucket for a timestamp
     * @param {number} timestamp Timestamp
     * @returns {number} Bucket timestamp
     * @private
     */
    _getTimeBucket(timestamp) {
        return Math.floor(timestamp / this.config.timeBucketSize) * this.config.timeBucketSize;
    }

    /**
     * Get current batch ID
     * @returns {string} Current batch ID
     * @private
     */
    _getCurrentBatchId() {
        const batchNumber = Math.floor(Date.now() / this.config.batchInterval);
        return `batch_${batchNumber}`;
    }

    /**
     * Get next batch processing time
     * @returns {number} Next processing timestamp
     * @private
     */
    _getNextBatchProcessingTime() {
        const currentBatch = Math.floor(Date.now() / this.config.batchInterval);
        return (currentBatch + 1) * this.config.batchInterval;
    }

    /**
     * Validate commitment
     * @param {Object} commitment Commitment to validate
     * @private
     */
    async _validateCommitment(commitment) {
        if (!commitment.userId || !commitment.hash) {
            throw new Error('Invalid commitment - missing required fields');
        }
        
        // Check user commitment limits
        const userCommitments = Array.from(this.commitments.values())
            .filter(c => c.userId === commitment.userId && !c.revealed);
        
        if (userCommitments.length >= this.config.maxCommitmentsPerUser) {
            throw new Error('Maximum commitments per user exceeded');
        }
        
        // Validate hash format
        if (!/^[a-f0-9]{64}$/i.test(commitment.hash)) {
            throw new Error('Invalid commitment hash format');
        }
    }

    /**
     * Validate reveal
     * @param {Object} reveal Reveal to validate
     * @private
     */
    async _validateReveal(reveal) {
        if (!reveal.commitmentId || !reveal.order || !reveal.nonce) {
            throw new Error('Invalid reveal - missing required fields');
        }
        
        const commitment = this.commitments.get(reveal.commitmentId);
        if (!commitment) {
            throw new Error('Commitment not found');
        }
        
        if (commitment.revealed) {
            throw new Error('Commitment already revealed');
        }
        
        // Check reveal timing
        const revealDeadline = commitment.timestamp + this.config.commitPhaseDuration + this.config.revealPhaseDuration;
        if (Date.now() > revealDeadline) {
            throw new Error('Reveal deadline exceeded');
        }
    }

    /**
     * Get fair ordering statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            pendingOrders: this.pendingOrders.size,
            timeBuckets: this.timeBuckets.size,
            activeCommitments: Array.from(this.commitments.values())
                .filter(c => !c.revealed).length,
            auctionBatches: this.auctionBatches.size,
            sequenceNumber: this.currentSequenceNumber,
            metrics: this.metrics.getMetrics(),
            sequencer: this.sequencer.getStatistics(),
            mevProtector: this.mevProtector.getStatistics()
        };
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
        }
        
        if (this.auctionInterval) {
            clearInterval(this.auctionInterval);
        }
        
        this.timeBuckets.clear();
        this.pendingOrders.clear();
        this.commitments.clear();
        this.reveals.clear();
        this.auctionBatches.clear();
        
        this.emit('engineDestroyed');
    }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

class OrderSequencer {
    constructor(config) {
        this.config = config;
        this.sequence = [];
        this.sequenceNumber = 0;
    }

    async initialize() {
        console.log('Order Sequencer initialized');
    }

    async addOrder(order) {
        order.finalSequenceNumber = this.sequenceNumber++;
        order.sequencedAt = Date.now();
        this.sequence.push(order);
        
        // Keep sequence manageable
        if (this.sequence.length > 10000) {
            this.sequence.shift();
        }
    }

    getStatistics() {
        return {
            sequenceLength: this.sequence.length,
            currentSequenceNumber: this.sequenceNumber
        };
    }
}

class CommitRevealManager {
    constructor(config) {
        this.config = config;
    }

    async initialize() {
        console.log('Commit-Reveal Manager initialized');
    }
}

class RandomnessGenerator {
    constructor(config) {
        this.config = config;
        this.randomSeed = config.randomSeed;
    }

    async initialize() {
        console.log('Randomness Generator initialized');
    }

    async generatePriority(order) {
        // Generate deterministic but unpredictable priority
        const input = order.id + order.userId + this.randomSeed.toString('hex');
        const hash = crypto.createHash('sha256').update(input).digest();
        
        // Convert to priority between 0 and 1
        const priority = hash.readUInt32BE(0) / 0xFFFFFFFF;
        return priority;
    }
}

class VerifiableRandom {
    constructor(config) {
        this.config = config;
    }

    async generatePriority(order) {
        // Mock verifiable random function
        return Math.random();
    }
}

class MEVProtector {
    constructor(config) {
        this.config = config;
    }

    async initialize() {
        console.log('MEV Protector initialized');
    }

    async protectOrder(order) {
        // Add MEV protection metadata
        order.mevProtected = true;
        order.protectionTimestamp = Date.now();
        return order;
    }

    async calculateMEVRisk(order) {
        // Mock MEV risk calculation
        return 0.1; // Low risk
    }

    getStatistics() {
        return {
            protectedOrders: 0,
            mevAttacksPrevented: 0
        };
    }
}

class FrontRunningDetector {
    constructor(config) {
        this.config = config;
    }

    async calculateRisk(order) {
        // Mock front-running risk calculation
        return 0.05; // Very low risk
    }
}

class BatchAuctioneer {
    constructor(config) {
        this.config = config;
    }

    async initialize() {
        console.log('Batch Auctioneer initialized');
    }

    async runAuction(batch) {
        // Mock batch auction - would implement proper price discovery
        const clearingPrice = this._calculateClearingPrice(batch.orders);
        const orderedList = this._orderByPriority(batch.orders);
        
        return {
            clearingPrice,
            orderedList,
            totalVolume: batch.orders.length,
            auctionTime: Date.now()
        };
    }

    _calculateClearingPrice(orders) {
        // Mock clearing price calculation
        if (orders.length === 0) return 0;
        
        const prices = orders
            .filter(o => o.price)
            .map(o => parseFloat(o.price));
        
        return prices.length > 0 
            ? prices.reduce((sum, price) => sum + price, 0) / prices.length
            : 0;
    }

    _orderByPriority(orders) {
        return orders.sort((a, b) => {
            if (a.priorityScore !== b.priorityScore) {
                return b.priorityScore - a.priorityScore;
            }
            return a.sequenceNumber - b.sequenceNumber;
        });
    }
}

class FairOrderingMetrics {
    constructor() {
        this.metrics = {
            ordersProcessed: 0,
            averageProcessingTime: 0,
            fairnessScore: 0,
            bucketsProcessed: 0,
            batchesProcessed: 0,
            commitmentsSubmitted: 0,
            revealsProcessed: 0
        };
    }

    recordOrderProcessing(processingTime, orderType, fairnessScore) {
        this.metrics.ordersProcessed++;
        
        // Update average processing time
        const totalTime = this.metrics.averageProcessingTime * (this.metrics.ordersProcessed - 1) + processingTime;
        this.metrics.averageProcessingTime = totalTime / this.metrics.ordersProcessed;
        
        // Update average fairness score
        const totalFairness = this.metrics.fairnessScore * (this.metrics.ordersProcessed - 1) + fairnessScore;
        this.metrics.fairnessScore = totalFairness / this.metrics.ordersProcessed;
    }

    recordBucketProcessing(bucketTime, orderCount) {
        this.metrics.bucketsProcessed++;
    }

    recordBatchAuction(batchId, orderCount, auctionResult) {
        this.metrics.batchesProcessed++;
    }

    recordError(operation, error) {
        console.error(`Fair ordering error in ${operation}:`, error.message);
    }

    getMetrics() {
        return { ...this.metrics };
    }
}

module.exports = {
    FairOrderingEngine,
    OrderSequencer,
    CommitRevealManager,
    RandomnessGenerator,
    VerifiableRandom,
    MEVProtector,
    FrontRunningDetector,
    BatchAuctioneer,
    FairOrderingMetrics
};