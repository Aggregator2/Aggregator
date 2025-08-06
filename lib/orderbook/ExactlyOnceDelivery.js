/**
 * @title Exactly-Once Delivery System
 * @author DEX State Management Team
 * @notice Guarantees exactly-once message delivery with idempotency and deduplication
 * @dev Implements outbox pattern, idempotency keys, and distributed acknowledgments
 */

const { ethers } = require('ethers');
const { EventStore } = require('./EventStore');

class ExactlyOnceDelivery {
    constructor(config) {
        this.config = {
            nodeId: config.nodeId || this._generateNodeId(),
            retryAttempts: config.retryAttempts || 5,
            retryBackoff: config.retryBackoff || 1000, // Base retry delay in ms
            ackTimeout: config.ackTimeout || 30000, // 30 seconds
            deduplicationWindow: config.deduplicationWindow || 3600000, // 1 hour
            batchSize: config.batchSize || 100,
            outboxCleanupInterval: config.outboxCleanupInterval || 300000, // 5 minutes
            maxInFlightMessages: config.maxInFlightMessages || 1000,
            enablePersistence: config.enablePersistence || true,
            ...config
        };

        this.eventStore = this.config.eventStore || new EventStore(config);
        
        // Message tracking
        this.outbox = new Map(); // Message ID -> Outbound message
        this.inbox = new Map(); // Message ID -> Inbound message status
        this.idempotencyKeys = new Map(); // Idempotency key -> Result
        this.acknowledgments = new Map(); // Message ID -> Acknowledgment data
        
        // Delivery tracking
        this.inFlightMessages = new Map(); // Message ID -> Delivery attempt
        this.deliveryCallbacks = new Map(); // Message ID -> Callback function
        this.sequenceNumbers = new Map(); // Destination -> Sequence number
        
        // Deduplication and ordering
        this.messageHashes = new Set(); // Content hashes for deduplication
        this.processedMessages = new Map(); // Message ID -> Processing result
        this.orderingBuffer = new Map(); // Destination -> Ordered message buffer
        
        // Performance metrics
        this.metrics = {
            messagesSent: 0,
            messagesReceived: 0,
            messagesDelivered: 0,
            duplicatesDetected: 0,
            retriesExecuted: 0,
            acknowledgementsReceived: 0,
            averageDeliveryTime: 0,
            outboxSize: 0,
            inFlightCount: 0
        };

        this._initializeDeliverySystem();
        this._startBackgroundProcessing();
    }

    /**
     * Send message with exactly-once delivery guarantee
     * @param {Object} message Message to send
     * @param {string} destination Destination identifier
     * @param {Object} options Delivery options
     * @returns {Promise<string>} Message ID
     */
    async sendMessage(message, destination, options = {}) {
        try {
            const {
                idempotencyKey = null,
                priority = 'normal',
                retryPolicy = 'exponential',
                timeoutMs = this.config.ackTimeout,
                requiresOrdering = false
            } = options;

            // Generate unique message ID
            const messageId = this._generateMessageId(message, destination);
            
            // Check for duplicate using idempotency key
            if (idempotencyKey) {
                const existingResult = this.idempotencyKeys.get(idempotencyKey);
                if (existingResult) {
                    console.log(`Duplicate request detected for idempotency key: ${idempotencyKey}`);
                    return existingResult.messageId;
                }
            }

            // Create outbound message
            const outboundMessage = {
                id: messageId,
                content: this._serializeMessage(message),
                destination,
                priority,
                idempotencyKey,
                requiresOrdering,
                createdAt: Date.now(),
                attempts: 0,
                maxAttempts: this.config.retryAttempts,
                retryPolicy,
                timeoutMs,
                status: 'pending',
                sequenceNumber: this._getNextSequenceNumber(destination),
                contentHash: this._calculateContentHash(message),
                metadata: {
                    nodeId: this.config.nodeId,
                    version: 1,
                    correlationId: options.correlationId || null
                }
            };

            // Store in outbox for reliable delivery
            await this._storeInOutbox(outboundMessage);
            
            // Store idempotency mapping
            if (idempotencyKey) {
                this.idempotencyKeys.set(idempotencyKey, {
                    messageId,
                    timestamp: Date.now(),
                    result: 'pending'
                });
            }

            // Start delivery process
            await this._initiateDelivery(outboundMessage);
            
            this.metrics.messagesSent++;
            
            console.log(`Message ${messageId} queued for delivery to ${destination}`);
            return messageId;

        } catch (error) {
            console.error('Failed to send message:', error);
            throw new Error(`Message sending failed: ${error.message}`);
        }
    }

