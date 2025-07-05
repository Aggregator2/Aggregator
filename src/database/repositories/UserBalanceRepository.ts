import { db, TransactionClient } from '../config';
import { logger } from '../../utils/logger';

export interface UserBalance {
  id: string;
  userId: string;
  currency: string;
  availableBalance: number;
  lockedBalance: number;
  totalBalance: number;
  lastUpdated: Date;
  version: number;
}

export class UserBalanceRepository {
  async getBalance(userId: string, currency: string): Promise<UserBalance | null> {
    const query = `
      SELECT 
        id,
        user_id,
        currency,
        available_balance::numeric as available_balance,
        locked_balance::numeric as locked_balance,
        total_balance::numeric as total_balance,
        last_updated,
        version
      FROM user_balances
      WHERE user_id = $1 AND currency = $2
    `;

    try {
      const result = await db.queryOne<any>(query, [userId, currency]);
      return result ? this.mapToUserBalance(result) : null;
    } catch (error) {
      logger.error('Error fetching balance', { userId, currency, error });
      throw error;
    }
  }

  async getUserBalances(userId: string): Promise<UserBalance[]> {
    const query = `
      SELECT 
        id,
        user_id,
        currency,
        available_balance::numeric as available_balance,
        locked_balance::numeric as locked_balance,
        total_balance::numeric as total_balance,
        last_updated,
        version
      FROM user_balances
      WHERE user_id = $1
      ORDER BY currency
    `;

    try {
      const results = await db.query<any>(query, [userId]);
      return results.map(this.mapToUserBalance);
    } catch (error) {
      logger.error('Error fetching user balances', { userId, error });
      throw error;
    }
  }

  async createBalance(
    userId: string,
    currency: string,
    initialBalance: number = 0,
    client?: TransactionClient
  ): Promise<UserBalance> {
    const query = `
      INSERT INTO user_balances (user_id, currency, available_balance, locked_balance)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, currency) DO UPDATE
      SET available_balance = user_balances.available_balance + EXCLUDED.available_balance
      RETURNING *
    `;

    try {
      const executor = client || db;
      const result = await executor.queryOne<any>(query, [
        userId,
        currency,
        initialBalance,
        0,
      ]);
      return this.mapToUserBalance(result);
    } catch (error) {
      logger.error('Error creating balance', { userId, currency, error });
      throw error;
    }
  }

  async updateBalance(
    userId: string,
    currency: string,
    availableDelta: number,
    lockedDelta: number,
    reason: string,
    client?: TransactionClient
  ): Promise<UserBalance> {
    // First get current balance and version
    const currentBalance = await this.getBalance(userId, currency);
    
    if (!currentBalance) {
      // Create new balance if doesn't exist
      if (availableDelta >= 0 && lockedDelta >= 0) {
        return await this.createBalance(userId, currency, availableDelta, client);
      } else {
        throw new Error(`Insufficient balance: no ${currency} balance found`);
      }
    }

    // Use the stored function for optimistic locking
    const query = `SELECT * FROM update_user_balance($1, $2, $3, $4, $5)`;

    try {
      const executor = client || db;
      const result = await executor.queryOne<any>(query, [
        userId,
        currency,
        availableDelta,
        lockedDelta,
        currentBalance.version,
      ]);

      if (!result) {
        throw new Error('Balance update failed: version mismatch or insufficient funds');
      }

      // Record balance history
      await this.recordBalanceHistory(
        userId,
        currency,
        currentBalance.availableBalance,
        result.available_balance,
        reason,
        client
      );

      return this.mapToUserBalance(result);
    } catch (error) {
      logger.error('Error updating balance', { 
        userId, 
        currency, 
        availableDelta, 
        lockedDelta, 
        error 
      });
      throw error;
    }
  }

  async lockBalance(
    userId: string,
    currency: string,
    amount: number,
    client?: TransactionClient
  ): Promise<UserBalance> {
    if (amount <= 0) {
      throw new Error('Lock amount must be positive');
    }

    return await this.updateBalance(
      userId,
      currency,
      -amount, // Reduce available
      amount,  // Increase locked
      'Order placement lock',
      client
    );
  }

  async unlockBalance(
    userId: string,
    currency: string,
    amount: number,
    client?: TransactionClient
  ): Promise<UserBalance> {
    if (amount <= 0) {
      throw new Error('Unlock amount must be positive');
    }

    return await this.updateBalance(
      userId,
      currency,
      amount,  // Increase available
      -amount, // Reduce locked
      'Order cancellation unlock',
      client
    );
  }

