import { EventEmitter } from 'events';

export interface OrderUpdate {
  type: 'ORDER_UPDATE' | 'ORDER_FILLED' | 'ORDER_CANCELLED' | 'TRADE_EXECUTED' | 'EXECUTION_REPORT';
  timestamp: number;
  order?: any;
  trade?: any;
  report?: any;
}

export interface WebSocketConfig {
  url: string;
  authToken?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class OrderWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isAuthenticated: boolean = false;
  private messageQueue: any[] = [];

  constructor(config: WebSocketConfig) {
    super();
    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      ...config,
    };
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(this.config.url);
      this.setupEventHandlers();
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.messageQueue = [];
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.emit('connected');
      
      // Authenticate immediately
      if (this.config.authToken) {
        this.authenticate(this.config.authToken);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      this.isAuthenticated = false;
      this.emit('disconnected', event.reason);
      
      if (event.code !== 1000) { // Not a normal closure
        this.scheduleReconnect();
      }
    };
  }

  private handleMessage(data: any): void {
    switch (data.type) {
      case 'connected':
        console.log('Server acknowledged connection');
        break;
        
      case 'authenticated':
        this.isAuthenticated = true;
        this.emit('authenticated', data);
        this.flushMessageQueue();
        break;
        
      case 'error':
        this.emit('error', new Error(data.error));
        break;
        
      case 'pong':
        this.emit('pong', data.timestamp);
        break;
        
      case 'subscribed':
        this.emit('subscribed', data.channel);
        break;
        
      case 'unsubscribed':
        this.emit('unsubscribed', data.channel);
        break;
        
      case 'ACTIVE_ORDERS':
        this.emit('activeOrders', data.orders);
        break;
        
      case 'ORDER_UPDATE':
      case 'ORDER_FILLED':
      case 'ORDER_CANCELLED':
        this.emit('orderUpdate', data);
        this.emit(data.type.toLowerCase().replace('_', ':'), data.order);
        break;
        
      case 'EXECUTION_REPORT':
        this.emit('executionReport', data.report);
        break;
        
      default:
        console.log('Unknown message type:', data.type);
    }
  }

  private authenticate(token: string): void {
    this.send({
      type: 'auth',
      token,
    });
  }

  subscribeToOrder(orderId: string): void {
    this.send({
      type: 'subscribe',
      data: { orderId },
    });
  }

  subscribeToPair(pair: string): void {
    this.send({
      type: 'subscribe',
      data: { pair },
    });
  }

  subscribeToAllOrders(): void {
    this.send({
      type: 'subscribe',
      data: { all: true },
    });
  }

  unsubscribeFromOrder(orderId: string): void {
    this.send({
      type: 'unsubscribe',
      data: { orderId },
    });
  }

  unsubscribeFromPair(pair: string): void {
    this.send({
      type: 'unsubscribe',
      data: { pair },
    });
  }

  unsubscribeFromAllOrders(): void {
    this.send({
      type: 'unsubscribe',
      data: { all: true },
    });
  }

  ping(): void {
    this.send({ type: 'ping' });
  }

  private send(data: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, queuing message');
      this.messageQueue.push(data);
      return;
    }

    if (!this.isAuthenticated && data.type !== 'auth' && data.type !== 'ping') {
      console.warn('Not authenticated, queuing message');
      this.messageQueue.push(data);
      return;
    }

    try {
      this.ws.send(JSON.stringify(data));
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
      this.emit('error', error);
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts!) {
      console.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.clearReconnectTimer();
    this.reconnectAttempts++;
    
    const delay = Math.min(
      this.config.reconnectInterval! * Math.pow(2, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );
    
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  isReady(): boolean {
    return this.isConnected() && this.isAuthenticated;
  }
}