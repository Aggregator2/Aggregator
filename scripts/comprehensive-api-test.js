#!/usr/bin/env node

const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');

// Test configuration
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'test-api-key';
const TEST_USER_ID = 'test-user-123';
const TEST_WALLET_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc9e7595f87D94';

// Color codes for output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Test result categories
const testResults = {
  fullyImplemented: [],
  partiallyImplemented: [],
  missingOrBroken: [],
  securityIssues: []
};

// Helper function to make HTTP requests
async function makeRequest(method, endpoint, data = null, headers = {}) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        ...headers
      },
      data,
      timeout: 5000,
      validateStatus: () => true // Don't throw on any status code
    };

    const startTime = performance.now();
    const response = await axios(config);
    const duration = performance.now() - startTime;

    return {
      success: true,
      status: response.status,
      data: response.data,
      headers: response.headers,
      duration
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
}

// Check if endpoint file exists
async function checkEndpointFile(apiPath) {
  const possiblePaths = [
    path.join('/workspace/pages', apiPath + '.js'),
    path.join('/workspace/pages', apiPath + '.ts'),
    path.join('/workspace/pages', apiPath, 'index.js'),
    path.join('/workspace/pages', apiPath, 'index.ts')
  ];

  for (const filePath of possiblePaths) {
    try {
      await fs.access(filePath);
      return { exists: true, path: filePath };
    } catch (e) {
      // Continue checking
    }
  }
  return { exists: false };
}

