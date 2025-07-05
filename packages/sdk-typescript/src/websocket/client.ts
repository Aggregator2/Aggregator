import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';
import {
  WebSocketOptions,
  WebSocketEvent,
  WebSocketMessage,
  Order,
  Trade,
  OrderBook,
  OrderBookUpdate,
  Ticker,
  Notification
} from '../types';
import { WebSocketError } from '../types/errors';

export class WebSocketClient extends EventEmitter {
  private socket?: Socket;
  private options: Required<WebSocketOptions>;
  private reconnectAttempts = 0;
  private subscriptions = new Set<string>();
  private authenticated = false;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    private url: string,
    private apiKey: string,
    options: WebSocketOptions = {}
  ) {
    super();
    
    this.options = {
      autoReconnect: options.autoReconnect ?? true,
      reconnectInterval: options.reconnectInterval ?? 5000,
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      this.socket = io(this.url, {
        transports: ['websocket'],
        auth: {
          apiKey: this.apiKey
        },
        reconnection: this.options.autoReconnect,
        reconnectionDelay: this.options.reconnectInterval,
        reconnectionAttempts: this.options.maxReconnectAttempts
      });

      this.setupEventHandlers();

      const timeout = setTimeout(() => {
        reject(new WebSocketError('Connection timeout'));
      }, 10000);

      this.socket.once('connect', () => {
        clearTimeout(timeout);
        this.onConnect();
        resolve();
      });

      this.socket.once('connect_error', (error) => {
        clearTimeout(timeout);
        reject(new WebSocketError(`Connection failed: ${error.message}`));
      });
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = undefined;
    }

    this.authenticated = false;
    this.subscriptions.clear();
    this.emit(WebSocketEvent.DISCONNECTED);
  }

  /**
   * Subscribe to order updates
   */
  subscribeOrders(): void {
    this.ensureConnected();
    this.socket!.emit('subscribe:orders');
    this.subscriptions.add('orders');
  }

  /**
   * Unsubscribe from order updates
   */
  unsubscribeOrders(): void {
    this.ensureConnected();
    this.socket!.emit('unsubscribe:orders');
    this.subscriptions.delete('orders');
  }

  /**
   * Subscribe to order book updates
   */
  subscribeOrderBook(pairs: string[]): void {
    this.ensureConnected();
    this.socket!.emit('subscribe:orderbook', pairs);
    pairs.forEach(pair => this.subscriptions.add(`orderbook:${pair}`));
  }

  /**
   * Unsubscribe from order book updates
   */
  unsubscribeOrderBook(pairs: string[]): void {
    this.ensureConnected();
    this.socket!.emit('unsubscribe:orderbook', pairs);
    pairs.forEach(pair => this.subscriptions.delete(`orderbook:${pair}`));
  }

  /**
   * Subscribe to trades
   */
  subscribeTrades(pairs: string[]): void {
    this.ensureConnected();
    this.socket!.emit('subscribe:trades', pairs);
    pairs.forEach(pair => this.subscriptions.add(`trades:${pair}`));
  }

  /**
   * Unsubscribe from trades
   */
  unsubscribeTrades(pairs: string[]): void {
    this.ensureConnected();
    this.socket!.emit('unsubscribe:trades', pairs);
    pairs.forEach(pair => this.subscriptions.delete(`trades:${pair}`));
  }

  /**
   * Subscribe to ticker updates
   */
  subscribeTicker(pairs: string[]): void {
    this.ensureConnected();
    this.socket!.emit('subscribe:ticker', pairs);
    pairs.forEach(pair => this.subscriptions.add(`ticker:${pair}`));
  }

  /**
   * Unsubscribe from ticker updates
   */
  unsubscribeTicker(pairs: string[]): void {
    this.ensureConnected();
    this.socket!.emit('unsubscribe:ticker', pairs);
    pairs.forEach(pair => this.subscriptions.delete(`ticker:${pair}`));
  }

  /**
   * Subscribe to notifications
   */
  subscribeNotifications(): void {
    this.ensureConnected();
    this.socket!.emit('subscribe:notifications', { userId: this.apiKey });
    this.subscriptions.add('notifications');
  }

  /**
   * Unsubscribe from notifications
   */
  unsubscribeNotifications(): void {
    this.ensureConnected();
    this.socket!.emit('unsubscribe:notifications', { userId: this.apiKey });
    this.subscriptions.delete('notifications');
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Get authentication status
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * Get active subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => this.onConnect());
    this.socket.on('disconnect', (reason) => this.onDisconnect(reason));
    this.socket.on('error', (error) => this.onError(error));

    // Authentication
    this.socket.on('auth:success', () => {
      this.authenticated = true;
      this.emit('authenticated');
    });

    this.socket.on('auth:failed', (error) => {
      this.emit('error', new WebSocketError(`Authentication failed: ${error.message}`));
    });

    // Order events
    this.socket.on('order:submitted', (order: Order) => {
      this.emit(WebSocketEvent.ORDER_UPDATE, order);
    });

    this.socket.on('order:filled', (order: Order) => {
      this.emit(WebSocketEvent.ORDER_FILLED, order);
    });

    this.socket.on('order:cancelled', (order: Order) => {
      this.emit(WebSocketEvent.ORDER_CANCELLED, order);
    });

    // Order book events
    this.socket.on('orderbook:snapshot', (data: any) => {
      this.emit(WebSocketEvent.ORDERBOOK_SNAPSHOT, data);
    });

    this.socket.on('orderbook:update', (update: OrderBookUpdate) => {
      this.emit(WebSocketEvent.ORDERBOOK_UPDATE, update);
    });

    // Trade events
    this.socket.on('trade:new', (trade: Trade) => {
      this.emit(WebSocketEvent.TRADE, trade);
    });

    // Ticker events
    this.socket.on('ticker', (ticker: Ticker) => {
      this.emit(WebSocketEvent.TICKER, ticker);
    });

    // Notification events
    this.socket.on('notification:new', (notification: Notification) => {
      this.emit(WebSocketEvent.NOTIFICATION, notification);
    });

    // Heartbeat
    this.socket.on('pong', (data: any) => {
      this.emit('pong', data);
    });
  }

  /**
   * Handle connection
   */
  private onConnect(): void {
    this.reconnectAttempts = 0;
    this.emit(WebSocketEvent.CONNECTED);
    
    // Start heartbeat
    this.startHeartbeat();

    // Resubscribe to previous subscriptions
    this.resubscribe();
  }

  /**
   * Handle disconnection
   */
  private onDisconnect(reason: string): void {
    this.authenticated = false;
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.emit(WebSocketEvent.DISCONNECTED, reason);

    // Handle reconnection
    if (this.options.autoReconnect && reason !== 'io client disconnect') {
      this.attemptReconnect();
    }
  }

  /**
   * Handle errors
   */
  private onError(error: any): void {
    this.emit(WebSocketEvent.ERROR, new WebSocketError(error.message || 'Unknown error'));
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit(WebSocketEvent.ERROR, new WebSocketError('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    
    setTimeout(() => {
      this.connect().catch(error => {
        this.emit(WebSocketEvent.ERROR, error);
      });
    }, this.options.reconnectInterval);
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping');
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * Resubscribe to previous subscriptions
   */
  private resubscribe(): void {
    const subscriptions = Array.from(this.subscriptions);
    this.subscriptions.clear();

    for (const subscription of subscriptions) {
      if (subscription === 'orders') {
        this.subscribeOrders();
      } else if (subscription === 'notifications') {
        this.subscribeNotifications();
      } else if (subscription.startsWith('orderbook:')) {
        const pair = subscription.split(':')[1];
        this.subscribeOrderBook([pair]);
      } else if (subscription.startsWith('trades:')) {
        const pair = subscription.split(':')[1];
        this.subscribeTrades([pair]);
      } else if (subscription.startsWith('ticker:')) {
        const pair = subscription.split(':')[1];
        this.subscribeTicker([pair]);
      }
    }
  }

  /**
   * Ensure connected
   */
  private ensureConnected(): void {
    if (!this.socket?.connected) {
      throw new WebSocketError('WebSocket is not connected');
    }
  }
}