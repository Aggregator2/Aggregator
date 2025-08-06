/**
 * @fileoverview WebSocket client with automatic reconnection and subscription management
 * @author SwappiQ Protocol
 * @description Production-grade WebSocket client with comprehensive error handling, reconnection logic, and real-time data streaming
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  WebSocketConfig,
  WebSocketMessage,
  SubscriptionRequest,
  AuthCredentials,
  OrderBookUpdate,
  Trade,
  UserEvent
} from '../types/api.js';
import { RequestSigner } from '../utils/request-signer.js';

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  lastConnected?: number;
  reconnectAttempts: number;
  subscriptions: Set<string>;
  authenticated: boolean;
}

export interface WebSocketStats {
  messagesReceived: number;
  messagesSent: number;
  reconnectionCount: number;
  connectionUptime: number;
  averageLatency: number;
  subscriptionCount: number;
  errorCount: number;
}

export interface MessageHandler<T = any> {
  channel: string;
  handler: (data: T, metadata: any) => void | Promise<void>;
}

/**
 * Enterprise-grade WebSocket client with comprehensive features
 */
export class WebSocketClient extends EventEmitter {
  private readonly config: WebSocketConfig;
  private readonly requestSigner?: RequestSigner;

  private ws?: WebSocket;
  private connectionState: ConnectionState;
  private reconnectTimeout?: NodeJS.Timeout;
  private pingInterval?: NodeJS.Timeout;
  private pongTimeout?: NodeJS.Timeout;

  private messageHandlers: Map<string, MessageHandler[]>;
  private pendingSubscriptions: Set<string>;
  private messageQueue: any[];
  private stats: WebSocketStats;

  private lastPingTime = 0;
  private latencyMeasurements: number[] = [];

  constructor(config: WebSocketConfig) {
    super();

    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      pingInterval: 30000,
      ...config
    };

    this.requestSigner = config.auth ? new RequestSigner(config.auth) : undefined;

    this.connectionState = {
      status: 'disconnected',
      reconnectAttempts: 0,
      subscriptions: new Set(),
      authenticated: false
    };

