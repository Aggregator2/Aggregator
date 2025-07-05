#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Files that need auth applied
const filesToUpdate = [
  // Notification endpoints
  { file: 'notifications/[id].ts', isTS: true },
  { file: 'notifications/read.ts', isTS: true },
  { file: 'notifications/read-all.ts', isTS: true },
  { file: 'notifications/batch-read.ts', isTS: true },
  { file: 'notifications/preferences.ts', isTS: true },
  { file: 'notifications/stats.ts', isTS: true },
  { file: 'notifications/webhook-test.ts', isTS: true },
  
  // Order endpoints
  { file: 'orders/[orderId].ts', isTS: true },
  { file: 'orders/status/[orderId].js', isTS: false },
  { file: 'orders/external/[orderId].js', isTS: false },
  { file: 'orders/external/pending.js', isTS: false },
  { file: 'orders/user/[userId].js', isTS: false },
  { file: 'orders/stream.js', isTS: false },
  { file: 'orders/settlement-proof/[orderId].js', isTS: false },
  { file: 'orderStatus/[orderId].ts', isTS: true },
  
  // Settlement endpoints
  { file: 'settlement/epochs.ts', isTS: true },
  { file: 'settlement/status.ts', isTS: true },
  { file: 'settlement/proof/[tradeId].js', isTS: false },
  { file: 'settlement/proof/claim.js', isTS: false },
  { file: 'settlement/proof/user/[userId].js', isTS: false },
  { file: 'settlement/proof/verify.js', isTS: false },
  { file: 'settlement/user/[userId]/settlements.ts', isTS: true },
  { file: 'settlement/webhooks.ts', isTS: true },
  
  // Trading endpoints
  { file: 'orderbook/[pair].js', isTS: false },
  { file: 'trades/[pair].js', isTS: false },
  { file: 'trading/quote.ts', isTS: true },
  { file: 'seedOrders.js', isTS: false },
  
  // Misc sensitive endpoints
  { file: 'markEscrowDeposit.ts', isTS: true },
  { file: 'releaseFund.ts', isTS: true },
  { file: 'signRelease.ts', isTS: true },
  { file: 'validate-order.ts', isTS: true },
  { file: 'submitOrder-validated.ts', isTS: true },
  { file: 'submitOrderV2.ts', isTS: true }
];

const apiDir = path.join(__dirname, '..', 'pages', 'api');

console.log(`Processing ${filesToUpdate.length} files...`);

let processed = 0;
let failed = 0;

for (const { file, isTS } of filesToUpdate) {
  const filePath = path.join(apiDir, file);
  
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File not found: ${file}`);
      continue;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if already has requireAuth
    if (content.includes('requireAuth')) {
      console.log(`✓ Already has auth: ${file}`);
      processed++;
      continue;
    }
    
    // Add import
    const importStatement = isTS 
      ? "import { requireAuth } from '../"
      : "const { requireAuth } = require('../";
    
    const importPath = file.split('/').map(() => '..').join('/') + '/src/middleware/auth';
    const fullImport = isTS 
      ? `import { requireAuth } from '${importPath}';\n`
      : `const { requireAuth } = require('${importPath}');\n`;
    
    // Add import after other imports
    if (isTS) {
      const lastImportMatch = content.match(/import[^;]+from[^;]+;/g);
      if (lastImportMatch) {
        const lastImport = lastImportMatch[lastImportMatch.length - 1];
        const insertPos = content.indexOf(lastImport) + lastImport.length;
        content = content.slice(0, insertPos) + '\n' + fullImport + content.slice(insertPos);
      } else {
        content = fullImport + content;
      }
    } else {
      const requireMatch = content.match(/(?:const|var|let).*require\([^)]+\);?/g);
      if (requireMatch) {
        const lastRequire = requireMatch[requireMatch.length - 1];
        const insertPos = content.indexOf(lastRequire) + lastRequire.length;
        content = content.slice(0, insertPos) + '\n' + fullImport + content.slice(insertPos);
      } else {
        content = fullImport + '\n' + content;
      }
    }
    
    // Wrap export default
    if (isTS) {
      content = content.replace(
        /export\s+default\s+async\s+function\s+handler/,
        'export default requireAuth(async function handler'
      );
      // Fix closing
      const lastBrace = content.lastIndexOf('}');
      if (lastBrace !== -1 && !content.substring(lastBrace - 10, lastBrace).includes('});')) {
        content = content.substring(0, lastBrace) + '});' + content.substring(lastBrace + 1);
      }
    } else {
      // Handle module.exports
      content = content.replace(
        /module\.exports\s*=\s*async\s*\(/,
        'module.exports = requireAuth(async ('
      );
      content = content.replace(
        /export\s+default\s+async\s+function/,
        'export default requireAuth(async function'
      );
      // Fix closing
      const lastBrace = content.lastIndexOf('}');
      if (lastBrace !== -1 && !content.substring(lastBrace - 10, lastBrace).includes('});')) {
        content = content.substring(0, lastBrace) + '});' + content.substring(lastBrace + 1);
      }
    }
    
    fs.writeFileSync(filePath, content);
    console.log(`✅ Applied auth to: ${file}`);
    processed++;
    
  } catch (error) {
    console.error(`❌ Failed to process ${file}:`, error.message);
    failed++;
  }
}

console.log(`\nSummary:`);
console.log(`✅ Processed: ${processed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`⚠️  Skipped: ${filesToUpdate.length - processed - failed}`);