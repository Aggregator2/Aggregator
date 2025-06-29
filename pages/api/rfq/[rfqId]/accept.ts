import { NextApiRequest, NextApiResponse } from 'next';
import { RFQService } from '../../../../src/services/marketMaker/rfq/RFQService';
import { authMiddleware } from '../../../../src/middleware/auth';
import { logger } from '../../../../src/utils/logger';

const rfqService = new RFQService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = (req as any).userId;
    const { quoteId } = req.body;

    if (!quoteId) {
      return res.status(400).json({ error: 'Quote ID is required' });
    }

    await rfqService.acceptQuote(quoteId, userId);

    res.status(200).json({
      success: true,
      message: 'Quote accepted successfully',
    });
  } catch (error: any) {
    logger.error('Error accepting quote:', error);
    
    if (error.message === 'Quote not found' || error.message === 'Unauthorized') {
      return res.status(404).json({ error: error.message });
    }
    
    if (error.message === 'Quote is no longer active' || error.message === 'Quote has expired') {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to accept quote' });
  }
}

export default authMiddleware(handler);