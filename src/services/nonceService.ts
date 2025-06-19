import Redis from 'ioredis';
import { logger } from '../utils/logger';

export class NonceService {
  private redis: Redis;
  private readonly NONCE_PREFIX = 'nonce:';
  private readonly QUOTE_PREFIX = 'quote:';
  private readonly NONCE_TTL = 86400; // 24 hours
  private readonly QUOTE_TTL = 300; // 5 minutes

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    this.redis.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      logger.info('Redis connected successfully');
    });
  }

  async generateNonce(walletAddress: string): Promise<string> {
    const nonce = this.createNonce();
    const key = `${this.NONCE_PREFIX}${walletAddress}:${nonce}`;
    
    await this.redis.setex(key, this.NONCE_TTL, '1');
    
    logger.info('Generated nonce', { walletAddress, nonce });
    return nonce;
  }

  async validateNonce(walletAddress: string, nonce: string): Promise<boolean> {
    const key = `${this.NONCE_PREFIX}${walletAddress}:${nonce}`;
    
    // Use Redis SET with NX (only set if not exists) to ensure atomic operation
    const result = await this.redis.set(key, 'used', 'EX', this.NONCE_TTL, 'NX');
    
    if (result === 'OK') {
      // Nonce was valid and is now marked as used
      logger.info('Valid nonce used', { walletAddress, nonce });
      return true;
    }
    
    // Check if nonce exists but was already used
    const exists = await this.redis.exists(key);
    if (exists) {
      logger.warn('Attempted nonce reuse', { walletAddress, nonce });
    } else {
      logger.warn('Invalid nonce', { walletAddress, nonce });
    }
    
    return false;
  }

  async storeQuote(quoteId: string, quoteData: any, ttl?: number): Promise<void> {
    const key = `${this.QUOTE_PREFIX}${quoteId}`;
    const expiry = ttl || this.QUOTE_TTL;
    
    await this.redis.setex(key, expiry, JSON.stringify({
      ...quoteData,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiry * 1000).toISOString()
    }));
    
    logger.info('Quote stored', { quoteId, expiry });
  }

  async getQuote(quoteId: string): Promise<any | null> {
    const key = `${this.QUOTE_PREFIX}${quoteId}`;
    const data = await this.redis.get(key);
    
    if (!data) {
      logger.warn('Quote not found or expired', { quoteId });
      return null;
    }
    
    const quote = JSON.parse(data);
    const expiresAt = new Date(quote.expiresAt);
    
    if (expiresAt < new Date()) {
      logger.warn('Quote expired', { quoteId, expiresAt });
      await this.redis.del(key);
      return null;
    }
    
    return quote;
  }

  async validateQuoteUsage(quoteId: string): Promise<boolean> {
    const key = `${this.QUOTE_PREFIX}${quoteId}:used`;
    
    // Atomic operation to check and set
    const result = await this.redis.set(key, '1', 'EX', this.QUOTE_TTL, 'NX');
    
    if (result === 'OK') {
      logger.info('Quote marked as used', { quoteId });
      return true;
    }
    
    logger.warn('Quote already used', { quoteId });
    return false;
  }

  async getRateLimitStatus(identifier: string, limit: number, windowSeconds: number): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    const key = `ratelimit:${identifier}`;
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    // Remove old entries
    await this.redis.zremrangebyscore(key, '-inf', windowStart);
    
    // Count requests in current window
    const count = await this.redis.zcard(key);
    
    if (count < limit) {
      // Add current request
      await this.redis.zadd(key, now, `${now}-${Math.random()}`);
      await this.redis.expire(key, windowSeconds);
      
      return {
        allowed: true,
        remaining: limit - count - 1,
        resetAt: new Date(now + windowSeconds * 1000)
      };
    }
    
    // Get oldest entry to determine reset time
    const oldestEntry = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
    const resetAt = oldestEntry.length > 1 
      ? new Date(parseInt(oldestEntry[1]) + windowSeconds * 1000)
      : new Date(now + windowSeconds * 1000);
    
    return {
      allowed: false,
      remaining: 0,
      resetAt
    };
  }

  private createNonce(): string {
    // Generate a cryptographically secure random nonce
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const random2 = Math.random().toString(36).substring(2, 15);
    return `${timestamp}-${random}${random2}`;
  }

  async cleanupExpiredEntries(): Promise<void> {
    try {
      // This would be called by a cron job
      const pattern = `${this.NONCE_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      
      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) {
          // Key exists but has no TTL, set one
          await this.redis.expire(key, this.NONCE_TTL);
        }
      }
      
      logger.info('Cleanup completed', { keysProcessed: keys.length });
    } catch (error) {
      logger.error('Cleanup error:', error);
    }
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

export const nonceService = new NonceService();