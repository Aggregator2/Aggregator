const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000/api';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

// Helper to print colored output
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Test rate limiting on an endpoint
async function testRateLimit(endpoint, maxRequests, description) {
  log(`\n=== Testing ${description} ===`, 'blue');
  log(`Endpoint: ${endpoint}`, 'blue');
  log(`Expected limit: ${maxRequests} requests\n`, 'blue');

  let successCount = 0;
  let rateLimitedCount = 0;
  let lastHeaders = {};

  // Make requests until we hit rate limit
  for (let i = 1; i <= maxRequests + 5; i++) {
    try {
      const response = await axios.get(`${API_BASE_URL}${endpoint}`, {
        headers: {
          'X-Test-Request': i
        }
      });

      successCount++;
      lastHeaders = response.headers;

      log(`Request ${i}: ✅ Success`, 'green');
      log(`  Remaining: ${response.headers['x-ratelimit-remaining']}`, 'yellow');
      
      // Add small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      if (error.response?.status === 429) {
        rateLimitedCount++;
        log(`Request ${i}: ❌ Rate limited (429)`, 'red');
        log(`  Message: ${error.response.data.message}`, 'red');
        log(`  Retry after: ${error.response.headers['retry-after']} seconds`, 'yellow');
        
        // Show rate limit reset time
        const resetTime = error.response.headers['x-ratelimit-reset'];
        if (resetTime) {
          log(`  Reset at: ${new Date(resetTime).toLocaleTimeString()}`, 'yellow');
        }
      } else {
        log(`Request ${i}: ❌ Error: ${error.message}`, 'red');
      }
    }
  }

  log(`\nSummary:`, 'magenta');
  log(`  Successful requests: ${successCount}`, 'green');
  log(`  Rate limited requests: ${rateLimitedCount}`, 'red');
  log(`  Rate limit headers from last success:`, 'yellow');
  log(`    Limit: ${lastHeaders['x-ratelimit-limit'] || 'N/A'}`, 'yellow');
  log(`    Reset: ${lastHeaders['x-ratelimit-reset'] ? new Date(lastHeaders['x-ratelimit-reset']).toLocaleTimeString() : 'N/A'}`, 'yellow');

  return { successCount, rateLimitedCount };
}

// Test sensitive endpoint with POST requests
async function testSensitiveEndpoint() {
  log(`\n=== Testing Sensitive Endpoint (POST) ===`, 'blue');
  log(`Endpoint: /examples/rate-limited-sensitive`, 'blue');
  log(`Expected limit: 10 requests per 15 minutes\n`, 'blue');

  let successCount = 0;
  let rateLimitedCount = 0;

  for (let i = 1; i <= 15; i++) {
    try {
      const response = await axios.post(`${API_BASE_URL}/examples/rate-limited-sensitive`, {
        amount: 100,
        pair: 'ETH/USDC'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      successCount++;
      log(`Request ${i}: ✅ Success`, 'green');
      log(`  Order ID: ${response.data.orderId}`, 'yellow');
      log(`  Remaining: ${response.headers['x-ratelimit-remaining']}`, 'yellow');

      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      if (error.response?.status === 429) {
        rateLimitedCount++;
        log(`Request ${i}: ❌ Rate limited`, 'red');
        log(`  Retry after: ${error.response.headers['retry-after']} seconds`, 'yellow');
      } else {
        log(`Request ${i}: ❌ Error: ${error.message}`, 'red');
      }
    }
  }

  log(`\nSummary:`, 'magenta');
  log(`  Successful requests: ${successCount}`, 'green');
  log(`  Rate limited requests: ${rateLimitedCount}`, 'red');
}

// Test with different IPs (simulated)
async function testDifferentClients() {
  log(`\n=== Testing Different Clients ===`, 'blue');
  log(`Testing if rate limits are per-client\n`, 'blue');

  const clients = ['192.168.1.1', '192.168.1.2', '192.168.1.3'];
  
  for (const clientIp of clients) {
    try {
      const response = await axios.get(`${API_BASE_URL}/examples/rate-limited-general`, {
        headers: {
          'X-Forwarded-For': clientIp
        }
      });

      log(`Client ${clientIp}: ✅ Success`, 'green');
      log(`  Remaining: ${response.headers['x-ratelimit-remaining']}`, 'yellow');

    } catch (error) {
      if (error.response?.status === 429) {
        log(`Client ${clientIp}: ❌ Rate limited`, 'red');
      } else {
        log(`Client ${clientIp}: ❌ Error: ${error.message}`, 'red');
      }
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Main test runner
async function runTests() {
  log('🚀 Starting Rate Limiting Tests', 'magenta');
  log('================================\n', 'magenta');

  try {
    // Test 1: General endpoint
    await testRateLimit('/examples/rate-limited-general', 100, 'General Endpoint');
    
    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 2: Sensitive endpoint
    await testSensitiveEndpoint();
    
    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 3: Custom endpoint
    await testRateLimit('/examples/rate-limited-custom', 25, 'Custom Endpoint');
    
    // Test 4: Different clients
    await testDifferentClients();
    
    log('\n✅ All tests completed!', 'green');
    
  } catch (error) {
    log(`\n❌ Test runner error: ${error.message}`, 'red');
  }
}

// Run specific test based on command line argument
const testType = process.argv[2];

if (testType === 'general') {
  testRateLimit('/examples/rate-limited-general', 100, 'General Endpoint').catch(console.error);
} else if (testType === 'sensitive') {
  testSensitiveEndpoint().catch(console.error);
} else if (testType === 'custom') {
  testRateLimit('/examples/rate-limited-custom', 25, 'Custom Endpoint').catch(console.error);
} else if (testType === 'clients') {
  testDifferentClients().catch(console.error);
} else {
  // Run all tests
  runTests().catch(console.error);
}

// Usage instructions
if (!testType) {
  log('\nUsage:', 'yellow');
  log('  node test-rate-limiting.js           # Run all tests', 'yellow');
  log('  node test-rate-limiting.js general   # Test general endpoint only', 'yellow');
  log('  node test-rate-limiting.js sensitive # Test sensitive endpoint only', 'yellow');
  log('  node test-rate-limiting.js custom    # Test custom endpoint only', 'yellow');
  log('  node test-rate-limiting.js clients   # Test different clients', 'yellow');
}