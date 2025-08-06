import { Cluster, Redis } from 'ioredis';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { RedisClusterConfig } from './RedisClusterConfig';

export interface ConnectionPoolOptions {
  minConnections?: number;
  maxConnections?: number;
  connectionTimeout?: number;
  idleTimeout?: number;
  healthCheckInterval?: number;
}

export class RedisConnectionPool extends EventEmitter {
  private connections: Array<Redis | Cluster> = [];
  private availableConnections: Array<Redis | Cluster> = [];
  private activeConnections: Map<string, Redis | Cluster> = new Map();
  private isCluster: boolean;
  private options: Required<ConnectionPoolOptions>;
  private healthCheckTimer?: NodeJS.Timeout;
  private connectionIndex = 0;

  constructor(options?: ConnectionPoolOptions) {
    super();
    
    this.isCluster = RedisClusterConfig.isClusterMode();
    this.options = {
      minConnections: options?.minConnections || 5,
      maxConnections: options?.maxConnections || 20,
      connectionTimeout: options?.connectionTimeout || 5000,
      idleTimeout: options?.idleTimeout || 30000,
      healthCheckInterval: options?.healthCheckInterval || 10000,
    };
    
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Create minimum connections
      for (let i = 0; i < this.options.minConnections; i++) {
        const conn = await this.createConnection();
        this.connections.push(conn);
        this.availableConnections.push(conn);
      }
      
      // Start health check
      this.startHealthCheck();
      
      logger.info(`Redis connection pool initialized with ${this.connections.length} connections`);
    } catch (error) {
      logger.error('Failed to initialize Redis connection pool', error);
      throw error;
    }
  }

  private async createConnection(): Promise<Redis | Cluster> {
    let conn: Redis | Cluster;
    
    if (this.isCluster) {
      conn = new Cluster(RedisClusterConfig.getClusterOptions());
    } else {
      conn = new Redis(RedisClusterConfig.getStandaloneConfig());
    }
    
    // Set up event handlers
    conn.on('error', (error) => {
      logger.error('Redis connection error', error);
      this.handleConnectionError(conn);
    });
    
    conn.on('close', () => {
      logger.warn('Redis connection closed');
      this.handleConnectionClose(conn);
    });
    
    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.options.connectionTimeout);
      
      conn.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    return conn;
  }

  async getConnection(): Promise<Redis | Cluster> {
    // Try to get available connection
    if (this.availableConnections.length > 0) {
      const conn = this.availableConnections.pop()!;
      const connId = this.generateConnectionId();
      this.activeConnections.set(connId, conn);
      return conn;
    }
    
    // Create new connection if under limit
    if (this.connections.length < this.options.maxConnections) {
      const conn = await this.createConnection();
      this.connections.push(conn);
      const connId = this.generateConnectionId();
      this.activeConnections.set(connId, conn);
      return conn;
    }
    
    // Wait for available connection
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('No available connections'));
      }, this.options.connectionTimeout);
      
      const checkAvailable = setInterval(() => {
        if (this.availableConnections.length > 0) {
          clearInterval(checkAvailable);
          clearTimeout(timeout);
          const conn = this.availableConnections.pop()!;
          const connId = this.generateConnectionId();
          this.activeConnections.set(connId, conn);
          resolve(conn);
        }
      }, 100);
    });
  }

  releaseConnection(conn: Redis | Cluster): void {
    // Find and remove from active connections
    let foundKey: string | undefined;
    for (const [key, activeConn] of this.activeConnections) {
      if (activeConn === conn) {
        foundKey = key;
        break;
      }
    }
    
    if (foundKey) {
      this.activeConnections.delete(foundKey);
      this.availableConnections.push(conn);
    }
  }

  async withConnection<T>(
    operation: (conn: Redis | Cluster) => Promise<T>
  ): Promise<T> {
    const conn = await this.getConnection();
    try {
      return await operation(conn);
    } finally {
      this.releaseConnection(conn);
    }
  }

  private handleConnectionError(conn: Redis | Cluster): void {
    // Remove from all pools
    const index = this.connections.indexOf(conn);
    if (index > -1) {
      this.connections.splice(index, 1);
    }
    
    const availIndex = this.availableConnections.indexOf(conn);
    if (availIndex > -1) {
      this.availableConnections.splice(availIndex, 1);
    }
    
    // Remove from active if present
    for (const [key, activeConn] of this.activeConnections) {
      if (activeConn === conn) {
        this.activeConnections.delete(key);
        break;
      }
    }
    
    // Create replacement if below minimum
    if (this.connections.length < this.options.minConnections) {
      this.createConnection()
        .then((newConn) => {
          this.connections.push(newConn);
          this.availableConnections.push(newConn);
        })
        .catch((error) => {
          logger.error('Failed to create replacement connection', error);
        });
    }
  }

  private handleConnectionClose(conn: Redis | Cluster): void {
    this.handleConnectionError(conn);
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      for (const conn of this.connections) {
        try {
          await conn.ping();
        } catch (error) {
          logger.warn('Health check failed for connection', error);
          this.handleConnectionError(conn);
        }
      }
    }, this.options.healthCheckInterval);
  }

  private generateConnectionId(): string {
    return `conn-${Date.now()}-${this.connectionIndex++}`;
  }

  async getMetrics(): Promise<{
    totalConnections: number;
    availableConnections: number;
    activeConnections: number;
    isCluster: boolean;
  }> {
    return {
      totalConnections: this.connections.length,
      availableConnections: this.availableConnections.length,
      activeConnections: this.activeConnections.size,
      isCluster: this.isCluster,
    };
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    // Close all connections
    await Promise.all(
      this.connections.map((conn) => conn.quit())
    );
    
    this.connections = [];
    this.availableConnections = [];
    this.activeConnections.clear();
    
    logger.info('Redis connection pool shut down');
  }
}

// Singleton instance
let connectionPool: RedisConnectionPool | null = null;

export function getConnectionPool(options?: ConnectionPoolOptions): RedisConnectionPool {
  if (!connectionPool) {
    connectionPool = new RedisConnectionPool(options);
  }
  return connectionPool;
}