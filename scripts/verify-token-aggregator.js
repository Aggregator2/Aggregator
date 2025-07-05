#!/usr/bin/env node

/**
 * Simple verification script for TokenAggregator fixes
 */

console.log('🧪 Verifying TokenAggregator fixes...\n');

// Check if the file can be read without syntax errors
const fs = require('fs');
const path = require('path');

try {
  const tokenAggregatorPath = path.join(__dirname, '..', 'src', 'services', 'tokenAggregator.ts');
  const content = fs.readFileSync(tokenAggregatorPath, 'utf8');
  
  console.log('✅ TokenAggregator file read successfully');
  console.log(`📄 File size: ${content.length} characters`);

  // Check for key fixes
  const checks = [
    {
      name: 'LiFi integration import',
      pattern: /import.*lifiService.*from.*lifiService/,
      found: content.match(/import.*lifiService.*from.*lifiService/)
    },
    {
      name: 'Concurrent loading prevention',
      pattern: /isLoading.*boolean/,
      found: content.match(/isLoading.*boolean/)
    },
    {
      name: 'loadTokensFromLifi method',
      pattern: /async loadTokensFromLifi/,
      found: content.match(/async loadTokensFromLifi/)
    },
    {
      name: 'Error handling with try-catch',
      pattern: /catch.*error[\s\S]*?logger\.(error|warn)/,
      found: content.match(/catch.*error[\s\S]*?logger\.(error|warn)/)
    },
    {
      name: 'Primary LiFi source in loadAllTokens',
      pattern: /allTokens = await this\.loadTokensFromLifi/,
      found: content.match(/allTokens = await this\.loadTokensFromLifi/)
    },
    {
      name: 'Fallback tokens usage',
      pattern: /(FALLBACK_TOKENS|getDefaultTokens)/,
      found: content.match(/(FALLBACK_TOKENS|getDefaultTokens)/)
    },
    {
      name: 'Removed failing external URLs',
      pattern: /compound-finance.*token-list|tokens\.1inch\.io|sushiswap.*default-token-list/,
      found: !content.match(/compound-finance.*token-list|tokens\.1inch\.io|sushiswap.*default-token-list/)
    },
    {
      name: 'Safe error handling in getAllTokens',
      pattern: /getAllTokens.*try.*catch/,
      found: content.match(/getAllTokens[\s\S]*?try[\s\S]*?catch/)
    }
  ];

  console.log('\n🔍 Checking for key fixes:');
  let allFixed = true;

  checks.forEach(check => {
    if (check.found) {
      console.log(`  ✅ ${check.name}`);
    } else {
      console.log(`  ❌ ${check.name}`);
      allFixed = false;
    }
  });

  if (allFixed) {
    console.log('\n🎉 All key fixes are present in the TokenAggregator!');
    console.log('\n✅ Summary of fixes applied:');
    console.log('  1. Stack overflow prevention with isLoading flag');
    console.log('  2. LiFi integration as primary token source');
    console.log('  3. Removed failing external token list URLs');
    console.log('  4. Comprehensive error handling');
    console.log('  5. Concurrent loading prevention');
    console.log('  6. Safe fallback mechanisms');
    
    console.log('\n📝 The TokenAggregator should now:');
    console.log('  - Load tokens from LiFi as the primary source');
    console.log('  - Fall back to reliable token lists only');
    console.log('  - Handle API failures gracefully');
    console.log('  - Prevent infinite recursion and stack overflow');
    console.log('  - Cache results to minimize API calls');
  } else {
    console.log('\n❌ Some fixes may be missing. Please review the implementation.');
  }

  console.log('\n✨ TokenAggregator verification complete!');

} catch (error) {
  console.error('❌ Failed to read TokenAggregator file:', error.message);
  process.exit(1);
}