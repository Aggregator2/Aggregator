// Test LiFi API integration
const fetch = require('node-fetch');

async function testLiFiAPI() {
  console.log('Testing LiFi API integration...\n');
  
  const testCases = [
    {
      sellToken: 'WETH',
      sellAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      buyToken: 'USDC', 
      buyAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      sellAmount: '1000000000000000000' // 1 WETH
    },
    {
      sellToken: '1INCH',
      sellAddress: '0x111111111117dc0aa78b770fa6a738034120c302',
      buyToken: 'USDC',
      buyAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 
      sellAmount: '1000000000000000000' // 1 1INCH
    }
  ];

  for (const test of testCases) {
    console.log(`\nTesting ${test.sellToken} -> ${test.buyToken}:`);
    
    try {
      const response = await fetch('http://localhost:3000/api/quote-profitable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sellToken: test.sellAddress,
          buyToken: test.buyAddress,
          sellAmount: test.sellAmount,
          chainId: 1,
          slippageTolerance: '0.5'
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        // Calculate human-readable amounts
        const sellDecimals = test.sellToken === 'WETH' ? 18 : 18;
        const buyDecimals = 6; // USDC has 6 decimals
        
        const sellAmountHuman = parseFloat(test.sellAmount) / Math.pow(10, sellDecimals);
        const buyAmountHuman = parseFloat(data.buyAmount) / Math.pow(10, buyDecimals);
        const buyAmountBeforeFeeHuman = parseFloat(data.buyAmountBeforeFee) / Math.pow(10, buyDecimals);
        const platformFeeHuman = parseFloat(data.platformFee.amount) / Math.pow(10, buyDecimals);
        
        console.log(`  ✅ Quote received successfully`);
        console.log(`  Sell: ${sellAmountHuman} ${test.sellToken}`);
        console.log(`  Buy (before fee): ${buyAmountBeforeFeeHuman.toFixed(2)} ${test.buyToken}`);
        console.log(`  Platform fee: ${platformFeeHuman.toFixed(2)} ${test.buyToken} (${data.platformFee.percentage}%)`);
        console.log(`  Buy (after fee): ${buyAmountHuman.toFixed(2)} ${test.buyToken}`);
        console.log(`  Effective rate: 1 ${test.sellToken} = ${buyAmountHuman.toFixed(2)} ${test.buyToken}`);
        
        // Check if fee breakdown is transparent
        if (data.feeBreakdown) {
          console.log(`  ✅ Fee transparency included`);
        }
      } else {
        console.log(`  ❌ Error: ${data.error}`);
        if (data.details) {
          console.log(`  Details: ${data.details}`);
        }
      }
    } catch (error) {
      console.log(`  ❌ Request failed: ${error.message}`);
    }
  }
}

// Run the test
testLiFiAPI().catch(console.error);