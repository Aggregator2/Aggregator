/**
 * Example usage of Enhanced Redis Order Book
 * Demonstrates migration from in-memory to Redis-based storage
 */

const EnhancedRedisOrderBook = require('./EnhancedRedisOrderBook');
const OrderBookMigration = require('./OrderBookMigration');
const WebSocket = require('ws');

// Example in-memory order book structure
const inMemoryOrderBooks = new Map();

// Simulate existing in-memory data
inMemoryOrderBooks.set('ETH-USDC', {
  bids: [
    { id: 'bid1', userId: 'user1', price: 1850.50, amount: 2.5, timestamp: Date.now() - 1000 },
    { id: 'bid2', userId: 'user2', price: 1850.25, amount: 1.8, timestamp: Date.now() - 2000 },
    { id: 'bid3', userId: 'user3', price: 1850.00, amount: 3.2, timestamp: Date.now() - 3000 }
  ],
  asks: [
    { id: 'ask1', userId: 'user4', price: 1851.00, amount: 2.0, timestamp: Date.now() - 1500 },
    { id: 'ask2', userId: 'user5', price: 1851.25, amount: 1.5, timestamp: Date.now() - 2500 },
    { id: 'ask3', userId: 'user6', price: 1851.50, amount: 2.8, timestamp: Date.now() - 3500 }
  ],
  orders: [], // Will be populated from bids/asks
  sequence: 1000
});

// Populate orders array
const ethUsdcBook = inMemoryOrderBooks.get('ETH-USDC');
ethUsdcBook.orders = [
  ...ethUsdcBook.bids.map(bid => ({ ...bid, side: 'buy', status: 'open' })),
  ...ethUsdcBook.asks.map(ask => ({ ...ask, side: 'sell', status: 'open' }))
];

async function demonstrateRedisOrderBook() {
  console.log('🚀 Redis Order Book Demo\n');
  
  // 1. Initialize Enhanced Redis Order Book
  const orderBook = new EnhancedRedisOrderBook({
    redisHost: 'localhost',
    redisPort: 6379,
    enableMEVProtection: true,
    streamMaxLen: 10000
  });
  
  // 2. Initialize trading pairs
  await orderBook.initializePair('ETH-USDC', {
    baseAsset: 'ETH',
    quoteAsset: 'USDC',
    minPrice: 1,
    maxPrice: 100000,
    minAmount: 0.001,
    tickSize: 0.01
  });
  
  console.log('✅ Trading pair initialized\n');
  
  // 3. Migrate existing in-memory data
  console.log('📦 Migrating in-memory data to Redis...\n');
  
  const migration = new OrderBookMigration({
    batchSize: 100,
    pricePrecision: 8,
    amountPrecision: 8
  });
  
  await migration.migrate(inMemoryOrderBooks, { verify: true });
  
  // 4. Demonstrate order placement with MEV protection
  console.log('\n📝 Placing new orders...\n');
  
  const newBuyOrder = await orderBook.placeOrder({
    id: 'buy_' + Date.now(),
    userId: 'user7',
    pair: 'ETH-USDC',
    side: 'buy',
    type: 'limit',
    price: 1850.75,
    amount: 1.5,
    mevProtection: true
  });
  
  console.log('Buy order placed:', {
    id: newBuyOrder.id,
    price: newBuyOrder.price,
    amount: newBuyOrder.amount,
    visibility: new Date(newBuyOrder.visibility).toISOString()
  });
  
  // 5. Get order book snapshot
  console.log('\n📊 Current Order Book:\n');
  
  const snapshot = await orderBook.getOrderBook('ETH-USDC', 5);
  console.log('Best 5 Bids:');
  snapshot.bids.forEach(([price, amount]) => {
    console.log(`  ${price} USDC - ${amount} ETH`);
  });
  
  console.log('\nBest 5 Asks:');
  snapshot.asks.forEach(([price, amount]) => {
    console.log(`  ${price} USDC - ${amount} ETH`);
  });
  
  // 6. Demonstrate WebSocket subscription
  console.log('\n🔌 Setting up WebSocket subscriptions...\n');
  
  const unsubscribe = orderBook.subscribeWebSocket('ETH-USDC', 'demo-client', (event) => {
    console.log('WebSocket Event:', {
      event: event.event,
      price: event.price,
      amount: event.amount,
      timestamp: new Date(event.timestamp).toISOString()
    });
  });
  
  // 7. Place market order to trigger matching
  console.log('\n⚡ Placing market order to trigger matching...\n');
  
  const marketOrder = await orderBook.placeOrder({
    id: 'market_' + Date.now(),
    userId: 'user8',
    pair: 'ETH-USDC',
    side: 'buy',
    type: 'market',
    price: 1852.00, // Willing to pay up to this price
    amount: 1.0
  });
  
  // Attempt matching
  const matches = await orderBook.attemptMatching('ETH-USDC', 'buy');
  console.log(`Matched ${matches.length} orders`);
  
  // 8. Get user orders
  console.log('\n👤 Getting user orders...\n');
  
  const userOrders = await orderBook.getUserOrders('ETH-USDC', 'user1');
  console.log(`User1 has ${userOrders.length} orders:`);
  userOrders.forEach(order => {
    console.log(`  ${order.side} ${order.amount} ETH @ ${order.price} USDC - Status: ${order.status}`);
  });
  
  // 9. Get market statistics
  console.log('\n📈 Market Statistics (24h):\n');
  
  const stats = await orderBook.getMarketStats('ETH-USDC');
  console.log(`Volume: ${stats.volume} ETH`);
  console.log(`High: ${stats.high} USDC`);
  console.log(`Low: ${stats.low} USDC`);
  console.log(`Last: ${stats.last} USDC`);
  console.log(`Change: ${stats.changePercent.toFixed(2)}%`);
  console.log(`Trades: ${stats.trades}`);
  
  // 10. Cancel an order
  console.log('\n❌ Cancelling an order...\n');
  
  try {
    const cancelled = await orderBook.cancelOrder('bid1', 'ETH-USDC', 'user1');
    console.log('Order cancelled:', cancelled.id);
  } catch (error) {
    console.error('Cancel failed:', error.message);
  }
  
  // 11. Get performance metrics
  console.log('\n📊 Performance Metrics:\n');
  
  const metrics = orderBook.getMetrics();
  console.log(`Orders Processed: ${metrics.ordersProcessed}`);
  console.log(`Matches Executed: ${metrics.matchesExecuted}`);
  console.log(`Stream Events: ${metrics.streamEventsPublished}`);
  console.log(`Average Matching Latency: ${metrics.avgMatchingLatency.toFixed(2)}ms`);
  
  // Cleanup
  setTimeout(async () => {
    console.log('\n🧹 Cleaning up...\n');
    unsubscribe();
    await orderBook.disconnect();
    await migration.disconnect();
    process.exit(0);
  }, 5000);
}

