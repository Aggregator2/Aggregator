import { PrismaClient, Quote, RFQ, MarketMakerTrade } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EventEmitter } from 'events';
import { logger } from '../../../utils/logger';
import { QuoteAggregator } from '../rfq/QuoteAggregator';

export interface ExecutionStrategy {
  type: 'IMMEDIATE' | 'TWAP' | 'VWAP' | 'ICEBERG';
  params?: {
    timeWindow?: number; // milliseconds
    sliceSize?: string;
    priceLimit?: string;
    minFillSize?: string;
  };
}

export interface ExecutionReport {
  rfqId: string;
  userId: string;
  strategy: ExecutionStrategy;
  quotes: Quote[];
  trades: MarketMakerTrade[];
  totalExecutedSize: Decimal;
  averagePrice: Decimal;
  totalCost: Decimal;
  totalFees: Decimal;
  slippage: Decimal;
  executionTime: number;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
}

export class BestExecutionService extends EventEmitter {
  private prisma: PrismaClient;
  private quoteAggregator: QuoteAggregator;

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.quoteAggregator = new QuoteAggregator(this.prisma);
  }

  async executeRFQ(
    rfqId: string,
    userId: string,
    strategy: ExecutionStrategy = { type: 'IMMEDIATE' }
  ): Promise<ExecutionReport> {
    const startTime = Date.now();

    try {
      // Get RFQ with quotes
      const rfq = await this.prisma.RFQ.findFirst({
        where: { id: rfqId, userId },
        include: {
          quotes: {
            where: {
              status: 'ACTIVE',
              expiresAt: { gt: new Date() },
            },
            orderBy: {
              price: rfq?.side === 'BUY' ? 'asc' : 'desc',
            },
          },
        },
      });

      if (!rfq) {
        throw new Error('RFQ not found or unauthorized');
      }

      // Execute based on strategy
      let executionResult: ExecutionReport;

      switch (strategy.type) {
        case 'IMMEDIATE':
          executionResult = await this.executeImmediate(rfq);
          break;
        case 'TWAP':
          executionResult = await this.executeTWAP(rfq, strategy.params);
          break;
        case 'VWAP':
          executionResult = await this.executeVWAP(rfq, strategy.params);
          break;
        case 'ICEBERG':
          executionResult = await this.executeIceberg(rfq, strategy.params);
          break;
        default:
          throw new Error(`Unknown execution strategy: ${strategy.type}`);
      }

      // Calculate execution time
      executionResult.executionTime = Date.now() - startTime;

      // Emit execution complete event
      this.emit('execution:complete', executionResult);

      return executionResult;
    } catch (error) {
      logger.error('Error executing RFQ:', error);
      throw error;
    }
  }

  private async executeImmediate(rfq: RFQ & { quotes: Quote[] }): Promise<ExecutionReport> {
    const requestedSize = new Decimal(rfq.baseAmount?.toString() || '0');
    
    if (requestedSize.lte(0)) {
      throw new Error('Invalid requested size');
    }

    // Get best execution path
    const executionPath = await this.quoteAggregator.getBestExecutionPath(
      rfq.quotes,
      requestedSize,
      rfq.side as 'BUY' | 'SELL'
    );

    if (!executionPath.canFillCompletely) {
      logger.warn(`Cannot fill complete order for RFQ ${rfq.id}`);
    }

    // Execute trades
    const trades: MarketMakerTrade[] = [];
    let totalExecutedSize = new Decimal(0);
    let totalCost = new Decimal(0);

    for (const aggregatedQuote of executionPath.quotes) {
      const quote = aggregatedQuote.quote;
      const fillSize = Decimal.min(
        new Decimal(quote.size.toString()),
        requestedSize.sub(totalExecutedSize)
      );

      if (fillSize.lte(0)) break;

      // Create trade
      const trade = await this.createTrade(rfq, quote, fillSize);
      trades.push(trade);

      // Update totals
      totalExecutedSize = totalExecutedSize.add(fillSize);
      totalCost = totalCost.add(fillSize.mul(quote.price));

      // Update quote filled size
      await this.prisma.Quote.update({
        where: { id: quote.id },
        data: {
          filledSize: new Decimal(quote.filledSize.toString()).add(fillSize),
          status: fillSize.gte(quote.size) ? 'FILLED' : 'PARTIALLY_FILLED',
        },
      });

      if (totalExecutedSize.gte(requestedSize)) break;
    }

    // Calculate metrics
    const averagePrice = totalExecutedSize.gt(0) 
      ? totalCost.div(totalExecutedSize) 
      : new Decimal(0);

    const slippage = this.calculateSlippage(
      rfq.quotes[0]?.price || new Decimal(0),
      averagePrice,
      rfq.side as 'BUY' | 'SELL'
    );

    // Update RFQ status
    await this.prisma.RFQ.update({
      where: { id: rfq.id },
      data: { status: 'EXECUTED' },
    });

    return {
      rfqId: rfq.id,
      userId: rfq.userId,
      strategy: { type: 'IMMEDIATE' },
      quotes: rfq.quotes,
      trades,
      totalExecutedSize,
      averagePrice,
      totalCost,
      totalFees: executionPath.totalFees,
      slippage,
      executionTime: 0,
      status: totalExecutedSize.gte(requestedSize) ? 'COMPLETED' : 'PARTIAL',
    };
  }

  private async executeTWAP(
    rfq: RFQ & { quotes: Quote[] },
    params?: ExecutionStrategy['params']
  ): Promise<ExecutionReport> {
    const timeWindow = params?.timeWindow || 60000; // 1 minute default
    const sliceSize = new Decimal(params?.sliceSize || '0');
    const requestedSize = new Decimal(rfq.baseAmount?.toString() || '0');

    // Calculate number of slices
    const numSlices = sliceSize.gt(0) 
      ? requestedSize.div(sliceSize).ceil().toNumber()
      : 10; // Default to 10 slices

    const sliceInterval = timeWindow / numSlices;
    const actualSliceSize = requestedSize.div(numSlices);

    const trades: MarketMakerTrade[] = [];
    let totalExecutedSize = new Decimal(0);
    let totalCost = new Decimal(0);

    for (let i = 0; i < numSlices; i++) {
      // Wait for interval (except first slice)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, sliceInterval));
      }

      // Get fresh quotes for this slice
      const freshQuotes = await this.prisma.Quote.findMany({
        where: {
          rfqId: rfq.id,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
        orderBy: {
          price: rfq.side === 'BUY' ? 'asc' : 'desc',
        },
      });

      if (freshQuotes.length === 0) {
        logger.warn(`No quotes available for TWAP slice ${i + 1}`);
        continue;
      }

      // Execute slice
      const sliceTrade = await this.createTrade(
        rfq,
        freshQuotes[0],
        actualSliceSize
      );

      trades.push(sliceTrade);
      totalExecutedSize = totalExecutedSize.add(actualSliceSize);
      totalCost = totalCost.add(actualSliceSize.mul(freshQuotes[0].price));

      // Emit progress
      this.emit('execution:progress', {
        rfqId: rfq.id,
        slice: i + 1,
        totalSlices: numSlices,
        executedSize: totalExecutedSize.toString(),
      });
    }

    const averagePrice = totalExecutedSize.gt(0)
      ? totalCost.div(totalExecutedSize)
      : new Decimal(0);

    return {
      rfqId: rfq.id,
      userId: rfq.userId,
      strategy: { type: 'TWAP', params },
      quotes: rfq.quotes,
      trades,
      totalExecutedSize,
      averagePrice,
      totalCost,
      totalFees: new Decimal(0), // Calculate fees
      slippage: new Decimal(0), // Calculate slippage
      executionTime: timeWindow,
      status: totalExecutedSize.gte(requestedSize) ? 'COMPLETED' : 'PARTIAL',
    };
  }

  private async executeVWAP(
    rfq: RFQ & { quotes: Quote[] },
    params?: ExecutionStrategy['params']
  ): Promise<ExecutionReport> {
    // VWAP implementation would consider historical volume patterns
    // For now, this is a simplified version
    const timeWindow = params?.timeWindow || 300000; // 5 minutes default
    const requestedSize = new Decimal(rfq.baseAmount?.toString() || '0');

    // Get volume profile (simplified)
    const volumeProfile = await this.getVolumeProfile(
      rfq.baseCurrency,
      rfq.quoteCurrency,
      timeWindow
    );

    const trades: MarketMakerTrade[] = [];
    let totalExecutedSize = new Decimal(0);
    let totalCost = new Decimal(0);

    // Execute based on volume profile
    for (const { percentage, timestamp } of volumeProfile) {
      const sliceSize = requestedSize.mul(percentage).div(100);

      // Get quotes at this time
      const quotes = await this.prisma.Quote.findMany({
        where: {
          rfqId: rfq.id,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
        orderBy: {
          price: rfq.side === 'BUY' ? 'asc' : 'desc',
        },
        take: 1,
      });

      if (quotes.length === 0) continue;

      const trade = await this.createTrade(rfq, quotes[0], sliceSize);
      trades.push(trade);
      
      totalExecutedSize = totalExecutedSize.add(sliceSize);
      totalCost = totalCost.add(sliceSize.mul(quotes[0].price));
    }

    const averagePrice = totalExecutedSize.gt(0)
      ? totalCost.div(totalExecutedSize)
      : new Decimal(0);

    return {
      rfqId: rfq.id,
      userId: rfq.userId,
      strategy: { type: 'VWAP', params },
      quotes: rfq.quotes,
      trades,
      totalExecutedSize,
      averagePrice,
      totalCost,
      totalFees: new Decimal(0),
      slippage: new Decimal(0),
      executionTime: timeWindow,
      status: totalExecutedSize.gte(requestedSize) ? 'COMPLETED' : 'PARTIAL',
    };
  }

  private async executeIceberg(
    rfq: RFQ & { quotes: Quote[] },
    params?: ExecutionStrategy['params']
  ): Promise<ExecutionReport> {
    const visibleSize = new Decimal(params?.sliceSize || '100');
    const requestedSize = new Decimal(rfq.baseAmount?.toString() || '0');
    const priceLimit = params?.priceLimit ? new Decimal(params.priceLimit) : null;

    const trades: MarketMakerTrade[] = [];
    let totalExecutedSize = new Decimal(0);
    let totalCost = new Decimal(0);
    let remainingSize = requestedSize;

    while (remainingSize.gt(0)) {
      // Determine next visible size
      const currentSliceSize = Decimal.min(visibleSize, remainingSize);

      // Get best quote within price limit
      const quotes = await this.prisma.Quote.findMany({
        where: {
          rfqId: rfq.id,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
          ...(priceLimit && rfq.side === 'BUY' ? { price: { lte: priceLimit } } : {}),
          ...(priceLimit && rfq.side === 'SELL' ? { price: { gte: priceLimit } } : {}),
        },
        orderBy: {
          price: rfq.side === 'BUY' ? 'asc' : 'desc',
        },
        take: 1,
      });

      if (quotes.length === 0) {
        logger.warn('No quotes available within price limit for iceberg order');
        break;
      }

      const trade = await this.createTrade(rfq, quotes[0], currentSliceSize);
      trades.push(trade);

      totalExecutedSize = totalExecutedSize.add(currentSliceSize);
      totalCost = totalCost.add(currentSliceSize.mul(quotes[0].price));
      remainingSize = remainingSize.sub(currentSliceSize);

      // Small delay between slices to avoid detection
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    }

    const averagePrice = totalExecutedSize.gt(0)
      ? totalCost.div(totalExecutedSize)
      : new Decimal(0);

    return {
      rfqId: rfq.id,
      userId: rfq.userId,
      strategy: { type: 'ICEBERG', params },
      quotes: rfq.quotes,
      trades,
      totalExecutedSize,
      averagePrice,
      totalCost,
      totalFees: new Decimal(0),
      slippage: new Decimal(0),
      executionTime: 0,
      status: totalExecutedSize.gte(requestedSize) ? 'COMPLETED' : 'PARTIAL',
    };
  }

  private async createTrade(
    rfq: RFQ,
    quote: Quote,
    size: Decimal
  ): Promise<MarketMakerTrade> {
    const quoteAmount = size.mul(quote.price);

    const trade = await this.prisma.MarketMakerTrade.create({
      data: {
        marketMakerId: quote.marketMakerId,
        quoteId: quote.id,
        rfqId: rfq.id,
        userId: rfq.userId,
        side: rfq.side,
        baseCurrency: rfq.baseCurrency,
        quoteCurrency: rfq.quoteCurrency,
        baseAmount: size,
        quoteAmount,
        price: quote.price,
        status: 'PENDING',
        executedAt: new Date(),
      },
    });

    // Emit trade created event
    this.emit('trade:created', trade);

    return trade;
  }

  private calculateSlippage(
    initialPrice: Decimal,
    executedPrice: Decimal,
    side: 'BUY' | 'SELL'
  ): Decimal {
    if (initialPrice.eq(0)) return new Decimal(0);

    const slippageRatio = side === 'BUY'
      ? executedPrice.sub(initialPrice).div(initialPrice)
      : initialPrice.sub(executedPrice).div(initialPrice);

    return slippageRatio.mul(10000); // Convert to basis points
  }

  private async getVolumeProfile(
    baseCurrency: string,
    quoteCurrency: string,
    timeWindow: number
  ): Promise<Array<{ percentage: number; timestamp: Date }>> {
    // Simplified volume profile
    // In production, this would analyze historical trading patterns
    const intervals = 10;
    const profile: Array<{ percentage: number; timestamp: Date }> = [];
    
    for (let i = 0; i < intervals; i++) {
      profile.push({
        percentage: 100 / intervals,
        timestamp: new Date(Date.now() + (timeWindow / intervals) * i),
      });
    }

    return profile;
  }

  async getExecutionReport(rfqId: string, userId: string): Promise<ExecutionReport | null> {
    const rfq = await this.prisma.RFQ.findFirst({
      where: { id: rfqId, userId },
      include: {
        quotes: true,
        trades: true,
      },
    });

    if (!rfq) return null;

    const totalExecutedSize = rfq.trades.reduce(
      (sum, trade) => sum.add(trade.baseAmount),
      new Decimal(0)
    );

    const totalCost = rfq.trades.reduce(
      (sum, trade) => sum.add(trade.quoteAmount),
      new Decimal(0)
    );

    const averagePrice = totalExecutedSize.gt(0)
      ? totalCost.div(totalExecutedSize)
      : new Decimal(0);

    return {
      rfqId: rfq.id,
      userId: rfq.userId,
      strategy: { type: 'IMMEDIATE' }, // Default
      quotes: rfq.quotes,
      trades: rfq.trades,
      totalExecutedSize,
      averagePrice,
      totalCost,
      totalFees: new Decimal(0), // Calculate from trades
      slippage: new Decimal(0), // Calculate from trades
      executionTime: 0,
      status: rfq.status === 'EXECUTED' ? 'COMPLETED' : 'PARTIAL',
    };
  }
}