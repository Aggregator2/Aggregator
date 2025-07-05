#!/usr/bin/env node

const http = require('http');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3000';
let testResults = [];
let testsPassed = 0;
let testsFailed = 0;

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = {
            status: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          };
          resolve(response);
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// Test function wrapper
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
    testResults.push({ name, status: 'passed' });
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    testsFailed++;
    testResults.push({ name, status: 'failed', error: error.message });
  }
}

// Generate test JWT
function generateTestJWT(userId = 'user1') {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 86400000 })).toString('base64');
  const signature = crypto.createHmac('sha256', 'secret').update(header + '.' + payload).digest('base64');
  return header + '.' + payload + '.' + signature;
}

// Test Suite
async function runTests() {
  console.log('🧪 SwappiQ Comprehensive Test Suite');
  console.log('===================================\n');

  // 1. Health Check Tests
  console.log('📊 Testing Health Endpoints...');
  
  await test('GET /api/health', async () => {
    const res = await makeRequest('GET', '/api/health');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.status) throw new Error('Missing status');
    if (!res.body.timestamp) throw new Error('Missing timestamp');
  });

  await test('GET /api/health/detailed', async () => {
    const res = await makeRequest('GET', '/api/health/detailed');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.services) throw new Error('Missing services');
    if (!res.body.metrics) throw new Error('Missing metrics');
    if (res.body.services.database !== 'connected') throw new Error('Database not connected');
  });

  // 2. Token Tests
  console.log('\n💰 Testing Token Endpoints...');
  
  await test('GET /api/tokens/comprehensive', async () => {
    const res = await makeRequest('GET', '/api/tokens/comprehensive');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!Array.isArray(res.body.tokens)) throw new Error('Tokens not array');
    if (res.body.tokens.length < 5) throw new Error('Not enough tokens');
    const eth = res.body.tokens.find(t => t.symbol === 'ETH');
    if (!eth) throw new Error('ETH token not found');
  });

  // 3. Quote Tests
  console.log('\n📈 Testing Quote Endpoints...');
  
  await test('POST /api/quote - Valid quote', async () => {
    const res = await makeRequest('POST', '/api/quote', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      sellAmount: '1'
    });
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.buyAmount) throw new Error('Missing buyAmount');
    if (!res.body.price) throw new Error('Missing price');
    if (!res.body.estimatedGas) throw new Error('Missing estimatedGas');
  });

  await test('POST /api/quote - Different pair', async () => {
    const res = await makeRequest('POST', '/api/quote', {
      sellToken: 'USDT',
      buyToken: 'USDC',
      sellAmount: '1000'
    });
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (res.body.buyAmount !== '1000') throw new Error('Incorrect stablecoin conversion');
  });

  // 4. Authentication Tests
  console.log('\n🔐 Testing Authentication...');
  
  const testToken = generateTestJWT('user1');
  
  await test('POST /api/submitOrder - No auth', async () => {
    const res = await makeRequest('POST', '/api/submitOrder', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      amount: '1',
      side: 'sell'
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await test('POST /api/submitOrder - With auth', async () => {
    const res = await makeRequest('POST', '/api/submitOrder', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      amount: '1',
      side: 'sell',
      userId: 'user1'
    }, {
      'Authorization': `Bearer ${testToken}`
    });
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.orderId) throw new Error('Missing orderId');
  });

  // 5. Order Management Tests
  console.log('\n📦 Testing Order Management...');
  
  let testOrderId;
  
  await test('Create test order', async () => {
    const res = await makeRequest('POST', '/api/submitOrder', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      amount: '0.5',
      side: 'sell',
      userId: 'user1'
    }, {
      'Authorization': `Bearer ${testToken}`
    });
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    testOrderId = res.body.orderId;
  });

  await test('GET /api/orders/:orderId', async () => {
    const res = await makeRequest('GET', `/api/orders/${testOrderId}`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (res.body.id !== testOrderId) throw new Error('Order ID mismatch');
    if (!res.body.status) throw new Error('Missing status');
  });

  await test('GET /api/orders/history', async () => {
    const res = await makeRequest('GET', '/api/orders/history', null, {
      'Authorization': `Bearer ${testToken}`
    });
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!Array.isArray(res.body.orders)) throw new Error('Orders not array');
    const found = res.body.orders.find(o => o.id === testOrderId);
    if (!found) throw new Error('Test order not in history');
  });

  await test('GET /api/orderbook', async () => {
    const res = await makeRequest('GET', '/api/orderbook');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!Array.isArray(res.body.buy)) throw new Error('Buy orders not array');
    if (!Array.isArray(res.body.sell)) throw new Error('Sell orders not array');
  });

  // 6. Settlement Tests
  console.log('\n⚡ Testing Settlement System...');
  
  await test('POST /api/settlement/initiate', async () => {
    const res = await makeRequest('POST', '/api/settlement/initiate', {
      orderId: testOrderId,
      amount: '0.5',
      token: 'ETH'
    });
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.settlementId) throw new Error('Missing settlementId');
  });

  await test('GET /api/orders/:orderId/settlement-proof', async () => {
    // Wait a bit for order to be "filled"
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    const res = await makeRequest('GET', `/api/orders/${testOrderId}/settlement-proof`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.merkleRoot) throw new Error('Missing merkleRoot');
    if (!Array.isArray(res.body.proofPath)) throw new Error('Invalid proof path');
  });

  // 7. Dispute Tests
  console.log('\n⚖️ Testing Dispute Resolution...');
  
  let testDisputeId;
  
  await test('POST /api/disputes - Create dispute', async () => {
    const res = await makeRequest('POST', '/api/disputes', {
      orderId: testOrderId,
      reason: 'Settlement amount incorrect',
      userId: 'user1'
    });
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.disputeId) throw new Error('Missing disputeId');
    testDisputeId = res.body.disputeId;
  });

  await test('POST /api/disputes/settle', async () => {
    const res = await makeRequest('POST', '/api/disputes/settle', {
      disputeId: testDisputeId,
      resolution: 'Refund issued to user'
    });
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (res.body.status !== 'resolved') throw new Error('Dispute not resolved');
  });

  // 8. Market Maker Tests
  console.log('\n🏦 Testing Market Maker Features...');
  
  await test('POST /api/market-maker/apply', async () => {
    const res = await makeRequest('POST', '/api/market-maker/apply', {
      name: 'Test Market Maker',
      email: 'mm@test.com',
      liquidityCommitment: '100000'
    });
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.applicationId) throw new Error('Missing applicationId');
  });

  await test('GET /api/competition/leaderboard', async () => {
    const res = await makeRequest('GET', '/api/competition/leaderboard');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!Array.isArray(res.body.leaderboard)) throw new Error('Leaderboard not array');
    if (res.body.leaderboard.length < 3) throw new Error('Not enough leaderboard entries');
  });

  // 9. Analytics Tests
  console.log('\n📊 Testing Analytics Endpoints...');
  
  await test('GET /api/analytics/profits', async () => {
    const res = await makeRequest('GET', '/api/analytics/profits');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.daily) throw new Error('Missing daily profits');
    if (!res.body.weekly) throw new Error('Missing weekly profits');
    if (!res.body.monthly) throw new Error('Missing monthly profits');
  });

  await test('GET /api/revenue/status', async () => {
    const res = await makeRequest('GET', '/api/revenue/status');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.totalRevenue) throw new Error('Missing totalRevenue');
    if (!res.body.pendingSettlements) throw new Error('Missing pendingSettlements');
  });

  // 10. Notification Tests
  console.log('\n🔔 Testing Notifications...');
  
  await test('GET /api/notifications/user/:userId', async () => {
    const res = await makeRequest('GET', '/api/notifications/user/user1');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!Array.isArray(res.body.notifications)) throw new Error('Notifications not array');
  });

  // 11. WebSocket Health
  console.log('\n🔌 Testing WebSocket Health...');
  
  await test('GET /api/ws/health', async () => {
    const res = await makeRequest('GET', '/api/ws/health');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (res.body.status !== 'active') throw new Error('WebSocket not active');
  });

  // 12. UI Tests
  console.log('\n🎨 Testing UI Endpoint...');
  
  await test('GET / - UI Homepage', async () => {
    const res = await makeRequest('GET', '/');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.includes('SwappiQ')) throw new Error('UI not serving correctly');
    if (!res.body.includes('Swap Tokens')) throw new Error('Swap widget missing');
  });

  // Summary
  console.log('\n📋 Test Summary');
  console.log('================');
  console.log(`Total Tests: ${testsPassed + testsFailed}`);
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

  if (testsFailed > 0) {
    console.log('\nFailed Tests:');
    testResults.filter(t => t.status === 'failed').forEach(t => {
      console.log(`  - ${t.name}: ${t.error}`);
    });
  }

  return testsFailed === 0;
}

// Run tests
runTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});