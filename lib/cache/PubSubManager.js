/**
 * @fileoverview Pub/Sub Manager for Real-time Updates in SwappiQ Protocol
 * @author SwappiQ Protocol
 * @description Advanced pub/sub system for real-time order book, balance, and trade updates with pattern matching and message routing
 */

const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * Pub/Sub Manager
 * Handles real-time messaging, channel management, pattern subscriptions, and message routing
 */
class PubSubManager extends EventEmitter {
    constructor(publisher, subscriber, config = {}) {
        super();
        
        this.publisher = publisher;
        this.subscriber = subscriber;
        this.config = {
            messageRetention: config.messageRetention || 1000, // Number of messages to retain
            maxSubscribers: config.maxSubscribers || 10000,
            messageExpiry: config.messageExpiry || 300000, // 5 minutes
            compressionEnabled: config.compressionEnabled || false,
            encryptionEnabled: config.encryptionEnabled || false,
            rateLimitEnabled: config.rateLimitEnabled !== false,
            rateLimitPerSecond: config.rateLimitPerSecond || 100,
            enableMessageHistory: config.enableMessageHistory !== false,
            enablePresence: config.enablePresence !== false,
            deadLetterQueue: config.deadLetterQueue !== false,
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
                connectionCount: 0,
                avgMessageSize: 0
            },
            rateLimitCounters: new Map()
        };

        // Channel definitions for SwappiQ Protocol
        this.channels = {
            // Order book updates
            orderbook: {
                pattern: 'orderbook:*',
                description: 'Order book updates by trading pair',
                example: 'orderbook:ETH-USDT'
            },
            
            // Trade updates
            trades: {
                pattern: 'trades:*',
                description: 'Real-time trade execution updates',
                example: 'trades:ETH-USDT'
            },
            
            // Balance updates
            balances: {
                pattern: 'balances:*',
                description: 'Wallet balance updates',
                example: 'balances:0x123...abc'
            },
            
            // User notifications
            notifications: {
                pattern: 'notifications:*',
                description: 'User-specific notifications',
                example: 'notifications:user:123'
            },
            
            // System events
            system: {
                pattern: 'system:*',
                description: 'System-wide events and announcements',
                example: 'system:maintenance'
            },
            
            // Price feeds
            prices: {
                pattern: 'prices:*',
                description: 'Token price updates',
                example: 'prices:ETH'
            },
            
            // Market data
            market: {
                pattern: 'market:*',
                description: 'Market statistics and metrics',
                example: 'market:stats'
            }
        };