    /**
     * Receive and process incoming message with deduplication
     * @param {Object} message Incoming message
     * @param {Function} processor Message processor function
     * @returns {Promise<Object>} Processing result
     */
    async receiveMessage(message, processor) {
        try {
            const messageId = message.id;
            const contentHash = message.contentHash;
            
            console.log(`Receiving message ${messageId}`);

            // Check for duplicate message
            if (this._isDuplicateMessage(messageId, contentHash)) {
                const existingResult = this.processedMessages.get(messageId);
                console.log(`Duplicate message detected: ${messageId}`);
                this.metrics.duplicatesDetected++;
                
                // Send acknowledgment for duplicate
                await this._sendAcknowledgment(message, existingResult);
                return existingResult;
            }

            // Store in inbox for tracking
            await this._storeInInbox(message);

            // Check ordering requirements
            if (message.requiresOrdering) {
                const orderingResult = await this._handleOrderedMessage(message, processor);
                if (orderingResult.deferred) {
                    return orderingResult;
                }
            }

            // Process message
            const processingResult = await this._processMessage(message, processor);
            
            // Store result for deduplication
            this.processedMessages.set(messageId, processingResult);
            this._updateMessageHashCache(contentHash);
            
            // Send acknowledgment
            await this._sendAcknowledgment(message, processingResult);
            
            this.metrics.messagesReceived++;
            this.metrics.messagesDelivered++;
            
            console.log(`Message ${messageId} processed successfully`);
            return processingResult;

        } catch (error) {
            console.error(`Failed to receive message ${message.id}:`, error);
            
            // Send negative acknowledgment
            await this._sendNegativeAcknowledgment(message, error);
            throw error;
        }
    }

    /**
     * Handle acknowledgment for sent message
     * @param {Object} acknowledgment Acknowledgment data
     * @returns {Promise<void>}
     */
    async handleAcknowledgment(acknowledgment) {
        try {
            const { messageId, status, result, timestamp } = acknowledgment;
            
            console.log(`Received acknowledgment for message ${messageId}: ${status}`);

            // Find message in outbox
            const outboundMessage = this.outbox.get(messageId);
            if (!outboundMessage) {
                console.warn(`Acknowledgment received for unknown message: ${messageId}`);
                return;
            }

            // Update message status
            outboundMessage.status = status;
            outboundMessage.acknowledgedAt = timestamp;
            outboundMessage.acknowledgmentResult = result;

            // Store acknowledgment
            this.acknowledgments.set(messageId, acknowledgment);

            if (status === 'success') {
                // Mark as delivered
                await this._markAsDelivered(messageId);
                
                // Update idempotency result
                if (outboundMessage.idempotencyKey) {
                    const idempotencyEntry = this.idempotencyKeys.get(outboundMessage.idempotencyKey);
                    if (idempotencyEntry) {
                        idempotencyEntry.result = 'success';
                        idempotencyEntry.deliveredAt = timestamp;
                    }
                }
                
                // Execute success callback
                await this._executeDeliveryCallback(messageId, 'success', result);
                
            } else if (status === 'failure') {
                // Handle delivery failure
                await this._handleDeliveryFailure(messageId, result);
            }

            this.metrics.acknowledgementsReceived++;

        } catch (error) {
            console.error('Failed to handle acknowledgment:', error);
            throw error;
        }
    }

    // =============================================================================
    // MESSAGE DELIVERY MANAGEMENT
    // =============================================================================

