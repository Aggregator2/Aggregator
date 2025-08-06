/**
 * @fileoverview Advanced rate limiter with priority queues and adaptive limits
 * @author SwappiQ Protocol
 * @description Production-grade rate limiting for API clients with burst handling and fair queuing
 */

import { EventEmitter } from 'events';
import { RateLimitConfig } from '../types/api.js';

export interface RateLimitInfo {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
  queuePosition?: number;
}

export interface QueuedRequest {
  priority: 'low' | 'normal' | 'high';
  resolve: (info: RateLimitInfo) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeoutId?: NodeJS.Timeout;
}

export interface RateLimiterStats {
  requestsPerSecond: number;
  burstSize: number;
  currentTokens: number;
  queueSize: number;
  queuedByPriority: {
    high: number;
    normal: number;
    low: number;
  };
  totalProcessed: number;
  totalQueued: number;
  totalRejected: number;
  averageWaitTime: number;
}

/**
 * Token bucket rate limiter with priority queues and adaptive behavior
 */
export class RateLimiter extends EventEmitter {
  private readonly requestsPerSecond: number;
  private readonly burstSize: number;
  private readonly queueSize: number;
  private readonly refillInterval: number;

  private currentTokens: number;
  private lastRefill: number;
  private requestQueue: Map<string, QueuedRequest[]>;
  private processingTimeout?: NodeJS.Timeout;

  private stats: {
    totalProcessed: number;
    totalQueued: number;
    totalRejected: number;
    waitTimes: number[];
  };

  constructor(config: RateLimitConfig) {
    super();

    this.requestsPerSecond = config.requestsPerSecond;
    this.burstSize = config.burstSize;
    this.queueSize = config.queueSize;
    this.refillInterval = 1000 / this.requestsPerSecond; // ms between token additions

    this.currentTokens = this.burstSize;
    this.lastRefill = Date.now();
    this.requestQueue = new Map([
      ['high', []],
      ['normal', []],
      ['low', []]
    ]);

    this.stats = {
      totalProcessed: 0,
      totalQueued: 0,
      totalRejected: 0,
      waitTimes: []
    };

    // Start token refill process
    this.startTokenRefill();
  }

  /**
   * Acquire a token for making a request
   */
  async acquire(priority: 'low' | 'normal' | 'high' = 'normal'): Promise<RateLimitInfo> {
    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        priority,
        resolve,
        reject,
        timestamp: Date.now()
      };

      // Try immediate acquisition
      const immediate = this.tryImmediateAcquisition();
      if (immediate.allowed) {
        this.stats.totalProcessed++;
        resolve(immediate);
        return;
      }

      // Check queue capacity
      const totalQueued = this.getTotalQueueSize();
      if (totalQueued >= this.queueSize) {
        this.stats.totalRejected++;
        reject(new Error('Rate limit queue is full'));
        return;
      }

      // Add to priority queue
      this.addToQueue(request);
      this.stats.totalQueued++;

      // Set timeout for queued request
      request.timeoutId = setTimeout(() => {
        this.removeFromQueue(request);
        reject(new Error('Rate limit queue timeout'));
      }, 30000); // 30 second timeout

