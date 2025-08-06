import { StructuredLogger, LoggerConfig, defaultMaskingPatterns, defaultSamplingRules } from '../logging/StructuredLogger';

// Logger configuration
const loggerConfig: LoggerConfig = {
  serviceName: 'trading-system',
  environment: process.env.NODE_ENV || 'development',
  level: process.env.LOG_LEVEL || 'info',
  outputs: {
    console: {
      enabled: true,
      format: process.env.NODE_ENV === 'production' ? 'json' : 'pretty'
    },
    file: {
      enabled: true,
      directory: './logs',
      filename: 'trading-system',
      maxSize: '20m',
      maxFiles: '14d',
      level: 'debug'
    },
    elasticsearch: {
      enabled: process.env.ELASTICSEARCH_ENABLED === 'true',
      node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      index: 'trading-logs',
      auth: process.env.ELASTICSEARCH_AUTH ? {
        username: process.env.ELASTICSEARCH_USER!,
        password: process.env.ELASTICSEARCH_PASS!
      } : undefined,
      flushInterval: 2000,
      bulkSize: 100
    }
  },
  sampling: {
    enabled: true,
    rules: [
      ...defaultSamplingRules,
      // Custom sampling rules
      {
        name: 'order_book_updates',
        match: (level, message) => message.includes('order book update'),
        rate: 0.1 // Sample 10% of order book updates
      },
      {
        name: 'price_ticks',
        match: (level, message, meta) => meta?.event === 'price_tick',
        rate: 0.05 // Sample 5% of price ticks
      }
    ],
    defaultRate: 1.0 // Log everything else
  },
  masking: {
    enabled: true,
    patterns: [
      ...defaultMaskingPatterns,
      // Custom masking patterns
      {
        name: 'private_key',
        pattern: /0x[a-fA-F0-9]{64}/g,
        replacement: '0x***PRIVATE_KEY***'
      },
      {
        name: 'wallet_address',
        pattern: /0x[a-fA-F0-9]{40}/g,
        replacement: '0x***WALLET***'
      }
    ]
  },
  retention: {
    debug: 7,    // 7 days
    info: 30,    // 30 days
    warn: 90,    // 90 days
    error: 365   // 1 year
  }
};

// Create logger instance
export const logger = new StructuredLogger(loggerConfig);

// Usage examples
export function demonstrateLogging() {
  // Basic logging
  logger.info('Trading system started');
  logger.debug('Debug information', { config: 'loaded' });
  logger.warn('Low balance detected', { userId: 'user123', balance: 10.50 });
  logger.error('Order failed', new Error('Insufficient funds'), { orderId: 'order456' });

  // Contextual logging
  const requestLogger = logger.child({
    requestId: 'req-123',
    userId: 'user456',
    sessionId: 'session-789'
  });

  requestLogger.info('Processing order request');

  // Performance tracking
  logger.startTimer('order_processing');
  
  // Simulate order processing
  setTimeout(() => {
    logger.endTimer('order_processing', {
      orderId: 'order789',
      status: 'completed'
    });
  }, 1500);

  // Structured logging for specific events
  
  // HTTP request logging
  const mockReq = {
    method: 'POST',
    url: '/api/orders',
    ip: '192.168.1.100',
    headers: {
      'user-agent': 'Mozilla/5.0',
      'referer': 'https://trading-app.com'
    },
    id: 'req-456'
  };
  
  const mockRes = {
    statusCode: 200
  };
  
  logger.logHttpRequest(mockReq, mockRes, 145);

  // Database query logging
  logger.logDatabaseQuery(
    'SELECT * FROM orders WHERE user_id = $1 AND status = $2',
    23
  );

  // Order event logging
  logger.logOrderEvent('order-123', 'created', {
    userId: 'user789',
    pair: 'ETH/USDT',
    side: 'buy',
    quantity: 1.5,
    price: 2000
  });

  logger.logOrderEvent('order-123', 'matched', {
    matchedOrderId: 'order-456',
    executionPrice: 1999.50
  });

  logger.logOrderEvent('order-123', 'settled', {
    transactionHash: '0x123abc...',
    gasUsed: 21000
  });

  // WebSocket event logging
  logger.logWebSocketEvent('ws-conn-123', 'connected', {
    clientIp: '192.168.1.100',
    protocol: 'wss'
  });

  logger.logWebSocketEvent('ws-conn-123', 'message', {
    messageType: 'subscribe',
    channel: 'orderbook'
  });

  // Security event logging
  logger.logSecurityEvent('unauthorized_access', 'high', {
    userId: 'user123',
    resource: '/api/admin/users',
    ip: '192.168.1.100'
  });

  logger.logSecurityEvent('rate_limit_exceeded', 'medium', {
    ip: '192.168.1.100',
    endpoint: '/api/orders',
    requests: 150,
    timeWindow: '1m'
  });

  // Sensitive data masking demonstration
  logger.info('User authentication', {
    email: 'user@example.com',
    password: 'super_secret_password', // Will be masked
    apiKey: 'sk_live_EXAMPLE_KEY_DO_NOT_USE', // Will be masked
    privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' // Will be masked
  });
}

