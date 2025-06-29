import { NextApiRequest, NextApiResponse } from 'next';
import { BestExecutionService } from '../../../../src/services/marketMaker/execution/BestExecutionService';
import { authMiddleware } from '../../../../src/middleware/auth';
import { logger } from '../../../../src/utils/logger';

const executionService = new BestExecutionService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = (req as any).userId;
    const { rfqId } = req.query;
    const { strategy } = req.body;

    if (!rfqId || typeof rfqId !== 'string') {
      return res.status(400).json({ error: 'Invalid RFQ ID' });
    }

    // Validate strategy if provided
    if (strategy) {
      const validTypes = ['IMMEDIATE', 'TWAP', 'VWAP', 'ICEBERG'];
      if (!validTypes.includes(strategy.type)) {
        return res.status(400).json({ 
          error: 'Invalid strategy type',
          validTypes 
        });
      }
    }

    // Execute RFQ
    const executionReport = await executionService.executeRFQ(
      rfqId,
      userId,
      strategy || { type: 'IMMEDIATE' }
    );

    res.status(200).json({
      success: true,
      data: {
        rfqId: executionReport.rfqId,
        strategy: executionReport.strategy,
        status: executionReport.status,
        totalExecutedSize: executionReport.totalExecutedSize.toString(),
        averagePrice: executionReport.averagePrice.toString(),
        totalCost: executionReport.totalCost.toString(),
        totalFees: executionReport.totalFees.toString(),
        slippage: executionReport.slippage.toString(),
        executionTime: executionReport.executionTime,
        trades: executionReport.trades.map(trade => ({
          id: trade.id,
          marketMakerId: trade.marketMakerId,
          price: trade.price.toString(),
          baseAmount: trade.baseAmount.toString(),
          quoteAmount: trade.quoteAmount.toString(),
          executedAt: trade.executedAt,
        })),
      },
    });
  } catch (error: any) {
    logger.error('Error executing RFQ:', error);
    
    if (error.message === 'RFQ not found or unauthorized') {
      return res.status(404).json({ error: error.message });
    }
    
    if (error.message.includes('Invalid')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to execute RFQ' });
  }
}

export default authMiddleware(handler);