import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';

export interface WebSocketClientConfig {
  url: string;
  path?: string;
  authToken?: string;
  autoConnect?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  timeout?: number;
}

export interface Subscription {
  channel: string;
  params?: any;
  callback?: (data: any) => void;
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  AUTHENTICATED = 'authenticated',
  ERROR = 'error'
}

export class WebSocketClient extends EventEmitter {
  private socket: Socket | null = null;
  private config: WebSocketClientConfig;
  private subscriptions: Map<string, Subscription> = new Map();
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private lastHeartbeat: number = 0;
  private latency: number = 0;
  private messageHandlers: Map<string, Set<(data: any) => void>> = new Map();

  constructor(config: WebSocketClientConfig) {
    super();
    this.config = {
      path: '/ws',
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      ...config
    };

    if (this.config.autoConnect) {
      this.connect();
    }
  }

  // Connect to WebSocket server
  connect(): void {
    if (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.CONNECTED) {
      return;
    }

    this.setState(ConnectionState.CONNECTING);

    const options: any = {
      path: this.config.path,
      transports: ['websocket'],
      reconnection: false, // We handle reconnection manually
      timeout: this.config.timeout
    };

    if (this.config.authToken) {
      options.auth = {
        token: this.config.authToken
      };
    }

    this.socket = io(this.config.url, options);
    this.setupEventHandlers();
  }

  // Disconnect from server
  disconnect(): void {
    this.clearTimers();
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.setState(ConnectionState.DISCONNECTED);
    this.subscriptions.clear();
  }

  // Setup socket event handlers
  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', this.handleConnect.bind(this));
    this.socket.on('disconnect', this.handleDisconnect.bind(this));
    this.socket.on('connect_error', this.handleError.bind(this));

    // Authentication
    this.socket.on('authenticated', this.handleAuthenticated.bind(this));
    this.socket.on('unauthorized', this.handleUnauthorized.bind(this));

    // Data events
    this.socket.on('orderbook:snapshot', (data) => this.handleMessage('orderbook:snapshot', data));
    this.socket.on('orderbook:update', (data) => this.handleMessage('orderbook:update', data));
    this.socket.on('orderbook:depth', (data) => this.handleMessage('orderbook:depth', data));
    this.socket.on('trades:new', (data) => this.handleMessage('trades:new', data));
    this.socket.on('trades:recent', (data) => this.handleMessage('trades:recent', data));
    this.socket.on('ticker:update', (data) => this.handleMessage('ticker:update', data));
    this.socket.on('market:data', (data) => this.handleMessage('market:data', data));
    this.socket.on('order:update', (data) => this.handleMessage('order:update', data));
    this.socket.on('trade:executed', (data) => this.handleMessage('trade:executed', data));
    this.socket.on('orders:update', (data) => this.handleMessage('orders:update', data));
    this.socket.on('trades:new', (data) => this.handleMessage('trades:new', data));
    this.socket.on('user:orders', (data) => this.handleMessage('user:orders', data));
    this.socket.on('user:trades', (data) => this.handleMessage('user:trades', data));

    // Settlement events
    this.socket.on('settlement:epoch:started', (data) => this.handleMessage('settlement:epoch:started', data));
    this.socket.on('settlement:epoch:finalized', (data) => this.handleMessage('settlement:epoch:finalized', data));
    this.socket.on('settlement:confirmed', (data) => this.handleMessage('settlement:confirmed', data));