        // Message types and their schemas
        this.messageTypes = {
            ORDER_BOOK_UPDATE: {
                schema: ['tradingPair', 'bids', 'asks', 'sequence', 'timestamp'],
                validation: this._validateOrderBookUpdate.bind(this)
            },
            TRADE_EXECUTED: {
                schema: ['tradingPair', 'price', 'quantity', 'side', 'tradeId', 'timestamp'],
                validation: this._validateTradeUpdate.bind(this)
            },
            BALANCE_UPDATE: {
                schema: ['walletAddress', 'tokenAddress', 'balance', 'network', 'blockNumber'],
                validation: this._validateBalanceUpdate.bind(this)
            },
            PRICE_UPDATE: {
                schema: ['tokenAddress', 'price', 'change24h', 'volume24h', 'timestamp'],
                validation: this._validatePriceUpdate.bind(this)
            },
            USER_NOTIFICATION: {
                schema: ['userId', 'type', 'message', 'metadata', 'timestamp'],
                validation: this._validateNotification.bind(this)
            }
        };
    }

    /**
     * Initialize pub/sub manager
     */
    async initialize() {
        try {
            await this._setupSubscriber();
            await this._setupPublisher();
            await this._setupChannelManagement();
            await this._startRateLimitCleanup();
            
            this.state.initialized = true;
            console.log('Pub/Sub Manager initialized');
            
            this.emit('initialized', {
                channels: Object.keys(this.channels).length,
                messageTypes: Object.keys(this.messageTypes).length
            });
            
        } catch (error) {
            console.error('Failed to initialize Pub/Sub Manager:', error);
            throw error;
        }
    }

    /**
     * Setup subscriber for incoming messages
     */
    async _setupSubscriber() {
        this.subscriber.on('message', (channel, message) => {
            this._handleMessage(channel, message);
        });

        this.subscriber.on('pmessage', (pattern, channel, message) => {
            this._handlePatternMessage(pattern, channel, message);
        });

        this.subscriber.on('subscribe', (channel, count) => {
            console.log(`Subscribed to channel: ${channel}, total: ${count}`);
            this.state.stats.totalSubscriptions++;
        });

        this.subscriber.on('psubscribe', (pattern, count) => {
            console.log(`Subscribed to pattern: ${pattern}, total: ${count}`);
        });

        this.subscriber.on('error', (error) => {
            console.error('Subscriber error:', error);
            this.emit('error', { source: 'subscriber', error });
        });
    }

    /**
     * Setup publisher
     */
    async _setupPublisher() {
        this.publisher.on('error', (error) => {
            console.error('Publisher error:', error);
            this.emit('error', { source: 'publisher', error });
        });
    }

    /**
     * Setup channel management
     */
    async _setupChannelManagement() {
        // Subscribe to all defined pattern channels
        for (const [channelName, channelConfig] of Object.entries(this.channels)) {
            await this.subscribeToPattern(channelConfig.pattern);
        }
    }

    /**
     * Publish message to a channel
     */
    async publish(channel, message, options = {}) {
        try {
            const {
                messageType = 'GENERIC',
                compressed = this.config.compressionEnabled,
                encrypted = this.config.encryptionEnabled,
                persistent = false,
                priority = 'normal', // 'low', 'normal', 'high', 'critical'
                metadata = {}
            } = options;

            // Rate limiting check
            if (this.config.rateLimitEnabled) {
                const allowed = await this._checkRateLimit('publish', channel);
                if (!allowed) {
                    this.state.stats.droppedMessages++;
                    return { success: false, reason: 'rate_limited' };
                }
            }

            // Validate message if type is specified
            if (this.messageTypes[messageType]) {
                const isValid = this.messageTypes[messageType].validation(message);
                if (!isValid) {
                    return { success: false, reason: 'validation_failed' };
                }
            }

            // Create message envelope
            const envelope = {
                id: crypto.randomUUID(),
                type: messageType,
                channel,
                data: message,
                metadata: {
                    ...metadata,
                    timestamp: Date.now(),
                    publisher: 'swappiq-protocol',
                    priority,
                    persistent
                }
            };

            // Apply compression if enabled
            let serializedMessage = JSON.stringify(envelope);
            if (compressed && serializedMessage.length > 1024) {
                serializedMessage = await this._compressMessage(serializedMessage);
                envelope.metadata.compressed = true;
            }

            // Apply encryption if enabled
            if (encrypted) {
                serializedMessage = await this._encryptMessage(serializedMessage);
                envelope.metadata.encrypted = true;
            }

            // Publish message
            const result = await this.publisher.publish(channel, serializedMessage);

            // Store in message history if enabled
            if (this.config.enableMessageHistory) {
                await this._storeMessageHistory(channel, envelope);
            }

            // Update statistics
            this.state.stats.totalPublications++;
            this.state.stats.totalMessages++;
            this._updateAvgMessageSize(serializedMessage.length);

            this.emit('messagePublished', {
                channel,
                messageId: envelope.id,
                messageType,
                size: serializedMessage.length,
                subscribers: result
            });

            return {
                success: true,
                messageId: envelope.id,
                subscribers: result,
                size: serializedMessage.length
            };

        } catch (error) {
            console.error('Publish error:', error);
            this.state.stats.droppedMessages++;
            return { success: false, reason: 'publish_error', error: error.message };
        }
    }

    /**
     * Subscribe to a specific channel
     */
    async subscribe(channel, callback) {
        try {
            if (this.state.subscribers.size >= this.config.maxSubscribers) {
                throw new Error('Maximum subscribers limit reached');
            }

            const subscriberId = crypto.randomUUID();
            
            // Store subscriber info
            this.state.subscribers.set(subscriberId, {
                channel,
                callback,
                subscribedAt: Date.now(),
                messageCount: 0
            });

            // Subscribe to Redis channel
            await this.subscriber.subscribe(channel);
            
            // Store channel info
            if (!this.state.channels.has(channel)) {
                this.state.channels.set(channel, {
                    subscribers: new Set(),
                    messageCount: 0,
                    createdAt: Date.now()
                });
            }
            
            this.state.channels.get(channel).subscribers.add(subscriberId);

            // Send message history if available
            if (this.config.enableMessageHistory) {
                const history = await this._getMessageHistory(channel);
                if (history.length > 0) {
                    callback('message_history', { channel, messages: history });
                }
            }

            this.emit('subscribed', { channel, subscriberId });
            
            return { subscriberId, channel };

        } catch (error) {
            console.error('Subscribe error:', error);
            throw error;
        }
    }

    /**
     * Subscribe to channel pattern
     */
    async subscribeToPattern(pattern, callback) {
        try {
            const patternId = crypto.randomUUID();
            
            // Store pattern subscription
            this.state.patterns.set(patternId, {
                pattern,
                callback,
                subscribedAt: Date.now(),
                matchedChannels: new Set()
            });

            // Subscribe to Redis pattern
            await this.subscriber.psubscribe(pattern);

            this.emit('patternSubscribed', { pattern, patternId });
            
            return { patternId, pattern };

        } catch (error) {
            console.error('Pattern subscribe error:', error);
            throw error;
        }
    }

    /**
     * Unsubscribe from channel
     */
    async unsubscribe(subscriberId) {
        try {
            const subscriber = this.state.subscribers.get(subscriberId);
            if (!subscriber) {
                return { success: false, reason: 'subscriber_not_found' };
            }

            const { channel } = subscriber;
            
            // Remove subscriber
            this.state.subscribers.delete(subscriberId);
            
            // Update channel info
            const channelInfo = this.state.channels.get(channel);
            if (channelInfo) {
                channelInfo.subscribers.delete(subscriberId);
                
                // If no more subscribers, unsubscribe from Redis
                if (channelInfo.subscribers.size === 0) {
                    await this.subscriber.unsubscribe(channel);
                    this.state.channels.delete(channel);
                }
            }

            this.emit('unsubscribed', { channel, subscriberId });
            
            return { success: true, channel };

        } catch (error) {
            console.error('Unsubscribe error:', error);
            return { success: false, reason: 'unsubscribe_error' };
        }
    }

    /**
     * Handle incoming messages
     */
    _handleMessage(channel, message) {
        try {
            const envelope = this._parseMessage(message);
            
            // Update channel statistics
            const channelInfo = this.state.channels.get(channel);
            if (channelInfo) {
                channelInfo.messageCount++;
            }

            // Notify subscribers
            const channelSubscribers = this.state.channels.get(channel)?.subscribers || new Set();
            for (const subscriberId of channelSubscribers) {
                const subscriber = this.state.subscribers.get(subscriberId);
                if (subscriber && subscriber.callback) {
                    try {
                        subscriber.callback(channel, envelope.data, envelope.metadata);
                        subscriber.messageCount++;
                    } catch (callbackError) {
                        console.error('Subscriber callback error:', callbackError);
                    }
                }
            }

            this.emit('messageReceived', {
                channel,
                messageId: envelope.id,
                messageType: envelope.type,
                subscriberCount: channelSubscribers.size
            });

        } catch (error) {
            console.error('Handle message error:', error);
            this.emit('messageError', { channel, error });
        }
    }

    /**
     * Handle pattern messages
     */
    _handlePatternMessage(pattern, channel, message) {
        try {
            const envelope = this._parseMessage(message);
            
            // Find pattern subscribers
            for (const [patternId, patternSub] of this.state.patterns) {
                if (patternSub.pattern === pattern && patternSub.callback) {
                    try {
                        patternSub.callback(channel, envelope.data, envelope.metadata);
                        patternSub.matchedChannels.add(channel);
                    } catch (callbackError) {
                        console.error('Pattern callback error:', callbackError);
                    }
                }
            }

            this.emit('patternMessageReceived', {
                pattern,
                channel,
                messageId: envelope.id,
                messageType: envelope.type
            });

        } catch (error) {
            console.error('Handle pattern message error:', error);
        }
    }

    /**
     * Broadcast message to multiple channels
     */
    async broadcast(channels, message, options = {}) {
        const results = [];
        
        for (const channel of channels) {
            const result = await this.publish(channel, message, options);
            results.push({ channel, ...result });
        }
        
        return results;
    }

    /**
     * Send private message to specific user
     */
    async sendPrivateMessage(userId, message, messageType = 'USER_NOTIFICATION') {
        const channel = `notifications:user:${userId}`;
        return this.publish(channel, message, { messageType });
    }

    /**
     * Send order book update
     */
    async publishOrderBookUpdate(tradingPair, orderBookData) {
        const channel = `orderbook:${tradingPair}`;
        return this.publish(channel, orderBookData, {
            messageType: 'ORDER_BOOK_UPDATE',
            priority: 'high'
        });
    }

    /**
     * Send trade execution update
     */
    async publishTradeUpdate(tradingPair, tradeData) {
        const channel = `trades:${tradingPair}`;
        return this.publish(channel, tradeData, {
            messageType: 'TRADE_EXECUTED',
            priority: 'high'
        });
    }

    /**
     * Send balance update
     */
    async publishBalanceUpdate(walletAddress, balanceData) {
        const channel = `balances:${walletAddress}`;
        return this.publish(channel, balanceData, {
            messageType: 'BALANCE_UPDATE',
            priority: 'normal'
        });
    }

    /**
     * Send price update
     */
    async publishPriceUpdate(tokenAddress, priceData) {
        const channel = `prices:${tokenAddress}`;
        return this.publish(channel, priceData, {
            messageType: 'PRICE_UPDATE',
            priority: 'normal'
        });
    }

    /**
     * Get channel statistics
     */
    getChannelStats(channel) {
        const channelInfo = this.state.channels.get(channel);
        if (!channelInfo) {
            return null;
        }

        return {
            channel,
            subscriberCount: channelInfo.subscribers.size,
            messageCount: channelInfo.messageCount,
            createdAt: channelInfo.createdAt,
            uptime: Date.now() - channelInfo.createdAt
        };
    }

    /**
     * Get all active channels
     */
    getActiveChannels() {
        const channels = [];
        
        for (const [channel, info] of this.state.channels) {
            channels.push({
                channel,
                subscriberCount: info.subscribers.size,
                messageCount: info.messageCount,
                createdAt: info.createdAt
            });
        }
        
        return channels;
    }

    /**
     * Get system statistics
     */
    getStats() {
        return {
            ...this.state.stats,
            activeChannels: this.state.channels.size,
            activeSubscribers: this.state.subscribers.size,
            activePatterns: this.state.patterns.size,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const testChannel = 'health_check';
            const testMessage = { test: true, timestamp: Date.now() };
            
            // Test publish
            const publishResult = await this.publish(testChannel, testMessage);
            
            return {
                status: 'healthy',
                canPublish: publishResult.success,
                activeChannels: this.state.channels.size,
                activeSubscribers: this.state.subscribers.size
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    // ========== PRIVATE METHODS ==========

    /**
     * Parse incoming message
     */
    _parseMessage(message) {
        try {
            // Try to parse as JSON first
            let parsed = JSON.parse(message);
            
            // Handle compressed messages
            if (parsed.metadata?.compressed) {
                parsed = JSON.parse(await this._decompressMessage(message));
            }
            
            // Handle encrypted messages
            if (parsed.metadata?.encrypted) {
                parsed = JSON.parse(await this._decryptMessage(message));
            }
            
            return parsed;
        } catch (error) {
            // Fallback for simple string messages
            return {
                id: crypto.randomUUID(),
                type: 'GENERIC',
                data: message,
                metadata: { timestamp: Date.now() }
            };
        }
    }

    /**
     * Store message in history
     */
    async _storeMessageHistory(channel, envelope) {
        if (!this.state.messageHistory.has(channel)) {
            this.state.messageHistory.set(channel, []);
        }
        
        const history = this.state.messageHistory.get(channel);
        history.push({
            ...envelope,
            receivedAt: Date.now()
        });
        
        // Limit history size
        if (history.length > this.config.messageRetention) {
            history.shift();
        }
    }

    /**
     * Get message history for channel
     */
    async _getMessageHistory(channel) {
        return this.state.messageHistory.get(channel) || [];
    }

    /**
     * Rate limiting check
     */
    async _checkRateLimit(operation, identifier) {
        if (!this.config.rateLimitEnabled) return true;
        
        const key = `${operation}:${identifier}`;
        const now = Date.now();
        const windowStart = now - 1000; // 1 second window
        
        if (!this.state.rateLimitCounters.has(key)) {
            this.state.rateLimitCounters.set(key, []);
        }
        
        const counter = this.state.rateLimitCounters.get(key);
        
        // Remove old entries
        while (counter.length > 0 && counter[0] < windowStart) {
            counter.shift();
        }
        
        // Check limit
        if (counter.length >= this.config.rateLimitPerSecond) {
            return false;
        }
        
        // Add current request
        counter.push(now);
        return true;
    }

    /**
     * Start rate limit cleanup
     */
    _startRateLimitCleanup() {
        setInterval(() => {
            const now = Date.now();
            const cutoff = now - 60000; // 1 minute
            
            for (const [key, counter] of this.state.rateLimitCounters) {
                // Remove old entries
                while (counter.length > 0 && counter[0] < cutoff) {
                    counter.shift();
                }
                
                // Remove empty counters
                if (counter.length === 0) {
                    this.state.rateLimitCounters.delete(key);
                }
            }
        }, 30000); // Every 30 seconds
    }

    /**
     * Update average message size
     */
    _updateAvgMessageSize(size) {
        this.state.stats.avgMessageSize = 
            (this.state.stats.avgMessageSize * (this.state.stats.totalMessages - 1) + size) / 
            this.state.stats.totalMessages;
    }

    /**
     * Message validation methods
     */
    _validateOrderBookUpdate(message) {
        return message.tradingPair && message.bids && message.asks && message.sequence;
    }

    _validateTradeUpdate(message) {
        return message.tradingPair && message.price && message.quantity && message.side;
    }

    _validateBalanceUpdate(message) {
        return message.walletAddress && message.tokenAddress && message.balance;
    }

    _validatePriceUpdate(message) {
        return message.tokenAddress && message.price;
    }

    _validateNotification(message) {
        return message.userId && message.type && message.message;
    }

    /**
     * Compression and encryption methods (mock implementations)
     */
    async _compressMessage(message) {
        // Would implement actual compression
        return message;
    }

    async _decompressMessage(message) {
        // Would implement actual decompression
        return message;
    }

    async _encryptMessage(message) {
        // Would implement actual encryption
        return message;
    }

    async _decryptMessage(message) {
        // Would implement actual decryption
        return message;
    }

    /**
     * Cleanup resources
     */
    async shutdown() {
        try {
            console.log('Shutting down Pub/Sub Manager...');
            
            // Unsubscribe from all channels
            const channels = Array.from(this.state.channels.keys());
            if (channels.length > 0) {
                await this.subscriber.unsubscribe(...channels);
            }
            
            // Unsubscribe from all patterns
            const patterns = Array.from(this.state.patterns.values()).map(p => p.pattern);
            if (patterns.length > 0) {
                await this.subscriber.punsubscribe(...patterns);
            }
            
            // Clear state
            this.state.channels.clear();
            this.state.patterns.clear();
            this.state.subscribers.clear();
            this.state.messageHistory.clear();
            
            console.log('Pub/Sub Manager shutdown completed');
            
        } catch (error) {
            console.error('Error during Pub/Sub Manager shutdown:', error);
            throw error;
        }
    }
}

module.exports = { PubSubManager };