import { db, TransactionClient } from '../config';
import { Order, OrderStatus, OrderSide, OrderType, TimeInForce } from '../../services/matchingEngine/types';
import { logger } from '../../utils/logger';

export class OrderRepository {
  async createOrder(order: Order, client?: TransactionClient): Promise<Order> {
    const query = `
      INSERT INTO orders (
        id, user_id, client_order_id, pair, side, type, price, quantity,
        filled_quantity, status, time_in_force, stop_price, timestamp,
        last_update_time, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      ) RETURNING *
    `;

    const params = [
      order.id,
      order.userId,
      order.clientOrderId || null,
      order.pair,
      order.side,
      order.type,
      order.price || null,
      order.quantity,
      order.filledQuantity,
      order.status,
      order.timeInForce,
      order.stopPrice || null,
      order.timestamp,
      order.lastUpdateTime,
      order.metadata ? JSON.stringify(order.metadata) : null,
    ];

    try {
      const executor = client || db;
      const result = await executor.queryOne(query, params);
      return result ? this.mapToOrder(result) : null as any;
    } catch (error) {
      logger.error('Error creating order', { order, error });
      throw error;
    }
  }

  async updateOrder(
    orderId: string,
    updates: Partial<Order>,
    client?: TransactionClient
  ): Promise<Order | null> {
    const allowedFields = [
      'filled_quantity',
      'status',
      'average_filled_price',
      'total_fees',
      'last_update_time',
      'metadata',
    ];

    const setClauses: string[] = [];
    const params: any[] = [orderId];
    let paramIndex = 2;

    // Build dynamic UPDATE query
    if (updates.filledQuantity !== undefined) {
      setClauses.push(`filled_quantity = $${paramIndex++}`);
      params.push(updates.filledQuantity);
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(updates.status);
    }
    if (updates.lastUpdateTime !== undefined) {
      setClauses.push(`last_update_time = $${paramIndex++}`);
      params.push(updates.lastUpdateTime);
    }
    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(updates.metadata));
    }

    // Calculate average filled price if needed
    if (updates.filledQuantity && updates.filledQuantity > 0) {
      setClauses.push(`average_filled_price = (
        SELECT SUM(t.price * t.quantity) / SUM(t.quantity)
        FROM trades t
        WHERE t.taker_order_id = $1 OR t.maker_order_id = $1
      )`);
    }

    if (setClauses.length === 0) {
      return await this.getOrderById(orderId);
    }

    const query = `
      UPDATE orders
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;

    try {
      const executor = client || db;
      const result = await executor.queryOne(query, params);
      return result ? this.mapToOrder(result) : null;
    } catch (error) {
      logger.error('Error updating order', { orderId, updates, error });
      throw error;
    }
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    const query = 'SELECT * FROM orders WHERE id = $1';
    
    try {
      const result = await db.queryOne<any>(query, [orderId]);
      return result ? this.mapToOrder(result) : null;
    } catch (error) {
      logger.error('Error fetching order', { orderId, error });
      throw error;
    }
  }

  async getOrdersByUser(
    userId: string,
    filters?: {
      pair?: string;
      status?: OrderStatus[];
      startTime?: number;
      endTime?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<Order[]> {
    let query = 'SELECT * FROM orders WHERE user_id = $1';
    const params: any[] = [userId];
    let paramIndex = 2;

    if (filters?.pair) {
      query += ` AND pair = $${paramIndex++}`;
      params.push(filters.pair);
    }

    if (filters?.status && filters.status.length > 0) {
      query += ` AND status = ANY($${paramIndex++})`;
      params.push(filters.status);
    }

    if (filters?.startTime) {
      query += ` AND timestamp >= $${paramIndex++}`;
      params.push(filters.startTime);
    }

    if (filters?.endTime) {
      query += ` AND timestamp <= $${paramIndex++}`;
      params.push(filters.endTime);
    }

    query += ' ORDER BY timestamp DESC';

    if (filters?.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    if (filters?.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    try {
      const results = await db.query<any>(query, params);
      return results.map(this.mapToOrder);
    } catch (error) {
      logger.error('Error fetching user orders', { userId, filters, error });
      throw error;
    }
  }

  async getActiveOrdersByPair(pair: string): Promise<Order[]> {
    const query = `
      SELECT * FROM orders
      WHERE pair = $1 
        AND status IN ('OPEN', 'PARTIALLY_FILLED')
        AND type = 'LIMIT'
      ORDER BY 
        CASE WHEN side = 'BUY' THEN price END DESC,
        CASE WHEN side = 'SELL' THEN price END ASC,
        timestamp ASC
    `;

    try {
      const results = await db.query<any>(query, [pair]);
      return results.map(this.mapToOrder);
    } catch (error) {
      logger.error('Error fetching active orders', { pair, error });
      throw error;
    }
  }

  async lockOrdersForMatching(
    orderIds: string[],
    client: TransactionClient
  ): Promise<Order[]> {
    if (orderIds.length === 0) return [];

    const query = `
      SELECT * FROM orders
      WHERE id = ANY($1)
      FOR UPDATE NOWAIT
    `;

    try {
      const results = await client.query(query, [orderIds]);
      return results.rows.map(this.mapToOrder);
    } catch (error) {
      if ((error as any).code === '55P03') { // Lock not available
        throw new Error('Orders are currently being processed');
      }
      throw error;
    }
  }

  async cancelExpiredOrders(): Promise<number> {
    const query = `
      UPDATE orders
      SET status = 'EXPIRED', last_update_time = $1
      WHERE status IN ('OPEN', 'PARTIALLY_FILLED')
        AND expire_time IS NOT NULL
        AND expire_time < $1
      RETURNING id
    `;

    try {
      const currentTime = Date.now();
      const results = await db.query<{ id: string }>(query, [currentTime]);
      
      if (results.length > 0) {
        logger.info(`Expired ${results.length} orders`);
      }
      
      return results.length;
    } catch (error) {
      logger.error('Error cancelling expired orders', error);
      throw error;
    }
  }

  async getOrderBookSnapshot(pair: string, depth: number = 20): Promise<{
    bids: Array<{ price: number; quantity: number; orderCount: number }>;
    asks: Array<{ price: number; quantity: number; orderCount: number }>;
  }> {
    const query = `SELECT * FROM get_order_book_depth($1, $2)`;

    try {
      const results = await db.query<{
        side: OrderSide;
        price: string;
        quantity: string;
        order_count: number;
      }>(query, [pair, depth]);

      const bids = results
        .filter(r => r.side === OrderSide.BUY)
        .map(r => ({
          price: parseFloat(r.price),
          quantity: parseFloat(r.quantity),
          orderCount: r.order_count,
        }));

      const asks = results
        .filter(r => r.side === OrderSide.SELL)
        .map(r => ({
          price: parseFloat(r.price),
          quantity: parseFloat(r.quantity),
          orderCount: r.order_count,
        }));

      return { bids, asks };
    } catch (error) {
      logger.error('Error fetching order book snapshot', { pair, error });
      throw error;
    }
  }

  private mapToOrder(row: any): Order {
    return {
      id: row.id,
      userId: row.user_id,
      clientOrderId: row.client_order_id,
      pair: row.pair,
      side: row.side as OrderSide,
      type: row.type as OrderType,
      price: row.price ? parseFloat(row.price) : 0,
      quantity: parseFloat(row.quantity),
      filledQuantity: parseFloat(row.filled_quantity),
      status: row.status as OrderStatus,
      timeInForce: row.time_in_force as TimeInForce,
      timestamp: parseInt(row.timestamp),
      lastUpdateTime: parseInt(row.last_update_time),
      stopPrice: row.stop_price ? parseFloat(row.stop_price) : undefined,
      metadata: row.metadata,
    };
  }
}