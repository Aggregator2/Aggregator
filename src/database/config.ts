import { Pool, PoolConfig } from 'pg';
import { logger } from '../utils/logger';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl?: boolean | { rejectUnauthorized: boolean };
}

// Default configuration
const defaultConfig: DatabaseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trading_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: parseInt(process.env.DB_POOL_SIZE || '20'),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000'),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

class DatabaseConnection {
  private pool: Pool | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig = defaultConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.pool) {
      logger.warn('Database pool already initialized');
      return;
    }

    try {
      const poolConfig: PoolConfig = {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        max: this.config.max,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis,
      };

      if (this.config.ssl) {
        poolConfig.ssl = this.config.ssl;
      }

      this.pool = new Pool(poolConfig);

      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      logger.info('Database connection established successfully', {
        host: this.config.host,
        database: this.config.database,
        poolSize: this.config.max,
      });

      // Setup error handlers
      this.pool.on('error', (err) => {
        logger.error('Unexpected database pool error', err);
      });

    } catch (error) {
      logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.pool) {
      logger.warn('No database pool to disconnect');
      return;
    }

    try {
      await this.pool.end();
      this.pool = null;
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection', error);
      throw error;
    }
  }

  getPool(): Pool {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.pool;
  }

  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const pool = this.getPool();
    try {
      const result = await pool.query(text, params);
      return result.rows;
    } catch (error) {
      logger.error('Database query error', { text, params, error });
      throw error;
    }
  }

  async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] || null;
  }

  async transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
    const pool = this.getPool();
    const client = await pool.connect();
    
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

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.query('SELECT 1 as health');
      return result.length > 0;
    } catch (error) {
      logger.error('Database health check failed', error);
      return false;
    }
  }

  // Get connection statistics
  async getStats(): Promise<{
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  }> {
    const pool = this.getPool();
    return {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
  }
}

// Singleton instance
export const db = new DatabaseConnection();

// Helper function to initialize database with retry logic
export async function initializeDatabase(maxRetries = 5, retryDelay = 5000): Promise<void> {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      await db.connect();
      
      // Run migrations if needed
      await runMigrations();
      
      return;
    } catch (error) {
      retries++;
      logger.error(`Database initialization failed (attempt ${retries}/${maxRetries})`, error);
      
      if (retries < maxRetries) {
        logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        throw new Error('Failed to initialize database after maximum retries');
      }
    }
  }
}

// Simple migration runner (in production, use a proper migration tool)
async function runMigrations(): Promise<void> {
  try {
    // Check if migrations table exists
    const tableExists = await db.queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'migrations'
      );
    `);

    if (!tableExists?.exists) {
      // Create migrations table
      await db.query(`
        CREATE TABLE migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      logger.info('Created migrations table');
    }

    // In a real application, you would read migration files and execute them
    logger.info('Database migrations completed');
  } catch (error) {
    logger.error('Migration error', error);
    throw error;
  }
}

// Export types for use in other modules
export type QueryResult<T> = T[];
export type QueryOneResult<T> = T | null;
export type TransactionClient = import('pg').PoolClient;