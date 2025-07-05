import { createServer } from 'http';
import { WebSocketServer } from './WebSocketServer';
import { WebSocketClient } from './WebSocketClientManager';
import { WebSocketDataProvider } from './WebSocketDataProvider';
import { EnhancedMatchingEngine } from '../matchingEngine/EnhancedMatchingEngine';
import { ProofGeneratingSettlementEngine } from '../settlement/ProofGeneratingSettlementEngine';
import { ethers } from 'ethers';

// Example: Set up WebSocket server
async function setupWebSocketServer() {
  console.log('\n=== WebSocket Server Setup ===\n');

  // 1. Create HTTP server
  const httpServer = createServer();
  
  // 2. Create WebSocket server with configuration
  const wsServer = new WebSocketServer(httpServer, {
    port: 3002,
    path: '/ws',
    cors: {
      origin: ['http://localhost:3000', 'https://yourdomain.com'],
      credentials: true
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    apiKeySecret: process.env.API_KEY_SECRET || 'your-secret-key',
    jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret',
    maxSubscriptionsPerClient: 50,
    messageRateLimit: {
      windowMs: 60000, // 1 minute
      maxMessages: 1000
    }
  });

  // 3. Create matching engine and settlement engine
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545');
  
  const matchingEngine = new EnhancedMatchingEngine({
    maxOrderBookDepth: 1000,
    minOrderSize: {
      'ETH/USDC': 0.001,
      'BTC/USDC': 0.00001
    },
    maxOrderSize: {
      'ETH/USDC': 1000,
      'BTC/USDC': 100
    },
    tickSize: {
      'ETH/USDC': 0.01,
      'BTC/USDC': 0.1
    },
    makerFeeRate: 0.001,
    takerFeeRate: 0.002,
    enableStopOrders: true,
    enableIcebergOrders: true
  });

  const settlementEngine = new ProofGeneratingSettlementEngine(
    provider,
    process.env.SETTLEMENT_PRIVATE_KEY || '0x...',
    {
      mevProtection: {
        primaryProvider: 'FLASHBOTS' as any,
        fallbackProviders: ['STANDARD' as any],
        maxBlocksInFuture: 25,
        simulationEnabled: true,
        bundleTimeout: 120000,
        retryAttempts: 3,
        retryDelay: 1000
      },
      settlementContractAddress: process.env.SETTLEMENT_CONTRACT || '0x...',
      epochDuration: 300000,
      prioritizeLargeSettlements: true,
      simulateBeforeSending: true,
      proofStorageEnabled: true,
      generateProofsAsync: false,
      storeOnChainRoot: true
    }
  );

  // 4. Create data provider
  const dataProvider = new WebSocketDataProvider(
    wsServer,
    matchingEngine,
    settlementEngine,
    {
      orderbookSnapshotInterval: 1000,
      orderbookUpdateBatchSize: 50,
      tradeFeedLimit: 100,
      tickerUpdateInterval: 5000,
      positionUpdateInterval: 10000
    }
  );

  // 5. Set up event listeners
  wsServer.on('clientConnected', (data) => {
    console.log('Client connected:', data.socketId, data.userId || 'anonymous');
  });

  wsServer.on('clientDisconnected', (data) => {
    console.log('Client disconnected:', data.socketId, data.reason);
  });

  wsServer.on('subscription', (data) => {
    console.log('New subscription:', data);
  });

  wsServer.on('healthCheck', (data) => {
    console.log('Health check:', data);
  });

  // 6. Start server
  httpServer.listen(3002, () => {
    console.log('WebSocket server listening on port 3002');
  });

  // 7. Start periodic updates
  dataProvider.startPeriodicUpdates();

  return { wsServer, dataProvider, httpServer };
}

// Example: WebSocket client usage
async function demonstrateWebSocketClient() {
  console.log('\n=== WebSocket Client Demo ===\n');

  // 1. Create client
  const client = new WebSocketClient({
    url: 'http://localhost:3002',
    path: '/ws',
    apiKey: 'demo-api-key-1234567890',
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    heartbeatInterval: 25000
  });

  // 2. Set up event handlers
  client.on('connected', () => {
    console.log('Connected to WebSocket server');
  });

  client.on('disconnected', (reason) => {
    console.log('Disconnected:', reason);
  });

  client.on('stateChange', ({ oldState, newState }) => {
    console.log(`Connection state: ${oldState} -> ${newState}`);
  });

  client.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  client.on('subscribed', (data) => {
    console.log('Subscribed to:', data);
  });

  // 3. Connect
  client.connect();

  // Wait for connection
  await new Promise(resolve => {
    client.once('connected', resolve);
  });

  // 4. Subscribe to channels
  console.log('\n--- Subscribing to channels ---\n');

  // Order book subscription
  const orderBookSub = client.subscribe(
    'orderbook',
    (message) => {
      console.log('Order book update:', {
        pair: message.pair,
        type: message.type,
        bidCount: message.data.bids.length,
        askCount: message.data.asks.length,
        sequence: message.sequence
      });
    },
    { pair: 'ETH/USDC' }
  );

  // Trade feed subscription
  const tradesSub = client.subscribe(
    'trades',
    (message) => {
      if (message.type === 'trade') {
        console.log('New trade:', {
          pair: message.pair,
          price: message.data.price,
          quantity: message.data.quantity,
          timestamp: new Date(message.data.timestamp).toISOString()
        });
      }
    },
    { pair: 'ETH/USDC' }
  );

  // User orders subscription
  const ordersSub = client.subscribe(
    'orders',
    (message) => {
      console.log('Order update:', {
        orderId: message.data.orderId,
        event: message.data.event,
        status: message.data.status,
        filled: message.data.filledQuantity
      });
    },
    { userId: 'user123' }
  );

  // Ticker subscription
  const tickerSub = client.subscribe(
    'tickers',
    (message) => {
      console.log('Ticker update:', {
        pair: message.data.pair,
        lastPrice: message.data.lastPrice,
        volume24h: message.data.volume24h,
        change24h: message.data.change24h
      });
    }
  );

  // 5. Wait for some data
  await new Promise(resolve => setTimeout(resolve, 10000));

  // 6. Unsubscribe
  console.log('\n--- Unsubscribing ---\n');
  if (orderBookSub) client.unsubscribe(orderBookSub);
  if (tradesSub) client.unsubscribe(tradesSub);

  // 7. Get statistics
  console.log('\nClient statistics:', client.getStats());

  // 8. Disconnect
  client.disconnect();
}

// Example: Simulate trading activity
async function simulateTradingActivity(
  matchingEngine: EnhancedMatchingEngine,
  wsServer: WebSocketServer
) {
  console.log('\n=== Simulating Trading Activity ===\n');

  // Initialize trading pairs
  matchingEngine.initializePair('ETH/USDC', 0.01);
  matchingEngine.initializePair('BTC/USDC', 0.1);

  // Add some initial orders
  const orders = [
    // ETH/USDC buy orders
    { userId: 'maker1', pair: 'ETH/USDC', side: 'BUY', type: 'LIMIT', price: 2480, quantity: 1 },
    { userId: 'maker2', pair: 'ETH/USDC', side: 'BUY', type: 'LIMIT', price: 2485, quantity: 0.5 },
    { userId: 'maker3', pair: 'ETH/USDC', side: 'BUY', type: 'LIMIT', price: 2490, quantity: 2 },
    
    // ETH/USDC sell orders
    { userId: 'maker4', pair: 'ETH/USDC', side: 'SELL', type: 'LIMIT', price: 2510, quantity: 1.5 },
    { userId: 'maker5', pair: 'ETH/USDC', side: 'SELL', type: 'LIMIT', price: 2515, quantity: 1 },
    { userId: 'maker6', pair: 'ETH/USDC', side: 'SELL', type: 'LIMIT', price: 2520, quantity: 0.8 }
  ];

  for (const order of orders) {
    await matchingEngine.submitOrder(order as any);
  }

  // Simulate market orders
  setInterval(async () => {
    const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
    const quantity = Math.random() * 0.1 + 0.01;
    
    try {
      const result = await matchingEngine.submitOrder({
        userId: `trader${Math.floor(Math.random() * 10)}`,
        pair: 'ETH/USDC',
        side: side as any,
        type: 'MARKET' as any,
        quantity,
        timeInForce: 'IOC' as any
      });
      
      console.log(`Market order ${side} ${quantity.toFixed(4)} ETH:`, result.status);
    } catch (error) {
      console.error('Order failed:', error.message);
    }
  }, 5000);

  // Simulate order updates
  setInterval(() => {
    const stats = wsServer.getStats();
    console.log('WebSocket stats:', {
      clients: stats.clients,
      subscriptions: stats.subscriptions
    });
  }, 30000);
}

// Example: Message format demonstrations
function demonstrateMessageFormats() {
  console.log('\n=== WebSocket Message Formats ===\n');

  // Subscription messages
  console.log('1. Subscription Messages:');
  console.log(JSON.stringify({
    op: 'subscribe',
    channel: 'orderbook',
    pair: 'ETH/USDC'
  }, null, 2));

  console.log(JSON.stringify({
    op: 'subscribe',
    channel: 'orders',
    userId: 'user123'
  }, null, 2));

  // Order book update
  console.log('\n2. Order Book Update:');
  console.log(JSON.stringify({
    channel: 'orderbook',
    pair: 'ETH/USDC',
    type: 'update',
    data: {
      bids: [[2490, 2.5], [2485, 1.0], [2480, 0.5]],
      asks: [[2510, 1.5], [2515, 2.0], [2520, 1.0]],
      sequence: 12345,
      timestamp: 1234567890
    }
  }, null, 2));

  // Trade message
  console.log('\n3. Trade Message:');
  console.log(JSON.stringify({
    channel: 'trades',
    pair: 'ETH/USDC',
    type: 'trade',
    data: {
      id: 'trade-123',
      price: 2500,
      quantity: 0.5,
      timestamp: 1234567890,
      isBuyerMaker: false
    }
  }, null, 2));

  // Order update
  console.log('\n4. Order Update:');
  console.log(JSON.stringify({
    channel: 'orders',
    type: 'update',
    data: {
      orderId: 'order-456',
      event: 'PARTIALLY_FILLED',
      filledQuantity: 0.3,
      remainingQuantity: 0.7,
      status: 'PARTIALLY_FILLED',
      timestamp: 1234567890
    }
  }, null, 2));

  // Settlement update
  console.log('\n5. Settlement Update:');
  console.log(JSON.stringify({
    channel: 'settlements',
    type: 'executed',
    data: {
      batchId: 'batch-789',
      status: 'EXECUTED',
      transactionHash: '0x...',
      merkleRoot: '0x...',
      leafCount: 25,
      timestamp: 1234567890
    }
  }, null, 2));
}

// Main execution
async function main() {
  try {
    // Set up server
    const { wsServer, dataProvider, httpServer } = await setupWebSocketServer();
    
    // Demonstrate message formats
    demonstrateMessageFormats();
    
    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Run client demo
    await demonstrateWebSocketClient();
    
    // Simulate trading
    const matchingEngine = (dataProvider as any).matchingEngine;
    await simulateTradingActivity(matchingEngine, wsServer);
    
    // Keep running for demo
    console.log('\nWebSocket server running. Press Ctrl+C to exit.');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Export for use in other modules
export {
  setupWebSocketServer,
  demonstrateWebSocketClient,
  simulateTradingActivity,
  demonstrateMessageFormats
};

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}