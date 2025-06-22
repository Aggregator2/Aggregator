const fs = require('fs');
const path = require('path');

// Load Jupiter token data
const jupiterTokensPath = '/workspace/temp-token-data/jupiter-solana-tokens.json';
const jupiterTokens = JSON.parse(fs.readFileSync(jupiterTokensPath, 'utf8'));

// Configured Solana tokens from popularTokens.ts
const configuredSolanaTokens = [
  { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USD Coin (SPL)' },
  { symbol: 'SRM', address: 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt', name: 'Serum' },
  { symbol: 'RAY', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', name: 'Raydium' },
  { symbol: 'FTT', address: 'AGFEad2et2ZJif9jaGpdMixQqvW5i81aBdvKe7PHNfz3', name: 'FTX Token' }
];

console.log('=== Solana Token Analysis ===\n');
console.log(`Total Jupiter tokens: ${jupiterTokens.length}\n`);

// Search for each configured token in Jupiter data
configuredSolanaTokens.forEach(configToken => {
  console.log(`\nSearching for ${configToken.symbol} (${configToken.name}):`);
  console.log(`Configured Address: ${configToken.address}`);
  
  // Find all tokens with matching symbol
  const matchingTokens = jupiterTokens.filter(token => 
    token.symbol === configToken.symbol || 
    token.symbol.toUpperCase() === configToken.symbol.toUpperCase()
  );
  
  if (matchingTokens.length > 0) {
    console.log(`Found ${matchingTokens.length} token(s) with symbol ${configToken.symbol}:`);
    matchingTokens.forEach((token, index) => {
      console.log(`  [${index + 1}] ${token.name}`);
      console.log(`      Address: ${token.mint || token.address}`);
      console.log(`      Decimals: ${token.decimals}`);
      console.log(`      Logo: ${token.logoURI ? 'Yes' : 'No'}`);
      if (token.tags) {
        console.log(`      Tags: ${token.tags.join(', ')}`);
      }
    });
  } else {
    console.log(`  ❌ No tokens found with symbol ${configToken.symbol}`);
  }
  
  // Also search by name
  const nameMatches = jupiterTokens.filter(token => 
    token.name && token.name.toLowerCase().includes(configToken.name.toLowerCase().split(' ')[0])
  );
  
  if (nameMatches.length > 0 && nameMatches.length !== matchingTokens.length) {
    console.log(`\n  Additional tokens found by name search:`);
    nameMatches.forEach(token => {
      if (!matchingTokens.find(t => (t.mint || t.address) === (token.mint || token.address))) {
        console.log(`    - ${token.symbol} (${token.name})`);
        console.log(`      Address: ${token.mint || token.address}`);
      }
    });
  }
});

// Check for deprecated/delisted tokens
console.log('\n\n=== Possible Reasons for Unsupported Tokens ===\n');
console.log('1. FTT (FTX Token) - FTX exchange collapsed in 2022, token likely delisted');
console.log('2. SRM (Serum) - Project affected by FTX collapse, may be delisted');
console.log('3. USDC - Multiple USDC versions exist on Solana, address may have changed');
console.log('4. RAY (Raydium) - Active DEX, address may have been updated');

// Look for alternative USDC addresses
console.log('\n\n=== Alternative Token Addresses ===\n');
const usdcTokens = jupiterTokens.filter(token => 
  token.symbol === 'USDC' || (token.name && token.name.includes('USD Coin'))
);

console.log('USDC variants found:');
usdcTokens.forEach(token => {
  console.log(`  ${token.symbol} - ${token.name}`);
  console.log(`    Address: ${token.mint || token.address}`);
  console.log(`    Decimals: ${token.decimals}`);
});

// Look for Raydium
const rayTokens = jupiterTokens.filter(token => 
  token.symbol === 'RAY' || (token.name && token.name.toLowerCase().includes('raydium'))
);

console.log('\nRAY/Raydium variants found:');
rayTokens.forEach(token => {
  console.log(`  ${token.symbol} - ${token.name}`);
  console.log(`    Address: ${token.mint || token.address}`);
});