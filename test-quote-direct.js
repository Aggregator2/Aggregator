const axios = require('axios');
const { ethers } = require('ethers');

async function testQuoteAPI() {
  console.log('🔍 Testing SwappiQ Quote API directly...\n');
  
  try {
    const response = await axios.post('http://localhost:3000/api/quote-profitable', {
      sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
      buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      sellAmount: ethers.parseEther('1').toString(), // 1 ETH
      chainId: 1
    });
    
    console.log('✅ Quote Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Check if there's hidden markup
    const quote = response.data;
    if (quote.originalQuote && quote.buyAmount) {
      const originalBuyAmount = BigInt(quote.originalQuote.buyAmount);
      const userBuyAmount = BigInt(quote.buyAmount);
      const hiddenFee = originalBuyAmount - userBuyAmount;
      const feePercentage = (hiddenFee * 10000n / originalBuyAmount) / 100n;
      
      console.log('\n💰 Hidden Fee Analysis:');
      console.log(`Original Buy Amount: ${originalBuyAmount.toString()}`);
      console.log(`User Buy Amount: ${userBuyAmount.toString()}`);
      console.log(`Hidden Fee: ${hiddenFee.toString()}`);
      console.log(`Fee Percentage: ${feePercentage.toString()}%`);
      
      console.log('\n⚠️  ISSUE FOUND:');
      console.log(`SwappiQ is reducing the quote by ${feePercentage}% compared to the actual market price.`);
      console.log('This is why your quotes don\'t match other DEX aggregators.');
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testQuoteAPI();