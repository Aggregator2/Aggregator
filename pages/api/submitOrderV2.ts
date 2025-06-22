import { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { addMockRevenue } from './revenue/status';

// In-memory order storage (replace with database in production)
const orders: Record<string, any> = {};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { order, signature } = req.body;
  
  try {
    // Validate order
    if (!order || !signature) {
      return res.status(400).json({ error: 'Missing order or signature' });
    }
    
    // Skip signature verification for testing
    // In production, implement proper EIP-712 verification here
    const isMockSignature = signature.startsWith('0xab') || signature.startsWith('0xcd');
    if (!isMockSignature) {
      // Perform actual signature verification
      // For now, we'll accept all signatures for testing
      console.log('[Order] Signature verification skipped for testing');
    }
    
    // Generate order ID
    const orderId = Date.now().toString();
    
    // Store order
    orders[orderId] = {
      id: orderId,
      order,
      signature,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    console.log('[Order Submitted]', {
      orderId,
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      sellAmount: order.sellAmount,
      user: order.user,
      feeAmount: order.feeAmount
    });
    
    // Track revenue (5% of trade value)
    if (order.feeAmount && order.feeAmount !== '0') {
      const feeWei = BigInt(order.feeAmount);
      const feeETH = parseFloat(ethers.formatEther(feeWei));
      
      // Add to revenue accumulator
      addMockRevenue(feeETH, 'ETH');
      
      console.log('[Revenue Tracked]', {
        orderId,
        feeETH,
        usdValue: feeETH * 2000 // Assuming $2000/ETH
      });
    }
    
    // Return success response
    return res.status(200).json({
      orderId,
      status: 'submitted',
      message: 'Order submitted successfully'
    });
    
  } catch (error) {
    console.error('[Order Submission Error]', error);
    return res.status(500).json({ 
      error: 'Failed to submit order',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}