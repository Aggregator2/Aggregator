import { NextApiRequest, NextApiResponse } from 'next';
import { MarketMakerOnboardingService } from '../../../../../src/services/marketMaker/onboarding/MarketMakerOnboardingService';
import { authMiddleware } from '../../../../../src/middleware/auth';
import { logger } from '../../../../../src/utils/logger';

const onboardingService = new MarketMakerOnboardingService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { marketMakerId } = req.query;
    const userRole = (req as any).role;

    if (!marketMakerId || typeof marketMakerId !== 'string') {
      return res.status(400).json({ error: 'Invalid market maker ID' });
    }

    // Only admins can test market maker integrations
    if (userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const testResults = await onboardingService.testTechnicalIntegration(marketMakerId);

    res.status(200).json({
      success: true,
      data: {
        testResults,
        allTestsPassed: testResults.errors.length === 0,
      },
    });
  } catch (error: any) {
    logger.error('Error testing integration:', error);
    
    if (error.message === 'Market maker not found') {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to test integration' });
  }
}

export default authMiddleware(handler);