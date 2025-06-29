import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { AuctionManager } from '../../../../src/services/marketMaker/rfq/AuctionManager';
import { authMiddleware } from '../../../../src/middleware/auth';
import { logger } from '../../../../src/utils/logger';

const prisma = new PrismaClient();
const auctionManager = new AuctionManager(prisma);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { auctionId } = req.query;
    const { marketMakerId, price, size, bidPrice, askPrice, bidSize, askSize, metadata } = req.body;

    if (!auctionId || typeof auctionId !== 'string') {
      return res.status(400).json({ error: 'Invalid auction ID' });
    }

    if (!marketMakerId || !price) {
      return res.status(400).json({ error: 'Market maker ID and price are required' });
    }

    // Verify market maker authentication
    const marketMaker = await prisma.marketMaker.findUnique({
      where: { id: marketMakerId },
    });

    if (!marketMaker || !marketMaker.isActive) {
      return res.status(403).json({ error: 'Invalid or inactive market maker' });
    }

    // Submit improved quote
    const improvedQuote = await auctionManager.submitImprovedQuote(
      auctionId,
      marketMakerId,
      {
        price: parseFloat(price),
        size: size ? parseFloat(size) : undefined,
        bidPrice: bidPrice ? parseFloat(bidPrice) : undefined,
        askPrice: askPrice ? parseFloat(askPrice) : undefined,
        bidSize: bidSize ? parseFloat(bidSize) : undefined,
        askSize: askSize ? parseFloat(askSize) : undefined,
        metadata,
      }
    );

    if (!improvedQuote) {
      return res.status(400).json({ error: 'Failed to submit improved quote' });
    }

    res.status(200).json({
      success: true,
      data: {
        quoteId: improvedQuote.id,
        price: improvedQuote.price.toString(),
        size: improvedQuote.size.toString(),
        improvement: (improvedQuote.metadata as any)?.improvementBps || 0,
      },
    });
  } catch (error: any) {
    logger.error('Error submitting auction quote:', error);
    
    if (error.message.includes('Auction not found')) {
      return res.status(404).json({ error: error.message });
    }
    
    if (error.message.includes('Auction has ended') || error.message.includes('Improvement must be')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to submit auction quote' });
  }
}

export default authMiddleware(handler);