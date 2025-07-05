import { WebSocketClient } from './WebSocketClientManager';
import { WebSocketServer } from './WebSocketServer';
import { RateLimiter } from './RateLimiter';
import { createServer } from 'http';

// Example: Demonstrate rate limiting behavior
async function demonstrateRateLimiting() {
  console.log('\n=== WebSocket Rate Limiting Demo ===\n');

  // 1. Create server with rate limiting configuration
  const httpServer = createServer();
  const wsServer = new WebSocketServer(httpServer, {
    rateLimiting: {
      maxSubscriptionsPerConnection: 10,
      maxConnectionsPerApiKey: 5,
      messageThrottling: {
        windowMs: 60000,
        maxMessages: 1000,
        highFrequencyChannels: ['orderbook', 'trades', 'tickers'],
        throttleDelay: 100
      },
      connectionLimits: {
        globalMaxConnections: 10000,
        perIpMaxConnections: 10,
        burstAllowance: 2
      }
    }
  });

  httpServer.listen(3003, () => {
    console.log('WebSocket server with rate limiting listening on port 3003');
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 2. Test connection limits
  await testConnectionLimits();

  // 3. Test subscription limits
  await testSubscriptionLimits();

  // 4. Test message rate limits
  await testMessageRateLimits();

  // 5. Test high-frequency channel throttling
  await testChannelThrottling();

  // 6. Monitor rate limit status
  await monitorRateLimitStatus();

  // Cleanup
  httpServer.close();
}

// Test connection limits per API key
async function testConnectionLimits() {
  console.log('\n--- Testing Connection Limits ---\n');

  const apiKey = 'test-api-key-123';
  const clients: WebSocketClient[] = [];

  try {
    // Try to create 6 connections (limit is 5)
    for (let i = 0; i < 6; i++) {
      const client = new WebSocketClient({
        url: 'http://localhost:3003',
        path: '/ws',
        apiKey,
        reconnection: false
      });

      client.on('connected', () => {
        console.log(`Client ${i + 1} connected successfully`);
      });

      client.on('error', (error) => {
        console.log(`Client ${i + 1} error:`, error.message);
      });

      client.connect();
      clients.push(client);

      // Wait a bit between connections
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Wait for all connection attempts
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check how many connected
    const connectedCount = clients.filter(c => c.getState() === 'CONNECTED').length;
    console.log(`\nConnected: ${connectedCount} out of 6 attempts (limit: 5)`);

  } finally {
    // Cleanup
    clients.forEach(client => client.disconnect());
  }
}

// Test subscription limits
async function testSubscriptionLimits() {
  console.log('\n--- Testing Subscription Limits ---\n');

  const client = new WebSocketClient({
    url: 'http://localhost:3003',
    path: '/ws',
    apiKey: 'test-api-key-456',
    reconnection: false
  });

  client.connect();

  // Wait for connection
  await new Promise(resolve => {
    client.once('connected', resolve);
  });

  console.log('Client connected, testing subscription limits...');

  // Try to subscribe to 12 channels (limit is 10)
  const subscriptions: string[] = [];
  
  for (let i = 0; i < 12; i++) {
    const sub = client.subscribe(
      'orderbook',
      (message) => {
        // Handler
      },
      { pair: `TEST${i}/USDC` }
    );

    if (sub) {
      subscriptions.push(sub);
      console.log(`Subscription ${i + 1}: Success`);
    } else {
      console.log(`Subscription ${i + 1}: Failed (limit reached)`);
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\nSuccessful subscriptions: ${subscriptions.length} (limit: 10)`);

  // Cleanup
  client.disconnect();
  await new Promise(resolve => setTimeout(resolve, 500));
}

// Test message rate limits
async function testMessageRateLimits() {
  console.log('\n--- Testing Message Rate Limits ---\n');

  const client = new WebSocketClient({
    url: 'http://localhost:3003',
    path: '/ws',
    apiKey: 'test-api-key-789',
    reconnection: false
  });

  let errorCount = 0;
  let successCount = 0;

  client.on('error', (error) => {
    if (error.code === 'RATE_LIMIT_EXCEEDED') {
      errorCount++;
    }
  });

  client.on('subscribed', () => {
    successCount++;
  });

  client.connect();

  // Wait for connection
  await new Promise(resolve => {
    client.once('connected', resolve);
  });

  console.log('Sending rapid subscription messages...');

  // Send 50 rapid messages
  for (let i = 0; i < 50; i++) {
    // Send subscribe message directly
    (client as any).socket?.emit('message', {
      op: 'subscribe',
      channel: 'orderbook',
      pair: `TEST${i}/USDC`
    });
  }

  // Wait for responses
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(`\nMessages sent: 50`);
  console.log(`Successful: ${successCount}`);
  console.log(`Rate limited: ${errorCount}`);

  // Cleanup
  client.disconnect();
  await new Promise(resolve => setTimeout(resolve, 500));
}

// Test high-frequency channel throttling
async function testChannelThrottling() {
  console.log('\n--- Testing Channel Throttling ---\n');

  const receivedUpdates = {
    orderbook: 0,
    trades: 0,
    orders: 0
  };

  // Create client and subscribe to channels
  const client = new WebSocketClient({
    url: 'http://localhost:3003',
    path: '/ws',
    apiKey: 'test-api-key-999',
    reconnection: false
  });

  client.connect();

  // Wait for connection
  await new Promise(resolve => {
    client.once('connected', resolve);
  });

  // Subscribe to high-frequency channels
  client.subscribe('orderbook', () => receivedUpdates.orderbook++, { pair: 'ETH/USDC' });
  client.subscribe('trades', () => receivedUpdates.trades++, { pair: 'ETH/USDC' });
  
  // Subscribe to normal channel
  client.subscribe('orders', () => receivedUpdates.orders++, { userId: 'testuser' });

  console.log('Subscribed to channels, simulating rapid updates...');

  // Simulate rapid updates (would normally come from matching engine)
  // In real scenario, these would be triggered by the WebSocketDataProvider

  const startTime = Date.now();
  const duration = 1000; // 1 second

  // Track time
  setTimeout(() => {
    const elapsed = Date.now() - startTime;
    console.log(`\nAfter ${elapsed}ms:`);
    console.log(`Orderbook updates: ${receivedUpdates.orderbook} (throttled)`);
    console.log(`Trade updates: ${receivedUpdates.trades} (throttled)`);
    console.log(`Order updates: ${receivedUpdates.orders} (not throttled)`);
    
    console.log('\nExpected behavior:');
    console.log('- High-frequency channels limited to ~10 updates/second (100ms throttle)');
    console.log('- Regular channels not throttled');

    client.disconnect();
  }, duration);
}

// Monitor rate limit status via API
async function monitorRateLimitStatus() {
  console.log('\n--- Monitoring Rate Limit Status ---\n');

  // Example API calls (would use fetch or axios in real app)
  console.log('API Endpoints for monitoring:');
  console.log('1. GET /api/websocket/rate-limits');
  console.log('   - Returns rate limit configuration and global stats');
  console.log('');
  console.log('2. GET /api/websocket/rate-limits?socketId=abc123');
  console.log('   - Returns specific socket rate limit status');
  console.log('');
  console.log('3. GET /api/websocket/connections');
  console.log('   - Returns connection statistics');
  console.log('');
  console.log('4. GET /api/websocket/connections?details=true&apiKey=test-key');
  console.log('   - Returns detailed connection info for API key');
}

// Example: Custom rate limiter configuration
function createCustomRateLimiter() {
  const rateLimiter = new RateLimiter({
    maxSubscriptionsPerConnection: 20, // Increased limit
    maxConnectionsPerApiKey: 10,       // More connections allowed
    messageThrottling: {
      windowMs: 30000,                 // 30 second window
      maxMessages: 500,                // 500 messages per window
      highFrequencyChannels: ['orderbook', 'trades'],
      throttleDelay: 50               // 50ms throttle (faster updates)
    },
    connectionLimits: {
      globalMaxConnections: 50000,     // Higher global limit
      perIpMaxConnections: 20,         // More per IP
      burstAllowance: 5                // More burst capacity
    }
  });

  // Listen to rate limiter events
  rateLimiter.on('connectionRegistered', (data) => {
    console.log('New connection:', data);
  });

  rateLimiter.on('connectionRemoved', (data) => {
    console.log('Connection removed:', data);
  });

  return rateLimiter;
}

// Example: Implement client-side rate limit awareness
class RateLimitAwareClient extends WebSocketClient {
  private rateLimitStatus: any = null;

  constructor(config: any) {
    super(config);

    // Track rate limit status from server
    this.on('connected', (data: any) => {
      if (data.rateLimits) {
        this.rateLimitStatus = data.rateLimits;
        console.log('Rate limits:', this.rateLimitStatus);
      }
    });
  }

  // Check if we can subscribe
  canSubscribe(): boolean {
    if (!this.rateLimitStatus) return true;
    return this.rateLimitStatus.subscriptions.remaining > 0;
  }

  // Get remaining message quota
  getRemainingMessages(): number {
    if (!this.rateLimitStatus) return -1;
    return this.rateLimitStatus.messages.remaining;
  }

  // Override subscribe to check limits
  subscribe(channel: string, handler: (data: any) => void, options?: any): string | null {
    if (!this.canSubscribe()) {
      console.warn('Subscription limit reached, cannot subscribe');
      return null;
    }

    const sub = super.subscribe(channel, handler, options);
    
    if (sub && this.rateLimitStatus) {
      this.rateLimitStatus.subscriptions.current++;
      this.rateLimitStatus.subscriptions.remaining--;
    }

    return sub;
  }
}

// Export for use
export {
  demonstrateRateLimiting,
  testConnectionLimits,
  testSubscriptionLimits,
  testMessageRateLimits,
  testChannelThrottling,
  monitorRateLimitStatus,
  createCustomRateLimiter,
  RateLimitAwareClient
};

// Run if executed directly
if (require.main === module) {
  demonstrateRateLimiting().catch(console.error);
}