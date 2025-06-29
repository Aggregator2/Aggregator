import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer, Server as HTTPServer } from 'http';
import { OrderBookDatabaseConfig } from './config';
import { OrderBookUpdate, OrderBookSnapshot, Trade, MarketData } from '../matchingEngine/types';
import { OrderBookDatabase } from './OrderBookDatabase';

interface WebSocketRoom {
  pair: string;
  subscribers: Set<string>;
  lastSnapshot?: OrderBookSnapshot;
  snapshotTimer?: NodeJS.Timeout;
}

export class OrderBookWebSocketServer {
  private io: SocketIOServer;
  private httpServer: HTTPServer;
  private config: OrderBookDatabaseConfig;
  private database: OrderBookDatabase;
  private rooms: Map<string, WebSocketRoom> = new Map();
  private socketInfo: Map<string, { userId?: string; subscriptions: Set<string> }> = new Map();
  private updateBuffer: Map<string, OrderBookUpdate[]> = new Map();
  private bufferTimer?: NodeJS.Timeout;

  constructor(config: OrderBookDatabaseConfig, database: OrderBookDatabase) {
    this.config = config;
    this.database = database;
    
    // Create HTTP server
    this.httpServer = createServer();
    
    // Create Socket.IO server
    this.io = new SocketIOServer(this.httpServer, {
      path: config.websocket.path,
      cors: config.websocket.cors,
      pingInterval: config.websocket.pingInterval,
      pingTimeout: config.websocket.pingTimeout,
      maxHttpBufferSize: 1e8, // 100 MB
      transports: ['websocket', 'polling']
    });

    this.setupSocketHandlers();
    this.setupDatabaseHandlers();
    this.startUpdateBuffer();
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`Client connected: ${socket.id}`);
      
      // Initialize socket info
      this.socketInfo.set(socket.id, { subscriptions: new Set() });
      
      // Handle authentication
      socket.on('authenticate', async (data: { userId: string; token: string }) => {
        // TODO: Implement proper authentication
        const info = this.socketInfo.get(socket.id);
        if (info) {
          info.userId = data.userId;
          socket.emit('authenticated', { success: true });
        }
      });
      
      // Handle order book subscription
      socket.on('subscribe:orderbook', async (data: { pair: string; depth?: number }) => {
        await this.handleOrderBookSubscription(socket, data.pair, data.depth);
      });
      
      // Handle order book unsubscription
      socket.on('unsubscribe:orderbook', async (data: { pair: string }) => {
        await this.handleOrderBookUnsubscription(socket, data.pair);
      });
      
      // Handle trade subscription
      socket.on('subscribe:trades', async (data: { pair: string }) => {
        await this.handleTradeSubscription(socket, data.pair);
      });
      
      // Handle market data subscription
      socket.on('subscribe:marketdata', async (data: { pair: string }) => {
        await this.handleMarketDataSubscription(socket, data.pair);
      });
      
      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
      
