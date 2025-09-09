import { SwappiqAPI } from '../../lib/swappiq-api';

const api = new SwappiqAPI(process.env.SWAPPIQ_API_BASE_URL || 'http://localhost:3000');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.substring(7);
    
    // For now, just forward the request to the backend API
    const result = await api.submitOrder(req.body, token);
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Submit order error:', error);
    
    // Handle specific error types
    if (error.message?.includes('401')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (error.message?.includes('400')) {
      return res.status(400).json({ 
        error: 'Invalid order parameters',
        details: error.message 
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to submit order',
      message: error.message 
    });
  }
}