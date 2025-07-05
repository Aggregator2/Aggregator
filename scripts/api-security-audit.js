#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

// Endpoint security categorization
const ENDPOINT_CATEGORIES = {
  // Public endpoints - no authentication required
  public: [
    // Health & monitoring
    'health', 'health/index', 'health/detailed', 'health-check',
    
    // Market data & quotes
    'quote', 'quote/hybrid', 'quote-profitable', 'unified-quote', 
    'unified-quote-simple', 'unified-swap-quote', 'tokenPrice',
    
    // Token information
    'tokens/*', 'supported-tokens', 'chains',
    
    // Public orderbook & trade data
    'orderbook/*', 'trades/*', 'v1/orderbook/*',
    
    // Documentation & tools
    'collections/*', 'openapi.yaml',
    
    // Cross-chain config
    'crosschain/config', 'crosschain/check-token',
    
    // Public competition data
    'competition/leaderboard',
    
    // WebSocket endpoints (auth handled separately)
    'websocket', 'ws/*'
  ],
  
  // Authenticated endpoints - require valid JWT
  authenticated: [
    // Order management
    'submitOrder', 'submitOrderHybrid', 'submitOrder-validated', 'submitOrderV2',
    'cancelOrder', 'execute', 'validate-order',
    'orders/history', 'orders/user/*', 'orders/status/*', 'orderStatus/*',
    'orders/stream', 'orders/*',
    
    // Account management
    'account/*', 'v1/account/*',
    
    // Notifications
    'notifications/*',
    
    // Market maker operations
    'market-maker/*/inventory/*', 'market-maker/*/trading/*',
    
    // User settlements
    'settlement/user/*', 'settlement/proof/user/*',
    'orders/settlement-proof/*',
    
    // Analytics
    'analytics/*',
    
    // Trading operations
    'trading/*', 'rfq/*', 'v1/trades/*', 'v1/orders/*',
    
    // User-specific operations
    'disputes', 'disputes/index',
    'markEscrowDeposit', 'releaseFund', 'signRelease',
    
    // Cross-chain operations
    'crosschain/quote', 'crosschain/execute', 'crosschain/status',
    
    // Revenue tracking
    'revenue/*',
    
    // State channels
    'channels/*'
  ],
  
  // Admin endpoints - require admin role
  admin: [
    // Market maker admin
    'market-maker/apply', 'market-maker/*/onboarding/*',
    'market-maker/*/update-pairs',
    
    // Settlement admin
    'settlement/proof/claim', 'settlement/proof/verify',
    'settlement/epochs', 'settlement/webhooks',
    
    // Dispute resolution
    'disputes/settle', 'disputes/return',
    
    // System operations
    'seedOrders', 'test/*',
    
    // Developer tools
    'developers/*',
    
    // External liquidity
    'orders/external/*'
  ]
};

// Helper function to check if path matches pattern
function matchesPattern(filePath, pattern) {
  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/\*/g, '.*')
    .replace(/\//g, '\\/')
    .replace(/\[([^\]]+)\]/g, '[^/]+'); // Handle Next.js dynamic routes
  
  const regex = new RegExp(`^${regexPattern}(\\.(?:js|ts|jsx|tsx))?$`);
  return regex.test(filePath);
}

// Categorize endpoint
function categorizeEndpoint(endpoint) {
  // Remove /pages/api/ prefix and file extension
  const cleanPath = endpoint
    .replace(/^\/pages\/api\//, '')
    .replace(/\.(js|ts|jsx|tsx)$/, '');
  
  // Check each category
  for (const [category, patterns] of Object.entries(ENDPOINT_CATEGORIES)) {
    for (const pattern of patterns) {
      if (matchesPattern(cleanPath, pattern)) {
        return category;
      }
    }
  }
  
  // Default to authenticated for uncategorized endpoints
  return 'authenticated';
}

// Check if file has authentication
async function checkAuthentication(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    
    const checks = {
      hasRequireAuth: /requireAuth|withApiKey/.test(content),
      hasAuthHeader: /authorization/i.test(content),
      hasJWTVerify: /jwt\.verify/.test(content),
      hasManualAuth: /req\.headers\['?authorization'?\]/.test(content),
      exportsDefault: /export\s+default/.test(content)
    };
    
    return {
      hasAuth: checks.hasRequireAuth || checks.hasJWTVerify,
      ...checks
    };
  } catch (error) {
    return {
      hasAuth: false,
      error: error.message
    };
  }
}

