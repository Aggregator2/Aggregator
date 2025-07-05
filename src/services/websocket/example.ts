import { EnhancedMatchingEngine } from '../matchingEngine/EnhancedMatchingEngine';
import { EnhancedWebSocketIntegration } from './EnhancedWebSocketIntegration';
import { SettlementOrchestrator } from '../settlement/SettlementOrchestrator';
import { createSettlementService } from '../settlement/SettlementService';
import { MatchingEngineConfig } from '../matchingEngine/types';

// Example: Complete WebSocket server setup
async function setupWebSocketServer() {
  // 1. Configure matching engine
  const matchingEngineConfig: MatchingEngineConfig = {
    maxOrderBookDepth: 1000,
    minOrderSize: {
      'ETH/USDC': 0.001,
      'BTC/USDC': 0.00001,
      'ETH/USDT': 0.001,
      'BTC/USDT': 0.00001
    },
    maxOrderSize: {
      'ETH/USDC': 1000,
      'BTC/USDC': 100,
      'ETH/USDT': 1000,
      'BTC/USDT': 100
    },
    tickSize: {
      'ETH/USDC': 0.01,
      'BTC/USDC': 0.1,
      'ETH/USDT': 0.01,
      'BTC/USDT': 0.1
    },
    makerFeeRate: 0.001,
    takerFeeRate: 0.002,
    enableStopOrders: false,
    enableIcebergOrders: false
  };

  // 2. Create enhanced matching engine
  const matchingEngine = new EnhancedMatchingEngine(matchingEngineConfig);

  // 3. Initialize trading pairs
  matchingEngine.initializePair('ETH/USDC', 0.01);
  matchingEngine.initializePair('BTC/USDC', 0.1);
  matchingEngine.initializePair('ETH/USDT', 0.01);
  matchingEngine.initializePair('BTC/USDT', 0.1);

  // 4. Create settlement service (optional)
  let settlementOrchestrator: SettlementOrchestrator | undefined;
  
  if (process.env.ENABLE_SETTLEMENT === 'true') {
    const settlementService = createSettlementService({
      providerUrl: process.env.RPC_URL || 'http://localhost:8545',
      privateKey: process.env.SETTLEMENT_PRIVATE_KEY!,
      settlementContractAddress: process.env.SETTLEMENT_CONTRACT!,
      epochDuration: 300000, // 5 minutes
      matchingEngineConfig,
      enableWebhooks: true,
      enableAutoSettlement: true,
      enableEmergencyPause: true
    });
    
    await settlementService.initialize();
    settlementOrchestrator = settlementService.getOrchestrator();
  }

  // 5. Create WebSocket integration
  const wsIntegration = new EnhancedWebSocketIntegration(
    {
      port: parseInt(process.env.WS_PORT || '3001'),
      corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      authSecret: process.env.JWT_SECRET || 'your-secret-key',
      authRequired: process.env.NODE_ENV === 'production',
      rateLimits: {
        connectionsPerIp: 5,
        messagesPerMinute: 100,
        subscriptionsPerConnection: 20
      },
      updateBatchInterval: 100, // 100ms batching
      snapshotInterval: 5000 // 5s snapshots
    },
    matchingEngine,
    settlementOrchestrator
  );

  // 6. Start WebSocket server
  await wsIntegration.start();
  console.log(`WebSocket server started on port ${process.env.WS_PORT || 3001}`);

  // 7. Set up demo data generation (optional)
  if (process.env.ENABLE_DEMO_DATA === 'true') {
    startDemoDataGeneration(matchingEngine);
  }

  // 8. Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down WebSocket server...');
    await wsIntegration.stop();
    process.exit(0);
  });

  return { matchingEngine, wsIntegration };
}

// Generate demo trading data
function startDemoDataGeneration(matchingEngine: EnhancedMatchingEngine) {
  const pairs = ['ETH/USDC', 'BTC/USDC'];
  const users = ['alice', 'bob', 'charlie', 'david', 'eve'];
  
  // Generate random orders
  setInterval(async () => {
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const user = users[Math.floor(Math.random() * users.length)];
    const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
    
    // Get current market price (simplified)
    const basePrice = pair === 'ETH/USDC' ? 2500 : 45000;
    const spread = basePrice * 0.001; // 0.1% spread
    
    const price = side === 'BUY' 
      ? basePrice - Math.random() * spread
      : basePrice + Math.random() * spread;
    
    const quantity = pair === 'ETH/USDC'
      ? 0.1 + Math.random() * 0.9
      : 0.01 + Math.random() * 0.09;
    
    try {
      await matchingEngine.submitOrder({
        userId: user,
        pair,
        side: side as any,
        type: 'LIMIT',
        price: Math.round(price * 100) / 100,
        quantity: Math.round(quantity * 1000) / 1000,
        timeInForce: 'GTC'
      });
    } catch (error) {
      console.error('Demo order failed:', error);
    }
  }, 2000); // Every 2 seconds

  // Generate some market orders
  setInterval(async () => {
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const user = users[Math.floor(Math.random() * users.length)];
    const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
    
    const quantity = pair === 'ETH/USDC'
      ? 0.05 + Math.random() * 0.1
      : 0.005 + Math.random() * 0.01;
    
    try {
      await matchingEngine.submitOrder({
        userId: user,
        pair,
        side: side as any,
        type: 'MARKET',
        quantity: Math.round(quantity * 1000) / 1000,
        timeInForce: 'IOC'
      });
    } catch (error) {
      console.error('Demo market order failed:', error);
    }
  }, 5000); // Every 5 seconds

  console.log('Demo data generation started');
}

// Example client connection
function exampleClientUsage() {
  console.log(`
Example client-side usage:

\`\`\`typescript
import { createWebSocketClient } from './WebSocketClient';

// Create client
const client = createWebSocketClient({
  url: 'ws://localhost:3001',
  authToken: 'your-jwt-token'
});

// Subscribe to order book
client.subscribeOrderBook('ETH/USDC', (data) => {
  console.log('Order book update:', data);
});

// Subscribe to trades
client.subscribeTrades('ETH/USDC', (data) => {
  console.log('New trades:', data);
});

// Subscribe to ticker
client.subscribeTicker('ETH/USDC', (data) => {
  console.log('Ticker update:', data);
});

// Subscribe to user orders
client.subscribeUserOrders((data) => {
  console.log('Order update:', data);
});

// Request snapshot
const snapshot = await client.requestOrderBookSnapshot('ETH/USDC');
console.log('Order book snapshot:', snapshot);
\`\`\`
  `);
}

// Run the example
if (require.main === module) {
  setupWebSocketServer()
    .then(() => {
      console.log('WebSocket server is running');
      exampleClientUsage();
    })
    .catch(console.error);
}

export { setupWebSocketServer, startDemoDataGeneration };