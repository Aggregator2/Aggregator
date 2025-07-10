import { NonceService } from '../../src/services/nonceService';

const nonceService = new NonceService();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { address } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    // Generate unique nonce for the wallet
    const nonce = await nonceService.generateNonce(address);
    
    return res.status(200).json({ 
      nonce,
      address,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Nonce generation error:', error);
    
    // If Redis is not available, generate a simple nonce
    const fallbackNonce = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    return res.status(200).json({ 
      nonce: fallbackNonce,
      address: req.query.address,
      timestamp: new Date().toISOString(),
      warning: 'Using fallback nonce generation'
    });
  }
}