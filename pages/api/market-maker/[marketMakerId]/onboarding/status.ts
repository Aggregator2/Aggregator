import { NextApiRequest, NextApiResponse } from 'next';
import { MarketMakerOnboardingService } from '../../../../../src/services/marketMaker/onboarding/MarketMakerOnboardingService';
import { authMiddleware } from '../../../../../src/middleware/auth';
import { logger } from '../../../../../src/utils/logger';

const onboardingService = new MarketMakerOnboardingService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { marketMakerId } = req.query;

    if (!marketMakerId || typeof marketMakerId !== 'string') {
      return res.status(400).json({ error: 'Invalid market maker ID' });
    }

    const status = await onboardingService.getOnboardingStatus(marketMakerId);

    res.status(200).json({
      success: true,
      data: {
        marketMaker: {
          id: status.marketMaker.id,
          name: status.marketMaker.name,
          code: status.marketMaker.code,
          status: status.marketMaker.status,
          supportedPairs: status.marketMaker.supportedPairs,
          isActive: status.marketMaker.isActive,
        },
        onboardingSteps: status.onboardingSteps,
        progress: status.progress,
      },
    });
  } catch (error: any) {
    logger.error('Error getting onboarding status:', error);
    
    if (error.message === 'Market maker not found') {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
}

export default authMiddleware(handler);