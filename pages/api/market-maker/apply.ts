import { NextApiRequest, NextApiResponse } from 'next';
import { MarketMakerOnboardingService } from '../../../src/services/marketMaker/onboarding/MarketMakerOnboardingService';
import { rateLimiter } from '../../../src/middleware/rateLimiterSimple';
import { logger } from '../../../src/utils/logger';

const onboardingService = new MarketMakerOnboardingService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      name,
      email,
      companyName,
      websocketUrl,
      webhookUrl,
      supportedPairs,
      minQuoteSize,
      maxQuoteSize,
      quoteExpiry,
      settlementAddress,
      metadata,
    } = req.body;

    // Validate required fields
    if (!name || !email || !companyName || !supportedPairs || supportedPairs.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'email', 'companyName', 'supportedPairs']
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Submit application
    const result = await onboardingService.submitApplication({
      name,
      email,
      companyName,
      websocketUrl,
      webhookUrl,
      supportedPairs,
      minQuoteSize,
      maxQuoteSize,
      quoteExpiry,
      settlementAddress,
      metadata,
    });

    res.status(201).json({
      success: true,
      data: {
        marketMakerId: result.marketMaker.id,
        code: result.marketMaker.code,
        apiKey: result.apiKey,
        status: result.marketMaker.status,
        onboardingSteps: result.onboardingSteps,
        message: 'Application submitted successfully. Please save your API key securely.',
      },
    });
  } catch (error) {
    logger.error('Error submitting market maker application:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
}

export default rateLimiter(handler);