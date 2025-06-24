/**
 * Rate Limiter Service for LiFi API
 * Implements proper rate limiting, caching, and exponential backoff
 */

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  retryAfterMs?: number;
  exponentialBackoff?: boolean;
}

export interface CacheConfig {
  maxAge: number; // Cache TTL in milliseconds
  maxSize: number; // Maximum number of cached items
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining?: number;
  resetTime?: number;
}

export interface CachedItem<T> {
  data: T;
  timestamp: number;
  key: string;
}

/**
 * Simple in-memory rate limiter
 */
class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private backoffState: Map<string, { count: number; nextRetry: number }> = new Map();

  constructor(private config: RateLimitConfig) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    // Check if we're in a backoff period
    const backoff = this.backoffState.get(key);
    if (backoff && now < backoff.nextRetry) {
      return {
        allowed: false,
        retryAfter: backoff.nextRetry - now,
      };
    }

    // Clean old requests outside the window
    const requests = this.requests.get(key) || [];
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    
    // Check if we can make a request
    if (validRequests.length >= this.config.maxRequests) {
      // If exponential backoff is enabled, update backoff state
      if (this.config.exponentialBackoff) {
        const currentBackoff = backoff || { count: 0, nextRetry: 0 };
        const backoffMs = Math.min(
          1000 * Math.pow(2, currentBackoff.count), // Exponential backoff: 1s, 2s, 4s, 8s, etc.
          300000 // Max 5 minutes
        );
        
        this.backoffState.set(key, {
          count: currentBackoff.count + 1,
          nextRetry: now + backoffMs
        });
        
        return {
          allowed: false,
          retryAfter: backoffMs,
        };
      }
      
      // Calculate when the oldest request will expire
      const oldestRequest = Math.min(...validRequests);
      const retryAfter = (oldestRequest + this.config.windowMs) - now;
      
      return {
        allowed: false,
        retryAfter: Math.max(retryAfter, 1000), // At least 1 second
      };
    }

    // Allow the request
    validRequests.push(now);
    this.requests.set(key, validRequests);
    
    // Reset backoff on successful request
    if (backoff) {
      this.backoffState.delete(key);
    }

    return {
      allowed: true,
      remaining: this.config.maxRequests - validRequests.length,
      resetTime: windowStart + this.config.windowMs,
    };
  }

  reset(key?: string) {
    if (key) {
      this.requests.delete(key);
      this.backoffState.delete(key);
    } else {
      this.requests.clear();
      this.backoffState.clear();
    }
  }
}

/**
 * Simple in-memory cache with TTL
 */
class Cache<T> {
  private items: Map<string, CachedItem<T>> = new Map();
  private accessTimes: Map<string, number> = new Map();

  constructor(private config: CacheConfig) {}

  get(key: string): T | null {
    const item = this.items.get(key);
    if (!item) return null;

    const now = Date.now();
    
    // Check if item has expired
    if (now - item.timestamp > this.config.maxAge) {
      this.items.delete(key);
      this.accessTimes.delete(key);
      return null;
    }

    // Update access time for LRU
    this.accessTimes.set(key, now);
    return item.data;
  }

  set(key: string, data: T): void {
    const now = Date.now();
    
    // Evict old items if cache is full
    if (this.items.size >= this.config.maxSize && !this.items.has(key)) {
      this.evictLRU();
    }

    this.items.set(key, {
      data,
      timestamp: now,
      key
    });
    this.accessTimes.set(key, now);
  }

  private evictLRU(): void {
    let oldestKey = '';
    let oldestTime = Date.now();

    this.accessTimes.forEach((time, key) => {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    });

    if (oldestKey) {
      this.items.delete(oldestKey);
      this.accessTimes.delete(oldestKey);
    }
  }

  clear(): void {
    this.items.clear();
    this.accessTimes.clear();
  }

  size(): number {
    return this.items.size;
  }
}

