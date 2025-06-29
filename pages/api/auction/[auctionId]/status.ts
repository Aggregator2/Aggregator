import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { AuctionManager } from '../../../../src/services/marketMaker/rfq/AuctionManager';
import { authMiddleware } from '../../../../src/middleware/auth';
import { logger } from '../../../../src/utils/logger';

const prisma = new PrismaClient();
const auctionManager = new AuctionManager(prisma);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { auctionId } = req.query;

    if (!auctionId || typeof auctionId !== 'string') {
      return res.status(400).json({ error: 'Invalid auction ID' });
    }

    const status = await auctionManager.getAuctionStatus(auctionId);

    if (!status) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        auction: {
          id: status.auction.id,
          rfqId: status.auction.rfqId,
          startTime: status.auction.startTime,
          endTime: status.auction.endTime,
          minParticipants: status.auction.minParticipants,
          winningQuoteId: status.auction.winningQuoteId,
          executedPrice: status.auction.executedPrice?.toString(),
          executedSize: status.auction.executedSize?.toString(),
        },
        quotes: status.quotes.map(quote => ({
          id: quote.id,
          marketMakerId: quote.marketMakerId,
          price: quote.price.toString(),
          size: quote.size.toString(),
          status: quote.status,
          createdAt: quote.createdAt,
        })),
        timeRemaining: status.timeRemaining,
        currentBest: status.currentBest ? {
          id: status.currentBest.id,
          marketMakerId: status.currentBest.marketMakerId,
          price: status.currentBest.price.toString(),
          size: status.currentBest.size.toString(),
        } : null,
      },
    });
  } catch (error) {
    logger.error('Error getting auction status:', error);
    res.status(500).json({ error: 'Failed to get auction status' });
  }
}

export default authMiddleware(handler);