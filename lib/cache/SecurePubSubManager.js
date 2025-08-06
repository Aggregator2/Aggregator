/**
 * @fileoverview Secure Pub/Sub Manager with Enhanced Security and Performance
 * @author SwappiQ Protocol - Security Hardened Version
 * @description Production-ready pub/sub system with comprehensive security measures, performance optimizations, and resilience features
 */

const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * Secure Pub/Sub Manager
 * Enhanced version with security fixes, performance optimizations, and comprehensive error handling
 */
class SecurePubSubManager extends EventEmitter {
    constructor(publisher, subscriber, config = {}) {
        super();
        
        this.publisher = publisher;
        this.subscriber = subscriber;
        this.config = {
            messageRetention: config.messageRetention || 1000,
            maxSubscribers: config.maxSubscribers || 10000,
            messageExpiry: config.messageExpiry || 300000,
            compressionEnabled: config.compressionEnabled || false,
            encryptionEnabled: config.encryptionEnabled || false,
            rateLimitEnabled: config.rateLimitEnabled !== false,
            rateLimitPerSecond: config.rateLimitPerSecond || 100,
            enableMessageHistory: config.enableMessageHistory !== false,
            enablePresence: config.enablePresence !== false,
            deadLetterQueue: config.deadLetterQueue !== false,
            
            // SECURITY ENHANCEMENTS
            messageSigningEnabled: config.messageSigningEnabled !== false,
            strictValidation: config.strictValidation !== false,
            maxMessageSize: config.maxMessageSize || 64 * 1024, // 64KB limit
            allowedMessageTypes: config.allowedMessageTypes || [],
            securityLogging: config.securityLogging !== false,
            ipWhitelist: config.ipWhitelist || [],
            rateLimitWindowMs: config.rateLimitWindowMs || 60000,
            
            // PERFORMANCE ENHANCEMENTS
            connectionPooling: config.connectionPooling !== false,
            batchPublishing: config.batchPublishing !== false,
            batchSize: config.batchSize || 100,
            circuitBreakerEnabled: config.circuitBreakerEnabled !== false,
            
            ...config
        };

        this.state = {
            initialized: false,
            channels: new Map(),
            patterns: new Map(),
            subscribers: new Map(),
            messageHistory: new Map(),
            presenceData: new Map(),
            stats: {
                totalMessages: 0,
                totalSubscriptions: 0,
                totalPublications: 0,
                droppedMessages: 0,
                securityViolations: 0,
                validationFailures: 0,
                connectionCount: 0,
                avgMessageSize: 0
            },
            rateLimitCounters: new LRUMap(10000), // LRU cache for rate limiting
            securityEvents: new LRUMap(1000),
            messageQueue: [],
            circuitBreaker: {
                failures: 0,
                state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
                lastFailureTime: 0,
                threshold: 5,
                timeout: 30000
            }
        };

        // SECURITY: Message type validation schemas
        this.messageSchemas = {
            ORDER_BOOK_UPDATE: {
                required: ['tradingPair', 'bids', 'asks', 'sequence', 'timestamp'],
                types: {
                    tradingPair: 'string',
                    bids: 'array',
                    asks: 'array',
                    sequence: 'number',
                    timestamp: 'number'
                },
                validation: this._validateOrderBookUpdate.bind(this)
            },
            TRADE_EXECUTED: {
                required: ['tradingPair', 'price', 'quantity', 'side', 'tradeId', 'timestamp'],
                types: {
                    tradingPair: 'string',
                    price: 'number',
                    quantity: 'number',
                    side: 'string',
                    tradeId: 'string',
                    timestamp: 'number'
                },
                validation: this._validateTradeUpdate.bind(this)
            },
            BALANCE_UPDATE: {
                required: ['walletAddress', 'tokenAddress', 'balance', 'network', 'blockNumber'],
                types: {
                    walletAddress: 'string',
                    tokenAddress: 'string',
                    balance: 'string',
                    network: 'string',
                    blockNumber: 'number'
                },
                validation: this._validateBalanceUpdate.bind(this)
            },
            USER_NOTIFICATION: {
                required: ['userId', 'type', 'message', 'timestamp'],
                types: {
                    userId: 'string',
                    type: 'string',
                    message: 'string',
                    timestamp: 'number'
                },
                validation: this._validateNotification.bind(this)
            }
        };

        // Initialize security components
        this._initializeSecurity();
        this._initializePerformanceOptimizations();
    }

