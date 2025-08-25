// Test the current pricing logic to understand the issue

const tokenAddresses = {
  '1INCH': '0x111111111117dc0aa78b770fa6a738034120c302',
  'WETH': '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  'USDC': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  'SHIB': '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
  'LINK': '0x514910771af9ca656af840dff83e8264ecf986ca',
  'UNI': '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  'MATIC': '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
  'CRV': '0xd533a949740bb3306d119cc777fa900ba034cd52',
  'AAVE': '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
  'COMP': '0xc00e94cb662c3520282e6f5717214004a7f26888'
};

console.log('Testing current token pricing logic:\n');

// Hardcoded prices
const tokenPricesUSD = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 2000,  // WETH
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,     // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 1,     // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f': 1,     // DAI
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 40000, // WBTC
};

// Actual market prices (approximate)
const actualPrices = {
  '1INCH': 0.25,
  'WETH': 2000,
  'USDC': 1,
  'SHIB': 0.000008,
  'LINK': 15,
  'UNI': 5,
  'MATIC': 0.8,
  'CRV': 0.5,
  'AAVE': 65,
  'COMP': 50
};

for (const [symbol, address] of Object.entries(tokenAddresses)) {
  const addressLower = address.toLowerCase();
  
  // Check if it has a hardcoded price
  let calculatedPrice = tokenPricesUSD[addressLower];
  
  if (!calculatedPrice) {
    // Use the pseudo-random logic from the API
    const hashValue = parseInt(addressLower.slice(-4), 16);
    calculatedPrice = 0.01 + (hashValue % 10000) / 100;
  }
  
  const actualPrice = actualPrices[symbol];
  const error = ((calculatedPrice - actualPrice) / actualPrice * 100).toFixed(1);
  
  console.log(`${symbol.padEnd(6)} | Address: ${address}`);
  console.log(`       | Calculated: $${calculatedPrice.toFixed(6)}`);
  console.log(`       | Actual: $${actualPrice.toFixed(6)}`);
  console.log(`       | Error: ${error}%`);
  console.log(`       | ${Math.abs(error) > 50 ? '❌ MAJOR ERROR' : '✅ Acceptable'}`);
  console.log('');
}

console.log('\nProblem: The API uses pseudo-random prices for unknown tokens!');
console.log('This explains why 1INCH shows $98.93 instead of $0.25');
console.log('\nThe last 4 chars of 1INCH address (c302) = 49922 in decimal');
console.log('Price = 0.01 + (49922 % 10000) / 100 = 0.01 + 99.22 / 100 = 99.23');
console.log('\nThis is completely wrong and needs to be fixed with real price data!');