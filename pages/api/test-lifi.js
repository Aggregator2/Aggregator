// Test endpoint to verify LiFi API connectivity
import { getChains, getTokens } from '@lifi/sdk';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = {
    timestamp: new Date().toISOString(),
    tests: {}
  };

  try {
    // Test 1: Get chains
    console.log('[Test] Fetching chains from LiFi...');
    const startChains = Date.now();
    const chains = await getChains();
    const chainsTime = Date.now() - startChains;
    
    results.tests.chains = {
      success: true,
      count: chains.length,
      time: `${chainsTime}ms`,
      sample: chains.slice(0, 3).map(c => ({ id: c.id, name: c.name }))
    };
    console.log(`[Test] Chains fetched: ${chains.length} in ${chainsTime}ms`);

    // Test 2: Get tokens for Ethereum
    console.log('[Test] Fetching Ethereum tokens from LiFi...');
    const startTokens = Date.now();
    const tokensResponse = await getTokens({ chains: [1] });
    const tokensTime = Date.now() - startTokens;
    
    const ethTokens = tokensResponse.tokens[1] || [];
    results.tests.ethereumTokens = {
      success: true,
      count: ethTokens.length,
      time: `${tokensTime}ms`,
      sample: ethTokens.slice(0, 3).map(t => ({ 
        symbol: t.symbol, 
        name: t.name,
        address: t.address 
      }))
    };
    console.log(`[Test] Ethereum tokens fetched: ${ethTokens.length} in ${tokensTime}ms`);

    // Test 3: Get all tokens (limited chains for speed)
    console.log('[Test] Fetching tokens for multiple chains...');
    const startAllTokens = Date.now();
    const allTokensResponse = await getTokens({ chains: [1, 56, 137] });
    const allTokensTime = Date.now() - startAllTokens;
    
    const totalTokens = Object.values(allTokensResponse.tokens)
      .reduce((sum, tokens) => sum + tokens.length, 0);
    
    results.tests.multiChainTokens = {
      success: true,
      totalTokens,
      chainCount: Object.keys(allTokensResponse.tokens).length,
      time: `${allTokensTime}ms`
    };
    console.log(`[Test] Multi-chain tokens fetched: ${totalTokens} tokens in ${allTokensTime}ms`);

    results.status = 'All tests passed';
    results.healthy = true;

  } catch (error) {
    console.error('[Test] LiFi API test failed:', error);
    results.status = 'Tests failed';
    results.healthy = false;
    results.error = {
      message: error.message,
      type: error.constructor.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }

  return res.status(results.healthy ? 200 : 500).json(results);
}