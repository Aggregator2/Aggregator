import { PrismaClient, Quote, MarketMaker } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EventEmitter } from 'events';
import { logger } from '../../../utils/logger';

export interface CompetitionMetrics {
  marketMakerId: string;
  marketMakerName: string;
  quotesSubmitted: number;
  quotesWon: number;
  winRate: number;
  averageSpread: Decimal;
  averageResponseTime: number;
  totalVolume: Decimal;
  improvementCount: number;
  averageImprovement: Decimal;
}

export interface CompetitionLeaderboard {
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ALL_TIME';
  startDate: Date;
  endDate: Date;
  rankings: CompetitionMetrics[];
}

export class QuoteCompetitionService extends EventEmitter {
  private prisma: PrismaClient;

  constructor() {
    super();
    this.prisma = new PrismaClient();
  }

  async getCompetitionMetrics(
    marketMakerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<CompetitionMetrics> {
    const marketMaker = await this.prisma.MarketMaker.findUnique({
      where: { id: marketMakerId },
    });

    if (!marketMaker) {
      throw new Error('Market maker not found');
    }

    // Get all quotes submitted in period
    const quotes = await this.prisma.Quote.findMany({
      where: {
        marketMakerId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        rfq: true,
      },
    });

    // Get winning quotes (accepted/filled)
    const winningQuotes = quotes.filter(
      q => q.status === 'FILLED' || q.status === 'PARTIALLY_FILLED'
    );

    // Calculate metrics
    const quotesSubmitted = quotes.length;
    const quotesWon = winningQuotes.length;
    const winRate = quotesSubmitted > 0 ? (quotesWon / quotesSubmitted) * 100 : 0;

    // Calculate average spread
    const spreads = quotes
      .filter(q => q.bidPrice && q.askPrice)
      .map(q => {
        const bid = new Decimal(q.bidPrice!.toString());
        const ask = new Decimal(q.askPrice!.toString());
        const mid = bid.add(ask).div(2);
        return ask.sub(bid).div(mid).mul(10000); // bps
      });

    const averageSpread = spreads.length > 0
      ? spreads.reduce((sum, s) => sum.add(s), new Decimal(0)).div(spreads.length)
      : new Decimal(0);

    // Calculate average response time
    const responseTimes = quotes.map(q => {
      const rfqTime = q.rfq.createdAt.getTime();
      const quoteTime = q.createdAt.getTime();
      return quoteTime - rfqTime;
    });

    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length
      : 0;

    // Calculate total volume
    const totalVolume = winningQuotes.reduce(
      (sum, q) => sum.add(q.filledSize),
      new Decimal(0)
    );

    // Count improvements (for auctions)
    const improvements = quotes.filter(
      q => q.metadata && (q.metadata as any).improvementBps > 0
    );

    const improvementCount = improvements.length;
    const averageImprovement = improvementCount > 0
      ? improvements
          .reduce((sum, q) => sum + (q.metadata as any).improvementBps, 0) / improvementCount
      : 0;

    return {
      marketMakerId,
      marketMakerName: marketMaker.name,
      quotesSubmitted,
      quotesWon,
      winRate,
      averageSpread,
      averageResponseTime,
      totalVolume,
      improvementCount,
      averageImprovement: new Decimal(averageImprovement),
    };
  }

  async getLeaderboard(
    period: CompetitionLeaderboard['period'] = 'DAILY'
  ): Promise<CompetitionLeaderboard> {
    const { startDate, endDate } = this.getPeriodDates(period);

    // Get all active market makers
    const marketMakers = await this.prisma.MarketMaker.findMany({
      where: {
        status: 'ACTIVE',
        isActive: true,
      },
    });

    // Calculate metrics for each market maker
    const metricsPromises = marketMakers.map(mm =>
      this.getCompetitionMetrics(mm.id, startDate, endDate)
    );

    const allMetrics = await Promise.all(metricsPromises);

    // Sort by win rate and volume
    const rankings = allMetrics.sort((a, b) => {
      // Primary sort by win rate
      if (a.winRate !== b.winRate) {
        return b.winRate - a.winRate;
      }
      // Secondary sort by volume
      return b.totalVolume.sub(a.totalVolume).toNumber();
    });

    return {
      period,
      startDate,
      endDate,
      rankings,
    };
  }

  async analyzeCompetition(
    baseCurrency: string,
    quoteCurrency: string,
    timeWindow: number = 3600000 // 1 hour
  ): Promise<{
    pair: string;
    competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    activeMarketMakers: number;
    averageQuotesPerRFQ: number;
    priceDispersion: Decimal;
    bestSpread: Decimal;
    worstSpread: Decimal;
  }> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - timeWindow);

    // Get RFQs for this pair in time window
    const rfqs = await this.prisma.RFQ.findMany({
      where: {
        baseCurrency,
        quoteCurrency,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        quotes: {
          include: {
            marketMaker: true,
          },
        },
      },
    });

    if (rfqs.length === 0) {
      return {
        pair: `${baseCurrency}/${quoteCurrency}`,
        competitionLevel: 'LOW',
        activeMarketMakers: 0,
        averageQuotesPerRFQ: 0,
        priceDispersion: new Decimal(0),
        bestSpread: new Decimal(0),
        worstSpread: new Decimal(0),
      };
    }