    this.messageHandlers = new Map();
    this.pendingSubscriptions = new Set();
    this.messageQueue = [];

    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      reconnectionCount: 0,
      connectionUptime: 0,
      averageLatency: 0,
      subscriptionCount: 0,
      errorCount: 0
    };
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this.connectionState.status === 'connected' || this.connectionState.status === 'connecting') {
      return;
    }

    this.connectionState.status = 'connecting';
    this.emit('connecting');

    try {
      await this.createConnection();
    } catch (error) {
      this.handleConnectionError(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  async disconnect(): Promise<void> {
    this.clearTimeouts();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = undefined;
    }

    this.connectionState.status = 'disconnected';
    this.connectionState.authenticated = false;
    this.emit('disconnected', { reason: 'client_disconnect' });
  }

  /**
   * Subscribe to channels
   */
  async subscribe(channels: string | string[], options: { tradingPairs?: string[]; auth?: boolean } = {}): Promise<void> {
    const channelArray = Array.isArray(channels) ? channels : [channels];
    
    // Add to subscriptions set
    channelArray.forEach(channel => {
      this.connectionState.subscriptions.add(channel);
      this.pendingSubscriptions.add(channel);
    });

    // If connected, send subscription immediately
    if (this.connectionState.status === 'connected') {
      await this.sendSubscriptionRequest('subscribe', channelArray, options);
    }

    this.stats.subscriptionCount = this.connectionState.subscriptions.size;
  }

  /**
   * Unsubscribe from channels
   */
  async unsubscribe(channels: string | string[]): Promise<void> {
    const channelArray = Array.isArray(channels) ? channels : [channels];
    
    // Remove from subscriptions set
    channelArray.forEach(channel => {
      this.connectionState.subscriptions.delete(channel);
      this.pendingSubscriptions.delete(channel);
    });

    // If connected, send unsubscription
    if (this.connectionState.status === 'connected') {
      await this.sendSubscriptionRequest('unsubscribe', channelArray);
    }

    this.stats.subscriptionCount = this.connectionState.subscriptions.size;
  }

  /**
   * Register message handler for specific channel
   */
  onMessage<T = any>(channel: string, handler: (data: T, metadata: any) => void | Promise<void>): void {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, []);
    }

    this.messageHandlers.get(channel)!.push({ channel, handler });
  }

  /**
   * Remove message handler
   */
  offMessage(channel: string, handler?: Function): void {
    if (!this.messageHandlers.has(channel)) {
      return;
    }

    const handlers = this.messageHandlers.get(channel)!;
    
    if (handler) {
      const index = handlers.findIndex(h => h.handler === handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    } else {
      // Remove all handlers for channel
      this.messageHandlers.delete(channel);
    }
  }

  /**
   * Send message to server
   */
  async send(message: any): Promise<void> {
    if (this.connectionState.status !== 'connected' || !this.ws) {
      // Queue message for later sending
      this.messageQueue.push(message);
      return;
    }

    try {
      const serialized = JSON.stringify(message);
      this.ws.send(serialized);
      this.stats.messagesSent++;
      
      this.emit('messageSent', message);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get connection state
   */
  getConnectionState(): ConnectionState {
    return { ...this.connectionState };
  }

  /**
   * Get WebSocket statistics
   */
  getStats(): WebSocketStats {
    const uptime = this.connectionState.lastConnected 
      ? Date.now() - this.connectionState.lastConnected 
      : 0;

    return {
      ...this.stats,
      connectionUptime: uptime,
      averageLatency: this.calculateAverageLatency()
    };
  }

  /**
   * Check if WebSocket is healthy
   */
  isHealthy(): boolean {
    return (
      this.connectionState.status === 'connected' &&
      this.connectionState.authenticated === (this.config.auth !== undefined) &&
      this.stats.errorCount < 10 // Less than 10 errors
    );
  }

  // ========== PRIVATE METHODS ==========

  /**
   * Create WebSocket connection
   */
  private async createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);
        
        this.ws.on('open', () => {
          this.handleOpen();
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
          this.handleClose(code, reason.toString());
        });

        this.ws.on('error', (error) => {
          this.handleError(error);
          reject(error);
        });

        this.ws.on('pong', () => {
          this.handlePong();
        });

        // Connection timeout
        setTimeout(() => {
          if (this.connectionState.status === 'connecting') {
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000); // 10 second timeout

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket open event
   */
  private async handleOpen(): Promise<void> {
    this.connectionState.status = 'connected';
    this.connectionState.lastConnected = Date.now();
    this.connectionState.reconnectAttempts = 0;

    // Start ping/pong heartbeat
    this.startHeartbeat();

    // Authenticate if credentials provided
    if (this.config.auth) {
      await this.authenticate();
    } else {
      this.connectionState.authenticated = true;
    }

    // Re-subscribe to channels
    await this.resubscribeChannels();

    // Send queued messages
    await this.flushMessageQueue();

    this.emit('connected');
  }

  /**
   * Handle WebSocket message
   */
  private handleMessage(data: Buffer | string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      this.stats.messagesReceived++;

      // Handle pong response for latency measurement
      if (message.type === 'pong') {
        this.handlePong();
        return;
      }

      // Handle authentication response
      if (message.type === 'auth_response') {
        this.handleAuthResponse(message);
        return;
      }

      // Handle subscription confirmation
      if (message.type === 'subscription_confirmed') {
        this.handleSubscriptionConfirmation(message);
        return;
      }

      // Route message to appropriate handlers
      this.routeMessage(message);

      this.emit('message', message);

    } catch (error) {
      this.stats.errorCount++;
      this.emit('parseError', { error, data: data.toString() });
    }
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(code: number, reason: string): void {
    this.clearTimeouts();
    this.connectionState.status = 'disconnected';
    this.connectionState.authenticated = false;

    this.emit('disconnected', { code, reason });

    // Attempt reconnection if not a clean close
    if (code !== 1000 && this.connectionState.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.scheduleReconnection();
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleError(error: Error): void {
    this.stats.errorCount++;
    this.emit('error', error);
  }

  /**
   * Handle connection error during initial connection
   */
  private handleConnectionError(error: Error): void {
    this.connectionState.status = 'error';
    this.stats.errorCount++;
    
    if (this.connectionState.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.scheduleReconnection();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnection(): void {
    if (this.reconnectTimeout) {
      return; // Already scheduled
    }

    this.connectionState.status = 'reconnecting';
    this.connectionState.reconnectAttempts++;
    this.stats.reconnectionCount++;

    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.connectionState.reconnectAttempts - 1),
      60000 // Max 1 minute delay
    );

    this.emit('reconnecting', {
      attempt: this.connectionState.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts,
      delay
    });

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = undefined;
      
      try {
        await this.connect();
      } catch (error) {
        // Error already handled in connect method
      }
    }, delay);
  }

  /**
   * Authenticate with server
   */
  private async authenticate(): Promise<void> {
    if (!this.requestSigner || !this.config.auth) {
      throw new Error('Authentication credentials not available');
    }

    const timestamp = Date.now().toString();
    const authMessage = {
      type: 'authenticate',
      timestamp,
      apiKey: this.config.auth.apiKey
    };

    // Sign the authentication message
    const signedRequest = await this.requestSigner.signRequest({
      method: 'POST',
      path: '/ws/auth',
      body: JSON.stringify(authMessage),
      timestamp
    });

    const authenticatedMessage = {
      ...authMessage,
      signature: signedRequest.signature
    };

    await this.send(authenticatedMessage);
  }

  /**
   * Handle authentication response
   */
  private handleAuthResponse(message: WebSocketMessage): void {
    if (message.data?.success) {
      this.connectionState.authenticated = true;
      this.emit('authenticated');
    } else {
      this.connectionState.authenticated = false;
      this.emit('authenticationFailed', message.data);
    }
  }

  /**
   * Re-subscribe to all channels after reconnection
   */
  private async resubscribeChannels(): Promise<void> {
    if (this.connectionState.subscriptions.size === 0) {
      return;
    }

    const channels = Array.from(this.connectionState.subscriptions);
    await this.sendSubscriptionRequest('subscribe', channels);
  }

  /**
   * Send subscription request
   */
  private async sendSubscriptionRequest(
    type: 'subscribe' | 'unsubscribe',
    channels: string[],
    options: { tradingPairs?: string[]; auth?: boolean } = {}
  ): Promise<void> {
    const request: SubscriptionRequest = {
      type,
      channels,
      tradingPairs: options.tradingPairs,
      auth: options.auth
    };

    await this.send(request);
  }

  /**
   * Handle subscription confirmation
   */
  private handleSubscriptionConfirmation(message: WebSocketMessage): void {
    const { channel } = message.data;
    if (channel) {
      this.pendingSubscriptions.delete(channel);
      this.emit('subscribed', { channel });
    }
  }

  /**
   * Route incoming message to appropriate handlers
   */
  private routeMessage(message: WebSocketMessage): void {
    const handlers = this.messageHandlers.get(message.channel);
    if (!handlers || handlers.length === 0) {
      return;
    }

    // Execute all handlers for the channel
    handlers.forEach(async ({ handler }) => {
      try {
        await handler(message.data, {
          channel: message.channel,
          timestamp: message.timestamp,
          sequence: message.sequence
        });
      } catch (error) {
        this.emit('handlerError', { error, message });
      }
    });
  }

  /**
   * Start ping/pong heartbeat
   */
  private startHeartbeat(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        this.ws.ping();
        
        // Set pong timeout
        this.pongTimeout = setTimeout(() => {
          // No pong received, assume connection is dead
          this.ws?.close(1000, 'Ping timeout');
        }, 5000); // 5 second pong timeout
      }
    }, this.config.pingInterval);
  }

  /**
   * Handle pong response
   */
  private handlePong(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = undefined;
    }

    if (this.lastPingTime > 0) {
      const latency = Date.now() - this.lastPingTime;
      this.latencyMeasurements.push(latency);
      
      // Keep only last 100 measurements
      if (this.latencyMeasurements.length > 100) {
        this.latencyMeasurements.shift();
      }
    }
  }

  /**
   * Calculate average latency
   */
  private calculateAverageLatency(): number {
    if (this.latencyMeasurements.length === 0) {
      return 0;
    }

    const sum = this.latencyMeasurements.reduce((acc, latency) => acc + latency, 0);
    return sum / this.latencyMeasurements.length;
  }

  /**
   * Flush queued messages
   */
  private async flushMessageQueue(): Promise<void> {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      await this.send(message);
    }
  }

  /**
   * Clear all timeouts
   */
  private clearTimeouts(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = undefined;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.clearTimeouts();
    
    // Unsubscribe from all channels
    if (this.connectionState.subscriptions.size > 0) {
      const channels = Array.from(this.connectionState.subscriptions);
      await this.unsubscribe(channels);
    }

    // Close connection
    await this.disconnect();

    // Clear handlers
    this.messageHandlers.clear();
    this.removeAllListeners();
  }
}

