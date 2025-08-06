/**
 * @fileoverview WebSocket Manager for Real-time Order Book Updates
 * @author SwappiQ Protocol
 * @description High-performance WebSocket system for real-time trading data
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * WebSocket Manager for Real-time Communications
 */
class WebSocketManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Server configuration
            port: config.port || 8080,
            host: config.host || '0.0.0.0',
            maxConnections: config.maxConnections || 10000,
            connectionTimeout: config.connectionTimeout || 30000,
            
            // Message configuration
            maxMessageSize: config.maxMessageSize || 1024 * 1024, // 1MB
            messageRateLimit: config.messageRateLimit || 100, // messages per second
            heartbeatInterval: config.heartbeatInterval || 30000, // 30 seconds
            
            // Security configuration
            authentication: {
                enabled: config.authentication?.enabled !== false,
                jwtSecret: config.authentication?.jwtSecret,
                apiKeyValidation: config.authentication?.apiKeyValidation !== false
            },
            
            // Rate limiting
            rateLimiting: {
                enabled: config.rateLimiting?.enabled !== false,
                windowMs: config.rateLimiting?.windowMs || 60000, // 1 minute
                maxMessages: config.rateLimiting?.maxMessages || 1000,
                maxSubscriptions: config.rateLimiting?.maxSubscriptions || 100
            },
            
            // Compression and optimization
            compression: {
                enabled: config.compression?.enabled !== false,
                threshold: config.compression?.threshold || 1024,
                algorithm: config.compression?.algorithm || 'gzip'
            },
            
            // Monitoring and logging
            monitoring: {
                enabled: config.monitoring?.enabled !== false,
                metricsInterval: config.monitoring?.metricsInterval || 10000,
                healthCheckInterval: config.monitoring?.healthCheckInterval || 5000
            },
            
            ...config
        };

        this.state = {
            server: null,
            clients: new Map(),
            subscriptions: new Map(),
            channels: new Map(),
            metrics: {
                totalConnections: 0,
                activeConnections: 0,
                totalMessages: 0,
                messagesSent: 0,
                messagesReceived: 0,
                bytesTransferred: 0,
                errors: 0,
                lastActivity: Date.now()
            },
            rateLimits: new Map(),
            messageQueue: []
        };

        this.messageTypes = {
            SUBSCRIBE: 'subscribe',
            UNSUBSCRIBE: 'unsubscribe',
            ORDER_BOOK_UPDATE: 'orderbook_update',
            ORDER_BOOK_SNAPSHOT: 'orderbook_snapshot',
            TRADE_UPDATE: 'trade_update',
            PRICE_UPDATE: 'price_update',
            HEARTBEAT: 'heartbeat',
            ERROR: 'error',
            AUTHENTICATION: 'auth',
            SUSPICIOUS_ACTIVITY: 'suspicious_activity'
        };

        this.channels = {
            ORDER_BOOK: 'orderbook',
            TRADES: 'trades',
            PRICES: 'prices',
            USER_ORDERS: 'user_orders',
            NOTIFICATIONS: 'notifications'
        };
    }

    /**
     * Initialize WebSocket server
     */
    async initialize() {
        try {
            await this._createServer();
            await this._setupEventHandlers();
            await this._startMonitoring();
            await this._startHeartbeat();
            
            console.log(`WebSocket server initialized on ${this.config.host}:${this.config.port}`);
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize WebSocket server:', error);
            throw error;
        }
    }

    /**
     * Create WebSocket server
     */
    async _createServer() {
        this.state.server = new WebSocket.Server({
            port: this.config.port,
            host: this.config.host,
            maxPayload: this.config.maxMessageSize,
            clientTracking: true,
            perMessageDeflate: this.config.compression.enabled ? {
                threshold: this.config.compression.threshold,
                concurrencyLimit: 10,
                memLevel: 7
            } : false
        });

        this.state.server.on('connection', this._handleConnection.bind(this));
        this.state.server.on('error', this._handleServerError.bind(this));
        this.state.server.on('close', this._handleServerClose.bind(this));
    }

    /**
     * Handle new WebSocket connection
     */
    async _handleConnection(ws, request) {
        try {
            // Check connection limits
            if (this.state.clients.size >= this.config.maxConnections) {
                ws.close(1013, 'Server overloaded');
                return;
            }

            // Create client object
            const clientId = this._generateClientId();
            const client = {
                id: clientId,
                ws,
                ip: this._getClientIP(request),
                userAgent: request.headers['user-agent'],
                subscriptions: new Set(),
                authenticated: false,
                userId: null,
                connectedAt: Date.now(),
                lastActivity: Date.now(),
                messageCount: 0,
                bytesReceived: 0,
                bytesSent: 0,
                rateLimitTokens: this.config.rateLimiting.maxMessages
            };

            // Store client
            this.state.clients.set(clientId, client);
            this.state.metrics.totalConnections++;
            this.state.metrics.activeConnections++;

            // Setup client event handlers
            this._setupClientHandlers(client);

            // Send welcome message
            await this._sendMessage(client, {
                type: 'welcome',
                clientId,
                serverTime: Date.now(),
                config: {
                    heartbeatInterval: this.config.heartbeatInterval,
                    maxSubscriptions: this.config.rateLimiting.maxSubscriptions,
                    authRequired: this.config.authentication.enabled
                }
            });

            console.log(`Client ${clientId} connected from ${client.ip}`);
            this.emit('clientConnected', client);

        } catch (error) {
            console.error('Error handling new connection:', error);
            ws.close(1011, 'Internal server error');
        }
    }

    /**
     * Setup client event handlers
     */
    _setupClientHandlers(client) {
        const { ws } = client;

        ws.on('message', async (data) => {
            try {
                await this._handleClientMessage(client, data);
            } catch (error) {
                console.error(`Error handling message from client ${client.id}:`, error);
                await this._sendError(client, 'Message processing error');
            }
        });

        ws.on('close', (code, reason) => {
            this._handleClientDisconnect(client, code, reason);
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error for client ${client.id}:`, error);
            this._handleClientDisconnect(client, 1006, 'Connection error');
        });

        ws.on('pong', () => {
            client.lastActivity = Date.now();
        });

        // Set connection timeout
        setTimeout(() => {
            if (!client.authenticated && this.config.authentication.enabled) {
                ws.close(1008, 'Authentication timeout');
            }
        }, this.config.connectionTimeout);
    }

    /**
     * Handle client message
     */
    async _handleClientMessage(client, data) {
        try {
            // Rate limiting check
            if (!this._checkRateLimit(client)) {
                await this._sendError(client, 'Rate limit exceeded');
                return;
            }

            // Parse message
            const message = JSON.parse(data.toString());
            
            // Update client metrics
            client.messageCount++;
            client.bytesReceived += data.length;
            client.lastActivity = Date.now();
            this.state.metrics.messagesReceived++;
            this.state.metrics.bytesTransferred += data.length;

            // Validate message structure
            if (!message.type) {
                await this._sendError(client, 'Invalid message format: missing type');
                return;
            }

            // Handle different message types
            switch (message.type) {
                case this.messageTypes.AUTHENTICATION:
                    await this._handleAuthentication(client, message);
                    break;
                    
                case this.messageTypes.SUBSCRIBE:
                    await this._handleSubscription(client, message);
                    break;
                    
                case this.messageTypes.UNSUBSCRIBE:
                    await this._handleUnsubscription(client, message);
                    break;
                    
                case this.messageTypes.HEARTBEAT:
                    await this._handleHeartbeat(client, message);
                    break;
                    
                default:
                    await this._sendError(client, `Unknown message type: ${message.type}`);
            }

        } catch (error) {
            if (error instanceof SyntaxError) {
                await this._sendError(client, 'Invalid JSON format');
            } else {
                console.error('Error processing client message:', error);
                await this._sendError(client, 'Message processing error');
            }
        }
    }

    /**
     * Handle client authentication
     */
    async _handleAuthentication(client, message) {
        if (!this.config.authentication.enabled) {
            client.authenticated = true;
            await this._sendMessage(client, {
                type: 'auth_success',
                message: 'Authentication not required'
            });
            return;
        }

        try {
            const { token, apiKey } = message.data || {};

            // Validate authentication credentials
            const authResult = await this._validateAuthentication(token, apiKey);
            
            if (authResult.valid) {
                client.authenticated = true;
                client.userId = authResult.userId;
                client.permissions = authResult.permissions || [];
                
                await this._sendMessage(client, {
                    type: 'auth_success',
                    message: 'Authentication successful',
                    userId: client.userId
                });
                
                console.log(`Client ${client.id} authenticated as user ${client.userId}`);
            } else {
                await this._sendError(client, 'Authentication failed');
                client.ws.close(1008, 'Authentication failed');
            }

        } catch (error) {
            console.error('Authentication error:', error);
            await this._sendError(client, 'Authentication error');
            client.ws.close(1011, 'Authentication error');
        }
    }

    /**
     * Handle subscription request
     */
    async _handleSubscription(client, message) {
        try {
            const { channel, params = {} } = message.data || {};

            if (!channel) {
                await this._sendError(client, 'Missing channel in subscription request');
                return;
            }

            // Check subscription limits
            if (client.subscriptions.size >= this.config.rateLimiting.maxSubscriptions) {
                await this._sendError(client, 'Maximum subscriptions reached');
                return;
            }

            // Validate channel access
            if (!this._canAccessChannel(client, channel, params)) {
                await this._sendError(client, 'Access denied to channel');
                return;
            }

            // Create subscription
            const subscriptionKey = this._createSubscriptionKey(channel, params);
            client.subscriptions.add(subscriptionKey);

            // Add to channel subscriptions
            if (!this.state.subscriptions.has(subscriptionKey)) {
                this.state.subscriptions.set(subscriptionKey, new Set());
            }
            this.state.subscriptions.get(subscriptionKey).add(client.id);

            await this._sendMessage(client, {
                type: 'subscription_success',
                channel,
                params,
                subscriptionKey
            });

            // Send initial data for certain channels
            await this._sendInitialChannelData(client, channel, params);

            console.log(`Client ${client.id} subscribed to ${subscriptionKey}`);

        } catch (error) {
            console.error('Subscription error:', error);
            await this._sendError(client, 'Subscription failed');
        }
    }

    /**
     * Handle unsubscription request
     */
    async _handleUnsubscription(client, message) {
        try {
            const { channel, params = {} } = message.data || {};
            const subscriptionKey = this._createSubscriptionKey(channel, params);

            // Remove from client subscriptions
            client.subscriptions.delete(subscriptionKey);

            // Remove from channel subscriptions
            if (this.state.subscriptions.has(subscriptionKey)) {
                this.state.subscriptions.get(subscriptionKey).delete(client.id);
                
                // Clean up empty subscription sets
                if (this.state.subscriptions.get(subscriptionKey).size === 0) {
                    this.state.subscriptions.delete(subscriptionKey);
                }
            }

            await this._sendMessage(client, {
                type: 'unsubscription_success',
                channel,
                params
            });

            console.log(`Client ${client.id} unsubscribed from ${subscriptionKey}`);

        } catch (error) {
            console.error('Unsubscription error:', error);
            await this._sendError(client, 'Unsubscription failed');
        }
    }

    /**
     * Handle heartbeat
     */
    async _handleHeartbeat(client, message) {
        client.lastActivity = Date.now();
        await this._sendMessage(client, {
            type: 'heartbeat_ack',
            timestamp: Date.now()
        });
    }

    /**
     * Broadcast order book update
     */
    async broadcastOrderBookUpdate(pair, update) {
        const message = {
            type: this.messageTypes.ORDER_BOOK_UPDATE,
            channel: this.channels.ORDER_BOOK,
            data: {
                pair,
                ...update,
                timestamp: Date.now()
            }
        };

        const subscriptionKey = this._createSubscriptionKey(this.channels.ORDER_BOOK, { pair });
        await this._broadcastToSubscribers(subscriptionKey, message);
    }

    /**
     * Broadcast order book snapshot
     */
    async broadcastOrderBookSnapshot(pair, snapshot) {
        const message = {
            type: this.messageTypes.ORDER_BOOK_SNAPSHOT,
            channel: this.channels.ORDER_BOOK,
            data: {
                pair,
                ...snapshot,
                timestamp: Date.now()
            }
        };

        const subscriptionKey = this._createSubscriptionKey(this.channels.ORDER_BOOK, { pair });
        await this._broadcastToSubscribers(subscriptionKey, message);
    }

    /**
     * Broadcast trade update
     */
    async broadcastTradeUpdate(trade) {
        const message = {
            type: this.messageTypes.TRADE_UPDATE,
            channel: this.channels.TRADES,
            data: {
                ...trade,
                timestamp: Date.now()
            }
        };

        const subscriptionKey = this._createSubscriptionKey(this.channels.TRADES, { pair: trade.pair });
        await this._broadcastToSubscribers(subscriptionKey, message);
    }

    /**
     * Broadcast price update
     */
    async broadcastPriceUpdate(priceData) {
        const message = {
            type: this.messageTypes.PRICE_UPDATE,
            channel: this.channels.PRICES,
            data: {
                ...priceData,
                timestamp: Date.now()
            }
        };

        const subscriptionKey = this._createSubscriptionKey(this.channels.PRICES, {});
        await this._broadcastToSubscribers(subscriptionKey, message);
    }

    /**
     * Send user-specific notification
     */
    async sendUserNotification(userId, notification) {
        const userClients = Array.from(this.state.clients.values())
            .filter(client => client.userId === userId && client.authenticated);

        const message = {
            type: this.messageTypes.NOTIFICATIONS,
            data: {
                ...notification,
                timestamp: Date.now()
            }
        };

        for (const client of userClients) {
            await this._sendMessage(client, message);
        }
    }

    /**
     * Broadcast suspicious activity alert
     */
    async broadcastSuspiciousActivity(activityData) {
        const message = {
            type: this.messageTypes.SUSPICIOUS_ACTIVITY,
            data: {
                ...activityData,
                timestamp: Date.now()
            }
        };

        // Send to admin clients only
        const adminClients = Array.from(this.state.clients.values())
            .filter(client => 
                client.authenticated && 
                client.permissions && 
                client.permissions.includes('admin')
            );

        for (const client of adminClients) {
            await this._sendMessage(client, message);
        }
    }

    /**
     * Broadcast to channel subscribers
     */
    async _broadcastToSubscribers(subscriptionKey, message) {
        if (!this.state.subscriptions.has(subscriptionKey)) {
            return;
        }

        const subscriberIds = this.state.subscriptions.get(subscriptionKey);
        const broadcastPromises = [];

        for (const clientId of subscriberIds) {
            const client = this.state.clients.get(clientId);
            if (client && client.ws.readyState === WebSocket.OPEN) {
                broadcastPromises.push(this._sendMessage(client, message));
            } else {
                // Remove stale client from subscription
                subscriberIds.delete(clientId);
            }
        }

        await Promise.allSettled(broadcastPromises);
    }

    /**
     * Send message to client
     */
    async _sendMessage(client, message) {
        try {
            if (client.ws.readyState !== WebSocket.OPEN) {
                return false;
            }

            const messageStr = JSON.stringify(message);
            const messageSize = Buffer.byteLength(messageStr);

            client.ws.send(messageStr);
            client.bytesSent += messageSize;
            this.state.metrics.messagesSent++;
            this.state.metrics.bytesTransferred += messageSize;

            return true;
        } catch (error) {
            console.error(`Error sending message to client ${client.id}:`, error);
            return false;
        }
    }

    /**
     * Send error message to client
     */
    async _sendError(client, errorMessage, code = 'GENERAL_ERROR') {
        await this._sendMessage(client, {
            type: this.messageTypes.ERROR,
            error: {
                code,
                message: errorMessage,
                timestamp: Date.now()
            }
        });
    }

    // ========== UTILITY METHODS ==========

    _generateClientId() {
        return crypto.randomBytes(16).toString('hex');
    }

    _getClientIP(request) {
        return request.headers['x-forwarded-for'] || 
               request.connection.remoteAddress || 
               request.socket.remoteAddress;
    }

    _createSubscriptionKey(channel, params) {
        const sortedParams = Object.keys(params)
            .sort()
            .map(key => `${key}=${params[key]}`)
            .join('&');
        return `${channel}${sortedParams ? `?${sortedParams}` : ''}`;
    }

    _checkRateLimit(client) {
        const now = Date.now();
        const windowStart = now - this.config.rateLimiting.windowMs;

        // Reset tokens if window has passed
        if (client.lastTokenRefresh < windowStart) {
            client.rateLimitTokens = this.config.rateLimiting.maxMessages;
            client.lastTokenRefresh = now;
        }

        // Check if client has tokens
        if (client.rateLimitTokens > 0) {
            client.rateLimitTokens--;
            return true;
        }

        return false;
    }

    _canAccessChannel(client, channel, params) {
        // Basic channel access validation
        const publicChannels = [this.channels.ORDER_BOOK, this.channels.TRADES, this.channels.PRICES];
        
        if (publicChannels.includes(channel)) {
            return true;
        }

        // Private channels require authentication
        if (!client.authenticated) {
            return false;
        }

        // User-specific channels
        if (channel === this.channels.USER_ORDERS) {
            return params.userId === client.userId;
        }

        // Admin channels
        if (channel === this.channels.NOTIFICATIONS) {
            return client.permissions && client.permissions.includes('admin');
        }

        return false;
    }

    async _sendInitialChannelData(client, channel, params) {
        // This would send initial snapshots for certain channels
        // Implementation depends on the specific data sources
        
        if (channel === this.channels.ORDER_BOOK && params.pair) {
            // Would fetch and send order book snapshot
            this.emit('orderBookSnapshotRequested', {
                clientId: client.id,
                pair: params.pair
            });
        }
    }

    async _validateAuthentication(token, apiKey) {
        // Mock authentication - implement with actual auth service
        if (token === 'valid_token') {
            return {
                valid: true,
                userId: 'user123',
                permissions: ['user']
            };
        }
        
        if (apiKey === 'admin_key') {
            return {
                valid: true,
                userId: 'admin',
                permissions: ['admin']
            };
        }

        return { valid: false };
    }

    _handleClientDisconnect(client, code, reason) {
        console.log(`Client ${client.id} disconnected: ${code} ${reason}`);

        // Remove from all subscriptions
        for (const subscriptionKey of client.subscriptions) {
            if (this.state.subscriptions.has(subscriptionKey)) {
                this.state.subscriptions.get(subscriptionKey).delete(client.id);
            }
        }

        // Remove client
        this.state.clients.delete(client.id);
        this.state.metrics.activeConnections--;

        this.emit('clientDisconnected', client, code, reason);
    }

    _handleServerError(error) {
        console.error('WebSocket server error:', error);
        this.state.metrics.errors++;
        this.emit('serverError', error);
    }

    _handleServerClose() {
        console.log('WebSocket server closed');
        this.emit('serverClosed');
    }

    async _setupEventHandlers() {
        // Setup periodic cleanup of stale connections
        setInterval(() => {
            this._cleanupStaleConnections();
        }, 60000); // Every minute
    }

    async _startMonitoring() {
        if (!this.config.monitoring.enabled) return;

        setInterval(() => {
            this.emit('metrics', this.getMetrics());
        }, this.config.monitoring.metricsInterval);
    }

    async _startHeartbeat() {
        setInterval(() => {
            this._sendHeartbeats();
        }, this.config.heartbeatInterval);
    }

    _sendHeartbeats() {
        const now = Date.now();
        for (const client of this.state.clients.values()) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.ping();
                
                // Check for inactive clients
                if (now - client.lastActivity > this.config.heartbeatInterval * 2) {
                    client.ws.close(1000, 'Inactive connection');
                }
            }
        }
    }

    _cleanupStaleConnections() {
        const now = Date.now();
        const staleClients = [];

        for (const client of this.state.clients.values()) {
            if (client.ws.readyState !== WebSocket.OPEN || 
                now - client.lastActivity > this.config.connectionTimeout) {
                staleClients.push(client);
            }
        }

        for (const client of staleClients) {
            this._handleClientDisconnect(client, 1000, 'Stale connection cleanup');
        }
    }

    /**
     * Get server metrics
     */
    getMetrics() {
        return {
            ...this.state.metrics,
            clients: {
                total: this.state.clients.size,
                authenticated: Array.from(this.state.clients.values())
                    .filter(c => c.authenticated).length,
                byChannel: this._getSubscriptionMetrics()
            },
            server: {
                uptime: Date.now() - (this.startTime || Date.now()),
                memoryUsage: process.memoryUsage(),
                timestamp: Date.now()
            }
        };
    }

    _getSubscriptionMetrics() {
        const metrics = {};
        for (const [key, subscribers] of this.state.subscriptions.entries()) {
            const [channel] = key.split('?');
            metrics[channel] = (metrics[channel] || 0) + subscribers.size;
        }
        return metrics;
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        console.log('Shutting down WebSocket server...');

        // Close all client connections
        for (const client of this.state.clients.values()) {
            client.ws.close(1001, 'Server shutting down');
        }

        // Close server
        if (this.state.server) {
            this.state.server.close();
        }

        console.log('WebSocket server shutdown complete');
    }
}

module.exports = WebSocketManager;