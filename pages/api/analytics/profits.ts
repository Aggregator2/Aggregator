import type { NextApiRequest, NextApiResponse } from 'next';
import { profitableQuoteService } from '../../../src/services/profitableQuoteService';

// This endpoint is for internal analytics only
// Should be protected with authentication in production
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check for internal API key (in production)
    const apiKey = req.headers['x-internal-api-key'];
    if (process.env.NODE_ENV === 'production' && apiKey !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { timeframe = 'day' } = req.query;
    
    // Get profit analytics
    const analytics = await (profitableQuoteService as any).profitLogger.getAnalytics(
      timeframe as 'hour' | 'day' | 'week'
    );

    res.status(200).json({
      success: true,
      analytics,
      generated: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Analytics generation failed:', error);
    res.status(500).json({ 
      error: 'Failed to generate analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}