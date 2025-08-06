/**
 * @fileoverview Type-safe HTTP client with automatic retry and request signing
 * @author SwappiQ Protocol
 * @description Production-ready HTTP client with comprehensive error handling, retry logic, and security features
 */

import { EventEmitter } from 'events';
import {
  ApiResponse,
  ApiError,
  AuthCredentials,
  SignedRequest,
  RetryConfig,
  RateLimitConfig,
  SDKConfig
} from '../types/api.js';
import { RequestSigner } from '../utils/request-signer.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { 
  performanceMonitor, 
  CircuitBreaker, 
  LRUCache, 
  ObjectPool,
  trackPerformance 
} from '../utils/performance-monitor.js';

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: any;
  headers?: Record<string, string>;
  auth?: boolean;
  timeout?: number;
  retries?: number;
  priority?: 'low' | 'normal' | 'high';
}

export interface RequestMetrics {
  requestId: string;
  method: string;
  path: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: number;
  success: boolean;
  retryCount: number;
  fromCache: boolean;
}

export interface CachedResponse {
  data: ApiResponse<any>;
  timestamp: number;
}

export interface RequestContext {
  headers: Record<string, string>;
  body: any;
  metadata: Record<string, any>;
}

/**
 * Production-grade HTTP client with enterprise features
 */
export class HttpClient extends EventEmitter {
  private readonly baseUrl: string;
  private readonly auth?: AuthCredentials;
  private readonly retryConfig: RetryConfig;
  private readonly rateLimitConfig?: RateLimitConfig;
  private readonly timeout: number;
  private readonly debug: boolean;

  private readonly requestSigner: RequestSigner;
  private readonly rateLimiter?: RateLimiter;
  private readonly responseCache: LRUCache<string, CachedResponse>;
  private readonly activeRequests: Map<string, Promise<any>>;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly requestPool: ObjectPool<RequestContext>;

  private requestCounter = 0;
  private metrics: RequestMetrics[] = [];

  constructor(config: SDKConfig) {
    super();

    this.baseUrl = config.apiUrl.replace(/\/$/, '');
    this.auth = config.auth;
    this.retryConfig = config.retryConfig;
    this.rateLimitConfig = config.rateLimitConfig;
    this.timeout = config.timeout;
    this.debug = config.debug || false;

    this.requestSigner = new RequestSigner(config.auth);
    this.rateLimiter = config.rateLimitConfig ? new RateLimiter(config.rateLimitConfig) : undefined;
    this.responseCache = new LRUCache(1000, 300000); // 1000 entries, 5 min TTL
    this.activeRequests = new Map();
    this.circuitBreaker = new CircuitBreaker(5, 60000, 2); // 5 failures, 1 min recovery
    this.requestPool = new ObjectPool(
      () => ({ headers: {}, body: null, metadata: {} }),
      (obj) => { obj.headers = {}; obj.body = null; obj.metadata = {}; },
      100 // Pool size
    );

    // Cleanup old metrics and cache entries
    setInterval(() => this.cleanup(), 300000); // Every 5 minutes
  }

  /**
   * Make a type-safe API request with automatic retry and rate limiting
   */
  @trackPerformance('http.request')
  async request<T = any>(options: RequestOptions): Promise<ApiResponse<T>> {
    const timer = performanceMonitor.startTimer('http.request');
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    // Check circuit breaker
    if (this.circuitBreaker.isOpen()) {
      throw new Error('Circuit breaker is open - service temporarily unavailable');
    }

    try {
      // Rate limiting check
      if (this.rateLimiter) {
        await this.rateLimiter.acquire(options.priority);
      }

      // Check for duplicate requests
      const duplicateKey = this.getDuplicateKey(options);
      if (this.activeRequests.has(duplicateKey)) {
        if (this.debug) {
          console.log(`[${requestId}] Waiting for duplicate request: ${duplicateKey}`);
        }
        const result = await this.activeRequests.get(duplicateKey) as Promise<ApiResponse<T>>;
        timer.endWithMetadata({ fromCache: false, duplicate: true });
        return result;
      }

      // Check cache for GET requests
      if (options.method === 'GET') {
        const cached = this.responseCache.get(options.path);
        if (cached) {
          this.recordMetrics({
            requestId,
            method: options.method,
            path: options.path,
            startTime,
            endTime: Date.now(),
            duration: 0,
            status: 200,
            success: true,
            retryCount: 0,
            fromCache: true
          });
          timer.endWithMetadata({ fromCache: true, success: true });
          this.circuitBreaker.recordSuccess();
          return cached.data as ApiResponse<T>;
        }
      }

      // Create the request promise
      const requestPromise = this.executeRequest<T>(options, requestId, startTime);
      this.activeRequests.set(duplicateKey, requestPromise);

      try {
        const response = await requestPromise;
        
        // Cache successful GET responses
        if (options.method === 'GET' && response.success) {
          this.cacheResponse(options.path, response);
        }

        return response;
      } finally {
        this.activeRequests.delete(duplicateKey);
      }

    } catch (error) {
      this.recordMetrics({
        requestId,
        method: options.method,
        path: options.path,
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime,
        status: 0,
        success: false,
        retryCount: 0,
        fromCache: false
      });

      throw this.createApiError(error, requestId);
    }
  }