      // Start processing if not already running
      this.scheduleProcessing();
    });
  }

  /**
   * Try to acquire token immediately without queuing
   */
  private tryImmediateAcquisition(): RateLimitInfo {
    this.refillTokens();

    if (this.currentTokens > 0) {
      this.currentTokens--;
      return {
        allowed: true,
        remaining: this.currentTokens,
        resetTime: this.calculateResetTime()
      };
    }

    return {
      allowed: false,
      remaining: 0,
      resetTime: this.calculateResetTime(),
      retryAfter: this.refillInterval
    };
  }

  /**
   * Add request to appropriate priority queue
   */
  private addToQueue(request: QueuedRequest): void {
    const queue = this.requestQueue.get(request.priority)!;
    queue.push(request);

    this.emit('queued', {
      priority: request.priority,
      queueSize: queue.length,
      totalQueued: this.getTotalQueueSize()
    });
  }

  /**
   * Remove request from queue
   */
  private removeFromQueue(request: QueuedRequest): void {
    const queue = this.requestQueue.get(request.priority)!;
    const index = queue.indexOf(request);
    if (index !== -1) {
      queue.splice(index, 1);
      if (request.timeoutId) {
        clearTimeout(request.timeoutId);
      }
    }
  }

  /**
   * Process queued requests by priority
   */
  private processQueue(): void {
    this.refillTokens();

    // Process high priority first, then normal, then low
    const priorities: Array<'high' | 'normal' | 'low'> = ['high', 'normal', 'low'];
    
    for (const priority of priorities) {
      const queue = this.requestQueue.get(priority)!;
      
      while (queue.length > 0 && this.currentTokens > 0) {
        const request = queue.shift()!;
        
        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
        }

        this.currentTokens--;
        this.stats.totalProcessed++;

        // Calculate wait time
        const waitTime = Date.now() - request.timestamp;
        this.stats.waitTimes.push(waitTime);
        
        // Keep only recent wait times for average calculation
        if (this.stats.waitTimes.length > 1000) {
          this.stats.waitTimes = this.stats.waitTimes.slice(-1000);
        }

        request.resolve({
          allowed: true,
          remaining: this.currentTokens,
          resetTime: this.calculateResetTime()
        });

        this.emit('processed', {
          priority,
          waitTime,
          remainingTokens: this.currentTokens
        });
      }
    }

    // Schedule next processing if there are still queued requests
    if (this.getTotalQueueSize() > 0) {
      this.scheduleProcessing();
    }
  }

  /**
   * Schedule queue processing
   */
  private scheduleProcessing(): void {
    if (this.processingTimeout) {
      return; // Already scheduled
    }

    const delay = Math.max(this.refillInterval, 10); // At least 10ms
    this.processingTimeout = setTimeout(() => {
      this.processingTimeout = undefined;
      this.processQueue();
    }, delay);
  }

  /**
   * Start token refill process
   */
  private startTokenRefill(): void {
    setInterval(() => {
      this.refillTokens();
      
      // Process queue if there are waiting requests
      if (this.getTotalQueueSize() > 0 && !this.processingTimeout) {
        this.scheduleProcessing();
      }
    }, Math.min(this.refillInterval, 1000)); // Refill at least every second
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillInterval);

    if (tokensToAdd > 0) {
      this.currentTokens = Math.min(this.burstSize, this.currentTokens + tokensToAdd);
      this.lastRefill = now;

      this.emit('tokensRefilled', {
        tokensAdded: tokensToAdd,
        currentTokens: this.currentTokens
      });
    }
  }

  /**
   * Calculate when tokens will be available
   */
  private calculateResetTime(): number {
    if (this.currentTokens === this.burstSize) {
      return Date.now(); // Already at max capacity
    }

    const tokensNeeded = this.burstSize - this.currentTokens;
    return Date.now() + (tokensNeeded * this.refillInterval);
  }

  /**
   * Get total size across all priority queues
   */
  private getTotalQueueSize(): number {
    return Array.from(this.requestQueue.values()).reduce((total, queue) => total + queue.length, 0);
  }

  /**
   * Get current rate limiter statistics
   */
  getStats(): RateLimiterStats {
    const averageWaitTime = this.stats.waitTimes.length > 0
      ? this.stats.waitTimes.reduce((sum, time) => sum + time, 0) / this.stats.waitTimes.length
      : 0;

    return {
      requestsPerSecond: this.requestsPerSecond,
      burstSize: this.burstSize,
      currentTokens: this.currentTokens,
      queueSize: this.getTotalQueueSize(),
      queuedByPriority: {
        high: this.requestQueue.get('high')!.length,
        normal: this.requestQueue.get('normal')!.length,
        low: this.requestQueue.get('low')!.length
      },
      totalProcessed: this.stats.totalProcessed,
      totalQueued: this.stats.totalQueued,
      totalRejected: this.stats.totalRejected,
      averageWaitTime
    };
  }

  /**
   * Check if rate limiter is healthy
   */
  isHealthy(): boolean {
    const totalQueued = this.getTotalQueueSize();
    const queueUtilization = totalQueued / this.queueSize;
    
    return queueUtilization < 0.8; // Healthy if queue is less than 80% full
  }

  /**
   * Reset rate limiter state
   */
  reset(): void {
    this.currentTokens = this.burstSize;
    this.lastRefill = Date.now();
    
    // Clear all queues and reject pending requests
    for (const [priority, queue] of this.requestQueue) {
      while (queue.length > 0) {
        const request = queue.shift()!;
        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
        }
        request.reject(new Error('Rate limiter reset'));
      }
    }

    // Reset stats
    this.stats = {
      totalProcessed: 0,
      totalQueued: 0,
      totalRejected: 0,
      waitTimes: []
    };

    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = undefined;
    }

    this.emit('reset');
  }

  /**
   * Gracefully shutdown the rate limiter
   */
  async shutdown(): Promise<void> {
    // Clear processing timeout
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = undefined;
    }

    // Reject all pending requests
    for (const [priority, queue] of this.requestQueue) {
      while (queue.length > 0) {
        const request = queue.shift()!;
        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
        }
        request.reject(new Error('Rate limiter shutting down'));
      }
    }

    this.removeAllListeners();
  }
}

