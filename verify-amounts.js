// Verify the order amounts
const ethers = require('ethers');

// Order data
const sellAmount = "1000000"; // 1 USDC (6 decimals)
const buyAmount = "284857142857143"; // WETH amount (18 decimals)

// Convert to human readable
const sellAmountHuman = ethers.formatUnits(sellAmount, 6);
const buyAmountHuman = ethers.formatUnits(buyAmount, 18);

console.log('Order Details:');
console.log('Sell Amount:', sellAmountHuman, 'USDC');
console.log('Buy Amount:', buyAmountHuman, 'WETH');

// Calculate rate
const rate = parseFloat(buyAmountHuman) / parseFloat(sellAmountHuman);
console.log('Rate: 1 USDC =', rate, 'WETH');

// Calculate implied ETH price
const impliedEthPrice = 1 / rate;
console.log('Implied ETH Price: $' + impliedEthPrice.toFixed(2));

// Verify with platform fee
const platformFeeBps = 30; // 0.3%
const buyAmountBeforeFee = BigInt(buyAmount) * BigInt(10000) / BigInt(10000 - platformFeeBps);
console.log('\nBuy amount before 0.3% fee:', buyAmountBeforeFee.toString());
console.log('Buy amount before fee (human):', ethers.formatUnits(buyAmountBeforeFee.toString(), 18), 'WETH');

// Check chainId issue
const chainIdHex = "0x1";
const chainIdNumber = parseInt(chainIdHex, 16);
console.log('\nChain ID:');
console.log('Hex:', chainIdHex);
console.log('Number:', chainIdNumber);