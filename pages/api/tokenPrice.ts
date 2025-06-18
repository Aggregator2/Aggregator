import { NextApiRequest, NextApiResponse } from 'next';

const ADDRESS_TO_COINGECKO_ID: Record<string, string> = {
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": "ethereum",
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": "ethereum", // WETH
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": "dai", // DAI
  "0x9d47894f8becb68b9cf3428d256311affe8b068b": "rope-token",
};

// Cache prices for 60 seconds to avoid rate limiting
const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_DURATION = 60 * 1000; // 60 seconds

// Track ongoing requests to prevent duplicate API calls
const ongoingRequests = new Map<string, Promise<any>>();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tokenAddress } = req.query;
  
  if (!tokenAddress || typeof tokenAddress !== 'string') {
    return res.status(400).json({ error: 'Token address is required' });
  }

  const coingeckoId = ADDRESS_TO_COINGECKO_ID[tokenAddress.toLowerCase()];
  
  if (!coingeckoId) {
    return res.status(404).json({ error: 'Unsupported token' });
  }

  // Check cache
  const cached = priceCache.get(coingeckoId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return res.status(200).json({ price: cached.price });
  }

  // Check if request is already ongoing
  if (ongoingRequests.has(coingeckoId)) {
    try {
      const result = await ongoingRequests.get(coingeckoId);
      return res.status(200).json(result);
    } catch (error) {
      // If ongoing request fails, continue to try fresh request
    }
  }

  // Start new request
  const requestPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
        {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
          }
        }
      );
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limited by price API');
        }
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const price = data[coingeckoId]?.usd;
      
      if (price === undefined) {
        throw new Error('Price data not available');
      }
      
      // Update cache
      priceCache.set(coingeckoId, { price, timestamp: Date.now() });
      
      return { price };
    } catch (error) {
      console.error('Token price fetch error:', error);
      
      // Return cached price if available, even if expired
      const cached = priceCache.get(coingeckoId);
      if (cached) {
        return { 
          price: cached.price, 
          stale: true,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
      
      throw error;
    } finally {
      // Remove from ongoing requests
      ongoingRequests.delete(coingeckoId);
    }
  })();

  ongoingRequests.set(coingeckoId, requestPromise);
  
  try {
    const result = await requestPromise;
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch price' 
    });
  }
}