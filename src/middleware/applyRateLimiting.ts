import { Application, Request, Response, NextFunction } from 'express';
import {
  publicRateLimiter,
  authenticatedRateLimiter,
  tradingRateLimiter,
  strictRateLimiter,
  websocketRateLimiter
} from './rateLimiter';

// Define endpoint patterns and their corresponding rate limiters
const rateLimitConfig = {
  // Trading endpoints - most restrictive (10 req/sec)
  trading: {
    limiter: tradingRateLimiter,
    patterns: [
      '/api/submitOrder',
      '/api/submitOrderHybrid',
      '/api/submitOrder-validated',
      '/api/submitOrderV2',
      '/api/cancelOrder',
      '/api/execute',
      '/api/orders/:orderId',
      '/api/orders/status/:orderId',
      '/api/orderStatus/:orderId',
      '/api/trading/*',
      '/api/rfq/*',
      '/api/v1/orders/*',
      '/api/v1/trades/*'
    ]
  },
  
  // Strict endpoints - sensitive operations (10 req/5min)
  strict: {
    limiter: strictRateLimiter,
    patterns: [
      '/api/auth/login',
      '/api/auth/register',
      '/api/market-maker/apply',
      '/api/settlement/proof/claim',
      '/api/releaseFund',
      '/api/signRelease',
      '/api/disputes/settle',
      '/api/disputes/return'
    ]
  },
  
  // Authenticated endpoints (1000 req/min)
  authenticated: {
    limiter: authenticatedRateLimiter,
    patterns: [
      '/api/orders/history',
      '/api/orders/user/:userId',
      '/api/orders/stream',
      '/api/notifications/*',
      '/api/market-maker/:marketMakerId/*',
      '/api/account/*',
      '/api/v1/account/*',
      '/api/settlement/user/:userId/*',
      '/api/analytics/*'
    ]
  },
  
  // WebSocket endpoints (100 connections/min)
  websocket: {
    limiter: websocketRateLimiter,
    patterns: [
      '/api/websocket',
      '/api/websocket/*',
      '/api/ws/*',
      '/api/orders/stream'
    ]
  },
  
  // Public endpoints (100 req/min) - default for everything else
  public: {
    limiter: publicRateLimiter,
    patterns: [
      '/api/health/*',
      '/api/quote',
      '/api/quote/*',
      '/api/tokens/*',
      '/api/supported-tokens',
      '/api/chains',
      '/api/orderbook/:pair',
      '/api/trades/:pair',
      '/api/competition/*',
      '/api/collections/*',
      '/api/crosschain/config',
      '/api/v1/orderbook/*',
      '/api/v1/settlements/epochs'
    ]
  }
};

// Helper function to check if a path matches a pattern
function matchesPattern(path: string, pattern: string): boolean {
  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/:[^/]+/g, '[^/]+') // Replace :param with regex
    .replace(/\*/g, '.*') // Replace * with regex
    .replace(/\//g, '\\/'); // Escape forward slashes
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}

// Apply rate limiters to Express app
export function applyRateLimiting(app: Application): void {
  // Apply rate limiters in order of priority (most restrictive first)
  const priorities = ['strict', 'trading', 'websocket', 'authenticated', 'public'];
  
  priorities.forEach(priority => {
    const config = rateLimitConfig[priority as keyof typeof rateLimitConfig];
    config.patterns.forEach(pattern => {
      app.use(pattern.replace(/:([^/]+)/g, ':$1'), config.limiter);
    });
  });
  
  // Apply public rate limiter as default for any unmatched routes
  app.use('/api/*', publicRateLimiter);
}

// Middleware for Next.js API routes
export function withRateLimiting(
  handler: (req: Request, res: Response) => Promise<void> | void,
  type: 'public' | 'authenticated' | 'trading' | 'strict' | 'websocket' = 'public'
) {
  const limiter = rateLimitConfig[type].limiter;
  
  return async (req: Request, res: Response) => {
    return new Promise<void>((resolve, reject) => {
      limiter(req, res, (err?: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }).then(() => handler(req, res));
  };
}

// Export individual rate limit middleware for manual application
export {
  publicRateLimiter,
  authenticatedRateLimiter,
  tradingRateLimiter,
  strictRateLimiter,
  websocketRateLimiter
} from './rateLimiter';