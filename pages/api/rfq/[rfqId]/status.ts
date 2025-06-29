import { NextApiRequest, NextApiResponse } from 'next';
import { RFQService } from '../../../../src/services/marketMaker/rfq/RFQService';
import { authMiddleware } from '../../../../src/middleware/auth';
import { logger } from '../../../../src/utils/logger';

const rfqService = new RFQService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = (req as any).userId;
    const { rfqId } = req.query;

    if (!rfqId || typeof rfqId !== 'string') {
      return res.status(400).json({ error: 'Invalid RFQ ID' });
    }

    const response = await rfqService.getRFQStatus(rfqId, userId);

    if (!response) {
      return res.status(404).json({ error: 'RFQ not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        rfq: {
          id: response.rfq.id,
          requestId: response.rfq.requestId,
          status: response.rfq.status,
          side: response.rfq.side,
          baseCurrency: response.rfq.baseCurrency,
          quoteCurrency: response.rfq.quoteCurrency,
          baseAmount: response.rfq.baseAmount?.toString(),
          quoteAmount: response.rfq.quoteAmount?.toString(),
          orderFlowType: response.rfq.orderFlowType,
          expiresAt: response.rfq.expiresAt,
          createdAt: response.rfq.createdAt,
        },
        quotes: response.quotes.map(quote => ({
          id: quote.id,
          marketMakerId: quote.marketMakerId,
          marketMakerName: (quote as any).marketMaker?.name,
          price: quote.price.toString(),
          size: quote.size.toString(),
          side: quote.side,
          status: quote.status,
          expiresAt: quote.expiresAt,
          createdAt: quote.createdAt,
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
    logger.error('Error getting RFQ status:', error);
    res.status(500).json({ error: 'Failed to get RFQ status' });
  }
}

export default authMiddleware(handler);