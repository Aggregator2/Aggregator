import { EventEmitter } from 'events';
import * as WebSocket from 'ws';
import { Server as HttpServer } from 'http';
import { PrometheusMetricsExporter } from '../prometheus/PrometheusMetricsExporter';
import { SLAMonitor, SLAViolation } from '../sla/SLAMonitor';
import * as jwt from 'jsonwebtoken';

export interface StreamConfig {
  port: number;
  authEnabled: boolean;
  jwtSecret?: string;
  maxConnections: number;
  heartbeatInterval: number;
  metrics: {
    websocket: boolean;
    orders: boolean;
    trades: boolean;
    system: boolean;
    sla: boolean;
  };
  aggregation: {
    interval: number; // ms
    windowSize: number; // number of data points to keep
  };
  compression: boolean;
}

export interface MetricsSnapshot {
  timestamp: number;
  websocket?: {
    activeConnections: number;
    messageRate: number;
    errorRate: number;
    latency: { p50: number; p95: number; p99: number };
  };
  orders?: {
    rate: number;
    processingTime: number;
    rejectionRate: number;
    queueDepth: number;
  };
  trades?: {
    rate: number;
    volume: number;
    executionTime: number;
  };
  system?: {
    cpuUsage: number;
    memoryUsage: number;
    eventLoopLag: number;
  };
  sla?: {
    compliance: number;
    activeViolations: SLAViolation[];
  };
}

interface StreamClient {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  subscriptions: Set<string>;
  lastHeartbeat: number;
}

export class MetricsStreamer extends EventEmitter {
  private config: StreamConfig;
  private metricsExporter: PrometheusMetricsExporter;
  private slaMonitor: SLAMonitor;
  private wss?: WebSocket.Server;
  private clients: Map<string, StreamClient> = new Map();
  private metricsBuffer: MetricsSnapshot[] = [];
  private aggregationInterval?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private currentMetrics: Partial<MetricsSnapshot> = {};
  
  constructor(
    config: StreamConfig,
    metricsExporter: PrometheusMetricsExporter,
    slaMonitor: SLAMonitor
  ) {
    super();
    this.config = config;
    this.metricsExporter = metricsExporter;
    this.slaMonitor = slaMonitor;
  }

