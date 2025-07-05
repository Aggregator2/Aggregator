#!/usr/bin/env node

const axios = require('axios');

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

// Test configurations
const tests = [
  {
    name: 'Public Endpoint Rate Limit (100 req/min)',
    endpoint: '/api/health',
    rateLimit: 100,
    windowMs: 60000,
    requestCount: 110
  },
  {
    name: 'Trading Endpoint Rate Limit (10 req/sec)',
    endpoint: '/api/quote',
    rateLimit: 10,
    windowMs: 1000,
    requestCount: 15
  },
  {
    name: 'Strict Endpoint Rate Limit (10 req/5min)',
    endpoint: '/api/auth/login',
    rateLimit: 10,
    windowMs: 300000,
    requestCount: 12,
    body: { username: 'test', password: 'test' }
  }
];

async function testRateLimit(test) {
  console.log(`\n🧪 Testing: ${test.name}`);
  console.log(`   Endpoint: ${test.endpoint}`);
  console.log(`   Rate Limit: ${test.rateLimit} requests per ${test.windowMs / 1000} seconds`);
  console.log(`   Test Requests: ${test.requestCount}`);

  const results = {
    success: 0,
    rateLimited: 0,
    errors: 0,
    retryAfterValues: []
  };

  const startTime = Date.now();
  const promises = [];

  // Send requests
  for (let i = 0; i < test.requestCount; i++) {
    const promise = axios({
      method: test.body ? 'POST' : 'GET',
      url: `${API_BASE_URL}${test.endpoint}`,
      data: test.body,
      validateStatus: () => true // Don't throw on any status
    }).then(response => {
      if (response.status === 429) {
        results.rateLimited++;
        if (response.data.retryAfter) {
          results.retryAfterValues.push(response.data.retryAfter);
        }
        
        // Check rate limit headers
        const headers = response.headers;
        if (i === test.requestCount - 1) {
          console.log('\n   Rate Limit Headers:');
          console.log(`   - X-RateLimit-Limit: ${headers['x-ratelimit-limit']}`);
          console.log(`   - X-RateLimit-Remaining: ${headers['x-ratelimit-remaining']}`);
          console.log(`   - X-RateLimit-Reset: ${headers['x-ratelimit-reset']}`);
          console.log(`   - Retry-After: ${headers['retry-after']}`);
        }
      } else if (response.status >= 200 && response.status < 300) {
        results.success++;
      } else {
        results.errors++;
      }
    }).catch(error => {
      results.errors++;
      console.error(`   Request ${i + 1} error:`, error.message);
    });

    promises.push(promise);
    
    // Add small delay to spread requests
    if (test.windowMs < 60000) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  await Promise.all(promises);
  const duration = Date.now() - startTime;

  console.log('\n   Results:');
  console.log(`   ✅ Successful: ${results.success}`);
  console.log(`   🚫 Rate Limited: ${results.rateLimited}`);
  console.log(`   ❌ Errors: ${results.errors}`);
  console.log(`   ⏱️  Duration: ${duration}ms`);

  if (results.retryAfterValues.length > 0) {
    console.log(`   ⏳ Retry After values: ${results.retryAfterValues.slice(0, 5).join(', ')}...`);
  }

  // Verify rate limiting is working
  const expectedRateLimited = test.requestCount - test.rateLimit;
  if (results.rateLimited >= expectedRateLimited - 2 && results.rateLimited <= expectedRateLimited + 2) {
    console.log(`   ✅ Rate limiting is working correctly!`);
  } else {
    console.log(`   ⚠️  Expected ~${expectedRateLimited} rate limited requests, got ${results.rateLimited}`);
  }

  return results;
}

async function runTests() {
  console.log('🚀 Starting Rate Limiting Tests');
  console.log(`   API Base URL: ${API_BASE_URL}`);
  console.log('=' .repeat(60));

  for (const test of tests) {
    await testRateLimit(test);
    
    // Wait between tests to reset rate limits
    if (test !== tests[tests.length - 1]) {
      console.log('\n   Waiting for rate limit reset...');
      await new Promise(resolve => setTimeout(resolve, Math.min(test.windowMs + 1000, 5000)));
    }
  }

  console.log('\n' + '=' .repeat(60));
  console.log('✅ Rate Limiting Tests Complete!');
}

// Check if API is available
async function checkAPI() {
  try {
    await axios.get(`${API_BASE_URL}/api/health`);
    return true;
  } catch (error) {
    console.error('❌ API is not available at', API_BASE_URL);
    console.error('   Please ensure the server is running');
    return false;
  }
}

// Main
(async () => {
  const apiAvailable = await checkAPI();
  if (apiAvailable) {
    await runTests();
  }
  process.exit(0);
})();