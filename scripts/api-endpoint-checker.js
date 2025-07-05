#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

// Color codes
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Core API endpoints that should exist
const coreEndpoints = {
  'Health & Monitoring': [
    '/api/health',
    '/api/health/detailed',
    '/api/health-check'
  ],
  'Order Management': [
    '/api/submitOrder',
    '/api/cancelOrder',
    '/api/orders/history',
    '/api/orders/[orderId]',
    '/api/orderStatus/[orderId]',
    '/api/validate-order'
  ],
  'Trading & Order Book': [
    '/api/orderbook/[pair]',
    '/api/trades/[pair]',
    '/api/quote',
    '/api/trading/quote'
  ],
  'Settlement': [
    '/api/settlement/status',
    '/api/settlement/epochs',
    '/api/settlement/proof/[tradeId]',
    '/api/settlement/proof/verify'
  ],
  'State Channels': [
    '/api/channels/create',
    '/api/channels/[channelId]/state',
    '/api/channels/[channelId]/trade',
    '/api/channels/[channelId]/settle'
  ],
  'Notifications': [
    '/api/notifications',
    '/api/notifications/[id]',
    '/api/notifications/preferences',
    '/api/notifications/read'
  ],
  'WebSocket': [
    '/api/websocket',
    '/api/websocket/notifications',
    '/api/ws/v1/orderbook/[pair]'
  ],
  'V1 API': [
    '/api/v1/orders',
    '/api/v1/orders/[id]',
    '/api/v1/orderbook/[pair]',
    '/api/v1/trades',
    '/api/v1/account/balances'
  ],
  'Tokens': [
    '/api/tokens/[chainId]',
    '/api/tokens/search',
    '/api/tokens/popular',
    '/api/supported-tokens'
  ],
  'Cross-chain': [
    '/api/crosschain/config',
    '/api/crosschain/quote',
    '/api/crosschain/execute',
    '/api/crosschain/status'
  ]
};

// Check if endpoint file exists
async function checkEndpoint(endpoint) {
  const basePath = path.join('/workspace/pages', endpoint);
  const possibleFiles = [
    `${basePath}.js`,
    `${basePath}.ts`,
    `${basePath}/index.js`,
    `${basePath}/index.ts`
  ];
  
  for (const file of possibleFiles) {
    try {
      await fs.access(file);
      return { exists: true, file };
    } catch (e) {
      // Continue checking
    }
  }
  
  return { exists: false };
}

// Quick security check
async function quickSecurityCheck(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const checks = {
      hasAuth: /x-api-key|authorization|authenticate|requireAuth/i.test(content),
      hasValidation: /validate|schema\.|joi\.|yup\.|zod\.|check\(/i.test(content),
      hasErrorHandling: /try\s*{|catch\s*\(|\.catch\(/i.test(content),
      hasRateLimit: /rateLimit|rate-limit|throttle/i.test(content)
    };
    return checks;
  } catch (error) {
    return {
      hasAuth: false,
      hasValidation: false,
      hasErrorHandling: false,
      hasRateLimit: false
    };
  }
}

// Main function
async function checkEndpoints() {
  console.log(`${colors.blue}SwappiQ API Endpoint Status Check${colors.reset}`);
  console.log(`${colors.blue}=================================${colors.reset}\n`);
  
  const results = {
    total: 0,
    existing: 0,
    missing: 0,
    secure: 0,
    insecure: 0
  };
  
  const missingEndpoints = [];
  const insecureEndpoints = [];
  
  for (const [category, endpoints] of Object.entries(coreEndpoints)) {
    console.log(`\n${colors.blue}${category}${colors.reset}`);
    console.log('-'.repeat(category.length));
    
    for (const endpoint of endpoints) {
      results.total++;
      process.stdout.write(`${endpoint.padEnd(40)}`);
      
      const check = await checkEndpoint(endpoint);
      
      if (check.exists) {
        results.existing++;
        const security = await quickSecurityCheck(check.file);
        
        if (security.hasAuth && security.hasErrorHandling) {
          results.secure++;
          console.log(`${colors.green}✅ Exists (Secure)${colors.reset}`);
        } else {
          results.insecure++;
          insecureEndpoints.push({ endpoint, issues: security });
          console.log(`${colors.yellow}⚠️  Exists (Needs security)${colors.reset}`);
        }
      } else {
        results.missing++;
        missingEndpoints.push(endpoint);
        console.log(`${colors.red}❌ Missing${colors.reset}`);
      }
    }
  }
  
  // Summary
  console.log(`\n${colors.blue}Summary${colors.reset}`);
  console.log(`${colors.blue}=======${colors.reset}`);
  console.log(`Total endpoints checked: ${results.total}`);
  console.log(`${colors.green}Existing & Secure: ${results.secure}${colors.reset}`);
  console.log(`${colors.yellow}Existing but Insecure: ${results.insecure}${colors.reset}`);
  console.log(`${colors.red}Missing: ${results.missing}${colors.reset}`);
  
  if (missingEndpoints.length > 0) {
    console.log(`\n${colors.red}Missing Endpoints:${colors.reset}`);
    missingEndpoints.forEach(ep => console.log(`  - ${ep}`));
  }
  
  if (insecureEndpoints.length > 0) {
    console.log(`\n${colors.yellow}Endpoints Needing Security Improvements:${colors.reset}`);
    insecureEndpoints.forEach(({ endpoint, issues }) => {
      console.log(`  - ${endpoint}`);
      if (!issues.hasAuth) console.log(`    ${colors.red}• Missing authentication${colors.reset}`);
      if (!issues.hasValidation) console.log(`    ${colors.yellow}• Missing validation${colors.reset}`);
      if (!issues.hasErrorHandling) console.log(`    ${colors.yellow}• Missing error handling${colors.reset}`);
      if (!issues.hasRateLimit) console.log(`    ${colors.yellow}• Missing rate limiting${colors.reset}`);
    });
  }
  
  // Save quick report
  const quickReport = {
    timestamp: new Date().toISOString(),
    summary: results,
    missing: missingEndpoints,
    insecure: insecureEndpoints
  };
  
  await fs.writeFile(
    '/workspace/api-quick-check-report.json',
    JSON.stringify(quickReport, null, 2)
  );
  
  console.log(`\n${colors.green}Quick report saved to: /workspace/api-quick-check-report.json${colors.reset}`);
}

// Run check
if (require.main === module) {
  checkEndpoints().catch(error => {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    process.exit(1);
  });
}