// Recursively get all API files
async function getAllApiFiles(dir, fileList = []) {
  const files = await fs.readdir(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);
    
    if (stat.isDirectory()) {
      await getAllApiFiles(filePath, fileList);
    } else if (/\.(js|ts|jsx|tsx)$/.test(file) && !file.includes('.test.')) {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

// Generate security report
async function generateSecurityReport() {
  console.log('🔍 API Security Audit\n');
  console.log('=' .repeat(80));
  
  const apiDir = path.join(process.cwd(), 'pages', 'api');
  const allFiles = await getAllApiFiles(apiDir);
  
  console.log(`\nFound ${allFiles.length} API endpoint files\n`);
  
  const results = {
    public: { secured: [], unsecured: [] },
    authenticated: { secured: [], unsecured: [] },
    admin: { secured: [], unsecured: [] },
    uncategorized: []
  };
  
  // Analyze each file
  for (const file of allFiles) {
    const relativePath = file.replace(process.cwd(), '');
    const category = categorizeEndpoint(relativePath);
    const authCheck = await checkAuthentication(file);
    
    const endpoint = {
      path: relativePath,
      ...authCheck
    };
    
    if (category === 'public') {
      // Public endpoints shouldn't have auth
      if (authCheck.hasAuth) {
        results.public.secured.push(endpoint);
      } else {
        results.public.unsecured.push(endpoint);
      }
    } else if (results[category]) {
      // Authenticated/Admin endpoints should have auth
      if (authCheck.hasAuth) {
        results[category].secured.push(endpoint);
      } else {
        results[category].unsecured.push(endpoint);
      }
    } else {
      results.uncategorized.push(endpoint);
    }
  }
  
  // Print results
  console.log('📊 Security Audit Results:\n');
  
  // Public endpoints
  console.log(`✅ Public Endpoints (${results.public.unsecured.length} correctly unsecured):`);
  if (results.public.secured.length > 0) {
    console.log(`\n⚠️  ${results.public.secured.length} public endpoints have unnecessary auth:`);
    results.public.secured.forEach(e => console.log(`   - ${e.path}`));
  }
  
  // Authenticated endpoints
  console.log(`\n🔐 Authenticated Endpoints:`);
  console.log(`   ✅ Secured: ${results.authenticated.secured.length}`);
  console.log(`   ❌ Unsecured: ${results.authenticated.unsecured.length}`);
  
  if (results.authenticated.unsecured.length > 0) {
    console.log(`\n⚠️  SECURITY RISK: ${results.authenticated.unsecured.length} authenticated endpoints lack authentication:`);
    results.authenticated.unsecured.slice(0, 20).forEach(e => console.log(`   - ${e.path}`));
    if (results.authenticated.unsecured.length > 20) {
      console.log(`   ... and ${results.authenticated.unsecured.length - 20} more`);
    }
  }
  
  // Admin endpoints
  console.log(`\n👑 Admin Endpoints:`);
  console.log(`   ✅ Secured: ${results.admin.secured.length}`);
  console.log(`   ❌ Unsecured: ${results.admin.unsecured.length}`);
  
  if (results.admin.unsecured.length > 0) {
    console.log(`\n🚨 CRITICAL: ${results.admin.unsecured.length} admin endpoints lack authentication:`);
    results.admin.unsecured.forEach(e => console.log(`   - ${e.path}`));
  }
  
  // Summary
  console.log('\n' + '=' .repeat(80));
  console.log('📈 Summary:');
  const totalUnsecured = results.authenticated.unsecured.length + results.admin.unsecured.length;
  const totalEndpoints = allFiles.length;
  const securityScore = Math.round(((totalEndpoints - totalUnsecured) / totalEndpoints) * 100);
  
  console.log(`   Total Endpoints: ${totalEndpoints}`);
  console.log(`   Properly Secured: ${totalEndpoints - totalUnsecured}`);
  console.log(`   Missing Auth: ${totalUnsecured}`);
  console.log(`   Security Score: ${securityScore}%`);
  
  if (securityScore < 80) {
    console.log(`\n🚨 Security Score is below 80%! Immediate action required.`);
  }
  
  // Generate fix script
  if (totalUnsecured > 0) {
    console.log('\n📝 Generating authentication fix script...');
    await generateFixScript(results);
  }
  
  return results;
}

// Generate script to fix authentication
async function generateFixScript(results) {
  const fixes = [];
  
  // Add authenticated endpoints
  results.authenticated.unsecured.forEach(endpoint => {
    fixes.push({
      file: endpoint.path,
      category: 'authenticated'
    });
  });
  
  // Add admin endpoints
  results.admin.unsecured.forEach(endpoint => {
    fixes.push({
      file: endpoint.path,
      category: 'admin'
    });
  });
  
  const fixScript = `#!/usr/bin/env node
// Auto-generated script to add authentication to unsecured endpoints

const fs = require('fs').promises;
const path = require('path');

const ENDPOINTS_TO_FIX = ${JSON.stringify(fixes, null, 2)};

async function addAuthentication(endpoint) {
  const filePath = path.join(process.cwd(), endpoint.file);
  let content = await fs.readFile(filePath, 'utf8');
  
  // Check if already has export default
  if (!/export\\s+default/.test(content)) {
    console.log(\`⚠️  Skipping \${endpoint.file} - no default export found\`);
    return false;
  }
  
  // Add import if not present
  if (!/requireAuth/.test(content)) {
    const importStatement = "import { requireAuth } from '@/src/middleware/auth';\\n";
    content = importStatement + content;
  }
  
  // Wrap default export with requireAuth
  content = content.replace(
    /export\\s+default\\s+([^;]+);?/,
    \`export default requireAuth($1);\`
  );
  
  await fs.writeFile(filePath, content);
  console.log(\`✅ Added authentication to \${endpoint.file}\`);
  return true;
}

async function fixAll() {
  console.log('🔧 Adding authentication to unsecured endpoints...\\n');
  
  let fixed = 0;
  for (const endpoint of ENDPOINTS_TO_FIX) {
    if (await addAuthentication(endpoint)) {
      fixed++;
    }
  }
  
  console.log(\`\\n✅ Fixed \${fixed} out of \${ENDPOINTS_TO_FIX.length} endpoints\`);
}

fixAll().catch(console.error);
`;
  
  await fs.writeFile('scripts/fix-authentication.js', fixScript);
  console.log('   Created: scripts/fix-authentication.js');
  console.log('   Run: node scripts/fix-authentication.js');
}

// Main
generateSecurityReport().catch(console.error);