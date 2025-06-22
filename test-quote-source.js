const fetch = require('node-fetch');

async function testQuoteSource() {
  console.log('Testing quote source...\n');
  
  const quoteRequest = {
    sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on Ethereum
    buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC on Ethereum
    sellAmount: '1000000000000000000', // 1 WETH
    user: '0x000000000000000000000000000000000000dead',
    chainId: 1
  };

  try {
    console.log('Sending quote request for WETH -> USDC on Ethereum mainnet');
    
    const response = await fetch('http://localhost:3000/api/quote-profitable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(quoteRequest),
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('\n✅ Quote successful!');
      console.log(`Source: ${data.source}`);
      console.log(`Buy Amount: ${data.buyAmount}`);
      console.log(`Price: ${data.price}`);
      
      // Check if it's using a real DEX or fallback
      if (data.source === 'Uniswap' || data.source === 'fallback' || data.source === 'Fallback Rate') {
        console.log('\n⚠️  Using fallback rates - no live DEX quotes available');
      } else {
        console.log('\n✅ Using live DEX quote from:', data.source);
      }
    } else {
      console.log('\n❌ Quote failed:', data.error);
    }
  } catch (error) {
    console.error('\n❌ Request failed:', error.message);
  }
}

testQuoteSource().catch(console.error);