  /**
   * Execute request with retry logic
   */
  private async executeRequest<T>(
    options: RequestOptions,
    requestId: string,
    startTime: number
  ): Promise<ApiResponse<T>> {
    let lastError: Error;
    let retryCount = 0;
    const maxRetries = options.retries ?? this.retryConfig.maxAttempts;

    while (retryCount <= maxRetries) {
      try {
        const response = await this.makeHttpRequest<T>(options, requestId);
        
        this.recordMetrics({
          requestId,
          method: options.method,
          path: options.path,
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          status: 200, // Assuming success if no error thrown
          success: response.success,
          retryCount,
          fromCache: false
        });

        return response;

      } catch (error) {
        lastError = error as Error;
        
        if (retryCount === maxRetries || !this.isRetryableError(error)) {
          break;
        }

        retryCount++;
        const delay = this.calculateRetryDelay(retryCount);
        
        if (this.debug) {
          console.warn(`[${requestId}] Retry ${retryCount}/${maxRetries} after ${delay}ms: ${lastError.message}`);
        }

        this.emit('retry', {
          requestId,
          attempt: retryCount,
          delay,
          error: lastError.message
        });

        await this.sleep(delay);
      }
    }

    this.recordMetrics({
      requestId,
      method: options.method,
      path: options.path,
      startTime,
      endTime: Date.now(),
      duration: Date.now() - startTime,
      status: 0,
      success: false,
      retryCount,
      fromCache: false
    });

    throw lastError!;
  }

  /**
   * Make the actual HTTP request
   */
  private async makeHttpRequest<T>(options: RequestOptions, requestId: string): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${options.path}`;
    const method = options.method;
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const timeout = options.timeout ?? this.timeout;

    // Prepare headers
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'SwappiQ-SDK-TS/1.0.0',
      'X-Request-ID': requestId,
      ...options.headers
    };

    // Sign request if authentication is required
    if (options.auth !== false && this.auth) {
      const signedRequest = await this.requestSigner.signRequest({
        method,
        path: options.path,
        body: body || '',
        timestamp: Date.now().toString(),
        signature: '',
        headers: {}
      });

      headers = { ...headers, ...signedRequest.headers };
    }

    if (this.debug) {
      console.log(`[${requestId}] ${method} ${url}`, {
        headers: this.sanitizeHeaders(headers),
        body: this.sanitizeBody(options.body)
      });
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new HttpError(`HTTP ${response.status}: ${response.statusText}`, response.status);
      }

      const data = await response.json();
      
      // Validate response structure
      if (!this.isValidApiResponse(data)) {
        throw new Error('Invalid API response structure');
      }

      if (this.debug) {
        console.log(`[${requestId}] Response:`, this.sanitizeResponse(data));
      }

      return data as ApiResponse<T>;

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError(`Request timeout after ${timeout}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.retryConfig.baseDelay;
    const backoffFactor = this.retryConfig.backoffFactor;
    const maxDelay = this.retryConfig.maxDelay;
    const jitter = this.retryConfig.jitter;