/**
 * LiFi API Rate Limiter and Cache Service
 */
export class LiFiRateLimitService {
  private rateLimiter: RateLimiter;
  private quoteCache: Cache<any>;
  private routeCache: Cache<any>;

  constructor() {
    // LiFi API rate limit: 75 requests per hour (conservative approach)
    this.rateLimiter = new RateLimiter({
      maxRequests: 60, // Stay well under the 75 limit
      windowMs: 60 * 60 * 1000, // 1 hour window
      exponentialBackoff: true,
    });

    // Quote cache: 5 minutes TTL, max 1000 items
    this.quoteCache = new Cache({
      maxAge: 5 * 60 * 1000, // 5 minutes
      maxSize: 1000
    });

    // Route cache: 10 minutes TTL, max 500 items
    this.routeCache = new Cache({
      maxAge: 10 * 60 * 1000, // 10 minutes
      maxSize: 500
    });
  }

  /**
   * Check if we can make a request to LiFi API
   */
  canMakeRequest(apiKey?: string): RateLimitResult {
    const key = apiKey || 'default';
    return this.rateLimiter.check(key);
  }

  /**
   * Get cached quote if available
   */
  getCachedQuote(params: {
    fromChainId: number;
    toChainId: number;
    fromTokenAddress: string;
    toTokenAddress: string;
    fromAmount: string;
  }): any | null {
    const cacheKey = this.generateQuoteCacheKey(params);
    return this.quoteCache.get(cacheKey);
  }

  /**
   * Cache a quote response
   */
  cacheQuote(params: {
    fromChainId: number;
    toChainId: number;
    fromTokenAddress: string;
    toTokenAddress: string;
    fromAmount: string;
  }, quote: any): void {
    const cacheKey = this.generateQuoteCacheKey(params);
    this.quoteCache.set(cacheKey, quote);
  }

  /**
   * Get cached route if available
   */
  getCachedRoute(routeId: string): any | null {
    return this.routeCache.get(routeId);
  }

  /**
   * Cache a route response
   */
  cacheRoute(routeId: string, route: any): void {
    this.routeCache.set(routeId, route);
  }

  /**
   * Generate cache key for quote parameters
   */
  private generateQuoteCacheKey(params: {
    fromChainId: number;
    toChainId: number;
    fromTokenAddress: string;
    toTokenAddress: string;
    fromAmount: string;
  }): string {
    return `quote:${params.fromChainId}:${params.toChainId}:${params.fromTokenAddress.toLowerCase()}:${params.toTokenAddress.toLowerCase()}:${params.fromAmount}`;
  }

  /**
   * Handle 429 rate limit response from LiFi API
   */
  handleRateLimit(retryAfterSeconds?: number, apiKey?: string): void {
    const key = apiKey || 'default';
    const retryAfterMs = retryAfterSeconds ? retryAfterSeconds * 1000 : 2 * 60 * 60 * 1000; // Default 2 hours
    
    // Force a backoff period
    const backoff = {
      count: 3, // Start with higher backoff
      nextRetry: Date.now() + retryAfterMs
    };
    
    // Access private backoffState to set forced backoff
    (this.rateLimiter as any).backoffState.set(key, backoff);
  }

  /**
   * Clear rate limit state (useful for testing or manual reset)
   */
  resetRateLimit(apiKey?: string): void {
    const key = apiKey || 'default';
    this.rateLimiter.reset(key);
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.quoteCache.clear();
    this.routeCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    quoteCache: { size: number; maxSize: number };
    routeCache: { size: number; maxSize: number };
  } {
    return {
      quoteCache: {
        size: this.quoteCache.size(),
        maxSize: (this.quoteCache as any).config.maxSize
      },
      routeCache: {
        size: this.routeCache.size(),
        maxSize: (this.routeCache as any).config.maxSize
      }
    };
  }
}

// Singleton instance
export const lifiRateLimitService = new LiFiRateLimitService();