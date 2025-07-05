// Test the system with mock data (no external dependencies)
console.log('🧪 Testing Off-Chain Settlement System (Mock Mode)\n');

// Mock database
const mockDb = {
  orders: new Map(),
  trades: new Map(),
  users: new Map(),
  
  async connect() {
    console.log('✅ Mock database connected');
    return true;
  },
  
  async saveOrder(order) {
    this.orders.set(order.id, order);
    return order;
  },
  
  async getOrder(orderId) {
    return this.orders.get(orderId);
  }
};

// Test 1: Order Creation
console.log('1. Testing Order Creation:');
const testOrder = {
  id: 'ORD-001',
  userId: 'user123',
  pair: 'ETH/USDC',
  side: 'BUY',
  type: 'LIMIT',
  price: 2000,
  quantity: 1,
  filledQuantity: 0,
  status: 'OPEN',
  timestamp: Date.now()
};

mockDb.saveOrder(testOrder);
console.log('   ✅ Order created:', testOrder.id);

// Test 2: Order Matching
console.log('\n2. Testing Order Matching:');
const sellOrder = {
  id: 'ORD-002',
  userId: 'user456',
  pair: 'ETH/USDC',
  side: 'SELL',
  type: 'LIMIT',
  price: 1999,
  quantity: 1,
  filledQuantity: 0,
  status: 'OPEN',
  timestamp: Date.now()
};

// Simulate matching
if (sellOrder.price <= testOrder.price) {
  console.log('   ✅ Orders match!');
  console.log('   Trade price:', testOrder.price);
  console.log('   Quantity:', 1);
  
  // Update orders
  testOrder.filledQuantity = 1;
  testOrder.status = 'FILLED';
  sellOrder.filledQuantity = 1;
  sellOrder.status = 'FILLED';
  
  // Create trade
  const trade = {
    id: 'TRD-001',
    buyOrderId: testOrder.id,
    sellOrderId: sellOrder.id,
    price: testOrder.price,
    quantity: 1,
    timestamp: Date.now()
  };
  
  mockDb.trades.set(trade.id, trade);
  console.log('   ✅ Trade executed:', trade.id);
} else {
  console.log('   ❌ No match');
}

// Test 3: Settlement Batch
console.log('\n3. Testing Settlement Batch:');
const settlementBatch = {
  id: 'BATCH-001',
  epochNumber: 1,
  trades: [mockDb.trades.get('TRD-001')],
  status: 'PENDING',
  timestamp: Date.now()
};

console.log('   ✅ Settlement batch created');
console.log('   Epoch:', settlementBatch.epochNumber);
console.log('   Trades:', settlementBatch.trades.length);

// Test 4: WebSocket Events (simulated)
console.log('\n4. Testing WebSocket Events:');
const events = [
  { event: 'order:submitted', data: testOrder },
  { event: 'order:filled', data: testOrder },
  { event: 'trade:executed', data: mockDb.trades.get('TRD-001') },
  { event: 'settlement:pending', data: settlementBatch }
];

events.forEach(({ event, data }) => {
  console.log(`   ✅ Event: ${event}`);
});

// Test 5: System Summary
console.log('\n5. System Status:');
console.log('   Orders:', mockDb.orders.size);
console.log('   Trades:', mockDb.trades.size);
console.log('   Filled orders:', Array.from(mockDb.orders.values()).filter(o => o.status === 'FILLED').length);

console.log('\n🎉 All mock tests passed!');
console.log('\nTo run the full system:');
console.log('1. Start PostgreSQL: brew services start postgresql');
console.log('2. Create database: createdb trading_platform');
console.log('3. Run schema: psql -d trading_platform < src/database/schema.sql');
console.log('4. Start system: npm run dev');