    /**
     * Initiate delivery process for a message
     * @param {Object} message Outbound message
     * @returns {Promise<void>}
     * @private
     */
    async _initiateDelivery(message) {
        const messageId = message.id;
        
        // Add to in-flight tracking
        this.inFlightMessages.set(messageId, {
            message,
            startTime: Date.now(),
            attemptHistory: []
        });

        // Start delivery attempt
        await this._attemptDelivery(message);
    }

    /**
     * Attempt to deliver a message
     * @param {Object} message Outbound message
     * @returns {Promise<boolean>} Success status
     * @private
     */
    async _attemptDelivery(message) {
        try {
            const messageId = message.id;
            const attempt = message.attempts + 1;
            
            console.log(`Delivery attempt ${attempt}/${message.maxAttempts} for message ${messageId}`);

            message.attempts = attempt;
            message.lastAttemptAt = Date.now();

            // Track attempt
            const inFlightData = this.inFlightMessages.get(messageId);
            if (inFlightData) {
                inFlightData.attemptHistory.push({
                    attempt,
                    timestamp: Date.now()
                });
            }

            // Execute delivery based on destination type
            const deliveryResult = await this._executeDelivery(message);
            
            if (deliveryResult.success) {
                message.status = 'sent';
                message.sentAt = Date.now();
                
                // Start acknowledgment timeout
                this._startAcknowledgmentTimeout(message);
                
                return true;
            } else {
                throw new Error(deliveryResult.error || 'Delivery failed');
            }

        } catch (error) {
            console.error(`Delivery attempt failed for message ${message.id}:`, error);
            
            // Handle retry logic
            await this._handleDeliveryRetry(message, error);
            return false;
        }
    }

