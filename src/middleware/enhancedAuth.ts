import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRedis, IRateLimiterOptions } from 'rate-limiter-flexible';
import { createClient } from 'redis';
import { requireAuth, withApiKey, AuthenticatedRequest } from './auth';
import { ApiKeyPermission } from '../services/apiKeyService';

// Enhanced request interface with rate limit info
interface RateLimitedRequest extends AuthenticatedRequest {
  rateLimitInfo?: {
    limit: number;
    remaining: number;
    reset: Date;
  };
}

// Rate limiter configurations for different scenarios
const rateLimiterConfigs = {
  // Standard public endpoint protection
  public: {
    points: 100, // Number of requests
    duration: 60, // Per 60 seconds
    blockDuration: 60, // Block for 60 seconds
  },
  
  // Authenticated user endpoints
  authenticated: {
    points: 1000,
    duration: 60,
    blockDuration: 60,
  },
  
  // High-frequency trading endpoints
  trading: {
    points: 10,
    duration: 1,
    blockDuration: 1,
  },
  
  // Sensitive operations (password reset, etc.)
  sensitive: {
    points: 10,
    duration: 300, // 5 minutes
    blockDuration: 300,
  },
  
  // Anti-brute force for login attempts
  bruteForce: {
    points: 5,
    duration: 900, // 15 minutes
    blockDuration: 900,
  },
  
  // DDoS protection - per IP
  ddosProtection: {
    points: 1000,
    duration: 1, // Per second
    blockDuration: 60,
  }
};

// Create rate limiters
class RateLimiterFactory {
  private static redisClient: any;
  private static limiters: Map<string, RateLimiterMemory | RateLimiterRedis> = new Map();

  static async initialize() {
    // Try to connect to Redis
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
        }
      });
      
      await this.redisClient.connect();
      console.log('Connected to Redis for rate limiting');
    } catch (error) {
      console.warn('Redis connection failed, using in-memory rate limiting:', error);
      this.redisClient = null;
    }
  }

  static getRateLimiter(name: string, config: IRateLimiterOptions): RateLimiterMemory | RateLimiterRedis {
    if (!this.limiters.has(name)) {
      const limiter = this.redisClient && this.redisClient.isOpen
        ? new RateLimiterRedis({
            storeClient: this.redisClient,
            keyPrefix: `rl:${name}:`,
            ...config
          })
        : new RateLimiterMemory(config);
      
      this.limiters.set(name, limiter);
    }
    
    return this.limiters.get(name)!;
  }
}

// Initialize rate limiters
RateLimiterFactory.initialize().catch(console.error);

// Enhanced rate limiting middleware with DDoS protection
export function withRateLimit(
  limiterName: keyof typeof rateLimiterConfigs,
  keyGenerator?: (req: Request) => string
) {
  return async (req: RateLimitedRequest, res: Response, next: NextFunction) => {
    try {
      const config = rateLimiterConfigs[limiterName];
      const rateLimiter = RateLimiterFactory.getRateLimiter(limiterName, config);
      
      // Generate key for rate limiting
      const key = keyGenerator 
        ? keyGenerator(req)
        : req.user?.id || req.apiKey?.id || req.ip;

      // First apply DDoS protection by IP
      const ddosLimiter = RateLimiterFactory.getRateLimiter('ddos', rateLimiterConfigs.ddosProtection);
      try {
        await ddosLimiter.consume(req.ip);
      } catch (ddosError) {
        res.setHeader('Retry-After', String(Math.round(ddosError.msBeforeNext / 1000) || 60));
        res.setHeader('X-RateLimit-Limit', String(rateLimiterConfigs.ddosProtection.points));
        res.setHeader('X-RateLimit-Remaining', String(ddosError.remainingPoints || 0));
        res.setHeader('X-RateLimit-Reset', new Date(Date.now() + ddosError.msBeforeNext).toISOString());
        
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'DDoS protection triggered. Please slow down your requests.',
          retryAfter: Math.round(ddosError.msBeforeNext / 1000)
        });
      }

      // Apply endpoint-specific rate limiting
      const rateLimitRes = await rateLimiter.consume(key);
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', String(config.points));
      res.setHeader('X-RateLimit-Remaining', String(rateLimitRes.remainingPoints));
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimitRes.msBeforeNext).toISOString());
      
      // Add rate limit info to request
      req.rateLimitInfo = {
        limit: config.points,
        remaining: rateLimitRes.remainingPoints,
        reset: new Date(Date.now() + rateLimitRes.msBeforeNext)
      };
      
      next();
    } catch (rateLimitError) {
      // Rate limit exceeded
      res.setHeader('Retry-After', String(Math.round(rateLimitError.msBeforeNext / 1000) || 60));
      res.setHeader('X-RateLimit-Limit', String(rateLimiterConfigs[limiterName].points));
      res.setHeader('X-RateLimit-Remaining', String(rateLimitError.remainingPoints || 0));
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimitError.msBeforeNext).toISOString());
      
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.round(rateLimitError.msBeforeNext / 1000),
        limit: rateLimiterConfigs[limiterName].points,
        remaining: rateLimitError.remainingPoints || 0,
        reset: new Date(Date.now() + rateLimitError.msBeforeNext).toISOString()
      });
    }
  };
}

