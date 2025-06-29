import { MatchingEngine, MatchingEngineConfig, OrderSide, OrderType, OrderStatus, TimeInForce } from './index';

// Demo script showing how to use the matching engine
async function runDemo() {
  console.log('=== Order Matching Engine Demo ===\n');

  // 1. Configure the matching engine
  const config: MatchingEngineConfig = {
    maxOrderBookDepth: 100,
    minOrderSize: { 'ETH/USDC': 0.01, 'BTC/USDC': 0.0001 },
    maxOrderSize: { 'ETH/USDC': 1000, 'BTC/USDC': 100 },
    tickSize: { 'ETH/USDC': 0.01, 'BTC/USDC': 0.01 },
    makerFeeRate: 0.001, // 0.1%
    takerFeeRate: 0.002, // 0.2%
    enableStopOrders: false,
    enableIcebergOrders: false,
  };

  // 2. Create matching engine instance
  const matchingEngine = new MatchingEngine(config);

  // 3. Initialize trading pairs
  matchingEngine.initializePair('ETH/USDC');
  matchingEngine.initializePair('BTC/USDC');

  // 4. Listen to events
  matchingEngine.on('orderSubmitted', (order) => {
    console.log(`📥 Order Submitted: ${order.side} ${order.quantity} ${order.pair} @ ${order.price}`);
  });

  matchingEngine.on('executionReport', (report) => {
    if (report.trades.length > 0) {
      console.log(`✅ Order Executed: ${report.orderId} - Filled: ${report.filledQuantity}/${report.quantity} @ avg price ${report.averagePrice.toFixed(2)}`);
      report.trades.forEach((trade: any) => {
        console.log(`   Trade: ${trade.quantity} @ ${trade.price} (Taker fee: $${trade.takerFee.toFixed(2)}, Maker fee: $${trade.makerFee.toFixed(2)})`);
      });
    }
  });

  matchingEngine.on('orderCancelled', (order) => {
    console.log(`❌ Order Cancelled: ${order.id}`);
  });

  console.log('📊 Creating Order Book for ETH/USDC...\n');

  // 5. Submit some sell orders (asks)
  await matchingEngine.submitOrder({
    userId: 'alice',
    pair: 'ETH/USDC',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2010,
    quantity: 2,
    clientOrderId: 'alice-sell-1',
  });

  await matchingEngine.submitOrder({
    userId: 'bob',
    pair: 'ETH/USDC',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2005,
    quantity: 1.5,
    clientOrderId: 'bob-sell-1',
  });

  await matchingEngine.submitOrder({
    userId: 'charlie',
    pair: 'ETH/USDC',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2008,
    quantity: 3,
    clientOrderId: 'charlie-sell-1',
  });

  // 6. Submit some buy orders (bids)
  await matchingEngine.submitOrder({
    userId: 'david',
    pair: 'ETH/USDC',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 1995,
    quantity: 2,
    clientOrderId: 'david-buy-1',
  });

  await matchingEngine.submitOrder({
    userId: 'eve',
    pair: 'ETH/USDC',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 1990,
    quantity: 1,
    clientOrderId: 'eve-buy-1',
  });

  // 7. Show current order book
  console.log('\n📖 Current Order Book:');
  const orderBook = matchingEngine.getOrderBook('ETH/USDC', 10);
  if (orderBook) {
    console.log('Asks (Sell Orders):');
    orderBook.asks.forEach(level => {
      console.log(`  $${level.price.toFixed(2)} - ${level.quantity} ETH (${level.orders.length} orders)`);
    });
    console.log('\nBids (Buy Orders):');
    orderBook.bids.forEach(level => {
      console.log(`  $${level.price.toFixed(2)} - ${level.quantity} ETH (${level.orders.length} orders)`);
    });
  }

  // 8. Submit a buy order that will match
  console.log('\n💰 Submitting aggressive buy order...\n');
  const aggressiveBuy = await matchingEngine.submitOrder({
    userId: 'frank',
    pair: 'ETH/USDC',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 2007,
    quantity: 2.5,
    clientOrderId: 'frank-buy-aggressive',
  });

  // 9. Show updated order book
  console.log('\n📖 Updated Order Book:');
  const updatedOrderBook = matchingEngine.getOrderBook('ETH/USDC', 10);
  if (updatedOrderBook) {
    console.log('Asks (Sell Orders):');
    updatedOrderBook.asks.forEach(level => {
      console.log(`  $${level.price.toFixed(2)} - ${level.quantity} ETH (${level.orders.length} orders)`);
    });
    console.log('\nBids (Buy Orders):');
    updatedOrderBook.bids.forEach(level => {
      console.log(`  $${level.price.toFixed(2)} - ${level.quantity} ETH (${level.orders.length} orders)`);
    });
  }

  // 10. Submit a market order
  console.log('\n🚀 Submitting market buy order...\n');
  const marketBuy = await matchingEngine.submitOrder({
    userId: 'grace',
    pair: 'ETH/USDC',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    quantity: 1,
    clientOrderId: 'grace-market-buy',
  });

  // 11. Show market data
  console.log('\n📈 Market Data:');
  const marketData = matchingEngine.getMarketData('ETH/USDC');
  if (marketData) {
    console.log(`Last Price: $${marketData.lastPrice.toFixed(2)}`);
    console.log(`Best Bid: $${marketData.bidPrice.toFixed(2)} (${marketData.bidQuantity} ETH)`);
    console.log(`Best Ask: $${marketData.askPrice.toFixed(2)} (${marketData.askQuantity} ETH)`);
    console.log(`24h Volume: $${marketData.volume24h.toFixed(2)}`);
    console.log(`24h High: $${marketData.high24h.toFixed(2)}`);
    console.log(`24h Low: $${marketData.low24h.toFixed(2)}`);
  }

  // 12. Get recent trades
  console.log('\n📊 Recent Trades:');
  const recentTrades = matchingEngine.getRecentTrades('ETH/USDC', 5);
  recentTrades.forEach(trade => {
    console.log(`${trade.takerSide === OrderSide.BUY ? '🟢' : '🔴'} ${trade.quantity} ETH @ $${trade.price.toFixed(2)} (${new Date(trade.timestamp).toLocaleTimeString()})`);
  });

  // 13. Show user orders
  console.log('\n👤 Frank\'s Orders:');
  const frankOrders = matchingEngine.getUserOrders('frank');
  frankOrders.forEach(order => {
    console.log(`${order.side} ${order.quantity} ETH @ $${order.price.toFixed(2)} - Status: ${order.status} (Filled: ${order.filledQuantity})`);
  });

  // 14. Test IOC order
  console.log('\n⚡ Testing IOC (Immediate or Cancel) order...\n');
  const iocOrder = await matchingEngine.submitOrder({
    userId: 'henry',
    pair: 'ETH/USDC',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 2008,
    quantity: 10, // Large order that can't be fully filled
    timeInForce: TimeInForce.IOC,
    clientOrderId: 'henry-ioc-buy',
  });
  console.log(`IOC Order Result: Filled ${iocOrder.filledQuantity}/${iocOrder.quantity} - Status: ${iocOrder.status}`);

  // 15. Test FOK order
  console.log('\n💥 Testing FOK (Fill or Kill) order...\n');
  try {
    const fokOrder = await matchingEngine.submitOrder({
      userId: 'iris',
      pair: 'ETH/USDC',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      price: 2010,
      quantity: 10, // Large order that can't be fully filled
      timeInForce: TimeInForce.FOK,
      clientOrderId: 'iris-fok-buy',
    });
    console.log(`FOK Order Result: ${fokOrder.status}`);
  } catch (error) {
    console.log('FOK order was cancelled (as expected for insufficient liquidity)');
  }

  // 16. Cancel an order
  console.log('\n🚫 Cancelling an order...\n');
  const davidOrders = matchingEngine.getUserOrders('david');
  if (davidOrders.length > 0 && davidOrders[0].status === OrderStatus.OPEN) {
    const cancelResult = await matchingEngine.cancelOrder(davidOrders[0].id, 'david');
    console.log(`Order ${cancelResult.orderId} cancelled successfully`);
  }

  console.log('\n✅ Demo completed!');
}

// Run the demo
runDemo().catch(console.error);