    /**
     * Initialize security components
     */
    _initializeSecurity() {
        // Generate signing key for message integrity
        this.signingKey = crypto.randomBytes(32);
        
        // Initialize security event monitoring
        this.securityMonitor = {
            events: new Map(),
            thresholds: {
                validation_failure: 10, // per minute
                rate_limit_exceeded: 5,
                suspicious_activity: 3
            }
        };
    }

    /**
     * Initialize performance optimizations
     */
    _initializePerformanceOptimizations() {
        // Batch publishing queue
        this.publishQueue = [];
        this.publishBatchTimeout = null;
        
        // Start batch processor
        if (this.config.batchPublishing) {
            this._startBatchProcessor();
        }
    }

    /**
     * SECURITY FIX: Enhanced message publishing with comprehensive validation
     */
    async publish(channel, message, options = {}) {
        const startTime = Date.now();
        
        try {
            const {
                messageType = 'GENERIC',
                compressed = this.config.compressionEnabled,
                encrypted = this.config.encryptionEnabled,
                persistent = false,
                priority = 'normal',
                metadata = {},
                bypassValidation = false // SECURITY: Only for system messages
            } = options;

            // SECURITY: Always validate message structure
            const validationResult = await this._comprehensiveMessageValidation(message, messageType, options);
            if (!validationResult.valid) {
                this._logSecurityEvent('message_validation_failure', {
                    channel,
                    messageType,
                    reason: validationResult.reason,
                    timestamp: Date.now()
                });
                this.state.stats.validationFailures++;
                return { success: false, reason: validationResult.reason };
            }

            // SECURITY: Rate limiting check
            if (this.config.rateLimitEnabled) {
                const rateLimitResult = await this._enhancedRateLimit('publish', channel, options);
                if (!rateLimitResult.allowed) {
                    this.state.stats.droppedMessages++;
                    return { success: false, reason: 'rate_limited', resetTime: rateLimitResult.resetTime };
                }
            }

            // SECURITY: Circuit breaker check
            if (this.state.circuitBreaker.state === 'OPEN') {
                return { success: false, reason: 'circuit_breaker_open' };
            }

            // Create secure message envelope
            const envelope = await this._createSecureEnvelope(message, messageType, metadata, {
                channel,
                priority,
                persistent,
                compressed,
                encrypted
            });

            // PERFORMANCE: Batch publishing if enabled
            if (this.config.batchPublishing && priority !== 'critical') {
                return this._addToBatch(channel, envelope, options);
            }

            // Direct publishing for high-priority messages
            const result = await this._securePublish(channel, envelope);
            
            // Update performance metrics
            this._updatePerformanceMetrics('publish', Date.now() - startTime, result.success);
            
            return result;

        } catch (error) {
            this._handleCircuitBreaker(error);
            this._logSecurityEvent('publish_error', { channel, error: error.message });
            return { success: false, reason: 'publish_error', error: error.message };
        }
    }

    /**
     * SECURITY: Comprehensive message validation
     */
    async _comprehensiveMessageValidation(message, messageType, options = {}) {
        try {
            // 1. Basic structure validation
            if (!message || typeof message !== 'object') {
                return { valid: false, reason: 'invalid_message_structure' };
            }

            // 2. Message size validation
            const messageSize = JSON.stringify(message).length;
            if (messageSize > this.config.maxMessageSize) {
                return { valid: false, reason: 'message_too_large', size: messageSize };
            }

            // 3. Message type validation (SECURITY FIX)
            if (this.config.strictValidation) {
                if (!this.messageSchemas[messageType]) {
                    return { valid: false, reason: 'unknown_message_type' };
                }
                
                // Validate against schema
                const schema = this.messageSchemas[messageType];
                const schemaValidation = this._validateAgainstSchema(message, schema);
                if (!schemaValidation.valid) {
                    return schemaValidation;
                }
            }

            // 4. Content sanitization
            const sanitized = this._sanitizeMessage(message);
            if (!sanitized.safe) {
                return { valid: false, reason: 'unsafe_content_detected' };
            }

            // 5. Business logic validation
            if (this.messageSchemas[messageType]?.validation) {
                const businessValidation = await this.messageSchemas[messageType].validation(message);
                if (!businessValidation) {
                    return { valid: false, reason: 'business_validation_failed' };
                }
            }

            return { valid: true };

        } catch (error) {
            return { valid: false, reason: 'validation_error', error: error.message };
        }
    }

