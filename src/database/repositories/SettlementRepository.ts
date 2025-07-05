import { db, TransactionClient } from '../config';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface SettlementEpoch {
  id: string;
  epochNumber: number;
  startTime: Date;
  endTime: Date;
  status: 'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED' | 'ROLLED_BACK';
  totalTrades: number;
  settledTrades: number;
  failedTrades: number;
  totalVolume: number;
  netPositions: any;
  settlementProof?: string;
  errorMessage?: string;
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettlementDetail {
  id: string;
  settlementEpochId: string;
  tradeId: string;
  userId: string;
  currency: string;
  amount: number;
  balanceBefore?: number;
  balanceAfter?: number;
  status: 'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED' | 'ROLLED_BACK';
  errorMessage?: string;
  processedAt?: Date;
}

export class SettlementRepository {
  async createSettlementEpoch(
    epochNumber: number,
    startTime: Date,
    endTime: Date,
    client?: TransactionClient
  ): Promise<SettlementEpoch> {
    const query = `
      INSERT INTO settlement_epochs (
        epoch_number, start_time, end_time, status
      ) VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    try {
      const executor = client || db;
      const result = await executor.queryOne<any>(query, [
        epochNumber,
        startTime,
        endTime,
        'PENDING',
      ]);
      return this.mapToSettlementEpoch(result);
    } catch (error) {
      logger.error('Error creating settlement epoch', { epochNumber, error });
      throw error;
    }
  }

  async getSettlementEpochById(epochId: string): Promise<SettlementEpoch | null> {
    const query = 'SELECT * FROM settlement_epochs WHERE id = $1';
    
    try {
      const result = await db.queryOne<any>(query, [epochId]);
      return result ? this.mapToSettlementEpoch(result) : null;
    } catch (error) {
      logger.error('Error fetching settlement epoch', { epochId, error });
      throw error;
    }
  }

  async getLatestEpoch(): Promise<SettlementEpoch | null> {
    const query = `
      SELECT * FROM settlement_epochs
      ORDER BY epoch_number DESC
      LIMIT 1
    `;
    
    try {
      const result = await db.queryOne<any>(query);
      return result ? this.mapToSettlementEpoch(result) : null;
    } catch (error) {
      logger.error('Error fetching latest epoch', error);
      throw error;
    }
  }

  async updateEpochStatus(
    epochId: string,
    status: string,
    updates?: {
      totalTrades?: number;
      settledTrades?: number;
      failedTrades?: number;
      totalVolume?: number;
      netPositions?: any;
      settlementProof?: string;
      errorMessage?: string;
      processingStartedAt?: Date;
      processingCompletedAt?: Date;
    },
    client?: TransactionClient
  ): Promise<SettlementEpoch | null> {
    const setClauses: string[] = ['status = $2'];
    const params: any[] = [epochId, status];
    let paramIndex = 3;

    if (updates) {
      if (updates.totalTrades !== undefined) {
        setClauses.push(`total_trades = $${paramIndex++}`);
        params.push(updates.totalTrades);
      }
      if (updates.settledTrades !== undefined) {
        setClauses.push(`settled_trades = $${paramIndex++}`);
        params.push(updates.settledTrades);
      }
      if (updates.failedTrades !== undefined) {
        setClauses.push(`failed_trades = $${paramIndex++}`);
        params.push(updates.failedTrades);
      }
      if (updates.totalVolume !== undefined) {
        setClauses.push(`total_volume = $${paramIndex++}`);
        params.push(updates.totalVolume);
      }
      if (updates.netPositions !== undefined) {
        setClauses.push(`net_positions = $${paramIndex++}`);
        params.push(JSON.stringify(updates.netPositions));
      }
      if (updates.settlementProof !== undefined) {
        setClauses.push(`settlement_proof = $${paramIndex++}`);
        params.push(updates.settlementProof);
      }
      if (updates.errorMessage !== undefined) {
        setClauses.push(`error_message = $${paramIndex++}`);
        params.push(updates.errorMessage);
      }
      if (updates.processingStartedAt !== undefined) {
        setClauses.push(`processing_started_at = $${paramIndex++}`);
        params.push(updates.processingStartedAt);
      }
      if (updates.processingCompletedAt !== undefined) {
        setClauses.push(`processing_completed_at = $${paramIndex++}`);
        params.push(updates.processingCompletedAt);
      }
    }

    const query = `
      UPDATE settlement_epochs
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    try {
      const executor = client || db;
      const result = await executor.queryOne<any>(query, params);
      return result ? this.mapToSettlementEpoch(result) : null;
    } catch (error) {
      logger.error('Error updating epoch status', { epochId, status, error });
      throw error;
    }
  }

  async getTradesForSettlement(
    startTime: Date,
    endTime: Date,
    limit: number = 10000
  ): Promise<Array<{
    id: string;
    pair: string;
    takerOrderId: string;
    makerOrderId: string;
    price: number;
    quantity: number;
    takerSide: string;
    takerUserId: string;
    makerUserId: string;
    takerFee: number;
    makerFee: number;
    timestamp: number;
  }>> {
    const query = `
      SELECT 
        id,
        trade_id,
        pair,
        taker_order_id,
        maker_order_id,
        price::numeric,
        quantity::numeric,
        taker_side,
        taker_user_id,
        maker_user_id,
        taker_fee::numeric,
        maker_fee::numeric,
        timestamp
      FROM trades
      WHERE settlement_status = 'pending'
        AND created_at >= $1
        AND created_at <= $2
      ORDER BY timestamp ASC
      LIMIT $3
    `;

    try {
      const results = await db.query<any>(query, [startTime, endTime, limit]);
      return results.map(r => ({
        id: r.id,
        pair: r.pair,
        takerOrderId: r.taker_order_id,
        makerOrderId: r.maker_order_id,
        price: parseFloat(r.price),
        quantity: parseFloat(r.quantity),
        takerSide: r.taker_side,
        takerUserId: r.taker_user_id,
        makerUserId: r.maker_user_id,
        takerFee: parseFloat(r.taker_fee),
        makerFee: parseFloat(r.maker_fee),
        timestamp: parseInt(r.timestamp),
      }));
    } catch (error) {
      logger.error('Error fetching trades for settlement', error);
      throw error;
    }
  }

  async createSettlementDetails(
    details: Array<{
      settlementEpochId: string;
      tradeId: string;
      userId: string;
      currency: string;
      amount: number;
    }>,
    client: TransactionClient
  ): Promise<void> {
    if (details.length === 0) return;

    const values = details.map((_, index) => {
      const base = index * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    }).join(', ');

    const query = `
      INSERT INTO settlement_details (
        settlement_epoch_id, trade_id, user_id, currency, amount
      ) VALUES ${values}
      ON CONFLICT (settlement_epoch_id, trade_id, user_id, currency) DO NOTHING
    `;

    const params = details.flatMap(d => [
      d.settlementEpochId,
      d.tradeId,
      d.userId,
      d.currency,
      d.amount,
    ]);

    try {
      await client.query(query, params);
    } catch (error) {
      logger.error('Error creating settlement details', { count: details.length, error });
      throw error;
    }
  }

  async updateSettlementDetail(
    epochId: string,
    tradeId: string,
    userId: string,
    currency: string,
    updates: {
      balanceBefore?: number;
      balanceAfter?: number;
      status?: string;
      errorMessage?: string;
      processedAt?: Date;
    },
    client?: TransactionClient
  ): Promise<boolean> {
    const setClauses: string[] = [];
    const params: any[] = [epochId, tradeId, userId, currency];
    let paramIndex = 5;

    if (updates.balanceBefore !== undefined) {
      setClauses.push(`balance_before = $${paramIndex++}`);
      params.push(updates.balanceBefore);
    }
    if (updates.balanceAfter !== undefined) {
      setClauses.push(`balance_after = $${paramIndex++}`);
      params.push(updates.balanceAfter);
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(updates.status);
    }
    if (updates.errorMessage !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`);
      params.push(updates.errorMessage);
    }
    if (updates.processedAt !== undefined) {
      setClauses.push(`processed_at = $${paramIndex++}`);
      params.push(updates.processedAt);
    }

    if (setClauses.length === 0) return false;

    const query = `
      UPDATE settlement_details
      SET ${setClauses.join(', ')}
      WHERE settlement_epoch_id = $1 
        AND trade_id = $2 
        AND user_id = $3 
        AND currency = $4
    `;

    try {
      const executor = client || db;
      const result = await executor.query(query, params);
      return result.rowCount > 0;
    } catch (error) {
      logger.error('Error updating settlement detail', { epochId, tradeId, userId, currency, error });
      throw error;
    }
  }

  async getSettlementDetails(
    epochId: string,
    status?: string
  ): Promise<SettlementDetail[]> {
    let query = `
      SELECT * FROM settlement_details
      WHERE settlement_epoch_id = $1
    `;
    const params: any[] = [epochId];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY user_id, currency';

    try {
      const results = await db.query<any>(query, params);
      return results.map(this.mapToSettlementDetail);
    } catch (error) {
      logger.error('Error fetching settlement details', { epochId, status, error });
      throw error;
    }
  }

  async markTradesAsSettled(
    tradeIds: string[],
    epochId: string,
    client: TransactionClient
  ): Promise<number> {
    if (tradeIds.length === 0) return 0;

    const query = `
      UPDATE trades
      SET 
        settlement_status = 'settled',
        settlement_epoch_id = $2,
        settled_at = CURRENT_TIMESTAMP
      WHERE id = ANY($1)
    `;

    try {
      const result = await client.query(query, [tradeIds, epochId]);
      return result.rowCount;
    } catch (error) {
      logger.error('Error marking trades as settled', { count: tradeIds.length, error });
      throw error;
    }
  }

  async getEpochStats(epochId: string): Promise<{
    totalUsers: number;
    totalCurrencies: number;
    totalPositiveBalances: number;
    totalNegativeBalances: number;
    largestPosition: { userId: string; currency: string; amount: number };
  } | null> {
    const query = `
      WITH epoch_stats AS (
        SELECT 
          COUNT(DISTINCT user_id) as total_users,
          COUNT(DISTINCT currency) as total_currencies,
          COUNT(CASE WHEN amount > 0 THEN 1 END) as positive_balances,
          COUNT(CASE WHEN amount < 0 THEN 1 END) as negative_balances
        FROM settlement_details
        WHERE settlement_epoch_id = $1
      ),
      largest AS (
        SELECT user_id, currency, amount
        FROM settlement_details
        WHERE settlement_epoch_id = $1
        ORDER BY ABS(amount) DESC
        LIMIT 1
      )
      SELECT 
        es.*,
        l.user_id as largest_user,
        l.currency as largest_currency,
        l.amount::numeric as largest_amount
      FROM epoch_stats es
      CROSS JOIN largest l
    `;

    try {
      const result = await db.queryOne<any>(query, [epochId]);
      if (!result) return null;

      return {
        totalUsers: result.total_users,
        totalCurrencies: result.total_currencies,
        totalPositiveBalances: result.positive_balances,
        totalNegativeBalances: result.negative_balances,
        largestPosition: {
          userId: result.largest_user,
          currency: result.largest_currency,
          amount: parseFloat(result.largest_amount),
        },
      };
    } catch (error) {
      logger.error('Error fetching epoch stats', { epochId, error });
      throw error;
    }
  }

  async getRecentEpochs(limit: number = 10): Promise<SettlementEpoch[]> {
    const query = `
      SELECT * FROM settlement_epochs
      ORDER BY epoch_number DESC
      LIMIT $1
    `;

    try {
      const results = await db.query<any>(query, [limit]);
      return results.map(this.mapToSettlementEpoch);
    } catch (error) {
      logger.error('Error fetching recent epochs', error);
      throw error;
    }
  }

  private mapToSettlementEpoch(row: any): SettlementEpoch {
    return {
      id: row.id,
      epochNumber: row.epoch_number,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      totalTrades: row.total_trades || 0,
      settledTrades: row.settled_trades || 0,
      failedTrades: row.failed_trades || 0,
      totalVolume: row.total_volume ? parseFloat(row.total_volume) : 0,
      netPositions: row.net_positions,
      settlementProof: row.settlement_proof,
      errorMessage: row.error_message,
      processingStartedAt: row.processing_started_at,
      processingCompletedAt: row.processing_completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapToSettlementDetail(row: any): SettlementDetail {
    return {
      id: row.id,
      settlementEpochId: row.settlement_epoch_id,
      tradeId: row.trade_id,
      userId: row.user_id,
      currency: row.currency,
      amount: parseFloat(row.amount),
      balanceBefore: row.balance_before ? parseFloat(row.balance_before) : undefined,
      balanceAfter: row.balance_after ? parseFloat(row.balance_after) : undefined,
      status: row.status,
      errorMessage: row.error_message,
      processedAt: row.processed_at,
    };
  }
}