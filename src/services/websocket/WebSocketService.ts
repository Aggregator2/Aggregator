import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer, Server as HTTPServer } from 'http';
import { EventEmitter } from 'events';
import jwt from 'jsonwebtoken';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import {
  Order,
  Trade,
  ExecutionReport,
  OrderBookSnapshot,
  OrderBookUpdate,
  MarketData,
  OrderStatus
} from '../matchingEngine/types';

export interface WebSocketServiceConfig {
  port: number;
  path?: string;
  cors?: {
    origin: string | string[];
    credentials: boolean;
  };
  auth: {
    secret: string;
    required: boolean;
  };
  rateLimits: {
    connectionsPerIp: number;
    messagesPerMinute: number;
    subscriptionsPerConnection: number;
  };
  heartbeatInterval: number;
  maxConnections?: number;
}

export interface AuthToken {
  userId: string;
  permissions?: string[];
  exp?: number;
}

export interface Subscription {
  channel: string;
  params?: any;
}

interface ClientInfo {
  userId?: string;
  socket: Socket;
  subscriptions: Map<string, Subscription>;
  authenticated: boolean;
  lastActivity: number;
  rateLimiter: RateLimiterMemory;
}

export enum ChannelType {
  ORDER_BOOK = 'orderbook',
  TRADES = 'trades',
  MARKET_DATA = 'market',
  USER_ORDERS = 'orders',
  USER_TRADES = 'user_trades',
  TICKER = 'ticker'
}

export class WebSocketService extends EventEmitter {
  private io: SocketIOServer;
  private httpServer: HTTPServer;
  private config: WebSocketServiceConfig;
  private clients: Map<string, ClientInfo> = new Map();
  private channelSubscribers: Map<string, Set<string>> = new Map();
  private ipRateLimiter: RateLimiterMemory;
  private stats = {
    connections: 0,
    messages: 0,
    broadcasts: 0
  };

  constructor(config: WebSocketServiceConfig) {
    super();
    this.config = config;
    this.httpServer = createServer();
    
    this.io = new SocketIOServer(this.httpServer, {
      path: config.path || '/ws',
      cors: config.cors || {
        origin: '*',
        credentials: true
      },
      pingInterval: 25000,
      pingTimeout: 20000,
      maxHttpBufferSize: 1e6, // 1MB
      transports: ['websocket']
    });

    this.ipRateLimiter = new RateLimiterMemory({
      points: config.rateLimits.connectionsPerIp,
      duration: 60 // Per minute
    });

    this.setupHandlers();
    this.startHeartbeat();
  }

