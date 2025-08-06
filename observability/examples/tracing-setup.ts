import { TracingProvider, TracingConfig } from '../tracing/TracingProvider';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';

// Tracing configuration
const tracingConfig: TracingConfig = {
  serviceName: 'trading-system',
  serviceVersion: '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  exporters: {
    jaeger: {
      endpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
      username: process.env.JAEGER_USERNAME,
      password: process.env.JAEGER_PASSWORD
    },
    zipkin: {
      url: process.env.ZIPKIN_URL || 'http://localhost:9411/api/v2/spans',
      headers: {
        'X-API-Key': process.env.ZIPKIN_API_KEY || ''
      }
    },
    otlp: {
      url: process.env.OTLP_URL || 'http://localhost:4318/v1/traces',
      headers: {
        'Authorization': `Bearer ${process.env.OTLP_TOKEN || ''}`
      }
    },
    console: process.env.NODE_ENV === 'development'
  },
  sampling: {
    probability: 0.1, // Sample 10% of traces in production
    rules: [
      {
        name: 'always_sample_errors',
        match: (spanName, attributes) => attributes['error'] === true,
        sampleRate: 1.0 // Always sample errors
      },
      {
        name: 'high_value_orders',
        match: (spanName, attributes) => {
          const amount = attributes['order.amount'] as number;
          return amount > 10000;
        },
        sampleRate: 1.0 // Always sample high-value orders
      },
      {
        name: 'health_checks',
        match: (spanName) => spanName.includes('health'),
        sampleRate: 0.01 // Sample 1% of health checks
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

// Create tracing provider
export const tracer = new TracingProvider(tracingConfig);

// Initialize tracing
export async function initializeTracing() {
  try {
    await tracer.initialize();
    console.log('✅ Tracing initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize tracing:', error);
    throw error;
  }
}

// Usage examples
export async function demonstrateTracing() {
  // Basic span creation
  const span = tracer.startSpan('demo.operation', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'demo.type': 'example',
      'demo.user': 'test-user'
    }
  });

  try {
    // Do some work
    await simulateWork();
    
    span.setAttributes({
      'demo.result': 'success',
      'demo.items_processed': 42
    });
    
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.recordException(error);
    span.setStatus({ 
      code: SpanStatusCode.ERROR, 
      message: error.message 
    });
    throw error;
  } finally {
    span.end();
  }

  // Using active span pattern
  await tracer.startActiveSpan('process.batch', async (span) => {
    span.setAttributes({
      'batch.size': 100,
      'batch.type': 'orders'
    });

    // Process items
    for (let i = 0; i < 10; i++) {
      await tracer.startActiveSpan(`process.item.${i}`, async (itemSpan) => {
        itemSpan.setAttributes({
          'item.id': i,
          'item.type': 'order'
        });
        
        await simulateWork();
      });
    }
  });
}

// Order lifecycle tracing
export async function traceOrderLifecycle(orderId: string) {
  return tracer.traceOrder(orderId, async () => {
    // The traceOrder method automatically creates spans for:
    // - order.validate
    // - order.match
    // - order.execute
    // - order.settle
    
    // Your order processing logic here
    const order = {
      id: orderId,
      userId: 'user123',
      pair: 'ETH/USDT',
      side: 'buy',
      quantity: 1.5,
      price: 2000
    };

    // Validation (automatically traced)
    if (order.quantity <= 0) {
      throw new Error('Invalid order quantity');
    }

    // Matching (automatically traced)
    const matches = await findMatchingOrders(order);

    // Execution (automatically traced)
    const executionResult = await executeOrderWithMatches(order, matches);

    // Settlement (automatically traced)
    await settleOrder(executionResult);

    return executionResult;
  });
}

// WebSocket tracing
export function traceWebSocketConnection(connectionId: string) {
  const connectionSpan = tracer.traceWebSocketConnection(connectionId);
  
  // Handle connection lifecycle
  return {
    onMessage: (messageType: string, messageData: any) => {
      const messageSpan = tracer.traceWebSocketMessage(
        connectionId,
        messageType,
        'in'
      );
      
      try {
        // Process message
        processWebSocketMessage(messageType, messageData);
        messageSpan.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        messageSpan.recordException(error);
        messageSpan.setStatus({ code: SpanStatusCode.ERROR });
      } finally {
        messageSpan.end();
      }
    },
    
    sendMessage: (messageType: string, messageData: any) => {
      const messageSpan = tracer.traceWebSocketMessage(
        connectionId,
        messageType,
        'out'
      );
      
      try {
        // Send message
        sendWebSocketMessage(messageType, messageData);
        messageSpan.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        messageSpan.recordException(error);
        messageSpan.setStatus({ code: SpanStatusCode.ERROR });
      } finally {
        messageSpan.end();
      }
    },
    
    close: () => {
      connectionSpan.setAttributes({
        'websocket.close.timestamp': Date.now()
      });
      connectionSpan.end();
    }
  };
}

// Database operation tracing
export async function traceDatabaseOperations() {
  // SELECT query
  const users = await tracer.traceDatabase(
    'select',
    'SELECT * FROM users WHERE active = true',
    async () => {
      // Simulate database query
      await simulateWork();
      return { rowCount: 42, rows: [] };
    }
  );

  // INSERT query
  const insertResult = await tracer.traceDatabase(
    'insert',
    'INSERT INTO orders (user_id, pair, quantity) VALUES ($1, $2, $3)',
    async () => {
      await simulateWork();
      return { rowCount: 1, insertedId: 'order123' };
    }
  );

  // Transaction
  await tracer.startActiveSpan('db.transaction', async (span) => {
    span.setAttributes({
      'db.system': 'postgresql',
      'db.operation': 'transaction'
    });

    try {
      await tracer.traceDatabase('begin', 'BEGIN', async () => {});
      
      await tracer.traceDatabase(
        'update',
        'UPDATE balances SET amount = amount - $1 WHERE user_id = $2',
        async () => ({ rowCount: 1 })
      );
      
      await tracer.traceDatabase(
        'insert',
        'INSERT INTO transactions (user_id, amount) VALUES ($1, $2)',
        async () => ({ rowCount: 1 })
      );
      
      await tracer.traceDatabase('commit', 'COMMIT', async () => {});
      
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      await tracer.traceDatabase('rollback', 'ROLLBACK', async () => {});
      throw error;
    }
  });
}

// Settlement tracing
export async function traceSettlementProcess(settlementId: string) {
  return tracer.traceSettlement(settlementId, async () => {
    // The traceSettlement method automatically creates spans for:
    // - settlement.validate
    // - settlement.blockchain
    // - settlement.confirm
    
    // Simulate blockchain interaction
    await simulateWork(2000); // Longer operation
    
    return {
      settlementId,
      transactionHash: '0xabc123...',
      gasUsed: 21000,
      status: 'confirmed'
    };
  });
}

// Context propagation
export function demonstrateContextPropagation() {
  // Extract context from incoming HTTP headers
  const incomingHeaders = {
    'traceparent': '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    'tracestate': 'vendor1=value1,vendor2=value2'
  };
  
  const extractedContext = tracer.extractContext(incomingHeaders);
  
  // Use extracted context for new span
  const span = tracer.startSpan('handle.request', {
    parent: extractedContext,
    attributes: {
      'http.method': 'POST',
      'http.url': '/api/orders'
    }
  });
  
  // Inject context into outgoing HTTP headers
  const outgoingHeaders: Record<string, string> = {};
  tracer.injectContext(extractedContext, outgoingHeaders);
  
  console.log('Propagated headers:', outgoingHeaders);
  
  span.end();
}

// Correlation ID generation
export function generateCorrelationId(): string {
  return tracer.createCorrelationId();
}

// Performance analysis
export async function analyzePerformance() {
  // Create some spans with varying durations
  for (let i = 0; i < 5; i++) {
    await tracer.startActiveSpan(`slow.operation.${i}`, async (span) => {
      const duration = Math.random() * 2000 + 500; // 500-2500ms
      await simulateWork(duration);
      span.setAttributes({
        'operation.duration': duration
      });
    });
  }

  // Find slow spans
  const slowSpans = tracer.findSlowSpans(1000); // Find spans > 1 second
  console.log(`Found ${slowSpans.length} slow spans`);

  // Get metrics
  const metrics = tracer.getMetrics();
  console.log('Tracing Metrics:', {
    totalSpans: metrics.totalSpans,
    errorRate: `${metrics.errorRate.toFixed(2)}%`,
    activeSpans: metrics.activeSpans,
    spansByOperation: metrics.spansByOperation
  });
}

// Error tracing
export async function traceErrorScenarios() {
  // Trace an operation that fails
  try {
    await tracer.startActiveSpan('failing.operation', async (span) => {
      span.setAttributes({
        'operation.type': 'risky',
        'operation.retry_count': 3
      });

      // Simulate retries
      for (let i = 0; i < 3; i++) {
        await tracer.startActiveSpan(`retry.${i}`, async (retrySpan) => {
          retrySpan.setAttributes({
            'retry.attempt': i + 1
          });
          
          if (i < 2) {
            // Fail first two attempts
            const error = new Error(`Attempt ${i + 1} failed`);
            retrySpan.recordException(error);
            throw error;
          }
          
          // Success on third attempt
          await simulateWork();
        }).catch(error => {
          // Continue to next retry
          console.log(`Retry ${i + 1} failed:`, error.message);
        });
      }
    });
  } catch (error) {
    console.error('Operation failed after all retries:', error);
  }
}

// Cross-service tracing
export async function traceCrossServiceCall() {
  await tracer.startActiveSpan('api.call.external', async (span) => {
    span.setAttributes({
      'peer.service': 'payment-service',
      'peer.address': 'payment.api.com:443'
    });

    // Get current trace context
    const traceContext = tracer.getCurrentTraceContext();
    
    if (traceContext) {
      console.log('Current trace context:', {
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
        traceFlags: traceContext.traceFlags
      });
    }

    // Inject context into outgoing request
    const headers: Record<string, string> = {};
    tracer.injectContext(span.spanContext(), headers);

    // Make HTTP request with trace headers
    await makeHttpRequest('https://payment.api.com/process', {
      headers,
      method: 'POST',
      body: JSON.stringify({ amount: 100 })
    });
  });
}

// Cleanup
export async function cleanup() {
  await tracer.shutdown();
}

// Helper functions
async function simulateWork(duration: number = 100): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, duration));
}

async function findMatchingOrders(order: any): Promise<any[]> {
  await simulateWork(200);
  return [
    { id: 'match1', price: 1999, quantity: 0.5 },
    { id: 'match2', price: 2000, quantity: 1.0 }
  ];
}

async function executeOrderWithMatches(order: any, matches: any[]): Promise<any> {
  await simulateWork(300);
  return {
    orderId: order.id,
    executedQuantity: order.quantity,
    averagePrice: 1999.67,
    matches: matches.map(m => m.id)
  };
}

async function settleOrder(executionResult: any): Promise<void> {
  await simulateWork(500);
}

function processWebSocketMessage(type: string, data: any): void {
  console.log(`Processing WebSocket message: ${type}`);
}

function sendWebSocketMessage(type: string, data: any): void {
  console.log(`Sending WebSocket message: ${type}`);
}

async function makeHttpRequest(url: string, options: any): Promise<any> {
  await simulateWork(150);
  return { status: 200, data: { success: true } };
}