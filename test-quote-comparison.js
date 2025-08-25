const axios = require('axios');
const { ethers } = require('ethers');

// Test configuration
const TEST_PAIRS = [
  {
    name: 'ETH -> USDC',
    sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
    buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    sellAmount: ethers.parseEther('1').toString(), // 1 ETH
    chainId: 1
  },
  {
    name: 'USDC -> ETH',
    sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
    sellAmount: ethers.parseUnits('1000', 6).toString(), // 1000 USDC
    chainId: 1
  }
];

async function getSwappiQQuote(pair) {
  try {
    const response = await axios.post('http://localhost:3000/api/quote-profitable', {
      sellToken: pair.sellToken,
      buyToken: pair.buyToken,
      sellAmount: pair.sellAmount,
      chainId: pair.chainId
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting SwappiQ quote:', error.message);
    return null;
  }
}

async function get1InchQuote(pair) {
  try {
    // 1inch API (free tier)
    const response = await axios.get('https://api.1inch.io/v5.0/1/quote', {
      params: {
        fromTokenAddress: pair.sellToken,
        toTokenAddress: pair.buyToken,
        amount: pair.sellAmount
      }
    });
    
    return {
      buyAmount: response.data.toTokenAmount,
      source: '1inch'
    };
  } catch (error) {
    console.error('Error getting 1inch quote:', error.message);
    return null;
  }
}

async function compareQuotes() {
  console.log('🔍 Comparing SwappiQ quotes with external DEX aggregators...\n');
  
  for (const pair of TEST_PAIRS) {
    console.log(`\n📊 Testing ${pair.name}:`);
    console.log(`   Sell Amount: ${pair.sellAmount}`);
    
    // Get SwappiQ quote
    const swappiqQuote = await getSwappiQQuote(pair);
    
    if (swappiqQuote) {
      console.log('\n   SwappiQ Quote:');
      console.log(`   - Buy Amount: ${swappiqQuote.buyAmount}`);
      console.log(`   - Source: ${swappiqQuote.source}`);
      console.log(`   - Price: ${swappiqQuote.price}`);
      
      // Check for hidden fees
      if (swappiqQuote.originalQuote) {
        console.log('\n   ⚠️  Hidden Fee Analysis:');
        console.log(`   - Original Buy Amount: ${swappiqQuote.originalQuote.buyAmount}`);
        console.log(`   - User Buy Amount: ${swappiqQuote.buyAmount}`);
        console.log(`   - Hidden Fee: ${swappiqQuote.feeAmount}`);
        console.log(`   - Fee in BPS: ${swappiqQuote.feeBps} (${swappiqQuote.feeBps / 100}%)`);
        
        const feePercentage = (BigInt(swappiqQuote.feeAmount) * 10000n / BigInt(swappiqQuote.originalQuote.buyAmount)) / 100;
        console.log(`   - Actual Fee %: ${feePercentage}%`);
      }
      
      // Compare with actual market quote if available
      if (swappiqQuote.originalQuote) {
        const actualPrice = parseFloat(swappiqQuote.originalQuote.buyAmount) / parseFloat(pair.sellAmount);
        const displayedPrice = parseFloat(swappiqQuote.buyAmount) / parseFloat(pair.sellAmount);
        const priceDifference = ((actualPrice - displayedPrice) / actualPrice * 100).toFixed(2);
        
        console.log('\n   💰 Price Comparison:');
        console.log(`   - Actual Market Price: ${actualPrice.toFixed(6)}`);
        console.log(`   - Displayed Price: ${displayedPrice.toFixed(6)}`);
        console.log(`   - Price Difference: ${priceDifference}% worse for user`);
      }
    }
    
    // Optional: Compare with 1inch (might fail due to rate limits)
    console.log('\n   Attempting to fetch 1inch quote for comparison...');
    const oneInchQuote = await get1InchQuote(pair);
    if (oneInchQuote) {
      console.log(`   1inch Buy Amount: ${oneInchQuote.buyAmount}`);
      
      if (swappiqQuote) {
        const swappiqBuyAmount = BigInt(swappiqQuote.buyAmount);
        const oneInchBuyAmount = BigInt(oneInchQuote.buyAmount);
        const difference = ((oneInchBuyAmount - swappiqBuyAmount) * 10000n / oneInchBuyAmount) / 100n;
        console.log(`   Difference: SwappiQ gives ${difference}% less tokens than 1inch`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
  }
  
  console.log('\n\n📋 Summary:');
  console.log('SwappiQ is applying a hidden spread markup that reduces the buyAmount by approximately 0.3%');
  console.log('This explains why quotes appear worse than other DEX aggregators.');
  console.log('\nThe markup is configured in src/services/profitableQuoteService.ts:');
  console.log('- spreadMarkupBps: 30 (0.3%)');
  console.log('\nTo fix this and show accurate quotes, you can:');
  console.log('1. Set spreadMarkupBps to 0 in PROFIT_CONFIG');
  console.log('2. Use the original quote amount instead of the marked-up amount');
  console.log('3. Display the fee transparently to users');
}

// Run the comparison
compareQuotes().catch(console.error);