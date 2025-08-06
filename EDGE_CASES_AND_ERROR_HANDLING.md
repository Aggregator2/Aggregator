# SwappiQ SDK Edge Cases and Error Handling

## Overview

This document outlines comprehensive edge case handling and error recovery mechanisms implemented across all SwappiQ SDKs to ensure robust production operation.

## Edge Cases Addressed

### 1. Network and Connectivity Issues

#### Intermittent Network Failures
**Scenario**: Network drops during request
**Handling**:
```typescript
// Automatic retry with exponential backoff
async retryWithBackoff<T>(
  operation: () => Promise<T>,
  attempt: number = 1
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (attempt >= this.maxRetries || !this.isRetryableError(error)) {
      throw error;
    }
    
    const delay = Math.min(
      this.baseDelay * Math.pow(2, attempt - 1),
      this.maxDelay
    );
    
    await this.sleep(delay);
    return this.retryWithBackoff(operation, attempt + 1);
  }
}
```

#### DNS Resolution Failures
**Scenario**: DNS lookup fails for API endpoint
**Handling**:
```typescript
// Fallback to secondary endpoints
const endpoints = [
  'https://api.swappiq.com',
  'https://api-backup.swappiq.com',
  'https://api-eu.swappiq.com'
];

async requestWithFailover<T>(options: RequestOptions): Promise<T> {
  let lastError: Error;
  
  for (const endpoint of endpoints) {
    try {
      return await this.makeRequest({ ...options, baseUrl: endpoint });
    } catch (error) {
      lastError = error;
      if (error.code === 'ENOTFOUND' || error.code === 'EAI_NODATA') {
        continue; // Try next endpoint
      }
      throw error; // Non-DNS error, stop trying
    }
  }
  
  throw lastError;
}
```

#### Slow Network Conditions
**Scenario**: Network is extremely slow
**Handling**:
```typescript
// Adaptive timeout based on network conditions
class AdaptiveTimeout {
  private recentLatencies: number[] = [];
  
  calculateTimeout(operation: string): number {
    const baseTimeout = this.getBaseTimeout(operation);
    
    if (this.recentLatencies.length === 0) {
      return baseTimeout;
    }
    
    const avgLatency = this.recentLatencies.reduce((a, b) => a + b) / this.recentLatencies.length;
    const adaptiveFactor = Math.min(Math.max(avgLatency / 1000, 1), 5); // 1x to 5x multiplier
    
    return Math.min(baseTimeout * adaptiveFactor, 300000); // Max 5 minutes
  }
}
```

### 2. API Rate Limiting and Throttling

#### Burst Traffic Handling
**Scenario**: Sudden spike in API requests
**Handling**:
```typescript
// Priority-based queuing with burst protection
class PriorityQueue {
  private queues: Map<Priority, RequestItem[]> = new Map();
  private processingRate = 10; // requests per second
  
  async enqueue(request: RequestItem, priority: Priority): Promise<any> {
    const queue = this.queues.get(priority) || [];
    
    // Drop low priority requests if queue is full
    if (queue.length >= this.maxQueueSize && priority === 'low') {
      throw new Error('Queue full - low priority request dropped');
    }
    
    return new Promise((resolve, reject) => {
      queue.push({ request, resolve, reject });
      this.queues.set(priority, queue);
      this.processQueue();
    });
  }
}
```

#### Rate Limit Exceeded
**Scenario**: API returns 429 Too Many Requests
**Handling**:
```typescript
// Exponential backoff with jitter
async handleRateLimit(response: Response, attempt: number): Promise<void> {
  const retryAfter = response.headers.get('retry-after');
  const baseDelay = retryAfter ? parseInt(retryAfter) * 1000 : 1000;
  
  // Add exponential backoff and jitter
  const backoffDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.1 * backoffDelay;
  const totalDelay = Math.min(backoffDelay + jitter, 300000); // Max 5 minutes
  
  await this.sleep(totalDelay);
}
```

### 3. Data Validation and Parsing Errors

#### Malformed API Responses
**Scenario**: API returns invalid JSON or unexpected structure
**Handling**:
```typescript
// Robust response parsing with validation
async parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new Error('Failed to read response body');
  }
  
  if (!text.trim()) {
    throw new Error('Empty response body');
  }
  
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (error) {
    // Log raw response for debugging (sanitized)
    console.error('JSON parse error:', {
      status: response.status,
      bodyPreview: text.substring(0, 200)
    });
    throw new Error(`Invalid JSON response: ${error.message}`);
  }
  
  // Validate response structure
  if (!this.isValidApiResponse(data)) {
    throw new Error('Response does not match expected API schema');
  }
  
  return data;
}
```

