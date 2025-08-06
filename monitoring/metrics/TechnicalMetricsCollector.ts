import { EventEmitter } from 'events';
import * as promClient from 'prom-client';
import Redis from 'ioredis';
import { performance } from 'perf_hooks';

export interface TechnicalMetrics {
  latency: {
    websocket: LatencyMetrics;
    orderProcessing: LatencyMetrics;
    databaseQueries: LatencyMetrics;
    apiEndpoints: Record<string, LatencyMetrics>;
  };
  throughput: {
    ordersPerSecond: number;
    messagesPerSecond: number;
    transactionsPerSecond: number;
    apiRequestsPerSecond: Record<string, number>;
  };
  errors: {
    totalCount: number;
    byType: Record<string, number>;
    byEndpoint: Record<string, number>;
    errorRate: number;
    criticalErrors: Array<{ type: string; message: string; timestamp: number }>;
  };
  availability: {
    uptime: number;
    serviceHealth: Record<string, boolean>;
    lastDowntime: number | null;
    mttr: number; // Mean Time To Recovery
    mtbf: number; // Mean Time Between Failures
  };
  performance: {
    responseTimeP50: number;
    responseTimeP95: number;
    responseTimeP99: number;
    slowQueries: Array<{ query: string; duration: number }>;
    cacheHitRate: number;
  };
}

interface LatencyMetrics {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  count: number;
}

export class TechnicalMetricsCollector extends EventEmitter {
  private redis: Redis;
  private metricsBuffer: Map<string, number[]> = new Map();
  private errorBuffer: Array<{ type: string; message: string; timestamp: number }> = [];
  private serviceStartTime: number;
  private lastHealthCheck: Map<string, boolean> = new Map();
  
  // Prometheus metrics
  private httpRequestDuration: promClient.Histogram;
  private httpRequestsTotal: promClient.Counter;
  private httpRequestErrors: promClient.Counter;
  private wsMessageLatency: promClient.Histogram;
  private orderProcessingDuration: promClient.Histogram;
  private dbQueryDuration: promClient.Histogram;
  private cacheHitRate: promClient.Gauge;
  private serviceUptime: promClient.Gauge;
  private errorRate: promClient.Gauge;
  private throughputGauge: promClient.Gauge;
  
