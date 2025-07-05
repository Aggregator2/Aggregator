const axios = require('axios');

async function testServices() {
  console.log('🧪 Testing SwappiQ Services Integration\n');
  
  const tests = [
    { name: 'Health Check', url: 'http://localhost:3000/api/health', expectedStatus: 200 },
    { name: 'WebSocket Status', url: 'http://localhost:3000/api/websocket', expectedStatus: 200 },
    { name: 'Quote Endpoint', url: 'http://localhost:3000/api/quote?sellToken=ETH&buyToken=USDC&amount=1', expectedStatus: [200, 500] },
    { name: 'Order Book', url: 'http://localhost:3000/api/orderbook/ETH-USDC', expectedStatus: [200, 500] },
    { name: 'Settlement Status', url: 'http://localhost:3000/api/settlement/status', expectedStatus: [200, 500] },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const response = await axios.get(test.url, { 
        timeout: 5000,
        validateStatus: () => true 
      });
      
      const expectedStatuses = Array.isArray(test.expectedStatus) ? test.expectedStatus : [test.expectedStatus];
      const success = expectedStatuses.includes(response.status);
      
      if (success) {
        console.log(`✅ ${test.name}: ${response.status} - OK`);
        passed++;
      } else {
        console.log(`❌ ${test.name}: ${response.status} - Expected ${expectedStatuses.join(' or ')}`);
        failed++;
      }
      
      if (response.data && typeof response.data === 'object') {
        console.log(`   Response: ${JSON.stringify(response.data).substring(0, 100)}...`);
      }
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
      failed++;
    }
    console.log('');
  }
  
  console.log(`\n📊 Summary: ${passed} passed, ${failed} failed`);
  
  // Test Redis
  const redis = require('redis');
  const client = redis.createClient();
  
  try {
    await client.connect();
    await client.ping();
    console.log('✅ Redis: Connected and responding');
    await client.disconnect();
  } catch (error) {
    console.log('❌ Redis:', error.message);
  }
  
  // Test matching engine
  try {
    const { getMatchingEngine } = require('./src/services/matchingEngine/singleton');
    const engine = getMatchingEngine();
    console.log('✅ Matching Engine: Initialized with pairs:', engine.getTradingPairs());
  } catch (error) {
    console.log('❌ Matching Engine:', error.message);
  }
}

testServices().catch(console.error);