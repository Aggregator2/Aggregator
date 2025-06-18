import { NextApiRequest, NextApiResponse } from 'next';

// Simple in-memory storage for orders (replace with database later)
let orders: any[] = [];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method === 'GET') {
            // Return orders from memory (simplified for now)
            return res.status(200).json(orders);
        } else if (req.method === 'POST') {
            const { order, signature } = req.body;
            
            // Basic validation
            if (!order) {
                return res.status(400).json({ error: 'Missing order data' });
            }
            
            // Add order to memory with timestamp
            const orderWithMetadata = {
                ...order,
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                signature
            };
            
            orders.unshift(orderWithMetadata); // Add to beginning
            
            // Keep only last 100 orders
            if (orders.length > 100) {
                orders = orders.slice(0, 100);
            }
            
            console.log('Order stored:', orderWithMetadata.id);
            return res.status(200).json({ ok: true, orderId: orderWithMetadata.id });
        } else {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
        }
    } catch (err) {
        console.error('Orders API error:', err);
        return res.status(500).json({ 
            error: 'Internal server error',
            details: err instanceof Error ? err.message : 'Unknown error'
        });
    }
}