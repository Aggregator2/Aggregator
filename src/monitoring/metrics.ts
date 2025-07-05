import { Registry, Counter, Histogram, Gauge, Summary } from 'prom-client';
import { Request, Response } from 'express';

// Create a custom registry
export const metricsRegistry = new Registry();

// Default metrics (CPU, memory, etc.)
import { collectDefaultMetrics } from 'prom-client';
collectDefaultMetrics({ register: metricsRegistry });

// ========================================
// HTTP Metrics
// ========================================

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.015, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

export const httpRequestSize = new Summary({
  name: 'http_request_size_bytes',
  help: 'Size of HTTP requests in bytes',
  labelNames: ['method', 'route'],
  registers: [metricsRegistry],
});

export const httpResponseSize = new Summary({
  name: 'http_response_size_bytes',
  help: 'Size of HTTP responses in bytes',
  labelNames: ['method', 'route'],
  registers: [metricsRegistry],
});

// ========================================
// WebSocket Metrics
// ========================================

export const wsConnectionsTotal = new Gauge({
  name: 'websocket_connections_total',
  help: 'Total number of WebSocket connections',
  registers: [metricsRegistry],
});

export const wsMessagesReceived = new Counter({
  name: 'websocket_messages_received_total',
  help: 'Total number of WebSocket messages received',
  labelNames: ['type'],
  registers: [metricsRegistry],
});

export const wsMessagesSent = new Counter({
  name: 'websocket_messages_sent_total',
  help: 'Total number of WebSocket messages sent',
  labelNames: ['type'],
  registers: [metricsRegistry],
});

// ========================================
// Order & Trading Metrics
// ========================================

export const ordersTotal = new Counter({
  name: 'orders_total',
  help: 'Total number of orders',
  labelNames: ['type', 'status', 'chain'],
  registers: [metricsRegistry],
});

export const orderValue = new Summary({
  name: 'order_value_usd',
  help: 'Order value in USD',
  labelNames: ['type', 'chain'],
  registers: [metricsRegistry],
});

