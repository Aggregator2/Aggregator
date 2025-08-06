# Observability System

A comprehensive observability solution for the trading system, featuring distributed tracing, structured logging, and real-time dashboards.

## Features

### 1. Distributed Tracing (OpenTelemetry)
- **Multiple Exporters**: Jaeger, Zipkin, and OTLP support
- **Automatic Instrumentation**: HTTP, Express, Redis, and database operations
- **Order Lifecycle Tracing**: End-to-end visibility of order processing
- **WebSocket Tracing**: Track real-time connections and messages
- **Context Propagation**: W3C Trace Context standard support
- **Smart Sampling**: Rule-based sampling for efficient tracing

### 2. Structured Logging
- **Multiple Outputs**: Console, file rotation, and Elasticsearch
- **Correlation IDs**: Automatic correlation with tracing
- **Log Sampling**: Reduce volume for high-frequency events
- **Sensitive Data Masking**: Automatic PII and credential masking
- **Performance Tracking**: Built-in timers and metrics
- **Contextual Logging**: Child loggers with inherited context

### 3. Real-time Dashboards
- **System Health Monitoring**: CPU, memory, and service status
- **Order Book Visualization**: Depth charts, heatmaps, and flow visualization
- **Settlement Metrics**: Success rates and performance tracking
- **User Activity Heatmaps**: Real-time user behavior analysis
- **P&L Tracking**: Comprehensive profit/loss monitoring
- **WebSocket Updates**: Live data streaming for all dashboards

## Quick Start

### Installation

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node winston @elastic/elasticsearch
npm install @mui/material recharts d3 react-spring date-fns
```

### Basic Setup

```typescript
import { TracingProvider } from './observability/tracing/TracingProvider';
import { StructuredLogger } from './observability/logging/StructuredLogger';

// Initialize tracing
const tracer = new TracingProvider({
  serviceName: 'trading-system',
  serviceVersion: '1.0.0',
  environment: 'production',
  exporters: {
    jaeger: {
      endpoint: 'http://localhost:14268/api/traces'
    }
  },
  sampling: {
    probability: 0.1
  }
});

await tracer.initialize();

// Initialize logging
const logger = new StructuredLogger({
  serviceName: 'trading-system',
  environment: 'production',
  level: 'info',
  outputs: {
    console: { enabled: true },
    elasticsearch: {
      enabled: true,
      node: 'http://localhost:9200',
      index: 'trading-logs'
    }
  }
});
```

## Component Overview

### TracingProvider

The central component for distributed tracing:

```typescript
// Trace an order lifecycle
await tracer.traceOrder(orderId, async () => {
  // Your order processing logic
  // Automatically creates spans for validation, matching, execution, and settlement
});

// Trace database operations
const result = await tracer.traceDatabase('select', query, async () => {
  return await db.query(query);
});

// Trace WebSocket connections
const wsTracer = tracer.traceWebSocketConnection(connectionId);
```

### StructuredLogger

Advanced logging with automatic context management:

```typescript
// Create contextual logger
const orderLogger = logger.child({
  orderId: 'order123',
  userId: 'user456'
});

// Performance tracking
orderLogger.startTimer('processing');
// ... do work ...
orderLogger.endTimer('processing', { status: 'completed' });

// Structured event logging
logger.logOrderEvent(orderId, 'matched', {
  matchedOrderId: 'order789',
  price: 2000,
  quantity: 1.5
});

// Security event logging
logger.logSecurityEvent('unauthorized_access', 'high', {
  userId: 'user123',
  resource: '/api/admin'
});
```

### Dashboard Components

#### RealtimeDashboard
Main monitoring dashboard with system health, metrics, and activity tracking.

```typescript
<RealtimeDashboard config={{
  wsUrl: 'wss://api.trading.com/ws',
  refreshInterval: 5000,
  theme: 'light'
}} />
```

#### OrderBookVisualization
Advanced order book visualization with multiple view modes:
- Depth chart
- Heatmap
- Order flow animation
- 3D visualization (coming soon)

```typescript
<OrderBookVisualization
  data={orderBookData}
  onPairChange={handlePairChange}
  availablePairs={['BTC/USDT', 'ETH/USDT']}
/>
```

#### PnLTrackingDashboard
Comprehensive P&L tracking with performance metrics:
- Real-time P&L updates
- Performance metrics (Sharpe ratio, profit factor)
- Position tracking
- Trade history

```typescript
<PnLTrackingDashboard 
  userId="user123"
  isAdmin={false}
