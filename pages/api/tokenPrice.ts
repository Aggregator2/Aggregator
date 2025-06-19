import { NextApiRequest, NextApiResponse } from 'next';

const ADDRESS_TO_COINGECKO_ID: Record<string, string> = {
  // Ethereum mainnet
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": "ethereum",
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": "ethereum", // WETH Arbitrum
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": "ethereum", // WETH mainnet
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": "dai", // DAI Arbitrum
  "0x6B175474E89094C44Da98b954EedeAC495271d0F": "dai", // DAI mainnet
  "0xA0b86a33E6417a2f0A87c1A8aBE4e74B8D6fcb3b6": "usd-coin", // USDC
  "0xdAC17F958D2ee523a2206206994597C13D831ec7": "tether", // USDT
  "0x514910771AF9Ca656af840dff83E8264EcF986CA": "chainlink", // LINK
  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984": "uniswap", // UNI
  "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9": "aave", // AAVE
  "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0": "matic-network", // MATIC
  "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE": "shiba-inu", // SHIB
  "0x9d47894f8becb68b9cf3428d256311affe8b068b": "rope-token",
};

// Mock prices for tokens not in CoinGecko or when API fails
const FALLBACK_PRICES: Record<string, number> = {
  // Common stablecoins
  "dai": 1,
  "usd-coin": 1,
  "tether": 1,
  "binance-usd": 1,
  // Major tokens
  "ethereum": 2400,
  "chainlink": 15,
  "uniswap": 7,
  "aave": 85,
  "matic-network": 0.80,
  "shiba-inu": 0.00001,
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

  // Handle non-Ethereum addresses (like Stellar)
  if (!tokenAddress.startsWith('0x')) {
    return res.status(200).json({ 
      price: 1, // Default price for non-Ethereum tokens
      currency: 'USD',
      source: 'default'
    });
  }
  
  const coingeckoId = ADDRESS_TO_COINGECKO_ID[tokenAddress.toLowerCase()];
  
  // If token not mapped, return a default price
  if (!coingeckoId) {
    return res.status(200).json({ 
      price: Math.random() * 10 + 0.1, // Random price between 0.1 and 10.1
      currency: 'USD',
      source: 'mock'
    });
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
      
      // Use fallback price if available
      const fallbackPrice = FALLBACK_PRICES[coingeckoId];
      if (fallbackPrice) {
        return {
          price: fallbackPrice,
          source: 'fallback',
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