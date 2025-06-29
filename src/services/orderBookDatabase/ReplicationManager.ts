import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { OrderBookDatabaseConfig } from './config';

interface ReplicaStatus {
  name: string;
  type: 'redis' | 'postgres';
  connected: boolean;
  lag: number; // milliseconds
  lastSync: Date | null;
  errors: number;
}

export class ReplicationManager extends EventEmitter {
  private config: OrderBookDatabaseConfig;
  private redisReplicas: Map<string, Redis> = new Map();
  private postgresReplicas: Map<string, Pool> = new Map();
  private replicaStatus: Map<string, ReplicaStatus> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private syncInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;

  constructor(config: OrderBookDatabaseConfig) {
    super();
    this.config = config;
  }

  // Initialize replication
  async initialize(): Promise<void> {
    if (!this.config.replication.enabled) return;

    try {
      // Initialize Redis replicas
      if (this.config.replication.replicas?.redis) {
        for (const replicaUrl of this.config.replication.replicas.redis) {
          await this.addRedisReplica(replicaUrl);
        }
      }

      // Initialize PostgreSQL replicas
      if (this.config.replication.replicas?.postgres) {
        for (const replicaUrl of this.config.replication.replicas.postgres) {
          await this.addPostgresReplica(replicaUrl);
        }
      }

      // Start health checks
      this.startHealthChecks();
      
      this.isRunning = true;
      this.emit('initialized');
    } catch (error) {
      this.emit('initialization:error', error);
      throw error;
    }
  }

  // Add Redis replica
  private async addRedisReplica(url: string): Promise<void> {
    const name = `redis-replica-${this.redisReplicas.size + 1}`;
    
    try {
      const replica = new Redis(url, {
        lazyConnect: false,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 100, 3000);
        }
      });

      // Set up event handlers
      replica.on('error', (err) => {
        console.error(`Redis replica ${name} error:`, err);
        this.updateReplicaStatus(name, { connected: false, errors: 1 });
      });

      replica.on('connect', () => {
        console.log(`Redis replica ${name} connected`);
        this.updateReplicaStatus(name, { connected: true });
      });

      replica.on('close', () => {
        this.updateReplicaStatus(name, { connected: false });
      });

      // Test connection
      await replica.ping();
      
      this.redisReplicas.set(name, replica);
      this.replicaStatus.set(name, {
        name,
        type: 'redis',
        connected: true,
        lag: 0,
        lastSync: new Date(),
        errors: 0
      });