/**
 * Convenience methods for common WebSocket operations
 */
export class SwappiQWebSocket extends WebSocketClient {
  /**
   * Subscribe to order book updates
   */
  async subscribeToOrderBook(tradingPairs: string | string[]): Promise<void> {
    await this.subscribe('orderbook', { tradingPairs: Array.isArray(tradingPairs) ? tradingPairs : [tradingPairs] });
  }

  /**
   * Subscribe to trade updates
   */
  async subscribeToTrades(tradingPairs: string | string[]): Promise<void> {
    await this.subscribe('trades', { tradingPairs: Array.isArray(tradingPairs) ? tradingPairs : [tradingPairs] });
  }

  /**
   * Subscribe to user events (requires authentication)
   */
  async subscribeToUserEvents(): Promise<void> {
    await this.subscribe(['orders', 'trades', 'balances'], { auth: true });
  }

  /**
   * Handle order book updates with typed data
   */
  onOrderBookUpdate(handler: (update: OrderBookUpdate) => void | Promise<void>): void {
    this.onMessage('orderbook', handler);
  }

  /**
   * Handle trade updates with typed data
   */
  onTradeUpdate(handler: (trade: Trade) => void | Promise<void>): void {
    this.onMessage('trades', handler);
  }

  /**
   * Handle user events with typed data
   */
  onUserEvent(handler: (event: UserEvent) => void | Promise<void>): void {
    this.onMessage('orders', handler);
    this.onMessage('trades', handler);
    this.onMessage('balances', handler);
  }
}