#### Invalid Decimal Numbers
**Scenario**: API returns invalid decimal values
**Handling**:
```typescript
// Robust decimal parsing
function parseDecimalSafely(value: string, fieldName: string): DecimalAmount {
  if (typeof value !== 'string') {
    throw new ValidationError(fieldName, 'INVALID_TYPE', 'Expected string');
  }
  
  // Check for basic format
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new ValidationError(fieldName, 'INVALID_FORMAT', 'Invalid decimal format');
  }
  
  // Check for reasonable bounds
  const num = parseFloat(value);
  if (!Number.isFinite(num)) {
    throw new ValidationError(fieldName, 'NOT_FINITE', 'Number is not finite');
  }
  
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError(fieldName, 'TOO_LARGE', 'Number exceeds safe integer range');
  }
  
  // Check decimal places
  const decimalPlaces = (value.split('.')[1] || '').length;
  if (decimalPlaces > 18) {
    throw new ValidationError(fieldName, 'TOO_PRECISE', 'Too many decimal places');
  }
  
  return new DecimalAmount(value, decimalPlaces);
}
```

### 4. WebSocket Connection Issues

#### Connection Drops During Trading
**Scenario**: WebSocket disconnects during active trading
**Handling**:
```typescript
// Graceful degradation with HTTP fallback
class HybridClient {
  private wsClient: WebSocketClient;
  private httpClient: HttpClient;
  private useWebSocket = true;
  
  async subscribe(channels: string[]): Promise<void> {
    if (this.useWebSocket && this.wsClient.isConnected()) {
      try {
        await this.wsClient.subscribe(channels);
      } catch (error) {
        console.warn('WebSocket subscription failed, falling back to polling');
        this.useWebSocket = false;
        this.startPolling(channels);
      }
    } else {
      this.startPolling(channels);
    }
  }
  
  private startPolling(channels: string[]): void {
    // Implement HTTP polling as fallback
    setInterval(async () => {
      for (const channel of channels) {
        try {
          const data = await this.httpClient.getChannelData(channel);
          this.emit('message', { channel, data });
        } catch (error) {
          console.error(`Polling failed for channel ${channel}:`, error);
        }
      }
    }, 5000); // Poll every 5 seconds
  }
}
```

#### Message Queue Overflow
**Scenario**: Too many incoming WebSocket messages
**Handling**:
```typescript
// Backpressure handling with message dropping
class WebSocketClient {
  private messageQueue: WebSocketMessage[] = [];
  private readonly maxQueueSize = 10000;
  private processing = false;
  
  private async handleMessage(message: WebSocketMessage): Promise<void> {
    if (this.messageQueue.length >= this.maxQueueSize) {
      // Drop oldest messages to make room
      const dropped = this.messageQueue.splice(0, this.messageQueue.length / 2);
      console.warn(`Dropped ${dropped.length} messages due to queue overflow`);
    }
    
    this.messageQueue.push(message);
    
    if (!this.processing) {
      this.processMessageQueue();
    }
  }
  
  private async processMessageQueue(): Promise<void> {
    this.processing = true;
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      try {
        await this.processMessage(message);
      } catch (error) {
        console.error('Message processing error:', error);
      }
    }
    
    this.processing = false;
  }
}
```

### 5. Order Validation Edge Cases

#### Precision Loss in Calculations
**Scenario**: Floating point precision errors in order amounts
**Handling**:
```typescript
// Use precise decimal arithmetic
import { Decimal } from 'decimal.js';

class PreciseCalculator {
  static multiply(a: string, b: string): string {
    return new Decimal(a).mul(new Decimal(b)).toFixed();
  }
  
  static divide(a: string, b: string): string {
    if (new Decimal(b).isZero()) {
      throw new Error('Division by zero');
    }
    return new Decimal(a).div(new Decimal(b)).toFixed();
  }
  
  static validateOrderValue(quantity: string, price: string): ValidationResult {
    try {
      const quantityDecimal = new Decimal(quantity);
      const priceDecimal = new Decimal(price);
      
      if (quantityDecimal.isNegative() || priceDecimal.isNegative()) {
        return { valid: false, error: 'Negative values not allowed' };
      }
      
      const value = quantityDecimal.mul(priceDecimal);
      
      // Check for reasonable bounds
      if (value.greaterThan('1e18')) {
        return { valid: false, error: 'Order value too large' };
      }
      
      if (value.lessThan('1e-18')) {
        return { valid: false, error: 'Order value too small' };
      }
      
      return { valid: true, value: value.toFixed() };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}
```

