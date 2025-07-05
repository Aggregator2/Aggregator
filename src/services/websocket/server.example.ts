import { MatchingEngine } from '../matchingEngine/MatchingEngine';
import { OrderBookDatabase } from '../orderBookDatabase/OrderBookDatabase';
import { WebSocketIntegration, WebSocketIntegrationConfig } from './WebSocketIntegration';

// Example server setup
async function startWebSocketServer() {
  // Initialize matching engine
  const matchingEngine = new MatchingEngine({
    tickSize: {
      'ETH/USDC': 0.01,
      'BTC/USDC': 0.01,
      'MATIC/USDC': 0.0001
    },
    fees: {
      maker: 0.001,
      taker: 0.002
    }
  });

  // Initialize pairs
  matchingEngine.initializePair('ETH/USDC');
  matchingEngine.initializePair('BTC/USDC');
  matchingEngine.initializePair('MATIC/USDC');

  // Optional: Initialize order book database for persistence
  const orderBookDatabase = new OrderBookDatabase({
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    },
    postgres: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'trading',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres'
    },
    websocket: {
      port: 3001,
      path: '/ws',
      cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        credentials: true
      }
    }
  });

  // WebSocket configuration
  const wsConfig: WebSocketIntegrationConfig = {
    websocket: {
      port: parseInt(process.env.WS_PORT || '3001'),
      path: '/ws',
      cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        credentials: true
      },
      auth: {
        secret: process.env.JWT_SECRET || 'your-secret-key',
        required: false // Set to true in production
      },
      rateLimits: {
        connectionsPerIp: 10,
        messagesPerMinute: 100,
        subscriptionsPerConnection: 20
      },
      heartbeatInterval: 30000,
      maxConnections: 1000
    },
    updateBatchInterval: 100, // Batch updates every 100ms
    snapshotInterval: 60000,  // Send snapshots every minute
    marketDataInterval: 1000  // Update market data every second
  };

  // Create WebSocket integration
  const wsIntegration = new WebSocketIntegration(
    wsConfig,
    matchingEngine,
    orderBookDatabase
  );

  // Start services
  try {
    if (orderBookDatabase) {
      await orderBookDatabase.connect();
      console.log('Order book database connected');
    }

    await wsIntegration.start();
    console.log(`WebSocket server started on port ${wsConfig.websocket.port}`);

    // Example: Submit a test order
    setTimeout(async () => {
      const order = await matchingEngine.submitOrder({
        userId: 'test-user-1',
        pair: 'ETH/USDC',
        side: 'BUY',
        type: 'LIMIT',
        price: 2000,
        quantity: 1,
        timeInForce: 'GTC'
      });
      console.log('Test order submitted:', order);
    }, 5000);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      await wsIntegration.stop();
      if (orderBookDatabase) {
        await orderBookDatabase.disconnect();
      }
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start WebSocket server:', error);
    process.exit(1);
  }
}

// Start the server
if (require.main === module) {
  startWebSocketServer();
}

export { startWebSocketServer };