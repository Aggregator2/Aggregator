import type { NextApiRequest, NextApiResponse } from 'next';
import { profitableQuoteService } from '../../src/services/profitableQuoteService';
import { ethers } from 'ethers';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sellToken, buyToken, sellAmount, user, chainId = 1, toChainId, slippagePercentage = 0.5 } = req.body;
    
    console.log('Quote request received:', { sellToken, buyToken, sellAmount, chainId, toChainId });
    console.log('Environment check - LIFI_API_KEY:', !!process.env.LIFI_API_KEY ? 'Present' : 'Missing');

    // Validate inputs
    if (!sellToken || !buyToken || !sellAmount) {
      return res.status(400).json({ 
        error: 'Missing required parameters: sellToken, buyToken, sellAmount' 
      });
    }

    // Validate addresses based on chain
    if (chainId === 101) {
      // Solana uses base58 addresses, validate basic format
      const isValidSolanaAddress = (addr: string) => {
        // Solana addresses are typically 32-44 characters base58
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
      };
      
      if (!isValidSolanaAddress(sellToken) || !isValidSolanaAddress(buyToken)) {
        return res.status(400).json({ 
          error: 'Invalid Solana token addresses' 
        });
      }
    } else {
      // EVM chains use hex addresses
      if (!ethers.isAddress(sellToken) || !ethers.isAddress(buyToken)) {
        return res.status(400).json({ 
          error: 'Invalid token addresses' 
        });
      }
    }

    // Check for same token swap (only on same chain)
    const isCrossChain = toChainId && toChainId !== chainId;
    if (!isCrossChain && sellToken.toLowerCase() === buyToken.toLowerCase()) {
      return res.status(400).json({ 
        error: 'Cannot swap the same token on the same chain' 
      });
    }

    // Check for zero or negative amount
    try {
      const amount = BigInt(sellAmount);
      if (amount <= 0n) {
        return res.status(400).json({ 
          error: 'Sell amount must be greater than zero' 
        });
      }
      
      // Check for unreasonably large amounts (more than 10^30)
      const maxAmount = BigInt(10) ** BigInt(30);
      if (amount > maxAmount) {
        return res.status(400).json({ 
          error: 'Sell amount is too large' 
        });
      }
    } catch (e) {
      return res.status(400).json({ 
        error: 'Invalid sell amount format' 
      });
    }

    // Get profitable quote with hidden fees
    const profitableQuote = await profitableQuoteService.getProfitableQuote({
      sellToken,
      buyToken,
      sellAmount,
      chainId,
      toChainId: toChainId || chainId, // Support cross-chain if toChainId is provided
      userAddress: user,
      slippagePercentage: slippagePercentage,
    });

    // Calculate minimum received after slippage
    const buyAmountBN = BigInt(profitableQuote.buyAmount);
    const slippageBps = Math.floor(slippagePercentage * 100); // Convert percentage to basis points
    const slippageAmount = (buyAmountBN * BigInt(slippageBps)) / BigInt(10000);
    const minReceived = buyAmountBN - slippageAmount;
    
    // Build response - only expose user-facing fields
    const response = {
      // User-facing quote data
      sellToken: profitableQuote.sellToken,
      buyToken: profitableQuote.buyToken,
      sellAmount: profitableQuote.sellAmount,
      buyAmount: profitableQuote.buyAmount, // Already has hidden fee applied
      minReceived: minReceived.toString(), // Minimum after slippage
      
      // Price information
      price: profitableQuote.price,
      guaranteedPrice: profitableQuote.guaranteedPrice,
      
      // Transaction data
      to: profitableQuote.to,
      data: profitableQuote.data,
      value: profitableQuote.value,
      gas: profitableQuote.gas,
      gasPrice: profitableQuote.gasPrice,
      
      // Source information (safe to expose)
      source: profitableQuote.source,
      sources: profitableQuote.sources,
      
      // Validity
      validTo: profitableQuote.validTo,
      
      // Do NOT expose these internal fields to the user:
      // - originalQuote
      // - feeAmount
      // - feeBps
      // - expectedProfit
      // - rebateEarned
      // - arbitrageProfit
      // - _internal
    };

    // Log profit data only in debug mode
    if (process.env.DEBUG) {
      console.log('[PROFITABLE QUOTE GENERATED]', {
        quoteId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        pair: `${sellToken}/${buyToken}`,
        hiddenFee: {
          amount: profitableQuote.feeAmount,
          bps: profitableQuote.feeBps,
        },
        rebate: {
          source: profitableQuote.rebateSource,
          amount: profitableQuote.rebateEarned,
          bps: profitableQuote.rebateBps,
        },
        arbitrage: {
          opportunity: profitableQuote.arbitrageOpportunity,
          profit: profitableQuote.arbitrageProfit,
        },
        totalRevenue: profitableQuote._internal.totalRevenue,
      });
    }

    res.status(200).json(response);

  } catch (error: any) {
    console.error('Quote generation failed:', error);
    
    // Don't expose internal error details
    const userError = error.message?.includes('No quotes available') 
      ? 'Unable to generate quote for this pair' 
      : 'Quote generation failed';
    
    res.status(500).json({ 
      error: userError,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}