    // System events
    this.socket.on('heartbeat', this.handleHeartbeat.bind(this));
    this.socket.on('error', this.handleError.bind(this));
  }

  // Handle connection
  private handleConnect(): void {
    console.log('WebSocket connected');
    this.setState(ConnectionState.CONNECTED);
    this.clearReconnectTimer();
    this.startHeartbeat();
    
    // Resubscribe to all channels
    this.resubscribeAll();
    
    this.emit('connected');
  }

  // Handle disconnection
  private handleDisconnect(reason: string): void {
    console.log('WebSocket disconnected:', reason);
    this.setState(ConnectionState.DISCONNECTED);
    this.clearTimers();
    
    this.emit('disconnected', reason);
    
    // Start reconnection if not manual disconnect
    if (reason !== 'io client disconnect') {
      this.startReconnection();
    }
  }

  // Handle authentication
  private handleAuthenticated(data: any): void {
    console.log('WebSocket authenticated');
    this.setState(ConnectionState.AUTHENTICATED);
    this.emit('authenticated', data);
  }

  // Handle unauthorized
  private handleUnauthorized(error: any): void {
    console.error('WebSocket authentication failed:', error);
    this.emit('unauthorized', error);
  }

  // Handle errors
  private handleError(error: any): void {
    console.error('WebSocket error:', error);
    this.setState(ConnectionState.ERROR);
    this.emit('error', error);
  }

  // Handle incoming messages
  private handleMessage(event: string, data: any): void {
    // Emit for specific event listeners
    this.emit(event, data);
    
    // Call registered handlers
    const handlers = this.messageHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in message handler for ${event}:`, error);
        }
      });
    }
    
    // Handle subscription callbacks
    if (data.pair) {
      const channelKey = this.getChannelKey(event, data.pair);
      const subscription = this.subscriptions.get(channelKey);
      if (subscription?.callback) {
        subscription.callback(data);
      }
    }
  }

  // Handle heartbeat
  private handleHeartbeat(data: { timestamp: number }): void {
    const now = Date.now();
    this.latency = now - data.timestamp;
    this.lastHeartbeat = now;
    
    // Respond to heartbeat
    if (this.socket) {
      this.socket.emit('pong', { timestamp: now });
    }
    
    this.emit('heartbeat', { latency: this.latency });
  }

  // Subscribe to a channel
  subscribe(channel: string, params?: any, callback?: (data: any) => void): void {
    if (!this.socket || this.state !== ConnectionState.CONNECTED) {
      console.warn('Cannot subscribe: not connected');
      return;
    }

    const subscription: Subscription = { channel, params, callback };
    const key = this.getSubscriptionKey(channel, params);
    
    this.subscriptions.set(key, subscription);
    
    this.socket.emit('subscribe', { channel, params });
    console.log(`Subscribed to ${channel}`, params);
  }

  // Unsubscribe from a channel
  unsubscribe(channel: string, params?: any): void {
    if (!this.socket) return;
    
    const key = this.getSubscriptionKey(channel, params);
    this.subscriptions.delete(key);
    
    this.socket.emit('unsubscribe', { channel, params });
    console.log(`Unsubscribed from ${channel}`, params);
  }

  // Subscribe to order book updates
  subscribeOrderBook(pair: string, callback?: (data: any) => void): void {
    this.subscribe('orderbook', { pair }, callback);
  }

  // Subscribe to trades
  subscribeTrades(pair: string, callback?: (data: any) => void): void {
    this.subscribe('trades', { pair }, callback);
  }

  // Subscribe to ticker
  subscribeTicker(pair: string, callback?: (data: any) => void): void {
    this.subscribe('ticker', { pair }, callback);
  }

  // Subscribe to market data
  subscribeMarketData(pair: string, callback?: (data: any) => void): void {
    this.subscribe('market', { pair }, callback);
  }

  // Subscribe to user orders
  subscribeUserOrders(callback?: (data: any) => void): void {
    this.subscribe('orders', {}, callback);
  }

  // Subscribe to user trades
  subscribeUserTrades(callback?: (data: any) => void): void {
    this.subscribe('user_trades', {}, callback);
  }

  // Register a message handler
  on(event: string, handler: (data: any) => void): this {
    if (!this.messageHandlers.has(event)) {
      this.messageHandlers.set(event, new Set());
    }
    this.messageHandlers.get(event)!.add(handler);
    return super.on(event, handler);
  }

  // Remove a message handler
  off(event: string, handler: (data: any) => void): this {
    const handlers = this.messageHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
    return super.off(event, handler);
  }

  // Send a request
  request(event: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.state !== ConnectionState.CONNECTED) {
        reject(new Error('Not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 10000);

      this.socket.emit(event, data, (response: any) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }

  // Request order book snapshot
  async requestOrderBookSnapshot(pair: string): Promise<any> {
    return this.request('request:orderbook:snapshot', { pair });
  }

  // Request recent trades
  async requestRecentTrades(pair: string, limit?: number): Promise<any> {
    return this.request('request:trades:recent', { pair, limit });
  }

  // Request user orders
  async requestUserOrders(pair?: string): Promise<any> {
    return this.request('request:user:orders', { pair });
  }

  // Request user trades
  async requestUserTrades(pair?: string, limit?: number): Promise<any> {
    return this.request('request:user:trades', { pair, limit });
  }

  // Request market data
  async requestMarketData(pair: string): Promise<any> {
    return this.request('request:market:data', { pair });
  }

  // Get connection state
  getState(): ConnectionState {
    return this.state;
  }

  // Get latency
  getLatency(): number {
    return this.latency;
  }

  // Check if connected
  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED || this.state === ConnectionState.AUTHENTICATED;
  }

  // Private helper methods
  private setState(state: ConnectionState): void {
    this.state = state;
    this.emit('stateChange', state);
  }

  private getSubscriptionKey(channel: string, params?: any): string {
    return params?.pair ? `${channel}:${params.pair}` : channel;
  }

  private getChannelKey(event: string, pair: string): string {
    const channelMap: { [key: string]: string } = {
      'orderbook:snapshot': 'orderbook',
      'orderbook:update': 'orderbook',
      'orderbook:depth': 'orderbook',
      'trades:new': 'trades',
      'ticker:update': 'ticker',
      'market:data': 'market'
    };
    
    const channel = channelMap[event];
    return channel ? `${channel}:${pair}` : event;
  }

  private resubscribeAll(): void {
    for (const [key, subscription] of this.subscriptions) {
      if (this.socket) {
        this.socket.emit('subscribe', {
          channel: subscription.channel,
          params: subscription.params
        });
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastHeartbeat > 60000) { // 1 minute timeout
        console.warn('Heartbeat timeout, reconnecting...');
        this.handleDisconnect('heartbeat timeout');
      }
    }, 30000);
  }

  private startReconnection(): void {
    let attempts = 0;
    const maxAttempts = this.config.reconnectionAttempts!;
    const baseDelay = this.config.reconnectionDelay!;
    const maxDelay = this.config.reconnectionDelayMax!;

    const attemptReconnect = () => {
      if (attempts >= maxAttempts) {
        console.error('Max reconnection attempts reached');
        this.emit('reconnectFailed');
        return;
      }

      attempts++;
      console.log(`Reconnection attempt ${attempts}/${maxAttempts}`);
      this.emit('reconnecting', { attempt: attempts, maxAttempts });

      this.connect();

      // Exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempts - 1), maxDelay);
      this.reconnectTimer = setTimeout(attemptReconnect, delay);
    };

    this.reconnectTimer = setTimeout(attemptReconnect, baseDelay);
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

// Factory function
export function createWebSocketClient(config: WebSocketClientConfig): WebSocketClient {
  return new WebSocketClient(config);
}