import { PrismaClient, Quote, QuoteStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { logger } from '../../../utils/logger';

export interface AggregatedQuote {
  quote: Quote;
  effectivePrice: Decimal;
  totalCost: Decimal;
  priceImpact: Decimal;
  fees: Decimal;
}

export class QuoteAggregator {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findBestQuote(quotes: Quote[], side: 'BUY' | 'SELL'): Promise<Quote | undefined> {
    const activeQuotes = quotes.filter(
      q => q.status === QuoteStatus.ACTIVE && new Date() < q.expiresAt
    );

    if (activeQuotes.length === 0) {
      return undefined;
    }

    // Sort by price (best price first)
    const sortedQuotes = activeQuotes.sort((a, b) => {
      if (side === 'BUY') {
        // For buy orders, lower price is better
        return a.price.toNumber() - b.price.toNumber();
      } else {
        // For sell orders, higher price is better
        return b.price.toNumber() - a.price.toNumber();
      }
    });

    return sortedQuotes[0];
  }

  async aggregateQuotes(
    quotes: Quote[],
    requestedSize: Decimal,
    side: 'BUY' | 'SELL'
  ): Promise<AggregatedQuote[]> {
    const activeQuotes = quotes.filter(
      q => q.status === QuoteStatus.ACTIVE && new Date() < q.expiresAt
    );

    if (activeQuotes.length === 0) {
      return [];
    }

    // Sort quotes by price
    const sortedQuotes = this.sortQuotesByPrice(activeQuotes, side);
    
    const aggregatedQuotes: AggregatedQuote[] = [];
    let remainingSize = requestedSize;

    for (const quote of sortedQuotes) {
      if (remainingSize.lte(0)) break;

      const availableSize = new Decimal(quote.size.toString());
      const fillSize = remainingSize.gt(availableSize) ? availableSize : remainingSize;
      
      // Calculate costs and impacts
      const totalCost = fillSize.mul(quote.price);
      const fees = await this.calculateFees(quote, fillSize, side);
      const priceImpact = await this.calculatePriceImpact(quote, fillSize);

      aggregatedQuotes.push({
        quote,
        effectivePrice: totalCost.add(fees).div(fillSize),
        totalCost: totalCost.add(fees),
        priceImpact,
        fees,
      });

      remainingSize = remainingSize.sub(fillSize);
    }

    return aggregatedQuotes;
  }

  private sortQuotesByPrice(quotes: Quote[], side: 'BUY' | 'SELL'): Quote[] {
    return quotes.sort((a, b) => {
      if (side === 'BUY') {
        return a.price.toNumber() - b.price.toNumber();
      } else {
        return b.price.toNumber() - a.price.toNumber();
      }
    });
  }

  private async calculateFees(
    quote: Quote,
    size: Decimal,
    side: 'BUY' | 'SELL'
  ): Promise<Decimal> {
    try {
      // Get fee structure for this market maker
      const feeStructure = await this.prisma.feeStructure.findFirst({
        where: {
          marketMakerId: quote.marketMakerId,
          isActive: true,
          feeType: side === 'BUY' ? 'TAKER_FEE' : 'MAKER_REBATE',
        },
        orderBy: {
          priority: 'desc',
        },
      });

      if (!feeStructure) {
        return new Decimal(0);
      }

      // Calculate fee based on basis points
      const feeRate = new Decimal(feeStructure.feeBps).div(10000);
      const fee = size.mul(quote.price).mul(feeRate);

      // Add flat fee if applicable
      if (feeStructure.flatFee) {
        return fee.add(feeStructure.flatFee);
      }

      return fee;
    } catch (error) {
      logger.error('Error calculating fees:', error);
      return new Decimal(0);
    }
  }

  private async calculatePriceImpact(quote: Quote, size: Decimal): Promise<Decimal> {
    // Simple price impact calculation
    // In a real system, this would consider market depth and liquidity
    const impactBps = size.div(quote.size).mul(10); // 10 bps per 100% of quote size
    return impactBps.gt(100) ? new Decimal(100) : impactBps;
  }

  async getBestExecutionPath(
    quotes: Quote[],
    requestedSize: Decimal,
    side: 'BUY' | 'SELL'
  ): Promise<{
    quotes: AggregatedQuote[];
    totalCost: Decimal;
    averagePrice: Decimal;
    totalFees: Decimal;
    canFillCompletely: boolean;
  }> {
    const aggregated = await this.aggregateQuotes(quotes, requestedSize, side);
    
    if (aggregated.length === 0) {
      return {
        quotes: [],
        totalCost: new Decimal(0),
        averagePrice: new Decimal(0),
        totalFees: new Decimal(0),
        canFillCompletely: false,
      };
    }

    const totalCost = aggregated.reduce(
      (sum, aq) => sum.add(aq.totalCost),
      new Decimal(0)
    );

    const totalSize = aggregated.reduce(
      (sum, aq) => sum.add(aq.quote.size),
      new Decimal(0)
    );

    const totalFees = aggregated.reduce(
      (sum, aq) => sum.add(aq.fees),
      new Decimal(0)
    );

    const canFillCompletely = totalSize.gte(requestedSize);
    const averagePrice = totalSize.gt(0) ? totalCost.div(totalSize) : new Decimal(0);

    return {
      quotes: aggregated,
      totalCost,
      averagePrice,
      totalFees,
      canFillCompletely,
    };
  }

  async compareQuotes(quotes: Quote[]): Promise<{
    bestPrice: Quote | undefined;
    bestSize: Quote | undefined;
    bestEffectivePrice: Quote | undefined;
  }> {
    const activeQuotes = quotes.filter(
      q => q.status === QuoteStatus.ACTIVE && new Date() < q.expiresAt
    );

    if (activeQuotes.length === 0) {
      return {
        bestPrice: undefined,
        bestSize: undefined,
        bestEffectivePrice: undefined,
      };
    }

    // Best raw price
    const bestPrice = activeQuotes.reduce((best, current) =>
      current.price.lt(best.price) ? current : best
    );

    // Best size
    const bestSize = activeQuotes.reduce((best, current) =>
      current.size.gt(best.size) ? current : best
    );

    // Best effective price (including fees)
    const quotesWithFees = await Promise.all(
      activeQuotes.map(async (quote) => {
        const fees = await this.calculateFees(quote, quote.size, 'BUY');
        const effectivePrice = quote.price.add(fees.div(quote.size));
        return { quote, effectivePrice };
      })
    );

    const bestEffectivePrice = quotesWithFees.reduce((best, current) =>
      current.effectivePrice.lt(best.effectivePrice) ? current : best
    ).quote;

    return {
      bestPrice,
      bestSize,
      bestEffectivePrice,
    };
  }
}