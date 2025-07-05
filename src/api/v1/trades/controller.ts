import { Request, Response } from 'express';
import { sendPaginatedResponse } from '../middleware';
import { Trade, Candle } from '../types';
import { TradeService } from './service';

export class TradeController {
  private tradeService: TradeService;

  constructor() {
    this.tradeService = new TradeService();
  }

  /**
   * Get user's trades
   */
  getUserTrades = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const filters = req.query;
    const pagination = req.pagination!;

    const { trades, total } = await this.tradeService.getUserTrades(
      userId,
      filters,
      pagination
    );

    sendPaginatedResponse(res, trades, total, pagination);
  };

  /**
   * Get all trades (admin)
   */
  getAllTrades = async (req: Request, res: Response): Promise<void> => {
    const filters = req.query;
    const pagination = req.pagination!;

    const { trades, total } = await this.tradeService.getAllTrades(
      filters,
      pagination
    );

    sendPaginatedResponse(res, trades, total, pagination);
  };

  /**
   * Get public trades for a pair
   */
  getPublicTrades = async (req: Request, res: Response): Promise<void> => {
    const { pair } = req.params;
    const pagination = req.pagination!;

    const { trades, total } = await this.tradeService.getPublicTrades(
      pair,
      pagination
    );

    sendPaginatedResponse(res, trades, total, pagination);
  };

  /**
   * Get trade by ID
   */
  getTradeById = async (req: Request, res: Response): Promise<void> => {
    const { tradeId } = req.params;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const trade = await this.tradeService.getTradeById(tradeId, userId, userRole);

    res.json({
      success: true,
      data: trade
    });
  };

  /**
   * Get daily trading statistics
   */
  getDailyStats = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { startDate, endDate } = req.query;

    const stats = await this.tradeService.getDailyStats(
      userId,
      startDate as string,
      endDate as string
    );

    res.json({
      success: true,
      data: stats
    });
  };

  /**
   * Get trading summary
   */
  getTradingSummary = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;

    const summary = await this.tradeService.getTradingSummary(userId);

    res.json({
      success: true,
      data: summary
    });
  };

  /**
   * Export trades as CSV
   */
  exportTrades = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const filters = req.query;

    const csv = await this.tradeService.exportTradesToCsv(userId, filters);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
    res.send(csv);
  };

  /**
   * Get OHLCV candle data
   */
  getCandles = async (req: Request, res: Response): Promise<void> => {
    const { pair } = req.params;
    const { interval, startTime, endTime, limit } = req.query;

    const candles = await this.tradeService.getCandles(
      pair,
      interval as string,
      startTime ? Number(startTime) : undefined,
      endTime ? Number(endTime) : undefined,
      Number(limit) || 100
    );

    res.json({
      success: true,
      data: candles
    });
  };
}