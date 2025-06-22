const fetch = require('node-fetch');

async function testQuote() {
  console.log('Testing clean quote generation...\n');
  
  const quoteRequest = {
    sellToken: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH on Arbitrum
    buyToken: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',  // DAI on Arbitrum
    sellAmount: '1000000000000000000', // 1 WETH
    user: '0x000000000000000000000000000000000000dead',
    chainId: 1 // Testing with Ethereum mainnet
  };

  try {
    console.log('Sending quote request:', JSON.stringify(quoteRequest, null, 2));
    
    const response = await fetch('http://localhost:3000/api/quote-profitable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(quoteRequest),
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('\n✅ Quote generated successfully!');
      console.log('Response:', JSON.stringify(data, null, 2));
      
      // Calculate and display the effective rate
      const sellAmountEth = parseFloat(quoteRequest.sellAmount) / 1e18;
      const buyAmountDai = parseFloat(data.buyAmount) / 1e18;
      const rate = buyAmountDai / sellAmountEth;
      
      console.log(`\nEffective rate: 1 WETH = ${rate.toFixed(2)} DAI`);
      console.log(`Source: ${data.source}`);
    } else {
      console.log('\n❌ Quote failed:', data.error);
    }
  } catch (error) {
    console.error('\n❌ Request failed:', error.message);
  }
}

testQuote().catch(console.error);