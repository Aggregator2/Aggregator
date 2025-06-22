// Test that all 47 chains are properly supported
const fetch = require('node-fetch');

// Get all chain IDs from our configuration
const ALL_CHAINS = [
  1, 56, 137, 42161, 10, 43114, 250, 8453, // Major chains
  100, 1284, 1285, 1313161554, 42220, // Layer 2s
  324, 1101, 534352, 59144, // zkEVM chains
  81457, 34443, 167000, 5000, // Newer chains
  25, 122, 288, 1088, 8217, // Alternative L1s
  146, 204, 232, 480, 999, 1135, 1329, 1625, 1868, 1923, // Emerging chains
  2741, 13371, 21000000, 30, 33139, 50, 55244, 57073, 60808, 80094, 130, // More chains
  195, 101 // Non-EVM (Tron, Solana)
];

async function testChainSupport(chainId) {
  try {
    const response = await fetch('http://localhost:3001/api/quote-profitable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native token
        buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native token (for simplicity)
        sellAmount: '1000000000000000000', // 1 native token
        chainId: chainId,
        toChainId: chainId === 1 ? 56 : 1, // Cross-chain test
        slippagePercentage: 1
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      return { chainId, status: '✅ Success', source: data.source };
    } else {
      return { chainId, status: '❌ Failed', error: data.error };
    }
  } catch (error) {
    return { chainId, status: '❌ Network Error', error: error.message };
  }
}

async function runTests() {
  console.log('🚀 Testing all 47 chains...');
  console.log('================================\n');
  
  // Check if server is running
  try {
    await fetch('http://localhost:3001');
  } catch (error) {
    console.error('❌ Server is not running at http://localhost:3001');
    console.log('Please start the server with: npm run dev');
    return;
  }
  
  // Test chains in batches to avoid overwhelming the API
  const batchSize = 5;
  const results = [];
  
  for (let i = 0; i < ALL_CHAINS.length; i += batchSize) {
    const batch = ALL_CHAINS.slice(i, i + batchSize);
    console.log(`Testing chains: ${batch.join(', ')}...`);
    
    const batchResults = await Promise.all(
      batch.map(chainId => testChainSupport(chainId))
    );
    
    results.push(...batchResults);
    
    // Wait between batches
    if (i + batchSize < ALL_CHAINS.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Display results
  console.log('\n📊 Results Summary:');
  console.log('==================\n');
  
  const successful = results.filter(r => r.status.includes('Success'));
  const failed = results.filter(r => r.status.includes('Failed'));
  
  console.log(`✅ Successful: ${successful.length}/${ALL_CHAINS.length}`);
  console.log(`❌ Failed: ${failed.length}/${ALL_CHAINS.length}`);
  
  if (failed.length > 0) {
    console.log('\n❌ Failed chains:');
    failed.forEach(result => {
      console.log(`  Chain ${result.chainId}: ${result.error}`);
    });
  }
  
  // Group by source
  console.log('\n📈 Quote sources used:');
  const sources = {};
  successful.forEach(result => {
    sources[result.source] = (sources[result.source] || 0) + 1;
  });
  
  Object.entries(sources).forEach(([source, count]) => {
    console.log(`  ${source}: ${count} chains`);
  });
}

// Run the tests
runTests().catch(console.error);