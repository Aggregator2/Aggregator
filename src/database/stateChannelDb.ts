import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { readFileSync } from 'fs';
import { join } from 'path';

let db: Database | null = null;

export async function getStateChannelDatabase(): Promise<Database> {
  if (!db) {
    db = await open({
      filename: join(process.cwd(), 'state_channels.db'),
      driver: sqlite3.Database
    });

    // Initialize schema
    const schema = readFileSync(join(__dirname, 'stateChannelSchema.sql'), 'utf-8');
    await db.exec(schema);
  }
  return db;
}

export interface StateChannelRecord {
  channel_id: string;
  address: string;
  participants: string;
  token_address: string;
  challenge_period: number;
  status: string;
  created_at: string;
  total_trades: number;
  total_volume: string;
}

export interface ChannelTradeRecord {
  trade_id: string;
  channel_id: string;
  from_address: string;
  to_address: string;
  amount: string;
  status: string;
  timestamp: string;
  execution_time?: number;
}

export class StateChannelDatabase {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  // Channel operations
  async createChannel(channel: StateChannelRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO state_channels (
        channel_id, address, participants, token_address, 
        challenge_period, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        channel.channel_id,
        channel.address,
        channel.participants,
        channel.token_address,
        channel.challenge_period,
        channel.status,
        channel.created_at
      ]
    );
  }

  async getChannel(channelId: string): Promise<StateChannelRecord | undefined> {
    return await this.db.get(
      'SELECT * FROM state_channels WHERE channel_id = ?',
      [channelId]
    );
  }

  async updateChannelStatus(channelId: string, status: string): Promise<void> {
    await this.db.run(
      'UPDATE state_channels SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?',
      [status, channelId]
    );
  }

  async updateChannelMetrics(
    channelId: string, 
    trades: number, 
    volume: string
  ): Promise<void> {
    await this.db.run(
      `UPDATE state_channels 
       SET total_trades = total_trades + ?, 
           total_volume = ?, 
           last_activity = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE channel_id = ?`,
      [trades, volume, channelId]
    );
  }

  // Trade operations
  async recordTrade(trade: ChannelTradeRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO channel_trades (
        trade_id, channel_id, from_address, to_address, 
        amount, status, timestamp, execution_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trade.trade_id,
        trade.channel_id,
        trade.from_address,
        trade.to_address,
        trade.amount,
        trade.status,
        trade.timestamp,
        trade.execution_time
      ]
    );
  }

  async updateTradeStatus(tradeId: string, status: string): Promise<void> {
    await this.db.run(
      'UPDATE channel_trades SET status = ? WHERE trade_id = ?',
      [status, tradeId]
    );
  }

  async getChannelTrades(
    channelId: string, 
    limit: number = 100
  ): Promise<ChannelTradeRecord[]> {
    return await this.db.all(
      `SELECT * FROM channel_trades 
       WHERE channel_id = ? 
       ORDER BY timestamp DESC 
       LIMIT ?`,
      [channelId, limit]
    );
  }

  // State operations
  async saveChannelState(
    channelId: string,
    nonce: number,
    stateRoot: string,
    balances: Record<string, string>,
    signatures?: Record<string, string>
  ): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO channel_states (
        channel_id, nonce, state_root, balances, signatures
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        channelId,
        nonce,
        stateRoot,
        JSON.stringify(balances),
        signatures ? JSON.stringify(signatures) : null
      ]
    );
  }

  async getLatestState(channelId: string): Promise<any> {
    return await this.db.get(
      `SELECT * FROM channel_states 
       WHERE channel_id = ? 
       ORDER BY nonce DESC 
       LIMIT 1`,
      [channelId]
    );
  }

  // Settlement operations
  async recordSettlement(
    settlementId: string,
    channelId: string,
    type: string,
    nonce: number,
    stateRoot: string
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO channel_settlements (
        settlement_id, channel_id, settlement_type, 
        nonce, state_root, status
      ) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [settlementId, channelId, type, nonce, stateRoot]
    );
  }

  async updateSettlementStatus(
    settlementId: string,
    status: string,
    txHash?: string,
    error?: string
  ): Promise<void> {
    await this.db.run(
      `UPDATE channel_settlements 
       SET status = ?, settlement_tx_hash = ?, error_message = ?
       WHERE settlement_id = ?`,
      [status, txHash, error, settlementId]
    );
  }

  // Metrics operations
  async recordHFTMetrics(metrics: {
    channelId: string;
    totalTrades: number;
    avgLatency: number;
    p99Latency: number;
    throughput: number;
    volumeTraded: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO hft_metrics (
        channel_id, total_trades, avg_latency, p99_latency,
        throughput, volume_traded, period_start, period_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metrics.channelId,
        metrics.totalTrades,
        metrics.avgLatency,
        metrics.p99Latency,
        metrics.throughput,
        metrics.volumeTraded,
        metrics.periodStart,
        metrics.periodEnd
      ]
    );
  }

  async getHFTMetrics(
    channelId: string,
    startTime?: string,
    endTime?: string
  ): Promise<any[]> {
    let query = 'SELECT * FROM hft_metrics WHERE channel_id = ?';
    const params: any[] = [channelId];

    if (startTime) {
      query += ' AND timestamp >= ?';
      params.push(startTime);
    }
    if (endTime) {
      query += ' AND timestamp <= ?';
      params.push(endTime);
    }

    query += ' ORDER BY timestamp DESC';
    return await this.db.all(query, params);
  }

  // Analytics queries
  async getActiveChannelsCount(): Promise<number> {
    const result = await this.db.get(
      "SELECT COUNT(*) as count FROM state_channels WHERE status = 'active'"
    );
    return result?.count || 0;
  }

  async getTotalVolumeToday(): Promise<string> {
    const result = await this.db.get(
      `SELECT SUM(CAST(amount as REAL)) as volume 
       FROM channel_trades 
       WHERE timestamp > datetime('now', '-1 day')`
    );
    return result?.volume?.toString() || '0';
  }

  async getTopChannelsByVolume(limit: number = 10): Promise<any[]> {
    return await this.db.all(
      `SELECT channel_id, total_trades, total_volume 
       FROM state_channels 
       ORDER BY CAST(total_volume as REAL) DESC 
       LIMIT ?`,
      [limit]
    );
  }
}