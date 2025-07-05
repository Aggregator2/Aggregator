#\!/usr/bin/env node

/**
 * Simple test script to verify LiFi integration
 * Run with: node test-lifi-integration.js
 */

const { lifiService } = require('./src/services/lifiService');
const { tokenAggregator } = require('./src/services/tokenAggregator');
const { tokenLoader } = require('./src/services/tokenLoader');

async function testLifiIntegration() {
  console.log('🧪 Testing LiFi Integration...\n');

  try {
    // Test 1: Check LiFi service health
    console.log('📊 1. Checking LiFi service health...');
    const isCacheValid = lifiService.isCacheValid();
    console.log(`   Cache valid: ${isCacheValid}`);

    // Test 2: Load tokens from LiFi
    console.log('\n🔄 2. Loading tokens from LiFi...');
    const startTime = Date.now();
    
    const lifiTokens = await lifiService.getAllTokens();
    const loadTime = Date.now() - startTime;
    
    const totalTokens = Array.from(lifiTokens.values()).reduce((sum, tokens) => sum + tokens.length, 0);
    console.log(`   ✅ Loaded ${totalTokens} tokens from ${lifiTokens.size} chains in ${loadTime}ms`);

    // Test 3: Test tokenAggregator integration
    console.log('\n🔗 3. Testing tokenAggregator integration...');
    await tokenAggregator.loadAllTokens();
    
    const stats = tokenAggregator.getStats();
    console.log(`   ✅ Total tokens in aggregator: ${stats.total}`);
    console.log(`   ✅ Chains: ${Object.keys(stats.byChain).length}`);

    // Test 4: Test tokenLoader health
    console.log('\n🩺 4. Checking tokenLoader health...');
    const health = tokenLoader.getHealthStatus();
    console.log(`   Status: ${health.status}`);
    console.log(`   Total tokens: ${health.totalTokens}`);
    console.log(`   LiFi cache valid: ${health.lifiCacheValid}`);

    // Test 5: Search functionality
    console.log('\n🔍 5. Testing search functionality...');
    const ethTokens = tokenAggregator.searchTokens('ETH', 1);
    console.log(`   ✅ Found ${ethTokens.length} ETH-related tokens on Ethereum`);

    const usdcTokens = tokenAggregator.searchTokens('USDC');
    console.log(`   ✅ Found ${usdcTokens.length} USDC tokens across all chains`);

    // Test 6: Check source breakdown
    console.log('\n📈 6. Source breakdown...');
    const allTokens = tokenAggregator.getAllTokens();
    const sources = {};
    
    allTokens.forEach(token => {
      const source = token.extensions?.source || 'unknown';
      sources[source] = (sources[source] || 0) + 1;
    });

    console.log('   Sources:');
    Object.entries(sources).forEach(([source, count]) => {
      console.log(`     ${source}: ${count} tokens`);
    });

    console.log('\n✅ All tests completed successfully\!');
    console.log(`\n📊 Summary:
    - LiFi tokens: ${totalTokens}
    - Total aggregated tokens: ${stats.total}
    - Chains supported: ${Object.keys(stats.byChain).length}
    - Load time: ${loadTime}ms
    - Status: ${health.status}`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
testLifiIntegration().catch(console.error);
EOF < /dev/null