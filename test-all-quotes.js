// Test all quote scenarios
const fetch = require('node-fetch');

async function testQuotes() {
  console.log('Testing SwappiQ quote endpoint with real-time prices...\n');
  
  const testCases = [
    {
      name: 'WETH -> USDC',
      sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      sellAmount: '1000000000000000000', // 1 WETH
      expectedRange: [4500, 5000] // Expected USDC range
    },
    {
      name: '1INCH -> USDC',
      sellToken: '0x111111111117dc0aa78b770fa6a738034120c302',
      buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      sellAmount: '1000000000000000000', // 1 1INCH
      expectedRange: [0.2, 0.4] // Expected USDC range
    },
    {
      name: 'ETH -> USDC',
      sellToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      sellAmount: '1000000000000000000', // 1 ETH
      expectedRange: [4500, 5000] // Expected USDC range
    }
  ];
  
  for (const test of testCases) {
    console.log(`\nTesting ${test.name}:`);
    
    try {
      const response = await fetch('http://localhost:3000/api/quote-profitable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellToken: test.sellToken,
          buyToken: test.buyToken,
          sellAmount: test.sellAmount,
          chainId: 1,
          slippageTolerance: '0.5'
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        const buyAmountHuman = parseFloat(data.buyAmount) / 1e6; // USDC has 6 decimals
        const buyAmountBeforeFeeHuman = parseFloat(data.buyAmountBeforeFee) / 1e6;
        const platformFeeHuman = parseFloat(data.platformFee.amount) / 1e6;
        
        console.log(`✅ Quote received successfully`);
        console.log(`  Buy amount (before fee): ${buyAmountBeforeFeeHuman.toFixed(2)} USDC`);
        console.log(`  Platform fee: ${platformFeeHuman.toFixed(2)} USDC (${data.platformFee.percentage}%)`);
        console.log(`  Buy amount (after fee): ${buyAmountHuman.toFixed(2)} USDC`);
        console.log(`  Effective rate: 1 ${test.name.split(' -> ')[0]} = ${buyAmountHuman.toFixed(2)} USDC`);
        
        // Check if price is in expected range
        if (buyAmountHuman >= test.expectedRange[0] && buyAmountHuman <= test.expectedRange[1]) {
          console.log(`  ✅ Price is in expected range [${test.expectedRange[0]}, ${test.expectedRange[1]}]`);
        } else {
          console.log(`  ⚠️  Price ${buyAmountHuman} is outside expected range [${test.expectedRange[0]}, ${test.expectedRange[1]}]`);
        }
        
        // Verify fee transparency
        if (data.feeBreakdown) {
          console.log(`  ✅ Fee transparency included in response`);
        }
      } else {
        console.log(`❌ Error: ${data.error}`);
        if (data.details) {
          console.log(`  Details: ${data.details}`);
        }
      }
    } catch (error) {
      console.log(`❌ Request failed: ${error.message}`);
    }
  }
}

testQuotes().catch(console.error);