      this.emit('replica:added', { name, type: 'redis' });
    } catch (error) {
      console.error(`Failed to add Redis replica ${name}:`, error);
      throw error;
    }
  }

  // Add PostgreSQL replica
  private async addPostgresReplica(connectionString: string): Promise<void> {
    const name = `postgres-replica-${this.postgresReplicas.size + 1}`;
    
    try {
      const pool = new Pool({
        connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      });

      // Test connection
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();

      pool.on('error', (err) => {
        console.error(`PostgreSQL replica ${name} error:`, err);
        this.updateReplicaStatus(name, { connected: false, errors: 1 });
      });

      this.postgresReplicas.set(name, pool);
      this.replicaStatus.set(name, {
        name,
        type: 'postgres',
        connected: true,
        lag: 0,
        lastSync: new Date(),
        errors: 0
      });

      this.emit('replica:added', { name, type: 'postgres' });
    } catch (error) {
      console.error(`Failed to add PostgreSQL replica ${name}:`, error);
      throw error;
    }
  }

  // Update replica status
  private updateReplicaStatus(name: string, updates: Partial<ReplicaStatus>): void {
    const status = this.replicaStatus.get(name);
    if (!status) return;

    if (updates.errors) {
      status.errors += updates.errors;
    }
    
    Object.assign(status, updates);
    this.emit('replica:status:updated', status);
  }

  // Start health checks
  private startHealthChecks(): void {
    if (!this.config.replication.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.config.replication.healthCheckInterval);
  }

  // Perform health checks
  private async performHealthChecks(): Promise<void> {
    // Check Redis replicas
    for (const [name, replica] of this.redisReplicas.entries()) {
      try {
        const start = Date.now();
        await replica.ping();
        const lag = Date.now() - start;
        
        this.updateReplicaStatus(name, {
          connected: true,
          lag,
          lastSync: new Date()
        });
      } catch (error) {
        this.updateReplicaStatus(name, {
          connected: false,
          errors: 1
        });
        
        // Attempt reconnection
        if (this.config.replication.failoverTimeout) {
          setTimeout(() => this.reconnectRedisReplica(name), this.config.replication.failoverTimeout);
        }
      }
    }

    // Check PostgreSQL replicas
    for (const [name, pool] of this.postgresReplicas.entries()) {
      try {
        const start = Date.now();
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        const lag = Date.now() - start;
        
        this.updateReplicaStatus(name, {
          connected: true,
          lag,
          lastSync: new Date()
        });
      } catch (error) {
        this.updateReplicaStatus(name, {
          connected: false,
          errors: 1
        });
      }
    }
  }

  // Reconnect Redis replica
  private async reconnectRedisReplica(name: string): Promise<void> {
    const replica = this.redisReplicas.get(name);
    if (!replica) return;

    try {
      await replica.connect();
      this.updateReplicaStatus(name, { connected: true });
    } catch (error) {
      console.error(`Failed to reconnect Redis replica ${name}:`, error);
    }
  }

  // Replicate Redis command
  async replicateRedisCommand(command: string, args: any[]): Promise<void> {
    if (!this.config.replication.enabled) return;

    const promises: Promise<any>[] = [];
    
    for (const [name, replica] of this.redisReplicas.entries()) {
      const status = this.replicaStatus.get(name);
      if (!status?.connected) continue;

      promises.push(
        replica.call(command, ...args).catch((error) => {
          console.error(`Redis replication to ${name} failed:`, error);
          this.updateReplicaStatus(name, { errors: 1 });
        })
      );
    }

    await Promise.allSettled(promises);
  }

  // Replicate PostgreSQL query
  async replicatePostgresQuery(query: string, params?: any[]): Promise<void> {
    if (!this.config.replication.enabled) return;

    const promises: Promise<any>[] = [];
    
    for (const [name, pool] of this.postgresReplicas.entries()) {
      const status = this.replicaStatus.get(name);
      if (!status?.connected) continue;

      promises.push(
        pool.query(query, params).catch((error) => {
          console.error(`PostgreSQL replication to ${name} failed:`, error);
          this.updateReplicaStatus(name, { errors: 1 });
        })
      );
    }

    await Promise.allSettled(promises);
  }

  // Get replica for read operations (load balancing)
  getReadReplica(type: 'redis' | 'postgres'): Redis | Pool | null {
    const replicas = type === 'redis' ? this.redisReplicas : this.postgresReplicas;
    const healthyReplicas: string[] = [];

    // Find healthy replicas
    for (const [name, _] of replicas.entries()) {
      const status = this.replicaStatus.get(name);
      if (status?.connected && status.lag < 1000) { // Less than 1 second lag
        healthyReplicas.push(name);
      }
    }

    if (healthyReplicas.length === 0) return null;

    // Simple round-robin selection
    const selected = healthyReplicas[Math.floor(Math.random() * healthyReplicas.length)];
    return type === 'redis' 
      ? this.redisReplicas.get(selected) || null
      : this.postgresReplicas.get(selected) || null;
  }

  // Promote replica to primary (manual failover)
  async promoteReplica(replicaName: string): Promise<void> {
    const status = this.replicaStatus.get(replicaName);
    if (!status) {
      throw new Error(`Replica ${replicaName} not found`);
    }

    if (!status.connected) {
      throw new Error(`Replica ${replicaName} is not connected`);
    }

    // This is a placeholder for actual promotion logic
    // In production, this would involve:
    // 1. Stopping writes to current primary
    // 2. Ensuring replica is fully synchronized
    // 3. Promoting replica to primary
    // 4. Updating application configuration
    // 5. Redirecting traffic to new primary

    this.emit('replica:promoted', {
      name: replicaName,
      type: status.type
    });
  }

  // Get replication status
  getStatus(): {
    enabled: boolean;
    replicas: ReplicaStatus[];
    healthyReplicas: number;
    totalReplicas: number;
  } {
    const replicas = Array.from(this.replicaStatus.values());
    const healthyReplicas = replicas.filter(r => r.connected).length;

    return {
      enabled: this.config.replication.enabled,
      replicas,
      healthyReplicas,
      totalReplicas: replicas.length
    };
  }

  // Check if replication is healthy
  isHealthy(): boolean {
    if (!this.config.replication.enabled) return true;

    const status = this.getStatus();
    // Consider healthy if at least 50% of replicas are connected
    return status.healthyReplicas >= status.totalReplicas * 0.5;
  }

  // Shutdown replication
  async shutdown(): Promise<void> {
    this.isRunning = false;

    // Stop intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Close Redis replicas
    for (const [name, replica] of this.redisReplicas.entries()) {
      try {
        await replica.quit();
      } catch (error) {
        console.error(`Error closing Redis replica ${name}:`, error);
      }
    }

    // Close PostgreSQL replicas
    for (const [name, pool] of this.postgresReplicas.entries()) {
      try {
        await pool.end();
      } catch (error) {
        console.error(`Error closing PostgreSQL replica ${name}:`, error);
      }
    }

    this.redisReplicas.clear();
    this.postgresReplicas.clear();
    this.replicaStatus.clear();

    this.emit('shutdown');
  }
}