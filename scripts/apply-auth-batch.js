#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

// Endpoints that need authentication (from security audit)
const ENDPOINTS_TO_SECURE = {
  authenticated: [
    // Order management
    'pages/api/submitOrder.js',
    'pages/api/submitOrderHybrid.js',
    'pages/api/submitOrderV2.ts',
    'pages/api/cancelOrder.js',
    'pages/api/execute.js',
    'pages/api/orders/history.js',
    'pages/api/orders/[orderId].ts',
    'pages/api/orders/status/[orderId].js',
    'pages/api/orders/user/[userId].js',
    'pages/api/orderStatus/[orderId].ts',
    
    // Notifications
    'pages/api/notifications/index.ts',
    'pages/api/notifications/[id].ts',
    'pages/api/notifications/read.ts',
    'pages/api/notifications/preferences.ts',
    
    // Account & Analytics
    'pages/api/analytics/profits.ts',
    'pages/api/v1/account/balances.js',
    'pages/api/v1/account/positions.js',
    'pages/api/v1/account/pnl.js',
    
    // Trading
    'pages/api/trading/quote.ts',
    'pages/api/rfq/create.ts',
    'pages/api/rfq/[rfqId]/accept.ts',
    'pages/api/rfq/[rfqId]/execute.ts',
    
    // Cross-chain
    'pages/api/crosschain/execute.ts',
    'pages/api/crosschain/status.ts',
    
    // Disputes
    'pages/api/disputes/index.ts',
    'pages/api/markEscrowDeposit.ts',
    'pages/api/releaseFund.ts',
    'pages/api/signRelease.ts'
  ],
  
  admin: [
    // Admin operations
    'pages/api/seedOrders.js',
    'pages/api/settlement/proof/claim.js',
    'pages/api/settlement/proof/verify.js',
    'pages/api/disputes/settle.ts',
    'pages/api/disputes/return.ts',
    
    // Market maker admin
    'pages/api/market-maker/apply.ts',
    'pages/api/market-maker/[marketMakerId]/update-pairs.ts',
    'pages/api/market-maker/[marketMakerId]/onboarding/status.ts',
    
    // Test endpoints
    'pages/api/test/simulateExternalLiquidity.js'
  ]
};

// Check if file already has authentication
async function hasAuthentication(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return /requireAuth|withAuth|authenticatedEndpoint|adminEndpoint/.test(content);
  } catch (error) {
    return false;
  }
}

