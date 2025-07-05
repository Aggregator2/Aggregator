import { Server as HTTPServer } from 'http';
import { Server as HTTPSServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { v4 as uuidv4 } from 'uuid';

export interface WebSocketConfig {
  port: number;
  host: string;
  path: string;
  heartbeatInterval: number;
  maxConnections: number;
  rateLimitWindow: number;
  rateLimitMax: number;
  ssl: {
    enabled: boolean;
    certPath?: string;
    keyPath?: string;
  };
}

export interface AuthenticatedWebSocket extends WebSocket {
  id: string;
  userId?: string;
  isAlive: boolean;
  subscriptions: Set<string>;
  metadata: Map<string, any>;
}

// Get WebSocket configuration
export const getWebSocketConfig = (): WebSocketConfig => {
  return {
    port: parseInt(process.env.WS_PORT || '8080'),
    host: process.env.WS_HOST || '0.0.0.0',
    path: process.env.WS_PATH || '/ws',
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000'),
    maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS || '10000'),
    rateLimitWindow: parseInt(process.env.WS_RATE_LIMIT_WINDOW || '60000'),
    rateLimitMax: parseInt(process.env.WS_RATE_LIMIT_MAX || '100'),
    ssl: {
      enabled: process.env.WS_SSL_ENABLED === 'true',
      certPath: process.env.WS_SSL_CERT_PATH,
      keyPath: process.env.WS_SSL_KEY_PATH,
    },
  };
};

