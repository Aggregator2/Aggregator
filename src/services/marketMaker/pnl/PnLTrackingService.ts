import { PrismaClient, MarketMakerTrade, FeeStructure } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EventEmitter } from 'events';
import { logger } from '../../../utils/logger';

export interface PnLSnapshot {
  marketMakerId: string;
  currency: string;
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ALL_TIME';
  startDate: Date;
  endDate: Date;
  tradingVolume: Decimal;
  grossProfit: Decimal;
  totalFees: Decimal;
  totalRebates: Decimal;
  netProfit: Decimal;
  realizedPnL: Decimal;
  unrealizedPnL: Decimal;
  avgSpread: Decimal;
  tradeCount: number;
  winRate: number;
}

export interface PositionSummary {
  marketMakerId: string;
  baseCurrency: string;
  quoteCurrency: string;
  position: Decimal;
  avgEntryPrice: Decimal;
  currentPrice: Decimal;
  unrealizedPnL: Decimal;
  realizedPnL: Decimal;
}

export interface TradeSummary {
  tradeId: string;
  timestamp: Date;
  side: 'BUY' | 'SELL';
  price: Decimal;
  size: Decimal;
  fee: Decimal;
  rebate: Decimal;
  profit: Decimal;
  cumProfit: Decimal;
}