/>
```

## Configuration

### Tracing Configuration

```typescript
const tracingConfig: TracingConfig = {
  serviceName: 'trading-system',
  serviceVersion: '1.0.0',
  environment: 'production',
  exporters: {
    jaeger: {
      endpoint: 'http://jaeger:14268/api/traces',
      username: 'optional',
      password: 'optional'
    },
    zipkin: {
      url: 'http://zipkin:9411/api/v2/spans'
    },
    otlp: {
      url: 'http://otel-collector:4318/v1/traces',
      headers: { 'Authorization': 'Bearer token' }
    }
  },
  sampling: {
    probability: 0.1,
    rules: [
      {
        name: 'always_sample_errors',
        match: (name, attrs) => attrs.error === true,
        sampleRate: 1.0
      }
    ]
  },
  instrumentations: {
    http: true,
    express: true,
    redis: true,
    database: true
  }
};
```

### Logging Configuration

```typescript
const loggerConfig: LoggerConfig = {
  serviceName: 'trading-system',
  environment: 'production',
  level: 'info',
  outputs: {
    console: {
      enabled: true,
      format: 'json'
    },
    file: {
      enabled: true,
      directory: './logs',
      filename: 'app',
      maxSize: '20m',
      maxFiles: '14d'
    },
    elasticsearch: {
      enabled: true,
      node: 'http://elasticsearch:9200',
      index: 'logs',
      auth: {
        username: 'elastic',
        password: 'password'
      }
    }
  },
  sampling: {
    enabled: true,
    rules: [...defaultSamplingRules],
    defaultRate: 1.0
  },
  masking: {
    enabled: true,
    patterns: [...defaultMaskingPatterns]
  },
  retention: {
    debug: 7,
    info: 30,
    warn: 90,
    error: 365
  }
};
```

## Best Practices

### Tracing
1. **Use semantic span names**: `service.operation.action`
2. **Add relevant attributes**: Include IDs, types, and statuses
3. **Handle errors properly**: Record exceptions and set error status
4. **Use appropriate span kinds**: SERVER, CLIENT, INTERNAL
5. **Propagate context**: Maintain trace context across services

### Logging
1. **Use structured logging**: Include metadata as objects
2. **Create child loggers**: Maintain context for related operations
3. **Track performance**: Use timers for critical operations
4. **Mask sensitive data**: Never log passwords, keys, or PII
5. **Use appropriate levels**: DEBUG, INFO, WARN, ERROR

### Dashboards
1. **Use WebSocket for real-time data**: Reduce API polling
2. **Implement proper error handling**: Show user-friendly messages
3. **Optimize rendering**: Use React.memo and useMemo
4. **Mobile responsiveness**: Test on various screen sizes
5. **Accessibility**: Include proper ARIA labels

## Monitoring Stack Setup

### Docker Compose Example

```yaml
version: '3.8'

services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "14268:14268"
    environment:
      - COLLECTOR_ZIPKIN_HOST_PORT=:9411

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
```

## Performance Considerations

### Tracing
- Use sampling to reduce overhead (10% recommended for production)
- Batch span exports to reduce network calls
- Set appropriate buffer sizes for high-volume systems
- Use head-based sampling for predictable overhead

### Logging
- Enable log sampling for high-frequency events
- Use async transports to prevent blocking
- Configure appropriate retention policies
- Index only necessary fields in Elasticsearch

### Dashboards
- Implement data aggregation on the backend
- Use pagination for large datasets
- Cache frequently accessed data
- Throttle WebSocket updates if needed

## Troubleshooting

### Common Issues

1. **High memory usage**: Reduce batch sizes and sampling rates
2. **Missing traces**: Check sampling configuration and exporters
3. **Log volume too high**: Implement stricter sampling rules
4. **Dashboard lag**: Reduce update frequency or data points
5. **Connection issues**: Verify network connectivity and endpoints

### Debug Mode

Enable debug logging for troubleshooting:

```typescript
// Enable console exporter for tracing
tracingConfig.exporters.console = true;

// Set log level to debug
loggerConfig.level = 'debug';
```

## Security

1. **Encrypt sensitive data**: Use TLS for all connections
2. **Mask sensitive information**: Configure masking patterns
3. **Authenticate endpoints**: Secure Jaeger and Elasticsearch
4. **Rate limit dashboards**: Prevent abuse of real-time features
5. **Audit access**: Log all dashboard and API access

## License

MIT