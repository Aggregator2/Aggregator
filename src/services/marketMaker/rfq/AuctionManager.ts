import { PrismaClient, RFQ, Quote, Auction } from '@prisma/client';
import { EventEmitter } from 'events';
import { logger } from '../../../utils/logger';
import { QuoteAggregator } from './QuoteAggregator';

export interface AuctionConfig {
  minParticipants: number;
  auctionDurationMs: number;
  minImprovementBps: number;
}

export class AuctionManager extends EventEmitter {
  private prisma: PrismaClient;
  private quoteAggregator: QuoteAggregator;
  private defaultConfig: AuctionConfig = {
    minParticipants: 2,
    auctionDurationMs: 5000, // 5 seconds
    minImprovementBps: 5, // 0.05% improvement required
  };

  constructor(prisma: PrismaClient) {
    super();
    this.prisma = prisma;
    this.quoteAggregator = new QuoteAggregator(prisma);
  }

  async createAuction(
    rfqId: string,
    initialQuotes: Quote[],
    config?: Partial<AuctionConfig>
  ): Promise<Auction> {
    const auctionConfig = { ...this.defaultConfig, ...config };
    
    if (initialQuotes.length < auctionConfig.minParticipants) {
      throw new Error(`Insufficient participants for auction. Minimum required: ${auctionConfig.minParticipants}`);
    }

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + auctionConfig.auctionDurationMs);

    const auction = await this.prisma.Auction.create({
      data: {
        rfqId,
        startTime,
        endTime,
        minParticipants: auctionConfig.minParticipants,
        metadata: {
          initialQuotes: initialQuotes.map(q => q.id),
          config: auctionConfig,
        },
      },
    });

    // Emit auction started event
    this.emit('auction:started', { auction, quotes: initialQuotes });

    // Schedule auction end
    setTimeout(() => {
      this.endAuction(auction.id).catch(error => {
        logger.error(`Error ending auction ${auction.id}:`, error);
      });
    }, auctionConfig.auctionDurationMs);

