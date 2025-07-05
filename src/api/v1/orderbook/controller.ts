import { Request, Response } from 'express';
import { OrderBook, Ticker } from '../types';
import { OrderBookService } from './service';

export class OrderBookController {
  private orderBookService: OrderBookService;

  constructor() {
    this.orderBookService = new OrderBookService();
  }

  /**
   * Get orderbook for a trading pair
   */
  getOrderBook = async (req: Request, res: Response): Promise<void> => {
    const { pair } = req.params;
    const { depth, aggregation } = req.query;

    const orderBook = await this.orderBookService.getOrderBook(
      pair,
      Number(depth) || 20,
      aggregation ? Number(aggregation) : undefined
    );

    res.json({
      success: true,
      data: orderBook
    });
  };

  /**
   * Get orderbook depth (aggregated)
   */
  getOrderBookDepth = async (req: Request, res: Response): Promise<void> => {
    const { pair } = req.params;
    const { depth, aggregation } = req.query;

    const depthData = await this.orderBookService.getOrderBookDepth(
      pair,
      Number(depth) || 20,
      Number(aggregation) || 0.01
    );

    res.json({
      success: true,
      data: depthData
    });
  };

  /**
   * Get current bid-ask spread
   */
  getSpread = async (req: Request, res: Response): Promise<void> => {
    const { pair } = req.params;

    const spread = await this.orderBookService.getSpread(pair);

    res.json({
      success: true,
      data: spread
    });
  };

  /**
   * Get liquidity information
   */
  getLiquidity = async (req: Request, res: Response): Promise<void> => {
    const { pair } = req.params;
    const userId = req.user?.id;

    const liquidity = await this.orderBookService.getLiquidity(pair, userId);

    res.json({
      success: true,
      data: liquidity
    });
  };

  /**
   * Get all tickers
   */
  getAllTickers = async (req: Request, res: Response): Promise<void> => {
    const tickers = await this.orderBookService.getAllTickers();

    res.json({
      success: true,
      data: tickers
    });
  };

  /**
   * Get ticker for specific pair
   */
  getTicker = async (req: Request, res: Response): Promise<void> => {
    const { pair } = req.params;

    const ticker = await this.orderBookService.getTicker(pair);

    res.json({
      success: true,
      data: ticker
    });
  };
}