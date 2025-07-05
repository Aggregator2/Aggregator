import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { EventEmitter } from 'events';
import { validateWebSocketConnection } from '../../middleware/auth';
import { RateLimiter, RateLimitConfig } from './RateLimiter';

export interface WebSocketConfig {
  port?: number;
  path?: string;
  cors?: {
    origin: string | string[];
    credentials: boolean;
  };
  pingInterval?: number;
  pingTimeout?: number;
  apiKeySecret?: string;
  jwtSecret?: string;
  maxSubscriptionsPerClient?: number;
  messageRateLimit?: {
    windowMs: number;
    maxMessages: number;
  };
  rateLimiting?: Partial<RateLimitConfig>;
}

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  apiKey?: any; // Changed to hold the full API key object
  subscriptions: Map<string, Set<string>>;
  lastActivity: number;
  messageCount: number;
  messageWindowStart: number;
}

export interface SubscriptionMessage {
  op: 'subscribe' | 'unsubscribe';
  channel: 'orderbook' | 'trades' | 'orders' | 'settlements' | 'tickers' | 'positions';
  pair?: string;
  userId?: string;
  params?: any;
}

export interface BroadcastMessage {
  channel: string;
  pair?: string;
  type: 'snapshot' | 'update' | 'trade' | 'settlement' | 'error';
  data: any;
  sequence?: number;
  timestamp: number;
}

export class WebSocketServer extends EventEmitter {
  private io: SocketIOServer;
  private config: WebSocketConfig;
  private clients: Map<string, AuthenticatedSocket> = new Map();
  private sequences: Map<string, number> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private rateLimiter: RateLimiter;

  constructor(server: HTTPServer, config: WebSocketConfig = {}) {
    super();
    
    this.config = {
      path: '/ws',
      pingInterval: 25000,
      pingTimeout: 60000,
      maxSubscriptionsPerClient: 100,
      messageRateLimit: {
        windowMs: 60000, // 1 minute
        maxMessages: 1000
      },
      ...config
    };

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter({
      maxSubscriptionsPerConnection: 10,
      maxConnectionsPerApiKey: 5,
      messageThrottling: {
        windowMs: 60000,
        maxMessages: 1000,
        highFrequencyChannels: ['orderbook', 'trades', 'tickers'],
        throttleDelay: 100
      },
      connectionLimits: {
        globalMaxConnections: 10000,
        perIpMaxConnections: 10,
        burstAllowance: 2
      },
      ...config.rateLimiting
    });

    // Initialize Socket.IO
    this.io = new SocketIOServer(server, {
      path: this.config.path,
      cors: this.config.cors || {
        origin: '*',
        credentials: true
      },
      pingInterval: this.config.pingInterval,
      pingTimeout: this.config.pingTimeout,
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    this.startHealthCheck();
  }

  private setupMiddleware(): void {
    // Authentication middleware
    this.io.use(async (socket: Socket, next) => {
      try {
        const apiKey = socket.handshake.auth.apiKey || socket.handshake.query.apiKey;

        if (!apiKey) {
          return next(new Error('Authentication required: API key missing'));
        }

        const keyDetails = await validateWebSocketConnection(apiKey as string);
        if (!keyDetails) {
          return next(new Error('Invalid or expired API key'));
        }

        // Check rate limits for new connection
        const ip = socket.handshake.address || 'unknown';
        const canConnect = this.rateLimiter.canConnect(apiKey as string, ip);
        
        if (!canConnect.allowed) {
          return next(new Error(canConnect.reason || 'Connection denied'));
        }

        const authSocket = socket as AuthenticatedSocket;
        authSocket.apiKey = keyDetails;
        authSocket.userId = keyDetails.userId;
        authSocket.subscriptions = new Map();
        authSocket.lastActivity = Date.now();
        authSocket.messageCount = 0;
        authSocket.messageWindowStart = Date.now();

        next();
      } catch (error) {
        next(error as Error);
      }
    });
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const authSocket = socket as AuthenticatedSocket;
      this.handleConnection(authSocket);
    });
  }

