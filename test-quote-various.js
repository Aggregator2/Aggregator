const fetch = require('node-fetch');

async function testQuotes() {
  const testCases = [
    { amount: '1000000000000000000', label: '1 WETH' },
    { amount: '2000000000000000000', label: '2 WETH' },
    { amount: '500000000000000000', label: '0.5 WETH' },
  ];

  for (const test of testCases) {
    console.log(`\nTesting quote for ${test.label}:`);
    
    const quoteRequest = {
      sellToken: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      buyToken: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
      sellAmount: test.amount,
      user: '0x000000000000000000000000000000000000dead',
      chainId: 1
    };

    try {
      const response = await fetch('http://localhost:3000/api/quote-profitable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quoteRequest),
      });

      const data = await response.json();
      
      if (response.ok) {
        const sellAmountEth = parseFloat(quoteRequest.sellAmount) / 1e18;
        const buyAmountDai = parseFloat(data.buyAmount) / 1e18;
        const rate = buyAmountDai / sellAmountEth;
        
        console.log(`✅ Success: ${test.label} = ${buyAmountDai.toFixed(2)} DAI (Rate: ${rate.toFixed(2)} DAI/WETH)`);
      } else {
        console.log(`❌ Failed: ${data.error}`);
      }
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
  }
}

testQuotes().catch(console.error);