import { NextApiRequest, NextApiResponse } from 'next';
import { MarketMakerOnboardingService } from '../../../../src/services/marketMaker/onboarding/MarketMakerOnboardingService';
import { authMiddleware } from '../../../../src/middleware/auth';
import { logger } from '../../../../src/utils/logger';

const onboardingService = new MarketMakerOnboardingService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { marketMakerId } = req.query;
    const { pairs } = req.body;

    if (!marketMakerId || typeof marketMakerId !== 'string') {
      return res.status(400).json({ error: 'Invalid market maker ID' });
    }

    if (!pairs || !Array.isArray(pairs) || pairs.length === 0) {
      return res.status(400).json({ error: 'Invalid pairs array' });
    }

    // Validate pair format
    for (const pair of pairs) {
      if (!pair.baseCurrency || !pair.quoteCurrency) {
        return res.status(400).json({ 
          error: 'Each pair must have baseCurrency and quoteCurrency' 
        });
      }
    }

    await onboardingService.updateSupportedPairs(marketMakerId, pairs);

    res.status(200).json({
      success: true,
      message: 'Trading pairs updated successfully',
    });
  } catch (error) {
    logger.error('Error updating trading pairs:', error);
    res.status(500).json({ error: 'Failed to update trading pairs' });
  }
}

export default authMiddleware(handler);