import { Pool, PoolClient } from 'pg';
import { EventEmitter } from 'events';
import { Order, Trade, ExecutionReport } from '../matchingEngine/types';
import { OrderBookDatabaseConfig } from './config';

export class PostgresOrderHistoryStore extends EventEmitter {
  private pool: Pool;
  private config: OrderBookDatabaseConfig;

  constructor(config: OrderBookDatabaseConfig) {
    super();
    this.config = config;
    
    // Create PostgreSQL connection pool
    this.pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
      ssl: config.postgres.ssl,
      max: config.postgres.poolSize,
      idleTimeoutMillis: config.postgres.idleTimeoutMillis,
      connectionTimeoutMillis: config.postgres.connectionTimeoutMillis,
      statement_timeout: config.postgres.statement_timeout
    });

    this.setupPoolEvents();
  }

  private setupPoolEvents(): void {
    this.pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err);
      this.emit('error', err);
    });

    this.pool.on('connect', () => {
      console.log('Connected to PostgreSQL');
      this.emit('connected');
    });
  }

  // Initialize database schema
  async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Create orders table
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          pair VARCHAR(50) NOT NULL,
          side VARCHAR(10) NOT NULL,
          type VARCHAR(10) NOT NULL,
          price DECIMAL(20, 8) NOT NULL,
          quantity DECIMAL(20, 8) NOT NULL,
          filled_quantity DECIMAL(20, 8) NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL,
          time_in_force VARCHAR(10) NOT NULL,
          client_order_id VARCHAR(255),
          stop_price DECIMAL(20, 8),
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE
        )
      `);

      // Create trades table
      await client.query(`
        CREATE TABLE IF NOT EXISTS trades (
          id VARCHAR(255) PRIMARY KEY,
          pair VARCHAR(50) NOT NULL,
          taker_order_id VARCHAR(255) NOT NULL,
          maker_order_id VARCHAR(255) NOT NULL,
          price DECIMAL(20, 8) NOT NULL,
          quantity DECIMAL(20, 8) NOT NULL,
          taker_side VARCHAR(10) NOT NULL,
          taker_fee DECIMAL(20, 8) NOT NULL,
          maker_fee DECIMAL(20, 8) NOT NULL,
          settlement_status VARCHAR(20) DEFAULT 'pending',
          executed_at TIMESTAMP WITH TIME ZONE NOT NULL,
          settled_at TIMESTAMP WITH TIME ZONE
        )
      `);

      // Create execution reports table
      await client.query(`
        CREATE TABLE IF NOT EXISTS execution_reports (
          id VARCHAR(255) PRIMARY KEY,
          order_id VARCHAR(255) NOT NULL,
          client_order_id VARCHAR(255),
          status VARCHAR(20) NOT NULL,
          side VARCHAR(10) NOT NULL,
          pair VARCHAR(50) NOT NULL,
          price DECIMAL(20, 8) NOT NULL,
          quantity DECIMAL(20, 8) NOT NULL,
          filled_quantity DECIMAL(20, 8) NOT NULL,
          remaining_quantity DECIMAL(20, 8) NOT NULL,
          average_price DECIMAL(20, 8) NOT NULL,
          message TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL
        )
      `);

      // Create market data table
      await client.query(`
        CREATE TABLE IF NOT EXISTS market_data (
          pair VARCHAR(50) NOT NULL,
          last_price DECIMAL(20, 8),
          bid_price DECIMAL(20, 8),
          ask_price DECIMAL(20, 8),
          bid_quantity DECIMAL(20, 8),
          ask_quantity DECIMAL(20, 8),
          volume_24h DECIMAL(20, 8),
          high_24h DECIMAL(20, 8),
          low_24h DECIMAL(20, 8),
          open_price_24h DECIMAL(20, 8),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
          PRIMARY KEY (pair, updated_at)
        )
      `);

      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_pair ON orders(pair);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_pair_price ON orders(pair, side, price);
        
        CREATE INDEX IF NOT EXISTS idx_trades_pair ON trades(pair);
        CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_trades_taker_order ON trades(taker_order_id);
        CREATE INDEX IF NOT EXISTS idx_trades_maker_order ON trades(maker_order_id);
        
        CREATE INDEX IF NOT EXISTS idx_execution_reports_order_id ON execution_reports(order_id);
        CREATE INDEX IF NOT EXISTS idx_execution_reports_created_at ON execution_reports(created_at DESC);
        
        CREATE INDEX IF NOT EXISTS idx_market_data_pair_time ON market_data(pair, updated_at DESC);
      `);

      // Create partitions for time-series data (optional)
      await this.createPartitions(client);

      await client.query('COMMIT');
      console.log('Database schema initialized successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Create partitions for better performance with time-series data
  private async createPartitions(client: PoolClient): Promise<void> {
    // Example: Create monthly partitions for trades
    const currentDate = new Date();
    const partitionName = `trades_${currentDate.getFullYear()}_${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
    
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF trades
        FOR VALUES FROM ('${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-01')
        TO ('${currentDate.getFullYear()}-${(currentDate.getMonth() + 2).toString().padStart(2, '0')}-01')
      `);
    } catch (error) {
      // Partition might already exist
      console.log('Partition creation skipped:', error);
    }
  }

  // Save order to history
  async saveOrder(order: Order): Promise<void> {
    const query = `
      INSERT INTO orders (
        id, user_id, pair, side, type, price, quantity, filled_quantity,
        status, time_in_force, client_order_id, stop_price, metadata,
        created_at, updated_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        filled_quantity = EXCLUDED.filled_quantity,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    `;

    const expiresAt = this.calculateExpiration(order);
    
    await this.pool.query(query, [
      order.id,
      order.userId,
      order.pair,
      order.side,
      order.type,
      order.price,
      order.quantity,
      order.filledQuantity,
      order.status,
      order.timeInForce,
      order.clientOrderId || null,
      order.stopPrice || null,
      order.metadata || null,
      new Date(order.timestamp),
      new Date(order.lastUpdateTime),
      expiresAt
    ]);
  }

  // Save trade to history
  async saveTrade(trade: Trade): Promise<void> {
    const query = `
      INSERT INTO trades (
        id, pair, taker_order_id, maker_order_id, price, quantity,
        taker_side, taker_fee, maker_fee, settlement_status, executed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    await this.pool.query(query, [
      trade.id,
      trade.pair,
      trade.takerOrderId,
      trade.makerOrderId,
      trade.price,
      trade.quantity,
      trade.takerSide,
      trade.takerFee,
      trade.makerFee,
      trade.settlementStatus || 'pending',
      new Date(trade.timestamp)
    ]);
  }

  // Save execution report
  async saveExecutionReport(report: ExecutionReport): Promise<void> {
    const query = `
      INSERT INTO execution_reports (
        id, order_id, client_order_id, status, side, pair, price, quantity,
        filled_quantity, remaining_quantity, average_price, message, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    await this.pool.query(query, [
      report.executionId,
      report.orderId,
      report.clientOrderId || null,
      report.status,
      report.side,
      report.pair,
      report.price,
      report.quantity,
      report.filledQuantity,
      report.remainingQuantity,
      report.averagePrice,
      report.message || null,
      new Date(report.timestamp)
    ]);
  }

  // Batch save orders for better performance
  async saveOrdersBatch(orders: Order[]): Promise<void> {
    if (orders.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const query = `
        INSERT INTO orders (
          id, user_id, pair, side, type, price, quantity, filled_quantity,
          status, time_in_force, client_order_id, stop_price, metadata,
          created_at, updated_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          filled_quantity = EXCLUDED.filled_quantity,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `;

      for (const order of orders) {
        const expiresAt = this.calculateExpiration(order);
        await client.query(query, [
          order.id,
          order.userId,
          order.pair,
          order.side,
          order.type,
          order.price,
          order.quantity,
          order.filledQuantity,
          order.status,
          order.timeInForce,
          order.clientOrderId || null,
          order.stopPrice || null,
          order.metadata || null,
          new Date(order.timestamp),
          new Date(order.lastUpdateTime),
          expiresAt
        ]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get order history
  async getOrderHistory(
    userId?: string,
    pair?: string,
    status?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100,
    offset: number = 0
  ): Promise<Order[]> {
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (userId) {
      query += ` AND user_id = $${paramIndex++}`;
      params.push(userId);
    }

    if (pair) {
      query += ` AND pair = $${paramIndex++}`;
      params.push(pair);
    }

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    if (startDate) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await this.pool.query(query, params);
    
    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      pair: row.pair,
      side: row.side,
      type: row.type,
      price: parseFloat(row.price),
      quantity: parseFloat(row.quantity),
      filledQuantity: parseFloat(row.filled_quantity),
      status: row.status,
      timeInForce: row.time_in_force,
      timestamp: row.created_at.getTime(),
      lastUpdateTime: row.updated_at.getTime(),
      clientOrderId: row.client_order_id,
      stopPrice: row.stop_price ? parseFloat(row.stop_price) : undefined,
      metadata: row.metadata
    }));
  }

  // Get trade history
  async getTradeHistory(
    pair?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100,
    offset: number = 0
  ): Promise<Trade[]> {
    let query = 'SELECT * FROM trades WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (pair) {
      query += ` AND pair = $${paramIndex++}`;
      params.push(pair);
    }

    if (startDate) {
      query += ` AND executed_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND executed_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ` ORDER BY executed_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await this.pool.query(query, params);
    
    return result.rows.map(row => ({
      id: row.id,
      pair: row.pair,
      takerOrderId: row.taker_order_id,
      makerOrderId: row.maker_order_id,
      price: parseFloat(row.price),
      quantity: parseFloat(row.quantity),
      takerSide: row.taker_side,
      timestamp: row.executed_at.getTime(),
      takerFee: parseFloat(row.taker_fee),
      makerFee: parseFloat(row.maker_fee),
      settlementStatus: row.settlement_status
    }));
  }

  // Calculate order expiration
  private calculateExpiration(order: Order): Date | null {
    if (!this.config.orderExpiration.enabled) return null;

    const ttl = this.config.orderExpiration.customTTL?.[order.pair] || 
                this.config.orderExpiration.defaultTTL || 86400;
    
    return new Date(order.timestamp + ttl * 1000);
  }

  // Clean up expired orders
  async cleanupExpiredOrders(): Promise<number> {
    const query = `
      UPDATE orders 
      SET status = 'EXPIRED' 
      WHERE status IN ('OPEN', 'PARTIALLY_FILLED') 
        AND expires_at < NOW()
      RETURNING id
    `;

    const result = await this.pool.query(query);
    return result.rowCount;
  }

  // Get database statistics
  async getStatistics(): Promise<any> {
    const queries = {
      totalOrders: 'SELECT COUNT(*) as count FROM orders',
      totalTrades: 'SELECT COUNT(*) as count FROM trades',
      activeOrders: "SELECT COUNT(*) as count FROM orders WHERE status IN ('OPEN', 'PARTIALLY_FILLED')",
      volume24h: `
        SELECT SUM(quantity * price) as volume 
        FROM trades 
        WHERE executed_at > NOW() - INTERVAL '24 hours'
      `
    };

    const results: any = {};
    
    for (const [key, query] of Object.entries(queries)) {
      const result = await this.pool.query(query);
      results[key] = result.rows[0]?.count || result.rows[0]?.volume || 0;
    }

    return results;
  }

  // Close connection pool
  async close(): Promise<void> {
    await this.pool.end();
  }
}