export class PnLTrackingService extends EventEmitter {
  private prisma: PrismaClient;
  private positionCache: Map<string, PositionSummary> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
  }

  async calculatePnL(
    marketMakerId: string,
    startDate: Date,
    endDate: Date,
    currency?: string
  ): Promise<PnLSnapshot[]> {
    try {
      // Fetch all trades in the period
      const trades = await this.prisma.MarketMakerTrade.findMany({
        where: {
          marketMakerId,
          executedAt: {
            gte: startDate,
            lte: endDate,
          },
          ...(currency && { baseCurrency: currency }),
        },
        orderBy: { executedAt: 'asc' },
      });

      // Group trades by currency pair
      const tradeByCurrency = new Map<string, MarketMakerTrade[]>();
      trades.forEach(trade => {
        const key = `${trade.baseCurrency}_${trade.quoteCurrency}`;
        if (!tradeByCurrency.has(key)) {
          tradeByCurrency.set(key, []);
        }
        tradeByCurrency.get(key)!.push(trade);
      });

      const snapshots: PnLSnapshot[] = [];

      // Calculate P&L for each currency pair
      for (const [currencyPair, pairTrades] of tradeByCurrency) {
        const [baseCurrency] = currencyPair.split('_');
        const snapshot = await this.calculatePairPnL(
          marketMakerId,
          baseCurrency,
          pairTrades,
          startDate,
          endDate
        );
        snapshots.push(snapshot);
      }

      return snapshots;
    } catch (error) {
      logger.error(`Error calculating P&L for ${marketMakerId}:`, error);
      throw error;
    }
  }

  private async calculatePairPnL(
    marketMakerId: string,
    currency: string,
    trades: MarketMakerTrade[],
    startDate: Date,
    endDate: Date
  ): Promise<PnLSnapshot> {
    let tradingVolume = new Decimal(0);
    let grossProfit = new Decimal(0);
    let totalFees = new Decimal(0);
    let totalRebates = new Decimal(0);
    let winCount = 0;

    const position = { size: new Decimal(0), avgPrice: new Decimal(0) };
    const spreads: Decimal[] = [];

    for (const trade of trades) {
      const tradeValue = trade.price.mul(trade.size);
      tradingVolume = tradingVolume.add(tradeValue);

      // Update position and calculate realized P&L
      const { realized, newPosition } = this.updatePosition(
        position,
        trade.side,
        trade.size,
        trade.price
      );

      grossProfit = grossProfit.add(realized);
      position.size = newPosition.size;
      position.avgPrice = newPosition.avgPrice;

      // Track fees and rebates
      if (trade.fee) {
        totalFees = totalFees.add(trade.fee);
      }
      if (trade.rebate) {
        totalRebates = totalRebates.add(trade.rebate);
      }

      // Track win rate
      if (realized.gt(0)) {
        winCount++;
      }

      // Calculate spread for market making metrics
      if (trade.bidPrice && trade.askPrice) {
        const spread = trade.askPrice.sub(trade.bidPrice).div(trade.midPrice);
        spreads.push(spread);
      }
    }

    // Calculate average spread
    const avgSpread = spreads.length > 0
      ? spreads.reduce((sum, s) => sum.add(s), new Decimal(0)).div(spreads.length)
      : new Decimal(0);

    // Calculate unrealized P&L (would need current market price)
    const unrealizedPnL = await this.calculateUnrealizedPnL(
      position,
      currency,
      trades[0]?.quoteCurrency || 'USDT'
    );

    const netProfit = grossProfit.sub(totalFees).add(totalRebates);
    const winRate = trades.length > 0 ? (winCount / trades.length) * 100 : 0;

    return {
      marketMakerId,
      currency,
      period: 'DAILY',
      startDate,
      endDate,
      tradingVolume,
      grossProfit,
      totalFees,
      totalRebates,
      netProfit,
      realizedPnL: grossProfit,
      unrealizedPnL,
      avgSpread,
      tradeCount: trades.length,
      winRate,
    };
  }

  private updatePosition(
    currentPosition: { size: Decimal; avgPrice: Decimal },
    side: string,
    tradeSize: Decimal,
    tradePrice: Decimal
  ): { realized: Decimal; newPosition: { size: Decimal; avgPrice: Decimal } } {
    let realized = new Decimal(0);
    let newSize = currentPosition.size;
    let newAvgPrice = currentPosition.avgPrice;

    if (side === 'BUY') {
      // Increasing position
      const totalValue = currentPosition.size.mul(currentPosition.avgPrice).add(
        tradeSize.mul(tradePrice)
      );
      newSize = currentPosition.size.add(tradeSize);
      newAvgPrice = newSize.gt(0) ? totalValue.div(newSize) : new Decimal(0);
    } else {
      // SELL - Reducing position or going short
      if (currentPosition.size.gt(0)) {
        // Closing long position
        const closingSize = Decimal.min(currentPosition.size, tradeSize);
        realized = closingSize.mul(tradePrice.sub(currentPosition.avgPrice));
        newSize = currentPosition.size.sub(closingSize);
        
        if (tradeSize.gt(closingSize)) {
          // Going short
          const shortSize = tradeSize.sub(closingSize);
          newSize = newSize.sub(shortSize);
          newAvgPrice = tradePrice;
        }
      } else {
        // Adding to short position
        const totalValue = currentPosition.size.abs().mul(currentPosition.avgPrice).add(
          tradeSize.mul(tradePrice)
        );
        newSize = currentPosition.size.sub(tradeSize);
        newAvgPrice = totalValue.div(newSize.abs());
      }
    }

    return {
      realized,
      newPosition: { size: newSize, avgPrice: newAvgPrice },
    };
  }

  private async calculateUnrealizedPnL(
    position: { size: Decimal; avgPrice: Decimal },
    baseCurrency: string,
    quoteCurrency: string
  ): Promise<Decimal> {
    if (position.size.eq(0)) {
      return new Decimal(0);
    }

    // In a real system, fetch current market price
    // For now, return 0 as placeholder
    return new Decimal(0);
  }

  async getPositionSummary(marketMakerId: string): Promise<PositionSummary[]> {
    // Get all open positions for the market maker
    const trades = await this.prisma.MarketMakerTrade.findMany({
      where: { marketMakerId },
      orderBy: { executedAt: 'asc' },
    });

    const positions = new Map<string, PositionSummary>();

    // Group by currency pair and calculate positions
    trades.forEach(trade => {
      const pairKey = `${trade.baseCurrency}_${trade.quoteCurrency}`;
      
      if (!positions.has(pairKey)) {
        positions.set(pairKey, {
          marketMakerId,
          baseCurrency: trade.baseCurrency,
          quoteCurrency: trade.quoteCurrency,
          position: new Decimal(0),
          avgEntryPrice: new Decimal(0),
          currentPrice: trade.price, // Would fetch real-time price
          unrealizedPnL: new Decimal(0),
          realizedPnL: new Decimal(0),
        });
      }

      const pos = positions.get(pairKey)!;
      const { realized, newPosition } = this.updatePosition(
        { size: pos.position, avgPrice: pos.avgEntryPrice },
        trade.side,
        trade.size,
        trade.price
      );

      pos.position = newPosition.size;
      pos.avgEntryPrice = newPosition.avgPrice;
      pos.realizedPnL = pos.realizedPnL.add(realized);
    });

    // Calculate unrealized P&L for each position
    for (const [, position] of positions) {
      if (!position.position.eq(0)) {
        position.unrealizedPnL = position.position.mul(
          position.currentPrice.sub(position.avgEntryPrice)
        );
      }
    }

    return Array.from(positions.values());
  }

  async getTradeHistory(
    marketMakerId: string,
    startDate: Date,
    endDate: Date,
    limit: number = 100
  ): Promise<TradeSummary[]> {
    const trades = await this.prisma.MarketMakerTrade.findMany({
      where: {
        marketMakerId,
        executedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { executedAt: 'desc' },
      take: limit,
    });

    let cumProfit = new Decimal(0);
    const summaries: TradeSummary[] = [];

    for (const trade of trades.reverse()) {
      const profit = trade.price.mul(trade.size).mul(trade.side === 'SELL' ? 1 : -1);
      const netProfit = profit.sub(trade.fee || 0).add(trade.rebate || 0);
      cumProfit = cumProfit.add(netProfit);

      summaries.push({
        tradeId: trade.id,
        timestamp: trade.executedAt,
        side: trade.side as 'BUY' | 'SELL',
        price: trade.price,
        size: trade.size,
        fee: trade.fee || new Decimal(0),
        rebate: trade.rebate || new Decimal(0),
        profit: netProfit,
        cumProfit,
      });
    }

    return summaries.reverse();
  }

  async generatePnLReport(
    marketMakerId: string,
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  ): Promise<{
    summary: PnLSnapshot[];
    positions: PositionSummary[];
    recentTrades: TradeSummary[];
  }> {
    const endDate = new Date();
    let startDate = new Date();

    switch (period) {
      case 'DAILY':
        startDate.setDate(endDate.getDate() - 1);
        break;
      case 'WEEKLY':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'MONTHLY':
        startDate.setMonth(endDate.getMonth() - 1);
        break;
    }

    const [summary, positions, recentTrades] = await Promise.all([
      this.calculatePnL(marketMakerId, startDate, endDate),
      this.getPositionSummary(marketMakerId),
      this.getTradeHistory(marketMakerId, startDate, endDate, 50),
    ]);

    return { summary, positions, recentTrades };
  }
}