/**
 * Adaptive rate limiter that adjusts limits based on response patterns
 */
export class AdaptiveRateLimiter extends RateLimiter {
  private readonly baseRequestsPerSecond: number;
  private readonly maxRequestsPerSecond: number;
  private readonly minRequestsPerSecond: number;
  private readonly adaptationFactor: number;

  private successCount = 0;
  private errorCount = 0;
  private lastAdaptation = Date.now();

  constructor(config: RateLimitConfig & {
    maxRequestsPerSecond?: number;
    minRequestsPerSecond?: number;
    adaptationFactor?: number;
  }) {
    super(config);

    this.baseRequestsPerSecond = config.requestsPerSecond;
    this.maxRequestsPerSecond = config.maxRequestsPerSecond || config.requestsPerSecond * 2;
    this.minRequestsPerSecond = config.minRequestsPerSecond || config.requestsPerSecond * 0.5;
    this.adaptationFactor = config.adaptationFactor || 0.1;

    // Periodically adapt rate limits
    setInterval(() => this.adaptRateLimit(), 10000); // Every 10 seconds
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.successCount++;
  }

  /**
   * Record a failed request (rate limited or error)
   */
  recordError(): void {
    this.errorCount++;
  }

  /**
   * Adapt rate limit based on success/error ratio
   */
  private adaptRateLimit(): void {
    const now = Date.now();
    const timeSinceAdaptation = now - this.lastAdaptation;
    
    if (timeSinceAdaptation < 10000) { // Minimum 10 seconds between adaptations
      return;
    }

    const totalRequests = this.successCount + this.errorCount;
    if (totalRequests < 10) { // Need minimum sample size
      return;
    }

    const successRate = this.successCount / totalRequests;
    let newRequestsPerSecond = this.baseRequestsPerSecond;

    if (successRate > 0.95) {
      // High success rate, increase rate limit
      newRequestsPerSecond = Math.min(
        this.maxRequestsPerSecond,
        this.baseRequestsPerSecond * (1 + this.adaptationFactor)
      );
    } else if (successRate < 0.8) {
      // Low success rate, decrease rate limit
      newRequestsPerSecond = Math.max(
        this.minRequestsPerSecond,
        this.baseRequestsPerSecond * (1 - this.adaptationFactor)
      );
    }

    if (newRequestsPerSecond !== this.baseRequestsPerSecond) {
      this.emit('rateAdapted', {
        oldRate: this.baseRequestsPerSecond,
        newRate: newRequestsPerSecond,
        successRate,
        totalRequests
      });
    }

    // Reset counters
    this.successCount = 0;
    this.errorCount = 0;
    this.lastAdaptation = now;
  }
}