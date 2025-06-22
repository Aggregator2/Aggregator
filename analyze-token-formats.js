#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const tempDir = path.join(__dirname, 'temp-token-data');

// Helper to safely read JSON files
function readJsonFile(filename) {
  try {
    const filePath = path.join(tempDir, filename);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

// Analyze token formats from each API
function analyzeFormats() {
  console.log('=== Token Format Analysis ===\n');
  
  // 1. Jupiter (Solana)
  const jupiterData = readJsonFile('jupiter-solana-tokens.json');
  if (jupiterData && jupiterData.length > 0) {
    console.log('Jupiter (Solana) Token Format:');
    console.log('Sample token:', JSON.stringify(jupiterData[0], null, 2));
    console.log(`Total tokens: ${jupiterData.length}`);
    console.log('Key fields: address (mint), symbol, name, decimals, logoURI, chainId\n');
  }
  
  // 2. OpenOcean
  const openOceanEth = readJsonFile('openocean-eth-tokens.json');
  if (openOceanEth && openOceanEth.data && openOceanEth.data.length > 0) {
    console.log('OpenOcean Token Format:');
    console.log('Sample token:', JSON.stringify(openOceanEth.data[0], null, 2));
    console.log(`Total tokens: ${openOceanEth.data.length}`);
    console.log('Key fields: address, symbol, name, decimals, icon, chainId\n');
  }
  
  // 3. CoinGecko
  const coingeckoData = readJsonFile('coingecko-ethereum-tokens.json');
  if (coingeckoData && coingeckoData.tokens && coingeckoData.tokens.length > 0) {
    console.log('CoinGecko Token Format:');
    console.log('Sample token:', JSON.stringify(coingeckoData.tokens[0], null, 2));
    console.log(`Total tokens: ${coingeckoData.tokens.length}`);
    console.log('Key fields: address, symbol, name, decimals, logoURI, chainId\n');
  }
  
  // Check 0x response
  const zeroXPrice = readJsonFile('0x-sample-price.json');
  console.log('0x API Response:', JSON.stringify(zeroXPrice, null, 2));
}

// Generate statistics
function generateStats() {
  console.log('\n=== Token Statistics by Chain ===\n');
  
  const stats = {
    'Solana (Jupiter)': readJsonFile('jupiter-solana-tokens.json')?.length || 0,
    'Ethereum (OpenOcean)': readJsonFile('openocean-eth-tokens.json')?.data?.length || 0,
    'Ethereum (CoinGecko)': readJsonFile('coingecko-ethereum-tokens.json')?.tokens?.length || 0,
    'BSC (OpenOcean)': readJsonFile('openocean-bsc-tokens.json')?.data?.length || 0,
    'Polygon (OpenOcean)': readJsonFile('openocean-polygon-tokens.json')?.data?.length || 0,
    'Arbitrum (OpenOcean)': readJsonFile('openocean-arbitrum-tokens.json')?.data?.length || 0,
    'Optimism (OpenOcean)': readJsonFile('openocean-optimism-tokens.json')?.data?.length || 0,
  };
  
  Object.entries(stats).forEach(([chain, count]) => {
    console.log(`${chain}: ${count.toLocaleString()} tokens`);
  });
  
  const total = Object.values(stats).reduce((sum, count) => sum + count, 0);
  console.log(`\nTotal unique tokens across all chains: ~${total.toLocaleString()}`);
}

// Find common tokens across chains
function findCommonTokens() {
  console.log('\n=== Common Tokens Across Chains ===\n');
  
  const tokensBySymbol = new Map();
  
  // Collect tokens from each source
  const sources = [
    { name: 'Jupiter', data: readJsonFile('jupiter-solana-tokens.json'), field: 'symbol' },
    { name: 'OpenOcean ETH', data: readJsonFile('openocean-eth-tokens.json')?.data, field: 'symbol' },
    { name: 'OpenOcean BSC', data: readJsonFile('openocean-bsc-tokens.json')?.data, field: 'symbol' },
    { name: 'CoinGecko ETH', data: readJsonFile('coingecko-ethereum-tokens.json')?.tokens, field: 'symbol' },
  ];
  
  sources.forEach(({ name, data, field }) => {
    if (Array.isArray(data)) {
      data.forEach(token => {
        const symbol = token[field];
        if (symbol) {
          if (!tokensBySymbol.has(symbol)) {
            tokensBySymbol.set(symbol, []);
          }
          tokensBySymbol.get(symbol).push({ source: name, token });
        }
      });
    }
  });
  
  // Find tokens that appear in multiple sources
  const commonTokens = Array.from(tokensBySymbol.entries())
    .filter(([symbol, sources]) => sources.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  
  console.log('Top 10 most common tokens:');
  commonTokens.slice(0, 10).forEach(([symbol, sources]) => {
    console.log(`${symbol}: Found in ${sources.length} sources (${sources.map(s => s.source).join(', ')})`);
  });
}

// Main execution
console.log('Token Data Analysis Report');
console.log('=========================\n');

analyzeFormats();
generateStats();
findCommonTokens();

// Export results
const exportData = {
  generatedAt: new Date().toISOString(),
  summary: {
    jupiterFormat: 'address (mint), symbol, name, decimals, logoURI, chainId',
    openOceanFormat: 'address, symbol, name, decimals, icon, chainId',
    coinGeckoFormat: 'address, symbol, name, decimals, logoURI, chainId',
    notes: [
      'Jupiter uses "address" field for Solana mint addresses',
      'OpenOcean wraps tokens in a "data" array',
      'CoinGecko wraps tokens in a "tokens" array',
      '0x API does not provide a direct token list endpoint'
    ]
  }
};

fs.writeFileSync(
  path.join(tempDir, 'token-analysis-report.json'),
  JSON.stringify(exportData, null, 2)
);

console.log('\n✅ Analysis complete! Report saved to temp-token-data/token-analysis-report.json');