    /**
     * Execute the actual delivery mechanism
     * @param {Object} message Outbound message
     * @returns {Promise<Object>} Delivery result
     * @private
     */
    async _executeDelivery(message) {
        try {
            // In a real implementation, this would use appropriate transport
            // (HTTP, WebSocket, message queue, etc.)
            
            const deliveryPayload = {
                id: message.id,
                content: message.content,
                contentHash: message.contentHash,
                sequenceNumber: message.sequenceNumber,
                requiresOrdering: message.requiresOrdering,
                metadata: message.metadata,
                timestamp: Date.now()
            };

            // Simulate delivery (replace with actual transport)
            const delivered = await this._simulateDelivery(message.destination, deliveryPayload);
            
            return {
                success: delivered,
                timestamp: Date.now(),
                deliveryMethod: 'simulated'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Handle delivery retry logic
     * @param {Object} message Message that failed delivery
     * @param {Error} error Delivery error
     * @returns {Promise<void>}
     * @private
     */
    async _handleDeliveryRetry(message, error) {
        const messageId = message.id;
        
        if (message.attempts >= message.maxAttempts) {
            // Max retries exceeded
            console.error(`Max delivery attempts exceeded for message ${messageId}`);
            
            message.status = 'failed';
            message.finalError = error.message;
            
            await this._markAsUndeliverable(messageId, error);
            return;
        }

        // Calculate retry delay
        const retryDelay = this._calculateRetryDelay(message);
        
        console.log(`Retrying delivery for message ${messageId} in ${retryDelay}ms`);
        
        // Schedule retry
        setTimeout(async () => {
            try {
                await this._attemptDelivery(message);
            } catch (retryError) {
                console.error(`Retry failed for message ${messageId}:`, retryError);
            }
        }, retryDelay);

        this.metrics.retriesExecuted++;
    }

    /**
     * Calculate retry delay based on policy
     * @param {Object} message Message being retried
     * @returns {number} Delay in milliseconds
     * @private
     */
    _calculateRetryDelay(message) {
        const baseDelay = this.config.retryBackoff;
        const attempt = message.attempts;

        switch (message.retryPolicy) {
            case 'exponential':
                return baseDelay * Math.pow(2, attempt - 1);
            case 'linear':
                return baseDelay * attempt;
            case 'fixed':
                return baseDelay;
            default:
                return baseDelay;
        }
    }

    // =============================================================================
    // MESSAGE PROCESSING AND ORDERING
    // =============================================================================

    /**
     * Process incoming message with error handling
     * @param {Object} message Incoming message
     * @param {Function} processor Message processor function
     * @returns {Promise<Object>} Processing result
     * @private
     */
    async _processMessage(message, processor) {
        const startTime = Date.now();
        
        try {
            // Deserialize message content
            const deserializedContent = this._deserializeMessage(message.content);
            
            // Execute processor
            const result = await processor(deserializedContent, message.metadata);
            
            const processingTime = Date.now() - startTime;
            
            return {
                success: true,
                result,
                processingTime,
                timestamp: Date.now(),
                messageId: message.id
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            return {
                success: false,
                error: error.message,
                processingTime,
                timestamp: Date.now(),
                messageId: message.id
            };
        }
    }

    /**
     * Handle ordered message delivery
     * @param {Object} message Incoming message
     * @param {Function} processor Message processor function
     * @returns {Promise<Object>} Processing result
     * @private
     */
    async _handleOrderedMessage(message, processor) {
        const destination = message.metadata.nodeId; // Source node
        const sequenceNumber = message.sequenceNumber;
        
        // Get or create ordering buffer for this destination
        if (!this.orderingBuffer.has(destination)) {
            this.orderingBuffer.set(destination, {
                expectedSequence: 1,
                buffer: new Map(),
                lastProcessed: 0
            });
        }
        
        const orderingState = this.orderingBuffer.get(destination);
        
        if (sequenceNumber === orderingState.expectedSequence) {
            // Process this message and any buffered messages in order
            return await this._processOrderedMessages(destination, message, processor);
        } else if (sequenceNumber > orderingState.expectedSequence) {
            // Buffer future message
            orderingState.buffer.set(sequenceNumber, { message, processor });
            
            console.log(`Buffering out-of-order message ${message.id} (seq ${sequenceNumber}, expected ${orderingState.expectedSequence})`);
            
            return {
                deferred: true,
                buffered: true,
                expectedSequence: orderingState.expectedSequence,
                receivedSequence: sequenceNumber
            };
        } else {
            // Duplicate or old message
            console.warn(`Received old message ${message.id} (seq ${sequenceNumber}, expected ${orderingState.expectedSequence})`);
            
            return {
                success: true,
                duplicate: true,
                result: 'already processed'
            };
        }
    }

    /**
     * Process messages in sequence order
     * @param {string} destination Message source
     * @param {Object} currentMessage Current message to process
     * @param {Function} processor Message processor function
     * @returns {Promise<Object>} Processing result
     * @private
     */
    async _processOrderedMessages(destination, currentMessage, processor) {
        const orderingState = this.orderingBuffer.get(destination);
        const results = [];
        
        // Process current message
        const currentResult = await this._processMessage(currentMessage, processor);
        results.push(currentResult);
        
        orderingState.expectedSequence++;
        orderingState.lastProcessed = currentMessage.sequenceNumber;
        
        // Process any buffered messages that are now in order
        while (orderingState.buffer.has(orderingState.expectedSequence)) {
            const bufferedEntry = orderingState.buffer.get(orderingState.expectedSequence);
            orderingState.buffer.delete(orderingState.expectedSequence);
            
            const bufferedResult = await this._processMessage(bufferedEntry.message, bufferedEntry.processor);
            results.push(bufferedResult);
            
            orderingState.expectedSequence++;
            orderingState.lastProcessed = bufferedEntry.message.sequenceNumber;
            
            console.log(`Processed buffered message ${bufferedEntry.message.id} (seq ${bufferedEntry.message.sequenceNumber})`);
        }
        
        return {
            success: true,
            orderedProcessing: true,
            messagesProcessed: results.length,
            results: results
        };
    }

    // =============================================================================
    // DEDUPLICATION AND ACKNOWLEDGMENTS
    // =============================================================================

    /**
     * Check if message is duplicate
     * @param {string} messageId Message identifier
     * @param {string} contentHash Content hash
     * @returns {boolean} True if duplicate
     * @private
     */
    _isDuplicateMessage(messageId, contentHash) {
        // Check by message ID
        if (this.processedMessages.has(messageId)) {
            return true;
        }
        
        // Check by content hash
        if (this.messageHashes.has(contentHash)) {
            return true;
        }
        
        // Check inbox for recent messages
        return this.inbox.has(messageId);
    }

    /**
     * Send acknowledgment for processed message
     * @param {Object} message Original message
     * @param {Object} result Processing result
     * @returns {Promise<void>}
     * @private
     */
    async _sendAcknowledgment(message, result) {
        try {
            const acknowledgment = {
                messageId: message.id,
                status: result.success ? 'success' : 'failure',
                result: result.success ? result.result : result.error,
                timestamp: Date.now(),
                processingTime: result.processingTime,
                nodeId: this.config.nodeId
            };

            // In real implementation, send ack back to sender
            await this._simulateAcknowledgment(message.metadata.nodeId, acknowledgment);
            
            console.log(`Sent acknowledgment for message ${message.id}: ${acknowledgment.status}`);

        } catch (error) {
            console.error(`Failed to send acknowledgment for message ${message.id}:`, error);
        }
    }

    /**
     * Send negative acknowledgment for failed processing
     * @param {Object} message Original message
     * @param {Error} error Processing error
     * @returns {Promise<void>}
     * @private
     */
    async _sendNegativeAcknowledgment(message, error) {
        try {
            const nack = {
                messageId: message.id,
                status: 'failure',
                error: error.message,
                timestamp: Date.now(),
                nodeId: this.config.nodeId
            };

            await this._simulateAcknowledgment(message.metadata.nodeId, nack);
            
            console.log(`Sent negative acknowledgment for message ${message.id}`);

        } catch (nackError) {
            console.error(`Failed to send negative acknowledgment:`, nackError);
        }
    }

    /**
     * Start acknowledgment timeout for sent message
     * @param {Object} message Sent message
     * @returns {void}
     * @private
     */
    _startAcknowledgmentTimeout(message) {
        const timeoutId = setTimeout(async () => {
            if (message.status === 'sent' && !this.acknowledgments.has(message.id)) {
                console.warn(`Acknowledgment timeout for message ${message.id}`);
                
                // Treat as delivery failure
                await this._handleDeliveryFailure(message.id, 'acknowledgment timeout');
            }
        }, message.timeoutMs);

        // Store timeout for cleanup
        message.timeoutId = timeoutId;
    }

    // =============================================================================
    // PERSISTENCE AND STORAGE
    // =============================================================================

    /**
     * Store message in outbox for reliable delivery
     * @param {Object} message Outbound message
     * @returns {Promise<void>}
     * @private
     */
    async _storeInOutbox(message) {
        this.outbox.set(message.id, message);
        
        if (this.config.enablePersistence) {
            // In production, persist to durable storage
            await this._persistMessage('outbox', message);
        }
        
        this.metrics.outboxSize = this.outbox.size;
    }

    /**
     * Store message in inbox for tracking
     * @param {Object} message Inbound message
     * @returns {Promise<void>}
     * @private
     */
    async _storeInInbox(message) {
        this.inbox.set(message.id, {
            message,
            receivedAt: Date.now(),
            status: 'processing'
        });
        
        if (this.config.enablePersistence) {
            await this._persistMessage('inbox', message);
        }
    }

    /**
     * Mark message as successfully delivered
     * @param {string} messageId Message identifier
     * @returns {Promise<void>}
     * @private
     */
    async _markAsDelivered(messageId) {
        const message = this.outbox.get(messageId);
        if (message) {
            message.status = 'delivered';
            message.deliveredAt = Date.now();
            
            // Calculate delivery time
            const deliveryTime = message.deliveredAt - message.createdAt;
            this.metrics.averageDeliveryTime = 
                (this.metrics.averageDeliveryTime + deliveryTime) / 2;
        }

        // Remove from in-flight tracking
        this.inFlightMessages.delete(messageId);
        this.metrics.inFlightCount = this.inFlightMessages.size;
        
        // Clean up timeout
        if (message && message.timeoutId) {
            clearTimeout(message.timeoutId);
        }
    }

    /**
     * Mark message as undeliverable
     * @param {string} messageId Message identifier
     * @param {Error} error Delivery error
     * @returns {Promise<void>}
     * @private
     */
    async _markAsUndeliverable(messageId, error) {
        const message = this.outbox.get(messageId);
        if (message) {
            message.status = 'failed';
            message.finalError = error.message;
            message.failedAt = Date.now();
            
            // Update idempotency result
            if (message.idempotencyKey) {
                const idempotencyEntry = this.idempotencyKeys.get(message.idempotencyKey);
                if (idempotencyEntry) {
                    idempotencyEntry.result = 'failed';
                    idempotencyEntry.error = error.message;
                }
            }
        }

        // Remove from in-flight tracking
        this.inFlightMessages.delete(messageId);
        this.metrics.inFlightCount = this.inFlightMessages.size;
        
        // Execute failure callback
        await this._executeDeliveryCallback(messageId, 'failure', error.message);
    }

    // =============================================================================
    // UTILITY METHODS
    // =============================================================================

    _generateNodeId() {
        return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    _generateMessageId(message, destination) {
        const data = JSON.stringify({
            content: message,
            destination,
            timestamp: Date.now(),
            nodeId: this.config.nodeId,
            nonce: Math.random().toString(36).substr(2, 9)
        });
        
        return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(data));
    }

    _getNextSequenceNumber(destination) {
        const current = this.sequenceNumbers.get(destination) || 0;
        const next = current + 1;
        this.sequenceNumbers.set(destination, next);
        return next;
    }

    _calculateContentHash(content) {
        const contentString = JSON.stringify(content, Object.keys(content).sort());
        return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(contentString));
    }

    _serializeMessage(message) {
        return JSON.stringify(message);
    }

    _deserializeMessage(serializedMessage) {
        return JSON.parse(serializedMessage);
    }

    _updateMessageHashCache(contentHash) {
        this.messageHashes.add(contentHash);
        
        // Implement LRU eviction if cache gets too large
        if (this.messageHashes.size > 10000) {
            // Remove oldest entries (simple approach)
            const hashArray = Array.from(this.messageHashes);
            const toRemove = hashArray.slice(0, 1000);
            toRemove.forEach(hash => this.messageHashes.delete(hash));
        }
    }

    async _executeDeliveryCallback(messageId, status, result) {
        const callback = this.deliveryCallbacks.get(messageId);
        if (callback) {
            try {
                await callback(status, result);
            } catch (error) {
                console.error(`Delivery callback failed for message ${messageId}:`, error);
            }
            this.deliveryCallbacks.delete(messageId);
        }
    }

    async _handleDeliveryFailure(messageId, reason) {
        console.error(`Delivery failed for message ${messageId}: ${reason}`);
        
        const message = this.outbox.get(messageId);
        if (message && message.attempts < message.maxAttempts) {
            // Retry delivery
            await this._handleDeliveryRetry(message, new Error(reason));
        } else {
            // Mark as undeliverable
            await this._markAsUndeliverable(messageId, new Error(reason));
        }
    }

    // =============================================================================
    // SIMULATION METHODS (Replace with real implementations)
    // =============================================================================

    async _simulateDelivery(destination, payload) {
        // Simulate network delay and occasional failures
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
        
        // 95% success rate simulation
        return Math.random() > 0.05;
    }

    async _simulateAcknowledgment(destination, ack) {
        // Simulate acknowledgment delivery
        await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20));
        return true;
    }

    async _persistMessage(type, message) {
        // Simulate persistence
        console.log(`Persisting ${type} message ${message.id}`);
    }

    // =============================================================================
    // BACKGROUND PROCESSING
    // =============================================================================

    _initializeDeliverySystem() {
        console.log(`Exactly-once delivery system initialized for node ${this.config.nodeId}`);
    }

    _startBackgroundProcessing() {
        // Cleanup expired messages
        setInterval(() => {
            this._cleanupExpiredMessages();
        }, this.config.outboxCleanupInterval);

        // Monitor in-flight messages
        setInterval(() => {
            this._monitorInFlightMessages();
        }, 30000); // Every 30 seconds

        // Update metrics
        setInterval(() => {
            this._updateMetrics();
        }, 10000); // Every 10 seconds

        console.log('Background processing started');
    }

    _cleanupExpiredMessages() {
        const now = Date.now();
        const expiryTime = this.config.deduplicationWindow;
        
        // Clean up processed messages
        for (const [messageId, result] of this.processedMessages.entries()) {
            if (now - result.timestamp > expiryTime) {
                this.processedMessages.delete(messageId);
            }
        }
        
        // Clean up delivered outbox messages
        for (const [messageId, message] of this.outbox.entries()) {
            if (message.status === 'delivered' && now - message.deliveredAt > expiryTime) {
                this.outbox.delete(messageId);
            }
        }
        
        // Clean up inbox
        for (const [messageId, entry] of this.inbox.entries()) {
            if (now - entry.receivedAt > expiryTime) {
                this.inbox.delete(messageId);
            }
        }
        
        // Clean up idempotency keys
        for (const [key, entry] of this.idempotencyKeys.entries()) {
            if (now - entry.timestamp > expiryTime) {
                this.idempotencyKeys.delete(key);
            }
        }
    }

    _monitorInFlightMessages() {
        const now = Date.now();
        const timeoutThreshold = this.config.ackTimeout * 2; // 2x timeout as warning threshold
        
        for (const [messageId, inFlightData] of this.inFlightMessages.entries()) {
            const age = now - inFlightData.startTime;
            
            if (age > timeoutThreshold) {
                console.warn(`Long-running delivery for message ${messageId}: ${age}ms`);
            }
        }
    }

    _updateMetrics() {
        this.metrics.outboxSize = this.outbox.size;
        this.metrics.inFlightCount = this.inFlightMessages.size;
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Register delivery callback for message
     * @param {string} messageId Message identifier
     * @param {Function} callback Callback function
     */
    onDelivery(messageId, callback) {
        this.deliveryCallbacks.set(messageId, callback);
    }

    /**
     * Get delivery statistics
     * @returns {Object} Statistics
     */
    getStatistics() {
        return {
            ...this.metrics,
            outboxSize: this.outbox.size,
            inboxSize: this.inbox.size,
            inFlightCount: this.inFlightMessages.size,
            processedMessages: this.processedMessages.size,
            idempotencyKeys: this.idempotencyKeys.size
        };
    }

    /**
     * Get health status
     * @returns {Object} Health status
     */
    getHealthStatus() {
        const pendingMessages = Array.from(this.outbox.values()).filter(m => m.status === 'pending').length;
        const failedMessages = Array.from(this.outbox.values()).filter(m => m.status === 'failed').length;
        
        return {
            status: failedMessages === 0 && pendingMessages < 100 ? 'healthy' : 'degraded',
            pendingMessages,
            failedMessages,
            inFlightMessages: this.inFlightMessages.size,
            lastActivity: Date.now(),
            metrics: this.metrics
        };
    }

    /**
     * Clear all message data (for testing)
     * @returns {Promise<void>}
     */
    async clearAllData() {
        this.outbox.clear();
        this.inbox.clear();
        this.idempotencyKeys.clear();
        this.acknowledgments.clear();
        this.inFlightMessages.clear();
        this.deliveryCallbacks.clear();
        this.processedMessages.clear();
        this.messageHashes.clear();
        this.orderingBuffer.clear();
        
        console.log('All delivery data cleared');
    }
}

module.exports = { ExactlyOnceDelivery };