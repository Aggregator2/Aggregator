import { NextApiRequest, NextApiResponse } from 'next';
import { InventoryManagementService } from '../../../../../src/services/marketMaker/inventory/InventoryManagementService';
import { authMiddleware } from '../../../../../src/middleware/auth';
import { logger } from '../../../../../src/utils/logger';

const inventoryService = new InventoryManagementService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { marketMakerId } = req.query;
    const { externalBalances } = req.body;

    if (!marketMakerId || typeof marketMakerId !== 'string') {
      return res.status(400).json({ error: 'Invalid market maker ID' });
    }

    if (!externalBalances || typeof externalBalances !== 'object') {
      return res.status(400).json({ error: 'External balances object is required' });
    }

    // Convert object to Map
    const balancesMap = new Map(Object.entries(externalBalances).map(
      ([currency, balance]) => [currency, String(balance)]
    ));

    const result = await inventoryService.reconcileInventory(
      marketMakerId,
      balancesMap
    );

    res.status(200).json({
      success: true,
      data: {
        marketMakerId,
        discrepancies: result.discrepancies.map(d => ({
          currency: d.currency,
          internalBalance: d.internalBalance.toString(),
          externalBalance: d.externalBalance.toString(),
          difference: d.difference.toString(),
          percentageDiff: d.internalBalance.gt(0) 
            ? d.difference.div(d.internalBalance).mul(100).toFixed(2) 
            : '100',
        })),
        totalDiscrepancy: result.totalDiscrepancy.toString(),
        hasDiscrepancies: result.discrepancies.length > 0,
      },
    });
  } catch (error) {
    logger.error('Error reconciling inventory:', error);
    res.status(500).json({ error: 'Failed to reconcile inventory' });
  }
}

export default authMiddleware(handler);