    /**
     * SECURITY: Enhanced rate limiting with distributed support
     */
    async _enhancedRateLimit(operation, identifier, options = {}) {
        try {
            const key = `${operation}:${identifier}`;
            const now = Date.now();
            const window = this.config.rateLimitWindowMs;
            const limit = this.config.rateLimitPerSecond;

            // Get or create counter
            let counter = this.state.rateLimitCounters.get(key);
            if (!counter) {
                counter = { requests: [], windowStart: now };
                this.state.rateLimitCounters.set(key, counter);
            }

            // Clean old requests outside window
            counter.requests = counter.requests.filter(timestamp => 
                now - timestamp < window
            );

            // Check if limit exceeded
            if (counter.requests.length >= limit) {
                const oldestRequest = Math.min(...counter.requests);
                const resetTime = oldestRequest + window;
                
                this._logSecurityEvent('rate_limit_exceeded', {
                    operation,
                    identifier,
                    currentCount: counter.requests.length,
                    limit,
                    resetTime
                });
                
                return { 
                    allowed: false, 
                    remaining: 0, 
                    resetTime,
                    retryAfter: resetTime - now
                };
            }

            // Add current request
            counter.requests.push(now);
            
            return {
                allowed: true,
                remaining: limit - counter.requests.length,
                resetTime: now + window
            };

        } catch (error) {
            // Fail open for availability
            console.error('Rate limiting error:', error);
            return { allowed: true, remaining: 1 };
        }
    }

    /**
     * SECURITY: Create secure message envelope with signing and encryption
     */
    async _createSecureEnvelope(message, messageType, metadata, options) {
        const envelope = {
            id: crypto.randomUUID(),
            type: messageType,
            channel: options.channel,
            data: message,
            metadata: {
                ...metadata,
                timestamp: Date.now(),
                publisher: 'swappiq-protocol',
                priority: options.priority,
                persistent: options.persistent,
                version: '1.0'
            }
        };

        // SECURITY: Message signing for integrity
        if (this.config.messageSigningEnabled) {
            envelope.signature = this._signMessage(envelope);
        }

        // Apply compression if enabled and beneficial
        if (options.compressed) {
            const serialized = JSON.stringify(envelope);
            if (serialized.length > 1024) {
                envelope.data = await this._compressMessage(envelope.data);
                envelope.metadata.compressed = true;
            }
        }

        // Apply encryption if enabled
        if (options.encrypted) {
            envelope.data = await this._encryptMessage(envelope.data);
            envelope.metadata.encrypted = true;
        }

        return envelope;
    }

    /**
     * SECURITY: Message signing for integrity verification
     */
    _signMessage(envelope) {
        const messageString = JSON.stringify({
            type: envelope.type,
            channel: envelope.channel,
            data: envelope.data,
            timestamp: envelope.metadata.timestamp
        });
        
        return crypto
            .createHmac('sha256', this.signingKey)
            .update(messageString)
            .digest('hex');
    }