#### Market Closed Orders
**Scenario**: Order placed when market is closed
**Handling**:
```typescript
// Market hours validation with timezone handling
class MarketHoursValidator {
  private static readonly marketHours = {
    'NYSE': { open: '09:30', close: '16:00', timezone: 'America/New_York' },
    'LSE': { open: '08:00', close: '16:30', timezone: 'Europe/London' },
    'TSE': { open: '09:00', close: '15:00', timezone: 'Asia/Tokyo' }
  };
  
  static isMarketOpen(market: string): boolean {
    const config = this.marketHours[market];
    if (!config) {
      return true; // Default to open for unknown markets
    }
    
    const now = new Date();
    const marketTime = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);
    
    const [currentHour, currentMinute] = marketTime.split(':').map(Number);
    const [openHour, openMinute] = config.open.split(':').map(Number);
    const [closeHour, closeMinute] = config.close.split(':').map(Number);
    
    const currentMinutes = currentHour * 60 + currentMinute;
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;
    
    return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
  }
}
```

### 6. Memory and Resource Management

#### Memory Leaks in Long-Running Applications
**Scenario**: SDK used in long-running applications
**Handling**:
```typescript
// Automatic cleanup and memory management
class ResourceManager {
  private cleanupTasks: Array<() => void> = [];
  private readonly maxCacheSize = 1000;
  private readonly maxMetricsAge = 3600000; // 1 hour
  
  constructor() {
    // Periodic cleanup
    setInterval(() => this.cleanup(), 300000); // Every 5 minutes
    
    // Process exit cleanup
    process.on('exit', () => this.cleanup());
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }
  
  addCleanupTask(task: () => void): void {
    this.cleanupTasks.push(task);
  }
  
  private cleanup(): void {
    // Clean up old cache entries
    this.cleanupCache();
    
    // Clean up old metrics
    this.cleanupMetrics();
    
    // Run custom cleanup tasks
    this.cleanupTasks.forEach(task => {
      try {
        task();
      } catch (error) {
        console.error('Cleanup task failed:', error);
      }
    });
  }
}
```

#### Event Listener Memory Leaks
**Scenario**: Event listeners not properly removed
**Handling**:
```typescript
// Automatic event listener cleanup
class EventManager {
  private listeners: Map<EventEmitter, Array<{
    event: string;
    listener: Function;
  }>> = new Map();
  
  addListener(emitter: EventEmitter, event: string, listener: Function): void {
    emitter.on(event, listener);
    
    const emitterListeners = this.listeners.get(emitter) || [];
    emitterListeners.push({ event, listener });
    this.listeners.set(emitter, emitterListeners);
  }
  
  removeAllListeners(): void {
    for (const [emitter, listeners] of this.listeners) {
      for (const { event, listener } of listeners) {
        emitter.removeListener(event, listener);
      }
    }
    this.listeners.clear();
  }
  
  // Weak references to automatically clean up when objects are garbage collected
  private weakRefs = new WeakMap<object, Array<() => void>>();
  
  addWeakCleanup(obj: object, cleanup: () => void): void {
    const cleanups = this.weakRefs.get(obj) || [];
    cleanups.push(cleanup);
    this.weakRefs.set(obj, cleanups);
  }
}
```

### 7. Concurrent Access and Race Conditions

#### Multiple Order Submissions
**Scenario**: User rapidly submits multiple orders
**Handling**:
```typescript
// Request deduplication and serialization
class OrderManager {
  private pendingOrders = new Map<string, Promise<any>>();
  private orderLocks = new Map<string, boolean>();
  
  async submitOrder(orderRequest: CreateOrderRequest): Promise<CreateOrderResponse> {
    const orderKey = this.getOrderKey(orderRequest);
    
    // Check for duplicate submission
    if (this.pendingOrders.has(orderKey)) {
      return this.pendingOrders.get(orderKey)!;
    }
    
    // Check for account lock
    const accountKey = orderRequest.userId;
    if (this.orderLocks.get(accountKey)) {
      throw new Error('Another order is being processed for this account');
    }
    
    this.orderLocks.set(accountKey, true);
    
    const orderPromise = this.processOrder(orderRequest);
    this.pendingOrders.set(orderKey, orderPromise);
    
    try {
      const result = await orderPromise;
      return result;
    } finally {
      this.pendingOrders.delete(orderKey);
      this.orderLocks.delete(accountKey);
    }
  }
  
  private getOrderKey(order: CreateOrderRequest): string {
    return `${order.userId}-${order.tradingPair}-${order.side}-${order.quantity}-${order.price}`;
  }
}
```

### 8. Error Recovery Strategies

