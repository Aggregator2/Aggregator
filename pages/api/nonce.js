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

    // Generate a simple nonce without Redis dependency
    const nonce = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    return res.status(200).json({ 
      nonce,
      address,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Nonce generation error:', error);
    
    return res.status(500).json({ 
      error: 'Failed to generate nonce',
      message: error.message
    });
  }
}