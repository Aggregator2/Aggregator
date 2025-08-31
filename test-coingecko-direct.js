const coingeckoService = require('./src/services/coingeckoService');

async function test() {
  try {
    console.log('Testing CoinGecko service...');
    
    const quote = await coingeckoService.getQuote(
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
      '1000000', // 1 USDC
      6, // USDC decimals
      18 // WETH decimals
    );
    
    console.log('Quote received:', quote);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();