// Brute force protection for login attempts
export function withBruteForceProtection(
  keyGenerator: (req: Request) => string = (req) => req.ip
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const bruteForceLimiter = RateLimiterFactory.getRateLimiter('bruteForce', rateLimiterConfigs.bruteForce);
    const key = `bruteforce:${keyGenerator(req)}`;

    try {
      await bruteForceLimiter.consume(key);
      next();
    } catch (error) {
      const retryAfter = Math.round(error.msBeforeNext / 1000) || 900;
      
      return res.status(429).json({
        error: 'Too Many Attempts',
        message: 'Too many failed login attempts. Please try again later.',
        retryAfter
      });
    }
  };
}

// Composite middleware for authenticated endpoints with rate limiting
export function authenticatedWithRateLimit(
  authMethod: 'jwt' | 'apiKey' = 'jwt',
  rateLimitType: keyof typeof rateLimiterConfigs = 'authenticated',
  requiredPermission?: ApiKeyPermission
) {
  const authMiddleware = authMethod === 'jwt' 
    ? requireAuth 
    : (req: Request, res: Response, next: NextFunction) => withApiKey(req, res, next, requiredPermission);

  return [
    withRateLimit(rateLimitType),
    authMiddleware
  ];
}

// Advanced DDoS protection with multiple strategies
export function withAdvancedDDoSProtection() {
  const strategies = {
    // Track requests per IP
    perIp: new Map<string, { count: number; resetTime: number }>(),
    
    // Track request patterns
    patterns: new Map<string, number>(),
    
    // Suspicious IPs
    suspiciousIps: new Set<string>(),
    
    // Blocked IPs
    blockedIps: new Set<string>()
  };

  // Clean up old entries periodically
  setInterval(() => {
    const now = Date.now();
    
    // Clean per-IP tracking
    for (const [ip, data] of strategies.perIp) {
      if (data.resetTime < now) {
        strategies.perIp.delete(ip);
      }
    }
    
    // Reset pattern tracking
    strategies.patterns.clear();
    
    // Clear suspicious IPs after 1 hour
    strategies.suspiciousIps.clear();
  }, 60000); // Every minute

  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip;
    const now = Date.now();
    const userAgent = req.headers['user-agent'] || 'unknown';
    const path = req.path;

    // Check if IP is blocked
    if (strategies.blockedIps.has(ip)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Your IP has been blocked due to suspicious activity.'
      });
    }

    // Track request patterns
    const patternKey = `${ip}:${path}:${userAgent}`;
    const patternCount = (strategies.patterns.get(patternKey) || 0) + 1;
    strategies.patterns.set(patternKey, patternCount);

    // Detect pattern-based attacks (same endpoint hit repeatedly)
    if (patternCount > 50) {
      strategies.suspiciousIps.add(ip);
    }

    // Track per-IP requests
    const ipData = strategies.perIp.get(ip) || { count: 0, resetTime: now + 1000 };
    if (ipData.resetTime < now) {
      ipData.count = 0;
      ipData.resetTime = now + 1000;
    }
    ipData.count++;
    strategies.perIp.set(ip, ipData);

    // Check for various attack patterns
    const isSuspicious = 
      // High request rate
      ipData.count > 100 ||
      // Suspicious patterns
      strategies.suspiciousIps.has(ip) ||
      // Missing user agent
      !userAgent ||
      // Common attack paths
      /\.(php|asp|cgi|exe)$/i.test(path) ||
      // SQL injection attempts
      /(\bunion\b|\bselect\b|\bdrop\b)/i.test(req.url) ||
      // Path traversal attempts
      /\.\.\//.test(req.url);

    if (isSuspicious) {
      // Log suspicious activity
      console.warn(`Suspicious activity detected from IP: ${ip}`);
      
      // If very suspicious, block the IP
      if (ipData.count > 200 || /(\bunion\b.*\bselect\b|\bdrop\b.*\btable\b)/i.test(req.url)) {
        strategies.blockedIps.add(ip);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Suspicious activity detected.'
        });
      }

      // Otherwise, add delay (tarpit)
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    next();
  };
}