    let delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);

    if (jitter) {
      // Add random jitter ±25%
      const jitterAmount = delay * 0.25;
      delay += (Math.random() - 0.5) * 2 * jitterAmount;
    }

    return Math.floor(delay);
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof TimeoutError) return true;
    if (error instanceof HttpError) {
      return error.status >= 500 || error.status === 429; // Server errors and rate limiting
    }
    
    const errorMessage = error.message?.toLowerCase() || '';
    return this.retryConfig.retryableErrors.some(retryableError => 
      errorMessage.includes(retryableError.toLowerCase())
    );
  }

  /**
   * Validate API response structure
   */
  private isValidApiResponse(data: any): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.success === 'boolean' &&
      typeof data.timestamp === 'string' &&
      typeof data.requestId === 'string'
    );
  }

  /**
   * Create standardized API error
   */
  private createApiError(error: any, requestId: string): ApiError {
    if (error instanceof HttpError) {
      return {
        code: `HTTP_${error.status}`,
        message: error.message,
        details: { status: error.status, requestId },
        retryable: this.isRetryableError(error)
      };
    }

    if (error instanceof TimeoutError) {
      return {
        code: 'TIMEOUT',
        message: error.message,
        details: { requestId },
        retryable: true
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error.message || 'An unknown error occurred',
      details: { requestId },
      retryable: false
    };
  }

  /**
   * Cache management
   */
  private getFromCache(path: string): CachedResponse | null {
    const cached = this.responseCache.get(path);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > 30000) { // 30 second TTL
      this.responseCache.delete(path);
      return null;
    }

    return cached;
  }

  private cacheResponse(path: string, response: ApiResponse<any>): void {
    this.responseCache.set(path, {
      response,
      timestamp: Date.now()
    });
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestCounter}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get key for duplicate request detection
   */
  private getDuplicateKey(options: RequestOptions): string {
    const bodyHash = options.body ? JSON.stringify(options.body) : '';
    return `${options.method}:${options.path}:${bodyHash}`;
  }

  /**
   * Record request metrics
   */
  private recordMetrics(metrics: RequestMetrics): void {
    this.metrics.push(metrics);
    
    // Keep only last 1000 metrics
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }

    this.emit('metrics', metrics);
  }

  /**
   * Cleanup old data
   */
  private cleanup(): void {
    const now = Date.now();
    
    // Clear old cache entries
    for (const [key, cached] of this.responseCache.entries()) {
      if (now - cached.timestamp > 300000) { // 5 minutes
        this.responseCache.delete(key);
      }
    }

    // Clear old metrics
    this.metrics = this.metrics.filter(m => now - m.endTime < 3600000); // 1 hour
  }

  /**
   * Comprehensive sanitization for logging security
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized = { ...headers };
    const sensitiveHeaders = [
      'authorization', 'x-api-key', 'x-api-secret', 'x-signature', 
      'x-passphrase', 'x-nonce', 'cookie', 'set-cookie'
    ];
    
    for (const [key, value] of Object.entries(sensitized)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveHeaders.some(h => lowerKey.includes(h)) || 
          lowerKey.includes('secret') || 
          lowerKey.includes('private') ||
          lowerKey.includes('auth')) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') return body;
    
    const sanitized = Array.isArray(body) ? [...body] : { ...body };
    const sensitiveFields = [
      'apiSecret', 'privateKey', 'password', 'signature', 'secret',
      'token', 'auth', 'credentials', 'passphrase', 'nonce'
    ];
    
    const sanitizeRecursive = (obj: any): any => {
      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeRecursive(item));
      } else if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          const lowerKey = key.toLowerCase();
          if (sensitiveFields.some(field => lowerKey.includes(field))) {
            result[key] = '[REDACTED]';
          } else if (typeof value === 'object') {
            result[key] = sanitizeRecursive(value);
          } else {
            result[key] = value;
          }
        }
        return result;
      }
      return obj;
    };
    
    return sanitizeRecursive(sanitized);
  }

  private sanitizeResponse(response: any): any {
    if (!response || typeof response !== 'object') return response;
    
    const sanitized = { ...response };
    if (sanitized.data && typeof sanitized.data === 'object') {
      sanitized.data = this.sanitizeBody(sanitized.data);
    }
    
    // Also sanitize error details that might contain sensitive info
    if (sanitized.error && typeof sanitized.error === 'object') {
      sanitized.error = this.sanitizeBody(sanitized.error);
    }
    
    return sanitized;
  }

  /**
   * Utility method for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get client statistics
   */
  getStats(): HttpClientStats {
    const recentMetrics = this.metrics.filter(m => Date.now() - m.endTime < 3600000); // Last hour
    const successfulRequests = recentMetrics.filter(m => m.success);
    const failedRequests = recentMetrics.filter(m => !m.success);

    return {
      totalRequests: recentMetrics.length,
      successfulRequests: successfulRequests.length,
      failedRequests: failedRequests.length,
      successRate: recentMetrics.length > 0 ? successfulRequests.length / recentMetrics.length : 0,
      averageResponseTime: recentMetrics.length > 0 
        ? recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length 
        : 0,
      cacheHitRate: recentMetrics.length > 0
        ? recentMetrics.filter(m => m.fromCache).length / recentMetrics.length
        : 0,
      activeCacheEntries: this.responseCache.size,
      activeRequests: this.activeRequests.size,
      rateLimiterStats: this.rateLimiter?.getStats()
    };
  }

  /**
   * Clear all caches and reset state
   */
  reset(): void {
    this.responseCache.clear();
    this.activeRequests.clear();
    this.metrics = [];
    this.requestCounter = 0;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    // Wait for active requests to complete
    const activePromises = Array.from(this.activeRequests.values());
    if (activePromises.length > 0) {
      await Promise.allSettled(activePromises);
    }

    this.reset();
    this.removeAllListeners();
  }
}

// ========== SUPPORTING TYPES AND CLASSES ==========

interface CachedResponse {
  response: ApiResponse<any>;
  timestamp: number;
}

export interface HttpClientStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  averageResponseTime: number;
  cacheHitRate: number;
  activeCacheEntries: number;
  activeRequests: number;
  rateLimiterStats?: any;
}

class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}