      // Handle errors
      socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
      });
    });

    // Limit connections if configured
    if (this.config.websocket.maxConnections) {
      this.io.use((socket, next) => {
        if (this.io.sockets.sockets.size >= this.config.websocket.maxConnections!) {
          next(new Error('Maximum connections reached'));
        } else {
          next();
        }
      });
    }
  }

  private setupDatabaseHandlers(): void {
    // Listen for order book updates from database
    this.database.on('orderbook:update', (channel: string, update: OrderBookUpdate) => {
      const pair = channel.split(':').pop();
      if (pair) {
        this.bufferUpdate(pair, update);
      }
    });
  }

  private async handleOrderBookSubscription(
    socket: Socket,
    pair: string,
    depth: number = 50
  ): Promise<void> {
    try {
      // Join room
      socket.join(`orderbook:${pair}`);
      
      // Update socket info
      const info = this.socketInfo.get(socket.id);
      if (info) {
        info.subscriptions.add(`orderbook:${pair}`);
      }
      
      // Update room info
      let room = this.rooms.get(pair);
      if (!room) {
        room = {
          pair,
          subscribers: new Set(),
          snapshotTimer: setInterval(() => this.sendSnapshot(pair), 60000) // Send snapshot every minute
        };
        this.rooms.set(pair, room);
        
        // Subscribe to database updates
        await this.database.subscribeToOrderBook(pair);
      }
      room.subscribers.add(socket.id);
      
      // Send initial snapshot
      const snapshot = await this.database.getOrderBookSnapshot(pair, depth);
      socket.emit('orderbook:snapshot', {
        pair,
        snapshot,
        timestamp: Date.now()
      });
      
      room.lastSnapshot = snapshot;
      
      // Send confirmation
      socket.emit('subscribed', {
        channel: `orderbook:${pair}`,
        success: true
      });
    } catch (error) {
      socket.emit('subscription:error', {
        channel: `orderbook:${pair}`,
        error: error instanceof Error ? error.message : 'Subscription failed'
      });
    }
  }

  private async handleOrderBookUnsubscription(socket: Socket, pair: string): Promise<void> {
    // Leave room
    socket.leave(`orderbook:${pair}`);
    
    // Update socket info
    const info = this.socketInfo.get(socket.id);
    if (info) {
      info.subscriptions.delete(`orderbook:${pair}`);
    }
    
    // Update room info
    const room = this.rooms.get(pair);
    if (room) {
      room.subscribers.delete(socket.id);
      
      // Clean up if no more subscribers
      if (room.subscribers.size === 0) {
        if (room.snapshotTimer) {
          clearInterval(room.snapshotTimer);
        }
        this.rooms.delete(pair);
        
        // Unsubscribe from database updates
        await this.database.unsubscribeFromOrderBook(pair);
      }
    }
    
    // Send confirmation
    socket.emit('unsubscribed', {
      channel: `orderbook:${pair}`,
      success: true
    });
  }

  private async handleTradeSubscription(socket: Socket, pair: string): Promise<void> {
    try {
      // Join trade room
      socket.join(`trades:${pair}`);
      
      // Update socket info
      const info = this.socketInfo.get(socket.id);
      if (info) {
        info.subscriptions.add(`trades:${pair}`);
      }
      
      // Send recent trades
      const trades = await this.database.getRecentTrades(pair, 50);
      socket.emit('trades:recent', {
        pair,
        trades,
        timestamp: Date.now()
      });
      
      // Send confirmation
      socket.emit('subscribed', {
        channel: `trades:${pair}`,
        success: true
      });
    } catch (error) {
      socket.emit('subscription:error', {
        channel: `trades:${pair}`,
        error: error instanceof Error ? error.message : 'Subscription failed'
      });
    }
  }

  private async handleMarketDataSubscription(socket: Socket, pair: string): Promise<void> {
    try {
      // Join market data room
      socket.join(`marketdata:${pair}`);
      
      // Update socket info
      const info = this.socketInfo.get(socket.id);
      if (info) {
        info.subscriptions.add(`marketdata:${pair}`);
      }
      
      // Send confirmation
      socket.emit('subscribed', {
        channel: `marketdata:${pair}`,
        success: true
      });
    } catch (error) {
      socket.emit('subscription:error', {
        channel: `marketdata:${pair}`,
        error: error instanceof Error ? error.message : 'Subscription failed'
      });
    }
  }

  private handleDisconnect(socket: Socket): void {
    console.log(`Client disconnected: ${socket.id}`);
    
    // Clean up socket info
    const info = this.socketInfo.get(socket.id);
    if (info) {
      // Remove from all rooms
      for (const subscription of info.subscriptions) {
        const [type, pair] = subscription.split(':');
        if (type === 'orderbook' && pair) {
          const room = this.rooms.get(pair);
          if (room) {
            room.subscribers.delete(socket.id);
            
            // Clean up empty rooms
            if (room.subscribers.size === 0) {
              if (room.snapshotTimer) {
                clearInterval(room.snapshotTimer);
              }
              this.rooms.delete(pair);
              this.database.unsubscribeFromOrderBook(pair);
            }
          }
        }
      }
    }
    
    this.socketInfo.delete(socket.id);
  }

  // Buffer updates to batch them
  private bufferUpdate(pair: string, update: OrderBookUpdate): void {
    if (!this.updateBuffer.has(pair)) {
      this.updateBuffer.set(pair, []);
    }
    this.updateBuffer.get(pair)!.push(update);
  }

  // Start update buffer timer
  private startUpdateBuffer(): void {
    this.bufferTimer = setInterval(() => {
      this.flushUpdateBuffer();
    }, 100); // Flush every 100ms
  }

  // Flush update buffer
  private flushUpdateBuffer(): void {
    for (const [pair, updates] of this.updateBuffer.entries()) {
      if (updates.length > 0) {
        this.io.to(`orderbook:${pair}`).emit('orderbook:updates', {
          pair,
          updates,
          timestamp: Date.now()
        });
        
        // Clear buffer
        this.updateBuffer.set(pair, []);
      }
    }
  }

  // Send order book snapshot
  private async sendSnapshot(pair: string): Promise<void> {
    const room = this.rooms.get(pair);
    if (!room || room.subscribers.size === 0) return;
    
    try {
      const snapshot = await this.database.getOrderBookSnapshot(pair);
      room.lastSnapshot = snapshot;
      
      this.io.to(`orderbook:${pair}`).emit('orderbook:snapshot', {
        pair,
        snapshot,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`Failed to send snapshot for ${pair}:`, error);
    }
  }

  // Broadcast trade
  public broadcastTrade(trade: Trade): void {
    this.io.to(`trades:${trade.pair}`).emit('trade:new', {
      trade,
      timestamp: Date.now()
    });
  }

  // Broadcast market data update
  public broadcastMarketData(data: MarketData): void {
    this.io.to(`marketdata:${data.pair}`).emit('marketdata:update', {
      data,
      timestamp: Date.now()
    });
  }

  // Get server statistics
  public getStatistics(): {
    connections: number;
    rooms: number;
    subscriptions: number;
    pairs: string[];
  } {
    let totalSubscriptions = 0;
    for (const info of this.socketInfo.values()) {
      totalSubscriptions += info.subscriptions.size;
    }
    
    return {
      connections: this.io.sockets.sockets.size,
      rooms: this.rooms.size,
      subscriptions: totalSubscriptions,
      pairs: Array.from(this.rooms.keys())
    };
  }

  // Start server
  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.websocket.port, () => {
        console.log(`WebSocket server listening on port ${this.config.websocket.port}`);
        resolve();
      });
    });
  }

  // Stop server
  public async stop(): Promise<void> {
    // Stop update buffer
    if (this.bufferTimer) {
      clearInterval(this.bufferTimer);
    }
    
    // Clear all snapshot timers
    for (const room of this.rooms.values()) {
      if (room.snapshotTimer) {
        clearInterval(room.snapshotTimer);
      }
    }
    
    // Disconnect all clients
    this.io.disconnectSockets();
    
    // Close server
    return new Promise((resolve) => {
      this.httpServer.close(() => {
        console.log('WebSocket server stopped');
        resolve();
      });
    });
  }
}