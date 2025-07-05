const { MatchingEngine } = require('./src/services/matchingEngine/MatchingEngine');
const { OrderSide, OrderType, TimeInForce } = require('./src/services/matchingEngine/types');

async function testSpecificIssue() {
  console.log('Testing specific partial fill issue (1.3 vs 1.5)...');
  
  const config = {
    takerFeeRate: 0.001,
    makerFeeRate: 0.0005,
    tickSize: { 'ETH/USDT': 0.01 },
    minOrderSize: { 'ETH/USDT': 0.01 },
    maxOrderSize: { 'ETH/USDT': 1000 }
  };
  
  const engine = new MatchingEngine(config);
  engine.initializePair('ETH/USDT');
  
  // Add sell orders to the book at various prices to create the issue
  console.log('Adding sell orders to create the problematic scenario...');
  
  // Create a scenario where floating point precision could cause issues
  await engine.submitOrder({
    userId: 'seller1',
    pair: 'ETH/USDT',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2000,
    quantity: 0.3,
    timeInForce: TimeInForce.GTC
  });
  
  await engine.submitOrder({
    userId: 'seller2',
    pair: 'ETH/USDT',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2000.01,
    quantity: 0.5,
    timeInForce: TimeInForce.GTC
  });
  
  await engine.submitOrder({
    userId: 'seller3',
    pair: 'ETH/USDT',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2000.02,
    quantity: 0.2,
    timeInForce: TimeInForce.GTC
  });
  
  await engine.submitOrder({
    userId: 'seller4',
    pair: 'ETH/USDT',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2000.03,
    quantity: 0.3,
    timeInForce: TimeInForce.GTC
  });
  
  // Submit a buy order for exactly 1.3 ETH at high price to match all
  console.log('Submitting buy order for 1.3 ETH');
  
  const result = await engine.submitOrder({
    userId: 'buyer1',
    pair: 'ETH/USDT',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 2001,  // High enough to match all orders
    quantity: 1.3,
    timeInForce: TimeInForce.GTC
  });
  
  console.log('\\nExecution result:');
  console.log('- Order filled quantity:', result.filledQuantity);
  console.log('- Expected filled quantity: 1.3');
  console.log('- Number of trades:', result.trades.length);
  console.log('- Trade quantities:', result.trades.map(t => t.quantity));
  console.log('- Sum of trade quantities:', result.trades.reduce((sum, t) => sum + t.quantity, 0));
  
  // Check if we have the specific issue
  if (result.filledQuantity === 1.5) {
    console.log('❌ REPRODUCED: Got filled quantity 1.5 instead of expected 1.3');
  } else if (result.filledQuantity === 1.3) {
    console.log('✅ FIXED: Filled quantity is correct (1.3)');
  } else {
    console.log('⚠️  UNEXPECTED: Filled quantity is', result.filledQuantity);
  }
  
  const tradeSum = result.trades.reduce((sum, t) => sum + t.quantity, 0);
  if (Math.abs(tradeSum - result.filledQuantity) > 0.0001) {
    console.log('❌ ERROR: Trade sum (' + tradeSum + ') does not match filled quantity (' + result.filledQuantity + ')');
  } else {
    console.log('✅ SUCCESS: Trade sum matches filled quantity');
  }
  
  // Test with exact precision issue
  console.log('\\nTesting precision edge case...');
  const engine2 = new MatchingEngine(config);
  engine2.initializePair('ETH/USDT');
  
  // Add orders that could cause precision issues
  await engine2.submitOrder({
    userId: 'seller1',
    pair: 'ETH/USDT',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2000,
    quantity: 0.333333333,  // Repeating decimal
    timeInForce: TimeInForce.GTC
  });
  
  await engine2.submitOrder({
    userId: 'seller2',
    pair: 'ETH/USDT',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2000,
    quantity: 0.666666667,  // Repeating decimal
    timeInForce: TimeInForce.GTC
  });
  
  const result2 = await engine2.submitOrder({
    userId: 'buyer1',
    pair: 'ETH/USDT',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 2001,
    quantity: 1.0,  // Should match exactly
    timeInForce: TimeInForce.GTC
  });
  
  console.log('Precision test:');
  console.log('- Expected: 1.0');
  console.log('- Actual filled:', result2.filledQuantity);
  console.log('- Trade sum:', result2.trades.reduce((sum, t) => sum + t.quantity, 0));
}

testSpecificIssue().catch(console.error);