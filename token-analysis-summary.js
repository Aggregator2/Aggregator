const fs = require('fs');

console.log('=== TOKEN SUPPORT ANALYSIS SUMMARY ===\n');

console.log('OVERVIEW:');
console.log('The comparison script analyzed tokens configured in popularTokens.ts against');
console.log('the tokens available through various API endpoints.\n');

console.log('RESULTS:');
console.log('- Total Configured Tokens: 43');
console.log('- Total Unsupported Tokens: 2 (95.3% support rate)');
console.log('- Ethereum: 29/29 tokens supported (100%)');
console.log('- BSC: 4/5 tokens supported (80%)');
console.log('- Polygon: 4/4 tokens supported (100%)');
console.log('- Solana: 4/5 tokens supported (80%)\n');

console.log('UNSUPPORTED TOKENS:\n');

console.log('1. SAFEMOON (BSC)');
console.log('   - Address: 0x8076C74C5e3F5852037F31Ff0093Eeb8c8ADd8D3');
console.log('   - Reason: SafeMoon has had significant controversies and was likely');
console.log('     delisted from major DEX aggregators. The token faced multiple');
console.log('     accusations of being a pyramid scheme and experienced a major hack.');
console.log('     Most reputable platforms have removed support for this token.\n');

console.log('2. FTT (Solana)');
console.log('   - Address: AGFEad2et2ZJif9jaGpdMixQqvW5i81aBdvKe7PHNfz3');
console.log('   - Reason: FTX Token became worthless after the FTX exchange collapsed');
console.log('     in November 2022. The token is no longer actively traded and has');
console.log('     been delisted from most platforms.\n');

console.log('OTHER OBSERVATIONS:\n');

console.log('- USDC on Solana (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) is supported');
console.log('- SRM/Serum on Solana (SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt) is supported');
console.log('- RAY/Raydium on Solana (4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R) is supported\n');

console.log('RECOMMENDATIONS:\n');
console.log('1. Remove SAFEMOON from BSC tokens in popularTokens.ts');
console.log('2. Remove FTT from Solana tokens in popularTokens.ts');
console.log('3. Both tokens are associated with failed/controversial projects');
console.log('4. Removing them will improve the user experience by preventing');
console.log('   failed swap attempts with these unsupported tokens\n');

// Create a removal script
const removalScript = `// Script to remove unsupported tokens from popularTokens.ts

const tokensToRemove = {
  56: ['SAFEMOON'], // BSC
  101: ['FTT']      // Solana
};

console.log('Tokens to remove:');
console.log('- BSC: SAFEMOON (0x8076C74C5e3F5852037F31Ff0093Eeb8c8ADd8D3)');
console.log('- Solana: FTT (AGFEad2et2ZJif9jaGpdMixQqvW5i81aBdvKe7PHNfz3)');
console.log('\\nThese tokens should be manually removed from src/config/tokens/popularTokens.ts');
`;

fs.writeFileSync('/workspace/remove-unsupported-tokens.js', removalScript);
console.log('Created removal script: /workspace/remove-unsupported-tokens.js');