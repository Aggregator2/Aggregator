#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Additional files that need auth applied
const filesToUpdate = [
  // Channels
  { file: 'channels/create.js', isTS: false },
  { file: 'channels/[channelId]/state.js', isTS: false },
  { file: 'channels/[channelId]/trade.js', isTS: false },
  { file: 'channels/[channelId]/settle.js', isTS: false },
  { file: 'channels/metrics.js', isTS: false },
  
  // WebSocket management (not the status endpoint)
  { file: 'websocket/connections.js', isTS: false },
  { file: 'websocket/notifications.ts', isTS: true },
  { file: 'websocket/rate-limits.js', isTS: false },
  { file: 'ws/v1/orderbook/[pair].js', isTS: false },
  
  // Competition & Analytics
  { file: 'competition/leaderboard.ts', isTS: true },
  { file: 'analytics/profits.ts', isTS: true },
  
  // Revenue
  { file: 'revenue/status.ts', isTS: true },
  { file: 'revenue/crosschain-status.ts', isTS: true },
  
  // Disputes
  { file: 'disputes/index.ts', isTS: true },
  { file: 'disputes/settle.ts', isTS: true },
  { file: 'disputes/return.ts', isTS: true },
  
  // Crosschain operations
  { file: 'crosschain/execute.ts', isTS: true },
  { file: 'crosschain/status.ts', isTS: true },
  { file: 'crosschain-test/simulate.ts', isTS: true },
  
  // API Documentation/Collections (sensitive)
  { file: 'collections/postman.js', isTS: false },
  { file: 'collections/insomnia.js', isTS: false },
  { file: 'collections/curl.js', isTS: false },
  
  // Market maker apply endpoint
  { file: 'market-maker/apply.ts', isTS: true }
];

const apiDir = path.join(__dirname, '..', 'pages', 'api');

console.log(`Processing ${filesToUpdate.length} additional files...`);

let processed = 0;
let failed = 0;
let skipped = 0;

for (const { file, isTS } of filesToUpdate) {
  const filePath = path.join(apiDir, file);
  
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File not found: ${file}`);
      skipped++;
      continue;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if already has requireAuth or withApiKey
    if (content.includes('requireAuth') || content.includes('withApiKey')) {
      console.log(`✓ Already has auth: ${file}`);
      processed++;
      continue;
    }
    
    // Calculate correct import path based on file depth
    const depth = file.split('/').length;
    const importPath = '../'.repeat(depth) + 'src/middleware/auth';
    
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
    
    // Wrap export
    if (content.includes('module.exports')) {
      content = content.replace(
        /module\.exports\s*=\s*async\s*\(req/,
        'module.exports = requireAuth(async (req'
      );
    } else if (content.includes('export default')) {
      content = content.replace(
        /export\s+default\s+async\s+function\s+handler/,
        'export default requireAuth(async function handler'
      );
    }
    
    // Fix closing - find the last closing brace
    const lastBrace = content.lastIndexOf('}');
    if (lastBrace !== -1) {
      // Check if it's already properly closed with });
      const beforeBrace = content.substring(Math.max(0, lastBrace - 10), lastBrace);
      if (!beforeBrace.includes('});')) {
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
console.log(`⚠️  Skipped: ${skipped}`);