  async start(server?: HttpServer): Promise<void> {
    // Create WebSocket server
    this.wss = new WebSocket.Server({
      port: server ? undefined : this.config.port,
      server,
      verifyClient: this.config.authEnabled ? this.verifyClient.bind(this) : undefined,
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    
    // Start metrics aggregation
    this.startAggregation();
    
    // Start heartbeat monitoring
    this.startHeartbeat();
    
    // Subscribe to real-time events
    this.subscribeToEvents();
    
    console.log(`📡 Metrics streaming server started on port ${this.config.port}`);
    this.emit('started', { port: this.config.port });
  }

  private verifyClient(
    info: { origin: string; secure: boolean; req: any },
    callback: (result: boolean, code?: number, message?: string) => void
  ): void {
    if (!this.config.authEnabled || !this.config.jwtSecret) {
      callback(true);
      return;
    }

    const token = this.extractToken(info.req);
    if (!token) {
      callback(false, 401, 'Unauthorized');
      return;
    }

    try {
      jwt.verify(token, this.config.jwtSecret);
      callback(true);
    } catch (error) {
      callback(false, 401, 'Invalid token');
    }
  }

  private extractToken(req: any): string | null {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.substring(7);
    }
    
    // Check query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    return url.searchParams.get('token');
  }

  private handleConnection(ws: WebSocket, req: any): void {
    const clientId = this.generateClientId();
    const client: StreamClient = {
      id: clientId,
      ws,
      authenticated: !this.config.authEnabled,
      subscriptions: new Set(['all']), // Default subscription
      lastHeartbeat: Date.now(),
    };

    this.clients.set(clientId, client);
    console.log(`👤 New streaming client connected: ${clientId}`);

    // Send welcome message
    this.sendToClient(client, {
      type: 'welcome',
      clientId,
      timestamp: Date.now(),
      config: {
        heartbeatInterval: this.config.heartbeatInterval,
        availableMetrics: Object.keys(this.config.metrics).filter(k => this.config.metrics[k]),
      },
    });

    // Send current snapshot
    this.sendSnapshot(client);

    // Setup client event handlers
    ws.on('message', (message) => this.handleClientMessage(client, message));
    ws.on('close', () => this.handleClientDisconnect(client));
    ws.on('error', (error) => this.handleClientError(client, error));
    ws.on('pong', () => {
      client.lastHeartbeat = Date.now();
    });
  }

  private handleClientMessage(client: StreamClient, message: WebSocket.Data): void {
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case 'subscribe':
          this.handleSubscribe(client, data.metrics);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(client, data.metrics);
          break;
        case 'request_snapshot':
          this.sendSnapshot(client);
          break;
        case 'request_history':
          this.sendHistory(client, data.duration);
          break;
        case 'ping':
          this.sendToClient(client, { type: 'pong', timestamp: Date.now() });
          break;
        case 'auth':
          this.handleAuth(client, data.token);
          break;
      }
    } catch (error) {
      console.error(`Error handling client message from ${client.id}:`, error);
      this.sendError(client, 'Invalid message format');
    }
  }

  private handleSubscribe(client: StreamClient, metrics: string[]): void {
    if (!Array.isArray(metrics)) {
      this.sendError(client, 'Invalid subscription format');
      return;
    }

    for (const metric of metrics) {
      if (metric === 'all' || this.config.metrics[metric]) {
        client.subscriptions.add(metric);
      }
    }

    this.sendToClient(client, {
      type: 'subscribed',
      metrics: Array.from(client.subscriptions),
      timestamp: Date.now(),
    });
  }

  private handleUnsubscribe(client: StreamClient, metrics: string[]): void {
    if (!Array.isArray(metrics)) {
      this.sendError(client, 'Invalid unsubscription format');
      return;
    }

    for (const metric of metrics) {
      client.subscriptions.delete(metric);
    }

    this.sendToClient(client, {
      type: 'unsubscribed',
      metrics: Array.from(client.subscriptions),
      timestamp: Date.now(),
    });
  }

  private handleAuth(client: StreamClient, token: string): void {
    if (!this.config.authEnabled || !this.config.jwtSecret) {
      client.authenticated = true;
      this.sendToClient(client, {
        type: 'authenticated',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      jwt.verify(token, this.config.jwtSecret);
      client.authenticated = true;
      this.sendToClient(client, {
        type: 'authenticated',
        timestamp: Date.now(),
      });
    } catch (error) {
      this.sendError(client, 'Authentication failed');
      client.ws.close(1008, 'Authentication failed');
    }
  }

  private handleClientDisconnect(client: StreamClient): void {
    console.log(`👋 Streaming client disconnected: ${client.id}`);
    this.clients.delete(client.id);
    this.emit('client-disconnected', { clientId: client.id });
  }

  private handleClientError(client: StreamClient, error: Error): void {
    console.error(`Error with streaming client ${client.id}:`, error);
    this.clients.delete(client.id);
  }

  private sendToClient(client: StreamClient, data: any): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify(data);
      
      if (this.config.compression) {
        // Would implement compression here
        client.ws.send(message);
      } else {
        client.ws.send(message);
      }
    }
  }

  private sendError(client: StreamClient, error: string): void {
    this.sendToClient(client, {
      type: 'error',
      error,
      timestamp: Date.now(),
    });
  }

  private sendSnapshot(client: StreamClient): void {
    const snapshot = this.buildSnapshot();
    const filteredSnapshot = this.filterSnapshot(snapshot, client.subscriptions);
    
    this.sendToClient(client, {
      type: 'snapshot',
      data: filteredSnapshot,
      timestamp: Date.now(),
    });
  }

  private sendHistory(client: StreamClient, duration: number = 3600000): void {
    const cutoff = Date.now() - duration;
    const history = this.metricsBuffer.filter(m => m.timestamp >= cutoff);
    
    this.sendToClient(client, {
      type: 'history',
      data: history.map(h => this.filterSnapshot(h, client.subscriptions)),
      timestamp: Date.now(),
    });
  }

  private filterSnapshot(snapshot: MetricsSnapshot, subscriptions: Set<string>): Partial<MetricsSnapshot> {
    if (subscriptions.has('all')) {
      return snapshot;
    }

    const filtered: Partial<MetricsSnapshot> = {
      timestamp: snapshot.timestamp,
    };

    if (subscriptions.has('websocket') && snapshot.websocket) {
      filtered.websocket = snapshot.websocket;
    }
    if (subscriptions.has('orders') && snapshot.orders) {
      filtered.orders = snapshot.orders;
    }
    if (subscriptions.has('trades') && snapshot.trades) {
      filtered.trades = snapshot.trades;
    }
    if (subscriptions.has('system') && snapshot.system) {
      filtered.system = snapshot.system;
    }
    if (subscriptions.has('sla') && snapshot.sla) {
      filtered.sla = snapshot.sla;
    }

    return filtered;
  }

  private startAggregation(): void {
    this.aggregationInterval = setInterval(() => {
      const snapshot = this.buildSnapshot();
      
      // Add to buffer
      this.metricsBuffer.push(snapshot);
      
      // Trim buffer to window size
      if (this.metricsBuffer.length > this.config.aggregation.windowSize) {
        this.metricsBuffer.shift();
      }
      
      // Broadcast to all connected clients
      this.broadcast(snapshot);
      
    }, this.config.aggregation.interval);
  }

  private buildSnapshot(): MetricsSnapshot {
    const snapshot: MetricsSnapshot = {
      timestamp: Date.now(),
    };

    if (this.config.metrics.websocket) {
      snapshot.websocket = {
        activeConnections: this.currentMetrics.websocket?.activeConnections || 0,
        messageRate: this.currentMetrics.websocket?.messageRate || 0,
        errorRate: this.currentMetrics.websocket?.errorRate || 0,
        latency: this.currentMetrics.websocket?.latency || { p50: 0, p95: 0, p99: 0 },
      };
    }

    if (this.config.metrics.orders) {
      snapshot.orders = {
        rate: this.currentMetrics.orders?.rate || 0,
        processingTime: this.currentMetrics.orders?.processingTime || 0,
        rejectionRate: this.currentMetrics.orders?.rejectionRate || 0,
        queueDepth: this.currentMetrics.orders?.queueDepth || 0,
      };
    }

    if (this.config.metrics.trades) {
      snapshot.trades = {
        rate: this.currentMetrics.trades?.rate || 0,
        volume: this.currentMetrics.trades?.volume || 0,
        executionTime: this.currentMetrics.trades?.executionTime || 0,
      };
    }

    if (this.config.metrics.system) {
      const memUsage = process.memoryUsage();
      snapshot.system = {
        cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
        memoryUsage: memUsage.heapUsed / 1024 / 1024, // Convert to MB
        eventLoopLag: this.currentMetrics.system?.eventLoopLag || 0,
      };
    }

    if (this.config.metrics.sla) {
      snapshot.sla = {
        compliance: 100, // Would calculate from SLA monitor
        activeViolations: this.slaMonitor.getActiveViolations(),
      };
    }

    return snapshot;
  }

  private broadcast(snapshot: MetricsSnapshot): void {
    const message = {
      type: 'update',
      data: snapshot,
      timestamp: Date.now(),
    };

    for (const [clientId, client] of this.clients) {
      if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        const filtered = this.filterSnapshot(snapshot, client.subscriptions);
        this.sendToClient(client, {
          ...message,
          data: filtered,
        });
      }
    }
  }

  private subscribeToEvents(): void {
    // Subscribe to metrics updates
    this.metricsExporter.on('metrics-updated', (metrics) => {
      // Update current metrics cache
      this.updateCurrentMetrics(metrics);
    });

    // Subscribe to SLA violations
    this.slaMonitor.on('violation', (violation) => {
      this.broadcastEvent('sla_violation', violation);
    });

    this.slaMonitor.on('violation-resolved', (violation) => {
      this.broadcastEvent('sla_violation_resolved', violation);
    });
  }

  private updateCurrentMetrics(metrics: any): void {
    // Update cached metrics from various sources
    // This would be implemented based on actual metric sources
  }

  private broadcastEvent(eventType: string, data: any): void {
    const message = {
      type: 'event',
      eventType,
      data,
      timestamp: Date.now(),
    };

    for (const [clientId, client] of this.clients) {
      if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(client, message);
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatInterval * 3; // 3 missed heartbeats

      for (const [clientId, client] of this.clients) {
        if (now - client.lastHeartbeat > timeout) {
          console.log(`💔 Client ${clientId} timed out`);
          client.ws.terminate();
          this.clients.delete(clientId);
        } else if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        }
      }
    }, this.config.heartbeatInterval);
  }

  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  stop(): void {
    // Clear intervals
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all client connections
    for (const [clientId, client] of this.clients) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }

    this.emit('stopped');
  }

  getStats(): {
    connectedClients: number;
    totalConnections: number;
    messagesPerSecond: number;
    bufferSize: number;
  } {
    return {
      connectedClients: this.clients.size,
      totalConnections: this.clients.size, // Would track historical total
      messagesPerSecond: 0, // Would calculate from actual message rate
      bufferSize: this.metricsBuffer.length,
    };
  }
}