  private setupHandlers(): void {
    // Connection rate limiting middleware
    this.io.use(async (socket, next) => {
      try {
        await this.ipRateLimiter.consume(socket.handshake.address);
        next();
      } catch (e) {
        next(new Error('Too many connections'));
      }
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      if (!this.config.auth.required) {
        return next();
      }

      const token = socket.handshake.auth?.token || 
                   socket.handshake.headers?.authorization?.replace('Bearer ', '');
      
      if (!token && this.config.auth.required) {
        return next(new Error('Authentication required'));
      }

      try {
        const decoded = jwt.verify(token, this.config.auth.secret) as AuthToken;
        socket.data.auth = decoded;
        next();
      } catch (error) {
        next(new Error('Invalid authentication token'));
      }
    });

    // Main connection handler
    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: Socket): void {
    const clientId = socket.id;
    const userId = socket.data.auth?.userId;

    // Create client info
    const rateLimiter = new RateLimiterMemory({
      points: this.config.rateLimits.messagesPerMinute,
      duration: 60
    });

    const clientInfo: ClientInfo = {
      userId,
      socket,
      subscriptions: new Map(),
      authenticated: !!userId,
      lastActivity: Date.now(),
      rateLimiter
    };

    this.clients.set(clientId, clientInfo);
    this.stats.connections++;

    // Send welcome message
    socket.emit('connected', {
      clientId,
      authenticated: clientInfo.authenticated,
      serverTime: Date.now()
    });

    // Setup socket event handlers
    this.setupSocketHandlers(socket, clientInfo);

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnect(clientId);
    });

    this.emit('client:connected', { clientId, userId });
  }

  private setupSocketHandlers(socket: Socket, clientInfo: ClientInfo): void {
    // Subscribe to channels
    socket.on('subscribe', async (data: { channel: string; params?: any }) => {
      try {
        await clientInfo.rateLimiter.consume(1);
        await this.handleSubscribe(clientInfo, data.channel, data.params);
      } catch (error) {
        socket.emit('error', { 
          message: error instanceof Error ? error.message : 'Rate limit exceeded' 
        });
      }
    });

    // Unsubscribe from channels
    socket.on('unsubscribe', async (data: { channel: string }) => {
      try {
        await this.handleUnsubscribe(clientInfo, data.channel);
      } catch (error) {
        socket.emit('error', { 
          message: error instanceof Error ? error.message : 'Unsubscribe failed' 
        });
      }
    });

    // Ping/pong for keepalive
    socket.on('ping', () => {
      clientInfo.lastActivity = Date.now();
      socket.emit('pong', { serverTime: Date.now() });
    });

    // Request snapshot
    socket.on('snapshot', async (data: { channel: string }) => {
      try {
        await clientInfo.rateLimiter.consume(1);
        await this.sendSnapshot(clientInfo, data.channel);
      } catch (error) {
        socket.emit('error', { 
          message: error instanceof Error ? error.message : 'Snapshot failed' 
        });
      }
    });
  }

  private async handleSubscribe(
    clientInfo: ClientInfo, 
    channel: string, 
    params?: any
  ): Promise<void> {
    // Check subscription limit
    if (clientInfo.subscriptions.size >= this.config.rateLimits.subscriptionsPerConnection) {
      throw new Error('Subscription limit reached');
    }

    // Parse channel type and validate
    const [channelType, ...channelParams] = channel.split(':');
    
    // Check permissions for user-specific channels
    if (channelType === ChannelType.USER_ORDERS || channelType === ChannelType.USER_TRADES) {
      if (!clientInfo.authenticated) {
        throw new Error('Authentication required for user channels');
      }
    }

    // Create subscription
    const subscription: Subscription = {
      channel,
      params
    };

    clientInfo.subscriptions.set(channel, subscription);

    // Add to channel subscribers
    if (!this.channelSubscribers.has(channel)) {
      this.channelSubscribers.set(channel, new Set());
    }
    this.channelSubscribers.get(channel)!.add(clientInfo.socket.id);

    // Join socket.io room
    clientInfo.socket.join(channel);

    // Send confirmation
    clientInfo.socket.emit('subscribed', { channel, timestamp: Date.now() });

    // Send initial data based on channel type
    await this.sendInitialData(clientInfo, channelType, channelParams, params);

    this.emit('client:subscribed', { 
      clientId: clientInfo.socket.id, 
      userId: clientInfo.userId, 
      channel 
    });
  }

  private async handleUnsubscribe(clientInfo: ClientInfo, channel: string): Promise<void> {
    clientInfo.subscriptions.delete(channel);
    
    const subscribers = this.channelSubscribers.get(channel);
    if (subscribers) {
      subscribers.delete(clientInfo.socket.id);
      if (subscribers.size === 0) {
        this.channelSubscribers.delete(channel);
      }
    }

    clientInfo.socket.leave(channel);
    clientInfo.socket.emit('unsubscribed', { channel, timestamp: Date.now() });

    this.emit('client:unsubscribed', { 
      clientId: clientInfo.socket.id, 
      userId: clientInfo.userId, 
      channel 
    });
  }

  private async sendInitialData(
    clientInfo: ClientInfo,
    channelType: string,
    channelParams: string[],
    params?: any
  ): Promise<void> {
    switch (channelType) {
      case ChannelType.ORDER_BOOK:
        if (channelParams[0]) {
          this.emit('request:orderbook:snapshot', {
            pair: channelParams[0],
            depth: params?.depth || 20,
            clientId: clientInfo.socket.id
          });
        }
        break;

      case ChannelType.TRADES:
        if (channelParams[0]) {
          this.emit('request:trades:recent', {
            pair: channelParams[0],
            limit: params?.limit || 50,
            clientId: clientInfo.socket.id
          });
        }
        break;

      case ChannelType.USER_ORDERS:
        if (clientInfo.userId) {
          this.emit('request:user:orders', {
            userId: clientInfo.userId,
            status: params?.status,
            clientId: clientInfo.socket.id
          });
        }
        break;

      case ChannelType.USER_TRADES:
        if (clientInfo.userId) {
          this.emit('request:user:trades', {
            userId: clientInfo.userId,
            limit: params?.limit || 100,
            clientId: clientInfo.socket.id
          });
        }
        break;
    }
  }

  private async sendSnapshot(clientInfo: ClientInfo, channel: string): Promise<void> {
    const [channelType, ...channelParams] = channel.split(':');
    
    if (!clientInfo.subscriptions.has(channel)) {
      throw new Error('Not subscribed to channel');
    }

    await this.sendInitialData(clientInfo, channelType, channelParams);
  }

  private handleDisconnect(clientId: string): void {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    // Remove from all channel subscribers
    for (const channel of clientInfo.subscriptions.keys()) {
      const subscribers = this.channelSubscribers.get(channel);
      if (subscribers) {
        subscribers.delete(clientId);
        if (subscribers.size === 0) {
          this.channelSubscribers.delete(channel);
        }
      }
    }

    this.clients.delete(clientId);
    this.stats.connections--;

    this.emit('client:disconnected', { 
      clientId, 
      userId: clientInfo.userId 
    });
  }

  // Broadcasting methods
  public broadcastOrderBookUpdate(pair: string, update: OrderBookUpdate): void {
    const channel = `${ChannelType.ORDER_BOOK}:${pair}`;
    this.io.to(channel).emit('orderbook:update', {
      channel,
      data: update,
      timestamp: Date.now()
    });
    this.stats.broadcasts++;
  }

  public broadcastOrderBookSnapshot(pair: string, snapshot: OrderBookSnapshot): void {
    const channel = `${ChannelType.ORDER_BOOK}:${pair}`;
    this.io.to(channel).emit('orderbook:snapshot', {
      channel,
      data: snapshot,
      timestamp: Date.now()
    });
    this.stats.broadcasts++;
  }

  public broadcastTrade(trade: Trade): void {
    const channel = `${ChannelType.TRADES}:${trade.pair}`;
    this.io.to(channel).emit('trade', {
      channel,
      data: trade,
      timestamp: Date.now()
    });
    this.stats.broadcasts++;
  }

  public broadcastMarketData(pair: string, data: MarketData): void {
    const channel = `${ChannelType.MARKET_DATA}:${pair}`;
    this.io.to(channel).emit('market:update', {
      channel,
      data,
      timestamp: Date.now()
    });
    this.stats.broadcasts++;
  }

  public broadcastTicker(pair: string, ticker: any): void {
    const channel = `${ChannelType.TICKER}:${pair}`;
    this.io.to(channel).emit('ticker', {
      channel,
      data: ticker,
      timestamp: Date.now()
    });
    this.stats.broadcasts++;
  }

  // User-specific broadcasts
  public sendOrderUpdate(userId: string, order: Order): void {
    const clients = this.getClientsByUserId(userId);
    const channel = `${ChannelType.USER_ORDERS}`;
    
    for (const client of clients) {
      if (client.subscriptions.has(channel)) {
        client.socket.emit('order:update', {
          channel,
          data: order,
          timestamp: Date.now()
        });
      }
    }
  }

  public sendExecutionReport(userId: string, report: ExecutionReport): void {
    const clients = this.getClientsByUserId(userId);
    const channel = `${ChannelType.USER_ORDERS}`;
    
    for (const client of clients) {
      if (client.subscriptions.has(channel)) {
        client.socket.emit('order:execution', {
          channel,
          data: report,
          timestamp: Date.now()
        });
      }
    }
  }

  public sendUserTrade(userId: string, trade: Trade): void {
    const clients = this.getClientsByUserId(userId);
    const channel = `${ChannelType.USER_TRADES}`;
    
    for (const client of clients) {
      if (client.subscriptions.has(channel)) {
        client.socket.emit('user:trade', {
          channel,
          data: trade,
          timestamp: Date.now()
        });
      }
    }
  }

  // Direct client messaging
  public sendToClient(clientId: string, event: string, data: any): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.socket.emit(event, data);
    }
  }

  // Utility methods
  private getClientsByUserId(userId: string): ClientInfo[] {
    const clients: ClientInfo[] = [];
    for (const client of this.clients.values()) {
      if (client.userId === userId) {
        clients.push(client);
      }
    }
    return clients;
  }

  private startHeartbeat(): void {
    setInterval(() => {
      const now = Date.now();
      const timeout = 5 * 60 * 1000; // 5 minutes

      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.lastActivity > timeout) {
          client.socket.disconnect();
          this.handleDisconnect(clientId);
        }
      }
    }, this.config.heartbeatInterval);
  }

  // Server lifecycle
  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, () => {
        console.log(`WebSocket server listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.io.disconnectSockets();
      this.httpServer.close(() => {
        console.log('WebSocket server stopped');
        resolve();
      });
    });
  }

  // Statistics
  public getStats(): any {
    return {
      ...this.stats,
      clients: this.clients.size,
      channels: this.channelSubscribers.size,
      subscriptions: Array.from(this.clients.values())
        .reduce((total, client) => total + client.subscriptions.size, 0)
    };
  }

  // Notification methods for compatibility
  public sendToUser(userId: string, event: string, data: any): void {
    const clients = this.getClientsByUserId(userId);
    for (const client of clients) {
      client.socket.emit(event, data);
    }
  }

  public sendToChannel(channel: string, event: string, data: any): void {
    this.io.to(channel).emit(event, data);
    this.stats.broadcasts++;
  }

  public subscribeToChannel(socketId: string, channel: string): void {
    const client = this.clients.get(socketId);
    if (client) {
      client.socket.join(channel);
      // Don't add to subscriptions map as this is a direct channel join
    }
  }

  public unsubscribeFromChannel(socketId: string, channel: string): void {
    const client = this.clients.get(socketId);
    if (client) {
      client.socket.leave(channel);
    }
  }

  public getConnectedUsersCount(): number {
    const uniqueUsers = new Set<string>();
    for (const client of this.clients.values()) {
      if (client.userId) {
        uniqueUsers.add(client.userId);
      }
    }
    return uniqueUsers.size;
  }

  public getActiveChannelsCount(): number {
    return this.channelSubscribers.size;
  }
}