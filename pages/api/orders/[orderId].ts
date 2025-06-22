import { NextApiRequest, NextApiResponse } from 'next';

// In-memory order storage (replace with database in production)
const orders: Record<string, any> = {};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { orderId } = req.query;
  
  if (req.method === 'GET') {
    // Simulate order status checking
    const order = orders[orderId as string];
    
    if (!order) {
      // Create a simulated order for testing
      const randomStatus = Math.random();
      let status = 'pending';
      let reason = undefined;
      
      // Simulate different outcomes
      if (randomStatus < 0.6) {
        status = 'filled';
      } else if (randomStatus < 0.8) {
        status = 'failed';
        reason = 'Insufficient liquidity';
      } else {
        status = 'timeout';
        reason = 'Order expired before execution';
      }
      
      const simulatedOrder = {
        id: orderId,
        status,
        reason,
        createdAt: new Date(Date.now() - 30000).toISOString(), // 30 seconds ago
        updatedAt: new Date().toISOString(),
        txHash: status === 'filled' ? '0x' + Math.random().toString(16).substring(2, 66) : undefined
      };
      
      orders[orderId as string] = simulatedOrder;
      console.log('[Order Status Check]', simulatedOrder);
      
      return res.status(200).json(simulatedOrder);
    }
    
    return res.status(200).json(order);
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}