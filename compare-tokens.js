const fs = require('fs');
const path = require('path');

// Import the configured tokens
const popularTokensPath = '/workspace/src/config/tokens/popularTokens.ts';
const popularTokensContent = fs.readFileSync(popularTokensPath, 'utf8');

// Extract token data from the TypeScript file
const tokenRegex = /POPULAR_TOKENS:\s*Record<number,\s*Token\[\]>\s*=\s*({[\s\S]*?});/;
const match = popularTokensContent.match(tokenRegex);

if (!match) {
  console.error('Could not extract POPULAR_TOKENS from file');
  process.exit(1);
}

// Parse the token configuration
const tokenConfig = eval('(' + match[1] + ')');

// Load API token data
const tempDataDir = '/workspace/temp-token-data';
const apiTokenData = {};

// Load Ethereum tokens from different sources
function loadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error.message);
    return null;
  }
}

// Load Ethereum tokens (chainId: 1)
const ethereum0xTokens = loadJsonFile(path.join(tempDataDir, '0x-ethereum-tokens.json'));
const ethereumCoingecko = loadJsonFile(path.join(tempDataDir, 'coingecko-ethereum-tokens.json'));
const ethereumOpenOcean = loadJsonFile(path.join(tempDataDir, 'openocean-ethereum-tokens.json'));

// Load BSC tokens (chainId: 56)
const bscOpenOcean = loadJsonFile(path.join(tempDataDir, 'openocean-bsc-tokens.json'));

// Load Polygon tokens (chainId: 137)
const polygonOpenOcean = loadJsonFile(path.join(tempDataDir, 'openocean-polygon-tokens.json'));

// Load Solana tokens (chainId: 101)
const solanaJupiter = loadJsonFile(path.join(tempDataDir, 'jupiter-solana-tokens.json'));

// Aggregate API tokens by chain
apiTokenData[1] = []; // Ethereum
apiTokenData[56] = []; // BSC
apiTokenData[137] = []; // Polygon
apiTokenData[101] = []; // Solana

// Process Ethereum tokens
if (ethereum0xTokens && ethereum0xTokens.records) {
  ethereum0xTokens.records.forEach(token => {
    apiTokenData[1].push({
      symbol: token.symbol,
      address: token.address.toLowerCase(),
      name: token.name
    });
  });
}

if (ethereumCoingecko && ethereumCoingecko.tokens) {
  ethereumCoingecko.tokens.forEach(token => {
    apiTokenData[1].push({
      symbol: token.symbol,
      address: token.address.toLowerCase(),
      name: token.name
    });
  });
}

if (ethereumOpenOcean && ethereumOpenOcean.data) {
  ethereumOpenOcean.data.forEach(token => {
    apiTokenData[1].push({
      symbol: token.symbol,
      address: token.address.toLowerCase(),
      name: token.name
    });
  });
}

// Process BSC tokens
if (bscOpenOcean && bscOpenOcean.data) {
  bscOpenOcean.data.forEach(token => {
    apiTokenData[56].push({
      symbol: token.symbol,
      address: token.address.toLowerCase(),
      name: token.name
    });
  });
}

// Process Polygon tokens
if (polygonOpenOcean && polygonOpenOcean.data) {
  polygonOpenOcean.data.forEach(token => {
    apiTokenData[137].push({
      symbol: token.symbol,
      address: token.address.toLowerCase(),
      name: token.name
    });
  });
}

// Process Solana tokens
if (solanaJupiter) {
  solanaJupiter.forEach(token => {
    apiTokenData[101].push({
      symbol: token.symbol,
      address: token.address,
      name: token.name
    });
  });
}

// Compare configured tokens with API tokens
const report = {
  summary: {
    totalConfigured: 0,
    totalUnsupported: 0,
    byChain: {}
  },
  unsupportedTokens: {}
};

const chainsToCheck = [1, 56, 137, 101];

chainsToCheck.forEach(chainId => {
  const configuredTokens = tokenConfig[chainId] || [];
  const apiTokens = apiTokenData[chainId] || [];
  
  const unsupported = [];
  
  configuredTokens.forEach(configToken => {
    // Skip native tokens
    if (configToken.type === 'NATIVE') {
      return;
    }
    
    const configAddress = configToken.address.toLowerCase();
    
    // Check if token exists in API data
    const found = apiTokens.some(apiToken => {
      return apiToken.address === configAddress || 
             (apiToken.symbol === configToken.symbol && 
              apiToken.name.toLowerCase().includes(configToken.name.toLowerCase().split(' ')[0]));
    });
    
    if (!found) {
      unsupported.push({
        symbol: configToken.symbol,
        name: configToken.name,
        address: configToken.address,
        type: configToken.type
      });
    }
  });
  
  report.summary.totalConfigured += configuredTokens.length;
  report.summary.totalUnsupported += unsupported.length;
  report.summary.byChain[chainId] = {
    configured: configuredTokens.length,
    unsupported: unsupported.length,
    percentage: configuredTokens.length > 0 ? 
      ((unsupported.length / configuredTokens.length) * 100).toFixed(1) + '%' : '0%'
  };
  report.unsupportedTokens[chainId] = unsupported;
});

// Generate detailed report
console.log('=== Token Support Analysis Report ===\n');

console.log('SUMMARY:');
console.log(`Total Configured Tokens: ${report.summary.totalConfigured}`);
console.log(`Total Unsupported Tokens: ${report.summary.totalUnsupported}`);
console.log(`Overall Support Rate: ${((1 - report.summary.totalUnsupported / report.summary.totalConfigured) * 100).toFixed(1)}%\n`);

console.log('BY CHAIN:');
const chainNames = {
  1: 'Ethereum',
  56: 'BSC',
  137: 'Polygon',
  101: 'Solana'
};

chainsToCheck.forEach(chainId => {
  const chainData = report.summary.byChain[chainId];
  console.log(`\n${chainNames[chainId]} (Chain ID: ${chainId}):`);
  console.log(`  - Configured: ${chainData.configured} tokens`);
  console.log(`  - Unsupported: ${chainData.unsupported} tokens (${chainData.percentage})`);
});

console.log('\n\n=== UNSUPPORTED TOKENS DETAIL ===\n');

chainsToCheck.forEach(chainId => {
  const unsupported = report.unsupportedTokens[chainId];
  if (unsupported.length > 0) {
    console.log(`\n${chainNames[chainId]} (Chain ID: ${chainId}) - ${unsupported.length} unsupported tokens:`);
    console.log('=' .repeat(60));
    unsupported.forEach(token => {
      console.log(`  ${token.symbol} (${token.name})`);
      console.log(`    Address: ${token.address}`);
      console.log(`    Type: ${token.type}`);
    });
  }
});

// Save report to file
const reportPath = '/workspace/unsupported-tokens-report.json';
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nDetailed report saved to: ${reportPath}`);

// Generate removal recommendations
console.log('\n\n=== REMOVAL RECOMMENDATIONS ===\n');
console.log('The following tokens should be removed from popularTokens.ts:\n');

let removalCount = 0;
chainsToCheck.forEach(chainId => {
  const unsupported = report.unsupportedTokens[chainId];
  if (unsupported.length > 0) {
    console.log(`${chainNames[chainId]}:`);
    unsupported.forEach(token => {
      console.log(`  - ${token.symbol} (${token.address})`);
      removalCount++;
    });
    console.log('');
  }
});

console.log(`Total tokens to remove: ${removalCount}`);