import { NextApiRequest, NextApiResponse } from 'next';
import Redis from 'ioredis';

// Rate limit configurations
export interface RateLimitConfig {
  windowMs: number;
  max: number;
  keyPrefix: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: NextApiRequest) => string;
  handler?: (req: NextApiRequest, res: NextApiResponse) => void;
}

// Redis client instance
let redisClient: Redis | null = null;

// Initialize Redis client
function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times: number) => {
        if (times > 3) {
          console.error('Redis connection failed after 3 attempts, using in-memory rate limiting');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      enableOfflineQueue: false
    });

    redisClient.on('error', (err) => {
      console.error('Redis error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis connected for rate limiting');
    });
  }
  return redisClient;
}

// In-memory store fallback
const memoryStore = new Map<string, { count: number; resetTime: number }>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (now > value.resetTime) {
      memoryStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

// Rate limit configurations for different endpoint types
export const rateLimitConfigs = {
  // General API endpoints - 100 requests per 15 minutes
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    keyPrefix: 'rl:general:'
  },
  
  // Sensitive endpoints - 10 requests per 15 minutes
  sensitive: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    keyPrefix: 'rl:sensitive:'
  },
  
  // Trading endpoints - 20 requests per minute
  trading: {
    windowMs: 60 * 1000, // 1 minute
    max: 20,
    keyPrefix: 'rl:trading:'
  },
  
  // Auth endpoints - 5 requests per 15 minutes
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    keyPrefix: 'rl:auth:'
  },
  
  // WebSocket endpoints - 50 requests per minute
  websocket: {
    windowMs: 60 * 1000, // 1 minute
    max: 50,
    keyPrefix: 'rl:ws:'
  },
  
  // Public read endpoints - 200 requests per 15 minutes
  public: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    keyPrefix: 'rl:public:'
  }
};

// Default error handler
const defaultHandler = (req: NextApiRequest, res: NextApiResponse, retryAfter: number) => {
  res.status(429).json({
    success: false,
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter: Math.ceil(retryAfter / 1000) // Convert to seconds
  });
};

// Get client identifier
function getClientId(req: NextApiRequest, keyGenerator?: (req: NextApiRequest) => string): string {
  if (keyGenerator) {
    return keyGenerator(req);
  }
  
  // Try to get user ID from various sources
  const userId = (req as any).user?.id || 
                 (req as any).userId ||
                 req.headers['x-user-id'] ||
                 req.cookies?.userId;
  
  if (userId) {
    return `user:${userId}`;
  }
  
  // Fall back to IP address
  const ip = req.headers['x-forwarded-for'] || 
             req.headers['x-real-ip'] || 
             req.socket?.remoteAddress ||
             'unknown';
  
  return `ip:${Array.isArray(ip) ? ip[0] : ip}`;
}

// Check rate limit using Redis
async function checkRateLimitRedis(
  key: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const redis = getRedisClient();
  const now = Date.now();
  const window = Math.floor(now / config.windowMs);
  const redisKey = `${config.keyPrefix}${key}:${window}`;
  
  try {
    // Use Redis pipeline for atomic operations
    const pipeline = redis.pipeline();
    pipeline.incr(redisKey);
    pipeline.expire(redisKey, Math.ceil(config.windowMs / 1000));
    
    const results = await pipeline.exec();
    if (!results || results.length < 1) {
      throw new Error('Redis pipeline failed');
    }
    
    const count = results[0][1] as number;
    const resetTime = (window + 1) * config.windowMs;
    
    return {
      allowed: count <= config.max,
      remaining: Math.max(0, config.max - count),
      resetTime
    };
  } catch (error) {
    // Fall back to memory store if Redis fails
    console.error('Redis rate limit error:', error);
    return checkRateLimitMemory(key, config);
  }
}

// Check rate limit using in-memory store
function checkRateLimitMemory(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const fullKey = `${config.keyPrefix}${key}`;
  const record = memoryStore.get(fullKey);
  
  if (!record || now > record.resetTime) {
    // Create new record
    const resetTime = now + config.windowMs;
    memoryStore.set(fullKey, { count: 1, resetTime });
    return { allowed: true, remaining: config.max - 1, resetTime };
  }
  
  // Increment count
  record.count++;
  return {
    allowed: record.count <= config.max,
    remaining: Math.max(0, config.max - record.count),
    resetTime: record.resetTime
  };
}

// Rate limiter middleware factory
export function createRateLimiter(config: RateLimitConfig) {
  return async function rateLimiter(
    req: NextApiRequest,
    res: NextApiResponse,
    next: () => void
  ) {
    const clientId = getClientId(req, config.keyGenerator);
    
    // Check if Redis is available
    const redis = getRedisClient();
    const useRedis = redis && redis.status === 'ready';
    
    // Check rate limit
    const result = useRedis
      ? await checkRateLimitRedis(clientId, config)
      : checkRateLimitMemory(clientId, config);
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', config.max.toString());
    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
    
    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      
      if (config.handler) {
        return config.handler(req, res);
      } else {
        return defaultHandler(req, res, result.resetTime - Date.now());
      }
    }
    
    // Continue to next middleware
    next();
  };
}

// Helper function to apply rate limiting to Next.js API routes
export function withRateLimit(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
  configOrName: RateLimitConfig | keyof typeof rateLimitConfigs = 'general'
) {
  const config = typeof configOrName === 'string' 
    ? rateLimitConfigs[configOrName]
    : configOrName;
  
  return async (req: NextApiRequest, res: NextApiResponse) => {
    return new Promise<void>((resolve, reject) => {
      const rateLimiter = createRateLimiter(config);
      
      rateLimiter(req, res, async () => {
        try {
          await handler(req, res);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  };
}

// Helper to apply multiple rate limiters
export function withMultipleRateLimits(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
  configs: Array<RateLimitConfig | keyof typeof rateLimitConfigs>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    // Check all rate limiters
    for (const configOrName of configs) {
      const config = typeof configOrName === 'string' 
        ? rateLimitConfigs[configOrName]
        : configOrName;
      
      const clientId = getClientId(req, config.keyGenerator);
      const redis = getRedisClient();
      const useRedis = redis && redis.status === 'ready';
      
      const result = useRedis
        ? await checkRateLimitRedis(clientId, config)
        : checkRateLimitMemory(clientId, config);
      
      if (!result.allowed) {
        res.setHeader('X-RateLimit-Limit', config.max.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
        
        const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter.toString());
        
        return defaultHandler(req, res, result.resetTime - Date.now());
      }
    }
    
    // All rate limits passed
    return handler(req, res);
  };
}

// Export convenience functions for common patterns
export const withGeneralRateLimit = (handler: any) => withRateLimit(handler, 'general');
export const withSensitiveRateLimit = (handler: any) => withRateLimit(handler, 'sensitive');
export const withTradingRateLimit = (handler: any) => withRateLimit(handler, 'trading');
export const withAuthRateLimit = (handler: any) => withRateLimit(handler, 'auth');
export const withPublicRateLimit = (handler: any) => withRateLimit(handler, 'public');