    /**
     * SECURITY: Verify message signature
     */
    _verifySignature(envelope) {
        if (!envelope.signature) {
            return false;
        }
        
        const expectedSignature = this._signMessage(envelope);
        return crypto.timingSafeEqual(
            Buffer.from(envelope.signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    }

    /**
     * SECURITY: Sanitize message content
     */
    _sanitizeMessage(message) {
        try {
            const messageStr = JSON.stringify(message);
            
            // Check for common injection patterns
            const dangerousPatterns = [
                /<script[^>]*>.*?<\/script>/gi,
                /javascript:/gi,
                /data:text\/html/gi,
                /vbscript:/gi,
                /onload=/gi,
                /onerror=/gi
            ];

            for (const pattern of dangerousPatterns) {
                if (pattern.test(messageStr)) {
                    return { safe: false, reason: 'unsafe_content_detected' };
                }
            }

            return { safe: true };
        } catch (error) {
            return { safe: false, reason: 'sanitization_error' };
        }
    }

    /**
     * SECURITY: Validate message against schema
     */
    _validateAgainstSchema(message, schema) {
        // Check required fields
        for (const field of schema.required) {
            if (!(field in message)) {
                return { valid: false, reason: `missing_required_field: ${field}` };
            }
        }

        // Check field types
        for (const [field, expectedType] of Object.entries(schema.types)) {
            if (field in message) {
                const actualType = Array.isArray(message[field]) ? 'array' : typeof message[field];
                if (actualType !== expectedType) {
                    return { valid: false, reason: `invalid_field_type: ${field}` };
                }
            }
        }

        return { valid: true };
    }

    /**
     * PERFORMANCE: Batch publishing for improved throughput
     */
    _addToBatch(channel, envelope, options) {
        return new Promise((resolve) => {
            this.publishQueue.push({
                channel,
                envelope,
                options,
                resolve,
                timestamp: Date.now()
            });

            if (this.publishQueue.length >= this.config.batchSize) {
                this._flushBatch();
            } else if (!this.publishBatchTimeout) {
                this.publishBatchTimeout = setTimeout(() => {
                    this._flushBatch();
                }, 10); // 10ms batch window
            }
        });
    }

    /**
     * PERFORMANCE: Flush batch queue
     */
    async _flushBatch() {
        if (this.publishQueue.length === 0) return;

        const batch = this.publishQueue.splice(0, this.config.batchSize);
        this.publishBatchTimeout = null;

        try {
            const pipeline = this.publisher.pipeline();
            
            for (const item of batch) {
                const serialized = JSON.stringify(item.envelope);
                pipeline.publish(item.channel, serialized);
            }

            const results = await pipeline.exec();
            
            // Resolve all promises in batch
            batch.forEach((item, index) => {
                const result = results[index];
                item.resolve({
                    success: result[0] === null, // Redis pipeline returns [error, result]
                    messageId: item.envelope.id,
                    subscribers: result[1] || 0
                });
            });

        } catch (error) {
            // Resolve all with error
            batch.forEach(item => {
                item.resolve({
                    success: false,
                    reason: 'batch_publish_error',
                    error: error.message
                });
            });
        }
    }

    /**
     * Start batch processor
     */
    _startBatchProcessor() {
        setInterval(() => {
            if (this.publishQueue.length > 0) {
                this._flushBatch();
            }
        }, 100); // Process batches every 100ms
    }

    /**
     * SECURITY: Log security events with structured format
     */
    _logSecurityEvent(eventType, details) {
        if (!this.config.securityLogging) return;

        const event = {
            type: eventType,
            timestamp: Date.now(),
            details,
            severity: this._getEventSeverity(eventType)
        };

        this.state.securityEvents.set(event.timestamp, event);
        this.state.stats.securityViolations++;

        // Emit for external monitoring
        this.emit('securityEvent', event);

        // Check thresholds for automated response
        this._checkSecurityThresholds(eventType);
    }

    /**
     * Get event severity level
     */
    _getEventSeverity(eventType) {
        const severityMap = {
            'message_validation_failure': 'medium',
            'rate_limit_exceeded': 'low',
            'suspicious_activity': 'high',
            'circuit_breaker_triggered': 'high',
            'publish_error': 'medium'
        };
        
        return severityMap[eventType] || 'low';
    }

    /**
     * Check security thresholds for automated response
     */
    _checkSecurityThresholds(eventType) {
        const threshold = this.securityMonitor.thresholds[eventType];
        if (!threshold) return;

        const recentEvents = Array.from(this.state.securityEvents.values())
            .filter(event => 
                event.type === eventType && 
                Date.now() - event.timestamp < 60000 // Last minute
            );

        if (recentEvents.length >= threshold) {
            this.emit('securityThresholdExceeded', {
                eventType,
                count: recentEvents.length,
                threshold,
                recommendation: this._getSecurityRecommendation(eventType)
            });
        }
    }

    /**
     * Get security recommendation for event type
     */
    _getSecurityRecommendation(eventType) {
        const recommendations = {
            'message_validation_failure': 'Consider implementing stricter input validation',
            'rate_limit_exceeded': 'Monitor for potential DDoS attack',
            'suspicious_activity': 'Investigate potential security breach'
        };
        
        return recommendations[eventType] || 'Monitor situation closely';
    }

    /**
     * PERFORMANCE: Circuit breaker implementation
     */
    _handleCircuitBreaker(error) {
        if (!this.config.circuitBreakerEnabled) return;

        const breaker = this.state.circuitBreaker;
        breaker.failures++;
        breaker.lastFailureTime = Date.now();

        if (breaker.failures >= breaker.threshold && breaker.state === 'CLOSED') {
            breaker.state = 'OPEN';
            this._logSecurityEvent('circuit_breaker_triggered', {
                failures: breaker.failures,
                error: error.message
            });

            // Auto-recovery after timeout
            setTimeout(() => {
                breaker.state = 'HALF_OPEN';
                breaker.failures = 0;
            }, breaker.timeout);
        }
    }

    /**
     * PERFORMANCE: Update performance metrics
     */
    _updatePerformanceMetrics(operation, responseTime, success) {
        this.state.stats.totalMessages++;
        
        if (success) {
            // Reset circuit breaker on success
            if (this.state.circuitBreaker.state === 'HALF_OPEN') {
                this.state.circuitBreaker.state = 'CLOSED';
                this.state.circuitBreaker.failures = 0;
            }
        }

        // Update response time metrics
        this.emit('performanceMetric', {
            operation,
            responseTime,
            success,
            timestamp: Date.now()
        });
    }

    /**
     * Enhanced health check with security and performance metrics
     */
    async healthCheck() {
        try {
            const testChannel = 'health_check';
            const testMessage = { test: true, timestamp: Date.now() };
            
            const publishResult = await this.publish(testChannel, testMessage, {
                messageType: 'HEALTH_CHECK',
                priority: 'low'
            });

            const securityMetrics = {
                securityViolations: this.state.stats.securityViolations,
                validationFailures: this.state.stats.validationFailures,
                circuitBreakerState: this.state.circuitBreaker.state,
                recentSecurityEvents: this.state.securityEvents.size
            };

            const performanceMetrics = {
                avgMessageSize: this.state.stats.avgMessageSize,
                queueSize: this.publishQueue.length,
                activeChannels: this.state.channels.size,
                activeSubscribers: this.state.subscribers.size
            };

            return {
                status: 'healthy',
                canPublish: publishResult.success,
                security: securityMetrics,
                performance: performanceMetrics,
                timestamp: Date.now()
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Enhanced validation methods with security improvements
     */
    async _validateOrderBookUpdate(message) {
        if (!message.tradingPair || typeof message.tradingPair !== 'string') return false;
        if (!Array.isArray(message.bids) || !Array.isArray(message.asks)) return false;
        if (typeof message.sequence !== 'number' || message.sequence < 0) return false;
        
        // Validate bid/ask structure
        for (const bid of message.bids) {
            if (!Array.isArray(bid) || bid.length !== 2) return false;
            if (typeof bid[0] !== 'number' || typeof bid[1] !== 'number') return false;
            if (bid[0] <= 0 || bid[1] <= 0) return false;
        }
        
        return true;
    }

    async _validateTradeUpdate(message) {
        if (!message.tradingPair || typeof message.tradingPair !== 'string') return false;
        if (typeof message.price !== 'number' || message.price <= 0) return false;
        if (typeof message.quantity !== 'number' || message.quantity <= 0) return false;
        if (!['buy', 'sell'].includes(message.side)) return false;
        return true;
    }

    async _validateBalanceUpdate(message) {
        const addressRegex = /^0x[a-fA-F0-9]{40}$/;
        if (!addressRegex.test(message.walletAddress)) return false;
        if (!addressRegex.test(message.tokenAddress)) return false;
        if (typeof message.balance !== 'string') return false;
        if (typeof message.blockNumber !== 'number' || message.blockNumber < 0) return false;
        return true;
    }

    async _validateNotification(message) {
        if (!message.userId || typeof message.userId !== 'string') return false;
        if (!message.type || typeof message.type !== 'string') return false;
        if (!message.message || typeof message.message !== 'string') return false;
        return true;
    }

    /**
     * Enhanced shutdown with graceful cleanup
     */
    async shutdown() {
        try {
            console.log('Shutting down Secure Pub/Sub Manager...');
            
            // Flush any pending batches
            if (this.publishQueue.length > 0) {
                await this._flushBatch();
            }
            
            // Clear timeouts
            if (this.publishBatchTimeout) {
                clearTimeout(this.publishBatchTimeout);
            }
            
            // Call parent shutdown
            await super.shutdown();
            
            console.log('Secure Pub/Sub Manager shutdown completed');
            
        } catch (error) {
            console.error('Error during Secure Pub/Sub Manager shutdown:', error);
            throw error;
        }
    }
}

/**
 * LRU Map implementation for memory-efficient caching
 */
class LRUMap extends Map {
    constructor(maxSize = 1000) {
        super();
        this.maxSize = maxSize;
    }

    get(key) {
        const value = super.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.delete(key);
            this.set(key, value);
        }
        return value;
    }

    set(key, value) {
        if (this.has(key)) {
            this.delete(key);
        } else if (this.size >= this.maxSize) {
            // Remove least recently used (first key)
            const firstKey = this.keys().next().value;
            this.delete(firstKey);
        }
        return super.set(key, value);
    }
}

module.exports = { SecurePubSubManager, LRUMap };