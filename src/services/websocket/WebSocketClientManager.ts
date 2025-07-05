import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';

export interface WebSocketClientConfig {
  url: string;
  path?: string;
  token?: string;
  apiKey?: string;
  reconnection?: boolean;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  reconnectionAttempts?: number;
  timeout?: number;
  heartbeatInterval?: number;
}

export interface Subscription {
  channel: string;
  pair?: string;
  userId?: string;
  handler: (data: any) => void;
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

export class WebSocketClient extends EventEmitter {
  private socket: Socket | null = null;
  private config: WebSocketClientConfig;
  private subscriptions: Map<string, Subscription> = new Map();
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts: number = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private messageHandlers: Map<string, Set<(data: any) => void>> = new Map();

  constructor(config: WebSocketClientConfig) {
    super();
    
    this.config = {
      path: '/ws',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      heartbeatInterval: 25000,
      ...config
    };
  }

  // Connect to WebSocket server
  public connect(): void {
    if (this.connectionState === ConnectionState.CONNECTED ||
        this.connectionState === ConnectionState.CONNECTING) {
      return;
    }

    this.setConnectionState(ConnectionState.CONNECTING);

    try {
      this.socket = io(this.config.url, {
        path: this.config.path,
        transports: ['websocket', 'polling'],
        auth: {
          token: this.config.token,
          apiKey: this.config.apiKey
        },
        query: {
          token: this.config.token,
          apiKey: this.config.apiKey
        },
        reconnection: false, // We handle reconnection manually
        timeout: this.config.timeout
      });

      this.setupSocketHandlers();
    } catch (error) {
      this.handleError('Connection failed', error);
      this.scheduleReconnect();
    }
  }

  // Disconnect from server
  public disconnect(): void {
    this.clearTimers();
    
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.setConnectionState(ConnectionState.DISCONNECTED);
    this.reconnectAttempts = 0;
  }

  // Subscribe to a channel
  public subscribe(
    channel: string,
    handler: (data: any) => void,
    options?: { pair?: string; userId?: string }
  ): string {
    const subscriptionId = this.generateSubscriptionId(channel, options?.pair, options?.userId);
    
    // Store subscription
    this.subscriptions.set(subscriptionId, {
      channel,
      pair: options?.pair,
      userId: options?.userId,
      handler
    });

    // Add handler
    const key = this.getHandlerKey(channel, options?.pair, options?.userId);
    if (!this.messageHandlers.has(key)) {
      this.messageHandlers.set(key, new Set());
    }
    this.messageHandlers.get(key)!.add(handler);

    // Send subscription if connected
    if (this.isConnected() && this.socket) {
      this.sendSubscription(channel, options?.pair, options?.userId);
    }

    return subscriptionId;
  }

  // Unsubscribe from a channel
  public unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    this.subscriptions.delete(subscriptionId);

    // Remove handler
    const key = this.getHandlerKey(subscription.channel, subscription.pair, subscription.userId);
    const handlers = this.messageHandlers.get(key);
    if (handlers) {
      handlers.delete(subscription.handler);
      if (handlers.size === 0) {
        this.messageHandlers.delete(key);
      }
    }

    // Send unsubscription if connected and no more handlers
    if (this.isConnected() && this.socket && !this.messageHandlers.has(key)) {
      this.sendUnsubscription(subscription.channel, subscription.pair, subscription.userId);
    }
  }

  // Send subscription message
  private sendSubscription(channel: string, pair?: string, userId?: string): void {
    if (!this.socket) return;

    this.socket.emit('message', {
      op: 'subscribe',
      channel,
      pair,
      userId
    });
  }

  // Send unsubscription message
  private sendUnsubscription(channel: string, pair?: string, userId?: string): void {
    if (!this.socket) return;

    this.socket.emit('message', {
      op: 'unsubscribe',
      channel,
      pair,
      userId
    });
  }

