export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      sellToken,
      buyToken,
      sellAmount,
      buyAmount,
      takerAddress,
      slippagePercentage = '0.5'
    } = req.query;

    // Validate required parameters
    if (!sellToken || !buyToken || (!sellAmount && !buyAmount) || !takerAddress) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['sellToken', 'buyToken', 'sellAmount or buyAmount', 'takerAddress']
      });
    }

    // Build query params
    const params = new URLSearchParams({
      sellToken,
      buyToken,
      ...(sellAmount && { sellAmount }),
      ...(buyAmount && { buyAmount }),
      takerAddress,
      slippagePercentage
    });

    // Call 0x API
    const zeroExApiUrl = 'https://api.0x.org/swap/v1/quote';
    const response = await fetch(`${zeroExApiUrl}?${params}`, {
      headers: {
        '0x-api-key': process.env.ZEROX_API_KEY || ''
      }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('0x API error:', error);
      return res.status(response.status).json({ 
        error: '0x API error',
        details: error,
        message: 'Failed to get quote from 0x'
      });
    }

    const quote = await response.json();
    return res.status(200).json(quote);
  } catch (error) {
    console.error('Quote error:', error);
    return res.status(500).json({ 
      error: 'Failed to get quote',
      message: error.message 
    });
  }
}