#!/usr/bin/env node

const axios = require('axios');
const jwt = require('jsonwebtoken');
const chalk = require('chalk');

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

// Generate test tokens
function generateToken(payload, expiresIn = '1h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// Test tokens
const tokens = {
  valid: generateToken({ 
    id: 'user123', 
    email: 'user@example.com', 
    role: 'user' 
  }),
  admin: generateToken({ 
    id: 'admin123', 
    email: 'admin@example.com', 
    role: 'admin' 
  }),
  marketMaker: generateToken({ 
    id: 'mm123', 
    email: 'mm@example.com', 
    role: 'market_maker' 
  }),
  expired: generateToken({ 
    id: 'expired123', 
    email: 'expired@example.com' 
  }, '-1h'),
  invalid: 'invalid.token.here'
};

// Test endpoints
const testEndpoints = [
  // Public endpoints (should work without auth)
  {
    name: 'Health Check',
    method: 'GET',
    url: '/api/health',
    expectedStatus: { noAuth: 200, withAuth: 200 }
  },
  {
    name: 'Token List',
    method: 'GET',
    url: '/api/supported-tokens',
    expectedStatus: { noAuth: 200, withAuth: 200 }
  },
  
  // Authenticated endpoints (should require auth)
  {
    name: 'Submit Order',
    method: 'POST',
    url: '/api/submitOrder',
    body: {
      fromToken: '0x...',
      toToken: '0x...',
      amount: '1000000000000000000'
    },
    expectedStatus: { noAuth: 401, withAuth: 200, admin: 200 }
  },
  {
    name: 'Order History',
    method: 'GET',
    url: '/api/orders/history',
    expectedStatus: { noAuth: 401, withAuth: 200, admin: 200 }
  },
  {
    name: 'User Notifications',
    method: 'GET',
    url: '/api/notifications',
    expectedStatus: { noAuth: 401, withAuth: 200, admin: 200 }
  },
  
  // Admin endpoints (should require admin role)
  {
    name: 'Seed Orders',
    method: 'POST',
    url: '/api/seedOrders',
    expectedStatus: { noAuth: 401, withAuth: 403, admin: 200 }
  },
  {
    name: 'Settlement Claim',
    method: 'POST',
    url: '/api/settlement/proof/claim',
    body: { settlementId: 'test123' },
    expectedStatus: { noAuth: 401, withAuth: 403, admin: 200 }
  }
];

// Test a single endpoint
async function testEndpoint(endpoint, token = null) {
  const config = {
    method: endpoint.method,
    url: `${API_BASE_URL}${endpoint.url}`,
    headers: {},
    validateStatus: () => true // Don't throw on any status
  };
  
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  if (endpoint.body) {
    config.data = endpoint.body;
  }
  
  try {
    const response = await axios(config);
    return {
      status: response.status,
      data: response.data
    };
  } catch (error) {
    return {
      status: error.response?.status || 0,
      error: error.message
    };
  }
}

// Run authentication tests
async function runAuthTests() {
  console.log(chalk.bold.blue('\n🔐 Authentication Test Suite\n'));
  console.log('=' .repeat(80));
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`JWT Secret: ${JWT_SECRET.substring(0, 10)}...`);
  console.log('=' .repeat(80));
  
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0
  };
  
  for (const endpoint of testEndpoints) {
    console.log(chalk.bold(`\n📍 Testing: ${endpoint.name}`));
    console.log(`   ${endpoint.method} ${endpoint.url}`);
    
    // Test without authentication
    console.log('\n   🔓 Without Authentication:');
    const noAuthResult = await testEndpoint(endpoint);
    const noAuthExpected = endpoint.expectedStatus.noAuth;
    const noAuthPassed = noAuthResult.status === noAuthExpected;
    
    console.log(`      Status: ${noAuthResult.status} ${noAuthPassed ? chalk.green('✓') : chalk.red('✗')} (expected ${noAuthExpected})`);
    if (!noAuthPassed) {
      console.log(chalk.red(`      Error: Expected ${noAuthExpected}, got ${noAuthResult.status}`));
      results.failed++;
    } else {
      results.passed++;
    }
    
    // Test with valid user token
    console.log('\n   🔐 With User Authentication:');
    const authResult = await testEndpoint(endpoint, tokens.valid);
    const authExpected = endpoint.expectedStatus.withAuth;
    const authPassed = authResult.status === authExpected;
    
    console.log(`      Status: ${authResult.status} ${authPassed ? chalk.green('✓') : chalk.red('✗')} (expected ${authExpected})`);
    if (!authPassed) {
      console.log(chalk.red(`      Error: Expected ${authExpected}, got ${authResult.status}`));
      results.failed++;
    } else {
      results.passed++;
    }
    
    // Test with admin token (if applicable)
    if (endpoint.expectedStatus.admin) {
      console.log('\n   👑 With Admin Authentication:');
      const adminResult = await testEndpoint(endpoint, tokens.admin);
      const adminExpected = endpoint.expectedStatus.admin;
      const adminPassed = adminResult.status === adminExpected;
      
      console.log(`      Status: ${adminResult.status} ${adminPassed ? chalk.green('✓') : chalk.red('✗')} (expected ${adminExpected})`);
      if (!adminPassed) {
        console.log(chalk.red(`      Error: Expected ${adminExpected}, got ${adminResult.status}`));
        results.failed++;
      } else {
        results.passed++;
      }
    }
  }
  
  // Test invalid tokens
  console.log(chalk.bold('\n🔍 Testing Invalid Tokens:\n'));
  
  const invalidTokenTests = [
    { name: 'Expired Token', token: tokens.expired },
    { name: 'Invalid Token', token: tokens.invalid },
    { name: 'Malformed Header', token: 'not-a-bearer-token' }
  ];
  
  for (const test of invalidTokenTests) {
    const endpoint = testEndpoints.find(e => e.expectedStatus.noAuth === 401);
    if (endpoint) {
      console.log(`   Testing ${test.name}:`);
      const result = await testEndpoint(endpoint, test.token);
      const passed = result.status === 401;
      console.log(`      Status: ${result.status} ${passed ? chalk.green('✓') : chalk.red('✗')} (expected 401)`);
      
      if (passed) {
        results.passed++;
      } else {
        results.failed++;
      }
    }
  }
  
  // Summary
  console.log('\n' + '=' .repeat(80));
  console.log(chalk.bold('📊 Test Summary:\n'));
  console.log(`   Total Tests: ${results.passed + results.failed}`);
  console.log(`   ${chalk.green('Passed:')} ${results.passed}`);
  console.log(`   ${chalk.red('Failed:')} ${results.failed}`);
  console.log(`   ${chalk.yellow('Warnings:')} ${results.warnings}`);
  
  const successRate = (results.passed / (results.passed + results.failed) * 100).toFixed(1);
  console.log(`   Success Rate: ${successRate}%`);
  
  if (results.failed === 0) {
    console.log(chalk.green('\n✅ All authentication tests passed!'));
  } else {
    console.log(chalk.red('\n❌ Some authentication tests failed. Please review the results above.'));
  }
  
  return results;
}

// Run security audit after tests
async function runSecurityAudit() {
  console.log(chalk.bold.blue('\n\n🔍 Running Security Audit...\n'));
  
  try {
    const { execSync } = require('child_process');
    execSync('node scripts/api-security-audit.js', { stdio: 'inherit' });
  } catch (error) {
    console.error(chalk.red('Failed to run security audit:', error.message));
  }
}

// Main
async function main() {
  // Check if API is available
  try {
    await axios.get(`${API_BASE_URL}/api/health`);
  } catch (error) {
    console.error(chalk.red('❌ API is not available at', API_BASE_URL));
    console.error('   Please ensure the server is running');
    process.exit(1);
  }
  
  // Run tests
  const results = await runAuthTests();
  
  // Run security audit
  await runSecurityAudit();
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(console.error);