require('dotenv').config({ path: '.env.local' });

async function loadLifiTokenService() {
  // Dynamic import to handle TypeScript
  const module = await import('./src/services/lifiTokenService.js');
  return module.lifiTokenService;
}

async function testLiFiTokens() {
  console.log('🔍 Testing LiFi Token Loading\n');
  
  try {
    const lifiTokenService = await loadLifiTokenService();
    // Test for multiple chains
    const chains = [1, 56, 137, 42161, 10, 43114];
    
    for (const chainId of chains) {
      console.log(`\nChain ${chainId}:`);
      const tokens = await lifiTokenService.getAllTokens({ chains: [chainId] });
      console.log(`  Token count: ${tokens.length}`);
      
      // Show first 5 tokens as examples
      if (tokens.length > 0) {
        console.log('  Sample tokens:');
        tokens.slice(0, 5).forEach(token => {
          console.log(`    - ${token.symbol}: ${token.name}`);
        });
      }
    }
    
    // Test getting all tokens across all chains
    console.log('\n\nAll chains combined:');
    const allTokens = await lifiTokenService.getAllTokens();
    console.log(`Total unique tokens: ${allTokens.length}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testLiFiTokens().catch(console.error);