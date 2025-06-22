const axios = require('axios');

const CHAIN_IDS = {
  ETHEREUM: 1,
  POLYGON: 137,
  ARBITRUM: 42161,
  OPTIMISM: 10
};

async function fetchAllTokens() {
  console.log('=== LI.FI Token Integration Full Verification ===\n');
  
  const tokenStats = {
    total: 0,
    byChain: {},
    withLogos: 0,
    withoutLogos: 0,
    logoErrors: [],
    ipfsLogos: 0,
    httpsLogos: 0
  };

  try {
    // Fetch tokens for each chain
    for (const [chainName, chainId] of Object.entries(CHAIN_IDS)) {
      console.log(`\nFetching tokens for ${chainName} (Chain ID: ${chainId})...`);
      
      try {
        const response = await axios.get(`https://li.quest/v1/tokens?chains=${chainId}`);
        const tokens = response.data.tokens[chainId] || [];
        
        tokenStats.byChain[chainName] = {
          count: tokens.length,
          tokens: tokens,
          examples: tokens.slice(0, 5).map(t => ({
            symbol: t.symbol,
            name: t.name,
            address: t.address,
            logoURI: t.logoURI,
            decimals: t.decimals
          }))
        };
        
        tokenStats.total += tokens.length;
        
        // Analyze logos
        for (const token of tokens) {
          if (token.logoURI) {
            tokenStats.withLogos++;
            if (token.logoURI.includes('ipfs://')) {
              tokenStats.ipfsLogos++;
            } else if (token.logoURI.startsWith('https://')) {
              tokenStats.httpsLogos++;
            }
          } else {
            tokenStats.withoutLogos++;
          }
        }
        
        console.log(`✅ Found ${tokens.length} tokens for ${chainName}`);
        
      } catch (error) {
        console.error(`❌ Error fetching tokens for ${chainName}:`, error.message);
        tokenStats.byChain[chainName] = { count: 0, error: error.message };
      }
    }
    
    // Print summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total tokens across all chains: ${tokenStats.total}`);
    console.log(`Tokens with logos: ${tokenStats.withLogos} (${((tokenStats.withLogos/tokenStats.total)*100).toFixed(1)}%)`);
    console.log(`Tokens without logos: ${tokenStats.withoutLogos} (${((tokenStats.withoutLogos/tokenStats.total)*100).toFixed(1)}%)`);
    console.log(`IPFS logos: ${tokenStats.ipfsLogos}`);
    console.log(`HTTPS logos: ${tokenStats.httpsLogos}`);
    
    console.log('\n=== TOKEN COUNT BY CHAIN ===');
    for (const [chain, data] of Object.entries(tokenStats.byChain)) {
      console.log(`${chain}: ${data.count} tokens`);
    }
    
    // Test logo loading for a few tokens
    console.log('\n=== TESTING LOGO URLS ===');
    const testTokens = [];
    for (const chainData of Object.values(tokenStats.byChain)) {
      if (chainData.tokens && chainData.tokens.length > 0) {
        testTokens.push(...chainData.tokens.filter(t => t.logoURI).slice(0, 2));
      }
    }
    
    for (const token of testTokens.slice(0, 8)) {
      try {
        let logoUrl = token.logoURI;
        
        // Convert IPFS URLs to HTTP gateway URLs
        if (logoUrl.startsWith('ipfs://')) {
          logoUrl = logoUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }
        
        const response = await axios.head(logoUrl, { timeout: 5000 });
        console.log(`✅ ${token.symbol} logo accessible: ${logoUrl} (${response.status})`);
      } catch (error) {
        console.log(`❌ ${token.symbol} logo failed: ${token.logoURI} - ${error.message}`);
        tokenStats.logoErrors.push({ token: token.symbol, url: token.logoURI, error: error.message });
      }
    }
    
    // Search test - find all USDC tokens
    console.log('\n=== SEARCH TEST: Finding all USDC tokens ===');
    const usdcTokens = [];
    for (const [chainName, chainData] of Object.entries(tokenStats.byChain)) {
      if (chainData.tokens) {
        const chainUSDC = chainData.tokens.filter(t => 
          t.symbol.toUpperCase() === 'USDC' || 
          t.name.toUpperCase().includes('USD COIN')
        );
        if (chainUSDC.length > 0) {
          usdcTokens.push({ chain: chainName, tokens: chainUSDC });
        }
      }
    }
    
    console.log(`Found USDC on ${usdcTokens.length} chains:`);
    for (const { chain, tokens } of usdcTokens) {
      console.log(`- ${chain}: ${tokens.length} USDC token(s)`);
      tokens.forEach(t => {
        console.log(`  Address: ${t.address}, Decimals: ${t.decimals}`);
      });
    }
    
    // Test caching by fetching again
    console.log('\n=== CACHE TEST ===');
    const cacheStart = Date.now();
    const cacheResponse = await axios.get(`https://li.quest/v1/tokens?chains=${CHAIN_IDS.ETHEREUM}`);
    const cacheTime = Date.now() - cacheStart;
    console.log(`Second fetch time: ${cacheTime}ms (should be fast if properly cached)`);
    
    // Print example tokens for verification
    console.log('\n=== EXAMPLE TOKENS PER CHAIN ===');
    for (const [chain, data] of Object.entries(tokenStats.byChain)) {
      if (data.examples && data.examples.length > 0) {
        console.log(`\n${chain}:`);
        data.examples.forEach(token => {
          console.log(`- ${token.symbol} (${token.name})`);
          console.log(`  Address: ${token.address}`);
          console.log(`  Logo: ${token.logoURI || 'No logo'}`);
        });
      }
    }
    
    return tokenStats;
    
  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  }
}

// Run the verification
fetchAllTokens().then(() => {
  console.log('\n✅ Verification complete!');
}).catch(error => {
  console.error('\n❌ Verification failed:', error);
  process.exit(1);
});