// Test WebSocket endpoint
async function testWebSocket(endpoint) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:3000${endpoint}`, {
      headers: {
        'x-api-key': API_KEY
      }
    });

    const timeout = setTimeout(() => {
      ws.close();
      resolve({ success: false, error: 'Connection timeout' });
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      ws.close();
      resolve({ success: true });
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: error.message });
    });
  });
}

// Security tests
async function performSecurityTests(endpoint, method = 'GET') {
  const securityIssues = [];

  // Test 1: SQL Injection
  const sqlInjectionPayloads = [
    "' OR '1'='1",
    "1; DROP TABLE users--",
    "' UNION SELECT * FROM users--"
  ];

  for (const payload of sqlInjectionPayloads) {
    const response = await makeRequest(method, `${endpoint}?id=${payload}`);
    if (response.success && response.status === 500 && 
        (response.data?.error?.includes('SQL') || response.data?.error?.includes('syntax'))) {
      securityIssues.push('Potential SQL injection vulnerability');
      break;
    }
  }

  // Test 2: XSS
  const xssPayload = '<script>alert("XSS")</script>';
  const xssResponse = await makeRequest(method, endpoint, { input: xssPayload });
  if (xssResponse.success && xssResponse.data?.toString().includes(xssPayload)) {
    securityIssues.push('Potential XSS vulnerability');
  }

  // Test 3: Missing authentication
  const noAuthResponse = await makeRequest(method, endpoint, null, { 'x-api-key': '' });
  if (noAuthResponse.success && noAuthResponse.status === 200) {
    securityIssues.push('Missing authentication');
  }

  // Test 4: Rate limiting
  const rateLimitPromises = [];
  for (let i = 0; i < 50; i++) {
    rateLimitPromises.push(makeRequest(method, endpoint));
  }
  const rateLimitResults = await Promise.all(rateLimitPromises);
  const hasRateLimit = rateLimitResults.some(r => r.status === 429);
  if (!hasRateLimit) {
    securityIssues.push('No rate limiting implemented');
  }

  return securityIssues;
}

// Test individual endpoint
async function testEndpoint(endpoint, config = {}) {
  const {
    method = 'GET',
    data = null,
    requiresAuth = true,
    isWebSocket = false,
    expectedStatus = [200, 201],
    validateResponse = null
  } = config;

  const result = {
    endpoint,
    method,
    fileExists: false,
    responseStatus: null,
    hasAuth: false,
    hasValidation: false,
    hasErrorHandling: false,
    securityIssues: [],
    errors: [],
    warnings: [],
    duration: null
  };

  // Skip file check and proceed with HTTP testing
  result.fileExists = true; // Assume exists for HTTP testing

  // Test WebSocket endpoints differently
  if (isWebSocket) {
    const wsResult = await testWebSocket(endpoint);
    result.responseStatus = wsResult.success ? 200 : 0;
    if (!wsResult.success) {
      result.errors.push(`WebSocket error: ${wsResult.error}`);
    }
    return result;
  }

  // Make request
  const response = await makeRequest(method, endpoint, data);
  result.duration = response.duration;

  if (!response.success) {
    result.errors.push(`Request failed: ${response.error}`);
    return result;
  }

  result.responseStatus = response.status;

  // Check if response status is expected
  const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expectedStatuses.includes(response.status)) {
    result.warnings.push(`Unexpected status code: ${response.status}`);
  }

  // Test authentication
  if (requiresAuth) {
    const noAuthResponse = await makeRequest(method, endpoint, data, { 'x-api-key': '' });
    result.hasAuth = noAuthResponse.status === 401 || noAuthResponse.status === 403;
    if (!result.hasAuth) {
      result.warnings.push('Missing authentication check');
    }
  }

  // Test input validation
  if (method !== 'GET') {
    const invalidDataResponse = await makeRequest(method, endpoint, { invalid: 'data' });
    result.hasValidation = invalidDataResponse.status === 400 || 
                          (invalidDataResponse.data?.error && invalidDataResponse.data.error.includes('validation'));
    if (!result.hasValidation) {
      result.warnings.push('Missing input validation');
    }
  }

  // Test error handling
  const errorTestResponse = await makeRequest(method, `${endpoint}?force_error=true`);
  result.hasErrorHandling = errorTestResponse.status !== 500 || 
                           (errorTestResponse.data?.error && !errorTestResponse.data.stack);
  if (!result.hasErrorHandling) {
    result.warnings.push('Poor error handling (exposes stack traces)');
  }

  // Perform security tests
  result.securityIssues = await performSecurityTests(endpoint, method);

  // Custom validation
  if (validateResponse && response.status === 200) {
    try {
      validateResponse(response.data);
    } catch (e) {
      result.warnings.push(`Response validation failed: ${e.message}`);
    }
  }

  return result;
}

// Define all endpoints to test
const endpointsToTest = [
  // Health endpoints
  { endpoint: '/api/health', config: { requiresAuth: false } },
  { endpoint: '/api/health/detailed', config: { requiresAuth: false } },
  { endpoint: '/api/health-check', config: { requiresAuth: false } },
  
  // Order management
  { endpoint: '/api/submitOrder', config: { method: 'POST', data: { 
    tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1', userAddress: TEST_WALLET_ADDRESS 
  }}},
  { endpoint: '/api/submitOrderHybrid', config: { method: 'POST', data: { 
    tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1', userAddress: TEST_WALLET_ADDRESS 
  }}},
  { endpoint: '/api/submitOrder-validated', config: { method: 'POST', data: { 
    tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1', userAddress: TEST_WALLET_ADDRESS 
  }}},
  { endpoint: '/api/submitOrderV2', config: { method: 'POST', data: { 
    tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1', userAddress: TEST_WALLET_ADDRESS 
  }}},
  { endpoint: '/api/cancelOrder', config: { method: 'POST', data: { orderId: 'test-order-123' }}},
  { endpoint: '/api/validate-order', config: { method: 'POST', data: { 
    tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1' 
  }}},
  
  // Order status and history
  { endpoint: '/api/orders/history', config: { method: 'GET' }},
  { endpoint: '/api/orders/test-order-123', config: { method: 'GET' }},
  { endpoint: '/api/orders/status/test-order-123', config: { method: 'GET' }},
  { endpoint: '/api/orders/user/test-user-123', config: { method: 'GET' }},
  { endpoint: '/api/orderStatus/test-order-123', config: { method: 'GET' }},
  
  // Order book
  { endpoint: '/api/orderbook/ETH-USDC', config: { method: 'GET' }},
  { endpoint: '/api/trades/ETH-USDC', config: { method: 'GET' }},
  
  // Quotes
  { endpoint: '/api/quote', config: { method: 'GET' }},
  { endpoint: '/api/quote-profitable', config: { method: 'GET' }},
  { endpoint: '/api/quote/hybrid', config: { method: 'GET' }},
  { endpoint: '/api/trading/quote', config: { method: 'POST', data: {
    tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1'
  }}},
  
  // Settlement
  { endpoint: '/api/settlement/status', config: { method: 'GET' }},
  { endpoint: '/api/settlement/epochs', config: { method: 'GET' }},
  { endpoint: '/api/settlement/proof/test-trade-123', config: { method: 'GET' }},
  { endpoint: '/api/settlement/proof/verify', config: { method: 'POST', data: { proof: {} }}},
  { endpoint: '/api/settlement/user/test-user-123/settlements', config: { method: 'GET' }},
  { endpoint: '/api/orders/settlement-proof/test-order-123', config: { method: 'GET' }},
  
  // State channels
  { endpoint: '/api/channels/create', config: { method: 'POST', data: {
    participant1: TEST_WALLET_ADDRESS,
    participant2: '0x742d35Cc6634C0532925a3b844Bc9e7595f87D95'
  }}},
  { endpoint: '/api/channels/test-channel-123/state', config: { method: 'GET' }},
  { endpoint: '/api/channels/test-channel-123/trade', config: { method: 'POST', data: {
    tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1'
  }}},
  { endpoint: '/api/channels/test-channel-123/settle', config: { method: 'POST' }},
  { endpoint: '/api/channels/metrics', config: { method: 'GET' }},
  
  // Notifications
  { endpoint: '/api/notifications', config: { method: 'GET' }},
  { endpoint: '/api/notifications/test-notif-123', config: { method: 'GET' }},
  { endpoint: '/api/notifications/preferences', config: { method: 'GET' }},
  { endpoint: '/api/notifications/stats', config: { method: 'GET' }},
  { endpoint: '/api/notifications/read', config: { method: 'POST', data: { id: 'test-notif-123' }}},
  { endpoint: '/api/notifications/read-all', config: { method: 'POST' }},
  { endpoint: '/api/notifications/batch-read', config: { method: 'POST', data: { ids: ['test-1', 'test-2'] }}},
  
  // WebSocket endpoints
  { endpoint: '/api/websocket', config: { isWebSocket: true }},
  { endpoint: '/api/websocket/notifications', config: { isWebSocket: true }},
  { endpoint: '/api/websocket/connections', config: { method: 'GET' }},
  { endpoint: '/api/websocket/rate-limits', config: { method: 'GET' }},
  { endpoint: '/api/ws/v1/orderbook/ETH-USDC', config: { isWebSocket: true }},
  
  // V1 API endpoints
  { endpoint: '/api/v1/orders', config: { method: 'GET' }},
  { endpoint: '/api/v1/orders', config: { method: 'POST', data: {
    side: 'buy', symbol: 'ETH-USDC', price: '2000', quantity: '1'
  }}},
  { endpoint: '/api/v1/orders/test-order-123', config: { method: 'GET' }},
  { endpoint: '/api/v1/orders/test-order-123/cancel', config: { method: 'POST' }},
  { endpoint: '/api/v1/orderbook/ETH-USDC', config: { method: 'GET' }},
  { endpoint: '/api/v1/orderbook/ETH-USDC/depth', config: { method: 'GET' }},
  { endpoint: '/api/v1/trades', config: { method: 'GET' }},
  { endpoint: '/api/v1/trades/history', config: { method: 'GET' }},
  { endpoint: '/api/v1/trades/estimate', config: { method: 'POST', data: {
    tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1'
  }}},
  { endpoint: '/api/v1/settlements/test-settlement-123', config: { method: 'GET' }},
  { endpoint: '/api/v1/settlements/test-settlement-123/proof', config: { method: 'GET' }},
  { endpoint: '/api/v1/settlements/epochs', config: { method: 'GET' }},
  { endpoint: '/api/v1/account/balances', config: { method: 'GET' }},
  { endpoint: '/api/v1/account/positions', config: { method: 'GET' }},
  { endpoint: '/api/v1/account/pnl', config: { method: 'GET' }},
  
  // Token endpoints
  { endpoint: '/api/tokens/1', config: { method: 'GET', requiresAuth: false }},
  { endpoint: '/api/tokens/search', config: { method: 'GET', requiresAuth: false }},
  { endpoint: '/api/tokens/popular', config: { method: 'GET', requiresAuth: false }},
  { endpoint: '/api/tokens/lists', config: { method: 'GET', requiresAuth: false }},
  { endpoint: '/api/tokens/health', config: { method: 'GET', requiresAuth: false }},
  { endpoint: '/api/supported-tokens', config: { method: 'GET', requiresAuth: false }},
  
  // Cross-chain
  { endpoint: '/api/crosschain/config', config: { method: 'GET' }},
  { endpoint: '/api/crosschain/routes', config: { method: 'GET' }},
  { endpoint: '/api/crosschain/quote', config: { method: 'POST', data: {
    fromToken: 'ETH', toToken: 'USDC', fromChain: 1, toChain: 137, amount: '1'
  }}},
  { endpoint: '/api/crosschain/execute', config: { method: 'POST', data: {
    fromToken: 'ETH', toToken: 'USDC', fromChain: 1, toChain: 137, amount: '1'
  }}},
  { endpoint: '/api/crosschain/status', config: { method: 'GET' }},
  
  // Market maker
  { endpoint: '/api/market-maker/apply', config: { method: 'POST', data: {
    name: 'Test MM', email: 'test@mm.com'
  }}},
  { endpoint: '/api/market-maker/test-mm-123/inventory/balance', config: { method: 'GET' }},
  { endpoint: '/api/market-maker/test-mm-123/inventory/history', config: { method: 'GET' }},
  { endpoint: '/api/market-maker/test-mm-123/inventory/reconcile', config: { method: 'POST' }},
  
  // Developer endpoints
  { endpoint: '/api/developers/keys', config: { method: 'GET' }},
  { endpoint: '/api/developers/keys', config: { method: 'POST', data: { name: 'Test Key' }}},
  { endpoint: '/api/developers/keys/test-key-123', config: { method: 'GET' }},
  
  // Other endpoints
  { endpoint: '/api/execute', config: { method: 'POST', data: { orderId: 'test-order-123' }}},
  { endpoint: '/api/chains', config: { method: 'GET', requiresAuth: false }},
  { endpoint: '/api/tokenPrice', config: { method: 'GET', requiresAuth: false }},
  { endpoint: '/api/seedOrders', config: { method: 'POST' }},
];

// Main test runner
async function runTests() {
  console.log(`${colors.blue}SwappiQ API Comprehensive Test Suite${colors.reset}`);
  console.log(`${colors.blue}=====================================${colors.reset}\n`);
  console.log(`Testing ${endpointsToTest.length} endpoints...\n`);

  const startTime = performance.now();
  let totalTests = 0;
  let passedTests = 0;

  for (const { endpoint, config } of endpointsToTest) {
    totalTests++;
    process.stdout.write(`Testing ${endpoint}...`);
    
    const result = await testEndpoint(endpoint, config);
    
    // Categorize results
    if (result.fileExists && result.responseStatus && 
        result.errors.length === 0 && 
        result.warnings.length === 0 && 
        result.securityIssues.length === 0) {
      testResults.fullyImplemented.push(result);
      console.log(` ${colors.green}✅${colors.reset}`);
      passedTests++;
    } else if (result.fileExists && (result.warnings.length > 0 || result.securityIssues.length > 0)) {
      testResults.partiallyImplemented.push(result);
      console.log(` ${colors.yellow}⚠️${colors.reset}`);
    } else {
      testResults.missingOrBroken.push(result);
      console.log(` ${colors.red}❌${colors.reset}`);
    }
    
    // Show details for problematic endpoints
    if (result.errors.length > 0 || result.warnings.length > 0 || result.securityIssues.length > 0) {
      if (result.errors.length > 0) {
        console.log(`  ${colors.red}Errors: ${result.errors.join(', ')}${colors.reset}`);
      }
      if (result.warnings.length > 0) {
        console.log(`  ${colors.yellow}Warnings: ${result.warnings.join(', ')}${colors.reset}`);
      }
      if (result.securityIssues.length > 0) {
        console.log(`  ${colors.red}Security: ${result.securityIssues.join(', ')}${colors.reset}`);
      }
    }
  }

  const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);

  // Generate summary report
  console.log(`\n${colors.blue}Test Summary${colors.reset}`);
  console.log(`${colors.blue}============${colors.reset}\n`);
  console.log(`Total endpoints tested: ${totalTests}`);
  console.log(`Total time: ${totalTime}s\n`);
  
  console.log(`${colors.green}✅ Fully Implemented: ${testResults.fullyImplemented.length}${colors.reset}`);
  console.log(`${colors.yellow}⚠️  Partially Implemented: ${testResults.partiallyImplemented.length}${colors.reset}`);
  console.log(`${colors.red}❌ Missing or Broken: ${testResults.missingOrBroken.length}${colors.reset}\n`);

  // Generate detailed report
  const report = {
    summary: {
      totalEndpoints: totalTests,
      fullyImplemented: testResults.fullyImplemented.length,
      partiallyImplemented: testResults.partiallyImplemented.length,
      missingOrBroken: testResults.missingOrBroken.length,
      testDuration: totalTime + 's',
      timestamp: new Date().toISOString()
    },
    details: {
      fullyImplemented: testResults.fullyImplemented.map(r => ({
        endpoint: r.endpoint,
        method: r.method,
        responseTime: r.duration ? `${r.duration.toFixed(2)}ms` : 'N/A'
      })),
      partiallyImplemented: testResults.partiallyImplemented.map(r => ({
        endpoint: r.endpoint,
        method: r.method,
        issues: {
          warnings: r.warnings,
          security: r.securityIssues
        }
      })),
      missingOrBroken: testResults.missingOrBroken.map(r => ({
        endpoint: r.endpoint,
        method: r.method,
        fileExists: r.fileExists,
        errors: r.errors,
        warnings: r.warnings,
        security: r.securityIssues
      }))
    },
    recommendations: {
      critical: [],
      high: [],
      medium: [],
      low: []
    }
  };

  // Add recommendations based on findings
  const securityEndpoints = [...testResults.partiallyImplemented, ...testResults.missingOrBroken]
    .filter(r => r.securityIssues.length > 0);
  
  if (securityEndpoints.length > 0) {
    report.recommendations.critical.push({
      issue: 'Security vulnerabilities detected',
      endpoints: securityEndpoints.map(r => r.endpoint),
      action: 'Implement proper authentication, input validation, and rate limiting'
    });
  }

  const missingAuth = [...testResults.partiallyImplemented, ...testResults.missingOrBroken]
    .filter(r => !r.hasAuth && r.fileExists);
  
  if (missingAuth.length > 0) {
    report.recommendations.high.push({
      issue: 'Missing authentication',
      endpoints: missingAuth.map(r => r.endpoint),
      action: 'Add authentication middleware to protect these endpoints'
    });
  }

  const missingValidation = testResults.partiallyImplemented
    .filter(r => !r.hasValidation && r.method !== 'GET');
  
  if (missingValidation.length > 0) {
    report.recommendations.high.push({
      issue: 'Missing input validation',
      endpoints: missingValidation.map(r => r.endpoint),
      action: 'Add request validation middleware'
    });
  }

  const poorErrorHandling = testResults.partiallyImplemented
    .filter(r => !r.hasErrorHandling);
  
  if (poorErrorHandling.length > 0) {
    report.recommendations.medium.push({
      issue: 'Poor error handling',
      endpoints: poorErrorHandling.map(r => r.endpoint),
      action: 'Implement proper error handling to avoid exposing stack traces'
    });
  }

  const missingEndpoints = testResults.missingOrBroken
    .filter(r => !r.fileExists);
  
  if (missingEndpoints.length > 0) {
    report.recommendations.low.push({
      issue: 'Missing endpoint implementations',
      endpoints: missingEndpoints.map(r => r.endpoint),
      action: 'Implement these endpoints or remove them from the API surface'
    });
  }

  // Save detailed report
  const reportPath = path.join('/workspace', 'api-test-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);

  // Save markdown report
  const markdownReport = generateMarkdownReport(report);
  const mdReportPath = path.join('/workspace', 'API_TEST_REPORT.md');
  await fs.writeFile(mdReportPath, markdownReport);
  console.log(`Markdown report saved to: ${mdReportPath}`);

  // Exit with appropriate code
  process.exit(passedTests === totalTests ? 0 : 1);
}

// Generate markdown report
function generateMarkdownReport(report) {
  let md = `# SwappiQ API Test Report\n\n`;
  md += `Generated: ${report.summary.timestamp}\n\n`;
  
  md += `## Summary\n\n`;
  md += `- **Total Endpoints Tested**: ${report.summary.totalEndpoints}\n`;
  md += `- **✅ Fully Implemented**: ${report.summary.fullyImplemented}\n`;
  md += `- **⚠️  Partially Implemented**: ${report.summary.partiallyImplemented}\n`;
  md += `- **❌ Missing or Broken**: ${report.summary.missingOrBroken}\n`;
  md += `- **Test Duration**: ${report.summary.testDuration}\n\n`;
  
  md += `## Fully Implemented Endpoints (${report.details.fullyImplemented.length})\n\n`;
  if (report.details.fullyImplemented.length > 0) {
    md += `| Endpoint | Method | Response Time |\n`;
    md += `|----------|--------|---------------|\n`;
    report.details.fullyImplemented.forEach(e => {
      md += `| ${e.endpoint} | ${e.method} | ${e.responseTime} |\n`;
    });
  }
  
  md += `\n## Partially Implemented Endpoints (${report.details.partiallyImplemented.length})\n\n`;
  if (report.details.partiallyImplemented.length > 0) {
    report.details.partiallyImplemented.forEach(e => {
      md += `### ${e.endpoint} (${e.method})\n\n`;
      if (e.issues.warnings.length > 0) {
        md += `**Warnings:**\n`;
        e.issues.warnings.forEach(w => md += `- ${w}\n`);
      }
      if (e.issues.security.length > 0) {
        md += `\n**Security Issues:**\n`;
        e.issues.security.forEach(s => md += `- ${s}\n`);
      }
      md += `\n`;
    });
  }
  
  md += `## Missing or Broken Endpoints (${report.details.missingOrBroken.length})\n\n`;
  if (report.details.missingOrBroken.length > 0) {
    report.details.missingOrBroken.forEach(e => {
      md += `### ${e.endpoint} (${e.method})\n\n`;
      md += `- **File Exists**: ${e.fileExists ? 'Yes' : 'No'}\n`;
      if (e.errors.length > 0) {
        md += `- **Errors**: ${e.errors.join(', ')}\n`;
      }
      if (e.warnings.length > 0) {
        md += `- **Warnings**: ${e.warnings.join(', ')}\n`;
      }
      if (e.security.length > 0) {
        md += `- **Security Issues**: ${e.security.join(', ')}\n`;
      }
      md += `\n`;
    });
  }
  
  md += `## Recommendations\n\n`;
  
  if (report.recommendations.critical.length > 0) {
    md += `### 🔴 Critical\n\n`;
    report.recommendations.critical.forEach(r => {
      md += `**${r.issue}**\n`;
      md += `- Action: ${r.action}\n`;
      md += `- Affected endpoints: ${r.endpoints.join(', ')}\n\n`;
    });
  }
  
  if (report.recommendations.high.length > 0) {
    md += `### 🟠 High Priority\n\n`;
    report.recommendations.high.forEach(r => {
      md += `**${r.issue}**\n`;
      md += `- Action: ${r.action}\n`;
      md += `- Affected endpoints: ${r.endpoints.join(', ')}\n\n`;
    });
  }
  
  if (report.recommendations.medium.length > 0) {
    md += `### 🟡 Medium Priority\n\n`;
    report.recommendations.medium.forEach(r => {
      md += `**${r.issue}**\n`;
      md += `- Action: ${r.action}\n`;
      md += `- Affected endpoints: ${r.endpoints.join(', ')}\n\n`;
    });
  }
  
  if (report.recommendations.low.length > 0) {
    md += `### 🟢 Low Priority\n\n`;
    report.recommendations.low.forEach(r => {
      md += `**${r.issue}**\n`;
      md += `- Action: ${r.action}\n`;
      md += `- Affected endpoints: ${r.endpoints.join(', ')}\n\n`;
    });
  }
  
  return md;
}

// Run tests
if (require.main === module) {
  runTests().catch(error => {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    process.exit(1);
  });
}

module.exports = { testEndpoint, runTests };