    // Count unique market makers
    const uniqueMarketMakers = new Set<string>();
    rfqs.forEach(rfq => {
      rfq.quotes.forEach(quote => {
        uniqueMarketMakers.add(quote.marketMakerId);
      });
    });

    const activeMarketMakers = uniqueMarketMakers.size;

    // Calculate average quotes per RFQ
    const totalQuotes = rfqs.reduce((sum, rfq) => sum + rfq.quotes.length, 0);
    const averageQuotesPerRFQ = totalQuotes / rfqs.length;

    // Calculate price dispersion
    const allPrices = rfqs.flatMap(rfq => 
      rfq.quotes.map(q => new Decimal(q.price.toString()))
    );

    const avgPrice = allPrices.reduce((sum, p) => sum.add(p), new Decimal(0))
      .div(allPrices.length);

    const priceDispersion = allPrices.length > 0
      ? allPrices
          .map(p => p.sub(avgPrice).abs())
          .reduce((sum, d) => sum.add(d), new Decimal(0))
          .div(allPrices.length)
          .div(avgPrice)
          .mul(10000) // Convert to bps
      : new Decimal(0);

    // Calculate spreads
    const spreads = rfqs.flatMap(rfq =>
      rfq.quotes
        .filter(q => q.bidPrice && q.askPrice)
        .map(q => {
          const bid = new Decimal(q.bidPrice!.toString());
          const ask = new Decimal(q.askPrice!.toString());
          const mid = bid.add(ask).div(2);
          return ask.sub(bid).div(mid).mul(10000); // bps
        })
    );

    const bestSpread = spreads.length > 0
      ? spreads.reduce((min, s) => s.lt(min) ? s : min)
      : new Decimal(0);

    const worstSpread = spreads.length > 0
      ? spreads.reduce((max, s) => s.gt(max) ? s : max)
      : new Decimal(0);

    // Determine competition level
    let competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (activeMarketMakers >= 5 && averageQuotesPerRFQ >= 4) {
      competitionLevel = 'HIGH';
    } else if (activeMarketMakers >= 3 && averageQuotesPerRFQ >= 2) {
      competitionLevel = 'MEDIUM';
    }

    return {
      pair: `${baseCurrency}/${quoteCurrency}`,
      competitionLevel,
      activeMarketMakers,
      averageQuotesPerRFQ,
      priceDispersion,
      bestSpread,
      worstSpread,
    };
  }

  async scoreMarketMaker(
    marketMakerId: string,
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'DAILY'
  ): Promise<{
    overallScore: number;
    components: {
      responseScore: number;
      priceScore: number;
      volumeScore: number;
      reliabilityScore: number;
      improvementScore: number;
    };
    rank: number;
    totalMarketMakers: number;
  }> {
    const { startDate, endDate } = this.getPeriodDates(period);
    
    // Get metrics for this market maker
    const metrics = await this.getCompetitionMetrics(marketMakerId, startDate, endDate);
    
    // Get leaderboard to determine rank
    const leaderboard = await this.getLeaderboard(period);
    const rank = leaderboard.rankings.findIndex(m => m.marketMakerId === marketMakerId) + 1;

    // Calculate component scores (0-100)
    const responseScore = Math.max(0, 100 - (metrics.averageResponseTime / 100)); // 100ms = 100 score
    const priceScore = Math.max(0, 100 - metrics.averageSpread.toNumber()); // Lower spread = higher score
    const volumeScore = Math.min(100, metrics.totalVolume.div(1000000).toNumber() * 10); // 10M volume = 100 score
    const reliabilityScore = metrics.winRate; // Win rate is already 0-100
    const improvementScore = Math.min(100, metrics.averageImprovement.toNumber() * 10); // 10 bps improvement = 100 score

    // Calculate weighted overall score
    const overallScore = (
      responseScore * 0.2 +
      priceScore * 0.3 +
      volumeScore * 0.2 +
      reliabilityScore * 0.2 +
      improvementScore * 0.1
    );

    return {
      overallScore,
      components: {
        responseScore,
        priceScore,
        volumeScore,
        reliabilityScore,
        improvementScore,
      },
      rank,
      totalMarketMakers: leaderboard.rankings.length,
    };
  }

  private getPeriodDates(period: CompetitionLeaderboard['period']): {
    startDate: Date;
    endDate: Date;
  } {
    const endDate = new Date();
    let startDate: Date;

    switch (period) {
      case 'DAILY':
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'WEEKLY':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'MONTHLY':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'ALL_TIME':
        startDate = new Date('2020-01-01');
        break;
    }

    return { startDate, endDate };
  }

  async trackQuoteImprovement(
    rfqId: string,
    marketMakerId: string,
    previousPrice: Decimal,
    newPrice: Decimal,
    side: 'BUY' | 'SELL'
  ): Promise<void> {
    const improvementBps = side === 'BUY'
      ? previousPrice.sub(newPrice).div(previousPrice).mul(10000)
      : newPrice.sub(previousPrice).div(previousPrice).mul(10000);

    if (improvementBps.gt(0)) {
      this.emit('quote:improved', {
        rfqId,
        marketMakerId,
        previousPrice: previousPrice.toString(),
        newPrice: newPrice.toString(),
        improvementBps: improvementBps.toNumber(),
        side,
      });

      logger.info(
        `Market maker ${marketMakerId} improved quote by ${improvementBps.toFixed(2)} bps`
      );
    }
  }
}