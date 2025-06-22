import { NextApiRequest, NextApiResponse } from 'next';
import { unifiedSwapService, UnifiedQuoteRequest } from '../../src/services/unifiedSwapService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      fromChain,
      toChain,
      fromToken,
      toToken,
      fromAmount,
      fromAddress,
      toAddress,
      slippage
    } = req.body;

    // Validate required fields
    if (!fromChain || !toChain || !fromToken || !toToken || !fromAmount || !fromAddress) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['fromChain', 'toChain', 'fromToken', 'toToken', 'fromAmount', 'fromAddress']
      });
    }

    const quoteRequest: UnifiedQuoteRequest = {
      fromChain: parseInt(fromChain),
      toChain: parseInt(toChain),
      fromToken,
      toToken,
      fromAmount,
      fromAddress,
      toAddress: toAddress || fromAddress,
      slippage: slippage || 0.5
    };

    const quote = await unifiedSwapService.getQuote(quoteRequest);

    res.status(200).json({
      success: true,
      quote,
      request: quoteRequest
    });
  } catch (error) {
    console.error('Error getting swap quote:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get swap quote',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}