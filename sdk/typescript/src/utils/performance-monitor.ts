/**
 * @fileoverview Performance monitoring utilities for the SwappiQ SDK
 * @author SwappiQ Protocol
 * @description Comprehensive performance tracking and optimization tools
 */

export interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface PerformanceTimer {
  end(): number;
  endWithMetadata(metadata: Record<string, any>): number;
}

export interface PerformanceReport {
  operations: Array<[string, PerformanceMetric[]]>;
  memoryUsage?: MemoryInfo;
  uptime: number;
  summary: {
    totalOperations: number;
    averageLatency: number;
    p95Latency: number;
    errorRate: number;
    throughput: number;
  };
}

export interface CircuitBreakerState {
  isOpen: boolean;
  failures: number;
  lastFailure?: number;
  lastSuccess?: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

/**
 * High-performance monitoring and optimization utilities
 */
export class PerformanceMonitor {
  private metrics = new Map<string, PerformanceMetric[]>();
  private readonly maxMetricsPerOperation = 1000;
  private readonly cleanupInterval = 300000; // 5 minutes
  private readonly metricRetentionPeriod = 3600000; // 1 hour
  
  constructor() {
    // Set up periodic cleanup
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  /**
   * Start timing an operation
   */
  startTimer(operation: string): PerformanceTimer {
    const start = performance.now();
    
    return {
      end: (): number => {
        const duration = performance.now() - start;
        this.recordMetric(operation, duration);
        return duration;
      },
      
      endWithMetadata: (metadata: Record<string, any>): number => {
        const duration = performance.now() - start;
        this.recordMetric(operation, duration, metadata);
        return duration;
      }
    };
  }

  /**
   * Record a performance metric
   */
  recordMetric(operation: string, duration: number, metadata?: Record<string, any>): void {
    const metric: PerformanceMetric = {
      operation,
      duration,
      timestamp: Date.now(),
      metadata
    };

    let operationMetrics = this.metrics.get(operation);
    if (!operationMetrics) {
      operationMetrics = [];
      this.metrics.set(operation, operationMetrics);
    }

    operationMetrics.push(metric);

    // Limit memory usage by keeping only recent metrics
    if (operationMetrics.length > this.maxMetricsPerOperation) {
      operationMetrics.shift();
    }
  }

  /**
   * Get performance report
   */
  getReport(): PerformanceReport {
    const now = Date.now();
    const allMetrics: PerformanceMetric[] = [];
    
    for (const metrics of this.metrics.values()) {
      allMetrics.push(...metrics);
    }

    const recentMetrics = allMetrics.filter(
      m => now - m.timestamp < this.metricRetentionPeriod
    );

    const durations = recentMetrics.map(m => m.duration).sort((a, b) => a - b);
    const errorMetrics = recentMetrics.filter(m => m.metadata?.error === true);

    return {
      operations: Array.from(this.metrics.entries()),
      memoryUsage: this.getMemoryUsage(),
      uptime: this.getUptime(),
      summary: {
        totalOperations: recentMetrics.length,
        averageLatency: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        p95Latency: durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0,
        errorRate: recentMetrics.length > 0 ? errorMetrics.length / recentMetrics.length : 0,
        throughput: recentMetrics.length / (this.metricRetentionPeriod / 1000)
      }
    };
  }

  /**
   * Get metrics for specific operation
   */
  getOperationMetrics(operation: string): PerformanceMetric[] {
    return this.metrics.get(operation) || [];
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Clean up old metrics
   */
  private cleanup(): void {
    const now = Date.now();
    
    for (const [operation, metrics] of this.metrics.entries()) {
      const recentMetrics = metrics.filter(
        m => now - m.timestamp < this.metricRetentionPeriod
      );
      
      if (recentMetrics.length === 0) {
        this.metrics.delete(operation);
      } else {
        this.metrics.set(operation, recentMetrics);
      }
    }
  }

  private getMemoryUsage(): MemoryInfo | undefined {
    if (typeof window !== 'undefined' && 'memory' in performance) {
      return (performance as any).memory;
    }
    return undefined;
  }

  private getUptime(): number {
    if (typeof process !== 'undefined' && process.uptime) {
      return process.uptime();
    }
    return Date.now() - this.startTime;
  }

  private readonly startTime = Date.now();
}

/**
 * Circuit breaker for preventing cascade failures
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailure?: number;
  private lastSuccess?: number;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly failureThreshold = 5,
    private readonly recoveryTimeout = 60000, // 1 minute
    private readonly successThreshold = 2
  ) {}

  /**
   * Check if circuit breaker is open
   */
  isOpen(): boolean {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (this.lastFailure && now - this.lastFailure > this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Record successful operation
   */
  recordSuccess(): void {
    this.failures = 0;
    this.lastSuccess = Date.now();
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
    }
  }

  /**
   * Record failed operation
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return {
      isOpen: this.isOpen(),
      failures: this.failures,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      state: this.state
    };
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.failures = 0;
    this.lastFailure = undefined;
    this.lastSuccess = undefined;
    this.state = 'CLOSED';
  }
}

/**
 * Object pool for reducing garbage collection
 */
export class ObjectPool<T> {
  private available: T[] = [];
  private readonly inUse = new Set<T>();

  constructor(
    private readonly factory: () => T,
    private readonly reset: (obj: T) => void,
    private readonly maxSize = 100
  ) {}

  /**
   * Acquire object from pool
   */
  acquire(): T {
    let obj = this.available.pop();
    if (!obj) {
      obj = this.factory();
    }

    this.inUse.add(obj);
    return obj;
  }

  /**
   * Release object back to pool
   */
  release(obj: T): void {
    if (this.inUse.has(obj)) {
      this.inUse.delete(obj);
      this.reset(obj);
      
      if (this.available.length < this.maxSize) {
        this.available.push(obj);
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): { available: number; inUse: number; total: number } {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size
    };
  }

  /**
   * Clear pool
   */
  clear(): void {
    this.available.length = 0;
    this.inUse.clear();
  }
}

/**
 * LRU Cache with automatic cleanup
 */
export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number; accessCount: number }>();
  private accessOrder: K[] = [];

  constructor(
    private readonly maxSize = 1000,
    private readonly ttl = 300000 // 5 minutes
  ) {}

  /**
   * Get value from cache
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return undefined;
    }

    // Update access tracking
    entry.accessCount++;
    this.updateAccessOrder(key);

    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: K, value: V): void {
    // Remove existing entry
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 1
    });
    
    this.updateAccessOrder(key);
  }

  /**
   * Delete key from cache
   */
  delete(key: K): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    }
    return deleted;
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder.length = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; hitRate: number; avgAccessCount: number } {
    const entries = Array.from(this.cache.values());
    const totalAccess = entries.reduce((sum, entry) => sum + entry.accessCount, 0);
    
    return {
      size: this.cache.size,
      hitRate: entries.length > 0 ? totalAccess / entries.length : 0,
      avgAccessCount: entries.length > 0 ? totalAccess / entries.length : 0
    };
  }

