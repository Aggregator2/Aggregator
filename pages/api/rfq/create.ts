import { NextApiRequest, NextApiResponse } from 'next';
import { RFQService } from '../../../src/services/marketMaker/rfq/RFQService';
import { authMiddleware } from '../../../src/middleware/auth';
import { rateLimiter } from '../../../src/middleware/rateLimiter';
import { logger } from '../../../src/utils/logger';

const rfqService = new RFQService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = (req as any).userId;
    const {
      side,
      baseCurrency,
      quoteCurrency,
      baseAmount,
      quoteAmount,
      orderFlowType,
      expiryMs,
      metadata,
    } = req.body;

    // Validate input
    if (!side || !baseCurrency || !quoteCurrency) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['BUY', 'SELL'].includes(side)) {
      return res.status(400).json({ error: 'Invalid side' });
    }

    if (!baseAmount && !quoteAmount) {
      return res.status(400).json({ error: 'Either baseAmount or quoteAmount is required' });
    }

    // Create RFQ
    const response = await rfqService.createRFQ({
      userId,
      side,
      baseCurrency,
      quoteCurrency,
      baseAmount,
      quoteAmount,
      orderFlowType,
      expiryMs,
      metadata,
    });

    res.status(200).json({
      success: true,
      data: {
        rfq: {
          id: response.rfq.id,
          requestId: response.rfq.requestId,
          status: response.rfq.status,
          expiresAt: response.rfq.expiresAt,
        },
        quotes: response.quotes.map(quote => ({
          id: quote.id,
          marketMakerId: quote.marketMakerId,
          price: quote.price.toString(),
          size: quote.size.toString(),
          side: quote.side,
          expiresAt: quote.expiresAt,
        })),
        bestQuote: response.bestQuote ? {
          id: response.bestQuote.id,
          marketMakerId: response.bestQuote.marketMakerId,
          price: response.bestQuote.price.toString(),
          size: response.bestQuote.size.toString(),
        } : null,
      },
    });
  } catch (error) {
    logger.error('Error creating RFQ:', error);
    res.status(500).json({ error: 'Failed to create RFQ' });
  }
}

export default authMiddleware(rateLimiter(handler));