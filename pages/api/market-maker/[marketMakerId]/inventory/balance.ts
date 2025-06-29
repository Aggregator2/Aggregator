import { NextApiRequest, NextApiResponse } from 'next';
import { InventoryManagementService } from '../../../../../src/services/marketMaker/inventory/InventoryManagementService';
import { authMiddleware } from '../../../../../src/middleware/auth';
import { logger } from '../../../../../src/utils/logger';

const inventoryService = new InventoryManagementService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { marketMakerId } = req.query;

  if (!marketMakerId || typeof marketMakerId !== 'string') {
    return res.status(400).json({ error: 'Invalid market maker ID' });
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, marketMakerId);
    case 'POST':
      return handlePost(req, res, marketMakerId);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  marketMakerId: string
) {
  try {
    // Get price map from query params (optional)
    const pricesParam = req.query.prices as string;
    let prices: Map<string, number> | undefined;
    
    if (pricesParam) {
      try {
        const pricesObj = JSON.parse(pricesParam);
        prices = new Map(Object.entries(pricesObj).map(([k, v]) => [k, Number(v)]));
      } catch (e) {
        logger.warn('Invalid prices parameter');
      }
    }

    const snapshot = await inventoryService.getInventorySnapshot(marketMakerId, prices);

    res.status(200).json({
      success: true,
      data: {
        marketMakerId: snapshot.marketMakerId,
        timestamp: snapshot.timestamp,
        balances: snapshot.balances.map(b => ({
          currency: b.currency,
          balance: b.balance.toString(),
          available: b.available.toString(),
          locked: b.locked.toString(),
          usdValue: b.usdValue?.toString(),
        })),
        totalUsdValue: snapshot.totalUsdValue.toString(),
      },
    });
  } catch (error) {
    logger.error('Error getting inventory snapshot:', error);
    res.status(500).json({ error: 'Failed to get inventory snapshot' });
  }
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  marketMakerId: string
) {
  try {
    const {
      currency,
      amount,
      eventType,
      referenceId,
      referenceType,
      description,
    } = req.body;

    // Validate required fields
    if (!currency || !amount || !eventType) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['currency', 'amount', 'eventType']
      });
    }

    // Validate event type
    const validEventTypes = [
      'DEPOSIT', 'WITHDRAWAL', 'TRADE_BUY', 'TRADE_SELL',
      'FEE', 'REBATE', 'ADJUSTMENT'
    ];
    
    if (!validEventTypes.includes(eventType)) {
      return res.status(400).json({ 
        error: 'Invalid event type',
        validTypes: validEventTypes
      });
    }

    const updatedInventory = await inventoryService.updateBalance({
      marketMakerId,
      currency,
      amount,
      eventType,
      referenceId,
      referenceType,
      description,
    });

    res.status(200).json({
      success: true,
      data: {
        currency: updatedInventory.currency,
        balance: updatedInventory.balance.toString(),
        available: updatedInventory.available.toString(),
        locked: updatedInventory.locked.toString(),
        lastUpdated: updatedInventory.lastUpdated,
      },
    });
  } catch (error: any) {
    logger.error('Error updating inventory balance:', error);
    
    if (error.message.includes('Insufficient')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to update inventory balance' });
  }
}

export default authMiddleware(handler);