// WebSocket server example
function createWebSocketServer() {
  const wss = new WebSocket.Server({ port: 8080 });
  
  wss.on('connection', (ws) => {
    console.log('Client connected');
    
    // Subscribe to order book updates
    const orderBook = new EnhancedRedisOrderBook();
    
    const unsubscribe = orderBook.subscribeWebSocket('ETH-USDC', ws.id, (event) => {
      ws.send(JSON.stringify({
        type: 'orderbook_update',
        data: event
      }));
    });
    
    ws.on('close', () => {
      console.log('Client disconnected');
      unsubscribe();
    });
  });
  
  console.log('WebSocket server running on port 8080');
}

// Advanced features demonstration
async function demonstrateAdvancedFeatures() {
  const orderBook = new EnhancedRedisOrderBook();
  
  // 1. Batch order processing
  console.log('\n📦 Batch Order Processing:\n');
  
  const orders = [];
  for (let i = 0; i < 10; i++) {
    orders.push({
      id: `batch_${i}_${Date.now()}`,
      userId: `user_${i % 3}`,
      pair: 'ETH-USDC',
      side: i % 2 === 0 ? 'buy' : 'sell',
      price: 1850 + (Math.random() * 2),
      amount: Math.random() * 5
    });
  }
  
  const startTime = Date.now();
  for (const order of orders) {
    await orderBook.placeOrder(order);
  }
  const batchTime = Date.now() - startTime;
  
  console.log(`Placed ${orders.length} orders in ${batchTime}ms`);
  console.log(`Average: ${(batchTime / orders.length).toFixed(2)}ms per order`);
  
  // 2. Stream processing
  console.log('\n📡 Redis Streams Processing:\n');
  
  // Get stream info
  const streamInfo = await orderBook.redis.xinfo('STREAM', 'ob:ETH-USDC:stream');
  console.log(`Stream length: ${streamInfo[1]}`);
  console.log(`First entry: ${streamInfo[3]}`);
  console.log(`Last entry: ${streamInfo[5]}`);
  
  // 3. MEV Protection demonstration
  console.log('\n🛡️ MEV Protection Demo:\n');
  
  const protectedOrder = await orderBook.placeOrder({
    id: 'mev_protected_' + Date.now(),
    userId: 'whale_user',
    pair: 'ETH-USDC',
    side: 'buy',
    price: 1855.00,
    amount: 100, // Large order
    mevProtection: true
  });
  
  console.log('Large order placed with MEV protection');
  console.log(`Order will be visible at: ${new Date(protectedOrder.visibility).toISOString()}`);
  console.log(`Current time: ${new Date().toISOString()}`);
  console.log(`Delay: ${protectedOrder.visibility - Date.now()}ms`);
  
  await orderBook.disconnect();
}

// Run the demonstration
if (require.main === module) {
  demonstrateRedisOrderBook()
    .then(() => console.log('\n✅ Demo completed'))
    .catch(error => {
      console.error('\n❌ Demo failed:', error);
      process.exit(1);
    });
}

module.exports = {
  demonstrateRedisOrderBook,
  createWebSocketServer,
  demonstrateAdvancedFeatures
};