#### Cascading Failures
**Scenario**: One component failure causes others to fail
**Handling**:
```typescript
// Circuit breaker pattern with graceful degradation
class ServiceManager {
  private services = new Map<string, Service>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  
  async callService<T>(serviceName: string, operation: () => Promise<T>): Promise<T> {
    const breaker = this.circuitBreakers.get(serviceName);
    
    if (breaker?.isOpen()) {
      // Try fallback service or cached data
      return this.tryFallback(serviceName, operation);
    }
    
    try {
      const result = await operation();
      breaker?.recordSuccess();
      return result;
    } catch (error) {
      breaker?.recordFailure();
      
      if (breaker?.isOpen()) {
        return this.tryFallback(serviceName, operation);
      }
      
      throw error;
    }
  }
  
  private async tryFallback<T>(serviceName: string, operation: () => Promise<T>): Promise<T> {
    // Try cached data first
    const cached = this.getCachedData(serviceName);
    if (cached) {
      return cached as T;
    }
    
    // Try fallback service
    const fallbackService = this.getFallbackService(serviceName);
    if (fallbackService) {
      return fallbackService.execute();
    }
    
    throw new Error(`Service ${serviceName} is unavailable and no fallback available`);
  }
}
```

### 9. Data Consistency Issues

#### Stale Cache Data
**Scenario**: Cached data becomes outdated
**Handling**:
```typescript
// Cache invalidation with dependency tracking
class SmartCache {
  private cache = new Map<string, CacheEntry>();
  private dependencies = new Map<string, Set<string>>();
  
  set(key: string, value: any, ttl?: number, dependencies?: string[]): void {
    const entry: CacheEntry = {
      value,
      timestamp: Date.now(),
      ttl: ttl || 300000, // 5 minutes default
      accessCount: 0
    };
    
    this.cache.set(key, entry);
    
    // Track dependencies
    if (dependencies) {
      for (const dep of dependencies) {
        const depSet = this.dependencies.get(dep) || new Set();
        depSet.add(key);
        this.dependencies.set(dep, depSet);
      }
    }
  }
  
  invalidate(key: string): void {
    // Invalidate this key
    this.cache.delete(key);
    
    // Invalidate dependent keys
    const dependent = this.dependencies.get(key);
    if (dependent) {
      for (const depKey of dependent) {
        this.cache.delete(depKey);
      }
      this.dependencies.delete(key);
    }
  }
  
  get(key: string): any {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    
    // Check TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    
    entry.accessCount++;
    return entry.value;
  }
}
```

## Error Classification and Handling

### Retryable Errors
- Network timeouts
- 5xx server errors
- 429 rate limit errors
- DNS resolution failures
- Connection refused

### Non-Retryable Errors
- 4xx client errors (except 429)
- Authentication failures
- Validation errors
- Malformed requests

### Critical Errors
- Circuit breaker open
- All endpoints down
- Memory exhaustion
- Security violations

## Monitoring and Alerting

### Error Metrics
```typescript
interface ErrorMetrics {
  errorRate: number;
  errorsByType: Map<string, number>;
  retrySuccessRate: number;
  circuitBreakerState: string;
  avgRecoveryTime: number;
}

class ErrorMonitor {
  private errors: ErrorEvent[] = [];
  
  recordError(error: Error, context: ErrorContext): void {
    const errorEvent: ErrorEvent = {
      type: error.constructor.name,
      message: error.message,
      timestamp: Date.now(),
      context,
      stack: error.stack
    };
    
    this.errors.push(errorEvent);
    
    // Alert on critical patterns
    this.checkAlertConditions(errorEvent);
  }
  
  private checkAlertConditions(error: ErrorEvent): void {
    const recentErrors = this.getRecentErrors(300000); // Last 5 minutes
    const errorRate = recentErrors.length / 300; // Errors per second
    
    if (errorRate > 1) {
      this.sendAlert('High error rate detected', { rate: errorRate });
    }
    
    // Check for specific error patterns
    const criticalErrors = recentErrors.filter(e => 
      e.type === 'CircuitBreakerOpenError' || 
      e.type === 'MemoryError'
    );
    
    if (criticalErrors.length > 0) {
      this.sendAlert('Critical errors detected', { errors: criticalErrors });
    }
  }
}
```

## Best Practices Summary

1. **Always validate inputs** before processing
2. **Implement circuit breakers** for external dependencies
3. **Use exponential backoff** with jitter for retries
4. **Cache aggressively** but invalidate intelligently
5. **Monitor error rates** and patterns
6. **Implement graceful degradation** when possible
7. **Clean up resources** automatically
8. **Log errors comprehensively** but safely
9. **Test edge cases** thoroughly
10. **Plan for failure** at every level