  // Setup socket event handlers
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.setConnectionState(ConnectionState.CONNECTED);
      this.reconnectAttempts = 0;
      this.resubscribeAll();
      this.startHeartbeat();
      this.emit('connected');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      this.handleDisconnect(reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error.message);
      this.handleError('Connection error', error);
    });

    // Message handling
    this.socket.on('message', (message) => {
      this.handleMessage(message);
    });

    this.socket.on('subscribed', (data) => {
      this.emit('subscribed', data);
    });

    this.socket.on('unsubscribed', (data) => {
      this.emit('unsubscribed', data);
    });

    this.socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    });

    // Heartbeat
    this.socket.on('pong', () => {
      this.emit('pong');
    });

    this.socket.on('serverShutdown', (data) => {
      console.log('Server shutdown:', data.message);
      this.emit('serverShutdown', data);
      this.disconnect();
    });
  }

  // Handle incoming messages
  private handleMessage(message: any): void {
    const { channel, pair, type, data } = message;
    
    // Get handlers for this message
    const key = this.getHandlerKey(channel, pair);
    const handlers = this.messageHandlers.get(key);
    
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error('Message handler error:', error);
        }
      });
    }

    // Emit typed events
    this.emit(`${channel}:${type}`, message);
    this.emit('message', message);
  }

  // Handle disconnection
  private handleDisconnect(reason: string): void {
    this.clearTimers();
    
    if (reason === 'io server disconnect') {
      // Server initiated disconnect, don't reconnect
      this.setConnectionState(ConnectionState.DISCONNECTED);
    } else if (this.config.reconnection) {
      // Client-side disconnect, attempt reconnection
      this.setConnectionState(ConnectionState.RECONNECTING);
      this.scheduleReconnect();
    } else {
      this.setConnectionState(ConnectionState.DISCONNECTED);
    }

    this.emit('disconnected', reason);
  }

  // Handle errors
  private handleError(context: string, error: any): void {
    this.setConnectionState(ConnectionState.ERROR);
    this.emit('error', { context, error: error.message || error });
  }

  // Schedule reconnection with exponential backoff
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.reconnectionAttempts!) {
      console.error('Max reconnection attempts reached');
      this.setConnectionState(ConnectionState.DISCONNECTED);
      this.emit('reconnectFailed');
      return;
    }

    const delay = Math.min(
      this.config.reconnectionDelay! * Math.pow(2, this.reconnectAttempts),
      this.config.reconnectionDelayMax!
    );

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);

    this.emit('reconnectScheduled', { delay, attempt: this.reconnectAttempts + 1 });
  }

  // Resubscribe to all channels after reconnection
  private resubscribeAll(): void {
    const uniqueSubscriptions = new Map<string, { channel: string; pair?: string; userId?: string }>();
    
    // Collect unique subscriptions
    for (const sub of this.subscriptions.values()) {
      const key = this.getHandlerKey(sub.channel, sub.pair, sub.userId);
      if (!uniqueSubscriptions.has(key)) {
        uniqueSubscriptions.set(key, {
          channel: sub.channel,
          pair: sub.pair,
          userId: sub.userId
        });
      }
    }

    // Resubscribe
    for (const sub of uniqueSubscriptions.values()) {
      this.sendSubscription(sub.channel, sub.pair, sub.userId);
    }
  }

  // Start heartbeat
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected() && this.socket) {
        this.socket.emit('ping');
        this.emit('ping');
      }
    }, this.config.heartbeatInterval!);
  }

  // Clear all timers
  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  // Set connection state
  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      const oldState = this.connectionState;
      this.connectionState = state;
      this.emit('stateChange', { oldState, newState: state });
    }
  }

  // Utility methods
  
  public isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED && this.socket?.connected === true;
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  private generateSubscriptionId(channel: string, pair?: string, userId?: string): string {
    return `${channel}:${pair || 'all'}:${userId || 'public'}:${Date.now()}`;
  }

  private getHandlerKey(channel: string, pair?: string, userId?: string): string {
    if (pair) return `${channel}:${pair}`;
    if (userId) return `${channel}:${userId}`;
    return channel;
  }

  // Get statistics
  public getStats(): any {
    return {
      connectionState: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      subscriptions: this.subscriptions.size,
      handlers: this.messageHandlers.size,
      connected: this.isConnected()
    };
  }
}