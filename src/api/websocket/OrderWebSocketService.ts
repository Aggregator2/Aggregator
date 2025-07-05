import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { EventEmitter } from 'events';
import { DatabaseMatchingEngine } from '../../services/matchingEngine/DatabaseMatchingEngine';
import { OrderRepository } from '../../database/repositories/OrderRepository';
import { OrderStatus } from '../../services/matchingEngine/types';
import { logger } from '../../utils/logger';
import jwt from 'jsonwebtoken';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
  subscriptions?: Set<string>;
}

interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping' | 'auth';
  data?: any;
  token?: string;
}

interface OrderUpdate {
  type: 'ORDER_UPDATE' | 'ORDER_FILLED' | 'ORDER_CANCELLED' | 'TRADE_EXECUTED';
  timestamp: number;
  order?: any;
  trade?: any;
}

export class OrderWebSocketService extends EventEmitter {
  private wss: WebSocketServer;
  private clients: Map<string, Set<AuthenticatedWebSocket>> = new Map(); // userId -> websockets
  private orderSubscriptions: Map<string, Set<string>> = new Map(); // orderId -> userIds
  private matchingEngine: DatabaseMatchingEngine;
  private orderRepo: OrderRepository;
  private heartbeatInterval!: NodeJS.Timeout;