// Circuit breaker for downstream service protection
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000,
    private resetTimeout: number = 30000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await operation();
      
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.threshold) {
        this.state = 'open';
        console.error(`Circuit breaker opened after ${this.failures} failures`);
      }
      
      throw error;
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

// Graceful degradation middleware
export function withGracefulDegradation(
  serviceName: string,
  fallbackResponse?: any
) {
  const circuitBreaker = new CircuitBreaker();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await circuitBreaker.execute(async () => {
        // Check if downstream service is healthy
        // This is a placeholder - implement actual health check
        const isHealthy = Math.random() > 0.1; // 90% success rate for demo
        
        if (!isHealthy) {
          throw new Error(`${serviceName} service is unavailable`);
        }
        
        return true;
      });
      
      next();
    } catch (error) {
      console.error(`${serviceName} circuit breaker triggered:`, error);
      
      // Return fallback response if provided
      if (fallbackResponse) {
        return res.status(503).json({
          error: 'Service Temporarily Unavailable',
          message: `${serviceName} is currently experiencing issues. Please try again later.`,
          fallback: true,
          data: fallbackResponse
        });
      }
      
      // Otherwise, return error
      return res.status(503).json({
        error: 'Service Temporarily Unavailable',
        message: `${serviceName} is currently experiencing issues. Please try again later.`,
        retryAfter: 30
      });
    }
  };
}

// Export composite middleware presets
export const rateLimitPresets = {
  // Public API endpoints
  publicApi: [
    withAdvancedDDoSProtection(),
    withRateLimit('public')
  ],
  
  // Authenticated API endpoints
  authenticatedApi: [
    withAdvancedDDoSProtection(),
    withRateLimit('authenticated'),
    requireAuth
  ],
  
  // Trading endpoints with strict limits
  tradingApi: [
    withAdvancedDDoSProtection(),
    withRateLimit('trading'),
    requireAuth
  ],
  
  // Admin endpoints with permission checks
  adminApi: [
    withAdvancedDDoSProtection(),
    withRateLimit('authenticated'),
    (req: Request, res: Response, next: NextFunction) => 
      withApiKey(req, res, next, ApiKeyPermission.ADMIN)
  ],
  
  // Login endpoint with brute force protection
  loginEndpoint: [
    withAdvancedDDoSProtection(),
    withBruteForceProtection((req) => req.body?.email || req.ip),
    withRateLimit('sensitive')
  ]
};