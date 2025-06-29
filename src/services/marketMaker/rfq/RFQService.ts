import { PrismaClient, RFQ, Quote, RFQStatus, QuoteStatus, OrderFlowType } from '@prisma/client';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/logger';
import { MarketMakerConnectorManager } from './MarketMakerConnectorManager';
import { QuoteAggregator } from './QuoteAggregator';
import { AuctionManager } from './AuctionManager';

export interface RFQRequest {
  userId: string;
  side: 'BUY' | 'SELL';
  baseCurrency: string;
  quoteCurrency: string;
  baseAmount?: string;
  quoteAmount?: string;
  orderFlowType?: OrderFlowType;
  expiryMs?: number;
  metadata?: any;
}

export interface RFQResponse {
  rfq: RFQ;
  quotes: Quote[];
  bestQuote?: Quote;
}

export interface QuoteRequest {
  rfqId: string;
  marketMakerId: string;
  side: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseAmount?: string;
  quoteAmount?: string;
  orderFlowType: OrderFlowType;
}

export class RFQService extends EventEmitter {
  private prisma: PrismaClient;
  private mmConnectorManager: MarketMakerConnectorManager;
  private quoteAggregator: QuoteAggregator;
  private auctionManager: AuctionManager;
  private defaultExpiryMs = 30000; // 30 seconds

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.mmConnectorManager = new MarketMakerConnectorManager(this.prisma);
    this.quoteAggregator = new QuoteAggregator(this.prisma);
    this.auctionManager = new AuctionManager(this.prisma);
  }

  async createRFQ(request: RFQRequest): Promise<RFQResponse> {
    try {
      const requestId = uuidv4();
      const expiresAt = new Date(Date.now() + (request.expiryMs || this.defaultExpiryMs));

      // Create RFQ in database
      const rfq = await this.prisma.rFQ.create({
        data: {
          requestId,
          userId: request.userId,
          side: request.side,
          baseCurrency: request.baseCurrency,
          quoteCurrency: request.quoteCurrency,
          baseAmount: request.baseAmount ? parseFloat(request.baseAmount) : undefined,
          quoteAmount: request.quoteAmount ? parseFloat(request.quoteAmount) : undefined,
          orderFlowType: request.orderFlowType || OrderFlowType.PUBLIC,
          status: RFQStatus.PENDING,
          expiresAt,
          metadata: request.metadata,
        },
      });

      // Emit RFQ created event
      this.emit('rfq:created', rfq);

      // Get eligible market makers based on pair and order flow type
      const eligibleMMs = await this.getEligibleMarketMakers(
        request.baseCurrency,
        request.quoteCurrency,
        request.orderFlowType || OrderFlowType.PUBLIC
      );

      // Send quote requests to market makers
      const quotePromises = eligibleMMs.map(mm => 
        this.requestQuoteFromMM(rfq, mm.id)
      );

      // Wait for quotes with timeout
      const quotes = await Promise.allSettled(quotePromises);
      const successfulQuotes = quotes
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<Quote>).value)
        .filter(quote => quote !== null);

      // Update RFQ status
      await this.prisma.rFQ.update({
        where: { id: rfq.id },
        data: { status: RFQStatus.QUOTED },
      });

      // Aggregate quotes and find best
      const bestQuote = await this.quoteAggregator.findBestQuote(
        successfulQuotes,
        request.side
      );

      // Handle auction if private order flow
      if (request.orderFlowType === OrderFlowType.AUCTION && successfulQuotes.length >= 2) {
        await this.auctionManager.createAuction(rfq.id, successfulQuotes);
      }

      return {
        rfq,
        quotes: successfulQuotes,
        bestQuote,
      };
    } catch (error) {
      logger.error('Error creating RFQ:', error);
      throw error;
    }
  }

  private async requestQuoteFromMM(rfq: RFQ, marketMakerId: string): Promise<Quote | null> {
    try {
      const mm = await this.prisma.marketMaker.findUnique({
        where: { id: marketMakerId },
      });

      if (!mm || !mm.isActive) {
        return null;
      }

      // Get connector for market maker
      const connector = await this.mmConnectorManager.getConnector(marketMakerId);
      if (!connector) {
        logger.warn(`No connector available for market maker ${marketMakerId}`);
        return null;
      }

      // Request quote via connector
      const quoteData = await connector.requestQuote({
        rfqId: rfq.id,
        side: rfq.side,
        baseCurrency: rfq.baseCurrency,
        quoteCurrency: rfq.quoteCurrency,
        baseAmount: rfq.baseAmount?.toString(),
        quoteAmount: rfq.quoteAmount?.toString(),
      });

      if (!quoteData) {
        return null;
      }

      // Store quote in database
      const quote = await this.prisma.quote.create({
        data: {
          rfqId: rfq.id,
          marketMakerId,
          bidPrice: quoteData.bidPrice ? parseFloat(quoteData.bidPrice) : undefined,
          askPrice: quoteData.askPrice ? parseFloat(quoteData.askPrice) : undefined,
          bidSize: quoteData.bidSize ? parseFloat(quoteData.bidSize) : undefined,
          askSize: quoteData.askSize ? parseFloat(quoteData.askSize) : undefined,
          price: parseFloat(quoteData.price),
          size: parseFloat(quoteData.size),
          side: quoteData.side,
          status: QuoteStatus.ACTIVE,
          expiresAt: new Date(Date.now() + mm.quoteExpiry),
          signature: quoteData.signature,
          metadata: quoteData.metadata,
        },
      });

      this.emit('quote:received', quote);
      return quote;
    } catch (error) {
      logger.error(`Error requesting quote from MM ${marketMakerId}:`, error);
      return null;
    }
  }

  private async getEligibleMarketMakers(
    baseCurrency: string,
    quoteCurrency: string,
    orderFlowType: OrderFlowType
  ) {
    const marketMakers = await this.prisma.marketMaker.findMany({
      where: {
        status: 'ACTIVE',
        isActive: true,
        pairs: {
          some: {
            baseCurrency,
            quoteCurrency,
            isActive: true,
          },
        },
      },
      include: {
        pairs: {
          where: {
            baseCurrency,
            quoteCurrency,
            isActive: true,
          },
        },
      },
    });

    // Filter based on order flow type
    if (orderFlowType === OrderFlowType.PRIVATE) {
      // Only return market makers that support private flow
      return marketMakers.filter(mm => 
        mm.metadata && (mm.metadata as any).supportsPrivateFlow === true
      );
    }

    return marketMakers;
  }

  async acceptQuote(quoteId: string, userId: string): Promise<void> {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { rfq: true },
    });

    if (!quote) {
      throw new Error('Quote not found');
    }

    if (quote.rfq.userId !== userId) {
      throw new Error('Unauthorized');
    }

    if (quote.status !== QuoteStatus.ACTIVE) {
      throw new Error('Quote is no longer active');
    }

    if (new Date() > quote.expiresAt) {
      throw new Error('Quote has expired');
    }

    // Update quote and RFQ status
    await this.prisma.$transaction([
      this.prisma.quote.update({
        where: { id: quoteId },
        data: { status: QuoteStatus.FILLED },
      }),
      this.prisma.rFQ.update({
        where: { id: quote.rfqId },
        data: { status: RFQStatus.ACCEPTED },
      }),
    ]);

    // Emit acceptance event
    this.emit('quote:accepted', { quote, userId });

    // Cancel other quotes for this RFQ
    await this.cancelOtherQuotes(quote.rfqId, quoteId);
  }

  private async cancelOtherQuotes(rfqId: string, acceptedQuoteId: string): Promise<void> {
    await this.prisma.quote.updateMany({
      where: {
        rfqId,
        id: { not: acceptedQuoteId },
        status: QuoteStatus.ACTIVE,
      },
      data: { status: QuoteStatus.CANCELLED },
    });
  }

  async getRFQStatus(rfqId: string, userId: string): Promise<RFQResponse | null> {
    const rfq = await this.prisma.rFQ.findFirst({
      where: {
        id: rfqId,
        userId,
      },
      include: {
        quotes: {
          include: {
            marketMaker: true,
          },
        },
      },
    });

    if (!rfq) {
      return null;
    }

    const bestQuote = await this.quoteAggregator.findBestQuote(
      rfq.quotes,
      rfq.side as 'BUY' | 'SELL'
    );

    return {
      rfq,
      quotes: rfq.quotes,
      bestQuote,
    };
  }

  async expireQuotes(): Promise<void> {
    const expiredQuotes = await this.prisma.quote.updateMany({
      where: {
        status: QuoteStatus.ACTIVE,
        expiresAt: { lte: new Date() },
      },
      data: { status: QuoteStatus.EXPIRED },
    });

    if (expiredQuotes.count > 0) {
      logger.info(`Expired ${expiredQuotes.count} quotes`);
    }
  }

  async cleanup(): Promise<void> {
    await this.mmConnectorManager.cleanup();
    await this.prisma.$disconnect();
  }
}