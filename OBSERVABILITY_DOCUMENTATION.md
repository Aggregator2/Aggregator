# Observability System Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Distributed Tracing](#distributed-tracing)
4. [Structured Logging](#structured-logging)
5. [Real-time Dashboards](#real-time-dashboards)
6. [Integration Guide](#integration-guide)
7. [Configuration Reference](#configuration-reference)
8. [Performance Optimization](#performance-optimization)
9. [Troubleshooting](#troubleshooting)
10. [Security Considerations](#security-considerations)

## Overview

The observability system provides comprehensive monitoring, tracing, and logging capabilities for the trading platform. It consists of three main components:

1. **Distributed Tracing**: OpenTelemetry-based tracing for end-to-end visibility
2. **Structured Logging**: Advanced logging with Elasticsearch integration
3. **Real-time Dashboards**: Interactive dashboards for system monitoring

### Key Features
- End-to-end order lifecycle tracing
- Automatic sensitive data masking
- Real-time performance metrics
- WebSocket-based live updates
- Smart sampling for efficiency
- Cross-service correlation
- Advanced data visualization

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Trading Application                      │
├─────────────────┬─────────────────┬────────────────────────┤
│  TracingProvider│ StructuredLogger │   Dashboard Components │
├─────────────────┼─────────────────┼────────────────────────┤
│  OpenTelemetry  │     Winston      │    React + D3.js       │
├─────────────────┴─────────────────┴────────────────────────┤
│                    Export/Storage Layer                      │
├──────────┬──────────┬──────────┬──────────┬───────────────┤
│  Jaeger  │  Zipkin  │   OTLP   │Elasticsearch│  WebSocket   │
└──────────┴──────────┴──────────┴──────────┴───────────────┘
```

## Distributed Tracing

### Overview
The tracing system uses OpenTelemetry to provide distributed tracing capabilities across all components of the trading system.

### Core Components

#### TracingProvider
Located at: `/workspace/observability/tracing/TracingProvider.ts`

```typescript
import { TracingProvider } from './observability/tracing/TracingProvider';

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
```

### Tracing Patterns

#### Order Lifecycle Tracing
Automatically creates spans for each phase of order processing:

```typescript
await tracer.traceOrder(orderId, async () => {
  // Your order processing logic
  // Automatic spans created for:
  // - order.validate
  // - order.match
  // - order.execute
  // - order.settle
});
```

#### Database Operation Tracing
```typescript
const result = await tracer.traceDatabase('select', 
  'SELECT * FROM orders WHERE status = $1',
  async () => {
    return await db.query(query, ['pending']);
  }
);
```

#### WebSocket Connection Tracing
```typescript
const wsTracer = tracer.traceWebSocketConnection(connectionId);

// Trace incoming messages
wsTracer.onMessage('subscribe', messageData);

// Trace outgoing messages
wsTracer.sendMessage('orderUpdate', updateData);

// Close connection
wsTracer.close();
```

#### Settlement Process Tracing
```typescript
await tracer.traceSettlement(settlementId, async () => {
  // Automatic spans for:
  // - settlement.validate
  // - settlement.blockchain
  // - settlement.confirm
  return await blockchainService.settle(settlementData);
});
```

### Context Propagation

#### Extracting Context from Headers
```typescript
const incomingHeaders = req.headers;
const context = tracer.extractContext(incomingHeaders);

const span = tracer.startSpan('handle.request', {
  parent: context
});
```

#### Injecting Context into Headers
```typescript
const outgoingHeaders = {};
tracer.injectContext(span.spanContext(), outgoingHeaders);

// Use headers in outgoing HTTP request
await fetch(url, { headers: outgoingHeaders });
```

### Sampling Configuration

```typescript
{
  sampling: {
    probability: 0.1, // Default 10% sampling
    rules: [
      {
        name: 'always_sample_errors',
        match: (spanName, attributes) => attributes.error === true,
        sampleRate: 1.0 // 100% sampling for errors
      },
      {
        name: 'high_value_orders',
        match: (spanName, attributes) => attributes['order.amount'] > 10000,
        sampleRate: 1.0 // 100% sampling for high-value orders
      },
      {
        name: 'health_checks',
        match: (spanName) => spanName.includes('health'),
        sampleRate: 0.01 // 1% sampling for health checks
      }
    ]
  }
}
```

## Structured Logging

### Overview
The logging system provides structured, contextual logging with automatic correlation to traces.

### Core Components

#### StructuredLogger
Located at: `/workspace/observability/logging/StructuredLogger.ts`

```typescript
import { StructuredLogger } from './observability/logging/StructuredLogger';

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

### Logging Patterns

#### Basic Logging
```typescript
logger.info('Order processed successfully', {
  orderId: 'order123',
  userId: 'user456',
  amount: 1000
});

logger.error('Order processing failed', error, {
  orderId: 'order123',
  retryCount: 3
});
```

#### Contextual Logging
```typescript
const orderLogger = logger.child({
  orderId: 'order123',
  userId: 'user456',
  correlationId: logger.createCorrelationId()
});

orderLogger.info('Starting order processing');
orderLogger.debug('Order validation passed');
orderLogger.info('Order completed');
```

#### Performance Tracking
```typescript
logger.startTimer('order_processing');

// Process order...

logger.endTimer('order_processing', {
  orderId: 'order123',
  status: 'success',
  matchCount: 5
});
```

#### Structured Event Logging
```typescript
// HTTP Request Logging
logger.logHttpRequest(req, res, duration);

// Database Query Logging
logger.logDatabaseQuery(query, duration, error);

// Order Event Logging
logger.logOrderEvent(orderId, 'matched', {
  matchedOrderId: 'order789',
  price: 2000,
  quantity: 1.5
});

// WebSocket Event Logging
logger.logWebSocketEvent(connectionId, 'message', {
  messageType: 'subscribe',
  channel: 'orderbook'
});

// Security Event Logging
logger.logSecurityEvent('unauthorized_access', 'high', {
  userId: 'user123',
  resource: '/api/admin',
  ip: req.ip
});
```

### Data Masking Configuration

```typescript
{
  masking: {
    enabled: true,
    patterns: [
      {
        name: 'email',
        pattern: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi,
        replacement: '***@***.***'
      },
      {
        name: 'api_key',
        pattern: /([a-zA-Z0-9]{32,})/g,
        replacement: '***API_KEY***'
      },
      {
        name: 'private_key',
        pattern: /0x[a-fA-F0-9]{64}/g,
        replacement: '0x***PRIVATE_KEY***'
      }
    ]
  }
}
```

### Log Sampling Rules

```typescript
{
  sampling: {
    enabled: true,
    rules: [
      {
        name: 'health_checks',
        match: (level, message) => message.includes('/health'),
        rate: 0.01 // Sample 1% of health check logs
      },
      {
        name: 'websocket_heartbeat',
        match: (level, message, meta) => meta?.websocket?.event === 'heartbeat',
        rate: 0.05 // Sample 5% of heartbeat logs
      }
    ],
    defaultRate: 1.0 // Log everything else
  }
}
```

### Elasticsearch Integration

#### Index Template
The logger automatically creates an index template with appropriate mappings:

```json
{
  "index_patterns": ["trading-logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "logs-policy"
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "level": { "type": "keyword" },
        "message": { "type": "text" },
        "correlationId": { "type": "keyword" },
        "traceId": { "type": "keyword" },
        "userId": { "type": "keyword" }
      }
    }
  }
}
```

#### Log Search Queries
```typescript
// Search for recent errors
const errors = await logger.search({
  startTime: new Date(Date.now() - 3600000),
  level: ['error', 'warn'],
  limit: 100
});

// Search by correlation ID
const correlatedLogs = await logger.search({
  correlationId: 'abc123-def456',
  limit: 200
});

// Full-text search
const results = await logger.search({
  message: 'order failed insufficient funds',
  level: 'error',
  limit: 50
});
```

## Real-time Dashboards

### Overview
The dashboard system provides real-time monitoring and visualization of system metrics, order book data, and P&L tracking.

### Dashboard Components

#### RealtimeDashboard
Main monitoring dashboard with system health and metrics.

Located at: `/workspace/observability/dashboards/RealtimeDashboard.tsx`

Features:
- System health monitoring (CPU, memory, services)
- Order book depth visualization
- Settlement success rates
- User activity heatmaps
- P&L tracking overview
- WebSocket connection status

#### OrderBookVisualization
Advanced order book visualization with multiple view modes.

Located at: `/workspace/observability/dashboards/OrderBookVisualization.tsx`

View Modes:
1. **Depth Chart**: D3.js-based market depth visualization
2. **Heatmap**: Canvas-based volume heatmap
3. **Order Flow**: Animated order flow visualization
4. **3D View**: Three.js 3D visualization (planned)

#### PnLTrackingDashboard
Comprehensive P&L tracking and analysis.

Located at: `/workspace/observability/dashboards/PnLTrackingDashboard.tsx`

Features:
- Real-time P&L overview with animations
- Performance metrics (Sharpe ratio, profit factor, max drawdown)
- P&L timeline charts
- P&L breakdown by trading pair
- Open positions table
- Recent trades history
- Multi-view modes (overview, detailed, analysis)

### Dashboard Setup

```typescript
import { RealtimeDashboard } from './observability/dashboards/RealtimeDashboard';
import { OrderBookVisualization } from './observability/dashboards/OrderBookVisualization';
import { PnLTrackingDashboard } from './observability/dashboards/PnLTrackingDashboard';

// Dashboard configuration
const config = {
  wsUrl: 'wss://api.trading.com/ws',
  refreshInterval: 5000,
  theme: 'light'
};

// In your React app
<RealtimeDashboard config={config} />

<OrderBookVisualization
  data={orderBookData}
  onPairChange={handlePairChange}
  availablePairs={['BTC/USDT', 'ETH/USDT']}
/>

<PnLTrackingDashboard
  userId="user123"
  isAdmin={false}
/>
```

### WebSocket Integration

```typescript
import { DashboardWebSocket } from './observability/examples/dashboard-setup';

const ws = new DashboardWebSocket();

// Connect to WebSocket
ws.connect('wss://api.trading.com/ws');

// Subscribe to events
ws.on('system_health', (data) => {
  updateSystemHealth(data);
});

ws.on('orderbook_depth', (data) => {
  updateOrderBook(data);
});

ws.on('pnl_update', (data) => {
  updatePnL(data);
});

// Send commands
ws.send({ action: 'subscribe', channels: ['orderbook', 'trades'] });
```

## Integration Guide

### Step 1: Install Dependencies

```bash
# Tracing dependencies
npm install @opentelemetry/api @opentelemetry/sdk-node
npm install @opentelemetry/auto-instrumentations-node
npm install @opentelemetry/exporter-jaeger
npm install @opentelemetry/exporter-zipkin
npm install @opentelemetry/exporter-trace-otlp-http

# Logging dependencies
npm install winston winston-daily-rotate-file winston-elasticsearch
npm install @elastic/elasticsearch

# Dashboard dependencies
npm install @mui/material @emotion/react @emotion/styled
npm install recharts d3 react-spring
npm install react-use-websocket date-fns
```

### Step 2: Initialize Services

```typescript
// In your application startup
import { TracingProvider } from './observability/tracing/TracingProvider';
import { StructuredLogger } from './observability/logging/StructuredLogger';

// Initialize tracing
const tracer = new TracingProvider(tracingConfig);
await tracer.initialize();

// Initialize logging
const logger = new StructuredLogger(loggerConfig);

// Make available globally
global.tracer = tracer;
global.logger = logger;
```

### Step 3: Instrument Your Code

```typescript
// In your order service
export async function processOrder(orderData: OrderData) {
  return tracer.traceOrder(orderData.id, async () => {
    const orderLogger = logger.child({ orderId: orderData.id });
    
    orderLogger.info('Processing order', { ...orderData });
    
    try {
      // Your order processing logic
      const result = await orderService.process(orderData);
      
      orderLogger.info('Order processed successfully', { result });
      return result;
      
    } catch (error) {
      orderLogger.error('Order processing failed', error);
      throw error;
    }
  });
}
```

### Step 4: Setup Dashboards

```typescript
// In your React app
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RealtimeDashboard } from './observability/dashboards/RealtimeDashboard';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2196f3' },
    secondary: { main: '#ff9800' }
  }
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <RealtimeDashboard config={dashboardConfig} />
    </ThemeProvider>
  );
}
```

## Configuration Reference

### Tracing Configuration

```typescript
interface TracingConfig {
  serviceName: string;           // Name of your service
  serviceVersion: string;        // Service version
  environment: string;           // Environment (dev, staging, prod)
  exporters: {
    jaeger?: {
      endpoint: string;          // Jaeger collector endpoint
      username?: string;         // Basic auth username
      password?: string;         // Basic auth password
    };
    zipkin?: {
      url: string;              // Zipkin API endpoint
      headers?: Record<string, string>; // Custom headers
    };
    otlp?: {
      url: string;              // OTLP endpoint
      headers?: Record<string, string>; // Auth headers
    };
    console?: boolean;          // Enable console output
  };
  sampling: {
    probability: number;        // Default sampling rate (0-1)
    rules?: SamplingRule[];     // Custom sampling rules
  };
  instrumentations?: {
    http?: boolean;             // HTTP instrumentation
    express?: boolean;          // Express instrumentation
    redis?: boolean;            // Redis instrumentation
    database?: boolean;         // Database instrumentation
  };
}
```

### Logging Configuration

```typescript
interface LoggerConfig {
  serviceName: string;          // Service name
  environment: string;          // Environment
  level: string;               // Default log level
  correlationId?: string;      // Initial correlation ID
  outputs: {
    console?: {
      enabled: boolean;        // Enable console output
      level?: string;          // Console log level
      format?: 'json' | 'pretty'; // Output format
    };
    file?: {
      enabled: boolean;        // Enable file output
      directory: string;       // Log directory
      filename: string;        // Base filename
      maxSize: string;         // Max file size (e.g., '20m')
      maxFiles: string;        // Max retention (e.g., '14d')
      level?: string;          // File log level
    };
    elasticsearch?: {
      enabled: boolean;        // Enable ES output
      node: string | string[]; // ES node(s)
      index: string;           // Index prefix
      auth?: {
        username: string;      // ES username
        password: string;      // ES password
      };
      flushInterval?: number;  // Flush interval (ms)
      bulkSize?: number;       // Bulk size
    };
  };
  sampling: {
    enabled: boolean;          // Enable sampling
    rules: SamplingRule[];     // Sampling rules
    defaultRate: number;       // Default rate (0-1)
  };
  masking: {
    enabled: boolean;          // Enable masking
    patterns: MaskingPattern[]; // Masking patterns
  };
  retention: {
    debug: number;             // Days to retain debug logs
    info: number;              // Days to retain info logs
    warn: number;              // Days to retain warn logs
    error: number;             // Days to retain error logs
  };
}
```

## Performance Optimization

### Tracing Optimization

1. **Use Appropriate Sampling**
   ```typescript
   // Production configuration
   sampling: {
     probability: 0.1, // 10% baseline
     rules: [
       // Always sample errors and high-value transactions
       { match: (n, a) => a.error === true, sampleRate: 1.0 },
       { match: (n, a) => a['order.value'] > 10000, sampleRate: 1.0 },
       // Reduce sampling for high-frequency operations
       { match: (n) => n.includes('health'), sampleRate: 0.01 }
     ]
   }
   ```

2. **Batch Span Exports**
   ```typescript
   // Automatically configured in TracingProvider
   new BatchSpanProcessor(exporter, {
     maxQueueSize: 2048,
     maxExportBatchSize: 512,
     scheduledDelayMillis: 5000
   })
   ```

3. **Minimize Span Attributes**
   ```typescript
   // Good: Only essential attributes
   span.setAttributes({
     'order.id': orderId,
     'order.status': status
   });
   
   // Avoid: Large or numerous attributes
   span.setAttributes({
     'order.full_data': JSON.stringify(largeObject) // Don't do this
   });
   ```

### Logging Optimization

1. **Enable Log Sampling**
   ```typescript
   sampling: {
     enabled: true,
     rules: [
       // Sample high-frequency logs
       { 
         match: (l, m) => m.includes('websocket ping'), 
         rate: 0.01 
       }
     ]
   }
   ```

2. **Use Async Transports**
   ```typescript
   // File and Elasticsearch transports are async by default
   outputs: {
     file: { enabled: true },
     elasticsearch: { enabled: true }
   }
   ```

3. **Optimize Elasticsearch Bulk Operations**
   ```typescript
   elasticsearch: {
     flushInterval: 5000,  // 5 seconds
     bulkSize: 200        // 200 documents per bulk
   }
   ```

### Dashboard Optimization

1. **Implement Data Aggregation**
   ```typescript
   // Aggregate on backend before sending to dashboard
   const aggregatedData = {
     orderbook: aggregateOrderBook(rawData),
     metrics: calculateMetrics(rawData),
     // Send summary instead of raw data
   };
   ```

2. **Use WebSocket Throttling**
   ```typescript
   // Throttle updates to prevent overwhelming the UI
   const throttledUpdate = throttle((data) => {
     updateDashboard(data);
   }, 100); // Max 10 updates per second
   ```

3. **Implement Virtual Scrolling**
   ```typescript
   // For large tables
   import { FixedSizeList } from 'react-window';
   
   <FixedSizeList
     height={600}
     itemCount={trades.length}
     itemSize={50}
   >
     {({ index, style }) => (
       <TradeRow trade={trades[index]} style={style} />
     )}
   </FixedSizeList>
   ```

## Troubleshooting

### Common Issues

#### Missing Traces
1. Check sampling configuration
2. Verify exporter endpoints
3. Ensure tracer is initialized
4. Check network connectivity

```typescript
// Enable debug mode
const tracer = new TracingProvider({
  ...config,
  exporters: { console: true } // Enable console output
});
```

#### High Memory Usage
1. Reduce batch sizes
2. Lower sampling rates
3. Implement memory limits

```typescript
// Reduce memory usage
{
  maxQueueSize: 1024,      // Reduce from 2048
  maxExportBatchSize: 256, // Reduce from 512
  sampling: {
    probability: 0.05      // Reduce from 0.1
  }
}
```

#### Log Volume Issues
1. Enable sampling
2. Adjust retention policies
3. Filter unnecessary logs

```typescript
// Aggressive sampling for production
{
  sampling: {
    enabled: true,
    defaultRate: 0.1,  // Only log 10% by default
    rules: [
      // Critical logs always logged
      { match: (l) => l === 'error', rate: 1.0 }
    ]
  }
}
```

#### Dashboard Performance
1. Reduce update frequency
2. Limit data points
3. Use data aggregation

```typescript
// Optimize dashboard updates
const config = {
  refreshInterval: 10000,  // 10 seconds instead of 5
  maxDataPoints: 100,      // Limit chart data points
  aggregationInterval: 60  // 1-minute aggregation
};
```

### Debug Commands

```bash
# Check Jaeger
curl http://localhost:16686/api/traces?service=trading-system

# Check Elasticsearch
curl http://localhost:9200/_cat/indices?v

# Test WebSocket connection
wscat -c wss://localhost:8080/ws

# View logs
docker logs -f trading-system

# Check memory usage
docker stats trading-system
```

## Security Considerations

### Data Protection

1. **Sensitive Data Masking**
   ```typescript
   // Automatically masks sensitive patterns
   masking: {
     enabled: true,
     patterns: [
       { pattern: /password=\S+/g, replacement: 'password=***' },
       { pattern: /api[_-]?key=\S+/g, replacement: 'api_key=***' }
     ]
   }
   ```

2. **Secure Transport**
   ```typescript
   // Use TLS for all connections
   exporters: {
     jaeger: {
       endpoint: 'https://jaeger.example.com:14268/api/traces'
     }
   }
   ```

3. **Access Control**
   ```typescript
   // Implement authentication
   elasticsearch: {
     auth: {
       username: process.env.ES_USER,
       password: process.env.ES_PASS
     }
   }
   ```

### Compliance

1. **Data Retention**
   ```typescript
   retention: {
     debug: 7,    // 7 days for debug
     info: 30,    // 30 days for info
     warn: 90,    // 90 days for warnings
     error: 365   // 1 year for errors
   }
   ```

2. **Audit Logging**
   ```typescript
   // Log all access to sensitive data
   logger.logSecurityEvent('data_access', 'medium', {
     userId: user.id,
     resource: 'user_profiles',
     action: 'read'
   });
   ```

3. **PII Protection**
   ```typescript
   // Never log PII directly
   logger.info('User login', {
     userId: user.id,  // Use ID, not email
     timestamp: Date.now()
   });
   ```

### Best Practices

1. **Use Environment Variables**
   ```typescript
   const config = {
     serviceName: process.env.SERVICE_NAME || 'trading-system',
     exporters: {
       jaeger: {
         endpoint: process.env.JAEGER_ENDPOINT,
         username: process.env.JAEGER_USER,
         password: process.env.JAEGER_PASS
       }
     }
   };
   ```

2. **Implement Rate Limiting**
   ```typescript
   // Limit dashboard connections
   const rateLimiter = new RateLimiter({
     windowMs: 60000,  // 1 minute
     max: 100          // 100 requests per minute
   });
   ```

3. **Regular Security Audits**
   - Review masking patterns
   - Audit access logs
   - Update dependencies
   - Test data leakage

## Monitoring Stack Deployment

### Docker Compose Setup

```yaml
version: '3.8'

services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    environment:
      - COLLECTOR_ZIPKIN_HOST_PORT=:9411
      - SPAN_STORAGE_TYPE=elasticsearch
      - ES_SERVER_URLS=http://elasticsearch:9200
    ports:
      - "16686:16686"
      - "14268:14268"
    depends_on:
      - elasticsearch

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    volumes:
      - es_data:/usr/share/elasticsearch/data

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    ports:
      - "3000:3000"
    volumes:
      - grafana_data:/var/lib/grafana

volumes:
  es_data:
  grafana_data:
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: trading-system
spec:
  replicas: 3
  selector:
    matchLabels:
      app: trading-system
  template:
    metadata:
      labels:
        app: trading-system
    spec:
      containers:
      - name: trading-system
        image: trading-system:latest
        env:
        - name: JAEGER_ENDPOINT
          value: "http://jaeger-collector:14268/api/traces"
        - name: ELASTICSEARCH_URL
          value: "http://elasticsearch:9200"
        - name: LOG_LEVEL
          value: "info"
        - name: TRACE_SAMPLING_RATE
          value: "0.1"
```

## Conclusion

The observability system provides comprehensive monitoring capabilities for the trading platform. By following this documentation, you can:

1. Implement distributed tracing for full visibility
2. Set up structured logging with automatic correlation
3. Deploy real-time dashboards for monitoring
4. Optimize performance with smart sampling
5. Ensure security with data masking and access control

For additional support or questions, refer to the example implementations in `/workspace/observability/examples/`.