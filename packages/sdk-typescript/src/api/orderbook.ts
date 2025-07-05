import { RequestClient } from '../utils/request';
import { OrderBook, OrderBookLevel, ApiResponse } from '../types';
import { ValidationError } from '../types/errors';

export class OrderBookAPI {
  constructor(private client: RequestClient) {}

  /**
   * Get order book for a trading pair
   */
  async get(pair: string, depth = 20): Promise<OrderBook> {
    if (!pair) {
      throw new ValidationError('Trading pair is required');
    }

    if (depth < 1 || depth > 100) {
      throw new ValidationError('Depth must be between 1 and 100');
    }

    const response = await this.client.get<ApiResponse<OrderBook>>(
      `/orderbook/${pair}`,
      { depth }
    );

    return this.parseOrderBook(response.data);
  }

  /**
   * Get aggregated order book with custom price levels
   */
  async getAggregated(
    pair: string,
    precision: number,
    depth = 20
  ): Promise<OrderBook> {
    if (!pair) {
      throw new ValidationError('Trading pair is required');
    }

    if (precision < 0 || precision > 8) {
      throw new ValidationError('Precision must be between 0 and 8');
    }

    const response = await this.client.get<ApiResponse<OrderBook>>(
      `/orderbook/${pair}/aggregated`,
      { precision, depth }
    );

    return this.parseOrderBook(response.data);
  }

  /**
   * Get best bid and ask prices
   */
  async getBestPrices(pair: string): Promise<{
    bid: OrderBookLevel | null;
    ask: OrderBookLevel | null;
    spread: string;
    spreadPercent: string;
  }> {
    if (!pair) {
      throw new ValidationError('Trading pair is required');
    }

    const orderbook = await this.get(pair, 1);
    
    const bid = orderbook.bids[0] || null;
    const ask = orderbook.asks[0] || null;

    let spread = '0';
    let spreadPercent = '0';

    if (bid && ask) {
      const bidPrice = parseFloat(bid.price);
      const askPrice = parseFloat(ask.price);
      spread = (askPrice - bidPrice).toFixed(8);
      spreadPercent = ((askPrice - bidPrice) / bidPrice * 100).toFixed(4);
    }

    return { bid, ask, spread, spreadPercent };
  }

  /**
   * Get market depth statistics
   */
  async getDepth(pair: string, depth = 50): Promise<{
    pair: string;
    bidVolume: string;
    askVolume: string;
    bidCount: number;
    askCount: number;
    imbalance: string;
  }> {
    const orderbook = await this.get(pair, depth);

    const bidVolume = orderbook.bids
      .reduce((sum, level) => sum + parseFloat(level.quantity), 0);
    
    const askVolume = orderbook.asks
      .reduce((sum, level) => sum + parseFloat(level.quantity), 0);

    const bidCount = orderbook.bids
      .reduce((sum, level) => sum + level.orderCount, 0);
    
    const askCount = orderbook.asks
      .reduce((sum, level) => sum + level.orderCount, 0);

    const totalVolume = bidVolume + askVolume;
    const imbalance = totalVolume > 0 
      ? ((bidVolume - askVolume) / totalVolume * 100).toFixed(2)
      : '0';

    return {
      pair,
      bidVolume: bidVolume.toFixed(8),
      askVolume: askVolume.toFixed(8),
      bidCount,
      askCount,
      imbalance
    };
  }

  /**
   * Calculate slippage for a market order
   */
  async calculateSlippage(
    pair: string,
    side: 'buy' | 'sell',
    quantity: string
  ): Promise<{
    averagePrice: string;
    worstPrice: string;
    slippage: string;
    slippagePercent: string;
    affectedLevels: number;
  }> {
    const orderbook = await this.get(pair, 100);
    const levels = side === 'buy' ? orderbook.asks : orderbook.bids;
    
    if (levels.length === 0) {
      throw new ValidationError('No liquidity available');
    }

    let remainingQty = parseFloat(quantity);
    let totalCost = 0;
    let affectedLevels = 0;
    let worstPrice = 0;

    for (const level of levels) {
      if (remainingQty <= 0) break;

      const levelQty = parseFloat(level.quantity);
      const levelPrice = parseFloat(level.price);
      const fillQty = Math.min(remainingQty, levelQty);

      totalCost += fillQty * levelPrice;
      remainingQty -= fillQty;
      worstPrice = levelPrice;
      affectedLevels++;
    }

    if (remainingQty > 0) {
      throw new ValidationError('Insufficient liquidity for order size');
    }

    const filledQty = parseFloat(quantity);
    const averagePrice = totalCost / filledQty;
    const bestPrice = parseFloat(levels[0].price);
    const slippage = Math.abs(worstPrice - bestPrice);
    const slippagePercent = (slippage / bestPrice * 100);

    return {
      averagePrice: averagePrice.toFixed(8),
      worstPrice: worstPrice.toFixed(8),
      slippage: slippage.toFixed(8),
      slippagePercent: slippagePercent.toFixed(4),
      affectedLevels
    };
  }

  /**
   * Parse order book from API response
   */
  private parseOrderBook(orderbook: any): OrderBook {
    return {
      ...orderbook,
      timestamp: new Date(orderbook.timestamp)
    };
  }
}