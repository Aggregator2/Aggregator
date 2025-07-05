import { db, TransactionClient } from '../config';
import { Trade, OrderSide } from '../../services/matchingEngine/types';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class TradeRepository {
  async createTrade(trade: Trade, client?: TransactionClient): Promise<Trade> {
    const query = `
      INSERT INTO trades (
        trade_id, pair, taker_order_id, maker_order_id, price, quantity,
        taker_side, taker_user_id, maker_user_id, taker_fee, maker_fee,
        taker_fee_currency, maker_fee_currency, settlement_status, timestamp, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) RETURNING *
    `;

    // Extract user IDs from orders (would need to be passed or fetched)
    const takerUserId = (trade as any).takerUserId || 'unknown';
    const makerUserId = (trade as any).makerUserId || 'unknown';

    const params = [
      trade.id,
      trade.pair,
      trade.takerOrderId,
      trade.makerOrderId,
      trade.price,
      trade.quantity,
      trade.takerSide,
      takerUserId,
      makerUserId,
      trade.takerFee,
      trade.makerFee,
      this.getFeeCurrency(trade.pair, trade.takerSide, 'taker'),
      this.getFeeCurrency(trade.pair, trade.takerSide, 'maker'),
      trade.settlementStatus || 'pending',
      trade.timestamp,
      JSON.stringify((trade as any).metadata || {}),
    ];

    try {
      const executor = client || db;
      const result = await executor.queryOne<any>(query, params);
      return this.mapToTrade(result);
    } catch (error) {
      logger.error('Error creating trade', { trade, error });
      throw error;
    }
  }

  async getTradeById(tradeId: string): Promise<Trade | null> {
    const query = 'SELECT * FROM trades WHERE trade_id = $1';
    
    try {
      const result = await db.queryOne<any>(query, [tradeId]);
      return result ? this.mapToTrade(result) : null;
    } catch (error) {
      logger.error('Error fetching trade', { tradeId, error });
      throw error;
    }
  }

  async getTradesByUser(
    userId: string,
    filters?: {
      pair?: string;
      startTime?: number;
      endTime?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<Trade[]> {
    let query = `
      SELECT * FROM trades 
      WHERE (taker_user_id = $1 OR maker_user_id = $1)
    `;
    const params: any[] = [userId];
    let paramIndex = 2;

    if (filters?.pair) {
      query += ` AND pair = $${paramIndex++}`;
      params.push(filters.pair);
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
      return results.map(this.mapToTrade);
    } catch (error) {
      logger.error('Error fetching user trades', { userId, filters, error });
      throw error;
    }
  }

  async getTradesByOrderId(orderId: string): Promise<Trade[]> {
    const query = `
      SELECT * FROM trades 
      WHERE taker_order_id = $1 OR maker_order_id = $1
      ORDER BY timestamp ASC
    `;

    try {
      const results = await db.query<any>(query, [orderId]);
      return results.map(this.mapToTrade);
    } catch (error) {
      logger.error('Error fetching trades by order', { orderId, error });
      throw error;
    }
  }

  async getUnsettledTrades(limit: number = 1000): Promise<Trade[]> {
    const query = `
      SELECT * FROM trades
      WHERE settlement_status = 'pending'
      ORDER BY timestamp ASC
      LIMIT $1
    `;

    try {
      const results = await db.query<any>(query, [limit]);
      return results.map(this.mapToTrade);
    } catch (error) {
      logger.error('Error fetching unsettled trades', error);
      throw error;
    }
  }

  async updateTradeSettlementStatus(
    tradeId: string,
    status: 'pending' | 'settled' | 'failed',
    epochId?: string,
    client?: TransactionClient
  ): Promise<boolean> {
    const query = `
      UPDATE trades
      SET 
        settlement_status = $2,
        settlement_epoch_id = $3,
        settled_at = CASE WHEN $2 = 'settled' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE trade_id = $1
    `;

    try {
      const executor = client || db;
      const result = await executor.query(query, [tradeId, status, epochId]);
      return result.rowCount > 0;
    } catch (error) {
      logger.error('Error updating trade settlement status', { tradeId, status, error });
      throw error;
    }
  }

  async getMarketStats(
    pair: string,
    hours: number = 24
  ): Promise<{
    volume24h: number;
    high24h: number;
    low24h: number;
    tradeCount24h: number;
    lastPrice: number;
  }> {
    const query = `SELECT * FROM get_market_stats_24h($1)`;

    try {
      const result = await db.queryOne<{
        volume_24h: string;
        high_24h: string;
        low_24h: string;
        trade_count_24h: number;
        last_price: string;
      }>(query, [pair]);

      if (!result) {
        return {
          volume24h: 0,
          high24h: 0,
          low24h: 0,
          tradeCount24h: 0,
          lastPrice: 0,
        };
      }

      return {
        volume24h: parseFloat(result.volume_24h),
        high24h: parseFloat(result.high_24h),
        low24h: parseFloat(result.low_24h),
        tradeCount24h: result.trade_count_24h,
        lastPrice: parseFloat(result.last_price),
      };
    } catch (error) {
      logger.error('Error fetching market stats', { pair, error });
      throw error;
    }
  }

  async getRecentTrades(pair: string, limit: number = 50): Promise<Trade[]> {
    const query = `
      SELECT * FROM trades
      WHERE pair = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `;

    try {
      const results = await db.query<any>(query, [pair, limit]);
      return results.map(this.mapToTrade);
    } catch (error) {
      logger.error('Error fetching recent trades', { pair, error });
      throw error;
    }
  }

  async createBulkTrades(trades: Trade[], client: TransactionClient): Promise<void> {
    if (trades.length === 0) return;

    const values = trades.map((trade, index) => {
      const base = index * 16;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, 
               $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, 
               $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16})`;
    }).join(', ');

    const query = `
      INSERT INTO trades (
        trade_id, pair, taker_order_id, maker_order_id, price, quantity,
        taker_side, taker_user_id, maker_user_id, taker_fee, maker_fee,
        taker_fee_currency, maker_fee_currency, settlement_status, timestamp, metadata
      ) VALUES ${values}
    `;

    const params = trades.flatMap(trade => [
      trade.id,
      trade.pair,
      trade.takerOrderId,
      trade.makerOrderId,
      trade.price,
      trade.quantity,
      trade.takerSide,
      (trade as any).takerUserId || 'unknown',
      (trade as any).makerUserId || 'unknown',
      trade.takerFee,
      trade.makerFee,
      this.getFeeCurrency(trade.pair, trade.takerSide, 'taker'),
      this.getFeeCurrency(trade.pair, trade.takerSide, 'maker'),
      trade.settlementStatus || 'pending',
      trade.timestamp,
      JSON.stringify((trade as any).metadata || {}),
    ]);

    try {
      await client.query(query, params);
    } catch (error) {
      logger.error('Error creating bulk trades', { tradeCount: trades.length, error });
      throw error;
    }
  }

  private getFeeCurrency(pair: string, side: OrderSide, feeType: 'taker' | 'maker'): string {
    // In a real system, this would be configurable
    const [base, quote] = pair.split('/');
    
    // Takers pay in the currency they receive
    // Makers pay in the currency they provide
    if (feeType === 'taker') {
      return side === OrderSide.BUY ? base : quote;
    } else {
      return side === OrderSide.BUY ? quote : base;
    }
  }

  private mapToTrade(row: any): Trade {
    return {
      id: row.trade_id,
      pair: row.pair,
      takerOrderId: row.taker_order_id,
      makerOrderId: row.maker_order_id,
      price: parseFloat(row.price),
      quantity: parseFloat(row.quantity),
      takerSide: row.taker_side as OrderSide,
      timestamp: parseInt(row.timestamp),
      takerFee: parseFloat(row.taker_fee),
      makerFee: parseFloat(row.maker_fee),
      settlementStatus: row.settlement_status,
    };
  }
}