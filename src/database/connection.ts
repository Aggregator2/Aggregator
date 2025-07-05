import { Pool, PoolConfig } from 'pg';
import { EventEmitter } from 'events';

// Database configuration
const poolConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trading_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: parseInt(process.env.DB_POOL_SIZE || '20'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Singleton database pool
let pool: Pool | null = null;

export class DatabaseConnection extends EventEmitter {
  private static instance: DatabaseConnection;
  private _pool: Pool;
  private isConnected: boolean = false;

  private constructor() {
    super();
    this._pool = new Pool(poolConfig);
    this.setupEventHandlers();
  }

  static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  private setupEventHandlers() {
    this._pool.on('error', (err, client) => {
      console.error('Unexpected error on idle client', err);
      this.emit('error', err);
    });

    this._pool.on('connect', (client) => {
      console.log('New client connected to database');
      this.emit('connect', client);
    });

    this._pool.on('acquire', (client) => {
      this.emit('acquire', client);
    });

    this._pool.on('remove', (client) => {
      this.emit('remove', client);
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      // Test the connection
      const client = await this._pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      this.isConnected = true;
      console.log('✅ Database connected successfully');
      this.emit('connected');
    } catch (error) {
      console.error('❌ Failed to connect to database:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this._pool.end();
      this.isConnected = false;
      console.log('Database disconnected');
      this.emit('disconnected');
    } catch (error) {
      console.error('Error disconnecting from database:', error);
      throw error;
    }
  }

  get pool(): Pool {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this._pool;
  }

  // Transaction helper
  async transaction<T>(callback: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Query helper with automatic client management
  async query(text: string, params?: any[]): Promise<any> {
    const start = Date.now();
    try {
      const result = await this._pool.query(text, params);
      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(`Slow query (${duration}ms):`, text);
      }
      return result;
    } catch (error) {
      console.error('Query error:', error);
      throw error;
    }
  }

  // Get pool statistics
  getStats() {
    return {
      totalCount: this._pool.totalCount,
      idleCount: this._pool.idleCount,
      waitingCount: this._pool.waitingCount,
    };
  }
}

// Export singleton instance
export const db = DatabaseConnection.getInstance();

// Helper functions for common operations
export async function getDb() {
  const instance = DatabaseConnection.getInstance();
  if (!instance['isConnected']) {
    await instance.connect();
  }
  return instance;
}