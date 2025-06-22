const axios = require('axios');

async function testTokenCount() {
  console.log('🔍 Testing LiFi Token Count\n');
  
  try {
    // Test individual chains
    const chains = [
      { id: 1, name: 'Ethereum' },
      { id: 56, name: 'BSC' },
      { id: 137, name: 'Polygon' },
      { id: 42161, name: 'Arbitrum' },
      { id: 10, name: 'Optimism' },
      { id: 43114, name: 'Avalanche' }
    ];
    
    let totalTokens = 0;
    
    for (const chain of chains) {
      const response = await axios.get(`http://localhost:3000/api/tokens/comprehensive-v2?chainId=${chain.id}`);
      const tokens = response.data.tokens || response.data;
      console.log(`${chain.name} (${chain.id}): ${tokens.length} tokens`);
      totalTokens += tokens.length;
    }
    
    console.log(`\nTotal tokens across chains: ${totalTokens}`);
    
    // Test all chains at once
    const allChainsResponse = await axios.get('http://localhost:3000/api/tokens/comprehensive-v2');
    const allTokens = allChainsResponse.data.tokens || allChainsResponse.data;
    console.log(`\nAll chains combined: ${allTokens.length} unique tokens`);
    
    // Show stats if available
    if (allChainsResponse.data.stats) {
      console.log('\nToken sources:', allChainsResponse.data.stats.bySource);
    }
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testTokenCount().catch(console.error);