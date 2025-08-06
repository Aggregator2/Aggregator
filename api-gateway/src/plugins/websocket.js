/**
 * WebSocket Plugin for Real-Time Data Streaming
 * Production-ready WebSocket implementation with authentication, rate limiting, and monitoring
 */

import fp from 'fastify-plugin';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import crypto from 'crypto';

/**
 * WebSocket connection manager
 */
class WebSocketManager extends EventEmitter {
    constructor(config, services) {
        super();
        this.config = config;
        this.services = services;
        this.connections = new Map();
        this.subscriptions = new Map();
        this.rateLimiters = new Map();
        this.heartbeatInterval = null;
        this.cleanupInterval = null;
        
        this.setupHeartbeat();
        this.setupCleanup();
    }

    /**
     * Setup heartbeat to detect dead connections
     */
    setupHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            this.connections.forEach((connection, connectionId) => {
                if (connection.ws.readyState === WebSocket.OPEN) {
                    // Send ping
                    connection.ws.ping();
                    connection.lastPing = Date.now();
                    
                    // Check for dead connections
                    if (connection.lastPong && 
                        Date.now() - connection.lastPong > this.config.heartbeatInterval * 2) {
                        this.closeConnection(connectionId, 'Heartbeat timeout');
                    }
                }
            });
        }, this.config.heartbeatInterval);
    }

    /**
     * Setup periodic cleanup of stale data
     */
    setupCleanup() {
        this.cleanupInterval = setInterval(() => {
            // Clean up expired rate limiters
            const cutoff = Date.now() - 60000; // 1 minute ago
            for (const [key, limiter] of this.rateLimiters) {
                if (limiter.lastReset < cutoff) {
                    this.rateLimiters.delete(key);
                }
            }
        }, 60000); // Run every minute
    }

    /**
     * Handle new WebSocket connection
     */
    async handleConnection(connection, request) {
        const connectionId = this.generateConnectionId();
        const clientIp = this.getClientIP(request);
        
        try {
            // Authenticate connection
            const user = await this.authenticateConnection(request);
            
            // Check connection limits
            await this.checkConnectionLimits(user, clientIp);
            
            // Create connection object
            const wsConnection = {
                id: connectionId,
                ws: connection,
                user,
                clientIp,
                userAgent: request.headers['user-agent'],
                connectedAt: new Date(),
                lastActivity: Date.now(),
                lastPing: null,
                lastPong: null,
                subscriptions: new Set(),
                metadata: {}
            };

            // Store connection
            this.connections.set(connectionId, wsConnection);

            // Setup connection event handlers
            this.setupConnectionHandlers(connectionId, wsConnection);

            // Send welcome message
            this.sendMessage(connectionId, {
                type: 'WELCOME',
                connectionId,
                serverTime: new Date().toISOString(),
                config: {
                    heartbeatInterval: this.config.heartbeatInterval,
                    maxPayload: this.config.maxPayload
                }
            });

            // Track analytics
            await this.services.analytics.trackEvent('websocket_connect', {
                connectionId,
                userId: user?.address,
                clientIp,
                userAgent: wsConnection.userAgent
            });

            this.emit('connection', wsConnection);
            
        } catch (error) {
            connection.close(1008, error.message);
            throw error;
        }
    }

    /**
     * Setup event handlers for a connection
     */
    setupConnectionHandlers(connectionId, wsConnection) {
        const { ws } = wsConnection;

        // Handle incoming messages
        ws.on('message', async (data) => {
            try {
                await this.handleMessage(connectionId, data);
            } catch (error) {
                this.sendError(connectionId, error.message, 'MESSAGE_ERROR');
            }
        });

        // Handle pong responses
        ws.on('pong', () => {
            const connection = this.connections.get(connectionId);
            if (connection) {
                connection.lastPong = Date.now();
            }
        });

        // Handle connection close
        ws.on('close', (code, reason) => {
            this.handleDisconnection(connectionId, code, reason);
        });

        // Handle connection errors
        ws.on('error', (error) => {
            this.handleConnectionError(connectionId, error);
        });
    }

    /**
     * Handle incoming WebSocket messages
     */
    async handleMessage(connectionId, data) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        // Update last activity
        connection.lastActivity = Date.now();

        // Check rate limiting
        if (!this.checkRateLimit(connection)) {
            this.sendError(connectionId, 'Rate limit exceeded', 'RATE_LIMIT_ERROR');
            return;
        }

        // Parse message
        let message;
        try {
            message = JSON.parse(data.toString());
        } catch (error) {
            this.sendError(connectionId, 'Invalid JSON', 'PARSE_ERROR');
            return;
        }

        // Validate message structure
        if (!message.type || typeof message.type !== 'string') {
            this.sendError(connectionId, 'Missing or invalid message type', 'VALIDATION_ERROR');
            return;
        }

        // Handle different message types
        switch (message.type) {
            case 'SUBSCRIBE':
                await this.handleSubscribe(connectionId, message);
                break;
                
            case 'UNSUBSCRIBE':
                await this.handleUnsubscribe(connectionId, message);
                break;
                
            case 'PING':
                this.handlePing(connectionId, message);
                break;
                
            case 'AUTH':
                await this.handleAuth(connectionId, message);
                break;
                
            default:
                this.sendError(connectionId, `Unknown message type: ${message.type}`, 'UNKNOWN_TYPE');
        }

        // Track message analytics
        await this.services.analytics.trackEvent('websocket_message', {
            connectionId,
            userId: connection.user?.address,
            messageType: message.type,
            messageSize: data.length
        });
    }

    /**
     * Handle subscription requests
     */
    async handleSubscribe(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        const { channel, params = {} } = message;
        
        if (!channel) {
            this.sendError(connectionId, 'Channel is required', 'VALIDATION_ERROR');
            return;
        }

        try {
            // Validate subscription permissions
            await this.validateSubscriptionPermissions(connection, channel, params);
            
            // Create subscription key
            const subscriptionKey = this.createSubscriptionKey(channel, params);
            
            // Add to connection subscriptions
            connection.subscriptions.add(subscriptionKey);
            
            // Add to global subscriptions
            if (!this.subscriptions.has(subscriptionKey)) {
                this.subscriptions.set(subscriptionKey, new Set());
            }
            this.subscriptions.get(subscriptionKey).add(connectionId);

            // Setup channel-specific data streaming
            await this.setupChannelStream(channel, params, subscriptionKey);

            // Send confirmation
            this.sendMessage(connectionId, {
                type: 'SUBSCRIBED',
                channel,
                params,
                subscriptionKey
            });

            // Track subscription
            await this.services.analytics.trackEvent('websocket_subscribe', {
                connectionId,
                userId: connection.user?.address,
                channel,
                params: JSON.stringify(params)
            });

        } catch (error) {
            this.sendError(connectionId, error.message, 'SUBSCRIPTION_ERROR');
        }
    }

    /**
     * Handle unsubscribe requests
     */
    async handleUnsubscribe(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        const { channel, params = {}, subscriptionKey } = message;
        
        let keyToRemove;
        if (subscriptionKey) {
            keyToRemove = subscriptionKey;
        } else if (channel) {
            keyToRemove = this.createSubscriptionKey(channel, params);
        } else {
            this.sendError(connectionId, 'Channel or subscriptionKey is required', 'VALIDATION_ERROR');
            return;
        }

        // Remove from connection subscriptions
        connection.subscriptions.delete(keyToRemove);
        
        // Remove from global subscriptions
        const subscribers = this.subscriptions.get(keyToRemove);
        if (subscribers) {
            subscribers.delete(connectionId);
            if (subscribers.size === 0) {
                this.subscriptions.delete(keyToRemove);
                await this.cleanupChannelStream(keyToRemove);
            }
        }

        // Send confirmation
        this.sendMessage(connectionId, {
            type: 'UNSUBSCRIBED',
            subscriptionKey: keyToRemove
        });

        // Track unsubscription
        await this.services.analytics.trackEvent('websocket_unsubscribe', {
            connectionId,
            userId: connection.user?.address,
            subscriptionKey: keyToRemove
        });
    }

    /**
     * Handle ping messages
     */
    handlePing(connectionId, message) {
        this.sendMessage(connectionId, {
            type: 'PONG',
            timestamp: new Date().toISOString(),
            id: message.id
        });
    }

    /**
     * Handle authentication messages
     */
    async handleAuth(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        try {
            const { token, apiKey } = message;
            
            let user = null;
            if (token) {
                const decoded = await this.services.auth.verifyToken(token);
                user = decoded.user;
            } else if (apiKey) {
                user = await this.services.auth.validateApiKey(apiKey);
            }

            if (user) {
                connection.user = user;
                this.sendMessage(connectionId, {
                    type: 'AUTH_SUCCESS',
                    user: {
                        address: user.address,
                        permissions: user.permissions
                    }
                });
            } else {
                this.sendError(connectionId, 'Authentication failed', 'AUTH_ERROR');
            }

        } catch (error) {
            this.sendError(connectionId, 'Authentication failed', 'AUTH_ERROR');
        }
    }

    /**
     * Setup data streaming for specific channels
     */
    async setupChannelStream(channel, params, subscriptionKey) {
        switch (channel) {
            case 'orders':
                await this.setupOrderStream(params, subscriptionKey);
                break;
                
            case 'settlements':
                await this.setupSettlementStream(params, subscriptionKey);
                break;
                
            case 'market-data':
                await this.setupMarketDataStream(params, subscriptionKey);
                break;
                
            case 'user-balances':
                await this.setupBalanceStream(params, subscriptionKey);
                break;
                
            default:
                throw new Error(`Unsupported channel: ${channel}`);
        }
    }

    /**
     * Setup order updates stream
     */
    async setupOrderStream(params, subscriptionKey) {
        const { userAddress, tokenPair, status } = params;
        
        // Listen for order updates from database
        this.services.database.on('orderUpdate', (order) => {
            // Check if order matches subscription criteria
            if (userAddress && order.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
                return;
            }
            
            if (tokenPair && 
                (order.tokenIn.toLowerCase() !== tokenPair.tokenIn.toLowerCase() ||
                 order.tokenOut.toLowerCase() !== tokenPair.tokenOut.toLowerCase())) {
                return;
            }
            
            if (status && order.status !== status) {
                return;
            }
            
            // Broadcast to subscribers
            this.broadcastToSubscription(subscriptionKey, {
                type: 'ORDER_UPDATE',
                data: order,
                timestamp: new Date().toISOString()
            });
        });
    }

    /**
     * Setup settlement updates stream
     */
    async setupSettlementStream(params, subscriptionKey) {
        // Listen for settlement updates from blockchain service
        this.services.blockchain.on('settlementUpdate', (settlement) => {
            this.broadcastToSubscription(subscriptionKey, {
                type: 'SETTLEMENT_UPDATE',
                data: settlement,
                timestamp: new Date().toISOString()
            });
        });
    }

    /**
     * Setup market data stream
     */
    async setupMarketDataStream(params, subscriptionKey) {
        const { tokenPair, interval = 1000 } = params;
        
        // Setup periodic market data updates
        const intervalId = setInterval(async () => {
            try {
                const marketData = await this.services.blockchain.getMarketData(tokenPair);
                this.broadcastToSubscription(subscriptionKey, {
                    type: 'MARKET_DATA_UPDATE',
                    data: marketData,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                // Handle error silently to avoid spamming logs
            }
        }, Math.max(interval, 1000)); // Minimum 1 second interval

        // Store interval ID for cleanup
        this.subscriptions.get(subscriptionKey).intervalId = intervalId;
    }

    /**
     * Setup balance updates stream
     */
    async setupBalanceStream(params, subscriptionKey) {
        const { userAddress, chainId } = params;
        
        // Listen for balance updates
        this.services.database.on('balanceUpdate', (balance) => {
            if (userAddress && balance.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
                return;
            }
            
            if (chainId && balance.chainId !== chainId) {
                return;
            }
            
            this.broadcastToSubscription(subscriptionKey, {
                type: 'BALANCE_UPDATE',
                data: balance,
                timestamp: new Date().toISOString()
            });
        });
    }

    /**
     * Broadcast message to all subscribers of a subscription
     */
    broadcastToSubscription(subscriptionKey, message) {
        const subscribers = this.subscriptions.get(subscriptionKey);
        if (!subscribers) return;

        subscribers.forEach(connectionId => {
            this.sendMessage(connectionId, message);
        });
    }

    /**
     * Send message to specific connection
     */
    sendMessage(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
            return false;
        }

        try {
            const data = JSON.stringify(message);
            
            // Check message size
            if (data.length > this.config.maxPayload) {
                this.sendError(connectionId, 'Message too large', 'PAYLOAD_TOO_LARGE');
                return false;
            }

            connection.ws.send(data);
            return true;
        } catch (error) {
            this.handleConnectionError(connectionId, error);
            return false;
        }
    }

    /**
     * Send error message to connection
     */
    sendError(connectionId, message, code = 'ERROR') {
        this.sendMessage(connectionId, {
            type: 'ERROR',
            error: {
                code,
                message
            },
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Handle connection disconnection
     */
    async handleDisconnection(connectionId, code, reason) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        // Clean up subscriptions
        connection.subscriptions.forEach(subscriptionKey => {
            const subscribers = this.subscriptions.get(subscriptionKey);
            if (subscribers) {
                subscribers.delete(connectionId);
                if (subscribers.size === 0) {
                    this.subscriptions.delete(subscriptionKey);
                    this.cleanupChannelStream(subscriptionKey);
                }
            }
        });

        // Remove connection
        this.connections.delete(connectionId);

        // Track disconnection
        await this.services.analytics.trackEvent('websocket_disconnect', {
            connectionId,
            userId: connection.user?.address,
            code,
            reason: reason?.toString(),
            duration: Date.now() - connection.connectedAt.getTime()
        });

        this.emit('disconnection', connection, code, reason);
    }

    /**
     * Handle connection errors
     */
    async handleConnectionError(connectionId, error) {
        const connection = this.connections.get(connectionId);
        
        // Log error
        this.services.logger?.error('WebSocket connection error:', {
            connectionId,
            userId: connection?.user?.address,
            error: error.message
        });

        // Track error
        await this.services.analytics.trackEvent('websocket_error', {
            connectionId,
            userId: connection?.user?.address,
            error: error.message
        });

        // Close connection if it's still open
        if (connection && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.close(1011, 'Internal error');
        }
    }

    /**
     * Authenticate WebSocket connection
     */
    async authenticateConnection(request) {
        // Extract authentication from URL parameters or headers
        const token = request.headers.authorization?.replace('Bearer ', '') ||
                     request.url.searchParams?.get('token');
        const apiKey = request.headers['x-api-key'] || 
                      request.url.searchParams?.get('apiKey');

        if (token) {
            try {
                const decoded = await this.services.auth.verifyToken(token);
                return decoded.user;
            } catch (error) {
                throw new Error('Invalid token');
            }
        }

        if (apiKey) {
            try {
                return await this.services.auth.validateApiKey(apiKey);
            } catch (error) {
                throw new Error('Invalid API key');
            }
        }

        // Allow anonymous connections for public channels
        return null;
    }

    /**
     * Check connection limits
     */
    async checkConnectionLimits(user, clientIp) {
        // Count current connections
        let userConnections = 0;
        let ipConnections = 0;

        this.connections.forEach(conn => {
            if (user && conn.user?.address === user.address) {
                userConnections++;
            }
            if (conn.clientIp === clientIp) {
                ipConnections++;
            }
        });

        // Check limits
        const maxPerUser = user?.tier === 'enterprise' ? 100 : (user?.tier === 'pro' ? 20 : 5);
        const maxPerIP = 50;

        if (userConnections >= maxPerUser) {
            throw new Error('Maximum connections per user exceeded');
        }

        if (ipConnections >= maxPerIP) {
            throw new Error('Maximum connections per IP exceeded');
        }

        if (this.connections.size >= this.config.maxConnections) {
            throw new Error('Server connection limit reached');
        }
    }

    /**
     * Validate subscription permissions
     */
    async validateSubscriptionPermissions(connection, channel, params) {
        // Public channels (no authentication required)
        const publicChannels = ['market-data'];
        if (publicChannels.includes(channel)) {
            return;
        }

        // User must be authenticated for private channels
        if (!connection.user) {
            throw new Error('Authentication required for this channel');
        }

        // Channel-specific permission checks
        switch (channel) {
            case 'orders':
            case 'user-balances':
                // User can only subscribe to their own data
                if (params.userAddress && 
                    params.userAddress.toLowerCase() !== connection.user.address.toLowerCase()) {
                    throw new Error('Access denied: can only subscribe to own data');
                }
                break;
                
            case 'settlements':
                // Premium feature
                if (!['pro', 'enterprise'].includes(connection.user.tier)) {
                    throw new Error('Settlement updates require Pro or Enterprise tier');
                }
                break;
        }
    }

    /**
     * Check rate limiting for connection
     */
    checkRateLimit(connection) {
        const key = connection.user?.address || connection.clientIp;
        const now = Date.now();
        const windowMs = 60000; // 1 minute
        const maxRequests = connection.user?.tier === 'enterprise' ? 1000 : 
                           (connection.user?.tier === 'pro' ? 500 : 100);

        let limiter = this.rateLimiters.get(key);
        if (!limiter) {
            limiter = { count: 0, lastReset: now };
            this.rateLimiters.set(key, limiter);
        }

        // Reset counter if window has passed
        if (now - limiter.lastReset > windowMs) {
            limiter.count = 0;
            limiter.lastReset = now;
        }

        limiter.count++;
        return limiter.count <= maxRequests;
    }

    /**
     * Utility methods
     */
    generateConnectionId() {
        return `ws_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    getClientIP(request) {
        return request.headers['x-forwarded-for']?.split(',')[0] ||
               request.headers['x-real-ip'] ||
               request.connection?.remoteAddress ||
               request.socket?.remoteAddress ||
               '127.0.0.1';
    }

    createSubscriptionKey(channel, params) {
        const sortedParams = Object.keys(params).sort().reduce((obj, key) => {
            obj[key] = params[key];
            return obj;
        }, {});
        return `${channel}:${crypto.createHash('md5').update(JSON.stringify(sortedParams)).digest('hex')}`;
    }

    async cleanupChannelStream(subscriptionKey) {
        const subscription = this.subscriptions.get(subscriptionKey);
        if (subscription?.intervalId) {
            clearInterval(subscription.intervalId);
        }
    }

    /**
     * Close specific connection
     */
    closeConnection(connectionId, reason = 'Server closing connection') {
        const connection = this.connections.get(connectionId);
        if (connection && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.close(1000, reason);
        }
    }

    /**
     * Broadcast to all connections
     */
    broadcast(message, filter = null) {
        this.connections.forEach((connection, connectionId) => {
            if (!filter || filter(connection)) {
                this.sendMessage(connectionId, message);
            }
        });
    }

    /**
     * Get connection statistics
     */
    getStats() {
        const connectionsByTier = { anonymous: 0, free: 0, pro: 0, enterprise: 0 };
        const subscriptionCounts = new Map();

        this.connections.forEach(connection => {
            const tier = connection.user?.tier || 'anonymous';
            connectionsByTier[tier] = (connectionsByTier[tier] || 0) + 1;
        });

        this.subscriptions.forEach((subscribers, key) => {
            const channel = key.split(':')[0];
            subscriptionCounts.set(channel, (subscriptionCounts.get(channel) || 0) + subscribers.size);
        });

        return {
            totalConnections: this.connections.size,
            connectionsByTier,
            totalSubscriptions: this.subscriptions.size,
            subscriptionsByChannel: Object.fromEntries(subscriptionCounts),
            rateLimitersActive: this.rateLimiters.size
        };
    }

    /**
     * Cleanup and shutdown
     */
    async shutdown() {
        // Clear intervals
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        // Close all connections
        this.connections.forEach((connection, connectionId) => {
            this.closeConnection(connectionId, 'Server shutting down');
        });

        // Clean up subscriptions
        this.subscriptions.forEach((subscription, key) => {
            this.cleanupChannelStream(key);
        });

        this.connections.clear();
        this.subscriptions.clear();
        this.rateLimiters.clear();
    }
}

/**
 * Register WebSocket plugin
 */
export async function registerWebSocketPlugin(fastify, services) {
    await fastify.register(import('@fastify/websocket'), {
        options: {
            maxPayload: fastify.config.websocket.maxPayload,
            compression: fastify.config.websocket.compression,
            clientTracking: false // We handle tracking manually
        }
    });

    // Create WebSocket manager
    const wsManager = new WebSocketManager(fastify.config.websocket, services);

    // Add to services for access from other parts of the application
    services.websocket = wsManager;

    // Register WebSocket route
    fastify.register(async function (fastify) {
        fastify.get('/ws', { websocket: true }, async (connection, request) => {
            await wsManager.handleConnection(connection, request);
        });

        // WebSocket status endpoint
        fastify.get('/ws/stats', {
            preHandler: [fastify.authenticate]
        }, async (request, reply) => {
            if (!request.user.isAdmin) {
                return reply.code(403).send({ error: 'Admin access required' });
            }

            const stats = wsManager.getStats();
            return reply.send({
                success: true,
                data: stats
            });
        });
    });

    // Graceful shutdown handler
    fastify.addHook('onClose', async () => {
        await wsManager.shutdown();
    });

    fastify.log.info('✅ WebSocket plugin registered successfully');
}

export default fp(registerWebSocketPlugin, {
    name: 'websocket-plugin'
});