  constructor(redis: Redis) {
    super();
    this.redis = redis;
    this.serviceStartTime = Date.now();
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // HTTP metrics
    this.httpRequestDuration = new promClient.Histogram({
      name: 'dex_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    });

    this.httpRequestsTotal = new promClient.Counter({
      name: 'dex_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    this.httpRequestErrors = new promClient.Counter({
      name: 'dex_http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'error_type'],
    });

    // WebSocket metrics
    this.wsMessageLatency = new promClient.Histogram({
      name: 'dex_websocket_message_latency_seconds',
      help: 'WebSocket message processing latency',
      labelNames: ['message_type', 'direction'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    });

    // Order processing metrics
    this.orderProcessingDuration = new promClient.Histogram({
      name: 'dex_order_processing_duration_seconds',
      help: 'Order processing duration in seconds',
      labelNames: ['order_type', 'status'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    });

    // Database metrics
    this.dbQueryDuration = new promClient.Histogram({
      name: 'dex_database_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['query_type', 'table'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    });

    // Cache metrics
    this.cacheHitRate = new promClient.Gauge({
      name: 'dex_cache_hit_rate',
      help: 'Cache hit rate percentage',
      labelNames: ['cache_type'],
    });

    // System metrics
    this.serviceUptime = new promClient.Gauge({
      name: 'dex_service_uptime_seconds',
      help: 'Service uptime in seconds',
      labelNames: ['service'],
    });

    this.errorRate = new promClient.Gauge({
      name: 'dex_error_rate_percent',
      help: 'Error rate as percentage of total requests',
      labelNames: ['error_type'],
    });

    this.throughputGauge = new promClient.Gauge({
      name: 'dex_throughput_per_second',
      help: 'Throughput metrics per second',
      labelNames: ['metric_type'],
    });
  }

  // Record HTTP request
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number
  ): void {
    const labels = { method, route, status_code: statusCode.toString() };
    
    this.httpRequestDuration.observe(labels, duration / 1000);
    this.httpRequestsTotal.inc(labels);
    
    if (statusCode >= 400) {
      const errorType = statusCode >= 500 ? 'server_error' : 'client_error';
      this.httpRequestErrors.inc({ method, route, error_type: errorType });
    }
    
    // Buffer for latency calculation
    this.bufferMetric(`http:${method}:${route}`, duration);
  }

  // Record WebSocket message
  recordWebSocketMessage(
    messageType: string,
    direction: 'in' | 'out',
    latency: number
  ): void {
    this.wsMessageLatency.observe({ message_type: messageType, direction }, latency / 1000);
    this.bufferMetric(`ws:${messageType}:${direction}`, latency);
  }

  // Record order processing
  recordOrderProcessing(
    orderType: string,
    status: string,
    duration: number
  ): void {
    this.orderProcessingDuration.observe({ order_type: orderType, status }, duration / 1000);
    this.bufferMetric(`order:${orderType}:${status}`, duration);
  }

  // Record database query
  recordDatabaseQuery(
    queryType: string,
    table: string,
    duration: number
  ): void {
    this.dbQueryDuration.observe({ query_type: queryType, table }, duration / 1000);
    this.bufferMetric(`db:${queryType}:${table}`, duration);
    
    // Track slow queries
    if (duration > 1000) { // Queries slower than 1 second
      this.trackSlowQuery(queryType, table, duration);
    }
  }

  // Record cache hit/miss
  recordCacheAccess(cacheType: string, hit: boolean): void {
    const key = `cache:${cacheType}`;
    const current = this.metricsBuffer.get(`${key}:hits`) || [0];
    const total = this.metricsBuffer.get(`${key}:total`) || [0];
    
    if (hit) {
      current[0]++;
    }
    total[0]++;
    
    this.metricsBuffer.set(`${key}:hits`, current);
    this.metricsBuffer.set(`${key}:total`, total);
    
    const hitRate = total[0] > 0 ? (current[0] / total[0]) * 100 : 0;
    this.cacheHitRate.set({ cache_type: cacheType }, hitRate);
  }

  // Record error
  recordError(errorType: string, message: string, endpoint?: string): void {
    const timestamp = Date.now();
    
    // Add to error buffer
    this.errorBuffer.push({ type: errorType, message, timestamp });
    
    // Keep only last 1000 errors
    if (this.errorBuffer.length > 1000) {
      this.errorBuffer.shift();
    }
    
    // Increment error counter
    const errorKey = `errors:${errorType}`;
    const count = (this.metricsBuffer.get(errorKey) || [0])[0] + 1;
    this.metricsBuffer.set(errorKey, [count]);
    
    // Store critical errors
    if (errorType === 'critical' || errorType === 'fatal') {
      this.storeCriticalError(errorType, message, timestamp);
    }
    
    this.emit('error-recorded', { type: errorType, message, timestamp });
  }

  // Update service health
  updateServiceHealth(serviceName: string, healthy: boolean): void {
    this.lastHealthCheck.set(serviceName, healthy);
    
    if (!healthy) {
      this.emit('service-unhealthy', { service: serviceName });
    }
  }

  // Calculate current metrics
  async calculateMetrics(): Promise<TechnicalMetrics> {
    const now = Date.now();
    const uptime = (now - this.serviceStartTime) / 1000;
    
    // Update uptime
    this.serviceUptime.set({ service: 'main' }, uptime);
    
    // Calculate latency metrics
    const latency = {
      websocket: this.calculateLatencyMetrics('ws:'),
      orderProcessing: this.calculateLatencyMetrics('order:'),
      databaseQueries: this.calculateLatencyMetrics('db:'),
      apiEndpoints: this.calculateApiLatencyMetrics(),
    };
    
    // Calculate throughput
    const throughput = await this.calculateThroughput();
    
    // Calculate errors
    const errors = this.calculateErrorMetrics();
    
    // Calculate availability
    const availability = this.calculateAvailability(uptime);
    
    // Calculate performance
    const performance = await this.calculatePerformanceMetrics();
    
    const metrics: TechnicalMetrics = {
      latency,
      throughput,
      errors,
      availability,
      performance,
    };
    
    // Update Prometheus gauges
    this.updatePrometheusGauges(metrics);
    
    // Store in Redis
    await this.storeMetricsInRedis(metrics);
    
    this.emit('metrics-calculated', metrics);
    
    return metrics;
  }

  private calculateLatencyMetrics(prefix: string): LatencyMetrics {
    const values: number[] = [];
    
    for (const [key, data] of this.metricsBuffer) {
      if (key.startsWith(prefix)) {
        values.push(...data);
      }
    }
    
    if (values.length === 0) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        count: 0,
      };
    }
    
    values.sort((a, b) => a - b);
    
    return {
      min: values[0],
      max: values[values.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      p50: this.percentile(values, 0.5),
      p95: this.percentile(values, 0.95),
      p99: this.percentile(values, 0.99),
      count: values.length,
    };
  }

  private calculateApiLatencyMetrics(): Record<string, LatencyMetrics> {
    const endpoints: Record<string, LatencyMetrics> = {};
    
    for (const [key, data] of this.metricsBuffer) {
      if (key.startsWith('http:')) {
        const [, method, ...routeParts] = key.split(':');
        const route = routeParts.join(':');
        const endpointKey = `${method} ${route}`;
        
        if (!endpoints[endpointKey]) {
          endpoints[endpointKey] = this.calculateLatencyMetrics(`http:${method}:${route}`);
        }
      }
    }
    
    return endpoints;
  }

  private async calculateThroughput(): Promise<TechnicalMetrics['throughput']> {
    const window = 60; // 1 minute window
    const now = Date.now();
    const windowStart = now - window * 1000;
    
    // Get counts from Redis
    const [orders, messages, transactions] = await Promise.all([
      this.redis.zcount('orders:timeline', windowStart, now),
      this.redis.zcount('messages:timeline', windowStart, now),
      this.redis.zcount('transactions:timeline', windowStart, now),
    ]);
    
    const ordersPerSecond = orders / window;
    const messagesPerSecond = messages / window;
    const transactionsPerSecond = transactions / window;
    
    // Update gauges
    this.throughputGauge.set({ metric_type: 'orders' }, ordersPerSecond);
    this.throughputGauge.set({ metric_type: 'messages' }, messagesPerSecond);
    this.throughputGauge.set({ metric_type: 'transactions' }, transactionsPerSecond);
    
    // Calculate API throughput
    const apiRequestsPerSecond: Record<string, number> = {};
    
    for (const [key, data] of this.metricsBuffer) {
      if (key.startsWith('http:')) {
        const [, method, ...routeParts] = key.split(':');
        const route = routeParts.join(':');
        const endpoint = `${method} ${route}`;
        apiRequestsPerSecond[endpoint] = data.length / window;
      }
    }
    
    return {
      ordersPerSecond,
      messagesPerSecond,
      transactionsPerSecond,
      apiRequestsPerSecond,
    };
  }

  private calculateErrorMetrics(): TechnicalMetrics['errors'] {
    let totalCount = 0;
    const byType: Record<string, number> = {};
    const byEndpoint: Record<string, number> = {};
    
    // Count errors by type
    for (const [key, data] of this.metricsBuffer) {
      if (key.startsWith('errors:')) {
        const errorType = key.substring(7);
        const count = data[0] || 0;
        byType[errorType] = count;
        totalCount += count;
      }
    }
    
    // Get total requests for error rate calculation
    let totalRequests = 0;
    for (const [key, data] of this.metricsBuffer) {
      if (key.startsWith('http:')) {
        totalRequests += data.length;
      }
    }
    
    const errorRate = totalRequests > 0 ? (totalCount / totalRequests) * 100 : 0;
    
    // Update error rate gauge
    this.errorRate.set({ error_type: 'all' }, errorRate);
    
    // Get recent critical errors
    const criticalErrors = this.errorBuffer
      .filter(e => e.type === 'critical' || e.type === 'fatal')
      .slice(-10); // Last 10 critical errors
    
    return {
      totalCount,
      byType,
      byEndpoint,
      errorRate,
      criticalErrors,
    };
  }

  private calculateAvailability(uptime: number): TechnicalMetrics['availability'] {
    const allHealthy = Array.from(this.lastHealthCheck.values()).every(h => h);
    
    const serviceHealth: Record<string, boolean> = {};
    for (const [service, healthy] of this.lastHealthCheck) {
      serviceHealth[service] = healthy;
    }
    
    // Get downtime info from Redis
    // This would need to be implemented based on your downtime tracking
    const lastDowntime = null; // Placeholder
    const mttr = 0; // Placeholder
    const mtbf = uptime; // Simplified - time since last failure
    
    return {
      uptime,
      serviceHealth,
      lastDowntime,
      mttr,
      mtbf,
    };
  }

  private async calculatePerformanceMetrics(): Promise<TechnicalMetrics['performance']> {
    // Calculate overall response times
    const allLatencies: number[] = [];
    
    for (const [key, data] of this.metricsBuffer) {
      if (key.startsWith('http:') || key.startsWith('ws:')) {
        allLatencies.push(...data);
      }
    }
    
    allLatencies.sort((a, b) => a - b);
    
    const responseTimeP50 = this.percentile(allLatencies, 0.5);
    const responseTimeP95 = this.percentile(allLatencies, 0.95);
    const responseTimeP99 = this.percentile(allLatencies, 0.99);
    
    // Get slow queries from Redis
    const slowQueries = await this.getSlowQueries();
    
    // Calculate cache hit rate
    let totalHits = 0;
    let totalAccesses = 0;
    
    for (const [key, data] of this.metricsBuffer) {
      if (key.endsWith(':hits')) {
        totalHits += data[0] || 0;
      } else if (key.endsWith(':total')) {
        totalAccesses += data[0] || 0;
      }
    }
    
    const cacheHitRate = totalAccesses > 0 ? (totalHits / totalAccesses) * 100 : 0;
    
    return {
      responseTimeP50,
      responseTimeP95,
      responseTimeP99,
      slowQueries,
      cacheHitRate,
    };
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const index = Math.ceil(values.length * p) - 1;
    return values[Math.max(0, index)];
  }

  private bufferMetric(key: string, value: number): void {
    const buffer = this.metricsBuffer.get(key) || [];
    buffer.push(value);
    
    // Keep only last 1000 values
    if (buffer.length > 1000) {
      buffer.shift();
    }
    
    this.metricsBuffer.set(key, buffer);
  }

  private async trackSlowQuery(queryType: string, table: string, duration: number): Promise<void> {
    const key = 'slow_queries';
    const query = `${queryType} on ${table}`;
    
    await this.redis.zadd(key, duration, `${query}:${Date.now()}`);
    
    // Keep only top 100 slow queries
    await this.redis.zremrangebyrank(key, 0, -101);
  }

  private async getSlowQueries(): Promise<Array<{ query: string; duration: number }>> {
    const results = await this.redis.zrevrange('slow_queries', 0, 9, 'WITHSCORES');
    const queries: Array<{ query: string; duration: number }> = [];
    
    for (let i = 0; i < results.length; i += 2) {
      const [query] = results[i].split(':');
      const duration = parseFloat(results[i + 1]);
      queries.push({ query, duration });
    }
    
    return queries;
  }

  private async storeCriticalError(type: string, message: string, timestamp: number): Promise<void> {
    const key = `critical_errors:${timestamp}`;
    await this.redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify({ type, message, timestamp }));
    await this.redis.zadd('critical_errors:timeline', timestamp, key);
  }

  private updatePrometheusGauges(metrics: TechnicalMetrics): void {
    // Already updated in individual methods
  }

  private async storeMetricsInRedis(metrics: TechnicalMetrics): Promise<void> {
    const timestamp = Date.now();
    const key = `technical_metrics:${timestamp}`;
    
    await this.redis.setex(key, 24 * 60 * 60, JSON.stringify(metrics));
    await this.redis.zadd('technical_metrics:timeline', timestamp, key);
    
    // Cleanup old entries
    const cutoff = timestamp - 7 * 24 * 60 * 60 * 1000;
    await this.redis.zremrangebyscore('technical_metrics:timeline', 0, cutoff);
  }

  // Express middleware for automatic HTTP metrics
  expressMiddleware() {
    return (req: any, res: any, next: any) => {
      const start = performance.now();
      
      res.on('finish', () => {
        const duration = performance.now() - start;
        this.recordHttpRequest(req.method, req.route?.path || req.path, res.statusCode, duration);
      });
      
      next();
    };
  }

  // Reset metrics buffers (for testing)
  resetBuffers(): void {
    this.metricsBuffer.clear();
    this.errorBuffer = [];
  }
}