  constructor(server: Server, matchingEngine: DatabaseMatchingEngine) {
    super();
    this.matchingEngine = matchingEngine;
    this.orderRepo = new OrderRepository();
    
    // Create WebSocket server
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws/orders',
      verifyClient: this.verifyClient.bind(this),
    });

    this.setupWebSocketServer();
    this.setupMatchingEngineListeners();
    this.startHeartbeat();
    
    logger.info('OrderWebSocketService initialized');
  }

  private verifyClient(info: any, cb: Function): void {
    // In production, implement proper authentication
    cb(true);
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: AuthenticatedWebSocket, request) => {
      logger.info('New WebSocket connection');
      
      ws.isAlive = true;
      ws.subscriptions = new Set();
      
      // Send welcome message
      this.sendMessage(ws, {
        type: 'connected',
        message: 'Connected to order updates stream',
        timestamp: Date.now(),
      });

      ws.on('message', (data) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          logger.error('Invalid WebSocket message', { error });
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { error });
      });
    });
  }

  private handleMessage(ws: AuthenticatedWebSocket, message: WebSocketMessage): void {
    switch (message.type) {
      case 'auth':
        this.handleAuth(ws, message.token);
        break;
      
      case 'subscribe':
        this.handleSubscribe(ws, message.data);
        break;
      
      case 'unsubscribe':
        this.handleUnsubscribe(ws, message.data);
        break;
      
      case 'ping':
        this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
        break;
      
      default:
        this.sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  private handleAuth(ws: AuthenticatedWebSocket, token?: string): void {
    if (!token) {
      this.sendError(ws, 'Authentication token required');
      return;
    }

    try {
      // Verify JWT token (use your actual secret)
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
      ws.userId = decoded.userId;
      
      // Add to clients map
      if (!this.clients.has(ws.userId!)) {
        this.clients.set(ws.userId!, new Set());
      }
      this.clients.get(ws.userId!)!.add(ws);
      
      this.sendMessage(ws, {
        type: 'authenticated',
        userId: ws.userId,
        timestamp: Date.now(),
      });
      
      // Send current active orders
      this.sendActiveOrders(ws);
      
    } catch (error) {
      this.sendError(ws, 'Invalid authentication token');
      ws.close(1008, 'Invalid token');
    }
  }

  private async handleSubscribe(ws: AuthenticatedWebSocket, data: any): Promise<void> {
    if (!ws.userId) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    const { orderId, pair, all } = data || {};
    
    if (orderId) {
      // Subscribe to specific order
      const order = await this.orderRepo.getOrderById(orderId);
      if (!order || order.userId !== ws.userId) {
        this.sendError(ws, 'Order not found or unauthorized');
        return;
      }
      
      ws.subscriptions?.add(`order:${orderId}`);
      
      // Track subscription
      if (!this.orderSubscriptions.has(orderId)) {
        this.orderSubscriptions.set(orderId, new Set());
      }
      this.orderSubscriptions.get(orderId)!.add(ws.userId);
      
      this.sendMessage(ws, {
        type: 'subscribed',
        channel: `order:${orderId}`,
        timestamp: Date.now(),
      });
      
      // Send current order status
      this.sendOrderUpdate(ws, order);
      
    } else if (pair) {
      // Subscribe to all orders for a pair
      ws.subscriptions?.add(`pair:${pair}`);
      
      this.sendMessage(ws, {
        type: 'subscribed',
        channel: `pair:${pair}`,
        timestamp: Date.now(),
      });
      
    } else if (all) {
      // Subscribe to all user orders
      ws.subscriptions?.add('all');
      
      this.sendMessage(ws, {
        type: 'subscribed',
        channel: 'all',
        timestamp: Date.now(),
      });
    }
  }

  private handleUnsubscribe(ws: AuthenticatedWebSocket, data: any): void {
    const { orderId, pair, all } = data || {};
    
    if (orderId && ws.subscriptions?.has(`order:${orderId}`)) {
      ws.subscriptions.delete(`order:${orderId}`);
      
      // Remove from order subscriptions
      const subscribers = this.orderSubscriptions.get(orderId);
      if (subscribers) {
        subscribers.delete(ws.userId!);
        if (subscribers.size === 0) {
          this.orderSubscriptions.delete(orderId);
        }
      }
      
      this.sendMessage(ws, {
        type: 'unsubscribed',
        channel: `order:${orderId}`,
        timestamp: Date.now(),
      });
      
    } else if (pair && ws.subscriptions?.has(`pair:${pair}`)) {
      ws.subscriptions.delete(`pair:${pair}`);
      
      this.sendMessage(ws, {
        type: 'unsubscribed',
        channel: `pair:${pair}`,
        timestamp: Date.now(),
      });
      
    } else if (all && ws.subscriptions?.has('all')) {
      ws.subscriptions.delete('all');
      
      this.sendMessage(ws, {
        type: 'unsubscribed',
        channel: 'all',
        timestamp: Date.now(),
      });
    }
  }

  private handleDisconnect(ws: AuthenticatedWebSocket): void {
    if (ws.userId) {
      const userSockets = this.clients.get(ws.userId);
      if (userSockets) {
        userSockets.delete(ws);
        if (userSockets.size === 0) {
          this.clients.delete(ws.userId);
        }
      }
    }
    
    // Clean up subscriptions
    if (ws.subscriptions) {
      for (const subscription of ws.subscriptions) {
        if (subscription.startsWith('order:')) {
          const orderId = subscription.substring(6);
          const subscribers = this.orderSubscriptions.get(orderId);
          if (subscribers && ws.userId) {
            subscribers.delete(ws.userId);
            if (subscribers.size === 0) {
              this.orderSubscriptions.delete(orderId);
            }
          }
        }
      }
    }
    
    logger.info('WebSocket disconnected', { userId: ws.userId });
  }

  private setupMatchingEngineListeners(): void {
    // Listen to matching engine events
    this.matchingEngine.on('orderSubmitted', (order) => {
      this.broadcastOrderUpdate(order, 'ORDER_UPDATE');
    });
    
    this.matchingEngine.on('orderFilled', (order) => {
      this.broadcastOrderUpdate(order, 'ORDER_FILLED');
    });
    
    this.matchingEngine.on('orderCancelled', (order) => {
      this.broadcastOrderUpdate(order, 'ORDER_CANCELLED');
    });
    
    this.matchingEngine.on('executionReport', (report) => {
      // Broadcast execution reports to order owner
      this.broadcastExecutionReport(report);
    });
  }

  private broadcastOrderUpdate(order: any, type: string): void {
    const update: OrderUpdate = {
      type: type as any,
      timestamp: Date.now(),
      order: {
        id: order.id,
        clientOrderId: order.clientOrderId,
        pair: order.pair,
        side: order.side,
        type: order.type,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity,
        remainingQuantity: order.quantity - order.filledQuantity,
        status: order.status,
        timestamp: order.timestamp,
        lastUpdateTime: order.lastUpdateTime,
      },
    };
    
    // Send to user's sockets
    const userSockets = this.clients.get(order.userId);
    if (userSockets) {
      for (const ws of userSockets) {
        // Check if subscribed to this order or all orders
        if (ws.subscriptions?.has(`order:${order.id}`) || 
            ws.subscriptions?.has('all') ||
            ws.subscriptions?.has(`pair:${order.pair}`)) {
          this.sendMessage(ws, update);
        }
      }
    }
  }

  private broadcastExecutionReport(report: any): void {
    // Get order to find userId
    this.orderRepo.getOrderById(report.orderId).then(order => {
      if (!order) return;
      
      const userSockets = this.clients.get(order.userId);
      if (userSockets) {
        for (const ws of userSockets) {
          if (ws.subscriptions?.has(`order:${order.id}`) || 
              ws.subscriptions?.has('all') ||
              ws.subscriptions?.has(`pair:${order.pair}`)) {
            this.sendMessage(ws, {
              type: 'EXECUTION_REPORT',
              timestamp: Date.now(),
              report,
            });
          }
        }
      }
    }).catch(error => {
      logger.error('Error broadcasting execution report', { error });
    });
  }

  private async sendActiveOrders(ws: AuthenticatedWebSocket): Promise<void> {
    if (!ws.userId) return;
    
    try {
      const activeOrders = await this.orderRepo.getOrdersByUser(ws.userId, {
        status: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
      });
      
      this.sendMessage(ws, {
        type: 'ACTIVE_ORDERS',
        timestamp: Date.now(),
        orders: activeOrders.map(order => ({
          id: order.id,
          clientOrderId: order.clientOrderId,
          pair: order.pair,
          side: order.side,
          type: order.type,
          price: order.price,
          quantity: order.quantity,
          filledQuantity: order.filledQuantity,
          remainingQuantity: order.quantity - order.filledQuantity,
          status: order.status,
          timestamp: order.timestamp,
        })),
      });
    } catch (error) {
      logger.error('Error sending active orders', { error });
    }
  }

  private sendOrderUpdate(ws: WebSocket, order: any): void {
    this.sendMessage(ws, {
      type: 'ORDER_UPDATE',
      timestamp: Date.now(),
      order: {
        id: order.id,
        clientOrderId: order.clientOrderId,
        pair: order.pair,
        side: order.side,
        type: order.type,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity,
        remainingQuantity: order.quantity - order.filledQuantity,
        status: order.status,
        timestamp: order.timestamp,
        lastUpdateTime: order.lastUpdateTime,
      },
    });
  }

  private sendMessage(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private sendError(ws: WebSocket, error: string): void {
    this.sendMessage(ws, {
      type: 'error',
      error,
      timestamp: Date.now(),
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (ws.isAlive === false) {
          ws.terminate();
          return;
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds
  }

  async shutdown(): Promise<void> {
    clearInterval(this.heartbeatInterval);
    
    // Close all connections
    this.wss.clients.forEach((ws) => {
      ws.close(1000, 'Server shutting down');
    });
    
    this.wss.close();
    this.removeAllListeners();
    
    logger.info('OrderWebSocketService shut down');
  }
}