// Add authentication to a file
async function addAuthentication(filePath, authLevel = 'authenticated') {
  const fullPath = path.join(process.cwd(), filePath);
  
  // Check if file exists
  try {
    await fs.access(fullPath);
  } catch {
    console.log(chalk.yellow(`   ⚠️  File not found: ${filePath}`));
    return false;
  }
  
  // Check if already has auth
  if (await hasAuthentication(fullPath)) {
    console.log(chalk.blue(`   ℹ️  Already secured: ${filePath}`));
    return false;
  }
  
  let content = await fs.readFile(fullPath, 'utf8');
  const isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  
  // Determine the auth wrapper to use
  const authWrapper = authLevel === 'admin' ? 'adminEndpoint' : 'authenticatedEndpoint';
  
  // Add import statement
  const importPath = '@/src/middleware/authWrapper';
  const importStatement = isTypeScript
    ? `import { ${authWrapper} } from '${importPath}';\n`
    : `const { ${authWrapper} } = require('${importPath}');\n`;
  
  // Check if file already has the import
  if (!content.includes(importPath)) {
    // Add import at the beginning of the file
    if (content.startsWith('import ') || content.startsWith('const ')) {
      // Find the last import/require statement
      const lines = content.split('\n');
      let lastImportIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('import ') || lines[i].includes('require(')) {
          lastImportIndex = i;
        }
      }
      lines.splice(lastImportIndex + 1, 0, importStatement);
      content = lines.join('\n');
    } else {
      content = importStatement + '\n' + content;
    }
  }
  
  // Wrap the default export
  // Handle different export patterns
  const exportPatterns = [
    // export default function handler
    {
      pattern: /export\s+default\s+function\s+(\w+)/,
      replacement: `export default ${authWrapper}(function $1`
    },
    // export default async function handler
    {
      pattern: /export\s+default\s+async\s+function\s+(\w+)/,
      replacement: `export default ${authWrapper}(async function $1`
    },
    // export default handler
    {
      pattern: /export\s+default\s+(\w+)(?=\s*;|\s*$)/,
      replacement: `export default ${authWrapper}($1)`
    },
    // export default (req, res) => 
    {
      pattern: /export\s+default\s+(\(|async\s*\()/,
      replacement: `export default ${authWrapper}($1`
    },
    // module.exports = handler
    {
      pattern: /module\.exports\s*=\s*(\w+)(?=\s*;|\s*$)/,
      replacement: `module.exports = ${authWrapper}($1)`
    },
    // module.exports = function
    {
      pattern: /module\.exports\s*=\s*function/,
      replacement: `module.exports = ${authWrapper}(function`
    },
    // module.exports = async function
    {
      pattern: /module\.exports\s*=\s*async\s*function/,
      replacement: `module.exports = ${authWrapper}(async function`
    }
  ];
  
  let modified = false;
  for (const { pattern, replacement } of exportPatterns) {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      
      // Add closing parenthesis for function expressions
      if (replacement.includes('(function') || replacement.includes('(async function')) {
        // Find the end of the function and add closing parenthesis
        const functionMatch = content.match(/export\s+default\s+\w+\((async\s+)?function[^{]+{/);
        if (functionMatch) {
          // Count braces to find the end of the function
          let braceCount = 0;
          let inString = false;
          let stringChar = '';
          let i = content.indexOf(functionMatch[0]) + functionMatch[0].length;
          
          for (; i < content.length; i++) {
            const char = content[i];
            
            if (inString) {
              if (char === stringChar && content[i - 1] !== '\\') {
                inString = false;
              }
            } else {
              if (char === '"' || char === "'" || char === '`') {
                inString = true;
                stringChar = char;
              } else if (char === '{') {
                braceCount++;
              } else if (char === '}') {
                if (braceCount === 0) {
                  // Found the closing brace
                  content = content.slice(0, i + 1) + ')' + content.slice(i + 1);
                  break;
                }
                braceCount--;
              }
            }
          }
        }
      }
      
      modified = true;
      break;
    }
  }
  
  if (!modified) {
    console.log(chalk.yellow(`   ⚠️  Could not find export pattern: ${filePath}`));
    return false;
  }
  
  // Write the modified content
  await fs.writeFile(fullPath, content);
  console.log(chalk.green(`   ✅ Secured: ${filePath}`));
  return true;
}

// Main function
async function applyAuthBatch() {
  console.log(chalk.bold.blue('\n🔐 Batch Authentication Application\n'));
  console.log('=' .repeat(80));
  
  let totalSecured = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  
  // Process authenticated endpoints
  console.log(chalk.bold('\n📋 Securing Authenticated Endpoints:\n'));
  for (const endpoint of ENDPOINTS_TO_SECURE.authenticated) {
    try {
      if (await addAuthentication(endpoint, 'authenticated')) {
        totalSecured++;
      } else {
        totalSkipped++;
      }
    } catch (error) {
      console.log(chalk.red(`   ❌ Error: ${endpoint} - ${error.message}`));
      totalErrors++;
    }
  }
  
  // Process admin endpoints
  console.log(chalk.bold('\n👑 Securing Admin Endpoints:\n'));
  for (const endpoint of ENDPOINTS_TO_SECURE.admin) {
    try {
      if (await addAuthentication(endpoint, 'admin')) {
        totalSecured++;
      } else {
        totalSkipped++;
      }
    } catch (error) {
      console.log(chalk.red(`   ❌ Error: ${endpoint} - ${error.message}`));
      totalErrors++;
    }
  }
  
  // Summary
  console.log('\n' + '=' .repeat(80));
  console.log(chalk.bold('📊 Summary:\n'));
  console.log(`   Total Endpoints: ${ENDPOINTS_TO_SECURE.authenticated.length + ENDPOINTS_TO_SECURE.admin.length}`);
  console.log(`   ${chalk.green('Secured:')} ${totalSecured}`);
  console.log(`   ${chalk.blue('Skipped:')} ${totalSkipped}`);
  console.log(`   ${chalk.red('Errors:')} ${totalErrors}`);
  
  if (totalSecured > 0) {
    console.log(chalk.green(`\n✅ Successfully secured ${totalSecured} endpoints!`));
    console.log('\nNext steps:');
    console.log('1. Run tests: node scripts/test-authentication.js');
    console.log('2. Run security audit: node scripts/api-security-audit.js');
    console.log('3. Review and test the modified endpoints');
  }
}

// Run the script
applyAuthBatch().catch(console.error);