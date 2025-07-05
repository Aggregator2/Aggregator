#!/usr/bin/env node

const http = require('http');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3000';

// Helper function for HTTP requests
function request(method, path, data = null, headers = {}) {
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
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body ? JSON.parse(body) : null
        });
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// Generate JWT tokens
function generateJWT(payload, secret = 'secret') {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = crypto.createHmac('sha256', secret).update(header + '.' + payloadB64).digest('base64');
  return header + '.' + payloadB64 + '.' + signature;
}

async function testAuthentication() {
  console.log('🔐 Testing SwappiQ Authentication & Authorization');
  console.log('===============================================\n');
  
  let passed = 0;
  let failed = 0;
  
  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
      failed++;
    }
  };

  // 1. Test unauthenticated access
  console.log('🚫 Testing Unauthenticated Access...\n');
  
  await test('Reject unauthenticated order submission', async () => {
    const res = await request('POST', '/api/submitOrder', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      amount: '1'
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await test('Reject unauthenticated order history', async () => {
    const res = await request('GET', '/api/orders/history');
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // 2. Test valid authentication
  console.log('\n✅ Testing Valid Authentication...\n');
  
  const validToken = generateJWT({ userId: 'user1', exp: Date.now() + 86400000 });
  
  await test('Accept valid JWT for order submission', async () => {
    const res = await request('POST', '/api/submitOrder', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      amount: '1',
      side: 'sell',
      userId: 'user1'
    }, {
      'Authorization': `Bearer ${validToken}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.body.orderId) throw new Error('Missing orderId');
  });

  await test('Accept valid JWT for order history', async () => {
    const res = await request('GET', '/api/orders/history', null, {
      'Authorization': `Bearer ${validToken}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!Array.isArray(res.body.orders)) throw new Error('Orders not array');
  });

  // 3. Test expired tokens
  console.log('\n⏰ Testing Expired Tokens...\n');
  
  const expiredToken = generateJWT({ userId: 'user1', exp: Date.now() - 1000 });
  
  await test('Reject expired JWT', async () => {
    const res = await request('POST', '/api/submitOrder', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      amount: '1',
      userId: 'user1'
    }, {
      'Authorization': `Bearer ${expiredToken}`
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // 4. Test invalid tokens
  console.log('\n🚨 Testing Invalid Tokens...\n');
  
  await test('Reject malformed JWT', async () => {
    const res = await request('POST', '/api/submitOrder', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      amount: '1'
    }, {
      'Authorization': 'Bearer invalid.token.here'
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await test('Reject JWT with wrong signature', async () => {
    const wrongSignatureToken = generateJWT({ userId: 'user1', exp: Date.now() + 86400000 }, 'wrong-secret');
    const res = await request('POST', '/api/submitOrder', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      amount: '1',
      userId: 'user1'
    }, {
      'Authorization': `Bearer ${wrongSignatureToken}`
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // 5. Test user isolation
  console.log('\n👥 Testing User Isolation...\n');
  
  const user1Token = generateJWT({ userId: 'user1', exp: Date.now() + 86400000 });
  const user2Token = generateJWT({ userId: 'user2', exp: Date.now() + 86400000 });
  
  // Create order as user1
  let user1OrderId;
  await test('Create order as user1', async () => {
    const res = await request('POST', '/api/submitOrder', {
      sellToken: 'ETH',
      buyToken: 'USDT',
      amount: '2',
      side: 'sell',
      userId: 'user1'
    }, {
      'Authorization': `Bearer ${user1Token}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    user1OrderId = res.body.orderId;
  });

  // Create order as user2
  await test('Create order as user2', async () => {
    const res = await request('POST', '/api/submitOrder', {
      sellToken: 'USDT',
      buyToken: 'ETH',
      amount: '1000',
      side: 'buy',
      userId: 'user2'
    }, {
      'Authorization': `Bearer ${user2Token}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await test('User1 sees only their orders', async () => {
    const res = await request('GET', '/api/orders/history', null, {
      'Authorization': `Bearer ${user1Token}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const user1Orders = res.body.orders.filter(o => o.userId === 'user1');
    const user2Orders = res.body.orders.filter(o => o.userId === 'user2');
    if (user1Orders.length === 0) throw new Error('User1 orders not found');
    if (user2Orders.length !== 0) throw new Error('User2 orders visible to User1');
  });

  await test('User2 sees only their orders', async () => {
    const res = await request('GET', '/api/orders/history', null, {
      'Authorization': `Bearer ${user2Token}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const user1Orders = res.body.orders.filter(o => o.userId === 'user1');
    const user2Orders = res.body.orders.filter(o => o.userId === 'user2');
    if (user2Orders.length === 0) throw new Error('User2 orders not found');
    if (user1Orders.length !== 0) throw new Error('User1 orders visible to User2');
  });

  // 6. Test public vs protected endpoints
  console.log('\n🌐 Testing Public vs Protected Endpoints...\n');
  
  const publicEndpoints = [
    { method: 'GET', path: '/api/health', name: 'Health check' },
    { method: 'GET', path: '/api/tokens/comprehensive', name: 'Token list' },
    { method: 'POST', path: '/api/quote', name: 'Quote' },
    { method: 'GET', path: '/api/orderbook', name: 'Order book' },
    { method: 'GET', path: '/api/competition/leaderboard', name: 'Leaderboard' }
  ];

  for (const endpoint of publicEndpoints) {
    await test(`Public access to ${endpoint.name}`, async () => {
      const res = await request(endpoint.method, endpoint.path, 
        endpoint.method === 'POST' ? { sellToken: 'ETH', buyToken: 'USDT', sellAmount: '1' } : null
      );
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
  }

  // 7. Test authorization headers
  console.log('\n📋 Testing Authorization Headers...\n');
  
  await test('Accept Bearer token format', async () => {
    const res = await request('GET', '/api/orders/history', null, {
      'Authorization': `Bearer ${validToken}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await test('Reject non-Bearer format', async () => {
    const res = await request('GET', '/api/orders/history', null, {
      'Authorization': validToken // Missing "Bearer " prefix
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // Summary
  console.log('\n📊 Authentication Test Summary');
  console.log('==============================');
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  return failed === 0;
}

// Run tests
testAuthentication().then(success => {
  console.log(success ? '\n✅ All authentication tests passed!' : '\n❌ Some authentication tests failed');
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});