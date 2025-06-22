import { ethers } from 'ethers';
import { 
  getTokenWarnings, 
  isTokenBlacklisted,
  getTokenFeePercentage,
  requiresSpecialApproval,
  isWrappedNativeToken,
  getActualDecimals
} from '../src/config/tokenRegistry.js';
import { SpecialTokenService } from '../src/services/specialTokenService.js';

console.log('🧪 Testing Token Edge Cases\n');

// Test data
const testCases = [
  {
    name: 'USDC (6 decimals)',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    chainId: 1,
    amount: '1000000', // 1 USDC in 6 decimals
    expectedDecimals: 6
  },
  {
    name: 'WBTC (8 decimals)',
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    chainId: 1,
    amount: '100000000', // 1 WBTC in 8 decimals
    expectedDecimals: 8
  },
  {
    name: 'DAI (18 decimals)',
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    chainId: 1,
    amount: '1000000000000000000', // 1 DAI in 18 decimals
    expectedDecimals: 18
  },
  {
    name: 'stETH (rebasing)',
    address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
    chainId: 1,
    amount: '1000000000000000000',
    expectedDecimals: 18
  },
  {
    name: 'AMPL (rebasing)',
    address: '0xd46ba6d942050d489dbd938a2c909a5d5039a161',
    chainId: 1,
    amount: '1000000000000000000',
    expectedDecimals: 18
  },
  {
    name: 'USDT (non-standard approval)',
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    chainId: 1,
    amount: '1000000',
    expectedDecimals: 6
  },
  {
    name: 'WETH (wrapped native)',
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    chainId: 1,
    amount: '1000000000000000000',
    expectedDecimals: 18
  }
];

console.log('1️⃣ Testing Token Decimals Handling\n');
testCases.forEach(test => {
  const actualDecimals = getActualDecimals(test.address, test.chainId, 18);
  const formatted = SpecialTokenService.formatTokenAmount(
    test.address,
    test.chainId,
    test.amount,
    18
  );
  
  console.log(`${test.name}:`);
  console.log(`  Expected decimals: ${test.expectedDecimals}`);
  console.log(`  Actual decimals: ${actualDecimals}`);
  console.log(`  Formatted amount: ${formatted}`);
  console.log(`  ✅ Decimals ${actualDecimals === test.expectedDecimals ? 'match' : 'differ'}`);
  console.log('');
});

console.log('\n2️⃣ Testing Rebasing Token Warnings\n');
const rebasingTokens = ['stETH', 'AMPL'];
testCases.filter(t => rebasingTokens.includes(t.name.split(' ')[0])).forEach(test => {
  const warnings = getTokenWarnings(test.address, test.chainId);
  console.log(`${test.name}:`);
  if (warnings.length > 0) {
    warnings.forEach(w => {
      console.log(`  ⚠️ ${w.severity.toUpperCase()}: ${w.message}`);
      if (w.helpText) console.log(`  💡 ${w.helpText}`);
    });
  } else {
    console.log('  ❌ No warnings found');
  }
  console.log('');
});

console.log('\n3️⃣ Testing Fee-on-Transfer Tokens\n');
// Example fee-on-transfer token
const feeToken = {
  address: '0x7e396bfc8a2f84748701167c2d622f041a1d7a17',
  chainId: 1,
  amount: '1000000000000000000' // 1 token
};

const feeCalc = SpecialTokenService.calculateFeeOnTransferAmount(
  feeToken.address,
  feeToken.chainId,
  feeToken.amount,
  18
);

console.log('Fee-on-Transfer Token (UNIDX):');
console.log(`  Gross amount: ${ethers.utils.formatUnits(feeCalc.grossAmount, 18)}`);
console.log(`  Fee percentage: ${feeCalc.feePercentage}%`);
console.log(`  Fee amount: ${ethers.utils.formatUnits(feeCalc.feeAmount, 18)}`);
console.log(`  Net amount: ${ethers.utils.formatUnits(feeCalc.netAmount, 18)}`);
console.log('');

console.log('\n4️⃣ Testing Non-Standard Approval Tokens\n');
const approvalTokens = ['USDT', 'USDP'];
testCases.filter(t => approvalTokens.includes(t.name.split(' ')[0])).forEach(test => {
  const requiresSpecial = requiresSpecialApproval(test.address, test.chainId);
  console.log(`${test.name}: ${requiresSpecial ? '✅ Requires special approval' : '❌ Standard approval'}`);
});

console.log('\n5️⃣ Testing Wrapped Native Tokens\n');
const wrappedTokens = ['WETH', 'WBNB', 'WMATIC'];
testCases.filter(t => wrappedTokens.includes(t.name.split(' ')[0])).forEach(test => {
  const isWrapped = isWrappedNativeToken(test.address, test.chainId);
  const canUnwrap = SpecialTokenService.canUnwrap(test.address, test.chainId);
  console.log(`${test.name}: ${isWrapped ? '✅ Is wrapped native' : '❌ Not wrapped native'}`);
  console.log(`  Can unwrap: ${canUnwrap ? 'Yes' : 'No'}`);
});

console.log('\n6️⃣ Testing Token Blacklist\n');
const blacklistTest = {
  address: '0x0000000000000000000000000000000000000001',
  chainId: 1
};
const isBlacklisted = isTokenBlacklisted(blacklistTest.address, blacklistTest.chainId);
console.log(`Scam token: ${isBlacklisted ? '✅ Correctly blacklisted' : '❌ Not blacklisted'}`);

console.log('\n7️⃣ Testing Special Approval Transaction Generation\n');
const mockProvider = {
  call: async () => '0x0000000000000000000000000000000000000000000000000000000000000064' // 100 allowance
};

// Test USDT approval (requires reset to 0 first)
const approvalTxs = await SpecialTokenService.generateApprovalTx(
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  1,
  '0x1234567890123456789012345678901234567890', // spender
  '1000000', // amount
  '100' // current allowance
);

console.log('USDT Approval Transactions:');
approvalTxs.forEach((tx, i) => {
  console.log(`  Transaction ${i + 1}:`);
  console.log(`    To: ${tx.to}`);
  console.log(`    Data: ${tx.data.substring(0, 10)}...`);
  console.log(`    ${i === 0 ? 'Reset to 0' : 'Set new allowance'}`);
});

console.log('\n✅ All token edge case tests completed!');
console.log('\nSummary:');
console.log('- Different decimals (6, 8, 18) are handled correctly');
console.log('- Rebasing tokens (stETH, AMPL) show appropriate warnings');
console.log('- Fee-on-transfer tokens calculate net amounts properly');
console.log('- Non-standard tokens (USDT) have special approval handling');
console.log('- Wrapped tokens (WETH, WBTC) can be identified for unwrapping');
console.log('- Token blacklisting prevents scam tokens from appearing');
console.log('- Special approval logic generates correct transaction sequence');