// Error handling with context
export function handleOrderError(error: Error, context: any) {
  const errorLogger = logger.child({
    orderId: context.orderId,
    userId: context.userId,
    correlationId: logger.createCorrelationId()
  });

  errorLogger.error('Order processing failed', error, {
    orderType: context.orderType,
    amount: context.amount,
    timestamp: new Date().toISOString()
  });
}

// Async operations with context preservation
export async function processOrderWithLogging(order: any) {
  const orderLogger = logger.child({
    orderId: order.id,
    userId: order.userId,
    traceId: generateTraceId()
  });

  orderLogger.info('Starting order processing');
  orderLogger.startTimer('total_processing');

  try {
    // Validation
    orderLogger.startTimer('validation');
    await validateOrder(order);
    orderLogger.endTimer('validation');

    // Matching
    orderLogger.startTimer('matching');
    const matches = await findMatches(order);
    orderLogger.endTimer('matching', { matchCount: matches.length });

    // Execution
    orderLogger.startTimer('execution');
    const result = await executeOrder(order, matches);
    orderLogger.endTimer('execution', { executedAmount: result.amount });

    orderLogger.endTimer('total_processing', { status: 'success' });
    orderLogger.info('Order processed successfully', result);

    return result;

  } catch (error) {
    orderLogger.endTimer('total_processing', { status: 'failed' });
    orderLogger.error('Order processing failed', error);
    throw error;
  }
}

// Log aggregation and search
export async function searchLogs() {
  try {
    // Search for errors in the last hour
    const recentErrors = await logger.search({
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(),
      level: ['error', 'warn'],
      limit: 50
    });

    console.log(`Found ${recentErrors.length} errors/warnings`);

    // Search by correlation ID
    const correlatedLogs = await logger.search({
      correlationId: 'specific-correlation-id',
      limit: 100
    });

    console.log(`Found ${correlatedLogs.length} correlated logs`);

    // Search by user
    const userLogs = await logger.search({
      userId: 'user123',
      startTime: new Date(Date.now() - 86400000), // Last 24 hours
      limit: 200
    });

    console.log(`Found ${userLogs.length} logs for user`);

    // Full-text search
    const searchResults = await logger.search({
      message: 'order failed insufficient',
      level: 'error',
      limit: 20
    });

    console.log(`Found ${searchResults.length} matching logs`);

  } catch (error) {
    console.error('Log search failed:', error);
  }
}

// Metrics and monitoring
export function logMetrics() {
  const metrics = logger.getMetrics();
  
  console.log('Logging Metrics:', {
    totalLogs: metrics.total,
    logsByLevel: metrics.byLevel,
    sampledLogs: metrics.sampledCount,
    maskedLogs: metrics.maskedCount,
    effectiveSamplingRate: `${metrics.samplingRate.toFixed(2)}%`
  });
}

// Cleanup
export async function cleanup() {
  await logger.close();
}

// Helper functions (mock implementations)
function generateTraceId(): string {
  return `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function validateOrder(order: any): Promise<void> {
  // Mock validation
  await new Promise(resolve => setTimeout(resolve, 50));
}

async function findMatches(order: any): Promise<any[]> {
  // Mock matching
  await new Promise(resolve => setTimeout(resolve, 100));
  return [{ id: 'match1' }, { id: 'match2' }];
}

async function executeOrder(order: any, matches: any[]): Promise<any> {
  // Mock execution
  await new Promise(resolve => setTimeout(resolve, 150));
  return { id: order.id, amount: 100, status: 'completed' };
}