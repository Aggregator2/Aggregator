const WebSocket = require('ws');
const Redis = require('ioredis');
const EventEmitter = require('events');
const jwt = require('jsonwebtoken');
const { RateLimiterRedis } = require('rate-limiter-flexible');

/**
 * High-performance WebSocket server for order book updates
 * Supports millions of concurrent connections with efficient broadcasting
 */
class WebSocketOrderBookServer extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      port: config.port || 8080,
      redisHost: config.redisHost || 'localhost',
      redisPort: config.redisPort || 6379,
      jwtSecret: config.jwtSecret || process.env.JWT_SECRET,
      heartbeatInterval: config.heartbeatInterval || 30000,
      messageQueueSize: config.messageQueueSize || 1000,
      compressionThreshold: config.compressionThreshold || 1024,
      maxConnectionsPerIp: config.maxConnectionsPerIp || 10,
      maxSubscriptionsPerConnection: config.maxSubscriptionsPerConnection || 20,
      ...config
    };
    
    // WebSocket server
    this.wss = null;
    
    // Redis clients
    this.redis = new Redis({
      host: this.config.redisHost,
      port: this.config.redisPort
    });
    
    this.subClient = this.redis.duplicate();
    this.pubClient = this.redis.duplicate();
    
    // Connection management
    this.connections = new Map(); // connectionId -> connection object
    this.subscriptions = new Map(); // channel -> Set of connectionIds
    this.userConnections = new Map(); // userId -> Set of connectionIds
    
    // Performance optimization
    this.messageQueues = new Map(); // connectionId -> message queue
    this.broadcastCache = new Map(); // channel -> recent messages
    
    // Rate limiting
    this.rateLimiter = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'orderbook_ws_rl',
      points: 100, // Number of points
      duration: 1, // Per second
      blockDuration: 10, // Block for 10 seconds
    });
    
    // Metrics
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      subscriptions: 0,
      errors: 0
    };
  }

  /**
   * Start WebSocket server
   */
  async start() {
    // Create WebSocket server
    this.wss = new WebSocket.Server({
      port: this.config.port,
      perMessageDeflate: {
        zlibDeflateOptions: {
          chunkSize: 1024,
          memLevel: 7,
          level: 3
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: this.config.compressionThreshold
      },
      handleProtocols: (protocols, request) => {
        // Handle protocol negotiation
        if (protocols.includes('orderbook-v1')) {
          return 'orderbook-v1';
        }
        return false;
      }
    });
    
    // Setup WebSocket event handlers
    this.wss.on('connection', this.handleConnection.bind(this));
    
    // Start heartbeat mechanism
    this.startHeartbeat();
    
    // Setup Redis subscriptions
    await this.setupRedisSubscriptions();
    
    // Start message queue processor
    this.startMessageQueueProcessor();
    
    console.log(`WebSocket server started on port ${this.config.port}`);
    this.emit('started', { port: this.config.port });
  }

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(ws, request) {
    const connectionId = this.generateConnectionId();
    const clientIp = this.getClientIp(request);
    
    try {
      // Rate limit by IP
      await this.rateLimiter.consume(clientIp, 1);
      
      // Check concurrent connections limit
      const ipConnections = Array.from(this.connections.values())
        .filter(conn => conn.ip === clientIp).length;
      
      if (ipConnections >= this.config.maxConnectionsPerIp) {
        ws.close(1008, 'Too many connections');
        return;
      }
    } catch (error) {
      ws.close(1008, 'Rate limit exceeded');
      return;
    }
    
    // Initialize connection object
    const connection = {
      id: connectionId,
      ws,
      ip: clientIp,
      userId: null,
      authenticated: false,
      subscriptions: new Set(),
      lastActivity: Date.now(),
      messageCount: 0,
      createdAt: Date.now()
    };
    
    this.connections.set(connectionId, connection);
    this.messageQueues.set(connectionId, []);
    
    // Update metrics
    this.metrics.totalConnections++;
    this.metrics.activeConnections++;
    
    // Setup connection event handlers
    ws.on('message', (message) => this.handleMessage(connectionId, message));
    ws.on('close', () => this.handleDisconnect(connectionId));
    ws.on('error', (error) => this.handleError(connectionId, error));
    ws.on('pong', () => this.handlePong(connectionId));
    
    // Send welcome message
    this.sendToConnection(connectionId, {
      type: 'welcome',
      connectionId,
      timestamp: Date.now(),
      protocol: 'orderbook-v1'
    });
    
    this.emit('connection', { connectionId, ip: clientIp });
  }

  /**
   * Handle incoming message from client
   */
  async handleMessage(connectionId, message) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    connection.lastActivity = Date.now();
    connection.messageCount++;
    this.metrics.messagesReceived++;
    
    try {
      // Rate limit messages
      await this.rateLimiter.consume(`msg_${connectionId}`, 1);
      
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'authenticate':
          await this.handleAuthenticate(connectionId, data);
          break;
          
        case 'subscribe':
          await this.handleSubscribe(connectionId, data);
          break;
          
        case 'unsubscribe':
          await this.handleUnsubscribe(connectionId, data);
          break;
          
        case 'ping':
          this.sendToConnection(connectionId, { type: 'pong', timestamp: Date.now() });
          break;
          
        default:
          this.sendError(connectionId, 'Unknown message type');
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.sendError(connectionId, 'Invalid JSON');
      } else if (error.remainingPoints !== undefined) {
        this.sendError(connectionId, 'Rate limit exceeded');
      } else {
        console.error('Message handling error:', error);
        this.sendError(connectionId, 'Internal error');
      }
      
      this.metrics.errors++;
    }
  }

  /**
   * Handle authentication
   */
  async handleAuthenticate(connectionId, data) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    try {
      // Verify JWT token
      const decoded = jwt.verify(data.token, this.config.jwtSecret);
      
      connection.userId = decoded.userId;
      connection.authenticated = true;
      
      // Track user connection
      if (!this.userConnections.has(decoded.userId)) {
        this.userConnections.set(decoded.userId, new Set());
      }
      this.userConnections.get(decoded.userId).add(connectionId);
      
      this.sendToConnection(connectionId, {
        type: 'authenticated',
        userId: decoded.userId,
        timestamp: Date.now()
      });
      
      this.emit('authenticated', { connectionId, userId: decoded.userId });
    } catch (error) {
      this.sendError(connectionId, 'Authentication failed');
    }
  }

  /**
   * Handle subscription request
   */
  async handleSubscribe(connectionId, data) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    // Validate subscription
    if (!data.channel || typeof data.channel !== 'string') {
      this.sendError(connectionId, 'Invalid channel');
      return;
    }
    
    // Check subscription limit
    if (connection.subscriptions.size >= this.config.maxSubscriptionsPerConnection) {
      this.sendError(connectionId, 'Subscription limit reached');
      return;
    }
    
    // Check authorization for private channels
    if (data.channel.startsWith('private:') && !connection.authenticated) {
      this.sendError(connectionId, 'Authentication required');
      return;
    }
    
    // Add subscription
    connection.subscriptions.add(data.channel);
    
    if (!this.subscriptions.has(data.channel)) {
      this.subscriptions.set(data.channel, new Set());
      
      // Subscribe to Redis channel if first subscriber
      this.subClient.subscribe(data.channel);
    }
    
    this.subscriptions.get(data.channel).add(connectionId);
    this.metrics.subscriptions++;
    
    // Send subscription confirmation
    this.sendToConnection(connectionId, {
      type: 'subscribed',
      channel: data.channel,
      timestamp: Date.now()
    });
    
    // Send latest snapshot if available
    await this.sendLatestSnapshot(connectionId, data.channel);
    
    this.emit('subscribed', { connectionId, channel: data.channel });
  }

  /**
   * Handle unsubscribe request
   */
  async handleUnsubscribe(connectionId, data) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    if (!data.channel || !connection.subscriptions.has(data.channel)) {
      this.sendError(connectionId, 'Not subscribed to channel');
      return;
    }
    
    // Remove subscription
    connection.subscriptions.delete(data.channel);
    
    const channelSubscribers = this.subscriptions.get(data.channel);
    if (channelSubscribers) {
      channelSubscribers.delete(connectionId);
      
      // Unsubscribe from Redis if no more subscribers
      if (channelSubscribers.size === 0) {
        this.subscriptions.delete(data.channel);
        this.subClient.unsubscribe(data.channel);
      }
    }
    
    this.metrics.subscriptions--;
    
    this.sendToConnection(connectionId, {
      type: 'unsubscribed',
      channel: data.channel,
      timestamp: Date.now()
    });
    
    this.emit('unsubscribed', { connectionId, channel: data.channel });
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    
    // Remove from all subscriptions
    for (const channel of connection.subscriptions) {
      const channelSubscribers = this.subscriptions.get(channel);
      if (channelSubscribers) {
        channelSubscribers.delete(connectionId);
        
        if (channelSubscribers.size === 0) {
          this.subscriptions.delete(channel);
          this.subClient.unsubscribe(channel);
        }
      }
    }
    
    // Remove from user connections
    if (connection.userId && this.userConnections.has(connection.userId)) {
      const userConns = this.userConnections.get(connection.userId);
      userConns.delete(connectionId);
      
      if (userConns.size === 0) {
        this.userConnections.delete(connection.userId);
      }
    }
    
    // Clean up
    this.connections.delete(connectionId);
    this.messageQueues.delete(connectionId);
    
    this.metrics.activeConnections--;
    
    this.emit('disconnected', { 
      connectionId, 
      userId: connection.userId,
      duration: Date.now() - connection.createdAt
    });
  }

  /**
   * Handle connection error
   */
  handleError(connectionId, error) {
    console.error(`Connection ${connectionId} error:`, error);
    this.metrics.errors++;
    
    // Close connection on error
    const connection = this.connections.get(connectionId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.close(1011, 'Internal error');
    }
  }

  /**
   * Handle pong response
   */
  handlePong(connectionId) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastActivity = Date.now();
    }
  }

  /**
   * Setup Redis subscriptions
   */
  async setupRedisSubscriptions() {
    // Handle Redis messages
    this.subClient.on('message', async (channel, message) => {
      try {
        const data = JSON.parse(message);
        await this.broadcastToChannel(channel, data);
      } catch (error) {
        console.error('Redis message error:', error);
      }
    });
    
    // Subscribe to system channels
    this.subClient.subscribe('system:broadcast');
    this.subClient.subscribe('system:maintenance');
  }

  /**
   * Broadcast message to channel subscribers
   */
  async broadcastToChannel(channel, data) {
    const subscribers = this.subscriptions.get(channel);
    if (!subscribers || subscribers.size === 0) return;
    
    // Cache message for late subscribers
    this.cacheChannelMessage(channel, data);
    
    // Prepare message
    const message = {
      type: 'update',
      channel,
      data,
      timestamp: Date.now()
    };
    
    // Queue message for each subscriber
    for (const connectionId of subscribers) {
      this.queueMessage(connectionId, message);
    }
  }

  /**
   * Queue message for connection
   */
  queueMessage(connectionId, message) {
    const queue = this.messageQueues.get(connectionId);
    if (!queue) return;
    
    // Add to queue
    queue.push(message);
    
    // Trim queue if too large
    if (queue.length > this.config.messageQueueSize) {
      queue.shift();
    }
  }

  /**
   * Process message queues
   */
  startMessageQueueProcessor() {
    setInterval(() => {
      for (const [connectionId, queue] of this.messageQueues) {
        if (queue.length === 0) continue;
        
        const connection = this.connections.get(connectionId);
        if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
          continue;
        }
        
        // Batch messages
        const batch = queue.splice(0, Math.min(queue.length, 100));
        
        // Send batched message
        try {
          connection.ws.send(JSON.stringify({
            type: 'batch',
            messages: batch,
            timestamp: Date.now()
          }));
          
          this.metrics.messagesSent += batch.length;
        } catch (error) {
          console.error(`Failed to send to ${connectionId}:`, error);
          connection.ws.close(1011, 'Send failed');
        }
      }
    }, 10); // Process every 10ms
  }

  /**
   * Send message to specific connection
   */
  sendToConnection(connectionId, message) {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    
    try {
      connection.ws.send(JSON.stringify(message));
      this.metrics.messagesSent++;
      return true;
    } catch (error) {
      console.error(`Failed to send to ${connectionId}:`, error);
      return false;
    }
  }

  /**
   * Send error message
   */
  sendError(connectionId, error) {
    this.sendToConnection(connectionId, {
      type: 'error',
      error,
      timestamp: Date.now()
    });
  }

  /**
   * Send latest snapshot to new subscriber
   */
  async sendLatestSnapshot(connectionId, channel) {
    // Extract pair from channel (e.g., "orderbook:BTC-USD" -> "BTC-USD")
    const match = channel.match(/^orderbook:(.+)$/);
    if (!match) return;
    
    const pair = match[1];
    
    try {
      // Get latest order book snapshot from Redis
      const snapshot = await this.redis.get(`ob:${pair}:latest_snapshot`);
      if (snapshot) {
        this.sendToConnection(connectionId, {
          type: 'snapshot',
          channel,
          data: JSON.parse(snapshot),
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Failed to send snapshot:', error);
    }
  }

  /**
   * Cache channel message for late subscribers
   */
  cacheChannelMessage(channel, data) {
    if (!this.broadcastCache.has(channel)) {
      this.broadcastCache.set(channel, []);
    }
    
    const cache = this.broadcastCache.get(channel);
    cache.push({
      data,
      timestamp: Date.now()
    });
    
    // Keep only last 100 messages
    if (cache.length > 100) {
      cache.shift();
    }
    
    // Clean old messages periodically
    const cutoff = Date.now() - 60000; // 1 minute
    const index = cache.findIndex(msg => msg.timestamp > cutoff);
    if (index > 0) {
      cache.splice(0, index);
    }
  }

  /**
   * Start heartbeat mechanism
   */
  startHeartbeat() {
    setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatInterval * 2;
      
      for (const [connectionId, connection] of this.connections) {
        if (connection.ws.readyState !== WebSocket.OPEN) {
          continue;
        }
        
        // Check for inactive connections
        if (now - connection.lastActivity > timeout) {
          connection.ws.close(1001, 'Connection timeout');
          continue;
        }
        
        // Send ping
        try {
          connection.ws.ping();
        } catch (error) {
          console.error(`Ping failed for ${connectionId}:`, error);
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Broadcast message to all connections
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    
    for (const connection of this.connections.values()) {
      if (connection.ws.readyState === WebSocket.OPEN) {
        try {
          connection.ws.send(data);
          this.metrics.messagesSent++;
        } catch (error) {
          console.error('Broadcast error:', error);
        }
      }
    }
  }

  /**
   * Get server statistics
   */
  getStatistics() {
    const channelStats = {};
    
    for (const [channel, subscribers] of this.subscriptions) {
      channelStats[channel] = subscribers.size;
    }
    
    return {
      ...this.metrics,
      uptime: process.uptime(),
      channels: Object.keys(channelStats).length,
      channelStats,
      userCount: this.userConnections.size,
      avgMessagesPerConnection: this.metrics.totalConnections > 0 
        ? Math.round(this.metrics.messagesReceived / this.metrics.totalConnections)
        : 0
    };
  }

  /**
   * Gracefully shutdown server
   */
  async shutdown() {
    console.log('Shutting down WebSocket server...');
    
    // Notify all clients
    this.broadcast({
      type: 'shutdown',
      message: 'Server is shutting down',
      timestamp: Date.now()
    });
    
    // Close all connections
    for (const connection of this.connections.values()) {
      connection.ws.close(1001, 'Server shutdown');
    }
    
    // Close WebSocket server
    if (this.wss) {
      await new Promise((resolve) => {
        this.wss.close(resolve);
      });
    }
    
    // Close Redis connections
    await this.redis.quit();
    await this.subClient.quit();
    await this.pubClient.quit();
    
    this.emit('shutdown');
  }

  // Helper methods

  generateConnectionId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  getClientIp(request) {
    return request.headers['x-forwarded-for']?.split(',')[0].trim() || 
           request.connection.remoteAddress;
  }
}

module.exports = WebSocketOrderBookServer;