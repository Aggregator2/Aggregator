// Example: How to apply rate limiting to Next.js API routes

import { NextApiRequest, NextApiResponse } from 'next';
import { withRateLimiting } from './applyRateLimiting';

// Example 1: Public endpoint with default rate limit (100 req/min)
export const publicEndpointExample = async (req: NextApiRequest, res: NextApiResponse) => {
  // Your API logic here
  res.status(200).json({ message: 'Public endpoint response' });
};

// Apply public rate limiting
export default withRateLimiting(publicEndpointExample as any, 'public');

// Example 2: Trading endpoint with strict rate limit (10 req/sec)
export const tradingEndpointExample = async (req: NextApiRequest, res: NextApiResponse) => {
  // Your trading logic here
  res.status(200).json({ message: 'Trading endpoint response' });
};

// Apply trading rate limiting
export const tradingHandler = withRateLimiting(tradingEndpointExample as any, 'trading');

// Example 3: Authentication endpoint with strict rate limit (10 req/5min)
export const authEndpointExample = async (req: NextApiRequest, res: NextApiResponse) => {
  // Your auth logic here
  res.status(200).json({ message: 'Auth endpoint response' });
};

// Apply strict rate limiting
export const authHandler = withRateLimiting(authEndpointExample as any, 'strict');

// Example 4: Manual rate limiting in existing endpoints
import { publicRateLimiter, tradingRateLimiter } from './rateLimiter';

export const manualRateLimitExample = async (req: NextApiRequest, res: NextApiResponse) => {
  // Apply rate limiting manually
  await new Promise<void>((resolve, reject) => {
    tradingRateLimiter(req as any, res as any, (err?: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
  
  // Your API logic here
  res.status(200).json({ message: 'Manual rate limit applied' });
};