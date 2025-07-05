import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';
import { Request, Response } from 'express';

// Create Redis client
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
  }
});

// Connect to Redis
redisClient.connect().catch((err) => {
  console.error('Redis connection error:', err);
  console.log('Falling back to in-memory rate limiting');
});

// Error handler for rate limit exceeded
const rateLimitHandler = (req: Request, res: Response) => {
  res.status(429).json({ 
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter: res.getHeader('Retry-After')
  });
};

// Public endpoints rate limiter (100 requests per minute)
export const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: redisClient.isOpen ? new RedisStore({
    client: redisClient,
    prefix: 'rl:public:'
  }) : undefined
});

// Authenticated endpoints rate limiter (1000 requests per minute)
export const authenticatedRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: redisClient.isOpen ? new RedisStore({
    client: redisClient,
    prefix: 'rl:auth:'
  }) : undefined,
  keyGenerator: (req: Request) => {
    // Use user ID if available, otherwise fall back to IP
    return (req as any).user?.id || req.ip;
  }
});

// Trading endpoints rate limiter (10 requests per second)
export const tradingRateLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: redisClient.isOpen ? new RedisStore({
    client: redisClient,
    prefix: 'rl:trading:'
  }) : undefined,
  keyGenerator: (req: Request) => {
    // Use user ID if available, otherwise fall back to IP
    return (req as any).user?.id || req.ip;
  }
});

// Strict rate limiter for sensitive endpoints (10 requests per 5 minutes)
export const strictRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: redisClient.isOpen ? new RedisStore({
    client: redisClient,
    prefix: 'rl:strict:'
  }) : undefined,
  keyGenerator: (req: Request) => {
    // Use user ID if available, otherwise fall back to IP
    return (req as any).user?.id || req.ip;
  }
});

// WebSocket rate limiter (100 connections per minute per IP)
export const websocketRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: redisClient.isOpen ? new RedisStore({
    client: redisClient,
    prefix: 'rl:ws:'
  }) : undefined
});

// Default rate limiter export
export const rateLimiter = publicRateLimiter;