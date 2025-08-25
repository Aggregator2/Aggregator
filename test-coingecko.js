// Test CoinGecko service
const coingeckoService = require('./src/services/coingeckoService');

async function test() {
  console.log('Testing CoinGecko service...\n');
  
  const tokens = [
    { address: '0x111111111117dc0aa78b770fa6a738034120c302', name: '1INCH' },
    { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', name: 'WETH' },
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', name: 'USDC' }
  ];
  
  // Test individual prices
  for (const token of tokens) {
    try {
      const price = await coingeckoService.getTokenPrice(token.address);
      console.log(`${token.name} price: $${price}`);
    } catch (error) {
      console.log(`${token.name} error: ${error.message}`);
    }
  }
  
  // Test quote
  console.log('\nTesting 1INCH -> USDC quote:');
  try {
    const quote = await coingeckoService.getQuote(
      '0x111111111117dc0aa78b770fa6a738034120c302', // 1INCH
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      '1000000000000000000', // 1 1INCH
      18, // 1INCH decimals
      6   // USDC decimals
    );
    
    console.log('Quote details:');
    console.log('  1INCH price:', quote.sellPrice);
    console.log('  USDC price:', quote.buyPrice);
    console.log('  Exchange rate:', quote.rate);
    console.log('  Buy amount (raw):', quote.buyAmount);
    console.log('  Buy amount (human):', parseFloat(quote.buyAmount) / 1e6, 'USDC');
  } catch (error) {
    console.log('Quote error:', error.message);
  }
}

test();