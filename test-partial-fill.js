const { MatchingEngine } = require('./src/services/matchingEngine/MatchingEngine');
const { OrderSide, OrderType, TimeInForce } = require('./src/services/matchingEngine/types');

async function testPartialFillIssue() {
  console.log('Testing partial fill calculation issue...');
  
  const config = {
    takerFeeRate: 0.001,
    makerFeeRate: 0.0005,
    tickSize: { 'ETH/USDT': 0.01 },
    minOrderSize: { 'ETH/USDT': 0.01 },
    maxOrderSize: { 'ETH/USDT': 1000 }
  };
  
  const engine = new MatchingEngine(config);
  engine.initializePair('ETH/USDT');
  
  // Add sell orders to the book
  console.log('Adding sell orders: 0.3, 0.5, 0.2, 0.3 at price 2000');
  
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
    price: 2000,
    quantity: 0.5,
    timeInForce: TimeInForce.GTC
  });
  
  await engine.submitOrder({
    userId: 'seller3',
    pair: 'ETH/USDT',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2000,
    quantity: 0.2,
    timeInForce: TimeInForce.GTC
  });
  
  await engine.submitOrder({
    userId: 'seller4',
    pair: 'ETH/USDT',
    side: OrderSide.SELL,
    type: OrderType.LIMIT,
    price: 2000,
    quantity: 0.3,
    timeInForce: TimeInForce.GTC
  });
  
  // Submit buy order for 1.3 ETH
  console.log('Submitting buy order for 1.3 ETH at price 2000');
  
  const result = await engine.submitOrder({
    userId: 'buyer1',
    pair: 'ETH/USDT',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 2000,
    quantity: 1.3,
    timeInForce: TimeInForce.GTC
  });
  
  console.log('Execution result:');
  console.log('- Order filled quantity:', result.filledQuantity);
  console.log('- Number of trades:', result.trades.length);
  console.log('- Trade quantities:', result.trades.map(t => t.quantity));
  console.log('- Sum of trade quantities:', result.trades.reduce((sum, t) => sum + t.quantity, 0));
  
  if (result.filledQuantity !== 1.3) {
    console.log('❌ ERROR: Expected filled quantity 1.3, got', result.filledQuantity);
  } else {
    console.log('✅ SUCCESS: Filled quantity matches expected 1.3');
  }
  
  const tradeSum = result.trades.reduce((sum, t) => sum + t.quantity, 0);
  if (Math.abs(tradeSum - result.filledQuantity) > 0.0001) {
    console.log('❌ ERROR: Trade sum does not match filled quantity');
  } else {
    console.log('✅ SUCCESS: Trade sum matches filled quantity');
  }
}

testPartialFillIssue().catch(console.error);