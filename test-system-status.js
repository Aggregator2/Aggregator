#!/usr/bin/env node

const axios = require('axios');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');

async function testSystemStatus() {
  console.log('\n🔍 SwappiQ System Status Check\n');
  
  const results = {
    jwt: false,
    redis: false,
    health: false,
    auth: false,
    websocket: false
  };

  // Test 1: JWT_SECRET
  console.log('1. Checking JWT_SECRET...');
  const jwtSecret = process.env.JWT_SECRET || '37c1c35b7c7e9d78df9d03e3ee4e2bbe716f9f4c0af512ccfb95dca216b65511';
  try {
    const testToken = jwt.sign({ userId: 'test123' }, jwtSecret);
    const decoded = jwt.verify(testToken, jwtSecret);
    console.log('✅ JWT working with secret');
    results.jwt = true;
  } catch (error) {
    console.log('❌ JWT failed:', error.message);
  }

  // Test 2: Redis
  console.log('\n2. Checking Redis...');
  try {
    const redis = createClient({ url: 'redis://localhost:6379' });
    await redis.connect();
    await redis.ping();
    console.log('✅ Redis is running');
    results.redis = true;
    await redis.quit();
  } catch (error) {
    console.log('❌ Redis failed:', error.message);
  }

  // Test 3: Health endpoint
  console.log('\n3. Checking health endpoint...');
  try {
    const response = await axios.get('http://localhost:3001/api/health');
    console.log('✅ Health endpoint returned:', response.status);
    results.health = true;
  } catch (error) {
    console.log('❌ Health endpoint failed:', error.response?.status || error.message);
  }

  // Test 4: Auth on submitOrder
  console.log('\n4. Checking authentication...');
  try {
    // Test without auth
    try {
      await axios.post('http://localhost:3001/api/submitOrder', { test: 'data' });
      console.log('⚠️  Endpoint allows unauthenticated access');
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('✅ Correctly rejected unauthenticated request');
        results.auth = true;
      } else {
        console.log('❌ Unexpected error:', error.response?.status);
      }
    }
  } catch (error) {
    console.log('❌ Auth test failed:', error.message);
  }

  // Test 5: WebSocket
  console.log('\n5. Checking WebSocket...');
  try {
    const wsResponse = await axios.get('http://localhost:3001/socket.io/');
    console.log('✅ WebSocket server is running');
    results.websocket = true;
  } catch (error) {
    console.log('❌ WebSocket not available on port 3001');
  }

  // Summary
  console.log('\n📊 Summary:');
  console.log('─────────────────────────');
  const passed = Object.values(results).filter(v => v).length;
  const total = Object.keys(results).length;
  
  for (const [key, value] of Object.entries(results)) {
    console.log(`${value ? '✅' : '❌'} ${key.toUpperCase()}`);
  }
  
  console.log('─────────────────────────');
  console.log(`Total: ${passed}/${total} tests passed\n`);
  
  if (passed === total) {
    console.log('🎉 System is fully operational!');
  } else {
    console.log('⚠️  Some services need attention');
  }
}

testSystemStatus().catch(console.error);