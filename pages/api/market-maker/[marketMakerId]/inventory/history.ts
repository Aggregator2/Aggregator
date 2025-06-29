import { NextApiRequest, NextApiResponse } from 'next';
import { InventoryManagementService } from '../../../../../src/services/marketMaker/inventory/InventoryManagementService';
import { authMiddleware } from '../../../../../src/middleware/auth';
import { logger } from '../../../../../src/utils/logger';

const inventoryService = new InventoryManagementService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { marketMakerId } = req.query;
    const { 
      currency, 
      startDate, 
      endDate, 
      limit = '100' 
    } = req.query;

    if (!marketMakerId || typeof marketMakerId !== 'string') {
      return res.status(400).json({ error: 'Invalid market maker ID' });
    }

    const history = await inventoryService.getInventoryHistory(
      marketMakerId,
      currency as string | undefined,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined,
      parseInt(limit as string)
    );

    res.status(200).json({
      success: true,
      data: {
        marketMakerId,
        events: history.map(event => ({
          id: event.id,
          currency: event.currency,
          eventType: event.eventType,
          amount: event.amount.toString(),
          balanceBefore: event.balanceBefore.toString(),
          balanceAfter: event.balanceAfter.toString(),
          referenceId: event.referenceId,
          referenceType: event.referenceType,
          description: event.description,
          createdAt: event.createdAt,
        })),
        count: history.length,
      },
    });
  } catch (error) {
    logger.error('Error getting inventory history:', error);
    res.status(500).json({ error: 'Failed to get inventory history' });
  }
}

export default authMiddleware(handler);