export const orderProcessingDuration = new Histogram({
  name: 'order_processing_duration_seconds',
  help: 'Time to process an order',
  labelNames: ['type', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

export const activeOrders = new Gauge({
  name: 'active_orders_count',
  help: 'Number of active orders',
  labelNames: ['type', 'chain'],
  registers: [metricsRegistry],
});

// ========================================
// Settlement Metrics
// ========================================

export const settlementsTotal = new Counter({
  name: 'settlements_total',
  help: 'Total number of settlements',
  labelNames: ['status', 'chain'],
  registers: [metricsRegistry],
});

export const settlementValue = new Summary({
  name: 'settlement_value_usd',
  help: 'Settlement value in USD',
  labelNames: ['chain'],
  registers: [metricsRegistry],
});

export const settlementGasUsed = new Summary({
  name: 'settlement_gas_used',
  help: 'Gas used for settlements',
  labelNames: ['chain'],
  registers: [metricsRegistry],
});

export const settlementDuration = new Histogram({
  name: 'settlement_duration_seconds',
  help: 'Time to complete settlement',
  labelNames: ['chain', 'status'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [metricsRegistry],
});

export const settlementQueueSize = new Gauge({
  name: 'settlement_queue_size',
  help: 'Number of settlements in queue',
  labelNames: ['chain'],
  registers: [metricsRegistry],
});

// ========================================
// Matching Engine Metrics
// ========================================

export const matchingEngineOrders = new Gauge({
  name: 'matching_engine_orders_total',
  help: 'Total orders in matching engine',
  labelNames: ['side', 'pair'],
  registers: [metricsRegistry],
});

export const matchingEngineMatches = new Counter({
  name: 'matching_engine_matches_total',
  help: 'Total number of matches',
  labelNames: ['pair'],
  registers: [metricsRegistry],
});

export const matchingEngineLatency = new Histogram({
  name: 'matching_engine_latency_milliseconds',
  help: 'Matching engine processing latency',
  labelNames: ['operation'],
  buckets: [0.1, 0.5, 1, 5, 10, 50, 100, 500],
  registers: [metricsRegistry],
});

export const orderBookDepth = new Gauge({
  name: 'order_book_depth',
  help: 'Order book depth',
  labelNames: ['side', 'pair'],
  registers: [metricsRegistry],
});

// ========================================
// Database Metrics
// ========================================

export const dbConnectionsActive = new Gauge({
  name: 'database_connections_active',
  help: 'Active database connections',
  labelNames: ['database'],
  registers: [metricsRegistry],
});

export const dbConnectionsIdle = new Gauge({
  name: 'database_connections_idle',
  help: 'Idle database connections',
  labelNames: ['database'],
  registers: [metricsRegistry],
});

export const dbQueryDuration = new Histogram({
  name: 'database_query_duration_seconds',
  help: 'Database query duration',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [metricsRegistry],
});

export const dbQueryErrors = new Counter({
  name: 'database_query_errors_total',
  help: 'Total database query errors',
  labelNames: ['operation', 'error_type'],
  registers: [metricsRegistry],
});

// ========================================
// External API Metrics
// ========================================

export const externalApiCalls = new Counter({
  name: 'external_api_calls_total',
  help: 'Total external API calls',
  labelNames: ['service', 'endpoint', 'status'],
  registers: [metricsRegistry],
});

export const externalApiLatency = new Histogram({
  name: 'external_api_latency_seconds',
  help: 'External API call latency',
  labelNames: ['service', 'endpoint'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

export const externalApiErrors = new Counter({
  name: 'external_api_errors_total',
  help: 'Total external API errors',
  labelNames: ['service', 'endpoint', 'error_type'],
  registers: [metricsRegistry],
});

// ========================================
// System Health Metrics
// ========================================

export const systemHealth = new Gauge({
  name: 'system_health_status',
  help: 'System health status (1 = healthy, 0 = unhealthy)',
  labelNames: ['component'],
  registers: [metricsRegistry],
});

export const systemErrors = new Counter({
  name: 'system_errors_total',
  help: 'Total system errors',
  labelNames: ['component', 'error_type'],
  registers: [metricsRegistry],
});

// ========================================
// Business Metrics
// ========================================

export const totalVolumeUSD = new Counter({
  name: 'total_volume_usd',
  help: 'Total trading volume in USD',
  labelNames: ['chain', 'token_pair'],
  registers: [metricsRegistry],
});

export const totalFeesUSD = new Counter({
  name: 'total_fees_usd',
  help: 'Total fees collected in USD',
  labelNames: ['chain', 'fee_type'],
  registers: [metricsRegistry],
});

export const uniqueUsers = new Gauge({
  name: 'unique_users_total',
  help: 'Total unique users',
  labelNames: ['time_period'],
  registers: [metricsRegistry],
});

export const profitabilityUSD = new Gauge({
  name: 'profitability_usd',
  help: 'Profitability in USD',
  labelNames: ['time_period'],
  registers: [metricsRegistry],
});

// ========================================
// Middleware
// ========================================

export const metricsMiddleware = (req: Request, res: Response, next: any) => {
  const start = Date.now();
  
  // Intercept response to get status code
  const originalSend = res.send;
  res.send = function(data: any) {
    res.send = originalSend;
    res.send(data);
    
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path || 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
    };
    
    // Record metrics
    httpRequestDuration.labels(labels).observe(duration);
    httpRequestTotal.labels(labels).inc();
    
    if (req.headers['content-length']) {
      httpRequestSize.labels({ method: req.method, route }).observe(parseInt(req.headers['content-length']));
    }
    
    if (res.getHeader('content-length')) {
      httpResponseSize.labels({ method: req.method, route }).observe(parseInt(res.getHeader('content-length') as string));
    }
    
    return res;
  };
  
  next();
};

// ========================================
// Metrics Endpoint Handler
// ========================================

export const metricsHandler = async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    const metrics = await metricsRegistry.metrics();
    res.end(metrics);
  } catch (error) {
    res.status(500).end();
  }
};

// ========================================
// Helper Functions
// ========================================

export const recordOrderMetrics = (order: any) => {
  const labels = {
    type: order.type,
    status: order.status,
    chain: order.chain,
  };
  
  ordersTotal.labels(labels).inc();
  orderValue.labels({ type: order.type, chain: order.chain }).observe(order.valueUSD);
  
  if (order.status === 'active') {
    activeOrders.labels({ type: order.type, chain: order.chain }).inc();
  }
};

export const recordSettlementMetrics = (settlement: any) => {
  const labels = {
    status: settlement.status,
    chain: settlement.chain,
  };
  
  settlementsTotal.labels(labels).inc();
  settlementValue.labels({ chain: settlement.chain }).observe(settlement.valueUSD);
  settlementGasUsed.labels({ chain: settlement.chain }).observe(settlement.gasUsed);
};

export const recordExternalApiCall = (service: string, endpoint: string, duration: number, status: number, error?: any) => {
  const labels = {
    service,
    endpoint,
    status: status.toString(),
  };
  
  externalApiCalls.labels(labels).inc();
  externalApiLatency.labels({ service, endpoint }).observe(duration / 1000);
  
  if (error) {
    externalApiErrors.labels({
      service,
      endpoint,
      error_type: error.code || 'unknown',
    }).inc();
  }
};

export const updateSystemHealth = (component: string, healthy: boolean) => {
  systemHealth.labels({ component }).set(healthy ? 1 : 0);
};