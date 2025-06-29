import { NextApiRequest, NextApiResponse } from 'next';
import { QuoteCompetitionService } from '../../../src/services/marketMaker/competition/QuoteCompetitionService';
import { authMiddleware } from '../../../src/middleware/auth';
import { logger } from '../../../src/utils/logger';

const competitionService = new QuoteCompetitionService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { period = 'DAILY' } = req.query;

    const validPeriods = ['DAILY', 'WEEKLY', 'MONTHLY', 'ALL_TIME'];
    if (!validPeriods.includes(period as string)) {
      return res.status(400).json({ 
        error: 'Invalid period',
        validPeriods 
      });
    }

    const leaderboard = await competitionService.getLeaderboard(
      period as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ALL_TIME'
    );

    res.status(200).json({
      success: true,
      data: {
        period: leaderboard.period,
        startDate: leaderboard.startDate,
        endDate: leaderboard.endDate,
        rankings: leaderboard.rankings.map(metrics => ({
          rank: leaderboard.rankings.indexOf(metrics) + 1,
          marketMakerId: metrics.marketMakerId,
          marketMakerName: metrics.marketMakerName,
          quotesSubmitted: metrics.quotesSubmitted,
          quotesWon: metrics.quotesWon,
          winRate: metrics.winRate.toFixed(2),
          averageSpread: metrics.averageSpread.toFixed(2),
          averageResponseTime: Math.round(metrics.averageResponseTime),
          totalVolume: metrics.totalVolume.toString(),
          improvementCount: metrics.improvementCount,
          averageImprovement: metrics.averageImprovement.toFixed(2),
        })),
      },
    });
  } catch (error) {
    logger.error('Error getting competition leaderboard:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
}

export default authMiddleware(handler);