// WebSocket server manager
export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, AuthenticatedWebSocket> = new Map();
  private rateLimiter: RateLimiterMemory;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private config: WebSocketConfig;
  
  constructor() {
    this.config = getWebSocketConfig();
    this.rateLimiter = new RateLimiterMemory({
      points: this.config.rateLimitMax,
      duration: this.config.rateLimitWindow / 1000, // convert to seconds
    });
  }
  
  // Initialize WebSocket server
  async initialize(server: HTTPServer | HTTPSServer): Promise<void> {
    this.wss = new WebSocketServer({
      server,
      path: this.config.path,
      maxPayload: 1024 * 1024, // 1MB
      clientTracking: false,
    });
    
    this.wss.on('connection', this.handleConnection.bind(this));
    
    // Start heartbeat
    this.startHeartbeat();
    
    console.log(`WebSocket server initialized on ${this.config.host}:${this.config.port}${this.config.path}`);
  }
  
  // Handle new WebSocket connection
  private async handleConnection(ws: WebSocket, request: any): Promise<void> {
    const clientId = uuidv4();
    const client = ws as AuthenticatedWebSocket;
    
    // Check max connections
    if (this.clients.size >= this.config.maxConnections) {
      ws.close(1008, 'Max connections reached');
      return;
    }
    
    // Initialize client
    client.id = clientId;
    client.isAlive = true;
    client.subscriptions = new Set();
    client.metadata = new Map();
    
    // Get client IP
    const clientIp = request.headers['x-forwarded-for'] || request.socket.remoteAddress;
    client.metadata.set('ip', clientIp);
    client.metadata.set('connectedAt', new Date());
    
    // Add to clients map
    this.clients.set(clientId, client);
    
    // Set up event handlers
    client.on('message', (data) => this.handleMessage(client, data));
    client.on('close', () => this.handleDisconnect(client));
    client.on('error', (error) => this.handleError(client, error));
    client.on('pong', () => { client.isAlive = true; });
    
    // Send welcome message
    this.sendToClient(client, {
      type: 'welcome',
      clientId,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`WebSocket client connected: ${clientId} from ${clientIp}`);
  }
  
  // Handle incoming messages
  private async handleMessage(client: AuthenticatedWebSocket, data: any): Promise<void> {
    try {
      // Rate limiting
      const clientIp = client.metadata.get('ip');
      await this.rateLimiter.consume(clientIp);
      
      // Parse message
      const message = JSON.parse(data.toString());
      
      // Validate message
      if (!message.type) {
        throw new Error('Message type is required');
      }
      
      // Handle different message types
      switch (message.type) {
        case 'auth':
          await this.handleAuth(client, message);
          break;
          
        case 'subscribe':
          await this.handleSubscribe(client, message);
          break;
          
        case 'unsubscribe':
          await this.handleUnsubscribe(client, message);
          break;
          
        case 'ping':
          this.sendToClient(client, { type: 'pong', timestamp: Date.now() });
          break;
          
        default:
          // Emit custom event for application-specific handling
          this.emit('message', { client, message });
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('rate limit')) {
          this.sendError(client, 'Rate limit exceeded', 429);
        } else {
          this.sendError(client, error.message);
        }
      }
    }
  }
  
  // Handle authentication
  private async handleAuth(client: AuthenticatedWebSocket, message: any): Promise<void> {
    // Implement your authentication logic here
    // This is a placeholder implementation
    if (message.token) {
      // Verify token and get user ID
      // const userId = await verifyToken(message.token);
      const userId = 'user123'; // Placeholder
      
      client.userId = userId;
      client.metadata.set('authenticated', true);
      
      this.sendToClient(client, {
        type: 'auth_success',
        userId,
        timestamp: new Date().toISOString(),
      });
    } else {
      throw new Error('Authentication token required');
    }
  }
  
  // Handle subscription
  private async handleSubscribe(client: AuthenticatedWebSocket, message: any): Promise<void> {
    const { channel } = message;
    
    if (!channel) {
      throw new Error('Channel is required');
    }
    
    // Check authorization for channel
    // This is a placeholder - implement your authorization logic
    const authorized = true;
    
    if (!authorized) {
      throw new Error('Not authorized for this channel');
    }
    
    client.subscriptions.add(channel);
    
    this.sendToClient(client, {
      type: 'subscribed',
      channel,
      timestamp: new Date().toISOString(),
    });
  }
  
  // Handle unsubscription
  private async handleUnsubscribe(client: AuthenticatedWebSocket, message: any): Promise<void> {
    const { channel } = message;
    
    if (!channel) {
      throw new Error('Channel is required');
    }
    
    client.subscriptions.delete(channel);
    
    this.sendToClient(client, {
      type: 'unsubscribed',
      channel,
      timestamp: new Date().toISOString(),
    });
  }
  
  // Handle client disconnect
  private handleDisconnect(client: AuthenticatedWebSocket): void {
    this.clients.delete(client.id);
    console.log(`WebSocket client disconnected: ${client.id}`);
  }
  
  // Handle client error
  private handleError(client: AuthenticatedWebSocket, error: Error): void {
    console.error(`WebSocket error for client ${client.id}:`, error);
  }
  
  // Send message to specific client
  sendToClient(client: AuthenticatedWebSocket, data: any): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }
  
  // Send error to client
  private sendError(client: AuthenticatedWebSocket, message: string, code?: number): void {
    this.sendToClient(client, {
      type: 'error',
      error: message,
      code,
      timestamp: new Date().toISOString(),
    });
  }
  
  // Broadcast to all clients
  broadcast(data: any): void {
    const message = JSON.stringify(data);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  // Broadcast to channel subscribers
  broadcastToChannel(channel: string, data: any): void {
    const message = JSON.stringify({ ...data, channel });
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client.subscriptions.has(channel)) {
        client.send(message);
      }
    });
  }
  
  // Start heartbeat interval
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach(client => {
        if (!client.isAlive) {
          client.terminate();
          this.clients.delete(client.id);
          return;
        }
        
        client.isAlive = false;
        client.ping();
      });
    }, this.config.heartbeatInterval);
  }
  
  // Get client statistics
  getStats(): {
    totalClients: number;
    authenticatedClients: number;
    channelSubscriptions: Map<string, number>;
  } {
    const channelSubscriptions = new Map<string, number>();
    let authenticatedClients = 0;
    
    this.clients.forEach(client => {
      if (client.userId) {
        authenticatedClients++;
      }
      
      client.subscriptions.forEach(channel => {
        channelSubscriptions.set(channel, (channelSubscriptions.get(channel) || 0) + 1);
      });
    });
    
    return {
      totalClients: this.clients.size,
      authenticatedClients,
      channelSubscriptions,
    };
  }
  
  // Shutdown WebSocket server
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Close all client connections
    this.clients.forEach(client => {
      client.close(1001, 'Server shutting down');
    });
    
    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
    }
    
    console.log('WebSocket server shut down');
  }
  
  // Event emitter functionality (simplified)
  private listeners: Map<string, Function[]> = new Map();
  
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }
  
  private emit(event: string, data: any): void {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(callback => callback(data));
  }
}

// Singleton instance
let wsManager: WebSocketManager | null = null;

export const getWebSocketManager = (): WebSocketManager => {
  if (!wsManager) {
    wsManager = new WebSocketManager();
  }
  return wsManager;
};