import { OrderBook, OrderBookLevel, Ticker, ErrorCode } from '../types';
import { NotFoundError } from '../middleware';

export class OrderBookService {
  /**
   * Get orderbook for a trading pair
   */
  async getOrderBook(
    pair: string,
    depth: number,
    aggregation?: number
  ): Promise<OrderBook> {
    // TODO: Implement actual orderbook fetching from matching engine
    
    // Placeholder implementation
    const orderBook: OrderBook = {
      pair,
      bids: this.generateMockLevels('bid', depth, 100, aggregation),
      asks: this.generateMockLevels('ask', depth, 100, aggregation),
      timestamp: new Date(),
      sequenceNumber: Date.now()
    };

    return orderBook;
  }

  /**
   * Get aggregated orderbook depth
   */
  async getOrderBookDepth(
    pair: string,
    depth: number,
    aggregation: number
  ): Promise<{
    pair: string;
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    aggregation: number;
    timestamp: Date;
  }> {
    const orderBook = await this.getOrderBook(pair, depth, aggregation);

    return {
      pair: orderBook.pair,
      bids: orderBook.bids,
      asks: orderBook.asks,
      aggregation,
      timestamp: orderBook.timestamp
    };
  }

  /**
   * Get current bid-ask spread
   */
  async getSpread(pair: string): Promise<{
    pair: string;
    bestBid: string;
    bestAsk: string;
    spread: string;
    spreadPercent: string;
    midPrice: string;
    timestamp: Date;
  }> {
    const orderBook = await this.getOrderBook(pair, 1);

    if (orderBook.bids.length === 0 || orderBook.asks.length === 0) {
      throw new NotFoundError('No liquidity available', ErrorCode.PAIR_NOT_FOUND);
    }

    const bestBid = parseFloat(orderBook.bids[0].price);
    const bestAsk = parseFloat(orderBook.asks[0].price);
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPercent = (spread / midPrice) * 100;

    return {
      pair,
      bestBid: bestBid.toString(),
      bestAsk: bestAsk.toString(),
      spread: spread.toString(),
      spreadPercent: spreadPercent.toFixed(4),
      midPrice: midPrice.toString(),
      timestamp: new Date()
    };
  }

  /**
   * Get liquidity information for a pair
   */
  async getLiquidity(
    pair: string,
    userId?: string
  ): Promise<{
    pair: string;
    totalBidLiquidity: string;
    totalAskLiquidity: string;
    depth10Percent: {
      bidLiquidity: string;
      askLiquidity: string;
    };
    userLiquidity?: {
      bidOrders: number;
      askOrders: number;
      totalBidAmount: string;
      totalAskAmount: string;
    };
  }> {
    const orderBook = await this.getOrderBook(pair, 100);
    
    // Calculate total liquidity
    const totalBidLiquidity = orderBook.bids
      .reduce((sum, level) => sum + parseFloat(level.total), 0);
    const totalAskLiquidity = orderBook.asks
      .reduce((sum, level) => sum + parseFloat(level.total), 0);

    // Calculate 10% depth liquidity
    const midPrice = await this.getSpread(pair).then(s => parseFloat(s.midPrice));
    const depth10PercentBids = orderBook.bids
      .filter(level => parseFloat(level.price) >= midPrice * 0.9)
      .reduce((sum, level) => sum + parseFloat(level.total), 0);
    const depth10PercentAsks = orderBook.asks
      .filter(level => parseFloat(level.price) <= midPrice * 1.1)
      .reduce((sum, level) => sum + parseFloat(level.total), 0);

    const result: any = {
      pair,
      totalBidLiquidity: totalBidLiquidity.toString(),
      totalAskLiquidity: totalAskLiquidity.toString(),
      depth10Percent: {
        bidLiquidity: depth10PercentBids.toString(),
        askLiquidity: depth10PercentAsks.toString()
      }
    };

    // Add user-specific liquidity if authenticated
    if (userId) {
      // TODO: Fetch user's orders in the orderbook
      result.userLiquidity = {
        bidOrders: 0,
        askOrders: 0,
        totalBidAmount: '0',
        totalAskAmount: '0'
      };
    }

    return result;
  }

  /**
   * Get all tickers
   */
  async getAllTickers(): Promise<Ticker[]> {
    // TODO: Implement actual ticker fetching
    const pairs = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT'];
    
    return Promise.all(pairs.map(pair => this.getTicker(pair)));
  }

  /**
   * Get ticker for specific pair
   */
  async getTicker(pair: string): Promise<Ticker> {
    // TODO: Implement actual ticker data fetching
    
    // Placeholder implementation
    const basePrice = 100;
    const change = (Math.random() - 0.5) * 10;
    
    return {
      pair,
      lastPrice: basePrice.toString(),
      bidPrice: (basePrice - 0.1).toString(),
      askPrice: (basePrice + 0.1).toString(),
      volume24h: '1000000',
      high24h: (basePrice + 5).toString(),
      low24h: (basePrice - 5).toString(),
      change24h: change.toString(),
      changePercent24h: ((change / basePrice) * 100).toFixed(2),
      timestamp: new Date()
    };
  }

  /**
   * Generate mock orderbook levels
   */
  private generateMockLevels(
    side: 'bid' | 'ask',
    depth: number,
    basePrice: number,
    aggregation?: number
  ): OrderBookLevel[] {
    const levels: OrderBookLevel[] = [];
    const priceStep = aggregation || 0.01;
    
    for (let i = 0; i < depth; i++) {
      const priceOffset = (i + 1) * priceStep;
      const price = side === 'bid' 
        ? basePrice - priceOffset 
        : basePrice + priceOffset;
      
      const amount = Math.random() * 10 + 1;
      const total = price * amount;
      
      levels.push({
        price: price.toFixed(2),
        amount: amount.toFixed(4),
        total: total.toFixed(2),
        orderCount: Math.floor(Math.random() * 5) + 1
      });
    }
    
    return levels;
  }
}