  private handleConnection(socket: AuthenticatedSocket): void {
    console.log(`Client connected: ${socket.id} (user: ${socket.userId || 'anonymous'})`);
    this.clients.set(socket.id, socket);

    // Register connection with rate limiter
    const ip = socket.handshake.address || 'unknown';
    const apiKey = socket.apiKey?.key || socket.handshake.auth.apiKey || 'unknown';
    this.rateLimiter.registerConnection(socket.id, apiKey, ip);

    // Send welcome message with rate limit info
    socket.emit('connected', {
      socketId: socket.id,
      timestamp: Date.now(),
      server: 'WebSocket API v1.0',
      rateLimits: this.rateLimiter.getRateLimitStatus(socket.id)
    });

    // Handle subscription messages
    socket.on('message', (message: SubscriptionMessage) => {
      this.handleMessage(socket, message);
    });

    // Handle ping/pong
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
      socket.lastActivity = Date.now();
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`Client disconnected: ${socket.id} (${reason})`);
      this.clients.delete(socket.id);
      this.rateLimiter.removeConnection(socket.id);
      this.emit('clientDisconnected', { socketId: socket.id, reason });
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
      this.emit('socketError', { socketId: socket.id, error });
    });

    this.emit('clientConnected', { 
      socketId: socket.id, 
      userId: socket.userId,
      apiKey: socket.apiKey 
    });
  }

  private handleMessage(socket: AuthenticatedSocket, message: SubscriptionMessage): void {
    // Check message rate limit
    const rateCheck = this.rateLimiter.checkMessageRateLimit(socket.id);
    if (!rateCheck.allowed) {
      socket.emit('error', {
        code: 'RATE_LIMIT_EXCEEDED',
        message: rateCheck.reason || 'Too many messages'
      });
      return;
    }

    socket.lastActivity = Date.now();

    try {
      switch (message.op) {
        case 'subscribe':
          this.handleSubscribe(socket, message);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(socket, message);
          break;
        default:
          socket.emit('error', {
            code: 'INVALID_OPERATION',
            message: `Unknown operation: ${message.op}`
          });
      }
    } catch (error) {
      socket.emit('error', {
        code: 'MESSAGE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to process message'
      });
    }
  }

  private handleSubscribe(socket: AuthenticatedSocket, message: SubscriptionMessage): void {
    const { channel, pair, userId } = message;

    // Validate subscription
    if (!this.validateSubscription(socket, channel, pair, userId)) {
      return;
    }

    // Check subscription limit with rate limiter
    const canSubscribe = this.rateLimiter.canSubscribe(socket.id);
    if (!canSubscribe.allowed) {
      socket.emit('error', {
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        message: canSubscribe.reason || 'Maximum subscriptions reached'
      });
      return;
    }

    // Add subscription
    if (!socket.subscriptions.has(channel)) {
      socket.subscriptions.set(channel, new Set());
    }

    const subscriptionKey = this.getSubscriptionKey(channel, pair, userId);
    socket.subscriptions.get(channel)!.add(subscriptionKey);

    // Update rate limiter subscription count
    this.rateLimiter.addSubscription(socket.id);

    // Join room for efficient broadcasting
    socket.join(subscriptionKey);

    // Send confirmation
    socket.emit('subscribed', {
      channel,
      pair,
      userId,
      timestamp: Date.now()
    });

    // Send initial snapshot for certain channels
    this.sendInitialSnapshot(socket, channel, pair, userId);

    this.emit('subscription', {
      socketId: socket.id,
      channel,
      pair,
      userId: userId || socket.userId
    });
  }

  private handleUnsubscribe(socket: AuthenticatedSocket, message: SubscriptionMessage): void {
    const { channel, pair, userId } = message;
    const subscriptionKey = this.getSubscriptionKey(channel, pair, userId);

    if (socket.subscriptions.has(channel)) {
      socket.subscriptions.get(channel)!.delete(subscriptionKey);
      
      if (socket.subscriptions.get(channel)!.size === 0) {
        socket.subscriptions.delete(channel);
      }

      // Update rate limiter subscription count
      this.rateLimiter.removeSubscription(socket.id);
    }

    // Leave room
    socket.leave(subscriptionKey);

    // Send confirmation
    socket.emit('unsubscribed', {
      channel,
      pair,
      userId,
      timestamp: Date.now()
    });

    this.emit('unsubscription', {
      socketId: socket.id,
      channel,
      pair,
      userId: userId || socket.userId
    });
  }

  private validateSubscription(
    socket: AuthenticatedSocket,
    channel: string,
    pair?: string,
    userId?: string
  ): boolean {
    // Validate channel
    const validChannels = ['orderbook', 'trades', 'orders', 'settlements', 'tickers', 'positions'];
    if (!validChannels.includes(channel)) {
      socket.emit('error', {
        code: 'INVALID_CHANNEL',
        message: `Invalid channel: ${channel}`
      });
      return false;
    }

    // Validate pair for market data channels
    if (['orderbook', 'trades', 'tickers'].includes(channel) && !pair) {
      socket.emit('error', {
        code: 'PAIR_REQUIRED',
        message: `Pair required for ${channel} channel`
      });
      return false;
    }

    // Validate user access for private channels
    if (['orders', 'positions'].includes(channel)) {
      const targetUserId = userId || socket.userId;
      if (!targetUserId) {
        socket.emit('error', {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required for private channels'
        });
        return false;
      }

      // Check if user can access this data
      if (socket.userId && socket.userId !== targetUserId) {
        socket.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Cannot subscribe to other users data'
        });
        return false;
      }
    }

    return true;
  }

  private getSubscriptionKey(channel: string, pair?: string, userId?: string): string {
    if (channel === 'orders' || channel === 'positions') {
      return `${channel}:${userId || 'public'}`;
    }
    if (pair) {
      return `${channel}:${pair}`;
    }
    return channel;
  }

  private sendInitialSnapshot(
    socket: AuthenticatedSocket,
    channel: string,
    pair?: string,
    userId?: string
  ): void {
    // Emit event for the application to send snapshot
    this.emit('snapshotRequested', {
      socketId: socket.id,
      channel,
      pair,
      userId: userId || socket.userId,
      callback: (data: any) => {
        socket.emit('message', {
          channel,
          pair,
          type: 'snapshot',
          data,
          sequence: this.getNextSequence(channel, pair),
          timestamp: Date.now()
        });
      }
    });
  }

  private checkRateLimit(socket: AuthenticatedSocket): boolean {
    const now = Date.now();
    const { windowMs } = this.config.messageRateLimit!;
    const maxMessages = socket.apiKey.rateLimit || this.config.messageRateLimit!.maxMessages;

    // Reset window if expired
    if (now - socket.messageWindowStart > windowMs) {
      socket.messageCount = 0;
      socket.messageWindowStart = now;
    }

    socket.messageCount++;
    return socket.messageCount <= maxMessages;
  }

  private validateApiKey(apiKey: string): boolean {
    // In production, validate against database
    // For demo, check format
    return apiKey.length >= 32;
  }

  private getNextSequence(channel: string, pair?: string): number {
    const key = pair ? `${channel}:${pair}` : channel;
    const current = this.sequences.get(key) || 0;
    const next = current + 1;
    this.sequences.set(key, next);
    return next;
  }

  // Public methods for broadcasting

  public broadcast(channel: string, pair: string | undefined, type: string, data: any): void {
    const subscriptionKey = this.getSubscriptionKey(channel, pair);
    const message: BroadcastMessage = {
      channel,
      pair,
      type: type as any,
      data,
      sequence: this.getNextSequence(channel, pair),
      timestamp: Date.now()
    };

    this.io.to(subscriptionKey).emit('message', message);
  }

  public broadcastToUser(userId: string, channel: string, type: string, data: any): void {
    const subscriptionKey = `${channel}:${userId}`;
    const message: BroadcastMessage = {
      channel,
      type: type as any,
      data,
      sequence: this.getNextSequence(channel, userId),
      timestamp: Date.now()
    };

    this.io.to(subscriptionKey).emit('message', message);
  }

  // Health check
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.pingTimeout!;

      for (const [socketId, socket] of this.clients) {
        if (now - socket.lastActivity > timeout) {
          console.log(`Disconnecting inactive client: ${socketId}`);
          socket.disconnect(true);
        }
      }

      this.emit('healthCheck', {
        clients: this.clients.size,
        timestamp: now
      });
    }, 30000); // Every 30 seconds
  }

  // Graceful shutdown
  public async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Disconnect all clients
    for (const [socketId, socket] of this.clients) {
      socket.emit('serverShutdown', { message: 'Server is shutting down' });
      socket.disconnect(true);
    }

    // Close Socket.IO server
    await new Promise<void>((resolve) => {
      this.io.close(() => resolve());
    });

    this.emit('shutdown');
  }

  // Get server statistics
  public getStats(): any {
    const stats = {
      clients: this.clients.size,
      subscriptions: {},
      sequences: Object.fromEntries(this.sequences),
      rateLimiting: this.rateLimiter.getConnectionStats()
    };

    // Count subscriptions by channel
    for (const client of this.clients.values()) {
      for (const [channel, subs] of client.subscriptions) {
        stats.subscriptions[channel] = (stats.subscriptions[channel] || 0) + subs.size;
      }
    }

    return stats;
  }

  // Get rate limit status for a specific connection
  public getRateLimitStatus(socketId: string): any {
    return this.rateLimiter.getRateLimitStatus(socketId);
  }

  // Get rate limiting configuration
  public getRateLimitConfig(): any {
    return this.rateLimiter['config'];
  }
}