    return auction;
  }

  async submitImprovedQuote(
    auctionId: string,
    marketMakerId: string,
    improvedQuote: Partial<Quote>
  ): Promise<Quote | null> {
    const auction = await this.prisma.Auction.findUnique({
      where: { id: auctionId },
      include: {
        rfq: {
          include: {
            quotes: {
              where: {
                marketMakerId,
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
            },
          },
        },
      },
    });

    if (!auction) {
      throw new Error('Auction not found');
    }

    if (new Date() > auction.endTime) {
      throw new Error('Auction has ended');
    }

    // Get the market maker's current best quote
    const currentQuote = auction.rfq.quotes[0];
    if (!currentQuote) {
      throw new Error('No existing quote from this market maker');
    }

    // Verify improvement
    const improvement = this.calculateImprovement(
      currentQuote.price,
      improvedQuote.price!,
      auction.rfq.side
    );

    const minImprovementBps = (auction.metadata as any)?.config?.minImprovementBps || 5;
    if (improvement < minImprovementBps) {
      throw new Error(`Improvement must be at least ${minImprovementBps} basis points`);
    }

    // Create improved quote
    const newQuote = await this.prisma.Quote.create({
      data: {
        rfqId: auction.rfqId,
        marketMakerId,
        price: improvedQuote.price!,
        size: improvedQuote.size || currentQuote.size,
        side: currentQuote.side,
        bidPrice: improvedQuote.bidPrice,
        askPrice: improvedQuote.askPrice,
        bidSize: improvedQuote.bidSize,
        askSize: improvedQuote.askSize,
        status: 'ACTIVE',
        expiresAt: improvedQuote.expiresAt || currentQuote.expiresAt,
        metadata: {
          ...(improvedQuote.metadata || {}),
          auctionId,
          improvementBps: improvement,
        },
      },
    });

    // Cancel previous quote
    await this.prisma.Quote.update({
      where: { id: currentQuote.id },
      data: { status: 'CANCELLED' },
    });

    this.emit('auction:improved_quote', { auction, newQuote, improvement });

    return newQuote;
  }

  private calculateImprovement(
    currentPrice: any,
    newPrice: any,
    side: string
  ): number {
    const current = parseFloat(currentPrice.toString());
    const improved = parseFloat(newPrice.toString());
    
    let improvementRatio: number;
    if (side === 'BUY') {
      // For buy orders, lower price is better
      improvementRatio = (current - improved) / current;
    } else {
      // For sell orders, higher price is better
      improvementRatio = (improved - current) / current;
    }

    return improvementRatio * 10000; // Convert to basis points
  }

  async endAuction(auctionId: string): Promise<void> {
    const auction = await this.prisma.Auction.findUnique({
      where: { id: auctionId },
      include: {
        rfq: {
          include: {
            quotes: {
              where: {
                status: 'ACTIVE',
              },
            },
          },
        },
      },
    });

    if (!auction) {
      return;
    }

    // Find winning quote
    const bestQuote = await this.quoteAggregator.findBestQuote(
      auction.rfq.quotes,
      auction.rfq.side as 'BUY' | 'SELL'
    );

    if (!bestQuote) {
      logger.warn(`No valid quotes found for auction ${auctionId}`);
      return;
    }

    // Update auction with winner
    await this.prisma.Auction.update({
      where: { id: auctionId },
      data: {
        winningQuoteId: bestQuote.id,
        executedPrice: bestQuote.price,
        executedSize: bestQuote.size,
      },
    });

    // Update RFQ status
    await this.prisma.RFQ.update({
      where: { id: auction.rfqId },
      data: { status: 'QUOTED' },
    });

    this.emit('auction:ended', { auction, winningQuote: bestQuote });
  }

  async getAuctionStatus(auctionId: string): Promise<{
    auction: Auction;
    quotes: Quote[];
    timeRemaining: number;
    currentBest?: Quote;
  } | null> {
    const auction = await this.prisma.Auction.findUnique({
      where: { id: auctionId },
      include: {
        rfq: {
          include: {
            quotes: {
              where: {
                status: 'ACTIVE',
              },
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
      },
    });

    if (!auction) {
      return null;
    }

    const timeRemaining = Math.max(0, auction.endTime.getTime() - Date.now());
    const currentBest = await this.quoteAggregator.findBestQuote(
      auction.rfq.quotes,
      auction.rfq.side as 'BUY' | 'SELL'
    );

    return {
      auction,
      quotes: auction.rfq.quotes,
      timeRemaining,
      currentBest,
    };
  }

  async getAuctionMetrics(startDate: Date, endDate: Date): Promise<{
    totalAuctions: number;
    averageParticipants: number;
    averageImprovementBps: number;
    completionRate: number;
  }> {
    const auctions = await this.prisma.Auction.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        rfq: {
          include: {
            quotes: true,
          },
        },
      },
    });

    if (auctions.length === 0) {
      return {
        totalAuctions: 0,
        averageParticipants: 0,
        averageImprovementBps: 0,
        completionRate: 0,
      };
    }

    const totalAuctions = auctions.length;
    const completedAuctions = auctions.filter(a => a.winningQuoteId !== null).length;
    const completionRate = (completedAuctions / totalAuctions) * 100;

    const totalParticipants = auctions.reduce((sum, auction) => {
      const uniqueMarketMakers = new Set(auction.rfq.quotes.map(q => q.marketMakerId));
      return sum + uniqueMarketMakers.size;
    }, 0);

    const averageParticipants = totalParticipants / totalAuctions;

    // Calculate average improvement
    let totalImprovement = 0;
    let improvementCount = 0;

    for (const auction of auctions) {
      const improvements = auction.rfq.quotes
        .map(q => (q.metadata as any)?.improvementBps)
        .filter(imp => imp !== undefined);
      
      totalImprovement += improvements.reduce((sum, imp) => sum + imp, 0);
      improvementCount += improvements.length;
    }

    const averageImprovementBps = improvementCount > 0 
      ? totalImprovement / improvementCount 
      : 0;

    return {
      totalAuctions,
      averageParticipants,
      averageImprovementBps,
      completionRate,
    };
  }
}