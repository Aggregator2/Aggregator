import { Server } from 'socket.io';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import { getMatchingEngine } from '../services/matchingEngine/singleton';
import { Order, Trade, MarketData, OrderBookSnapshot } from '../services/matchingEngine/types';
// import { NotificationWebSocketHandlers } from '../services/websocket/NotificationWebSocketHandlers';
// import { WebSocketService } from '../services/websocket/WebSocketService';

interface SubscriptionData {
  userId?: string;
  pairs: Set<string>;
  orderBook: Set<string>;
  trades: Set<string>;
  marketData: Set<string>;
  userOrders: boolean;
}

export class WebSocketServer {
  private io: Server;
  private httpServer: any;
  private matchingEngine: any;
  private subscriptions: Map<string, SubscriptionData> = new Map();
  // private notificationHandlers: NotificationWebSocketHandlers;
  // private wsService: WebSocketService;

  constructor(port: number = 3001) {
    this.httpServer = createServer();
    this.io = new Server(this.httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });

    // Add authentication middleware
    this.io.use(async (socket, next) => {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Unauthorized: No token provided'));
      }

      try {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          console.error('JWT_SECRET not configured');
          return next(new Error('Server configuration error'));
        }

        const decoded = jwt.verify(token, secret) as any;
        socket.data.user = decoded;
        next();
      } catch (err) {
        console.error('WebSocket authentication failed:', err);
        next(new Error('Unauthorized: Invalid token'));
      }
    });

    this.matchingEngine = getMatchingEngine();
    
    // WebSocket service is not needed - we're using Socket.IO directly
    // Comment out for now as it's not properly integrated
    // this.wsService = new WebSocketService(wsServiceConfig);
    
    // Initialize notification handlers without WebSocketService for now
    // this.notificationHandlers = new NotificationWebSocketHandlers(this.wsService);
    
    this.setupEventHandlers();
    this.setupSocketHandlers();
    
    // Handle connection errors
    this.io.on('connect_error', (err) => {
      console.error('WebSocket connection error:', err.message);
    });

    this.httpServer.listen(port, () => {
      console.log(`✅ WebSocket server listening on port ${port}`);
    });
  }

  private setupEventHandlers() {
    // Order events
    this.matchingEngine.on('orderSubmitted', (order: Order) => {
      this.broadcastToUserAndPair(order.userId, order.pair, 'order:submitted', order);
    });

    this.matchingEngine.on('orderAdded', (order: Order) => {
      this.broadcastToPair(order.pair, 'orderbook:update', {
        pair: order.pair,
        side: order.side,
        action: 'add',
        order: {
          price: order.price,
          quantity: order.quantity - order.filledQuantity,
          orderId: order.id
        }
      });
    });

    this.matchingEngine.on('orderFilled', (order: Order) => {
      this.broadcastToUserAndPair(order.userId, order.pair, 'order:filled', order);
    });

    this.matchingEngine.on('orderCancelled', (order: Order) => {
      this.broadcastToUserAndPair(order.userId, order.pair, 'order:cancelled', order);
      this.broadcastToPair(order.pair, 'orderbook:update', {
        pair: order.pair,
        side: order.side,
        action: 'remove',
        orderId: order.id
      });
    });

    // Trade events
    this.matchingEngine.on('trade', (trade: Trade) => {
      this.broadcastToPair(trade.pair, 'trade:new', trade);
    });

    // Market data events
    this.matchingEngine.on('marketDataUpdate', (data: MarketData) => {
      this.broadcastToPair(data.pair, 'market:update', data);
    });

    // Execution reports
    this.matchingEngine.on('executionReport', (report: any) => {
      // Send to specific user
      this.io.to(`user:${report.order?.userId}`).emit('execution:report', report);
    });
  }

  private setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      const user = socket.data.user;
      console.log(`Client connected: ${socket.id}, userId: ${user.userId || user.sub || 'unknown'}`);
      
      // Extract userId from JWT payload (could be in userId, sub, or id field)
      const userId = user.userId || user.sub || user.id;
      
      // Initialize subscription data with authenticated user
      this.subscriptions.set(socket.id, {
        userId: userId,
        pairs: new Set(),
        orderBook: new Set(),
        trades: new Set(),
        marketData: new Set(),
        userOrders: false
      });

      // Join user-specific room immediately
      if (userId) {
        socket.join(`user:${userId}`);
        socket.emit('auth:success', { userId: userId, user: user });
      }

      // Subscribe to order book updates
      socket.on('subscribe:orderbook', (pairs: string[]) => {
        const sub = this.subscriptions.get(socket.id);
        if (sub) {
          pairs.forEach(pair => {
            sub.orderBook.add(pair);
            socket.join(`orderbook:${pair}`);
            
            // Send initial snapshot
            const snapshot = this.matchingEngine.getOrderBook(pair, 50);
            if (snapshot) {
              socket.emit('orderbook:snapshot', { pair, snapshot });
            }
          });
        }
      });

      // Subscribe to trades
      socket.on('subscribe:trades', (pairs: string[]) => {
        const sub = this.subscriptions.get(socket.id);
        if (sub) {
          pairs.forEach(pair => {
            sub.trades.add(pair);
            socket.join(`trades:${pair}`);
            
            // Send recent trades
            const trades = this.matchingEngine.getRecentTrades(pair, 50);
            socket.emit('trades:history', { pair, trades });
          });
        }
      });

      // Subscribe to market data
      socket.on('subscribe:market', (pairs: string[]) => {
        const sub = this.subscriptions.get(socket.id);
        if (sub) {
          pairs.forEach(pair => {
            sub.marketData.add(pair);
            socket.join(`market:${pair}`);
            
            // Send current market data
            const marketData = this.matchingEngine.getMarketData(pair);
            if (marketData) {
              socket.emit('market:snapshot', marketData);
            }
          });
        }
      });

      // Subscribe to user orders
      socket.on('subscribe:orders', () => {
        const sub = this.subscriptions.get(socket.id);
        if (sub && sub.userId) {
          sub.userOrders = true;
          
          // Send current open orders
          const orders = this.matchingEngine.getUserOrders(sub.userId);
          socket.emit('orders:snapshot', orders);
        }
      });

      // Subscribe to notifications (now uses authenticated userId)
      socket.on('subscribe:notifications', () => {
        const sub = this.subscriptions.get(socket.id);
        if (!sub || !sub.userId) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }
        
        // Subscribe to user's notification channel
        // this.notificationHandlers.subscribeUserToNotifications(sub.userId, socket.id);
        socket.join(`notifications:${sub.userId}`);
        
        socket.emit('subscribed:notifications', { 
          success: true,
          userId: sub.userId,
          channel: `notifications:${sub.userId}`
        });
      });

      // Unsubscribe from notifications (now uses authenticated userId)
      socket.on('unsubscribe:notifications', () => {
        const sub = this.subscriptions.get(socket.id);
        if (!sub || !sub.userId) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }
        
        // this.notificationHandlers.unsubscribeUserFromNotifications(sub.userId, socket.id);
        socket.leave(`notifications:${sub.userId}`);
        
        socket.emit('unsubscribed:notifications', { 
          success: true,
          userId: sub.userId
        });
      });

      // Unsubscribe
      socket.on('unsubscribe:orderbook', (pairs: string[]) => {
        const sub = this.subscriptions.get(socket.id);
        if (sub) {
          pairs.forEach(pair => {
            sub.orderBook.delete(pair);
            socket.leave(`orderbook:${pair}`);
          });
        }
      });

      socket.on('unsubscribe:trades', (pairs: string[]) => {
        const sub = this.subscriptions.get(socket.id);
        if (sub) {
          pairs.forEach(pair => {
            sub.trades.delete(pair);
            socket.leave(`trades:${pair}`);
          });
        }
      });

      socket.on('unsubscribe:market', (pairs: string[]) => {
        const sub = this.subscriptions.get(socket.id);
        if (sub) {
          pairs.forEach(pair => {
            sub.marketData.delete(pair);
            socket.leave(`market:${pair}`);
          });
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        this.subscriptions.delete(socket.id);
      });

      // Ping/pong for connection health
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
      });
    });
  }

  private broadcastToPair(pair: string, event: string, data: any) {
    this.io.to(`orderbook:${pair}`).emit(event, data);
    this.io.to(`trades:${pair}`).emit(event, data);
    this.io.to(`market:${pair}`).emit(event, data);
  }

  private broadcastToUserAndPair(userId: string, pair: string, event: string, data: any) {
    // Send to user
    this.io.to(`user:${userId}`).emit(event, data);
    
    // Also broadcast to pair subscribers for order book updates
    if (event.includes('order:')) {
      this.broadcastToPair(pair, event, data);
    }
  }

  public stop() {
    this.io.close();
    this.httpServer.close();
  }
}

// Export singleton instance
let wsServer: WebSocketServer | null = null;

export function getWebSocketServer(): WebSocketServer {
  if (!wsServer) {
    const port = parseInt(process.env.WS_PORT || '3001');
    wsServer = new WebSocketServer(port);
  }
  return wsServer;
}