  async transferBalance(
    fromUserId: string,
    toUserId: string,
    currency: string,
    amount: number,
    reason: string,
    client?: TransactionClient
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Transfer amount must be positive');
    }

    const executor = client || db;

    // In a transaction if not already in one
    const doTransfer = async (txClient: TransactionClient) => {
      // Deduct from sender
      await this.updateBalance(
        fromUserId,
        currency,
        -amount,
        0,
        `Transfer to ${toUserId}: ${reason}`,
        txClient
      );

      // Add to receiver
      await this.updateBalance(
        toUserId,
        currency,
        amount,
        0,
        `Transfer from ${fromUserId}: ${reason}`,
        txClient
      );
    };

    if (client) {
      await doTransfer(client);
    } else {
      await db.transaction(doTransfer);
    }
  }

  async getTotalBalances(currencies: string[]): Promise<{
    currency: string;
    totalAvailable: number;
    totalLocked: number;
    total: number;
  }[]> {
    const query = `
      SELECT 
        currency,
        SUM(available_balance)::numeric as total_available,
        SUM(locked_balance)::numeric as total_locked,
        SUM(total_balance)::numeric as total
      FROM user_balances
      WHERE currency = ANY($1)
      GROUP BY currency
    `;

    try {
      const results = await db.query<any>(query, [currencies]);
      return results.map(r => ({
        currency: r.currency,
        totalAvailable: parseFloat(r.total_available),
        totalLocked: parseFloat(r.total_locked),
        total: parseFloat(r.total),
      }));
    } catch (error) {
      logger.error('Error fetching total balances', { currencies, error });
      throw error;
    }
  }

  private async recordBalanceHistory(
    userId: string,
    currency: string,
    balanceBefore: number,
    balanceAfter: number,
    description: string,
    client?: TransactionClient
  ): Promise<void> {
    const query = `
      INSERT INTO balance_history (
        user_id, currency, balance_before, balance_after,
        change_type, description
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `;

    const changeType = this.inferChangeType(description);

    try {
      const executor = client || db;
      await executor.query(query, [
        userId,
        currency,
        balanceBefore,
        balanceAfter,
        changeType,
        description,
      ]);
    } catch (error) {
      logger.error('Error recording balance history', { userId, currency, error });
      // Don't throw - this is not critical
    }
  }

  private inferChangeType(description: string): string {
    const desc = description.toLowerCase();
    if (desc.includes('deposit')) return 'DEPOSIT';
    if (desc.includes('withdrawal')) return 'WITHDRAWAL';
    if (desc.includes('trade')) return 'TRADE';
    if (desc.includes('fee')) return 'FEE';
    if (desc.includes('settlement')) return 'SETTLEMENT';
    if (desc.includes('transfer')) return 'TRANSFER';
    return 'OTHER';
  }

  async getBalanceHistory(
    userId: string,
    currency?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    id: string;
    currency: string;
    balanceBefore: number;
    balanceAfter: number;
    changeAmount: number;
    changeType: string;
    description: string;
    timestamp: Date;
  }[]> {
    let query = `
      SELECT 
        id,
        currency,
        balance_before::numeric,
        balance_after::numeric,
        change_amount::numeric,
        change_type,
        description,
        timestamp
      FROM balance_history
      WHERE user_id = $1
    `;
    const params: any[] = [userId];
    let paramIndex = 2;

    if (currency) {
      query += ` AND currency = $${paramIndex++}`;
      params.push(currency);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    try {
      const results = await db.query<any>(query, params);
      return results.map(r => ({
        id: r.id,
        currency: r.currency,
        balanceBefore: parseFloat(r.balance_before),
        balanceAfter: parseFloat(r.balance_after),
        changeAmount: parseFloat(r.change_amount),
        changeType: r.change_type,
        description: r.description,
        timestamp: r.timestamp,
      }));
    } catch (error) {
      logger.error('Error fetching balance history', { userId, currency, error });
      throw error;
    }
  }

  private mapToUserBalance(row: any): UserBalance {
    return {
      id: row.id,
      userId: row.user_id,
      currency: row.currency,
      availableBalance: parseFloat(row.available_balance),
      lockedBalance: parseFloat(row.locked_balance),
      totalBalance: parseFloat(row.total_balance),
      lastUpdated: row.last_updated,
      version: row.version,
    };
  }
}