  private updateAccessOrder(key: K): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  private evictLRU(): void {
    const lruKey = this.accessOrder.shift();
    if (lruKey !== undefined) {
      this.cache.delete(lruKey);
    }
  }
}

/**
 * Batch processor for reducing API calls
 */
export class BatchProcessor<T, R> {
  private readonly queue: Array<{
    item: T;
    resolve: (result: R) => void;
    reject: (error: Error) => void;
  }> = [];
  
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly processBatch: (items: T[]) => Promise<R[]>,
    private readonly batchSize = 10,
    private readonly batchTimeout = 100 // ms
  ) {}

  /**
   * Add item to batch
   */
  add(item: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.queue.push({ item, resolve, reject });

      if (this.queue.length >= this.batchSize) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.batchTimeout);
      }
    });
  }

  /**
   * Process current batch
   */
  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.batchSize);
    const items = batch.map(b => b.item);

    try {
      const results = await this.processBatch(items);
      
      batch.forEach((b, index) => {
        if (index < results.length) {
          b.resolve(results[index]);
        } else {
          b.reject(new Error('Batch processing failed'));
        }
      });
    } catch (error) {
      batch.forEach(b => b.reject(error as Error));
    }
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();

// Decorator for automatic performance tracking
export function trackPerformance(operation: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const timer = performanceMonitor.startTimer(`${target.constructor.name}.${operation}`);
      
      try {
        const result = await originalMethod.apply(this, args);
        timer.endWithMetadata({ success: true });
        return result;
      } catch (error) {
        timer.endWithMetadata({ success: false, error: true });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Utility functions for performance optimization
 */
export class PerformanceUtils {
  /**
   * Fast hash function for cache keys
   */
  static fastHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  /**
   * Debounce function calls
   */
  static debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  /**
   * Throttle function calls
   */
  static throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
  ): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    
    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /**
   * Memoize function results
   */
  static memoize<T extends (...args: any[]) => any>(
    func: T,
    keyGenerator?: (...args: Parameters<T>) => string
  ): T {
    const cache = new Map<string, ReturnType<T>>();
    
    return ((...args: Parameters<T>) => {
      const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);
      
      if (cache.has(key)) {
        return cache.get(key)!;
      }
      
      const result = func.apply(this, args);
      cache.set(key, result);
      return result;
    }) as T;
  }

  /**
   * Batch async operations
   */
  static async batchAsync<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    batchSize = 10
  ): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await processor(batch);
      results.push(...batchResults);
    }
    
    return results;
  }
}