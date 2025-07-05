import { RequestClient } from '../utils/request';
import { Trade, TradeFilter, PaginatedResponse, ApiResponse } from '../types';
import { ValidationError } from '../types/errors';

export class TradesAPI {
  constructor(private client: RequestClient) {}

  /**
   * Get recent trades for a pair
   */
  async getRecent(pair: string, limit = 50): Promise<Trade[]> {
    if (!pair) {
      throw new ValidationError('Trading pair is required');
    }

    if (limit < 1 || limit > 500) {
      throw new ValidationError('Limit must be between 1 and 500');
    }

    const response = await this.client.get<ApiResponse<Trade[]>>(
      `/trades/${pair}/recent`,
      { limit }
    );

    return response.data.map(trade => this.parseTrade(trade));
  }

  /**
   * Get trade history with filtering
   */
  async history(filter?: TradeFilter): Promise<PaginatedResponse<Trade>> {
    const response = await this.client.get<PaginatedResponse<Trade>>(
      '/trades/history',
      filter
    );

    return {
      ...response,
      data: response.data.map(trade => this.parseTrade(trade))
    };
  }

  /**
   * Get user's trade history
   */
  async getUserTrades(filter?: TradeFilter): Promise<PaginatedResponse<Trade>> {
    const response = await this.client.get<PaginatedResponse<Trade>>(
      '/trades/my',
      filter
    );

    return {
      ...response,
      data: response.data.map(trade => this.parseTrade(trade))
    };
  }

  /**
   * Get trade by ID
   */
  async get(tradeId: string): Promise<Trade> {
    if (!tradeId) {
      throw new ValidationError('Trade ID is required');
    }

    const response = await this.client.get<ApiResponse<Trade>>(`/trades/${tradeId}`);
    return this.parseTrade(response.data);
  }

  /**
   * Get aggregated trade statistics
   */
  async getStats(
    pair: string,
    interval: '1h' | '24h' | '7d' | '30d' = '24h'
  ): Promise<{
    pair: string;
    interval: string;
    volume: string;
    quoteVolume: string;
    trades: number;
    buyVolume: string;
    sellVolume: string;
    averagePrice: string;
    highPrice: string;
    lowPrice: string;
  }> {
    if (!pair) {
      throw new ValidationError('Trading pair is required');
    }

    const response = await this.client.get<ApiResponse<any>>(
      `/trades/${pair}/stats`,
      { interval }
    );

    return response.data;
  }

  /**
   * Get trade export (CSV)
   */
  async export(filter: TradeFilter & { format?: 'csv' | 'json' }): Promise<string | Trade[]> {
    const format = filter.format || 'json';
    
    if (format === 'csv') {
      const response = await this.client.get<string>(
        '/trades/export',
        { ...filter, format: 'csv' }
      );
      return response;
    }

    const response = await this.client.get<ApiResponse<Trade[]>>(
      '/trades/export',
      filter
    );
    
    return response.data.map(trade => this.parseTrade(trade));
  }

  /**
   * Calculate trading fees for a hypothetical trade
   */
  async calculateFees(
    pair: string,
    side: 'buy' | 'sell',
    quantity: string,
    price: string,
    orderType: 'market' | 'limit' = 'market'
  ): Promise<{
    quantity: string;
    price: string;
    subtotal: string;
    feeRate: string;
    feeAmount: string;
    total: string;
  }> {
    const response = await this.client.post<ApiResponse<any>>(
      '/trades/calculate-fees',
      { pair, side, quantity, price, orderType }
    );

    return response.data;
  }

  /**
   * Parse trade from API response
   */
  private parseTrade(trade: any): Trade {
    return {
      ...trade,
      timestamp: new Date(trade.timestamp)
    };
  }
}