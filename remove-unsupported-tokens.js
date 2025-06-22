// Script to remove unsupported tokens from popularTokens.ts

const tokensToRemove = {
  56: ['SAFEMOON'], // BSC
  101: ['FTT']      // Solana
};

console.log('Tokens to remove:');
console.log('- BSC: SAFEMOON (0x8076C74C5e3F5852037F31Ff0093Eeb8c8ADd8D3)');
console.log('- Solana: FTT (AGFEad2et2ZJif9jaGpdMixQqvW5i81aBdvKe7PHNfz3)');
console.log('\nThese tokens should be manually removed from src/config/tokens/popularTokens.ts');
