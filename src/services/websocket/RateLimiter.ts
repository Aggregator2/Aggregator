import { EventEmitter } from 'events';

export interface RateLimitConfig {
  maxSubscriptionsPerConnection: number;
  maxConnectionsPerApiKey: number;
  messageThrottling: {
    windowMs: number;
    maxMessages: number;
    highFrequencyChannels: string[];
    throttleDelay: number;
  };
  connectionLimits: {
    globalMaxConnections: number;
    perIpMaxConnections: number;
    burstAllowance: number;
  };
}

export interface ConnectionInfo {
  socketId: string;
  apiKey: string;
  ip: string;
  connectedAt: number;
  subscriptionCount: number;
  messageCount: number;
  messageWindowStart: number;
  throttledChannels: Set<string>;
}

export class RateLimiter extends EventEmitter {
  private config: RateLimitConfig;
  private connections: Map<string, ConnectionInfo> = new Map();
  private apiKeyConnections: Map<string, Set<string>> = new Map();
  private ipConnections: Map<string, Set<string>> = new Map();
  private messageQueues: Map<string, any[]> = new Map();
  private throttleTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<RateLimitConfig> = {}) {
    super();
    
    this.config = {
      maxSubscriptionsPerConnection: 10,
      maxConnectionsPerApiKey: 5,
      messageThrottling: {
        windowMs: 60000, // 1 minute
        maxMessages: 1000,
        highFrequencyChannels: ['orderbook', 'trades', 'tickers'],
        throttleDelay: 100, // 100ms minimum between high-frequency updates
        ...config.messageThrottling
      },
      connectionLimits: {
        globalMaxConnections: 10000,
        perIpMaxConnections: 10,
        burstAllowance: 2,
        ...config.connectionLimits
      },
      ...config
    };
  }

  // Check if new connection is allowed
  canConnect(apiKey: string, ip: string): { allowed: boolean; reason?: string } {
    // Check global limit
    if (this.connections.size >= this.config.connectionLimits.globalMaxConnections) {
      return { allowed: false, reason: 'Global connection limit reached' };
    }

    // Check API key limit
    const apiKeyConns = this.apiKeyConnections.get(apiKey)?.size || 0;
    if (apiKeyConns >= this.config.maxConnectionsPerApiKey) {
      return { allowed: false, reason: 'API key connection limit reached' };
    }

    // Check IP limit
    const ipConns = this.ipConnections.get(ip)?.size || 0;
    if (ipConns >= this.config.connectionLimits.perIpMaxConnections) {
      return { allowed: false, reason: 'IP connection limit reached' };
    }

    return { allowed: true };
  }

  // Register new connection
  registerConnection(socketId: string, apiKey: string, ip: string): void {
    const info: ConnectionInfo = {
      socketId,
      apiKey,
      ip,
      connectedAt: Date.now(),
      subscriptionCount: 0,
      messageCount: 0,
      messageWindowStart: Date.now(),
      throttledChannels: new Set()
    };

    this.connections.set(socketId, info);

    // Track by API key
    if (!this.apiKeyConnections.has(apiKey)) {
      this.apiKeyConnections.set(apiKey, new Set());
    }
    this.apiKeyConnections.get(apiKey)!.add(socketId);

    // Track by IP
    if (!this.ipConnections.has(ip)) {
      this.ipConnections.set(ip, new Set());
    }
    this.ipConnections.get(ip)!.add(socketId);

    this.emit('connectionRegistered', { socketId, apiKey, ip });
  }

  // Remove connection
  removeConnection(socketId: string): void {
    const info = this.connections.get(socketId);
    if (!info) return;

    // Clean up connection tracking
    this.connections.delete(socketId);
    
    // Remove from API key tracking
    const apiKeySet = this.apiKeyConnections.get(info.apiKey);
    if (apiKeySet) {
      apiKeySet.delete(socketId);
      if (apiKeySet.size === 0) {
        this.apiKeyConnections.delete(info.apiKey);
      }
    }

    // Remove from IP tracking
    const ipSet = this.ipConnections.get(info.ip);
    if (ipSet) {
      ipSet.delete(socketId);
      if (ipSet.size === 0) {
        this.ipConnections.delete(info.ip);
      }
    }

    // Clean up message queues
    this.messageQueues.delete(socketId);
    
    // Clear throttle timers
    const timerId = `${socketId}:*`;
    for (const [key, timer] of this.throttleTimers) {
      if (key.startsWith(socketId)) {
        clearTimeout(timer);
        this.throttleTimers.delete(key);
      }
    }

    this.emit('connectionRemoved', { socketId });
  }

  // Check if subscription is allowed
  canSubscribe(socketId: string): { allowed: boolean; reason?: string } {
    const info = this.connections.get(socketId);
    if (!info) {
      return { allowed: false, reason: 'Connection not found' };
    }

    if (info.subscriptionCount >= this.config.maxSubscriptionsPerConnection) {
      return { allowed: false, reason: 'Subscription limit reached' };
    }

    return { allowed: true };
  }

  // Increment subscription count
  addSubscription(socketId: string): void {
    const info = this.connections.get(socketId);
    if (info) {
      info.subscriptionCount++;
    }
  }

  // Decrement subscription count
  removeSubscription(socketId: string): void {
    const info = this.connections.get(socketId);
    if (info && info.subscriptionCount > 0) {
      info.subscriptionCount--;
    }
  }

  // Check message rate limit
  checkMessageRateLimit(socketId: string): { allowed: boolean; reason?: string } {
    const info = this.connections.get(socketId);
    if (!info) {
      return { allowed: false, reason: 'Connection not found' };
    }

    const now = Date.now();
    const { windowMs, maxMessages } = this.config.messageThrottling;

    // Reset window if expired
    if (now - info.messageWindowStart > windowMs) {
      info.messageCount = 0;
      info.messageWindowStart = now;
    }

    if (info.messageCount >= maxMessages) {
      return { allowed: false, reason: 'Message rate limit exceeded' };
    }

    info.messageCount++;
    return { allowed: true };
  }

  // Throttle high-frequency channel updates
  shouldThrottleMessage(
    socketId: string,
    channel: string,
    callback: (message: any) => void
  ): boolean {
    const { highFrequencyChannels, throttleDelay } = this.config.messageThrottling;
    
    // Check if channel needs throttling
    if (!highFrequencyChannels.includes(channel)) {
      return false;
    }

    const info = this.connections.get(socketId);
    if (!info) return true;

    const throttleKey = `${socketId}:${channel}`;
    
    // If already throttled for this channel, queue the message
    if (this.throttleTimers.has(throttleKey)) {
      if (!this.messageQueues.has(throttleKey)) {
        this.messageQueues.set(throttleKey, []);
      }
      // Only keep the latest message for each channel
      this.messageQueues.set(throttleKey, [callback]);
      return true;
    }

    // Set throttle timer
    this.throttleTimers.set(throttleKey, setTimeout(() => {
      this.throttleTimers.delete(throttleKey);
      
      // Process queued message if any
      const queue = this.messageQueues.get(throttleKey);
      if (queue && queue.length > 0) {
        const latestCallback = queue[queue.length - 1];
        this.messageQueues.delete(throttleKey);
        latestCallback(null); // Execute the callback
      }
    }, throttleDelay));

    return false;
  }

  // Get connection statistics
  getConnectionStats(apiKey?: string): any {
    if (apiKey) {
      const connections = this.apiKeyConnections.get(apiKey);
      if (!connections) {
        return { connectionCount: 0, connections: [] };
      }

      const connInfos = Array.from(connections).map(socketId => {
        const info = this.connections.get(socketId);
        return info ? {
          socketId,
          ip: info.ip,
          connectedAt: info.connectedAt,
          subscriptionCount: info.subscriptionCount,
          messageCount: info.messageCount,
          uptime: Date.now() - info.connectedAt
        } : null;
      }).filter(Boolean);

      return {
        connectionCount: connections.size,
        connections: connInfos
      };
    }

    // Global stats
    return {
      totalConnections: this.connections.size,
      totalApiKeys: this.apiKeyConnections.size,
      totalIps: this.ipConnections.size,
      connectionsByApiKey: Array.from(this.apiKeyConnections.entries()).map(([key, set]) => ({
        apiKey: key,
        count: set.size
      })),
      connectionsByIp: Array.from(this.ipConnections.entries()).map(([ip, set]) => ({
        ip,
        count: set.size
      }))
    };
  }

  // Get rate limit status for a connection
  getRateLimitStatus(socketId: string): any {
    const info = this.connections.get(socketId);
    if (!info) return null;

    const now = Date.now();
    const messageWindowRemaining = Math.max(0, 
      this.config.messageThrottling.windowMs - (now - info.messageWindowStart)
    );

    return {
      subscriptions: {
        current: info.subscriptionCount,
        limit: this.config.maxSubscriptionsPerConnection,
        remaining: this.config.maxSubscriptionsPerConnection - info.subscriptionCount
      },
      messages: {
        current: info.messageCount,
        limit: this.config.messageThrottling.maxMessages,
        remaining: this.config.messageThrottling.maxMessages - info.messageCount,
        windowResetIn: messageWindowRemaining
      },
      throttledChannels: Array.from(info.throttledChannels)
    };
  }

  // Clean up expired connections (optional housekeeping)
  cleanup(): void {
    const now = Date.now();
    const maxIdleTime = 3600000; // 1 hour

    for (const [socketId, info] of this.connections) {
      if (now - info.connectedAt > maxIdleTime && info.messageCount === 0) {
        this.removeConnection(socketId);
      }
    }
  }
}