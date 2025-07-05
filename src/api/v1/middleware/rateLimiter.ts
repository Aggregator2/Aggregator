import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

// Redis client for distributed rate limiting
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// Connect to Redis
redisClient.connect().catch(console.error);

// Different rate limit configurations for different endpoint types
export const createRateLimiter = (options: {
  windowMs?: number;
  max?: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    max = 100, // 100 requests per window default
    message = 'Too many requests from this IP, please try again later.',
    keyGenerator = (req: Request) => req.ip || 'unknown'
  } = options;

  return rateLimit({
    store: new RedisStore({
      client: redisClient,
      prefix: 'rl:',
    }),
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message,
        retryAfter: Math.round(windowMs / 1000)
      });
    }
  });
};

// Predefined rate limiters for different use cases
export const rateLimiters = {
  // Strict rate limiting for sensitive operations
  strict: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: 'Too many sensitive requests, please try again later.'
  }),

  // Standard rate limiting for regular API calls
  standard: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100
  }),

  // Relaxed rate limiting for read-heavy operations
  relaxed: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500
  }),

  // Per-user rate limiting
  perUser: createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200,
    keyGenerator: (req: Request) => {
      // Use user ID if authenticated, otherwise fall back to IP
      return req.user?.id || req.ip || 'unknown';
    }
  })
};