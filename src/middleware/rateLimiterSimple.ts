// Simple rate limiter for Vercel deployment
import { NextApiRequest, NextApiResponse } from 'next';

// In-memory store for rate limiting (resets on each deployment)
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function rateLimiter(windowMs: number = 60000, max: number = 100) {
  return async (req: NextApiRequest, res: NextApiResponse, next: () => void) => {
    const identifier = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'anonymous';
    const key = `${identifier}:${req.url}`;
    const now = Date.now();
    
    const record = requestCounts.get(key);
    
    if (!record || record.resetTime < now) {
      requestCounts.set(key, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }
    
    if (record.count >= max) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    
    record.count++;
    next();
  };
}

// Export specific rate limiters
export const publicRateLimiter = rateLimiter(60000, 100);
export const authRateLimiter = rateLimiter(60000, 200);
export const sensitiveRateLimiter = rateLimiter(60000, 10);

// Default export for compatibility
export default rateLimiter;