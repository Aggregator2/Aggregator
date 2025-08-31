// Test decimal validation for quote-profitable endpoint

async function testDecimalValidation() {
  console.log('Testing decimal validation for quote-profitable endpoint...\n');

  // Test cases with different token pairs and amounts
  const testCases = [
    {
      name: 'USDC to USDT (6 decimals each)',
      sellToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      buyToken: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      sellAmount: '1000000', // 1 USDC
      expectedMinDigits: 6
    },
    {
      name: 'ETH to DAI (18 decimals each)',
      sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
      buyToken: '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
      sellAmount: '1000000000000000000', // 1 ETH
      expectedMinDigits: 18
    },
    {
      name: 'WBTC to USDC (8 to 6 decimals)',
      sellToken: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
      buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      sellAmount: '100000000', // 1 WBTC
      expectedMinDigits: 6
    },
    {
      name: 'Small amount - USDC to USDT',
      sellToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      buyToken: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      sellAmount: '100', // 0.0001 USDC
      expectedMinDigits: 6
    }
  ];

  for (const testCase of testCases) {
    console.log(`\nTest: ${testCase.name}`);
    console.log(`Sell Token: ${testCase.sellToken}`);
    console.log(`Buy Token: ${testCase.buyToken}`);
    console.log(`Sell Amount: ${testCase.sellAmount}`);

    try {
      const response = await fetch('http://localhost:3000/api/quote-profitable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sellToken: testCase.sellToken,
          buyToken: testCase.buyToken,
          sellAmount: testCase.sellAmount,
          chainId: 1,
          toChainId: 1,
          slippageTolerance: '0.5'
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.log('❌ Error:', data.error);
        continue;
      }

      console.log(`Buy Amount: ${data.buyAmount} (${data.buyAmount.length} digits)`);
      console.log(`Buy Amount Before Fee: ${data.buyAmountBeforeFee} (${data.buyAmountBeforeFee.length} digits)`);
      console.log(`Min Received: ${data.minReceived} (${data.minReceived.length} digits)`);

      // Check if amounts have at least the expected minimum digits
      const buyAmountValid = data.buyAmount.length >= testCase.expectedMinDigits;
      const buyAmountBeforeFeeValid = data.buyAmountBeforeFee.length >= testCase.expectedMinDigits;
      const minReceivedValid = data.minReceived.length >= testCase.expectedMinDigits;

      if (buyAmountValid && buyAmountBeforeFeeValid && minReceivedValid) {
        console.log('✅ All amounts have correct decimal precision');
      } else {
        console.log('❌ Precision issues detected:');
        if (!buyAmountValid) console.log(`  - buyAmount has ${data.buyAmount.length} digits, expected at least ${testCase.expectedMinDigits}`);
        if (!buyAmountBeforeFeeValid) console.log(`  - buyAmountBeforeFee has ${data.buyAmountBeforeFee.length} digits, expected at least ${testCase.expectedMinDigits}`);
        if (!minReceivedValid) console.log(`  - minReceived has ${data.minReceived.length} digits, expected at least ${testCase.expectedMinDigits}`);
      }

      // Show fee breakdown
      if (data.feeBreakdown) {
        console.log('Fee Breakdown:', data.feeBreakdown);
      }

    } catch (error) {
      console.log('❌ Request failed:', error.message);
    }
  }
}

// Run the test
testDecimalValidation().catch(console.error);