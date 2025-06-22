import { NextApiRequest, NextApiResponse } from 'next';

// In-memory dispute storage (replace with database in production)
const disputes: any[] = [];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    // Log a new dispute
    const { orderId, type, reason, userId, timestamp } = req.body;
    
    const dispute = {
      id: Date.now().toString(),
      orderId,
      type,
      reason,
      userId,
      timestamp,
      status: 'pending',
      resolution: null,
      createdAt: new Date().toISOString()
    };
    
    disputes.push(dispute);
    
    console.log('[Dispute Logged]', dispute);
    
    return res.status(201).json(dispute);
  } else if (req.method === 'GET') {
    // Get disputes, optionally filtered by orderId
    const { orderId } = req.query;
    
    if (orderId) {
      const orderDisputes = disputes.filter(d => d.orderId === orderId);
      return res.status(200).json(orderDisputes);
    }
    
    return res.status(200).json(disputes);
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}