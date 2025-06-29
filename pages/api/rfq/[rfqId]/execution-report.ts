import { NextApiRequest, NextApiResponse } from 'next';
import { BestExecutionService } from '../../../../src/services/marketMaker/execution/BestExecutionService';
import { authMiddleware } from '../../../../src/middleware/auth';
import { logger } from '../../../../src/utils/logger';

const executionService = new BestExecutionService();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = (req as any).userId;
    const { rfqId } = req.query;

    if (!rfqId || typeof rfqId !== 'string') {
      return res.status(400).json({ error: 'Invalid RFQ ID' });
    }

    const report = await executionService.getExecutionReport(rfqId, userId);

    if (!report) {
      return res.status(404).json({ error: 'Execution report not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        rfqId: report.rfqId,
        strategy: report.strategy,
        status: report.status,
        totalExecutedSize: report.totalExecutedSize.toString(),
        averagePrice: report.averagePrice.toString(),
        totalCost: report.totalCost.toString(),
        totalFees: report.totalFees.toString(),
        slippage: report.slippage.toString(),
        executionTime: report.executionTime,
        trades: report.trades.map(trade => ({
          id: trade.id,
          marketMakerId: trade.marketMakerId,
          price: trade.price.toString(),
          baseAmount: trade.baseAmount.toString(),
          quoteAmount: trade.quoteAmount.toString(),
          fee: trade.fee.toString(),
          rebate: trade.rebate.toString(),
          status: trade.status,
          executedAt: trade.executedAt,
        })),
        quotes: report.quotes.map(quote => ({
          id: quote.id,
          marketMakerId: quote.marketMakerId,
          price: quote.price.toString(),
          size: quote.size.toString(),
          status: quote.status,
        })),
      },
    });
  } catch (error) {
    logger.error('Error getting execution report:', error);
    res.status(500).json({ error: 'Failed to get execution report' });
  }
}

export default authMiddleware(handler);