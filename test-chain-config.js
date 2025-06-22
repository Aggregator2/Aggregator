// Test that all chains are properly configured
const { CHAIN_CONFIG } = require('./src/services/multiChainQuoteService');

console.log('🔍 Checking chain configuration...\n');

const chainIds = Object.keys(CHAIN_CONFIG).map(Number).sort((a, b) => a - b);

console.log(`Total chains configured: ${chainIds.length}`);
console.log('================================\n');

// Group chains by category
const categories = {
  'Major EVM Chains': [1, 56, 137, 42161, 10, 43114, 250, 8453],
  'Layer 2s & Sidechains': [100, 1284, 1285, 1313161554, 42220],
  'zkEVM Chains': [324, 1101, 534352, 59144],
  'Newer Chains': [81457, 34443, 167000, 5000],
  'Alternative L1s': [25, 122, 288, 1088, 8217],
  'Emerging Chains': [146, 204, 232, 480, 999, 1135, 1329, 1625, 1868, 1923, 2741, 13371, 21000000, 30, 33139, 50, 55244, 57073, 60808, 80094, 130],
  'Non-EVM Chains': [195, 101]
};

Object.entries(categories).forEach(([category, ids]) => {
  console.log(`${category}:`);
  ids.forEach(id => {
    const config = CHAIN_CONFIG[id];
    if (config) {
      console.log(`  ✅ ${id}: ${config.name} (${config.nativeCurrency})`);
    } else {
      console.log(`  ❌ ${id}: Not configured`);
    }
  });
  console.log('');
});

// Check for chains in config but not in our categories
const allCategorizedChains = Object.values(categories).flat();
const uncategorized = chainIds.filter(id => !allCategorizedChains.includes(id));

if (uncategorized.length > 0) {
  console.log('Uncategorized chains:');
  uncategorized.forEach(id => {
    const config = CHAIN_CONFIG[id];
    console.log(`  ⚠️  ${id}: ${config.name} (${config.nativeCurrency})`);
  });
  console.log('');
}

console.log('Summary:');
console.log(`✅ Total chains configured: ${chainIds.length}`);
console.log(`📊 Expected chains: 47`);
console.log(`${chainIds.length >= 47 ? '✅' : '❌'} All chains present: ${chainIds.length >= 47 ? 'Yes' : 'No'}`);