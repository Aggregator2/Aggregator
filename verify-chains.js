// Verify all 47 chains are properly configured
const fs = require('fs');

// Read the multiChainQuoteService file
const content = fs.readFileSync('./src/services/multiChainQuoteService.ts', 'utf-8');

// Extract CHAIN_CONFIG
const configMatch = content.match(/export const CHAIN_CONFIG = \{[\s\S]*?\n\};/);
if (!configMatch) {
  console.error('Could not find CHAIN_CONFIG in file');
  process.exit(1);
}

// Count chains by finding all numeric keys
const chainMatches = configMatch[0].matchAll(/^\s*(\d+):\s*\{/gm);
const chainIds = Array.from(chainMatches).map(m => parseInt(m[1]));

console.log('🔍 Chain Configuration Verification');
console.log('===================================\n');

console.log(`Total chains configured: ${chainIds.length}`);
console.log('Chain IDs:', chainIds.sort((a, b) => a - b).join(', '));

// Expected chains from LiFi
const expectedChains = 47;
const allExpectedIds = [
  1, 56, 137, 42161, 10, 43114, 250, 8453, // Major
  100, 1284, 1285, 1313161554, 42220, // Layer 2s
  324, 1101, 534352, 59144, // zkEVM
  81457, 34443, 167000, 5000, // Newer
  25, 122, 288, 1088, 8217, // Alt L1s
  146, 204, 232, 480, 999, 1135, 1329, 1625, 1868, 1923, // Emerging
  2741, 13371, 21000000, 30, 33139, 50, 55244, 57073, 60808, 80094, 130, // More
  195, 101 // Non-EVM
];

console.log(`\n✅ Configured: ${chainIds.length}`);
console.log(`📊 Expected: ${expectedChains}`);

// Check for missing chains
const missingChains = allExpectedIds.filter(id => !chainIds.includes(id));
if (missingChains.length > 0) {
  console.log(`\n❌ Missing chains: ${missingChains.join(', ')}`);
} else {
  console.log('\n✅ All expected chains are configured!');
}

// Check for extra chains
const extraChains = chainIds.filter(id => !allExpectedIds.includes(id));
if (extraChains.length > 0) {
  console.log(`\n⚠️  Extra chains not in expected list: ${extraChains.join(', ')}`);
}

console.log(`\n${chainIds.length >= expectedChains ? '✅' : '❌'} Status: ${chainIds.length >= expectedChains ? 'PASS' : 'FAIL'}`);

// Also check TokenPicker
console.log('\n\n🔍 TokenPicker Chain Configuration');
console.log('==================================\n');

const tokenPickerContent = fs.readFileSync('./components/TokenPicker.tsx', 'utf-8');
const chainInfoMatch = tokenPickerContent.match(/const CHAIN_INFO.*?= \{[\s\S]*?\n\};/);

if (chainInfoMatch) {
  const tokenPickerChains = Array.from(chainInfoMatch[0].matchAll(/^\s*(\d+):\s*\{/gm)).map(m => parseInt(m[1]));
  console.log(`TokenPicker chains configured: ${tokenPickerChains.length}`);
  
  const missingInPicker = chainIds.filter(id => !tokenPickerChains.includes(id));
  if (missingInPicker.length > 0) {
    console.log(`\n⚠️  Chains in service but not in TokenPicker UI: ${missingInPicker.join(', ')}`);
  } else {
    console.log('\n✅ All chains are present in TokenPicker UI!');
  }
}