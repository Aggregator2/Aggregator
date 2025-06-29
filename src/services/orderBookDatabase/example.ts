import {
  OrderBookDatabase,
  WebSocketServer,
  OrderExpirationManager,
  ReplicationManager,
  BackupManager,
  defaultConfig,
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce
} from './index';

// Example usage of the high-performance order book database
async function main() {
  // 1. Configure the system
  const config = {
    ...defaultConfig,
    redis: {
      ...defaultConfig.redis,
      host: process.env.REDIS_HOST || 'localhost',
      port: 6379,
      keyPrefix: 'orderbook:prod:'
    },
    postgres: {
      ...defaultConfig.postgres,
      host: process.env.POSTGRES_HOST || 'localhost',
      database: 'orderbook_production',
      poolSize: 50
    },
    websocket: {
      ...defaultConfig.websocket,
      port: 8080,
      maxConnections: 10000
    },
    orderExpiration: {
      enabled: true,
      checkInterval: 30000, // 30 seconds
      defaultTTL: 86400, // 24 hours
      customTTL: {
        'ETH/USDC': 3600, // 1 hour for ETH/USDC
        'BTC/USDT': 7200  // 2 hours for BTC/USDT
      }
    },
    replication: {
      enabled: true,
      replicas: {
        redis: [
          'redis://replica1.example.com:6379',
          'redis://replica2.example.com:6379'
        ],
        postgres: [
          'postgresql://user:pass@replica1.example.com:5432/orderbook',
          'postgresql://user:pass@replica2.example.com:5432/orderbook'
        ]
      },
      healthCheckInterval: 10000
    },
    backup: {
      enabled: true,
      interval: 3600000, // 1 hour
      retention: 30, // 30 days
      local: {
        path: './backups',
        compress: true
      },
      s3: {
        bucket: 'orderbook-backups',
        region: 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        prefix: 'production/'
      }
    }
  };

  // 2. Initialize the database
  const database = new OrderBookDatabase(config);
  await database.initialize();

  // 3. Set up WebSocket server for real-time updates
  const wsServer = new WebSocketServer(config, database);
  await wsServer.start();

  // 4. Set up order expiration manager
  const expirationManager = new OrderExpirationManager(database, config);
  expirationManager.start();

  // 5. Set up replication manager
  const replicationManager = new ReplicationManager(config);
  await replicationManager.initialize();

  // 6. Set up backup manager
  const backupManager = new BackupManager(database, config);
  await backupManager.start();

  // 7. Example: Add an order
  const order: Order = {
    id: 'ORD-001',
    userId: 'USER-123',
    pair: 'ETH/USDC',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 2000,
    quantity: 10,
    filledQuantity: 0,
    status: OrderStatus.OPEN,
    timeInForce: TimeInForce.GTC,
    timestamp: Date.now(),
    lastUpdateTime: Date.now()
  };

  await database.addOrder(order);
  console.log('Order added:', order.id);

  // 8. Example: Get order book snapshot
  const snapshot = await database.getOrderBookSnapshot('ETH/USDC', 50);
  console.log('Order book snapshot:', {
    pair: snapshot.pair,
    bidLevels: snapshot.bids.length,
    askLevels: snapshot.asks.length,
    bestBid: snapshot.bids[0]?.price,
    bestAsk: snapshot.asks[0]?.price
  });

  // 9. Example: Subscribe to real-time updates
  database.on('orderbook:update', (channel, update) => {
    console.log('Order book update:', {
      channel,
      type: update.type,
      side: update.side,
      price: update.price,
      quantity: update.quantity
    });
  });

  // 10. Example: Add a trade
  const trade = {
    id: 'TRD-001',
    pair: 'ETH/USDC',
    takerOrderId: 'ORD-001',
    makerOrderId: 'ORD-002',
    price: 2000,
    quantity: 5,
    takerSide: OrderSide.BUY,
    timestamp: Date.now(),
    takerFee: 10,
    makerFee: 5
  };

  await database.addTrade(trade);
  wsServer.broadcastTrade(trade);

  // 11. Example: Query historical data
  const orderHistory = await database.getOrderHistory(
    'USER-123',
    'ETH/USDC',
    undefined,
    new Date(Date.now() - 86400000), // Last 24 hours
    new Date(),
    100
  );
  console.log('Order history:', orderHistory.length, 'orders');

  // 12. Example: Health check
  const health = await database.healthCheck();
  console.log('System health:', health);

  // 13. Example: Get statistics
  const stats = await database.getStatistics();
  console.log('Database statistics:', stats);

  // 14. Example: Manual backup
  const backupMetadata = await backupManager.performBackup('full');
  console.log('Backup completed:', backupMetadata.id);

  // 15. Example: WebSocket client connection
  // This would typically be in a separate client application
  /*
  import { io } from 'socket.io-client';
  
  const socket = io('ws://localhost:8080', {
    path: '/orderbook',
    transports: ['websocket']
  });

  socket.on('connect', () => {
    // Authenticate
    socket.emit('authenticate', {
      userId: 'USER-123',
      token: 'auth-token'
    });

    // Subscribe to order book
    socket.emit('subscribe:orderbook', {
      pair: 'ETH/USDC',
      depth: 50
    });

    // Subscribe to trades
    socket.emit('subscribe:trades', {
      pair: 'ETH/USDC'
    });
  });

  socket.on('orderbook:snapshot', (data) => {
    console.log('Received order book snapshot:', data);
  });

  socket.on('orderbook:updates', (data) => {
    console.log('Received order book updates:', data);
  });

  socket.on('trade:new', (data) => {
    console.log('New trade:', data);
  });
  */

  // 16. Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    
    expirationManager.stop();
    await wsServer.stop();
    await replicationManager.shutdown();
    backupManager.stop();
    await database.shutdown();
    
    process.exit(0);
  });
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run the example
main().catch(console.error);